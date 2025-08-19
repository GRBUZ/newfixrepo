// paypal-integration.js - Intégration PayPal frontend
(function(window) {
  'use strict';
  
  let paypalOrderId = null;
  
  // Initialiser PayPal SDK
  function initPayPal(clientId, currency = 'USD') {
    if (window.paypal) {
      setupPayPalButtons(currency);
      return;
    }
    
    // Charger le SDK PayPal
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=${currency}`;
    script.onload = () => setupPayPalButtons(currency);
    document.head.appendChild(script);
  }
  
  // Configuration des boutons PayPal
  function setupPayPalButtons(currency) {
    if (!window.paypal) {
      console.error('PayPal SDK non chargé');
      return;
    }
    
    window.paypal.Buttons({
      
      // 1. CRÉATION DE LA COMMANDE (côté serveur pour sécurité)
      createOrder: async function(data, actions) {
        try {
          // Récupérer les blocs sélectionnés et calculer le prix
          const selectedBlocks = Array.from(window.selected || []);
          if (!selectedBlocks.length) {
            throw new Error('Aucun bloc sélectionné');
          }
          
          const currentPrice = calculateCurrentPrice();
          const totalAmount = (selectedBlocks.length * 100 * currentPrice).toFixed(2);
          
          // Appel sécurisé vers votre backend
          const response = await window.fetchWithJWT('/.netlify/functions/paypal-create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              blocks: selectedBlocks,
              amount: totalAmount,
              currency: currency,
              email: document.getElementById('email').value,
              name: document.getElementById('name').value,
              linkUrl: document.getElementById('link').value
            })
          });
          
          if (!response.ok) {
            throw new Error('Erreur création commande PayPal');
          }
          
          const orderData = await response.json();
          paypalOrderId = orderData.id;
          
          console.log('✅ [PAYPAL] Commande créée:', paypalOrderId);
          return paypalOrderId;
          
        } catch (error) {
          console.error('❌ [PAYPAL] Erreur createOrder:', error);
          alert('Erreur lors de la création de la commande: ' + error.message);
          throw error;
        }
      },
      
      // 2. APPROBATION DE LA COMMANDE
      onApprove: async function(data, actions) {
        try {
          console.log('📋 [PAYPAL] Commande approuvée:', data.orderID);
          
          // Afficher un indicateur de traitement
          showPaymentProcessing();
          
          // Le webhook PayPal se chargera automatiquement de la finalisation
          // On attend juste la confirmation
          const result = await waitForPaymentConfirmation(data.orderID);
          
          if (result.success) {
            showPaymentSuccess();
            clearSelection();
            closeModal();
            // Recharger les données pour voir les blocs vendus
            setTimeout(async () => {
              await window.loadStatus();
              window.paintAll();
            }, 1000);
          } else {
            throw new Error(result.error || 'Paiement non confirmé');
          }
          
        } catch (error) {
          console.error('❌ [PAYPAL] Erreur onApprove:', error);
          showPaymentError(error.message);
        }
      },
      
      // 3. ANNULATION
      onCancel: function(data) {
        console.log('⚠️ [PAYPAL] Paiement annulé:', data.orderID);
        
        // Libérer les blocs réservés
        releasePendingBlocks();
        
        alert('Paiement annulé. Les blocs ont été libérés.');
      },
      
      // 4. ERREUR
      onError: function(err) {
        console.error('❌ [PAYPAL] Erreur:', err);
        
        // Libérer les blocs en cas d'erreur
        releasePendingBlocks();
        
        alert('Erreur PayPal: ' + (err.message || 'Erreur inconnue'));
      }
      
    }).render('#paypal-button-container');
  }
  
  // Attendre la confirmation de paiement via polling
  async function waitForPaymentConfirmation(orderId, maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await window.fetchWithJWT(`/.netlify/functions/paypal-check-status?orderId=${orderId}`);
        const result = await response.json();
        
        if (result.status === 'COMPLETED') {
          return { success: true };
        } else if (result.status === 'FAILED') {
          return { success: false, error: result.error };
        }
        
        // Attendre 2 secondes avant le prochain check
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        console.warn(`Tentative ${i + 1} échouée:`, error);
      }
    }
    
    return { success: false, error: 'Timeout confirmation paiement' };
  }
  
  // Libérer les blocs en attente
  async function releasePendingBlocks() {
    try {
      if (window.currentLock && window.currentLock.length) {
        await window.unlock(window.currentLock);
        window.currentLock = [];
      }
    } catch (error) {
      console.warn('Erreur libération blocs:', error);
    }
  }
  
  // Calculer le prix actuel
  function calculateCurrentPrice() {
    const blocksSold = Object.keys(window.sold || {}).length;
    const pixelsSold = blocksSold * 100;
    return 1 + Math.floor(pixelsSold / 1000) * 0.01;
  }
  
  // Interface utilisateur
  function showPaymentProcessing() {
    const btn = document.getElementById('confirm');
    btn.disabled = true;
    btn.textContent = 'Traitement PayPal...';
  }
  
  function showPaymentSuccess() {
    alert('✅ Paiement réussi ! Vos blocs publicitaires sont maintenant actifs.');
  }
  
  function showPaymentError(message) {
    const btn = document.getElementById('confirm');
    btn.disabled = false;
    btn.textContent = 'Confirmer';
    alert('❌ Erreur de paiement: ' + message);
  }
  
  // Remplacer le bouton confirm par PayPal
  function replaceConfirmButton() {
    const confirmBtn = document.getElementById('confirm');
    const paypalContainer = document.createElement('div');
    paypalContainer.id = 'paypal-button-container';
    paypalContainer.style.marginTop = '20px';
    
    confirmBtn.parentNode.insertBefore(paypalContainer, confirmBtn.nextSibling);
    confirmBtn.style.display = 'none'; // Cacher le bouton original
  }
  
  // Initialisation
  function initPayPalIntegration(clientId, currency = 'USD') {
    // Attendre que le DOM soit prêt
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        replaceConfirmButton();
        initPayPal(clientId, currency);
      });
    } else {
      replaceConfirmButton();
      initPayPal(clientId, currency);
    }
  }
  
  // Export global
  window.PayPalIntegration = {
    init: initPayPalIntegration
  };
  
})(window);

// Utilisation dans votre HTML :
// <script>
//   PayPalIntegration.init('YOUR_PAYPAL_CLIENT_ID', 'USD');
// </script>