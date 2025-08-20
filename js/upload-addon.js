// UID sécurisé via JWT

// Initialisation asynchrone de l'UID (à appeler ailleurs)
async function initUID() {
  try {
    if (!window.authUtils) throw new Error('Auth utils non chargés');
    window.uid = window.authUtils.getUIDFromToken();
    //let uid = window.authUtils.getUIDFromToken();
    if (!window.uid) {
      await fetch('/.netlify/functions/status');
      window.uid = window.authUtils.getUIDFromToken();
    }
    if (!window.uid) throw new Error('Impossible de récupérer l UID');
    console.log('✅ UID sécurisé initialisé:', window.uid.slice(0, 8) + '...');
  } catch (error) {
    console.error('❌ Erreur initialisation UID:', error);
    uid = localStorage.getItem('iw_uid_fallback') || 
          Date.now().toString(36) + Math.random().toString(36).slice(2);
    localStorage.setItem('iw_uid_fallback', uid);
    window.uid = uid;
    console.log('⚠️ Utilisation UID fallback:', uid.slice(0, 8) + '...');
  }
}

(function(){
  const input = document.getElementById('avatar');
  const out   = document.getElementById('uploadedUrl');
  const btn   = document.getElementById('copyUrl');

  if (!input || !out) return;

  function toBase64(file){
    return new Promise((resolve, reject)=>{
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('Read failed'));
      fr.onload  = () => resolve(fr.result);
      fr.readAsDataURL(file);
    });
  }

  async function linkImageAfterUpload(regionId, imageUrl) {
    if (!regionId || !imageUrl) return console.warn('Missing regionId or imageUrl');
    try {
      const resp = await window.fetchWithJWT('/.netlify/functions/link-image', {
        method: 'POST',
        headers: { 'content-type':'application/json' },
        body: JSON.stringify({ regionId, imageUrl })
      });
      const j = await resp.json();
      if (!j.ok) console.warn('link-image failed:', j);
      else console.log('✅ image linked', j.imageUrl);
    } catch (e) {
      console.error('❌ error linking image:', e);
    }
  }

  input.addEventListener('change', async (e)=>{
    const file = input.files && input.files[0];
    if (!file) return;
    out.value = 'Uploading… please wait';
    try{
      if (file.size > 1.5 * 1024 * 1024) {
        throw new Error('File too large. Please keep under ~1.5 MB.');
      }
      const dataUrl = await toBase64(file);
      const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
      if (!m) throw new Error('Unsupported image format.');
      const contentType = m[1];
      const b64 = m[2];

      const r = await window.fetchWithJWT('/.netlify/functions/upload', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body: JSON.stringify({ filename: file.name, contentType, data: b64 })
      });
      const res = await r.json();
      if (!r.ok || !res.ok) throw new Error(res.message || res.error || ('HTTP '+r.status));

      const uploadedPath = res.path || '';
      out.value = res.url || '';
      out.dataset.path = uploadedPath;

      const regionId = out.dataset.regionId;
      if (regionId && uploadedPath) {
        await linkImageAfterUpload(regionId, uploadedPath);
      }

    }catch(err){
      console.error(err);
      out.value = 'Upload failed: ' + (err?.message || err);
    }
  });

  if (btn && out){
    btn.addEventListener('click', ()=>{
      if (!out.value) return;
      out.select();
      try { document.execCommand('copy'); } catch {}
    });
  }
})();