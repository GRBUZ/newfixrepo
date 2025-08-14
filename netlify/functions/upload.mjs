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
    if (req.method !== "POST") return bad(405, "METHOD_NOT_ALLOWED");
    if (!GH_REPO || !GH_TOKEN) return bad(500, "GITHUB_CONFIG_MISSING");

    // --- accepter FormData OU JSON ---
    const ct = (req.headers.get('content-type') || '').toLowerCase();
    let regionId = '', filename = '', buffer = null, mime = '';

    if (ct.includes('multipart/form-data')) {
      // MODE FORMDATA (file + regionId)
      const form = await req.formData();
      const file = form.get('file');
      regionId = String(form.get('regionId') || '').trim();
      if (!file || !file.name) return bad(400, "NO_FILE");
      if (!file.type || !file.type.startsWith("image/")) return bad(400, "NOT_IMAGE");
      filename = file.name;
      mime = file.type;
      buffer = Buffer.from(await file.arrayBuffer());

    } else {
      // MODE JSON (filename + contentBase64 + regionId)
      const body = await req.json().catch(() => null);
      if (!body) return bad(400, "BAD_JSON");
      regionId = String(body.regionId || '').trim();
      filename = String(body.filename || 'image.jpg');
      mime = String(body.contentType || 'image/jpeg');
      const b64 = String(body.contentBase64 || '');
      if (!b64) return bad(400, "NO_FILE_BASE64");
      buffer = Buffer.from(b64, 'base64');
      if (!mime.startsWith('image/')) return bad(400, "NOT_IMAGE");
    }

    if (!regionId) return bad(400, "MISSING_REGION_ID");

    // … puis garde le reste de TA logique d’upload :
    //  - écrire dans assets/images/<regionId>/<filename>
    //  - construire l’URL RAW GitHub
    //  - mettre à jour state.json → regions[regionId].imageUrl (pretty-print)
    //  (si tu n’as pas cette partie, dis-le moi et je te colle le bloc exact)

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
