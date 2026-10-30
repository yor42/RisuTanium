/* Studio slice 3: the first keydown listener on window (capture), registered before slice1.js, so the long-text editor can take Esc, Ctrl+E, Ctrl+F/H, Tab (focus trap), Alt+Up/Down and the autocomplete keys
   before the shell's own shortcuts (which would, for example, send Esc to the item header). lte.js sets window.__ltKey; it returns true when it handled the key. */
(function () {
  'use strict';
  addEventListener('keydown', function (e) { if (typeof window.__ltKey === 'function' && window.__ltKey(e)) e.stopImmediatePropagation(); }, true);
})();
