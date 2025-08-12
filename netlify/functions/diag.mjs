// Functions v2 (ESM) – diag using GitHub API (no deps)
export default async (req, context) => {
  try {
    const repo = process.env.GH_REPO;
    const token = process.env.GH_TOKEN;
    const branch = process.env.GH_BRANCH || 'main';
    const path = process.env.PATH_JSON || 'data/state.json';
    if (!repo || !token) {
      return new Response(JSON.stringify({ ok:false, error:'ENV_MISSING', repoSet:!!repo, tokenSet:!!token }), { status: 500, headers: { 'content-type':'application/json' } });
    }
    const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
    const r = await fetch(url, { headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'iw-netlify-func' } });
    const info = { status: r.status, repo, branch, path };
    if (r.status === 404) {
      return new Response(JSON.stringify({ ok:true, readable:false, ...info }), { headers: { 'content-type':'application/json' } });
    }
    if (!r.ok) {
      const text = await r.text();
      return new Response(JSON.stringify({ ok:false, error:'GITHUB_READ_FAILED', ...info, body:text }), { status: r.status, headers: { 'content-type':'application/json' } });
    }
    return new Response(JSON.stringify({ ok:true, readable:true, ...info }), { headers: { 'content-type':'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error:'SERVER_ERROR', message: String(e) }), { status: 500, headers: { 'content-type':'application/json' } });
  }
};
