// Minimal 100x100 grid with drag selection + simple finalize (no locks)
const grid = document.getElementById('grid');
const buyBtn = document.getElementById('buyBtn');
const modal = document.getElementById('modal');
const form = document.getElementById('form');
const linkInput = document.getElementById('link');
const fileInput = document.getElementById('file');
const confirmBtn = document.getElementById('confirm');

const N = 100;
const cells = [];
let sold = {};            // { index: { imageUrl, linkUrl, soldAt } }
let selected = new Set();
let isDragging = false;
let startIdx = -1;

function idxFromEvent(e) {
  const el = e.target.closest('.cell');
  return el ? +el.dataset.idx : -1;
}

function buildGrid() {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < N*N; i++) {
    const d = document.createElement('div');
    d.className = 'cell';
    d.dataset.idx = i;
    d.addEventListener('mousedown', onDown);
    d.addEventListener('mouseover', onOver);
    cells.push(d);
    frag.appendChild(d);
  }
  grid.appendChild(frag);
  document.addEventListener('mouseup', onUp);
}

function paint() {
  for (let i = 0; i < cells.length; i++) {
    const d = cells[i];
    d.classList.toggle('sold', !!sold[i]);
    d.classList.toggle('sel', selected.has(i));
    // Background thumbnail if sold
    if (sold[i] && sold[i].imageUrl) {
      d.style.backgroundImage = `url(${sold[i].imageUrl})`;
      d.style.backgroundSize = 'cover';
      d.style.backgroundPosition = 'center';
    } else {
      d.style.backgroundImage = '';
      d.style.backgroundSize = '';
      d.style.backgroundPosition = '';
    }
  }
  buyBtn.disabled = selected.size === 0;
}

function rectSelect(aIdx, bIdx) {
  selected.clear();
  const aR = Math.floor(aIdx / N), aC = aIdx % N;
  const bR = Math.floor(bIdx / N), bC = bIdx % N;
  const r0 = Math.min(aR, bR), r1 = Math.max(aR, bR);
  const c0 = Math.min(aC, bC), c1 = Math.max(aC, bC);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const idx = r*N+c;
      if (!sold[idx]) selected.add(idx);
    }
  }
  paint();
}

function onDown(e) {
  const idx = idxFromEvent(e);
  if (idx < 0) return;
  isDragging = true;
  startIdx = idx;
  rectSelect(startIdx, idx);
  e.preventDefault();
}
function onOver(e) {
  if (!isDragging) return;
  const idx = idxFromEvent(e);
  if (idx < 0) return;
  rectSelect(startIdx, idx);
}
function onUp() { isDragging = false; startIdx = -1; }

function openModal(){ modal.classList.remove('hidden'); }
function closeModal(){ modal.classList.add('hidden'); }

buyBtn.addEventListener('click', () => {
  if (selected.size === 0) return;
  openModal();
});
modal.addEventListener('click', (e) => { if (e.target.matches('[data-close]')) closeModal(); });

async function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const linkUrl = linkInput.value.trim();
  const f = fileInput.files && fileInput.files[0];
  if (!linkUrl || !f) { alert('Provide link and image.'); return; }
  confirmBtn.disabled = true; confirmBtn.textContent = 'Processing…';
  try {
    const imageUrl = await fileToDataURL(f);
    const blocks = Array.from(selected);
    const r = await fetch('/.netlify/functions/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageUrl, linkUrl, blocks })
    });
    const res = await r.json();
    if (!r.ok || !res.ok) throw new Error(res.error || ('HTTP '+r.status));
    // Update local sold
    sold = res.artCells || sold;
    selected.clear();
    paint();
    closeModal();
  } catch (err) {
    alert('Finalize failed: ' + (err && err.message ? err.message : err));
  } finally {
    confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm';
  }
});

async function loadStatus(){
  try {
    const r = await fetch('/.netlify/functions/status', { cache: 'no-store' });
    const s = await r.json();
    sold = s.artCells || {};
  } catch {}
}

(async function init(){
  buildGrid();
  await loadStatus();
  paint();
})();