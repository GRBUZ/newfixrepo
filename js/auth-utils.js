// Utilitaires d'auth (compatible navigateur + Node/Netlify Functions)
// Ne doit pas utiliser `window` au top-level pour éviter "window is not defined".
'use strict';

function getTokenFromReq(req) {
  // 1) Priorité : token dans les headers (Authorization: Bearer ...)
  if (req && req.headers) {
    const auth = req.headers.authorization || req.headers.Authorization;
    if (auth && typeof auth === 'string') {
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (m) return m[1];
      return auth; // si pas de "Bearer", renvoyer la valeur brute
    }
    // 2) Cookie (ex: cookie "jwt" ou "token")
    const cookie = req.headers.cookie || req.headers.Cookie;
    if (cookie && typeof cookie === 'string') {
      const m = cookie.match(/(?:^|;\s*)(?:jwt|token)=([^;]+)/);
      if (m) return m[1];
    }
  }

  // 3) Si on est en navigateur (window existe), essayer localStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage.getItem('jwt') || window.localStorage.getItem('token') || null;
  }

  return null;
}

async function fetchWithJWT(input, init = {}, req = undefined) {
  // Récupère le token à partir de req (si fourni) ou de l'environnement client
  const token = getTokenFromReq(req) || (init.headers && (init.headers.Authorization || init.headers.authorization));
  const headers = Object.assign({}, init.headers || {});

  if (token) {
    // Normaliser header Authorization
    if (!headers.Authorization && !headers.authorization) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const fetchFn = (typeof fetch !== 'undefined') ? fetch : (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
  if (!fetchFn) throw new Error('fetch not available in this runtime');

  const realInit = Object.assign({}, init, { headers });
  return fetchFn(input, realInit);
}

// Pour compatibilité CommonJS
module.exports = {
  getTokenFromReq,
  fetchWithJWT
};