/* Home templates. Pure string builders over Home.store / Home.S; events and layers live in app.js.
   Conventions: data-part = the stable role name a theme pack may target (home/THEME_AUDIT.md); data-* state mirrors what the classes mean (DD-144); data-part-critical marks the protected surfaces
   (DD-149); no style="" attributes (a character's hue goes through data-hue and a generated rule, Home.hue); no literal sizes or colours (home.css reads tokens only). */
(function () {
  'use strict';
  var H = window.Home; var S = H.S; var store = H.store; var t = H.t; var loc = H.loc; var esc = H.esc; var Tasks = H.Tasks; var HS = window.HomeStrings;
  var R = H.R = {};
  var NM = window.NexusMark; var P = H.P;
  var modeName = function (m) { return t('mode.' + m); };
  R.modeName = modeName;
  var icons = {
    home: 'M3 11l9-8 9 8M5 9.5V20h14V9.5', tasks: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01', swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
    code: 'M8 7l-5 5 5 5M16 7l5 5-5 5', flask: 'M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3', sliders: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
    gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1', plus: 'M12 5v14M5 12h14',
    folder: 'M3 6h6l2 2h10v11H3z', search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4', clip: 'M20 11l-8 8a5 5 0 01-7-7l8.5-8.5a3.5 3.5 0 015 5L10 17a2 2 0 01-3-3l7.5-7.5',
    tool: 'M14.5 5.5a4 4 0 005 5L11 19a2 2 0 01-3-3l8.5-8.5a4 4 0 01-2-2z', book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 5v16', send: 'M4 12l16-8-6 16-2-7z',
    globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3.5 3.5 3.5 14.5 0 18M12 3c-3.5 3.5-3.5 14.5 0 18', speaker: 'M4 9h4l5-4v14l-5-4H4zM17 9a4 4 0 010 6',
    chevron: 'M15 6l-6 6 6 6', external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6', chat: 'M4 5h16v11H8l-4 4z', user: 'M12 4a4 4 0 100 8 4 4 0 000-8zM4 21a8 8 0 0116 0',
    hash: 'M5 9h14M5 15h14M10 4L8 20M16 4l-2 16', lang: 'M4 5h9M8 3v2M6 5c1 4 4 7 7 8M11 5c-1 4-4 7-7 8M14 21l4-9 4 9M15.5 18h5', mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
    git: 'M6 3v12M18 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM18 9a9 9 0 01-9 9', compass: 'M12 3a9 9 0 100 18 9 9 0 000-18zM15.5 8.5l-2 5-5 2 2-5z',
    play: 'M7 4l13 8-13 8z', braces: 'M8 4H7a2 2 0 00-2 2v4l-2 2 2 2v4a2 2 0 002 2h1M16 4h1a2 2 0 012 2v4l2 2-2 2v4a2 2 0 01-2 2h-1', stop: 'M7 7h10v10H7z', menu: 'M4 7h16M4 12h16M4 17h16', gearBtn: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2'
  };
  var typeIcons = { coding: 'code', writing: 'book', research: 'search', task: 'chat', translation: 'lang', brainstorm: 'chat' };
  var icon = R.icon = function (n) { return '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="' + icons[n] + '"/></svg>'; };
  var avatar = R.avatar = function (c, size, shape) {
    return '<span class="avatar" data-part="home-avatar" data-size="' + (size || 'sm') + '" data-shape="' + (shape || 'round') + '" data-hue="' + H.hue(c.hue) + '" aria-hidden="true">' + esc(H.initials(loc(c.name))) + '</span>';
  };
  var STATUS = function (s) { return lang() === 'ko' ? (HS.STATUS_KO[s] || s) : (NM.brandStatusLabels[s] || s); };
  var lang = function () { return H.lang; };
  R.statusLabel = STATUS;
  var bgText = function (st) { return st ? t('bg.' + st) : ''; };
  R.bgText = bgText;

  // ---------- small parts ----------
  var statusBadge = function (c) {
    var st = Tasks.bgOf(c.id);
    return st ? '<span class="bg-badge" data-part="home-bg-badge" data-status="' + st + '"><span class="bg-dot" aria-hidden="true"></span><span class="bg-text">' + esc(bgText(st)) + '</span></span>' : '';
  };
  R.statusBadge = statusBadge;

  // ---------- rails ----------
  function railLabel(text) { return '<span class="label" data-part="home-rail-label">' + esc(text) + '</span>'; }
  function rpRail() {
    var recent = store.order.map(function (id) { return store.chars[id]; }).sort(function (a, b) { return a.recent - b.recent; }).slice(0, 5);
    return '<button type="button" class="rail-item rail-icon" data-part="home-rail-item" data-current="true" aria-current="page" data-tip="' + esc(t('rail.home')) + '" data-action="home">' + icon('home') + railLabel(t('rail.home')) + '</button>' +
      '<div class="rail-sep" data-part="home-rail-sep" role="separator"></div>' +
      (recent.length ? '<p class="rail-title" data-part="home-rail-section-title">' + esc(t('rail.recent')) + '</p>' : '') +
      recent.map(function (c, i) {
        var bg = Tasks.bgOf(c.id); var nm = loc(c.name);
        return '<a class="rail-item rail-avatar" data-part="home-rail-avatar" href="' + esc(H.Nav.links.chat(c.id)) + '" data-out data-out-label="' + esc(nm) + '" data-key="char-' + c.id + '" data-tip="' + esc(nm) + '"' + (i === 0 ? ' data-current="true" aria-current="true"' : '') + (bg ? ' data-status="' + bg + '"' : '') + '>' +
          avatar(c, 'md', 'sq') + (bg ? '<span class="rail-dot" data-part="home-bg-badge" data-status="' + bg + '" aria-hidden="true"></span>' : '') + railLabel(nm) +
          '<span class="sr-only">' + (i === 0 ? ', ' + esc(t('rail.lastChat')) : '') + '</span>' + (bg ? '<span class="sr-only bg-sr">, ' + esc(bgText(bg)) + '</span>' : '') + '</a>';
      }).join('') +
      '<button type="button" class="rail-item rail-icon" data-part="home-rail-item" data-tip="' + esc(t('rail.newChar')) + '" data-lib="create" data-key="new-char">' + icon('plus') + railLabel(t('rail.newChar')) + '</button>' +
      '<div class="rail-bottom" data-part="home-rail-bottom">' +
      '<a class="rail-item rail-icon" data-part="home-rail-item" href="' + esc(H.Nav.links.prompts()) + '" data-out data-out-label="' + esc(t('link.settings')) + '" data-tip="' + esc(t('rail.prompts')) + '" data-key="prompts">' + icon('sliders') + railLabel(t('rail.prompts')) + '</a>' +
      '<a class="rail-item rail-icon" data-part="home-rail-item" href="' + esc(H.Nav.links.settings()) + '" data-out data-out-label="' + esc(t('link.settings')) + '" data-tip="' + esc(t('rail.settings')) + '" data-key="settings">' + icon('gear') + railLabel(t('rail.settings')) + '</a></div>';
  }
  function navLink(ic, label, href, key, outLabel, tip) {
    return '<a class="rail-item nav-item" data-part="home-rail-item" href="' + esc(href) + '" data-out data-out-label="' + esc(outLabel) + '" data-key="' + key + '"' + (tip ? ' data-tip="' + esc(label) + '"' : '') + '>' + icon(ic) + railLabel(label) + '</a>';
  }
  function navBtn(ic, label, attrs, tip) {
    return '<button type="button" class="rail-item nav-item" data-part="home-rail-item" ' + attrs + (tip ? ' data-tip="' + esc(label) + '"' : '') + '>' + icon(ic) + railLabel(label) + '</button>';
  }
  function hybridRail() {
    var pinned = ['sera', 'hollis', 'lumi', 'airisu'].filter(function (id) { return id === 'airisu' || (store.chars[id] && !H.isTrashed(id) && store.order.indexOf(id) >= 0); }).map(function (id) { return store.chars[id]; });
    return '<button type="button" class="rail-item nav-item" data-part="home-rail-item" data-current="true" aria-current="page" data-action="home">' + icon('home') + railLabel(t('rail.home')) + '</button>' +
      navBtn('tasks', t('hy.railTasks'), 'data-action="tasks"') + navBtn('swap', t('hy.railSwap'), 'data-action="companion"') +
      navLink('code', t('hy.railStudio'), H.Nav.links.studio(), 'nav-code', t('link.studio')) + navBtn('flask', t('hy.railTools'), 'data-demo data-demo-label="' + esc(t('hy.railTools')) + '" data-key="nav-flask"') +
      '<p class="rail-title" data-part="home-rail-section-title">' + esc(t('hy.railComp')) + '</p>' +
      pinned.map(function (c) {
        var cur = S.companion === c.id;
        return '<button type="button" class="rail-item companion-row" data-part="home-rail-item" data-companion="' + c.id + '"' + (cur ? ' data-current="true" aria-current="true"' : '') + '>' + avatar(c, 'sm') +
          '<span class="label">' + esc(loc(c.name)) + (c.builtIn ? ' <span class="tag" data-part="home-tag">' + esc(t('char.builtIn')) + '</span>' : '') + '</span>' + (cur ? '<span class="live" aria-hidden="true"></span><span class="sr-only">' + esc(t('hy.active')) + '</span>' : '') + '</button>';
      }).join('') +
      '<div class="rail-bottom" data-part="home-rail-bottom">' + navLink('sliders', t('hy.railPresets'), H.Nav.links.models(), 'presets', t('link.settings')) + navLink('gear', t('rail.settings'), H.Nav.links.settings(), 'settings', t('link.settings')) + '</div>';
  }
  function utilRail() {
    var coll = S.utilCollapsed;
    var wsNames = { release: t('ut.ws.release'), parser: t('ut.ws.parser'), thesis: t('ut.ws.thesis') };
    var tools = [['code', t('ut.tool.studio'), 'studio'], ['tool', t('ut.tool.mcp')], ['hash', t('ut.tool.tokenizer')], ['braces', t('ut.tool.jinja')], ['play', t('ut.tool.parser')], ['compass', t('ut.tool.embedding')], ['lang', t('ut.tool.translation')]];
    return '<div class="rail-top" data-part="home-rail-top"><button type="button" class="btn rail-new" data-part="home-rail-new" data-variant="accent" id="new-task" aria-label="' + esc(t('ut.newTask')) + '" data-tip="' + esc(t('ut.newTask')) + '">' + icon('plus') + railLabel(t('ut.newTask')) + '</button>' +
      '<button type="button" class="btn icon-btn" data-part="home-rail-collapse" id="collapse" aria-expanded="' + !coll + '" aria-controls="rail"><span class="collapse-ic" aria-hidden="true">' + icon('chevron') + '</span><span class="sr-only">' + esc(coll ? t('ut.expand') : t('ut.collapse')) + '</span></button></div>' +
      (store.workspaces.length ? '<p class="rail-title" data-part="home-rail-section-title">' + esc(t('ut.workspaces')) + '</p>' : '') +
      store.workspaces.map(function (w, i) {
        var nm = wsNames[w[0]]; return '<button type="button" class="rail-item nav-item" data-part="home-rail-item" aria-label="' + esc(nm) + '" data-tip="' + esc(nm) + '" data-demo data-demo-label="' + esc(nm) + '" data-key="ws-' + i + '">' + icon('folder') + railLabel(nm) + '<span class="count" data-part="home-count">' + w[1] + '</span></button>';
      }).join('') +
      '<p class="rail-title" data-part="home-rail-section-title">' + esc(t('ut.recent')) + '</p>' +
      '<div id="util-recent">' + store.threads.utility.map(function (th, i) {
        var nm = loc(th.title);
        return '<button type="button" class="rail-item nav-item" data-part="home-rail-item" data-thread="' + th.id + '" aria-label="' + esc(nm + ', ' + H.tagLabel(th.tag)) + '" data-tip="' + esc(nm) + '" data-key="recent-' + i + '">' + icon(typeIcons[th.tag] || 'chat') + '<span class="label label-fill" data-part="home-rail-label">' + esc(nm) + '</span></button>';
      }).join('') + '</div>' +
      '<p class="rail-title" data-part="home-rail-section-title">' + esc(t('ut.tools')) + '</p>' +
      tools.map(function (x, i) {
        return x[2] === 'studio' ? '<a class="rail-item nav-item" data-part="home-rail-item" href="' + esc(H.Nav.links.studio()) + '" data-out data-out-label="' + esc(t('link.studio')) + '" aria-label="' + esc(x[1]) + '" data-tip="' + esc(x[1]) + '" data-key="tool-code">' + icon(x[0]) + railLabel(x[1]) + '</a>'
          : '<button type="button" class="rail-item nav-item" data-part="home-rail-item" aria-label="' + esc(x[1]) + '" data-tip="' + esc(x[1]) + '" data-demo data-demo-label="' + esc(x[1]) + '" data-key="tool-' + x[0] + '">' + icon(x[0]) + railLabel(x[1]) + '</button>';
      }).join('') +
      '<div class="rail-bottom" data-part="home-rail-bottom">' +
      '<a class="rail-item nav-item" data-part="home-rail-item" href="' + esc(H.Nav.links.models()) + '" data-out data-out-label="' + esc(t('link.settings')) + '" aria-label="' + esc(t('hy.railPresets')) + '" data-tip="' + esc(t('hy.railPresets')) + '" data-key="presets">' + icon('sliders') + railLabel(t('hy.railPresets')) + '</a>' +
      '<a class="rail-item nav-item" data-part="home-rail-item" href="' + esc(H.Nav.links.settings()) + '" data-out data-out-label="' + esc(t('link.settings')) + '" aria-label="' + esc(t('rail.settings')) + '" data-tip="' + esc(t('rail.settings')) + '" data-key="settings">' + icon('gear') + railLabel(t('rail.settings')) + '</a></div>';
  }

  // ---------- top bar ----------
  R.tasksInner = function () {
    var n = Tasks.activeCount();
    return icon('tasks') + '<span class="label">' + esc(t('tasks')) + '</span>' + (n ? '<span class="badge" data-part="home-badge" aria-hidden="true">' + n + '</span>' : '') + '<span class="sr-only">' + esc(n ? t('tasks.n', { n: n }) : t('tasks.none')) + '</span>';
  };
  R.tasksButton = function () { return '<button type="button" class="pill pill-text" data-part="home-tasks-button" id="tasks-button" aria-haspopup="dialog" data-count="' + Tasks.activeCount() + '">' + R.tasksInner() + '</button>'; };
  function rpTop() {
    var p = H.activePersona(); var nm = H.personaName();
    return '<a class="pill pill-persona" data-part="home-pill" data-pill="persona" id="persona-chip" href="' + esc(H.Nav.links.persona()) + '" data-out data-out-label="' + esc(t('link.settings')) + '" title="' + esc(t('persona.hint')) + '">' + avatar({ hue: p.hue, name: { ko: nm, en: nm } }, 'xs') +
      '<span class="label">' + esc(t('persona.chip', { name: nm })) + '</span><span class="sr-only">. ' + esc(t('persona.hint')) + '. ' + esc(t('persona.go')) + '</span></a>';
  }
  function hybridTop() {
    if (!S.provider) return '<button type="button" class="pill pill-text" data-part="home-pill" data-pill="model" id="model-pill" data-lib="setup" data-provider="' + (S.providerIssue === 'key' ? 'no-key' : 'no-model') + '">' + icon('sliders') + '<span class="label">' + esc(S.providerIssue === 'key' ? t('model.noKey') : t('model.none')) + '</span><span class="sr-only">' + esc(t('model.setupSr')) + '</span></button>';
    return '<a class="pill pill-text" data-part="home-pill" data-pill="model" id="model-pill" href="' + esc(H.Nav.links.models()) + '" data-out data-out-label="' + esc(t('link.settings')) + '" data-provider="ready">' + icon('sliders') + '<span class="label">' + esc(t('model.pill')) + '</span><span class="sr-only">' + esc(t('model.pillSr')) + '</span></a>';
  }
  function utilTop() {
    if (!S.provider) return '<button type="button" class="pill pill-text" data-part="home-pill" data-pill="model" data-lib="setup" data-provider="' + (S.providerIssue === 'key' ? 'no-key' : 'no-model') + '"><span class="label">' + esc(S.providerIssue === 'key' ? t('model.noKey') : t('model.none')) + '</span><span class="sr-only">' + esc(t('model.setupSr')) + '</span></button>';
    return '<span class="pill pill-text pill-static" data-part="home-pill" data-pill="context" data-provider="ready"><span class="label">' + esc(t('model.context')) + '</span><span class="muted num">12k / 100k</span><span class="sr-only">' + esc(t('model.contextSr')) + '</span></span>';
  }

  // ---------- Roleplay main ----------
  var realmGate = R.realmGate = function (cls) {
    // DD-206: one gate, everywhere. Before the agreement the RisuRealm entry is the consent text and its button, never a link.
    return '<div class="' + (cls || 'realm-gate') + '" data-part="home-realm-gate" data-part-critical><span data-testid="upstream-consent-placeholder">' + esc(t('realm.gateLink')) + '</span><button type="button" class="btn" data-part="home-realm-consent-action" data-variant="raised" data-realm-action="ask">' + esc(t('realm.consentBtn')) + '</button></div>';
  };
  R.realmEntry = function (label, cls) {
    if (S.realm === 'hidden') return '';
    if (!S.agreed) return realmGate();
    return '<button type="button" class="link-btn ' + (cls || '') + '" data-part="home-realm-link" data-action="hub">' + esc(label) + '</button>';
  };
  function rpMain() {
    var lib = store.order.length || store.trash.length;
    var nm = H.personaName();
    var greeting = t(lib ? 'rp.welcomeBack' : 'rp.welcome', { name: nm });
    var head = '<div class="rp-head" data-part="home-greeting"><div><p class="eyebrow" data-part="home-eyebrow">' + esc(t('rp.eyebrow')) + '</p><h1 class="h1">' + esc(greeting) + '</h1><p class="muted small persona-caption">' + esc(t('persona.caption')) + '</p></div></div>';
    var shelf = shelfStories();
    return head + '<div class="rp-body"><div class="stage">' +
      (shelf.length ? '<section id="continue-section" aria-labelledby="continue-h" data-part="home-shelf-section"><div class="section-head"><h2 id="continue-h">' + esc(t('continue.h')) + '</h2></div><div class="shelf" data-part="home-shelf">' + shelf.map(storyCard).join('') + '</div></section>' : '') +
      '<section class="card glass library" data-part="home-library" data-manage="' + S.lib.manage + '" data-library-view="' + S.lib.view + '" aria-labelledby="library-h"><div class="section-head"><h2 id="library-h">' + esc(t('lib.h')) + '</h2><span class="muted small" id="lib-count" role="status"></span></div><div id="lib-msg" role="status"></div><div id="lib-body">' + R.libBody() + '</div></section>' +
      '</div><aside class="side" aria-label="' + esc(t('community.aside')) + '">' + (S.realm !== 'hidden' ? realmCard() : '') + communityCard() + '</aside></div>';
  }
  function shelfStories() { return store.stories.filter(function (s) { return store.order.indexOf(s.id) >= 0; }); }
  function storyCard(s) {
    var c = store.chars[s.id]; var bg = Tasks.bgOf(c.id); var nm = loc(c.name);
    return '<a class="story glass nexus-enter" data-part="home-story" href="' + esc(H.Nav.links.chat(c.id)) + '" data-out data-out-label="' + esc(nm) + '" data-key="story-' + c.id + '"' + (bg ? ' data-status="' + bg + '"' : '') + '>' +
      '<span class="portrait" data-part="home-story-portrait" data-hue="' + H.hue(c.hue) + '" aria-hidden="true">' + esc(H.initials(nm)) + '</span>' + statusBadge(c) +
      '<span class="body" data-part="home-story-body"><b data-part="home-story-name">' + esc(nm) + '</b><span class="muted small" data-part="home-story-branch">' + esc(loc(s.branch)) + '</span><span class="snippet" data-part="home-story-snippet">' + esc(loc(s.snippet)) + '</span>' +
      '<span class="meta" data-part="home-story-meta"><span class="tag" data-part="home-memory-tag" data-kind="memory">' + esc(s.memory || t('story.noMemory')) + '</span><span data-part="home-story-time">' + esc(H.ago(s.min)) + '</span></span></span></a>';
  }
  function communityCard() {
    var links = [['chat', t('community.discord')], ['globe', t('community.web')], ['git', t('community.src')], ['mail', t('community.mail')]];
    return '<section class="card glass community" data-part="home-community" aria-labelledby="community-h"><h3 id="community-h">' + esc(t('community.h')) + '</h3><div class="links">' +
      links.map(function (l) { return '<a class="link-row" data-part="home-community-link" href="#" data-demo-ext data-demo-label="' + esc(l[1]) + '">' + icon(l[0]) + esc(l[1]) + '</a>'; }).join('') + '</div></section>';
  }
  function realmList() {
    return '<div class="realm-list" data-part="home-realm-list" data-realm-preview-list><p class="eyebrow">' + esc(t('realm.latest')) + '</p><div class="realm-scroll" data-scroll>' + store.realm.map(function (r, i) {
      var nm = loc(r[0]); return '<button type="button" class="realm-item" data-part="home-realm-item" data-action="hub" data-key="realm-' + i + '">' + avatar({ hue: r[2], name: r[0] }, 'sm') + '<span><b>' + esc(nm) + '</b><small>' + esc(loc(r[1])) + '</small></span><span class="sr-only">. ' + esc(t('realm.item', { name: nm })) + '</span></button>';
    }).join('') + '</div></div>';
  }
  var announceHtml = function () { return '<details class="announce" data-part="home-realm-announce"><summary>' + esc(t('realm.announce')) + '</summary><p class="muted">' + esc(t('realm.announceBody')) + '</p></details>'; };
  R.announceHtml = announceHtml; R.realmList = realmList;
  R.realmMore = function (r) {
    if (!S.agreed || (r !== 'populated' && r !== 'empty')) return '';
    return '<button type="button" class="btn realm-more" data-part="home-realm-more" data-variant="raised" data-action="hub">' + esc(t('realm.more')) + icon('external') + '</button><a class="link-btn realm-page" data-part="home-realm-link" href="' + esc(H.Nav.links.realm()) + '" data-out data-out-label="RisuRealm">' + esc(t('realm.page')) + '</a>';
  };
  R.realmStatus = function (r) {
    if (r === 'consent') return '<span data-testid="upstream-consent-placeholder">' + esc(t('realm.consent')) + '</span><button type="button" class="btn" data-part="home-realm-consent-action" data-variant="raised" data-testid="upstream-consent-accept" data-realm-action="ask">' + esc(t('realm.consentBtn')) + '</button>';
    if (r === 'pending') return NM.markSvg('realm-pending', 'transfer_in', { size: H.tokPx('--home-realm-mark-size', 32) }) + '<span>' + esc(t('realm.pending')) + '</span>';
    if (r === 'offline') return '<span>' + esc(t('realm.offline')) + '</span><button type="button" class="btn" data-variant="raised" aria-disabled="true">' + esc(t('realm.retry')) + '</button>';
    if (r === 'failed') return '<span>' + esc(t('realm.failed')) + '</span><button type="button" class="btn" data-variant="raised" data-realm-action="load">' + esc(t('realm.retry')) + '</button>';
    if (r === 'empty') return '<span>' + esc(t('realm.empty')) + '</span>';
    return '<span class="sr-only">' + esc(t('realm.loaded', { n: store.realm.length })) + '</span>';
  };
  function realmCard() {
    var r = S.agreed ? (S.realm === 'consent' ? 'populated' : S.realm) : 'consent';
    return '<section class="card glass realm" data-part="home-realm" data-realm="' + r + '" aria-labelledby="realm-h"><div class="realm-title"><h3 id="realm-h">' + esc(t('realm.h')) + '</h3><span class="tag" data-part="home-tag" data-kind="upstream">' + esc(t('realm.upstream')) + '</span></div>' +
      '<p class="muted small">' + esc(t('realm.sub')) + '</p>' + (r === 'populated' ? realmList() : '') +
      '<div class="realm-status" data-part="home-realm-status" ' + (r === 'consent' ? 'data-part-critical ' : '') + 'data-loaded="' + (r === 'populated') + '" role="status" aria-live="polite" tabindex="-1">' + R.realmStatus(r) + '</div>' +
      (r === 'populated' ? announceHtml() : '') + R.realmMore(r) + '</section>';
  }
  R.realmCard = realmCard;

  // ---------- library ----------
  R.foldersHtml = function () {
    return store.folders.map(function (f) {
      var n = store.order.filter(function (id) { return store.chars[id].folder === f[0]; }).length;
      return '<button type="button" class="chip-btn" data-part="home-folder-chip" data-folder="' + f[0] + '" aria-pressed="' + (S.folder === f[0]) + '"' + (S.folder === f[0] ? ' data-selected="true"' : '') + '>' + icon('folder') + esc(t(f[1])) + '<span class="count" data-part="home-count">' + n + '</span></button>';
    }).join('');
  };
  R.emptyHero = function () {
    return '<div class="empty-hero" data-part="home-empty-hero" id="empty-hero"><span class="hero-mark" data-part="home-hero-mark" aria-hidden="true">' + icon('book') + '</span><h3 id="empty-h" class="h-hero">' + esc(t('empty.h')) + '</h3><p class="muted">' + esc(t('empty.p')) + '</p>' +
      '<div class="hero-actions"><button type="button" class="btn" data-variant="primary" data-lib="create">' + esc(t('empty.create')) + '</button><button type="button" class="btn" data-variant="raised" data-lib="import">' + esc(t('empty.import')) + '</button></div>' +
      R.realmEntry(t('empty.browse'), 'small') + '</div>';
  };
  R.libBody = function () {
    var tab = function (v, label, n) { return '<button type="button" class="chip-btn" data-part="home-lib-tab" data-view="' + v + '" aria-pressed="' + (S.lib.view === v) + '"' + (S.lib.view === v ? ' data-selected="true"' : '') + ' data-lib="view-' + v + '">' + esc(label) + '<span class="count" data-part="home-count">' + n + '</span></button>'; };
    var tabs = '<div class="lib-views" role="group" aria-label="' + esc(t('lib.views')) + '">' + tab('library', t('lib.tab.chars'), store.order.length) + tab('trash', t('lib.tab.trash'), store.trash.length) + '</div>';
    if (S.lib.view === 'trash') return tabs + R.trashHtml();
    if (!store.order.length) return tabs + R.emptyHero();
    var sortOpts = [['order', 'lib.sort.order'], ['recent', 'lib.sort.recent'], ['name', 'lib.sort.name']].map(function (o) { return '<option value="' + o[0] + '"' + (S.sort === o[0] ? ' selected' : '') + '>' + esc(t(o[1])) + '</option>'; }).join('');
    return tabs + '<div class="lib-tools" data-part="home-library-tools"><label class="search field" data-part="home-search">' + icon('search') + '<span class="sr-only">' + esc(t('lib.search')) + '</span><input id="lib-search" type="search" placeholder="' + esc(t('lib.search')) + '" value="' + esc(S.search) + '"></label>' +
      '<label class="sort small muted">' + esc(t('lib.sort')) + ' <select id="lib-sort" data-part="home-sort" class="field">' + sortOpts + '</select></label>' +
      '<button type="button" class="btn" data-variant="raised" data-lib="create">' + icon('plus') + esc(t('lib.new')) + '</button>' +
      '<button type="button" class="btn" data-variant="raised" data-lib="manage" aria-pressed="' + S.lib.manage + '"' + (S.lib.manage ? ' data-selected="true"' : '') + '>' + esc(t('lib.manage')) + '</button></div>' +
      (S.lib.manage ? '<div class="sel-bar" data-part="home-selection-bar" id="sel-bar" role="group" aria-label="' + esc(t('sel.group')) + '"><span id="sel-count" role="status"></span>' +
        '<span class="sel-desk"><button type="button" class="btn" data-variant="raised" data-lib="select-all">' + esc(t('sel.all')) + '</button><button type="button" class="btn" data-variant="raised" data-lib="move" data-needs-sel>' + esc(t('sel.move')) + '</button><button type="button" class="btn" data-variant="danger" data-lib="trash" data-needs-sel>' + esc(t('sel.trash')) + '</button></span>' +
        '<button type="button" class="btn sel-phone" data-variant="raised" data-lib="actions" aria-haspopup="dialog">' + esc(t('sel.actions')) + '</button><button type="button" class="btn" data-variant="raised" data-lib="done">' + esc(t('sel.done')) + '</button></div>' : '') +
      '<div class="folders" role="group" aria-label="' + esc(t('lib.folders')) + '" id="folders">' + R.foldersHtml() + '</div><div class="chars" data-part="home-char-grid" id="char-grid"></div>';
  };
  var canReorder = R.canReorder = function () { return S.lib.manage && S.sort === 'order' && !S.folder && !S.search.trim(); };
  R.charRow = function (c, i, n) {
    var nm = loc(c.name); var bg = Tasks.bgOf(c.id);
    var info = '<span class="char-text" data-part="home-char-text"><span class="char-name" data-part="home-char-name">' + esc(nm) + '</span><small data-part="home-char-chats">' + esc(t(c.group ? 'char.group' : 'char.chats', { n: c.chats })) + '</small></span>';
    if (!S.lib.manage) {
      return '<a class="char card-raised" data-part="home-char-card" href="' + esc(H.Nav.links.chat(c.id)) + '" data-out data-out-label="' + esc(nm) + '" data-key="char-' + c.id + '"' + (bg ? ' data-status="' + bg + '"' : '') + '>' + avatar(c, 'lg', 'sq') + (bg ? '<span class="rail-dot" data-part="home-bg-badge" data-status="' + bg + '" aria-hidden="true"></span>' : '') + info + (bg ? '<span class="sr-only bg-sr">, ' + esc(bgText(bg)) + '</span>' : '') + '</a>';
    }
    var sel = S.lib.sel.indexOf(c.id) >= 0;
    var mv = canReorder() ? '<button type="button" class="btn mv" data-variant="raised" data-lib="up" data-id="' + c.id + '" aria-label="' + esc(t('char.up', { name: nm })) + '"' + (i === 0 ? ' aria-disabled="true"' : '') + '>↑</button><button type="button" class="btn mv" data-variant="raised" data-lib="down" data-id="' + c.id + '" aria-label="' + esc(t('char.down', { name: nm })) + '"' + (i === n - 1 ? ' aria-disabled="true"' : '') + '>↓</button>' : '';
    return '<div class="char-row card-raised" data-part="home-char-row" data-row="' + c.id + '"' + (sel ? ' data-selected="true"' : '') + '><label class="sel"><input type="checkbox" data-sel="' + c.id + '"' + (sel ? ' checked' : '') + '><span class="sr-only">' + esc(t('char.select', { name: nm })) + '</span></label>' +
      '<span class="char" data-key="char-' + c.id + '">' + avatar(c, 'md', 'sq') + info + '</span>' + mv + '</div>';
  };
  R.trashMatches = function () { var q = S.lib.trashSearch.trim().toLowerCase(); return store.trash.filter(function (x) { return !q || loc(store.chars[x.id].name).toLowerCase().indexOf(q) >= 0; }); };
  R.trashEmptyLabel = function () { var m = R.trashMatches().length; return S.lib.trashSearch.trim() ? t('trash.emptyQ', { n: m }) : t('trash.empty', { n: m }); };
  R.trashScope = function () {
    var m = R.trashMatches().length, total = store.trash.length, q = S.lib.trashSearch.trim();
    return q ? t('trash.scopeQ', { m: m, total: total, rest: total - m, q: q }) : t('trash.scopeAll', { total: total });
  };
  R.trashListHtml = function () {
    var m = R.trashMatches();
    if (!m.length) return '<div class="empty-lib">' + esc(t('trash.noMatch', { q: S.lib.trashSearch })) + '<br><button type="button" class="btn" data-variant="raised" data-lib="clear-trash-search">' + esc(t('trash.clearSearch')) + '</button></div>';
    return m.map(function (x) {
      var c = store.chars[x.id]; var nm = loc(c.name); var left = Math.max(1, H.DAYS_KEPT - x.days);
      return '<div class="trash-row card-raised" data-part="home-trash-row" data-trash="' + x.id + '"' + (x.status ? ' data-status="' + x.status + '"' : '') + '>' + avatar(c, 'md', 'sq') +
        '<div class="char-text"><b>' + esc(nm) + '</b><small>' + esc(t('char.chats', { n: c.chats })) + ' · ' + esc(t('trash.days', { d: left })) + (x.status === 'restoring' ? ' · ' + esc(t('trash.restoring')) : '') + '</small>' +
        (x.status === 'failed' ? '<small class="err" data-part="home-restore-error" data-part-critical role="alert">' + esc(t('trash.restoreFail')) + '</small>' : '') + '</div>' +
        '<button type="button" class="btn" data-variant="raised" data-lib="restore" data-id="' + x.id + '"' + (x.status === 'restoring' ? ' aria-disabled="true" aria-busy="true"' : '') + '>' + esc(x.status === 'restoring' ? t('trash.restoring') : x.status === 'failed' ? t('trash.retry') : t('trash.restore')) + '<span class="sr-only"> ' + esc(nm) + '</span></button></div>';
    }).join('');
  };
  R.trashHtml = function () {
    if (!store.trash.length) return '<div class="empty-lib" id="trash-empty-state">' + t('trash.none') + '</div>';
    return '<div class="lib-tools" data-part="home-library-tools"><label class="search field" data-part="home-search">' + icon('search') + '<span class="sr-only">' + esc(t('trash.search')) + '</span><input id="trash-search" type="search" placeholder="' + esc(t('trash.search')) + '" value="' + esc(S.lib.trashSearch) + '"></label>' +
      '<button type="button" class="btn" data-part="home-trash-empty" data-part-critical data-variant="danger" id="trash-empty" data-lib="empty-trash"' + (R.trashMatches().length ? '' : ' aria-disabled="true"') + '>' + esc(R.trashEmptyLabel()) + '</button></div>' +
      '<p class="muted small trash-scope" data-part="home-trash-scope" data-part-critical id="trash-scope" role="status">' + esc(R.trashScope()) + '</p><div class="trash-list" id="trash-list">' + R.trashListHtml() + '</div>';
  };

  // ---------- run cards (Hybrid, Utility) and the Tasks dialog ----------
  R.pct = function (task) { var total = task.total || 1; return task.state === 'queued' ? 0 : Math.round(Math.min(task.step, total) / total * 100); };
  R.statusLine = function (task) {
    if (task.state === 'queued') return t('run.queued');
    var where = task.state === 'active' ? t('run.step', { n: Math.min(task.step, task.total), total: task.total }) : (task.status === 'done' || task.status === 'stopped' && task.note === 'cancelled') ? '' : t('run.stepAt', { n: Math.min(task.step, task.total), total: task.total });
    return STATUS(task.status) + where;
  };
  R.runMeta = function (task) {
    if (task.state === 'queued') return t('run.queuedMeta');
    if (task.note === 'failed') return t('run.failed');
    if (task.note === 'stopped' || task.note === 'cancelled') return t('run.stopped');
    return loc(task.meta) || '';
  };
  R.runActions = function (task, where) {
    var out = [];
    if (task.state === 'active') out.push('<button type="button" class="btn" data-part="home-run-stop" data-variant="stop" data-task-act="stop" data-id="' + task.id + '">' + icon('stop') + esc(t('run.stop')) + '<span class="sr-only"> ' + esc(Tasks.title(task)) + '</span></button>');
    if (task.state === 'queued') out.push('<button type="button" class="btn" data-part="home-run-stop" data-variant="stop" data-task-act="stop" data-id="' + task.id + '">' + esc(t('run.cancel')) + '<span class="sr-only"> ' + esc(Tasks.title(task)) + '</span></button>');
    if (task.state === 'ended' && task.status === 'error' && task.kind !== 'reply') out.push('<button type="button" class="btn" data-part="home-run-retry" data-part-critical data-variant="raised" data-task-act="retry" data-id="' + task.id + '">' + esc(t('run.retry')) + '<span class="sr-only"> ' + esc(Tasks.title(task)) + '</span></button>');
    return out.join('');
  };
  R.runCard = function (task) {
    var size = H.tokPx('--home-run-mark-size', 64);
    var errNote = task.note === 'failed' ? ' data-part-critical' : '';
    return '<article class="run" data-part="home-run-card" data-task-id="' + task.id + '" data-status="' + task.status + '" data-state="' + task.state + '">' +
      '<span class="run-mark" data-part="home-run-mark">' + NM.markSvg('run-' + task.id, task.status === 'waiting' && task.state === 'queued' ? 'waiting' : task.status, { size: size }) + '</span>' +
      '<div class="run-body"><h3 class="run-title" data-part="home-run-title">' + esc(Tasks.title(task)) + '</h3><div class="status" data-part="home-run-status"><span class="dot" aria-hidden="true"></span><span class="status-text">' + esc(R.statusLine(task)) + '</span></div>' +
      '<progress class="run-bar" data-part="home-run-progress" max="100" value="' + R.pct(task) + '" aria-hidden="true"></progress>' +
      '<p class="muted small run-meta" data-part="' + (task.note === 'failed' ? 'home-run-error"' + errNote : 'home-run-meta"') + '>' + esc(R.runMeta(task)) + '</p>' +
      '<div class="run-actions" data-part="home-run-actions">' + R.runActions(task) + '</div></div></article>';
  };
  R.idleRunCard = function () {
    var size = H.tokPx('--home-run-mark-size', 64);
    var meta = !S.provider ? t('run.noProviderMeta') : t('run.idleMeta');
    var line = !S.provider ? (S.providerIssue === 'key' ? t('run.waitKey') : t('run.waitModel')) : STATUS('idle');
    return '<article class="run" data-part="home-run-card" data-state="idle" data-status="idle" id="run-idle"><span class="run-mark" data-part="home-run-mark">' + NM.markSvg('run-idle', 'idle', { size: size }) + '</span><div class="run-body"><h3 class="run-title" data-part="home-run-title">' + esc(t('run.idleTitle')) + '</h3>' +
      '<div class="status" data-part="home-run-status"><span class="dot" aria-hidden="true"></span><span class="status-text">' + esc(line) + '</span></div><progress class="run-bar" data-part="home-run-progress" max="100" value="0" aria-hidden="true"></progress><p class="muted small run-meta" data-part="home-run-meta">' + esc(meta) + '</p></div></article>';
  };
  R.visibleThreads = function () { return store.threads.hybrid.filter(function (th) { return !H.isTrashed(th.by); }); };
  R.runList = function (mode) {
    var list = Tasks.visible(mode);
    return list.length ? list.map(R.runCard).join('') : R.idleRunCard();
  };
  R.runCount = function (mode) { var n = Tasks.activeCount(mode); var q = Tasks.queuedCount(mode); return n || q ? t('run.of', { n: n, cap: H.CAP }) : ''; };

  // ---------- composer (Hybrid, Utility) ----------
  R.setupNote = function () {
    if (S.provider) return '';
    var key = S.providerIssue === 'key';
    return '<div class="setup-note" data-part="home-setup-note" data-part-critical role="group" aria-labelledby="setup-h"><div><b id="setup-h">' + esc(key ? t('setup.noKey') : t('setup.noModel')) + '</b><span class="muted small block">' + esc(t('setup.hint', { what: key ? t('setup.whatKey') : t('setup.whatModel') })) + '</span></div>' +
      '<button type="button" class="btn" data-part="home-setup-action" data-variant="raised" data-lib="setup">' + esc(key ? t('setup.btnKey') : t('setup.btnModel')) + '</button></div>';
  };
  function composerBar(mode) {
    var send = mode === 'hybrid' ? t('hy.send') : t('ut.run');
    var buttons = mode === 'hybrid'
      ? '<button type="button" class="btn ghost" data-part="home-composer-button" data-demo data-demo-label="' + esc(t('hy.attach')) + '" data-key="attach">' + icon('clip') + esc(t('hy.attach')) + '</button>' +
        '<button type="button" class="btn ghost" data-part="home-composer-button" data-toggle="tools" aria-pressed="' + S.tools + '"' + (S.tools ? ' data-selected="true"' : '') + '>' + icon('tool') + esc(t('hy.tools')) + '</button>' +
        '<button type="button" class="btn ghost" data-part="home-composer-button" data-toggle="lore" aria-pressed="' + S.lore + '"' + (S.lore ? ' data-selected="true"' : '') + '>' + icon('book') + esc(t('hy.lore')) + '</button>'
      : '<button type="button" class="btn ghost" data-part="home-composer-button" data-demo data-demo-label="' + esc(t('hy.attach')) + '" data-key="attach">' + icon('clip') + esc(t('hy.attach')) + '</button>' +
        '<button type="button" class="btn ghost" data-part="home-composer-button" data-toggle="utilTools" aria-pressed="' + S.utilTools + '"' + (S.utilTools ? ' data-selected="true"' : '') + '>' + icon('tool') + esc(t('ut.mcp')) + '</button>' +
        '<button type="button" class="btn ghost" data-part="home-composer-button" data-demo data-demo-label="' + esc(t('ut.preset')) + '" data-key="preset">' + icon('sliders') + esc(t('ut.preset')) + '</button>' +
        '<button type="button" class="btn ghost" data-part="home-composer-button" data-toggle="utilWeb" aria-pressed="' + S.utilWeb + '"' + (S.utilWeb ? ' data-selected="true"' : '') + '>' + icon('globe') + esc(t('ut.web')) + '</button>';
    return '<div class="composer-bar" data-part="home-composer-bar">' + buttons + '<span class="run-count small muted" data-part="home-run-count" id="run-count">' + esc(R.runCount(mode)) + '</span><button type="submit" class="btn send" data-part="home-send" data-variant="primary" id="send">' + icon('send') + '<span data-part="home-send-label">' + esc(send) + '</span><span class="sr-only"> (Enter)</span></button></div>';
  }
  R.composer = function (mode, ph, label, hero) {
    var provider = S.provider ? 'ready' : (S.providerIssue === 'key' ? 'no-key' : 'no-model');
    return '<form class="card glass composer' + (hero ? ' hero' : '') + '" data-part="home-composer" data-provider="' + provider + '" id="composer" data-mode="' + mode + '"' + (hero ? ' data-hero="true"' : '') + '><label class="sr-only" for="prompt">' + esc(label) + '</label>' +
      '<textarea id="prompt" data-part="home-composer-field" aria-describedby="composer-note" placeholder="' + esc(ph) + '">' + esc(S.drafts[mode]) + '</textarea>' + composerBar(mode) + '</form>' +
      '<p class="composer-note" id="composer-note" data-part="home-composer-note" data-part-critical role="status"></p>';
  };

  // ---------- Hybrid main ----------
  var threadRow = R.threadRow = function (th) {
    var by = store.chars[th.by] || store.chars.airisu;
    return '<a class="thread" data-part="home-thread-row" href="' + esc(H.Nav.links.chat(by.id)) + '" data-out data-out-label="' + esc(loc(th.title)) + '">' + avatar(by, 'sm') + '<span class="title" data-part="home-thread-title">' + esc(loc(th.title)) + '</span><span class="tag" data-part="home-tag" data-kind="type">' + esc(H.tagLabel(th.tag)) + '</span><time data-part="home-thread-time">' + esc(H.ago(th.min)) + '</time></a>';
  };
  function emptyCompanionCard() {
    var lib = store.order.length ? t('hy.companionLib') : t('hy.companionLib0');
    return '<section class="card glass presence nexus-enter" data-part="home-presence" data-companion="none" aria-labelledby="companion-name"><span class="portrait" data-part="home-companion-portrait" data-hue="' + H.hue(200) + '" aria-hidden="true">?</span>' +
      '<div class="presence-text"><p class="eyebrow">' + esc(t('hy.eyebrow')) + '</p><h1 id="companion-name" class="h1 h1-sm">' + esc(t('hy.companionH')) + '</h1><p class="muted">' + esc(t('hy.companionP', { lib: lib })) + '</p></div>' +
      '<div class="presence-actions"><button type="button" class="btn" data-variant="primary" data-action="companion" aria-haspopup="dialog">' + esc(t('hy.choose')) + '</button><button type="button" class="btn" data-variant="raised" data-lib="goto-rp">' + esc(t('hy.goRp')) + '</button></div></section>';
  }
  function hybridMain() {
    var c = S.companion ? H.charById(S.companion) : null; var nm = c ? loc(c.name) : '';
    var greetKey = c ? { sera: 'hy.greet.sera', hollis: 'hy.greet.hollis', lumi: 'hy.greet.lumi', airisu: 'hy.greet.airisu' }[c.id] || 'hy.greet.default' : 'hy.greet.default';
    var presence = c ? '<section class="card glass presence nexus-enter" data-part="home-presence" data-companion="present" aria-labelledby="companion-name"><span class="portrait" data-part="home-companion-portrait" data-hue="' + H.hue(c.hue) + '" aria-hidden="true">' + esc(H.initials(nm)) + '</span>' +
      '<div class="presence-text"><p class="eyebrow">' + esc(t('hy.eyebrow')) + '</p><h1 id="companion-name" class="h1 h1-sm warm">' + esc(nm) + '</h1><p class="muted">' + esc(t(greetKey)) + '</p></div>' +
      '<div class="presence-actions"><button type="button" class="btn" data-variant="raised" data-action="companion" aria-haspopup="dialog">' + icon('swap') + esc(t('hy.change')) + '</button>' +
      '<button type="button" class="btn ghost" id="voice" aria-pressed="' + String(Boolean(c.tts && S.voice)) + '"' + (c.tts && S.voice ? ' data-selected="true"' : '') + (c.tts ? '' : ' aria-disabled="true" aria-describedby="voice-note"') + '>' + icon('speaker') + esc(t('hy.voice')) + '</button>' + (c.tts ? '' : '<span class="muted small" id="voice-note">' + esc(t('hy.noVoice')) + '</span>') + '</div>' +
      '<div class="framing" data-part="home-framing"><fieldset class="seg" id="framing"><legend>' + esc(t('hy.personality')) + '</legend>' +
      ['focused', 'balanced', 'full'].map(function (v) { return '<label class="seg-option" data-part="home-framing-option"' + (S.framing === v ? ' data-selected="true"' : '') + '><input type="radio" name="framing" value="' + v + '"' + (S.framing === v ? ' checked' : '') + '>' + esc(t('hy.p.' + v)) + '</label>'; }).join('') +
      '</fieldset><span class="muted small" id="framing-hint">' + esc(t('hy.h.' + S.framing)) + '</span></div></section>' : emptyCompanionCard();
    var ph = c ? t('hy.ph', { name: nm }) : t('hy.phNone');
    return '<div class="center">' + presence + R.setupNote() + R.composer('hybrid', ph, c ? t('hy.msgLabel', { name: nm }) : t('hy.send'), false) + '<div id="choice-slot"></div>' +
      '<div class="deck"><section class="card glass panel" data-part="home-tasks-panel" aria-labelledby="hybrid-runs-h"><h2 id="hybrid-runs-h">' + esc(c ? t('hy.tasksH') : t('hy.tasksEarlier')) + '</h2><div class="run-list" id="run-list" data-mode="hybrid">' + R.runList('hybrid') + '</div>' +
      '<div id="threads">' + (R.visibleThreads().map(threadRow).join('') || '<p class="muted small">' + esc(t('hy.noTasks')) + '</p>') + '</div></section>' +
      '<section class="card glass panel" aria-labelledby="quick-h"><h2 id="quick-h">' + esc(c ? t('hy.quickH', { name: nm.split(' ')[0] }) : t('hy.quickNone')) + '</h2><div class="quick" data-part="home-quick-list">' +
      [['code', 'q.code', 'q.codeD'], ['book', 'q.book', 'q.bookD'], ['lang', 'q.lang', 'q.langD'], ['braces', 'q.braces', 'q.bracesD']].map(function (q) { return '<button type="button" class="quick-item" data-part="home-quick-start" data-quick="' + esc(t(q[1])) + '">' + icon(q[0]) + '<span>' + esc(t(q[1])) + '<small>' + esc(t(q[2])) + '</small></span></button>'; }).join('') +
      '</div>' + (S.realm !== 'hidden' ? R.realmEntry(t('realm.hybridLink'), 'small') : '') + '</section></div></div>';
  }

  // ---------- Utility main ----------
  function utilMain() {
    var nick = S.nick.trim();
    var greet = nick && nick.toLowerCase() !== 'user' ? t('ut.greetName', { name: nick }) : t('ut.greet');
    var chips = [['tool', 'ut.chip.tool'], ['code', 'ut.chip.code'], ['braces', 'ut.chip.braces'], ['hash', 'ut.chip.hash'], ['lang', 'ut.chip.lang']];
    return '<div class="center narrow"><div class="greet" data-part="home-greeting"><p class="eyebrow" data-part="home-eyebrow">' + esc(t('ut.eyebrow')) + '</p><h1 class="h1">' + esc(greet) + '</h1></div>' + R.setupNote() +
      R.composer('utility', t('ut.ph'), t('ut.taskLabel'), true) + '<div id="choice-slot"></div>' +
      '<div class="chips" role="group" aria-label="' + esc(t('ut.quick')) + '" data-part="home-chip-list">' + chips.map(function (c) {
        return c[0] === 'code' ? '<a class="chip-btn" data-part="home-chip" href="' + esc(H.Nav.links.studio()) + '" data-out data-out-label="' + esc(t('link.studio')) + '" data-key="chip-code">' + icon(c[0]) + esc(t(c[1])) + '</a>'
          : '<button type="button" class="chip-btn" data-part="home-chip" data-demo data-demo-label="' + esc(t(c[1])) + '" data-key="chip-' + c[0] + '">' + icon(c[0]) + esc(t(c[1])) + '</button>';
      }).join('') + '</div>' +
      '<div class="util-grid"><section class="card glass panel" data-part="home-tasks-panel" aria-labelledby="util-run-h"><h2 id="util-run-h">' + esc(t('ut.runH')) + '</h2><div class="run-list" id="run-list" data-mode="utility">' + R.runList('utility') + '</div></section>' +
      '<section class="card glass panel" aria-labelledby="util-recent-h"><h2 id="util-recent-h">' + esc(t('ut.recentH')) + '</h2><div id="util-threads">' + (store.threads.utility.slice(1, 5).map(utilRow).join('') || '<p class="muted small">' + esc(t('ut.noRecent')) + '</p>') + '</div></section></div></div>';
  }
  var utilRow = R.utilRow = function (th) { return '<button type="button" class="thread" data-part="home-thread-row" data-thread="' + th.id + '"><span class="title" data-part="home-thread-title">' + esc(loc(th.title)) + '</span><span class="tag" data-part="home-tag" data-kind="type">' + esc(H.tagLabel(th.tag)) + '</span><time data-part="home-thread-time">' + esc(H.ago(th.min)) + '</time></button>'; };

  // ---------- RisuRealm hub ----------
  R.hubView = function () {
    return '<section class="card glass hub-panel" data-part="home-hub" aria-labelledby="hub-h"><button type="button" class="btn back-btn" data-variant="ghost" data-action="hub-back">' + icon('chevron') + esc(t('realm.hubBack')) + '</button>' +
      '<span class="hub-ic" aria-hidden="true">' + icon('compass') + '</span><h1 id="hub-h" class="h1 h1-sm" tabindex="-1">' + esc(t('realm.h')) + '</h1><p class="muted hub-text">' + esc(t('realm.hubText')) + '</p>' +
      '<a class="btn" data-variant="primary" data-part="home-realm-link" href="' + esc(H.Nav.links.realm()) + '" data-out data-out-label="RisuRealm">' + esc(t('realm.hubPage')) + '</a>' + (P.get('controls') === '0' ? '' : '<p class="muted small" data-mock>' + esc(t('mock.hubNote')) + '</p>') + '</section>';
  };

  R.rail = { rp: rpRail, hybrid: hybridRail, utility: utilRail };
  R.top = { rp: rpTop, hybrid: hybridTop, utility: utilTop };
  R.main = { rp: rpMain, hybrid: hybridMain, utility: utilMain };
})();
