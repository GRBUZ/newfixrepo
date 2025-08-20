// iw_finalize_upload_patch.js — UID unify + DOM-selection + file input id compat
// Corrections : fixe la faute "fatch", attend l'init asynchrone du JWT, fallback propre sur fetchWithJWT

// Déclare la variable ici pour pouvoir la modifier dans initUID()
let uid = null;

// Initialisation asynchrone de l'UID via JWT si possible
async function initUID() {
  try {
    // Vérifier que les utilitaires d'auth sont chargés
    const hasAuthUtils = typeof window !== 'undefined' && (window.authUtils || window.fetchWithJWT || window.getUIDFromToken);
    if (!hasAuthUtils) {
      throw new Error('Auth utils non chargés');
    }

    // 1) Essayer de récupérer l'UID depuis le token JWT existant (via authUtils ou alias global)
    const getUID = (window.authUtils && window.authUtils.getUIDFromToken) ? window.authUtils.getUIDFromToken : (window.getUIDFromToken || null);
    if (typeof getUID === 'function') {
      const found = getUID();
      if (found) {
        uid = found;
        window.uid = uid;
        console.log('✅ UID from token:', uid.slice(0,8) + '...');
        return uid;
      }
    }

    // 2) Si pas d'UID, effectuer une requête vers le backend pour forcer éventuellement la création/renvoi d'un token
    // Utilise fetchWithJWT si disponible, sinon fallback sur fetch
    const fetchFn = window.fetchWithJWT || (window.authUtils && window.authUtils.fetchWithJWT) || window.fetch;
    if (!fetchFn) throw new Error('fetch non disponible');

    try {
      // on ne dépend pas du résultat mais la requête peut provoquer la création d'un cookie / token côté serveur
      await fetchFn('/.netlify/functions/status');
    } catch (e) {
      // ignore: l'appel peut échouer si le serveur refuse, on retentera de lire le token localement ensuite
      console.warn('[initUID] status call failed (ignored):', e);
    }

    // 3) relire le token/uid après l'appel
    if (typeof getUID === 'function') {
      const found2 = getUID();
      if (found2) {
        uid = found2;
        window.uid = uid;
        console.log('✅ UID obtenu après status:', uid.slice(0,8) + '...');
        return uid;
      }
    }

    throw new Error('Impossible de récupérer l\'UID via JWT');

  } catch (error) {
    console.error('❌ Erreur initialisation UID:', error);
    // Fallback vers l'ancien système en cas de problème
    try {
      uid = localStorage.getItem('iw_uid_fallback') || (Date.now().toString(36) + Math.random().toString(36).slice(2));
      localStorage.setItem('iw_uid_fallback', uid);
      window.uid = uid;
      console.log('⚠️ Utilisation UID fallback:', uid.slice(0,8) + '...');
      return uid;
    } catch (e) {
      // En dernier recours
      uid = window.uid || (Date.now().toString(36) + Math.random().toString(36).slice(2));
      window.uid = uid;
      console.log('⚠️ Utilisation UID fallback (no storage):', uid.slice(0,8) + '...');
      return uid;
    }
  }
}

/* iw_finalize_upload_patch.js — UID unify + DOM-selection + file input id compat */
(async function(){
  // === UID unify (reuse existing window.uid if present; persist in localStorage) ===
  function makeUid(){ try{ return crypto.randomUUID(); }catch(_){ return Date.now().toString(36)+Math.random().toString(36).slice(2); } }
  (function ensureUid(){
    try{
      const k='iw_uid';
      let v = (typeof window.uid !== 'undefined' && window.uid) ? String(window.uid) : (localStorage.getItem(k) || '');
      if (!v) { v = makeUid(); }
      localStorage.setItem(k, v);
      window.uid = v; // <- single source of truth pour démarrage
    }catch(_){
      window.uid = window.uid || makeUid();
    }
  })();

  // Attendre l'initialisation JWT (tentera d'écraser window.uid si succès)
  await initUID();

  // Maintenant on peut utiliser uid stable dans la closure
  uid = window.uid;
  console.log('[IW patch] UID unify active. uid=', uid);

  const grid        = document.getElementById('grid');
  const modal       = document.getElementById('modal');
  const form        = document.getElementById('form');
  const confirmBtn  = document.getElementById('confirm');
  const cancelBtn   = document.getElementById('cancel');
  const nameInput   = document.getElementById('name');
  const linkInput   = document.getElementById('link');
  const emailInput  = document.getElementById('email');
  const fileInput   = document.getElementById('image') || document.getElementById('avatar') || (form && form.querySelector('input[type="file"]'));

  if (!grid || !form || !confirmBtn) { console.warn('[IW patch] required elements not found'); return; }

  // Always derive selected indices from DOM to avoid cross-browser mismatch
  function getSelectedIndices(){
    return Array.from(document.querySelectorAll('.cell.sel')).map(el => +el.dataset.idx);
  }
  function normalizeUrl(u){ u=String(u||'').trim(); if(!u) return ''; if(!/^https?:\/\//i.test(u)) u='https://'+u; return u; }

  // Fallbacks if missing
  if (typeof window.renderRegions !== 'function') {
    window.renderRegions = function(){
      const gridEl = document.getElementById('grid'); if (!gridEl) return;
      gridEl.querySelectorAll('.region-overlay').forEach(n=>n.remove());
      const first = gridEl.querySelector('.cell'); const size = first ? first.offsetWidth : 10;
      const regionLink = {};
      for (const [idx, s] of Object.entries(window.sold||{})) if (s && s.regionId && !regionLink[s.regionId] && s.linkUrl) regionLink[s.regionId]=s.linkUrl;
      for (const [rid, reg] of Object.entries(window.regions||{})) {
        if (!reg || !reg.rect || !reg.imageUrl) continue;
        const {x,y,w,h} = reg.rect;
        const tl = gridEl.querySelector(`.cell[data-idx="${y*100+x}"]`); if (!tl) continue;
        const a=document.createElement('a'); a.className='region-overlay';
        if (regionLink[rid]) { a.href=regionLink[rid]; a.target='_blank'; a.rel='noopener nofollow'; }
        Object.assign(a.style,{position:'absolute',left:tl.offsetLeft+'px',top:tl.offsetTop+'px',width:(w*size)+'px',height:(h*size)+'px',backgroundImage:`url("${reg.imageUrl}")`,backgroundSize:'cover',backgroundPosition:'center',backgroundRepeat:'no-repeat',zIndex:999});
        gridEl.appendChild(a);
      }
      gridEl.style.position='relative'; gridEl.style.zIndex=2;
    };
  }
  if (typeof window.refreshStatus !== 'function') {
    window.refreshStatus = async function(){
      const r=await fetch('/.netlify/functions/status?ts='+Date.now()); const d=await r.json();
      window.sold=d.sold||{}; window.locks=d.locks||{}; window.regions=d.regions||{}; window.renderRegions?.();
    };
  }

  async function unlockSelection(){
    try{
      const blocks=getSelectedIndices(); if(!blocks.length) return;
      const fetchFn = window.fetchWithJWT || (window.authUtils && window.authUtils.fetchWithJWT) || window.fetch;
      if (!fetchFn) throw new Error('fetch non disponible');
      await fetchFn('/.netlify/functions/unlock',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({uid,blocks})});
    }catch(_){}
  }
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') unlockSelection(); },{passive:true});
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'){
      try{
        const blocks=getSelectedIndices(); if(!blocks.length) return;
        navigator.sendBeacon('/.netlify/functions/unlock', new Blob([JSON.stringify({uid,blocks})],{type:'application/json'}));
      }catch(_){}
    }
  });

  async function doConfirm(){
    const name=(nameInput&&nameInput.value||'').trim();
    const linkUrl=normalizeUrl(linkInput&&linkInput.value);
    const blocks=getSelectedIndices();
    if(!blocks.length){ alert('Please select at least one block.'); return; }
    if(!name||!linkUrl){ alert('Name and Profile URL are required.'); return; }

    newBtn?.setAttribute('disabled','true');

    // Re-reserve just before finalize (if backend supports it), using the SAME uid
    try{
      const rsv = await fetch('/.netlify/functions/reserve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({uid,blocks,ttl:180000})});
      const jr = await rsv.json();
      if(!jr.ok){
        await window.refreshStatus().catch(()=>{});
        alert(jr.error||'Some blocks are already locked/sold. Please reselect.');
        newBtn?.removeAttribute('disabled');
        return;
      }
    }catch(_){ /* ignore if not present */ }

    // Finalize WITH uid
    try {
      const fetchFn = window.fetchWithJWT || (window.authUtils && window.authUtils.fetchWithJWT) || window.fetch;
      if (!fetchFn) throw new Error('fetch non disponible');
      const fRes = await fetchFn('/.netlify/functions/finalize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({uid,name,linkUrl,blocks})});
      const out = await fRes.json();
      if(!out.ok){ alert(out.error||'Finalize failed'); newBtn?.removeAttribute('disabled'); return; }

      // Optional upload
      try{
        const file=fileInput&&fileInput.files&&fileInput.files[0];
        if(file){
          if(!file.type.startsWith('image/')) throw new Error('Please upload an image file.');
          if(file.size>5*1024*1024) throw new Error('Max 5 MB.');
          const fd=new FormData(); fd.append('file',file,file.name); fd.append('regionId',out.regionId);
          const upFetch = window.fetchWithJWT || (window.authUtils && window.authUtils.fetchWithJWT) || window.fetch;
          const upRes = await upFetch('/.netlify/functions/upload',{method:'POST',body:fd});
          const up = await upRes.json(); if(!up.ok) throw new Error(up.error||'UPLOAD_FAILED');
          console.log('[IW patch] image linked:', up.imageUrl);
        }
      }catch(e){ console.warn('[IW patch] upload failed:', e); }

      await window.refreshStatus().catch(()=>{});
      modal?.classList?.add('hidden');
    } finally {
      newBtn?.removeAttribute('disabled');
    }
  }

  // Force-rebind Confirm to avoid old handler keeping a wrong uid
  const newBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
  newBtn.id = 'confirm'; // keep same id
  newBtn.addEventListener('click', (e)=>{ e.preventDefault(); doConfirm(); });
  // Rebind cancel too (optional)
  if (cancelBtn){
    const nc = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(nc, cancelBtn);
    nc.id='cancel';
    nc.addEventListener('click', async (e)=>{ e.preventDefault(); await unlockSelection(); modal?.classList?.add('hidden'); });
  }

  // Premier refresh
  window.refreshStatus().catch(()=>{});
})();