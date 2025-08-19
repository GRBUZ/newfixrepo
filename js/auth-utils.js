
// auth-utils.js — Utilitaires JWT sans import/export (utilisation via <script>)
// Déclare les fonctions globales : window.fetchWithJWT et window.authUtils.getUIDFromToken

(function(){
  const jwtKey = 'jwtToken';

  // Fonction pour envoyer un fetch avec le JWT stocké
  async function fetchWithJWT(url, options = {}) {
    const token = localStorage.getItem(jwtKey);
    const headers = options.headers || {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch(url, { ...options, headers });
  }

  // Fonction pour décoder le payload du JWT sans vérifier la signature (client-side only)
  function decodeJWT(token) {
    try {
      const payload = token.split('.')[1];
      const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(json);
    } catch (e) {
      console.warn('[auth-utils] Impossible de décoder le JWT');
      return null;
    }
  }

  // Fonction pour récupérer le UID du token JWT (si disponible)
  function getUIDFromToken() {
    const token = localStorage.getItem(jwtKey);
    if (!token) return null;
    const decoded = decodeJWT(token);
    return decoded?.uid || null;
  }

  // Initialisation globale
  window.fetchWithJWT = fetchWithJWT;
  window.authUtils = {
    getUIDFromToken
  };
})();
