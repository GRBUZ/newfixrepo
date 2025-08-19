// netlify/functions/paypal-create-order.js
const { requireAuth, getAuthenticatedUID } = require('../../jwt-middleware.js');

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
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

// Sauvegarder les détails de la commande (à adapter selon votre BDD)
async function saveOrderDetails(orderId, orderData) {
  // TODO: Sauvegarder en base de données
  // En attendant, on peut utiliser un cache temporaire
  console.log(`💾 [ORDER] Sauvegarde commande ${orderId}:`, orderData);
  
  // Exemple avec un cache en mémoire (à remplacer par votre BDD)
  if (!global.orderCache) global.orderCache = new Map();
  global.orderCache.set(orderId, {
    ...orderData,
    createdAt: new Date().toISOString(),
    status: 'PENDING'
  });
}

// Handler principal protégé par JWT
const handler = requireAuth(async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Méthode non autorisée' })
    };
  }

  try {
    // 1. Récupérer l'UID authentifié
    const uid = getAuthenticatedUID(event);
    
    // 2. Parser les données
    const { blocks, amount, currency, email, name, linkUrl } = JSON.parse(event.body || '{}');
    
    // 3. Validations
    if (!Array.isArray(blocks) || blocks.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Blocs invalides' })
      };
    }
    
    if (!amount || !currency || !email || !name || !linkUrl) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Données manquantes' })
      };
    }
    
    // 4. Validation de l'URL
    let validatedUrl = linkUrl.trim();
    if (!/^https?:\/\//i.test(validatedUrl)) {
      validatedUrl = 'https://' + validatedUrl;
    }
    
    // 5. SÉCURITÉ: Vérifier que les blocs sont réservés par cet UID
    const areBlocksReserved = await validateUserBlocksReservation(blocks, uid);
    if (!areBlocksReserved) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ 
          error: 'Blocs non réservés ou expirés',
          code: 'BLOCKS_NOT_RESERVED'
        })
      };
    }
    
    // 6. Créer la commande PayPal
    const accessToken = await getPayPalAccessToken();
    
    const orderData = {
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: currency,
          value: amount
        },
        description: `${blocks.length} blocs publicitaires (${blocks.length * 100} pixels)`,
        custom_id: `${uid}_${Date.now()}`, // Identifiant unique
        invoice_id: `INV_${uid.slice(0, 8)}_${Date.now()}` // Facture unique
      }],
      application_context: {
        brand_name: 'Million Pixels',
        landing_page: 'BILLING',
        user_action: 'PAY_NOW',
        return_url: `${process.env.URL}/payment-success`,
        cancel_url: `${process.env.URL}/payment-cancel`
      }
    };
    
    const createResponse = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(orderData)
    });
    
    if (!createResponse.ok) {
      const error = await createResponse.json();
      throw new Error(`PayPal order creation failed: ${JSON.stringify(error)}`);
    }
    
    const order = await createResponse.json();
    
    // 7. Sauvegarder les détails de la commande
    await saveOrderDetails(order.id, {
      paypalOrderId: order.id,
      uid,
      blocks,
      amount,
      currency,
      email: email.trim(),
      name: name.trim(),
      linkUrl: validatedUrl,
      status: 'CREATED'
    });
    
    console.log(`✅ [PAYPAL] Commande créée: ${order.id} pour UID ${uid.slice(0, 8)}... (${blocks.length} blocs)`);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        id: order.id,
        status: order.status,
        links: order.links
      })
    };

  } catch (error) {
    console.error('❌ [PAYPAL] Erreur création commande:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Erreur création commande PayPal',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
});

// Fonction utilitaire (à adapter selon votre système)
async function validateUserBlocksReservation(blocks, uid) {
  // TODO: Vérifier dans votre système de locks que ces blocs sont réservés par cet UID
  // Pour l'instant, retourne true (à implémenter selon votre logique)
  
  console.log(`🔍 [VALIDATION] Vérification réservation ${blocks.length} blocs pour UID ${uid.slice(0, 8)}...`);
  
  // Exemple de validation basique
  try {
    // Ici vous devriez vérifier votre système de locks
    // Exemple : const locks = await getLocks(); return locks.filter(l => l.uid === uid && blocks.includes(l.blockId)).length === blocks.length;
    return true; // À remplacer par votre logique
  } catch (error) {
    console.error('Erreur validation réservation:', error);
    return false;
  }
}

exports.handler = handler;