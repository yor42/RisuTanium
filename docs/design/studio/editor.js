/* Studio slice 1: code editor (textarea + overlay), problems, quick fixes, find/replace, completion, simulated Test.
   PORTED from docs/design/mockups/studio.html (DD-092) with the lint rules untouched (see lint.js). What changed in the port:
   - the pure lint engine moved to lint.js; this file keeps the editing layer and talks to the Studio shell through StudioEditor.hooks;
   - removed: mode tabs, example/reference pane, Target/E03 panel, Save draft (drafts persist through the shell), leave guards, scratch documents;
   - one document per code item (Lua, plugin) instead of three fixed documents; document key = item id;
   - chrome strings, announcements and toasts go through a ko/en translator (diagnostic messages and rule titles stay English source text);
   - Check stamps the draft; Apply, conflict handling and persistence live in the shell (slice1.js).
   Mockup only: nothing here runs Lua, plugins or the real CBS parser. */
(function () {
  'use strict';
  var L = window.StudioLint;
  var esc = L.esc, lineIndex = L.lineIndex, applyEdits = L.applyEdits, lintCBS = L.lintCBS, lintLua = L.lintLua, lintPlugin = L.lintPlugin, simRun = L.simRun, selfTest = L.selfTest,
      sanitizeLua = L.sanitizeLua, parseHeaderMirror = L.parseHeaderMirror, RULES = L.RULES, PRESETS = L.PRESETS, DECORATORS = L.DECORATORS, INT_DECORATORS = L.INT_DECORATORS,
      LUA_LOWLEVEL = L.LUA_LOWLEVEL, BUILD_DATE = L.BUILD_DATE;
  var $ = function (id) { return document.getElementById(id); };
  var editor = $('editor'), backdrop = $('backdrop'), marks = $('marks'), gutter = $('gutter'), wrap = $('editor-wrap'), stage = $('code-stage');
  var measureSpan = $('measure-span');
  var diagList = $('diag-list'), previewOut = $('preview-out'), srSummary = $('sr-summary');
  var chkLow = $('chk-lowlevel'), lowWrap = $('lowlevel-wrap');
  var btnUndo = $('btn-undo'), btnRedo = $('btn-redo');
  var RULE_BY_CODE = {};
  RULES.forEach(function (r) { RULE_BY_CODE[r[0]] = r; });
  var docs = [], activeDoc = null, docSeq = 0;
  var hooks = { leave: function () {}, run: null, showEditor: function () {}, edit: function () {}, check: function () {}, toast: function () {}, counts: function () {}, header: function () {}, tested: function () {}, openSetting: function () {}, showProblems: function () {}, showTest: function () {} };
  function isNarrow() { return window.matchMedia('(max-width: 599px)').matches; }
  function setView() {}

  // ---- ko/en translator (port addition) ---------------------------------------------------------------------------------------
  // The original wrote English announcements and tooltips. Every such string passes through T(): exact matches first, then patterns.
  // Rule titles and diagnostic messages come from lint.js (unchanged English source text) and are not translated.
  function lang() { return window.StudioLang ? window.StudioLang() : 'ko'; }
  var TX = {
    'Nothing to undo.': '되돌릴 내용이 없어요.', 'Nothing to redo.': '다시 실행할 내용이 없어요.', 'Nothing to undo': '되돌릴 내용 없음', 'Nothing to redo': '다시 실행할 내용 없음',
    'Opened': '열었을 때', 'Typing': '입력', 'Paste': '붙여넣기', 'Edit': '편집', 'New line': '줄 바꿈', 'Indent': '들여쓰기', 'Remove indentation': '들여쓰기 지우기', 'Replace': '바꾸기',
    'Inserted indentation.': '들여쓰기를 넣었어요.', 'Nothing to indent.': '들여쓸 내용이 없어요.', 'Nothing to outdent.': '내어쓸 내용이 없어요.',
    'No problems to move to.': '이동할 문제가 없어요.', 'No completions at the caret.': '이 위치에는 자동 완성이 없어요.', 'Completions dismissed.': '자동 완성을 닫았어요.',
    'Tab will now move focus out of the editor.': '다음 Tab은 편집기 밖으로 이동해요.', 'Tab now moves focus out of the editor.': 'Tab이 편집기 밖으로 이동해요.', 'Tab now indents.': 'Tab이 들여쓰기를 해요.',
    'Auto-complete on.': '자동 완성을 켰어요.', 'Auto-complete off. Control plus Space still opens completions.': '자동 완성을 껐어요. Ctrl+Space로는 계속 열 수 있어요.',
    'That problem changed. Pick it again from the list.': '그 문제가 바뀌었어요. 목록에서 다시 골라 주세요.',
    'No quick fixes available.': '쓸 수 있는 빠른 수정이 없어요.', 'Simulated test running. Stop is available.': '시험 실행 중이에요(가상). 중지할 수 있어요.',
    'Wrote the draft text.': '초안을 바꿨어요.'
  };
  var TP = [
    [/^Undid: (.*)\.$/, '되돌렸어요: $1'], [/^Redid: (.*)\.$/, '다시 실행했어요: $1'], [/^Undo: (.*) \(Ctrl\+Z\)$/, '되돌리기: $1 (Ctrl+Z)'], [/^Redo: (.*) \(Ctrl\+Y\)$/, '다시 실행: $1 (Ctrl+Y)'],
    [/^Fix: (.*)$/, '수정: $1'], [/^Applied: (.*)\. (.*)$/, '빠른 수정을 적용했어요: $1. $2'], [/^Apply all quick fixes \((\d+)\)$/, '빠른 수정 모두 적용 ($1개)'],
    [/^Applied (\d+) quick fixes? as one undoable step\. (.*)$/, '빠른 수정 $1개를 한 번에 적용했어요(되돌릴 수 있어요). $2'],
    [/^(\d+) rule match\(es\) remain\.$/, '규칙 일치가 $1개 남았어요.'], [/^No rule matches remain\.$/, '남은 규칙 일치가 없어요.'],
    [/^Line (\d+): (\S+), (.*)\.$/, '$1번째 줄: $2, $3'], [/^Problem (\d+) of (\d+)\. (\w+), line (\d+), (\S+), (.*?)(\. Quick fix available)?\.?$/, function (m) { return '문제 ' + m[1] + '/' + m[2] + '. ' + ({ Error: '오류', Warning: '경고', Info: '정보' }[m[3]] || m[3]) + ', ' + m[4] + '번째 줄, ' + m[5] + ', ' + m[6] + (m[7] ? '. 빠른 수정 있음' : '') + '.'; }],
    [/^No completions match "(.*)"\.$/, '"$1"에 맞는 자동 완성이 없어요.'], [/^(\d+) completions?\. (.*) selected\. .*$/, '자동 완성 $1개. $2 선택됨. 화살표로 고르고 Enter나 Tab으로 넣고 Esc로 닫아요.'],
    [/^(.*), (\d+) of (\d+)\.$/, '$1, $2/$3'], [/^Complete (.*)$/, '완성: $1'], [/^Inserted (.*)\.$/, '넣었어요: $1'],
    [/^No matches for (.*)\.$/, '"$1"와 일치하는 내용이 없어요.'], [/^Match (\d+) of (\d+), line (\d+)\.$/, '$1/$2번째 일치, $3번째 줄'],
    [/^Replace all \((\d+)\)$/, '모두 바꾸기 ($1)'], [/^Replaced (\d+) matches? in one undoable step\.$/, '$1곳을 한 번에 바꿨어요(되돌릴 수 있어요).'],
    [/^Enter a line number from 1 to (\d+)\. The cursor was not moved\.$/, '1부터 $1 사이의 줄 번호를 입력해 주세요. 커서는 움직이지 않았어요.'], [/^Line (\d+) of (\d+)\.$/, '$1/$2번째 줄'],
    [/^Indent set to (.*)\.$/, function (m) { return '들여쓰기: ' + (m[1] === 'tab' ? '탭' : m[1].replace(' spaces', '칸')) + '.'; }],
    [/^What-if lowLevelAccess (on|off)\. Simulation only; no setting was changed\.$/, function (m) { return '가정: 낮은 수준 접근 ' + (m[1] === 'on' ? '켜짐' : '꺼짐') + '. 시뮬레이션일 뿐 설정은 바뀌지 않았어요.'; }],
    [/^Simulated test finished for revision (\d+)\. Nothing was executed\.$/, '시험이 끝났어요(가상, 판 $1). 아무것도 실행되지 않았어요.'],
    [/^Simulated test (.*) for revision (\d+)\. Nothing was executed\.$/, function (m) { return '시험이 ' + ({ 'threw an error': '오류로 끝났어요', 'timed out': '시간 초과로 끝났어요', 'was stopped': '중지됐어요', 'produced diagnostics': '진단을 냈어요' }[m[1]] || m[1]) + '(가상, 판 ' + m[2] + '). 아무것도 실행되지 않았어요.'; }],
    [/^Check finished for revision (\d+): (.*?)( JavaScript syntax and API checks were not run\.)?$/, function (m) { return '검사가 끝났어요(판 ' + m[1] + '): ' + m[2].replace('no rule matches.', '규칙 일치 없음.').replace(/(\d+) errors, (\d+) warnings, (\d+) info\./, '오류 $1개, 경고 $2개, 정보 $3개.') + (m[3] ? ' 자바스크립트 문법과 API는 검사하지 않았어요.' : ''); }]
  ];
  function T(s) {
    if (lang() === 'en' || typeof s !== 'string') return s;
    if (TX[s] !== undefined) return TX[s];
    for (var i = 0; i < TP.length; i++) { var m = TP[i][0].exec(s); if (m) return typeof TP[i][1] === 'function' ? TP[i][1](m) : s.replace(TP[i][0], TP[i][1]); }
    return s;
  }
  // chrome strings that are not announcements: kept in one table so the shell can switch language without a reload
  var CH = {
    ko: { sevError: '오류', sevWarning: '경고', sevInfo: '정보', line: '줄', col: '열', selected: '선택', noRules: '규칙 일치 없음', allProblems: '모든 문제', errorsL: '오류', warningsL: '경고', infoL: '정보 알림',
      issues: function (n) { return '문제 ' + n + '개'; }, quickFix: '빠른 수정', fullDiff: '전체 차이 보기', shortDiff: '짧게 보기', show: '편집기에서 보기', fix: '수정', source: '근거', explainOpen: '자세히',
      noMatchFilter: function (f) { return (f === 'error' ? '오류' : f === 'warning' ? '경고' : '정보') + '가 없어요.'; }, showAll: '모두 보기',
      empty: '규칙에 걸리는 내용이 없어요. 글이 맞다는 뜻은 아니에요. 규칙이 다루는 경우만 확인해요.', emptyPlus: '시뮬레이션이 일부 태그를 그대로 출력해요',
      luaNote: function (on) { return '낮은 수준 접근이 <strong>' + (on ? '켜짐' : '꺼짐') + '</strong>이라고 가정하고 검사해요(가정일 뿐, 빠른 수정은 설정을 바꾸지 않아요).'; },
      openSetting: '소유자 설정 열기', changeInTest: '테스트에서 바꾸기', expanded: '펼쳐짐', pressExpand: '눌러서 펼치고 편집기에서 선택해요', quickFixAvail: '빠른 수정 있음',
      scanError: '규칙 검사에서 내부 오류가 나 건너뛰었어요: ', Eng: '진단 메시지는 영어 원문이에요' },
    en: { sevError: 'Error', sevWarning: 'Warning', sevInfo: 'Info', line: 'Line', col: 'Col', selected: 'selected', noRules: 'No rule matches', allProblems: 'All problems', errorsL: 'Errors', warningsL: 'Warnings', infoL: 'Info notes',
      issues: function (n) { return n + ' issue' + (n === 1 ? '' : 's'); }, quickFix: 'Quick fix', fullDiff: 'Show full diff', shortDiff: 'Show short diff', show: 'Show in editor', fix: 'Fix', source: 'Source', explainOpen: 'Details',
      noMatchFilter: function (f) { return 'No ' + (f === 'error' ? 'errors' : f === 'warning' ? 'warnings' : 'info notes') + ' in this filter.'; }, showAll: 'Show all',
      empty: 'No rule matches. This does not prove the text is correct: the rules cover only the cases listed in the rule reference.', emptyPlus: 'the preview simulation still prints some tags literally',
      luaNote: function (on) { return 'Rule scan assumes <code>lowLevelAccess</code> is <strong>' + (on ? 'on' : 'off') + '</strong> (what-if only; quick fixes never change it).'; },
      openSetting: 'Open owner setting', changeInTest: 'Change in Test', expanded: 'Expanded', pressExpand: 'Press to expand and select it in the editor', quickFixAvail: 'Quick fix available',
      scanError: 'The rule scan hit an internal error and was skipped: ', Eng: 'Diagnostic messages are English source text' }
  };
  function C_(k) { var t = CH[lang() === 'en' ? 'en' : 'ko'][k]; return t; }

  /* ==== ORIGINAL studio.html lines 2039-2182 : small helpers, tokenizers, highlighters ==== */
  var rankOf = { error: 3, warning: 2, info: 1 };
  var composing = false;
  var indent = { mode: 'spaces', width: 2 };
  function indentUnit() { return indent.mode === 'tab' ? '\t' : new Array(indent.width + 1).join(' '); }

  // ---- small text helpers ------------------------------------------------------
  function lineStartOf(v, p) { return p <= 0 ? 0 : v.lastIndexOf('\n', p - 1) + 1; }
  function lineEndOf(v, p) { var i = v.indexOf('\n', p); return i === -1 ? v.length : i; }
  function lineNoAt(v, p) { var n = 1; for (var i = v.indexOf('\n'); i !== -1 && i < p; i = v.indexOf('\n', i + 1)) n++; return n; }
  function diffRange(a, b) {
    var n = Math.min(a.length, b.length), p = 0;
    while (p < n && a.charCodeAt(p) === b.charCodeAt(p)) p++;
    var s = 0, m = n - p;
    while (s < m && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
    return { p: p, aEnd: a.length - s, bEnd: b.length - s };
  }
  // Moves an offset through a set of non-overlapping edits (original coordinates). bias 'left' keeps a position that sits
  // exactly at an insertion point in front of the inserted text.
  function mapPos(pos, edits, bias) {
    var sorted = edits.slice().sort(function (a, b) { return a.start - b.start || a.end - b.end; }), delta = 0;
    for (var i = 0; i < sorted.length; i++) {
      var e = sorted[i], len = e.text.length - (e.end - e.start);
      if (e.end < pos || (e.end === pos && e.start < pos)) { delta += len; continue; }
      if (e.end === pos && e.start === pos) { if (bias !== 'left') delta += len; break; }
      if (e.start < pos) return e.start + delta + e.text.length;
      break;
    }
    return pos + delta;
  }

  // ---- stateful tokenizers (ST-08): comments and strings are recognised in the order the language does --------------
  function scanLua(src) {
    var toks = [], i = 0, n = src.length, cs = 0;
    function push(t, s, e, closed) { if (cs < s) toks.push({ t: 'code', s: cs, e: s }); toks.push({ t: t, s: s, e: e, closed: closed }); cs = e; }
    while (i < n) {
      var c = src.charCodeAt(i);
      if (c === 45 && src.charCodeAt(i + 1) === 45) {                       // --
        var m = /^--\[(=*)\[/.exec(src.slice(i, i + 40));
        if (m) { var cl = ']' + m[1] + ']', j = src.indexOf(cl, i + m[0].length), e = j === -1 ? n : j + cl.length; push('com', i, e, j !== -1); i = e; continue; }
        var nl = src.indexOf('\n', i); if (nl === -1) nl = n; push('com', i, nl, false); i = nl; continue;
      }
      if (c === 34 || c === 39) {                                           // " '
        var q = src[i], k = i + 1;
        while (k < n && src[k] !== q && src[k] !== '\n') { if (src[k] === '\\') k++; k++; }
        var closed = k < n && src[k] === q, ek = closed ? k + 1 : Math.min(k, n);
        push('str', i, ek, closed); i = ek; continue;
      }
      if (c === 91) {                                                       // [[ long string ]]
        var lm = /^\[(=*)\[/.exec(src.slice(i, i + 20));
        if (lm) { var cl2 = ']' + lm[1] + ']', jj = src.indexOf(cl2, i + lm[0].length), ee = jj === -1 ? n : jj + cl2.length; push('str', i, ee, jj !== -1); i = ee; continue; }
      }
      i++;
    }
    if (cs < n) toks.push({ t: 'code', s: cs, e: n });
    return toks;
  }
  function scanJs(src) {
    var toks = [], i = 0, n = src.length, cs = 0;
    function push(t, s, e, closed) { if (cs < s) toks.push({ t: 'code', s: cs, e: s }); toks.push({ t: t, s: s, e: e, closed: closed }); cs = e; }
    while (i < n) {
      var c = src.charCodeAt(i);
      if (c === 47) {
        var d = src.charCodeAt(i + 1);
        if (d === 47) {                                                     // // line comment or //@ header
          var nl = src.indexOf('\n', i); if (nl === -1) nl = n;
          push(src.charCodeAt(i + 2) === 64 && (i === 0 || src.charCodeAt(i - 1) === 10) ? 'dir' : 'com', i, nl, false); i = nl; continue;
        }
        if (d === 42) { var j = src.indexOf('*/', i + 2), e = j === -1 ? n : j + 2; push('com', i, e, j !== -1); i = e; continue; }
      }
      if (c === 34 || c === 39) {
        var q = src[i], k = i + 1;
        while (k < n && src[k] !== q && src[k] !== '\n') { if (src[k] === '\\') k++; k++; }
        var closed = k < n && src[k] === q, ek = closed ? k + 1 : Math.min(k, n);
        push('str', i, ek, closed); i = ek; continue;
      }
      if (c === 96) {                                                       // template literal (nested ${ } is not parsed)
        var k2 = i + 1;
        while (k2 < n && src[k2] !== '`') { if (src[k2] === '\\') k2++; k2++; }
        var cl3 = k2 < n, e3 = cl3 ? k2 + 1 : n;
        push('str', i, e3, cl3); i = e3; continue;
      }
      i++;
    }
    if (cs < n) toks.push({ t: 'code', s: cs, e: n });
    return toks;
  }
  function scanFor(mode, text) { return mode === 'lua' ? scanLua(text) : mode === 'plugin' ? scanJs(text) : []; }
  // 'code' | 'string' | 'comment' for the caret position `off`
  function ctxAtOffset(toks, off) {
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.s >= off) break;
      if (t.t === 'code') continue;
      if (off < t.e || (off === t.e && !t.closed)) return t.t === 'str' ? 'string' : 'comment';
    }
    return 'code';
  }

  var LUA_KW = 'function|local|if|then|else|elseif|end|return|or|and|not|for|while|do|in|nil|true|false|repeat|until|break';
  var LUA_API = 'async|await|getChatVar|setChatVar|simpleLLM|LLM|axLLM|similarity|request|generateImage|loadLoreBooks|listenEdit';
  var luaRe = new RegExp('\\b(' + LUA_API + ')\\b|\\b(' + LUA_KW + ')\\b', 'g');
  var JS_KW = 'const|let|var|await|async|function|return|new|if|else|for|while|class|try|catch|throw|true|false|null|import|export';
  var jsRe = new RegExp('\\b(risuai\\.[A-Za-z0-9_]+|eval)\\b|\\b(' + JS_KW + ')\\b', 'g');
  function hlCode(seg, re) {
    return esc(seg).replace(re, function (m, a) { return '<span class="' + (a ? 'hl-macro' : 'hl-kw') + '">' + m + '</span>'; });
  }
  // Spans never cross a newline (a multi-line string/comment is closed and re-opened per line) so the output can be
  // split into per-line HTML and painted in cached blocks.
  function spanPerLine(cls, raw) {
    return raw.split('\n').map(function (p) { return p ? '<span class="' + cls + '">' + esc(p) + '</span>' : ''; }).join('\n');
  }
  function highlightScript(text, toks, re) {
    var out = '';
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i], s = text.slice(t.s, t.e);
      if (t.t === 'code') out += hlCode(s, re);
      else if (t.t === 'str') out += spanPerLine('hl-str', s);
      else if (t.t === 'dir') { var m = /^(\/\/@[a-z-]+)([^]*)$/i.exec(s); out += m ? '<span class="hl-dec">' + esc(m[1]) + '</span><span class="hl-arg">' + esc(m[2]) + '</span>' : esc(s); }
      else out += spanPerLine('hl-comment', s);
    }
    return out;
  }
  function hlCBSLine(line) {
    var out = '', last = 0, re = /(\{\{)([#\/:]?[A-Za-z0-9_\-?\/]*)|(\}\})|(::)(vis|visnot|tis|tisnot|isnot|is|and|or|not|keep|legacy|var|toggle|>=|<=|>|<)(?=::|\}\})|(<\/?(?:char|user|bot)>)/gi, m;
    var dec = /^(\s*@@@?[A-Za-z0-9_]+)(.*)$/.exec(line);
    if (dec) return '<span class="hl-dec">' + esc(dec[1]) + '</span><span class="hl-arg">' + esc(dec[2]) + '</span>';
    while ((m = re.exec(line)) !== null) {
      out += esc(line.slice(last, m.index));
      if (m[1]) {
        var isBlock = /^[#\/:]/.test(m[2]);
        out += '<span class="' + (isBlock ? 'hl-block' : 'hl-macro') + '">' + esc(m[1] + m[2]) + '</span>';
      } else if (m[3]) out += '<span class="hl-macro">}}</span>';
      else if (m[4]) out += '::<span class="hl-op">' + esc(m[5]) + '</span>';
      else out += '<span class="hl-legacy">' + esc(m[6]) + '</span>';
      last = m.index + m[0].length;
    }
    return out + esc(line.slice(last));
  }
  function highlightLines(text, mode) {
    if (mode === 'cbs') return text.split('\n').map(hlCBSLine);
    return highlightScript(text, scanFor(mode, text), mode === 'lua' ? luaRe : jsRe).split('\n');
  }
  function highlightAll(text, mode) { return highlightLines(text, mode).join('\n') + '\n'; }


  /* ==== ORIGINAL studio.html lines 2183-2285 : documents, history, announce/toast ==== */
  // ---- documents (one model per synthetic document: text, selection, scroll, history, lifecycle) ------------------
  // PORT: a document is keyed by the shell's item id; savedText is the live (applied) text, so isModified() means "has a draft".
  function makeDoc(key, mode, title, text, live, lowLevel, realLow) {
    var d = {
      id: 'doc' + (++docSeq), key: key, mode: mode, title: title, text: text, lowLevel: !!lowLevel, realLow: !!realLow,
      selStart: 0, selEnd: 0, selDir: 'none', scrollTop: 0, scrollLeft: 0,
      hist: { states: [{ text: text, selStart: 0, selEnd: 0, label: T('Opened') }], idx: 0, lastKind: null, lastAt: 0 },
      rev: 0, savedText: live, checked: null, tested: null
    };
    docs.push(d);
    return d;
  }
  function docText(d) { return d === activeDoc ? editor.value : d.text; }
  function isModified(d) { return docText(d) !== d.savedText; }   // the what-if setting is not document content

  // ---- one chronological history per document (ST-01) -----------------------------------------------------------
  function stampSel() {
    var h = activeDoc.hist, st = h.states[h.idx];
    if (st.text === editor.value) { st.selStart = editor.selectionStart; st.selEnd = editor.selectionEnd; }
  }
  function histPush(kind, label, low) {
    var d = activeDoc, h = d.hist, now = Date.now();
    var st = { text: editor.value, selStart: editor.selectionStart, selEnd: editor.selectionEnd, label: T(label) };
    if (low) { st.lowBefore = low.before; st.lowAfter = low.after; }
    if (kind === 'type' && h.lastKind === 'type' && h.idx === h.states.length - 1 && h.idx > 0 && now - h.lastAt < 1000) {
      h.states[h.idx] = st;                          // same typing burst: one undo step
    } else {
      h.states.length = h.idx + 1;                   // a new edit discards only the redo branch
      h.states.push(st); h.idx++;
      if (h.states.length > 400) { h.states.shift(); h.idx--; }
    }
    h.lastKind = kind; h.lastAt = now;
    d.text = st.text; d.rev++;
  }
  function breakBurst() { if (activeDoc) activeDoc.hist.lastKind = null; }
  function applyHistState(st, low, say) {
    editor.value = st.text;
    if (low !== undefined) chkLow.checked = low;
    editor.setSelectionRange(st.selStart, st.selEnd);
    activeDoc.text = st.text; activeDoc.lowLevel = chkLow.checked; activeDoc.rev++; activeDoc.hist.lastKind = null;
    afterEdit({ say: say });
  }
  function undo() {
    if (composing) return false;
    var h = activeDoc.hist;
    if (h.idx <= 0) { announce('Nothing to undo.'); return false; }
    var op = h.states[h.idx]; h.idx--;
    applyHistState(h.states[h.idx], op.lowBefore, 'Undid: ' + op.label + '.');
    return true;
  }
  function redo() {
    if (composing) return false;
    var h = activeDoc.hist;
    if (h.idx >= h.states.length - 1) { announce('Nothing to redo.'); return false; }
    h.idx++;
    var st = h.states[h.idx];
    applyHistState(st, st.lowAfter, 'Redid: ' + st.label + '.');
    return true;
  }
  // Every command goes through here: one history entry, then focus, selection, scroll and status are brought back in sync.
  function runEdit(label, newText, selS, selE, o) {
    o = o || {};
    if (newText === editor.value) return false;
    stampSel();
    if (o.low) chkLow.checked = o.low.after;
    editor.value = newText;
    editor.setSelectionRange(selS, selE);
    histPush(o.kind || 'cmd', label, o.low);
    if (o.low) activeDoc.lowLevel = chkLow.checked;
    afterEdit({ say: o.say, immediate: o.kind !== 'type', focus: o.focus, noReveal: o.noReveal, noAnnounce: o.noAnnounce });
    return true;
  }
  function afterEdit(o) {
    o = o || {};
    hideCompletion();
    renderDisplay();
    if (o.immediate === false) scheduleAnalysis(); else analyzeNow();
    renderDocHeader(); renderUndoButtons();
    if (o.focus !== false) {
      var s = editor.selectionStart, e = editor.selectionEnd, dir = editor.selectionDirection;
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(s, e, dir);
    }
    cursorInfo();
    if (!o.noReveal) revealRange(editor.selectionStart, editor.selectionEnd);
    if (find.open) recomputeFind(false);
    if (o.say && !o.noAnnounce) announce(o.say);
  }
  function renderUndoButtons() {
    var h = activeDoc.hist;
    btnUndo.disabled = h.idx <= 0; btnRedo.disabled = h.idx >= h.states.length - 1;
    btnUndo.title = T(h.idx > 0 ? 'Undo: ' + h.states[h.idx].label + ' (Ctrl+Z)' : 'Nothing to undo');
    btnRedo.title = T(h.idx < h.states.length - 1 ? 'Redo: ' + h.states[h.idx + 1].label + ' (Ctrl+Y)' : 'Nothing to redo');
    var pre = lang() === 'en' ? 'Editor: ' : '편집기 ';   // F-15: the editor's own history is named, the header pair is the owner history
    btnUndo.title = pre + btnUndo.title; btnRedo.title = pre + btnRedo.title;
    btnUndo.setAttribute('aria-label', btnUndo.title); btnRedo.setAttribute('aria-label', btnRedo.title);
  }

  var annFlip = false;
  function announce(msg) { annFlip = !annFlip; srSummary.textContent = T(msg) + (annFlip ? '' : ' '); }
  function showToast(msg, withUndo) {
    hooks.toast(T(msg), withUndo && activeDoc.hist.idx > 0 ? function () { undo(); } : null);
    announce(msg);
  }

  /* ==== ORIGINAL studio.html lines 2286-2422 : layout, analysis, display layers ==== */

  // ---- layout measurement (ST-09): coordinates come from rendered text, not from "columns x width of M" ------------
  var lineHeightPx = 20.8;
  function lineHeight() { var lh = parseFloat(getComputedStyle(editor).lineHeight); return lh > 0 ? lh : lineHeightPx; }
  function prefixWidth(str) { measureSpan.textContent = str; return measureSpan.getBoundingClientRect().width; }
  // Visual x of a range inside its line (tabs expand to their tab stop, Hangul/CJK use the fallback font's real widths).
  function rangeMetrics(start, end) {
    var v = editor.value, ls = lineStartOf(v, start), le = lineEndOf(v, start);
    var x0 = prefixWidth(v.slice(ls, start)), x1 = prefixWidth(v.slice(ls, Math.min(Math.max(end, start), le)));
    return { line: lineNoAt(v, start), col: start - ls + 1, x0: x0, x1: Math.max(x1, x0 + 2) };
  }
  function revealRange(start, end, center) {
    var m = rangeMetrics(start, end), lh = lineHeight();
    var top = 14 + (m.line - 1) * lh, viewH = wrap.clientHeight;
    if (center || top < wrap.scrollTop + 6 || top + lh > wrap.scrollTop + viewH - 6) wrap.scrollTop = Math.max(0, top - viewH / 3);
    var gw = gutter.offsetWidth, vis = wrap.clientWidth - gw;      // the sticky gutter covers the first gw px of the scrollport
    var a0 = 16 + m.x0, a1 = 16 + m.x1;
    if (a0 < wrap.scrollLeft + 8 || Math.min(a1, a0 + vis * 0.6) > wrap.scrollLeft + vis - 8) wrap.scrollLeft = Math.max(0, a0 - vis / 3);
    return m;
  }
  function caretOffset() { return editor.selectionDirection === 'backward' ? editor.selectionStart : editor.selectionEnd; }
  function cursorInfo() {
    var v = editor.value, p = caretOffset(), ls = lineStartOf(v, p), n = Math.abs(editor.selectionEnd - editor.selectionStart);
    $('cursor-pos').textContent = lang() === 'en' ? 'Ln ' + lineNoAt(v, p) + ', Col ' + (p - ls + 1) + (n ? ' (' + n + ' selected)' : '') : lineNoAt(v, p) + '번째 줄, ' + (p - ls + 1) + '열' + (n ? ' (' + n + '자 선택)' : '');
  }

  // ---- analysis (separate from text input, ST-10) ------------------------------------------------------------------
  var analysis = { docId: null, rev: -1, text: '', diags: [], header: null, error: null };
  var analysisTimer = null, analysisPending = false, analysisSeq = 0, perf = { lastAnalysisMs: 0, analyses: 0, skippedObsolete: 0 };
  function runLintFor(mode, text, low) {
    if (mode === 'cbs') return { diags: lintCBS(text), header: null };
    if (mode === 'lua') return { diags: lintLua(text, low), header: null };
    var r = lintPlugin(text); return { diags: r.diags, header: r.header };
  }
  function scheduleAnalysis() {
    analysisPending = true; $('check-chips').classList.add('pending'); diagList.setAttribute('aria-busy', 'true');
    clearTimeout(analysisTimer);
    analysisTimer = setTimeout(function tick() {
      if (composing) { analysisTimer = setTimeout(tick, 200); return; }   // never analyze during IME composition
      analyzeNow();
    }, 220);
  }
  function analyzeNow() {
    clearTimeout(analysisTimer); analysisPending = false;
    var d = activeDoc, rev = d.rev, text = editor.value, seq = ++analysisSeq, t0 = performance.now(), res, err = null;
    try { res = runLintFor(d.mode, text, chkLow.checked); } catch (e) { res = { diags: [], header: null }; err = String(e && e.message || e); }
    if (seq !== analysisSeq || d !== activeDoc || d.rev !== rev) { perf.skippedObsolete++; return; }   // obsolete revision: ignore
    var counts = {};
    var diags = res.diags.slice().sort(function (a, b) { return a.start - b.start; });
    diags.forEach(function (x) { counts[x.code] = (counts[x.code] || 0) + 1; x.key = x.code + '#' + counts[x.code]; });
    analysis = { docId: d.id, rev: rev, text: text, diags: diags, header: res.header, error: err };
    perf.lastAnalysisMs = performance.now() - t0; perf.analyses++;
    $('check-chips').classList.remove('pending'); diagList.removeAttribute('aria-busy');
    renderDisplay(); renderProblems(); renderStatus(); renderChips(); renderTestPanel();
  }

  // ---- display layers ----------------------------------------------------------------------------------------------
  function shiftDiag(d, delta) { var c = {}; for (var k in d) c[k] = d[k]; c.start = d.start + delta; c.end = d.end + delta; return c; }
  function mapDiags(diags, a, b) {
    if (a === b) return diags;
    var r = diffRange(a, b), delta = b.length - a.length, out = [];
    diags.forEach(function (d) {
      if (d.end <= r.p) out.push(d);
      else if (d.start >= r.aEnd) out.push(shiftDiag(d, delta));   // ranges that overlap the edit are dropped until re-analysed
    });
    return out;
  }
  var shown = [], lastGutterKey = null;
  function marksExtras() {
    var ex = [];
    if (find.open && find.q) {
      var n = Math.min(find.matches.length, 400);
      for (var i = 0; i < n; i++) ex.push({ start: find.matches[i], end: find.matches[i] + find.q.length, cls: i === find.cur ? 'm-find-cur' : 'm-find' });
      if (find.cur >= n && find.cur >= 0) ex.push({ start: find.matches[find.cur], end: find.matches[find.cur] + find.q.length, cls: 'm-find-cur' });
    }
    if (selProbKey) shown.forEach(function (d) { if (d.key === selProbKey) ex.push({ start: d.start, end: Math.max(d.end, d.start + 1), cls: 'm-sel' }); });
    return ex;
  }
  function renderMarks(text, diags, extras) {
    var items = [], n = text.length;
    diags.forEach(function (d) {
      var s = Math.max(0, Math.min(n, d.start)), e = Math.max(0, Math.min(n, d.end));
      if (e > s) items.push({ s: s, e: e, cls: d.severity === 'error' ? 'm-err' : 'm-' + d.severity, rank: rankOf[d.severity] });
    });
    extras.forEach(function (x) { var s = Math.max(0, Math.min(n, x.start)), e = Math.max(0, Math.min(n, x.end)); if (e > s) items.push({ s: s, e: e, cls: x.cls, rank: 0, extra: true }); });
    items.sort(function (a, b) { return a.s - b.s; });
    var cuts = new Set([0, n]);
    items.forEach(function (it) { cuts.add(it.s); cuts.add(it.e); });
    var pts = Array.from(cuts).sort(function (a, b) { return a - b; });
    var active = [], ni = 0, html = '';
    for (var i = 0; i < pts.length - 1; i++) {
      var s0 = pts[i], e0 = pts[i + 1];
      while (ni < items.length && items[ni].s <= s0) { active.push(items[ni]); ni++; }
      active = active.filter(function (it) { return it.e > s0; });
      var best = null, extra = '';
      active.forEach(function (it) { if (it.extra) extra += ' ' + it.cls; else if (!best || it.rank > best.rank) best = it; });
      var cls = ((best ? best.cls : '') + extra).trim(), seg = text.slice(s0, e0);
      html += cls ? spanPerLine(cls, seg) : esc(seg);
    }
    return html.split('\n');                                     // one HTML string per source line
  }
  // Block painting: the layers are rebuilt as strings on every edit (cheap) but only the 40-line blocks whose HTML
  // changed are written to the DOM, so one keystroke touches one or two blocks instead of the whole document.
  var BLK = 40, blockCache = { backdrop: [], marks: [], gutter: [] };
  function paintBlocks(el, lines, cache, tag, trail) {
    var kids = el.children, nb = Math.max(1, Math.ceil(lines.length / BLK)), i;
    for (i = 0; i < nb; i++) {
      var html = lines.slice(i * BLK, i * BLK + BLK).join(trail) + trail;
      if (i >= kids.length) { var n = document.createElement(tag); n.innerHTML = html; el.appendChild(n); }
      else if (cache[i] !== html) kids[i].innerHTML = html;
      cache[i] = html;
    }
    while (kids.length > nb) el.removeChild(el.lastChild);
    cache.length = nb;
  }
  function resetLayers() { blockCache = { backdrop: [], marks: [], gutter: [] }; backdrop.textContent = ''; marks.textContent = ''; gutter.textContent = ''; }
  var minEditorH = 0;
  function resizeEditor() {
    if (!minEditorH) minEditorH = parseFloat(getComputedStyle(wrap).minHeight) || 100;
    var h = Math.max(backdrop.offsetHeight, minEditorH - 2), w = backdrop.offsetWidth;
    var hs = h + 'px', ws = w + 'px';
    if (editor.style.height !== hs) editor.style.height = hs;
    if (editor.style.width !== ws) editor.style.width = ws;     // the textarea must be as wide as its text or it scrolls on its own
  }
  function renderDisplay() {
    var text = editor.value, mode = activeDoc.mode;
    shown = analysis.docId === activeDoc.id ? mapDiags(analysis.diags, analysis.text, text) : [];
    var L = lineIndex(text), sev = {}, count = L.starts.length;
    shown.forEach(function (d) { var ln = L.lineAt(d.start); if (!sev[ln] || rankOf[d.severity] > rankOf[sev[ln]]) sev[ln] = d.severity; });
    var gl = new Array(count);
    for (var i = 1; i <= count; i++) gl[i - 1] = '<div class="gutter-line ' + (sev[i] === 'error' ? 'err' : sev[i] || '') + '">' + i + '</div>';
    paintBlocks(gutter, gl, blockCache.gutter, 'div', '');
    paintBlocks(backdrop, highlightLines(text, mode), blockCache.backdrop, 'span', '\n');
    paintBlocks(marks, renderMarks(text, shown, marksExtras()), blockCache.marks, 'span', '\n');
    resizeEditor();
  }


  /* ==== ORIGINAL studio.html lines 2423-2665 : problems, status, chips, header, test pane, check ==== */
  // ==========================================================================
  // 10. Problems (triage list), fix previews, status, chips, test pane
  // ==========================================================================
  var filter = 'all', selProbKey = null, fullDiffKeys = {};
  function plainLabel(s, max) {
    if (s.length <= max) return s;
    var cut = s.slice(0, max), sp = cut.lastIndexOf(' ');
    return (sp > 40 ? cut.slice(0, sp) : cut) + '...';
  }
  function literalTagCount(s) { return (String(s).match(/\{\{[^{}]*\}\}/g) || []).length; }
  function probTitle(d) { var r = RULE_BY_CODE[d.code]; return r ? r[2] : plainLabel(d.msg, 60); }
  function sevIcon(sev, size) { return StudioIcon(sev === 'error' ? 'circle-x' : sev === 'warning' ? 'triangle-alert' : 'info', size || 14); }
  function sevInfo(sev) { return { label: sev === 'error' ? C_('sevError') : sev === 'warning' ? C_('sevWarning') : C_('sevInfo') }; }
  function visibleProblems() { return shown.filter(function (d) { return filter === 'all' || d.severity === filter; }); }

  // ---- fix preview centred on the changed characters (ST-07) ---------------------------------------------------
  function hunksFor(fix, text) {
    return fix.edits.slice().sort(function (a, b) { return a.start - b.start; }).map(function (e) {
      var ls = lineStartOf(text, e.start), le = lineEndOf(text, Math.max(e.end, e.start));
      var before = text.slice(ls, le), after = text.slice(ls, e.start) + e.text + text.slice(e.end, le);
      var r = diffRange(before, after);
      return { line: lineNoAt(text, e.start), before: before, after: after, p: r.p, delEnd: r.aEnd, addEnd: r.bEnd };
    });
  }
  function pvRow(kind, h, full) {
    var str = kind === 'del' ? h.before : h.after, endIdx = kind === 'del' ? h.delEnd : h.addEnd;
    var pre = str.slice(0, h.p), mid = str.slice(h.p, endIdx), post = str.slice(endIdx);
    if (!full) {
      pre = pre.slice(pre.lastIndexOf('\n') + 1); post = post.split('\n')[0];
      if (pre.length > 38) pre = '…' + pre.slice(-36);
      if (post.length > 38) post = post.slice(0, 36) + '…';
      if (mid.length > 160) mid = mid.slice(0, 70) + ' … [' + (mid.length - 140) + ' more characters] … ' + mid.slice(-70);
    }
    var midShown = mid === '' ? '‸' : mid.replace(/\n/g, full ? '⏎\n' : '⏎');
    return '<span class="pv-row pv-' + kind + '">' + (kind === 'del' ? '- ' : '+ ') + 'L' + h.line + ': <span class="pv-ctx">' + esc(pre) + '</span><b class="pv-chg">' + esc(midShown) + '</b><span class="pv-ctx">' + esc(post) + '</span></span>';
  }
  function previewHtml(fix, text, full) {
    var hs = hunksFor(fix, text), rows = [], max = full ? hs.length : 3;
    hs.slice(0, max).forEach(function (h) { rows.push(pvRow('del', h, full)); rows.push(pvRow('add', h, full)); });
    if (hs.length > max) rows.push('<span class="pv-note">… ' + (lang() === 'en' ? (hs.length - max) + ' more change' + (hs.length - max === 1 ? '' : 's') + ' (choose Show full diff)' : '바뀐 곳 ' + (hs.length - max) + '곳 더 있어요(전체 차이 보기)') + '</span>');
    if (!hs.length) rows.push('<span class="pv-note">' + (lang() === 'en' ? '(no text change)' : '(글자는 바뀌지 않아요)') + '</span>');
    if (fix.note) rows.push('<span class="pv-note" lang="en">' + (lang() === 'en' ? 'Note: ' : '참고: ') + esc(fix.note) + '</span>');
    return rows.join('');
  }

  function renderProblems() {
    var diags = shown, text = editor.value;
    var ec = 0, wc = 0, ic = 0;
    diags.forEach(function (d) { if (d.severity === 'error') ec++; else if (d.severity === 'warning') wc++; else ic++; });
    var ae = document.activeElement, focusKey = null, focusRole = null;
    if (ae && diagList.contains(ae)) { var li = ae.closest('.prob'); focusKey = li && li.getAttribute('data-key'); focusRole = ae.getAttribute('data-role'); }
    var prevScroll = diagList.scrollTop;
    // toolbar
    var fb = $('prob-toolbar').querySelectorAll('[data-filter]');
    Array.prototype.forEach.call(fb, function (b) {
      var f = b.getAttribute('data-filter'), n = f === 'all' ? diags.length : f === 'error' ? ec : f === 'warning' ? wc : ic;
      b.innerHTML = f === 'all' ? esc(lang() === 'en' ? 'All' : '전체') + ' ' + n : sevIcon(f, 14) + ' ' + n;
      b.setAttribute('aria-pressed', String(filter === f));
      b.setAttribute('aria-label', (f === 'all' ? C_('allProblems') : f === 'error' ? C_('errorsL') : f === 'warning' ? C_('warningsL') : C_('infoL')) + ', ' + n);
    });
    $('btn-fix-all').disabled = !diags.some(function (d) { return d.fix; });
    $('diag-badge').textContent = C_('issues')(diags.length);
    hooks.counts({ errors: ec, warnings: wc, infos: ic, total: diags.length });
    var note = $('prob-note');
    if (analysis.error) { note.hidden = false; note.textContent = C_('scanError') + analysis.error; }
    else if (activeDoc.mode === 'lua') {
      note.hidden = false;
      note.innerHTML = C_('luaNote')(chkLow.checked) + ' <button type="button" id="btn-open-whatif" class="btn-txt">' + esc(C_('changeInTest')) + '</button> <button type="button" id="btn-open-setting" class="btn-txt">' + esc(C_('openSetting')) + '</button>';
    } else note.hidden = true;

    var list = visibleProblems();
    if (!diags.length) {
      var extra = '';
      if (activeDoc.mode === 'cbs') { try { if (literalTagCount(simRun(text.replace(/^@@.*\n?/gm, ''), { vars: {} }))) extra = ' (' + C_('emptyPlus') + ')'; } catch (e) { /* ignore */ } }
      diagList.innerHTML = '<li class="prob-empty"><span class="cnt-none">' + StudioIcon('circle-check', 16) + ' ' + esc(C_('noRules')) + '</span> ' + esc(C_('empty')) + esc(extra) + '</li>';
    } else if (!list.length) {
      diagList.innerHTML = '<li class="prob-empty">' + esc(C_('noMatchFilter')(filter)) + ' <button type="button" class="btn-txt" data-filter-reset="1">' + esc(C_('showAll')) + '</button></li>';
    } else {
      diagList.innerHTML = list.map(function (d, i) {
        var si = sevInfo(d.severity), sel = d.key === selProbKey, line = lineNoAt(text, d.start), title = probTitle(d);
        var label = si.label + ', ' + (lang() === 'en' ? 'line ' + line : line + C_('line')) + ', ' + d.code + ': ' + title + (d.fix ? '. ' + C_('quickFixAvail') + '.' : '.') + (sel ? ' ' + C_('expanded') + '.' : ' ' + C_('pressExpand') + '.');
        var detail = '';
        if (sel) {
          var rule = RULE_BY_CODE[d.code], fullD = !!fullDiffKeys[d.key];
          detail = '<div class="prob-detail" id="pd-' + i + '"><div class="meta"><span class="diag-code">' + esc(d.code) + '</span><span>' + (lang() === 'en' ? 'Line ' + line : line + C_('line')) + '</span></div>' +
            '<p class="msg" lang="en">' + esc(d.msg) + '</p>' +
            (rule ? '<p class="src">' + esc(C_('source')) + ': <code>' + esc(rule[4]) + '</code>' + (rule[5] ? ' &middot; <span lang="en">' + esc(rule[5]) + '</span>' : '') + '</p>' : '') +
            (d.explain ? '<details class="explain"><summary>' + esc(d.explain.label) + '</summary><p lang="en">' + esc(d.explain.text) + '</p></details>' : '') +
            (d.fix ? '<div class="acts"><button type="button" class="diag-fix" data-role="fix" aria-describedby="pv-' + i + '">' + StudioIcon('wand', 14) + ' <span lang="en">' + esc(d.fix.label) + '</span></button><button type="button" data-role="full" aria-pressed="' + fullD + '">' + esc(fullD ? C_('shortDiff') : C_('fullDiff')) + '</button></div><pre class="diag-preview" id="pv-' + i + '" aria-label="' + esc(lang() === 'en' ? 'Preview of the change' : '바뀌는 내용 미리보기') + '">' + previewHtml(d.fix, text, fullD) + '</pre>' : '') +
            '<div class="acts"><button type="button" data-role="show">' + esc(C_('show')) + '</button></div></div>';
        }
        return '<li class="prob ' + d.severity + (sel ? ' sel' : '') + '" data-key="' + esc(d.key) + '"><button type="button" class="prob-row" data-role="row" aria-expanded="' + sel + '"' + (sel ? ' aria-controls="pd-' + i + '"' : '') + ' aria-label="' + esc(label) + '">' +
          '<span class="sevl sev-' + d.severity + '"><span aria-hidden="true">' + sevIcon(d.severity, 14) + '</span> ' + si.label + '</span><span class="ln">L' + line + '</span><span class="ttl" lang="en">' + esc(title) + '</span><span class="fx">' + (d.fix ? '<span aria-hidden="true">' + StudioIcon('wand', 13) + '</span> ' + esc(C_('fix')) : '') + '</span></button>' + detail + '</li>';
      }).join('');
    }
    diagList.scrollTop = prevScroll;
    if (focusKey) {
      var tgt = diagList.querySelector('[data-key="' + focusKey.replace(/"/g, '\\"') + '"] [data-role="' + focusRole + '"]') || diagList.querySelector('[data-key="' + focusKey.replace(/"/g, '\\"') + '"] [data-role="row"]');
      if (tgt && tgt !== document.activeElement) tgt.focus({ preventScroll: true });
    }
  }
  function renderStatus() {
    var ec = 0, wc = 0, ic = 0;
    shown.forEach(function (d) { if (d.severity === 'error') ec++; else if (d.severity === 'warning') wc++; else ic++; });
    $('status-counts').innerHTML = (ec + wc + ic === 0)
      ? '<span class="cnt-none" title="' + esc(lang() === 'en' ? 'The rule scan found nothing. This is not a syntax check.' : '규칙 검사에서 걸린 게 없어요. 문법 검사는 아니에요.') + '">' + StudioIcon('circle-check', 14) + ' ' + esc(C_('noRules')) + '</span>'
      : '<span class="cnt-err" title="' + esc(C_('errorsL')) + '">' + sevIcon('error', 14) + ' ' + ec + '</span><span class="cnt-warn" title="' + esc(C_('warningsL')) + '">' + sevIcon('warning', 14) + ' ' + wc + '</span><span class="cnt-info" title="' + esc(C_('infoL')) + '">' + sevIcon('info', 14) + ' ' + ic + '</span><span class="sr-only">' + (lang() === 'en' ? ec + ' errors, ' + wc + ' warnings, ' + ic + ' info' : '오류 ' + ec + '개, 경고 ' + wc + '개, 정보 ' + ic + '개') + '</span>';
  }

  function chipHtml(cls, text) { return '<span class="chip ' + cls + '" role="listitem">' + text + '</span>'; }
  var chipsSig = '';
  function renderChips() {
    var d = activeDoc, mode = d.mode, diags = analysis.docId === d.id ? analysis.diags : [];
    var ec = 0, wc = 0, ic = 0; diags.forEach(function (x) { if (x.severity === 'error') ec++; else if (x.severity === 'warning') wc++; else ic++; });
    var en = lang() === 'en', chips = [], o = StudioIcon('circle-off', 12), ok = StudioIcon('check', 12);
    if (mode === 'plugin') {
      var hdr = diags.filter(function (x) { return /^PLG-/.test(x.code); }).length, adv = diags.length - hdr;
      chips.push(hdr === 0 ? ['done', ok + ' ' + (en ? 'Header checks passed' : '헤더 검사 통과')] : ['bad', sevIcon('error', 12) + ' ' + (en ? 'Header checks: ' + hdr + ' problem' + (hdr === 1 ? '' : 's') : '헤더 문제 ' + hdr + '개')]);
      chips.push(['neutral', o + ' ' + (en ? 'JavaScript syntax not checked' : '자바스크립트 문법은 검사하지 않아요')], ['neutral', o + ' ' + (en ? 'API checks not run' : 'API 검사는 하지 않았어요')]);
      if (adv) chips.push(['neutral', sevIcon('info', 12) + ' ' + (en ? 'Advisory pattern scan: ' + adv + ' note' + (adv === 1 ? '' : 's') : '참고용 패턴 검사: ' + adv + '건')]);
    } else {
      chips.push(ec + wc + ic === 0 ? ['neutral', o + ' ' + (en ? 'Rule scan: no matches (' + (mode === 'lua' ? 'syntax not checked' : 'real parser not run') + ')' : '규칙 검사: 일치 없음(' + (mode === 'lua' ? '문법은 검사하지 않아요' : '실제 파서는 실행하지 않았어요') + ')')]
        : [ec ? 'bad' : wc ? 'warn' : '', (ec ? sevIcon('error', 12) : wc ? sevIcon('warning', 12) : sevIcon('info', 12)) + ' ' + (en ? 'Rule scan: ' + ec + ' error' + (ec === 1 ? '' : 's') + ', ' + wc + ' warning' + (wc === 1 ? '' : 's') + ', ' + ic + ' info' : '규칙 검사: 오류 ' + ec + '개, 경고 ' + wc + '개, 정보 ' + ic + '개')]);
      if (mode === 'lua') chips.push(['neutral', o + ' ' + (en ? 'Lua syntax not checked' : '루아 문법은 검사하지 않아요')], ['neutral', o + ' ' + (en ? 'API checks not run' : 'API 검사는 하지 않았어요')]);
      else chips.push(['neutral', o + ' ' + (en ? 'Real CBS parser not run' : '실제 CBS 파서는 실행하지 않았어요')]);
    }
    if (!d.checked) chips.push(['neutral', o + ' ' + (en ? 'Check not run' : '아직 검사하지 않았어요')]);
    else if (d.checked.rev === d.rev) chips.push(['done', ok + ' ' + (en ? 'Checked · ' + d.checked.errors + ' errors' : '검사함 · 오류 ' + d.checked.errors + '개') + (d.checked.assume !== d.realLow ? ' · ' + (en ? 'assumes low-level ' + (d.checked.assume ? 'on' : 'off') : '낮은 수준 접근 ' + (d.checked.assume ? '켜짐' : '꺼짐') + ' 가정') : '')]);
    else chips.push(['stale', StudioIcon('triangle-alert', 12) + ' ' + (en ? 'Check out of date (revision ' + d.checked.rev + ', now ' + d.rev + ')' : '검사 이후 내용이 바뀌었어요(판 ' + d.checked.rev + ' → ' + d.rev + ')')]);
    if (!d.tested) chips.push(['neutral', o + ' ' + (en ? 'Test not run' : '아직 시험하지 않았어요')]);
    else if (testIsCurrent(d)) chips.push([d.tested.status && d.tested.status !== 'normal' ? (d.tested.status === 'stopped' ? 'warn' : 'bad') : '', (en ? 'Simulated test' + ({ thrown: ' threw an error', timeout: ' timed out', stopped: ' stopped', diag: ' showed diagnostics' }[d.tested.status] || '') + ': revision ' + d.tested.rev + ' · current' : '시험(가상)' + ({ thrown: ' 오류', timeout: ' 시간 초과', stopped: ' 중지', diag: ' 진단' }[d.tested.status] || '') + ' · 판 ' + d.tested.rev + ' · 최신')]);
    else chips.push(['stale', StudioIcon('triangle-alert', 12) + ' ' + (en ? 'Test out of date (revision ' + d.tested.rev + ', now ' + d.rev + ')' : '시험 이후 내용이 바뀌었어요(판 ' + d.tested.rev + ' → ' + d.rev + ')')]);
    var html = chips.map(function (c) { return chipHtml(c[0], c[1]); }).join('');
    var sig = d.id + '|' + lang() + '|' + html;
    if (sig !== chipsSig) { chipsSig = sig; $('check-chips').innerHTML = html; }
  }

  // ---- document header: the shell owns the visible header and status now; this only tells it something changed -------
  function renderDocHeader() { hooks.header(activeDoc, isModified(activeDoc)); }

  // ---- test pane (named revision, stale marker, simulated) -------------------------------------------------------------
  function varsSig() { var s = []; document.querySelectorAll('[data-var]').forEach(function (i) { s.push(i.value); }); return s.join('\u0001'); }
  function testIsCurrent(d) { return !!d.tested && d.tested.rev === d.rev && d.tested.sig === (d.mode === 'cbs' ? varsSig() : '') && d.tested.assume === chkLow.checked; }
  function buildTestOutput(d, text) {
    var vars = {}, body, note, sub, title, en = lang() === 'en';
    document.querySelectorAll('[data-var]').forEach(function (inp) { vars[inp.getAttribute('data-var')] = inp.value; });
    if (d.mode === 'cbs') {
      title = en ? 'Test · simulated output' : '시험 · 시뮬레이션 출력'; sub = en ? 'port of the parser loop' : '파서 반복문 이식';
      var out; try { out = simRun(text.replace(/^@@.*\n?/gm, ''), { vars: vars }); } catch (e) { out = '[simulator error] ' + e.message; }
      body = out === '' ? (en ? '(empty)' : '(비어 있음)') : out;
      var lit = literalTagCount(out);
      note = (lit ? lit + (en ? ' tag(s) are still printed literally in this output (unresolved or unsimulated tags). ' : '개의 태그가 그대로 출력돼요(해석되지 않았거나 시뮬레이션하지 않은 태그). ') : '') + (en ? 'Synthetic variables. Runs the block/else/each/func logic of parser.svelte.ts and a small macro subset; other macros stay literal. Decorator lines are stripped.' : '가상 변수예요. 블록/else/each/func 논리와 일부 매크로만 시뮬레이션하고 나머지는 그대로 남아요. 데코레이터 줄은 빼요.');
    } else if (d.mode === 'lua') {
      title = en ? 'Test · static summary' : '시험 · 정적 요약'; sub = en ? 'Lua is not executed' : '루아는 실행하지 않아요';
      var clean = sanitizeLua(text), entries = [];
      ['onStart', 'onInput', 'onOutput', 'onButtonClick'].forEach(function (en2) { if (new RegExp('(function\\s+' + en2 + '\\b|\\b' + en2 + '\\s*=)').test(clean)) entries.push(en2); });
      var listen = (clean.match(/listenEdit\s*\(/g) || []).length;
      var used = Object.keys(LUA_LOWLEVEL).filter(function (k) { return new RegExp('(^|[^.:\\w])' + k + '\\s*\\(').test(clean); });
      body = en ? 'Entry points: ' + (entries.length ? entries.join(', ') : 'none') + (listen ? '\nlistenEdit callbacks: ' + listen : '') +
        '\nLow-level bindings used: ' + (used.length ? used.join(', ') : 'none') + '\nlowLevelAccess (simulated what-if): ' + (chkLow.checked ? 'on' : 'off') + '\nLua syntax: not checked\nAPI checks: not run'
        : '진입점: ' + (entries.length ? entries.join(', ') : '없음') + (listen ? '\nlistenEdit 콜백: ' + listen + '개' : '') + '\n사용한 낮은 수준 함수: ' + (used.length ? used.join(', ') : '없음') +
        '\n낮은 수준 접근(가정): ' + (chkLow.checked ? '켜짐' : '꺼짐') + '\n루아 문법: 검사하지 않았어요\nAPI 검사: 하지 않았어요';
      note = en ? 'Nothing is executed. In the app the lowLevelAccess grant belongs to the character or module and prompts on import.' : '아무것도 실행하지 않아요. 앱에서는 낮은 수준 접근 권한이 캐릭터나 모듈에 속하고, 가져올 때 물어봐요.';
    } else {
      title = en ? 'Test · parsed header' : '시험 · 헤더 해석'; sub = en ? 'mirror of parsePluginHeader' : 'parsePluginHeader 미러';
      var h = (analysis.docId === d.id && analysis.rev === d.rev && analysis.header) || parseHeaderMirror(text);
      body = en ? 'name: ' + (h.name || '(missing)') + '\ndisplay-name: ' + (h.displayName || '-') + '\napi: ' + h.api + (h.api === '3.0' ? '' : '  (refused on install)') + '\nplugin version: ' + (h.version || '-') +
        '\nargs: ' + (h.args.length ? h.args.join(', ') : '-') + '\nlinks: ' + (h.links.length ? h.links.join(', ') : '-') + '\nupdate-url: ' + (h.updateUrl || '-') +
        '\n\nHeader checks: ' + (h.problems.length === 0 && h.api === '3.0' ? 'passed' : h.problems.length + ' problem(s)') + '\nJavaScript syntax: not checked\nAPI checks: not run\n(the plugin code is never run here)'
        : '이름: ' + (h.name || '(없음)') + '\n표시 이름: ' + (h.displayName || '-') + '\nAPI: ' + h.api + (h.api === '3.0' ? '' : '  (설치할 때 거부돼요)') + '\n플러그인 버전: ' + (h.version || '-') +
        '\n인자: ' + (h.args.length ? h.args.join(', ') : '-') + '\n링크: ' + (h.links.length ? h.links.join(', ') : '-') + '\n업데이트 주소: ' + (h.updateUrl || '-') +
        '\n\n헤더 검사: ' + (h.problems.length === 0 && h.api === '3.0' ? '통과' : '문제 ' + h.problems.length + '개') + '\n자바스크립트 문법: 검사하지 않았어요\nAPI 검사: 하지 않았어요\n(플러그인 코드는 여기서 실행하지 않아요)';
      note = en ? 'Script contents are only scanned for advisory patterns. A passing header says nothing about whether the code runs.' : '스크립트 내용은 참고용 패턴만 훑어요. 헤더가 통과해도 코드가 돈다는 뜻은 아니에요.';
    }
    return { title: title, sub: sub, body: body, note: note };
  }
  function whenText(at) { var s = Math.max(0, Math.round((Date.now() - at.getTime()) / 1000)); if (s < 15) return lang() === 'en' ? 'just now' : '방금'; if (s < 90) return lang() === 'en' ? s + ' s ago' : s + '초 전'; var m = Math.round(s / 60); return lang() === 'en' ? m + ' min ago' : m + '분 전'; }
  function renderTestPanel() {
    var d = activeDoc, t = d.tested, en = lang() === 'en';
    lowWrap.hidden = d.mode !== 'lua'; $('var-grid').hidden = d.mode !== 'cbs';
    var meta = $('test-meta'), cur = testIsCurrent(d);
    var base = { cbs: ['Test · simulated output', 'port of the parser loop'], lua: [en ? 'Test · static summary' : '시험 · 정적 요약', en ? 'Lua is not executed' : '루아는 실행하지 않아요'], plugin: [en ? 'Test · parsed header' : '시험 · 헤더 해석', en ? 'mirror of parsePluginHeader' : 'parsePluginHeader 미러'] }[d.mode];
    $('sim-title').textContent = t ? t.title : base[0]; $('sim-sub').textContent = t ? t.sub : base[1];
    if (!t) {
      meta.className = 'test-meta'; meta.textContent = en ? 'Not run yet. Choose Run to produce a simulated result.' : '아직 실행하지 않았어요. 실행을 누르면 가상 결과가 나와요.';
      previewOut.className = 'preview-out'; previewOut.textContent = en ? '(no result yet)' : '(아직 결과가 없어요)'; $('sim-note').textContent = '';
    } else {
      var basis = t.basis === 'draft' ? (en ? 'based on the draft' : '초안 기준') : (en ? 'based on the applied version' : '적용된 버전 기준');
      meta.className = 'test-meta ' + (cur ? 'current' : 'stale');
      meta.textContent = cur ? (en ? 'Result · ' : '결과 · ') + whenText(t.at) + ' · ' + basis : (en ? 'Based on earlier content · result is for revision ' + t.rev + ', now ' + d.rev + '. Run again.' : '이전 내용 기준 · 결과는 판 ' + t.rev + '의 것이고 지금은 판 ' + d.rev + '이에요. 다시 실행해 주세요.');
      previewOut.className = 'preview-out' + (cur ? '' : ' stale'); previewOut.textContent = t.body; $('sim-note').textContent = t.note;
    }
    $('test-scope').textContent = (en ? 'Scope: ' : '범위: ') + d.title + ' · ' + ({ lua: en ? 'Lua script' : '루아 스크립트', plugin: en ? 'Plugin code' : '플러그인 코드', cbs: 'CBS' }[d.mode]) + ' · ' + (en ? 'nothing is executed' : '실행하지 않아요');
    renderTestExtras(d);
  }
  function doTest() {
    var d = activeDoc;
    if (testRun) return;
    if ($('sel-outcome').value !== 'normal') { simTest($('sel-outcome').value); return; }
    if (analysisPending) analyzeNow();
    var r = buildTestOutput(d, editor.value);
    d.tested = { rev: d.rev, at: new Date(), sig: d.mode === 'cbs' ? varsSig() : '', assume: chkLow.checked, basis: isModified(d) ? 'draft' : 'live', title: r.title, sub: r.sub, body: r.body, note: r.note };
    renderTestPanel(); renderChips();
    announce('Simulated test finished for revision ' + d.rev + '. Nothing was executed.');
    hooks.tested(d);
  }
  // PORT: Check also records the what-if assumption it ran under; Apply (shell) only accepts a stamp made under the owner's real setting.
  function doCheck() {
    var d = activeDoc;
    analyzeNow();
    var ec = 0, wc = 0, ic = 0; analysis.diags.forEach(function (x) { if (x.severity === 'error') ec++; else if (x.severity === 'warning') wc++; else ic++; });
    d.checked = { rev: d.rev, at: new Date(), errors: ec, warnings: wc, infos: ic, assume: chkLow.checked, codes: analysis.diags.filter(function (x) { return x.severity !== 'info'; }).map(function (x) { return x.code; }) };
    renderChips(); renderDocHeader();
    announce('Check finished for revision ' + d.rev + ': ' + (ec + wc + ic === 0 ? 'no rule matches.' : ec + ' errors, ' + wc + ' warnings, ' + ic + ' info.') + (d.mode === 'plugin' ? ' JavaScript syntax and API checks were not run.' : ''));
    hooks.check(d, d.checked);
    return d.checked;
  }


  /* ==== ORIGINAL studio.html lines 2716-2776 : fixes, problem navigation ==== */
  // ---- fixes (always previewed, one history entry each) ---------------------------------------------------------------
  function afterFixSummary() { return analysis.diags.length ? analysis.diags.length + ' rule match(es) remain.' : 'No rule matches remain.'; }
  function applyFix(d) {
    if (!d || !d.fix) return false;
    var before = editor.value, after = applyEdits(before, d.fix.edits);
    if (after === before) return false;
    var first = d.fix.edits.slice().sort(function (a, b) { return a.start - b.start; })[0];
    var ok = runEdit('Fix: ' + d.fix.label, after, first.start, first.start + first.text.length, { noAnnounce: true });
    if (ok) showToast('Applied: ' + d.fix.label + '. ' + afterFixSummary(), true);
    return ok;
  }
  function applyAllFixes() {
    if (analysisPending) analyzeNow();
    var start = editor.value, text = start, applied = 0, skip = new Set(), firstPos = null, diags = analysis.diags;
    for (var guard = 0; guard < 40; guard++) {
      var d = diags.find(function (x) { return x.fix && !skip.has(x.code + ':' + x.fix.label); });
      if (!d) break;
      var after = applyEdits(text, d.fix.edits);          // text edits only; permissions are never changed here
      if (after === text) { skip.add(d.code + ':' + d.fix.label); continue; }
      if (firstPos === null) firstPos = d.fix.edits.slice().sort(function (a, b) { return a.start - b.start; })[0].start;
      text = after; applied++;
      diags = runLintFor(activeDoc.mode, text, chkLow.checked).diags.slice().sort(function (a, b) { return a.start - b.start; });
    }
    if (!applied) { showToast('No quick fixes available.', false); return; }
    runEdit('Apply all quick fixes (' + applied + ')', text, firstPos, firstPos, { noAnnounce: true });
    showToast('Applied ' + applied + ' quick fix' + (applied === 1 ? '' : 'es') + ' as one undoable step. ' + afterFixSummary(), true);
  }

  // ---- problem navigation ------------------------------------------------------------------------------------------------
  function selectDiag(d, focusEditor) {
    hooks.showEditor();
    var s = d.start, e = Math.max(d.end, d.start);
    editor.setSelectionRange(s, e);
    if (focusEditor) { editor.focus({ preventScroll: true }); editor.setSelectionRange(s, e); }
    renderDisplay();
    var m = revealRange(s, e, false);
    cursorInfo();
    announce('Line ' + m.line + ': ' + d.code + ', ' + probTitle(d) + '.');
  }
  function stepProblem(dir, focusEditor) {
    if (analysisPending) analyzeNow();
    var list = visibleProblems();
    if (!list.length) { announce('No problems to move to.'); return; }
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].key === selProbKey) idx = i;
    if (idx >= 0) idx = (idx + dir + list.length) % list.length;
    else {
      var p = dir > 0 ? editor.selectionEnd : editor.selectionStart;
      if (dir > 0) { idx = 0; for (var a = 0; a < list.length; a++) if (list[a].start >= p) { idx = a; break; } }
      else { idx = list.length - 1; for (var b = list.length - 1; b >= 0; b--) if (list[b].start < p) { idx = b; break; } }
    }
    var d = list[idx];
    selProbKey = d.key;
    renderProblems();
    var li = diagList.querySelector('[data-key="' + d.key.replace(/"/g, '\\"') + '"]');
    if (li) { var top = li.offsetTop - diagList.offsetTop; if (top < diagList.scrollTop || top + li.offsetHeight > diagList.scrollTop + diagList.clientHeight) diagList.scrollTop = Math.max(0, top - 6); }
    selectDiag(d, focusEditor !== false);
    announce('Problem ' + (idx + 1) + ' of ' + list.length + '. ' + sevInfo(d.severity).label + ', line ' + lineNoAt(editor.value, d.start) + ', ' + d.code + ', ' + probTitle(d) + (d.fix ? '. Quick fix available.' : '.'));
  }


  /* ==== ORIGINAL studio.html lines 2785-3171 : structural editing, completion, find/replace, go to line ==== */
  // ==========================================================================
  // 11. Structural editing (ST-02): indent, Enter, closer dedent, smart Backspace
  // ==========================================================================
  var tabMoves = false, tabArmed = false;
  function setTabHint() {
    var h = $('tab-hint');
    h.className = 'tab-hint hide-narrow' + (tabArmed ? ' armed' : '');
    h.innerHTML = lang() === 'en' ? (tabMoves ? 'Tab moves focus (change with the Tab button)' : tabArmed ? '<kbd>Tab</kbd> now moves focus out of the editor' : '<kbd>Esc</kbd> then <kbd>Tab</kbd> leaves the editor') : (tabMoves ? 'Tab이 포커스를 옮겨요(Tab 버튼으로 바꿔요)' : tabArmed ? '지금 <kbd>Tab</kbd>은 편집기 밖으로 나가요' : '<kbd>Esc</kbd> 다음 <kbd>Tab</kbd>으로 편집기를 벗어나요');
    var b = $('btn-tabmode'); b.setAttribute('aria-pressed', String(tabMoves)); b.textContent = lang() === 'en' ? (tabMoves ? 'Tab: moves focus' : 'Tab: indents') : (tabMoves ? 'Tab: 이동' : 'Tab: 들여쓰기');
  }
  function blockLines(v, s, e) {
    var first = lineStartOf(v, s), lastRef = (e > s && v.charCodeAt(e - 1) === 10) ? e - 1 : e;
    var lastEnd = lineEndOf(v, lastRef), starts = [], p = first;
    for (;;) { starts.push(p); var nl = v.indexOf('\n', p); if (nl === -1 || nl >= lastEnd) break; p = nl + 1; }
    return starts;
  }
  function changeIndent(dir) {
    var v = editor.value, s = editor.selectionStart, e = editor.selectionEnd, unit = indentUnit(), edits = [];
    var starts = blockLines(v, s, e);
    starts.forEach(function (ls) {
      var le = lineEndOf(v, ls);
      if (dir > 0) { if (le > ls || starts.length === 1) edits.push({ start: ls, end: ls, text: unit }); }
      else {
        var m = v.charAt(ls) === '\t' ? 1 : /^ */.exec(v.slice(ls, le))[0].length;
        var r = v.charAt(ls) === '\t' ? 1 : Math.min(m, indent.width);
        if (r > 0) edits.push({ start: ls, end: ls + r, text: '' });
      }
    });
    if (!edits.length) { announce(dir > 0 ? 'Nothing to indent.' : 'Nothing to outdent.'); editor.focus({ preventScroll: true }); return false; }
    var ns = mapPos(s, edits, s === e ? 'right' : 'left'), ne = mapPos(e, edits, 'right');
    var lines = starts.length;
    return runEdit(dir > 0 ? 'Indent ' + lines + ' line' + (lines === 1 ? '' : 's') : 'Outdent ' + lines + ' line' + (lines === 1 ? '' : 's'), applyEdits(v, edits), ns, ne, { say: (dir > 0 ? 'Indented ' : 'Outdented ') + lines + ' line' + (lines === 1 ? '' : 's') + '.' });
  }
  function tabKey() {
    var v = editor.value, s = editor.selectionStart, e = editor.selectionEnd;
    if (s !== e) return changeIndent(1);                       // selection (one line or many): indent the lines
    var ls = lineStartOf(v, s), col = s - ls, ins;
    if (indent.mode === 'tab') ins = '\t'; else { var n = indent.width - (col % indent.width); ins = new Array(n + 1).join(' '); }
    return runEdit('Indent', v.slice(0, s) + ins + v.slice(e), s + ins.length, s + ins.length, { kind: 'type', say: 'Inserted indentation.', noAnnounce: true });
  }
  // Does this line (the text before the caret) open a block? mode-aware, comments and strings ignored.
  function stripComments(mode, line) {
    if (mode === 'cbs') return line;
    var toks = scanFor(mode, line), out = '';
    toks.forEach(function (t) { if (t.t === 'code' || t.t === 'str') out += line.slice(t.s, t.e); else out += ' '; });
    return out;
  }
  function cbsLastTag(line) {
    var depth = 0, start = -1, last = null, i = 0;
    while (i < line.length) {
      if (line.startsWith('{{', i)) { if (depth === 0) start = i; depth++; i += 2; continue; }
      if (line.startsWith('}}', i) && depth > 0) { depth--; i += 2; if (depth === 0) last = { s: start, e: i }; continue; }
      i++;
    }
    return last;
  }
  function isOpener(mode, before) {
    var code = stripComments(mode, before).replace(/\s+$/, '');
    if (!code.trim()) return false;
    if (mode === 'cbs') {
      var t = cbsLastTag(code);
      if (!t || t.e !== code.length) return false;
      return /^\{\{(#(when|if|if_pure|each|func|pure|puredisplay|pure_display|escape|code)\b|:else\}\})/.test(code.slice(t.s));
    }
    if (mode === 'lua') {
      if (/\b(then|do|else|repeat)$/.test(code)) return true;
      var fi = code.search(/\bfunction\b/);
      if (fi !== -1 && /\)$/.test(code) && !/\bend\b/.test(code.slice(fi))) return true;
      return /[{(\[]$/.test(code);
    }
    return /([{(\[]|=>)$/.test(code);
  }
  function startsWithCloser(mode, after) {
    var a = after.replace(/^[ \t]+/, '');
    if (mode === 'cbs') return /^\{\{(\/|:else\}\})/.test(a);
    if (mode === 'lua') return /^(end\b|until\b|else\b|elseif\b|[}\])])/.test(a);
    return /^[}\])]/.test(a);
  }
  function enterKey() {
    var v = editor.value, s = editor.selectionStart, e = editor.selectionEnd, mode = activeDoc.mode;
    var ls = lineStartOf(v, s), before = v.slice(ls, s), after = v.slice(e, lineEndOf(v, e));
    var base = /^[ \t]*/.exec(before)[0], unit = indentUnit(), opener = isOpener(mode, before), inner = base + (opener ? unit : '');
    var ins, caret;
    if (opener && startsWithCloser(mode, after)) {
      var ws = /^[ \t]*/.exec(after)[0].length;
      ins = '\n' + inner + '\n' + base; caret = s + 1 + inner.length;
      return runEdit('New line', v.slice(0, s) + ins + v.slice(e + ws), caret, caret, { kind: 'type', noAnnounce: true });
    }
    ins = '\n' + inner; caret = s + ins.length;
    return runEdit('New line', v.slice(0, s) + ins + v.slice(e), caret, caret, { kind: 'type', noAnnounce: true });
  }
  function backspaceKey() {
    var v = editor.value, s = editor.selectionStart, e = editor.selectionEnd;
    if (s !== e || s === 0 || indent.mode === 'tab') return false;
    var ls = lineStartOf(v, s), before = v.slice(ls, s);
    if (!/^ {2,}$/.test(before)) return false;                 // a single space: normal Backspace
    var n = before.length % indent.width || indent.width;
    if (n < 2) return false;
    return runEdit('Remove indentation', v.slice(0, s - n) + v.slice(s), s - n, s - n, { kind: 'type', noAnnounce: true });
  }
  var lastDedent = null;
  // Typing a closer as the first token of a line moves it back to its opener's level (only if it is still at body level).
  function maybeDedent(ch) {
    var mode = activeDoc.mode, v = editor.value, p = editor.selectionStart;
    if (editor.selectionEnd !== p) return;
    var ls = lineStartOf(v, p), before = v.slice(ls, p), m = /^([ \t]*)(\S.*)$/.exec(before);
    if (!m) return;
    var ind = m[1], body = m[2], trig = false;
    if (!ind.length) return;
    if (mode === 'cbs') trig = ch === '}' && /^\{\{(\/[A-Za-z_]*|:else)\}\}$/.test(body);
    else if (mode === 'lua') trig = /^(end|until|else|elseif)$/.test(body) || (body === ch && /[}\])]/.test(ch));
    else trig = body === ch && /[}\])]/.test(ch);
    if (!trig) return;
    if (lastDedent && lastDedent.ls === ls && lastDedent.after === ind) return;
    var prevInd = '', q = ls;                                    // indentation of the previous non-empty line
    while (q > 0) { var ps = lineStartOf(v, q - 1), pl = v.slice(ps, q - 1); if (pl.trim()) { prevInd = /^[ \t]*/.exec(pl)[0]; break; } q = ps; }
    if (ind.length < prevInd.length) return;                     // hand-aligned already
    var cut = ind.charAt(ind.length - 1) === '\t' ? 1 : Math.min(indent.width, ind.length);
    var nind = ind.slice(0, ind.length - cut);
    editor.setRangeText(nind, ls, ls + ind.length, 'preserve');
    var np = p - cut; editor.setSelectionRange(np, np);
    lastDedent = { ls: ls, after: nind };
  }

  // ==========================================================================
  // 12. Completion at the caret (ST-04)
  // ==========================================================================
  function C(g, l, ins, sig, doc, kind) { return { g: g, l: l, ins: ins, sig: sig, doc: doc, kind: kind || '' }; }
  var DEC_COMPLETIONS = Array.from(DECORATORS).map(function (n) { return C('d', '@@' + n, '@@' + n + (INT_DECORATORS.has(n) ? ' $1' : ''), '@@' + n + (INT_DECORATORS.has(n) ? ' <number>' : ''), 'Lorebook decorator handled in lorebook.svelte.ts.', 'decorator'); });
  var COMPLETIONS = {
    cbs: [
      C('m', 'getvar', '{{getvar::$1}}', '{{getvar::name}}', 'Reads a chat variable ("null" when unset).', 'macro'),
      C('m', 'setvar', '{{setvar::$1::$0}}', '{{setvar::name::value}}', 'Writes a chat variable. The preview simulator does not run it.', 'macro'),
      C('m', 'addvar', '{{addvar::$1::$0}}', '{{addvar::name::amount}}', 'Adds a number to a chat variable.', 'macro'),
      C('m', 'getglobalvar', '{{getglobalvar::$1}}', '{{getglobalvar::name}}', 'Reads a global variable (toggles use the toggle_ prefix).', 'macro'),
      C('m', 'greater', '{{greater::$1::$0}}', '{{greater::a::b}}', '1 when a is greater than b, otherwise 0.', 'macro'),
      C('m', 'less', '{{less::$1::$0}}', '{{less::a::b}}', '1 when a is less than b, otherwise 0.', 'macro'),
      C('m', 'equal', '{{equal::$1::$0}}', '{{equal::a::b}}', '1 when a equals b, otherwise 0.', 'macro'),
      C('m', 'and', '{{and::$1::$0}}', '{{and::a::b}}', '1 when both are truthy.', 'macro'),
      C('m', 'or', '{{or::$1::$0}}', '{{or::a::b}}', '1 when either is truthy.', 'macro'),
      C('m', 'not', '{{not::$1}}', '{{not::a}}', 'Negates a truthy value.', 'macro'),
      C('m', 'calc', '{{calc::$1}}', '{{calc::expression}}', 'Evaluates a numeric expression.', 'macro'),
      C('m', 'char', '{{char}}', '{{char}}', 'The character name.', 'macro'),
      C('m', 'user', '{{user}}', '{{user}}', 'The user name.', 'macro'),
      C('m', 'random', '{{random:$1}}', '{{random:a,b,c}}', 'Picks one item; the single-colon form is the usual style.', 'macro'),
      C('m', 'slot', '{{slot::$1}}', '{{slot::item}}', 'The current #each item; use the loop variable name.', 'macro'),
      C('m', 'arg', '{{arg::$1}}', '{{arg::1}}', 'Function argument. arg::0 is the function name; parameters start at 1.', 'macro'),
      C('m', 'call', '{{call::$1}}', '{{call::name::arg1::arg2}}', 'Calls a {{#func}} defined earlier.', 'macro'),
      C('m', '#when', '{{#when::$1}}\n\u0001$0\n{{/when}}', '{{#when::X::vis::value}}...{{/when}}', 'Block conditional; {{:else}} must be alone on its line.', 'block'),
      C('m', '#each', '{{#each $1 as item}}{{slot::item}}{{/each}}', '{{#each list as item}}...{{/each}}', 'Loops over a JSON array or a section-sign delimited list.', 'block'),
      C('m', '#func', '{{#func $1 a b}}\n\u0001$0\n{{/func}}', '{{#func name a b}}...{{/func}}', 'Defines a callable block.', 'block'),
      C('m', ':else', '{{:else}}', '{{:else}}', 'Else branch of a multi-line #when.', 'block'),
      C('m', '/when', '{{/when}}', '{{/when}}', 'Closes a #when block.', 'block'),
      C('m', '/each', '{{/each}}', '{{/each}}', 'Closes an #each block.', 'block'),
      C('m', '/func', '{{/func}}', '{{/func}}', 'Closes a #func block.', 'block')
    ].concat(DEC_COMPLETIONS),
    lua: [
      C('c', 'getChatVar', 'getChatVar(triggerId, "$1")', 'getChatVar(triggerId, key)', 'Reads a chat variable ("null" when unset). No access check.', 'api'),
      C('c', 'setChatVar', 'setChatVar(triggerId, "$1", "$0")', 'setChatVar(triggerId, key, value)', 'Writes a chat variable.', 'api'),
      C('c', 'simpleLLM', 'simpleLLM(triggerId, "$1"):await()', 'simpleLLM(triggerId, prompt):await()', 'Returns { success, result }. Needs lowLevelAccess.', 'api'),
      C('c', 'LLM', 'LLM(triggerId, {{role = "user", content = "$1"}})', 'LLM(triggerId, messages)', 'Shim that awaits internally; do not add :await(). Needs lowLevelAccess and async().', 'api'),
      C('c', 'axLLM', 'axLLM(triggerId, {{role = "user", content = "$1"}})', 'axLLM(triggerId, messages)', 'Auxiliary-model shim; awaits internally. Needs lowLevelAccess.', 'api'),
      C('c', 'similarity', 'similarity(triggerId, "$1", {"a", "b"}):await()', 'similarity(triggerId, query, candidates):await()', 'Embedding similarity. Needs lowLevelAccess.', 'api'),
      C('c', 'listenEdit', 'listenEdit("editOutput", function(id, content, meta)\n\u0001$0\n\u0001return content\nend)', 'listenEdit(mode, function(id, content, meta) ... end)', 'Edit listeners always run with lowLevelAccess off.', 'api'),
      C('c', 'async', 'async(function(triggerId)\n\u0001$0\nend)', 'async(function(triggerId) ... end)', 'Gives the handler a coroutine so :await() can run.', 'api'),
      C('c', 'function', 'function $1()\n\u0001$0\nend', 'function name() ... end', 'Lua function.', 'keyword'),
      C('c', 'if', 'if $1 then\n\u0001$0\nend', 'if cond then ... end', 'Conditional.', 'keyword'),
      C('c', 'local', 'local $1 = $0', 'local name = value', 'Local variable.', 'keyword'),
      C('c', 'onOutput', 'onOutput = async(function(triggerId)\n\u0001$0\nend)', 'onOutput = async(function(triggerId) ... end)', 'Trigger entry point run after the model output.', 'api')
    ],
    plugin: [
      C('h', '//@name', '//@name $1', '//@name plugin_id', 'Required. Plugin id; the line must start at column 0.', 'header'),
      C('h', '//@display-name', '//@display-name $1', '//@display-name Title', 'Optional display name.', 'header'),
      C('h', '//@api', '//@api 3.0', '//@api 3.0', 'API version header. Without it the plugin is read as API 2.0 and refused.', 'header'),
      C('h', '//@version', '//@version 1.0.0', '//@version 1.0.0', 'The plugin\'s own version (not the API version).', 'header'),
      C('h', '//@arg', '//@arg $1 string', '//@arg name string|int', 'Declares a user argument. Type must be int or string.', 'header'),
      C('h', '//@link', '//@link https://$1 Label', '//@link https://host/path Label', 'Documentation link; must be https.', 'header'),
      C('h', '//@update-url', '//@update-url https://$1', '//@update-url https://host/plugin.js', 'Needs a //@version line.', 'header'),
      C('c', 'risuai.getArgument', 'risuai.getArgument("$1")', 'await risuai.getArgument(key)', 'Reads a declared //@arg value.', 'api'),
      C('c', 'risuai.log', 'risuai.log($1)', 'await risuai.log(value)', 'Writes to the plugin log.', 'api'),
      C('c', 'risuai.registerSetting', 'risuai.registerSetting("$1", async () => {\n\u0001$0\n}, "", "html", "")', 'await risuai.registerSetting(name, open, icon, kind, id)', 'Adds a settings entry.', 'api'),
      C('c', 'risuai.addRisuScriptHandler', 'risuai.addRisuScriptHandler("display", async (text) => {\n\u0001return text;\n})', 'await risuai.addRisuScriptHandler(mode, handler)', 'Modes: display, output, input, process.', 'api'),
      C('c', 'risuai.registerMCP', 'risuai.registerMCP({ identifier: "plugin:$1", name: "", version: "1.0.0", description: "" }, async () => [], async (tool, args) => [])', 'await risuai.registerMCP(info, listTools, callTool)', 'identifier, name, version and description are all required.', 'api'),
      C('c', 'const', 'const $1 = $0;', 'const name = value;', 'Constant.', 'keyword'),
      C('c', 'await', 'await $0', 'await expr', 'Await a promise.', 'keyword'),
      C('c', 'async', 'async () => {\n\u0001$0\n}', 'async () => { ... }', 'Async arrow function.', 'keyword')
    ]
  };
  var ac = { open: false, items: [], active: 0, ctx: null }, autoComplete = true;
  // Where is the caret and what has been typed so far? null = no completion context.
  function complContext(explicit) {
    var d = activeDoc, mode = d.mode, v = editor.value, p = editor.selectionStart;
    if (editor.selectionEnd !== p) return null;
    var ls = lineStartOf(v, p), before = v.slice(ls, p), m;
    if (mode === 'cbs') {
      if ((m = /\{\{([#:\/]?[A-Za-z0-9_?\/-]*)$/.exec(before))) return { kind: 'macro', start: ls + m.index, end: p, prefix: m[1], g: 'm' };
      if ((m = /^(\s*)(@@[A-Za-z_]*)$/.exec(before))) return { kind: 'decorator', start: ls + m[1].length, end: p, prefix: m[2], g: 'd' };
    } else {
      if (mode === 'plugin' && (m = /^(\/\/@[A-Za-z-]*)$/.exec(before))) return { kind: 'header', start: ls, end: p, prefix: m[1], g: 'h' };
      var toks = scanFor(mode, v), cx = ctxAtOffset(toks, p);
      if (cx !== 'code' && !explicit) return null;                   // no API completion inside strings or comments unless asked
      if ((m = /([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]*)*)$/.exec(before)) && before.charAt(before.length - m[1].length - 1) !== ':') {
        if (m[1].length >= 3 || explicit) return { kind: 'word', start: p - m[1].length, end: p, prefix: m[1], g: 'c' };
      }
    }
    if (explicit) return { kind: 'any', start: p, end: p, prefix: '', g: null };
    return null;
  }
  function filterCompletions(ctx) {
    var list = COMPLETIONS[activeDoc.mode].filter(function (it) { return !ctx.g || it.g === ctx.g; });
    var pre = ctx.prefix.toLowerCase(), starts = [], inc = [];
    list.forEach(function (it) {
      var l = it.l.toLowerCase();
      if (!pre || l.indexOf(pre) === 0) starts.push(it);
      else if (pre.length >= 2 && /^[a-z]/.test(pre) && l.indexOf(pre) !== -1) inc.push(it);
    });
    return starts.concat(inc).slice(0, 14);
  }
  function expandTemplate(tpl, base) {
    var out = '', caret = -1, caret0 = -1, unit = indentUnit();
    for (var i = 0; i < tpl.length; i++) {
      var ch = tpl.charAt(i);
      if (ch === '$' && /[0-9]/.test(tpl.charAt(i + 1))) { var nn = tpl.charAt(i + 1); if (nn === '1' && caret < 0) caret = out.length; if (nn === '0' && caret0 < 0) caret0 = out.length; i++; continue; }
      if (ch === '\n') { out += '\n' + base; continue; }
      if (ch === '\u0001') { out += unit; continue; }
      out += ch;
    }
    return { text: out, caret: caret >= 0 ? caret : caret0 >= 0 ? caret0 : out.length };
  }
  function renderCompletion() {
    var list = $('ac-list');
    list.innerHTML = ac.items.map(function (it, i) {
      return '<div class="ac-opt" role="option" id="ac-opt-' + i + '" data-ac="' + i + '" aria-selected="' + (i === ac.active) + '"><span class="l">' + esc(it.l) + '</span><span class="k">' + esc(it.kind) + '</span></div>';
    }).join('');
    var it = ac.items[ac.active];
    $('ac-doc').innerHTML = it ? '<code>' + esc(it.sig) + '</code>' + esc(it.doc) : '';
    editor.setAttribute('aria-activedescendant', 'ac-opt-' + ac.active);
    var cur = $('ac-opt-' + ac.active);
    if (cur) { var top = cur.offsetTop, bot = top + cur.offsetHeight; if (top < list.scrollTop) list.scrollTop = top; else if (bot > list.scrollTop + list.clientHeight) list.scrollTop = bot - list.clientHeight; }
  }
  function positionCompletion() {
    var pop = $('ac-pop'), panel = $('editor-panel'), wr = wrap.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    var m = rangeMetrics(ac.ctx.start, ac.ctx.start), lh = lineHeight(), gw = gutter.offsetWidth;
    var x = (wr.left - pr.left) + gw + 16 + m.x0 - wrap.scrollLeft;
    var yBelow = (wr.top - pr.top) + 14 + m.line * lh - wrap.scrollTop, yAbove = yBelow - lh - pop.offsetHeight;
    var y = (yBelow + pop.offsetHeight > (wr.bottom - pr.top) && yAbove >= (wr.top - pr.top)) ? yAbove : yBelow;
    x = Math.max(4, Math.min(x, pr.width - pop.offsetWidth - 6));
    pop.style.left = x + 'px'; pop.style.top = Math.max(0, y) + 'px';
  }
  function hideCompletion() {
    if (!ac.open) return;
    ac.open = false; $('ac-pop').hidden = true; editor.removeAttribute('aria-activedescendant');
  }
  function openCompletion(explicit) {
    var ctx = complContext(explicit);
    if (!ctx) { hideCompletion(); if (explicit) announce('No completions at the caret.'); return false; }
    var items = filterCompletions(ctx);
    if (!explicit) items = items.filter(function (it) { return it.l.toLowerCase() !== ctx.prefix.toLowerCase(); });   // a finished word needs no completion
    if (!items.length) { hideCompletion(); if (explicit) announce('No completions match "' + ctx.prefix + '".'); return false; }
    var wasOpen = ac.open, prevLabel = wasOpen && ac.items[ac.active] ? ac.items[ac.active].l : null;
    ac.open = true; ac.items = items; ac.ctx = ctx; ac.active = 0;
    if (prevLabel) items.forEach(function (it, i) { if (it.l === prevLabel) ac.active = i; });
    $('ac-pop').hidden = false;
    renderCompletion(); positionCompletion();
    if (!wasOpen || explicit) announce(items.length + ' completion' + (items.length === 1 ? '' : 's') + '. ' + items[ac.active].l + ' selected. Arrow keys choose, Enter or Tab accepts, Escape dismisses.');
    return true;
  }
  function moveCompletion(delta) {
    ac.active = (ac.active + delta + ac.items.length) % ac.items.length;
    renderCompletion();
    announce(ac.items[ac.active].l + ', ' + (ac.active + 1) + ' of ' + ac.items.length + '.');
  }
  function acceptCompletion(idx) {
    var it = ac.items[idx], ctx = ac.ctx;
    if (!it || !ctx) return false;
    var v = editor.value, s = ctx.start, e = editor.selectionStart, after = v.slice(e);
    if (ctx.kind === 'macro' && /^\}\}/.test(after) && it.ins.indexOf('}}') !== -1) e += 2;        // `{{get|}}` -> no leftover braces
    else if (ctx.kind === 'word') e += /^[A-Za-z0-9_]*/.exec(after)[0].length;
    var base = /^[ \t]*/.exec(v.slice(lineStartOf(v, s), s))[0];
    var t = expandTemplate(it.ins, base);
    hideCompletion();
    return runEdit('Complete ' + it.l, v.slice(0, s) + t.text + v.slice(e), s + t.caret, s + t.caret, { say: 'Inserted ' + it.l + '.' });
  }

  // ==========================================================================
  // 13. Find / replace and go to line (ST-05)
  // ==========================================================================
  var find = { open: false, q: '', caseS: false, word: false, rep: false, matches: [], cur: -1 };
  function isWordCh(c) { return /[A-Za-z0-9_]/.test(c || ''); }
  function computeMatches() {
    var v = editor.value, q = find.q, out = [];
    if (q) {
      var hay = find.caseS ? v : v.toLowerCase(), nd = find.caseS ? q : q.toLowerCase(), i = 0;
      while ((i = hay.indexOf(nd, i)) !== -1) {
        if (!find.word || (!isWordCh(v.charAt(i - 1)) && !isWordCh(v.charAt(i + q.length)))) out.push(i);
        i += Math.max(1, nd.length);
        if (out.length >= 5000) break;
      }
    }
    find.matches = out;
  }
  function updateFindCount() {
    var el = $('find-count'), n = find.matches.length;
    el.textContent = !find.q ? '' : n === 0 ? 'No matches' : (find.cur >= 0 ? (find.cur + 1) + ' of ' + n : n + ' match' + (n === 1 ? '' : 'es'));
    $('rep-one').disabled = !n; $('rep-all').disabled = !n;
  }
  function recomputeFind(keepCur) {
    var prev = keepCur ? find.matches[find.cur] : undefined;
    computeMatches();
    if (prev !== undefined) { var idx = find.matches.indexOf(prev); find.cur = idx; }
    else find.cur = -1;
    updateFindCount(); renderDisplay();
  }
  function findGo(dir) {
    computeMatches();
    var n = find.matches.length;
    if (!n) { find.cur = -1; updateFindCount(); renderDisplay(); announce('No matches for ' + find.q + '.'); return; }
    var s = editor.selectionStart, e = editor.selectionEnd, idx = -1, i;
    var onCur = find.cur >= 0 && find.matches[find.cur] === s && e - s === find.q.length;
    if (onCur) idx = (find.cur + dir + n) % n;
    else if (dir > 0) { idx = 0; for (i = 0; i < n; i++) if (find.matches[i] >= e) { idx = i; break; } }
    else { idx = n - 1; for (i = n - 1; i >= 0; i--) if (find.matches[i] + find.q.length <= s) { idx = i; break; } }
    find.cur = idx;
    var ms = find.matches[idx];
    editor.setSelectionRange(ms, ms + find.q.length);
    updateFindCount(); renderDisplay(); revealRange(ms, ms + find.q.length, false); cursorInfo();
    announce('Match ' + (idx + 1) + ' of ' + n + ', line ' + lineNoAt(editor.value, ms) + '.');
  }
  function openFind(withReplace, gotoMode) {
    find.open = true; $('find-bar').hidden = false;
    var s = editor.selectionStart, e = editor.selectionEnd, v = editor.value;
    if (e > s && v.slice(s, e).indexOf('\n') === -1 && e - s < 200 && !gotoMode) { find.q = v.slice(s, e); $('find-q').value = find.q; }
    if (withReplace) setReplaceVisible(true);
    recomputeFind(false);
    var target = gotoMode ? $('goto-line') : $('find-q');
    target.focus(); if (target.select) target.select();
  }
  function closeFind() {
    if (!find.open) return;
    find.open = false; $('find-bar').hidden = true; find.cur = -1; clearGotoMsg();
    renderDisplay();
    editor.focus({ preventScroll: true });
    revealRange(editor.selectionStart, editor.selectionEnd, false); cursorInfo();
  }
  function setReplaceVisible(on) { find.rep = on; $('find-rep-row').hidden = !on; $('find-toggle-rep').setAttribute('aria-pressed', String(on)); }
  function replaceOne() {
    computeMatches();
    var s = editor.selectionStart, e = editor.selectionEnd, v = editor.value, q = find.q;
    var sel = v.slice(s, e), isMatch = e - s === q.length && (find.caseS ? sel === q : sel.toLowerCase() === q.toLowerCase()) && find.matches.indexOf(s) !== -1;
    if (!isMatch) { findGo(1); return; }
    var r = $('find-r').value;
    runEdit('Replace', v.slice(0, s) + r + v.slice(e), s + r.length, s + r.length, { focus: false, noReveal: true, noAnnounce: true });
    computeMatches(); find.cur = -1; findGo(1);
  }
  function replaceAll() {
    computeMatches();
    var n = find.matches.length; if (!n) return;
    var v = editor.value, r = $('find-r').value, len = find.q.length, out = '', pos = 0;
    find.matches.forEach(function (m) { out += v.slice(pos, m) + r; pos = m + len; });
    out += v.slice(pos);
    var first = find.matches[0];
    runEdit('Replace all (' + n + ')', out, first, first + r.length, { focus: false, say: 'Replaced ' + n + ' match' + (n === 1 ? '' : 'es') + ' in one undoable step.' });
    recomputeFind(false);
  }
  function clearGotoMsg() {
    var m = $('goto-msg'), g = $('goto-line');
    m.hidden = true; m.textContent = ''; g.removeAttribute('aria-invalid'); g.removeAttribute('aria-describedby');
  }
  function gotoLine(n) {
    var v = editor.value, total = v.split('\n').length, g = $('goto-line');
    var raw = String(n == null ? '' : n).trim(), num = Number(raw);
    if (raw === '' || !isFinite(num) || num < 1 || (g.validity && g.validity.badInput)) {
      // P3-01: invalid input must not move the caret; keep focus in the field and say why.
      var msg = 'Enter a line number from 1 to ' + total + '. The cursor was not moved.';
      var m = $('goto-msg'); m.textContent = msg; m.hidden = false;
      g.setAttribute('aria-invalid', 'true'); g.setAttribute('aria-describedby', 'goto-msg'); g.focus();
      announce(msg);
      return;
    }
    clearGotoMsg();
    n = Math.max(1, Math.min(total, Math.floor(num)));
    var off = 0; for (var i = 1; i < n; i++) off = v.indexOf('\n', off) + 1;
    editor.focus({ preventScroll: true }); editor.setSelectionRange(off, off);
    revealRange(off, off, true); cursorInfo();
    announce('Line ' + n + ' of ' + total + '.');
  }


  /* ==== ORIGINAL studio.html lines 3241-3265 : view state, activateDoc ==== */
  function saveViewState(d) {
    d.selStart = editor.selectionStart; d.selEnd = editor.selectionEnd; d.selDir = editor.selectionDirection;
    d.scrollTop = wrap.scrollTop; d.scrollLeft = wrap.scrollLeft; d.text = editor.value; d.lowLevel = chkLow.checked;
  }
  function activateDoc(d, o) {
    o = o || {};
    if (activeDoc) { saveViewState(activeDoc); hideCompletion(); }
    activeDoc = d;
    editor.value = d.text; chkLow.checked = d.lowLevel;
    editor.setSelectionRange(d.selStart, d.selEnd, d.selDir);
    resetLayers(); analysis = { docId: null, rev: -1, text: '', diags: [], header: null, error: null };
    selProbKey = null; chipsSig = ''; lastDedent = null;
    renderDocHeader(); renderUndoButtons();
    analyzeNow(); renderTestPanel();
    wrap.scrollTop = d.scrollTop; wrap.scrollLeft = d.scrollLeft;
    cursorInfo();
    if (find.open) recomputeFind(false);
    if (o.focus) { editor.focus({ preventScroll: true }); editor.setSelectionRange(d.selStart, d.selEnd, d.selDir); }
  }

  /* ==== ORIGINAL studio.html lines 3273-3516 : events ==== */
  // ==========================================================================
  // 15. Events
  // ==========================================================================
  diagList.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest('[data-filter-reset]')) { filter = 'all'; renderProblems(); return; }
    var btn = t.closest('[data-role]'); if (!btn) return;
    if (analysisPending) analyzeNow();
    var li = btn.closest('.prob'), key = li && li.getAttribute('data-key'), d = shown.find(function (x) { return x.key === key; });
    if (!d) { announce('That problem changed. Pick it again from the list.'); return; }
    var role = btn.getAttribute('data-role');
    if (role === 'row') {
      if (selProbKey === key) { selProbKey = null; renderProblems(); renderDisplay(); }
      else { selProbKey = key; renderProblems(); selectDiag(d, false); }
    } else if (role === 'fix') { applyFix(d); }
    else if (role === 'full') { fullDiffKeys[key] = !fullDiffKeys[key]; renderProblems(); }
    else if (role === 'show') { selectDiag(d, true); }
  });
  diagList.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    var rows = Array.prototype.slice.call(diagList.querySelectorAll('[data-role="row"]')), i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    var n = e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
    rows[n].focus();
  });
  $('prob-toolbar').addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter]'); if (!b) return;
    filter = b.getAttribute('data-filter'); renderProblems();
  });
  $('prob-note').addEventListener('click', function (e) {
    if (e.target.closest('#btn-open-setting')) { hooks.openSetting(activeDoc); return; }
    if (!e.target.closest('#btn-open-whatif')) return;
    hooks.showTest();
    lowWrap.scrollIntoView({ block: 'nearest' }); chkLow.focus();
  });
  $('btn-fix-all').addEventListener('click', applyAllFixes);
  btnUndo.addEventListener('click', function () { undo(); });
  btnRedo.addEventListener('click', function () { redo(); });
  $('btn-run-test').addEventListener('click', function () { if (hooks.run && hooks.run()) return; doTest(); });
  $('btn-indent').addEventListener('click', function () { changeIndent(1); });
  $('btn-outdent').addEventListener('click', function () { changeIndent(-1); });
  $('btn-find').addEventListener('click', function () { openFind(false, false); });
  $('btn-goto').addEventListener('click', function () { openFind(false, true); });
  $('btn-prev-prob').addEventListener('click', function () { stepProblem(-1, true); });
  $('btn-next-prob').addEventListener('click', function () { stepProblem(1, true); });
  // status bar settings
  $('sel-indent').addEventListener('change', function (e) {
    var v = e.target.value; indent.mode = v === 'tab' ? 'tab' : 'spaces'; indent.width = v === 's4' ? 4 : v === 'tab' ? 4 : 2;
    wrap.style.setProperty('--studio-tab-size', String(indent.width)); resizeEditor();
    announce('Indent set to ' + (v === 'tab' ? 'tab' : indent.width + ' spaces') + '.');
    editor.focus({ preventScroll: true });
  });
  $('btn-tabmode').addEventListener('click', function () { tabMoves = !tabMoves; tabArmed = false; setTabHint(); announce(tabMoves ? 'Tab now moves focus out of the editor.' : 'Tab now indents.'); editor.focus({ preventScroll: true }); });
  $('btn-toggle-ac').addEventListener('click', function (e) {
    autoComplete = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(autoComplete)); if (!autoComplete) hideCompletion();
    announce(autoComplete ? 'Auto-complete on.' : 'Auto-complete off. Control plus Space still opens completions.');
    editor.focus({ preventScroll: true });
  });

  // editor
  var inputCount = 0;
  function onTextInput(e) {
    var d = activeDoc, h = d.hist;
    if (editor.value === h.states[h.idx].text) return;
    var it = (e && e.inputType) || '';
    if (it === 'insertText' && e.data && e.data.length === 1) maybeDedent(e.data);
    var kind = (!it || /^(insertText|deleteContent|insertCompositionText|insertFromComposition|insertReplacementText)/.test(it)) ? 'type' : 'edit';
    histPush(kind, kind === 'type' ? 'Typing' : it === 'insertFromPaste' ? 'Paste' : 'Edit');
    inputCount++;
    renderDisplay(); scheduleAnalysis(); renderDocHeader(); renderUndoButtons(); cursorInfo(); renderChips();
    revealRange(editor.selectionStart, editor.selectionEnd, false);
    if (find.open) recomputeFind(false);
    if (ac.open || autoComplete) { if (kind === 'type' && it !== 'deleteContentBackward' ? true : ac.open) openCompletion(false); }
  }
  editor.addEventListener('compositionstart', function () { composing = true; });
  editor.addEventListener('compositionend', function (e) { composing = false; onTextInput({ inputType: 'insertCompositionText', data: e.data }); });
  editor.addEventListener('beforeinput', function (e) {
    if (e.inputType === 'historyUndo') { e.preventDefault(); undo(); return; }
    if (e.inputType === 'historyRedo') { e.preventDefault(); redo(); return; }
    if ((e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') && !e.isComposing && !composing) { e.preventDefault(); if (ac.open) acceptCompletion(ac.active); else enterKey(); return; }
    stampSel();
  });
  editor.addEventListener('input', function (e) {
    if (composing || e.isComposing) { renderDisplay(); return; }   // display only while an IME composition is open
    onTextInput(e);
  });
  editor.addEventListener('keydown', function (e) {
    if (e.isComposing || e.keyCode === 229) return;
    var mod = e.ctrlKey || e.metaKey, k = e.key;
    var modifierOnly = k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta';
    if (k === 'Tab' && !mod && !e.altKey) {
      if (tabMoves || tabArmed) { tabArmed = false; setTabHint(); return; }           // let the browser move focus
      e.preventDefault();
      if (ac.open && !e.shiftKey) { acceptCompletion(ac.active); return; }
      if (e.shiftKey) changeIndent(-1); else tabKey();
      return;
    }
    if (!modifierOnly && k !== 'Escape' && tabArmed) { tabArmed = false; setTabHint(); }
    if (mod && !e.altKey && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && !e.altKey && !e.shiftKey && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.code === 'Space' && e.ctrlKey && !e.altKey) { e.preventDefault(); openCompletion(true); return; }
    if (ac.open) {
      if (k === 'ArrowDown') { e.preventDefault(); moveCompletion(1); return; }
      if (k === 'ArrowUp') { e.preventDefault(); moveCompletion(-1); return; }
      if (k === 'Enter' && !mod && !e.shiftKey) { e.preventDefault(); acceptCompletion(ac.active); return; }
      if (k === 'Escape') { e.preventDefault(); hideCompletion(); announce('Completions dismissed.'); return; }
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End' || k === 'PageUp' || k === 'PageDown') hideCompletion();
    }
    if (k === 'Escape') {
      e.preventDefault();
      if (find.open) { closeFind(); return; }
      if (!tabMoves) { if (tabArmed) { tabArmed = false; setTabHint(); hooks.leave(); return; } tabArmed = true; setTabHint(); announce('Tab will now move focus out of the editor.'); }
      return;
    }
    if (k === 'Enter' && !mod && !e.altKey) { e.preventDefault(); enterKey(); return; }
    if (k === 'Backspace' && !mod && !e.altKey) { if (backspaceKey()) e.preventDefault(); return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown' || k === 'Home' || k === 'End' || k === 'PageUp' || k === 'PageDown') breakBurst();
  });
  editor.addEventListener('mousedown', breakBurst);
  editor.addEventListener('blur', function () { tabArmed = false; setTabHint(); hideCompletion(); });
  ['keyup', 'click', 'focus', 'select'].forEach(function (ev) { editor.addEventListener(ev, cursorInfo); });
  document.addEventListener('selectionchange', function () { if (document.activeElement === editor) cursorInfo(); });
  wrap.addEventListener('scroll', function () { if (ac.open) positionCompletion(); });
  $('ac-list').addEventListener('mousedown', function (e) { e.preventDefault(); var o = e.target.closest('[data-ac]'); if (o) acceptCompletion(Number(o.getAttribute('data-ac'))); });
  chkLow.addEventListener('change', function () {
    activeDoc.lowLevel = chkLow.checked; activeDoc.rev++;
    analyzeNow(); renderChips(); renderTestPanel();
    announce('What-if lowLevelAccess ' + (chkLow.checked ? 'on' : 'off') + '. Simulation only; no setting was changed.');
  });
  document.querySelectorAll('[data-var]').forEach(function (inp) { inp.addEventListener('input', function () { renderTestPanel(); renderChips(); }); });

  // find bar
  $('find-q').addEventListener('input', function (e) { find.q = e.target.value; recomputeFind(false); if (find.q) { var s = editor.selectionStart; editor.setSelectionRange(s, s); findGo(1); } });
  $('find-q').addEventListener('keydown', function (e) {
    if (e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); findGo(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });
  $('find-r').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (e.ctrlKey || e.metaKey) replaceAll(); else replaceOne(); } else if (e.key === 'Escape') { e.preventDefault(); closeFind(); } });
  $('goto-line').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); gotoLine(e.target.value); } else if (e.key === 'Escape') { e.preventDefault(); closeFind(); } });
  $('goto-go').addEventListener('click', function () { gotoLine($('goto-line').value); });
  $('goto-line').addEventListener('input', clearGotoMsg);
  $('find-next').addEventListener('click', function () { findGo(1); });
  $('find-prev').addEventListener('click', function () { findGo(-1); });
  $('find-close').addEventListener('click', closeFind);
  $('find-case').addEventListener('click', function (e) { find.caseS = !find.caseS; e.currentTarget.setAttribute('aria-pressed', String(find.caseS)); recomputeFind(false); });
  $('find-word').addEventListener('click', function (e) { find.word = !find.word; e.currentTarget.setAttribute('aria-pressed', String(find.word)); recomputeFind(false); });
  $('find-toggle-rep').addEventListener('click', function () { setReplaceVisible(!find.rep); });
  $('rep-one').addEventListener('click', replaceOne);
  $('rep-all').addEventListener('click', replaceAll);

  // global shortcuts
  document.addEventListener('keydown', function (e) {
    if (!activeDoc || $('editor-panel').hidden) return;
    var mod = e.ctrlKey || e.metaKey, k = e.key;
    if (k === 'F8') { e.preventDefault(); stepProblem(e.shiftKey ? -1 : 1, true); return; }
    var inPanel = $('editor-panel').contains(e.target);
    if (mod && !e.altKey && !e.shiftKey && inPanel && !composing) {
      var kl = k.toLowerCase();
      if (kl === 'f') { e.preventDefault(); openFind(false, false); return; }
      if (kl === 'h') { e.preventDefault(); openFind(true, false); return; }
      if (kl === 'g') { e.preventDefault(); openFind(false, true); return; }
    }
    if (k === 'Escape' && !e.defaultPrevented && e.target !== editor) {
      if (find.open && $('find-bar').contains(e.target)) { e.stopPropagation(); closeFind(); return; }
    }
  });

  /* ==== ORIGINAL studio.html lines 3535-3535 : testRun ==== */
  var testRun = null;

  /* ==== ORIGINAL studio.html lines 3546-3570 : lineDiff ==== */
  // Line diff (LCS) -> ops + hunks. The draft is the proposed side; the target is the current side.
  function lineDiff(aText, bText) {
    var a = aText.split('\n'), b = bText.split('\n'), n = a.length, m = b.length, ops = [], i, j;
    if (n * m > 250000) {
      a.forEach(function (s) { ops.push({ t: 'del', s: s }); }); b.forEach(function (s) { ops.push({ t: 'add', s: s }); });
    } else {
      var L = []; for (i = 0; i <= n; i++) L.push(new Uint16Array(m + 1));
      for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      i = 0; j = 0;
      while (i < n && j < m) {
        if (a[i] === b[j]) { ops.push({ t: 'eq', s: a[i] }); i++; j++; }
        else if (L[i + 1][j] >= L[i][j + 1]) ops.push({ t: 'del', s: a[i++] });
        else ops.push({ t: 'add', s: b[j++] });
      }
      while (i < n) ops.push({ t: 'del', s: a[i++] });
      while (j < m) ops.push({ t: 'add', s: b[j++] });
    }
    var hunks = [], cur = null;
    ops.forEach(function (o, k) {
      if (o.t === 'eq') { cur = null; return; }
      if (!cur) { cur = { id: hunks.length, from: k, to: k, dels: 0, adds: 0 }; hunks.push(cur); }
      cur.to = k; o.h = cur.id; if (o.t === 'del') cur.dels++; else cur.adds++;
    });
    return { ops: ops, hunks: hunks };
  }

  /* ==== ORIGINAL studio.html lines 3853-3900 : simulated test outcomes ==== */
  // Simulated test outcomes (E03.2): canned fixtures, nothing is parsed or executed.
  function renderTestExtras(d) {
    var t = d.tested, box = $('test-stack'), lines = t && t.stack ? t.stack : [];
    var h = lines.map(function (n) { return '<button type="button" class="btn-ghost" data-line="' + n + '">Jump to line ' + n + '</button>'; }).join('');
    if (box.getAttribute('data-h') !== h) { box.setAttribute('data-h', h); box.innerHTML = h; }
    box.hidden = !h;
    $('btn-stop-test').disabled = !testRun; $('btn-stop-test').setAttribute('aria-disabled', String(!testRun)); $('btn-run-test').disabled = !!testRun;
    if (testRun) { $('test-meta').className = 'test-meta'; $('test-meta').textContent = 'Running (simulated)… Stop is available. Nothing is being executed.'; }
  }
  function simTest(oc) {
    var d = activeDoc, rev = d.rev, sig = d.mode === 'cbs' ? varsSig() : '', total = editor.value.split('\n').length;
    var fn = { cbs: 'entry', lua: 'onOutput', plugin: 'render' }[d.mode];
    function ln(n) { return Math.max(1, Math.min(total, n)); }
    function finish(kind) {
      var title, sub, body, stack = [];
      if (kind === 'thrown') {
        stack = [ln(7), ln(2)]; title = 'Test · thrown error (simulated)'; sub = 'canned fixture';
        body = 'Thrown error (canned fixture)\n' + ({ cbs: 'CBS evaluation error: block is not closed', lua: 'attempt to index a nil value (field "state")', plugin: "TypeError: Cannot read properties of undefined (reading 'hud')" }[d.mode]) +
          '\n  at ' + fn + ' (line ' + stack[0] + ')\n  at <caller> (line ' + stack[1] + ')\n\nThis result is a fixture. No code was run.';
      } else if (kind === 'timeout') {
        stack = [ln(5)]; title = 'Test · timed out (simulated)'; sub = 'canned fixture';
        body = 'Timed out (canned fixture)\nThe simulated run exceeded its 2000 ms budget and was stopped by the harness.\nNo real clock ran and nothing was executed.\nPartial output: none\nLast reported position: line ' + stack[0];
      } else if (kind === 'stopped') {
        title = 'Test · stopped (simulated)'; sub = 'canned fixture';
        body = 'Stopped (canned fixture)\nStop was requested while the simulated run was in progress.\nNo output was produced and nothing was executed.';
      } else {
        stack = [ln(4), ln(6)]; title = 'Test · diagnostics (simulated)'; sub = 'canned fixture, not a parser result';
        body = 'Simulated diagnostics (fixture)\nsyntax  line ' + stack[0] + ': unexpected symbol near "end" (simulated)\napi     line ' + stack[1] + ': unknown API "risuState" (simulated)\n\nA real parser, Lua VM or plugin API check was not run.';
      }
      d.tested = { rev: rev, at: new Date(), sig: sig, assume: chkLow.checked, basis: isModified(d) ? 'draft' : 'live', title: title, sub: sub, body: body, note: 'Canned simulation fixture. It does not validate the language, load a plugin or change any capability setting.', status: kind, stack: stack };
      var wasStop = document.activeElement === $('btn-stop-test'); testRun = null;
      if (d === activeDoc) { renderTestPanel(); renderChips(); }
      announce('Simulated test ' + ({ thrown: 'threw an error', timeout: 'timed out', stopped: 'was stopped', diag: 'produced diagnostics' }[kind]) + ' for revision ' + rev + '. Nothing was executed.');
      if (wasStop) $('btn-run-test').focus({ preventScroll: true });
      if (kind !== 'stopped') hooks.tested(d);
    }
    if (oc === 'timeout' || oc === 'stopped') {
      testRun = { timer: setTimeout(function () { finish(oc); }, oc === 'timeout' ? 1600 : 700), finish: finish };
      renderTestExtras(d); announce('Simulated test running. Stop is available.');
      hooks.showTest();
    } else finish(oc);
  }
  $('btn-stop-test').addEventListener('click', function () { if (testRun) { clearTimeout(testRun.timer); testRun.finish('stopped'); } });
  $('test-stack').addEventListener('click', function (e) {
    var b = e.target.closest('[data-line]'); if (!b) return;
    hooks.showEditor();
    gotoLine(b.getAttribute('data-line'));
  });

  // ==========================================================================
  // Public API for the Studio shell (port addition)
  // ==========================================================================
  var StudioEditor = {
    hooks: hooks,
    // Make `spec.key` the active document. spec: { key, mode, title, text, live, whatIf, realLow }. An existing document keeps its history and view.
    open: function (spec, o) {
      var d = docs.filter(function (x) { return x.key === spec.key; })[0];
      if (!d) d = makeDoc(spec.key, spec.mode, spec.title, spec.text, spec.live, !!spec.whatIf, !!spec.realLow);
      d.savedText = spec.live; d.realLow = !!spec.realLow; d.title = spec.title;
      if (d !== activeDoc) activateDoc(d, o || {}); else { renderDocHeader(); renderTestPanel(); renderChips(); }
      return d;
    },
    doc: function (key) { return docs.filter(function (x) { return x.key === key; })[0] || null; },
    current: function () { return activeDoc; },
    text: function () { return editor.value; },
    isModified: function () { return activeDoc ? isModified(activeDoc) : false; },
    // programmatic change as one editor-history step (the shell uses it for "take theirs", discard and demo scripts)
    setText: function (text, label, o) { if (!activeDoc) return false; return runEdit(label || 'Edit', text, 0, 0, Object.assign({ focus: false, noReveal: true, noAnnounce: true }, o || {})); },
    check: function () { return doCheck(); },
    test: function () { doTest(); },
    applyAllFixes: applyAllFixes,
    selectRange: function (a, b) { editor.focus({ preventScroll: true }); editor.setSelectionRange(a, b); renderDisplay(); revealRange(a, b, true); cursorInfo(); },
    focus: function () { editor.focus({ preventScroll: true }); },
    undo: undo, redo: redo,
    problems: function () { return shown.slice(); },
    relang: function () { chipsSig = ''; if (activeDoc) { renderProblems(); renderStatus(); renderChips(); renderTestPanel(); renderUndoButtons(); setTabHint(); cursorInfo(); } },
    whatIf: function (on) { chkLow.checked = !!on; chkLow.dispatchEvent(new Event('change')); },
    lineDiff: lineDiff, refreshTest: function () { if (activeDoc) { renderTestPanel(); renderChips(); } },
    drop: function (key) { var i = docs.map(function (x) { return x.key; }).indexOf(key); if (i >= 0) { if (docs[i] === activeDoc) activeDoc = null; docs.splice(i, 1); } },
    resize: function () { minEditorH = 0; if (activeDoc) { resizeEditor(); if (ac.open) positionCompletion(); } }
  };
  window.StudioEditor = StudioEditor;

  // Test hook kept from the original page (synthetic only; no app access), so the original lint checks can run against this port.
  window.__studio = {
    lintCBS: lintCBS, lintLua: lintLua, lintPlugin: lintPlugin, simRun: simRun, selfTest: selfTest, applyEdits: applyEdits, RULES: RULES, PRESETS: PRESETS, buildDate: BUILD_DATE,
    state: function () { return { doc: activeDoc, docs: docs, analysis: analysis, shown: shown, hist: activeDoc && activeDoc.hist, perf: perf, find: find, ac: ac, indent: indent, tabArmed: tabArmed }; },
    undo: undo, redo: redo, scanLua: scanLua, scanJs: scanJs, highlightAll: highlightAll, rangeMetrics: rangeMetrics, revealRange: revealRange, isOpener: isOpener
  };
  tabMoves = tabMoves; setTabHint();
})();
