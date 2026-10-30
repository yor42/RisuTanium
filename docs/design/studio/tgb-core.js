/* Studio slice 2: toggle definition core (pure functions, no DOM). Mirrors the engine parser and panel rules of src/ts/util.ts:788-828 and
   src/lib/SideBars/Toggles.svelte:70-92,159-160 (design reference only; nothing here is wired into the app). Usable in the browser (window.TGCore) and in node.
   Rev 2: orphan groupEnd nodes, owner-aware fallback keys (DD-112), app-wide shared keys, spill that respects a later groupEnd, carry-over issues against a baseline (DD-110, DD-114). */
(function (root) {
  'use strict';
  var VALUE = ['check', 'select', 'text', 'textarea'];

  /* engine: line.split('=') keeps the first four parts; key/label/type/option are NOT trimmed */
  function parseLine(raw, i) {
    var r = { i: i, raw: raw, kind: '', key: '', label: '', type: '', opts: [], extra: false, reason: null, unknownType: false };
    if (raw.trim() === '') { r.kind = 'blank'; return r; }
    var p = raw.split('='); r.extra = p.length > 4;
    var key = p[0], value = p[1], type = p[2], option = p[3];
    r.key = key; r.label = value == null ? '' : value; r.type = type == null ? '' : type;
    if (type === 'group' || type === 'groupEnd' || type === 'divider') r.kind = type;
    else if (type === 'caption' && value) r.kind = 'caption';
    else if (key && value) { r.kind = type === 'select' || type === 'text' || type === 'textarea' ? type : 'check'; r.opts = r.kind === 'select' && option != null ? option.split(',') : []; r.unknownType = r.kind === 'check' && type != null && type !== ''; }
    else { r.kind = 'bad'; r.reason = type === 'caption' ? 'caption' : 'keylabel'; }
    return r;
  }
  function parse(text) { return String(text == null ? '' : text).split('\n').map(parseLine); }
  var isValue = function (r) { return VALUE.indexOf(r.kind) >= 0; };

  /* the engine reduce (Toggles.svelte:77-92): groups do not nest; a group line starts a new top-level group; groupEnd closes; bad/blank dropped */
  function engine(rows) {
    var acc = [], open = false;
    rows.forEach(function (r) {
      if (r.kind === 'blank' || r.kind === 'bad') return;
      if (r.kind === 'group') { acc.push({ row: r, type: 'group', children: [] }); open = true; }
      else if (r.kind === 'groupEnd') open = false;
      else if (open) acc[acc.length - 1].children.push({ row: r, type: r.kind });
      else acc.push({ row: r, type: r.kind });
    });
    return acc;
  }
  /* what the panel draws from an entry list: repeated same-label dividers collapse (Toggles.svelte:159-160); an empty group is hidden (DD-109) */
  function visible(items) {
    var out = [];
    items.forEach(function (e, idx) {
      if (e.type === 'group' && e.children.length === 0) return;   // DD-109: the redesigned panel hides an empty group (today's Toggles.svelte draws it as an on/off switch; lane A changes that)
      if (e.type === 'divider') { var p = items[idx - 1]; if (p && p.type === 'divider' && p.row.label === e.row.label) return; }
      out.push(e);
    });
    return out;
  }

  /* builder structure: nodes in file order with line ranges (a group node owns its lines up to its groupEnd, or its last child when unclosed).
     A groupEnd with no open group is an orphan node (the engine ignores it; the list shows it so it is not invisible). */
  function structure(rows) {
    var nodes = [], open = null, orphans = [];
    rows.forEach(function (r) {
      if (r.kind === 'blank') return;
      if (r.kind === 'group') { open = { type: 'group', row: r, start: r.i, end: r.i, endRow: null, children: [] }; nodes.push(open); }
      else if (r.kind === 'groupEnd') { if (open) { open.endRow = r; open.end = r.i; open = null; } else { orphans.push(r); nodes.push({ type: 'row', row: r, start: r.i, end: r.i, orphan: true }); } }
      else if (open) { open.children.push({ type: 'row', row: r, start: r.i, end: r.i }); open.end = r.i; }
      else nodes.push({ type: 'row', row: r, start: r.i, end: r.i });
    });
    return { nodes: nodes, orphans: orphans, openGroup: open };
  }

  /* ---- canonical lines (SLICE2_SPEC section 6) ---- */
  function canon(r) {
    switch (r.kind) {
      case 'check': return r.key + '=' + r.label;
      case 'select': return r.key + '=' + r.label + '=select' + (r.opts.length ? '=' + r.opts.join(',') : '');
      case 'text': return r.key + '=' + r.label + '=text';
      case 'textarea': return r.key + '=' + r.label + '=textarea';
      case 'group': return r.key + '=' + r.label + '=group';
      case 'groupEnd': return r.key + '=' + r.label + '=groupEnd';
      case 'divider': return '=' + r.label + '=divider';
      case 'caption': return '=' + r.label + '=caption';
      default: return r.raw;
    }
  }
  var endLineOf = function (g) { return (g.key || 'group') + '_end=' + g.label + '=groupEnd'; };
  function slug(s) { var w = String(s).toLowerCase().match(/[a-z0-9]+/g); return w ? w.join('_') : ''; }
  /* key from a label: lowercase ASCII letters and digits joined with '_' (taken keys get _2, _3 ...). With no ASCII in the label (DD-112) the fallback is
     <owner>_t1, <owner>_t2 ... (next free); `taken` holds every key of every owner in the app, so the fallback is unique app-wide. */
  function suggestKey(label, taken, prefix) {
    var has = function (k) { return taken.indexOf(k) >= 0; }, base = slug(label), k, n;
    if (base) { k = base; n = 2; while (has(k)) k = base + '_' + (n++); return k; }
    var p = prefix ? slug(prefix) + '_' : ''; n = 1; while (has(p + 't' + n)) n++; return p + 't' + n;
  }
  /* a copy keeps the stem of the key it copies (also non-ASCII), with _copy, _copy_2 ... */
  function copyKey(key, taken) { var k = key + '_copy', n = 2; while (taken.indexOf(k) >= 0) k = key + '_copy_' + (n++); return k; }
  /* DD-105: '=' is never allowed in label/key/option; ',' never in an option. Returns an error code or null. */
  function checkField(field, v) {
    if (/\n/.test(v)) return 'nl';
    if (/=/.test(v)) return 'eq';
    if (field === 'opt' && /,/.test(v)) return 'comma';
    return null;
  }
  /* Q-5: soft hints for a key: leading/trailing space, an interior space, a twin that differs only by case or whitespace */
  function keyHints(key, others) {
    var out = [];
    if (/^\s|\s$/.test(key)) out.push('edge');
    else if (/\s/.test(key)) out.push('inner');
    var norm = function (s) { return String(s).toLowerCase().replace(/[\s_]+/g, ''); }, twin = others.filter(function (k) { return k !== key && norm(k) === norm(key); });   // Q-2: case, spaces and _ are ignored
    if (twin.length) out.push('twin:' + twin[0]);
    return out;
  }

  /* ---- array moves (applied to the lines and to the parallel uid array) ---- */
  function moveRange(arr, a0, a1, to) {   // to: insertion index in the ORIGINAL numbering; returns {arr,start}
    if (to >= a0 && to <= a1 + 1) return { arr: arr.slice(), start: a0 };
    var len = a1 - a0 + 1, a = arr.slice(), blk = a.splice(a0, len), at = to > a1 ? to - len : to;
    a.splice.apply(a, [at, 0].concat(blk)); return { arr: a, start: at };
  }
  function insertAt(arr, i, items) { var a = arr.slice(); a.splice.apply(a, [i, 0].concat(items)); return a; }
  function removeRange(arr, a0, a1) { var a = arr.slice(); a.splice(a0, a1 - a0 + 1); return a; }

  /* ---- joined analysis across owners in engine order ----
     owners: [{id, name, text}] the owners the chat joins; others: [{id, name, text}] every other owner in the app (off modules, other presets, other characters):
     they take no part in the join but share values (the value store is app-wide), so shared keys look at them too.
     res.names lists owners then others; shared[line].owners are indices into it. */
  function analyze(owners, others) {
    others = others || [];
    var perOwner = owners.map(function (o) { return { id: o.id, name: o.name, rows: parse(o.text) }; });
    var open = null, recs = [];
    perOwner.forEach(function (po, oi) {
      po.rec = null;
      po.rows.forEach(function (r) {
        if (r.kind === 'group') { if (open) open.closedBy = oi; open = { row: r, oi: oi, swallowed: 0, closedBy: null }; recs.push(open); }
        else if (r.kind === 'groupEnd') { if (open) { open.closedBy = oi; open = null; } }
        else if (open && open.oi !== oi && r.kind !== 'blank' && r.kind !== 'bad') { open.swallowed++; po.swallowed = true; }
      });
      if (open && open.oi === oi) po.rec = open;
    });
    perOwner.forEach(function (po, oi) {
      po.swallowed = !!po.swallowed; po.spill = null; po.split = null;
      var rec = po.rec; delete po.rec;
      if (rec) {
        if (rec.swallowed > 0) po.spill = { row: rec.row, hard: true };
        else if (rec.closedBy != null && rec.closedBy !== oi) po.split = { row: rec.row, closedBy: rec.closedBy };   // a later source holds the matching groupEnd: nothing falls in (m-6)
        else po.spill = { row: rec.row, hard: false };
      }
      var cnt = {}; po.rows.forEach(function (r) { if (isValue(r)) cnt[r.key] = (cnt[r.key] || 0) + 1; });
      po.dupKeys = Object.keys(cnt).filter(function (k) { return cnt[k] > 1; });
    });
    var all = perOwner.map(function (po) { return { id: po.id, name: po.name, rows: po.rows }; }).concat(others.map(function (o) { return { id: o.id, name: o.name, rows: parse(o.text) }; }));
    var byKey = {}; all.forEach(function (po, oi) { po.rows.forEach(function (r) { if (isValue(r)) (byKey[r.key] = byKey[r.key] || []).push({ oi: oi, r: r }); }); });
    perOwner.forEach(function (po, oi) {
      po.shared = {};   // line index -> {owners:[index into names], kindDiff}
      po.rows.forEach(function (r) {
        if (!isValue(r)) return; var o = (byKey[r.key] || []).filter(function (x) { return x.oi !== oi; });
        if (o.length) po.shared[r.i] = { owners: o.map(function (x) { return x.oi; }).filter(function (v, i, a) { return a.indexOf(v) === i; }), kindDiff: o.some(function (x) { return x.r.kind !== r.kind && !(/^text(area)?$/.test(x.r.kind) && /^text(area)?$/.test(r.kind)); }) };
      });
    });
    var tagged = []; perOwner.forEach(function (po, oi) { po.rows.forEach(function (r) { tagged.push({ kind: r.kind, r: r, oi: oi }); }); });
    var acc = [], gopen = false;
    tagged.forEach(function (t) {
      var k = t.kind; if (k === 'blank' || k === 'bad') return;
      if (k === 'group') { acc.push({ row: t.r, oi: t.oi, type: 'group', children: [] }); gopen = true; }
      else if (k === 'groupEnd') gopen = false;
      else if (gopen) acc[acc.length - 1].children.push({ row: t.r, oi: t.oi, type: k });
      else acc.push({ row: t.r, oi: t.oi, type: k });
    });
    return { owners: perOwner, joined: acc, bad: perOwner.map(function (po) { return po.rows.filter(function (r) { return r.kind === 'bad'; }).length; }), names: all.map(function (o) { return o.name; }), appKeys: Object.keys(byKey) };
  }

  /* ---- carry-over issues (DD-106, DD-110, DD-114): what would detach or reinterpret stored values when the text moves from `baseText` to `curText` ----
     Values are one app-wide entry per key (plus a copy in each chat that pinned it), so:
       key      a key was renamed: the old key's value no longer belongs to the toggle
       options  a choice's options were reordered or removed: the stored option NUMBER now means another option
       type     the kind changed (on/off, choice, text): the value stays but is read differently
       drop     a value row became a divider or note: nobody reads the value any more */
  var vclass = function (k) { return k === 'check' ? 'check' : k === 'select' ? 'select' : 'text'; };
  function optionsChange(b, c) {
    var pre = b.length <= c.length && b.every(function (x, i) { return c[i] === x; }); if (pre) return null;   // appended only
    if (b.length === c.length) { var diff = []; b.forEach(function (x, i) { if (c[i] !== x) diff.push(i); }); if (diff.length === 1 && c.indexOf(b[diff[0]]) < 0) return null; }   // one option renamed in place
    var map = b.map(function (x) { var j = c.indexOf(x); return j; });
    return { removed: map.some(function (j) { return j < 0; }), map: map };
  }
  function carryIssues(baseText, curText) {
    var bAll = parse(baseText), cAll = parse(curText), b = bAll.filter(isValue), c = cAll.filter(isValue), out = [];
    var cBy = {}, bBy = {}; c.forEach(function (r) { if (!cBy[r.key]) cBy[r.key] = r; }); b.forEach(function (r) { if (!bBy[r.key]) bBy[r.key] = r; });
    var removed = b.filter(function (r) { return !cBy[r.key]; }), added = c.filter(function (r) { return !bBy[r.key]; }), used = {};
    removed.forEach(function (r) {
      var a = added.filter(function (x) { return !used[x.i] && x.label === r.label && vclass(x.kind) === vclass(r.kind); })[0] || null;   // N-10: a rename is only recognised by the same name and kind; a removed row next to a different new row is not guessed to be a rename
      if (a) { used[a.i] = true; out.push({ type: 'key', from: r.key, to: a.key, label: r.label, kind: a.kind }); if (vclass(a.kind) !== vclass(r.kind)) out.push({ type: 'type', key: a.key, from: r.kind, to: a.kind, label: a.label }); if (r.kind === 'select' && a.kind === 'select') { var oc = optionsChange(r.opts, a.opts); if (oc) out.push({ type: 'options', key: a.key, label: a.label, removed: oc.removed, map: oc.map }); } }
      else { var d = cAll.filter(function (x) { return (x.kind === 'divider' || x.kind === 'caption') && x.label === r.label; })[0]; if (d) out.push({ type: 'drop', key: r.key, label: r.label, to: d.kind }); }
    });
    b.forEach(function (r) {
      var x = cBy[r.key]; if (!x) return;
      if (vclass(x.kind) !== vclass(r.kind)) out.push({ type: 'type', key: r.key, from: r.kind, to: x.kind, label: x.label });
      else if (r.kind === 'select' && x.kind === 'select') { var oc2 = optionsChange(r.opts, x.opts); if (oc2) out.push({ type: 'options', key: r.key, label: x.label, removed: oc2.removed, map: oc2.map }); }
    });
    return out;
  }

  var api = { parse: parse, parseLine: parseLine, engine: engine, visible: visible, structure: structure, canon: canon, endLineOf: endLineOf, suggestKey: suggestKey, copyKey: copyKey, slug: slug, checkField: checkField, keyHints: keyHints, moveRange: moveRange, insertAt: insertAt, removeRange: removeRange, analyze: analyze, carryIssues: carryIssues, isValue: isValue, VALUE: VALUE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TGCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
