// Influencers Wall — merged app.js
// - Fixes the "lost cell after drag" by suppressing stray click
// - Keeps full dynamic flow: reserve (on Buy), unlock (on Cancel/ESC), finalize (on Confirm)
// - Uses GitHub-backed functions: /status, /reserve, /unlock, /finalize

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
const confirmBtn = document.getElementById('confirm');

// Stable client id
const uid = (() => {
  const k='iw_uid'; let v=localStorage.getItem(k);
  if (!v) { v=(crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)); localStorage.setItem(k,v); }
  return v;
})();

// State
let sold = {};     // { idx: { name, linkUrl, ts } }
let locks = {};    // { idx: { uid, until } }
let selected = new Set();

// Drag / click state + suppression of post-drag click
let isDragging = false;
let dragStartIdx = -1;
let movedDuringDrag = false;
let lastDragIdx = -1;
let suppressNextClick = false;

// ---------- Build grid ----------
(function build(){
  const frag = document.createDocumentFragment();
  for (let i=0;i<N*N;i++){
    const d=document.createElement('div');
    d.className='cell';
    d.dataset.idx=i;
    frag.appendChild(d);
  }
  grid.appendChild(frag);
})();

// ---------- Helpers ----------
function idxToRowCol(idx){ return [Math.floor(idx/N), idx%N]; }
function rowColToIdx(r,c){ return r*N + c; }

function paintCell(idx){
  const d=grid.children[idx];
  const s=sold[idx];
  const l=locks[idx];
  const reserved = l && l.until > Date.now() && !s;
  const reservedByOther = reserved && l.uid !== uid;

  d.classList.toggle('sold', !!s);
  d.classList.toggle('pending', !!reservedByOther);
  d.classList.toggle('sel', selected.has(idx));

  if (s){
    d.title = (s.name ? s.name + ' · ' : '') + (s.linkUrl || '');
    if (!d.firstChild) { const a=document.createElement('a'); a.className='region-link'; a.target='_blank'; d.appendChild(a); }
    d.firstChild.href = s.linkUrl || '#';
  } else {
    d.title='';
    if (d.firstChild) d.firstChild.remove();
  }
}
function paintAll(){ for(let i=0;i<N*N;i++) paintCell(i); refreshTopbar(); }

function refreshTopbar(){
  const blocksSold = Object.keys(sold).length;
  const pixelsSold = blocksSold * 100;
  const price = 1 + Math.floor(pixelsSold/1000)*0.01;
  priceLine.textContent = `1 pixel = $${price.toFixed(2)}`;
  pixelsLeftEl.textContent = `${(TOTAL_PIXELS - pixelsSold).toLocaleString()} pixels left`;
  buyBtn.disabled = selected.size === 0;
}

function clearSelection(){
  for(const i of selected) grid.children[i].classList.remove('sel');
  selected.clear();
  refreshTopbar();
}

// ---------- Selection ----------
function selectRect(aIdx, bIdx){
  clearSelection();
  const [ar,ac]=idxToRowCol(aIdx), [br,bc]=idxToRowCol(bIdx);
  const r0=Math.min(ar,br), r1=Math.max(ar,br), c0=Math.min(ac,bc), c1=Math.max(ac,bc);
  for(let r=r0;r<=r1;r++) for(let c=c0;c<=c1;c++){
    const idx=rowColToIdx(r,c);
    if (sold[idx]) continue;
    const l=locks[idx]; const reservedByOther = l && l.until > Date.now() && l.uid !== uid;
    if (!reservedByOther) selected.add(idx);
  }
  for(const i of selected) grid.children[i].classList.add('sel');
  refreshTopbar();
}

function toggleCell(idx){
  if (sold[idx]) return;
  const l=locks[idx]; const reservedByOther = l && l.until > Date.now() && l.uid !== uid;
  if (reservedByOther) return;
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

// ---------- Pointer handlers with click suppression ----------
grid.addEventListener('mousedown', (e)=>{
  const idx=idxFromClientXY(e.clientX,e.clientY); if(idx<0) return;
  isDragging = true; dragStartIdx = idx; lastDragIdx = idx;
  movedDuringDrag = false; suppressNextClick = false;
  selectRect(idx, idx);
  e.preventDefault();
});
window.addEventListener('mousemove', (e)=>{
  if(!isDragging) return;
  const idx=idxFromClientXY(e.clientX,e.clientY); if(idx<0) return;
  if (idx !== lastDragIdx){ movedDuringDrag = true; lastDragIdx = idx; }
  selectRect(dragStartIdx, idx);
});
window.addEventListener('mouseup', ()=>{
  if (isDragging){ suppressNextClick = movedDuringDrag; }
  isDragging=false; dragStartIdx=-1; movedDuringDrag=false; lastDragIdx=-1;
});
grid.addEventListener('click', (e)=>{
  if (suppressNextClick){ suppressNextClick=false; return; }
  if (isDragging) return;
  const idx=idxFromClientXY(e.clientX,e.clientY); if(idx<0) return;
  toggleCell(idx);
});

// ---------- Modal open/close ----------
function openModal(){ modal.classList.remove('hidden'); }
function closeModal(){ modal.classList.add('hidden'); }

document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', async () => {
  if (selected.size){ try { await unlock(Array.from(selected)); } catch {} }
  closeModal(); clearSelection();
}));

window.addEventListener('keydown', async (e)=>{
  if (e.key === 'Escape') {
    if (!modal.classList.contains('hidden') && selected.size){
      try { await unlock(Array.from(selected)); } catch {}
    }
    closeModal(); clearSelection();
  }
});

// ---------- Buy flow ----------
buyBtn.addEventListener('click', async () => {
  if (!selected.size) return;
  // Reserve server-side (one call, fewer commits)
  const want = Array.from(selected);
  try {
    const got = await reserve(want);
    clearSelection();
    for (const i of got.locked) { selected.add(i); grid.children[i].classList.add('sel'); }
    if (selected.size === 0) {
      alert('These blocks were just reserved or sold by someone else. Please pick another area.');
      return;
    }
    openModal();
  } catch (e) {
    alert('Reservation failed: ' + (e?.message || e));
  }
});

// ---------- Confirm ----------
form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const linkUrl = linkInput.value.trim();
  const name    = nameInput.value.trim();
  if (!linkUrl || !name) { alert('Provide display name and profile URL.'); return; }
  confirmBtn.disabled = true; confirmBtn.textContent = 'Processing…';
  try{
    const blocks = Array.from(selected);
    const r = await fetch('/.netlify/functions/finalize', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ uid, blocks, linkUrl, name })
    });
    const res = await r.json();
    if (r.status === 409 && res.taken) {
      for (const b of res.taken) { grid.children[b].classList.remove('sel'); selected.delete(b); }
      alert('Some blocks were taken. They were removed from your selection.');
      refreshTopbar();
      return;
    }
    if (!r.ok || !res.ok) throw new Error(res.error || ('HTTP '+r.status));
    sold = res.soldMap || sold;
    // cleanup any leftover locks
    try { await unlock(blocks); } catch {}
    clearSelection(); paintAll(); closeModal();
  } catch (err) {
    alert('Finalize failed: ' + (err?.message || err));
  } finally {
    confirmBtn.disabled=false; confirmBtn.textContent='Confirm';
  }
});

// ---------- Server calls ----------
async function reserve(indices){
  const r = await fetch('/.netlify/functions/reserve', {
    method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ uid, blocks: indices })
  });
  const res = await r.json();
  if (!r.ok || !res.ok) throw new Error(res.error || ('HTTP '+r.status));
  locks = res.locks || locks; paintAll();
  return res;
}
async function unlock(indices){
  const r = await fetch('/.netlify/functions/unlock', {
    method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ uid, blocks: indices })
  });
  const res = await r.json();
  if (!r.ok || !res.ok) throw new Error(res.error || ('HTTP '+r.status));
  locks = res.locks || locks; paintAll();
  return res;
}

// ---------- Status polling ----------
async function loadStatus(){
  try {
    const r = await fetch('/.netlify/functions/status', { cache:'no-store' });
    const s = await r.json();
    if (s && s.ok) { sold = s.sold || {}; locks = s.locks || {}; }
  } catch {}
}
(async function init(){
  await loadStatus();
  paintAll();
  setInterval(async()=>{ await loadStatus(); paintAll(); }, 2500);
})();
