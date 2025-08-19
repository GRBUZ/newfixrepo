// netlify/functions/paypal-webhook.js
const crypto = require('crypto');

// Configuration PayPal (variables d'environnement)
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;
const PAYPAL_BASE_URL = process.env.PAYPAL_SANDBOX === 'true' 
  ? 'https://api.sandbox.paypal.com' 
  : 'https://api.paypal.com';

// Obtenir un token d'accès PayPal
async function getPayPalAccessToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  
  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  
  if (!response.ok) {
    throw new Error(`Erreur token PayPal: ${response.status}`);
  }
  
  const data = await response.json();
  return data.access_token;
}

// Vérifier la signature du webhook PayPal
async function verifyPayPalWebhook(headers, body, webhookId) {
  try {
    const accessToken = await getPayPalAccessToken();
    
    // Construire la requête de vérification
    const verificationData = {
      auth_algo: headers['paypal-auth-algo'],
      cert_id: headers['paypal-cert-id'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: JSON.parse(body)
    };

    const verifyResponse = await fetch(`${PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(verificationData)
    });

    if (!verifyResponse.ok) {
      throw new Error(`Vérification échouée: ${verifyResponse.status}`);
    }

    const result = await verifyResponse.json();
    return result.verification_status === 'SUCCESS';
    
  } catch (error) {
    console.error('Erreur vérification PayPal:', error);
    return false;
  }
}

// Handler principal du webhook
exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  // Seules les requêtes POST sont acceptées
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Méthode non autorisée' })
    };
  }

  try {
    // 1. VÉRIFICATION CRITIQUE: Signature PayPal
    const isValid = await verifyPayPalWebhook(
      event.headers, 
      event.body, 
      PAYPAL_WEBHOOK_ID
    );

    if (!isValid) {
      console.error('🚨 [SECURITY] Signature PayPal invalide!', {
        ip: event.headers['x-forwarded-for'],
        headers: event.headers
      });
      
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Signature invalide' })
      };
    }

    // 2. Parser l'événement PayPal
    const webhookEvent = JSON.parse(event.body);
    const eventType = webhookEvent.event_type;
    const resource = webhookEvent.resource;

    console.log(`✅ [PAYPAL] Événement vérifié: ${eventType}`, {
      id: webhookEvent.id,
      orderId: resource?.id
    });

    // 3. Traitement selon le type d'événement
    switch (eventType) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        return await handlePaymentCompleted(resource, webhookEvent);
        
      case 'PAYMENT.CAPTURE.DENIED':
      case 'PAYMENT.CAPTURE.FAILED':
        return await handlePaymentFailed(resource, webhookEvent);
        
      case 'CHECKOUT.ORDER.APPROVED':
        // Optionnel: log que l'utilisateur a approuvé
        console.log(`📋 [PAYPAL] Commande approuvée: ${resource.id}`);
        break;
        
      default:
        console.log(`ℹ️ [PAYPAL] Événement non géré: ${eventType}`);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ received: true })
    };

  } catch (error) {
    console.error('❌ [PAYPAL] Erreur webhook:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur serveur' })
    };
  }
};

// Gestion du paiement complété (CRITIQUE)
async function handlePaymentCompleted(resource, webhookEvent) {
  try {
    // 1. Extraire les infos du paiement
    const orderId = resource.id;
    const amount = resource.amount?.value;
    const currency = resource.amount?.currency_code;
    const payerId = resource.payer?.payer_id;
    
    // 2. Récupérer les métadonnées de la commande (blocs + UID)
    const orderDetails = await getOrderDetails(orderId);
    if (!orderDetails) {
      throw new Error(`Commande introuvable: ${orderId}`);
    }

    const { blocks, uid, email, name, linkUrl } = orderDetails;
    
    // 3. VALIDATION CRITIQUE: Vérifier que les blocs sont toujours réservés par cet UID
    const areBlocksStillReserved = await validateBlocksReservation(blocks, uid);
    if (!areBlocksStillReserved) {
      console.error(`🚨 [SECURITY] Blocs non réservés pour UID ${uid}:`, blocks);
      
      // Rembourser automatiquement si possible
      await refundPayment(orderId, 'Blocs non disponibles');
      
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Blocs non disponibles', 
          refunded: true 
        })
      };
    }

    // 4. FINALISATION: Marquer les blocs comme vendus
    await finalizeBlocksSale({
      blocks,
      uid,
      email,
      name, 
      linkUrl,
      paypalOrderId: orderId,
      amount,
      currency,
      payerId
    });

    console.log(`🎉 [PAYPAL] Vente finalisée: ${blocks.length} blocs pour ${amount} ${currency}`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: true,
        blocks: blocks.length,
        orderId
      })
    };

  } catch (error) {
    console.error('❌ [PAYPAL] Erreur finalisation:', error);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Erreur finalisation' })
    };
  }
}

// Gestion du paiement échoué
async function handlePaymentFailed(resource, webhookEvent) {
  const orderId = resource.id;
  
  try {
    // Libérer les blocs réservés
    const orderDetails = await getOrderDetails(orderId);
    if (orderDetails && orderDetails.blocks) {
      await releaseBlocks(orderDetails.blocks, orderDetails.uid);
      console.log(`🔓 [PAYPAL] Blocs libérés après échec: ${orderDetails.blocks.length}`);
    }
    
  } catch (error) {
    console.error('❌ [PAYPAL] Erreur libération blocs:', error);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ received: true })
  };
}

// Fonctions utilitaires (à adapter selon votre base de données)
async function getOrderDetails(orderId) {
  // TODO: Récupérer depuis votre base de données
  // Retour attendu: { blocks: [1,2,3], uid: "abc", email: "...", name: "...", linkUrl: "..." }
  return null;
}

async function validateBlocksReservation(blocks, uid) {
  // TODO: Vérifier que ces blocs sont toujours réservés par cet UID
  return false;
}

async function finalizeBlocksSale(data) {
  // TODO: Marquer les blocs comme vendus dans votre base
  console.log('Finalisation vente:', data);
}

async function releaseBlocks(blocks, uid) {
  // TODO: Libérer les blocs réservés
  console.log('Libération blocs:', blocks);
}

async function refundPayment(orderId, reason) {
  // TODO: Implémenter le remboursement automatique si nécessaire
  console.log(`Remboursement nécessaire: ${orderId} - ${reason}`);
}