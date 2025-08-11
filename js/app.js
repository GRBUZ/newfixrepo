// Minimal Influencers Wall – with client-side image compression + better errors
const N = 100;                 // 100x100
const CELL = 10;               // px
const TOTAL_PIXELS = 1_000_000;

const grid = document.getElementById('grid');
const buyBtn = document.getElementById('buyBtn');
const priceLine = document.getElementById('priceLine');
const pixelsLeftEl = document.getElementById('pixelsLeft');

const modal = document.getElementById('modal');
const form = document.getElementById('form');
const linkInput = document.getElementById('link');
const fileInput = document.getElementById('file');
const confirmBtn = document.getElementById('confirm');

// State
let sold = {};                 // { idx: { imageUrl, linkUrl, rect:{x,y,w,h} } }
let selected = new Set();      // current selection (indices)
let isDragging = false;
let dragStartIdx = -1;

// Build grid
(function build(){
  const frag = document.createDocumentFragment();
  for (let i = 0; i < N*N; i++) {
    const d = document.createElement('div');
    d.className = 'cell';
    d.dataset.idx = i;
    frag.appendChild(d);
  }
  grid.appendChild(frag);
})();

function idxToRowCol(idx){ return [Math.floor(idx / N), idx % N]; }
function rowColToIdx(r,c){ return r*N + c; }

function paintCell(idx) {
  const d = grid.children[idx];
  const s = sold[idx];
  d.classList.toggle('sold', !!s);
  d.classList.toggle('sel', selected.has(idx));
  if (s && s.imageUrl && s.rect) {
    const [r, c] = idxToRowCol(idx);
    const rx = s.rect.x, ry = s.rect.y, rw = s.rect.w, rh = s.rect.h;
    const offX = (c - rx) * CELL, offY = (r - ry) * CELL;
    d.style.backgroundImage = `url(${s.imageUrl})`;
    d.style.backgroundSize = `${rw*CELL}px ${rh*CELL}px`;
    d.style.backgroundPosition = `-${offX}px -${offY}px`;
    d.title = s.linkUrl || '';
    if (!d.firstChild) {
      const a = document.createElement('a');
      a.className = 'region-link';
      a.target = '_blank';
      d.appendChild(a);
    }
    d.firstChild.href = s.linkUrl || '#';
  } else {
    d.style.backgroundImage = '';
    d.style.backgroundSize = '';
    d.style.backgroundPosition = '';
    if (d.firstChild) d.firstChild.remove();
  }
}

function paintAll() {
  for (let i = 0; i < N*N; i++) paintCell(i);
  refreshTopbar();
}

function refreshTopbar() {
  const blocksSold = Object.keys(sold).length;
  const pixelsSold = blocksSold * 100;
  const price = 1 + Math.floor(pixelsSold / 1000) * 0.01;
  priceLine.textContent = `1 pixel = $${price.toFixed(2)}`;
  const left = TOTAL_PIXELS - pixelsSold;
  pixelsLeftEl.textContent = `${left.toLocaleString()} pixels left`;
  buyBtn.disabled = selected.size === 0;
}

// Selection
function clearSelection() { for (const i of selected) grid.children[i].classList.remove('sel'); selected.clear(); refreshTopbar(); }
function selectRect(aIdx, bIdx) {
  clearSelection();
  const [ar, ac] = idxToRowCol(aIdx);
  const [br, bc] = idxToRowCol(bIdx);
  const r0 = Math.min(ar, br), r1 = Math.max(ar, br);
  const c0 = Math.min(ac, bc), c1 = Math.max(ac, bc);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const idx = rowColToIdx(r,c);
    if (!sold[idx]) selected.add(idx);
  }
  for (const i of selected) grid.children[i].classList.add('sel');
  refreshTopbar();
}
function toggleCell(idx) {
  if (sold[idx]) return;
  const d = grid.children[idx];
  if (selected.has(idx)) { selected.delete(idx); d.classList.remove('sel'); }
  else { selected.add(idx); d.classList.add('sel'); }
  refreshTopbar();
}
function idxFromClientXY(x,y) {
  const rect = grid.getBoundingClientRect();
  const gx = Math.floor((x - rect.left) / 10);
  const gy = Math.floor((y - rect.top) / 10);
  if (gx < 0 || gy < 0 || gx >= N || gy >= N) return -1;
  return gy * N + gx;
}
grid.addEventListener('mousedown', (e) => {
  const idx = idxFromClientXY(e.clientX, e.clientY);
  if (idx < 0) return;
  isDragging = true; dragStartIdx = idx; selectRect(idx, idx); e.preventDefault();
});
window.addEventListener('mousemove', (e) => { if (!isDragging) return; const idx = idxFromClientXY(e.clientX, e.clientY); if (idx >= 0) selectRect(dragStartIdx, idx); });
window.addEventListener('mouseup', () => { isDragging = false; dragStartIdx = -1; });
grid.addEventListener('click', (e) => { if (isDragging) return; const idx = idxFromClientXY(e.clientX, e.clientY); if (idx >= 0) toggleCell(idx); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); clearSelection(); } });

// Modal
function openModal(){ modal.classList.remove('hidden'); }
function closeModal(){ modal.classList.add('hidden'); }
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => { closeModal(); clearSelection(); }));
buyBtn.addEventListener('click', () => { if (selected.size) openModal(); });

// Helpers
function fileToDataURL(file) { return new Promise((resolve,reject)=>{ const fr=new FileReader(); fr.onload=()=>resolve(fr.result); fr.onerror=reject; fr.readAsDataURL(file); }); }
function loadImage(src) { return new Promise((resolve,reject)=>{ const img=new Image(); img.onload=()=>resolve(img); img.onerror=reject; img.src=src; }); }
async function compressImage(file, targetW) {
  const data = await fileToDataURL(file);
  const img = await loadImage(data);
  const maxW = Math.max(80, Math.min(targetW, 600));
  const scale = Math.min(1, maxW / img.width);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.8);
}

// Finalize
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const linkUrl = linkInput.value.trim();
  const f = fileInput.files && fileInput.files[0];
  if (!linkUrl || !f) { alert('Provide link and image.'); return; }
  confirmBtn.disabled = true; confirmBtn.textContent = 'Processing…';
  try {
    // Set target width based on selection width in pixels (cap at 600)
    const cols = Array.from(selected).map(i => i % N);
    const minC = Math.min(...cols), maxC = Math.max(...cols);
    const rectWidthPx = (maxC - minC + 1) * CELL;
    const imageUrl = await compressImage(f, rectWidthPx);

    // Safety: bail out if still too large (> 800 KB)
    const approxBytes = Math.round(imageUrl.length * 0.75);
    if (approxBytes > 800 * 1024) { alert('Image too large after optimization. Please choose a smaller image.'); return; }

    const blocks = Array.from(selected);
    const r = await fetch('/.netlify/functions/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageUrl, linkUrl, blocks })
    });
    const text = await r.text();
    let res = {};
    try { res = JSON.parse(text); } catch { res = { ok:false, error:'INVALID_JSON', raw:text }; }

    if (r.status === 409 && res.taken && Array.isArray(res.taken)) {
      for (const b of res.taken) { const el = grid.children[b]; el.classList.remove('sel'); selected.delete(b); }
      alert('Some blocks were already taken. They were removed from your selection. Please try again.');
      refreshTopbar();
      return;
    }
    if (!r.ok || !res.ok) throw new Error(res.error || ('HTTP '+r.status+' '+text));

    sold = res.artCells || sold;
    clearSelection();
    paintAll();
    closeModal();
  } catch (err) {
    alert('Finalize failed: ' + (err && err.message ? err.message : err));
  } finally {
    confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm';
  }
});

// Status polling
async function loadStatus(){
  try {
    const r = await fetch('/.netlify/functions/status', { cache: 'no-store' });
    const s = await r.json();
    if (s && s.ok && s.artCells) sold = s.artCells;
  } catch (e) {}
}

(async function init(){
  await loadStatus();
  paintAll();
  setInterval(async () => { await loadStatus(); paintAll(); }, 3000);
})();