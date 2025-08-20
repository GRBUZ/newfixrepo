// jwt-middleware.js
// Compatible usages:
// - as middleware wrapper: const requireAuth = require('./jwt-middleware').requireAuth; app = requireAuth(handler)
// - as sync check: const authCheck = requireAuth(req); // returns { success, message }
// - getAuthenticatedUID(req) used by reserve.js

const authUtils = (function () {
  // minimal base64url -> string decoder (works in Node and browser)
  function base64UrlDecodeToString(str) {
    if (!str) return null;
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    try {
      if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        return Buffer.from(str, 'base64').toString('utf8');
      } else if (typeof atob === 'function') {
        return decodeURIComponent(Array.prototype.map.call(atob(str), function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  function decodeJwtPayload(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payloadPart = parts[1];
    const decoded = base64UrlDecodeToString(payloadPart);
    if (!decoded) return null;
    try {
      return JSON.parse(decoded);
    } catch (e) {
      return null;
    }
  }

  // try-get token from a server-like request object (event) or cookies/headers
  function getTokenFromReq(req) {
    if (req && req.headers) {
      const auth = req.headers.authorization || req.headers.Authorization;
      if (auth && typeof auth === 'string') {
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (m) return m[1];
        return auth;
      }
      const cookie = req.headers.cookie || req.headers.Cookie;
      if (cookie && typeof cookie === 'string') {
        const m = cookie.match(/(?:^|;\s*)(?:jwt|token)=([^;]+)/);
        if (m) return m[1];
      }
    }
    // browser fallback
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem('jwt') || window.localStorage.getItem('token') || null;
    }
    return null;
  }

  return {
    decodeJwtPayload,
    getTokenFromReq
  };
})();

function verifyJWT(token) {
  // NOTE: This implementation decodes the payload and checks exp if present.
  // It does NOT verify signature. If you need signature verification, plug in a JWT library
  // (jsonwebtoken) and verify with the secret/public key.
  if (!token) throw new Error('No token provided');
  const payload = authUtils.decodeJwtPayload(token);
  if (!payload) throw new Error('Invalid token payload');
  if (payload.exp && (Math.floor(Date.now() / 1000) > payload.exp)) {
    throw new Error('Token expired');
  }
  return payload;
}

// Dual-purpose requireAuth:
// - If called with a function (handler) it returns a wrapper middleware (Netlify-style).
// - If called with a "req" object it performs a synchronous check and returns { success, message }.
function requireAuth(arg) {
  // middleware use: requireAuth(handler)
  if (typeof arg === 'function') {
    const handler = arg;
    return async (event, context) => {
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Content-Type': 'application/json'
      };

      // CORS preflight
      if (event && event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
      }

      try {
        const authHeader = (event && event.headers) ? (event.headers.authorization || event.headers.Authorization) : null;
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

        const token = authHeader.slice(7);
        const payload = verifyJWT(token);

        // attach user info for downstream handlers
        event.user = {
          uid: payload.uid || payload.sub || payload.user_id || null,
          fingerprint: payload.fingerprint,
          iat: payload.iat,
          exp: payload.exp
        };

        return await handler(event, context);
      } catch (error) {
        console.error('Erreur authentification:', error && error.message ? error.message : error);
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

  // synchronous check use: const authCheck = requireAuth(req);
  if (arg && typeof arg === 'object') {
    const req = arg;
    try {
      const token = authUtils.getTokenFromReq(req);
      if (!token) return { success: false, message: 'MISSING_TOKEN' };
      const payload = verifyJWT(token);
      return { success: true, message: 'OK', payload };
    } catch (e) {
      return { success: false, message: String(e) || 'INVALID_TOKEN' };
    }
  }

}