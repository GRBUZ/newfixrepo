(function (global, factory) {
  // CommonJS (Node / Netlify)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    // Browser global (attach to globalThis)
    global.authUtils = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  // Récupère un token JWT soit depuis un "req" (server), soit depuis headers/cookie,
  // sinon depuis localStorage si on est en navigateur.
  function getTokenFromReq(req) {
    // 1) headers Authorization Bearer
    if (req && req.headers) {
      const auth = req.headers.authorization || req.headers.Authorization;
      if (auth && typeof auth === 'string') {
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (m) return m[1];
        return auth;
      }
      // cookie: jwt or token
      const cookie = req.headers.cookie || req.headers.Cookie;
      if (cookie && typeof cookie === 'string') {
        const m = cookie.match(/(?:^|;\s*)(?:jwt|token)=([^;]+)/);
        if (m) return m[1];
      }
    }

    // 2) browser localStorage (only if window/localStorage exist)
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem('jwt') || window.localStorage.getItem('token') || null;
    }

    return null;
  }

  // fetchWithJWT: envoie Authorization: Bearer <token> si trouvé (req priority)
  async function fetchWithJWT(input, init = {}, req = undefined) {
    const headers = Object.assign({}, init.headers || {});

    // token from req or from headers passed in init
    const fromReq = getTokenFromReq(req);
    const fromInitHeader = headers.Authorization || headers.authorization;
    const token = fromReq || (fromInitHeader ? (String(fromInitHeader).replace(/^Bearer\s+/i, '')) : null);

    if (token) {
      if (!headers.Authorization && !headers.authorization) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    // pick fetch implementation (browser or node + polyfilled fetch)
    const fetchFn = (typeof fetch !== 'undefined') ? fetch : (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
    if (!fetchFn) throw new Error('fetch not available in this runtime');

    const realInit = Object.assign({}, init, { headers });
    return fetchFn(input, realInit);
  }

  // Export the utilities
  return {
    getTokenFromReq,
    fetchWithJWT
  };
});