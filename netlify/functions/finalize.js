/* Netlify Functions – Minimal finalize (no locks, POST/OPTIONS) */
const { getStore } = require('@netlify/blobs');
const STORE = 'reservations';
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
function uniqInts(list){ const out=[]; const seen=new Set(); (Array.isArray(list)?list:[]).forEach(v=>{const n=Number(v); if(Number.isInteger(n)&&n>=0&&n<10000&&!seen.has(n)){seen.add(n); out.push(n);}}); return out; }

exports.handler = async (event) => {
  try {
    const method = String(event.httpMethod || '').toUpperCase();
    if (method === 'OPTIONS') return res(204, {});
    if (method !== 'POST') return res(405, { ok:false, error:'METHOD_NOT_ALLOWED' });

    let body = {};
    if (isJsonCT(event.headers)) {
      try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
    } else {
      const txt = event.body || '';
      try { body = JSON.parse(txt); } catch {
        const params = new URLSearchParams(txt);
        body = Object.fromEntries(params.entries());
      }
    }

    const imageUrl = (body.imageUrl || '').toString();
    const linkUrl = (body.linkUrl || '').toString();
    const blocks = uniqInts(body.blocks || []);
    if (!imageUrl || !linkUrl || blocks.length === 0) {
      return res(400, { ok:false, error:'MISSING_FIELDS' });
    }

    const store = getStore(STORE, { consistency: 'strong' });
    const state = (await store.get(STATE_KEY, { type: 'json' })) || { sold: {} };
    state.sold = state.sold || {};
    blocks.forEach(b => {
      if (!state.sold[b]) {
        state.sold[b] = { imageUrl, linkUrl, soldAt: Date.now() };
      }
    });
    await store.setJSON(STATE_KEY, state);
    return res(200, { ok:true, soldBlocks: blocks, artCells: state.sold });
  } catch (e) {
    console.error('finalize error', e);
    return res(500, { ok:false, error:'SERVER_ERROR', message: e && e.message ? e.message : String(e) });
  }
};
