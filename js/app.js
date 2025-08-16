// app.js — robust locks: local-wins merge + heartbeat during modal

const N = 100;
const TOTAL_PIXELS = 1_000_000;

// DOM
const grid = document.getElementById('grid');
const buyBtn = document.getElementById('buyBtn');
const priceLine = document.getElementById('priceLine');
const pixelsLeftEl = document.getElementById('pixelsLeft');

const modal = document.getElementById('modal');
const form = document.getElementById('form');
const linkInput = document.getElementById('link');
const nameInput = document.getElementById('name');
const emailInput = document.getElementById('email');
const confirmBtn = document.getElementById('confirm');
const modalStats = document.getElementById('modalStats');

function formatInt(n){ return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function formatMoney(n){ const [i,d]=Number(n).toFixed(2).split('.'); return '$'+i.replace(/\B(?=(\d{3})+(?!\d))/g,' ') + '.' + d; }

  // 1. UID génération plus robuste pour Edge
const uid = (()=>{ 
    const k='iw_uid'; 
    let v=localStorage.getItem(k); 
    if(!v){ 
        // Meilleure compatibilité Edge
        if (window.crypto && window.crypto.randomUUID) {
            v = crypto.randomUUID();
        } else if (window.crypto && window.crypto.getRandomValues) {
            // Fallback pour Edge anciennes versions
            const arr = new Uint8Array(16);
            crypto.getRandomValues(arr);
            v = Array.from(arr, byte => byte.toString(16).padStart(2, '0')).join('');
        } else {
            // Fallback ultime
            v = Date.now().toString(36) + Math.random().toString(36).slice(2);
        }
        localStorage.setItem(k,v);
    } 
    window.uid=v; 
    return v; 
})();

let sold = {};
let locks = {};
let selected = new Set();
let holdIncomingLocksUntil = 0;   // fenêtre pendant laquelle on NE TOUCHE PAS aux locks venant du serveur


// Heartbeat while modal open
let currentLock = [];
let heartbeat = null;
function startHeartbeat(){
  stopHeartbeat();
  heartbeat = setInterval(async ()=>{
    if (!currentLock.length) return;
    try { await reserve(currentLock); } catch {}
  }, 4000); // 25s
}
function stopHeartbeat(){
  if (heartbeat){ clearInterval(heartbeat); heartbeat=null; }
}

// Merge helper: keep our local locks (same uid) if longer
function mergeLocksPreferLocal(local, incoming){
  const now = Date.now();
  const out = {};
  
  console.log('🔄 [MERGE] Début merge équilibré:', {
    localCount: Object.keys(local || {}).length,
    incomingCount: Object.keys(incoming || {}).length,
    now: new Date(now).toLocaleTimeString(),
    browser: navigator.userAgent.includes('Edg') ? 'EDGE' : 'CHROME'
  });
  
  // 1️⃣ D'abord traiter TOUS les locks (locaux + entrants) et ne garder que les valides
  const allLocks = {};
  
  // Ajouter les locks locaux valides
  let localValidCount = 0;
  for (const [k, l] of Object.entries(local || {})) {
    if (l && l.until > now) {
      allLocks[k] = { ...l, source: 'local' };
      localValidCount++;
      console.log(`🏠 [MERGE] Local valide ${k}:`, {
        uid: l.uid?.slice(0,8) + '...',
        until: new Date(l.until).toLocaleTimeString(),
        isOurs: l.uid === uid
      });
    } else if (l && l.until <= now) {
      console.log(`⏰ [MERGE] Local EXPIRÉ ignoré ${k}:`, {
        uid: l.uid?.slice(0,8) + '...',
        until: new Date(l.until).toLocaleTimeString(),
        expiredBy: Math.round((now - l.until) / 1000) + 's'
      });
    }
  }
  
  // Ajouter les locks entrants valides
  let incomingValidCount = 0;
  for (const [k, l] of Object.entries(incoming || {})) {
    if (l && l.until > now) {
      // Si on a déjà ce lock localement, garder le plus récent
      const existing = allLocks[k];
      if (!existing || l.until > existing.until) {
        allLocks[k] = { ...l, source: 'incoming' };
        incomingValidCount++;
        console.log(`📡 [MERGE] Incoming valide ${k}:`, {
          uid: l.uid?.slice(0,8) + '...',
          until: new Date(l.until).toLocaleTimeString(),
          isOurs: l.uid === uid,
          replacing: existing ? 'local' : 'none'
        });
      } else {
        console.log(`🏠 [MERGE] Local plus récent gardé ${k}:`, {
          localUntil: new Date(existing.until).toLocaleTimeString(),
          incomingUntil: new Date(l.until).toLocaleTimeString()
        });
      }
    } else if (l && l.until <= now) {
      console.log(`⏰ [MERGE] Incoming EXPIRÉ ignoré ${k}:`, {
        uid: l.uid?.slice(0,8) + '...',
        until: new Date(l.until).toLocaleTimeString(),
        expiredBy: Math.round((now - l.until) / 1000) + 's'
      });
    }
  }
  
  // 2️⃣ Appliquer la priorité : nos locks ont priorité absolue s'ils sont plus longs
  let ourPriorityCount = 0;
  for (const [k, lock] of Object.entries(allLocks)) {
    if (lock.uid === uid) {
      // C'est notre lock, on le garde toujours
      out[k] = { uid: lock.uid, until: lock.until };
      ourPriorityCount++;
      console.log(`👑 [MERGE] Notre lock prioritaire ${k}:`, {
        until: new Date(lock.until).toLocaleTimeString(),
        source: lock.source
      });
    } else {
      // Lock d'un autre user - on le garde seulement si on n'a pas de conflit
      const ourLock = Object.entries(allLocks).find(([_, l]) => l.uid === uid);
      out[k] = { uid: lock.uid, until: lock.until };
      console.log(`👤 [MERGE] Lock autre user ${k}:`, {
        uid: lock.uid?.slice(0,8) + '...',
        until: new Date(lock.until).toLocaleTimeString(),
        source: lock.source
      });
    }
  }
  
  console.log('✅ [MERGE] Résultat équilibré:', {
    localValidCount,
    incomingValidCount, 
    ourPriorityCount,
    outputCount: Object.keys(out).length,
    browser: navigator.userAgent.includes('Edg') ? 'EDGE' : 'CHROME'
  });
  
  return out;
}

  

let isDragging=false, dragStartIdx=-1, movedDuringDrag=false, lastDragIdx=-1, suppressNextClick=false;
let blockedDuringDrag = false;

(function build(){
  const frag=document.createDocumentFragment();
  for(let i=0;i<N*N;i++){ const d=document.createElement('div'); d.className='cell'; d.dataset.idx=i; frag.appendChild(d); }
  grid.appendChild(frag);
  const cs = getComputedStyle(grid);
  if (cs.position === 'static') grid.style.position = 'relative';
})();

const invalidEl = document.createElement('div');
invalidEl.id = 'invalidRect';
Object.assign(invalidEl.style, { position:'absolute', border:'2px solid #ef4444', background:'rgba(239,68,68,0.08)', pointerEvents:'none', display:'none', zIndex:'999' });
const invalidIcon = document.createElement('div');
Object.assign(invalidIcon.style, { position:'absolute', left:'50%', top:'50%', transform:'translate(-50%,-50%)', pointerEvents:'none', zIndex:'1000' });
invalidIcon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="rgba(255,255,255,0.95)"></circle><circle cx="12" cy="12" r="9" fill="none" stroke="#ef4444" stroke-width="2"></circle><line x1="7" y1="17" x2="17" y2="7" stroke="#ef4444" stroke-width="2" stroke-linecap="round"></line></svg>`;
invalidEl.appendChild(invalidIcon);
grid.appendChild(invalidEl);

function getCellSize(){ const cell=grid.children[0]; if(!cell) return {w:10,h:10}; const r=cell.getBoundingClientRect(); return { w:Math.max(1,Math.round(r.width)), h:Math.max(1,Math.round(r.height)) }; }
function showInvalidRect(r0,c0,r1,c1, ttl=900){
  const { w:CW, h:CH } = getCellSize();
  const left=c0*CW, top=r0*CH, w=(c1-c0+1)*CW, h=(r1-r0+1)*CH;
  Object.assign(invalidEl.style,{ left:left+'px', top:top+'px', width:w+'px', height:h+'px', display:'block' });
  const size = Math.max(16, Math.min(64, Math.floor(Math.min(w, h) * 0.7)));
  const svg = invalidIcon.querySelector('svg'); svg.style.width=size+'px'; svg.style.height=size+'px';
  if (ttl>0) setTimeout(()=>{ invalidEl.style.display='none'; }, ttl);
}
function hideInvalidRect(){ invalidEl.style.display='none'; }

function idxToRowCol(idx){ return [Math.floor(idx/N), idx%N]; }
function rowColToIdx(r,c){ return r*N + c; }
function isBlockedCell(idx){
  if (sold[idx]) return true;
  const l = locks[idx];
  return !!(l && l.until > Date.now() && l.uid !== uid);
}

function paintCell(idx){
  const d=grid.children[idx]; const s=sold[idx]; const l=locks[idx];
  // DEBUG TEMPORAIRE pour quelques cellules
  if (idx < 5 || (l && l.until > Date.now())) {
    console.log(`🎨 [paintCell] idx=${idx}:`, {
      sold: !!s,
      lock: l ? {uid: l.uid, until: new Date(l.until).toLocaleTimeString()} : null,
      isReserved: !!(l && l.until > Date.now()),
      isOtherUser: !!(l && l.until > Date.now() && l.uid !== uid)
    });
  }
  
  const reserved = l && l.until > Date.now() && !s;
  const reservedByOther = reserved && l.uid !== uid;
  d.classList.toggle('sold', !!s);
  d.classList.toggle('pending', !!reservedByOther);
  d.classList.toggle('sel', selected.has(idx));
  
  if (s && s.imageUrl && s.rect && Number.isInteger(s.rect.x)){
    const [r,c]=idxToRowCol(idx); const { w:CW, h:CH }=getCellSize();
    const offX=(c - s.rect.x)*CW, offY=(r - s.rect.y)*CH;
    d.style.backgroundImage=`url(${s.imageUrl})`;
    d.style.backgroundSize=`${s.rect.w*CW}px ${s.rect.h*CH}px`;
    d.style.backgroundPosition=`-${offX}px -${offY}px`;
  } else {
    d.style.backgroundImage=''; d.style.backgroundSize=''; d.style.backgroundPosition='';
  }
  if (s){
    d.title=(s.name?s.name+' · ':'')+(s.linkUrl||'');
    if(!d.firstChild){ const a=document.createElement('a'); a.className='region-link'; a.target='_blank'; d.appendChild(a); }
    d.firstChild.href = s.linkUrl || '#';
  } else {
    d.title=''; if (d.firstChild) d.firstChild.remove();
  }
}
function paintAll(){ for(let i=0;i<N*N;i++) paintCell(i); refreshTopbar(); }

function refreshTopbar(){
  const blocksSold=Object.keys(sold).length, pixelsSold=blocksSold*100;
  const currentPrice = 1 + Math.floor(pixelsSold / 1000) * 0.01;
  priceLine.textContent = `1 pixel = ${formatMoney(currentPrice)}`;
  const left = TOTAL_PIXELS - pixelsSold;
  pixelsLeftEl.textContent = `${formatInt(left)} pixels left`;
  const selectedPixels = selected.size * 100;
  if (selectedPixels > 0) {
    const total = selectedPixels * currentPrice;
    buyBtn.textContent = `Buy Pixels — ${formatInt(selectedPixels)} px (${formatMoney(total)})`;
    buyBtn.disabled = false;
  } else { buyBtn.textContent = `Buy Pixels`; buyBtn.disabled = true; }
}

function clearSelection(){
  for(const i of selected) grid.children[i].classList.remove('sel');
  selected.clear(); refreshTopbar();
}

function selectRect(aIdx,bIdx){
  const [ar,ac]=idxToRowCol(aIdx), [br,bc]=idxToRowCol(bIdx);
  const r0=Math.min(ar,br), r1=Math.max(ar,br), c0=Math.min(ac,bc), c1=Math.max(ac,bc);
  blockedDuringDrag = false;
  for(let r=r0;r<=r1;r++){ for(let c=c0;c<=c1;c++){ const idx=rowColToIdx(r,c); if (isBlockedCell(idx)) { blockedDuringDrag = true; break; } } if (blockedDuringDrag) break; }
  if (blockedDuringDrag){ clearSelection(); showInvalidRect(r0,c0,r1,c1,900); return; }
  hideInvalidRect(); clearSelection();
  for(let r=r0;r<=r1;r++) for(let c=c0;c<=c1;c++){ const idx=rowColToIdx(r,c); selected.add(idx); }
  for(const i of selected) grid.children[i].classList.add('sel');
  refreshTopbar();
}

function toggleCell(idx){
  if (isBlockedCell(idx)) return;
  const d=grid.children[idx];
  if (selected.has(idx)) { selected.delete(idx); d.classList.remove('sel'); }
  else { selected.add(idx); d.classList.add('sel'); }
  refreshTopbar();
}

function idxFromClientXY(x,y){
  const rect=grid.getBoundingClientRect();
  const { w:CW, h:CH } = getCellSize();
  const gx=Math.floor((x-rect.left)/CW), gy=Math.floor((y-rect.top)/CH);
  if (gx<0||gy<0||gx>=N||gy>=N) return -1;
  return gy*N + gx;
}

grid.addEventListener('mousedown',(e)=>{
  const idx=idxFromClientXY(e.clientX,e.clientY); if(idx<0) return;
  isDragging=true; dragStartIdx=idx; lastDragIdx=idx; movedDuringDrag=false; suppressNextClick=false;
  selectRect(idx, idx); e.preventDefault();
});
window.addEventListener('mousemove',(e)=>{
  if(!isDragging) return;
  const idx=idxFromClientXY(e.clientX,e.clientY); if(idx<0) return;
  if(idx!==lastDragIdx){ movedDuringDrag=true; lastDragIdx=idx; }
  selectRect(dragStartIdx, idx);
});
window.addEventListener('mouseup',()=>{
  if (isDragging){ suppressNextClick=movedDuringDrag; }
  isDragging=false; dragStartIdx=-1; movedDuringDrag=false; lastDragIdx=-1;
});
grid.addEventListener('click',(e)=>{
  if(suppressNextClick){ suppressNextClick=false; return; }
  if(isDragging) return;
  const idx=idxFromClientXY(e.clientX,e.clientY); if(idx<0) return;
  toggleCell(idx);
});

function openModal(){ 
  modal.classList.remove('hidden');
  const blocksSold=Object.keys(sold).length, pixelsSold=blocksSold*100;
  const currentPrice = 1 + Math.floor(pixelsSold / 1000) * 0.01;
  const selectedPixels = selected.size * 100;
  const total = selectedPixels * currentPrice;
  modalStats.textContent = `${formatInt(selectedPixels)} px — ${formatMoney(total)}`;
  
  // ✅ UN SEUL heartbeat !
  if (currentLock.length) {
    startHeartbeat();
    console.log('[MODAL] Started heartbeat for', currentLock.length, 'blocks');
  }
}

function closeModal(){ 
  modal.classList.add('hidden'); 
  stopHeartbeat(); // ← C'est suffisant, pas besoin de répéter
}

document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', async () => {
  if (selected.size){ try { await unlock(Array.from(selected)); } catch {} }
  currentLock = []; stopHeartbeat();
  closeModal(); clearSelection();
}));
window.addEventListener('keydown', async (e)=>{
  if(e.key==='Escape'){
    if (!modal.classList.contains('hidden') && selected.size){ try { await unlock(Array.from(selected)); } catch {} }
    currentLock = []; stopHeartbeat();
    currentLock = [];
    if (heartbeat){ clearInterval(heartbeat); heartbeat = null; }
    closeModal();
    
     clearSelection();
  }
});

async function reserve(indices){
  const r = await fetch('/.netlify/functions/reserve', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body: JSON.stringify({ uid, blocks: indices, ttl: 300000 })
  });
  const res=await r.json();
  if(!r.ok||!res.ok) throw new Error(res.error||('HTTP '+r.status));

  // Ensure local locks reflect what we just reserved, with a full TTL
  const now = Date.now();
  for (const i of (res.locked||[])){
    locks[i] = { uid, until: now + 300000 };
  }
  // Merge incoming (others' locks) without dropping ours
  locks = mergeLocksPreferLocal(locks, res.locks || {});
  paintAll();
  
  // Empêche loadStatus() d’écraser nos locks pendant 8s (latence GitHub/Netlify)
  holdIncomingLocksUntil = Date.now() + 305000;
  // Souviens-toi de ce que TU viens de réserver (pour le heartbeat et la finalisation)
  currentLock = Array.isArray(res.locked) ? res.locked.slice() : [];
  return res;
}
async function unlock(indices){
  const r=await fetch('/.netlify/functions/unlock',{
    method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ uid, blocks: indices })
  });
  const res=await r.json(); if(!r.ok||!res.ok) throw new Error(res.error||('HTTP '+r.status));
  locks = res.locks || locks; paintAll(); return res;
}

buyBtn.addEventListener('click', async ()=>{
  if(!selected.size) return;
  const want = Array.from(selected);
  try{
    const got = await reserve(want);
    if ((got.conflicts && got.conflicts.length>0) || (got.locked && got.locked.length !== want.length)){
      const rect = rectFromIndices(want);
      if (rect) showInvalidRect(rect.r0, rect.c0, rect.r1, rect.c1, 1200);
      clearSelection(); paintAll();
      return;
    }
    // remember our current lock and start heartbeat in modal
    currentLock = got.locked.slice();
    clearSelection();
    for(const i of got.locked){ selected.add(i); grid.children[i].classList.add('sel'); }
    openModal();
  }catch(e){
    alert('Reservation failed: ' + (e?.message || e));
  }
});

form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  let linkUrl = linkInput.value.trim();
  const name  = nameInput.value.trim();
  const email = emailInput.value.trim();
  if(!linkUrl || !name || !email){ return; }
  if (!/^https?:\/\//i.test(linkUrl)) linkUrl = 'https://' + linkUrl;

  confirmBtn.disabled=true; confirmBtn.textContent='Processing…';
  try{
    const blocks = currentLock.length ? currentLock.slice() : Array.from(selected);
    const r = await fetch('/.netlify/functions/finalize', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ uid, blocks, linkUrl, name, email })
    });
    const res = await r.json();
    if (r.status===409 && res.taken){
      const rect = rectFromIndices(blocks);
      if (rect) showInvalidRect(rect.r0, rect.c0, rect.r1, rect.c1, 1200);
      clearSelection(); paintAll();
      return;
    }
    if (!r.ok || !res.ok) throw new Error(res.error || ('HTTP '+r.status));
    sold = res.soldMap || sold;
    try{ await unlock(blocks); }catch{}
    currentLock = []; stopHeartbeat();
    clearSelection(); paintAll(); closeModal();
  }catch(err){
    alert('Finalize failed: '+(err?.message||err));
  }finally{
    confirmBtn.disabled=false; confirmBtn.textContent='Confirm';
  }
});

function rectFromIndices(arr){
  if (!arr || !arr.length) return null;
  let r0=999, c0=999, r1=-1, c1=-1;
  for (const idx of arr){
    const r=Math.floor(idx/N), c=idx%N;
    if (r<r0) r0=r; if (c<c0) c0=c; if (r>r1) r1=r; if (c>c1) c1=c;
  }
  return { r0,c0,r1,c1 };
}

// Remplacez le début de loadStatus() par ceci pour voir la réponse brute :

// CORRECTION CRITIQUE : Nettoyer les locks expirés dans loadStatus
async function loadStatus(){
  console.log('🔄 [loadStatus] DÉBUT avec nettoyage - Browser:', navigator.userAgent.includes('Edg') ? 'EDGE' : 'CHROME');
  
  try{
    const r = await fetch('/.netlify/functions/status', {
      cache:'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
    
    const s = await r.json();
    
    if(s && s.ok){
      // Toujours mettre à jour SOLD
      sold = s.sold || {};
      
      const incoming = s.locks || {};
      const modalOpen = !modal.classList.contains('hidden');
      const protectionActive = Date.now() < holdIncomingLocksUntil;
      const hasCurrentLock = currentLock && currentLock.length > 0;
      
      console.log('🛡️ [loadStatus] État protection:', {
        modalOpen,
        protectionActive,
        hasCurrentLock,
        browser: navigator.userAgent.includes('Edg') ? 'EDGE' : 'CHROME'
      });
      
      if (modalOpen && hasCurrentLock) {
        console.log('⏸️ [loadStatus] PROTECTION STRICTE - modal + currentLock');
        paintAll();
        return;
      }
      
      // ✅ NETTOYAGE PRÉVENTIF des locks expirés AVANT merge
      const now = Date.now();
      const cleanedLocal = {};
      let expiredCount = 0;
      
      for (const [k, l] of Object.entries(locks)) {
        if (l && l.until > now) {
          cleanedLocal[k] = l;
        } else if (l) {
          expiredCount++;
          console.log(`🧹 [loadStatus] Nettoyage lock expiré ${k}:`, {
            uid: l.uid?.slice(0,8) + '...',
            until: new Date(l.until).toLocaleTimeString(),
            expiredBy: Math.round((now - l.until) / 1000) + 's'
          });
        }
      }
      
      if (expiredCount > 0) {
        console.log(`🧹 [loadStatus] ${expiredCount} locks expirés nettoyés`);
      }
      
      // Fusionner avec les locks nettoyés
      console.log('🔄 [loadStatus] Fusion avec nettoyage préalable:', {
        locksAvant: Object.keys(locks).length,
        locksNettoyés: Object.keys(cleanedLocal).length,
        locksEntrants: Object.keys(incoming).length
      });
      
      locks = mergeLocksPreferLocal(cleanedLocal, incoming);
      window.locks = { ...locks };
      
      console.log('🔄 [loadStatus] Après fusion:', {
        locksFinaux: Object.keys(locks).length
      });
    }
  } catch(e) {
    console.error('❌ [loadStatus] ERREUR:', e);
  }
  
  paintAll();
  console.log('✅ [loadStatus] FIN');
}


(async function init(){ 
  await loadStatus(); paintAll(); 
  /*setInterval(async()=>{ await loadStatus(); paintAll(); }, 2500); */
  setInterval(async()=>{ 
  console.log('⏰ [POLLING PRINCIPAL] Début cycle');
  await loadStatus(); 
  paintAll(); 
  console.log('⏰ [POLLING PRINCIPAL] Fin cycle - locks actuels:', Object.keys(locks).length);
}, 2500);

}

)();

window.__regionsPoll && clearInterval(window.__regionsPoll);
window.__regionsPoll = setInterval(async () => {
  try {
    console.log('🌍 [REGIONS] Début polling regions...');
    const res = await fetch('/.netlify/functions/status?ts=' + Date.now());
    const data = await res.json();
    
    // SEULEMENT regions et sold, PAS de locks !
    window.sold = data.sold || {};
    window.regions = data.regions || {};
    
    console.log('🌍 [REGIONS] Mise à jour:', {
      regions: Object.keys(window.regions).length,
      sold: Object.keys(window.sold).length
    });
    
    if (typeof window.renderRegions === 'function') window.renderRegions();
    console.log('🌍 [REGIONS] Terminé');
  } catch (e) { 
    console.warn('❌ [REGIONS] Erreur:', e);
  }
}, 15000);

// Regions overlay (kept)
window.regions = window.regions || {};
function renderRegions() {
  const gridEl = document.getElementById('grid');
  if (!gridEl) return;
  gridEl.querySelectorAll('.region-overlay').forEach(n => n.remove());
  const firstCell = gridEl.querySelector('.cell');
  const size = firstCell ? firstCell.offsetWidth : 10;
  const regionLink = {};
  for (const [idx, s] of Object.entries(window.sold || {})) {
    if (s && s.regionId && !regionLink[s.regionId] && s.linkUrl) regionLink[s.regionId] = s.linkUrl;
  }
  for (const [rid, reg] of Object.entries(window.regions || {})) {
    if (!reg || !reg.rect || !reg.imageUrl) continue;
    const { x, y, w, h } = reg.rect;
    const idxTL = y * 100 + x;
    const tl = gridEl.querySelector(`.cell[data-idx="${idxTL}"]`);
    if (!tl) continue;
    const a = document.createElement('a');
    a.className = 'region-overlay';
    if (regionLink[rid]) { a.href = regionLink[rid]; a.target = '_blank'; a.rel = 'noopener nofollow'; }
    Object.assign(a.style, {
      position: 'absolute',
      left: tl.offsetLeft + 'px',
      top:  tl.offsetTop  + 'px',
      width:  (w * size) + 'px',
      height: (h * size) + 'px',
      backgroundImage: `url("${reg.imageUrl}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      zIndex: 999
    });
    gridEl.appendChild(a);
  }
  gridEl.style.position = 'relative';
  gridEl.style.zIndex = 2;
}
window.renderRegions = renderRegions;

// Initial regions fetch + periodic refresh (15s)
(async function regionsBootOnce(){
  try {
    // Utilise la même fonction que le polling principal
    await loadStatus();
    paintAll(); // S'assurer que tout est rendu
    console.log('[regions] initial load via loadStatus()');
  } catch (e) { 
    console.warn('[regions] initial load failed', e); 
  }
})();
console.log('✅ Unified polling implemented - no more timing conflicts!');
/*console.log('app.js (robust locks + heartbeat) loaded');*/

// BONUS : Fonction de nettoyage manuel pour débugger
function debugCleanExpiredLocks() {
  const now = Date.now();
  const before = Object.keys(locks).length;
  
  for (const [k, l] of Object.entries(locks)) {
    if (!l || l.until <= now) {
      delete locks[k];
      console.log(`🧹 [DEBUG] Supprimé lock expiré ${k}`);
    }
  }
  
  const after = Object.keys(locks).length;
  console.log(`🧹 [DEBUG] Nettoyage: ${before} -> ${after} locks`);
  paintAll();
}