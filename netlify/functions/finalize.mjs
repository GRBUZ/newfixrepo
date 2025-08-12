export default async (req, context) => {
  const headers = {
    'content-type':'application/json; charset=utf-8',
    'access-control-allow-origin':'*',
    'access-control-allow-methods':'POST,OPTIONS',
    'access-control-allow-headers':'content-type'
  };
  try {
    if (req.method === 'OPTIONS') return new Response('', { status:204, headers });
    if (req.method !== 'POST') return new Response(JSON.stringify({ ok:false, error:'METHOD_NOT_ALLOWED' }), { status:405, headers });

    const env = context.env || process.env;
    const repo = env.GH_REPO;
    const token = env.GH_TOKEN;
    const branch = env.GH_BRANCH || 'main';
    const path = env.PATH_JSON || 'data/state.json';
    if (!repo || !token) {
      return new Response(JSON.stringify({ ok:false, error:'ENV_MISSING', message:'Set GH_REPO and GH_TOKEN.' }), { status:500, headers });
    }

    let body = {};
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ ok:false, error:'BAD_JSON' }), { status:400, headers }); }

    const name = (body.name || '').toString().trim();
    const linkUrl = (body.linkUrl || '').toString().trim();
    const blocks = Array.isArray(body.blocks) ? body.blocks : [];
    const uniq = Array.from(new Set(blocks.map(n => Number(n)).filter(n => Number.isInteger(n) && n>=0 && n<10000)));
    if (!name || !linkUrl || uniq.length === 0) {
      return new Response(JSON.stringify({ ok:false, error:'MISSING_FIELDS' }), { status:400, headers });
    }

    const ghHeaders = {
      'authorization': `Bearer ${token}`,
      'accept': 'application/vnd.github+json',
      'user-agent': 'netlify-fn-finalize'
    };
    const fileUrl = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;

    async function readState() {
      const r = await fetch(fileUrl, { headers: ghHeaders });
      if (r.status === 404) return { state:{ artCells:{} }, sha:null };
      if (!r.ok) throw new Error('GITHUB_READ_FAILED ' + r.status + ' ' + await r.text());
      const j = await r.json();
      const content = Buffer.from(j.content, 'base64').toString('utf-8');
      let s = {};
      try { s = JSON.parse(content); } catch { s = { artCells:{} }; }
      s.artCells = s.artCells || {};
      return { state:s, sha:j.sha };
    }

    async function writeState(state, prevSha) {
      const content = Buffer.from(JSON.stringify(state, null, 2), 'utf-8').toString('base64');
      const payload = {
        message: `feat: sell ${uniq.length} blocks`,
        content,
        branch
      };
      if (prevSha) payload.sha = prevSha;
      const putUrl = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
      const r = await fetch(putUrl, { method:'PUT', headers: ghHeaders, body: JSON.stringify(payload) });
      if (!r.ok) {
        const t = await r.text();
        throw new Error('GITHUB_WRITE_FAILED ' + r.status + ' ' + t);
      }
      return await r.json();
    }

    for (let attempt=0; attempt<2; attempt++) {
      const { state, sha } = await readState();
      const taken = uniq.filter(b => !!state.artCells[b]);
      if (taken.length) {
        return new Response(JSON.stringify({ ok:false, error:'SOME_BLOCKS_TAKEN', taken }), { status:409, headers });
      }
      const ts = Date.now();
      for (const b of uniq) state.artCells[b] = { name, linkUrl, ts };
      try {
        await writeState(state, sha);
        return new Response(JSON.stringify({ ok:true, soldBlocks: uniq, artCells: state.artCells }), { status:200, headers });
      } catch (e) {
        const msg = String(e);
        if (attempt === 0 && (msg.includes('409') || msg.includes('422') || msg.includes('sha'))) {
          // file changed under us; retry once
          continue;
        }
        return new Response(JSON.stringify({ ok:false, error:'WRITE_FAILED', message: msg }), { status:500, headers });
      }
    }
    return new Response(JSON.stringify({ ok:false, error:'RETRY_FAILED' }), { status:500, headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error:'SERVER_ERROR', message:String(e) }), { status:500, headers });
  }
};
