/* Home library lifecycle (E01, DD-214): search, sort, folders, Manage mode, Recently deleted (최근 삭제). Simulated in memory; nothing is stored or sent.
   Recently deleted keeps a character for Home.DAYS_KEPT (30) days; its chats are hidden with it and come back on restore (DD-214). A character's record stays in store.chars; the library order and
   the trash list hold ids only (DD-157). */
(function () {
  'use strict';
  var H = window.Home; var S = H.S; var store = H.store; var t = H.t; var loc = H.loc; var esc = H.esc; var R = H.R; var Tasks = H.Tasks; var Nav = H.Nav; var P = H.P;
  var L = S.lib; var $ = function (s, r) { return (r || document).querySelector(s); };
  var wait = function (ms) { return new Promise(function (res) { setTimeout(res, ms); }); };
  var main = function () { return document.getElementById('main'); };
  var has = function (arr, id) { return arr.indexOf(id) >= 0; };
  var add = function (arr, id) { if (!has(arr, id)) arr.push(id); };
  var del = function (arr, id) { var i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); };
  var rowBtn = function (id) { return $('#main [data-key="char-' + CSS.escape(id) + '"]'); };
  var noMock = P.get('controls') === '0';

  // ---------- one modal with a promise result. Esc/backdrop resolve 'cancel'. Focus returns to the invoker when it still exists. ----------
  H.simDialog = function (o) {
    return new Promise(function (resolve) {
      var dlg = document.getElementById('sim'); var invoker = document.activeElement;
      var crit = !!o.critical;
      dlg.setAttribute('data-part', crit ? 'home-confirm' : 'home-dialog');
      if (crit) dlg.setAttribute('data-part-critical', ''); else dlg.removeAttribute('data-part-critical');
      var ti = document.getElementById('sim-title'); ti.textContent = o.title; ti.setAttribute('data-part', crit ? 'home-confirm-title' : 'home-dialog-title');
      var tx = document.getElementById('sim-text'); tx.textContent = o.text || ''; tx.hidden = !o.text; tx.setAttribute('data-part', crit ? 'home-confirm-body' : 'home-dialog-body');
      var mk = document.getElementById('sim-mock'); if (mk) { mk.textContent = o.mock || ''; mk.hidden = !o.mock || noMock; }
      var foot = document.getElementById('sim-actions'); foot.setAttribute('data-part', crit ? 'home-confirm-actions' : 'home-dialog-actions');
      var part = crit ? 'home-confirm-action' : 'home-dialog-action';
      foot.innerHTML = o.actions.map(function (a) {
        return a.href ? '<a class="btn" data-part="' + part + '" data-variant="raised" href="' + esc(a.href) + '" data-out data-out-label="' + esc(a.outLabel || '') + '">' + esc(a.label) + '</a>'
          : '<button type="button" class="btn" data-part="' + part + '" data-variant="' + (a.primary ? 'primary' : a.danger ? 'danger' : 'raised') + '" data-sim="' + esc(a.id) + '">' + esc(a.label) + '</button>';
      }).join('');
      var done = function () { dlg.removeEventListener('close', done); var r = dlg.returnValue || 'cancel'; if (invoker && invoker.isConnected && invoker !== document.body) invoker.focus(); resolve(r); };
      dlg.addEventListener('close', done);
      dlg.returnValue = '';
      H.openDialog(dlg);
      (foot.querySelector('[data-sim="' + CSS.escape(o.initial || 'cancel') + '"]') || foot.querySelector('button')).focus();
    });
  };
  (function () {
    var dlg = document.getElementById('sim');
    dlg.addEventListener('click', function (e) { var b = e.target.closest('[data-sim]'); if (b) dlg.close(b.dataset.sim); else if (e.target === dlg) dlg.close('cancel'); });
  })();

  // ---------- messages ----------
  H.setMsg = function (kind, text, actions) {
    actions = actions || [];
    L.msg = text ? { kind: kind, text: text, actions: actions } : null;
    var el = document.getElementById('lib-msg'); if (!el) return;
    el.innerHTML = L.msg ? '<div class="lib-msg" data-part="' + (kind === 'err' ? 'home-bulk-result' : 'home-lib-msg') + '"' + (kind === 'err' ? ' data-part-critical' : '') + ' data-kind="' + kind + '"><span>' + esc(text) + '</span>' +
      actions.map(function (a) { return '<button type="button" class="btn" data-variant="raised" data-lib="' + a.id + '">' + esc(a.label) + '</button>'; }).join('') +
      '<button type="button" class="btn" data-variant="raised" data-lib="dismiss-msg" aria-label="' + esc(t('msg.dismissLabel')) + '">' + esc(t('msg.dismiss')) + '</button></div>' : '';
  };
  var restoreMsg = function () { if (L.msg) H.setMsg(L.msg.kind, L.msg.text, L.msg.actions); };
  H.restoreLibMsg = restoreMsg;

  // ---------- grid ----------
  H.renderCharGrid = function () {
    var grid = document.getElementById('char-grid');
    var cnt = document.getElementById('lib-count');
    if (!grid) { if (cnt) cnt.textContent = L.view === 'trash' ? t('lib.countTrash', { shown: R.trashMatches().length, total: store.trash.length }) : ''; return; }
    var q = S.search.trim().toLowerCase();
    var list = store.order.map(function (id) { return store.chars[id]; }).filter(function (c) { return (!S.folder || c.folder === S.folder) && (!q || loc(c.name).toLowerCase().indexOf(q) >= 0); });
    var by = { order: function (a, b) { return store.order.indexOf(a.id) - store.order.indexOf(b.id); }, recent: function (a, b) { return a.recent - b.recent; }, name: function (a, b) { return loc(a.name).localeCompare(loc(b.name), H.lang); } }[S.sort];
    list.sort(by);
    L.visible = list.map(function (c) { return c.id; });
    cnt.textContent = t('lib.count', { shown: list.length, total: store.order.length });
    grid.setAttribute('data-manage', String(L.manage));
    grid.innerHTML = list.length ? list.map(function (c, i) { return R.charRow(c, i, list.length); }).join('')
      : S.search.trim() ? '<div class="empty-lib span-all">' + esc(t('char.noMatch')) + '<br><button type="button" class="btn" data-variant="raised" data-lib="clear-search">' + esc(t('char.clearSearch')) + '</button></div>'
      : '<div class="empty-lib span-all">' + esc(t('char.noFolder')) + '</div>';
    if (L.manage && !R.canReorder() && list.length) grid.insertAdjacentHTML('beforeend', '<p class="muted small span-all reorder-hint">' + esc(t('char.reorderHint')) + '</p>');
    updateSelBar();
  };
  function updateSelBar() {
    var bar = document.getElementById('sel-bar'); if (!bar) return;
    var n = L.sel.length; var hidden = L.sel.filter(function (id) { return !has(L.visible, id); }).length;
    document.getElementById('sel-count').textContent = n ? (hidden ? t('sel.hidden', { n: n, h: hidden }) : t('sel.n', { n: n })) : (L.msg ? t('sel.none2') : t('sel.none'));
    bar.querySelectorAll('[data-needs-sel]').forEach(function (b) { b.setAttribute('aria-disabled', String(!n)); });
    var sp = bar.querySelector('.sel-phone'); if (sp) sp.setAttribute('aria-label', n ? t('sel.actionsN', { n: n }) : t('sel.actions0'));
  }
  H.updateSelBar = updateSelBar;
  H.updateFolders = function () {
    var focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.folder : '';
    var f = document.getElementById('folders'); if (f) f.innerHTML = R.foldersHtml();
    if (focused) { var b = $('[data-folder="' + focused + '"]'); if (b) b.focus(); }
    H.renderCharGrid();
  };
  H.renderLib = function () {
    var body = document.getElementById('lib-body'); if (!body) return;
    body.innerHTML = R.libBody();
    var lib = $('[data-part="home-library"]'); if (lib) { lib.setAttribute('data-manage', String(L.manage)); lib.setAttribute('data-library-view', L.view); }
    document.body.dataset.libfocus = S.mode === 'rp' && !S.hubOpen && (L.view === 'trash' || L.manage) ? 'on' : '';
    H.renderCharGrid(); if (L.view === 'trash') updateTrashCount();
    if (H.applyMarks) H.applyMarks();
  };
  function updateTrashCount() { var c = document.getElementById('lib-count'); if (c) c.textContent = t('lib.countTrash', { shown: R.trashMatches().length, total: store.trash.length }); }
  H.updateTrash = function () {
    var list = document.getElementById('trash-list'); if (!list) return;
    var had = document.activeElement && document.activeElement.closest && document.activeElement.closest('#trash-list') ? document.activeElement.dataset.id : null;
    list.innerHTML = R.trashListHtml();
    document.getElementById('trash-scope').textContent = R.trashScope();
    var b = document.getElementById('trash-empty'); b.textContent = R.trashEmptyLabel();
    if (!R.trashMatches().length) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
    updateTrashCount();
    if (had) { var nb = list.querySelector('[data-lib="restore"][data-id="' + CSS.escape(had) + '"]'); if (nb) nb.focus(); }
  };

  // ---------- layers owned by the library ----------
  H.exitManage = function () {
    var target = L.lastRow; L.manage = false; L.sel = [];
    H.renderLib();
    var b = (target && rowBtn(target)) || $('#main [data-lib="manage"]'); if (b) b.focus();
  };
  H.clearSearch = function () { S.search = ''; var i = document.getElementById('lib-search'); if (i) i.value = ''; H.renderCharGrid(); if (i) i.focus(); };
  H.openTrashView = function () {
    if (L.view === 'trash') return;
    L.view = 'trash'; L.manage = false; L.sel = []; H.setMsg(null); Nav.push('trash'); H.renderLib();
    var b = $('#main [data-lib="view-trash"]'); if (b) b.focus();
  };
  H.closeTrashView = function (focusTab) {
    if (L.view !== 'trash') return;
    L.view = 'library'; H.setMsg(null); H.renderLib();
    if (focusTab !== false) { var b = $('#main [data-lib="view-library"]'); if (b) b.focus(); }
  };

  // ---------- actions ----------
  async function trashSelected() {
    var ids = L.sel.filter(function (id) { return has(store.order, id); });
    if (!ids.length) return;
    var names = ids.map(function (id) { return H.name(id); });
    var r = await H.simDialog({
      critical: true, title: t('trash.title', { n: ids.length }),
      text: t('trash.text', { names: names.slice(0, 3).join(', '), more: names.length > 3 ? t('trash.moreN', { n: names.length - 3 }) : '' }), mock: t('mock.dlgTrash'),
      actions: [{ id: 'cancel', label: t('move.cancel') }, { id: 'go', label: t('trash.go', { n: ids.length }), danger: true }]
    });
    if (r !== 'go') return;
    H.setMsg('info', t('trash.moving', { n: ids.length }));
    await wait(500);
    var before = L.visible.slice();
    var failed = ids.filter(function (id) { return has(L.failIds, id); }); L.failIds = [];
    var moved = ids.filter(function (id) { return !has(failed, id); });
    moved.forEach(function (id) { del(store.order, id); store.trash.unshift({ id: id, days: 0 }); del(L.sel, id); if (S.companion === id) S.companion = ''; Tasks.cancelForChar(id); });
    var lastRemoved = Math.max.apply(null, moved.map(function (id) { return before.indexOf(id); }).concat([-1]));
    var remaining = before.filter(function (id) { return !has(moved, id); });
    var next = before.slice(lastRemoved + 1).filter(function (id) { return has(remaining, id); })[0] || remaining[remaining.length - 1] || '';
    L.lastRow = failed[0] || next;
    var failNames = failed.map(function (id) { return H.name(id); }).join(', ');
    if (failed.length) H.setMsg('err', t('trash.partial', { ok: moved.length, all: ids.length, names: failNames }), [{ id: 'view-trash', label: t('trash.view') }, { id: 'retry-trash', label: t('trash.partialRetry', { who: failed.length === 1 ? failNames : failed.length }) }]);
    else H.setMsg('ok', t('trash.ok', { n: moved.length }), [{ id: 'view-trash', label: t('trash.view') }]);
    H.render();
    var f = failed.length ? $('#main [data-sel="' + CSS.escape(failed[0]) + '"]') : (L.lastRow && $('#main [data-sel="' + CSS.escape(L.lastRow) + '"]')) || $('#main [data-lib="done"]') || $('#main [data-lib="view-trash"]');
    if (f) f.focus();
  }
  async function moveSelected() {
    var ids = L.sel.filter(function (id) { return has(store.order, id); });
    if (!ids.length) return;
    var r = await H.simDialog({ title: t('move.title', { n: ids.length }), actions: store.folders.map(function (f) { return { id: 'f:' + f[0], label: t(f[1]) }; }).concat([{ id: 'f:', label: t('move.noFolder') }, { id: 'cancel', label: t('move.cancel') }]) });
    if (r.indexOf('f:') !== 0) return;
    var f = r.slice(2);
    ids.forEach(function (id) { store.chars[id].folder = f; });
    H.setMsg('ok', f ? t('move.result', { n: ids.length, folder: H.folderName(f) }) : t('move.resultNone', { n: ids.length }));
    H.updateFolders(); updateSelBar();
  }
  function moveRow(id, dir) {
    var i = store.order.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= store.order.length) return;
    var tmp = store.order[i]; store.order[i] = store.order[j]; store.order[j] = tmp;
    H.renderCharGrid();
    H.setMsg('info', t('order.moved', { name: H.name(id), pos: j + 1, total: store.order.length }));
    var b = $('#main [data-lib="' + (dir < 0 ? 'up' : 'down') + '"][data-id="' + CSS.escape(id) + '"]'); if (b) b.focus();
  }
  async function restoreItem(id) {
    var x = store.trash.filter(function (e) { return e.id === id; })[0];
    if (!x || x.status === 'restoring') return;
    x.status = 'restoring';
    H.setMsg('info', t('trash.restoring') + ' ' + H.name(id));
    H.updateTrash();
    await wait(900);
    if (store.trash.indexOf(x) < 0) return;
    if (x.flaky) { x.flaky = false; x.status = 'failed'; H.setMsg(null); H.updateTrash(); return; }
    store.trash.splice(store.trash.indexOf(x), 1); x.status = '';
    store.order.push(id);
    var active = document.activeElement;
    var owns = L.view === 'trash' && (!active || active === document.body || !!(active.closest && active.closest('#trash-list')));
    var name = H.name(id);
    if (!owns) { H.setMsg('ok', t('trash.restoreDone', { name: name })); H.render(); return; }
    var c = store.chars[id]; var note = '';
    if ((S.search.trim() && loc(c.name).toLowerCase().indexOf(S.search.trim().toLowerCase()) < 0) || (S.folder && c.folder !== S.folder)) { S.search = ''; S.folder = ''; note = t('trash.filtersCleared'); }
    L.view = 'library'; H.setMsg('ok', t('trash.restoreDone', { name: name }) + note);
    Nav.drop('trash');
    H.render(); L.lastRow = id;
    var rb = rowBtn(id); if (rb) rb.focus();
  }
  async function emptyTrash() {
    var m = R.trashMatches(); if (!m.length) return;
    var q = L.trashSearch.trim(); var rest = store.trash.length - m.length;
    var r = await H.simDialog({
      critical: true, title: q ? t('trash.delTitleQ', { n: m.length }) : t('trash.delTitleAll', { n: m.length }),
      text: (q ? t('trash.delTextRest', { rest: rest }) : '') + t('trash.delText', { names: m.map(function (x) { return H.name(x.id); }).join(', ') }), mock: t('mock.trashNote'),
      actions: [{ id: 'cancel', label: t('move.cancel') }, { id: 'go', label: t('trash.delGo'), danger: true }]
    });
    if (r !== 'go') return;
    var gone = m.map(function (x) { return x.id; });
    store.trash = store.trash.filter(function (x) { return !has(gone, x.id); });
    gone.forEach(function (id) { delete store.chars[id]; });
    L.trashSearch = '';
    H.setMsg('ok', t('trash.deleted', { n: m.length, rest: rest ? t('trash.restKept', { n: rest }) : t('trash.nowEmpty') }));
    H.render();
    var f = $('#main #trash-search') || $('#main [data-lib="view-trash"]'); if (f) f.focus();
  }
  async function addCharacter(kind) {
    var r = await H.simDialog({ title: kind === 'import' ? t('add.titleImport') : t('add.titleCreate'), text: t('add.text'), actions: [{ id: 'cancel', label: t('move.cancel') }, { id: 'go', label: t('add.go'), primary: true }] });
    if (r !== 'go') return;
    var n = Object.keys(store.chars).filter(function (k) { return k.indexOf('new-') === 0; }).length + 1;
    var c = { id: 'new-' + n, name: { ko: t(kind === 'import' ? 'add.nameImport' : 'add.nameCreate', { n: n }), en: t(kind === 'import' ? 'add.nameImport' : 'add.nameCreate', { n: n }) }, hue: (n * 71) % 360, folder: '', recent: 0, chats: 0 };
    store.chars[c.id] = c; store.order.push(c.id);
    if (L.view === 'trash') { Nav.drop('trash'); }
    L.view = 'library'; H.setMsg('ok', t('add.done', { name: loc(c.name) }));
    H.render(); L.lastRow = c.id;
    var rb = rowBtn(c.id); if (rb) rb.focus();
  }
  async function actionsSheet() {
    var n = L.sel.length;
    var r = await H.simDialog({ critical: false, title: t('sel.actionsN', { n: n }), text: n ? '' : t('sel.none'), actions: n ? [{ id: 'move', label: t('sel.move') }, { id: 'trash', label: t('sel.trash'), danger: true }, { id: 'all', label: t('sel.all') }, { id: 'cancel', label: t('move.cancel') }] : [{ id: 'cancel', label: t('tasks.close') }] });
    if (r === 'move') moveSelected(); else if (r === 'trash') trashSelected(); else if (r === 'all') H.libAction({ dataset: { lib: 'select-all' } });
  }
  H.setupModel = async function () {
    var key = S.providerIssue === 'key';
    var r = await H.simDialog({
      title: key ? t('setup.titleKey') : t('setup.title'), text: t('setup.text'),
      actions: [{ id: 'cancel', label: t('setup.cancel') }, { href: Nav.links.models(), label: t('setup.open'), outLabel: t('link.settings') }, { id: 'ok', label: key ? t('setup.useKey') : t('setup.use'), primary: true }]
    });
    if (r !== 'ok') return;
    S.provider = true; S.providerIssue = '';
    H.render();
    var p = document.getElementById('prompt'); if (p) p.focus();
    H.composerNote(t('note.modelReady', { word: S.mode === 'hybrid' ? t('hy.send') : t('ut.run') }));
  };
  H.libAction = function (el) {
    var a = el.dataset.lib;
    if (a === 'manage') { L.manage = !L.manage; if (!L.manage) L.sel = []; H.setMsg(null); H.renderLib(); var mb = $('#main [data-lib="manage"]'); if (mb) mb.focus(); }
    else if (a === 'done') H.exitManage();
    else if (a === 'select-all') { L.visible.forEach(function (id) { add(L.sel, id); }); H.renderCharGrid(); }
    else if (a === 'trash' || a === 'retry-trash') trashSelected();
    else if (a === 'move') moveSelected();
    else if (a === 'actions') actionsSheet();
    else if (a === 'up' || a === 'down') moveRow(el.dataset.id, a === 'up' ? -1 : 1);
    else if (a === 'view-trash') H.openTrashView();
    else if (a === 'view-library') { if (L.view === 'trash') Nav.back('ui'); }
    else if (a === 'restore') restoreItem(el.dataset.id);
    else if (a === 'empty-trash') emptyTrash();
    else if (a === 'clear-trash-search') { L.trashSearch = ''; H.renderLib(); var ts = $('#main #trash-search'); if (ts) ts.focus(); }
    else if (a === 'dismiss-msg') { H.setMsg(null); var nb = $('#main [data-lib="manage"], #main [data-lib^="view-"]'); if (nb) nb.focus(); }
    else if (a === 'clear-search') H.clearSearch();
    else if (a === 'create' || a === 'import') addCharacter(a);
    else if (a === 'setup') H.setupModel();
    else if (a === 'goto-rp') H.requestMode('rp', function () { var h = document.getElementById('library-h'); if (h) h.scrollIntoView({ block: 'start' }); });
  };
  H.lib = { restoreItem: restoreItem, emptyTrash: emptyTrash, trashSelected: trashSelected };
})();
