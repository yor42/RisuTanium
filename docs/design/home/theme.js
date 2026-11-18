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

  // 3. ?scheme=<name> applies one of the app's colour-scheme presets the way src/ts/gui/colorscheme.ts does (style properties on <html>), so the page can be seen under the user's own colours.
  //    Values copied from colorscheme.ts (read-only reference). Order: bgcolor, darkbg, borderc, selected, draculared, textcolor, textcolor2, darkBorderc, darkbutton, type.
  var SCHEMES = {
    'default': ['#282a36', '#21222c', '#6272a4', '#44475a', '#ff5555', '#f8f8f2', '#64748b', '#4b5563', '#374151', 'dark'],
    'dark': ['#1a1a1a', '#141414', '#525252', '#3d3d3d', '#ff5555', '#f5f5f5', '#a3a3a3', '#404040', '#2e2e2e', 'dark'],
    'light': ['#ffffff', '#f0f0f0', '#0f172a', '#e0e0e0', '#ff5555', '#0f172a', '#64748b', '#d1d5db', '#e5e7eb', 'light'],
    'cherry': ['#450a0a', '#7f1d1d', '#ea580c', '#d97706', '#ff5555', '#f8f8f2', '#fca5a5', '#92400e', '#b45309', 'dark'],
    'galaxy': ['#0f172a', '#1f2a48', '#8be9fd', '#457b9d', '#ff5555', '#f8f8f2', '#8be9fd', '#457b9d', '#1f2a48', 'dark'],
    'nature': ['#1b4332', '#2d6a4f', '#a8dadc', '#4d908e', '#ff5555', '#f8f8f2', '#4d908e', '#457b9d', '#2d6a4f', 'dark'],
    'ocean': ['#0b1f2a', '#08202b', '#38bdf8', '#164e63', '#fb7185', '#e6f6fb', '#8fc7d5', '#155e75', '#0f3a4a', 'dark'],
    'aurora': ['#10201c', '#152a24', '#5eead4', '#315c52', '#fb7185', '#ecfdf5', '#a7f3d0', '#2f6f63', '#21443c', 'dark'],
    'twilight': ['#171324', '#201936', '#c084fc', '#3b2a5a', '#f43f5e', '#f8f5ff', '#c4b5fd', '#4c3575', '#2e2348', 'dark'],
    'realblack': ['#000000', '#000000', '#6272a4', '#44475a', '#ff5555', '#f8f8f2', '#64748b', '#4b5563', '#374151', 'dark'],
    'monokai-light': ['#f8f8f2', '#e8e8e3', '#75715e', '#d8d8d0', '#f92672', '#272822', '#75715e', '#c0c0b8', '#d0d0c8', 'light'],
    'monokai-black': ['#272822', '#1e1f1a', '#75715e', '#3e3d32', '#f92672', '#f8f8f2', '#a6a68a', '#3e3d32', '#3e3d32', 'dark'],
    'sky-light': ['#f6fbff', '#e8f3fb', '#0284c7', '#d7ecf8', '#e11d48', '#0f172a', '#516174', '#b7d7ea', '#dbeafe', 'light'],
    'sage-light': ['#f7faf5', '#e8f0e6', '#3f6212', '#d9e8d3', '#dc2626', '#1f2933', '#586a52', '#b7c9ad', '#dce8d6', 'light'],
    'lavender-light': ['#f8f7ff', '#ede9fe', '#6d28d9', '#ddd6fe', '#e11d48', '#1e1b4b', '#5b5680', '#c4b5fd', '#e0e7ff', 'light'],
    'slate-light': ['#f8fafc', '#e2e8f0', '#334155', '#cbd5e1', '#dc2626', '#020617', '#475569', '#94a3b8', '#cbd5e1', 'light'],
    'lite': ['#1f2937', '#1C2533', '#475569', '#475569', '#ff5555', '#f8f8f2', '#64748b', '#030712', '#374151', 'dark']
  };
  var KEYS = ['bgcolor', 'darkbg', 'borderc', 'selected', 'draculared', 'textcolor', 'textcolor2', 'darkborderc', 'darkbutton'];
  // Both go into one generated <style> (the page keeps no style="" attribute; a generated <style> is the same channel the character hues use).
  var gen = document.createElement('style'); gen.id = 'home-scheme'; document.head.appendChild(gen);
  var schemeCss = '', netCss = '';
  var flush = function () { gen.textContent = schemeCss + netCss; };
  var schemeName = P.get('scheme');
  if (schemeName && Object.prototype.hasOwnProperty.call(SCHEMES, schemeName)) {
    var sc = SCHEMES[schemeName];
    schemeCss = 'html:root{' + KEYS.map(function (k, i) { return '--risu-theme-' + k + ':' + sc[i]; }).join(';') + '}';
    flush();
    put('data-scheme', schemeName); put('data-scheme-type', sc[9]);
  }
  window.homeTheme.SCHEMES = Object.keys(SCHEMES);
  // The lattice script reads "r g b" channels (--nexus-network-node/-link); the scheme gives a colour, so it is resolved once through a probe and handed over as channels.
  window.homeTheme.syncNetwork = function () {
    var probe = document.createElement('span'); probe.className = 'sr-only'; probe.setAttribute('aria-hidden', 'true'); document.body.appendChild(probe);
    probe.style.color = 'var(--risu-theme-borderc)';
    var m2 = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(probe).color); probe.remove();
    if (m2) { var ch = m2[1] + ' ' + m2[2] + ' ' + m2[3]; netCss = 'html:root{--nexus-network-node:' + ch + ';--nexus-network-link:' + ch + '}'; flush(); }
  };
  if (!name) return;
  root.setAttribute('data-theme', name);
  document.write('<link rel="stylesheet" id="homeThemeSheet" href="themes/' + name + '.css">');
})();
