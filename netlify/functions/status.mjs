// Netlify Functions v2 (ESM) — status
import { getStore } from '@netlify/blobs';

const STORE = 'pixelwall_basic';
const STATE_KEY = 'state';

const json = (status, obj) => new Response(JSON.stringify(obj), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store'
  },
});

export default async (req, context) => {
  try {
    if (req.method === 'OPTIONS') return json(204, {});
    if (req.method !== 'GET') return json(405, { ok:false, error:'METHOD_NOT_ALLOWED' });

    let store;
    try { store = getStore(STORE); }
    catch (e) { return json(500, { ok:false, error:'GETSTORE_FAILED', message:String(e) }); }

    let state = await store.get(STATE_KEY, { type: 'json' });
    if (!state) state = { artCells: {} };

    const blocksSold = Object.keys(state.artCells || {}).length;
    const pixelsSold = blocksSold * 100;
    const price = 1 + Math.floor(pixelsSold / 1000) * 0.01;
    const left = 1_000_000 - pixelsSold;

    return json(200, { ok:true, artCells: state.artCells, price, pixelsSold, pixelsLeft: left });
  } catch (e) {
    return json(500, { ok:false, error:'SERVER_ERROR', message: String(e) });
  }
};
