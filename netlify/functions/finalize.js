/* Netlify Function – finalize (ANY-METHOD hotfix with _method override)
   TEMPORARY: accepts GET/HEAD weirdness by honoring ?_method=POST or body._method="POST".
   Keeps anti-double purchase and single-image-across-selection behavior.
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
  for (const b of blocks) {
    const r = Math.floor(b / 100), c = b % 100;
    if (r < minR) minR = r;
    if (c < minC) minC = c;
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  if (minR===1e9) return null;
  return { x: minC, y: minR, w: (maxC-minC+1), h: (maxR-minR+1) };
}

exports.handler = async (event) => {
  try {
    // Detect/override method
    let method = String(event.httpMethod || (event.requestContext && event.requestContext.http && event.requestContext.http.method) || '').toUpperCase();
    const qs = event.queryStringParameters || {};
    if (qs && typeof qs._method === 'string' && qs._method.toUpperCase() === 'POST') method = 'POST';
    if (method === 'OPTIONS') return res(204, {});

    // Parse body (JSON or form) + body override
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
    if (body && typeof body._method === 'string' && body._method.toUpperCase() === 'POST') method = 'POST';

    // If still not POST but we have the required fields, proceed anyway (hotfix)
    if (method !== 'POST') {
      if (!(body && body.imageUrl && body.linkUrl && (Array.isArray(body.blocks) && body.blocks.length))) {
        return res(405, { ok:false, error:'METHOD_NOT_ALLOWED', hint:'Use POST or add ?_method=POST' });
      }
    }

    const imageUrl = (body.imageUrl || '').toString();
    const linkUrl = (body.linkUrl || '').toString();
    const blocks = uniqInts(body.blocks || []);
    if (!imageUrl || !linkUrl || blocks.length === 0) {
      return res(400, { ok:false, error:'MISSING_FIELDS' });
    }

    const store = getStore(STORE, { consistency: 'strong' });
    const state = (await store.get(STATE_KEY, { type: 'json' })) || { artCells: {} };
    state.artCells = state.artCells || {};

    // Anti-double: find conflicts
    const taken = blocks.filter(b => !!state.artCells[b]);
    if (taken.length) {
      return res(409, { ok:false, error:'SOME_BLOCKS_TAKEN', taken });
    }

    // Compute rect once for the whole selection
    const rect = bbox(blocks);

    // Commit
    for (const b of blocks) {
      state.artCells[b] = { imageUrl, linkUrl, rect };
    }

    await store.setJSON(STATE_KEY, state);
    return res(200, { ok:true, soldBlocks: blocks, artCells: state.artCells });
  } catch (e) {
    console.error('finalize error', e);
    return res(500, { ok:false, error:'SERVER_ERROR', message: e && e.message ? e.message : String(e) });
  }
};
