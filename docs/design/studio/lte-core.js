/* Studio slice 3 mockup: long-text editor core (SLICE3_SPEC.md rev 1). Pure functions, no DOM: CBS scanner/tokeniser, problems, painter, mini evaluator for the sandbox,
   token estimate, example-message and alternate-first-message round trip, find helpers, 초성 filter. Synthetic: the macro list comes from data3.js (setMacros).
   Works in a browser (window.LTCore) and in node (module.exports) so the unit checks can load it directly. */
(function (root, factory) { const X = factory(); if (typeof module !== 'undefined' && module.exports) module.exports = X; else root.LTCore = X; })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const BLOCKS = new Set(['if', 'if_pure', 'when', 'each', 'func', 'pure', 'pure_display', 'puredisplay', 'escape']);   // the registry's blocks (cbs.ts, parser.svelte.ts:1217-1479); #while does not exist
  const HEAD = /^([#\/:]?)([A-Za-z0-9_\-]+)/;
  let KNOWN = new Map();
  function setMacros(list) { KNOWN = new Map(); list.forEach((m) => { KNOWN.set(m.n.toLowerCase(), m); (m.al || []).forEach((a) => KNOWN.set(a.toLowerCase(), m)); }); }
  const isKnown = (name) => KNOWN.has(name) || /^toggle_/.test(name);
  const esc = (s) => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

  /* ---------------------------------------------------------------- scanner */
  function scan(text) {
    const pairs = [], stack = [], strayClose = []; const n = text.length; let i = 0;
    while (i < n - 1) {
      const c = text.charCodeAt(i);
      if (c === 123 && text.charCodeAt(i + 1) === 123) { stack.push(i); i += 2; continue; }
      if (c === 125 && text.charCodeAt(i + 1) === 125) { if (stack.length) { const o = stack.pop(); pairs.push({ o, c: i, d: stack.length }); } else strayClose.push(i); i += 2; continue; }
      i++;
    }
    return { pairs, strayOpen: stack, strayClose };
  }
  const lineOfFactory = (text) => { const nl = []; for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) nl.push(i); return (pos) => { let lo = 0, hi = nl.length; while (lo < hi) { const m = (lo + hi) >> 1; if (nl[m] < pos) lo = m + 1; else hi = m; } return lo + 1; }; };

  /* analysis: pairs with their role, matched blocks and problems (codes only; the UI words them) */
  function analyze(text, o) {
    o = o || {}; const sc = scan(text), pairs = sc.pairs.sort((a, b) => a.o - b.o), probs = [], stack = [], blocks = [], lineOf = lineOfFactory(text);
    const add = (sev, code, s, e, extra) => probs.push(Object.assign({ sev, code, s, e, pos: s, line: lineOf(s) }, extra || {}));
    let commentEnd = -1, vary = false;
    for (const p of pairs) {
      if (p.o < commentEnd) { p.skip = true; continue; }
      const inner = text.slice(p.o + 2, p.c);
      if (inner.startsWith('//')) { p.kind = 'comment'; commentEnd = p.c + 2; continue; }
      const m = HEAD.exec(inner);
      if (!m) { p.kind = 'expr'; continue; }
      p.pre = m[1]; p.name = m[2].toLowerCase(); p.nameS = p.o + 2; p.nameE = p.o + 2 + m[0].length;
      if (m[1] === '#') {
        p.kind = 'open'; if (BLOCKS.has(p.name)) stack.push(p); else { p.unknown = true; add('warning', 'unknown', p.nameS, p.nameE, { name: '#' + p.name }); }
      } else if (m[1] === '/') {
        p.kind = 'close'; let k = -1; for (let j = stack.length - 1; j >= 0; j--) if (stack[j].name === p.name) { k = j; break; }
        if (k < 0) { p.bad = true; add('error', 'unopened', p.nameS, p.nameE, { block: p.name }); }
        else { while (stack.length - 1 > k) { const lost = stack.pop(); lost.bad = true; add('error', 'unclosed', lost.nameS, lost.nameE, { block: lost.name }); } const op = stack.pop(); blocks.push({ o1: op.o, c1: op.c, o2: p.o, c2: p.c, name: p.name, open: op, close: p }); op.mate = p; p.mate = op; }
      } else if (m[1] === ':') {
        p.kind = 'else'; if (p.name !== 'else' && p.name !== 'elif') { p.unknown = true; add('warning', 'unknown', p.nameS, p.nameE, { name: ':' + p.name }); }
      } else {
        p.kind = 'macro';
        if (!isKnown(p.name) && !stack.some((x) => x.name === 'pure' || x.name === 'escape' || x.name === 'each' || x.name === 'func')) {   /* N-R3: the engine does not evaluate these bodies as CBS at that point (parser.svelte.ts:1759-1764), so an unknown name there is not a problem; balance is still checked */ p.unknown = true; add('warning', 'unknown', p.nameS, p.nameE, { name: p.name }); }
        else {
          const mm = KNOWN.get(p.name); if (mm && mm.vary) vary = true;
          if (p.name === 'slot' && !o.slotOK && !stack.some((x) => x.name === 'each')) add('warning', 'slot', p.nameS, p.nameE, {});   // {{slot::name}} is filled in #each bodies anywhere (parser.svelte.ts:1797)
        }
      }
    }
    while (stack.length) { const lost = stack.pop(); lost.bad = true; add('error', 'unclosed', lost.nameS, lost.nameE, { block: lost.name }); }
    if (!o.edge) {
      sc.strayOpen.forEach((p) => add('error', 'unbalanced', p, p + 2, { which: 'open' }));
      if (!o.html) sc.strayClose.forEach((p) => add('info', 'strayclose', p, p + 2, { which: 'close' }));   // the engine reads a }} with no {{ as text (parser.svelte.ts:1734)
    }
    // deprecated forms
    const re = /<(char|user|bot)>/gi; let m;
    while ((m = re.exec(text))) { if (insideComment(pairs, m.index)) continue; const w = m[1].toLowerCase(); add('info', 'deprecated', m.index, m.index + m[0].length, { from: m[0], to: w === 'user' ? '{{user}}' : '{{char}}' }); }
    if (o.lore) { const r2 = /^@@(end|assistant|user|system)\b/gm; while ((m = r2.exec(text))) add('info', 'deprecated', m.index, m.index + m[0].length, { from: m[0], to: null }); }
    probs.sort((a, b) => a.pos - b.pos);
    return { text, pairs, blocks, probs, strayOpen: sc.strayOpen, strayClose: sc.strayClose, vary, lineOf };
  }
  function insideComment(pairs, pos) { for (const p of pairs) if (p.kind === 'comment' && pos >= p.o && pos < p.c + 2) return true; return false; }

  /* the engine's reading of an example line (exampleMessages.ts:40-55): trim, then {{char}}: <bot>: <name>: or {{user}}: <user>: start a turn; the turn text is split(':', 2)[1], so everything from a second colon on is dropped */
  function speakerLines(text, charName) {
    const out = []; const nm = charName ? String(charName).toLowerCase() + ':' : null; let pos = 0;
    while (pos <= text.length) {
      let e = text.indexOf('\n', pos); if (e < 0) e = text.length; let end = e; if (end > pos && text.charCodeAt(end - 1) === 13) end--;
      const line = text.slice(pos, end), lead = line.length - line.trimStart().length, low = line.trimStart().toLowerCase(); let lab = null, user = false;
      if (low.startsWith('{{char}}:')) lab = '{{char}}:'; else if (low.startsWith('<bot>:')) lab = '<bot>:'; else if (nm && low.startsWith(nm)) lab = nm; else if (low.startsWith('{{user}}:')) { lab = '{{user}}:'; user = true; } else if (low.startsWith('<user>:')) { lab = '<user>:'; user = true; }
      if (lab) { const s = pos + lead, le = s + lab.length, rest = line.slice(lead + lab.length), k = rest.indexOf(':'); out.push({ s, e: le, user, cut: k >= 0 ? le + k : -1, end: pos + line.trimEnd().length }); }
      if (e >= text.length) break; pos = e + 1;
    }
    return out;
  }
  /* ---------------------------------------------------------------- painter (class ids: see lte.css .c1 .. .c11) */
  const C = { BR: 1, NAME: 2, ARG: 3, BLOCK: 4, COMMENT: 5, DECO: 6, DEP: 7, HTML: 8, SPKU: 9, SPKC: 10, CUT: 11 };
  function fill(arr, a, b, v) { for (let i = a; i < b; i++) arr[i] = v; }
  function paint(text, an, o) {
    o = o || {}; const n = text.length, cls = new Uint8Array(n), ul = new Uint8Array(n), em = new Uint8Array(n); let m;
    if (o.html) { const re = /<\/?[A-Za-z][^<>\n]*>/g; while ((m = re.exec(text))) fill(cls, m.index, m.index + m[0].length, C.HTML); }
    if (o.lore) { const re = /^@@[A-Za-z_]+/gm; while ((m = re.exec(text))) fill(cls, m.index, m.index + m[0].length, C.DECO); }
    for (const p of an.pairs) {
      if (p.skip) continue;
      if (p.kind === 'comment') { fill(cls, p.o, p.c + 2, C.COMMENT); continue; }
      fill(cls, p.o, p.o + 2, C.BR); fill(cls, p.c, p.c + 2, C.BR);
      if (p.name) { fill(cls, p.o + 2, p.nameE, p.pre ? C.BLOCK : C.NAME); fill(cls, p.nameE, p.c, C.ARG); if (p.unknown) fill(ul, p.nameS, p.nameE, 2); if (p.bad) fill(ul, p.nameS, p.nameE, 3); }
      else fill(cls, p.o + 2, p.c, C.ARG);
    }
    if (!o.edge) { an.strayOpen.forEach((p) => fill(ul, p, p + 2, 3)); }
    an.probs.forEach((pr) => { if (pr.code === 'deprecated') { fill(cls, pr.s, pr.e, C.DEP); fill(ul, pr.s, pr.e, 1); } });
    if (o.ex) { for (const sp of speakerLines(text, o.charName)) { fill(cls, sp.s, sp.e, sp.user ? C.SPKU : C.SPKC); if (sp.cut >= 0) fill(cls, sp.cut, sp.end, C.CUT); } }
    if (o.caret != null) { let best = null; for (const b of an.blocks) if (o.caret >= b.o1 && o.caret <= b.c2 + 2 && (!best || b.c2 - b.o1 < best.c2 - best.o1)) best = b; if (best) { fill(em, best.o1, best.c1 + 2, 1); fill(em, best.o2, best.c2 + 2, 1); } }
    if (o.marks) o.marks.forEach((mk) => fill(em, mk.s, mk.e, mk.cur ? 3 : 2));
    let html = '', i = 0;
    while (i < n) {
      let j = i + 1; const k = cls[i], u = ul[i], e = em[i];
      while (j < n && cls[j] === k && ul[j] === u && em[j] === e) j++;
      const s = esc(text.slice(i, j));
      html += k || u || e ? '<span class="c' + k + (u ? ' u' + u : '') + (e ? (e === 1 ? ' em' : e === 2 ? ' mk' : ' mkc') : '') + '">' + s + '</span>' : s; i = j;
    }
    return html;
  }
  /* long text: the whole text is in the mirror (so wrapping matches the textarea) but only [a,b) is coloured */
  function paintWindow(text, a, b, o) {
    const sub = text.slice(a, b), an = analyze(sub, Object.assign({}, o, { edge: true }));
    return esc(text.slice(0, a)) + paint(sub, an, Object.assign({}, o, { edge: true, caret: o && o.caret != null ? o.caret - a : null })) + esc(text.slice(b));
  }
  function snapLine(text, pos, dir) { if (dir < 0) { const k = text.lastIndexOf('\n', Math.max(0, pos - 1)); return k < 0 ? 0 : k + 1; } const k = text.indexOf('\n', pos); return k < 0 ? text.length : k; }

  /* ---------------------------------------------------------------- sandbox evaluator (mini CBS, enough for the preview and the token count; unknown macros stay as written) */
  function matchClose(t, a) { let d = 0, i = a; while (i < t.length - 1) { const x = t.charCodeAt(i), y = t.charCodeAt(i + 1); if (x === 123 && y === 123) { d++; i += 2; continue; } if (x === 125 && y === 125) { d--; i += 2; if (d === 0) return i - 2; continue; } i++; } return -1; }
  function splitTop(s) { const out = []; let d = 0, cur = 0, i = 0; while (i < s.length) { if (s.startsWith('{{', i)) { d++; i += 2; continue; } if (s.startsWith('}}', i)) { d--; i += 2; continue; } if (d === 0 && s.startsWith('::', i)) { out.push(s.slice(cur, i)); i += 2; cur = i; continue; } i++; } out.push(s.slice(cur)); return out; }
  function topPairs(t, from) { const out = []; let i = from; for (;;) { const a = t.indexOf('{{', i); if (a < 0) break; const b = matchClose(t, a); if (b < 0) break; out.push({ a, b, inner: t.slice(a + 2, b) }); i = b + 2; } return out; }
  function blockEnd(t, from, name) {
    let depth = 0, i = from; const elses = [];
    for (;;) {
      const a = t.indexOf('{{', i); if (a < 0) return null; const b = matchClose(t, a); if (b < 0) return null; i = b + 2;
      const m = HEAD.exec(t.slice(a + 2, Math.min(b, a + 40))); if (!m) continue; const p = { a, b };
      if (m[1] === '#') depth++; else if (m[1] === '/') { if (depth === 0 && m[2].toLowerCase() === name) return { s: a, e: b + 2, elses }; depth = Math.max(0, depth - 1); } else if (m[1] === ':' && depth === 0) elses.push(p);
    }
  }
  const truthy = (v) => { v = String(v).trim().toLowerCase(); return !(v === '' || v === '0' || v === 'false' || v === 'null'); };
  function cond(parts) {
    const p = parts.map((x) => x.trim());
    if (p.length === 1) return truthy(p[0]);
    const [a, op, b] = p; const na = Number(a), nb = Number(b);
    switch ((op || '').toLowerCase()) { case 'is': return a === b; case 'isnot': return a !== b; case '>': return na > nb; case '<': return na < nb; case '>=': return na >= nb; case '<=': return na <= nb; case 'and': return truthy(a) && truthy(b); case 'or': return truthy(a) || truthy(b); default: return truthy(a); }
  }
  function evalCbs(text, vals, state) {
    const cx = state || { fields: (vals && vals.fields) || {}, expanding: new Set(), vars: Object.assign({}, vals && vals.vars), user: (vals && vals.user) || 'user', char: (vals && vals.char) || 'char', glob: (vals && vals.glob) || {}, vary: false, writes: new Set(), reads: new Set(), unknown: new Set(), depth: 0 };
    if (++cx.depth > 12) { cx.depth--; return text; }
    let out = '', i = 0; const n = text.length;
    while (i < n) {
      const a = text.indexOf('{{', i); if (a < 0) { out += text.slice(i); break; }
      out += text.slice(i, a); const b = matchClose(text, a); if (b < 0) { out += text.slice(a); break; }
      const inner = text.slice(a + 2, b);
      if (inner.startsWith('//')) { i = b + 2; continue; }
      const m = HEAD.exec(inner);
      if (!m) { out += text.slice(a, b + 2); i = b + 2; continue; }
      const name = m[2].toLowerCase(), rest = inner.slice(m[0].length);
      if (m[1] === '#') {
        const end = blockEnd(text, b + 2, name);
        if (!end) { out += text.slice(a, b + 2); i = b + 2; continue; }
        const bodyAll = text.slice(b + 2, end.s); let yes = bodyAll, no = '';
        if (end.elses.length) { const e0 = end.elses[0]; yes = text.slice(b + 2, e0.a); no = text.slice(e0.b + 2, end.s); }
        let ok;
        if (name === 'when' || name === 'if' || name === 'if_pure') { const cs = rest.startsWith('::') ? rest.slice(2) : rest.trim(); ok = cond(splitTop(evalCbs(cs, null, cx)).map((x) => x)); }
        else if (name === 'each') ok = true; else ok = true;
        out += evalCbs(ok ? yes : no, null, cx); i = end.e; continue;
      }
      if (m[1] === '/' || m[1] === ':') { i = b + 2; continue; }
      const args = rest.startsWith('::') ? splitTop(rest.slice(2)).map((x) => evalCbs(x, null, cx)) : [];
      const r = macro(name, args, cx);
      out += r == null ? (cx.unknown.add(name), text.slice(a, b + 2)) : r; i = b + 2;
    }
    cx.depth--;
    if (state) return out;
    return { out, vary: cx.vary, writes: [...cx.writes], reads: [...cx.reads], unknown: [...cx.unknown], vars: cx.vars };
  }
  /* + - * / % and parentheses on numbers (a small recursive-descent reader; nothing is evaluated as code) */
  function calc(src) {
    const t = src.replace(/\s+/g, ''); let i = 0; const bad = { v: false };
    const num = () => { if (t[i] === '(') { i++; const v = add(); if (t[i] === ')') i++; else bad.v = true; return v; } if (t[i] === '-') { i++; return -num(); } if (t[i] === '+') { i++; return num(); } const m = /^\d+(\.\d+)?/.exec(t.slice(i)); if (!m) { bad.v = true; return 0; } i += m[0].length; return Number(m[0]); };
    const mul = () => { let v = num(); while (t[i] === '*' || t[i] === '/' || t[i] === '%') { const o = t[i++], r = num(); v = o === '*' ? v * r : o === '/' ? (r === 0 ? 0 : v / r) : (r === 0 ? 0 : v % r); } return v; };
    const add = () => { let v = mul(); while (t[i] === '+' || t[i] === '-') { const o = t[i++], r = mul(); v = o === '+' ? v + r : v - r; } return v; };
    const v = add(); return bad.v || i < t.length || !isFinite(v) ? 0 : v;
  }
  function macro(name, a, cx) {
    const num = (x) => { const v = Number(x); return isNaN(v) ? 0 : v; };
    switch (name) {
      case 'user': return cx.user; case 'char': case 'bot': return cx.char; case 'persona': case 'description': case 'personality': case 'scenario': case 'lastmessage': case 'lastcharmessage': case 'previouscharchat': case 'lastusermessage': case 'previoususerchat': { const src = cx.fields[name]; if (src == null) return '…'; if (cx.expanding.has(name)) return ''; cx.expanding.add(name); try { return evalCbs(String(src), null, cx); } finally { cx.expanding.delete(name); } }
      case 'getvar': case 'tempvar': { const k = a[0]; cx.reads.add(k); return cx.vars[k] == null ? 'null' : String(cx.vars[k]); }   // chat variables (getChatVar, cbs.ts:888)
      case 'getglobalvar': { const k = a[0]; cx.reads.add(k); return cx.glob[k] == null ? (/^toggle_/.test(k) ? '0' : 'null') : String(cx.glob[k]); }   // global chat variables, where the toggles live (cbs.ts:957)
      case 'setvar': case 'settempvar': cx.writes.add(a[0]); cx.vars[a[0]] = a[1]; return '';
      case 'addvar': cx.writes.add(a[0]); cx.vars[a[0]] = String(num(cx.vars[a[0]]) + num(a[1])); return '';
      case 'setdefaultvar': if (cx.vars[a[0]] == null) { cx.writes.add(a[0]); cx.vars[a[0]] = a[1]; } return '';
      case 'time': cx.vary = true; return '21:04:00'; case 'date': cx.vary = true; return '2026-10-26'; case 'isotime': cx.vary = true; return '21:04:00'; case 'isodate': cx.vary = true; return '2026-10-26'; case 'unixtime': cx.vary = true; return '1793019840'; case 'idle_duration': cx.vary = true; return '0:03:12';
      case 'random': case 'pick': cx.vary = true; return a.length ? a[0] : '0.5'; case 'roll': cx.vary = true; return '1'; case 'dice': cx.vary = true; return '1'; case 'randint': cx.vary = true; return String(a[0] || 0);
      case 'br': case 'newline': return '\n'; case 'trim': return String(a[0] || '').trim(); case 'upper': return String(a[0] || '').toUpperCase(); case 'lower': return String(a[0] || '').toLowerCase(); case 'capitalize': { const s = String(a[0] || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
      case 'length': return String(String(a[0] || '').length); case 'replace': return String(a[0] || '').split(a[1] || '\u0000').join(a[2] || ''); case 'round': return String(Math.round(num(a[0]))); case 'floor': return String(Math.floor(num(a[0]))); case 'abs': return String(Math.abs(num(a[0])));
      case 'calc': return String(calc(String(a[0] || '')));
      case 'equal': return a[0] === a[1] ? '1' : '0'; case 'notequal': return a[0] !== a[1] ? '1' : '0'; case 'and': return truthy(a[0]) && truthy(a[1]) ? '1' : '0'; case 'or': return truthy(a[0]) || truthy(a[1]) ? '1' : '0'; case 'not': return truthy(a[0]) ? '0' : '1';
      case 'greater': return num(a[0]) > num(a[1]) ? '1' : '0'; case 'less': return num(a[0]) < num(a[1]) ? '1' : '0'; case 'contains': return String(a[0] || '').includes(a[1] || '\u0000') ? '1' : '0';
      case 'chatindex': return '12';
      case 'slot': return '';
      case 'raw': return a[0] || ''; case 'img': return '<img alt="' + (a[0] || '') + '">'; case 'audio': case 'bg': case 'emotion': return '';
      default: return /^toggle_/.test(name) ? (cx.reads.add(name), cx.vars[name] == null ? '0' : String(cx.vars[name])) : null;
    }
  }
  /* variable and toggle names a text touches (for the sandbox value list) */
  function usedNames(text) {
    const vars = new Set(), togs = new Set(); let m; const re = /\{\{\s*(getvar|setvar|addvar|setdefaultvar|getglobalvar|tempvar|settempvar)::([A-Za-z0-9_\-]+)/gi;
    while ((m = re.exec(text))) { if (/^toggle_/.test(m[2])) togs.add(m[2].slice(7)); else if (m[1].toLowerCase() !== 'getglobalvar') vars.add(m[2]); }   // a global variable other than a toggle reads as null in the sandbox and is not listed
    const r2 = /toggle_([A-Za-z0-9_]+)/g; while ((m = r2.exec(text))) togs.add(m[1]);
    return { vars: [...vars], toggles: [...togs] };
  }
  const hasUser = (text) => /\{\{\s*user\s*\}\}|<user>/i.test(text), hasChar = (text) => /\{\{\s*char\s*\}\}|<char>|<bot>/i.test(text);

  /* ---------------------------------------------------------------- token counts. Synthetic: no real tokenizer is loaded in the mockup. */
  function estimate(text) {
    let hangul = 0, cjk = 0, latin = 0, digit = 0, ws = 0, other = 0;
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (c >= 0xAC00 && c <= 0xD7A3) hangul++; else if ((c >= 0x3040 && c <= 0x30FF) || (c >= 0x4E00 && c <= 0x9FFF)) cjk++; else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) latin++; else if (c >= 48 && c <= 57) digit++; else if (c === 32 || c === 10 || c === 9 || c === 13) ws++; else other++; }
    return Math.ceil(hangul * 0.85 + cjk * 1.1 + latin * 0.27 + digit * 0.4 + ws * 0.12 + other * 0.6);
  }
  function exactCount(text) {   // stand-in for a model tokenizer: words and punctuation with a per-word length rule; deliberately a different rule from estimate()
    let n = 0; const re = /[A-Za-z]+|[0-9]{1,3}|[가-힣]+|[぀-ヿ一-鿿]|[^\sA-Za-z0-9가-힣]/g; let m;
    while ((m = re.exec(text))) { const w = m[0]; if (/^[A-Za-z]+$/.test(w)) n += Math.max(1, Math.ceil(w.length / 4.5)); else if (/^[가-힣]+$/.test(w)) n += Math.ceil(w.length * 0.9) + (w.length > 3 ? 0 : 0); else n += 1; }
    return n;
  }
  function roundApprox(n) { if (n < 100) return Math.round(n / 5) * 5; const p = Math.pow(10, String(Math.round(n)).length - 2); return Math.round(n / p) * p; }

  /* ---------------------------------------------------------------- example messages (one stored string; a marker line is exactly <start> after trim and lower case, as the engine reads it: DD-123) */
  const isMarker = (line) => line.trim().toLowerCase() === '<start>';
  function markerStarts(text) { const out = []; let pos = 0; while (pos <= text.length) { let e = text.indexOf('\n', pos); if (e < 0) e = text.length; if (isMarker(text.slice(pos, e))) out.push(pos); if (e >= text.length) break; pos = e + 1; } return out; }
  function splitExamples(text) {
    const pos = markerStarts(text); if (!pos.length) return { pre: text, blocks: [] };
    return { pre: text.slice(0, pos[0]), blocks: pos.map((p, i) => text.slice(p, i + 1 < pos.length ? pos[i + 1] : text.length)) };
  }
  const joinExamples = (pre, blocks) => pre + blocks.map((b, i) => (i < blocks.length - 1 && !/\n$/.test(b) ? b + (/\r\n/.test(b) ? '\r\n' : '\n') : b)).join('');
  const blockBody = (raw) => raw.replace(/^[^\n]*\n?/, '');
  const blockTail = (raw) => /\s*$/.exec(raw)[0];
  const eolOf = (s) => (/\r\n/.test(s) ? '\r\n' : '\n');
  /* a changed card is written as <START> + its body; line endings follow the card it replaces (CRLF stays CRLF) */
  function blockFrom(body, oldRaw) { const eol = oldRaw != null ? eolOf(oldRaw) : '\n', tail = oldRaw != null ? blockTail(oldRaw) : '\n\n'; return '<START>' + eol + body.replace(/\s+$/, '').replace(/\r?\n/g, eol) + (tail || eol); }
  /* apply an edit made in a textarea (its value has LF only) to the stored text without touching the endings of the lines the edit did not reach */
  function mergeEdit(old, val) {
    if (old.indexOf('\r') < 0) return val; const norm = old.replace(/\r\n/g, '\n'); if (norm === val) return old;
    let a = 0; const m = Math.min(norm.length, val.length); while (a < m && norm.charCodeAt(a) === val.charCodeAt(a)) a++;
    let b = 0; while (b < m - a && norm.charCodeAt(norm.length - 1 - b) === val.charCodeAt(val.length - 1 - b)) b++;
    const toOrig = (k) => { let n = 0, i = 0; while (i < old.length && n < k) { if (old.charCodeAt(i) === 13 && old.charCodeAt(i + 1) === 10) i++; i++; n++; } return i; };
    const oa = toOrig(a), ob = toOrig(norm.length - b), eol = /\r\n/.test(old.slice(Math.max(0, oa - 4), ob + 4)) || (oa >= old.length && /\r\n$/.test(old)) ? '\r\n' : eolOf(old);
    return old.slice(0, oa) + val.slice(a, val.length - b).replace(/\n/g, eol) + old.slice(ob);
  }
  const turns = (body, charName) => speakerLines(body, charName).length;
  const colonCuts = (body, charName) => speakerLines(body, charName).filter((x) => x.cut >= 0).length;
  const firstLine = (s, n) => { const l = String(s).split('\n').map((x) => x.trim()).find((x) => x) || ''; return l.length > (n || 40) ? l.slice(0, (n || 40) - 1) + '…' : l; };
  /* "paste several": messages are separated by two or more blank lines (a blank line holds nothing or only spaces); one blank line stays inside a message; blank lines at both ends are dropped (DD-122) */
  /* paste several (DD-122, DD-129): two or more blank lines separate messages (one blank line stays inside); with o.dash a line holding only --- separates them instead; ends are trimmed; nothing splits inside a ``` block (an unclosed one runs to the end) */
  function splitMany(text, o) {
    const dash = !!(o && o.dash), lines = String(text).replace(/\r\n/g, '\n').split('\n'), out = []; let cur = [], pend = [], fence = false;
    const push = () => { const x = cur.join('\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, ''); if (x.trim() !== '') out.push(x); cur = []; pend = []; };
    for (const ln of lines) {
      if (/^[ \t]*$/.test(ln)) { pend.push(ln); continue; }
      if (!fence && dash && /^\s*-{3,}\s*$/.test(ln)) { push(); continue; }
      if (!fence && !dash && pend.length >= 2) push(); else { cur.push(...pend); pend = []; }
      cur.push(ln); if (/^\s*```/.test(ln)) fence = !fence;
    }
    push(); return out;
  }

  /* ---------------------------------------------------------------- find / replace (plain text, no regex syntax; positions come from the original text: lower-casing the whole text changes lengths for letters such as İ) */
  const reOf = (q, matchCase) => new RegExp(q.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
  function findAll(text, q, matchCase) { if (!q) return []; const re = reOf(q, matchCase), out = []; let m; while ((m = re.exec(text))) out.push(m.index); return out; }
  function replaceAll(text, q, r, matchCase) { if (!q) return { text, n: 0 }; let n = 0; const out = text.replace(reOf(q, matchCase), () => { n++; return r; }); return { text: out, n }; }

  /* ---------------------------------------------------------------- 초성 filter (same rule as the Studio search: a jamo in the query matches the initial consonant of a syllable) */
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const cho = (ch) => { const n = ch.charCodeAt(0); return n >= 0xAC00 && n <= 0xD7A3 ? CHO[Math.floor((n - 0xAC00) / 588)] : ch; };
  const isJamo = (c) => /[ㄱ-ㅎ]/.test(c);
  function textMatch(hay, q) {
    hay = String(hay).toLowerCase(); q = q.toLowerCase(); if (!q) return true;
    if (![...q].some(isJamo)) return hay.indexOf(q) >= 0;
    for (let i = 0; i + q.length <= hay.length; i++) { let ok = true; for (let j = 0; j < q.length; j++) { if (hay[i + j] === q[j]) continue; if (isJamo(q[j]) && cho(hay[i + j]) === q[j]) continue; ok = false; break; } if (ok) return true; }
    return false;
  }
  function filterMacros(q, list, lang, limit) {
    q = q.replace(/^[#\/:]/, '').toLowerCase(); const pre = [], sub = [], kw = [], desc = [];
    list.forEach((m) => {
      const n = m.n.toLowerCase();
      if (!q) { pre.push(m); return; }
      if (n.indexOf(q) === 0) pre.push(m); else if (n.indexOf(q) > 0) sub.push(m); else if (textMatch((m.kw || '') + ' ' + (m.ko || ''), q)) kw.push(m); else if (lang === 'en' && (m.en || '').toLowerCase().indexOf(q) >= 0) desc.push(m);
    });
    const all = pre.concat(sub, kw, desc); return limit ? all.slice(0, limit) : all;
  }
  /* what to insert for a macro: {text, caret} relative to the start of the inserted text */
  function insertion(m) {
    if (m.ins === 'block') { const open = '{{#' + m.n + (m.n === 'when' ? '::' : ' '); const t = open + '}}\n\n{{/' + m.n + '}}'; return { text: t, caret: open.length }; }
    if (m.ins === 'args') { const t = '{{' + m.n + '::}}'; return { text: t, caret: t.length - 2 }; }
    if (m.ins === 'else') return { text: '{{:else}}', caret: 9 };
    if (m.ins === 'comment') return { text: '{{// }}', caret: 5 };
    if (m.ins === 'toggle') { const t0 = '{{getglobalvar::toggle_' + m.key + '}}'; return { text: t0, caret: t0.length }; }
    const t = '{{' + m.n + '}}'; return { text: t, caret: t.length };
  }
  /* the open `{{query` before the caret, or null */
  function acContext(text, caret) {
    const k = text.lastIndexOf('{{', caret - 2 >= 0 ? caret - 2 : 0); if (k < 0 || k + 2 > caret) return null;
    const q = text.slice(k + 2, caret); if (!/^[#\/:]?[A-Za-z0-9_\-ㄱ-ㅎ가-힣]*$/.test(q)) return null;
    return { start: k, query: q };
  }
  return { BLOCKS, setMacros, isKnown, analyze, paint, paintWindow, snapLine, evalCbs, usedNames, hasUser, hasChar, estimate, exactCount, roundApprox, splitExamples, joinExamples, blockBody, blockTail, blockFrom, eolOf, mergeEdit, isMarker, markerStarts, speakerLines, colonCuts, splitMany, turns, firstLine, findAll, replaceAll, textMatch, filterMacros, insertion, acContext, cho, esc, scan, truthy };
});
