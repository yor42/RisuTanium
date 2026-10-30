/* Chat slice 1 mockup, revision 2 (round 3 build). Synthetic mockup; not proof of native behaviour or performance.
   Standalone: no network, no dependencies. Implements docs/design/chat/SLICE1_SPEC.md revision 2 (do not redesign).
   Sections: icons, i18n, state, action registry, messages, streaming, swipe, sidebar, sheets, delete, composer, controls, init. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const Q = new URLSearchParams(location.search);
const root = document.documentElement;
const now = () => performance.now();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ------------------------------------------------------------------ icons (Lucide, inline) */
/* ------------------------------------------------------------------ icons (Lucide, inline) */
const ICONS = {
  'panel-left': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  'ellipsis-vertical': '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'send': '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  'square': '<rect width="18" height="18" x="3" y="3" rx="2"/>',
  'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  'languages': '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  'volume-2': '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
  'git-branch': '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  'bookmark': '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  'eye-off': '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  'trash-2': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  'image': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  'sparkles': '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'paperclip': '<path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"/>',
  'user': '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  'code': '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  'loader': '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  'keyboard': '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  'vibrate': '<path d="m2 8 2 2-2 2 2 2-2 2"/><path d="m22 8-2 2 2 2-2 2 2 2"/><path d="M8 8v8a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2z"/>',
  'check': '<path d="M20 6 9 17l-5-5"/>',
  'grid': '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  'message': '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
  'text': '<path d="M17 6.1H3"/><path d="M21 12.1H3"/><path d="M15.1 18H3"/>',
  'wand': '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>',
};
Object.assign(ICONS, {
  'arrow-up': '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  'arrow-down': '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  'grip-vertical': '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  'undo-2': '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  'plug': '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  'sliders': '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  'hash': '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  'pin': '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  // hooks batch 1 (HOOKS1_SPEC): failed-reply card and preset chip
  'circle-alert': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  'wrench': '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
});
// ic(name, size, cls) as before; the third argument may also be an options object { cls, fill } (HOOKS1_SPEC C-8: a filled variant, e.g. a starred mark)
const ic = (n, size = 20, cls = '') => {
  const o = cls && typeof cls === 'object' ? cls : { cls };
  return `<svg class="ic ${o.cls || ''}" data-icon-size="${size}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${o.fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[n] || ''}</svg>`;
};

/* ------------------------------------------------------------------ i18n (SLICE1_SPEC section 8 keys plus mockup-only keys; Korean: 해요체 notices, noun-phrase labels) */
const I18N = {
en: {
  banner: 'Synthetic mockup; not proof of native behaviour or performance.',
  openSidebar: 'Open sidebar', closeSidebar: 'Close sidebar', sidebar: 'Sidebar', chatOptions: 'This chat',
  chatOptionsBody: 'Chat settings arrive in slice 2. This is a placeholder.',
  prevReply: 'Previous reply', nextReply: 'Next reply', newReply: 'New reply', replyOf: 'Reply {n} of {total}',
  firstMessageOf: 'First message {n} of {total}', firstMessage: 'First message',
  firstReply: 'First reply', lastReply: 'Last reply', noMoreSaved: 'No more saved replies', releaseToGenerate: 'Release to generate a new reply',
  stillWriting: 'Still writing the reply', writingNow: 'The reply is being written',
  generateReply: 'Generate reply', asPersona: 'as {name}',
  composerPh: 'Message…', composerLabel: 'Message', send: 'Send', stop: 'Stop', more: 'More actions', personaPick: 'Write as',
  chatLog: 'Chat transcript', msgPos: 'message {n} of {total}', skip: 'Skip to chat',
  grpMessage: 'Message', grpAlts: 'Replies', grpMore: 'More', grpDelete: 'Delete', msgActions: 'Message actions', altsLabel: 'Replies',
  copy: 'Copy', selectText: 'Select text', selectHint: 'Selecting text: tap elsewhere to end', edit: 'Edit', translate: 'Translate', readAloud: 'Read aloud',
  branch: 'Branch from here', bookmark: 'Bookmark', unbookmark: 'Remove bookmark', hideAI: 'Hide from AI', showAI: 'Show to AI',
  copied: 'Copied', copiedSel: 'Copied the selection',
  deleteThis: 'Delete', deleteThisAndAfter: 'Delete this and the messages after it', deleteTitle: 'Confirm delete', deleteHint: 'Shift+click: delete this and the messages after it',
  deleteRangeConfirm: '“{excerpt}” and the {n} messages after it will be deleted', deleteCount: 'Delete {n}', stopAndDelete: 'Stop and delete',
  stopDeleteBody: 'The reply is still being written. It will be stopped first, then deleted.', stopDeleteRange: 'This includes the reply being written. It will be stopped first.',
  deleteOneConfirm: '“{excerpt}” will be stopped and deleted',
  cancel: 'Cancel', deleted: 'Message deleted', undo: 'Undo', restored: 'Message restored', simulated: '{what} (simulated)',
  customizeButtons: 'Customize buttons', restoreDefaults: 'Restore defaults', pinLabel: 'Pin {name}', moveUp: 'Move up', moveDown: 'Move down', dragHandle: 'Drag to reorder',
  previewNarrow: 'Narrow screens (up to {n})', previewWide: 'Wide screens (up to {n})', waiting: 'Waiting', demoBadge: 'Demo plugin', pluginDemoLabel: 'Count words', pluginToast: '{n} words',
  customizeHint: 'Pinned buttons sit next to the menu button. Up to 3 show on narrow screens and 6 on wide ones; extra pins wait in order.',
  plusTitle: 'Add to message', attachFile: 'Attach a file', addImage: 'Add an image', translateInput: 'Translate my message',
  suggestions: 'Suggestions', continue: 'Continue the reply', impersonate: 'Write for me', plugins: 'Plugin panels',
  thinking: 'Thinking…', words: '{n} words', writingCode: 'Writing code… {n} lines', writingCode1: 'Writing code… 1 line', writingStyles: 'Writing styles…', writingReply: 'Writing the reply… {n} characters',
  peekCode: 'Peek at the code', thoughtsLabel: 'Thoughts · {n} words', imageLoading: 'Image loading',
  removeChip: 'Remove', chats: 'Chats', ctlTitle: 'Mockup controls', lang: 'Language',
  rm: 'Reduced motion', lp: 'Low power', preset: 'Platform preset', c3: 'Header hides while reading older messages', c6: 'Hide names and avatars',
  c2: 'Counter n / N always visible', c1: 'Haptic tick (simulated)', c5: 'Render only when complete', swipeOn: 'Swipe gesture (off keeps pager and New reply)', pluginOn: 'Demo plugin installed',
  extras: 'Attachments and suggestions present', today: "Show today's behaviour", insetShow: 'Show system back inset and edge zones', insetPx: 'System back inset',
  kbUp: 'Keyboard up (shrink 300 px)', kbDown: 'Keyboard down', stream: 'Stream a reply', ime: 'Simulate IME composition', reset: 'Reset chat',
  hideKbd: 'Hide keyboard', kbdNote: 'Simulated keyboard, 300 px', haptic: 'haptic tick', imeIgnored: 'IME guard: Enter ignored ({why})',
  imeDone: 'IME simulation finished: nothing sent', sentN: 'Sent messages so far: {n}', s1: 'Seraphina’s forest', s2: 'Archivist’s tower', s3: 'Harbour café',
  hotNA: 'Shortcut needs the newest character message',
  todayNote: 'Showing today’s behaviour: raw text, every chunk remounts, unclosed CSS applies early.',
  personaJuno: 'Juno', personaMina: 'Mina', personaKai: 'Kai', charName: 'Seraphina',
  pAP: 'Android phone (touch)', pAT: 'Android tablet + keyboard (touch + keys)', pWT: 'Windows touch laptop (mouse + touch)', pLX: 'Linux desktop (mouse + keyboard)', pWH: 'Web host', presetNote: 'Changes only which affordances and defaults are shown.', noHaptic: 'No haptics on this platform', wheelEdge: 'Last reply (scrolling never generates)',
  enterKey: 'Enter key: Automatic / Send / New line', enterAuto: 'Automatic', enterSend: 'Send', enterNL: 'New line',
  hwYes: 'Hardware keyboard seen: Enter sends', hwNo: 'No hardware keyboard seen yet: Enter adds a line', xlLabel: 'Message to translate', xlSent: 'Translated message sent (simulated)',
  stopHint: 'Stopped', cmenu: 'Menu', replyShort: 'reply {n}/{total}', done: 'Done', deleteSingleConfirm: '“{excerpt}” will be deleted',
  // hooks batch 1: failed-reply card (DS-043)
  fcFailed: "Couldn't write the reply", fcReason_key: 'The API key is missing or was rejected', fcReason_model: "The selected model isn't available", fcReason_quota: 'The usage limit was reached',
  fcReason_network: "Couldn't reach the service", fcReason_server: 'The service had a problem', fcFix: 'Fix', fcRetry: 'Try again', fcChanged: 'Settings changed · Try again?', fcClose: 'Close',
  fcDetail: 'Details: {detail}', atRegion: 'Notice',
},
ko: {
  banner: '합성 목업이에요. 네이티브 동작이나 성능의 증거가 아니에요.',
  openSidebar: '사이드바 열기', closeSidebar: '사이드바 닫기', sidebar: '사이드바', chatOptions: '이 채팅',
  chatOptionsBody: '채팅 설정은 슬라이스 2에서 제공해요. 지금은 자리 표시용이에요.',
  prevReply: '이전 답변', nextReply: '다음 답변', newReply: '새 답변', replyOf: '답변 {total}개 중 {n}번째',
  firstMessageOf: '첫 메시지 {total}개 중 {n}번째', firstMessage: '첫 메시지',
  firstReply: '첫 번째 답변', lastReply: '마지막 답변', noMoreSaved: '저장된 답변 없음', releaseToGenerate: '놓으면 새 답변 생성',
  stillWriting: '답변을 아직 쓰는 중이에요', writingNow: '답변을 쓰는 중이에요',
  generateReply: '답변 생성', asPersona: '{name}(으)로',
  composerPh: '메시지…', composerLabel: '메시지', send: '보내기', stop: '중지', more: '추가 동작', personaPick: '작성자 선택',
  chatLog: '채팅 내용', msgPos: '메시지 {total}개 중 {n}번째', skip: '채팅으로 건너뛰기',
  grpMessage: '메시지', grpAlts: '답변', grpMore: '더 보기', grpDelete: '삭제', msgActions: '메시지 작업', altsLabel: '답변',
  copy: '복사', selectText: '텍스트 선택', selectHint: '텍스트를 선택하는 중이에요. 다른 곳을 탭하면 끝나요', edit: '편집', translate: '번역', readAloud: '읽어 주기',
  branch: '여기서 분기', bookmark: '북마크', unbookmark: '북마크 해제', hideAI: 'AI에게서 숨기기', showAI: 'AI에게 다시 보이기',
  copied: '복사했어요', copiedSel: '선택한 글을 복사했어요',
  deleteThis: '삭제', deleteThisAndAfter: '이 메시지와 이후 메시지 삭제', deleteTitle: '삭제 확인', deleteHint: 'Shift+클릭: 이 메시지와 이후 메시지 삭제',
  deleteRangeConfirm: '“{excerpt}” 이후 메시지 {n}개도 함께 삭제됩니다', deleteCount: '{n}개 삭제', stopAndDelete: '중지하고 삭제',
  stopDeleteBody: '답변을 아직 쓰는 중이에요. 먼저 중지한 뒤 삭제해요.', stopDeleteRange: '쓰는 중인 답변도 포함돼요. 먼저 중지해요.',
  deleteOneConfirm: '“{excerpt}” 답변을 중지하고 삭제해요',
  cancel: '취소', deleted: '메시지를 삭제했어요', undo: '실행 취소', restored: '메시지를 되돌렸어요', simulated: '{what} (시뮬레이션)',
  customizeButtons: '버튼 사용자 지정', restoreDefaults: '기본값으로', pinLabel: '{name} 고정', moveUp: '위로', moveDown: '아래로', dragHandle: '끌어서 순서 바꾸기',
  previewNarrow: '좁은 화면 (최대 {n}개)', previewWide: '넓은 화면 (최대 {n}개)', waiting: '대기 중', demoBadge: '데모 플러그인', pluginDemoLabel: '단어 수 세기', pluginToast: '{n}단어예요',
  customizeHint: '고정한 버튼은 메뉴 버튼 옆에 바로 나타나요. 좁은 화면은 3개, 넓은 화면은 6개까지 보이고, 넘치는 고정은 순서대로 기다려요.',
  plusTitle: '메시지에 추가', attachFile: '파일 첨부', addImage: '이미지 추가', translateInput: '내 메시지 번역',
  suggestions: '추천 답변', continue: '이어서 쓰기', impersonate: '대신 써 주기', plugins: '플러그인 패널',
  thinking: '생각 중…', words: '{n}단어', writingCode: '코드 작성 중… {n}줄', writingCode1: '코드 작성 중… 1줄', writingStyles: '스타일 작성 중…', writingReply: '답변 작성 중… {n}자',
  peekCode: '코드 미리보기', thoughtsLabel: '생각 · {n}단어', imageLoading: '이미지를 불러오는 중이에요',
  removeChip: '제거', chats: '채팅', ctlTitle: '목업 제어', lang: '언어',
  rm: '동작 줄이기', lp: '저전력', preset: '플랫폼 프리셋', c3: '이전 메시지를 읽는 동안 헤더 숨김', c6: '이름과 아바타 숨기기',
  c2: '카운터 n / N 항상 표시', c1: '햅틱 틱(시뮬레이션)', c5: '완성된 뒤에만 렌더링', swipeOn: '스와이프 제스처 (끄면 페이저와 새 답변만 남아요)', pluginOn: '데모 플러그인 설치됨',
  extras: '첨부 및 추천 칩 표시', today: '현재 동작 보기', insetShow: '시스템 뒤로가기 영역과 가장자리 구역 표시', insetPx: '시스템 뒤로가기 영역',
  kbUp: '키보드 올리기(300px 축소)', kbDown: '키보드 내리기', stream: '답변 스트리밍', ime: 'IME 조합 시뮬레이션', reset: '채팅 초기화',
  hideKbd: '키보드 숨기기', kbdNote: '시뮬레이션 키보드, 300px', haptic: '햅틱 틱', imeIgnored: 'IME 보호: Enter를 무시했어요 ({why})',
  imeDone: 'IME 시뮬레이션이 끝났어요. 아무것도 보내지 않았어요', sentN: '지금까지 보낸 메시지: {n}', s1: '세라핀의 숲', s2: '기록관의 탑', s3: '항구 카페',
  hotNA: '가장 최근 캐릭터 메시지에서만 쓸 수 있는 단축키예요',
  todayNote: '현재 동작을 보여 주고 있어요. 원문 그대로, 청크마다 다시 마운트하고, 닫히지 않은 CSS가 먼저 적용돼요.',
  personaJuno: '주노', personaMina: '미나', personaKai: '카이', charName: '세라핀',
  pAP: 'Android 폰(터치)', pAT: 'Android 태블릿 + 키보드(터치 + 키)', pWT: 'Windows 터치 노트북(마우스 + 터치)', pLX: 'Linux 데스크톱(마우스 + 키보드)', pWH: '웹 호스트', presetNote: '표시되는 기능과 기본값만 바뀌어요.', noHaptic: '이 플랫폼은 햅틱이 없어요', wheelEdge: '마지막 답변(스크롤로는 생성되지 않아요)',
  enterKey: 'Enter 키: 자동 / 보내기 / 줄바꿈', enterAuto: '자동', enterSend: '보내기', enterNL: '줄바꿈',
  hwYes: '하드웨어 키보드를 감지했어요. Enter는 보내기예요', hwNo: '하드웨어 키보드를 아직 감지하지 못했어요. Enter는 줄바꿈이에요', xlLabel: '번역해서 보낼 메시지', xlSent: '번역한 메시지를 보냈어요 (시뮬레이션)',
  stopHint: '중지했어요', cmenu: '메뉴', replyShort: '답변 {n}/{total}', done: '완료', deleteSingleConfirm: '“{excerpt}” 메시지를 삭제해요',
  // hooks batch 1: failed-reply card (DS-043)
  fcFailed: '답변을 만들지 못했어요', fcReason_key: 'API 키가 없거나 맞지 않아요', fcReason_model: '고른 모델을 쓸 수 없어요', fcReason_quota: '사용량 한도를 넘었어요',
  fcReason_network: '서비스에 연결하지 못했어요', fcReason_server: '서비스에 문제가 생겼어요', fcFix: '고치기', fcRetry: '다시 시도', fcChanged: '설정을 바꿨어요 · 다시 시도할까요?', fcClose: '닫기',
  fcDetail: '자세히: {detail}', atRegion: '알림',
},
};

/* ------------------------------------------------------------------ state */
const S = {
  lang: Q.get('lang') === 'ko' ? 'ko' : 'en',
  rm: false, lp: false, hideNames: Q.get('c6') === '1', hideHdr: true, counter: true, haptics: true, enterMode: 'auto', renderComplete: false, swipeOn: Q.get('swipe') !== '0', pluginOn: true,
  extras: Q.get('extras') === '1', xl: false, today: false, showInset: Q.get('inset') === '1', inset: 16, kb: false,
  persona: 0, preset: 'android-phone', hapticCap: true, hoverUi: false, touchUi: false, msgs: [], desktop: false, hdrHidden: false, atBottom: true, sent: 0, streaming: false, sbOpen: false,
  hwSeen: false, kbdSinceTouch: false, lastCopied: '', hapticCount: 0, hooks: {}, sendBlock: '',   // hooks and sendBlock: slice 2 extension points (no effect in slice 1)
  seq: 0, log: [], mqRM: matchMedia('(prefers-reduced-motion: reduce)'),
};
const t = (k, v) => {
  let s = I18N[S.lang][k] ?? I18N.en[k] ?? k;
  if (v) for (const x in v) s = s.replaceAll('{' + x + '}', v[x]);
  if (S.lang === 'ko') s = josa(s); // Korean particle by last syllable
  return s;
};
// 로 after a vowel or final ㄹ, 으로 after another final consonant, (으)로 when the name does not end in Hangul
function roParticle(ch) { const n = ch.charCodeAt(0); if (n < 0xAC00 || n > 0xD7A3) return '(으)로'; const j = (n - 0xAC00) % 28; return j === 0 || j === 8 ? '로' : '으로'; }
// slice 3: the other particle pairs, written "{name}(은)는" (은/는, 이/가, 을/를, 와/과): the first form after a final consonant, the second after a vowel; the pair is kept when the name does not end in Hangul
function josa(s) { return s.replace(/(\S)\(으\)로/g, (_, c) => c + roParticle(c)).replace(/(\S)\((은|이|을|와)\)(는|가|를|과)/g, (_, c, a, b) => { const n = c.charCodeAt(0); if (n < 0xAC00 || n > 0xD7A3) return c + '(' + a + ')' + b; return c + ((n - 0xAC00) % 28 === 0 ? b : a); }); }
const PERSONAS = ['personaJuno', 'personaMina', 'personaKai'];
const personaName = () => t(PERSONAS[S.persona]);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const log = (m) => { S.log.push(m); if (S.log.length > 80) S.log.shift(); const el = $('#evlog'); if (el) el.innerHTML = S.log.slice(-6).map((x) => '<li>' + esc(x) + '</li>').join(''); };
const edgeInset = () => S.inset;

/* ------------------------------------------------------------------ sample conversation (26 messages; a novel-style stretch of consecutive turns) */
const C = (en, ko) => ({ en, ko });
const CODE = "```js\nconst lantern = { glow: 'amber', hours: 9 };\nlantern.kindle('Seraphina', { patience: true, rain: 'ignore', wind: 'only when asked politely' });\n```";
function sampleMsgs() {
  const m = (role, alts, idx = 0) => ({ id: ++S.seq, role, alts, idx, bookmarked: false, hidden: false, streaming: false });
  return [
    m('char', [
      C('*Seraphina looks up from the lantern she is polishing and smiles.* You must be Juno. The mist came in early tonight, so I hoped someone would find the path. Come in and warm your hands.',
        '*세라핀은 닦던 등불에서 고개를 들고 미소 짓는다.* 당신이 주노군요. 오늘은 안개가 일찍 내려서 누군가 길을 찾아오길 바랐어요. 들어와서 손부터 녹이세요.'),
      C('*A soft light moves between the trees before Seraphina steps into view.* Juno? I am glad you came. The forest told me a traveler was close, and it is rarely wrong.',
        '*나무 사이로 부드러운 빛이 흔들리더니 세라핀이 모습을 드러낸다.* 주노? 와 줘서 기뻐요. 숲이 여행자가 가까이 왔다고 알려줬거든요. 숲은 좀처럼 틀리지 않아요.'),
      C('*Seraphina sets down her basket of moss and wipes her hands.* Oh, a visitor. Please sit anywhere that is dry. The kettle is nearly ready, and I have questions if you do.',
        '*세라핀이 이끼 바구니를 내려놓고 손을 턴다.* 어머, 손님이군요. 마른 자리 아무 데나 앉으세요. 주전자가 곧 끓을 거고, 저도 궁금한 게 많아요.'),
    ]),
    m('user', [C('안녕하세요, 세라핀! I followed the lights from the old bridge. Is this the clearing?', '안녕하세요, 세라핀! 오래된 다리에서 불빛을 따라왔어요. 여기가 그 공터인가요?')]),
    m('char', [C('Yes, this is the clearing. Those lights are my lanterns, and they only burn for people who are looking for something. What are you looking for, Juno?', '맞아요, 여기가 그 공터예요. 그 불빛은 제 등불인데, 무언가를 찾는 사람에게만 타올라요. 주노, 당신은 무엇을 찾고 있나요?')]),
    m('user', [C('Honestly, I am not sure. A quiet place, maybe. My head has been loud lately.', '솔직히 잘 모르겠어요. 조용한 곳일지도요. 요즘 머릿속이 너무 시끄러웠거든요.')]),
    m('char', [C('Then you came to the right place. *She pours tea into a chipped blue cup.* Quiet is the one thing this forest has in abundance. Drink first, talk later.', '그렇다면 제대로 오셨어요. *그녀는 이가 빠진 파란 잔에 차를 따른다.* 이 숲에 넘치는 건 고요뿐이에요. 먼저 마시고, 이야기는 나중에 해요.')]),
    m('user', [C('Thank you. The tea smells like pine and honey.', '고마워요. 차에서 소나무랑 꿀 향이 나요.')]),
    m('char', [C('Pine needles, wild honey and a little thyme. My grandmother’s recipe, though she never wrote it down. I only learned it by watching her hands.', '솔잎과 야생 꿀, 그리고 타임을 조금 넣었어요. 할머니의 레시피인데 적어 두신 적은 없어요. 저는 할머니 손을 보면서 배웠죠.')]),
    m('user', [C('Do you live out here by yourself?', '여기서 혼자 지내세요?')]),
    m('char', [C('Mostly, yes. The lanterns keep me company, and I teach them small spells so they last the night. Here is the one I use most:\n\n' + CODE + '\n\nIt is more of a habit than a spell.',
                 '대체로 그래요. 등불들이 친구가 되어 주고, 밤새 꺼지지 않도록 작은 주문을 가르쳐 줘요. 제가 가장 자주 쓰는 건 이거예요:\n\n' + CODE + '\n\n주문이라기보다는 습관에 가깝죠.')]),
    m('user', [C('That is lovely. Could you teach me one?', '멋지네요. 하나 가르쳐 주실 수 있어요?')]),
    m('char', [C('Of course. *She guides your fingers around the lantern’s brass frame.* Hold it like this, and think of a place that feels safe, not a person or a promise, just a place.', '물론이죠. *그녀는 등불의 놋쇠 틀 위로 당신의 손가락을 이끈다.* 이렇게 잡고, 안전하다고 느끼는 장소를 떠올려 봐요. 사람이나 약속이 아니라 그냥 장소를요.')]),
    m('user', [C('A porch with a creaky swing, and rain on the roof.', '삐걱거리는 그네가 있는 현관, 그리고 지붕에 떨어지는 빗소리요.')]),
    m('char', [C('*The lantern flares gently and settles into a steady amber.* That is a good place to start from. Most people picture something grand, a castle or a mountain top, and the lantern flickers because it cannot tell where to put the warmth. A small porch is easy for it to understand. You can build everything else from there: the sound of the rain, the smell of wet wood, the way the swing never quite stops moving even when nobody is on it. If you keep thinking of it each evening for a week, the glow will remember you, and then you will not need the words at all. I did not learn it faster than that, and I have been doing this since I was small. Do not rush it. The forest is patient, and so are the lanterns.',
                 '*등불이 부드럽게 일렁이다가 고른 호박색으로 가라앉는다.* 시작하기에 좋은 장소예요. 대부분은 성이나 산꼭대기처럼 거창한 걸 떠올리는데, 그러면 등불이 온기를 어디에 둬야 할지 몰라서 흔들려요. 작은 현관은 이해하기 쉽죠. 나머지는 거기서부터 쌓으면 돼요. 빗소리, 젖은 나무 냄새, 아무도 타지 않았는데도 멈추지 않고 조금씩 흔들리는 그네까지요. 일주일 동안 저녁마다 그 장소를 떠올리면 빛이 당신을 기억하게 되고, 그다음엔 말이 전혀 필요 없어져요. 저도 그보다 빨리 배우지는 못했어요. 어릴 때부터 해 왔는데도요. 서두르지 마세요. 숲은 참을성이 많고, 등불도 그래요.')]),
    m('char', [C('The light settled over Juno’s hands like warm water. Nobody spoke for a long moment. Somewhere beyond the clearing a branch let go of its rain, and the sound travelled a very long way through the quiet.\n\nThe lantern did not flicker once. Seraphina watched it the way one watches a child take its first steps: carefully, and without saying a word, in case the word turned out to be the thing that made it fall.',
                 '빛이 주노의 손 위로 따뜻한 물처럼 내려앉았다. 한참 동안 아무도 말하지 않았다. 공터 너머 어딘가에서 나뭇가지가 빗물을 놓아 주었고, 그 소리가 고요 속을 아주 멀리까지 번져 갔다.\n\n등불은 한 번도 흔들리지 않았다. 세라핀은 아이의 첫걸음을 지켜보듯 그것을 바라보았다. 조심스럽게, 아무 말도 하지 않은 채로. 그 말이 오히려 등불을 넘어뜨릴까 봐서였다.')]),
    m('char', [C('*Seraphina laughs quietly.* See? It likes you already. Most lanterns take a week to be this kind to a stranger.', '*세라핀이 조용히 웃는다.* 보세요? 벌써 당신을 좋아하잖아요. 낯선 사람에게 이렇게 다정해지려면 보통 등불은 일주일은 걸리거든요.')]),
    m('user', [C('It’s working! The light is so warm.', '되고 있어요! 빛이 정말 따뜻해요.')]),
    m('user', [C('Can I stay for the night? I can sleep by the fire.', '오늘 밤 묵어가도 될까요? 난롯가에서 자도 괜찮아요.')]),
    m('char', [C('There is a spare bed in the loft, and I would feel better knowing you were warm. The stairs are steep, so take the lantern with you.', '다락에 남는 침대가 있어요. 따뜻하게 지내시면 저도 마음이 놓이고요. 계단이 가파르니까 등불을 들고 올라가세요.')]),
    m('user', [C('Thank you, Seraphina. I really mean it.', '고마워요, 세라핀. 진심이에요.')]),
    m('char', [C('You do not have to thank me yet. Wait until you hear the owls at dawn; they have opinions about guests.', '아직 고마워하지 않아도 돼요. 새벽에 올빼미 소리를 들어 보세요. 손님에 대해 할 말이 많은 녀석들이거든요.')]),
    m('user', [C('Opinions? What kind of opinions?', '의견이요? 어떤 의견이요?')]),
    m('char', [C('Mostly about snoring. *She grins.* Do not worry, they are fair judges.', '대부분 코 고는 소리에 대해서요. *그녀가 씩 웃는다.* 걱정 마요, 공정한 심사위원들이니까.')]),
    m('user', [C('Then I will try to sleep quietly. Good night.', '그럼 조용히 자 볼게요. 안녕히 주무세요.')]),
    m('char', [C('Good night, Juno. *She dims her own lantern to a faint ember.* Call out if the mist gets inside.', '잘 자요, 주노. *그녀는 자신의 등불을 희미한 불씨로 낮춘다.* 안개가 안으로 들어오면 불러요.')]),
    m('user', [C('Sleep well too. Let’s talk more in the morning. 내일 봬요!', '당신도 푹 주무세요. 내일 아침에 더 이야기해요. 내일 봬요!')]),
    m('char', [
      C('*Seraphina smiles in the dark.* Morning it is. I will have breakfast ready, and the owls will have their say.', '*세라핀이 어둠 속에서 미소 짓는다.* 그럼 아침에 봐요. 아침을 차려 둘게요, 올빼미들도 한마디 할 거고요.'),
      C('*A soft chuckle comes from below the loft.* Rest well. I will keep the fire low and the kettle warm.', '*다락 아래에서 부드러운 웃음소리가 들린다.* 푹 쉬어요. 불은 낮게, 주전자는 따뜻하게 둘게요.'),
      C('*She pauses at the foot of the stairs.* Juno? Thank you for coming. It has been a long time since the lanterns had a guest.', '*그녀가 계단 아래에서 멈춰 선다.* 주노? 와 줘서 고마워요. 등불들이 손님을 맞은 건 정말 오랜만이에요.'),
      C('*The forest hushes, as if it heard.* Sleep, traveler. Whatever is loud in your head can wait until sunrise.', '*숲이 들은 것처럼 고요해진다.* 자요, 여행자. 머릿속이 시끄러운 건 해가 뜬 뒤에 생각해도 늦지 않아요.'),
      C('*Seraphina leans on the doorframe, listening to the rain start.* Good. The porch you imagined is real enough tonight.', '*세라핀이 문틀에 기대어 비가 시작되는 소리를 듣는다.* 좋아요. 당신이 떠올린 현관이 오늘 밤은 꽤 진짜 같네요.'),
    ], 2),
  ];
}
const lastMsg = () => S.msgs[S.msgs.length - 1];
const isNewestChar = (m) => m === lastMsg() && m.role === 'char';
const altText = (m, idx = m.idx) => { const a = m.alts[idx]; return a ? (a[S.lang] || a.en) : ''; };
const nameOf = (m) => (S.hooks.nameOf && S.hooks.nameOf(m)) || (m.role === 'char' ? t('charName') : personaName());   // slice 3: group replies name their speaker

const isFirstMsg = (m) => S.msgs[0] === m;
// message text for copy, excerpts and the word count; while streaming only what is visible so far (no half-written macro or tag)
const plainOf = (m) => (m.streaming ? tokenize(ST.raw).filter((x) => x.type === 'text' || (x.type === 'css' && x.closed)).map((x) => x.text).join('\n\n') : altText(m)).replace(/<\/?[A-Za-z][^>]*>/g, '').replace(/\{\{[^}]*\}\}/g, '').trim();

/* ------------------------------------------------------------------ markdown-lite + streaming-safe tokenizer (spec 6) + block renderer */
const inline = (s) => esc(s).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, '<strong>$1</strong>').replace(/\*(?=\S)([^*\n]+?)(?<=\S)\*/g, '<em>$1</em>');
// open paragraph: an unclosed opening marker (followed by text) or a trailing closing marker is hidden; a spaced "2 * 3" stays, so nothing flashes
const inlineOpen = (s) => inline(s).replace(/(<[^>]+>)|\*+(?=\S)|(?<=\S)\*+$/g, (m, tag) => (tag ? tag : ''));
const inlineHTML = (s, open) => (open ? inlineOpen(s) : inline(s)).replace(/\n/g, '<br>');
const wordCount = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const lineCount = (s) => { const a = s.split('\n'); return a.filter((l, i) => i < a.length - 1 || l.length).length; };

const MACRO_LIMIT = 64, CSS_LINE_LIMIT = 40;
const TAGS = new Set('html body p div span a strong em b i u h1 h2 h3 h4 h5 h6 img ul ol li table tr td th section article header footer main nav button input blockquote code pre hr br small label'.split(' '));
const COMPOUND = /^(?:\*|[a-zA-Z][\w-]*|[.#][\w-]+|\[[^\]]+\]|:{1,2}[\w-]+(?:\([^)]*\))?)+$/;
// DD-030: a rule opener is selector-like text before a "{" (at a line start, inline after text, one-line, or Allman) and counts only when a known CSS
// property followed by ":" comes right after the "{" (custom --x properties too). `interface Button {`, `enum Label {`, `[Status] {` and `a {` + prose never qualify.
const PROP_RE = /^(?:--[\w-]+|(?:margin|padding|border|background|font|text|line|letter|word|min|max|flex|grid|align|justify|overflow|animation|transition|box|outline|list|object|mix|backdrop|white|scroll|column|writing|place|inset|transform|filter|clip|mask|will|user|pointer|caret|accent|aspect)(?:-[a-z-]+)?|color|opacity|display|position|top|left|right|bottom|width|height|float|clear|cursor|content|visibility|z-index|gap|order|appearance|direction|resize|quotes|zoom|fill|stroke|contain|isolation|perspective|rotate|scale|translate)$/;
function startsDeclaration(s) { const m = /^\s*([\w-]+)\s*:/.exec(s); return !!m && PROP_RE.test(m[1].toLowerCase()); }
function selectorStart(s) {          // index in s where a selector ending at the end of s begins, or -1
  const t0 = s.replace(/\s+$/, ''); if (!t0) return -1;
  if ((s.slice(t0.length).match(/\n/g) || []).length > 1) return -1;
  const ls = t0.lastIndexOf('\n') + 1; const toks = [...t0.slice(ls).matchAll(/\S+/g)]; let k = toks.length;
  const isComb = (x) => /^[>+~]$/.test(x);
  const isSel = (x) => { const b = x.replace(/,$/, ''); return !!b && COMPOUND.test(b) && (/[.#:\[*]/.test(b) || TAGS.has(b)); };
  while (k > 0 && (isComb(toks[k - 1][0]) || isSel(toks[k - 1][0]))) k--;
  while (k < toks.length && isComb(toks[k][0])) k++;
  if (k >= toks.length) return -1;
  return ls + toks[k].index;
}
function tokenize(raw, final = false) {
  const segs = []; let i = 0, buf = '';
  const flush = () => { if (buf) { segs.push({ type: 'text', text: buf, closed: true }); buf = ''; } };
  const lineStart = (p) => p === 0 || raw[p - 1] === '\n';
  while (i < raw.length) {
    const c = raw[i];
    if (c === '<' && raw.startsWith('<Thoughts>', i)) {
      flush(); const e = raw.indexOf('</Thoughts>', i + 10);
      if (e < 0) { segs.push({ type: 'thought', text: raw.slice(i + 10), closed: final }); i = raw.length; }
      else { segs.push({ type: 'thought', text: raw.slice(i + 10, e), closed: true }); i = e + 11; }
      continue;
    }
    if ((c === '`' || c === '~') && lineStart(i)) {
      const fence = c.repeat(3);
      if (raw.startsWith(fence, i)) {
        const nl = raw.indexOf('\n', i + 3);
        const lang = (nl < 0 ? raw.slice(i + 3) : raw.slice(i + 3, nl)).trim();
        if (!lang) {                      // spec 12: a bare ~~~ / ``` line opens a fence only when more text follows before a blank line
          const rest = nl < 0 ? '' : raw.slice(nl + 1);
          if (rest === '') { if (!final) { flush(); i = raw.length; continue; } buf += raw.slice(i); i = raw.length; continue; }
          if (rest.split('\n')[0].trim() === '') { buf += raw.slice(i, nl); i = nl; continue; }   // scene break, stays prose
        }
        flush();
        const bs = nl < 0 ? raw.length : nl + 1; let e = -1, from = bs;
        while (from <= raw.length) { const k = raw.indexOf(fence, from); if (k < 0) break; if (k === bs || raw[k - 1] === '\n') { e = k; break; } from = k + 3; }
        if (e < 0) { segs.push({ type: 'fence', lang, text: raw.slice(bs), closed: final }); i = raw.length; }
        else { segs.push({ type: 'fence', lang, text: raw.slice(bs, e).replace(/\n$/, ''), closed: true }); const nl2 = raw.indexOf('\n', e); i = nl2 < 0 ? raw.length : nl2; }
        continue;
      }
      // a partial fence opener at the very end of the stream stays hidden
      if (!final && raw.length - i < 3 && raw.slice(i).split('').every((x) => x === c)) { flush(); i = raw.length; continue; }
    }
    if (c === '<' && /^<style(?=[\s>\/])/i.test(raw.slice(i, i + 7))) {      // any attributes, any case
      flush(); const te = raw.indexOf('>', i);
      if (te < 0) { i = raw.length; continue; }
      const cm = /<\/style\s*>/i.exec(raw.slice(te + 1));
      if (!cm) { i = raw.length; continue; }                                 // unclosed: nothing rendered, no CSS applied
      segs.push({ type: 'style', text: raw.slice(te + 1, te + 1 + cm.index), closed: true }); i = te + 1 + cm.index + cm[0].length;
      continue;
    }
    if (c === '{' && raw[i + 1] === '{') {
      const isImg = raw.startsWith('{{img::', i) || raw.startsWith('{{inlay', i);
      const e = raw.indexOf('}}', i + 2);
      if (isImg) {
        flush();
        if (e < 0) { if (!final) segs.push({ type: 'image', closed: false }); i = raw.length; }
        else { segs.push({ type: 'image', closed: true }); i = e + 2; }
        continue;
      }
      if (e >= 0) { buf += raw.slice(i, e + 2); i = e + 2; continue; }      // a closed macro stays in the prose
      if (!final && raw.length - i <= MACRO_LIMIT) { flush(); i = raw.length; continue; }   // fragment: hidden until }} or 64 characters
      buf += '{{'; i += 2; continue;                                           // fallback: shown as text
    }
    if (c === '<' && /^<img(?=[\s>\/]|$)/i.test(raw.slice(i, i + 5))) {
      flush(); const e = raw.indexOf('>', i);
      if (e < 0) { if (!final) segs.push({ type: 'image', closed: false }); i = raw.length; }
      else { segs.push({ type: 'image', closed: true }); i = e + 1; }
      continue;
    }
    if (c === '{' && startsDeclaration(raw.slice(i + 1, i + 64))) {
      const ss = selectorStart(buf);
      if (ss >= 0) {
        let depth = 0, k = i, lines = 1, close = -1;
        for (; k < raw.length; k++) { const ch = raw[k]; if (ch === '\n') { lines++; if (lines > CSS_LINE_LIMIT + 1) break; } else if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth <= 0) { close = k; break; } } }
        if (close >= 0) { buf += raw.slice(i, close + 1); i = close + 1; continue; }           // a closed rule outside a display script stays prose
        if (!final && lines <= CSS_LINE_LIMIT && k >= raw.length) { const text = buf.slice(ss) + raw.slice(i); buf = buf.slice(0, ss); flush(); segs.push({ type: 'css', text, closed: false }); i = raw.length; continue; }
      }
    }
    buf += c; i++;
  }
  flush();
  // trailing incomplete HTML tag stays hidden until its '>' arrives
  const lt = segs[segs.length - 1];
  if (!final && lt && lt.type === 'text') {            // only while it still looks like a tag (< + letter, not glued to a word) and for at most 64 characters
    const tm = /(^|[^A-Za-z0-9])(<\/?[A-Za-z][^<>]*)$/.exec(lt.text);
    if (tm && tm[2].length <= 64) lt.text = lt.text.slice(0, lt.text.length - tm[2].length);
  }
  return segs.filter((s) => !(s.type === 'text' && !s.text.trim()));
}

const SUN = '<svg viewBox="0 0 160 160" role="img" aria-label="sunset"><defs><linearGradient id="skyg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#587bff"/><stop offset=".6" stop-color="#ff9a7a"/><stop offset="1" stop-color="#ffc58f"/></linearGradient></defs><rect width="160" height="160" fill="url(#skyg)"/><circle cx="80" cy="104" r="26" fill="#ffe3b8"/><path d="M0 120Q40 98 80 118T160 112V160H0Z" fill="#0b0c2e"/><path d="M0 138Q50 120 100 136T160 132V160H0Z" fill="#00011c"/></svg>';
function highlight(code, lang) {
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('[^']*'|"[^"]*")|(\b(?:const|let|return|function|true|false|var)\b)|([a-z-]+)(?=\s*:)|(#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|deg|%)?)/g;
  return esc(code).replace(re, (m, c, s, k, p, n) => c ? `<span class="tk-c">${c}</span>` : s ? `<span class="tk-v">${s}</span>` : k ? `<span class="tk-k">${k}</span>` : p ? `<span class="tk-p">${p}</span>` : `<span class="tk-v">${n}</span>`);
}

const blockKey = (seg, mode) => seg.type + (seg.closed ? '-c' : '-o') + (mode === 'final' && seg.type === 'fence' ? '-f' : '');
// append-only text: finished paragraphs are rendered once; only the open (last) paragraph is re-rendered (spec 6)
function fillText(el, text, open) {
  const ps = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const kids = [...el.children];
  ps.forEach((src, j) => {
    const isOpen = open && j === ps.length - 1;
    let p = kids[j];
    if (!p) { p = document.createElement('p'); el.appendChild(p); }
    if (p.dataset.src !== src || p.dataset.open !== String(isOpen)) { p.innerHTML = inlineHTML(src, isOpen); p.dataset.src = src; p.dataset.open = String(isOpen); }
  });
  for (let j = kids.length - 1; j >= ps.length; j--) kids[j].remove();
}
function fillBlock(el, seg, mode, open) {
  switch (seg.type) {
    case 'text': fillText(el, seg.text, open); break;
    case 'css':
      if (!seg.closed) {
        if (!el.firstChild) el.innerHTML = `<span class="chip chip-style">${ic('wand', 16)}<span class="lbl"></span></span>`;
        $('.lbl', el).textContent = t('writingStyles');
      } else fillText(el, seg.text, false);
      break;
    case 'thought':
      if (!seg.closed) {
        if (!el.firstChild) el.innerHTML = `<span class="chip chip-thinking">${ic('sparkles', 16)}<span class="lbl"></span></span>`;
        $('.lbl', el).textContent = t('thinking') + ' ' + t('words', { n: wordCount(seg.text) });
      } else {
        if (!el.firstChild) el.innerHTML = `<details class="thought"><summary>${ic('sparkles', 16)}<span class="lbl"></span></summary><div class="thought-body"></div></details>`;
        $('.lbl', el).textContent = t('thoughtsLabel', { n: wordCount(seg.text) });
        const tb = $('.thought-body', el); if (tb.dataset.src !== seg.text) { tb.dataset.src = seg.text; tb.innerHTML = seg.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => '<p>' + inlineHTML(p, false) + '</p>').join(''); }
      }
      break;
    case 'image':
      if (!seg.closed) { if (!el.firstChild) el.innerHTML = `<div class="img-skel" role="img" aria-label="${esc(t('imageLoading'))}"></div>`; }
      else if (!el.firstChild) el.innerHTML = `<figure class="img">${SUN}</figure>`;
      break;
    case 'fence':
      if (!seg.closed) {
        if (!el.firstChild) {
          el.innerHTML = `<button type="button" class="btn chip chip-code" aria-expanded="false" title="${esc(t('peekCode'))}">${ic('code', 16)}<span class="lbl"></span></button><pre class="peek-pre" hidden></pre>`;
          $('.chip-code', el).addEventListener('click', (e) => { const p = $('.peek-pre', el); p.hidden = !p.hidden; e.currentTarget.setAttribute('aria-expanded', String(!p.hidden)); });
        }
        { const n = lineCount(seg.text); $('.lbl', el).textContent = n === 1 ? t('writingCode1') : t('writingCode', { n }); }
        $('.peek-pre', el).textContent = seg.text;
      } else {
        el.innerHTML = `<pre class="code" tabindex="-1" ${mode === 'final' ? `data-lang="${esc(seg.lang)}"` : ''}><code>${mode === 'final' ? highlight(seg.text, seg.lang) : esc(seg.text)}</code></pre>`;
      }
      break;
    case 'style': el.hidden = true; break;
  }
}
const fastMs = () => parseFloat(getComputedStyle($('#probe')).transitionDuration) * 1000 || 120;
function createBlock(seg, mode, open) {
  const el = document.createElement('div');
  el.className = 'blk ' + seg.type; el.dataset.key = blockKey(seg, mode);
  fillBlock(el, seg, mode, open); return el;
}
function reconcile(container, segs, mode) {
  const kids = [...container.children].filter((c) => !c.classList.contains('leaving'));
  segs.forEach((seg, i) => {
    const key = blockKey(seg, mode); const el = kids[i]; const open = mode === 'stream' && i === segs.length - 1;
    if (el && el.dataset.key === key) fillBlock(el, seg, mode, open);
    else {
      const n = createBlock(seg, mode, open); n.classList.add('fade-in');
      if (el) { container.insertBefore(n, el); el.classList.add('leaving'); setTimeout(() => el.remove(), fastMs() + 20); }
      else container.appendChild(n);
    }
  });
  for (let j = segs.length; j < kids.length; j++) kids[j].remove();
}
function setScopedStyle(msgEl, m, css) {
  let st = msgEl.querySelector('style[data-scope]');
  if (!css) { if (st) st.remove(); return; }
  if (!st) { st = document.createElement('style'); /* guard-ok: a message's own scoped CSS is sample content */ st.dataset.scope = '1'; msgEl.appendChild(st); }
  const prefix = `.msg[data-id="${m.id}"] .reply-body`;
  const out = css.replace(/([^{}]+)\{/g, (_, sel) => sel.split(',').map((s) => prefix + ' ' + s.trim()).join(', ') + ' {');
  if (st.textContent !== out) st.textContent = out;
}
const styleOf = (segs) => segs.filter((s) => s.type === 'style' && s.closed).map((s) => s.text).join('\n');
function renderFull(msgEl, m, raw, mode = 'final') {
  const body = $('.reply-body', msgEl); const segs = tokenize(raw, true);
  body.replaceChildren();
  segs.forEach((s) => { const el = createBlock(s, mode, false); el.classList.remove('fade-in'); body.appendChild(el); });
  setScopedStyle(msgEl, m, styleOf(segs));
}

/* ------------------------------------------------------------------ action registry (spec 5.1; a plugin action joins the same list) */
const L = { order: [], pinned: [] };
const DEFAULT_ORDER = ['edit', 'delete', 'copy', 'translate', 'readAloud', 'selectText', 'branch', 'bookmark', 'hideAI', 'plugin:demo-count'];
const DEFAULT_PINNED = ['edit', 'delete'];
const ACT = [];
const reg = (id) => ACT.find((a) => a.id === id);
const pinLimit = () => (S.desktop ? 6 : 3);
// DD-135: a failed reply keeps only delete (the card has 고치기 and 다시 시도); copy, translate, read aloud, edit, bookmark, branch and the rest are hidden
const scopeOk = (a, m) => (m && m.fail ? a.id === 'delete' : a.scope === 'any' || (a.scope === 'newest' && isNewestChar(m)) || (a.scope === 'character' && m.role === 'char') || (a.scope === 'user' && m.role === 'user'));
const busyReason = (m) => (m.streaming ? 'writingNow' : true);
const act = (id, icon, label, o = {}) => ({ id, icon, label, scope: 'any', source: 'builtin', pin: true, grp: 1, available: () => true, ...o });
function addAction(a) { ACT.push(a); if (!L.order.includes(a.id)) L.order.push(a.id); }
function initActions() {
  ACT.length = 0;
  L.order = DEFAULT_ORDER.slice(); L.pinned = DEFAULT_PINNED.slice();
  addAction(act('copy', 'copy', () => t('copy'), { grp: 1, run: (m, c) => copyMsg(m, c && c.selText) }));
  addAction(act('selectText', 'text', () => t('selectText'), { grp: 1, run: (m) => enableSelect(m) }));
  addAction(act('edit', 'pencil', () => t('edit'), { grp: 1, available: busyReason, run: (m) => (S.hooks.edit ? S.hooks.edit(m) : simulated(t('edit'))) }));       // slice 4: an inline editor that pins its message
  addAction(act('translate', 'languages', () => t('translate'), { grp: 1, available: busyReason, run: () => simulated(t('translate')) }));
  addAction(act('readAloud', 'volume-2', () => t('readAloud'), { grp: 1, available: busyReason, run: () => simulated(t('readAloud')) }));
  addAction(act('branch', 'git-branch', () => t('branch'), { grp: 3, available: busyReason, run: () => simulated(t('branch')) }));
  addAction(act('bookmark', 'bookmark', (m) => (m && m.bookmarked ? t('unbookmark') : t('bookmark')), { grp: 3, run: (m) => { m.bookmarked = !m.bookmarked; } }));
  addAction(act('hideAI', 'eye-off', (m) => (m && m.hidden ? t('showAI') : t('hideAI')), { grp: 3, run: (m) => { m.hidden = !m.hidden; } }));
  addAction(act('delete', 'trash-2', () => t('deleteThis'), { grp: 4, danger: true, run: (m, c) => deleteSingle(m, c && c.shift) }));
  addAction(act('deleteAfter', 'trash-2', () => t('deleteThisAndAfter'), { grp: 4, danger: true, pin: false, run: (m) => confirmDelete(m, true) }));
  if (S.pluginOn) addPlugin();
}
// A synthetic demo "plugin" action: shows that a plugin action can join the same list (no plugin API is specified)
function addPlugin() { addAction(act('plugin:demo-count', 'hash', () => t('pluginDemoLabel'), { grp: 3, source: 'plugin:demo-count', run: (m) => toast(t('pluginToast', { n: wordCount(plainOf(m)) })) })); }
function setPlugin(on) {
  S.pluginOn = on; const id = 'plugin:demo-count';
  if (on && !reg(id)) addPlugin(); if (!on) { const i = ACT.findIndex((a) => a.id === id); if (i >= 0) ACT.splice(i, 1); }
  refreshAll(); log('demo plugin ' + (on ? 'installed' : 'removed (its id stays in the layout and is skipped)'));
}
const actLabel = (a, m) => (typeof a.label === 'function' ? a.label(m) : a.label);
const reasonOf = (a, m) => { const r = a.available(m); return r === true ? '' : t(r); };
function pinnedFor(m, limit = pinLimit()) { return L.order.filter((id) => L.pinned.includes(id)).map(reg).filter((a) => a && a.pin && scopeOk(a, m)).slice(0, limit); }
function pinBtn(a, m) {
  const reason = reasonOf(a, m); const label = actLabel(a, m);
  const title = (reason ? label + ': ' + reason : label) + (a.id === 'delete' ? ' · ' + t('deleteHint') : '');
  return `<button type="button" class="btn pin${a.danger ? ' danger' : ''}" data-act="act" data-aid="${esc(a.id)}" aria-label="${esc(label)}" title="${esc(title)}"${reason ? ' aria-disabled="true"' : ''}>${ic(a.icon)}</button>`;
}
const moreBtn = () => `<button type="button" class="btn more" data-act="menu" aria-haspopup="dialog" aria-label="${esc(t('msgActions'))}" title="${esc(t('msgActions'))}">${ic('ellipsis-vertical')}</button>`;

/* ------------------------------------------------------------------ message DOM */
const thread = () => $('#thread');
const scroller = () => $('#scroller');
const msgEl = (m) => $(`.msg[data-id="${m.id}"]`);
const msgOf = (el) => el && S.msgs.find((x) => x.id == el.dataset.id);
function renderMsg(m, i) {
  const a = document.createElement('article');
  a.className = 'msg ' + m.role; a.dataset.id = m.id; a.tabIndex = -1; a.setAttribute('data-part', 'chat-message'); a.dataset.role = m.role;
  a.setAttribute('aria-labelledby', `nm-${m.id} ps-${m.id}`);
  a.innerHTML =
    `<div class="cluster" role="group" data-part="chat-message-actions-float"></div>` +
    `<div class="meta" data-part="chat-message-name-row"><span class="avatar" data-part="chat-message-avatar" aria-hidden="true"></span><span class="name" data-part="chat-message-name" id="nm-${m.id}"></span><span class="badges" data-part="chat-message-badges"></span><span class="hover-row" data-part="chat-message-actions-hover" role="group"></span><span class="pins" data-part="chat-message-actions" role="group"></span></div>` +
    `<div class="stage" data-part="chat-message-stage"><div class="card" data-part="chat-message-body"><span class="cl-spacer" data-part="chat-message-spacer" aria-hidden="true"></span><div class="reply-body" data-part="chat-message-text"></div></div>` +
    `<div class="peek" aria-hidden="true"><span class="chip peek-chip"></span><div class="peek-text"></div></div>` +
    `<div class="edge-chip chip" aria-hidden="true"></div>` +
    `<div class="meter" aria-hidden="true"><svg viewBox="0 0 40 40" width="40" height="40"><circle class="trk" cx="20" cy="20" r="15"/><circle class="arc" cx="20" cy="20" r="15"/></svg><span class="mi">${ic('refresh-cw', 18)}</span></div></div>` +
    `<div class="altrow" data-part="chat-message-alts"></div><span class="ps sr-only" id="ps-${m.id}"></span><div class="lp-ring" aria-hidden="true"></div>`;
  fillMsg(a, m, i);
  return a;
}
function setLabel(btn, key) { const l = t(key); btn.setAttribute('aria-label', l); btn.title = l; }
const altRowShown = (m) => !m.fail && m.role === 'char' && ((isFirstMsg(m) && m.alts.length > 1) || (isNewestChar(m) && !isFirstMsg(m)));      // a failed reply has no pager and no New reply: its card offers 다시 시도 (HOOKS1_SPEC A)
function altRowHTML(m) {
  const N = m.alts.length, idx = m.idx; const first = isFirstMsg(m); const canNew = isNewestChar(m) && !first;
  const showPager = N > 1; const atEnd = idx >= N - 1, atStart = idx <= 0;
  let h = '';
  if (showPager) {
    const nm = first ? t('firstMessageOf', { n: idx + 1, total: N }) : t('replyOf', { n: idx + 1, total: N });
    h += `<div class="pager${S.counter ? '' : ' nocount'}" role="group" aria-label="${esc(nm)}">` +
      `<button type="button" class="btn" data-act="prev" aria-label="${esc(t('prevReply'))}" title="${esc(atStart ? t('firstReply') : t('prevReply'))}" aria-disabled="${atStart || m.streaming}">${ic('chevron-left')}</button>` +
      `<span class="count" aria-hidden="true">${first ? esc(t('firstMessage')) + ' ' : ''}${idx + 1} / ${N}</span>` +
      `<button type="button" class="btn" data-act="next" aria-label="${esc(t('nextReply'))}" title="${esc(atEnd ? t('lastReply') : t('nextReply'))}" aria-disabled="${atEnd || m.streaming}">${ic('chevron-right')}</button></div>`;
  }
  if (canNew) {
    const dis = m.streaming || !!S.sendBlock; const label = t('newReply'); const why = m.streaming ? t('writingNow') : S.sendBlock;
    h += `<button type="button" class="btn newbtn${dis ? ' working' : ''}" data-act="new" aria-label="${esc(label)}" title="${esc(dis ? label + ': ' + why : label)}"${dis ? ' aria-disabled="true"' : ''}>${ic(m.streaming ? 'loader' : 'refresh-cw', 18, m.streaming ? 'spin' : '')}<span>${esc(label)}</span></button>`;
  }
  return h;
}
/* DD-144 / DD-153: message state mirrored as data-* attributes (the classes stay).
   model state (S.msgs): data-run first | middle | last | single (role plus group member), data-fail, data-streaming, data-bookmarked
   class state (set by existing code on the .msg itself): data-meta shown | none (.metaless), data-hidden (.hidden-ai), data-selected (.selectable)
   A neighbour's run changes when a message arrives, goes away or is refilled, and streaming starts or ends outside fillMsg, so those sites queue one coalesced pass over the mounted messages. */
const runKey = (m) => m.role + '|' + (m.saying || '');
function runOf(L, i) { const k = runKey(L[i]); const p = i > 0 && runKey(L[i - 1]) === k, n = i < L.length - 1 && runKey(L[i + 1]) === k; return !p && !n ? 'single' : !p ? 'first' : !n ? 'last' : 'middle'; }
function mirrorMsg(a, m, L, i) { const run = runOf(L, i); if (a.dataset.run !== run) a.dataset.run = run; a.toggleAttribute('data-fail', !!m.fail); a.toggleAttribute('data-streaming', !!m.streaming); a.toggleAttribute('data-bookmarked', !!m.bookmarked); }
function mirrorClasses(a) { const meta = a.classList.contains('metaless') ? 'none' : 'shown'; if (a.dataset.meta !== meta) a.dataset.meta = meta; a.toggleAttribute('data-hidden', a.classList.contains('hidden-ai')); a.toggleAttribute('data-selected', a.classList.contains('selectable')); }
const msgObs = new MutationObserver((recs) => recs.forEach((r) => mirrorClasses(r.target)));
let runQ = false;
function queueRuns() { if (runQ) return; runQ = true; Promise.resolve().then(() => { runQ = false; syncRuns(); }); }
function syncRuns() { const L = S.msgs; $$('.msg', thread()).forEach((a) => { let i = Number(a.dataset.i); if (!L[i] || String(L[i].id) !== a.dataset.id) i = L.findIndex((x) => String(x.id) === a.dataset.id); if (i >= 0) { mirrorMsg(a, L[i], L, i); mirrorClasses(a); } }); }
const KIND_SEL = 'button.btn, a.btn, button.chip, input, textarea, select';
function stampKind(e) { if (e.hasAttribute('data-kind')) return; const t = e.tagName; let k; if (t === 'TEXTAREA' || t === 'SELECT') k = 'field'; else if (t === 'INPUT') k = /^(checkbox|radio)$/.test(e.type) ? 'switch' : e.type === 'range' ? 'range' : /^(hidden|file|button|submit)$/.test(e.type) ? '' : 'field'; else k = e.classList.contains('chip') ? 'chip' : (e.textContent || '').trim() ? 'button' : 'icon-button'; if (k) e.setAttribute('data-kind', k); }
function stampKinds(root) { if (root.nodeType !== 1) return; if (root.matches(KIND_SEL)) stampKind(root); root.querySelectorAll(KIND_SEL).forEach(stampKind); }
function fillMsg(a, m, i = S.msgs.indexOf(m), opts = {}) {
  const total = S.msgs.length;
  a.dataset.i = i; a.classList.toggle('hidden-ai', m.hidden);
  const prev = S.msgs[i - 1];
  const showMeta0 = (!S.hideNames && (!prev || prev.role !== m.role)) || !!m.fail;      // a failed reply always shows its name row, so its pins never sit on the card
  const showMeta = S.hooks.showMeta ? S.hooks.showMeta(m, prev, showMeta0) : showMeta0;      // slice 3: a new speaker in a group shows the name row
  a.classList.toggle('metaless', !showMeta); a.classList.toggle('no-names', S.hideNames);
  mirrorMsg(a, m, S.msgs, i); mirrorClasses(a); msgObs.observe(a, { attributes: true, attributeFilter: ['class'] }); queueRuns();      // DD-144 / DD-153: state mirrored as attributes, in the same place the classes are set
  $('.name', a).textContent = nameOf(m); $('.avatar', a).textContent = [...nameOf(m)][0];
  if (S.hooks.meta) S.hooks.meta(a, m, showMeta);
  $('.ps', a).textContent = ', ' + t('msgPos', { n: i + 1, total });
  $('.badges', a).innerHTML = (m.bookmarked ? `<span class="on" title="${esc(t('bookmark'))}">${ic('bookmark', 14)}</span>` : '') + (m.hidden ? `<span title="${esc(t('hideAI'))}">${ic('eye-off', 14)}</span>` : '');
  const pins = pinnedFor(m); const pinsH = pins.map((x) => pinBtn(x, m)).join('') + moreBtn();
  const pinsEl = $('.pins', a), cl = $('.cluster', a);
  const had = document.activeElement && a.contains(document.activeElement) ? (document.activeElement.dataset.aid || (document.activeElement.classList.contains('more') ? '__more' : '')) : '';
  const hadIn = had && (pinsEl.contains(document.activeElement) ? 'pins' : cl.contains(document.activeElement) ? 'cl' : '');
  pinsEl.innerHTML = pinsH; cl.innerHTML = pinsH;
  pinsEl.setAttribute('aria-label', t('msgActions')); cl.setAttribute('aria-label', t('msgActions'));
  a.style.setProperty('--cl-w', (pins.length + 1) * tokNum('--size-touch') + 'px');
  // wide + hover: a compact row of the next most used actions that are not pinned (spec 5.3)
  const hov = ['copy', 'translate', 'readAloud', 'bookmark'].map(reg).filter((x) => x && scopeOk(x, m) && !pins.includes(x)).slice(0, 3);
  const hr = $('.hover-row', a); hr.innerHTML = hov.map((x) => pinBtn(x, m)).join(''); hr.setAttribute('aria-label', t('grpMore'));
  if (had) { const host = hadIn === 'cl' ? cl : pinsEl; const b = had === '__more' ? $('.more', host) : $(`[data-aid="${CSS.escape(had)}"]`, host); if (b) b.focus({ preventScroll: true }); }
  fillAltRow(a, m);
  if (S.hooks.altRow) S.hooks.altRow(a, m);                            // slice 3: a refused New reply looks disabled and says why
  if (m.fail) renderFail(a, m);                                         // hooks batch 1: the error card replaces the reply body
  else if (!m.streaming && !opts.keepBody) { renderFull(a, m, altText(m)); markPre(a); }
  syncReturnRow(a, m);
  if (opts.enter) { const c = $('.card', a); c.classList.remove('enter'); void c.offsetWidth; c.classList.add('enter'); }
  if (S.hooks.afterFill) S.hooks.afterFill(a, m);                      // slice 4: lazy images and thumbnail avatars
}
function fillAltRow(a, m) {
  const row = $('.altrow', a); const show = altRowShown(m);
  row.hidden = !show; if (!show) { row.replaceChildren(); return; }
  const hadFocus = row.contains(document.activeElement) ? document.activeElement.dataset.act : '';
  row.innerHTML = altRowHTML(m);
  const act = a.classList.contains('active') || a.tabIndex === 0; $$('.btn', row).forEach((b) => (b.tabIndex = act ? 0 : -1));
  if (hadFocus) { const b = $(`[data-act="${hadFocus}"]`, row); if (b && b.getAttribute('aria-disabled') !== 'true') b.focus({ preventScroll: true }); else a.focus({ preventScroll: true }); }
}
function genRow() {
  const d = document.createElement('div'); d.className = 'genrow';
  d.innerHTML = `<button type="button" class="btn solid" data-act="gen">${ic('sparkles', 18)}<span>${esc(t('generateReply'))}</span></button>`;
  return d;
}
function refreshAll(keepBody = true) {
  if (S.hooks.mounted) S.hooks.mounted(keepBody).forEach(({ m, i, el }) => fillMsg(el, m, i, { keepBody: keepBody || m.streaming }));       // slice 4: only the mounted messages exist in the DOM
  else S.msgs.forEach((m, i) => { const el = msgEl(m); if (el) fillMsg(el, m, i, { keepBody: keepBody || m.streaming }); });
  setActive(activeEl());
}
function renderTranscript(keepScroll) {
  if (S.hooks.transcript) { S.hooks.transcript(keepScroll); return; }       // slice 4: a bounded window instead of every message
  const th = thread(); const sc = scroller(); const was = sc.scrollTop;
  th.replaceChildren();
  const note = document.createElement('p'); note.className = 'note'; note.setAttribute('data-part', 'chat-message'); note.dataset.role = 'system'; note.textContent = t('banner'); th.appendChild(note);
  S.msgs.forEach((m, i) => th.appendChild(renderMsg(m, i)));
  const l = lastMsg();
  if (l && l.role === 'user' && !S.streaming) th.appendChild(genRow());
  setActive(l ? msgEl(l) : null);
  if (keepScroll) sc.scrollTop = was; else scrollBottom();
  updateCV();
}
function rerenderMsg(m, opts) {
  const el = msgEl(m); const i = S.msgs.indexOf(m);
  if (!el) { if (S.hooks.mounted) return; thread().insertBefore(renderMsg(m, i), $('.genrow')); return; }
  fillMsg(el, m, i, opts);
}
const activeEl = () => $('.msg[tabindex="0"]') || (lastMsg() && msgEl(lastMsg()));
function setActive(el) {
  $$('.msg').forEach((x) => {
    const on = x === el; const ti = on ? 0 : -1;                       // slice 4: write only what changes (100 mounted messages: no hundreds of attribute mutations per call)
    if (x.tabIndex !== ti) x.tabIndex = ti; if (x.classList.contains('active') !== on) x.classList.toggle('active', on);
    $$('.pins .btn, .cluster .btn, .altrow .btn, .hover-row .btn, .failcard .btn, .fc-return .btn', x).forEach((b) => { if (b.tabIndex !== ti) b.tabIndex = ti; });
    $$('pre.code', x).forEach((p) => { if (p.tabIndex !== ti) p.tabIndex = ti; });
  });
}
// containment: all but the newest three messages get content-visibility:auto with their last measured height (spec 6)
function updateCV() {
  if (S.hooks.mounted) return;                                         // slice 4: the bounded list owns containment (cached heights, fractional sizes)
  const els = $$('.msg'); const cut = els.length - 3;
  els.forEach((el, k) => {
    if (k < cut) { if (!el.classList.contains('cv')) { const h = el.offsetHeight; if (h) el.style.containIntrinsicSize = 'auto ' + h + 'px'; el.classList.add('cv'); } }
    else if (el.classList.contains('cv')) { el.classList.remove('cv'); }
  });
}
// a code block only owns horizontal gestures while it actually overflows sideways (spec 3.2)
const markPre = (root = document) => $$('pre.code, pre.peek-pre', root).forEach((p) => p.classList.toggle('ovf', p.scrollWidth > p.clientWidth + 1));
let progUntil = 0;
function scrollBottom() { const sc = scroller(); progUntil = now() + 150; sc.scrollTop = sc.scrollHeight; S.atBottom = true; }
const announce = (s) => { const l = $('#live'); l.textContent = ''; setTimeout(() => (l.textContent = s), 30); };
function haptic(why) {
  if (!S.hapticCap || !S.haptics) return;
  S.hapticCount++; log('haptic tick: ' + why);
  const h = $('#haptic'); h.innerHTML = ic('vibrate', 14) + '<span>' + esc(t('haptic')) + '</span>'; h.classList.remove('pulse'); void h.offsetWidth; h.classList.add('pulse');
  try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(10); } catch (_) {}
}
let toastT = 0;
function toast(s) { const el = $('#toast'); el.textContent = s; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 1700); log(s); }
const simulated = (what) => toast(t('simulated', { what }));
function doCopy(text) {
  S.lastCopied = text;
  try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => {}); } catch (_) {}
}
function copyMsg(m, selText) { const sel = selText || ''; doCopy(sel || plainOf(m)); toast(sel ? t('copiedSel') : t('copied')); }

/* ------------------------------------------------------------------ alternatives: pager path (guard of 500 ms, spec 3.1) */
let guardUntil = 0;
const GUARD_MS = 500;
const armGuard = () => { guardUntil = now() + GUARD_MS; };
function goAlt(m, d) {
  const n = m.idx + d; if (n < 0 || n >= m.alts.length || m.streaming || m.fail) return false;      // a failed reply has no alternatives to step through
  m.idx = n; armGuard(); const keep = S.atBottom; rerenderMsg(m, { enter: !S.rm }); if (keep) scrollBottom();
  announce(isFirstMsg(m) ? t('firstMessageOf', { n: n + 1, total: m.alts.length }) : t('replyOf', { n: n + 1, total: m.alts.length })); return true;
}
// the only ways a paid generation starts: the labelled button, the sheet item, the armed pull, Ctrl+Alt+R at N/N, and Send (guarded)
function newReply(source) {
  if (S.sendBlock && !ST.m) { toast(S.sendBlock); log('new reply refused: ' + source + ' (' + S.sendBlock + ')'); return false; }
  if (ST.m) { log('new reply refused: ' + source + ' (already writing)'); return false; }
  { const f = lastMsg(); if (f && f.fail) return retryFail(f, source); }           // a failed reply regenerates in place
  const m = lastMsg(); if (m && m.role === 'char' && isFirstMsg(m)) { log('new reply refused: first message'); return false; }
  const why = S.hooks.regenWhy && S.hooks.regenWhy(m); if (why) { toast(why); log('new reply refused: ' + source + ' (' + why + ')'); return false; }
  if ((source === 'button' || source === 'hotkey') && now() < guardUntil) { log('new reply ignored: ' + source + ' within the 500 ms guard'); return false; }
  generateNew(); return true;
}

/* ------------------------------------------------------------------ streaming (spec 6) */
// Every row of the spec 6 table appears in the scripted reply. A hold keeps one construct open so it can be looked at; ?hold=<phase> keeps it open forever.
const SCRIPTS = {
  en: [
    '<Thoughts>The traveler wants a gentle lesson. ', { hold: 700, phase: 'thinking' },
    'I will describe the porch as a picture, show the rune as code, and tint the emphasis.</Thoughts>',
    '\n\n*Seraphina closes her eyes and smiles.* Listen closely: the **porch light** is yours now. This is how it looks from the swing:\n\n',
    '{{img::sun', { hold: 700, phase: 'image' }, 'set}}',
    '\n\nA second picture, through the inlay macro:\n\n{{inlay::lan', { hold: 600, phase: 'inlay' }, 'tern}}',
    '\n\nAnd one as a plain tag: <img src="porch', { hold: 600, phase: 'imgtag' }, '.png">',
    '\n\nThe name on the door is {{user', { hold: 600, phase: 'macro' }, '}}, in a macro the app fills in later. She adds, *softly', { hold: 600, phase: 'emphasis' }, ' and slowly* that **the rune is next.',
    '** \n\nAnd this is the rune I traced on the glass:\n\n```css\n.rune {\n  color: #ffb38a;\n  opacity: 0.9;\n', { hold: 700, phase: 'code' },
    '  filter: drop-shadow(0 0 6px #ffb38a);\n  letter-spacing: 0.04em;\n  transform: rotate(-4deg);\n}\n```',
    '\n\nA tilde fence works the same way:\n\n~~~\nlantern.kindle();\n', { hold: 600, phase: 'tilde' }, 'lantern.hold();\n~~~',
    '\n\nSome replies carry their styles without a style tag:\n\n.rune em {\n  color: #ffb38a;\n  text-shadow: 0 0 6px #ffb38a;', { hold: 700, phase: 'css' }, '\n}\n',
    '\n\nOne more thing, a little warmth for the words.\n\n<style>\nstrong { color: #ff9a7a;\n  font-size: 1.3em;', { hold: 700, phase: 'style' }, '\n}\n</style>',
    '\n\nA lone { such as {"a": 1} in prose is just text. Sleep well, Juno.',
  ],
  ko: [
    '<Thoughts>여행자가 부드러운 가르침을 원하는구나. ', { hold: 700, phase: 'thinking' },
    '현관을 그림으로 보여 주고, 룬을 코드로 적고, 강조할 부분에 색을 입혀야겠다.</Thoughts>',
    '\n\n*세라핀이 눈을 감고 미소 짓는다.* 잘 들어요. 이제 **현관 등불**은 당신 거예요. 그네에서 보면 이런 모습이에요:\n\n',
    '{{img::sun', { hold: 700, phase: 'image' }, 'set}}',
    '\n\n두 번째 그림은 inlay 매크로로 보여 드릴게요:\n\n{{inlay::lan', { hold: 600, phase: 'inlay' }, 'tern}}',
    '\n\n그리고 하나는 일반 태그로요: <img src="porch', { hold: 600, phase: 'imgtag' }, '.png">',
    '\n\n문에 적힌 이름은 {{user', { hold: 600, phase: 'macro' }, '}}이고, 앱이 나중에 채워 넣는 매크로예요. 그녀가 *조용히', { hold: 600, phase: 'emphasis' }, ' 천천히* 덧붙인다. **다음은 룬이에요.',
    '** \n\n그리고 이게 유리창에 그려 둔 룬이에요:\n\n```css\n.rune {\n  color: #ffb38a;\n  opacity: 0.9;\n', { hold: 700, phase: 'code' },
    '  filter: drop-shadow(0 0 6px #ffb38a);\n  letter-spacing: 0.04em;\n  transform: rotate(-4deg);\n}\n```',
    '\n\n물결 울타리도 같은 방식이에요:\n\n~~~\nlantern.kindle();\n', { hold: 600, phase: 'tilde' }, 'lantern.hold();\n~~~',
    '\n\n어떤 답변은 스타일 태그 없이 스타일을 담고 있어요:\n\n.rune em {\n  color: #ffb38a;\n  text-shadow: 0 0 6px #ffb38a;', { hold: 700, phase: 'css' }, '\n}\n',
    '\n\n한 가지 더, 말에 온기를 조금 더해 볼게요.\n\n<style>\nstrong { color: #ff9a7a;\n  font-size: 1.3em;', { hold: 700, phase: 'style' }, '\n}\n</style>',
    '\n\n문장 속의 { 하나나 {"a": 1} 같은 글은 그냥 글이에요. 잘 자요, 주노.',
  ],
};
const ST = { m: null, raw: '', full: '', holds: [], pos: 0, holdUntil: 0, hi: 0, timer: 0, raf: 0, lastRender: 0, dirty: false, renders: [], durs: [], remounts: 0, hold: Q.get('hold') || '', phase: '', manual: false, interval: 100, level: 0, fast: 0, burn: 0, longest: 0 };
const CADENCE = [100, 250, 500];
function buildPlan(lang) {
  let full = ''; const holds = [];
  SCRIPTS[lang].forEach((p) => { if (typeof p === 'string') full += p; else holds.push({ at: full.length, ms: p.ms ?? p.hold, phase: p.phase }); });
  return { full, holds };
}
const minLevel = () => (S.lp ? 1 : 0);
function setLevel(l) { ST.level = clamp(l, minLevel(), 2); ST.interval = CADENCE[ST.level]; }
function generateNew(opts = {}) {
  if (ST.m) return;
  if (S.hooks.generate) S.hooks.generate();
  commitUndo();                                                       // DD-031
  let m = opts.msg || lastMsg();                                      // opts.msg: regenerate in place (a failed reply's 다시 시도)
  if (!m || m.role !== 'char' || opts.newMsg) { m = { id: ++S.seq, role: 'char', alts: [], idx: 0, bookmarked: false, hidden: false, streaming: false, saying: opts.saying }; S.msgs.push(m); $('.genrow')?.remove(); }
  FAILCTX.m = m; FAILCTX.prevIdx = m.idx; FAILCTX.prevCount = m.alts.length;   // what failReply restores: a failed generation is not a swipe
  m.alts.push({ en: '', ko: '' }); m.idx = m.alts.length - 1; m.streaming = true; queueRuns();
  S.streaming = true;
  if (!msgEl(m)) { if (S.hooks.append) S.hooks.append(m); else thread().appendChild(renderMsg(m, S.msgs.indexOf(m))); } else rerenderMsg(m);
  refreshAll(); const el = msgEl(m); setActive(el);
  const { full, holds } = opts.manual ? { full: '', holds: [] } : ((S.hooks.plan && S.hooks.plan(m, opts)) || buildPlan(S.lang));
  Object.assign(ST, { m, raw: '', full, holds, pos: 0, hi: 0, holdUntil: 0, dirty: true, lastRender: 0, renders: [], durs: [], remounts: 0, phase: '', manual: !!opts.manual, fast: 0, longest: 0 });
  setLevel(0); syncSend();
  $('.reply-body', el).replaceChildren(); updateCV();
  if (!ST.manual) { ST.timer = setInterval(streamTick, 40); ST.raf = requestAnimationFrame(streamFrame); }
  if (S.atBottom) scrollBottom();
  log('stream start (' + (S.today ? "today's behaviour" : 'streaming-safe view') + ')');
  if (S.hooks.started) S.hooks.started(m, opts);                       // slice 3: scripted group replies drive their own pace
  if (FAIL.next && !opts.manual) { const f = FAIL.next; FAIL.next = null; setTimeout(() => { if (ST.m === m) failReply(m.id, f.opts); }, f.after); }   // demo: the next generation fails after f.after ms
  return m;
}
function streamTick() {
  const t0 = now(); if (t0 < ST.holdUntil) return;
  const h = ST.holds[ST.hi];
  if (h && ST.pos >= h.at) { ST.hi++; ST.phase = h.phase; ST.holdUntil = ST.hold === h.phase ? Infinity : t0 + h.ms; log('hold: ' + h.phase); return; }
  const lim = h ? h.at : ST.full.length; const next = Math.min(ST.pos + 5, lim);
  ST.raw = ST.full.slice(0, next); ST.pos = next; ST.dirty = true;
  if (S.today) renderStream(t0);              // today: every chunk
  if (ST.pos >= ST.full.length) finishStream(false);
}
function streamFrame() {
  if (!ST.m) return;
  try { if (ST.dirty && !S.today && now() - ST.lastRender >= ST.interval) renderStream(now()); } catch (e) { console.error(e); }
  ST.raf = requestAnimationFrame(streamFrame);
}
function renderStream(t0) {
  const m = ST.m; if (!m) return; const el = msgEl(m); if (!el) return;
  const body = $('.reply-body', el); const keep = S.atBottom; const ts = now();
  ST.renders.push(Math.round(t0)); ST.lastRender = t0; ST.dirty = false;
  if (S.renderComplete) {
    if (!body.firstChild) body.innerHTML = `<div class="blk"><span class="chip chip-wait">${ic('loader', 16, 'spin')}<span class="lbl"></span></span></div>`;
    $('.lbl', body).textContent = t('writingReply', { n: ST.raw.length });
  } else if (S.today) {
    // today: whole message remounts each chunk, raw text, unclosed <style> hidden but its partial CSS applies
    const si = ST.raw.indexOf('<style>'); let shown = ST.raw, css = '';
    if (si >= 0) { shown = ST.raw.slice(0, si); const e = ST.raw.indexOf('</style>'); css = ST.raw.slice(si + 7, e < 0 ? undefined : e); if (e >= 0) shown += ST.raw.slice(e + 8); }
    body.innerHTML = `<div class="blk text">${shown.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => '<p>' + inline(p).replace(/\n/g, '<br>') + '</p>').join('')}</div>`; ST.remounts++;
    setScopedStyle(el, m, css);
  } else {
    const segs = tokenize(ST.raw);
    reconcile(body, segs, 'stream');
    setScopedStyle(el, m, styleOf(segs));
    $$('.caret', body).forEach((c) => c.classList.remove('caret'));
    const texts = $$('.blk.text', body); if (texts.length && segs.length && segs[segs.length - 1].type === 'text') texts[texts.length - 1].classList.add('caret');
  }
  if (ST.burn) { const b = now(); while (now() - b < ST.burn) { /* test hook: simulate a slow device */ } }
  const dur = now() - ts; ST.durs.push(+dur.toFixed(2)); ST.longest = Math.max(ST.longest, dur);
  // adaptive cadence: 100, then 250, then 500 ms when a render takes longer than 8 ms; back to 100 after five fast renders (low power: 250 minimum)
  if (dur > 8) { ST.fast = 0; setLevel(ST.level + 1); } else if (++ST.fast >= 5 && ST.level > minLevel()) { ST.fast = 0; setLevel(minLevel()); } else if (ST.level < minLevel()) setLevel(minLevel());
  if (keep) scrollBottom();
}
// the end-of-stream path tolerates a missing message and always clears the stream state (spec 5.6)
function finishStream(stopped) {
  const m = ST.m; if (!m) return;
  try {
    clearInterval(ST.timer); cancelAnimationFrame(ST.raf);
    const raw = stopped ? ST.raw : (ST.manual ? ST.raw : ST.full);
    if (S.msgs.includes(m)) {
      const closed = tokenizeClosedRaw(raw, stopped);
      m.alts[m.idx][S.lang] = closed; if (!m.alts[m.idx].en) m.alts[m.idx].en = closed; if (!m.alts[m.idx].ko) m.alts[m.idx].ko = closed;
    }
    m.streaming = false; queueRuns();
    const el = msgEl(m);
    if (el && S.msgs.includes(m)) {
      const keep = S.atBottom; const body = $('.reply-body', el);
      // completion: the full pipeline runs once; changed blocks crossfade
      const segs = tokenize(m.alts[m.idx][S.lang], true);
      if (S.today || S.renderComplete) renderFull(el, m, m.alts[m.idx][S.lang]);
      else { reconcile(body, segs, 'final'); setScopedStyle(el, m, styleOf(segs)); $$('.caret', body).forEach((c) => c.classList.remove('caret')); }
      fillMsg(el, m, S.msgs.indexOf(m), { keepBody: true }); markPre(el);
      setActive(el); if (keep) scrollBottom();
      if (!(S.hooks.quietReply && S.hooks.quietReply(m))) announce(isFirstMsg(m) ? t('firstMessageOf', { n: m.idx + 1, total: m.alts.length }) : t('replyOf', { n: m.idx + 1, total: m.alts.length }));
    }
    log('stream ' + (stopped ? 'stopped' : 'finished') + ': ' + ST.renders.length + ' renders, ' + ST.remounts + ' remounts, longest ' + ST.longest.toFixed(1) + ' ms');
  } catch (e) {
    console.error(e);
  } finally {
    ST.m = null; S.streaming = false; clearInterval(ST.timer); cancelAnimationFrame(ST.raf);
    try { syncSend(); showHeader(); refreshAll(); } catch (e) { console.error(e); }
    try { if (S.hooks.streamEnd) S.hooks.streamEnd(m, stopped); } catch (e) { console.error(e); }
  }
}
function tokenizeClosedRaw(raw, stopped) {
  if (!stopped) return raw;
  return tokenize(raw, true).map((s) => s.type === 'text' ? s.text : s.type === 'thought' ? '<Thoughts>' + s.text + '</Thoughts>' : s.type === 'fence' ? '```' + s.lang + '\n' + s.text + '\n```' : s.type === 'style' ? '<style>' + s.text + '</style>' : s.type === 'css' ? s.text : '{{img::x}}').join('\n\n');
}
// slice 2: hand a running reply to a background job and take it back (the data stays in the message; only the on-screen stream stops)
function detachStream() {
  const m = ST.m; if (!m || ST.manual) return null; const out = { m, full: ST.full, pos: ST.pos, raw: ST.raw };
  clearInterval(ST.timer); cancelAnimationFrame(ST.raf); m.alts[m.idx][S.lang] = ST.raw || ''; m.streaming = false; queueRuns(); ST.m = null; S.streaming = false;
  try { syncSend(); } catch (_) {} return out;
}
function attachStream(m, full, pos) {
  Object.assign(ST, { m, raw: full.slice(0, pos), full, holds: [], pos, hi: 0, holdUntil: 0, dirty: true, lastRender: 0, renders: [], durs: [], remounts: 0, phase: '', manual: false, fast: 0, longest: 0 });
  m.streaming = true; queueRuns(); S.streaming = true; setLevel(0); syncSend(); refreshAll(); const el = msgEl(m); if (el) { rerenderMsg(m); $('.reply-body', el).replaceChildren(); }
  ST.timer = setInterval(streamTick, 40); ST.raf = requestAnimationFrame(streamFrame);
}
function stopStream() { if (ST.m) finishStream(true); }
// test hooks: drive the streaming view without timers
function feed(raw, final = false) { if (!ST.m) generateNew({ manual: true }); ST.raw = raw; ST.dirty = true; renderStream(now()); if (final) finishStream(false); }

/* ------------------------------------------------------------------ failed replies and the action toast (HOOKS1_SPEC A; Settings DS-043)
   window.__chat.failReply(msgId, { reason: 'key'|'model'|'quota'|'network'|'server', fix: 'key'|'model'|null, conn, detail? }) replaces the streaming reply with an inline error card.
   The failed reply keeps its place, is not a swipe (the generation's empty alternative is dropped) and is not part of historyOf(). Single-reply path only (slice 3 group rounds drive their own streams). */
const FAIL_REASONS = ['key', 'model', 'quota', 'network', 'server'];
const FC_REASON_KEY = { key: 'fcReason_key', model: 'fcReason_model', quota: 'fcReason_quota', network: 'fcReason_network', server: 'fcReason_server' };      // literal keys, so the key-parity check can see them
const FAIL_ROWS = ['main', 'sub', 'mem', 'trans', 'emo', 'suggest', 'other'];      // DS-063: which model row failed
const FAIL = { next: null, key: 'hk1.failed' };
const FAILCTX = { m: null, prevIdx: 0, prevCount: 0 };
// the ids are Settings' own (settings/data3.js, default demo set): c-google fails its key test (badkey), c-openrouter is the quota case, c-anthropic is a hosted connection (model and server cases), c-home is address-based (unreachable)
const DEMO_FAIL = {
  key: { reason: 'key', fix: 'key', conn: 'c-google', detail: 'HTTP 401' },
  model: { reason: 'model', fix: 'model', conn: 'c-anthropic', detail: 'claude-sonnet-45 · 404', model: 'claude-sonnet-45', row: 'main' },      // model/row (DS-063): claude-sonnet-45 is a model of c-anthropic (settings/data.js catalog 'Anthropic', used by data3.js), row main
  quota: { reason: 'quota', fix: 'key', conn: 'c-openrouter', detail: 'HTTP 429' },
  network: { reason: 'network', fix: null, conn: 'c-anthropic', detail: '' },                  // a hosted provider: nothing in Settings fixes a network error (DS-056)
  networkAddr: { reason: 'network', fix: 'address', conn: 'c-home', detail: 'ECONNREFUSED' },   // an address-based connection: the address row (DS-056)
  server: { reason: 'server', fix: null, conn: 'c-anthropic', detail: 'HTTP 503' },
};
// simulated persistence: the failed reply survives the round trip through Settings only in this tab's sessionStorage (a real build keeps the message in the chat)
const stashRead = () => { try { return JSON.parse(sessionStorage.getItem(FAIL.key) || '[]'); } catch (_) { return []; } };
const stashWrite = (a) => { try { sessionStorage.setItem(FAIL.key, JSON.stringify(a.slice(-10))); } catch (_) {} };
const stashSet = (m) => stashWrite(stashRead().filter((x) => String(x.id) !== String(m.id)).concat([{ id: m.id, ...m.fail }]));
const stashDrop = (m) => stashWrite(stashRead().filter((x) => String(x.id) !== String(m.id)));
const historyOf = () => S.msgs.filter((x) => !x.fail);                // what a request would send: failed replies are never history
const settingsHref = (m) => `../settings/slice3.html?fix=${encodeURIComponent(m.fail.fix)}&conn=${encodeURIComponent(m.fail.conn)}&reason=${encodeURIComponent(m.fail.reason)}${m.fail.reason === 'model' && m.fail.model && m.fail.row ? `&model=${encodeURIComponent(m.fail.model)}&row=${m.fail.row}` : ''}&back=chat&msg=${encodeURIComponent(m.id)}&lang=${S.lang}`;      // lang: Settings carries it back (DD-139)
function abortStream(m) {                                             // stop without committing text; drop the empty alternative so the failure is not a swipe
  clearInterval(ST.timer); cancelAnimationFrame(ST.raf);
  if (FAILCTX.m === m) { m.alts.splice(FAILCTX.prevCount); m.idx = Math.max(0, Math.min(FAILCTX.prevIdx, m.alts.length - 1)); } else { m.alts.pop(); m.idx = Math.max(0, Math.min(m.idx, m.alts.length - 1)); }
  ST.m = null; S.streaming = false; m.streaming = false; queueRuns();
}
const markFailed = (m, fail) => { m.fail = fail; m.fcReturn = false; stashSet(m); };
const cleanFail = (o) => ({ reason: FAIL_REASONS.includes(o.reason) ? o.reason : 'server', fix: o.fix === 'key' || o.fix === 'model' || (o.fix === 'address' && o.reason === 'network') ? o.fix : null,      // fix: key | model | address (a network error on an address-based connection only) | null
   conn: o.conn == null ? '' : String(o.conn), detail: o.detail ? String(o.detail) : '', ...(o.reason === 'model' ? { model: o.model != null && String(o.model) !== '' ? String(o.model) : '', row: FAIL_ROWS.includes(o.row) ? o.row : '' } : {}) });      // model (opaque id) and row only for reason model; an invalid row is dropped
// failReply(msgId, { reason, fix, conn, detail?, chat? }): chat (DD-133) names the chat the reply belongs to; a failure in a chat that is not open waits in that chat and shows the same card when it is opened (slice 2 hook failElsewhere)
function failReply(msgId, o = {}) {
  const fail = cleanFail(o);
  if (o.chat != null && S.hooks.failElsewhere) { const r = S.hooks.failElsewhere(o.chat, msgId, fail); if (r !== false) return !!r; }
  const m = S.msgs.find((x) => String(x.id) === String(msgId)); if (!m) { log('failReply: no message ' + msgId); return false; }
  if (m.role !== 'char') { log('failReply: message ' + msgId + ' is not a reply'); return false; }
  const reason = fail.reason, fix = fail.fix;
  const was = ST.m === m; if (was) abortStream(m); else m.streaming = false; queueRuns();
  markFailed(m, fail);
  const el = msgEl(m); const keep = S.atBottom;
  if (el) { setScopedStyle(el, m, ''); fillMsg(el, m, S.msgs.indexOf(m)); setActive(el); }
  try { syncSend(); showHeader(); refreshAll(); } catch (e) { console.error(e); }
  if (keep) scrollBottom();
  if (was) { try { if (S.hooks.streamEnd) S.hooks.streamEnd(m, true); } catch (e) { console.error(e); } }
  log('reply failed: ' + reason + (fix ? ' (fix ' + fix + ')' : '')); return true;
}
function renderFail(a, m) {
  const body = $('.reply-body', a); const f = m.fail; const sig = [m.id, f.reason, f.fix || '', f.conn, f.detail, f.model || '', f.row || ''].join('|');
  let card = $('.failcard', body);
  if (!card || card.dataset.sig !== sig) {
    body.replaceChildren(); setScopedStyle(a, m, '');
    card = document.createElement('div'); card.className = 'blk failcard'; card.setAttribute('role', 'alert'); card.tabIndex = -1; card.dataset.sig = sig; card.dataset.reason = f.reason; card.setAttribute('data-part', 'chat-failed-card'); card.setAttribute('data-part-critical', '');
    card.innerHTML = `<p class="fc-line"><span class="fc-ic">${ic('circle-alert', 20)}</span><span class="fc-txt"><span class="sr-only fc-pre"></span><span class="fc-reason"></span></span></p><p class="fc-detail"></p><div class="fc-actions"></div>`;
    const acts = $('.fc-actions', card);
    if (f.fix) { const lk = document.createElement('a'); lk.className = 'btn fc-fix'; lk.href = settingsHref(m); lk.innerHTML = ic('wrench', 18) + '<span></span>'; acts.appendChild(lk); }
    const rb = document.createElement('button'); rb.type = 'button'; rb.className = 'btn fc-retry'; rb.dataset.act = 'fc-retry'; rb.innerHTML = ic('rotate-ccw', 18) + '<span></span>'; acts.appendChild(rb);
    $$('.btn', card).forEach((b) => { b.tabIndex = a.tabIndex === 0 ? 0 : -1; b.setAttribute('data-part', 'chat-critical-action'); }); $$('.fc-line, .fc-detail', card).forEach((e) => e.setAttribute('data-part', 'chat-critical-body'));
    body.appendChild(card);
  }
  // labels follow the UI language and are updated in place: the alert node stays, so a language switch does not announce it again
  $('.fc-pre', card).textContent = t('fcFailed') + ': '; $('.fc-reason', card).textContent = t(FC_REASON_KEY[f.reason]);
  const dt = $('.fc-detail', card); dt.textContent = f.detail ? t('fcDetail', { detail: f.detail }) : ''; dt.hidden = !f.detail;
  const lk = $('.fc-fix span', card); if (lk) { lk.textContent = t('fcFix'); $('.fc-fix', card).setAttribute('href', settingsHref(m)); }      // the link follows the language too
  $('.fc-retry span', card).textContent = t('fcRetry');
}
// "설정을 바꿨어요 · 다시 시도할까요?" after returning from Settings: an inline status row under the card (DD-029: nothing floats over the transcript); never retries by itself
function syncReturnRow(a, m) {
  let row = $('.fc-return', a);
  if (!m.fail || !m.fcReturn) { if (row) row.remove(); return; }
  if (!row) {
    row = document.createElement('div'); row.className = 'fc-return'; row.setAttribute('data-part', 'chat-status-row'); row.setAttribute('role', 'status');
    row.innerHTML = `<span class="fc-rt"></span><button type="button" class="btn fc-rx" data-act="fc-dismiss">${ic('x', 18)}</button>`;      // DD-132: no retry button of its own, the card's 다시 시도 is the one
    $$('.btn', row).forEach((b) => (b.tabIndex = a.tabIndex === 0 ? 0 : -1));
    const alt = $('.altrow', a); if (alt) alt.after(row); else a.appendChild(row);
    setTimeout(() => { if (row.isConnected) $('.fc-rt', row).textContent = t('fcChanged'); }, 40);       // text arrives after insertion so the status region announces it once (like the undo row)
  } else if ($('.fc-rt', row).textContent) $('.fc-rt', row).textContent = t('fcChanged');
  const x = $('.fc-rx', row); x.setAttribute('aria-label', t('fcClose')); x.title = t('fcClose');
}
// the return URL must not bring the card back after a retry, a dismiss or a delete (reload, Back)
function clearReturnParams() { try { if (!Q.get('retry') && Q.get('from') !== 'settings') return; const u = new URL(location.href); ['from', 'retry', 'changed', 'reason', 'fix', 'conn'].forEach((k) => u.searchParams.delete(k)); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (_) {} }
function retryFail(m, source = 'card') {                              // 다시 시도: regenerate in place; the same message, a fresh alternative
  if (!m || !m.fail || ST.m) return false;
  if (S.sendBlock) { toast(S.sendBlock); return false; }
  m.fail = null; m.fcReturn = false; stashDrop(m); clearReturnParams();
  const r = generateNew({ msg: m }); const el = msgEl(m); if (el) el.focus({ preventScroll: true });
  log('retry in place (' + source + ')'); return !!r;
}
function failNext(opts, after = 700) { FAIL.next = opts ? { opts, after } : null; }
function demoFail(reason, o = {}) {                                   // start a reply that fails: after o.after ms (default 700), or at once with o.immediate; o.regen = a new alternative on the last reply instead of a new reply
  const f = Object.assign({}, DEMO_FAIL[reason] || DEMO_FAIL.server, o.override || {});
  if (o.immediate) { const m = generateNew(o.regen ? {} : { newMsg: true }); if (m) failReply(m.id, f); return m; }
  failNext(f, o.after == null ? 700 : o.after); return generateNew(o.regen ? {} : { newMsg: true });
}
// slice1.html?from=settings&retry=<msgId>: the chat reopens with focus on that card and the "설정을 바꿨어요" row; nothing is retried
const focusRetry = (el) => { const b = $('.failcard .fc-retry', el) || $('.failcard', el); if (b) b.focus({ preventScroll: true }); };
function restoreFromSettings() {
  const id = Q.get('retry'); if (Q.get('from') !== 'settings' || !id) return false;
  let m = S.msgs.find((x) => String(x.id) === String(id));
  if (!m || !m.fail) {
    const st = stashRead().find((x) => String(x.id) === String(id)); const rq = Q.get('reason');
    const f = st || { reason: FAIL_REASONS.includes(rq) ? rq : 'key', fix: ['key', 'model'].includes(Q.get('fix')) || (Q.get('fix') === 'address' && rq === 'network') ? Q.get('fix') : Q.get('fix') === null ? (rq === 'model' ? 'model' : (!rq || rq === 'key' || rq === 'quota') ? 'key' : null) : null, conn: Q.get('conn') || '', detail: '' };
    const n = Number(id); const nid = m ? ++S.seq : (Number.isFinite(n) && String(n) === String(id) ? n : id); if (m) log('retry id collides with an existing reply; a new failed reply was added');
    if (typeof nid === 'number') S.seq = Math.max(S.seq, nid);
    m = { id: nid, role: 'char', alts: [], idx: 0, bookmarked: false, hidden: false, streaming: false, fail: { reason: f.reason, fix: f.fix || null, conn: f.conn || '', detail: f.detail || '', ...(f.reason === 'model' ? { model: f.model || '', row: FAIL_ROWS.includes(f.row) ? f.row : '' } : {}) } };
    S.msgs.push(m);
  }
  m.fcReturn = Q.get('changed') === '1'; renderTranscript(); scrollBottom();      // DS-055: the row only after a Settings change that can affect the failing request
  const el = msgEl(m); if (el) { setActive(el); setTimeout(() => focusRetry(el), 60); }
  log('returned from Settings for ' + id); return true;
}
// a status row with buttons above the composer (switch undo, empty slot, model change; DD-130: nothing floats over the transcript, like the delete undo row and the return row).
// One at a time; the timer pauses while the pointer or focus is inside and resumes with the time left; text is set after insertion so it is announced once.
// An action with undo: true is also run by Alt+Z from anywhere, text fields included (DD-131; Ctrl+Z stays with text fields and slice 1's delete undo).
const AT = { el: null, timer: 0, left: 0, started: 0, holds: new Set(), onClose: null, undo: null };
function actionToast({ text, actions = [], ms = 10000, onClose } = {}) {
  closeActionToast(false);
  let el = $('#atoast'); if (!el) { el = document.createElement('div'); el.id = 'atoast'; el.className = 'atoast'; el.setAttribute('data-part', 'chat-status-row'); el.hidden = true; el.setAttribute('role', 'status'); $('#main').insertBefore(el, $('#composer')); el.addEventListener('pointerenter', () => holdAT('hover', true)); el.addEventListener('pointerleave', () => holdAT('hover', false)); el.addEventListener('focusin', () => holdAT('focus', true)); el.addEventListener('focusout', () => holdAT('focus', false)); }
  AT.el = el; AT.onClose = onClose || null; AT.holds.clear(); AT.left = ms; AT.undo = null; el.hidden = false;
  el.innerHTML = '<span class="at-text"></span><span class="at-actions"></span>'; const box = $('.at-actions', el);
  actions.forEach((a) => {
    const b = a.href ? document.createElement('a') : document.createElement('button'); if (a.href) b.href = a.href; else b.type = 'button'; b.className = 'btn at-btn';
    b.innerHTML = (a.icon ? ic(a.icon, 18) : '') + '<span></span>'; $('span', b).textContent = a.label; if (a.title) b.title = a.title;
    if (a.undo) { AT.undo = a; b.setAttribute('aria-keyshortcuts', 'Alt+Z'); b.title = (a.title || a.label) + ' (Alt+Z)'; }
    b.addEventListener('click', () => { if (a.run) a.run(); if (a.close !== false) closeActionToast(true); }); box.appendChild(b);
  });
  void el.offsetWidth; el.classList.add('show'); layoutDock();
  setTimeout(() => { if (AT.el === el && el.classList.contains('show')) $('.at-text', el).textContent = text; }, 40);
  if (ms > 0) startAT(); log('status row: ' + text);
  return { close: () => closeActionToast(true), el };
}
function startAT() { clearTimeout(AT.timer); AT.started = now(); AT.timer = setTimeout(() => closeActionToast(true), AT.left); }
function holdAT(key, on) {
  if (!AT.el || !AT.el.classList.contains('show') || AT.left <= 0) return; const was = AT.holds.size > 0; on ? AT.holds.add(key) : AT.holds.delete(key); const is = AT.holds.size > 0;
  if (!was && is) { clearTimeout(AT.timer); AT.left = Math.max(800, AT.left - (now() - AT.started)); } else if (was && !is) startAT();
}
function closeActionToast(animate = true) {
  clearTimeout(AT.timer); const el = AT.el; if (!el) return; const cb = AT.onClose; AT.onClose = null; AT.undo = null; AT.holds.clear();
  const had = el.contains(document.activeElement); el.classList.remove('show');
  if (!animate || S.rm) { el.hidden = true; layoutDock(); } else setTimeout(() => { if (!el.classList.contains('show')) { el.hidden = true; layoutDock(); } }, durOf('fast') + 40);
  AT.el = null; if (had) { const f = activeEl() || $('#input'); try { f.focus({ preventScroll: true }); } catch (_) {} }
  if (cb) { try { cb(); } catch (e) { console.error(e); } }
}

/* ------------------------------------------------------------------ edge zones (spec 1): decided from the pointerdown x, no overlay, no touch-action:none on content */
function edgeSide(x) {
  const ar = $('#app').getBoundingClientRect(); const rx = x - ar.left; const z = edgeInset() + 24;   // system inset + 24 dp, mirrored to the right
  if (rx < z) return 'left'; if (rx > ar.width - z) return 'right'; return '';
}
const sbZone = (x) => { const ar = $('#app').getBoundingClientRect(); const rx = x - ar.left; return rx >= edgeInset() && rx < edgeInset() + 24; };
// release / current velocity in px per ms; samples older than 80 ms mean the finger is still
function velocity(samples, axis = 'x') {
  const n = now(); const w = (samples || []).filter((s) => n - s.t <= 120);      // only the last 120 ms count; a held finger has no samples there
  if (w.length < 2) return 0; const a = w[0], b = w[w.length - 1];
  if (n - b.t > 80) return 0; return b.t > a.t ? (b[axis] - a[axis]) / (b.t - a.t) : 0;
}
const pushSample = (arr, e) => { arr.push({ t: now(), x: e.clientX, y: e.clientY }); while (arr.length > 2 && now() - arr[0].t > 120) arr.shift(); };
function scrollsSideways(target, stop) {
  for (let el = target; el && el !== stop; el = el.parentElement) { if (el.nodeType !== 1) continue; if (el.scrollWidth > el.clientWidth + 1) { const o = getComputedStyle(el).overflowX; if (o === 'auto' || o === 'scroll') return true; } }
  return false;
}

/* ------------------------------------------------------------------ swipe through alternatives (spec 3) */
const D = { active: false };
const gap = 8, ARM_DP = 160, ARM_HOLD = 300;
function resist(raw, W) { const a = Math.abs(raw), s = Math.sign(raw); return s * (a <= 0.4 * W ? a : 0.4 * W + (a - 0.4 * W) * 0.35); }
const swipeable = (m) => S.swipeOn && !m.fail && ((isNewestChar(m)) || (isFirstMsg(m) && m.alts.length > 1));
const armable = (m) => !m.fail && isNewestChar(m) && !isFirstMsg(m) && !m.streaming && !ST.m && !S.sendBlock;

function dragStart(e, el, m, longPress, target) {
  const stage = $('.stage', el); const edge = edgeSide(e.clientX);
  Object.assign(D, { active: true, id: e.pointerId, el, m, stage, card: $('.card', stage), peek: $('.peek', stage), chip: $('.edge-chip', stage), x0: e.clientX, y0: e.clientY, t0: now(), dx: 0, locked: null, samples: [], armed: false, armTimer: 0, holdStart: 0, mode: '', meter: $('.meter', stage), fill: 0, mRaf: 0, raf: 0, W: stage.clientWidth, edge, canSwipe: swipeable(m) && !edge && e.pointerType !== 'mouse' && !scrollsSideways(target, stage), longPress, lpDone: false, ringT: 0, fireT: 0, peekDir: 0 });
  pushSample(D.samples, e);
  if (longPress) {
    const r = $('.lp-ring', el); const er = el.getBoundingClientRect();
    r.style.left = e.clientX - er.left + 'px'; r.style.top = e.clientY - er.top + 'px';
    D.ringT = setTimeout(() => { if (D.active && !D.lpDone) { r.classList.remove('run'); void r.offsetWidth; r.classList.add('run'); } }, 200);
    D.fireT = setTimeout(() => { if (!D.active || D.locked === 'x') return; D.lpDone = true; endRing(); const opener = el; dragAbort(); openActions(m, opener); }, 500);
  }
}
function endRing() { clearTimeout(D.ringT); clearTimeout(D.fireT); const r = D.el && $('.lp-ring', D.el); if (r) r.classList.remove('run'); }
function dragMove(e) {
  if (!D.active || e.pointerId !== D.id) return;
  const dx = e.clientX - D.x0, dy = e.clientY - D.y0; D.dx = dx; pushSample(D.samples, e);
  if (!D.locked) {
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) endRing();
    if (Math.abs(dx) > 10 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
      if (!D.canSwipe) { D.locked = 'no'; return; }
      D.locked = 'x'; D.stage.classList.add('dragging'); D.card.classList.add('drag'); try { D.stage.setPointerCapture(e.pointerId); } catch (_) {}
    } else if (Math.abs(dy) > 10) { D.locked = 'y'; endRing(); dragAbort(); return; }
    else return;
  }
  if (D.locked !== 'x') return;
  if (e.cancelable) e.preventDefault();
  if (!D.raf) D.raf = requestAnimationFrame(paintDrag);
}
function paintDrag() { D.raf = 0; if (!D.active || D.locked !== 'x') return; paintDragAt(D.dx); }
function paintDragAt(raw) {
  const { m, W, card, peek, chip } = D; const N = m.alts.length, idx = m.idx; const dir = raw < 0 ? -1 : 1;
  if (m.streaming) {                                           // a swipe on a streaming message: 24 dp rubber band and a note
    D.mode = 'busy'; card.style.transform = `translate3d(${dir * tokNum('--swipe-nudge') * Math.tanh(Math.abs(raw) / 80)}px,0,0)`;
    peek.classList.remove('on'); setChip(false, t('stillWriting'), 'loader'); return;
  }
  const hasNb = dir < 0 ? idx < N - 1 : idx > 0;
  D.mode = hasNb ? 'normal' : dir > 0 ? 'first' : armable(m) ? 'past' : 'end';
  const off = hasNb ? resist(raw, W) : raw * 0.35;
  card.style.transform = `translate3d(${off}px,0,0)`;
  if (hasNb) {
    if (D.peekDir !== dir) { D.peekDir = dir; const nb = idx + (dir < 0 ? 1 : -1); $('.peek-text', peek).textContent = altText(m, nb).replace(/[*`#]/g, '').replace(/\n+/g, ' '); $('.peek-chip', peek).textContent = `${nb + 1} / ${N}`; peek.classList.toggle('from-right', dir < 0); peek.classList.toggle('from-left', dir > 0); }
    peek.classList.add('on'); peek.style.transform = `translate3d(${off - dir * (W + gap)}px,0,0)`; chip.classList.remove('show'); D.armed = false;
  } else {
    peek.classList.remove('on'); D.peekDir = 0;
    if (D.mode === 'first') setChip(false, t('firstReply'), 'chevron-left');
    else if (D.mode === 'end') setChip(false, S.sendBlock && isNewestChar(D.m) ? S.sendBlock : t('lastReply'), 'chevron-right');
    else { armCheck(); paintMeter(); renderChip(); }
  }
  if (D.mode !== 'past') hideMeter();
}
// DD-033: a fill meter (ring + refresh-cw) beside the trailing edge: 0 -> 70 % with the pull to 160 dp, 70 -> 100 % over the 300 ms hold; full = armed
const RING = 2 * Math.PI * 15;
function meterFill() { const d = Math.max(0, -D.dx); if (D.armed) return 1; if (d < ARM_DP) return 0.7 * d / ARM_DP; return 0.7 + (D.holdStart ? 0.3 * Math.min(1, (now() - D.holdStart) / ARM_HOLD) : 0); }
function paintMeter() {
  const mt = D.meter; if (!mt) return; let f = meterFill();
  if (S.rm || S.lp) f = D.armed ? 1 : Math.floor(f * 4) / 4;            // reduced motion / low power: a static ring that fills in steps, no rotation
  D.fill = f; mt.classList.add('show'); mt.classList.toggle('full', !!D.armed); mt.dataset.fill = f.toFixed(2);
  $('.arc', mt).style.strokeDashoffset = String(RING * (1 - f));
  $('.mi', mt).style.transform = S.rm || S.lp ? '' : `rotate(${Math.round(f * tokNum('--angle-turn'))}deg)`;
}
function hideMeter() { const mt = D.meter; cancelAnimationFrame(D.mRaf); if (mt) mt.classList.remove('show', 'full'); }
function meterLoop() { cancelAnimationFrame(D.mRaf); const step = () => { if (!D.active || D.mode !== 'past') return; paintMeter(); if (D.holdStart && !D.armed) D.mRaf = requestAnimationFrame(step); }; D.mRaf = requestAnimationFrame(step); }
// DD-021: armed only after the finger is held more than 160 dp past the start for 300 ms at under 0.15 px/ms
function armCheck() {
  if (!D.active || D.mode !== 'past') return;
  const beyond = D.dx < -ARM_DP;
  if (!beyond) { D.holdStart = 0; clearTimeout(D.armTimer); D.armTimer = 0; setArmed(false); return; }
  if (D.armed) return;
  if (velocity(D.samples) < 0.15) {
    if (!D.holdStart) { D.holdStart = now(); clearTimeout(D.armTimer); D.armTimer = setTimeout(armCheck, ARM_HOLD + 8); meterLoop(); }
    else if (now() - D.holdStart >= ARM_HOLD) setArmed(true);
  } else { D.holdStart = 0; clearTimeout(D.armTimer); D.armTimer = setTimeout(armCheck, 110); }
}
function setChip(armed, label, icon) { const c = D.chip; c.className = 'edge-chip chip show' + (armed ? ' accent' : ''); c.innerHTML = ic(icon, 16) + '<span>' + esc(label) + '</span>'; }
function renderChip() { if (D.armed) setChip(true, t('releaseToGenerate'), 'refresh-cw'); else setChip(false, t('noMoreSaved'), 'chevron-right'); }
function setArmed(v) { if (D.armed === v) return; D.armed = v; if (v) { haptic('armed'); announce(t('releaseToGenerate')); } paintMeter(); renderChip(); }
function dragEnd(e, cancelled) {
  if (!D.active || (e && e.pointerId !== D.id)) return;
  endRing(); clearTimeout(D.armTimer); D.armTimer = 0; hideMeter();
  const wasX = D.locked === 'x'; const m = D.m;
  if (!wasX) { D.active = false; return; }
  D.active = false; D.stage.classList.remove('dragging');
  const dx = D.dx, W = D.W, dir = dx < 0 ? -1 : 1;
  const v = velocity(D.samples); const fling = Math.abs(v) > 0.5 && Math.sign(v) === dir;
  const commitIt = !cancelled && D.mode === 'normal' && (Math.abs(dx) > 0.3 * W || fling);
  const armed = !cancelled && D.mode === 'past' && D.armed && Math.abs(v) <= 0.5;      // a fast release never generates, armed or not
  log(`release: mode=${D.mode} dx=${Math.round(dx)} v=${v.toFixed(2)} armed=${D.armed} ${commitIt ? 'COMMIT' : armed ? 'ARMED-GENERATE' : 'cancel'}`);
  D.armed = false;
  if (commitIt) commitSwipe(dir); else springBack(armed);
}
function dragAbort() { endRing(); clearTimeout(D.armTimer); if (D.active && D.locked === 'x') { D.active = false; springBack(false); } D.active = false; }
function cleanupDrag(stage, card, peek, chip) {
  hideMeter();
  card.classList.remove('settle', 'spring', 'drag', 'fade'); card.style.transform = ''; card.style.opacity = ''; peek.classList.remove('on', 'settle'); peek.style.transform = ''; peek.style.opacity = ''; chip.classList.remove('show', 'accent'); stage.classList.remove('dragging'); D.peekDir = 0;
}
function afterTransition(el, fn, ms) { let done = false; const f = () => { if (done) return; done = true; el.removeEventListener('transitionend', h); fn(); }; const h = (e) => { if (e.target === el) f(); }; el.addEventListener('transitionend', h); setTimeout(f, ms + 90); }
const durOf = (name) => { const p = $('#probe'); p.style.transitionDuration = `var(--chat-dur-${name})`; return parseFloat(getComputedStyle(p).transitionDuration) * 1000; };
function springBack(armed) {
  const { m, stage, card, peek, chip, W } = D; const lowfx = S.rm || S.lp;
  const go = () => { cleanupDrag(stage, card, peek, chip); if (armed) newReply('pull'); };   // DD-033: the message is back in the centre, then N+1 streams in it
  if (S.rm && !armed) { go(); return; }                                                       // reduced motion: an unarmed cancel is instant, an armed return is a 120 ms move
  card.classList.add(lowfx ? 'settle' : 'spring'); card.style.transform = 'translate3d(0,0,0)';
  peek.classList.add('settle'); peek.style.transform = `translate3d(${D.peekDir ? -D.peekDir * (W + gap) : 0}px,0,0)`; peek.style.opacity = '0';
  chip.classList.remove('show');
  afterTransition(card, go, durOf('slow'));
}
function commitSwipe(dir) {
  const { m, stage, card, peek, chip, W } = D; const target = m.idx + (dir < 0 ? 1 : -1);
  haptic('commit'); const ms = durOf('slow'); const crossfade = S.rm || S.lp;
  const finish = () => {
    m.idx = target; armGuard(); cleanupDrag(stage, card, peek, chip);
    const keep = S.atBottom; fillMsg(msgEl(m), m, S.msgs.indexOf(m), { enter: true }); if (keep) scrollBottom();
    announce(isFirstMsg(m) ? t('firstMessageOf', { n: target + 1, total: m.alts.length }) : t('replyOf', { n: target + 1, total: m.alts.length }));
  };
  if (crossfade) { peek.classList.remove('on'); card.classList.add('fade'); card.style.opacity = '0'; afterTransition(card, finish, ms); }
  else { card.classList.add('settle'); card.style.transform = `translate3d(${dir * (W + gap)}px,0,0)`; peek.classList.add('settle'); peek.style.transform = 'translate3d(0,0,0)'; afterTransition(card, finish, ms); }
}
function previewArmed() {
  const m = lastMsg(); m.idx = m.alts.length - 1; rerenderMsg(m); scrollBottom();
  const el = msgEl(m); const stage = $('.stage', el);
  Object.assign(D, { active: true, locked: 'x', el, m, stage, card: $('.card', stage), peek: $('.peek', stage), chip: $('.edge-chip', stage), W: stage.clientWidth, armed: true, peekDir: 0, dx: -ARM_DP - 30, samples: [] });
  D.card.classList.add('drag'); paintDragAt(-ARM_DP - 30); D.armed = true; renderChip(); D.active = false; log('armed preview (static)');
}

/* ------------------------------------------------------------------ sidebar that follows the finger (spec 4); modal while overlaid */
const SB = { drag: null };
const sbW = () => $('#sidebar').offsetWidth || 306;
function syncInert() {
  const sheet = Sh.open, modalSb = S.sbOpen && !S.desktop;
  $('#main').inert = sheet || modalSb || !!S.homeOpen; $('#skip').inert = sheet || modalSb || !!S.homeOpen;
  $('#sidebar').inert = sheet ? true : (S.desktop ? false : !S.sbOpen);
  const sb = $('#sidebar');
  if (S.desktop) { sb.removeAttribute('role'); sb.removeAttribute('aria-modal'); }
  else { sb.setAttribute('role', 'dialog'); sb.setAttribute('aria-modal', 'true'); }
  sb.setAttribute('aria-label', t('sidebar'));
}
const tokNum = (() => { const c = {}; return (n) => (n in c ? c[n] : (c[n] = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)) || 0)); })();      // a numeric token (opacity) read once; drag code scales it
function sbPaint(p) { const sb = $('#sidebar'), bd = $('#sbBackdrop'); sb.style.transform = `translate3d(${(p - 1) * sbW()}px,0,0)`; bd.style.opacity = String(p * tokNum('--opacity-sidebar-scrim')); bd.style.pointerEvents = p > 0.001 ? 'auto' : 'none'; SB.p = p; }
function sbSettle(open) {
  const sb = $('#sidebar'), bd = $('#sbBackdrop'); sb.classList.add('settle'); bd.classList.add('settle');
  sbPaint(open ? 1 : 0); S.sbOpen = open; syncInert();
  afterTransition(sb, () => { sb.classList.remove('settle'); bd.classList.remove('settle'); sb.dataset.state = open ? 'open' : 'closed'; }, durOf('base'));
  if (open) setTimeout(() => $('.sb-close')?.focus({ preventScroll: true }), 0);
  else if (SB.opener && !S.desktop && SB.restoreFocus) { SB.opener.focus({ preventScroll: true }); SB.restoreFocus = false; }
  $('#sbBtn').setAttribute('aria-expanded', String(open));
  log('sidebar ' + (open ? 'open' : 'closed'));
}
function openSidebar(opener) { if (S.desktop) return; SB.opener = opener || $('#sbBtn'); SB.restoreFocus = true; sbSettle(true); }
function closeSidebar() { if (S.desktop) return; SB.restoreFocus = true; sbSettle(false); }
function sbDown(e, mode) {
  if (S.desktop) return; if (e.pointerType === 'mouse') return; if (e.target.closest && e.target.closest('input[type=range]')) return;
  SB.drag = { id: e.pointerId, mode, x0: e.clientX, y0: e.clientY, locked: null, samples: [], W: sbW(), moved: false, from: e.target };
  pushSample(SB.drag.samples, e);
}
function sbMove(e) {
  const d = SB.drag; if (!d || e.pointerId !== d.id) return;
  const dx = e.clientX - d.x0, dy = e.clientY - d.y0; d.dx = dx; pushSample(d.samples, e);
  if (!d.locked) {
    if (Math.abs(dx) > 10 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
      if ((d.mode === 'open' && dx < 0) || (d.mode === 'close' && dx > 0)) { SB.drag = null; return; }
      d.locked = 'x'; d.moved = true; $('#sidebar').classList.remove('settle'); $('#sbBackdrop').classList.remove('settle'); $('#sidebar').inert = false;
      try { d.from.setPointerCapture(e.pointerId); } catch (_) {}
    } else if (Math.abs(dy) > 10) { SB.drag = null; return; } else return;
  }
  const p = clamp(d.mode === 'open' ? d.dx / d.W : 1 + d.dx / d.W, 0, 1); sbPaint(p);
}
function sbUp(e) {
  const d = SB.drag; if (!d || (e && e.pointerId !== d.id)) return; SB.drag = null;
  if (!d.locked) return;
  SB.suppressClick = true; setTimeout(() => (SB.suppressClick = false), 50);
  const v = velocity(d.samples); const p = SB.p; let open;
  if (e && e.type === 'pointercancel') open = d.mode === 'close';
  else if (d.mode === 'open') open = p > 0.4 || v > 0.4; else open = !(p < 0.6 || v < -0.4);
  log(`sidebar release: progress=${p.toFixed(2)} v=${v.toFixed(2)} -> ${open ? 'open' : 'close'}`);
  SB.restoreFocus = !open; SB.opener = $('#sbBtn'); sbSettle(open);
}
function sbKeys(e) {
  if (e.key !== 'Tab' || !S.sbOpen || S.desktop || Sh.open) return;
  const f = $$('button, input, select, [tabindex="0"]', $('#sidebar')).filter((x) => x.offsetParent !== null && x.tabIndex >= 0 && !x.disabled);
  if (!f.length) return; const first = f[0], last = f[f.length - 1], a = document.activeElement;
  if (!$('#sidebar').contains(a)) { e.preventDefault(); first.focus(); return; }
  if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
}

/* ------------------------------------------------------------------ sheets and menus (spec 5) */
const Sh = { open: false, opener: null, kind: 'sheet', at: 0, arrows: false, gen: 0 };      // gen: counts openSheet calls; a swapSheet keeps it (HOOKS1_SPEC C-3: Back layers belong to one opened sheet)
const isTextField = (el) => !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|)$/.test(el.type)) || el.isContentEditable);
// width (px, optional): the width of the anchored popup on wide screens (default 340, 420 for .tall); a phone sheet ignores it
/* DD-149: a sheet with a danger button (.dangerous) or one that drops data (data-drops-data on a choice) is critical by default. A critical sheet keeps the sheet part and gets
   chat-critical-body on its explanatory text and chat-critical-action on every choice, so the protected children have their own part names. */
function markCritical(body) {
  const sh = body && body.closest ? body.closest('.sheet') : null; if (!sh) return;
  sh.setAttribute('data-part-critical', ''); sheetParts(sh, true);
  $$('.btn.item, .btn.tile', sh).forEach((b) => b.setAttribute('data-part', 'chat-critical-action'));
  $$('.confirm-text', sh).forEach((p) => p.setAttribute('data-part', 'chat-critical-body'));
}
/* the sheet's own header, title and handle are protected children of a critical sheet (DD-155 stopgap): they take the critical part names while it is open and get their own back after */
function sheetParts(sh, critical) { const p = critical ? 'chat-critical-' : 'chat-sheet-'; const g = $('.grab', sh); if (!g) return; g.dataset.part = p + 'header'; const i = $('i', g), h = $('h2', g); if (i) i.dataset.part = p + 'handle'; if (h) h.dataset.part = p + 'title'; }
const autoCritical = (body) => { if ($('.dangerous, [data-drops-data]', body)) markCritical(body); };
function openSheet({ title, build, opener, menu, anchor, cls = '', arrows = false, width = 0 }) {
  const rt = $('#sheetRoot'), sh = $('.sheet', rt);
  Sh.opener = opener || document.activeElement; Sh.open = true; Sh.kind = menu ? 'menu' : 'sheet'; Sh.at = now(); Sh.arrows = arrows; Sh.gen++;
  sh.className = 'sheet ' + cls; sh.removeAttribute('data-part-critical'); sheetParts(sh, false); sh.setAttribute('aria-label', title); if (width) sh.dataset.w = String(width); else delete sh.dataset.w;
  if (menu) { sh.setAttribute('role', 'presentation'); sh.removeAttribute('aria-modal'); } else { sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); }
  $('#sheetTitle').textContent = title;
  const body = $('.sheet-body', rt); body.replaceChildren(); body.className = 'sheet-body';      // HOOKS1_SPEC C-1: a layout class set by one sheet (the toggles panel's tgp-body) must not leak into the next
  body.setAttribute('role', menu ? 'menu' : 'group'); body.setAttribute('aria-labelledby', 'sheetTitle'); build(body); autoCritical(body);
  rt.hidden = false; sh.style.transform = ''; sh.classList.remove('dragging', 'settle'); void rt.offsetWidth; rt.classList.add('open');
  syncInert();
  if (S.desktop && !/\bpanel\b/.test(cls)) placeMenu(sh, anchor, Sh.opener); else { sh.style.maxHeight = ''; sh.style.removeProperty('--ax'); sh.style.removeProperty('--ay'); }
  setTimeout(() => focusIn(body, sh), 0);
}
function focusIn(body, sh) { const f = $('[data-autofocus]', body) || $('button:not([aria-disabled="true"]), input', body) || sh; f.focus({ preventScroll: true }); }
// replace the content of the open sheet (delete confirm, customize); resets the accidental-tap guard
function swapSheet(title, build, cls = '') {
  const rt = $('#sheetRoot'), sh = $('.sheet', rt), body = $('.sheet-body', rt);
  Sh.at = now(); Sh.kind = 'sheet'; sh.className = 'sheet open ' + cls; sh.removeAttribute('data-part-critical'); sheetParts(sh, false); sh.setAttribute('aria-label', title); $('#sheetTitle').textContent = title;
  body.setAttribute('role', 'group'); build(body); autoCritical(body); focusIn(body, sh);
  if (S.desktop) placeMenu(sh, Sh.anchor, Sh.opener);
}
function placeMenu(sh, anchor, opener) {
  sh.style.maxHeight = '';
  const ar = $('#app').getBoundingClientRect(); const w = Math.min(Number(sh.dataset.w) || tokNum(sh.classList.contains('tall') ? '--sheet-width-tall' : '--sheet-width-popup'), ar.width * 0.94); sh.style.width = w + 'px'; const h = sh.offsetHeight; let x, y;
  Sh.anchor = anchor || null;
  if (anchor) { x = anchor.x - ar.left; y = anchor.y - ar.top; if (x + w > ar.width - 8) x -= w; if (y + h > ar.height - 8) y -= h; }
  else {
    let o = opener || $('#input'); if (o.classList && o.classList.contains('msg')) o = $$('[data-act=menu]', o).find((b) => b.offsetParent) || o;
    const r = o.getBoundingClientRect(); x = r.left - ar.left; y = r.bottom - ar.top + 4;
    if (x + w > ar.width - 8) x = r.right - ar.left - w;
    const below = ar.height - 8 - y, above = r.top - ar.top - 4 - 8;
    if (h > below) { if (above > below) { const hh = Math.min(h, above); sh.style.maxHeight = hh + 'px'; y = r.top - ar.top - 4 - hh; } else sh.style.maxHeight = below + 'px'; }
  }
  const h2 = sh.offsetHeight;
  x = Math.min(Math.max(x, 8), ar.width - w - 8); y = Math.min(Math.max(y, 8), Math.max(8, ar.height - h2 - 8));
  sh.style.setProperty('--ax', x + 'px'); sh.style.setProperty('--ay', y + 'px');
}
function closeSheet(restore = true) {
  if (!Sh.open) return; if (S.hooks.beforeClose && S.hooks.beforeClose()) return;       // slice 3: a half-built group asks before it is discarded
  Sh.open = false; const rt = $('#sheetRoot'), sh = $('.sheet', rt); const kind = Sh.kind, opener = Sh.opener;
  rt.classList.remove('open'); syncInert();
  setTimeout(() => { if (!Sh.open) { rt.hidden = true; sh.style.transform = ''; } }, durOf('base') + 60);
  if (restore) { let o = Sh.opener; if (!o || !o.isConnected) o = activeEl() || $('#input'); try { o.focus({ preventScroll: true }); } catch (_) {} }
  // HOOKS1_SPEC C-2: one event for every way a sheet closes (Back, Esc, backdrop, drag, an item, closeSheet from code). Fired after the focus restore.
  try { document.dispatchEvent(new CustomEvent('chat:sheetclosed', { detail: { kind, opener, restored: !!restore } })); } catch (e) { console.error(e); }
}
function item(icon, label, fn, cls = '', attrs = {}) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn item ' + cls; b.setAttribute('data-part', 'chat-sheet-item'); b.innerHTML = (Array.isArray(icon) ? ic(icon[0], 20, icon[1]) : ic(icon, 20)) + '<span>' + esc(label) + '</span>';      // icon may be [name, { fill }] (HOOKS1_SPEC C-8)
  for (const k in attrs) b.setAttribute(k, attrs[k]);
  if (attrs.role === 'menuitem') b.tabIndex = -1;
  b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') === 'true' || now() - Sh.at < 350) return; fn(); }); return b; // the lift after a long-press must not activate the item under the finger
}
function tile(icon, label, fn, { cls = '', reason = '', attrs = {} } = {}) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn tile ' + cls; b.setAttribute('data-part', 'chat-sheet-item');
  b.innerHTML = ic(icon, 20) + '<span class="tl">' + esc(label) + '</span>' + (reason ? `<small class="why">${esc(reason)}</small>` : '');
  if (reason) { b.setAttribute('aria-disabled', 'true'); b.title = label + ': ' + reason; }
  for (const k in attrs) b.setAttribute(k, attrs[k]);
  b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') === 'true' || now() - Sh.at < 350) return; fn(); }); return b;
}
function group(title, id, cls = '') { const g = document.createElement('div'); g.className = 'grp ' + cls; g.setAttribute('role', 'group'); g.setAttribute('aria-labelledby', id); g.innerHTML = `<div class="grp-title sr-only" id="${id}">${esc(title)}</div>`; return g; }

function selectionIn(m) {
  const el = msgEl(m); const s = getSelection(); if (!el || !s || s.isCollapsed || !s.rangeCount) return '';
  return el.contains(s.anchorNode) && el.contains(s.focusNode) ? s.toString().trim() : '';
}
function afterToggle(m) { rerenderMsg(m, { keepBody: true }); }
function runAct(a, m, ctx = {}) { if (reasonOf(a, m)) return; a.run(m, ctx); if (a.id === 'bookmark' || a.id === 'hideAI') afterToggle(m); }
function openActions(m, opener, anchor) {
  const selText = selectionIn(m); const ctx = { selText };
  openSheet({ title: t('msgActions'), opener, anchor, arrows: true, build(body) {
    const mk = (id, title, acts) => { const g = group(title, id, 'tiles'); acts.forEach((a) => { const r = reasonOf(a, m); g.appendChild(tile(a.icon, actLabel(a, m), () => { closeSheet(true); runAct(a, m, ctx); }, { reason: r, attrs: { 'data-aid': a.id } })); }); return g; };
    const g1acts = ACT.filter((a) => a.grp === 1 && scopeOk(a, m)); const short = innerHeight < 700;     // spec 5.2: under 700 px the grid row shows 4 and the fifth moves after the delete group
    body.appendChild(mk('g1', t('grpMessage'), short ? g1acts.slice(0, 4) : g1acts));
    const altOK = !m.fail && (isNewestChar(m) || (isFirstMsg(m) && m.alts.length > 1));
    if (altOK) {
      const g2 = group(t('grpAlts'), 'g2', 'tiles'); const w = m.streaming ? t('writingNow') : S.sendBlock;
      g2.appendChild(tile('chevron-left', t('prevReply'), () => { closeSheet(); goAlt(m, -1); }, { reason: w || (m.idx <= 0 ? t('firstReply') : '') }));
      g2.appendChild(tile('chevron-right', t('nextReply'), () => { closeSheet(); goAlt(m, 1); }, { reason: w || (m.idx >= m.alts.length - 1 ? t('lastReply') : '') }));
      if (isNewestChar(m) && !isFirstMsg(m)) g2.appendChild(tile('refresh-cw', t('newReply'), () => { closeSheet(false); if (newReply('sheet')) { const el = msgEl(lastMsg()); if (el) el.focus({ preventScroll: true }); } }, { cls: 'accent', reason: w }));
      body.appendChild(g2);
    }
    if (S.hooks.actions && !m.fail) S.hooks.actions(m, body);                     // slice 3: group round actions
    body.appendChild(mk('g3', t('grpMore'), ACT.filter((a) => a.grp === 3 && scopeOk(a, m))));
    const g4 = group(t('grpDelete'), 'g4', 'danger-grp');
    g4.appendChild(item('trash-2', t('deleteThis'), () => { if (m.streaming) confirmDelete(m, false); else { closeSheet(false); removeMsgs([m], { undo: true }); } }, 'danger'));
    g4.appendChild(item('trash-2', t('deleteThisAndAfter'), () => confirmDelete(m, true), 'danger'));
    body.appendChild(g4);
    if (short && g1acts.length > 4) body.appendChild(mk('g1b', t('grpMessage'), g1acts.slice(4)));
    const g5 = group(t('customizeButtons'), 'g5'); g5.appendChild(item('sliders', t('customizeButtons'), () => openCustomize(), '')); body.appendChild(g5);
  } });
}
function enableSelect(m) {
  const el = msgEl(m); if (!el) return; $$('.msg.selectable').forEach((x) => x.classList.remove('selectable')); el.classList.add('selectable'); toast(t('selectHint'));
  const body = $('.reply-body', el); const r = document.createRange(); r.selectNodeContents(body); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); log('select text on message ' + (S.msgs.indexOf(m) + 1));
}
document.addEventListener('pointerdown', (e) => { const sel = $('.msg.selectable'); if (sel && !sel.contains(e.target)) { sel.classList.remove('selectable'); getSelection().removeAllRanges(); log('select text ended'); } }, true);

/* ------------------------------------------------------------------ delete (spec 5.6; DD-022, DD-023) */
const excerptOf = (m) => { const s = plainOf(m).replace(/[*`#]/g, '').replace(/\s+/g, ' ').trim(); return s.length > 36 ? s.slice(0, 36).trimEnd() + '…' : s; };
function deleteSingle(m, shift) {
  if (shift) return confirmDelete(m, true);
  if (m.streaming) return confirmDelete(m, false);          // DD-022: stop, then delete (confirmed)
  removeMsgs([m], { undo: true });
}
function confirmDelete(m, after) {
  const i = S.msgs.indexOf(m); const n = after ? S.msgs.length - 1 - i : 0;
  const strm = !!ST.m && S.msgs.indexOf(ST.m) >= i && (after || ST.m === m);
  const build = (body) => {
    body.replaceChildren();
    const p = document.createElement('p'); p.className = 'confirm-text';
    const pos = t('replyShort', { n: m.idx + 1, total: m.alts.length }); const fixQ = (x) => x.replace('“”', pos);   // nothing written yet: name the position, not an empty quote
    p.textContent = fixQ(after && n > 0 ? t('deleteRangeConfirm', { excerpt: excerptOf(m), n }) : strm ? t('deleteOneConfirm', { excerpt: excerptOf(m) }) : t('deleteSingleConfirm', { excerpt: excerptOf(m) }));
    body.appendChild(p);
    if (strm) { const q = document.createElement('p'); q.className = 'confirm-text warn'; q.textContent = after && n > 0 ? t('stopDeleteRange') : t('stopDeleteBody'); body.appendChild(q); }
    const row = document.createElement('div'); row.className = 'confirm-row';
    const cancel = item('x', t('cancel'), () => closeSheet(), '', { 'data-autofocus': '' });
    markCritical(body); const label = strm ? t('stopAndDelete') : t('deleteCount', { n: n + 1 });
    const go = item('trash-2', label, () => { closeSheet(false); if (strm) stopStream(); removeMsgs(after ? S.msgs.slice(i) : [m], { undo: !after }); }, 'danger dangerous', { 'data-confirm': '' });
    row.appendChild(cancel); row.appendChild(go); body.appendChild(row);
  };
  if (Sh.open) swapSheet(t('deleteTitle'), build); else openSheet({ title: t('deleteTitle'), opener: msgEl(m), build });
}
const SN = { item: null, row: null, timer: 0, left: 6000, started: 0, holds: new Set() };
function removeMsgs(list, { undo = false } = {}) {
  const first = S.msgs.indexOf(list[0]); if (first < 0) return;
  hideSnack(false);                                                  // one pending undo at a time: a new delete commits the earlier one
  const before = new Map($$('.msg').map((el) => [el.dataset.id, el.getBoundingClientRect().top]));
  const stay = S.atBottom;
  $$('.genrow').forEach((g) => g.remove());
  list.forEach((x) => msgEl(x)?.remove());
  S.msgs = S.msgs.filter((x) => !list.includes(x)); list.forEach((x) => { if (x.fail) { stashDrop(x); clearReturnParams(); } });
  const l = lastMsg(); if (l && l.role === 'user' && !ST.m) thread().appendChild(genRow());
  refreshAll(); updateCV();
  const next = S.msgs[first] || S.msgs[first - 1]; const nel = next && msgEl(next);
  if (nel) { setActive(nel); nel.focus({ preventScroll: true }); } else $('#input').focus({ preventScroll: true });
  if (undo && list.length === 1) { const anchor = (S.msgs[first] && msgEl(S.msgs[first])) || $('.genrow'); showSnack(list[0], first, anchor); } else hideSnack(false);
  const tops = new Map(); $$('.msg, .genrow').forEach((el) => { const was = el.classList.contains('genrow') ? null : before.get(el.dataset.id); if (was != null) tops.set(el, was); });
  if (stay) scrollBottom();
  flipFrom(tops);
  log('deleted ' + list.length + ' message(s)' + (undo ? ' with undo' : ''));
}
function layoutDock() {
  const main = $('#main'); if (!main) return; const top = Math.min(...[$('#extras'), $('#s3Strip'), $('#atoast'), $('#composer')].filter((e) => e && e.offsetHeight).map((e) => e.getBoundingClientRect().top));
  main.style.setProperty('--dock', Math.max(0, main.getBoundingClientRect().bottom - top) + 'px');
}
// DD-029: the undo is an inline row in the deleted message's place (role=status); nothing floats over the transcript or the composer
function flipFrom(tops) {                                       // close or open a gap with transform only
  if (S.rm) return;
  tops.forEach((was, el) => { if (!el.isConnected) return; const dy = was - el.getBoundingClientRect().top; if (Math.abs(dy) < 2) return; el.style.transform = `translate3d(0,${dy}px,0)`; void el.offsetWidth; el.classList.add('flip'); el.style.transform = ''; afterTransition(el, () => el.classList.remove('flip'), durOf('base')); });
}
const rowTops = () => new Map($$('.msg, .genrow, .undo-row').map((el) => [el, el.getBoundingClientRect().top]));
function showSnack(m, index, anchor) {
  SN.item = { m, index }; SN.left = 6000; SN.holds.clear();
  const row = document.createElement('div'); row.className = 'undo-row'; row.setAttribute('data-part', 'chat-status-row'); row.setAttribute('role', 'status'); row.tabIndex = -1;
  row.innerHTML = `<span class="undo-text"></span><button type="button" class="btn undo-btn" aria-label="${esc(t('undo'))}">${ic('undo-2', 18)}<span></span></button>`;
  $('span', $('.undo-btn', row)).textContent = t('undo');
  row.addEventListener('pointerenter', () => holdSnack('hover', true)); row.addEventListener('pointerleave', () => holdSnack('hover', false));
  row.addEventListener('focusin', () => holdSnack('focus', true)); row.addEventListener('focusout', () => holdSnack('focus', false));
  $('.undo-btn', row).addEventListener('click', undoDelete);
  thread().insertBefore(row, anchor || null); SN.row = row;
  setTimeout(() => { if (SN.row === row) $('.undo-text', row).textContent = t('deleted') + ' ·'; }, 40);     // text arrives after insertion so the status region announces it
  announce(t('deleted')); startSnack();
}
function startSnack() { clearTimeout(SN.timer); SN.started = now(); SN.timer = setTimeout(() => hideSnack(true), SN.left); }
function holdSnack(key, on) {
  if (!SN.item) return; const was = SN.holds.size > 0; on ? SN.holds.add(key) : SN.holds.delete(key); const isNow = SN.holds.size > 0;
  if (!was && isNow) { clearTimeout(SN.timer); SN.left = Math.max(800, SN.left - (now() - SN.started)); } else if (was && !isNow) startSnack();
}
// close the pending undo: the row fades (--chat-dur-base), then the gap closes
function hideSnack(animate = false) {
  clearTimeout(SN.timer); const row = SN.row; SN.item = null; SN.row = null; SN.holds.clear(); if (!row) return;
  if (!animate || S.rm) { row.remove(); return; }
  row.classList.add('out');
  afterTransition(row, () => { const tops = rowTops(); tops.delete(row); const nxt = [...tops.keys()]; const pre = new Map(nxt.map((el) => [el, el.getBoundingClientRect().top])); row.remove(); flipFrom(pre); }, durOf('base'));
}
const commitUndo = () => { if (SN.item) hideSnack(true); };         // DD-031: a new generation commits the pending undo
function undoDelete() {
  const it = SN.item; if (!it) return; const row = SN.row; const m = it.m;
  const idx = clamp(it.index, 0, S.msgs.length); S.msgs.splice(idx, 0, m); if (m.fail) stashSet(m);
  $$('.genrow').forEach((g) => g.remove());
  const el = renderMsg(m, idx); thread().insertBefore(el, row); hideSnack(false);
  const l = lastMsg(); if (l && l.role === 'user' && !ST.m) thread().appendChild(genRow());
  refreshAll(); updateCV(); setActive(el); el.focus({ preventScroll: true }); announce(t('restored')); log('undo: message restored in place');
}

/* ------------------------------------------------------------------ "Customize buttons" (spec 5.1, DD-019) */
function openCustomize(opener) {
  const build = (body) => buildCustomize(body);
  if (Sh.open) swapSheet(t('customizeButtons'), build, 'tall'); else openSheet({ title: t('customizeButtons'), opener, build, cls: 'tall' });
}
const pinnable = () => L.order.map(reg).filter((a) => a && a.pin);
function previewRow(limit, key) {
  const demo = { id: -1, role: 'char', alts: [{ en: '', ko: '' }], idx: 0 };
  const act = L.order.filter((id) => L.pinned.includes(id)).map(reg).filter((a) => a && a.pin && scopeOk(a, demo)).slice(0, limit);
  const names = act.map((a) => actLabel(a, demo)).join(', ');
  return `<div class="pv"><div class="pv-label">${esc(t(key, { n: limit }))}</div><div class="pv-row"><span class="avatar" aria-hidden="true">${esc([...t('charName')][0])}</span><span class="pv-name">${esc(t('charName'))}</span><span class="pv-icons" aria-hidden="true">${act.map((a) => ic(a.icon, 20)).join('')}${ic('ellipsis-vertical', 20)}</span><span class="sr-only">: ${esc(names)}</span></div></div>`;
}
function buildCustomize(body, focusKey) {
  body.replaceChildren();
  const hint = document.createElement('p'); hint.className = 'confirm-text'; hint.textContent = t('customizeHint'); body.appendChild(hint);
  const pv = document.createElement('div'); pv.className = 'previews'; pv.setAttribute('role', 'group'); pv.setAttribute('aria-label', t('customizeButtons'));
  pv.innerHTML = previewRow(3, 'previewNarrow') + previewRow(6, 'previewWide'); body.appendChild(pv);
  const list = document.createElement('ul'); list.className = 'clist'; const pinnedIds = L.order.filter((id) => L.pinned.includes(id) && reg(id) && reg(id).pin); const lim = pinLimit();
  const vis = pinnable();
  vis.forEach((a, k) => {
    const on = L.pinned.includes(a.id); const waiting = on && pinnedIds.indexOf(a.id) >= lim;
    const li = document.createElement('li'); li.className = 'crow'; li.dataset.id = a.id;
    li.innerHTML = `<span class="grip" aria-hidden="true" title="${esc(t('dragHandle'))}">${ic('grip-vertical', 20)}</span>` +
      `<span class="clabel">${ic(a.icon, 20)}<span class="ct"><span>${esc(actLabel(a, { bookmarked: false, hidden: false }))}</span>${a.source !== 'builtin' ? `<small class="badge">${esc(t('demoBadge'))}</small>` : ''}${waiting ? `<small class="wait">${esc(t('waiting'))}</small>` : ''}</span></span>` +
      `<label class="sw mini"><input type="checkbox" role="switch" data-pin="${esc(a.id)}" aria-label="${esc(t('pinLabel', { name: actLabel(a, { bookmarked: false, hidden: false }) }))}" ${on ? 'checked' : ''}><span class="sw-ui"></span></label>` +
      `<button type="button" class="btn mv" data-mv="-1" data-id="${esc(a.id)}" aria-label="${esc(actLabel(a, {}) + ': ' + t('moveUp'))}" title="${esc(t('moveUp'))}" aria-disabled="${k === 0}">${ic('arrow-up', 18)}</button>` +
      `<button type="button" class="btn mv" data-mv="1" data-id="${esc(a.id)}" aria-label="${esc(actLabel(a, {}) + ': ' + t('moveDown'))}" title="${esc(t('moveDown'))}" aria-disabled="${k === vis.length - 1}">${ic('arrow-down', 18)}</button>`;
    list.appendChild(li);
  });
  body.appendChild(list);
  const foot = document.createElement('div'); foot.className = 'confirm-row';
  const rs = item('rotate-ccw', t('restoreDefaults'), () => { L.order = DEFAULT_ORDER.concat(ACT.map((a) => a.id).filter((id) => !DEFAULT_ORDER.includes(id))); L.pinned = DEFAULT_PINNED.slice(); refreshAll(); buildCustomize(body, 'restore'); }, '', { 'data-restore': '' });
  const done = item('check', t('done'), () => closeSheet(), '', { 'data-done': '' }); done.setAttribute('aria-label', t('done')); done.title = t('done');
  foot.appendChild(rs); foot.appendChild(done); body.appendChild(foot);
  list.addEventListener('change', (e) => { const inp = e.target.closest('[data-pin]'); if (!inp) return; const id = inp.dataset.pin; L.pinned = L.pinned.filter((x) => x !== id); if (inp.checked) L.pinned.push(id); refreshAll(); buildCustomize(body, 'pin:' + id); });
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-mv]'); if (!b || b.getAttribute('aria-disabled') === 'true') return; moveAction(b.dataset.id, Number(b.dataset.mv)); buildCustomize(body, 'mv:' + b.dataset.id + ':' + b.dataset.mv); });
  list.addEventListener('pointerdown', (e) => gripDown(e, list, body));
  if (focusKey) {
    let f = null;
    if (focusKey === 'restore') f = $('[data-restore]', body);
    else if (focusKey.startsWith('pin:')) f = $(`[data-pin="${CSS.escape(focusKey.slice(4))}"]`, body);
    else if (focusKey.startsWith('mv:')) { const mm = /^mv:(.*):(-?1)$/.exec(focusKey); const id = mm[1], d = mm[2]; f = $(`[data-mv="${d}"][data-id="${CSS.escape(id)}"]`, body); if (!f || f.getAttribute('aria-disabled') === 'true') f = $(`[data-mv="${-d}"][data-id="${CSS.escape(id)}"]`, body); }
    if (f) f.focus({ preventScroll: true });
  }
}
function reorderIds(ids) { // write the visible order back into L.order, keeping the slots of ids that no longer exist (removed plugins)
  const vis = pinnable().map((a) => a.id); const pos = vis.map((id) => L.order.indexOf(id)).sort((a, b) => a - b);
  ids.forEach((id, k) => { L.order[pos[k]] = id; });
}
function moveAction(id, d) {
  const ids = pinnable().map((a) => a.id); const i = ids.indexOf(id), j = i + d; if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]]; reorderIds(ids); refreshAll(); log('customize: moved ' + id + ' ' + (d < 0 ? 'up' : 'down'));
}
function gripDown(e, list, body) {
  const grip = e.target.closest('.grip'); if (!grip) return; const row = grip.closest('.crow'); if (!row) return;
  e.preventDefault(); const rows = $$('.crow', list); const idx = rows.indexOf(row); const h = row.offsetHeight; const y0 = e.clientY; let target = idx;
  row.classList.add('dragging'); try { grip.setPointerCapture(e.pointerId); } catch (_) {}
  const move = (ev) => { const dy = ev.clientY - y0; row.style.transform = `translate3d(0,${dy}px,0)`; target = clamp(idx + Math.round(dy / h), 0, rows.length - 1); rows.forEach((r, k) => { r.classList.toggle('drop-before', k === target && target < idx); r.classList.toggle('drop-after', k === target && target > idx); }); };
  const up = () => {
    grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
    const ids = rows.map((r) => r.dataset.id); ids.splice(idx, 1); ids.splice(target, 0, row.dataset.id);
    if (target !== idx) { reorderIds(ids); refreshAll(); log('customize: dragged ' + row.dataset.id + ' to ' + (target + 1)); }
    buildCustomize(body);
  };
  grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
}

/* ------------------------------------------------------------------ + menu (APG menu pattern), persona, chat options */
function openPlus() {
  openSheet({ title: t('plusTitle'), opener: $('#plusBtn'), menu: true, build(body) {
    [['paperclip', 'attachFile'], ['image', 'addImage'], ['languages', 'translateInput'], ['sparkles', 'suggestions'], ['chevron-right', 'continue'], ['user', 'impersonate'], ['grid', 'plugins']].forEach(([ico, k], n) => {
      const b = item(ico, t(k), () => { closeSheet(); if (k === 'translateInput') { S.xl = !S.xl; renderExtras(); if (S.xl) $('#xlInput')?.focus(); } else simulated(t(k)); }, '', { role: 'menuitem' }); if (n === 0) { b.tabIndex = 0; b.setAttribute('data-autofocus', ''); } body.appendChild(b);
    });
    if (S.hooks.plus) S.hooks.plus(body);                              // slice 3: group items
  } });
}
function openPersona() {
  openSheet({ title: t('personaPick'), opener: $('#personaBtn'), build(body) {
    body.setAttribute('role', 'radiogroup'); Sh.arrows = true;
    PERSONAS.forEach((k, n) => {
      const b = item('user', t(k), () => { S.persona = n; closeSheet(); setPersonaLabel(); $$('.msg.user').forEach((el) => { const m = msgOf(el); fillMsg(el, m, S.msgs.indexOf(m), { keepBody: true }); }); }, '', { role: 'radio', 'aria-checked': String(n === S.persona) });
      if (n === S.persona) b.setAttribute('data-autofocus', ''); body.appendChild(b);
    });
  } });
}
function openChatOptions() { openSheet({ title: t('chatOptions'), opener: $('#moreBtn'), build(body) { const p = document.createElement('p'); p.className = 'confirm-text'; p.textContent = t('chatOptionsBody'); body.appendChild(p); body.appendChild(item('x', t('cancel'), () => closeSheet())); } }); }
function sheetKeys(e) {
  if (!Sh.open) return;
  const rt = $('#sheetRoot');
  if (e.key === 'Escape') {
    if (e.target && e.target.dataset && e.target.dataset.escLeave !== undefined) { e.preventDefault(); e.stopPropagation(); const sh = e.target.closest('.sheet'); if (sh) sh.focus(); return; }   // Esc in a field leaves the field, not the sheet
    e.preventDefault(); e.stopPropagation(); closeSheet(); return;
  }
  const body = $('.sheet-body', rt);
  if (Sh.kind === 'menu') {                                       // APG menu: arrows wrap, Home/End, Tab closes and moves on
    const items = $$('[role^="menuitem"]', body).filter((x) => x.getAttribute('aria-disabled') !== 'true');      // HOOKS1_SPEC C-7: menuitem, menuitemcheckbox and menuitemradio
    if (e.key === 'Tab') { closeSheet(true); return; }            // no preventDefault: focus is back on the opener, so Tab moves on from there
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); const i = items.indexOf(document.activeElement);
      const n = e.key === 'Home' ? items[0] : e.key === 'End' ? items[items.length - 1] : items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      $$('[role^="menuitem"]', body).forEach((x) => (x.tabIndex = -1)); n.tabIndex = 0; n.focus();
    }
    return;
  }
  if (e.key === 'Tab') {
    const f = $$('button:not([aria-disabled="true"]), input, [tabindex="0"]', rt).filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (!f.length) return; const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  if (Sh.arrows && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault(); const f = $$('.item, .tile', body).filter((x) => x.getAttribute('aria-disabled') !== 'true'); const i = f.indexOf(document.activeElement);
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1; const n = f[(i + step + f.length) % f.length]; if (body.getAttribute('role') === 'radiogroup') { f.forEach((x) => (x.tabIndex = -1)); n.tabIndex = 0; } n.focus();
  }
}
function sheetDragInit() {
  const g = $('.grab'); let d = null;
  g.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; d = { id: e.pointerId, y0: e.clientY, dy: 0, s: [] }; pushSample(d.s, e); $('.sheet').classList.add('dragging'); g.setPointerCapture(e.pointerId); });
  g.addEventListener('pointermove', (e) => { if (!d || e.pointerId !== d.id) return; d.dy = Math.max(0, e.clientY - d.y0); pushSample(d.s, e); $('.sheet').style.transform = `translate3d(0,${d.dy}px,0)`; $('.sheet-backdrop').style.opacity = String(tokNum('--opacity-scrim') * (1 - Math.min(1, d.dy / $('.sheet').offsetHeight))); });
  const up = (e) => { if (!d || e.pointerId !== d.id) return; const sh = $('.sheet'); const v = velocity(d.s, 'y'); const close = d.dy > 0.3 * sh.offsetHeight || v > 0.5; d = null; sh.classList.remove('dragging'); sh.classList.add('settle'); $('.sheet-backdrop').style.opacity = '';
    log('sheet drag release -> ' + (close ? 'close' : 'spring back')); if (close) { sh.style.transform = 'translate3d(0,100%,0)'; closeSheet(); } else sh.style.transform = ''; };
  g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
}

/* ------------------------------------------------------------------ composer (spec 7) */
function syncSend() { const b = $('#sendBtn'); b.classList.toggle('stopping', S.streaming); setLabel(b, S.streaming ? 'stop' : 'send'); const blocked = !S.streaming && !!S.sendBlock; b.setAttribute('aria-disabled', String(!S.streaming && (!$('#input').value.trim() || blocked)));
  if (blocked) { b.title = t('send') + ': ' + S.sendBlock; b.setAttribute('aria-description', S.sendBlock); } else b.removeAttribute('aria-description');
  if (S.hooks.syncSend) S.hooks.syncSend(b); }
function setPersonaLabel() { $('#personaLbl').textContent = t('asPersona', { name: personaName() }); const b = $('#personaBtn'); b.setAttribute('aria-label', t('personaPick') + ': ' + t('asPersona', { name: personaName() })); b.title = t('personaPick'); }
function fitInput() {
  const ta = $('#input'); ta.style.height = 'auto'; const cs = getComputedStyle(ta); const lh = parseFloat(cs.lineHeight); const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + 2;
  let max = 5 * lh + pad; if (S.kb) max = Math.min(max, 0.3 * $('#app').clientHeight);
  const h = Math.max(tokNum('--composer-field-height'), Math.min(ta.scrollHeight + 2, max)); ta.style.height = h + 'px'; ta.style.overflowY = ta.scrollHeight + 2 > max + 1 ? 'auto' : 'hidden'; ta.dataset.max = Math.round(max);
  layoutDock();
}
// Send starts the reply, as in the app today (spec 7.1)
function doSend() {
  const ta = $('#input'); const v = ta.value.trim(); if (!v) return;
  if (S.streaming) { if (S.hooks.busySend && S.hooks.busySend(v)) { ta.value = ''; fitInput(); syncSend(); } return; }   // slice 3: Send during auto mode
  if (S.sendBlock) { toast(S.sendBlock); return; }                   // slice 2: a refusal is visible, never silent
  if (S.hooks.send) S.hooks.send();                                  // slice 2: reply suggestions end with the user's own message
  hideSnack(false);                                                   // DD-031: Send commits a pending undo
  S.msgs.push({ id: ++S.seq, role: 'user', alts: [{ en: v, ko: v }], idx: 0, bookmarked: false, hidden: false, streaming: false });
  S.sent++; ta.value = ''; fitInput(); renderTranscript(); syncSend(); log('sent: ' + v.slice(0, 20)); const sn = $('#sentN'); if (sn) sn.textContent = t('sentN', { n: S.sent });
  if (S.hooks.sendRound && S.hooks.sendRound(v)) return;               // slice 3: a group answers with a round
  generateNew();
}
/* Enter (spec 7.2, DD-026): hardware keyboard seen -> Enter sends; otherwise a line break; a visible per-device setting overrides */
const IME = { compEnd: -1e9, composing: false, ignored: 0 };
const VV = { base: 0 };
function chatField(el) { return !!el && (el.id === 'input' || el.id === 'xlInput'); }
function syncHw() { const el = $('#hwStatus'); if (el) el.textContent = S.hwSeen ? t('hwYes') : t('hwNo'); }
function noteKey(e) {
  if (!e.isTrusted) return;
  const mod = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Process', 'Unidentified', 'Dead', 'AltGraph'].includes(e.key);
  if (!mod && !(e.ctrlKey && e.altKey)) S.kbdSinceTouch = true;
  // DD-032: only navigation keys (arrows, Home/End, Page keys, Tab, Esc) and Ctrl/Alt shortcuts count; letters, digits, Backspace, Delete and Enter never do
  const nav = /^(Arrow(Up|Down|Left|Right)|Home|End|Page(Up|Down)|Tab|Escape)$/.test(e.key);
  const altGr = !!(e.getModifierState && e.getModifierState('AltGraph'));
  const shortcut = (e.ctrlKey || e.altKey) && !mod && !altGr;
  const inChat = !!(e.target && e.target.closest && e.target.closest('#main'));
  if (inChat && e.keyCode !== 229 && e.key !== 'Enter' && (nav || shortcut) && !S.hwSeen) { S.hwSeen = true; log('hardware keyboard seen (' + e.key + '): Enter now sends in Automatic mode'); syncHw(); }
}
function onViewportDrop(drop) {
  if (drop > 150 && isTextField(document.activeElement) && S.hwSeen) { S.hwSeen = false; log('on-screen keyboard appeared (viewport -' + Math.round(drop) + ' px): hardware keyboard flag cleared'); syncHw(); }
}
function enterAction(e) {
  if (e.key !== 'Enter') return null;
  const why = e.isComposing ? 'isComposing' : e.keyCode === 229 ? 'keyCode 229' : now() - IME.compEnd < 30 ? '<30 ms after compositionend' : '';
  if (why) return { do: 'ignore', why };
  const mode = S.enterMode === 'auto' ? (S.hwSeen ? 'send' : 'newline') : S.enterMode;
  if (mode === 'send') return { do: e.shiftKey ? 'newline' : 'send' };
  return { do: e.ctrlKey || e.metaKey ? 'send' : 'newline' };
}
function onInputKey(e) {
  const r = enterAction(e); if (!r) return;
  if (r.do === 'ignore') { log(t('imeIgnored', { why: r.why })); IME.ignored++; return; }
  if (r.do === 'send') { e.preventDefault(); if (S.streaming) return; doSend(); }
}
function onXlKey(e) {
  const r = enterAction(e); if (!r) return;
  if (r.do === 'ignore') { log(t('imeIgnored', { why: r.why })); IME.ignored++; return; }
  e.preventDefault(); if ($('#xlInput').value.trim()) { toast(t('xlSent')); $('#xlInput').value = ''; }
}
function simulateIME() {
  const ta = $('#input'); ta.focus({ preventScroll: true }); IME.ignored = 0; const before = S.sent;
  ta.dispatchEvent(new CompositionEvent('compositionstart', { data: '' })); IME.composing = true;
  ta.value += '하'; ta.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: '하', isComposing: true, bubbles: true }));
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }));
  ta.dispatchEvent(new CompositionEvent('compositionend', { data: '하' }));
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, isComposing: false, bubbles: true, cancelable: true }));
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: false, bubbles: true, cancelable: true }));
  fitInput(); syncSend(); log(t('imeDone') + ' (' + IME.ignored + ' Enter ignored, sent ' + (S.sent - before) + ')'); toast(t('imeDone'));
}

/* ------------------------------------------------------------------ extras chips (44 dp hit areas around smaller visuals) */
function renderExtras() {
  const ex = $('#extras'); ex.replaceChildren();
  if (S.extras) {
    const att = document.createElement('span'); att.className = 'chip att'; att.innerHTML = ic('image', 16) + '<span>sunset.png</span>';
    const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'btn chip-x'; rm.innerHTML = ic('x', 16); setLabel(rm, 'removeChip'); rm.addEventListener('click', () => { att.remove(); if (!ex.children.length) S.extras = false; syncCtl(); layoutDock(); }); att.appendChild(rm);
    ex.appendChild(att);
    (S.lang === 'ko' ? ['올빼미 이야기 해 줘', '다른 룬도 알려 줘'] : ['Ask about the owls', 'Teach me another rune']).forEach((s) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip sugg'; b.innerHTML = ic('sparkles', 16) + '<span>' + esc(s) + '</span>'; b.addEventListener('click', () => { $('#input').value = s; fitInput(); syncSend(); $('#input').focus(); }); ex.appendChild(b);
    });
  }
  if (S.xl) {
    const c = document.createElement('span'); c.className = 'chip xl'; c.innerHTML = ic('languages', 16) + `<input id="xlInput" type="text" aria-label="${esc(t('xlLabel'))}" placeholder="${esc(t('xlLabel'))}" autocomplete="off">`;
    ex.appendChild(c); const inp = $('input', c);
    inp.addEventListener('keydown', onXlKey); inp.addEventListener('compositionstart', () => (IME.composing = true)); inp.addEventListener('compositionend', () => { IME.composing = false; IME.compEnd = now(); });
  }
  layoutDock();
}

/* ------------------------------------------------------------------ header hide-on-scroll (C-3, narrow only), anchoring, roving focus */
let LASTTOUCH = -1e9, CTXAT = -1e9;
let lastTop = 0, upAcc = 0, userIntentUntil = 0, hdrTimer = 0;
function showHeader() { const h = $('#hdr'); clearTimeout(hdrTimer); h.classList.remove('hidden', 'gone'); S.hdrHidden = false; upAcc = 0; }
function hideHeader() {
  if (S.desktop || S.kbdSinceTouch || !S.hideHdr) return;           // never on the wide layout, never after hardware-keyboard use
  const h = $('#hdr'); if (h.contains(document.activeElement)) return;
  h.classList.add('hidden'); S.hdrHidden = true; clearTimeout(hdrTimer);
  hdrTimer = setTimeout(() => { if (S.hdrHidden && !h.contains(document.activeElement)) h.classList.add('gone'); }, durOf('base') + 30);   // visibility:hidden after the transition, never inert
}
function onScroll() {
  const sc = scroller(); const top = sc.scrollTop; const d = top - lastTop; lastTop = top;
  if (now() < progUntil) return;
  S.atBottom = sc.scrollHeight - top - sc.clientHeight < 24;
  if (now() > userIntentUntil) return;
  if (!S.hideHdr || S.desktop) { showHeader(); return; }
  if (d < 0) { upAcc += -d; if (upAcc >= 24) hideHeader(); } else if (d > 0) { showHeader(); }
  if (top <= 1) showHeader();
}
const WH = { last: 0, dx: 0, dy: 0, lock: 0, done: false };
function onWheel(e) {
  let dx = e.deltaX, dy = e.deltaY; if (e.shiftKey && !dx) { dx = dy; dy = 0; }
  const t0 = now(); if (t0 - WH.last > 160) { WH.dx = 0; WH.dy = 0; WH.done = false; } WH.last = t0; WH.dx += dx; WH.dy += dy;
  if (!S.swipeOn) return;
  const el = e.target.closest('.msg'); if (!el) return; const m = msgOf(el);
  if (!m || !swipeable(m) || m.streaming || scrollsSideways(e.target, el)) return;
  if (Math.abs(WH.dx) < 40 || Math.abs(WH.dx) <= 2 * Math.abs(WH.dy)) { if (e.shiftKey && e.cancelable) e.preventDefault(); return; }   // accumulated |dx| >= 40 and |dx| > 2|dy|
  if (e.cancelable) e.preventDefault();
  if (WH.done || t0 < WH.lock) return;
  WH.done = true; WH.lock = t0 + 450; const dir = WH.dx > 0 ? -1 : 1;
  const target = m.idx + (dir < 0 ? 1 : -1);
  if (target < 0 || target >= m.alts.length) { toast(dir < 0 ? t('wheelEdge') : t('firstReply')); log('wheel at edge: no generation'); return; }
  stepAnimated(m, el, dir); log('wheel step -> ' + (target + 1) + ' / ' + m.alts.length);
}
function stepAnimated(m, el, dir) {
  const stage = $('.stage', el); const nb = m.idx + (dir < 0 ? 1 : -1);
  Object.assign(D, { active: false, locked: 'x', el, m, stage, card: $('.card', stage), peek: $('.peek', stage), chip: $('.edge-chip', stage), W: stage.clientWidth, peekDir: dir, mode: 'normal' });
  const { peek } = D; $('.peek-text', peek).textContent = altText(m, nb).replace(/[*`#]/g, '').replace(/\n+/g, ' '); $('.peek-chip', peek).textContent = `${nb + 1} / ${m.alts.length}`;
  peek.classList.toggle('from-right', dir < 0); peek.classList.toggle('from-left', dir > 0); peek.classList.add('on'); peek.style.transform = `translate3d(${-dir * (D.W + gap)}px,0,0)`;
  void peek.offsetWidth; commitSwipe(dir);
}
// the undo row takes the deleted message's place in the roving order (arrows reach it; its button is the next forward Tab stop after the message before it)
function onTranscriptKey(e) {
  const rowEl = e.target.closest && e.target.closest('.undo-row');
  const mEl = rowEl && e.target === rowEl ? rowEl : e.target.closest('.msg'); if (!mEl || e.target !== mEl) return;
  const all = $$('.msg, .undo-row'); const i = all.indexOf(mEl); const m = rowEl ? null : msgOf(mEl);
  const goTo = (n) => { if (n.classList.contains('msg')) setActive(n); n.focus(); };
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); goTo(all[clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, all.length - 1)]); return; }
  if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); goTo(e.key === 'Home' ? all[0] : all[all.length - 1]); return; }
  if (rowEl) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); undoDelete(); } return; }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (!m.fail && m.alts.length > 1 && (isFirstMsg(m) || isNewestChar(m))) { e.preventDefault(); const ok = goAlt(m, e.key === 'ArrowRight' ? 1 : -1); if (!ok && !m.streaming) { const msg = e.key === 'ArrowRight' ? t('lastReply') : t('firstReply'); toast(msg); announce(msg); } msgEl(m).focus(); } return;
  }
  if (e.key === 'Enter' || e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); CTXAT = now(); openActions(m, mEl); return; }
  if (e.key === 'Delete') { e.preventDefault(); deleteSingle(m, e.shiftKey); return; }
  if (!m.fail && (e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && !selectionIn(m)) { e.preventDefault(); copyMsg(m, ''); }
}
function hotkeys(e) {
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyZ' && !e.isComposing && AT.el && AT.undo) { e.preventDefault(); const u = AT.undo; closeActionToast(true); if (u.run) u.run(); return; }   // DD-131: Alt+Z undoes the switch / model change while its row is up
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'z' || e.key === 'Z') && SN.item && !isTextField(e.target)) { e.preventDefault(); undoDelete(); return; }
  if (e.ctrlKey && e.altKey && (e.key === 'r' || e.key === 'R')) {
    e.preventDefault(); if (e.repeat) return;                                   // holding the keys never repeats
    const f = document.activeElement.closest?.('.msg'); const m = f ? msgOf(f) : lastMsg();
    if (m && m.fail) { retryFail(m, 'hotkey'); return; }               // a failed reply regenerates in place
    if (!m || m.role !== 'char' || !(isNewestChar(m) || (isFirstMsg(m) && m.alts.length > 1))) { toast(t('hotNA')); return; }
    if (m.streaming) { toast(t('writingNow')); return; }
    if (m.idx < m.alts.length - 1) { goAlt(m, 1); msgEl(m)?.focus({ preventScroll: true }); log('Ctrl+Alt+R: next alternative'); }
    else if (isNewestChar(m) && !isFirstMsg(m)) { if (newReply('hotkey')) { const el = msgEl(lastMsg()); if (el) el.focus({ preventScroll: true }); log('Ctrl+Alt+R: new reply'); } }
    else toast(t('lastReply'));
  }
}

/* ------------------------------------------------------------------ settings, controls, layout */
function applyFlags() {
  S.rm = !!(S.rmToggle || S.mqRM.matches); root.classList.toggle('rm', S.rm); S.lp = !!S.lpToggle; root.classList.toggle('nexus-low-power', S.lp);
  if (ST.m) setLevel(ST.level);
}
function layout() {
  const w = Number(Q.get('w')) || 0; const framed = w && w < innerWidth; root.classList.toggle('framed', !!framed);
  if (framed) root.style.setProperty('--frame-w', w + 'px'); else root.style.removeProperty('--frame-w');
  const ew = framed ? w : innerWidth; const was = S.desktop; S.desktop = ew >= 900; root.classList.toggle('is-desktop', S.desktop);
  const app = $('#app'); const sw = Math.min(app.clientWidth * 0.85, tokNum('--sidebar-width-max')); app.style.setProperty('--sbw', sw + 'px');
  const sb = $('#sidebar');
  if (S.desktop) { sb.style.transform = ''; $('#sbBackdrop').style.opacity = '0'; $('#sbBackdrop').style.pointerEvents = 'none'; S.sbOpen = false; showHeader(); }
  else if (!S.sbOpen && !SB.drag) { sb.style.transform = ''; }
  app.style.setProperty('--inset', S.inset + 'px'); app.style.setProperty('--zone', S.inset + tokNum('--edge-zone-extra') + 'px');
  syncInert(); if (was !== S.desktop && $('#thread').children.length) refreshAll();
}
function setKb(on) {
  S.kb = on; root.style.setProperty('--kb', on ? tokNum('--size-kbd') + 'px' : '0px'); $('#kbd').hidden = !on; if (S.hooks.kb) S.hooks.kb(on);
  const ta = $('#input'); if (on && document.activeElement !== ta) ta.focus({ preventScroll: true });
  if (on) onViewportDrop(300);                                   // the simulated on-screen keyboard is a visualViewport drop
  requestAnimationFrame(() => { fitInput(); if (S.atBottom) scrollBottom(); }); syncCtl(); log('keyboard ' + (on ? 'up (viewport -300 px)' : 'down'));
}
const PRESETS = {
  'android-phone': { label: 'pAP', haptic: true, hover: false },
  'android-tablet-kbd': { label: 'pAT', haptic: true, hover: false },
  'windows-touch-laptop': { label: 'pWT', haptic: false, hover: true },
  'linux-desktop': { label: 'pLX', haptic: false, hover: true },
  'web-host': { label: 'pWH', haptic: false, hover: true },
};
function setPreset(k) {
  const p = PRESETS[k]; if (!p) return; S.preset = k; S.hapticCap = p.haptic; setHoverUi(p.hover); setTouchUi(!p.hover);
  $('#haptic').hidden = !p.haptic; buildControls(); log('preset = ' + k + ' (haptics ' + p.haptic + ')');
}
function setHoverUi(v) { S.hoverUi = v; root.classList.toggle('hover-ui', v); }
function setTouchUi(v) { S.touchUi = v; root.classList.toggle('touch-ui', v); }
const CTL = [];
function buildControls() {
  const c = $('#controls'); c.replaceChildren(); CTL.length = 0;
  const addSw = (key, label, badge, fn) => {
    const l = document.createElement('label'); l.className = 'sw'; l.innerHTML = `<input type="checkbox" role="switch" data-k="${key}"><span class="sw-ui"></span><span class="lbl">${esc(t(label))}</span>${badge ? `<span class="badge">${badge}</span>` : ''}`;
    const inp = $('input', l); inp.addEventListener('change', () => { S[key] = inp.checked; fn && fn(inp.checked); log(key + ' = ' + inp.checked); }); c.appendChild(l); CTL.push(() => (inp.checked = !!S[key]));
  };
  const addAct = (icon, label, fn, closes) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn act'; b.innerHTML = ic(icon, 18) + '<span>' + esc(label) + '</span>'; b.addEventListener('click', () => { if (closes && !S.desktop) { closeSidebar(); setTimeout(fn, 30); } else fn(); }); c.appendChild(b); return b; };
  const segOf = (lblKey, opts, get, set) => {
    const g = document.createElement('div'); g.className = 'seg'; g.setAttribute('role', 'group'); g.setAttribute('aria-label', t(lblKey));
    opts.forEach(([val, txt]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = txt; b.dataset.v = val; b.setAttribute('aria-pressed', String(get() === val)); b.addEventListener('click', () => { set(val); $$('button', g).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === get()))); }); g.appendChild(b); });
    return g;
  };
  c.appendChild(segOf('lang', [['en', 'EN'], ['ko', '한국어']], () => S.lang, (l) => setLang(l)));
  const pr = document.createElement('label'); pr.className = 'rng'; pr.style.flexWrap = 'wrap';
  pr.innerHTML = `<span>${esc(t('preset'))}</span><select id="presetSel" class="preset-sel">${Object.keys(PRESETS).map((k) => `<option value="${k}" ${k === S.preset ? 'selected' : ''}>${esc(t(PRESETS[k].label))}</option>`).join('')}</select><span class="banner flush">${esc(t('presetNote'))}</span>`;
  $('select', pr).addEventListener('change', (e) => setPreset(e.target.value)); c.appendChild(pr);
  addSw('rmToggle', 'rm', '', applyFlags); addSw('lpToggle', 'lp', '', applyFlags);
  addSw('hideHdr', 'c3', 'C-3', (v) => { if (!v) showHeader(); }); addSw('hideNames', 'c6', 'C-6', () => { root.classList.toggle('hide-names', S.hideNames); refreshAll(); }); addSw('counter', 'c2', 'C-2', () => refreshAll());
  if (S.hapticCap) addSw('haptics', 'c1', 'C-1', () => {}); else { const n = document.createElement('p'); n.className = 'banner'; n.id = 'noHaptic'; n.textContent = t('noHaptic'); c.appendChild(n); }
  addSw('renderComplete', 'c5', 'C-5', () => {}); addSw('swipeOn', 'swipeOn', 'DD-027', () => {});
  c.appendChild(segOf('enterKey', [['auto', t('enterAuto')], ['send', t('enterSend')], ['newline', t('enterNL')]], () => S.enterMode, (v) => { S.enterMode = v; log('Enter key = ' + v); }));
  { const lbl = document.createElement('p'); lbl.className = 'banner'; lbl.innerHTML = `<strong>${esc(t('enterKey'))}</strong><br><span id="hwStatus"></span>`; c.appendChild(lbl); }
  addSw('pluginOn', 'pluginOn', 'DD-019', setPlugin);
  addAct('sliders', t('customizeButtons'), () => openCustomize($('#sbBtn')), true);
  addSw('extras', 'extras', '', renderExtras); addSw('today', 'today', '', () => {});
  addSw('showInset', 'insetShow', '', paintInset);
  const r = document.createElement('label'); r.className = 'rng'; r.innerHTML = `<span>${esc(t('insetPx'))}</span><input type="range" min="0" max="32" step="2" value="${S.inset}" id="insetRng"><output id="insetOut">${S.inset}px</output>`;
  $('input', r).addEventListener('input', (e) => { S.inset = Number(e.target.value); $('#insetOut').textContent = S.inset + 'px'; layout(); }); c.appendChild(r);
  addAct('keyboard', t(S.kb ? 'kbDown' : 'kbUp'), () => setKb(!S.kb), true).id = 'kbToggle';
  addAct('sparkles', t('stream'), () => generateNew(), true); addAct('languages', t('ime'), simulateIME, true); addAct('refresh-cw', t('reset'), () => resetChat(), true);
  const sn = document.createElement('p'); sn.id = 'sentN'; sn.className = 'banner'; sn.textContent = t('sentN', { n: S.sent }); c.appendChild(sn);
  const ul = document.createElement('ul'); ul.id = 'evlog'; ul.setAttribute('aria-label', 'Event log'); c.appendChild(ul); log('ready');
  syncCtl(); syncHw();
}
function syncCtl() { CTL.forEach((f) => f()); const k = $('#kbToggle'); if (k) k.lastChild.textContent = t(S.kb ? 'kbDown' : 'kbUp'); }
function paintInset() { $('#insetStrip').classList.toggle('show', S.showInset); $('#insetStripR').classList.toggle('show', S.showInset); layout(); }
function applyStatic() {
  document.documentElement.lang = S.lang;
  $$('[data-label]').forEach((e) => setLabel(e, e.dataset.label));
  $$('[data-ic]').forEach((e) => (e.innerHTML = ic(e.dataset.ic, Number(e.dataset.size || 20))));
  $('#input').placeholder = t('composerPh'); $('#input').setAttribute('aria-label', t('composerLabel'));
  $('#hdrName').textContent = t('charName'); $('#hdrAv').textContent = [...t('charName')][0];
  $('#scroller').setAttribute('aria-label', t('chatLog')); $('#skip').textContent = t('skip'); $('#kbdNote').textContent = t('kbdNote'); $('#sbChats').textContent = t('chats'); $('#ctlTitle').textContent = t('ctlTitle'); $('#banner').textContent = t('banner');
  $('#chat1').innerHTML = `${ic('message', 18)}<span><span>${esc(t('s1'))}</span><small>Seraphina · ${S.msgs.length}</small></span>`; $('#chat2').innerHTML = `${ic('message', 18)}<span><span>${esc(t('s2'))}</span><small>…</small></span>`; $('#chat3').innerHTML = `${ic('message', 18)}<span><span>${esc(t('s3'))}</span><small>…</small></span>`;
  setPersonaLabel(); syncSend(); document.title = 'Chat slice 1 · ' + (S.lang === 'ko' ? '목업' : 'mockup');
}
// a UI language change mid-stream changes labels only; the stream continues (spec 5.6)
function setLang(l) {
  if (S.lang === l) return; S.lang = l; applyStatic(); buildControls(); initLabelsOnly(); renderExtras(); layout(); log('lang = ' + l); if (S.hooks.lang) S.hooks.lang();
}
function initLabelsOnly() {
  const nt = $('.note'); if (nt) nt.textContent = t('banner');
  S.msgs.forEach((m, i) => { const el = msgEl(m); if (!el) return; fillMsg(el, m, i, { keepBody: m.streaming }); });
  $$('.genrow span').forEach((s) => (s.textContent = t('generateReply')));
  setActive(activeEl()); if (Sh.open) closeSheet(false);
}
function resetChat() { stopStream(); hideSnack(); S.msgs = sampleMsgs(); S.sent = 0; renderTranscript(); showHeader(); syncSend(); }

/* ------------------------------------------------------------------ measurements for checks */
function measure() {
  const sc = scroller(); const hShown = !S.hdrHidden; const vis = sc.clientHeight - (hShown ? 48 : 0);
  const kb = S.kb ? 300 : 0;
  return { innerW: innerWidth, innerH: innerHeight, kb, scrollerH: sc.clientHeight, headerShown: hShown, transcriptVisibleH: vis, ratioVsViewport: +(vis / innerHeight).toFixed(3), ratioVsRemaining: +(vis / (innerHeight - kb)).toFixed(3), composerH: $('#composer').offsetHeight, extrasH: $('#extras').offsetHeight, textareaH: $('#input').offsetHeight, textareaMax: Number($('#input').dataset.max), hScroll: document.documentElement.scrollWidth > innerWidth, bodyScrollW: document.documentElement.scrollWidth };
}

/* ------------------------------------------------------------------ init */
function init() {
  S.msgs = sampleMsgs(); initActions();
  S.rmToggle = Q.get('reduced') === '1' || S.mqRM.matches; S.lpToggle = Q.get('lowpower') === '1';
  root.classList.toggle('hide-names', S.hideNames); applyFlags(); S.mqRM.addEventListener?.('change', () => { S.rmToggle = S.mqRM.matches || S.rmToggle; applyFlags(); syncCtl(); });
  document.body.insertAdjacentHTML('beforeend', '<div id="probe" class="probe" aria-hidden="true"></div>');
  { const w = Number(Q.get('w')) || innerWidth; const k = PRESETS[Q.get('preset')] ? Q.get('preset') : (w < 900 ? 'android-phone' : 'web-host'); const p = PRESETS[k]; S.preset = k; S.hapticCap = p.haptic; setHoverUi(p.hover); setTouchUi(!p.hover); }
  applyStatic(); buildControls(); renderTranscript(); renderExtras(); layout(); paintInset(); $('#haptic').hidden = !S.hapticCap;
  $('#skip').addEventListener('click', (e) => { e.preventDefault(); (activeEl() || $('#input')).focus(); });
  const sc = scroller();
  sc.addEventListener('scroll', onScroll, { passive: true });
  ['wheel', 'touchmove'].forEach((ev) => sc.addEventListener(ev, () => (userIntentUntil = now() + 300), { passive: true }));
  sc.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') userIntentUntil = now() + 300; }, { passive: true });
  new ResizeObserver(() => { fitInput(); if (S.atBottom) scrollBottom(); }).observe(sc);
  addEventListener('resize', () => { layout(); fitInput(); markPre(); });
  if (window.visualViewport) { VV.base = visualViewport.height; visualViewport.addEventListener('resize', () => { VV.base = Math.max(VV.base, visualViewport.height); onViewportDrop(VV.base - visualViewport.height); }); }
  document.addEventListener('focusin', (e) => { if (isTextField(e.target) && window.visualViewport) onViewportDrop(VV.base - visualViewport.height); });
  // pointers: last-used input decides the affordances; the sidebar edge drag is decided here from the pointerdown x (no overlay)
  addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') { setHoverUi(true); setTouchUi(false); } else { setHoverUi(false); setTouchUi(true); LASTTOUCH = now(); S.kbdSinceTouch = false; }
    if (e.pointerType !== 'mouse' && e.isPrimary && !S.desktop && !S.sbOpen && !Sh.open && sbZone(e.clientX)) sbDown(e, 'open');
  }, true);
  addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && !S.hoverUi) { setHoverUi(true); setTouchUi(false); } }, { passive: true });
  sc.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || e.button > 0) return; const el = e.target.closest('.msg'); if (!el) return;
    if (e.target.closest('button, a, input, textarea, summary')) return;
    const m = msgOf(el); if (!m) return;
    dragStart(e, el, m, true, e.target);
  });
  addEventListener('pointermove', dragMove, { passive: false });
  addEventListener('pointerup', (e) => dragEnd(e, false)); addEventListener('pointercancel', (e) => { if (D.active && D.locked !== 'x') { endRing(); D.active = false; } else dragEnd(e, true); });
  sc.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.msg'); if (!el) return; const m = msgOf(el); const touchy = now() - LASTTOUCH < 900;
    if (!touchy && !e.shiftKey && selectionIn(m)) { log('contextmenu: native menu kept (selection inside the message)'); return; }
    e.preventDefault(); if (touchy || now() - CTXAT < 200) return;
    CTXAT = now(); const kbd = e.clientX === 0 && e.clientY === 0; log('contextmenu -> action menu' + (e.shiftKey ? ' (forced by Shift)' : ''));
    openActions(m, el, kbd ? null : { x: e.clientX, y: e.clientY });
  });
  sc.addEventListener('wheel', onWheel, { passive: false });
  addEventListener('mouseup', (e) => { if (e.button === 3) { if (Sh.open) { e.preventDefault(); closeSheet(); log('mouse back: sheet closed'); } else if (S.sbOpen && !S.desktop) { e.preventDefault(); closeSidebar(); log('mouse back: sidebar closed'); } } }, true);
  thread().addEventListener('pointerdown', (e) => { if (e.target.closest('.pager .btn')) armGuard(); }, true);
  thread().addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return; if (b.getAttribute('aria-disabled') === 'true') return;
    const el = b.closest('.msg'); const m = el && msgOf(el);
    switch (b.dataset.act) {
      case 'prev': armGuard(); goAlt(m, -1); break; case 'next': armGuard(); goAlt(m, 1); break;
      case 'new': newReply('button'); break;
      case 'menu': openActions(m, b); break; case 'gen': newReply('gen'); break;
      case 'fc-retry': retryFail(m, 'button'); break;
      case 'fc-dismiss': m.fcReturn = false; syncReturnRow(el, m); clearReturnParams(); focusRetry(el); break;
      case 'act': { const a = reg(b.dataset.aid); if (a) runAct(a, m, { selText: selectionIn(m), shift: e.shiftKey }); break; }
    }
  });
  thread().addEventListener('focusin', (e) => { const el = e.target.closest('.msg'); if (el && el.tabIndex !== 0 && !Sh.open) setActive(el); });
  sc.addEventListener('keydown', onTranscriptKey);
  addEventListener('keydown', (e) => {
    noteKey(e);
    if (['Tab', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'F6'].includes(e.key) && !S.desktop) showHeader();   // key navigation brings the header back before focus moves
    const sheetWas = Sh.open;                                         // a sheet closed by this very Esc must not also close the sidebar behind it (slice 2 opens sheets over the sidebar)
    sheetKeys(e); sbKeys(e); hotkeys(e);
    if (e.key === 'Escape' && !sheetWas && !Sh.open && S.sbOpen && !S.desktop) { e.preventDefault(); closeSidebar(); }
  }, true);
  // header and sidebar
  $('#sbBtn').addEventListener('click', () => { if (SB.suppressClick) return; S.sbOpen ? closeSidebar() : openSidebar($('#sbBtn')); });
  $('#sbBtn').addEventListener('pointerdown', (e) => sbDown(e, 'open'));
  $('#moreBtn').addEventListener('click', openChatOptions);
  $('#sidebar').addEventListener('pointerdown', (e) => { if (S.sbOpen) sbDown(e, 'close'); });
  $('#sbBackdrop').addEventListener('pointerdown', (e) => { if (S.sbOpen) sbDown(e, 'close'); });
  addEventListener('pointermove', sbMove); addEventListener('pointerup', sbUp); addEventListener('pointercancel', sbUp);
  $('#sbBackdrop').addEventListener('click', () => { if (SB.suppressClick) return; closeSidebar(); });
  $('.sb-close').addEventListener('click', () => closeSidebar());
  $('#sidebar').addEventListener('click', (e) => { if (SB.suppressClick) { e.preventDefault(); e.stopPropagation(); } }, true);
  // composer
  const ta = $('#input');
  ta.addEventListener('input', () => { fitInput(); syncSend(); });
  ta.addEventListener('keydown', onInputKey);
  ta.addEventListener('compositionstart', () => (IME.composing = true)); ta.addEventListener('compositionend', () => { IME.composing = false; IME.compEnd = now(); });
  ta.addEventListener('focus', () => { if (S.kb && S.atBottom) requestAnimationFrame(scrollBottom); });
  $('#composer').addEventListener('submit', (e) => { e.preventDefault(); if (S.hooks.submit && S.hooks.submit(e)) return; if (S.streaming) stopStream(); else doSend(); });
  $('#sendBtn').addEventListener('click', (e) => { if ($('#sendBtn').getAttribute('aria-disabled') === 'true') { e.preventDefault(); if (S.sendBlock && $('#input').value.trim()) toast(S.sendBlock); } });
  $('#plusBtn').addEventListener('click', openPlus); $('#personaBtn').addEventListener('click', openPersona);
  $('#kbdHide').addEventListener('click', () => setKb(false));
  $('#sheetRoot .sheet-backdrop').addEventListener('click', () => { if (now() - Sh.at < 600) return; closeSheet(); });
  sheetDragInit();
  fitInput(); setPersonaLabel(); layoutDock();
  if (Q.get('kb') === '1') setKb(true);
  // window.__chat: the hooks the other lanes call (HOOKS1_SPEC). failReply is the agreed shape from Settings DS-043; the rest is for the demo controls and the checks.
  window.__chat = { markFailed, failReply, retryFail, failNext, demoFail, history: historyOf, actionToast, closeActionToast, restoreFromSettings, DEMO_FAIL, FAIL_REASONS, openPlus };
  window.__slice1 = { tokNum, queueRuns, markCritical, FAILCTX, markFailed, stashSet, openPlus, failReply, retryFail, historyOf, actionToast, closeActionToast, renderMsg, fillMsg, markPre, genRow, josa, ICONS, openSheet, closeSheet, swapSheet, item, tile, group, renderTranscript, refreshAll, scrollBottom, scroller, thread, updateCV, setActive, activeEl, esc, ic, toast, announce, setLabel, syncSend, setPersonaLabel, personaName, PERSONAS, detachStream, attachStream, altText, nameOf, isNewestChar, applyStatic, layout, fitInput, plainOf, wordCount, haptic, durOf, afterTransition, syncInert, hideSnack, renderExtras, buildControls, syncCtl, clamp, now, rerenderMsg, buildPlan, t, roParticle, S, ST, D, SB, SN, L, ACT, WH, IME, VV, Sh, I18N, measure, log: S.log, tokenize, setKb, openActions, openCustomize, confirmDelete, removeMsgs, undoDelete, generateNew, newReply, stopStream, finishStream, feed, goAlt, showHeader, hideHeader, openSidebar, closeSidebar, simulateIME, resetChat, lastMsg, setLang, buildPlan, releaseHold: () => { ST.holdUntil = 0; ST.hold = ''; }, previewArmed, onViewportDrop, enterAction, setPlugin, pinnedFor, msgEl, armGuard, guardLeft: () => Math.max(0, guardUntil - now()), setLevel };
  restoreFromSettings();
  { const th = thread(); if (th) new MutationObserver(queueRuns).observe(th, { childList: true }); queueRuns(); }
  stampKinds(document.body); new MutationObserver((recs) => recs.forEach((r) => r.addedNodes.forEach(stampKinds))).observe(document.body, { childList: true, subtree: true });      // DD-153: data-kind on every control      // a message arrived or went away (send, delete, undo, a group round, the long list's window)
  const state = Q.get('state');
  if (state) setTimeout(() => runState(state), 60);
  if (Q.get('alt')) { const m = lastMsg(); m.idx = clamp(Number(Q.get('alt')) - 1, 0, m.alts.length - 1); rerenderMsg(m); }
}
function runState(s) {
  if (s === 'streaming') { ST.hold = Q.get('hold') || 'code'; generateNew(); }
  else if (s === 'today') { S.today = true; syncCtl(); ST.hold = Q.get('hold') || 'style'; generateNew(); }
  else if (s === 'armed') previewArmed();
  else if (s === 'sheet') openActions(lastMsg(), msgEl(lastMsg()));
  else if (s === 'customize') { openActions(lastMsg(), msgEl(lastMsg())); setTimeout(() => { Sh.at = 0; openCustomize(); }, 60); }
  else if (s === 'confirm') confirmDelete(S.msgs[S.msgs.length - 6], true);
  else if (s === 'snack') removeMsgs([lastMsg()], { undo: true });
  else if (s === 'sidebar') { if (!S.desktop) openSidebar($('#sbBtn')); }
  else if (/^hk-fail-/.test(s)) runFailState(s.slice(8));
}
// ?state=hk-fail-<reason> (key, model, quota, network, network-addr, server), hk-fail-regen (the failed generation was a New reply on a reply that has alternatives), hk-fail-return (the Settings round trip)
function runFailState(k) {
  if (FAIL_REASONS.includes(k)) { demoFail(k, { immediate: true }); return; }
  if (k === 'network-addr') { const m = generateNew({ newMsg: true }); if (m) failReply(m.id, DEMO_FAIL.networkAddr); return; }
  if (k === 'regen') { demoFail('model', { immediate: true, regen: true }); return; }
  if (k === 'return') { const m = demoFail('key', { immediate: true }); if (!m) return; m.fcReturn = true; const el = msgEl(m); if (el) { fillMsg(el, m, S.msgs.indexOf(m)); scrollBottom(); setTimeout(() => focusRetry(el), 60); } }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
