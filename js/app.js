// Basic Influencers Wall (no images).
// On confirm, store { name, linkUrl } for selected blocks; grid shows them as SOLD (grey).

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
const nameInput = document.getElementById('name');
const confirmBtn = document.getElementById('confirm');

// State
let sold = {};                 // { idx: { linkUrl, name } }
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
  if (s) {
    d.title = (s.name ? s.name + ' · ' : '') + (s.linkUrl || '');
    if (!d.firstChild) {
      const a = document.createElement('a');
      a.className = 'region-link';
      a.target = '_blank';
      d.appendChild(a);
    }
    d.firstChild.href = s.linkUrl || '#';
  } else {
    d.title = '';
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
function clearSelection() {
  for (const i of selected) {
    const d = grid.children[i];
    d.classList.remove('sel');
  }
  selected.clear();
  refreshTopbar();
}

function selectRect(aIdx, bIdx) {
  clearSelection();
  const [ar, ac] = idxToRowCol(aIdx);
  const [br, bc] = idxToRowCol(bIdx);
  const r0 = Math.min(ar, br), r1 = Math.max(ar, br);
  const c0 = Math.min(ac, bc), c1 = Math.max(ac, bc);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const idx = rowColToIdx(r,c);
      if (!sold[idx]) selected.add(idx);
    }
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

// Pointer math
function idxFromClientXY(x,y) {
  const rect = grid.getBoundingClientRect();
  const gx = Math.floor((x - rect.left) / 10);
  const gy = Math.floor((y - rect.top) / 10);
  if (gx < 0 || gy < 0 || gx >= N || gy >= N) return -1;
  return gy * N + gx;
}

// Delegated events
grid.addEventListener('mousedown', (e) => {
  const idx = idxFromClientXY(e.clientX, e.clientY);
  if (idx < 0) return;
  isDragging = true;
  dragStartIdx = idx;
  selectRect(idx, idx);
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const idx = idxFromClientXY(e.clientX, e.clientY);
  if (idx < 0) return;
  selectRect(dragStartIdx, idx);
});
window.addEventListener('mouseup', () => { isDragging = false; dragStartIdx = -1; });

// Click toggle (unit selection)
grid.addEventListener('click', (e) => {
  if (isDragging) return;
  const idx = idxFromClientXY(e.clientX, e.clientY);
  if (idx < 0) return;
  toggleCell(idx);
});

// ESC clears
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    clearSelection();
  }
});

// Modal open/close
function openModal(){ modal.classList.remove('hidden'); }
function closeModal(){ modal.classList.add('hidden'); }

document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => {
  closeModal();
  clearSelection();
}));

buyBtn.addEventListener('click', () => {
  if (selected.size === 0) return;
  openModal();
});

// Finalize (no images)
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const linkUrl = linkInput.value.trim();
  const name = nameInput.value.trim();
  if (!linkUrl || !name) { alert('Provide display name and profile URL.'); return; }
  confirmBtn.disabled = true; confirmBtn.textContent = 'Processing…';
  try {
    const blocks = Array.from(selected);
    const r = await fetch('/.netlify/functions/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ linkUrl, name, blocks })
    });
    const res = await r.json();
    if (r.status === 409 && res.taken && Array.isArray(res.taken)) {
      for (const b of res.taken) {
        const el = grid.children[b];
        el.classList.remove('sel');
        selected.delete(b);
      }
      alert('Some blocks were already taken and were removed from your selection. Please try again.');
      refreshTopbar();
      return;
    }
    if (!r.ok || !res.ok) throw new Error(res.error || ('HTTP '+r.status));
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

// Status polling (light)
async function loadStatus(){
  try {
    const r = await fetch('/.netlify/functions/status', { cache: 'no-store' });
    const s = await r.json();
    if (s && s.ok && s.artCells) sold = s.artCells;
  } catch {}
}

(async function init(){
  await loadStatus();
  paintAll();
  setInterval(async () => { await loadStatus(); paintAll(); }, 3000);
})();