/* Home theme loader and root-state mirror (THEMING.md, DD-142, DD-144, DD-147). Included by home.html after the stylesheets. Same shape as chat/theme.js.
   1. ?theme=origin-navy | banana-cocoa loads themes/<name>.css after the page stylesheets, written into the head while it is parsed so it blocks the first paint
      (no flash of Deep Nexus). No parameter, or an unknown name, loads nothing. Mockup-only: no picker, nothing is stored.
   2. State packs may key on is mirrored as data-* on <html> (DD-147):
        data-layout = wide | mid | phone    phone below 768 px, mid below 1200 px, wide from 1280 px (DD-247: with the switcher on the viewport centre, a narrower wide band would overlap the brand beside a 240 px rail) (viewport width; the same in every mode, DD-209)
        data-input  = touch | hover         ?input=touch|hover forces it; otherwise (hover: hover) and (pointer: fine) means hover
        data-power  = low | normal          html.nexus-low-power (set by ?lowpower=1 or the mock control)
        data-motion = reduced | full        prefers-reduced-motion, ?motion=reduced, or ?still=1
        data-lang   = ko | en
   The breakpoints are mirrored in tokens (--home-bp-*) only for documentation: media queries cannot read tokens, so the script owns the numbers. */
(function () {
  'use strict';
  var THEMES = { 'origin-navy': 1, 'banana-cocoa': 1 };
  var P = new URLSearchParams(location.search);
  var m = /[?&]theme=([\w-]+)/.exec(location.search);
  var name = m && Object.prototype.hasOwnProperty.call(THEMES, m[1]) ? m[1] : '';
  var root = document.documentElement;
  var BP_MID = 768, BP_WIDE = 1280;
  window.homeTheme = { name: name, BP_MID: BP_MID, BP_WIDE: BP_WIDE };
  function put(attr, val) { if (root.getAttribute(attr) !== val) root.setAttribute(attr, val); }
  var mqHover = window.matchMedia ? matchMedia('(hover: hover) and (pointer: fine)') : null;
  var mqRM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  function mirror() {
    var w = window.innerWidth;
    put('data-layout', w >= BP_WIDE ? 'wide' : w >= BP_MID ? 'mid' : 'phone');
    var forced = P.get('input');
    put('data-input', forced === 'touch' || forced === 'hover' ? forced : (mqHover && mqHover.matches ? 'hover' : 'touch'));
    put('data-power', root.classList.contains('nexus-low-power') ? 'low' : 'normal');
    var rm = (mqRM && mqRM.matches) || P.get('motion') === 'reduced' || P.get('still') === '1' || root.classList.contains('home-reduce-motion');
    put('data-motion', rm ? 'reduced' : 'full');
  }
  put('data-lang', P.get('lang') === 'en' ? 'en' : 'ko');
  mirror();
  new MutationObserver(mirror).observe(root, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', mirror);
  document.addEventListener('DOMContentLoaded', mirror);
  if (mqRM && mqRM.addEventListener) mqRM.addEventListener('change', mirror);
  window.homeTheme.mirror = mirror;
  if (!name) return;
  root.setAttribute('data-theme', name);
  document.write('<link rel="stylesheet" id="homeThemeSheet" href="themes/' + name + '.css">');
})();
