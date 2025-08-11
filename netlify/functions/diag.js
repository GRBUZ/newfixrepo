/* Netlify Function – diag — siteId/siteID compatibility patch */
const { getStore } = require('@netlify/blobs');
function res(statusCode, obj){ return { statusCode, headers: { 'content-type':'application/json' }, body: JSON.stringify(obj) }; }

function makeOptions() {
  const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  const token  = process.env.BLOBS_TOKEN || process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
  return { siteID, siteId: siteID, token };
}

exports.handler = async () => {
  const opts = makeOptions();
  try {
    if (!opts.siteID || !opts.token) {
      return res(500, { ok:false, error:'ENV_MISSING', info:{ node: process.version, siteID: opts.siteID, tokenSet: !!opts.token } });
    }
    let store;
    try { store = getStore('pixelwall_basic', opts); } catch (e) {
      return res(500, { ok:false, error:'GETSTORE_FAILED', message: String(e), info:{ node: process.version, opts } });
    }
    let setErr=null, getErr=null, ok=false;
    try { await store.setJSON('diag', { ok:true, ts: Date.now() }); } catch (e) { setErr = String(e); }
    try { const v = await store.get('diag', { type: 'json' }); ok = !!(v && v.ok); } catch (e) { getErr = String(e); }
    return res(200, { ok, setErr, getErr, info:{ node: process.version, opts } });
  } catch (e) {
    return res(500, { ok:false, error:'SERVER_ERROR', message: String(e) });
  }
};
