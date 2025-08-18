/* ===== GLOBAL STATE ===== */
const UID = (() => {
  const k = 'iw_uid';
  let v = localStorage.getItem(k);
  if (!v) {
    v = crypto?.randomUUID?.() || ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
    localStorage.setItem(k, v);
  }
  return v;
})();

const N = 100, TOTAL_PIXELS = 1_000_000;

const state = {
  sold: {},          // idx → {imageUrl, linkUrl, name, rect}
  locks: {},       // idx → {uid, until}
  selected: new Set(),
  lastFetch: 0,
};

/* ===== UTILS ===== */
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const fmtInt = n => n.toLocaleString('fr');
const fmtMoney = n => n.toLocaleString('fr', { style:'currency', currency:'USD' });

/* ===== DOM CACHE ===== */
const grid      = $('#grid');
const buyBtn    = $('#buyBtn');
const priceLine = $('#priceLine');
const pixelsLeft= $('#pixelsLeft');
const modal     = $('#modal');
const form      = $('#form');
const modalStats= $('#modalStats');

/* ===== GRID INITIALISATION ===== */
(function buildGrid() {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < N * N; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.idx = i;
    frag.appendChild(cell);
  }
  grid.appendChild(frag);
})();

/* ===== RENDER ===== */
const render = (() => {
  let last = { sold: {}, locks: {}, selected: new Set() };
  return () => {
    const now = Date.now();
    for (let i = 0; i < N * N; i++) {
      const c = grid.children[i];
      const sold = state.sold[i];
      const lock = state.locks[i];
      const selected = state.selected.has(i);

      // sold
      if (sold !== last.sold[i]) {
        c.classList.toggle('sold', !!sold);
        if (sold?.imageUrl) {
          c.style.backgroundImage = `url(${sold.imageUrl})`;
          c.style.backgroundSize = `${sold.rect.w*10}px ${sold.rect.h*10}px`;
        } else {
          c.style.backgroundImage = '';
        }
      }

      // lock
      if (lock !== last.locks[i]) {
        const isOther = lock && lock.uid !== UID && lock.until > now;
        c.classList.toggle('pending', isOther);
      }

      // selected
      if (selected !== last.selected.has(i)) c.classList.toggle('sel', selected);
    }
    last = { ...state, selected: new Set(state.selected) };
  };
})();

/* ===== PRICE BAR ===== */
function refreshTopbar() {
  const pxSold = Object.keys(state.sold).length * 100;
  const price  = 1 + Math.floor(pxSold / 1000) * 0.01;
  priceLine.textContent = `1 pixel = ${fmtMoney(price)}`;
  pixelsLeft.textContent = `${TOTAL_PIXELS.toLocaleString()} pixels`;

  const selPx = state.selected.size * 100;
  buyBtn.disabled = !selPx;
  buyBtn.textContent = selPx ? `Buy — ${fmtInt(selPx)} px (${fmtMoney(selPx * price)})` : `Buy pixels`;
}

/* ===== SELECTION LOGIC ===== */
let drag = { start: -1, last: -1, active: false };

function idxFromXY(x, y) {
  const { left, top } = grid.getBoundingClientRect();
  const w = grid.clientWidth / N;
  const h = grid.clientHeight / N;
  const cx = Math.floor((x - left) / w);
  const cy = Math.floor((y - top) / h);
  return (cx < 0 || cy < 0 || cx >= N || cy >= N) ? -1 : cy * N + cx;
}

function selectRect(a, b) {
  const [r0, r1] = [Math.floor(a / N), Math.floor(b / N)].sort((a, b) => a - b);
  const [c0, c1] = [a % N, b % N].sort((a, b) => a - b);
  const blocked = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const idx = r * N + c;
      if (state.sold[idx] || (state.locks[idx] && state.locks[idx].until > Date.now())) blocked.push(idx);
    }
  }
  state.selected.clear();
  if (blocked.length) return false;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) state.selected.add(r * N + c);
  refreshTopbar();
  return true;
}

grid.addEventListener('mousedown', e => {
  const idx = idxFromXY(e.clientX, e.clientY);
  if (idx < 0) return;
  drag = { start: idx, last: idx, active: true };
  selectRect(idx, idx);
});
window.addEventListener('mousemove', e => {
  if (!drag.active) return;
  const idx = idxFromXY(e.clientX, e.clientY);
  if (idx < 0) return;
  drag.last = idx;
  selectRect(drag.start, idx);
});
window.addEventListener('mouseup', () => drag.active = false);

/* ===== API ===== */
const api = async (path, body) => {
  const r = await fetch(`/.netlify/functions/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uid: UID, ...body }),
  });
  const res = await r.json();
  if (!r.ok || !res.ok) throw new Error(res.error || `HTTP ${r.status}`);
  return res;
};

const reserve = blocks => api('reserve', { blocks, ttl: 300000 });
const unlock  = blocks => api('unlock', { blocks });
const finalize = opts => api('finalize', opts);

/* ===== FETCH STATE ===== */
async function fetchState() {
  if (Date.now() - state.lastFetch < 2000) return; // debounce
  state.lastFetch = Date.now();
  const { sold, locks } = await api('status');
  state.sold = sold || {};
  state.locks = locks || {};
  render();
  refreshTopbar();
}

/* ===== MODAL ===== */
let currentLock = [];
let heartbeat;

function startHeartbeat() {
  clearInterval(heartbeat);
  heartbeat = setInterval(() => reserve(currentLock).catch(() => {}), 4000);
}
function stopHeartbeat() {
  clearInterval(heartbeat);
}

function openModal() {
  modal.classList.remove('hidden');
  const price = 1 + Math.floor(Object.keys(state.sold).length * 100 / 1000) * 0.01;
  modalStats.textContent = `${fmtInt(state.selected.size * 100)} px — ${fmtMoney(state.selected.size * 100 * price)}`;
  startHeartbeat();
}
function closeModal() {
  modal.classList.add('hidden');
  stopHeartbeat();
}

buyBtn.addEventListener('click', async () => {
  const want = [...state.selected];
  try {
    const { locked } = await reserve(want);
    currentLock = locked;
    state.selected.clear();
    locked.forEach(i => state.selected.add(i));
    openModal();
  } catch (e) {
    alert('Reservation failed: ' + e.message);
  }
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  const linkUrl = linkInput.value.trim().startsWith('http') ? linkInput.value.trim() : 'https://' + linkInput.value.trim();
  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  if (!linkUrl || !name || !email) return;
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Processing…';
  try {
    await finalize({ blocks: currentLock, linkUrl, name, email });
    await fetchState();
    closeModal();
    state.selected.clear();
  } catch (e) {
    alert('Finalize failed: ' + e.message);
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirm';
  }
});

document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => {
  unlock(currentLock).catch(() => {});
  closeModal();
  state.selected.clear();
}));

/* ===== INIT ===== */
(async () => {
  await fetchState();
  setInterval(fetchState, 5000);
})();