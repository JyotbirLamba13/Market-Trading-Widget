import { loadSymbols } from "./symbolService.js";

loadSymbols();

'use strict';

const SK = {
  THEME:  'widgetTheme',
  LIST:   'watchlist',
  PINNED: 'pinnedSymbols',
  HIDDEN: 'widgetHidden',
};

const DEFAULTS = {
  theme:     'dark',
  watchlist: ['NSE:NIFTY', 'BSE:SENSEX', 'NSE:RELIANCE', 'NSE:HDFCBANK', 'NSE:TCS'],
  pinned:    ['NSE:NIFTY', 'BSE:SENSEX'],
};

// Max symbols. ~15 rows fit comfortably on a 900px screen without overflow.
const MAX_SYMBOLS = 15;

// ── Curated catalog — only symbols valid on TradingView scanner ───────────────
const CATALOG = {
  'Indices':  ['NSE:NIFTY', 'BSE:SENSEX', 'NSE:BANKNIFTY', 'NSE:NIFTYIT', 'NSE:MIDCPNIFTY', 'NSE:FINNIFTY'],
  'Banking':  ['NSE:HDFCBANK', 'NSE:ICICIBANK', 'NSE:KOTAKBANK', 'NSE:SBIN', 'NSE:AXISBANK', 'NSE:INDUSINDBK', 'NSE:BANDHANBNK', 'NSE:FEDERALBNK'],
  'IT':       ['NSE:TCS', 'NSE:INFY', 'NSE:WIPRO', 'NSE:HCLTECH', 'NSE:TECHM', 'NSE:LTIM', 'NSE:MPHASIS', 'NSE:PERSISTENT'],
  'Energy':   ['NSE:RELIANCE', 'NSE:ONGC', 'NSE:BPCL', 'NSE:IOC', 'NSE:HINDPETRO', 'NSE:GAIL', 'NSE:ADANIGREEN'],
  'Finance':  ['NSE:BAJFINANCE', 'NSE:BAJAJFINSV', 'NSE:SBILIFE', 'NSE:HDFCLIFE', 'NSE:ICICIGI', 'NSE:MUTHOOTFIN'],
  'Auto':     ['NSE:MARUTI', 'NSE:TATAMOTORS', 'NSE:M_M', 'NSE:BAJAJ-AUTO', 'NSE:HEROMOTOCO', 'NSE:EICHERMOT', 'NSE:TVSMOTOR'],
  'Consumer': ['NSE:HINDUNILVR', 'NSE:ITC', 'NSE:NESTLEIND', 'NSE:BRITANNIA', 'NSE:DABUR', 'NSE:MARICO', 'NSE:COLPAL'],
  'Metals':   ['NSE:TATASTEEL', 'NSE:JSWSTEEL', 'NSE:HINDALCO', 'NSE:VEDL', 'NSE:COALINDIA', 'NSE:SAIL', 'NSE:NMDC'],
  'Infra':    ['NSE:LT', 'NSE:ULTRACEMCO', 'NSE:ADANIPORTS', 'NSE:POWERGRID', 'NSE:NTPC', 'NSE:TATAPOWER'],
  'Pharma':   ['NSE:SUNPHARMA', 'NSE:DRREDDY', 'NSE:CIPLA', 'NSE:DIVISLAB', 'NSE:APOLLOHOSP', 'NSE:BIOCON'],
  'New Age':  ['NSE:ZOMATO', 'NSE:DMART', 'NSE:NYKAA', 'NSE:IRCTC', 'NSE:TRENT', 'NSE:PAYTM'],
};

const ALL_SYMBOLS = [...new Set(Object.values(CATALOG).flat())];
const label = sym => sym.split(':')[1] || sym;

// ── State ─────────────────────────────────────────────────────────────────────
let st = {
  theme:     DEFAULTS.theme,
  watchlist: [...DEFAULTS.watchlist],
  pinned:    [...DEFAULTS.pinned],
  hidden:    false,
};

let activeSector = 'Indices';
let searchQ      = '';

// ── Load & apply theme to popup immediately ───────────────────────────────────
chrome.storage.local.get([SK.THEME, SK.LIST, SK.PINNED, SK.HIDDEN], res => {
  st.theme     = res[SK.THEME]  || DEFAULTS.theme;
  st.watchlist = res[SK.LIST]   || DEFAULTS.watchlist;
  st.pinned    = res[SK.PINNED] || DEFAULTS.pinned;
  st.hidden    = !!res[SK.HIDDEN];

  // Cap any previously over-limit watchlist
  if (st.watchlist.length > MAX_SYMBOLS) {
    st.watchlist = st.watchlist.slice(0, MAX_SYMBOLS);
    st.pinned    = st.pinned.filter(s => st.watchlist.includes(s));
    chrome.storage.local.set({ [SK.LIST]: st.watchlist, [SK.PINNED]: st.pinned });
  }

  applyThemeToPopup();
  render();
});

// ── Apply theme to popup body (fixes popup not going light) ───────────────────
function applyThemeToPopup() {
  document.body.setAttribute('data-theme', st.theme);
}

function render() {
  renderThemeBtns();
  renderVisBtn();
  renderWatchlist();
  renderSectors();
  renderGrid();
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function renderThemeBtns() {
  document.querySelectorAll('.theme-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === st.theme)
  );
}
document.querySelectorAll('.theme-btn').forEach(b => {
  b.addEventListener('click', () => {
    st.theme = b.dataset.theme;
    chrome.storage.local.set({ [SK.THEME]: st.theme });
    applyThemeToPopup();
    renderThemeBtns();
  });
});

// ── Visibility ────────────────────────────────────────────────────────────────
function renderVisBtn() {
  const btn = document.getElementById('btn-vis');
  if (!btn) return;
  btn.textContent = st.hidden ? 'Show Widget' : 'Hide Widget';
  btn.classList.toggle('showing', st.hidden);
}
document.getElementById('btn-vis')?.addEventListener('click', () => {
  st.hidden = !st.hidden;
  chrome.storage.local.set({ [SK.HIDDEN]: st.hidden });
  renderVisBtn();
});

// ── Clear All ─────────────────────────────────────────────────────────────────
document.getElementById('btn-clear')?.addEventListener('click', () => {
  if (!st.watchlist.length) return;
  if (!confirm('Remove all symbols from watchlist?')) return;
  st.watchlist = [];
  st.pinned    = [];
  chrome.storage.local.set({ [SK.LIST]: [], [SK.PINNED]: [] });
  render();
});

// ── Active watchlist ──────────────────────────────────────────────────────────
function renderWatchlist() {
  const el    = document.getElementById('active-list');
  const cnt   = document.getElementById('wl-count');
  const limit = document.getElementById('limit-hint');

  if (cnt)   cnt.textContent = `${st.watchlist.length}/${MAX_SYMBOLS}`;
  if (limit) limit.textContent = st.watchlist.length >= MAX_SYMBOLS ? `· limit reached` : '';

  const clearBtn = document.getElementById('btn-clear');
  if (clearBtn) clearBtn.style.display = st.watchlist.length ? '' : 'none';

  if (!el) return;

  if (!st.watchlist.length) {
    el.innerHTML = '<div class="empty-msg">Pick symbols from the browser below ↓</div>';
    return;
  }

  el.innerHTML = st.watchlist.map(s => {
    const pinned = st.pinned.includes(s);
    return `<div class="wl-item${pinned ? ' pinned' : ''}">
      <span class="wl-sym">${label(s)}</span>
      <div class="wl-acts">
        <button class="wl-pin${pinned ? ' on' : ''}" data-sym="${s}"
          title="${pinned ? 'Unpin from mini bar' : 'Pin to mini bar (max 4)'}">${pinned ? '📌' : '○'}</button>
        <button class="wl-del" data-sym="${s}" title="Remove">×</button>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.wl-pin').forEach(b => b.addEventListener('click', () => togglePin(b.dataset.sym)));
  el.querySelectorAll('.wl-del').forEach(b => b.addEventListener('click', () => remove(b.dataset.sym)));
}

function togglePin(sym) {
  if (st.pinned.includes(sym)) {
    st.pinned = st.pinned.filter(s => s !== sym);
  } else {
    if (st.pinned.length >= 4) st.pinned = st.pinned.slice(1);
    st.pinned.push(sym);
  }
  chrome.storage.local.set({ [SK.PINNED]: st.pinned });
  renderWatchlist();
}

function remove(sym) {
  st.watchlist = st.watchlist.filter(s => s !== sym);
  st.pinned    = st.pinned.filter(s => s !== sym);
  chrome.storage.local.set({ [SK.LIST]: st.watchlist, [SK.PINNED]: st.pinned });
  renderWatchlist();
  renderGrid();
}

// ── Sector tabs ───────────────────────────────────────────────────────────────
function renderSectors() {
  const el = document.getElementById('sector-tabs');
  if (!el) return;
  el.innerHTML = Object.keys(CATALOG).map(s =>
    `<button class="stab${s === activeSector && !searchQ ? ' active' : ''}" data-s="${s}">${s}</button>`
  ).join('');
  el.querySelectorAll('.stab').forEach(b => {
    b.addEventListener('click', () => {
      activeSector = b.dataset.s;
      searchQ = '';
      const inp = document.getElementById('sym-search');
      if (inp) inp.value = '';
      renderSectors();
      renderGrid();
    });
  });
}

// ── Symbol grid — only catalog symbols, cap enforced ─────────────────────────
function renderGrid() {
  const el = document.getElementById('sym-grid');
  if (!el) return;

  const atLimit = st.watchlist.length >= MAX_SYMBOLS;

  let syms = searchQ
    ? ALL_SYMBOLS.filter(s => s.toLowerCase().includes(searchQ) || label(s).toLowerCase().includes(searchQ))
    : CATALOG[activeSector] || [];

  if (!syms.length) {
    el.innerHTML = '<div class="empty-msg">No matches</div>';
    return;
  }

  el.innerHTML = syms.map(s => {
    const inList  = st.watchlist.includes(s);
    const blocked = atLimit && !inList;
    return `<button class="schip${inList ? ' in' : ''}${blocked ? ' blocked' : ''}"
      data-sym="${s}" ${blocked ? 'title="Watchlist full (15 max)" disabled' : ''}>
      ${label(s)}<span class="schip-icon">${inList ? '✓' : blocked ? '—' : '+'}</span>
    </button>`;
  }).join('');

  el.querySelectorAll('.schip:not([disabled])').forEach(b => {
    b.addEventListener('click', () => {
      st.watchlist.includes(b.dataset.sym) ? remove(b.dataset.sym) : add(b.dataset.sym);
    });
  });
}

function add(sym) {
  if (st.watchlist.includes(sym)) return;
  if (st.watchlist.length >= MAX_SYMBOLS) return;
  // Extra safety: only allow catalog symbols
  if (!ALL_SYMBOLS.includes(sym)) return;
  st.watchlist.push(sym);
  chrome.storage.local.set({ [SK.LIST]: st.watchlist });
  renderWatchlist();
  renderGrid();
}

// ── Search ────────────────────────────────────────────────────────────────────
document.getElementById('sym-search')?.addEventListener('input', e => {
  searchQ = e.target.value.trim().toLowerCase();
  renderSectors();
  renderGrid();
});
