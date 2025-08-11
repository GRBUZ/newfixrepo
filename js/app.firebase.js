// Firebase Influencers Wall – with RESERVATIONS (locks) + anti-overwrite
// Requires: Realtime Database + Anonymous Auth enabled
// Steps in console:
//   - Enable Anonymous sign-in (Build → Authentication → Sign-in method → Anonymous: ON)
//   - Realtime Database → Rules: paste FIREBASE_RULES.json from this patch
//   - Fill your firebaseConfig below

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import {
  getDatabase, ref, onValue, runTransaction, onDisconnect, remove, set, update
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAiXV1PPWcPHbfvB5z1GBXl3cYAjXGKCrI",
  authDomain: "mlninf.firebaseapp.com",
  projectId: "mlninf",
  storageBucket: "mlninf.firebasestorage.app",
  messagingSenderId: "988312606751",
  appId: "1:988312606751:web:9acf640a08f06ec39a9d2a",
  measurementId: "G-X72ZRS9K11"
};
(function checkConfig(){
  const vals = Object.values(firebaseConfig).join('');
  if (vals.includes('YOUR_')) {
    alert('⚠️ Edit js/app.firebase.js and fill your Firebase config (including databaseURL).');
  }
})();

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db  = getDatabase(app);

const N = 100, CELL = 10, TOTAL_PIXELS = 1_000_000;
const LOCK_TTL_MS = 3 * 60 * 1000;       // 3 minutes
const LOCK_KEEPALIVE_MS = 60 * 1000;     // extend every minute

const grid = document.getElementById('grid');
const buyBtn = document.getElementById('buyBtn');
const priceLine = document.getElementById('priceLine');
const pixelsLeftEl = document.getElementById('pixelsLeft');
const modal = document.getElementById('modal');
const form = document.getElementById('form');
const linkInput = document.getElementById('link');
const fileInput = document.getElementById('file');
const confirmBtn = document.getElementById('confirm');

let myUid = null;
let artCells = {};         // sold cells: { idx: { imageUrl, linkUrl, rect, uid } }
let locks = {};            // live locks: { idx: { uid, until } }
let mySelected = new Set();
let myLocked = new Set();  // the blocks I currently hold a lock on
let isDragging = false;
let dragStartIdx = -1;

/* ---------- UI helpers ---------- */
function idxToRowCol(idx){ return [Math.floor(idx / N), idx % N]; }
function rowColToIdx(r,c){ return r*N + c; }
function paintCell(idx) {
  const d = grid.children[idx];
  const sold = !!artCells[idx];
  const locked = locks[idx] && locks[idx].until > Date.now();
  const mine = locked && locks[idx].uid === myUid;

  d.classList.toggle('sold', sold);
  d.classList.toggle('pending', locked && !mine && !sold);
  d.classList.toggle('sel', mySelected.has(idx));

  if (sold && artCells[idx].imageUrl && artCells[idx].rect) {
    const [r, c] = idxToRowCol(idx);
    const rect = artCells[idx].rect;
    const offX = (c - rect.x) * CELL, offY = (r - rect.y) * CELL;
    d.style.backgroundImage = `url(${artCells[idx].imageUrl})`;
    d.style.backgroundSize = `${rect.w*CELL}px ${rect.h*CELL}px`;
    d.style.backgroundPosition = `-${offX}px -${offY}px`;
    d.title = artCells[idx].linkUrl || '';
    if (!d.firstChild) { const a=document.createElement('a'); a.className='region-link'; a.target='_blank'; d.appendChild(a); }
    d.firstChild.href = artCells[idx].linkUrl || '#';
  } else {
    d.style.backgroundImage = '';
    d.style.backgroundSize = '';
    d.style.backgroundPosition = '';
    if (d.firstChild) d.firstChild.remove();
  }
}
function paintAll(){ for (let i=0;i<N*N;i++) paintCell(i); refreshTopbar(); }

function refreshTopbar(){
  const blocksSold = Object.keys(artCells).length;
  const pixelsSold = blocksSold * 100;
  const price = 1 + Math.floor(pixelsSold / 1000) * 0.01;
  priceLine.textContent = `1 pixel = $${price.toFixed(2)}`;
  const left = TOTAL_PIXELS - pixelsSold;
  pixelsLeftEl.textContent = `${left.toLocaleString()} pixels left`;
  buyBtn.disabled = mySelected.size === 0;
}

/* ---------- Build grid ---------- */
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

/* ---------- Data listeners ---------- */
onValue(ref(db, 'artCells'), (snap) => { artCells = snap.val() || {}; paintAll(); });
onValue(ref(db, 'locks'), (snap) => {
  locks = snap.val() || {};
  paintAll();
});

/* ---------- Selection & locking ---------- */
function clearSelection(){
  for (const i of mySelected) grid.children[i].classList.remove('sel');
  mySelected.clear();
  refreshTopbar();
}

async function tryLock(idx){
  // Transaction to acquire/refresh lock if free/expired OR owned by me
  const lockRef = ref(db, 'locks/'+idx);
  const now = Date.now();
  const until = now + LOCK_TTL_MS + 30000; // +30s fudge vs server time
  const res = await runTransaction(lockRef, (current) => {
    if (!current || current.until < now) {
      return { uid: myUid, until };
    }
    if (current.uid === myUid) {
      return { uid: myUid, until }; // refresh/extend
    }
    return; // someone else holds it
  }, { applyLocally: true });
  if (res.committed && res.snapshot && res.snapshot.val() && res.snapshot.val().uid === myUid) {
    myLocked.add(idx);
    try { await onDisconnect(lockRef).remove(); } catch {}
    return true;
  }
  return false;
}

async function lockRect(aIdx, bIdx){
  const [ar, ac] = idxToRowCol(aIdx);
  const [br, bc] = idxToRowCol(bIdx);
  const r0 = Math.min(ar, br), r1 = Math.max(ar, br);
  const c0 = Math.min(ac, bc), c1 = Math.max(ac, bc);

  // clear UI selection first
  clearSelection();
  const acquired = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const idx = rowColToIdx(r,c);
    if (artCells[idx]) continue; // already sold
    const l = locks[idx];
    const lockedByOther = l && l.until > Date.now() && l.uid !== myUid;
    if (lockedByOther) continue;
    const ok = await tryLock(idx);
    if (ok) {
      mySelected.add(idx);
      grid.children[idx].classList.add('sel');
      acquired.push(idx);
    }
  }
  if (!acquired.length) {
    // Nothing locked
  }
  refreshTopbar();
}

async function toggleOne(idx){
  if (artCells[idx]) return;
  const l = locks[idx];
  const lockedByOther = l && l.until > Date.now() && l.uid !== myUid;
  if (lockedByOther) return;
  if (mySelected.has(idx)) {
    // deselect -> release my lock
    mySelected.delete(idx);
    grid.children[idx].classList.remove('sel');
    await releaseLock(idx);
  } else {
    const ok = await tryLock(idx);
    if (ok) {
      mySelected.add(idx);
      grid.children[idx].classList.add('sel');
    }
  }
  refreshTopbar();
}

async function releaseLock(idx){
  const l = locks[idx];
  if (l && l.uid === myUid) {
    try { await remove(ref(db, 'locks/'+idx)); } catch {}
  }
  myLocked.delete(idx);
}

async function releaseAll(){
  const tasks = [];
  for (const idx of Array.from(myLocked)) tasks.push(releaseLock(idx));
  await Promise.allSettled(tasks);
  myLocked.clear();
  clearSelection();
}

/* ---------- Pointer wiring ---------- */
function idxFromClientXY(x,y){
  const rect = grid.getBoundingClientRect();
  const gx = Math.floor((x - rect.left) / CELL);
  const gy = Math.floor((y - rect.top) / CELL);
  if (gx < 0 || gy < 0 || gx >= N || gy >= N) return -1;
  return gy * N + gx;
}
grid.addEventListener('mousedown', async (e) => {
  const idx = idxFromClientXY(e.clientX, e.clientY);
  if (idx < 0) return;
  isDragging = true; dragStartIdx = idx;
  await lockRect(idx, idx);
  e.preventDefault();
});
window.addEventListener('mousemove', async (e) => {
  if (!isDragging) return;
  const idx = idxFromClientXY(e.clientX, e.clientY);
  if (idx < 0) return;
  await lockRect(dragStartIdx, idx);
});
window.addEventListener('mouseup', () => { isDragging = false; dragStartIdx = -1; });
grid.addEventListener('click', async (e) => {
  if (isDragging) return;
  const idx = idxFromClientXY(e.clientX, e.clientY);
  if (idx < 0) return;
  await toggleOne(idx);
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); releaseAll(); }});

/* ---------- Modal ---------- */
function openModal(){ modal.classList.remove('hidden'); }
function closeModal(){ modal.classList.add('hidden'); }
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => { closeModal(); releaseAll(); }));
buyBtn.addEventListener('click', () => { if (mySelected.size) openModal(); });

/* ---------- Image helpers ---------- */
function fileToDataURL(file) { return new Promise((resolve,reject)=>{ const fr=new FileReader(); fr.onload=()=>resolve(fr.result); fr.onerror=reject; fr.readAsDataURL(file); }); }
function loadImage(src) { return new Promise((resolve,reject)=>{ const img=new Image(); img.onload=()=>resolve(img); img.onerror=reject; img.src=src; }); }
async function compressImage(file, targetW) {
  const data = await fileToDataURL(file);
  const img = await loadImage(data);
  const maxW = Math.max(80, Math.min(targetW, 600));
  const scale = Math.min(1, maxW / img.width);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.8);
}

/* ---------- Finalize (writes only if I hold valid locks) ---------- */
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const linkUrl = linkInput.value.trim();
  const f = fileInput.files && fileInput.files[0];
  if (!linkUrl || !f) { alert('Provide link and image.'); return; }
  confirmBtn.disabled = true; confirmBtn.textContent = 'Processing…';
  try {
    const cols = Array.from(mySelected).map(i => i % N);
    const rows = Array.from(mySelected).map(i => Math.floor(i / N));
    const minC = Math.min(...cols), maxC = Math.max(...cols);
    const minR = Math.min(...rows), maxR = Math.max(...rows);
    const rectWidthPx = (maxC - minC + 1) * CELL;
    const imageUrl = await compressImage(f, rectWidthPx);
    const rect = { x: minC, y: minR, w: (maxC - minC + 1), h: (maxR - minR + 1) };

    const targets = Array.from(mySelected);
    const results = await Promise.all(targets.map(async (idx) => {
      // Transaction on artCells: only create if empty; rules also require my valid lock
      const cellRef = ref(db, 'artCells/' + idx);
      return runTransaction(cellRef, (current) => {
        if (current) return current; // already sold
        return { imageUrl, linkUrl, rect, uid: myUid };
      });
    }));

    // Collect conflicts (not committed)
    const conflicts = [];
    results.forEach((r, i) => { if (!r.committed) conflicts.push(targets[i]); });

    if (conflicts.length) {
      // Remove conflicted from selection
      for (const b of conflicts) { grid.children[b].classList.remove('sel'); mySelected.delete(b); }
      alert('Some blocks were already taken (or your lock expired). They were removed from your selection.');
      refreshTopbar();
      return;
    }

    // Success: drop my locks for those blocks
    await Promise.allSettled(targets.map((idx) => remove(ref(db, 'locks/'+idx))));
    for (const idx of targets) myLocked.delete(idx);
    mySelected.clear();
    closeModal();
  } catch (err) {
    alert('Finalize failed: ' + (err?.message || err));
  } finally {
    confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm';
  }
});

/* ---------- Keepalive & cleanup ---------- */
setInterval(async () => {
  if (!myUid || myLocked.size === 0) return;
  const now = Date.now();
  const until = now + LOCK_TTL_MS + 30000;
  const tasks = [];
  for (const idx of myLocked) tasks.push(update(ref(db, 'locks/'+idx), { uid: myUid, until }));
  await Promise.allSettled(tasks);
}, LOCK_KEEPALIVE_MS);

window.addEventListener('pagehide', () => { releaseAll(); });

/* ---------- Auth bootstrap ---------- */
onAuthStateChanged(auth, (user) => {
  if (user) { myUid = user.uid; }
});
signInAnonymously(auth).catch(console.error);
