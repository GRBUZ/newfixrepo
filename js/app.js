// Forbidden icon overlay — robust version
// - Overlay appended AFTER cells to ensure it's on top
// - Cell size computed from DOM (handles CSS changes)
// - High z-index; ensure grid has position:relative
// - No-holes selection logic retained

const N = 100;
const TOTAL_PIXELS = 1_000_000;

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
function formatMoney(n){ const [i,d]=n.toFixed(2).split('.'); return '$'+i.replace(/\B(?=(\d{3})+(?!\d))/g,' ') + '.' + d; }

const uid = (()=>{ const k='iw_uid'; let v=localStorage.getItem(k); if(!v){ v=(crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)); localStorage.setItem(k,v);} return v; })();

let sold = {};   // { idx: { name, linkUrl, ts, imageUrl?, rect? } }
let locks = {};  // { idx: { uid, until } }
let selected = new Set();

// drag state
let isDragging=false, dragStartIdx=-1, movedDuringDrag=false, lastDragIdx=-1, suppressNextClick=false;
let blockedDuringDrag = false;

// ---------- Build grid ----------
(function build(){
  const frag=document.createDocumentFragment();
  for(let i=0;i<N*N;i++){ const d=document.createElement('div'); d.className='cell'; d.dataset.idx=i; frag.appendChild(d); }
  grid.appendChild(frag);
  const cs = getComputedStyle(grid);
  if (cs.position === 'static') grid.style.position = 'relative';
})();

// ---------- Overlay (added AFTER cells so it's on top) ----------
const invalidEl = document.createElement('div');
invalidEl.id = 'invalidRect';
Object.assign(invalidEl.style, {
  position: 'absolute',
  border: '2px solid #ef4444',
  background: 'rgba(239,68,68,0.08)',
  pointerEvents: 'none',
  display: 'none',
  zIndex: '999'
});
const invalidIcon = document.createElement('div');
Object.assign(invalidIcon.style, {
  position: 'absolute',
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
  pointerEvents: 'none',
  zIndex: '1000'
});
invalidIcon.innerHTML = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="10" fill="rgba(255,255,255,0.95)"></circle>
    <circle cx="12" cy="12" r="9" fill="none" stroke="#ef4444" stroke-width="2"></circle>
    <line x1="7" y1="17" x2="17" y2="7" stroke="#ef4444" stroke-width="2" stroke-linecap="round"></line>
  </svg>
`;
invalidEl.appendChild(invalidIcon);
grid.appendChild(invalidEl);

function getCellSize(){
  const cell = grid.children[0];
  if (!cell) return { w: 10, h: 10 };
  const r = cell.getBoundingClientRect();
  return { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) };
}
function showInvalidRect(r0,c0,r1,c1, ttl=900){
  const { w:CW, h:CH } = getCellSize();
  const left = c0*CW, top = r0*CH;
  const w = (c1-c0+1)*CW, h = (r1-r0+1)*CH;
  Object.assign(invalidEl.style, { left:left+'px', top:top+'px', width:w+'px', height:h+'px', display:'block' });
  const size = Math.max(16, Math.min(64, Math.floor(Math.min(w, h) * 0.7)));
  const svg = invalidIcon.querySelector('svg'); svg.style.width = size+'px'; svg.style.height = size+'px';
  if (ttl>0){ setTimeout(()=>{ invalidEl.style.display='none'; }, ttl); }
}
function hideInvalidRect(){ invalidEl.style.display='none'; }

// ---------- Helpers ----------
function idxToRowCol(idx){ return [Math.floor(idx/N), idx%N]; }
function rowColToIdx(r,c){ return r*N + c; }
function isBlockedCell(idx){
  if (sold[idx]) return true;
  const l = locks[idx];
  return !!(l && l.until > Date.now() && l.uid !== uid);
}

function paintCell(idx){
  const d=grid.children[idx]; const s=sold[idx]; const l=locks[idx];
  const reserved = l && l.until > Date.now() && !s;
  const reservedByOther = reserved && l.uid !== uid;

  d.classList.toggle('sold', !!s);
  d.classList.toggle('pending', !!reservedByOther);
  d.classList.toggle('sel', selected.has(idx));

  if (s && s.imageUrl && s.rect && Number.isInteger(s.rect.x)) {
    const [r,c]=idxToRowCol(idx);
    const { w:CW, h:CH } = getCellSize();
    const offX=(c - s.rect.x)*CW, offY=(r - s.rect.y)*CH;
    d.style.backgroundImage = `url(${s.imageUrl})`;
    d.style.backgroundSize = `${s.rect.w*CW}px ${s.rect.h*CH}px`;
    d.style.backgroundPosition = `-${offX}px -${offY}px`;
  } else {
    d.style.backgroundImage=''; d.style.backgroundSize=''; d.style.backgroundPosition='';
  }

  if (s){
    d.title=(s.name?s.name+' · ':'')+(s.linkUrl||'');
    if(!d.firstChild){ const a=document.createElement('a'); a.className='region-link'; a.target='_blank'; d.appendChild(a); }
    d.firstChild.href = s.linkUrl || '#';
  } else {
    d.title='';
    if (d.firstChild) d.firstChild.remove();
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
  } else {
    buyBtn.textContent = `Buy Pixels`;
    buyBtn.disabled = true;
  }
}

function clearSelection(){
  for(const i of selected) grid.children[i].classList.remove('sel');
  selected.clear();
  refreshTopbar();
}

function selectRect(aIdx,bIdx){
  const [ar,ac]=idxToRowCol(aIdx), [br,bc]=idxToRowCol(bIdx);
  const r0=Math.min(ar,br), r1=Math.max(ar,br), c0=Math.min(ac,bc), c1=Math.max(ac,bc);

  // detect blocked cells
  blockedDuringDrag = false;
  for(let r=r0;r<=r1;r++){
    for(let c=c0;c<=c1;c++){
      const idx=rowColToIdx(r,c);
      if (isBlockedCell(idx)) { blockedDuringDrag = true; break; }
    }
    if (blockedDuringDrag) break;
  }

  if (blockedDuringDrag){
    clearSelection();
    showInvalidRect(r0,c0,r1,c1, 900);
    return;
  }

  hideInvalidRect();
  clearSelection();
  for(let r=r0;r<=r1;r++) for(let c=c0;c<=c1;c++){
    const idx=rowColToIdx(r,c);
    selected.add(idx);
  }
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
  // compute cell size from DOM
  const { w:CW, h:CH } = getCellSize();
  const gx=Math.floor((x-rect.left)/CW), gy=Math.floor((y-rect.top)/CH);
  if (gx<0||gy<0||gx>=N||gy>=N) return -1;
  return gy*N + gx;
}

// Drag handlers + click suppression
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
  // overlay auto-hides via TTL
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
}
function closeModal(){ modal.classList.add('hidden'); }

document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', async () => {
  if (selected.size){ try { await unlock(Array.from(selected)); } catch {} }
  closeModal(); clearSelection();
}));
window.addEventListener('keydown', async (e)=>{
  if(e.key==='Escape'){
    if (!modal.classList.contains('hidden') && selected.size){ try { await unlock(Array.from(selected)); } catch {} }
    closeModal(); clearSelection();
  }
});

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
    clearSelection();
    for(const i of got.locked){ selected.add(i); grid.children[i].classList.add('sel'); }
    openModal();
  }catch(e){
    alert('Reservation failed: ' + (e?.message || e));
  }
});

form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const linkUrl = linkInput.value.trim();
  const name    = nameInput.value.trim();
  const email   = emailInput.value.trim();
  if(!linkUrl || !name || !email){ return; }
  confirmBtn.disabled=true; confirmBtn.textContent='Processing…';
  try{
    const blocks = Array.from(selected);
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

async function reserve(indices){
  const r=await fetch('/.netlify/functions/reserve',{ method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ uid, blocks: indices }) });
  const res=await r.json(); if(!r.ok||!res.ok) throw new Error(res.error||('HTTP '+r.status));
  locks = res.locks || locks; paintAll(); return res;
}
async function unlock(indices){
  const r=await fetch('/.netlify/functions/unlock',{ method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ uid, blocks: indices }) });
  const res=await r.json(); if(!r.ok||!res.ok) throw new Error(res.error||('HTTP '+r.status));
  locks = res.locks || locks; paintAll(); return res;
}

async function loadStatus(){
  try{ const r=await fetch('/.netlify/functions/status',{cache:'no-store'}); 
  const s=await r.json(); 
  if(s&&s.ok){ sold=s.sold||{}; 
  locks=s.locks||{}; } }
  catch{}

  // DESSIN AUTOMATIQUE DES RÉGIONS
  renderRegions();
}
(async function init(){ await loadStatus(); paintAll(); setInterval(async()=>{ await loadStatus(); paintAll(); }, 2500); })();

// Debug marker to verify correct file is loaded
window.__hasForbiddenIconOverlay = true;
console.log('app.js: forbidden icon overlay patch loaded');
window.regions = window.regions || {};

function getRegionForIndex(idx){
  const info = sold[idx];
  if (!info) return null;
  const reg = info.regionId && regions ? regions[info.regionId] : null;
  if (reg && reg.rect && (reg.imageUrl || reg.imageUrl === "")) return { info, region: reg };
  // Back-compat legacy
  const legacyRect = info.rect, legacyImage = info.imageUrl;
  if (legacyRect && legacyImage !== undefined) {
    return { info, region: { imageUrl: legacyImage, rect: legacyRect } };
  }
  return { info, region: null };
}

function renderAllRegionsOnce(){
  if (!regions) return;
  const seen = new Set();
  for (const [idxStr, s] of Object.entries(sold)){
    const rid = s.regionId;
    if (!rid || seen.has(rid)) continue;
    const reg = regions[rid];
    if (!reg || !reg.rect) continue;
    if (typeof window.drawRegionOverlay === 'function'){
      window.drawRegionOverlay(reg, rid);
    }
    seen.add(rid);
  }
}
// Example hook: call this after fetching status (sold/locks/regions)
window.renderAllRegionsOnce = renderAllRegionsOnce;


form.addEventListener('submit', async (e) => {
  e.preventDefault();
  let link = linkInput.value.trim();
  if (link && !/^https?:\/\//i.test(link)) {
    link = 'https://' + link;     // confort côté client
  }
  // ... puis envoie { linkUrl: link, name, blocks, ... } à /finalize
});
// ---- Render regions (one overlay per region) ----
function renderRegions() {
  const grid = document.getElementById('grid');
  if (!grid) return;

  // Nettoyer les overlays précédents
  grid.querySelectorAll('.region-overlay').forEach(n => n.remove());

  const firstCell = grid.querySelector('.cell');
  const size = firstCell ? firstCell.offsetWidth : 10; // cellule (incl. bordure)

  // Map regionId -> linkUrl (on prend le 1er bloc vendu qui a ce regionId)
  const regionLink = {};
  for (const [idx, s] of Object.entries(window.sold || {})) {
    if (s && s.regionId && !regionLink[s.regionId] && s.linkUrl) {
      regionLink[s.regionId] = s.linkUrl;
    }
  }

  // Dessiner 1 overlay par région
  for (const [rid, reg] of Object.entries(window.regions || {})) {
    if (!reg || !reg.rect || !reg.imageUrl) continue;

    const { x, y, w, h } = reg.rect;
    const idxTL = y * 100 + x; // top-left block index (N=100)
    const tl = grid.querySelector(`.cell[data-idx="${idxTL}"]`);
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
    grid.appendChild(a);
  }
  // S’assurer que la grille est au-dessus du header
  grid.style.position = 'relative';
  grid.style.zIndex = 2;
}
window.renderRegions = renderRegions;
