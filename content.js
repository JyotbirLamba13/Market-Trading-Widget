/**
 * content.js — Market Ticker Overlay
 *
 * Three states:
 *   FULL  — header + full price table, draggable by header
 *   MINI  — slim 44px bar, live prices for pinned symbols, no header chrome
 *   ICON  — small draggable pill: "NIFTY 24,432 ▲0.65%", click to expand
 */

(function () {
  'use strict';

  if (document.getElementById('mticker-host')) return;

  const SK = {
    STATE:  'widgetState',
    X:      'widgetX',
    Y:      'widgetY',
    THEME:  'widgetTheme',
    LIST:   'watchlist',
    PINNED: 'pinnedSymbols',
    HIDDEN: 'widgetHidden',
  };

  const DEFAULTS = {
    state:     'full',
    x:         20,
    y:         80,
    theme:     'dark',
    watchlist: ['NSE:NIFTY', 'BSE:SENSEX', 'NSE:RELIANCE', 'NSE:HDFCBANK', 'NSE:TCS'],
    pinned:    ['NSE:NIFTY', 'BSE:SENSEX'],
  };

  let cfg         = { ...DEFAULTS };
  let host        = null;
  let shadow      = null;
  let quotes      = {};
  let lastUpdated = null;
  let isDragging  = false;
  let drag        = {};

  const $ = id => shadow && shadow.getElementById(id);

  // ══════════════════════════════════════════════════════════════════════════
  //  BOOTSTRAP
  // ══════════════════════════════════════════════════════════════════════════

  chrome.storage.local.get(
    [SK.STATE, SK.X, SK.Y, SK.THEME, SK.LIST, SK.PINNED, SK.HIDDEN],
    res => {
      cfg.state     = res[SK.STATE]                       || DEFAULTS.state;
      cfg.x         = typeof res[SK.X] === 'number' ? res[SK.X]  : DEFAULTS.x;
      cfg.y         = typeof res[SK.Y] === 'number' ? res[SK.Y]  : DEFAULTS.y;
      cfg.theme     = res[SK.THEME]                       || DEFAULTS.theme;
      cfg.watchlist = res[SK.LIST]                        || DEFAULTS.watchlist;
      cfg.pinned    = res[SK.PINNED]                      || DEFAULTS.pinned;
      buildWidget();
      if (res[SK.HIDDEN]) hide();
      startPolling();
    }
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !shadow) return;
    if (changes[SK.HIDDEN]) { changes[SK.HIDDEN].newValue ? hide() : show(); return; }
    if (changes[SK.STATE])  { cfg.state = changes[SK.STATE].newValue; applyState(); return; }
    if (changes[SK.THEME])  { cfg.theme = changes[SK.THEME].newValue; applyTheme(); }
    let refetch = false;
    if (changes[SK.LIST])   { cfg.watchlist = changes[SK.LIST].newValue;   refetch = true; }
    if (changes[SK.PINNED]) { cfg.pinned    = changes[SK.PINNED].newValue; }
    if (refetch) fetchAndRender(); else renderAll();
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  BUILD
  // ══════════════════════════════════════════════════════════════════════════

  function buildWidget() {
    host = document.createElement('div');
    host.id = 'mticker-host';
    host.style.cssText =
      'all:unset;position:fixed!important;z-index:2147483647!important;' +
      `left:${clampX(cfg.x)}px;top:${clampY(cfg.y)}px;`;
    document.body.appendChild(host);

    shadow = host.attachShadow({ mode: 'open' });
    const sty = document.createElement('style');
    sty.textContent = CSS;
    shadow.appendChild(sty);

    const root = document.createElement('div');
    root.id = 'mt-root';
    root.innerHTML = TEMPLATE;
    shadow.appendChild(root);

    applyState();
    applyTheme();
    setupDrag();
    setupControls();
  }

  // ── Template ───────────────────────────────────────────────────────────────
  // Three visually distinct regions, only one visible per state.
  const TEMPLATE = `
<div id="mt-icon-pill" title="Expand">
  <span id="mt-icon-label">MARKET TICKER</span>
</div>

<div id="mt-mini-bar">
  <div id="mt-mini-pills"></div>
  <button class="mt-mini-expand" id="mt-mini-expand-btn" title="Expand">↑</button>
</div>

<div id="mt-panel">
  <div id="mt-header">
    <span class="mt-logo">${svgChart(12)} MARKET TICKER</span>
    <div class="mt-ctrls">
      <button class="mt-btn" id="mt-min"   title="Minimise">${svgMinus()}</button>
      <button class="mt-btn" id="mt-close" title="Hide">${svgX()}</button>
    </div>
  </div>
  <div id="mt-loading"><span></span><span></span><span></span></div>
  <div id="mt-rows"></div>
  <div id="mt-footer"><span id="mt-ts"></span></div>
</div>`;

  // ══════════════════════════════════════════════════════════════════════════
  //  DATA
  // ══════════════════════════════════════════════════════════════════════════

  const POLL_MS = 30_000;
  let pollTimer = null;

  function startPolling() {
    fetchAndRender();
    pollTimer = setInterval(fetchAndRender, POLL_MS);
  }

  async function fetchAndRender() {
    const syms = [...new Set([...(cfg.pinned || []), ...(cfg.watchlist || [])])];
    if (!syms.length) return;
    try {
      const results = await chrome.runtime.sendMessage({ type: 'FETCH_PRICES', symbols: syms });
      if (Array.isArray(results) && results.length) {
        results.forEach(q => { quotes[q.sym] = q; });
        lastUpdated = Date.now();
        hideLoading();
        renderAll();
      }
    } catch (e) {
      hideLoading();
    }
  }

  function hideLoading() {
    const el = $('mt-loading');
    if (el) el.style.display = 'none';
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════════════════

  function renderAll() {
    renderRows();
    renderMiniPills();
    renderIconPill();
    renderTimestamp();
  }

  // FULL state — price rows
  function renderRows() {
    const el = $('mt-rows');
    if (!el) return;

    const pinned = cfg.pinned || [];
    const rest   = (cfg.watchlist || []).filter(s => !pinned.includes(s));
    let html = '';

    const pinnedQ = pinned.map(s => quotes[s]).filter(Boolean);
    if (pinnedQ.length) {
      html += `<div class="mt-group">${pinnedQ.map(q => rowHTML(q, true)).join('')}</div>`;
    }

    const restQ = rest.map(s => quotes[s]).filter(Boolean);
    if (restQ.length) {
      if (pinnedQ.length) html += `<div class="mt-sep"></div>`;
      html += `<div class="mt-group">${restQ.map(q => rowHTML(q, false)).join('')}</div>`;
    }

    if (!html) html = `<div class="mt-empty">No data yet…</div>`;
    el.innerHTML = html;
  }

  function rowHTML(q, pinned) {
    if (!q?.ok) return `<div class="mt-row">
      <span class="mt-sym${pinned ? ' pin' : ''}">${q?.label || '—'}</span>
      <span class="mt-no-data">—</span></div>`;
    const pos  = q.change >= 0;
    const sign = pos ? '+' : '';
    return `<div class="mt-row">
      <span class="mt-sym${pinned ? ' pin' : ''}">${q.label}</span>
      <span class="mt-price">${fmtPrice(q.price)}</span>
      <span class="mt-chg ${pos ? 'pos' : 'neg'}">${sign}${fmtAbs(q.change)}&nbsp;<span class="mt-pct">(${sign}${fmtPct(q.pct)}%)</span></span>
    </div>`;
  }

  // MINI state — slim pill row
  function renderMiniPills() {
    const el = $('mt-mini-pills');
    if (!el) return;

    const syms = (cfg.pinned || []).filter(s => quotes[s]?.ok);
    if (!syms.length) {
      el.innerHTML = `<span class="mt-mini-wait">Loading…</span>`;
      return;
    }

    el.innerHTML = syms.map(s => {
      const q   = quotes[s];
      const pos = q.change >= 0;
      return `<span class="mt-mini-item">
        <span class="mt-mini-sym">${q.label}</span>
        <span class="mt-mini-price">${fmtCompact(q.price)}</span>
        <span class="mt-mini-pct ${pos ? 'pos' : 'neg'}">${pos ? '▲' : '▼'}${fmtPct(q.pct)}%</span>
      </span>`;
    }).join('<span class="mt-mini-div"></span>');
  }

  // ICON state — single pill with first pinned scrip
  function renderIconPill() {
    const el = $('mt-icon-label');
    if (!el) return;

    const sym = (cfg.pinned || [])[0];
    const q   = sym && quotes[sym];

    if (!q?.ok) {
      el.innerHTML = `${svgChart(11)} <span class="icon-sym">TICKER</span>`;
      return;
    }

    const pos  = q.change >= 0;
    const sign = pos ? '▲' : '▼';
    el.innerHTML =
      `<span class="icon-sym">${q.label}</span>` +
      `<span class="icon-price">${fmtCompact(q.price)}</span>` +
      `<span class="icon-chg ${pos ? 'pos' : 'neg'}">${sign}${fmtPct(q.pct)}%</span>`;
  }

  function renderTimestamp() {
    const el = $('mt-ts');
    if (!el || !lastUpdated) return;
    const sec = Math.round((Date.now() - lastUpdated) / 1000);
    el.textContent = sec < 5 ? '↻ just now' : `↻ ${sec}s ago`;
  }

  setInterval(() => { if (lastUpdated) renderTimestamp(); }, 5_000);

  // ══════════════════════════════════════════════════════════════════════════
  //  NUMBER FORMAT
  // ══════════════════════════════════════════════════════════════════════════

  function fmtPrice(n) {
    if (n == null || isNaN(n)) return '—';
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtAbs(n) {
    if (n == null || isNaN(n)) return '—';
    return Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPct(n) {
    if (n == null || isNaN(n)) return '—';
    return Math.abs(n).toFixed(2);
  }
  function fmtCompact(n) {
    if (n == null || isNaN(n)) return '—';
    return n >= 10000
      ? Math.round(n).toLocaleString('en-IN')
      : n.toLocaleString('en-IN', { maximumFractionDigits: 1 });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  STATE
  // ══════════════════════════════════════════════════════════════════════════

  function applyState() {
    const r = $('mt-root');
    if (r) r.setAttribute('data-state', cfg.state);
  }

  function applyTheme() {
    const r = $('mt-root');
    if (r) r.setAttribute('data-theme', cfg.theme);
  }

  function setState(s) {
    cfg.state = s;
    chrome.storage.local.set({ [SK.STATE]: s });
    applyState();
    if (s === 'mini') renderMiniPills();
    if (s === 'icon') renderIconPill();
  }

  function hide() {
    if (host) { host.style.opacity = '0'; host.style.pointerEvents = 'none'; }
  }
  function show() {
    if (host) { host.style.opacity = ''; host.style.pointerEvents = ''; }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  DRAG — works on all three states (header, mini bar, icon pill)
  // ══════════════════════════════════════════════════════════════════════════

  function setupDrag() {
    // Attach mousedown to each draggable element
    const dragTargets = ['mt-header', 'mt-mini-bar', 'mt-icon-pill'];
    dragTargets.forEach(id => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('mousedown', e => {
        // Don't drag when clicking buttons
        if (e.target.closest('button')) return;
        startDrag(e);
      });
    });

    document.addEventListener('mousemove', e => {
      if (!isDragging) return;
      host.style.left = clampX(drag.origX + (e.clientX - drag.startX)) + 'px';
      host.style.top  = clampY(drag.origY + (e.clientY - drag.startY)) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      chrome.storage.local.set({
        [SK.X]: parseFloat(host.style.left) || 0,
        [SK.Y]: parseFloat(host.style.top)  || 0,
      });
    });
  }

  function startDrag(e) {
    isDragging  = true;
    drag.startX = e.clientX;
    drag.startY = e.clientY;
    drag.origX  = parseFloat(host.style.left) || cfg.x;
    drag.origY  = parseFloat(host.style.top)  || cfg.y;
    e.preventDefault();
  }

  function clampX(x) { return Math.max(0, Math.min(x, window.innerWidth  - (host?.offsetWidth  || 300))); }
  function clampY(y) { return Math.max(0, Math.min(y, window.innerHeight - 36)); }

  // ══════════════════════════════════════════════════════════════════════════
  //  CONTROLS
  // ══════════════════════════════════════════════════════════════════════════

  function setupControls() {
    // Icon pill: click (not drag) → mini
    $('mt-icon-pill')?.addEventListener('click', e => {
      if (!isDragging) setState('mini');
    });

    // Mini bar expand button → full
    $('mt-mini-expand-btn')?.addEventListener('click', () => setState('full'));

    // Header min button: full → mini → icon
    $('mt-min')?.addEventListener('click', () => {
      setState(cfg.state === 'full' ? 'mini' : 'icon');
    });

    // Close → hide
    $('mt-close')?.addEventListener('click', () => {
      chrome.storage.local.set({ [SK.HIDDEN]: true });
      hide();
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  CSS — shadow DOM, full isolation
  // ══════════════════════════════════════════════════════════════════════════

  const CSS = `
:host { display: block; }

/* ── Shared theme vars ── */
#mt-root[data-theme="dark"] {
  --bg:      #0d1117;
  --hdr:     #161b22;
  --bdr:     rgba(255,255,255,0.08);
  --bdr2:    rgba(255,255,255,0.04);
  --text:    #e6edf3;
  --sub:     #7d8590;
  --pos:     #3fb950;
  --neg:     #f85149;
  --pos-bg:  rgba(63,185,80,0.11);
  --neg-bg:  rgba(248,81,73,0.11);
  --row-ho:  rgba(255,255,255,0.03);
  --sep:     rgba(255,255,255,0.06);
  --shadow:  0 12px 40px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.3);
}

#mt-root[data-theme="light"] {
  --bg:      #ffffff;
  --hdr:     #f6f8fa;
  --bdr:     rgba(0,0,0,0.09);
  --bdr2:    rgba(0,0,0,0.04);
  --text:    #1f2328;
  --sub:     #656d76;
  --pos:     #1a7f37;
  --neg:     #cf222e;
  --pos-bg:  rgba(26,127,55,0.09);
  --neg-bg:  rgba(207,34,46,0.09);
  --row-ho:  rgba(0,0,0,0.02);
  --sep:     rgba(0,0,0,0.07);
  --shadow:  0 12px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.09);
}

/* ── Default hidden for all regions ── */
#mt-icon-pill, #mt-mini-bar, #mt-panel { display: none; }

/* ── ICON state — show only pill ── */
#mt-root[data-state="icon"]  #mt-icon-pill { display: flex; }

/* ── MINI state — show only mini bar ── */
#mt-root[data-state="mini"]  #mt-mini-bar  { display: flex; }

/* ── FULL state — show only panel ── */
#mt-root[data-state="full"]  #mt-panel     { display: block; }

/* ══ ICON PILL ══════════════════════════════════════════════════════════════ */
#mt-icon-pill {
  align-items: center;
  gap: 7px;
  padding: 7px 12px 7px 10px;
  border-radius: 22px;
  background: var(--hdr);
  border: 1px solid var(--bdr);
  box-shadow: var(--shadow);
  cursor: grab;
  user-select: none;
  white-space: nowrap;
  font-family: 'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace;
  font-size: 11px;
  color: var(--text);
  transition: box-shadow 0.15s;
}
#mt-icon-pill:active { cursor: grabbing; }
#mt-icon-pill:hover  { box-shadow: 0 6px 24px rgba(0,0,0,0.45); }

#mt-icon-label { display: flex; align-items: center; gap: 6px; }

.icon-sym   { font-weight: 700; letter-spacing: 0.04em; color: var(--text); }
.icon-price { font-weight: 600; color: var(--text); }
.icon-chg   { font-size: 10px; font-weight: 600; }
.icon-chg.pos { color: var(--pos); }
.icon-chg.neg { color: var(--neg); }

/* ══ MINI BAR ════════════════════════════════════════════════════════════════ */
#mt-mini-bar {
  align-items: center;
  gap: 0;
  padding: 0;
  height: 44px;
  border-radius: 12px;
  background: var(--hdr);
  border: 1px solid var(--bdr);
  box-shadow: var(--shadow);
  overflow: hidden;
  cursor: grab;
  user-select: none;
  font-family: 'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace;
}
#mt-mini-bar:active { cursor: grabbing; }

#mt-mini-pills {
  display: flex;
  align-items: center;
  flex: 1;
  height: 100%;
  overflow: hidden;
}

.mt-mini-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 14px;
  height: 100%;
  border-right: 1px solid var(--bdr);
  white-space: nowrap;
}

.mt-mini-sym {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--sub);
}
.mt-mini-price {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.01em;
}
.mt-mini-pct {
  font-size: 10px;
  font-weight: 600;
}
.mt-mini-pct.pos { color: var(--pos); }
.mt-mini-pct.neg { color: var(--neg); }

.mt-mini-div {
  width: 1px;
  height: 60%;
  background: var(--bdr);
  flex-shrink: 0;
}

.mt-mini-wait {
  padding: 0 14px;
  font-size: 10px;
  color: var(--sub);
  opacity: 0.5;
  font-family: 'SF Mono', ui-monospace, monospace;
}

/* Expand button */
.mt-mini-expand {
  all: unset;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 100%;
  flex-shrink: 0;
  cursor: pointer;
  font-size: 12px;
  color: var(--sub);
  border-left: 1px solid var(--bdr);
  transition: color 0.12s, background 0.12s;
}
.mt-mini-expand:hover { color: var(--text); background: var(--row-ho); }

/* ══ FULL PANEL ══════════════════════════════════════════════════════════════ */
#mt-panel {
  width: 300px;
  background: var(--bg);
  border: 1px solid var(--bdr);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--shadow);
  font-family: 'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace;
}

#mt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  min-height: 34px;
  background: var(--hdr);
  border-bottom: 1px solid var(--bdr);
  cursor: grab;
  color: var(--text);
}
#mt-header:active { cursor: grabbing; }

.mt-logo {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  opacity: 0.85;
  user-select: none;
}

.mt-ctrls { display: flex; gap: 2px; }

.mt-btn {
  all: unset;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  cursor: pointer;
  color: var(--sub);
  transition: color 0.12s, background 0.12s;
}
.mt-btn:hover { color: var(--text); background: rgba(125,133,144,0.15); }

/* Loading */
#mt-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 18px 0;
}
#mt-loading span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--sub);
  animation: blink 1.2s ease-in-out infinite;
}
#mt-loading span:nth-child(2) { animation-delay: 0.2s; }
#mt-loading span:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink {
  0%,80%,100% { opacity:0.2; transform:scale(0.8); }
  40%         { opacity:1;   transform:scale(1); }
}

/* Price rows */
.mt-group { padding: 4px 0; }

.mt-row {
  display: flex;
  align-items: center;
  padding: 5px 10px;
  gap: 6px;
  font-size: 11px;
}
.mt-row:hover { background: var(--row-ho); }

.mt-sym {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--sub);
  width: 86px;
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mt-sym.pin { color: var(--text); }

.mt-price {
  flex: 1;
  font-weight: 600;
  color: var(--text);
  text-align: right;
  white-space: nowrap;
}

.mt-chg {
  font-size: 10px;
  font-weight: 500;
  text-align: right;
  white-space: nowrap;
  min-width: 92px;
}
.mt-chg.pos { color: var(--pos); }
.mt-chg.neg { color: var(--neg); }
.mt-pct { opacity: 0.8; }
.mt-no-data { flex:1; text-align:right; color:var(--sub); opacity:0.4; }

.mt-sep {
  height: 1px;
  background: var(--sep);
  margin: 2px 10px;
}

.mt-empty {
  padding: 14px 10px;
  font-size: 10px;
  color: var(--sub);
  opacity: 0.6;
  text-align: center;
}

/* Footer */
#mt-footer {
  padding: 4px 10px 6px;
  border-top: 1px solid var(--bdr2);
}
#mt-ts {
  font-size: 9px;
  color: var(--sub);
  opacity: 0.45;
}
`;

  // ══════════════════════════════════════════════════════════════════════════
  //  SVG ICONS
  // ══════════════════════════════════════════════════════════════════════════

  function svgChart(s) {
    return `<svg width="${s}" height="${s}" viewBox="0 0 20 20" fill="none" style="display:block;flex-shrink:0">
<rect x="1.5" y="1.5" width="17" height="17" rx="2.5" stroke="currentColor" stroke-width="1.4"/>
<polyline points="3,14.5 6.5,9.5 9.5,12.5 13.5,7 17,10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;
  }
  function svgMinus() {
    return `<svg width="11" height="11" viewBox="0 0 11 11" fill="none">
<line x1="2" y1="5.5" x2="9" y2="5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  }
  function svgX() {
    return `<svg width="11" height="11" viewBox="0 0 11 11" fill="none">
<line x1="2" y1="2" x2="9" y2="9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
<line x1="9" y1="2" x2="2" y2="9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  }

})();
