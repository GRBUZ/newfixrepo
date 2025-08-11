// Netlify Functions v2 (ESM) — diag
import { getStore } from '@netlify/blobs';

const json = (status, obj) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

export default async () => {
  try {
    const info = { node: process.version, runtime: 'functions-v2' };
    let ok = false, setErr=null, getErr=null;
    try {
      const store = getStore('pixelwall_basic');
      try { await store.setJSON('diag', { ok:true, ts: Date.now() }); } catch (e) { setErr = String(e); }
      try { const v = await store.get('diag', { type: 'json' }); ok = !!(v && v.ok); } catch (e) { getErr = String(e); }
    } catch (e) {
      return json(500, { ok:false, error:'GETSTORE_FAILED', message:String(e), info });
    }
    return json(200, { ok:true, blobsOk: ok, setErr, getErr });
  } catch (e) {
    return json(500, { ok:false, error:'SERVER_ERROR', message: String(e) });
  }
};
