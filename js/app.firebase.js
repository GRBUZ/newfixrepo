// Firebase-only minimal Influencers Wall (no backend functions)
// Replace the firebaseConfig placeholders with your real project config.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import { getDatabase, ref, onValue, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-database.js";


// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAiXV1PPWcPHbfvB5z1GBXl3cYAjXGKCrI",
  authDomain: "mlninf.firebaseapp.com",
  projectId: "mlninf",
  storageBucket: "mlninf.firebasestorage.app",
  messagingSenderId: "988312606751",
  appId: "1:988312606751:web:9acf640a08f06ec39a9d2a",
  measurementId: "G-X72ZRS9K11"
};

// --- Guard: prevent forgetting to configure ---
(function checkConfig(){
  const vals = Object.values(firebaseConfig).join('');
  if (vals.includes('YOUR_')) {
    alert('⚠️ Please edit js/app.firebase.js and fill your Firebase config (apiKey, databaseURL, etc.) before deploying.');
  }
})();

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

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
const fileInput = document.getElementById('file');
const confirmBtn = document.getElementById('confirm');

let artCells = {}; // { idx: { imageUrl, linkUrl, rect } }
let selected = new Set();
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
  const s = artCells[idx];
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
    if (!d.firstChild) { const a = document.createElement('a'); a.className='region-link'; a.target='_blank'; d.appendChild(a); }
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
  const blocksSold = Object.keys(artCells).length;
  const pixelsSold = blocksSold * 100;
  const price = 1 + Math.floor(pixelsSold / 1000) * 0.01;
  priceLine.textContent = `1 pixel = $${price.toFixed(2)}`;
  const left = TOTAL_PIXELS - pixelsSold;
  pixelsLeftEl.textContent = `${left.toLocaleString()} pixels left`;
  buyBtn.disabled = selected.size === 0;
}

// Selection
function clearSelection(){ for (const i of selected) grid.children[i].classList.remove('sel'); selected.clear(); refreshTopbar(); }
function selectRect(aIdx, bIdx) {
  clearSelection();
  const [ar, ac] = idxToRowCol(aIdx);
  const [br, bc] = idxToRowCol(bIdx);
  const r0 = Math.min(ar, br), r1 = Math.max(ar, br);
  const c0 = Math.min(ac, bc), c1 = Math.max(ac, bc);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const idx = rowColToIdx(r,c); if (!artCells[idx]) selected.add(idx); }
  for (const i of selected) grid.children[i].classList.add('sel');
  refreshTopbar();
}
function toggleCell(idx){
  if (artCells[idx]) return;
  const d = grid.children[idx];
  if (selected.has(idx)) { selected.delete(idx); d.classList.remove('sel'); }
  else { selected.add(idx); d.classList.add('sel'); }
  refreshTopbar();
}
function idxFromClientXY(x,y){
  const rect = grid.getBoundingClientRect();
  const gx = Math.floor((x - rect.left) / CELL);
  const gy = Math.floor((y - rect.top) / CELL);
  if (gx < 0 || gy < 0 || gx >= N || gy >= N) return -1;
  return gy * N + gx;
}
grid.addEventListener('mousedown', (e) => {
  const idx = idxFromClientXY(e.clientX, e.clientY); if (idx < 0) return;
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

// Firebase live sync
onValue(ref(db, 'artCells'), (snap) => {
  artCells = snap.val() || {};
  paintAll();
});

// Finalize using transactions per block (prevents double buy)
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const linkUrl = linkInput.value.trim();
  const f = fileInput.files && fileInput.files[0];
  if (!linkUrl || !f) { alert('Provide link and image.'); return; }
  confirmBtn.disabled = true; confirmBtn.textContent = 'Processing…';
  try {
    // Compress image according to selection width
    const cols = Array.from(selected).map(i => i % N);
    const minC = Math.min(...cols), maxC = Math.max(...cols);
    const rectWidthPx = (maxC - minC + 1) * CELL;
    const imageUrl = await compressImage(f, rectWidthPx);
    const rect = { x: minC, y: Math.min(...Array.from(selected).map(i => Math.floor(i / N))), w: (maxC - minC + 1), h: (Math.max(...Array.from(selected).map(i => Math.floor(i / N))) - Math.min(...Array.from(selected).map(i => Math.floor(i / N))) + 1) };

    const blocks = Array.from(selected);
    const results = await Promise.all(blocks.map(async (idx) => {
      const cellRef = ref(db, 'artCells/' + idx);
      return runTransaction(cellRef, (current) => {
        if (current) return current; // already sold -> don't overwrite
        return { imageUrl, linkUrl, rect };
      });
    }));

    const conflicts = [];
    results.forEach((res, i) => { if (!res.committed) conflicts.push(blocks[i]); });

    if (conflicts.length > 0) {
      // Remove conflicts from local selection and inform user
      for (const b of conflicts) { grid.children[b].classList.remove('sel'); selected.delete(b); }
      alert('Some blocks were already taken and have been removed from your selection. You can try again for the remaining ones.');
      return;
    }

    // success
    clearSelection();
    closeModal();
  } catch (err) {
    alert('Finalize failed: ' + (err && err.message ? err.message : err));
  } finally {
    confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm';
  }
});
