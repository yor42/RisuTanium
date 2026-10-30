/* Chat theme loader and view-state mirror (THEMING.md, DD-142, DD-144, DD-147). Included by every chat page after the page stylesheets.
   Nothing here is needed for the screen to work: components mark their own critical surfaces and states (slice1.js), and this file only loads a pack and mirrors view state.
   1. ?theme=origin-navy | banana-cocoa loads themes/<name>.css after the page stylesheets, written into the head while it is parsed so it blocks the first paint (no flash
      of Deep Nexus). No parameter, or an unknown name, loads nothing. Mockup-only: no picker, nothing is stored.
   2. The view state that existing code keeps as classes on <html> is mirrored as data-* attributes on <html> (the classes stay):
        data-layout = wide | mid | phone    wide = html.is-desktop (the app is 900 px or wider); otherwise mid at 600 px and wider, phone below. Same names as Settings.
        data-input  = touch | hover         the one input rule: html.touch-ui means touch, html.hover-ui means hover (set by slice1.js from the platform preset or
                                            from (hover: hover) and (pointer: fine)). Until the page has decided, the media query answers, so the attribute is never absent.
        data-names  = shown | hidden        html.hide-names
        data-motion = reduced | full        html.rm
        data-power  = low | normal          html.nexus-low-power
   Message and row state (data-run, data-meta, data-fail, data-streaming, data-hidden, data-bookmarked, data-selected, data-current, data-unread, data-status, data-open)
   is set by slice1.js and slice2.js where their classes and model change. */
(function () {
  var THEMES = { 'origin-navy': 1, 'banana-cocoa': 1 };
  var m = /[?&]theme=([\w-]+)/.exec(location.search);
  var name = m && Object.prototype.hasOwnProperty.call(THEMES, m[1]) ? m[1] : '';
  var root = document.documentElement;
  window.chatTheme = { name: name };
  function put(attr, val) { if (root.getAttribute(attr) !== val) root.setAttribute(attr, val); }
  function mirror() {
    var c = root.classList, app = document.getElementById('app'), w = app ? app.clientWidth : window.innerWidth;
    put('data-layout', c.contains('is-desktop') ? 'wide' : w >= 600 ? 'mid' : 'phone');
    put('data-input', c.contains('touch-ui') ? 'touch' : c.contains('hover-ui') ? 'hover' : (window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches ? 'hover' : 'touch'));
    put('data-names', c.contains('hide-names') ? 'hidden' : 'shown');
    put('data-motion', c.contains('rm') ? 'reduced' : 'full');
    put('data-power', c.contains('nexus-low-power') ? 'low' : 'normal');
  }
  mirror();
  new MutationObserver(mirror).observe(root, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', mirror); document.addEventListener('DOMContentLoaded', mirror);
  window.chatTheme.mirror = mirror;
  if (!name) return;
  root.setAttribute('data-theme', name);
  document.write('<link rel="stylesheet" id="chatThemeSheet" href="themes/' + name + '.css">');
})();
