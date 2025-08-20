(function (global, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    global.authUtils = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  // Decode base64url to string (works in Node and browser)
  function base64UrlDecodeToString(str) {
    if (!str) return null;
    // base64url -> base64
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    // pad
    while (str.length % 4) str += '=';
    try {
      if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        return Buffer.from(str, 'base64').toString('utf8');
      } else if (typeof atob === 'function') {
        // atob works with base64 (not url), but we converted above
        return decodeURIComponent(Array.prototype.map.call(atob(str), function(c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
      } else {
        return null;
      }
    } catch (e) {
      return null;
    }
  }

  // Get token from a server-style req or from browser storage/cookies
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

    // Browser fallback: localStorage
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem('jwt') || window.localStorage.getItem('token') || null;
    }

    return null;
  }

  // Decode JWT payload safely and return object or null
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

  // Exposed: getUIDFromToken(tokenOrReq)
  // If argument is a string token, decode it; if it's an object (req) try to extract token then decode.
  // Returns uid if found in payload (sub, uid, user_id) or null.
  function getUIDFromToken(input) {
    let token = null;
    if (!input) {
      token = getTokenFromReq(undefined);
    } else if (typeof input === 'string') {
      token = input;
    } else if (typeof input === 'object') {
      token = getTokenFromReq(input);
    } else {
      token = null;
    }
    const payload = decodeJwtPayload(token);
    if (!payload) return null;
    return payload.sub || payload.uid || payload.user_id || payload.name || null;
  }

  // fetchWithJWT: attaches Authorization header from req or uses provided init.headers
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
    getTokenFromReq,
    fetchWithJWT,
    getUIDFromToken,
    // backward-compat alias used by some code
    getUID: getUIDFromToken
  };
});