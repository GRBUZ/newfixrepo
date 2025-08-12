export default async (req, context) => {
  const headers = {
    'content-type':'application/json; charset=utf-8',
    'access-control-allow-origin':'*',
    'cache-control':'no-store'
  };
  try {
    if (req.method === 'OPTIONS') return new Response('', { status:204, headers });
    if (req.method !== 'GET') return new Response(JSON.stringify({ ok:false, error:'METHOD_NOT_ALLOWED' }), { status:405, headers });

    const env = context.env || process.env;
    const repo = env.GH_REPO;
    const token = env.GH_TOKEN;
    const branch = env.GH_BRANCH || 'main';
    const path = env.PATH_JSON || 'data/state.json';
    if (!repo || !token) {
      return new Response(JSON.stringify({ ok:false, error:'ENV_MISSING', message:'Set GH_REPO and GH_TOKEN.' }), { status:500, headers });
    }

    const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
    const r = await fetch(url, {
      headers: {
        'authorization': `Bearer ${token}`,
        'accept': 'application/vnd.github+json',
        'user-agent': 'netlify-fn-status'
      }
    });
    if (r.status === 404) {
      // empty initial state
      const state = { artCells: {} };
      return new Response(JSON.stringify({
        ok:true,
        artCells: state.artCells,
        price: 1.00,
        pixelsSold: 0,
        pixelsLeft: 1_000_000
      }), { status:200, headers });
    }
    if (!r.ok) {
      const txt = await r.text();
      return new Response(JSON.stringify({ ok:false, error:'GITHUB_READ_FAILED', status:r.status, body:txt }), { status:500, headers });
    }
    const json = await r.json();
    const content = Buffer.from(json.content, 'base64').toString('utf-8');
    let state = {};
    try { state = JSON.parse(content); } catch { state = { artCells:{} }; }
    state.artCells = state.artCells || {};

    const blocksSold = Object.keys(state.artCells).length;
    const pixelsSold = blocksSold * 100;
    const price = 1 + Math.floor(pixelsSold / 1000) * 0.01;
    const left = 1_000_000 - pixelsSold;

    return new Response(JSON.stringify({ ok:true, artCells: state.artCells, price, pixelsSold, pixelsLeft: left }), { status:200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error:'SERVER_ERROR', message:String(e) }), { status:500, headers });
  }
};
