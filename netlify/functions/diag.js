/* Netlify Function – diag (explicit Blobs config via env) */
const { getStore } = require('@netlify/blobs');
function res(statusCode, obj){ return { statusCode, headers: { 'content-type':'application/json' }, body: JSON.stringify(obj) }; }

function getConfiguredStore() {
  const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  const token  = process.env.BLOBS_TOKEN || process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) throw new Error('Missing env SITE_ID and/or BLOBS_TOKEN/NETLIFY_AUTH_TOKEN');
  return getStore('pixelwall', { siteID, token });
}

exports.handler = async () => {
  try {
    const info = { node: process.version, siteID: process.env.SITE_ID || process.env.NETLIFY_SITE_ID, tokenSet: !!(process.env.BLOBS_TOKEN || process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN) };
    let ok = false, setErr=null, getErr=null;
    try {
      const store = getConfiguredStore();
      try { await store.setJSON('diag', { ok:true, ts: Date.now() }); } catch (e) { setErr = String(e); }
      try { const v = await store.get('diag', { type: 'json' }); ok = !!(v && v.ok); } catch (e) { getErr = String(e); }
    } catch (e) {
      return res(500, { ok:false, error:'BLOBS_CONFIG_MISSING', message:String(e), info });
    }
    return res(200, { ok:true, blobsOk: ok, setErr, getErr });
  } catch (e) {
    return res(500, { ok:false, error:'SERVER_ERROR', message: String(e) });
  }
};
