// No-holes selection + red highlight (no alert)
// - Reject rectangles that include SOLD/RESERVED cells
// - Show a red overlay rectangle instead of alert
// - On /reserve conflicts or partial lock, flash the same overlay
// - Keeps: drag suppression, modal summary, required fields

const N = 100;
const CELL = 10;
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
let blockedRect = null; // {r0,c0,r1,c1}

// ----- invalid overlay -----
const invalidEl = document.createElement('div');
invalidEl.id = 'invalidRect';
invalidEl.style.position = 'absolute';
invalidEl.style.border = '2px solid #ef4444';
invalidEl.style.background = 'rgba(239,68,68,0.08)';
invalidEl.style.pointerEvents = 'none';
invalidEl.style.display = 'none';
invalidEl.style.zIndex = '5';
grid.appendChild(invalidEl);

function showInvalidRect(r0,c0,r1,c1, ttl=900){
  const left = c0*CELL, top = r0*CELL;
  const w = (c1-c0+1)*CELL, h = (r1-r0+1)*CELL;
  invalidEl.style.left = left+'px';
  invalidEl.style.top = top+'px';
  invalidEl.style.width = w+'px';
  invalidEl.style.height = h+'px';
  invalidEl.style.display = 'block';
  if (ttl>0){
    const t = setTimeout(()=>{ invalidEl.style.display='none'; }, ttl);
  }
}
function hideInvalidRect(){ invalidEl.style.display='none'; }

(function build(){
  const frag=document.createDocumentFragment();
  for(let i=0;i<N*N;i++){ const d=document.createElement('div'); d.className='cell'; d.dataset.idx=i; frag.appendChild(d); }
  grid.appendChild(frag);
})();

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
    const offX=(c - s.rect.x)*CELL, offY=(r - s.rect.y)*CELL;
    d.style.backgroundImage = `url(${s.imageUrl})`;
    d.style.backgroundSize = `${s.rect.w*CELL}px ${s.rect.h*CELL}px`;
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
  blockedDuringDrag = false; blockedRect = {r0,c0,r1,c1};
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
  const gx=Math.floor((x-rect.left)/CELL), gy=Math.floor((y-rect.top)/CELL);
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
  // keep overlay a bit if was blocked; it will auto-hide via TTL
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
    // if conflict/partial → reject and flash red overlay around current selection
    if ((got.conflicts && got.conflicts.length>0) || (got.locked && got.locked.length !== want.length)){
      const selRect = rectFromSelected();
      if (selRect) showInvalidRect(selRect.r0, selRect.c0, selRect.r1, selRect.c1, 1200);
      clearSelection();
      paintAll();
      return;
    }
    clearSelection();
    for(const i of got.locked){ selected.add(i); grid.children[i].classList.add('sel'); }
    openModal();
  }catch(e){
    // network/server error — keep alert to signal a real failure
    alert('Reservation failed: ' + (e?.message || e));
  }
});

form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const linkUrl = linkInput.value.trim();
  const name    = nameInput.value.trim();
  const email   = emailInput.value.trim();
  if(!linkUrl || !name || !email){ return; } // fields are required; rely on browser validation
  confirmBtn.disabled=true; confirmBtn.textContent='Processing…';
  try{
    const blocks = Array.from(selected);
    const r = await fetch('/.netlify/functions/finalize', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ uid, blocks, linkUrl, name, email })
    });
    const res = await r.json();
    if (r.status===409 && res.taken){
      const selRect = rectFromSelected();
      if (selRect) showInvalidRect(selRect.r0, selRect.c0, selRect.r1, selRect.c1, 1200);
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

function rectFromSelected(){
  if (selected.size===0) return null;
  let r0=999, c0=999, r1=-1, c1=-1;
  for (const idx of selected){
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
  try{ const r=await fetch('/.netlify/functions/status',{cache:'no-store'}); const s=await r.json(); if(s&&s.ok){ sold=s.sold||{}; locks=s.locks||{}; } }catch{}
}
(async function init(){ await loadStatus(); paintAll(); setInterval(async()=>{ await loadStatus(); paintAll(); }, 2500); })();
