// Netlify Functions v2 (ESM) — finalize (no image)
import { getStore } from '@netlify/blobs';

const STORE = 'pixelwall_basic';
const STATE_KEY = 'state';

const json = (status, obj) => new Response(JSON.stringify(obj), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  },
});

const uniqInts = (list) => {
  const out = []; const seen = new Set();
  (Array.isArray(list) ? list : []).forEach(v => {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0 && n < 10000 && !seen.has(n)) { seen.add(n); out.push(n); }
  });
  return out;
};

export default async (req, context) => {
  try {
    if (req.method === 'OPTIONS') return json(204, {});
    if (req.method !== 'POST') return json(405, { ok: false, error: 'METHOD_NOT_ALLOWED' });

    let body = {};
    const ct = req.headers.get('content-type') || '';
    if (/application\/json/i.test(ct)) {
      try { body = await req.json(); } catch (e) { return json(400, { ok:false, error:'BAD_JSON', message:String(e) }); }
    } else {
      const txt = await req.text();
      try { body = JSON.parse(txt); } catch { const params = new URLSearchParams(txt); body = Object.fromEntries(params.entries()); }
    }

    const linkUrl = (body.linkUrl || '').toString();
    const name    = (body.name || '').toString();
    const blocks  = uniqInts(body.blocks || []);
    if (!linkUrl || !name || blocks.length === 0) return json(400, { ok:false, error:'MISSING_FIELDS' });

    // Auto-configured store (Functions v2)
    let store;
    try {
      store = getStore(STORE);
    } catch (e) {
      return json(500, { ok:false, error:'GETSTORE_FAILED', message:String(e) });
    }

    let state = await store.get(STATE_KEY, { type: 'json' });
    if (!state) state = { artCells: {} };
    state.artCells ||= {};

    const taken = blocks.filter(b => !!state.artCells[b]);
    if (taken.length) return json(409, { ok:false, error:'SOME_BLOCKS_TAKEN', taken });

    for (const b of blocks) state.artCells[b] = { linkUrl, name, ts: Date.now() };

    await store.setJSON(STATE_KEY, state);
    return json(200, { ok:true, soldBlocks: blocks, artCells: state.artCells });
  } catch (e) {
    return json(500, { ok:false, error:'SERVER_ERROR', message: String(e) });
  }
};
