// Functions v2 (ESM) – finalize: commits state.json to GitHub (no deps)
// Body: { name, linkUrl, blocks: number[] }
function headers(){ return { 'content-type':'application/json; charset=utf-8', 'access-control-allow-origin':'*' }; }
export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: headers() });
  if (req.method !== 'POST') return new Response(JSON.stringify({ ok:false, error:'METHOD_NOT_ALLOWED' }), { status: 405, headers: headers() });
  try {
    const repo = process.env.GH_REPO;
    const token = process.env.GH_TOKEN;
    const branch = process.env.GH_BRANCH || 'main';
    const path = process.env.PATH_JSON || 'data/state.json';
    if (!repo || !token) {
      return new Response(JSON.stringify({ ok:false, error:'ENV_MISSING' }), { status: 500, headers: headers() });
    }
    const body = await req.json().catch(()=>({}));
    const name = (body.name || '').toString().trim();
    const linkUrl = (body.linkUrl || '').toString().trim();
    const blocks = Array.isArray(body.blocks) ? body.blocks.map(n => Number(n)).filter(n => Number.isInteger(n) && n>=0 && n<10000) : [];
    if (!name || !linkUrl || blocks.length===0) {
      return new Response(JSON.stringify({ ok:false, error:'MISSING_FIELDS' }), { status: 400, headers: headers() });
    }
    const baseHeaders = { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'iw-netlify-func' };
    // Step 1: read current (get sha)
    const readUrl = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
    let sha = null, state = { artCells: {} };
    let r = await fetch(readUrl, { headers: baseHeaders });
    if (r.status === 404) {
      // Fresh file
      state = { artCells: {} };
    } else if (!r.ok) {
      const text = await r.text();
      return new Response(JSON.stringify({ ok:false, error:'GITHUB_READ_FAILED', status:r.status, body:text }), { status: r.status, headers: headers() });
    } else {
      const j = await r.json();
      sha = j.sha;
      const content = j.content ? Buffer.from(j.content, 'base64').toString('utf-8') : '{}';
      state = JSON.parse(content || '{"artCells":{}}');
      state.artCells = state.artCells || {};
    }
    // Step 2: anti-double – check conflicts
    const taken = blocks.filter(b => !!state.artCells[b]);
    if (taken.length) {
      return new Response(JSON.stringify({ ok:false, error:'SOME_BLOCKS_TAKEN', taken }), { status: 409, headers: headers() });
    }
    // Step 3: commit new entries
    for (const b of blocks) state.artCells[b] = { name, linkUrl, ts: Date.now() };
    const newContent = Buffer.from(JSON.stringify(state, null, 2)).toString('base64');
    const putUrl = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
    const commitBody = {
      message: `feat: add ${blocks.length} blocks for ${name}`,
      content: newContent,
      branch,
      sha: sha || undefined
    };
    r = await fetch(putUrl, { method: 'PUT', headers: baseHeaders, body: JSON.stringify(commitBody) });
    if (!r.ok) {
      const text = await r.text();
      // If conflict (sha outdated) → retry once
      if (r.status === 409 && text.includes('sha does not match')) {
        // Re-read latest, merge, and try again once
        const rr = await fetch(readUrl, { headers: baseHeaders });
        if (!rr.ok) return new Response(JSON.stringify({ ok:false, error:'GITHUB_READ_FAILED_RETRY', status: rr.status }), { status: rr.status, headers: headers() });
        const jj = await rr.json();
        const latestSha = jj.sha;
        const latest = JSON.parse(Buffer.from(jj.content, 'base64').toString('utf-8') || '{"artCells":{}}');
        latest.artCells = latest.artCells || {};
        const conflicts2 = blocks.filter(b => !!latest.artCells[b]);
        if (conflicts2.length) return new Response(JSON.stringify({ ok:false, error:'SOME_BLOCKS_TAKEN', taken: conflicts2 }), { status: 409, headers: headers() });
        for (const b of blocks) latest.artCells[b] = { name, linkUrl, ts: Date.now() };
        const content2 = Buffer.from(JSON.stringify(latest, null, 2)).toString('base64');
        const body2 = { message: `feat: add ${blocks.length} blocks for ${name} (retry)`, content: content2, branch, sha: latestSha };
        const r2 = await fetch(putUrl, { method: 'PUT', headers: baseHeaders, body: JSON.stringify(body2) });
        if (!r2.ok) {
          const t2 = await r2.text();
          return new Response(JSON.stringify({ ok:false, error:'GITHUB_WRITE_FAILED', status:r2.status, body:t2 }), { status: r2.status, headers: headers() });
        }
        const out2 = await r2.json();
        return new Response(JSON.stringify({ ok:true, artCells: latest.artCells, commit: out2.commit && out2.commit.sha }), { headers: headers() });
      }
      return new Response(JSON.stringify({ ok:false, error:'GITHUB_WRITE_FAILED', status:r.status, body:text }), { status: r.status, headers: headers() });
    }
    const out = await r.json();
    return new Response(JSON.stringify({ ok:true, artCells: state.artCells, commit: out.commit && out.commit.sha }), { headers: headers() });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error:'SERVER_ERROR', message: String(e) }), { status: 500, headers: headers() });
  }
};
