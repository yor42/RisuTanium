/* Studio slice 3, part 4: demo states (?state=lt-...) and the test hook window.__st3. No requestAnimationFrame in a state script (a hidden tab never fires it): every step is synchronous and ends in syncNow(). Synthetic. */
(function () {
  'use strict';
  const ST = window.__st1, A = ST.api, S = A.S, C = window.LTCore, LT = window.LTX, DD = window.StudioData3;
  const { t, ic, esc, $, $$ } = A;
  const STATES = ST.STATES, lang = (ko, en) => (S.lang === 'en' ? en : ko), fx = () => DD.fx(S.lang);
  const root = document.documentElement;
  const begin = async (o) => { ST.enter(Object.assign({ from: 'chat', noFocus: true }, o || {})); };
  const setField = (itemId, field, text) => { const f = A.findItem(itemId); f.it.f[field] = text; };
  const openItem = async (id) => { await begin(); ST.openItem(id, { focus: false }); };
  const openBasic = async () => openItem('c1.basic');
  const fieldOf = (key) => LT.fields.get(key);
  const focusField = (F) => { F.ta.focus({ preventScroll: true }); if (!F.focused) F.ta.dispatchEvent(new Event('focus')); return F; };
  const typeAt = (F, text, caret) => { focusField(F); F.ta.value = text; const c = caret == null ? text.length : caret; F.ta.setSelectionRange(c, c); F.ta.dispatchEvent(new Event('input', { bubbles: true })); return F; };
  const lowPower = () => { S.lp = true; root.classList.add('nexus-low-power'); };
  const syncNow = () => {
    LT.flushAll(); LT.cancel(LT.totT); LT.fields.forEach((F) => { LT.cancel(F.tokT); }); LT.cancel(LT.sbT);
    LT.fields.forEach((F) => { if (F.ta.isConnected) { LT.fit(F); LT.render(F); } });
    LT.countVisible(); if (LT.FM.open && LT.FM.G) LT.countNow(LT.FM.G, true); if (S.open) LT.drawTotals(S.open);
    if ($('#ltSb')) LT.sbRender();
  };
  const prose = (n) => { let s = ''; for (let i = 1; i <= n; i++) s += lang('등불 숲의 ' + i + '번째 이야기. {{char}}는 {{user}}에게 길을 안내한다.\n', 'Story ' + i + ' of the Lantern Forest. {{char}} guides {{user}} along the path.\n'); return s.trimEnd(); };
  const MACRO_TEXT = () => lang('{{char}}는 {{user}}를 반긴다. {{#when::{{getglobalvar::toggle_lantern}}}}푸른 등불이 {{getvar::hp}}번 깜박인다.{{:else}}등불은 꺼져 있다.{{/when}}\n{{// 여기는 메모예요}}\n{{random::안녕::어서 와요}}', '{{char}} greets {{user}}. {{#when::{{getglobalvar::toggle_lantern}}}}The blue lantern flickers {{getvar::hp}} times.{{:else}}The lantern is dark.{{/when}}\n{{// this is a note}}\n{{random::Hello::Welcome}}');
  const withSide = (tab) => { if (S.layout === 'wide') A.selectTab(tab); else A.openSide(tab); };
  const ex = {
    'lt-field-short': async () => { await openBasic(); },
    'lt-field-grow': async () => { setField('c1.basic', 'description', prose(30)); await openBasic(); },
    'lt-field-cap': async () => { setField('c1.basic', 'description', prose(60)); await openBasic(); LT.setCap('c1.basic:description', 200); },
    'lt-hl-macros': async () => { setField('c1.basic', 'description', MACRO_TEXT()); await openBasic(); const F = fieldOf('c1.basic:description'); focusField(F); const p = F.ta.value.indexOf('푸른') >= 0 ? F.ta.value.indexOf('푸른') + 1 : F.ta.value.indexOf('lantern flickers') + 3; F.ta.setSelectionRange(p, p); LT.render(F, { force: true }); },
    'lt-hl-lore': async () => { await openItem('c1.lore1'); },
    'lt-hl-deprecated': async () => { setField('c1.basic', 'description', lang('<char>는 <user>를 기다린다. {{char}}도 안다.', '<char> waits for <user>. {{char}} knows too.')); setField('c1.lore1', 'content', '@@depth 2\n' + lang('등불이 꺼지면 길이 사라진다.', 'The path vanishes when the lantern goes out.') + '\n@@end'); await openBasic(); },
    'lt-ac-open': async () => { await openBasic(); typeAt(fieldOf('c1.basic:description'), lang('안녕하세요 {{us', 'Hello {{us')); },
    'lt-ac-cho': async () => { await openBasic(); typeAt(fieldOf('c1.basic:description'), '{{ㅅㄱ'); },
    'lt-ac-block': async () => { await openBasic(); typeAt(fieldOf('c1.basic:description'), '{{#wh'); LT.acPick(0); LT.flushAll(); },
    'lt-sheet': async () => { await openBasic(); const F = focusField(fieldOf('c1.basic:description')); LT.openMacroSheet(F, $('[data-lt-key="c1.basic:description"] [data-lt-act="macro"]') || F.ta); },
    'lt-prob-unbalanced': async () => { setField('c1.basic', 'description', lang('첫 줄이에요 }} 이건 닫는 표시만 있어요.\n{{char은 {{user}}를 만난다.', 'First line }} has only a close mark.\n{{char meets {{user}}.')); await openBasic(); withSide('problems'); },
    'lt-prob-unclosed': async () => { setField('c1.basic', 'description', lang('{{#when::{{getglobalvar::toggle_combat}}}}전투 중에는 짧게 말한다.\n그 밖에는 느긋하다.', '{{#when::{{getglobalvar::toggle_combat}}}}Speak briefly during combat.\nOtherwise relaxed.')); await openBasic(); withSide('problems'); },
    'lt-prob-unknown': async () => { setField('c1.basic', 'description', lang('{{char}}는 {{frobnicate::x}}를 한다.', '{{char}} does {{frobnicate::x}}.')); await openBasic(); withSide('problems'); },
    'lt-prob-deprecated': async () => { setField('c1.basic', 'description', lang('<char>는 <user>를 기다린다.', '<char> waits for <user>.')); await openBasic(); withSide('problems'); },
    'lt-prob-fixed': async () => { await ex['lt-prob-deprecated'](); const b = $('[data-lt-key="c1.basic:description"] .lt-pfix'); if (b) b.click(); },
    'lt-focus': async () => { setField('c1.basic', 'description', MACRO_TEXT() + '\n\n' + prose(8)); await openBasic(); LT.openFocus(fieldOf('c1.basic:description'), null); if (innerWidth >= 1024) { const b = $('#ltfPvBtn'); b && b.click(); } },
    'lt-focus-preview': async () => { await ex['lt-focus'](); if (innerWidth < 1024) { const b = $('#ltfPvBtn'); b && b.click(); } },
    'lt-focus-find': async () => { setField('c1.basic', 'description', prose(12)); await openBasic(); LT.openFocus(fieldOf('c1.basic:description'), null, { find: true }); const q = $('#ltfQ'); q.value = lang('등불', 'Lantern'); q.dispatchEvent(new Event('input', { bubbles: true })); },
    'lt-focus-replace': async () => { await ex['lt-focus-find'](); LT.openFind(true); $('#ltfR').value = lang('촛불', 'candle'); $('#ltfRepAll').click(); },
    'lt-focus-revert': async () => { setField('c1.basic', 'description', prose(6)); await openBasic(); LT.openFocus(fieldOf('c1.basic:description'), null); const G = LT.FM.G; G.ta.focus(); G.ta.value += '\n' + lang('덧붙인 글입니다.', 'An added line.'); G.ta.dispatchEvent(new Event('input', { bubbles: true })); LT.flush(G); LT.revertFocus(); },
    'lt-tok-exact': async () => { setField('c1.basic', 'description', prose(8)); await openBasic(); },
    'lt-tok-offline': async () => { LT.tok.mode = 'offline'; setField('c1.basic', 'description', prose(8)); await openBasic(); },
    'lt-tok-online': async () => { LT.tok.mode = 'online'; setField('c1.basic', 'description', prose(8)); await openBasic(); },
    'lt-tok-approx': async () => { setField('c1.basic', 'description', MACRO_TEXT()); await openBasic(); },
    'lt-tok-tip': async () => { LT.tok.mode = 'offline'; await ex['lt-tok-approx'](); syncNow(); const b = $('[data-lt-key="c1.basic:description"] .lt-tokinfo'); if (b) b.click(); },
    'lt-tok-lowpower': async () => { lowPower(); setField('c1.basic', 'description', prose(8)); await openBasic(); },
    'lt-sb-values': async (text) => { setField('c1.basic', 'description', typeof text === 'string' ? text : MACRO_TEXT()); await openBasic(); S.tv.lantern = true; const F = focusField(fieldOf('c1.basic:description')); withSide('test'); A.renderSide(); LT.sbRender(); },
    'lt-sb-chat': async () => { await ex['lt-sb-values'](); const b = $('#tSw [data-sb-act="copy"]'); b && b.click(); },
    'lt-sb-writes': async () => { await ex['lt-sb-values'](lang('{{setvar::mood::calm}}{{addvar::hp::-5}}{{char}}의 체력은 {{getvar::hp}}이고 기분은 {{getvar::mood}}이다.', '{{setvar::mood::calm}}{{addvar::hp::-5}}{{char}} has {{getvar::hp}} hp and feels {{getvar::mood}}.')); },
    'lt-sb-nochat': async () => { await ex['lt-sb-values'](); S.ctx.chat = false; A.renderAll(); focusField(fieldOf('c1.basic:description')); A.renderSide(); LT.sbRender(); },
    'lt-alt-list': async () => { await openBasic(); },
    'lt-alt-menu': async () => { await openBasic(); const b = $('#ltAlts .lt-card:nth-child(2) [data-lt-card-act="menu"]'); b.click(); },
    'lt-alt-moved': async () => { await openBasic(); const u = LT.uids['c1.basic:alts'][1]; LT.listOps.move('alts', 'c1.basic', u, -1); },
    'lt-alt-main': async () => { await openBasic(); LT.listOps.makeMain('c1.basic', LT.uids['c1.basic:alts'][2]); },
    'lt-alt-added': async () => { await openBasic(); LT.listOps.add('alts', 'c1.basic'); },
    'lt-alt-deleted': async () => { await openBasic(); LT.listOps.del('alts', 'c1.basic', LT.uids['c1.basic:alts'][1]); },
    'lt-alt-restored': async () => { await ex['lt-alt-deleted'](); const b = $('#toast .toast-act'); b && b.click(); },
    'lt-alt-paste': async () => { await openBasic(); LT.listOps.openPasteMany('c1.basic', null); const ta = $('#pmTa'); ta.value = lang('첫 번째 메시지입니다.\n문단은 한 줄 비워요.\n\n두 번째 문단.\n\n\n두 번째 메시지입니다.\n\n\n\n  \n세 번째 메시지입니다.', 'The first message.\nOne empty line is a paragraph.\n\nSecond paragraph.\n\n\nThe second message.\n\n\n\n  \nThe third message.'); ta.dispatchEvent(new Event('input', { bubbles: true })); },
    'lt-ex-split': async () => { await openBasic(); const u = LT.uids['c1.basic:ex'][0]; const F = [...LT.fields.values()].find((x) => x.ta.id === 'ltta-' + u); focusField(F); F.ta.setSelectionRange(F.ta.value.length, F.ta.value.length); F.ta.value = F.ta.value + '\n<START>\n{{user}}: ' + lang('여기서 나뉘어요', 'split here') + '\n{{char}}: ' + lang('네.', 'Yes.'); F.ta.setSelectionRange(F.ta.value.length, F.ta.value.length); F.ta.dispatchEvent(new Event('input', { bubbles: true })); LT.flush(F); },
    'lt-ex-colon': async () => { setField('c1.basic', 'examples', '<START>\n{{user}}: ' + lang('열 시 반이에요, 10:30', 'It is half past ten, 10:30') + '\n{{char}}: ' + lang('벌써요? 시간: 늦었네요', 'Already? Time: late') + '\n  <start>  \n{{user}}: ' + lang('들여쓴 표시도 시작이에요', 'An indented mark starts a block too') + '\n'); await openBasic(); },
    'lt-ac-noopen': async () => { setField('c1.basic', 'description', lang('앞 {{getvar::hp}} 뒤', 'Before {{getvar::hp}} after')); await openBasic(); const F = focusField(fieldOf('c1.basic:description')); const at = F.ta.value.indexOf('{{get') + 5; F.ta.setSelectionRange(at, at); F.ta.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true })); LT.acUpdate(F, false); },
    'lt-ex-list': async () => { await openBasic(); },
    'lt-ex-before': async () => { setField('c1.basic', 'examples', fx().exPre + fx().examples); await openBasic(); },
    'lt-ex-text': async () => { LT.view.ex = 'text'; await openBasic(); },
    'lt-roundtrip': async () => { await openBasic(); const u = LT.uids['c1.basic:ex'][1]; const F = [...LT.fields.values()].find((x) => x.ta.id === 'ltta-' + u); focusField(F); F.ta.value = F.ta.value + '\n{{user}}: ' + lang('한 줄 더요.', 'One more line.'); F.ta.dispatchEvent(new Event('input', { bubbles: true })); LT.flush(F); LT.view.ex = 'text'; LT.rerenderLists('c1.basic'); },
    'lt-paste': async () => { await openBasic(); const u = LT.uids['c1.basic:ex'][3]; const F = [...LT.fields.values()].find((x) => x.ta.id === 'ltta-' + u); focusField(F); const pasted = '\n<START>\n{{user}}: ' + lang('붙인 첫째', 'Pasted one') + '\n{{char}}: ' + lang('네.', 'Yes.') + '\n<START>\n{{user}}: ' + lang('붙인 둘째', 'Pasted two') + '\n{{char}}: ' + lang('좋아요.', 'Fine.') + '\n'; F.ta.setSelectionRange(F.ta.value.length, F.ta.value.length); F.ta.value += pasted; F.ta.setSelectionRange(F.ta.value.length, F.ta.value.length); F.ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' })); LT.flush(F); },
    'lt-huge': async () => { setField('c1.basic', 'description', DD.huge(S.lang)); await openBasic(); focusField(fieldOf('c1.basic:description')); },
    'lt-huge-lowpower': async () => { lowPower(); await ex['lt-huge'](); },
    'lt-ime': async () => { await openBasic(); const F = focusField(fieldOf('c1.basic:description')); F.ta.setSelectionRange(F.ta.value.length, F.ta.value.length); F.ta.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); F.ta.setRangeText('ㅎ', F.ta.value.length, F.ta.value.length, 'end'); F.ta.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: 'ㅎ', inputType: 'insertCompositionText' })); },
    'lt-plain': async () => { await openBasic(); const F = fieldOf('c1.basic:defvars'); F.ta.scrollIntoView({ block: 'center' }); },
    'lt-html': async () => { await openBasic(); const F = fieldOf('c1.basic:bghtml'); F.ta.scrollIntoView({ block: 'center' }); }
  };
  Object.keys(ex).forEach((k) => { const f = ex[k]; STATES[k] = async () => { await f(); syncNow(); }; });
  // the one scroll a state may do: bring the thing the state is about into view (the form scrolls, not the page)
  const scrollTo = { 'lt-alt-list': '#ltAlts', 'lt-alt-menu': '#ltAlts', 'lt-alt-moved': '#ltAlts', 'lt-alt-main': '#ltAlts', 'lt-alt-added': '#ltAlts', 'lt-alt-deleted': '#ltAlts', 'lt-alt-restored': '#ltAlts', 'lt-alt-paste': '#ltAlts', 'lt-ex-split': '#ltEx', 'lt-ex-colon': '#ltEx', 'lt-ex-list': '#ltEx', 'lt-ex-before': '#ltEx', 'lt-ex-text': '#ltEx', 'lt-roundtrip': '#ltEx', 'lt-paste': '#ltEx' };
  Object.keys(scrollTo).forEach((k) => { const f = STATES[k]; STATES[k] = async () => { await f(); const e = $(scrollTo[k]); if (e) { const m = $('#main'); m.scrollTop = Math.max(0, e.offsetTop - 60); } }; });
  window.__st3 = { LT, C, A, S, states: Object.keys(ex), STATES, fields: () => [...LT.fields.keys()], F: fieldOf, sync: syncNow, focusField, typeAt, setField, pend: () => LT.pend() + (window.__pend ? window.__pend() : 0), pendFast: () => LT.pendFast() + (window.__pend ? window.__pend() : 0), ac: () => LT.ac, sb: LT.sb, FM: LT.FM, openBasic, lowPower };
})();
