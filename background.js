/**
 * background.js — Market Ticker Service Worker
 *
 * DATA SOURCE: TradingView Scanner API (scanner.tradingview.com/india/scan)
 *
 * Why this endpoint:
 *  - Same real-time feed powering TradingView's own screener
 *  - No API key required
 *  - CORS-open (Access-Control-Allow-Origin: *)
 *  - Accepts symbols in NSE:SYMBOL / BSE:SYMBOL format directly — no mapping
 *  - Covers every NSE and BSE listed stock + all indices
 *
 * Why fetch here (service worker) and not in content.js:
 *  - Content scripts in MV3 run in an isolated world. fetch() from there is
 *    subject to the HOST PAGE's CORS policy, which can block cross-origin calls.
 *  - Service workers fetch with extension-level permissions — host_permissions
 *    in manifest.json grants unconditional cross-origin access to the domain,
 *    bypassing CORS entirely.
 */

'use strict';

const TV_SCAN_URL = 'https://scanner.tradingview.com/india/scan';

// Columns returned per symbol from the scanner.
// Order must match COLUMNS array below.
const COLUMNS = ['close', 'change', 'change_abs'];
// close       = last traded price
// change      = % change from previous close (e.g. 0.67 = +0.67%)
// change_abs  = absolute change in currency units

async function fetchPrices(symbols) {
  const body = JSON.stringify({
    symbols: { tickers: symbols },
    columns: COLUMNS,
  });

  const res = await fetch(TV_SCAN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) throw new Error(`Scanner HTTP ${res.status}`);
  const json = await res.json();

  return (json.data || []).map(item => {
    const [price, pct, change] = item.d || [];
    return {
      sym:    item.s,
      label:  item.s.split(':')[1] || item.s,
      price:  price  ?? null,
      pct:    pct    ?? null,
      change: change ?? null,
      ok:     price != null,
    };
  });
}

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'FETCH_PRICES') return false;

  const symbols = msg.symbols || [];
  if (!symbols.length) { sendResponse([]); return true; }

  fetchPrices(symbols)
    .then(sendResponse)
    .catch(err => {
      console.warn('[MarketTicker] fetchPrices failed:', err.message);
      // Return error stubs so content.js can show graceful error state
      sendResponse(symbols.map(s => ({ sym: s, label: s.split(':')[1] || s, ok: false })));
    });

  return true; // keep channel open for async sendResponse
});
