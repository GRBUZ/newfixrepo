/* Netlify Function – finalize (NO IMAGE) — siteId/siteID compatibility patch */
const { getStore } = require('@netlify/blobs');
const STORE = 'pixelwall_basic';
const STATE_KEY = 'state';

function headers() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Content-Type': 'application/json; charset=utf-8',
  };
}
function res(statusCode, obj){ return { statusCode, headers: headers(), body: JSON.stringify(obj) }; }
function isJsonCT(h){ const ct = h && (h['content-type'] || h['Content-Type'] || ''); return /application\/json/i.test(ct); }
function uniqInts(list){ const out=[]; const seen=new Set(); (Array.isArray(list)?list:[]).forEach(v=>{ const n=Number(v); if(Number.isInteger(n)&&n>=0&&n<10000&&!seen.has(n)){ seen.add(n); out.push(n); } }); return out; }

function makeStore() {
  const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  const token  = process.env.BLOBS_TOKEN || process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) throw new Error('Missing env SITE_ID and/or BLOBS_TOKEN/NETLIFY_AUTH_TOKEN');
  // pass BOTH keys to satisfy different library versions
  return getStore(STORE, { siteID, siteId: siteID, token });
}

exports.handler = async (event) => {
  try {
    const method = String(event.httpMethod || '').toUpperCase();
    if (method === 'OPTIONS') return res(204, {});
    if (method !== 'POST') return res(405, { ok:false, error:'METHOD_NOT_ALLOWED' });

    let body = {};
    if (isJsonCT(event.headers)) { try { body = JSON.parse(event.body || '{}'); } catch (e) { return res(400, { ok:false, error:'BAD_JSON', message: String(e) }); } }
    else { const txt = event.body || ''; try { body = JSON.parse(txt); } catch { const params = new URLSearchParams(txt); body = Object.fromEntries(params.entries()); } }

    const linkUrl = (body.linkUrl || '').toString();
    const name    = (body.name || '').toString();
    const blocks  = uniqInts(body.blocks || []);
    if (!linkUrl || !name || blocks.length === 0) return res(400, { ok:false, error:'MISSING_FIELDS' });

    let store;
    try { store = makeStore(); } catch (e) { return res(500, { ok:false, error:'BLOBS_NOT_AVAILABLE', message: String(e) }); }

    let state;
    try { state = (await store.get(STATE_KEY, { type: 'json' })) || { artCells: {} }; }
    catch (e) { return res(500, { ok:false, error:'BLOBS_GET_FAILED', message: String(e) }); }
    state.artCells = state.artCells || {};

    const taken = blocks.filter(b => !!state.artCells[b]);
    if (taken.length) return res(409, { ok:false, error:'SOME_BLOCKS_TAKEN', taken });

    for (const b of blocks) state.artCells[b] = { linkUrl, name, ts: Date.now() };

    try { await store.setJSON(STATE_KEY, state); }
    catch (e) { return res(500, { ok:false, error:'BLOBS_SET_FAILED', message: String(e) }); }

    return res(200, { ok:true, soldBlocks: blocks, artCells: state.artCells });
  } catch (e) {
    console.error('finalize error', e);
    return res(500, { ok:false, error:'SERVER_ERROR', message: e && e.message ? e.message : String(e) });
  }
};
