// auth-utils.js - Version sans import/export pour script classique
(function(window) {
  'use strict';
  
  const TOKEN_DURATION = 24 * 60 * 60 * 1000; // 24h
  const STORAGE_KEY = 'iw_jwt_token';

  // Générer un UID sécurisé
  function generateSecureUID() {
    if (window.crypto && window.crypto.randomUUID) {
      return crypto.randomUUID();
    } else if (window.crypto && window.crypto.getRandomValues) {
      const arr = new Uint8Array(16);
      crypto.getRandomValues(arr);
      return Array.from(arr, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    
    // Fallback
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  // Générer une empreinte du navigateur
  async function generateFingerprint() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('Fingerprint', 2, 2);
    
    const fingerprint = {
      screen: `${screen.width}x${screen.height}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
      platform: navigator.platform,
      canvas: canvas.toDataURL().slice(-50),
      userAgent: navigator.userAgent.slice(0, 100)
    };
    
    // Hash simple
    const str = JSON.stringify(fingerprint);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    return Math.abs(hash).toString(16);
  }

  // Récupérer ou générer le token JWT
  async function getOrCreateJWT() {
    let token = localStorage.getItem(STORAGE_KEY);
    
    // Vérifier si le token existe et n'est pas expiré
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp > Date.now() / 1000) {
          return token; // Token valide
        }
      } catch (e) {
        console.warn('Token invalide, génération d\'un nouveau');
      }
    }
    
    // Générer un nouveau token via le serveur
    try {
      const response = await fetch('/.netlify/functions/auth-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: generateSecureUID(),
          fingerprint: await generateFingerprint()
        })
      });
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      if (data.token) {
        localStorage.setItem(STORAGE_KEY, data.token);
        return data.token;
      }
      
      throw new Error('Pas de token reçu');
    } catch (error) {
      console.error('Erreur génération JWT:', error);
      throw error;
    }
  }

  // Récupérer l'UID depuis le token JWT
  function getUIDFromToken() {
    try {
      const token = localStorage.getItem(STORAGE_KEY);
      if (!token) return null;
      
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.uid;
    } catch (e) {
      return null;
    }
  }

  // Effectuer une requête avec JWT
  async function fetchWithJWT(url, options = {}) {
    const token = await getOrCreateJWT();
    
    const headers = {
      'Authorization': `Bearer ${token}`,
      ...options.headers
    };
    
    const response = await fetch(url, { ...options, headers });
    
    // Si 401, regénérer le token et réessayer une fois
    if (response.status === 401) {
      localStorage.removeItem(STORAGE_KEY);
      const newToken = await getOrCreateJWT();
      headers['Authorization'] = `Bearer ${newToken}`;
      
      return fetch(url, { ...options, headers });
    }
    
    return response;
  }

  // Obtenir un token JWT valide (utilitaire)
  async function fetchJwtToken() {
    return await getOrCreateJWT();
  }

  // Exposer les fonctions globalement
  window.authUtils = {
    getOrCreateJWT,
    fetchWithJWT,
    getUIDFromToken,
    generateFingerprint,
    fetchJwtToken // Pour compatibilité avec votre code existant
  };

  // Alias pour compatibilité avec votre code
  window.fetchWithJWT = fetchWithJWT;
  window.fetchJwtToken = fetchJwtToken;
  
  console.log('✅ Auth utils chargé sans modules ES6');

})(window);