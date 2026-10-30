/* Settings theme loader and state mirror (THEMING.md, DD-142, DD-144, DD-145 to DD-159). Included by the three Settings pages after the page stylesheets; same shape as chat/theme.js.
   1. ?theme=origin-navy | banana-cocoa loads themes/<name>.css after them, written into the head while it is parsed so it blocks the first paint (no flash of Deep Nexus).
      No parameter, or an unknown name, loads nothing. Mockup-only: there is no picker and nothing is stored. A theme changes appearance, never behaviour.
   2. The view state that existing code keeps as classes on <html> and <body>, or as media queries, is mirrored as data-* attributes so a pack can style it with attribute selectors:
        <html>  data-layout  = wide | mid | phone    set by slice1.js from the width of the app (DD-147); the same names as chat
        <html>  data-input   = touch | hover         the one input rule (DD-147): hover when (hover: hover) and (pointer: fine), else touch
        <html>  data-motion  = reduced | full        (html.rm)
        <html>  data-power   = low | normal          (html.nexus-low-power)
        <html>  data-text    = large | normal        (html.big, the 200 % text mode)
        <body>  data-overlay = dialog | picker | switcher   the topmost open layer, in that priority; absent when none is open
        <body>  data-search  = open                  (body.s-open, the phone search field)
   3. The state classes of single parts are mirrored the same way (one table, MAP, below): a part carries the attribute while it has the class. In use and cursor are two words everywhere:
        data-current = the one in use (.cur, .is-active)        data-active = the cursor, where the keyboard is (.act)
        changed -> data-changed   stack -> data-stack   is-sel -> data-selected   hl -> data-highlight   unav -> data-unavailable   dragging, is-dragging -> data-dragging   lifted -> data-lifted
        open -> data-open   on, ps-on -> data-on   need -> data-needs-connection   bad, c3-bad -> data-bad   ps-failed, is-failed -> data-failed   ps-shared -> data-shared   closed -> data-closed
        capturing -> data-capturing   selecting -> data-selecting   renaming -> data-renaming   no-model -> data-no-model   top -> data-top (the top search result)   same -> data-same (a model row that is the same as the main model);   .c3-tres.<ok|badkey|unreachable|quota|none|run> -> data-result
      The classes stay (existing code and checks read them); the attributes are derived from them here and nowhere else: on every class change and for every node that is added to the page.
      The observer runs before the next paint, so a pack never sees a class without its attribute.
   4. Helpers for the page scripts: num(token) reads a length or a number from a token once (T-17: it caches the first read for the life of the page, right for a static mockup; a pack swapped at run time would need the cache cleared),
      ms(el) the longest transition or animation of an element in ms, afterMotion(el, fn, pad) runs fn when el's transition or animation ends (transitionend / animationend), at the latest ms(el) + pad after the call. */
(function () {
  var THEMES = new Set(['origin-navy', 'banana-cocoa']);
  var m = /[?&]theme=([\w-]+)/.exec(location.search);
  var name = m && THEMES.has(m[1]) ? m[1] : '';
  var root = document.documentElement;
  window.settingsTheme = { name: name };
  function put(el, attr, val) { if (val === null) { if (el.hasAttribute(attr)) el.removeAttribute(attr); } else if (el.getAttribute(attr) !== val) el.setAttribute(attr, val); }
  var numCache = {};
  window.settingsTheme.num = function (token) { if (!(token in numCache)) numCache[token] = parseFloat(getComputedStyle(root).getPropertyValue(token)); return numCache[token]; };
  function list(v) { return String(v || '').split(',').map(function (x) { x = x.trim(); return /ms$/.test(x) ? parseFloat(x) : /s$/.test(x) ? parseFloat(x) * 1000 : 0; }); }
  window.settingsTheme.ms = function (el) {
    var cs = getComputedStyle(el), out = 0;
    [['transitionDuration', 'transitionDelay'], ['animationDuration', 'animationDelay']].forEach(function (p) { var d = list(cs[p[0]]), l = list(cs[p[1]]); d.forEach(function (x, i) { out = Math.max(out, x + (l[i % l.length] || 0)); }); });
    return out;
  };
  window.settingsTheme.afterMotion = function (el, fn, pad) {
    var done = false, t = 0;
    function fin() { if (done) return; done = true; el.removeEventListener('transitionend', on); el.removeEventListener('animationend', on); clearTimeout(t); fn(); }
    function on(e) { if (e.target === el) fin(); }
    el.addEventListener('transitionend', on); el.addEventListener('animationend', on);
    var p = pad === undefined ? 80 : pad, t0 = performance.now(), safety = setTimeout(fin, 1500);   // the duration is read in the next frame (style is recalculated then anyway); this timer covers a frame that never comes
    requestAnimationFrame(function () { if (done) return; clearTimeout(safety); t = setTimeout(fin, Math.max(0, window.settingsTheme.ms(el) + p - (performance.now() - t0))); });
    return { cancel: function () { done = true; el.removeEventListener('transitionend', on); el.removeEventListener('animationend', on); clearTimeout(t); clearTimeout(safety); } };
  };

  // ---- root and body
  var hoverFine = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
  function mirrorRoot() {
    var c = root.classList;
    put(root, 'data-motion', c.contains('rm') ? 'reduced' : 'full');
    put(root, 'data-power', c.contains('nexus-low-power') ? 'low' : 'normal');
    put(root, 'data-text', c.contains('big') ? 'large' : 'normal');
    put(root, 'data-input', hoverFine && hoverFine.matches ? 'hover' : 'touch');
  }
  function mirrorBody() {
    var b = document.body; if (!b) return; var c = b.classList;
    put(b, 'data-overlay', c.contains('dlg-open') ? 'dialog' : c.contains('mp-open') ? 'picker' : c.contains('sw-open') ? 'switcher' : null);
    put(b, 'data-search', c.contains('s-open') ? 'open' : null);
  }
  mirrorRoot();
  if (hoverFine) { if (hoverFine.addEventListener) hoverFine.addEventListener('change', mirrorRoot); else if (hoverFine.addListener) hoverFine.addListener(mirrorRoot); }

  // ---- part state (one table)
  var MAP = [['changed', 'data-changed'], ['stack', 'data-stack'], ['cur', 'data-current'], ['is-active', 'data-current'], ['act', 'data-active'], ['is-sel', 'data-selected'], ['hl', 'data-highlight'], ['unav', 'data-unavailable'],
    ['dragging', 'data-dragging'], ['is-dragging', 'data-dragging'], ['lifted', 'data-lifted'], ['open', 'data-open'], ['on', 'data-on'], ['ps-on', 'data-on'], ['need', 'data-needs-connection'], ['bad', 'data-bad'], ['c3-bad', 'data-bad'],
    ['ps-failed', 'data-failed'], ['is-failed', 'data-failed'], ['ps-shared', 'data-shared'], ['closed', 'data-closed'], ['capturing', 'data-capturing'], ['selecting', 'data-selecting'], ['renaming', 'data-renaming'], ['no-model', 'data-no-model'], ['top', 'data-top'], ['same', 'data-same']];
  var BY = {}, SEL = []; MAP.forEach(function (p) { (BY[p[1]] = BY[p[1]] || []).push(p[0]); SEL.push('.' + p[0]); });
  SEL.push('.c3-tres'); SEL = SEL.join(',');
  var RES = ['ok', 'badkey', 'unreachable', 'quota', 'none', 'run'];
  function syncEl(el) {
    var cl = el.classList; if (!cl || !cl.length) { for (var a0 in BY) if (el.hasAttribute(a0)) el.removeAttribute(a0); if (el.hasAttribute('data-result')) el.removeAttribute('data-result'); return; }
    for (var a in BY) { var on = false, L = BY[a]; for (var i = 0; i < L.length; i++) if (cl.contains(L[i])) { on = true; break; } if (on) { if (!el.hasAttribute(a)) el.setAttribute(a, ''); } else if (el.hasAttribute(a)) el.removeAttribute(a); }
    if (cl.contains('c3-tres')) { var v = null; for (var j = 0; j < RES.length; j++) if (cl.contains(RES[j])) v = RES[j]; put(el, 'data-result', v); } else if (el.hasAttribute('data-result')) el.removeAttribute('data-result');
  }
  function syncTree(n) { if (n.nodeType !== 1) return; syncEl(n); var list = n.querySelectorAll(SEL); for (var i = 0; i < list.length; i++) syncEl(list[i]); }
  var seen = new Set();
  function onMut(recs) {
    seen.clear();
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      if (r.type === 'attributes') { var t = r.target; if (seen.has(t)) continue; seen.add(t); if (t === root) mirrorRoot(); else if (t === document.body) mirrorBody(); syncEl(t); }
      else for (var k = 0; k < r.addedNodes.length; k++) syncTree(r.addedNodes[k]);
    }
  }
  var mo = new MutationObserver(onMut);
  mo.observe(root, { attributes: true, attributeFilter: ["class"], subtree: true, childList: true });
  function first() { mirrorRoot(); mirrorBody(); syncTree(root); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', first); else first();
  window.settingsTheme.mirror = first;

  if (!name) return;
  root.setAttribute('data-theme', name);
  if (document.readyState === 'loading') document.write('<link rel="stylesheet" id="settingsThemeSheet" href="themes/' + name + '.css">');
  else { var l = document.createElement('link'); l.rel = 'stylesheet'; l.id = 'settingsThemeSheet'; l.href = 'themes/' + name + '.css'; document.head.appendChild(l); }
})();
