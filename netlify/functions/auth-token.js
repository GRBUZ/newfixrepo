// netlify/functions/auth-token.js
const { generateJWT, generateSecureUID } = require('js/auth-utils.js');

exports.handler = async (event, context) => {
  // Headers CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Gestion preflight CORS
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
    const { uid, fingerprint } = JSON.parse(event.body || '{}');
    
    // Validation basique
    if (!uid || !fingerprint) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'UID et fingerprint requis' 
        })
      };
    }

    // Générer le token JWT
    const token = generateJWT(uid, fingerprint);
    
    // Log pour monitoring (optionnel)
    console.log(`Token généré pour UID: ${uid.slice(0, 8)}... Fingerprint: ${fingerprint}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        token: token,
        expiresIn: 24 * 60 * 60 // 24h en secondes
      })
    };

  } catch (error) {
    console.error('Erreur génération token:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Erreur serveur lors de la génération du token' 
      })
    };
  }
};