/* Home application shell: boot, render, layers (dialogs, drawer, hub, Recently deleted, Manage), tasks UI, events. Mockup only.
   Motion numbers (durations, shifts, the toast time) are read from the --home-* tokens at the time they are used (DD-143), so a pack can retune them. */
(function () {
  'use strict';
  var H = window.Home; var S = H.S; var store = H.store; var t = H.t; var loc = H.loc; var esc = H.esc; var R = H.R; var Tasks = H.Tasks; var Nav = H.Nav; var P = H.P; var NM = window.NexusMark;
  var L = S.lib; var root = document.documentElement; var body = document.body;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var rail = $('#rail'); var main = $('#main'); var topRight = $('#topbar-right');
  var still = P.get('still') === '1';
  var noMock = P.get('controls') === '0';
  var cs = function () { return getComputedStyle(root); };
  H.tokPx = function (name, fb) { var n = parseFloat(cs().getPropertyValue(name)); return Number.isFinite(n) ? n : fb; };
  H.tokMs = function (name, fb) { var v = cs().getPropertyValue(name).trim(); var n = parseFloat(v); if (!Number.isFinite(n)) return fb; return /ms$/.test(v) ? n : /s$/.test(v) ? n * 1000 : fb; };
  H.tokStr = function (name, fb) { var v = cs().getPropertyValue(name).trim(); return v || fb; };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var layout = function () { return root.getAttribute('data-layout'); };
  var motionOff = function () { return root.getAttribute('data-motion') === 'reduced' || S.lowPower || root.classList.contains('nexus-low-power'); };

  // ---------- static text ----------
  function applyI18n() {
    root.lang = H.lang; root.setAttribute('data-lang', H.lang);
    $$('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    document.title = t('title.mode', { mode: R.modeName(S.mode) });
  }

  // ---------- hue / dynamic rules ----------
  var dynSheet = (function () { var st = document.createElement('style'); st.id = 'home-dyn'; st.setAttribute('data-generated', ''); document.head.appendChild(st); st.sheet.insertRule('#rail-tip {}', 0); return st.sheet; })();
  function placeTip(x, y) { var r = dynSheet.cssRules[0]; r.style.left = x + 'px'; r.style.top = y + 'px'; }

  // ---------- focus across re-renders ----------
  var keyAttrs = ['data-key', 'data-companion', 'data-folder', 'data-action', 'data-quick', 'data-toggle', 'data-lib', 'data-task-act'];
  function focusKey() {
    var el = document.activeElement; if (!el || el === document.body) return null;
    var scope = rail.contains(el) ? rail : main.contains(el) ? main : topRight.contains(el) ? topRight : null; if (!scope) return null;
    if (el.id) return { scope: scope, selector: '#' + CSS.escape(el.id) };
    var attr = keyAttrs.filter(function (a) { return el.hasAttribute(a); })[0];
    return attr ? { scope: scope, selector: '[' + attr + '="' + CSS.escape(el.getAttribute(attr)) + '"]' } : null;
  }
  function restoreFocus(key) { if (!key || (document.activeElement && document.activeElement !== document.body)) return; var el = key.scope.querySelector(key.selector); if (el) el.focus(); }

  // ---------- marks ----------
  H.applyMarks = function () {
    $$('.nexus-mark').forEach(function (svg) {
      svg.toggleAttribute('data-low-power', S.lowPower);      // low power drops the glow and the second copy of repeated layers; the loop keeps running (DD-211)
      svg.toggleAttribute('data-still', root.getAttribute('data-motion') === 'reduced');   // reduced motion (or still=1) stops it
    });
  };

  // ---------- render ----------
  function syncModes() {
    var fs = $('#modes'); fs.setAttribute('data-current', S.mode);
    $$('.mode-option', fs).forEach(function (l) { l.setAttribute('data-selected', String(l.dataset.mode === S.mode)); });
    $$('input[name="mode"]').forEach(function (i) { i.checked = i.value === S.mode; });
    $('#modes-wrap').hidden = !!S.only;
    $('.topbar').setAttribute('data-modes', S.only ? 'only' : 'all');
  }
  function render() {
    var key = focusKey(); var mode = S.mode;
    body.dataset.mode = mode; body.dataset.collapsed = String(mode === 'utility' && S.utilCollapsed);
    rail.dataset.mode = mode;
    var slim = mode === 'rp' || (mode === 'utility' && S.utilCollapsed);
    rail.setAttribute('data-slim', String(slim));
    if (mode === 'utility') rail.setAttribute('data-collapsed', String(S.utilCollapsed)); else rail.removeAttribute('data-collapsed');
    rail.setAttribute('aria-label', t('mode.menu', { mode: R.modeName(mode) }));
    rail.innerHTML = R.rail[mode]();
    hideTip();
    topRight.innerHTML = R.tasksButton() + R.top[mode]();
    main.innerHTML = S.hubOpen ? R.hubView() : R.main[mode]();
    body.dataset.libfocus = mode === 'rp' && !S.hubOpen && (L.view === 'trash' || L.manage) ? 'on' : '';
    if (H.fixture === 'all-modes-hidden-repair') main.insertAdjacentHTML('afterbegin', '<div class="setup-note" data-part="home-setup-note" data-part-critical role="group" aria-labelledby="repair-h"><div><b id="repair-h">' + esc(t('repair.h', { mode: R.modeName(mode) })) + '</b><span class="muted small block">' + esc(t('repair.p')) + '</span></div><a class="btn" data-variant="raised" data-part="home-setup-action" href="' + esc(Nav.links.settingsRepair()) + '" data-out data-out-label="' + esc(t('link.settings')) + '">' + esc(t('repair.btn')) + '</a></div>');
    syncModes(); document.title = t('title.mode', { mode: R.modeName(mode) });
    H.renderCharGrid(); H.restoreLibMsg(); H.applyMarks();
    syncTasksUI(null, true);
    if (S.hubOpen) { var hb = $('#hub-h'); if (hb && !key) hb.focus(); }
    restoreFocus(key);
  }
  H.render = render;

  // ---------- tasks UI (in place: no node is replaced while it is focused or animating) ----------
  var announceTimer = 0;
  function announce(text) { var el = $('#run-live'); clearTimeout(announceTimer); announceTimer = setTimeout(function () { el.textContent = text; }, 0); }
  function updateCard(el, task) {
    el.setAttribute('data-status', task.status); el.setAttribute('data-state', task.state);
    $('.run-title', el).textContent = Tasks.title(task);
    $('.status-text', el).textContent = R.statusLine(task);
    $('.run-bar', el).value = R.pct(task);
    var meta = $('.run-meta', el); meta.textContent = R.runMeta(task);
    if (task.note === 'failed') { meta.setAttribute('data-part', 'home-run-error'); meta.setAttribute('data-part-critical', ''); } else { meta.setAttribute('data-part', 'home-run-meta'); meta.removeAttribute('data-part-critical'); }
    var svg = $('.nexus-mark', el); if (svg) svg.setAttribute('data-status', task.status === 'waiting' ? 'waiting' : task.status);
    var acts = $('.run-actions', el); var html = R.runActions(task);
    if (acts.innerHTML !== html) {
      var hadFocus = acts.contains(document.activeElement);
      acts.innerHTML = html;
      if (hadFocus) { var f = acts.querySelector('button') || $('#prompt') || $('#tasks-button'); if (f) f.focus(); }
    }
  }
  function syncCards(container, items, build, update, idle) {
    if (!container) return;
    var existing = {}; $$('[data-task-id]', container).forEach(function (e) { existing[e.dataset.taskId] = e; });
    var idleEl = $('#run-idle', container);
    if (!items.length) { Object.keys(existing).forEach(function (k) { existing[k].remove(); }); if (!idleEl) { container.innerHTML = idle(); H.applyMarks(); } return; }
    if (idleEl) idleEl.remove();
    var prev = null;
    items.forEach(function (task) {
      var el = existing[task.id];
      if (!el) { var w = document.createElement('div'); w.innerHTML = build(task); el = w.firstElementChild; } else { update(el, task); delete existing[task.id]; }
      var want = prev ? prev.nextElementSibling : container.firstElementChild;
      if (el !== want) container.insertBefore(el, want);
      prev = el;
    });
    Object.keys(existing).forEach(function (k) { var e = existing[k]; var had = e.contains(document.activeElement); e.remove(); if (had) { var f = $('#prompt') || $('#tasks-button'); if (f) f.focus(); } });
    H.applyMarks();
  }
  function taskRow(task) {
    var size = H.tokPx('--home-task-mark-size', 28);
    var gone = task.kind === 'reply' && H.isTrashed(task.charId);
    var openEl = gone ? '' : task.kind === 'reply' ? '<a class="btn" data-variant="raised" data-part="home-task-open" href="' + esc(Nav.links.chat(task.charId)) + '" data-out data-out-label="' + esc(H.name(task.charId)) + '" data-task-open="' + task.id + '">' + esc(t('run.open')) + '<span class="sr-only"> ' + esc(Tasks.title(task)) + '</span></a>'
      : '<button type="button" class="btn" data-variant="raised" data-part="home-task-open" data-task-open="' + task.id + '">' + esc(t('run.open')) + '<span class="sr-only"> ' + esc(Tasks.title(task)) + '</span></button>';
    return '<div class="task-row" data-part="home-task-row" data-task-id="' + task.id + '" data-state="' + task.state + '" data-status="' + task.status + '">' + NM.markSvg('task-' + task.id, task.status, { size: size }) +
      '<div class="task-text"><b>' + esc(Tasks.title(task)) + '</b><span class="muted small task-sub">' + esc(taskSub(task)) + '</span></div><div class="acts" data-part="home-task-actions" data-sig="' + task.state + '">' + openEl + taskStop(task) + '</div></div>';
  }
  function taskSub(task) { return t('tasks.rowMode', { mode: R.modeName(task.mode), status: R.statusLine(task) }); }
  function taskStop(task) {
    if (task.state === 'active') return '<button type="button" class="btn" data-part="home-run-stop" data-variant="stop" data-task-act="stop" data-id="' + task.id + '">' + esc(t('run.stop')) + '<span class="sr-only"> ' + esc(Tasks.title(task)) + '</span></button>';
    if (task.state === 'queued') return '<button type="button" class="btn" data-part="home-run-stop" data-variant="stop" data-task-act="stop" data-id="' + task.id + '">' + esc(t('run.cancel')) + '<span class="sr-only"> ' + esc(Tasks.title(task)) + '</span></button>';
    return '';
  }
  function updateRow(el, task) {
    el.setAttribute('data-state', task.state); el.setAttribute('data-status', task.status);
    $('b', el).textContent = Tasks.title(task); $('.task-sub', el).textContent = taskSub(task);
    var svg = $('.nexus-mark', el); if (svg) svg.setAttribute('data-status', task.status);
    var acts = $('.acts', el); var stop = acts.querySelector('[data-task-act]');
    var sig = task.state;       // the stop control only changes with the state (active: Stop, queued: Cancel wait, ended: none)
    if (acts.getAttribute('data-sig') !== sig) {
      var had = stop && stop === document.activeElement;
      if (stop) stop.remove();
      acts.insertAdjacentHTML('beforeend', taskStop(task)); acts.setAttribute('data-sig', sig);
      if (had) { var f = acts.querySelector('[data-task-open]') || $('#tasks-close'); if (f) f.focus(); }
    }
  }
  function tasksDialogItems() {
    var all = Tasks.all(); var items = [];
    var active = all.filter(function (x) { return x.state === 'active'; }), queued = all.filter(function (x) { return x.state === 'queued'; }), ended = all.filter(function (x) { return x.state === 'ended'; }).slice(-5).reverse();
    var grp = function (id, label, list) { if (list.length) { items.push({ key: 'g-' + id, group: label }); list.forEach(function (x) { items.push({ key: x.id, task: x }); }); } };
    grp('active', t('tasks.active'), active); grp('queued', t('tasks.waiting'), queued); grp('ended', t('tasks.ended'), ended);
    return items;
  }
  function renderTaskList() {
    var list = $('#task-list'); var items = tasksDialogItems();
    var focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('#task-list') ? (document.activeElement.getAttribute('data-id') || document.activeElement.getAttribute('data-task-open')) : '';
    var fAct = document.activeElement && document.activeElement.getAttribute ? document.activeElement.getAttribute('data-task-act') : '';
    $('#tasks-cap').textContent = t('tasks.capNote', { cap: H.CAP });
    if (!items.length) { list.innerHTML = '<p class="muted" data-empty>' + esc(t('tasks.emptyList')) + '</p>'; return; }
    var empty = $('[data-empty]', list); if (empty) empty.remove();
    var existing = {}; $$(':scope > [data-key]', list).forEach(function (e) { existing[e.getAttribute('data-key')] = e; });
    var prev = null;
    items.forEach(function (it) {
      var el = existing[it.key];
      if (it.group) {
        if (!el) { el = document.createElement('h3'); el.className = 'eyebrow'; el.setAttribute('data-key', it.key); el.setAttribute('data-part', 'home-task-group'); }
        el.textContent = it.group; delete existing[it.key];
      } else if (!el) { var w = document.createElement('div'); w.innerHTML = taskRow(it.task); el = w.firstElementChild; el.setAttribute('data-key', it.key); }
      else { updateRow(el, it.task); delete existing[it.key]; }
      var want = prev ? prev.nextElementSibling : list.firstElementChild;
      if (el !== want) list.insertBefore(el, want);
      prev = el;
    });
    Object.keys(existing).forEach(function (k) { var e = existing[k]; var had = e.contains(document.activeElement); e.remove(); if (had) $('#tasks-close').focus(); });
    H.applyMarks();
    if (focused && document.activeElement === document.body) { var f = list.querySelector('[data-id="' + CSS.escape(focused) + '"][data-task-act="' + fAct + '"]') || list.querySelector('[data-task-open="' + CSS.escape(focused) + '"]') || $('#tasks-close'); if (f) f.focus(); }
  }
  var lastStatus = {};
  function syncTasksUI(task, quiet) {
    var btn = $('#tasks-button'); if (btn) { var n = Tasks.activeCount(); btn.innerHTML = R.tasksInner(); btn.setAttribute('data-count', String(n)); }
    var rl = $('#run-list');
    if (rl) syncCards(rl, Tasks.visible(rl.dataset.mode), R.runCard, updateCard, R.idleRunCard);
    var rc = $('#run-count'); if (rc) rc.textContent = R.runCount(S.mode);
    var cn = $('#composer-note'); if (cn && cn.getAttribute('data-kind') === 'cap' && Tasks.queuedCount(S.mode) === 0 && Tasks.activeCount(S.mode) < H.CAP) H.composerNote('');      // the cap note must not outlive the queue (re-review r2)
    if ($('#tasks').open) renderTaskList();
    refreshBadges();
    if (task && !quiet) {
      var key = task.id + ':' + task.state + ':' + task.status;
      if (lastStatus[task.id] !== key && (task.state === 'ended' || task.state === 'queued' || lastStatus[task.id] && lastStatus[task.id].indexOf(':queued:') > 0)) announce(Tasks.title(task) + ': ' + R.statusLine(task));
      lastStatus[task.id] = key;
    }
  }
  // Roleplay background replies (DD-205): the badge on a character's story card, rail avatar and library card follows the task state
  function refreshBadges() {
    $$('[data-key^="story-"],[data-key^="char-"][data-part="home-rail-avatar"],[data-part="home-char-card"]').forEach(function (el) {
      var id = (el.getAttribute('data-key') || '').replace(/^(story|char)-/, ''); if (!id) return;
      var st = Tasks.bgOf(id); var c = store.chars[id]; if (!c) return;
      var cur = el.getAttribute('data-status') || '';
      if (cur === st) return;
      if (st) el.setAttribute('data-status', st); else el.removeAttribute('data-status');
      $$('[data-part="home-bg-badge"]', el).forEach(function (b) { b.remove(); });
      $$('.bg-sr', el).forEach(function (b) { b.remove(); });
      if (st) {
        if (el.getAttribute('data-part') === 'home-story') el.querySelector('.portrait').insertAdjacentHTML('afterend', R.statusBadge(c));
        else el.querySelector('.avatar').insertAdjacentHTML('afterend', '<span class="rail-dot" data-part="home-bg-badge" data-status="' + st + '" aria-hidden="true"></span>');
        if (el.getAttribute('data-part') !== 'home-story') el.insertAdjacentHTML('beforeend', '<span class="sr-only bg-sr">, ' + esc(R.bgText(st)) + '</span>');
      }
    });
  }
  Tasks.onChange(function (task) { syncTasksUI(task); });

  // ---------- dialogs and the layer stack ----------
  var dialogStack = [];
  var fieldRef = { f: null };
  function syncPause() { var paused = dialogStack.length > 0 || rail.getAttribute('data-open') === 'true'; if (fieldRef.f && fieldRef.f.setPaused) fieldRef.f.setPaused(paused); root.setAttribute('data-paused', String(paused)); }
  H.openDialog = function (dlg) {
    if (dlg.open) return;
    dlg.showModal(); dialogStack.push(dlg); syncPause();
  };
  $$('dialog').forEach(function (dlg) {
    dlg.addEventListener('close', function () { var i = dialogStack.indexOf(dlg); if (i >= 0) dialogStack.splice(i, 1); syncPause(); });
  });
  H.dialogStack = dialogStack;
  H.topLayer = function () {
    if (dialogStack.length) { var d = dialogStack[dialogStack.length - 1]; return { id: 'dialog:' + d.id, close: function () { d.close(); } }; }
    if (rail.getAttribute('data-open') === 'true') return { id: 'drawer', close: function () { closeDrawer(true); } };
    if ($('#draft-choice')) return { id: 'choice', close: function () { resolveQuick('cancel'); } };
    if (S.hubOpen) return { id: 'hub', history: true, close: closeHub };
    if (S.mode === 'rp' && L.view === 'trash') return { id: 'trash', history: true, close: function () { H.closeTrashView(true); } };
    if (S.mode === 'rp' && L.manage) return { id: 'manage', close: function () { H.exitManage(); } };
    if (S.mode === 'rp' && S.search.trim()) return { id: 'search', close: function () { H.clearSearch(); } };
    return null;
  };
  function closeHub() {
    if (!S.hubOpen) return;
    S.hubOpen = false; render();
    var b = $('#main .realm-more') || $('#main [data-action="hub"]'); if (b) b.focus();
  }
  H.closeHub = closeHub;
  // browser Forward onto a hub / Recently deleted entry: reopen the layer without pushing (the entry exists)
  H.restoreLayer = function (id) {
    if (id === 'hub' && S.realm !== 'hidden' && S.agreed && !S.hubOpen) { S.hubOpen = true; render(); var h = $('#hub-h'); if (h) h.focus(); }
    else if (id === 'trash' && S.mode === 'rp' && L.view !== 'trash') { L.view = 'trash'; L.manage = false; L.sel = []; H.setMsg(null); H.renderLib(); }
  };

  // ---------- DD-261: a Utility recent (rail or list) opens its task card on Home, never a legacy page, so the draft and the language stay ----------
  function openThread(id) {
    var th = store.threads.utility.filter(function (x) { return x.id === id; })[0]; if (!th) return;
    var title = loc(th.title);
    var task = Tasks.all().filter(function (x) { return x.mode === 'utility' && Tasks.title(x) === title; }).pop();
    closeDrawer(false);
    var card = task && $('[data-task-id="' + task.id + '"] .run-title');
    if (card) { card.setAttribute('tabindex', '-1'); card.focus(); card.scrollIntoView({ block: 'center' }); return; }
    Nav.toast(t('thread.history', { title: title }));
  }

  // ---------- tasks dialog ----------
  var tasksDialog = $('#tasks'); var tasksNavigating = false;
  function openTasks() { renderTaskList(); H.openDialog(tasksDialog); }
  tasksDialog.addEventListener('close', function () {
    if (tasksNavigating) { tasksNavigating = false; return; }
    var btn = $('#tasks-button'); if (btn && btn.getClientRects().length) btn.focus();
  });
  tasksDialog.addEventListener('click', function (e) {
    if (e.target.id === 'tasks-close' || e.target === tasksDialog) { tasksDialog.close(); return; }
    var stop = e.target.closest('[data-task-act="stop"]'); if (stop) { Tasks.stop(stop.dataset.id); return; }
    var open = e.target.closest('button[data-task-open]');
    if (open) {
      var task = Tasks.get(open.dataset.taskOpen); tasksNavigating = true; tasksDialog.close(); closeDrawer(false);
      H.requestMode(task.mode, function () {
        if (S.hubOpen) Nav.back('ui');
        var card = $('[data-task-id="' + task.id + '"] .run-title'); if (card) { card.setAttribute('tabindex', '-1'); card.focus(); }
      });
    }
  });

  // ---------- drawer (phone) ----------
  var menuButton = $('#menu-button'); var scrim = $('#scrim');
  var outside = function () { return [main, $('#modes-wrap'), topRight, $('.skip'), $('#mock-controls')].filter(Boolean); };
  function openDrawer() {
    rail.setAttribute('data-open', 'true'); scrim.setAttribute('data-open', 'true'); root.classList.add('drawer-open');
    menuButton.setAttribute('aria-expanded', 'true');
    outside().forEach(function (el) { el.inert = true; });
    var first = rail.querySelector('a, button'); if (first) first.focus();
    syncPause();
  }
  function closeDrawer(returnFocus) {
    if (rail.getAttribute('data-open') !== 'true') return;
    rail.removeAttribute('data-open'); scrim.removeAttribute('data-open'); root.classList.remove('drawer-open');
    menuButton.setAttribute('aria-expanded', 'false');
    outside().forEach(function (el) { el.inert = false; });
    if (returnFocus !== false) menuButton.focus();
    syncPause();
  }
  H.closeDrawer = closeDrawer;
  menuButton.addEventListener('click', function () { if (rail.getAttribute('data-open') === 'true') closeDrawer(true); else openDrawer(); });
  scrim.addEventListener('click', function () { closeDrawer(true); });
  document.addEventListener('keydown', function (e) {
    if (rail.getAttribute('data-open') !== 'true' || e.key !== 'Tab' || dialogStack.length) return;
    var items = [menuButton].concat($$('a[href], button:not([disabled])', rail).filter(function (el) { return el.getClientRects().length; }));
    var i = items.indexOf(document.activeElement);
    var next = e.shiftKey ? items[(i <= 0 ? items.length : i) - 1] : items[(i + 1) % items.length];
    e.preventDefault(); next.focus();
  });
  rail.addEventListener('click', function (e) { if (layout() === 'phone' && e.target.closest('.rail-item') && !e.target.closest('#collapse')) closeDrawer(false); });
  window.addEventListener('resize', function () { if (layout() !== 'phone') closeDrawer(false); });

  // ---------- rail tooltip (slim rail: Roleplay and the collapsed Utility rail) ----------
  var tipEl = $('#rail-tip');
  function hideTip() { tipEl.removeAttribute('data-open'); }
  function showTip(item) {
    if (rail.getAttribute('data-slim') !== 'true' || layout() === 'phone' || !item || !item.dataset.tip) { hideTip(); return; }
    var r = item.getBoundingClientRect();
    tipEl.textContent = item.dataset.tip; placeTip(Math.round(r.right + H.tokPx('--home-tip-gap', 8)), Math.round(r.top + r.height / 2)); tipEl.setAttribute('data-open', '');
  }
  rail.addEventListener('mouseover', function (e) { showTip(e.target.closest('[data-tip]')); });
  rail.addEventListener('mouseleave', hideTip);
  rail.addEventListener('focusin', function (e) { showTip(e.target.closest('[data-tip]')); });
  rail.addEventListener('focusout', hideTip);
  rail.addEventListener('scroll', hideTip);

  // ---------- mode switching ----------
  var thumbReady = false; var enterAnims = [];
  function enterStage(dir) {
    enterAnims.forEach(function (a) { a.cancel(); }); enterAnims = [];
    if (motionOff() || !dir) return;
    var ease = H.tokStr('--nexus-ease', 'ease');
    var fly = function (el, x, ms) {
      if (!el || !el.animate) return;
      var a = el.animate([{ opacity: 0, transform: 'translate3d(' + dir * x + 'px,0,0)' }, { opacity: 1, transform: 'translate3d(0,0,0)' }], { duration: ms, easing: ease });
      a.onfinish = a.oncancel = function () { enterAnims = enterAnims.filter(function (b) { return b !== a; }); };
      enterAnims.push(a);
    };
    fly(main, H.tokPx('--home-stage-shift', 14), H.tokMs('--home-dur-stage', 220));
    fly(topRight, H.tokPx('--home-topbar-shift', 8), H.tokMs('--home-dur-topbar', 180));
    var ms = H.tokMs('--home-dur-rail-fade', 180);
    $$(':scope > *', rail).forEach(function (item) { if (item.animate) item.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: ease }); });
  }
  function setMode(mode) {
    if (mode === S.mode) return;
    var order = { rp: 0, hybrid: 1, utility: 2 }; var dir = Math.sign(order[mode] - order[S.mode]);
    if (S.hubOpen) { S.hubOpen = false; Nav.drop('hub'); }
    if (L.view === 'trash' && mode !== 'rp') { L.view = 'library'; Nav.drop('trash'); }
    S.mode = mode;
    var url = new URL(location.href); url.searchParams.set('mode', mode); history.replaceState(history.state, '', url);
    render(); enterStage(dir);
    $('#mode-status').textContent = t('mode.home', { mode: R.modeName(mode) });
  }
  var leave = $('#leave'); var pendingMode = null;
  function syncRadios() { $$('input[name="mode"]').forEach(function (i) { i.checked = i.value === S.mode; }); }
  H.requestMode = function (mode, then) {
    if (mode === S.mode) { if (then) then(); return; }
    var draft = S.drafts[S.mode];
    if (!draft || !draft.trim()) { setMode(mode); if (then) then(); return; }
    pendingMode = { mode: mode, then: then }; syncRadios();
    $('#leave-title').textContent = t('leave.title', { mode: R.modeName(S.mode) });
    $('#leave-go').textContent = t('leave.go', { mode: R.modeName(mode) });
    var cur = $('input[name="mode"]:checked'); if (cur) cur.focus();      // the dialog gives focus back to whatever had it, so it must be the checked radio (review m4)
    H.openDialog(leave);
    $('#leave-stay').focus();
  };
  leave.addEventListener('click', function (e) {
    if (e.target.id === 'leave-stay') leave.close();
    if (e.target.id === 'leave-go' && pendingMode) {
      var pm = pendingMode; pendingMode = null; leave.close(); setMode(pm.mode);
      if (pm.then) pm.then(); else { var r = $('input[name="mode"][value="' + pm.mode + '"]'); if (r) r.focus(); }
    }
  });
  leave.addEventListener('close', function () { pendingMode = null; var fix = function () { var r = $('input[name="mode"]:checked'); var ae = document.activeElement; if (r && (ae === document.body || !ae || (ae.name === 'mode' && ae !== r))) r.focus(); }; setTimeout(fix, 0); requestAnimationFrame(function () { requestAnimationFrame(fix); }); });
  var lastModeAt = 0; var lastPointerAt = 0;
  $('#modes').addEventListener('pointerdown', function () { lastPointerAt = Date.now(); }, true);
  $('#modes').addEventListener('change', function (e) {
    var byPointer = Date.now() - lastPointerAt < 120;
    if (byPointer && Date.now() - lastModeAt < H.tokMs('--home-mode-settle', 400) && e.target.value !== S.mode) { syncRadios(); return; }
    var before = S.mode; H.requestMode(e.target.value); if (S.mode !== before) lastModeAt = Date.now();
  });

  // ---------- composer ----------
  H.composerNote = function (text, error, kind) {
    var note = $('#composer-note'); if (!note) return;
    note.textContent = text; note.setAttribute('data-kind', error ? 'error' : (kind || 'info'));
  };
  var quickPending = null;
  function setPrompt(text) {
    var p = $('#prompt'); p.value = text; S.drafts[S.mode] = text; p.removeAttribute('aria-invalid'); H.composerNote(''); p.focus(); p.setSelectionRange(text.length, text.length);
  }
  function closeChoice() { var c = $('#draft-choice'); if (c) c.remove(); quickPending = null; }
  function startQuick(btn) {
    var p = $('#prompt'); if (!p) return; closeChoice();
    var template = btn.dataset.quick + ': ';
    if (!p.value.trim()) { setPrompt(template); return; }
    quickPending = { template: template, label: btn.dataset.quick };
    $('#choice-slot').innerHTML = '<div class="draft-choice" data-part="home-draft-choice" data-part-critical id="draft-choice" role="group" aria-labelledby="draft-choice-text"><span id="draft-choice-text">' + esc(t('draft.text', { t: template.trim() })) + '</span><span class="acts">' +
      '<button type="button" class="btn" data-part="home-draft-action" data-variant="raised" data-choice="append">' + esc(t('draft.append')) + '</button>' +
      '<button type="button" class="btn" data-part="home-draft-action" data-variant="danger" data-choice="replace" title="' + esc(t('draft.replaceTitle')) + '"><span aria-hidden="true">&#9888; </span>' + esc(t('draft.replace')) + '</button>' +
      '<button type="button" class="btn" data-part="home-draft-action" data-variant="ghost" data-choice="cancel">' + esc(t('draft.cancel')) + '</button></span></div>';
    $('#draft-choice [data-choice="append"]').focus();
  }
  function resolveQuick(choice) {
    var pending = quickPending; var p = $('#prompt'); closeChoice();
    if (!pending || !p) return;
    if (choice === 'append') { var kept = p.value.replace(/\s+$/, ''); setPrompt(kept ? kept + '\n' + pending.template : pending.template); }
    else if (choice === 'replace') setPrompt(pending.template);
    else { var q = $('[data-quick="' + CSS.escape(pending.label) + '"]'); if (q) q.focus(); }
  }
  function submitComposer(form) {
    var mode = form.dataset.mode; var area = $('textarea', form);
    if (!area.value.trim()) { H.composerNote(t(mode === 'hybrid' ? 'note.empty' : 'note.emptyTask'), true); area.setAttribute('aria-invalid', 'true'); area.focus(); return; }
    if (mode === 'hybrid' && !S.companion) { H.composerNote(t('note.chooseCompanion'), true); openPicker(); return; }
    if (!S.provider) { H.composerNote(t('note.noSent', { why: t(S.providerIssue === 'key' ? 'note.noKey' : 'note.noModel'), verb: t(mode === 'hybrid' ? 'note.verbSent' : 'note.verbStarted') }), true); H.setupModel(); return; }
    if (S.outcome === 'offline') { H.composerNote(t('note.offline'), true); area.focus(); return; }
    if (Tasks.activeCount(mode) >= H.CAP && Tasks.queuedCount(mode) >= H.QUEUE_MAX) { H.composerNote(t('run.full', { max: H.QUEUE_MAX }), true); area.focus(); return; }     // DD-248
    closeChoice();
    var text = area.value.trim().replace(/\s+/g, ' '); var title = text.length > 48 ? text.slice(0, 47) + '…' : text;
    area.value = ''; S.drafts[mode] = ''; H.composerNote('');
    var meta;
    if (mode === 'hybrid') {
      store.threads.hybrid.unshift({ id: 'th-new-' + Date.now(), title: title, by: S.companion, tag: 'task', min: 0 }); store.threads.hybrid.length = Math.min(store.threads.hybrid.length, 5);
      $('#threads').innerHTML = store.threads.hybrid.map(R.threadRow).join('');
      meta = t('run.meta.companion', { name: H.name(S.companion) }) + (S.tools ? t('run.meta.tools') : '');
    } else {
      store.threads.utility.splice(1, 0, { id: 'th-new-' + Date.now(), title: title, tag: 'task', min: 0 });
      $('#util-threads').innerHTML = store.threads.utility.slice(1, 5).map(R.utilRow).join('');
      meta = t('run.meta.util') + (S.utilTools ? t('run.meta.utilTools') : '') + (S.utilWeb ? t('run.meta.web') : '');
    }
    var task = Tasks.create({ mode: mode, title: title, meta: meta, fails: S.outcome === 'fail' });
    if (task.state === 'queued') H.composerNote(t('run.cap', { cap: H.CAP }), false, 'cap');    // DD-204: the 4th send waits, and says so
  }

  // ---------- companion picker ----------
  var picker = $('#picker');
  function openPicker() {
    var list = store.order.map(function (id) { return store.chars[id]; }).filter(function (c) { return !c.group; }).concat([store.chars.airisu]);
    $('#picker-list').innerHTML = list.map(function (c) {
      return '<button type="button" class="btn picker-item" data-part="home-picker-item" data-pick="' + c.id + '"' + (c.id === S.companion ? ' data-current="true" aria-current="true"' : '') + '>' + R.avatar(c, 'sm') + '<span>' + esc(loc(c.name)) + (c.builtIn ? ' <span class="tag" data-part="home-tag">' + esc(t('char.builtIn')) + '</span>' : '') + (c.id === S.companion ? '<span class="sr-only">' + esc(t('pick.current')) + '</span>' : '') + '</span></button>';
    }).join('');
    H.openDialog(picker);
    var cur = $('[aria-current="true"]', picker); if (cur) cur.focus(); else { var f = $('.picker-item', picker); if (f) f.focus(); }
  }
  picker.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pick]');
    if (e.target.id === 'picker-close' || e.target === picker) { picker.close(); return; }
    if (!b) return;
    S.companion = b.dataset.pick; picker.close(); render();
    var f = $('#main [data-action="companion"]'); if (f) f.focus();
  });

  // ---------- RisuRealm: one gate (DD-206) ----------
  var agree = $('#agree'); var agreeThen = null;
  H.askAgreement = function (then) { agreeThen = then || null; H.openDialog(agree); $('#agree-decline').focus(); };
  agree.addEventListener('click', function (e) {
    if (e.target.closest('a[data-demo-ext]')) { e.preventDefault(); Nav.toast(t('toast.ext')); return; }
    if (e.target.id === 'agree-accept') {
      agree.close(); S.agreed = true; var then = agreeThen; agreeThen = null;
      var wasConsent = S.realm === 'consent'; if (wasConsent) S.realm = 'populated';
      if (S.mode === 'rp' && !S.hubOpen && wasConsent && !then) { render(); loadRealm(true); return; }
      render(); if (then) then();
    }
    if (e.target.id === 'agree-decline') { agree.close(); agreeThen = null; }
  });
  H.openHub = function () {
    if (S.realm === 'hidden') return;
    if (!S.agreed) { H.askAgreement(function () { H.openHub(); }); return; }
    if (S.hubOpen) return;
    S.hubOpen = true; Nav.push('hub'); render();
    var h = $('#hub-h'); if (h) h.focus();
  };
  function rerenderRealm() {
    var card = $('#main .realm'); if (!card) return;
    var status = $('.realm-status', card);
    var r = S.realm;
    $$('.realm-list,.announce,.realm-more,.realm-page', card).forEach(function (e) { e.remove(); });
    if (r === 'populated') { status.insertAdjacentHTML('beforebegin', R.realmList()); status.insertAdjacentHTML('afterend', R.announceHtml()); }
    card.insertAdjacentHTML('beforeend', R.realmMore(r));
    card.setAttribute('data-realm', r); status.setAttribute('data-loaded', String(r === 'populated'));
    if (r === 'consent') status.setAttribute('data-part-critical', ''); else status.removeAttribute('data-part-critical');
    status.innerHTML = R.realmStatus(r); H.applyMarks();
  }
  async function loadRealm(afterAgree) {
    S.realm = 'pending'; rerenderRealm();
    var status = $('#main .realm-status'); if (status) status.focus();
    await wait(1400);
    if (S.realm !== 'pending') return;
    S.realm = 'populated'; rerenderRealm();
    if (document.activeElement === status || document.activeElement === document.body) { var it = $('#main .realm-item'); if (it) it.focus(); }
  }

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    var el = e.target.closest('button, a'); if (!el) return;
    if (el.closest('dialog')) return;              // dialogs have their own handlers
    if (el.hasAttribute('data-demo-ext')) { e.preventDefault(); Nav.toast(t('toast.ext')); return; }
    if (el.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
    if (el.hasAttribute('data-demo')) { Nav.toast(t('toast.demo', { what: el.getAttribute('data-demo-label') || el.textContent.trim() })); return; }
    if (el.hasAttribute('data-out')) return;      // a real link: nav.js parks Home and the browser follows it
    if (el.dataset.lib) return H.libAction(el);
    if (el.dataset.choice) return resolveQuick(el.dataset.choice);
    var ta = el.dataset.taskAct; if (ta === 'stop') { Tasks.stop(el.dataset.id); return; } if (ta === 'retry') { Tasks.retry(el.dataset.id); return; }
    var a = el.dataset.action;
    if (el.id === 'tasks-button') return openTasks();
    if (a === 'tasks') { closeDrawer(false); return openTasks(); }
    if (a === 'companion') { closeDrawer(false); return openPicker(); }
    if (a === 'home') { closeDrawer(false); if (S.hubOpen || L.view === 'trash') Nav.back('ui'); window.scrollTo(0, 0); var hh = $('#main h1'); if (hh) { hh.setAttribute('tabindex', '-1'); hh.focus(); } return; }
    if (a === 'hub') { H.openHub(); return; }
    if (a === 'hub-back') { Nav.back('ui'); return; }
    if (el.dataset.realmAction === 'ask') { H.askAgreement(el.closest('[data-part="home-realm-gate"]') ? function () { H.openHub(); } : null); return; }
    if (el.dataset.realmAction === 'load') { loadRealm(); return; }
    if (el.dataset.folder) { S.folder = S.folder === el.dataset.folder ? '' : el.dataset.folder; H.updateFolders(); return; }
    if (el.dataset.toggle) { S[el.dataset.toggle] = !S[el.dataset.toggle]; el.setAttribute('aria-pressed', String(S[el.dataset.toggle])); el.setAttribute('data-selected', String(S[el.dataset.toggle])); return; }
    if (el.id === 'voice') { S.voice = !S.voice; el.setAttribute('aria-pressed', String(S.voice)); el.setAttribute('data-selected', String(S.voice)); return; }
    if (el.dataset.thread) return openThread(el.dataset.thread);
    if (el.dataset.quick) return startQuick(el);
    if (el.dataset.companion) { S.companion = el.dataset.companion; render(); return; }
    if (el.id === 'collapse') { S.utilCollapsed = !S.utilCollapsed; render(); return; }
    if (el.id === 'new-task') { closeDrawer(false); var pr = $('#prompt'); if (pr) pr.focus(); return; }
    if (el.getAttribute('href') === '#') e.preventDefault();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.isComposing) return;
    hideTip();
    if (dialogStack.length) return;               // a native dialog closes itself on Esc
    var tg = e.target;
    if (tg.matches && tg.matches('input[type="search"]') && tg.value) {      // the first Esc in a search box clears the text (and nothing else)
      e.preventDefault();
      if (tg.id === 'lib-search') { S.search = ''; tg.value = ''; H.renderCharGrid(); } else if (tg.id === 'trash-search') { L.trashSearch = ''; tg.value = ''; H.updateTrash(); }
      return;
    }
    if (tg.closest && tg.closest('#draft-choice')) return;      // handled below
    if (Nav.back('esc')) e.preventDefault();
  });
  main.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && e.target.closest && e.target.closest('#draft-choice')) { e.preventDefault(); resolveQuick('cancel'); return; }
    // Enter sends, Shift+Enter is a new line. Never while an IME is composing: Enter there commits the composition.
    if (e.target.id === 'prompt' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); e.target.form.requestSubmit(); }
  });
  main.addEventListener('focusin', function (e) {
    var r = e.target.closest && e.target.closest('[data-row]'); var k = e.target.closest && e.target.closest('[data-key^="char-"]');
    if (r) L.lastRow = r.dataset.row; else if (k) L.lastRow = k.dataset.key.slice(5);
  });
  main.addEventListener('input', function (e) {
    if (e.target.id === 'lib-search') { S.search = e.target.value; H.renderCharGrid(); }
    if (e.target.id === 'trash-search') { L.trashSearch = e.target.value; H.updateTrash(); }
    if (e.target.id === 'prompt') { S.drafts[S.mode] = e.target.value; H.composerNote(''); e.target.removeAttribute('aria-invalid'); }
  });
  main.addEventListener('change', function (e) {
    if (e.target.id === 'lib-sort') { S.sort = e.target.value; H.renderCharGrid(); }
    if (e.target.dataset && e.target.dataset.sel) {
      var id = e.target.dataset.sel; var i = L.sel.indexOf(id);
      if (e.target.checked) { if (i < 0) L.sel.push(id); } else if (i >= 0) L.sel.splice(i, 1);
      L.lastRow = id; var row = e.target.closest('.char-row'); if (row) row.setAttribute('data-selected', String(e.target.checked));
      H.updateSelBar();
    }
    if (e.target.name === 'framing') {
      S.framing = e.target.value; $('#framing-hint').textContent = t('hy.h.' + S.framing);
      $$('.seg-option').forEach(function (l) { l.setAttribute('data-selected', String($('input', l).checked)); });
    }
  });
  main.addEventListener('submit', function (e) { e.preventDefault(); submitComposer(e.target); });

  // ---------- network field: background taps only, paused behind dialogs (DD-212) ----------
  var field = null;
  var SURFACE = 'button, a, input, select, textarea, label, summary, dialog, details, form, progress, [data-scroll], .glass, .rail, .card, .pill, .scrim, .toast, .mock-controls, .brand, .modes, .skip';
  function canWave(e) {
    var tg = e.target;
    if (!tg || tg.nodeType !== 1) return true;
    if (dialogStack.length || rail.getAttribute('data-open') === 'true') return false;
    return !tg.closest(SURFACE);
  }
  function startField() {
    if (field) field.destroy();
    var tt = Number(P.get('t') || 0);
    var pt = function (name) { var raw = P.get(name); if (!raw) return undefined; var a = raw.split(',').map(Number); return { x: a[0], y: a[1], age: Number.isFinite(a[2]) ? a[2] : undefined }; };
    field = NexusNetwork.createNetworkField($('#network'), {
      lowPower: S.lowPower, reducedMotion: root.getAttribute('data-motion') === 'reduced' && !still ? true : false, initialWave: pt('wave'), initialPointer: pt('pointer'), still: still, startTime: Number.isFinite(tt) ? tt : 0,
      canWave: canWave, tapSlop: H.tokPx('--home-tap-slop', 10), tapMs: H.tokMs('--home-tap-ms', 500)
    });
    fieldRef.f = field; H.field = field; syncPause();
  }
  H.startField = startField;

  // ---------- mock controls (data-mock: not part of the product) ----------
  function buildMock() {
    var box = $('#mock-controls');
    if (noMock) { $$('[data-mock]').forEach(function (e) { e.remove(); }); return; }
    var sel = function (id, label, opts, cur) { return '<label>' + esc(label) + '<select id="' + id + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(cur) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>'; };
    $('#mock-rows').innerHTML =
      '<label>' + esc(t('mock.lowPower')) + ' <input type="checkbox" id="ctl-lowpower"' + (S.lowPower ? ' checked' : '') + '></label>' +
      '<label>' + esc(t('mock.motion')) + ' <input type="checkbox" id="ctl-motion"' + (root.classList.contains('home-reduce-motion') ? ' checked' : '') + '></label>' +
      sel('ctl-lang', t('mock.lang'), [['ko', '한국어'], ['en', 'English']], H.lang) +
      sel('ctl-only', t('mock.hideUnused'), [['', t('mock.hideNo')], ['rp', t('mock.rpOnly')], ['utility', t('mock.utOnly')]], S.only) +
      sel('ctl-realm', t('mock.realm'), ['populated', 'pending', 'failed', 'empty', 'offline', 'consent', 'hidden'].map(function (x) { return [x, x]; }), S.realm) +
      sel('ctl-occasion', t('mock.seasonal'), [['auto', t('mock.seasonalAuto')], ['none', t('mock.seasonalNone')]].concat(RisuSeasonal.KEYS.map(function (k) { return [k, k]; })), seasonalOccasion) +
      sel('ctl-outcome', t('mock.outcome'), [['ok', t('mock.ok')], ['fail', t('mock.fail')], ['offline', t('mock.offline')]], S.outcome) +
      sel('ctl-fixture', t('mock.fixture'), H.FIXTURES.map(function (x) { return [x, x]; }), H.fixture) +
      '<button type="button" class="btn" data-variant="raised" id="ctl-runs">' + esc(t(S.mockRuns ? 'mock.runsOn' : 'mock.runs')) + '</button>' +
      '<button type="button" class="btn" data-variant="raised" id="ctl-bg">' + esc(t('mock.bgStart')) + '</button>';
    var q = function (id) { return document.getElementById(id); };
    q('ctl-lowpower').addEventListener('change', function (e) { S.lowPower = e.target.checked; root.classList.toggle('nexus-low-power', S.lowPower); H.applyMarks(); startField(); seasonal.update({ lowPower: S.lowPower }); });
    q('ctl-motion').addEventListener('change', function (e) { root.classList.toggle('home-reduce-motion', e.target.checked); window.homeTheme.mirror(); H.applyMarks(); startField(); });
    q('ctl-lang').addEventListener('change', function (e) { var u = new URL(location.href); u.searchParams.set('lang', e.target.value); location.href = u.href; });
    q('ctl-only').addEventListener('change', function (e) { S.only = e.target.value; if (S.only) S.mode = S.only; render(); });
    q('ctl-realm').addEventListener('change', function (e) { S.realm = e.target.value; S.agreed = S.realm !== 'consent'; if (S.realm === 'hidden') S.hubOpen = false; render(); });
    q('ctl-occasion').addEventListener('change', function (e) { seasonal.update({ occasion: e.target.value === 'none' ? '' : e.target.value }); });
    q('ctl-outcome').addEventListener('change', function (e) { S.outcome = e.target.value; });
    q('ctl-fixture').addEventListener('change', function (e) { var u = new URL(location.href); u.searchParams.set('fixture', e.target.value); location.href = u.href; });
    q('ctl-runs').addEventListener('click', function (e) { S.mockRuns = !S.mockRuns; if (S.mockRuns) Tasks.seedSample(); else Tasks.clear(); e.target.textContent = t(S.mockRuns ? 'mock.runsOn' : 'mock.runs'); });
    q('ctl-bg').addEventListener('click', function () {
      var ids = store.order.filter(function (id) { return Tasks.bgOf(id) !== 'running'; }); if (!ids.length) return;
      Tasks.reply(ids[0]);
    });
  }

  // ---------- seasonal wordmark (separate from the status mark, which never celebrates) ----------
  var occasionKeys = ['auto', 'none'].concat(RisuSeasonal.KEYS);
  var seasonalOccasion = occasionKeys.indexOf(P.get('occasion')) >= 0 ? P.get('occasion') : 'auto';
  var seasonalDate = /^\d{4}-\d{2}-\d{2}$/.test(P.get('date') || '') ? new Date(P.get('date') + 'T12:00:00') : undefined;
  var seasonal;
  function mountSeasonal() {
    $('#brand-mark').innerHTML = NM.markSvg('brand', 'idle', { size: H.tokPx('--home-brand-mark-size', 32) });
    seasonal = RisuSeasonal.mount($('#seasonal-wordmark'), {
      markEl: $('#brand-mark'), anniversaryUrl: 'https://github.com/yor42/RisuTanium', firstViewToday: P.get('first') !== '0',
      occasion: seasonalOccasion === 'none' ? '' : seasonalOccasion, date: seasonalDate, language: H.lang,
      variant: /^(samiljeol|gwangbokjeol)$/.test(P.get('variant') || '') ? P.get('variant') : undefined, simulateFontFailure: P.get('cdnfont') === 'fail',
      year: seasonalDate ? seasonalDate.getFullYear() : undefined, motion: still ? 'still' : undefined, lowPower: S.lowPower,
      onLink: function (url) { $('#mode-status').textContent = (url || '') + ' (' + (H.lang === 'ko' ? '가상' : 'simulated') + ')'; }
    });
  }

  // ---------- boot ----------
  function boot() {
    if (S.lowPower) root.classList.add('nexus-low-power');
    window.homeTheme.mirror();
    applyI18n();
    var snap = Nav.take();
    if (snap) {
      S.drafts = snap.drafts; if (!P.get('mode') && !S.only) S.mode = snap.mode;
      S.search = snap.search || ''; S.sort = snap.sort || 'order'; S.folder = snap.folder || ''; L.view = snap.libView || 'library'; L.trashSearch = snap.trashSearch || '';
      var own = function (o, k) { return typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k); };
      if (own(store.chars, snap.companion) && !H.isTrashed(snap.companion) && !store.chars[snap.companion].group) S.companion = snap.companion;
      if (['order', 'recent', 'name'].indexOf(snap.sort) < 0) S.sort = 'order';
      if (S.folder && !store.folders.some(function (f) { return f[0] === S.folder; })) S.folder = '';
      if (L.view !== 'library' && L.view !== 'trash' || S.mode !== 'rp') L.view = 'library';
      S.search = String(S.search).slice(0, 200); L.trashSearch = String(L.trashSearch).slice(0, 200);
      S.framing = ['focused', 'balanced', 'full'].indexOf(snap.framing) >= 0 ? snap.framing : S.framing;
      void 0; S.tools = !!snap.tools; S.lore = !!snap.lore; S.utilTools = snap.utilTools !== false; S.utilWeb = !!snap.utilWeb; S.utilCollapsed = !!snap.utilCollapsed;
    }
    if (S.mockRuns) Tasks.seedSample();
    mountSeasonal();
    buildMock();
    Nav.init();
    if (L.view === 'trash') Nav.push('trash');
    render();
    startField();
    $$('input[name="mode"]').forEach(function (i) { i.checked = i.value === S.mode; });
    if (snap && snap.scrollY) { var go = function () { window.scrollTo(0, snap.scrollY); }; go(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(go); requestAnimationFrame(go); }
    if (Nav.draftLost) Nav.toast(t('toast.draftLost'));
    H.ready = true;
    document.documentElement.setAttribute('data-ready', '1');
  }
  boot();
})();
