// Refresh registry: each live-data builder calls registerRefresh(fn) so
// the global timer in main.js can repaint them without a full reload.
// Hoisted out of builders.js so all per-domain modules can import it.

const _refreshers = [];
export function registerRefresh(fn) { _refreshers.push(fn); }
export function runAllRefreshers() {
  _refreshers.forEach(function(fn) {
    try { fn(); } catch (e) { console.warn("refresh failed:", e); }
  });
}
