/* Home navigation (DD-207, DD-210, DD-008).
   1. Layers: Esc and Back pop the top layer, in this order: open dialogs, the drawer, the RisuRealm hub, Recently deleted, Manage mode, library search text, then the root.
      The hub and Recently deleted push a history entry (DD-207); dialogs, the drawer, Manage mode and search text do not, so Back there closes the layer and re-pushes the entry it consumed.
      At the root, the first Back shows the DD-008 toast; a second Back within the toast's lifetime "quits" (simulated).
   2. Return contract (DD-210): every link to chat, Settings or Studio carries from=home&lang=&mode=&return=<this page, with restore=1>. Before leaving, Home parks its drafts, view state and scroll in
      sessionStorage and marks its own history entry restore=1, so the browser's Back and a "return" link both land on a Home that restores them once.
   Mockup only: the storage is the tab's sessionStorage; no real app storage is read or written. */
(function () {
  'use strict';
  var H = window.Home; var S = H.S; var P = H.P; var t = H.t;
  var Nav = H.Nav = {};
  var KEY = 'nexus-home-handoff';
  var file = location.pathname.split('/').pop() || 'home.html';

  // ---------- URLs and links ----------
  // Home's own URL with the state that must survive a round trip. `rel` = relative to a sibling folder (../home/home.html), else relative to this page.
  Nav.homeQuery = function (restore) {
    var q = new URLSearchParams();
    q.set('mode', S.mode);
    q.set('lang', H.lang);
    ['only', 'theme', 'fixture', 'still', 'lowpower', 'occasion', 'first', 'input', 'motion', 'controls', 'realm', 'runs', 'name', 'date'].forEach(function (k) { if (P.get(k) !== null && P.get(k) !== '') q.set(k, P.get(k)); });
    if (S.only) q.set('only', S.only);
    if (restore) q.set('restore', '1');
    return q.toString();
  };
  Nav.returnUrl = function () { return '../home/' + file + '?' + Nav.homeQuery(true); };
  var BASES = { chat: '../chat/slice2.html', settings: '../settings/index.html', studio: '../studio/slice1.html', realm: '../mockups/realm.html', task: '../mockups/task-detail.html' };
  // from=home&lang=&mode=&return= on every out-link (DD-210). `extra` is a plain object of target-specific parameters.
  Nav.href = function (target, extra) {
    var q = new URLSearchParams();
    q.set('from', 'home'); q.set('lang', H.lang); q.set('mode', S.mode); q.set('return', Nav.returnUrl());
    Object.keys(extra || {}).forEach(function (k) { q.set(k, extra[k]); });
    return BASES[target] + '?' + q.toString();
  };
  Nav.links = {
    chat: function (charId) { return Nav.href('chat', { char: charId }); },
    persona: function () { return Nav.href('settings', { page: 'persona' }); },
    models: function () { return Nav.href('settings', { page: 'models' }); },
    prompts: function () { return Nav.href('settings', { page: 'models', section: 'prompts' }); },
    settings: function () { return Nav.href('settings', {}); },
    settingsRepair: function () { return Nav.href('settings', { page: 'display', fixture: 'all-modes-hidden-repair' }); },
    studio: function () { return Nav.href('studio', {}); },
    realm: function () { return Nav.href('realm', {}); },
    task: function (c) { return Nav.href('task', { case: c || 'unknown' }); }
  };

  // ---------- handoff ----------
  Nav.save = function () {
    var snap = { v: 1, at: Date.now(), mode: S.mode, drafts: S.drafts, scrollY: Math.round(window.scrollY || 0), search: S.search, sort: S.sort, folder: S.folder, libView: S.lib.view, trashSearch: S.lib.trashSearch, companion: S.companion, framing: S.framing, tools: S.tools, lore: S.lore, utilTools: S.utilTools, utilWeb: S.utilWeb, utilCollapsed: S.utilCollapsed };
    try { sessionStorage.removeItem(KEY + '-used'); sessionStorage.setItem(KEY, JSON.stringify(snap)); } catch (e) { /* storage blocked: the link still works, nothing is parked */ }
    try { var u = new URL(location.href); u.search = '?' + Nav.homeQuery(true); history.replaceState(history.state, '', u.pathname + u.search); } catch (e) { /* ignore */ }
  };
  Nav.take = function () {
    var restore = P.get('restore') === '1'; var raw = null; var done = false;
    if (restore) suppressRoot = true;
    try { raw = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); done = sessionStorage.getItem(KEY + '-used') === '1'; if (raw) sessionStorage.setItem(KEY + '-used', '1'); } catch (e) { /* ignore */ }
    Nav.cleanRestore();
    if (!restore) return null;
    if (!raw) { if (!done) Nav.draftLost = true; return null; }          // n6: a replayed restore URL (the snapshot was already used) is not a loss          // we left with a parked snapshot and it is gone (storage cleared or blocked): say so
    try {
      var d = JSON.parse(raw);
      if (!d || d.v !== 1 || !d.drafts) { Nav.draftLost = true; return null; }
      d.drafts = { hybrid: String(d.drafts.hybrid || ''), utility: String(d.drafts.utility || '') };
      return d;
    } catch (e) { Nav.draftLost = true; return null; }
  };
  Nav.cleanRestore = function () {
    try { var u = new URL(location.href); if (u.searchParams.has('restore')) { u.searchParams.delete('restore'); history.replaceState(history.state, '', u.pathname + u.search); } } catch (e) { /* ignore */ }
  };
  // Back/forward cache keeps the live page; the parked copy is then stale.
  addEventListener('pageshow', function (e) { if (e.persisted) { suppressRoot = true; try { sessionStorage.removeItem(KEY); } catch (err) { /* ignore */ } Nav.cleanRestore(); } });
  // a plain link to another screen: park Home first, then the browser follows the href
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-out]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    Nav.save();
    var st = document.getElementById('mode-status'); if (st) st.textContent = t('link.opening', { what: a.getAttribute('data-out-label') || '' });
  }, true);
  Nav.goOut = function (url, label) { Nav.save(); var st = document.getElementById('mode-status'); if (st) st.textContent = t('link.opening', { what: label || '' }); location.href = url; };

  // ---------- history: the root guard, the hub and Recently deleted ----------
  var suppressRoot = false;          // DD-264: the first Back after a restore must not show the root toast
  var stack = ['guard', 'root']; var silent = 0; var toastTimer = 0; var toastUp = false;
  function stateFor(i, id) { return { home: 1, i: i, id: id }; }
  Nav.stack = function () { return stack.slice(); };
  Nav.init = function () {
    try { history.replaceState(stateFor(0, 'guard'), '', location.href); history.pushState(stateFor(1, 'root'), '', location.href); } catch (e) { /* ignore */ }
    stack = ['guard', 'root'];
  };
  Nav.push = function (id) {
    stack.push(id);
    try { history.pushState(stateFor(stack.length - 1, id), '', location.href); } catch (e) { /* ignore */ }
  };
  // the layer was closed by something other than Back (a mode switch, Done, a restore): take its entry off, quietly
  Nav.drop = function (id) {
    if (stack[stack.length - 1] === id) { silent++; try { history.back(); } catch (e) { silent--; stack.pop(); } }
    else { var i = stack.lastIndexOf(id); if (i > 1) stack.splice(i, 1); }
  };
  // Esc, the on-screen back controls and the mouse's Back button all come here
  Nav.back = function (src) {
    var top = H.topLayer && H.topLayer();
    if (!top) { if (src === 'esc') return false; try { history.back(); } catch (e) { /* ignore */ } return true; }
    if (top.history) { try { history.back(); } catch (e) { top.close(src); } return true; }
    top.close(src); return true;
  };
  addEventListener('popstate', function (e) {
    if (silent > 0) { silent--; stack.pop(); return; }
    var idx = e.state && e.state.home ? e.state.i : -1;
    if (idx < 0) return;
    var sup = suppressRoot; suppressRoot = false;
    var moved = stack.length - 1 - idx;
    if (moved < 0) { var fid = e.state.id; stack.length = idx; stack.push(fid); if (H.restoreLayer) H.restoreLayer(fid); return; }
    if (moved === 0) return;
    var removed = stack.slice(idx + 1); var leftId = removed[removed.length - 1];
    stack.length = idx + 1;
    var top = H.topLayer && H.topLayer();
    if (top && top.history && top.id === leftId) { top.close('back'); return; }
    if (top) {
      top.close('back');
      removed.forEach(function (id) { stack.push(id); try { history.pushState(stateFor(stack.length - 1, id), '', location.href); } catch (err) { /* ignore */ } });
      return;
    }
    if (removed[0] === 'root' || leftId === 'root') { rootBack(sup); return; }
  });
  function rootBack(quiet) {
    if (toastUp) { Nav.quit(); return; }
    if (!quiet) Nav.toast(t('toast.backQuit'));
    stack.push('root'); try { history.pushState(stateFor(stack.length - 1, 'root'), '', location.href); } catch (e) { /* ignore */ }
  }
  Nav.quit = function () {
    if (P.get('controls') !== '0') Nav.toast(t('mock.quit'), { mock: true });
    document.documentElement.setAttribute('data-quit', '1');
  };
  // mouse back button (button 3) is a real Back; keyboard Esc is routed from app.js
  // ---------- toast ----------
  Nav.toast = function (text, o) {
    o = o || {}; var el = document.getElementById('toast'); if (!el) return;
    var ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--home-toast-ms')) || 2500;
    el.textContent = text; el.setAttribute('data-open', ''); if (o.mock) el.setAttribute('data-mock', ''); else el.removeAttribute('data-mock');
    toastUp = !o.mock; clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.removeAttribute('data-open'); toastUp = false; }, ms);
  };
  Nav.toastUp = function () { return toastUp; };
})();
