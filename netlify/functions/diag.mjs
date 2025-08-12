// Functions v2 ESM
export default async (req, context) => {
  const headers = {'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*'};
  try {
    const env = context.env || process.env;
    const repo = env.GH_REPO;
    const token = env.GH_TOKEN;
    const branch = env.GH_BRANCH || 'main';
    const path = env.PATH_JSON || 'data/state.json';
    const info = {
      node: process.version,
      repoSet: !!repo,
      tokenSet: !!token,
      branch,
      path
    };
    if (!repo || !token) {
      return new Response(JSON.stringify({ ok:false, error:'ENV_MISSING', message:'Set GH_REPO and GH_TOKEN in Environment variables.', info }), { status:500, headers });
    }
    // Try a GET to see if we can read (404 is fine)
    const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
    const r = await fetch(url, {
      headers: {
        'authorization': `Bearer ${token}`,
        'accept': 'application/vnd.github+json',
        'user-agent': 'netlify-fn-diag'
      }
    });
    const status = r.status;
    let body = null;
    try { body = await r.json(); } catch {}
    return new Response(JSON.stringify({ ok:true, readable: status===200, status, body }), { status:200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error:'SERVER_ERROR', message: String(e) }), { status:500, headers });
  }
};
