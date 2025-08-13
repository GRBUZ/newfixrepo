// netlify/functions/upload.mjs — save uploaded image into GitHub repo under assets/images
const GH_REPO   = process.env.GH_REPO;            // e.g. "GRBUZ/Fixrepo"
const GH_TOKEN  = process.env.GH_TOKEN;
const GH_BRANCH = process.env.GH_BRANCH || 'main';
const PATH_DIR  = process.env.PATH_IMAGES || 'assets/images';

const API_BASE = 'https://api.github.com';

function jres(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}

function extForContentType(ct){
  if (!ct) return 'bin';
  ct = ct.toLowerCase();
  if (ct.includes('jpeg')||ct.includes('jpg')) return 'jpg';
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('svg')) return 'svg';
  return 'bin';
}

function safeBase(name){
  return (name||'img')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'img';
}

async function ghPutFile(path, b64content, message, sha){
  const url = `${API_BASE}/repos/${GH_REPO}/contents/${encodeURIComponent(path)}`;
  const body = { message, content: b64content, branch: GH_BRANCH };
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
  return data.content && data.content.path;
}

export default async (req) => {
  try {
    if (req.method !== 'POST') return jres(405, { ok:false, error:'METHOD_NOT_ALLOWED' });
    if (!GH_REPO || !GH_TOKEN) return jres(500, { ok:false, error:'MISSING_CONFIG', message:'GH_REPO / GH_TOKEN not set' });
    const body = await req.json().catch(()=>null);
    if (!body) return jres(400, { ok:false, error:'BAD_JSON' });
    const filename = safeBase(body.filename || 'avatar');
    const contentType = (body.contentType || 'application/octet-stream')+'';
    const dataB64 = (body.data || '')+'';
    if (!dataB64) return jres(400, { ok:false, error:'NO_DATA' });

    const ext = extForContentType(contentType);
    const now = Date.now();
    const rand = Math.random().toString(36).slice(2,8);
    const path = `${PATH_DIR}/${filename.replace(/\.[a-z0-9]+$/i,'')}-${now}-${rand}.${ext}`;

    const savedPath = await ghPutFile(path, dataB64, `upload image ${filename}`, null);
    const rawUrl = `https://raw.githubusercontent.com/${GH_REPO}/${GH_BRANCH}/${encodeURIComponent(savedPath)}?t=${now}`;
    return jres(200, { ok:true, path: savedPath, url: rawUrl });
  } catch (e) {
    return jres(500, { ok:false, error:'UPLOAD_FAILED', message: String(e) });
  }
};
