// app.js — Version optimisée avec améliorations de performance
// Configuration et constantes
const CONFIG = {
  GRID_SIZE: 100,
  TOTAL_PIXELS: 1_000_000,
  OTHERS_GRACE_MS: 5000,
  HEARTBEAT_INTERVAL: 4000,
  LOCK_TTL: 300000,
  HOLD_PROTECTION_TIME: 8000,
  MAIN_POLLING_INTERVAL: 2500,
  REGIONS_POLLING_INTERVAL: 15000,
  INVALID_RECT_TTL: 900,
  BASE_PRICE: 1,
  PRICE_INCREMENT: 0.01,
  PRICE_TIER_SIZE: 1000
};

// Cache et état global optimisé
const state = {
  uid: null,
  sold: Object.create(null),
  locks: Object.create(null),
  selected: new Set(),
  holdIncomingLocksUntil: 0,
  currentLock: [],
  cellSize: { w: 10, h: 10 },
  
  // État du drag optimisé
  drag: {
    active: false,
    startIdx: -1,
    lastIdx: -1,
    moved: false,
    suppressClick: false,
    blocked: false
  },
  
  // Cache pour les éléments DOM
  elements: {}
};

// Anti-flicker pour les locks d'autrui
const othersCache = {
  lastSeen: Object.create(null),
  hold: Object.create(null)
};

// Cache des éléments DOM pour éviter les lookups répétés
function initDOMCache() {
  const elements = [
    'grid', 'buyBtn', 'priceLine', 'pixelsLeft', 'modal', 'form',
    'link', 'name', 'email', 'confirm', 'modalStats'
  ];
  
  elements.forEach(id => {
    state.elements[id] = document.getElementById(id);
  });
}

// Utilitaires optimisés
const utils = {
  formatInt: (n) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '),
  
  formatMoney: (n) => {
    const [i, d] = Number(n).toFixed(2).split('.');
    return '$' + i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '.' + d;
  },
  
  // UID génération plus robuste
  generateUID: () => {
    const key = 'iw_uid';
    let uid = localStorage.getItem(key);
    
    if (!uid) {
      if (window.crypto?.randomUUID) {
        uid = crypto.randomUUID();
      } else if (window.crypto?.getRandomValues) {
        const arr = new Uint8Array(16);
        crypto.getRandomValues(arr);
        uid = Array.from(arr, byte => byte.toString(16).padStart(2, '0')).join('');
      } else {
        uid = Date.now().toString(36) + Math.random().toString(36).slice(2);
      }
      localStorage.setItem(key, uid);
    }
    
    return uid;
  },
  
  // Calculs de coordonnées optimisés avec cache
  idxToRowCol: (idx) => [Math.floor(idx / CONFIG.GRID_SIZE), idx % CONFIG.GRID_SIZE],
  rowColToIdx: (r, c) => r * CONFIG.GRID_SIZE + c,
  
  // Prix dynamique optimisé
  getCurrentPrice: () => {
    const pixelsSold = Object.keys(state.sold).length * 100;
    return CONFIG.BASE_PRICE + Math.floor(pixelsSold / CONFIG.PRICE_TIER_SIZE) * CONFIG.PRICE_INCREMENT;
  },
  
  // Throttle pour les events fréquents
  throttle: (func, delay) => {
    let timeoutId;
    let lastExecTime = 0;
    
    return function (...args) {
      const currentTime = Date.now();
      
      if (currentTime - lastExecTime > delay) {
        func.apply(this, args);
        lastExecTime = currentTime;
      } else {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          func.apply(this, args);
          lastExecTime = Date.now();
        }, delay - (currentTime - lastExecTime));
      }
    };
  },
  
  // Debounce pour les recalculs
  debounce: (func, delay) => {
    let timeoutId;
    return function (...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
  }
};

// Initialisation de l'UID
state.uid = utils.generateUID();
window.uid = state.uid;

// Gestion optimisée des cellules
const cellManager = {
  // Cache des états de cellules pour éviter les recalculs
  cellStateCache: new Map(),
  dirtyeCells: new Set(),
  
  recalcCellSize: utils.debounce(() => {
    const firstCell = state.elements.grid?.children[0];
    if (!firstCell) return;
    
    const rect = firstCell.getBoundingClientRect();
    state.cellSize = {
      w: Math.max(1, Math.round(rect.width)),
      h: Math.max(1, Math.round(rect.height))
    };
  }, 100),
  
  isBlockedCell(idx) {
    // Cache du résultat pour éviter les recalculs
    const cacheKey = `${idx}-${Date.now() >> 10}`; // Cache par seconde
    if (this.cellStateCache.has(cacheKey)) {
      return this.cellStateCache.get(cacheKey);
    }
    
    const isBlocked = !!(state.sold[idx] || 
      (state.locks[idx]?.until > Date.now() && state.locks[idx]?.uid !== state.uid));
    
    this.cellStateCache.set(cacheKey, isBlocked);
    
    // Nettoyage périodique du cache
    if (this.cellStateCache.size > 1000) {
      const cutoff = Date.now() - 5000;
      for (const [key] of this.cellStateCache) {
        if (parseInt(key.split('-')[1]) * 1000 < cutoff) {
          this.cellStateCache.delete(key);
        }
      }
    }
    
    return isBlocked;
  },
  
  // Painting optimisé avec batch updates
  paintCell(idx) {
    const cell = state.elements.grid.children[idx];
    if (!cell) return;
    
    const sold = state.sold[idx];
    const lock = state.locks[idx];
    const reserved = lock?.until > Date.now() && !sold;
    const reservedByOther = reserved && lock.uid !== state.uid;
    
    // Batch DOM updates
    const updates = {
      classes: {
        sold: !!sold,
        pending: !!reservedByOther,
        sel: state.selected.has(idx)
      },
      styles: {},
      title: '',
      link: null
    };
    
    // Style de background pour les images
    if (sold?.imageUrl && sold.rect && Number.isInteger(sold.rect.x)) {
      const [r, c] = utils.idxToRowCol(idx);
      const { w: CW, h: CH } = state.cellSize;
      const offX = (c - sold.rect.x) * CW;
      const offY = (r - sold.rect.y) * CH;
      
      updates.styles = {
        backgroundImage: `url(${sold.imageUrl})`,
        backgroundSize: `${sold.rect.w * CW}px ${sold.rect.h * CH}px`,
        backgroundPosition: `-${offX}px -${offY}px`
      };
    }
    
    // Title et lien
    if (sold) {
      updates.title = (sold.name ? sold.name + ' · ' : '') + (sold.linkUrl || '');
      if (sold.linkUrl) {
        updates.link = sold.linkUrl;
      }
    }
    
    // Application des mises à jour en batch
    this.applyUpdates(cell, updates);
  },
  
  applyUpdates(cell, updates) {
    // Classes
    Object.entries(updates.classes).forEach(([className, shouldHave]) => {
      cell.classList.toggle(className, shouldHave);
    });
    
    // Styles
    Object.entries(updates.styles).forEach(([prop, value]) => {
      cell.style[prop] = value;
    });
    
    // Title
    cell.title = updates.title;
    
    // Lien
    if (updates.link) {
      if (!cell.firstChild) {
        const link = document.createElement('a');
        link.className = 'region-link';
        link.target = '_blank';
        cell.appendChild(link);
      }
      cell.firstChild.href = updates.link;
    } else if (cell.firstChild) {
      cell.firstChild.remove();
    }
  },
  
  // Paint optimisé avec RequestAnimationFrame
  paintAll() {
    requestAnimationFrame(() => {
      const gridSize = CONFIG.GRID_SIZE * CONFIG.GRID_SIZE;
      for (let i = 0; i < gridSize; i++) {
        this.paintCell(i);
      }
      uiManager.refreshTopbar();
    });
  },
  
  // Batch paint pour les cellules modifiées uniquement
  paintDirty() {
    if (this.dirtyeCells.size === 0) return;
    
    requestAnimationFrame(() => {
      this.dirtyeCells.forEach(idx => this.paintCell(idx));
      this.dirtyeCells.clear();
      uiManager.refreshTopbar();
    });
  },
  
  markDirty(idx) {
    this.dirtyeCells.add(idx);
  }
};

// Gestionnaire d'UI optimisé
const uiManager = {
  lastTopbarUpdate: 0,
  
  refreshTopbar: utils.throttle(() => {
    const blocksSold = Object.keys(state.sold).length;
    const pixelsSold = blocksSold * 100;
    const currentPrice = utils.getCurrentPrice();
    
    state.elements.priceLine.textContent = `1 pixel = ${utils.formatMoney(currentPrice)}`;
    state.elements.pixelsLeft.textContent = `${CONFIG.TOTAL_PIXELS.toLocaleString('en-US')} pixels`;
    
    const selectedPixels = state.selected.size * 100;
    if (selectedPixels > 0) {
      const total = selectedPixels * currentPrice;
      state.elements.buyBtn.textContent = `Buy Pixels — ${utils.formatInt(selectedPixels)} px (${utils.formatMoney(total)})`;
      state.elements.buyBtn.disabled = false;
    } else {
      state.elements.buyBtn.textContent = 'Buy Pixels';
      state.elements.buyBtn.disabled = true;
    }
  }, 100),
  
  clearSelection() {
    state.selected.forEach(idx => {
      state.elements.grid.children[idx]?.classList.remove('sel');
    });
    state.selected.clear();
    this.refreshTopbar();
  },
  
  applySelection(newSet) {
    // Optimisation: seulement modifier les cellules qui changent
    const toRemove = new Set([...state.selected].filter(x => !newSet.has(x)));
    const toAdd = new Set([...newSet].filter(x => !state.selected.has(x)));
    
    toRemove.forEach(idx => {
      state.elements.grid.children[idx]?.classList.remove('sel');
    });
    
    toAdd.forEach(idx => {
      state.elements.grid.children[idx]?.classList.add('sel');
    });
    
    state.selected = newSet;
    this.refreshTopbar();
  }
};

// Gestionnaire de sélection optimisé
const selectionManager = {
  selectRect(aIdx, bIdx) {
    const [ar, ac] = utils.idxToRowCol(aIdx);
    const [br, bc] = utils.idxToRowCol(bIdx);
    const r0 = Math.min(ar, br), r1 = Math.max(ar, br);
    const c0 = Math.min(ac, bc), c1 = Math.max(ac, bc);
    
    // Vérification optimisée des cellules bloquées
    state.drag.blocked = false;
    
    // Early exit si la sélection est trop grande (performance)
    const rectSize = (r1 - r0 + 1) * (c1 - c0 + 1);
    if (rectSize > 10000) { // Limite arbitraire
      state.drag.blocked = true;
      uiManager.clearSelection();
      return;
    }
    
    // Vérification des cellules bloquées avec short-circuit
    outerLoop: for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const idx = utils.rowColToIdx(r, c);
        if (cellManager.isBlockedCell(idx)) {
          state.drag.blocked = true;
          break outerLoop;
        }
      }
    }
    
    if (state.drag.blocked) {
      uiManager.clearSelection();
      invalidRectManager.show(r0, c0, r1, c1, CONFIG.INVALID_RECT_TTL);
      return;
    }
    
    // Construction optimisée de la nouvelle sélection
    const newSelection = new Set();
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        newSelection.add(utils.rowColToIdx(r, c));
      }
    }
    
    uiManager.applySelection(newSelection);
    invalidRectManager.hide();
  },
  
  toggleCell(idx) {
    if (cellManager.isBlockedCell(idx)) return;
    
    if (state.selected.has(idx)) {
      state.selected.delete(idx);
      state.elements.grid.children[idx]?.classList.remove('sel');
    } else {
      state.selected.add(idx);
      state.elements.grid.children[idx]?.classList.add('sel');
    }
    
    uiManager.refreshTopbar();
  },
  
  idxFromClientXY: utils.throttle((x, y) => {
    const rect = state.elements.grid.getBoundingClientRect();
    const { w: CW, h: CH } = state.cellSize;
    const gx = Math.floor((x - rect.left) / CW);
    const gy = Math.floor((y - rect.top) / CH);
    
    if (gx < 0 || gy < 0 || gx >= CONFIG.GRID_SIZE || gy >= CONFIG.GRID_SIZE) {
      return -1;
    }
    
    return gy * CONFIG.GRID_SIZE + gx;
  }, 16) // ~60fps
};

// Gestionnaire de rectangle invalide optimisé
const invalidRectManager = {
  element: null,
  hideTimeout: null,
  
  init() {
    this.element = document.createElement('div');
    this.element.id = 'invalidRect';
    Object.assign(this.element.style, {
      position: 'absolute',
      border: '2px solid #ef4444',
      background: 'rgba(239,68,68,0.08)',
      pointerEvents: 'none',
      display: 'none',
      zIndex: '999'
    });
    
    const icon = document.createElement('div');
    Object.assign(icon.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%,-50%)',
      pointerEvents: 'none',
      zIndex: '1000'
    });
    
    icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" fill="rgba(255,255,255,0.95)"></circle>
      <circle cx="12" cy="12" r="9" fill="none" stroke="#ef4444" stroke-width="2"></circle>
      <line x1="7" y1="17" x2="17" y2="7" stroke="#ef4444" stroke-width="2" stroke-linecap="round"></line>
    </svg>`;
    
    this.element.appendChild(icon);
    state.elements.grid.appendChild(this.element);
  },
  
  show(r0, c0, r1, c1, ttl = CONFIG.INVALID_RECT_TTL) {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    
    const { w: CW, h: CH } = state.cellSize;
    const left = c0 * CW, top = r0 * CH;
    const width = (c1 - c0 + 1) * CW, height = (r1 - r0 + 1) * CH;
    
    Object.assign(this.element.style, {
      left: left + 'px',
      top: top + 'px',
      width: width + 'px',
      height: height + 'px',
      display: 'block'
    });
    
    const size = Math.max(16, Math.min(64, Math.floor(Math.min(width, height) * 0.7)));
    const svg = this.element.querySelector('svg');
    svg.style.width = size + 'px';
    svg.style.height = size + 'px';
    
    if (ttl > 0) {
      this.hideTimeout = setTimeout(() => this.hide(), ttl);
    }
  },
  
  hide() {
    this.element.style.display = 'none';
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }
};

// Gestionnaire de locks optimisé
const lockManager = {
  // Merge optimisé avec moins d'allocations
  mergeLocksPreferLocal(local, incoming) {
    const now = Date.now();
    const result = Object.create(null);
    
    // Garde mes locks valides
    for (const [key, lock] of Object.entries(local || {})) {
      if (lock?.uid === state.uid && lock.until > now) {
        result[key] = { uid: lock.uid, until: lock.until };
      }
    }
    
    // Ajoute les locks entrants
    for (const [key, lock] of Object.entries(incoming || {})) {
      if (lock?.until > now) {
        result[key] = { uid: lock.uid, until: lock.until };
        othersCache.lastSeen[key] = now;
      }
    }
    
    // Grâce pour les locks d'autrui disparus
    for (const [key, lock] of Object.entries(local || {})) {
      if (!result[key] && lock?.uid !== state.uid && lock.until > now) {
        const lastSeen = othersCache.lastSeen[key] || 0;
        if (now - lastSeen < CONFIG.OTHERS_GRACE_MS) {
          result[key] = { uid: lock.uid, until: lock.until };
        } else {
          delete othersCache.lastSeen[key];
        }
      }
    }
    
    return result;
  },
  
  // Nettoyage périodique des locks expirés
  cleanExpiredLocks() {
    const now = Date.now();
    const keysToDelete = [];
    
    for (const [key, lock] of Object.entries(state.locks)) {
      if (!lock || lock.until <= now) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => {
      delete state.locks[key];
      cellManager.markDirty(parseInt(key, 10));
    });
    
    if (keysToDelete.length > 0) {
      cellManager.paintDirty();
    }
  }
};

// Gestionnaire de heartbeat optimisé
const heartbeatManager = {
  interval: null,
  
  start() {
    this.stop();
    if (state.currentLock.length === 0) return;
    
    this.interval = setInterval(async () => {
      if (state.currentLock.length === 0) {
        this.stop();
        return;
      }
      
      try {
        await apiManager.reserve(state.currentLock);
      } catch (error) {
        console.warn('Heartbeat failed:', error);
      }
    }, CONFIG.HEARTBEAT_INTERVAL);
  },
  
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
};

// Gestionnaire d'API avec retry et cache
const apiManager = {
  // Cache des requêtes pour éviter les doublons
  requestCache: new Map(),
  
  // Retry automatique avec backoff exponentiel
  async requestWithRetry(url, options, maxRetries = 3) {
    const cacheKey = `${url}-${JSON.stringify(options)}`;
    
    // Cache très court pour éviter les doublons
    if (this.requestCache.has(cacheKey)) {
      const cached = this.requestCache.get(cacheKey);
      if (Date.now() - cached.timestamp < 1000) {
        return cached.response;
      }
    }
    
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          cache: 'no-store',
          headers: {
            'content-type': 'application/json',
            ...options.headers
          }
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.ok) {
          throw new Error(data.error || `HTTP ${response.status}`);
        }
        
        // Cache la réponse
        this.requestCache.set(cacheKey, {
          response: data,
          timestamp: Date.now()
        });
        
        // Nettoyage du cache
        if (this.requestCache.size > 100) {
          const cutoff = Date.now() - 5000;
          for (const [key, value] of this.requestCache) {
            if (value.timestamp < cutoff) {
              this.requestCache.delete(key);
            }
          }
        }
        
        return data;
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries - 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  },
  
  async reserve(indices) {
    const response = await this.requestWithRetry('/.netlify/functions/reserve', {
      method: 'POST',
      body: JSON.stringify({
        uid: state.uid,
        blocks: indices,
        ttl: CONFIG.LOCK_TTL
      })
    });
    
    // Mise à jour locale optimisée
    const now = Date.now();
    for (const idx of (response.locked || [])) {
      state.locks[idx] = { uid: state.uid, until: now + CONFIG.LOCK_TTL };
      cellManager.markDirty(idx);
    }
    
    // Merge des locks avec protection
    state.locks = lockManager.mergeLocksPreferLocal(state.locks, response.locks || {});
    cellManager.paintDirty();
    
    state.holdIncomingLocksUntil = Date.now() + CONFIG.HOLD_PROTECTION_TIME;
    state.currentLock = Array.isArray(response.locked) ? response.locked.slice() : [];
    
    return response;
  },
  
  async unlock(indices) {
    const response = await this.requestWithRetry('/.netlify/functions/unlock', {
      method: 'POST',
      body: JSON.stringify({
        uid: state.uid,
        blocks: indices
      })
    });
    
    state.locks = response.locks || {};
    state.holdIncomingLocksUntil = 0;
    
    // Marquer toutes les cellules affectées comme dirty
    indices.forEach(idx => cellManager.markDirty(idx));
    cellManager.paintDirty();
    
    return response;
  },
  
  async loadStatus() {
    try {
      const response = await this.requestWithRetry('/.netlify/functions/status');
      
      if (!response?.ok) return;
      
      // Mise à jour des ventes
      state.sold = response.sold || {};
      
      const incoming = response.locks || {};
      const now = Date.now();
      
      // Mise à jour des caches de grâce
      for (const [key, lock] of Object.entries(incoming)) {
        if (lock?.uid !== state.uid && lock.until > now) {
          othersCache.hold[key] = now + CONFIG.OTHERS_GRACE_MS;
        }
      }
      
      // Nettoyage des holds expirés
      for (const [key, expTime] of Object.entries(othersCache.hold)) {
        if (expTime <= now) {
          delete othersCache.hold[key];
        }
      }
      
      // Construction de la vue des locks
      const visibleLocks = Object.create(null);
      
      // Base: locks du serveur
      for (const [key, lock] of Object.entries(incoming)) {
        if (lock?.until > now) {
          visibleLocks[key] = { uid: lock.uid, until: lock.until };
        }
      }
      
      // Ajout des holds
      for (const [key, expTime] of Object.entries(othersCache.hold)) {
        if (!visibleLocks[key]) {
          visibleLocks[key] = { uid: 'other', until: expTime };
        }
      }
      
      // Priorité aux locks locaux
      for (const [key, lock] of Object.entries(state.locks)) {
        if (lock?.uid === state.uid && lock.until > now) {
          const current = visibleLocks[key];
          if (!current || current.uid !== state.uid || lock.until > current.until) {
            visibleLocks[key] = { uid: lock.uid, until: lock.until };
          }
        }
      }
      
      state.locks = visibleLocks;
      cellManager.paintAll();
      
    } catch (error) {
      console.warn('Status load failed:', error);
    }
  },
  
  async finalize(blocks, linkUrl, name, email) {
    return await this.requestWithRetry('/.netlify/functions/finalize', {
      method: 'POST',
      body: JSON.stringify({
        uid: state.uid,
        blocks,
        linkUrl,
        name,
        email
      })
    });
  }
};

// Gestionnaire d'événements optimisé
const eventManager = {
  init() {
    this.setupMouseEvents();
    this.setupKeyboardEvents();
    this.setupFormEvents();
    this.setupResizeObserver();
  },
  
  setupMouseEvents() {
    // Utilisation de la délégation d'événements
    state.elements.grid.addEventListener('mousedown', this.handleMouseDown.bind(this));
    window.addEventListener('mousemove', utils.throttle(this.handleMouseMove.bind(this), 16)); // 60fps
    window.addEventListener('mouseup', this.handleMouseUp.bind(this));
    state.elements.grid.addEventListener('click', this.handleClick.bind(this));
  },
  
  handleMouseDown(e) {
    const idx = selectionManager.idxFromClientXY(e.clientX, e.clientY);
    if (idx < 0) return;
    
    state.drag = {
      active: true,
      startIdx: idx,
      lastIdx: idx,
      moved: false,
      suppressClick: false,
      blocked: false
    };
    
    selectionManager.selectRect(idx, idx);
    e.preventDefault();
  },
  
  handleMouseMove(e) {
    if (!state.drag.active) return;
    
    const idx = selectionManager.idxFromClientXY(e.clientX, e.clientY);
    if (idx < 0 || idx === state.drag.lastIdx) return;
    
    state.drag.moved = true;
    state.drag.lastIdx = idx;
    selectionManager.selectRect(state.drag.startIdx, idx);
  },
  
  handleMouseUp() {
    if (state.drag.active) {
      state.drag.suppressClick = state.drag.moved;
    }
    
    state.drag.active = false;
    state.drag.startIdx = -1;
    state.drag.moved = false;
    state.drag.lastIdx = -1;
  },
  
  handleClick(e) {
    if (state.drag.suppressClick) {
      state.drag.suppressClick = false;
      return;
    }
    
    if (state.drag.active) return;
    
    const idx = selectionManager.idxFromClientXY(e.clientX, e.clientY);
    if (idx >= 0) {
      selectionManager.toggleCell(idx);
    }
  },
  
  setupKeyboardEvents() {
    window.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape' && !state.elements.modal.classList.contains('hidden')) {
        await this.closeModal();
      }
    });
  },
  
  setupFormEvents() {
    // Buy button
    state.elements.buyBtn.addEventListener('click', async () => {
      if (state.selected.size === 0) return;
      
      const selectedArray = Array.from(state.selected);
      
      try {
        const response = await apiManager.reserve(selectedArray);
        
        if (response.conflicts?.length > 0 || 
            response.locked?.length !== selectedArray.length) {
          this.handleReservationConflict(selectedArray);
          return;
        }
        
        state.currentLock = response.locked.slice();
        
        uiManager.clearSelection();
        
        // Mise à jour de la sélection avec les cellules réservées
        for (const idx of response.locked) {
          state.selected.add(idx);
          state.elements.grid.children[idx]?.classList.add('sel');
        }
        
        modalManager.open();
        
      } catch (error) {
        alert('Reservation failed: ' + (error?.message || error));
      }
    });
    
    // Close modal buttons
    document.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => this.closeModal());
    });
    
    // Form submission
    state.elements.form.addEventListener('submit', this.handleFormSubmit.bind(this));
  },
  
  async handleFormSubmit(e) {
    e.preventDefault();
    
    let linkUrl = state.elements.link.value.trim();
    const name = state.elements.name.value.trim();
    const email = state.elements.email.value.trim();
    
    if (!linkUrl || !name || !email) return;
    
    if (!/^https?:\/\//i.test(linkUrl)) {
      linkUrl = 'https://' + linkUrl;
    }
    
    const confirmBtn = state.elements.confirm;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Processing…';
    
    try {
      const blocks = state.currentLock.length ? state.currentLock.slice() : Array.from(state.selected);
      
      const response = await apiManager.finalize(blocks, linkUrl, name, email);
      
      if (response.taken) {
        this.handleFinalizationConflict(blocks);
        return;
      }
      
      state.sold = response.soldMap || state.sold;
      
      try {
        await apiManager.unlock(blocks);
      } catch (error) {
        console.warn('Unlock after finalize failed:', error);
      }
      
      state.currentLock = [];
      heartbeatManager.stop();
      uiManager.clearSelection();
      cellManager.paintAll();
      modalManager.close();
      
    } catch (error) {
      alert('Finalize failed: ' + (error?.message || error));
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm';
    }
  },
  
  handleReservationConflict(selectedArray) {
    const rect = this.rectFromIndices(selectedArray);
    if (rect) {
      invalidRectManager.show(rect.r0, rect.c0, rect.r1, rect.c1, 1200);
    }
    uiManager.clearSelection();
    cellManager.paintAll();
  },
  
  handleFinalizationConflict(blocks) {
    const rect = this.rectFromIndices(blocks);
    if (rect) {
      invalidRectManager.show(rect.r0, rect.c0, rect.r1, rect.c1, 1200);
    }
    uiManager.clearSelection();
    cellManager.paintAll();
  },
  
  async closeModal() {
    const toRelease = state.currentLock.length ? state.currentLock.slice() : Array.from(state.selected);
    
    state.currentLock = [];
    heartbeatManager.stop();
    
    if (toRelease.length > 0) {
      try {
        await apiManager.unlock(toRelease);
      } catch (error) {
        console.warn('Unlock on close failed:', error);
      }
    }
    
    modalManager.close();
    uiManager.clearSelection();
    
    // Refresh différé pour éviter les conflicts de timing
    setTimeout(async () => {
      await apiManager.loadStatus();
      cellManager.paintAll();
    }, 150);
  },
  
  rectFromIndices(arr) {
    if (!arr?.length) return null;
    
    let r0 = Infinity, c0 = Infinity, r1 = -1, c1 = -1;
    
    for (const idx of arr) {
      const [r, c] = utils.idxToRowCol(idx);
      r0 = Math.min(r0, r); c0 = Math.min(c0, c);
      r1 = Math.max(r1, r); c1 = Math.max(c1, c);
    }
    
    return { r0, c0, r1, c1 };
  },
  
  setupResizeObserver() {
    // Utilisation de ResizeObserver pour une meilleure performance
    if (window.ResizeObserver) {
      const resizeObserver = new ResizeObserver(cellManager.recalcCellSize);
      resizeObserver.observe(state.elements.grid);
    } else {
      // Fallback pour les navigateurs non supportés
      window.addEventListener('resize', cellManager.recalcCellSize);
    }
  }
};

// Gestionnaire de modal optimisé
const modalManager = {
  open() {
    state.elements.modal.classList.remove('hidden');
    
    const blocksSold = Object.keys(state.sold).length;
    const pixelsSold = blocksSold * 100;
    const currentPrice = utils.getCurrentPrice();
    const selectedPixels = state.selected.size * 100;
    const total = selectedPixels * currentPrice;
    
    state.elements.modalStats.textContent = 
      `${utils.formatInt(selectedPixels)} px — ${utils.formatMoney(total)}`;
    
    if (state.currentLock.length > 0) {
      heartbeatManager.start();
    }
  },
  
  close() {
    state.elements.modal.classList.add('hidden');
    heartbeatManager.stop();
  }
};

// Gestionnaire de régions optimisé avec polling séparé
const regionManager = {
  interval: null,
  
  init() {
    this.startPolling();
    this.initialLoad();
  },
  
  async initialLoad() {
    try {
      await apiManager.loadStatus();
      cellManager.paintAll();
      this.render();
    } catch (error) {
      console.warn('Initial regions load failed:', error);
    }
  },
  
  startPolling() {
    // Polling séparé pour les régions pour éviter les conflicts
    this.interval = setInterval(async () => {
      try {
        const response = await fetch(`/.netlify/functions/status?ts=${Date.now()}`);
        const data = await response.json();
        
        if (data?.ok) {
          // Mise à jour sélective: seulement sold et regions, pas les locks
          const soldChanged = JSON.stringify(state.sold) !== JSON.stringify(data.sold);
          
          state.sold = data.sold || {};
          window.regions = data.regions || {};
          
          if (soldChanged) {
            cellManager.paintAll();
          }
          
          this.render();
        }
      } catch (error) {
        console.warn('Regions polling failed:', error);
      }
    }, CONFIG.REGIONS_POLLING_INTERVAL);
  },
  
  render() {
    const gridEl = state.elements.grid;
    if (!gridEl) return;
    
    // Suppression optimisée des overlays existants
    const existingOverlays = gridEl.querySelectorAll('.region-overlay');
    existingOverlays.forEach(node => node.remove());
    
    const firstCell = gridEl.querySelector('.cell');
    const cellSize = firstCell ? firstCell.offsetWidth : 10;
    
    // Cache des liens de région
    const regionLinks = Object.create(null);
    for (const [idx, sold] of Object.entries(state.sold)) {
      if (sold?.regionId && sold.linkUrl && !regionLinks[sold.regionId]) {
        regionLinks[sold.regionId] = sold.linkUrl;
      }
    }
    
    // Fragment pour batch DOM insertion
    const fragment = document.createDocumentFragment();
    
    for (const [regionId, region] of Object.entries(window.regions || {})) {
      if (!region?.rect || !region.imageUrl) continue;
      
      const { x, y, w, h } = region.rect;
      const topLeftIdx = y * CONFIG.GRID_SIZE + x;
      const topLeftCell = gridEl.querySelector(`.cell[data-idx="${topLeftIdx}"]`);
      
      if (!topLeftCell) continue;
      
      const overlay = document.createElement('a');
      overlay.className = 'region-overlay';
      
      if (regionLinks[regionId]) {
        overlay.href = regionLinks[regionId];
        overlay.target = '_blank';
        overlay.rel = 'noopener nofollow';
      }
      
      Object.assign(overlay.style, {
        position: 'absolute',
        left: topLeftCell.offsetLeft + 'px',
        top: topLeftCell.offsetTop + 'px',
        width: (w * cellSize) + 'px',
        height: (h * cellSize) + 'px',
        backgroundImage: `url("${region.imageUrl}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        zIndex: '999'
      });
      
      fragment.appendChild(overlay);
    }
    
    gridEl.appendChild(fragment);
    
    // Style de position une seule fois
    if (gridEl.style.position !== 'relative') {
      gridEl.style.position = 'relative';
      gridEl.style.zIndex = '2';
    }
  },
  
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
};

// Gestionnaire de polling principal optimisé
const pollingManager = {
  interval: null,
  
  start() {
    this.stop();
    
    this.interval = setInterval(async () => {
      // Nettoyage périodique des locks expirés
      lockManager.cleanExpiredLocks();
      
      await apiManager.loadStatus();
      cellManager.paintAll();
    }, CONFIG.MAIN_POLLING_INTERVAL);
  },
  
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
};

// Gestionnaire de performance et monitoring
const performanceManager = {
  frameTimeBuffer: [],
  lastFrameTime: 0,
  
  init() {
    this.startMonitoring();
  },
  
  startMonitoring() {
    // Monitoring des performances de rendu
    const checkFrameRate = () => {
      const now = performance.now();
      if (this.lastFrameTime) {
        const frameTime = now - this.lastFrameTime;
        this.frameTimeBuffer.push(frameTime);
        
        if (this.frameTimeBuffer.length > 60) {
          this.frameTimeBuffer.shift();
        }
        
        // Log si performance dégradée
        const avgFrameTime = this.frameTimeBuffer.reduce((a, b) => a + b, 0) / this.frameTimeBuffer.length;
        if (avgFrameTime > 20) { // Plus de 20ms = moins de 50fps
          console.warn(`Performance warning: Average frame time ${avgFrameTime.toFixed(2)}ms`);
        }
      }
      this.lastFrameTime = now;
      requestAnimationFrame(checkFrameRate);
    };
    
    requestAnimationFrame(checkFrameRate);
  },
  
  // Fonction de nettoyage pour libérer la mémoire
  cleanup() {
    cellManager.cellStateCache.clear();
    apiManager.requestCache.clear();
    this.frameTimeBuffer = [];
  }
};

// Construction optimisée de la grille
function buildGrid() {
  const fragment = document.createDocumentFragment();
  const totalCells = CONFIG.GRID_SIZE * CONFIG.GRID_SIZE;
  
  // Création en batch pour optimiser les performances
  const batchSize = 1000;
  let createdCells = 0;
  
  function createBatch() {
    const currentBatchSize = Math.min(batchSize, totalCells - createdCells);
    
    for (let i = 0; i < currentBatchSize; i++) {
      const cellIndex = createdCells + i;
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.idx = cellIndex;
      fragment.appendChild(cell);
    }
    
    createdCells += currentBatchSize;
    
    if (createdCells < totalCells) {
      // Continuation asynchrone pour éviter de bloquer l'UI
      requestAnimationFrame(createBatch);
    } else {
      // Finition de la construction
      state.elements.grid.appendChild(fragment);
      
      const computedStyle = getComputedStyle(state.elements.grid);
      if (computedStyle.position === 'static') {
        state.elements.grid.style.position = 'relative';
      }
      
      cellManager.recalcCellSize();
    }
  }
  
  createBatch();
}

// Fonction de débogage améliorée
function debugInfo() {
  return {
    selectedCount: state.selected.size,
    locksCount: Object.keys(state.locks).length,
    soldCount: Object.keys(state.sold).length,
    currentLockCount: state.currentLock.length,
    cacheSize: cellManager.cellStateCache.size,
    isDragging: state.drag.active,
    heartbeatActive: !!heartbeatManager.interval,
    performance: {
      avgFrameTime: performanceManager.frameTimeBuffer.length > 0 
        ? (performanceManager.frameTimeBuffer.reduce((a, b) => a + b, 0) / performanceManager.frameTimeBuffer.length).toFixed(2) + 'ms'
        : 'N/A'
    }
  };
}

// Fonction de nettoyage manuel améliorée
function debugCleanExpiredLocks() {
  const before = Object.keys(state.locks).length;
  lockManager.cleanExpiredLocks();
  const after = Object.keys(state.locks).length;
  
  console.log(`🧹 [DEBUG] Lock cleanup: ${before} -> ${after} locks`);
  console.log('🧹 [DEBUG] Current state:', debugInfo());
  
  return { before, after, cleaned: before - after };
}

// Gestionnaire d'erreurs global
const errorManager = {
  lastError: null,
  errorCount: 0,
  
  handle(error, context = 'unknown') {
    this.errorCount++;
    this.lastError = { error, context, timestamp: Date.now() };
    
    console.error(`[${context}] Error #${this.errorCount}:`, error);
    
    // Nettoyage automatique en cas d'erreurs répétées
    if (this.errorCount > 10) {
      console.warn('Multiple errors detected, performing cleanup...');
      performanceManager.cleanup();
      this.errorCount = 0;
    }
  }
};

// Initialisation principale
async function init() {
  try {
    // Cache des éléments DOM
    initDOMCache();
    
    // Construction de la grille
    buildGrid();
    
    // Initialisation des gestionnaires
    invalidRectManager.init();
    eventManager.init();
    performanceManager.init();
    regionManager.init();
    
    // Chargement initial
    await apiManager.loadStatus();
    cellManager.paintAll();
    
    // Démarrage du polling principal
    pollingManager.start();
    
    console.log('✅ App initialized successfully');
    console.log('📊 Initial state:', debugInfo());
    
  } catch (error) {
    errorManager.handle(error, 'initialization');
  }
}

// Nettoyage à la fermeture
window.addEventListener('beforeunload', () => {
  pollingManager.stop();
  regionManager.stop();
  heartbeatManager.stop();
  performanceManager.cleanup();
});

// Exposition des fonctions utiles pour le débogage
window.debugInfo = debugInfo;
window.debugCleanExpiredLocks = debugCleanExpiredLocks;
window.state = state; // Pour inspection en dev

// Démarrage de l'application
init();