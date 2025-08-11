/* Netlify Function – finalize with verbose errors & size guard
   - POST JSON: { imageUrl (dataURL <= ~800KB), linkUrl, blocks[] }
   - Anti-double purchase; one image over selection (rect bbox)
*/
const { getStore } = require('@netlify/blobs');
const STORE = 'pixelwall';
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
function bbox(blocks) {
  let minR=1e9, minC=1e9, maxR=-1, maxC=-1;
  for (const b of blocks) { const r=Math.floor(b/100), c=b%100; if (r<minR) minR=r; if (c<minC) minC=c; if (r>maxR) maxR=r; if (c>maxC) maxC=c; }
  if (minR===1e9) return null;
  return { x:minC, y:minR, w:(maxC-minC+1), h:(maxR-minR+1) };
}

exports.handler = async (event) => {
  try {
    const method = String(event.httpMethod || '').toUpperCase();
    if (method === 'OPTIONS') return res(204, {});
    if (method !== 'POST') return res(405, { ok:false, error:'METHOD_NOT_ALLOWED' });

    let body = {};
    if (isJsonCT(event.headers)) { try { body = JSON.parse(event.body || '{}'); } catch (e) { return res(400, { ok:false, error:'BAD_JSON', message: String(e) }); } }
    else {
      const txt = event.body || '';
      try { body = JSON.parse(txt); } catch { const params = new URLSearchParams(txt); body = Object.fromEntries(params.entries()); }
    }

    const imageUrl = (body.imageUrl || '').toString();
    const linkUrl = (body.linkUrl || '').toString();
    const blocks = uniqInts(body.blocks || []);

    if (!imageUrl || !linkUrl || !blocks.length) return res(400, { ok:false, error:'MISSING_FIELDS' });

    // Size guard (approx bytes from dataURL length)
    const approxBytes = Math.round(imageUrl.length * 0.75);
    if (approxBytes > 900 * 1024) return res(413, { ok:false, error:'IMAGE_TOO_LARGE', approxBytes });

    let store;
    try { store = getStore(STORE, { consistency: 'strong' }); }
    catch (e) { return res(500, { ok:false, error:'BLOBS_NOT_AVAILABLE', message: String(e) }); }

    // Load state
    let state;
    try { state = (await store.get(STATE_KEY, { type: 'json' })) || { artCells: {} }; }
    catch (e) { return res(500, { ok:false, error:'BLOBS_GET_FAILED', message: String(e) }); }
    state.artCells = state.artCells || {};

    // Anti-double
    const taken = blocks.filter(b => !!state.artCells[b]);
    if (taken.length) return res(409, { ok:false, error:'SOME_BLOCKS_TAKEN', taken });

    // Commit
    const rect = bbox(blocks);
    for (const b of blocks) state.artCells[b] = { imageUrl, linkUrl, rect };

    try { await store.setJSON(STATE_KEY, state); }
    catch (e) { return res(500, { ok:false, error:'BLOBS_SET_FAILED', message: String(e) }); }

    return res(200, { ok:true, soldBlocks: blocks, artCells: state.artCells });
  } catch (e) {
    console.error('finalize error', e);
    return res(500, { ok:false, error:'SERVER_ERROR', message: e && e.message ? e.message : String(e) });
  }
};
