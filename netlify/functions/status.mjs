// Functions v2 (ESM) – status: reads state.json from GitHub (no deps)
export default async (req, context) => {
  try {
    const repo = process.env.GH_REPO;
    const token = process.env.GH_TOKEN;
    const branch = process.env.GH_BRANCH || 'main';
    const path = process.env.PATH_JSON || 'data/state.json';
    if (!repo || !token) {
      return new Response(JSON.stringify({ ok:false, error:'ENV_MISSING' }), { status: 500, headers: { 'content-type':'application/json' } });
    }
    const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
    const r = await fetch(url, { headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'iw-netlify-func' } });
    if (r.status === 404) {
      // No state yet
      return new Response(JSON.stringify({ ok:true, artCells:{}, price:1.00, pixelsSold:0, pixelsLeft:1_000_000 }), { headers: { 'content-type':'application/json', 'cache-control':'no-store' } });
    }
    if (!r.ok) {
      const text = await r.text();
      return new Response(JSON.stringify({ ok:false, error:'GITHUB_READ_FAILED', status:r.status, body:text }), { status: r.status, headers: { 'content-type':'application/json' } });
    }
    const j = await r.json();
    const content = j.content ? Buffer.from(j.content, 'base64').toString('utf-8') : '{}';
    const state = JSON.parse(content || '{}');
    const artCells = state.artCells || {};
    const blocksSold = Object.keys(artCells).length;
    const pixelsSold = blocksSold * 100;
    const price = 1 + Math.floor(pixelsSold / 1000) * 0.01;
    const left = 1_000_000 - pixelsSold;
    return new Response(JSON.stringify({ ok:true, artCells, price, pixelsSold, pixelsLeft:left }), { headers: { 'content-type':'application/json', 'cache-control':'no-store' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error:'SERVER_ERROR', message: String(e) }), { status: 500, headers: { 'content-type':'application/json' } });
  }
};
