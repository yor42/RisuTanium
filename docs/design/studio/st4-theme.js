/* Studio slices 1-4: the theme probe loader (loaded by slice1.html to slice4.html since DD-200; the file keeps its slice 4 name for the checks) and the shared root attributes (THEMING.md, DD-147). Loaded in the head, before the page paints.
   ?theme=origin-navy|banana-cocoa loads themes/<name>.css (origin-navy: tokens only; banana-cocoa: tokens and part CSS) while the head is parsed, so there is no flash of Deep Nexus. A theme changes appearance, never behaviour. Mockup only: no picker, nothing stored.
   html[data-layout=wide|mid|phone] (same breakpoints as the Studio shell) and html[data-input=touch|hover] are the one shared attribute set; the shell's own #studio[data-layout] stays as it was. */
(function () {
  var root = document.documentElement;
  var m = /[?&]theme=([\w-]+)/.exec(location.search); var PACKS = { 'origin-navy': 1, 'banana-cocoa': 1 }; var name = m && Object.prototype.hasOwnProperty.call(PACKS, m[1]) ? m[1] : '';
  window.st4Theme = window.studioTheme = { name: name };   // loaded by slice1-4.html; the name is kept for the older checks
  if (name) root.setAttribute('data-theme', name);
  if (name) document.write('<link rel="stylesheet" href="themes/' + name + '.css">');
  function put(a, v) { if (root.getAttribute(a) !== v) root.setAttribute(a, v); }
  function layout() { var w = window.innerWidth; put('data-layout', w >= 1024 ? 'wide' : w >= 600 ? 'mid' : 'phone'); }
  var hf = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
  function input() { put('data-input', hf && hf.matches ? 'hover' : 'touch'); }
  layout(); input(); window.addEventListener('resize', layout);
  if (hf) { if (hf.addEventListener) hf.addEventListener('change', input); else if (hf.addListener) hf.addListener(input); }
})();
