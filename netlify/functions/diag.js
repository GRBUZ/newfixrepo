/* Netlify Function – diag: quick environment check */
exports.handler = async () => {
  try {
    const info = { node: process.version };
    let blobsOk = false, getErr = null, setErr = null;
    try {
      const { getStore } = require('@netlify/blobs');
      const store = getStore('pixelwall', { consistency: 'strong' });
      try { await store.setJSON('diag', { ok:true, ts: Date.now() }); } catch (e) { setErr = String(e); }
      try { const v = await store.get('diag', { type: 'json' }); blobsOk = !!(v && v.ok); } catch (e) { getErr = String(e); }
    } catch (e) {
      return { statusCode: 500, headers: { 'content-type':'application/json' }, body: JSON.stringify({ ok:false, error:'BLOBS_IMPORT_FAIL', message: String(e), info }) };
    }
    return { statusCode: 200, headers: { 'content-type':'application/json' }, body: JSON.stringify({ ok:true, info, blobsOk, setErr, getErr }) };
  } catch (e) {
    return { statusCode: 500, headers: { 'content-type':'application/json' }, body: JSON.stringify({ ok:false, error:'SERVER_ERROR', message: String(e) }) };
  }
};
