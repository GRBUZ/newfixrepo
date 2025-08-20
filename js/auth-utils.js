// UMD auth-utils: compatible Node (module.exports) and browser (window.authUtils)
// Exporte: verifyJWT(token), getUIDFromToken(tokenOrReq), getTokenFromReq(req), fetchWithJWT(...)
(function (global, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    global.authUtils = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  // base64url -> utf8 string
  function base64UrlDecodeToString(str) {
    if (!str) return null;
    str = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    try {
      if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        return Buffer.from(str, 'base64').toString('utf8');
      } else if (typeof atob === 'function') {
        // atob expects base64
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
    const decoded = base64UrlDecodeToString(parts[1]);
    if (!decoded) return null;
    try {
      return JSON.parse(decoded);
    } catch (e) {
      return null;
    }
  }

  function getTokenFromReq(req) {
    // server-like event: headers.authorization or cookie
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
    // browser fallback: localStorage
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem('jwt') || window.localStorage.getItem('token') || null;
    }
    return null;
  }

  // Basic verify: decode payload and check exp. DOES NOT verify signature.
  function verifyJWT(token) {
    if (!token) throw new Error('No token provided');
    const payload = decodeJwtPayload(token);
    if (!payload) throw new Error('Invalid token payload');
    if (payload.exp && (Math.floor(Date.now() / 1000) > payload.exp)) {
      throw new Error('Token expired');
    }
    return payload;
  }

  function getUIDFromToken(input) {
    let token = null;
    if (!input) {
      token = getTokenFromReq(undefined);
    } else if (typeof input === 'string') {
      token = input;
    } else if (typeof input === 'object') {
      token = getTokenFromReq(input);
    }
    const payload = decodeJwtPayload(token);
    if (!payload) return null;
    return payload.uid || payload.sub || payload.user_id || null;
  }

  async function fetchWithJWT(input, init = {}, req = undefined) {
    const headers = Object.assign({}, init.headers || {});
    const fromReq = getTokenFromReq(req);
    const fromInitHeader = headers.Authorization || headers.authorization;
    const token = fromReq || (fromInitHeader ? String(fromInitHeader).replace(/^Bearer\s+/i, '') : null);
    if (token) {
      if (!headers.Authorization && !headers.authorization) {
        headers.Authorization = `Bearer ${token}`;
      }
    }
    const fetchFn = (typeof fetch !== 'undefined') ? fetch : (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
    if (!fetchFn) throw new Error('fetch not available in this runtime');
    const realInit = Object.assign({}, init, { headers });
    return fetchFn(input, realInit);
  }

  return {
    base64UrlDecodeToString,
    decodeJwtPayload,
    getTokenFromReq,
    verifyJWT,
    getUIDFromToken,
    fetchWithJWT
  };
});