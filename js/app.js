// No-holes selection patch
// - Prevents selecting rectangles that include sold/reserved cells
// - On reserve(), if any conflicts, the whole selection is rejected
// - Keeps: drag suppression, modal summary, formatting, email field

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
let blockedDuringDrag = false; // true if current rectangle crosses a sold/reserved cell

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

  // image overlay if present
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

// Rectangle selection that rejects any area containing blocked cells
function selectRect(aIdx,bIdx){
  const [ar,ac]=idxToRowCol(aIdx), [br,bc]=idxToRowCol(bIdx);
  const r0=Math.min(ar,br), r1=Math.max(ar,br), c0=Math.min(ac,bc), c1=Math.max(ac,bc);

  // First pass: detect any blocked cell inside rect
  blockedDuringDrag = false;
  for(let r=r0;r<=r1;r++){
    for(let c=c0;c<=c1;c++){
      const idx=rowColToIdx(r,c);
      if (isBlockedCell(idx)) { blockedDuringDrag = true; break; }
    }
    if (blockedDuringDrag) break;
  }

  if (blockedDuringDrag){
    // Reject the whole rectangle (no partials)
    clearSelection();
    refreshTopbar();
    return;
  }

  // Accept the rectangle → build selection
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
  if (isDragging && blockedDuringDrag){
    alert('Your rectangle includes blocks that are already SOLD or RESERVED. Please select a free area.');
  }
  if (isDragging){ suppressNextClick=movedDuringDrag; }
  isDragging=false; dragStartIdx=-1; movedDuringDrag=false; lastDragIdx=-1; blockedDuringDrag=false;
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
    // Reject if any conflict or partial locking (no-holes policy)
    if ((got.conflicts && got.conflicts.length>0) || (got.locked && got.locked.length !== want.length)){
      clearSelection();
      paintAll();
      alert('Some blocks in your selection are SOLD or RESERVED. Please pick a free rectangle.');
      return;
    }
    // All good → mark selection from server-locked set (should match want)
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
  if(!linkUrl || !name || !email){ alert('Please fill Pseudo, Email and Profile URL.'); return; }
  confirmBtn.disabled=true; confirmBtn.textContent='Processing…';
  try{
    const blocks = Array.from(selected);
    const r = await fetch('/.netlify/functions/finalize', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ uid, blocks, linkUrl, name, email })
    });
    const res = await r.json();
    if (r.status===409 && res.taken){
      clearSelection(); paintAll();
      alert('Some blocks were taken meanwhile. Please reselect.');
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
