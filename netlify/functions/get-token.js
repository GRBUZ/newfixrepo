const jwt = require('jsonwebtoken');

// ⚠️ À garder secret côté serveur !
const SECRET_KEY = process.env.JWT_SECRET || 'change_this_to_a_strong_secret';

exports.handler = async function(event, context) {
  try {
    // Extrait des infos depuis le client (IP, UA, etc. selon ton besoin)
    const clientIp = event.headers['x-forwarded-for'] || 'unknown';
    const userAgent = event.headers['user-agent'] || 'unknown';

    // Crée un identifiant aléatoire unique pour ce "client"
    const uid = crypto.randomUUID();

    // Crée le token (exp: 24h par défaut)
    const token = jwt.sign(
      {
        uid,
        ip: clientIp,
        ua: userAgent,
      },
      SECRET_KEY,
      {
        expiresIn: '24h'
      }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, token, uid })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: 'TOKEN_GENERATION_FAILED' })
    };
  }
};
