// jwt-middleware.js
const { verifyJWT } = require('../../js/auth-utils.js');

// Middleware pour vérifier l'authentification JWT
function requireAuth(handler) {
  return async (event, context) => {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Content-Type': 'application/json'
    };

    // Gestion preflight CORS
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }

    try {
      // Extraire le token
      const authHeader = event.headers.authorization || event.headers.Authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ 
            error: 'Token d\'authentification requis',
            code: 'MISSING_TOKEN'
          })
        };
      }

      const token = authHeader.slice(7); // Enlever "Bearer "
      
      // Vérifier le token
      const payload = verifyJWT(token);
      
      // Ajouter les infos utilisateur à l'event
      event.user = {
        uid: payload.uid,
        fingerprint: payload.fingerprint,
        iat: payload.iat,
        exp: payload.exp
      };

      // Appeler le handler original
      return await handler(event, context);

    } catch (error) {
      console.error('Erreur authentification:', error.message);
      
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          error: 'Token invalide ou expiré',
          code: 'INVALID_TOKEN'
        })
      };
    }
  };
}

// Helper pour extraire l'UID de manière sécurisée
function getAuthenticatedUID(event) {
  if (!event.user || !event.user.uid) {
    throw new Error('Utilisateur non authentifié');
  }
  return event.user.uid;
}

// Validation supplémentaire optionnelle
function validateFingerprint(event, expectedFingerprint) {
  if (event.user.fingerprint !== expectedFingerprint) {
    throw new Error('Empreinte du navigateur modifiée');
  }
}

module.exports = { 
  requireAuth, 
  getAuthenticatedUID, 
  validateFingerprint 
};