import { guardFinalizeInput } from './_validation.mjs';

export default async (req) => {
  const guarded = await guardFinalizeInput(req).catch(err => err);
  if (guarded instanceof Response) return guarded; // input invalide → 4xx/403
  const { name, linkUrl, blocks } = guarded;

};

// finalize.mjs — write rect + empty imageUrl for all sold blocks
const GH_REPO   = process.env.GH_REPO;
const GH_TOKEN  = process.env.GH_TOKEN;
const GH_BRANCH = process.env.GH_BRANCH || 'main';
const PATH_JSON = process.env.PATH_JSON || 'data/state.json';

const API_BASE = 'https://api.github.com';

function jres(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}

async function ghGetFile(path) {
  const url = `${API_BASE}/repos/${GH_REPO}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(GH_BRANCH)}`;
  const r = await fetch(url, {
    headers: {
      'Authorization': `token ${GH_TOKEN}`,
      'User-Agent': 'netlify-fn',
      'Accept': 'application/vnd.github+json'
    }
  });
  if (r.status === 404) return { sha: null, content: null, status: 404 };
  if (!r.ok) throw new Error(`GITHUB_GET_FAILED ${r.status}`);
  const data = await r.json();
  const buf = Buffer.from(data.content, data.encoding || 'base64');
  return { sha: data.sha, content: buf.toString('utf8'), status: 200 };
}

async function ghPutFile(path, content, sha, message) {
  const url = `${API_BASE}/repos/${GH_REPO}/contents/${encodeURIComponent(path)}`;
  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: GH_BRANCH
  };
  if (sha) body.sha = sha;
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${GH_TOKEN}`,
      'User-Agent': 'netlify-fn',
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`GITHUB_PUT_FAILED ${r.status}`);
  const data = await r.json();
  return data.content.sha;
}

function parseState(raw) {
  if (!raw) return { sold:{}, locks:{} };
  try {
    const obj = JSON.parse(raw);
    if (!obj.sold) obj.sold = {};
    if (!obj.locks) obj.locks = {};
    return obj;
  } catch {
    return { sold:{}, locks:{} };
  }
}

function pruneLocks(locks) {
  const now = Date.now();
  const out = {};
  for (const [k,v] of Object.entries(locks || {})) {
    if (v && typeof v.until === 'number' && v.until > now) out[k] = v;
  }
  return out;
}

function idxToXY(idx){ const x = idx % 100; const y = Math.floor(idx / 100); return { x, y }; }

export default async (req) => {
  try {
    if (req.method !== 'POST') return jres(405, { ok:false, error:'METHOD_NOT_ALLOWED' });
    const body = await req.json();
    const uid    = (body.uid || '').toString();
    const linkUrl= (body.linkUrl || '').toString();
    const name   = (body.name || '').toString();
    const blocks = Array.isArray(body.blocks) ? body.blocks.map(n=>parseInt(n,10)).filter(n=>Number.isInteger(n)&&n>=0&&n<10000) : [];
    if (!uid || !linkUrl || !name || blocks.length===0) return jres(400, { ok:false, error:'MISSING_FIELDS' });

    // Load current
    let got = await ghGetFile(PATH_JSON);
    let sha = got.sha;
    let st = parseState(got.content);
    st.locks = pruneLocks(st.locks);

    // Filter allowed vs taken
    const taken = [];
    const allowed = [];
    for (const b of blocks) {
      const key = String(b);
      if (st.sold[key]) { taken.push(b); continue; }
      const l = st.locks[key];
      if (l && l.until > Date.now() && l.uid !== uid) { taken.push(b); continue; }
      allowed.push(b);
    }
    if (allowed.length === 0) {
      return jres(taken.length?409:400, { ok:false, error:'NO_BLOCKS_AVAILABLE', taken });
    }

    // Compute rect from bounding box of allowed blocks
    let minX=999, minY=999, maxX=-1, maxY=-1;
    for (const b of allowed) {
      const {x,y} = idxToXY(b);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const rect = { x: minX, y: minY, w: (maxX-minX+1), h: (maxY-minY+1) };

    // Write sold entries with empty imageUrl and computed rect
    const nowTs = Date.now();
    for (const b of allowed) {
      const key = String(b);
      st.sold[key] = { name, linkUrl, ts: nowTs, imageUrl: "", rect };
      if (st.locks[key] && st.locks[key].uid === uid) delete st.locks[key];
    }

    const newContent = JSON.stringify(st, null, 2);
    try {
      await ghPutFile(PATH_JSON, newContent, sha, `finalize ${allowed.length} by ${uid} (rect + imageUrl placeholder)`);
    } catch (e) {
      if (String(e).includes('GITHUB_PUT_FAILED 409')) {
        // Retry once on conflict
        got = await ghGetFile(PATH_JSON);
        sha = got.sha; st = parseState(got.content); st.locks = pruneLocks(st.locks);
        // Re-evaluate taken/allowed quickly
        const taken2 = []; const allowed2 = [];
        for (const b of blocks) {
          const key = String(b);
          if (st.sold[key]) { taken2.push(b); continue; }
          const l = st.locks[key];
          if (l && l.until > Date.now() && l.uid !== uid) { taken2.push(b); continue; }
          allowed2.push(b);
        }
        if (allowed2.length === 0) return jres(409, { ok:false, error:'SOME_BLOCKS_TAKEN', taken: taken2 });
        // Recompute rect
        let minX2=999, minY2=999, maxX2=-1, maxY2=-1;
        for (const b of allowed2) {
          const {x,y} = idxToXY(b);
          if (x < minX2) minX2 = x;
          if (y < minY2) minY2 = y;
          if (x > maxX2) maxX2 = x;
          if (y > maxY2) maxY2 = y;
        }
        const rect2 = { x: minX2, y: minY2, w: (maxX2-minX2+1), h: (maxY2-minY2+1) };
        const now2 = Date.now();
        for (const b of allowed2) {
          const key = String(b);
          st.sold[key] = { name, linkUrl, ts: now2, imageUrl: "", rect: rect2 };
          if (st.locks[key] && st.locks[key].uid === uid) delete st.locks[key];
        }
        const content2 = JSON.stringify(st, null, 2);
        await ghPutFile(PATH_JSON, content2, got.sha, `finalize(retry) ${allowed2.length} by ${uid} (rect + imageUrl placeholder)`);
        return jres(200, { ok:true, sold: allowed2, taken: taken2, soldMap: st.sold, rect: rect2 });
      }
      throw e;
    }
    return jres(200, { ok:true, sold: allowed, taken, soldMap: st.sold, rect });
  } catch (e) {
    return jres(500, { ok:false, error:'FINALIZE_FAILED', message: String(e) });
  }
};
