/* Netlify Function – status (explicit Blobs config via env) */
const { getStore } = require('@netlify/blobs');
const STORE = 'pixelwall';
const STATE_KEY = 'state';

function headers() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
}
function res(statusCode, obj){ return { statusCode, headers: headers(), body: JSON.stringify(obj) }; }

function getConfiguredStore() {
  const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  const token  = process.env.BLOBS_TOKEN || process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) {
    const msg = 'Missing env SITE_ID and/or BLOBS_TOKEN (or NETLIFY_AUTH_TOKEN). Set them in Netlify → Site settings → Build & deploy → Environment.';
    throw new Error(msg);
  }
  return getStore(STORE, { siteID, token });
}

exports.handler = async (event) => {
  try {
    const method = String(event.httpMethod || '').toUpperCase();
    if (method === 'OPTIONS') return res(204, {});
    if (method !== 'GET') return res(405, { ok:false, error:'METHOD_NOT_ALLOWED' });

    let store;
    try { store = getConfiguredStore(); } catch (e) { return res(500, { ok:false, error:'BLOBS_NOT_AVAILABLE', message: String(e) }); }

    let state;
    try { state = (await store.get(STATE_KEY, { type: 'json' })) || { artCells: {} }; }
    catch (e) { return res(500, { ok:false, error:'BLOBS_GET_FAILED', message: String(e) }); }

    const blocksSold = Object.keys(state.artCells || {}).length;
    const pixelsSold = blocksSold * 100;
    const price = 1 + Math.floor(pixelsSold / 1000) * 0.01;
    const left = 1_000_000 - pixelsSold;

    return res(200, { ok:true, artCells: state.artCells, price, pixelsSold, pixelsLeft: left });
  } catch (e) {
    console.error('status error', e);
    return res(500, { ok:false, error:'SERVER_ERROR', message: e && e.message ? e.message : String(e) });
  }
};
