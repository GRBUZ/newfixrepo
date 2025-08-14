/* iw_finalize_upload_patch.js (DOM-based selection indices)
   - Builds blocks list from DOM (.cell.sel) to avoid cross-browser math issues.
   - Sends uid; tries /reserve; then /finalize.
   - Optional image upload to /.netlify/functions/upload.
   - Unlocks on Cancel, ESC, and page hide (keepalive).
   - Refreshes status and renders regions.
*/
(function(){
  const grid        = document.getElementById('grid');
  const modal       = document.getElementById('modal');
  const form        = document.getElementById('form');
  const confirmBtn  = document.getElementById('confirm');
  const cancelBtn   = document.getElementById('cancel');
  const nameInput   = document.getElementById('name');
  const linkInput   = document.getElementById('link');
  const emailInput  = document.getElementById('email');
  const fileInput   = document.getElementById('image');  // <input type="file" id="image">

  if (!grid || !form || !confirmBtn) {
    console.warn('[IW patch] required elements not found, skipping.');
    return;
  }

  // UID persistent (Edge-friendly)
  const uid = (function(){
    try {
      const k='iw_uid';
      let v=localStorage.getItem(k);
      if(!v){
        v=(crypto && crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36)+Math.random().toString(36).slice(2)));
        localStorage.setItem(k,v);
      }
      return v;
    } catch(_){
      return (Date.now().toString(36)+Math.random().toString(36).slice(2));
    }
  })();

  // Always derive selected indices from DOM (prevents cross-browser mismatch)
  function getSelectedIndices(){
    return Array.from(document.querySelectorAll('.cell.sel')).map(el => +el.dataset.idx);
  }

  function normalizeUrl(u){
    u = String(u||'').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u;
  }

  // Fallbacks if missing
  if (typeof window.renderRegions !== 'function') {
    window.renderRegions = function renderRegions(){
      const gridEl = document.getElementById('grid'); if (!gridEl) return;
      gridEl.querySelectorAll('.region-overlay').forEach(n=>n.remove());
      const firstCell = gridEl.querySelector('.cell');
      const size = firstCell ? firstCell.offsetWidth : 10;
      const regionLink = {};
      for (const [idx, s] of Object.entries(window.sold||{})) {
        if (s && s.regionId && !regionLink[s.regionId] && s.linkUrl) regionLink[s.regionId] = s.linkUrl;
      }
      for (const [rid, reg] of Object.entries(window.regions||{})) {
        if (!reg || !reg.rect || !reg.imageUrl) continue;
        const {x,y,w,h} = reg.rect;
        const idxTL = y*100 + x;
        const tl = gridEl.querySelector(`.cell[data-idx="${idxTL}"]`);
        if (!tl) continue;
        const a = document.createElement('a');
        a.className = 'region-overlay';
        if (regionLink[rid]) { a.href = regionLink[rid]; a.target = '_blank'; a.rel='noopener nofollow'; }
        Object.assign(a.style, {
          position:'absolute', left:tl.offsetLeft+'px', top:tl.offsetTop+'px',
          width:(w*size)+'px', height:(h*size)+'px',
          backgroundImage:`url("${reg.imageUrl}")`,
          backgroundSize:'cover', backgroundPosition:'center', backgroundRepeat:'no-repeat',
          zIndex:999
        });
        gridEl.appendChild(a);
      }
      gridEl.style.position='relative'; gridEl.style.zIndex=2;
    };
  }
  if (typeof window.refreshStatus !== 'function') {
    window.refreshStatus = async function refreshStatus(){
      const res = await fetch('/.netlify/functions/status?ts='+Date.now());
      const data = await res.json();
      window.sold    = data.sold    || {};
      window.locks   = data.locks   || {};
      window.regions = data.regions || {};
      window.renderRegions?.();
    };
  }

  async function unlockSelection(){
    try {
      const blocks = getSelectedIndices();
      if (!blocks.length) return;
      await fetch('/.netlify/functions/unlock', {
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ uid, blocks })
      });
    } catch(_){}
  }

  // Unlock on ESC + when page hidden (keepalive)
  document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') unlockSelection(); }, { passive:true });
  document.addEventListener('visibilitychange', ()=>{
    if (document.visibilityState === 'hidden') {
      try {
        const blocks = getSelectedIndices();
        if (!blocks.length) return;
        navigator.sendBeacon('/.netlify/functions/unlock', new Blob([JSON.stringify({ uid, blocks })], { type: 'application/json' }));
      } catch(_){}
    }
  });

  async function doConfirm(){
    const name    = (nameInput && nameInput.value || '').trim();
    const linkUrl = normalizeUrl(linkInput && linkInput.value);
    const blocks  = getSelectedIndices();
    if (!blocks.length) { alert('Please select at least one block.'); return; }
    if (!name || !linkUrl) { alert('Name and Profile URL are required.'); return; }

    confirmBtn.disabled = true;

    // Re-reserve just before finalize (if backend supports it)
    try {
      const rsv = await fetch('/.netlify/functions/reserve', {
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ uid, blocks, ttl: 180000 })
      });
      const jr = await rsv.json();
      if (!jr.ok) {
        await window.refreshStatus().catch(()=>{});
        alert(jr.error || 'Some blocks are already locked/sold. Please reselect.');
        confirmBtn.disabled = false;
        return;
      }
    } catch(_) { /* ignore if not present */ }

    // Finalize WITH uid
    const fRes = await fetch('/.netlify/functions/finalize', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ uid, name, linkUrl, blocks })
    });
    const out = await fRes.json();
    if (!out.ok) {
      alert(out.error || 'Finalize failed');
      confirmBtn.disabled = false;
      return;
    }

    // Optional upload (sets regions[out.regionId].imageUrl)
    try {
      const file = fileInput && fileInput.files && fileInput.files[0];
      if (file) {
        if (!file.type.startsWith('image/')) throw new Error('Please upload an image file.');
        if (file.size > 5*1024*1024) throw new Error('Max 5 MB.');
        const fd = new FormData();
        fd.append('file', file, file.name);
        fd.append('regionId', out.regionId);
        const upRes = await fetch('/.netlify/functions/upload', { method:'POST', body: fd });
        const up = await upRes.json();
        if (!up.ok) throw new Error(up.error || 'UPLOAD_FAILED');
        console.log('[IW patch] image linked:', up.imageUrl);
      }
    } catch(e){
      console.warn('[IW patch] upload failed:', e);
    }

    await window.refreshStatus().catch(()=>{});
    modal?.classList?.add('hidden');
    confirmBtn.disabled = false;
  }

  if (!confirmBtn.__iwBound){
    confirmBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); doConfirm(); });
    confirmBtn.__iwBound = true;
  }
  if (cancelBtn && !cancelBtn.__iwBound){
    cancelBtn.addEventListener('click', async (ev)=>{ ev.preventDefault(); await unlockSelection(); modal?.classList?.add('hidden'); });
    cancelBtn.__iwBound = true;
  }

  window.refreshStatus().catch(()=>{});
  console.log('[IW patch] DOM-based selection + uid/locks patch active. UID=', uid);
})();