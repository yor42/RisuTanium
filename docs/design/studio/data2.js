/* Studio slice 2: copy (ko/en) and synthetic toggle fixtures for the list builder. All data is invented for this mockup.
   Load after data.js, before slice1.js. Wraps StudioData.build so the toggle definitions of the preset, two modules, one off module and the character are richer:
   a key shared by the preset and a module, an unclosed group (in the off module), unreadable lines, KO and EN labels, every type. Nothing is read from the app. */
(function () {
  'use strict';
  var D = window.StudioData; window.StudioSS = 'st2:'; window.StudioTabs = ['problems', 'test', 'history', 'preview'];
  var K = {
    tgViewLbl: '보기', tgViewList: '목록', tgViewText: '텍스트', tgAdd: '토글 추가', tgType_check: '켜기/끄기', tgType_select: '선택', tgType_text: '짧은 글', tgType_textarea: '긴 글', tgType_group: '묶음', tgType_divider: '구분선', tgType_caption: '설명',
    tgKey: '키', tgKeyDot: '키 · ', tgAdvanced: '고급', tgOptions: '선택지', tgAddOption: '선택지 추가',
    tgErrEq: '‘=’는 쓸 수 없어요 — 토글 형식이 이 글자에서 줄을 나눠요', tgErrComma: '선택지에는 ‘,’를 쓸 수 없어요', tgErrNl: '줄바꿈은 쓸 수 없어요 — 한 줄에 토글 하나예요', tgErrKeyEmpty: '키가 비어 있어요', tgErrLabelEmpty: '이름이 비어 있어요', tgErrOptEmpty: '선택지가 비어 있어요',
    tgDupKey: '같은 키가 두 번 있어요', tgShared: '같은 키 · {owner}와 값을 함께 써요', tgSharedDiff: '같은 키, 종류가 달라요 · {owner}', tgSpill: '묶음이 닫히지 않아 다음 출처의 토글이 이 묶음 안으로 들어가요', tgUnclosed: '묶음이 닫히지 않았어요', tgCloseGroup: '묶음 닫기',
    tgUnreadable: '읽을 수 없는 줄', tgWhyKeyLabel: '키와 이름이 필요해요', tgWhyCaption: '설명에는 글이 필요해요', tgFewOpts: '‘{name}’의 선택지가 2개보다 적어요', tgFew: '선택지 2개 미만', tgFewHint: '선택지는 2개 이상이어야 해요', tgNotWritten: '저장되지 않은 글자가 있어요',
    tgCarryAsk: '저장된 값이 있는 채팅이 있을 수 있어요. 이 변경 뒤에는 이전 값이 이 토글과 이어지지 않아요.', tgCarryYes: '값 옮기기', tgCarryNo: '그대로 두기', tgCarried: '채팅 {n}개의 값을 옮겼어요', tgLeft: '값을 그대로 두었어요',
    tgCarryKey: '키 {from} → {to}', tgCarryOpts: '선택지의 순서나 개수가 바뀌었어요', tgCarryType: '종류 {from} → {to} (값은 변환할 수 없어요)', tgCarryPending: '값을 옮길지 정해 주세요', tgStepCarried: '값 옮김', tgStepLeft: '값 그대로 둠',
    tgPreviewNote: '미리보기 값 · 채팅에는 저장되지 않아요', tgScopeLbl: '미리보기 범위', tgScopeOwner: '이 출처만', tgScopeAll: '합쳐진 결과', tgNoGroupInGroup: '묶음 안에는 묶음을 넣을 수 없어요', tgEmpty: '아직 토글이 없어요', tgEmptyHint: '여기서 만든 토글은 채팅의 토글 패널에 나타나요',
    tabPreview: '미리보기', tgPreviewBtn: '미리보기 열기', tgPreviewAll: '전체 미리보기', tgPreviewBad: '읽을 수 없는 줄 {n}개는 보이지 않아요', tgBadNote: '읽을 수 없는 줄 {n}개는 보이지 않아요', tgPreviewNone: '보여 줄 토글이 없어요', tgPvSelected: '‘{name}’ 줄을 골랐어요',
    tgMergedBtn: '합쳐서 보기', tgMergedLead: '프리셋 → 모듈 → 캐릭터 순서로 합쳐져요', tgOffModules: '꺼진 모듈 (채팅에 나오지 않아요)', tgOffOwner: '꺼진 출처예요. 채팅의 토글 패널에는 나타나지 않아요', tgSwallowed: '앞 출처의 열린 묶음 안으로 들어가요', tgEmptyGroup: '빈 묶음 · 채팅에는 켜기/끄기 스위치로 보여요',
    tgSrcPreset: '프리셋', tgSrcModule: '모듈', tgSrcChar: '캐릭터',
    tgStepEdit: '‘{name}’ 편집', tgStepKey: '키 {from} → {to}', tgStepOpts: '‘{name}’ 선택지 편집', tgStepOptAdd: '‘{name}’ 선택지 추가', tgStepOptDel: '‘{name}’ 선택지 삭제', tgStepOptMove: '‘{name}’ 선택지 순서 변경', tgStepType: '‘{name}’ 종류 {from} → {to}', tgStepMove: '‘{name}’ 옮김',
    tgStepAdd: '‘{name}’ 추가', tgStepDel: '‘{name}’ 삭제', tgStepRestore: '삭제 되돌림: ‘{name}’', tgStepDup: '‘{name}’ 복제', tgStepPaste: '줄 {n}개 붙여넣음', tgStepClose: '묶음 ‘{name}’ 닫음', tgStepFix: '읽을 수 없는 줄 고침', tgStepText: '텍스트 편집',
    tgMoveEnd: '더 옮길 수 없어요', tgMovedTo: '‘{name}’ {n}번째로', tgMoved: '‘{name}’ 옮겼어요', tgMovedInto: '‘{name}’을(를) 묶음 안으로 옮겼어요', tgMovedOut: '‘{name}’을(를) 묶음 밖으로 옮겼어요', tgAdded: '‘{name}’ 추가했어요', tgDeleted: '삭제했어요: {name}', tgDuplicated: '‘{name}’ 복제했어요', tgPasted: '줄 {n}개를 붙여넣었어요', tgClosed: '묶음을 닫았어요',
    tgSumSelect: '{n}개 중 하나', tgSumText: '짧은 글', tgSumArea: '긴 글', tgSumGroup: '{n}개', tgSumCheck: '켜기/끄기', tgFold: '묶음 접기', tgUnfold: '묶음 펼치기', tgRowMenu: '행 메뉴', tgDuplicate: '복제', tgMoveToGroup: '묶음으로 옮기기', tgMoveOut: '묶음 밖으로', tgNoGroups: '옮길 묶음이 없어요', tgNoName: '이름 없음', tgDivNoName: '(이름 없는 구분선)',
    tgPickHint: '추가할 종류를 골라 주세요', tgPickTitle: '토글 종류', tgHint_check: '켜고 끄는 스위치', tgHint_select: '목록에서 하나 고르기', tgHint_text: '한 줄 글 입력', tgHint_textarea: '여러 줄 글 입력', tgHint_group: '토글을 접어 두는 묶음', tgHint_divider: '나누는 선 (제목은 선택)', tgHint_caption: '작은 설명 글',
    tgPasteText: '텍스트로 붙여넣기', tgPasteHint: '줄마다 한 항목이에요. 쓴 그대로 목록에 들어가요', tgPasteLbl: '붙여넣을 줄', tgPasteDo: '추가',
    tgNew_check: '새 토글', tgNew_select: '새 선택', tgNew_text: '새 짧은 글', tgNew_textarea: '새 긴 글', tgNew_group: '새 묶음', tgNew_caption: '설명을 입력하세요', tgOptN: '선택지 {n}',
    tgEditRow: '토글 편집', tgPickRow: '목록에서 토글을 골라 주세요', tgName: '이름', tgLblGroup: '묶음 이름', tgLblCaption: '설명 글', tgOptional: '(선택)', tgTypeLbl: '종류', tgOptionN: '선택지 {n}', tgOptUp: '선택지 {n} 위로', tgOptDown: '선택지 {n} 아래로', tgOptDel: '선택지 {n} 지우기',
    tgKeySpace: '키 앞뒤에 공백이 있어요. 엔진은 공백도 키의 일부로 읽어요', tgCopy: 'CBS 식 복사', tgCopied: '복사했어요', tgGroupKeyNote: '묶음의 키는 엔진이 쓰지 않아요 (줄에만 적혀요)', tgRawLine: '줄 내용', tgBadKept: '고치거나 지우기 전에는 쓴 그대로 보관해요', tgBackToList: '목록으로', tgListLbl: '토글 목록', tgOptsDropped: '선택지를 지웠어요',
    tgHelpTitle: '형식 도움말', tgHelpLead: '한 줄에 하나: 키=이름=종류=선택지. 넷째 ‘=’ 뒤는 무시돼요. 키·이름·선택지에는 ‘=’를 쓸 수 없고, 선택지에는 ‘,’도 쓸 수 없어요', tgHelpCheck: '켜기/끄기 (종류 생략)', tgHelpSelect: '선택 (선택지는 쉼표로)', tgHelpText: '짧은 글', tgHelpArea: '긴 글', tgHelpGroup: '묶음: 시작 줄과 끝 줄이 짝이에요. 묶음 안에 묶음은 둘 수 없어요', tgHelpDiv: '구분선 (이름은 선택)', tgHelpCap: '설명 (글이 있어야 해요)',
    tgTextHint: '쓴 글이 그대로 저장돼요. 목록에서 만진 줄만 다시 써요', tgLintTitle: '검사', tgLineN: '{n}번째 줄', tgLintNone: '문제가 없어요', tgLintExtra: '넷째 ‘=’ 뒤는 무시돼요', tgLintUnknown: '알 수 없는 종류 ‘{type}’는 켜기/끄기로 읽혀요', tgLintNest: '묶음 안에는 묶음이 들어가지 않아요. 새 묶음으로 읽혀요', tgLintOrphanEnd: '짝이 없는 묶음 끝 줄이에요',
    fToggleHelp: '토글 정의는 목록으로 편집해요. 텍스트 보기에서는 쓴 글이 그대로 저장돼요', phToggles: '토글 미리보기는 ‘미리보기’ 탭에 있어요'
  };
  var E = {
    tgViewLbl: 'View', tgViewList: 'List', tgViewText: 'Text', tgAdd: 'Add toggle', tgType_check: 'On/off', tgType_select: 'Choice', tgType_text: 'Short text', tgType_textarea: 'Long text', tgType_group: 'Group', tgType_divider: 'Divider', tgType_caption: 'Note',
    tgKey: 'Key', tgKeyDot: 'Key · ', tgAdvanced: 'Advanced', tgOptions: 'Options', tgAddOption: 'Add option',
    tgErrEq: 'You can\'t use ‘=’ — the toggle format splits lines at it', tgErrComma: 'Options can\'t contain ‘,’', tgErrNl: 'Line breaks aren\'t allowed — one toggle per line', tgErrKeyEmpty: 'The key is empty', tgErrLabelEmpty: 'The name is empty', tgErrOptEmpty: 'The option is empty',
    tgDupKey: 'This key is used twice', tgShared: 'Same key · shares its value with {owner}', tgSharedDiff: 'Same key, different kind · {owner}', tgSpill: 'This group is never closed, so the next source\'s toggles fall into it', tgUnclosed: 'This group is never closed', tgCloseGroup: 'Close group',
    tgUnreadable: 'Unreadable line', tgWhyKeyLabel: 'It needs a key and a name', tgWhyCaption: 'A note needs text', tgFewOpts: '‘{name}’ has fewer than 2 options', tgFew: 'Fewer than 2 options', tgFewHint: 'A choice needs at least 2 options', tgNotWritten: 'Text not saved yet',
    tgCarryAsk: 'Some chats may have saved values. After this change, the old values no longer belong to this toggle.', tgCarryYes: 'Carry values over', tgCarryNo: 'Leave them', tgCarried: 'Moved values in {n} chats', tgLeft: 'Values left as they are',
    tgCarryKey: 'Key {from} → {to}', tgCarryOpts: 'The order or number of options changed', tgCarryType: 'Kind {from} → {to} (values can\'t be converted)', tgCarryPending: 'Decide about saved values', tgStepCarried: 'values carried over', tgStepLeft: 'values left',
    tgPreviewNote: 'Preview values · not saved to any chat', tgScopeLbl: 'Preview scope', tgScopeOwner: 'This source only', tgScopeAll: 'Combined result', tgNoGroupInGroup: 'A group can\'t go inside a group', tgEmpty: 'No toggles yet', tgEmptyHint: 'Toggles made here appear in the chat\'s toggle panel',
    tabPreview: 'Preview', tgPreviewBtn: 'Open preview', tgPreviewAll: 'Preview everything', tgPreviewBad: '{n} unreadable lines are not shown', tgBadNote: '{n} unreadable lines are not shown', tgPreviewNone: 'No toggles to show', tgPvSelected: 'Selected ‘{name}’',
    tgMergedBtn: 'Combined view', tgMergedLead: 'Joined as preset → modules → character', tgOffModules: 'Off modules (not in the chat)', tgOffOwner: 'This source is off. It does not appear in the chat\'s toggle panel', tgSwallowed: 'Falls into an open group of an earlier source', tgEmptyGroup: 'Empty group · shown as an on/off switch in the chat',
    tgSrcPreset: 'Preset', tgSrcModule: 'Module', tgSrcChar: 'Character',
    tgStepEdit: 'Edited ‘{name}’', tgStepKey: 'key {from} → {to}', tgStepOpts: 'Edited options of ‘{name}’', tgStepOptAdd: 'Added option to ‘{name}’', tgStepOptDel: 'Removed option of ‘{name}’', tgStepOptMove: 'Reordered options of ‘{name}’', tgStepType: '‘{name}’ kind {from} → {to}', tgStepMove: 'Moved ‘{name}’',
    tgStepAdd: 'Added ‘{name}’', tgStepDel: 'Deleted ‘{name}’', tgStepRestore: 'Restored ‘{name}’', tgStepDup: 'Duplicated ‘{name}’', tgStepPaste: 'Pasted {n} lines', tgStepClose: 'Closed group ‘{name}’', tgStepFix: 'Fixed an unreadable line', tgStepText: 'Edited text',
    tgMoveEnd: 'Can\'t move further', tgMovedTo: '‘{name}’ now number {n}', tgMoved: 'Moved ‘{name}’', tgMovedInto: 'Moved ‘{name}’ into the group', tgMovedOut: 'Moved ‘{name}’ out of the group', tgAdded: 'Added ‘{name}’', tgDeleted: 'Deleted {name}', tgDuplicated: 'Duplicated ‘{name}’', tgPasted: 'Pasted {n} lines', tgClosed: 'Group closed',
    tgSumSelect: 'one of {n}', tgSumText: 'Short text', tgSumArea: 'Long text', tgSumGroup: '{n}', tgSumCheck: 'On/off', tgFold: 'Collapse group', tgUnfold: 'Expand group', tgRowMenu: 'Row menu', tgDuplicate: 'Duplicate', tgMoveToGroup: 'Move into group', tgMoveOut: 'Out of the group', tgNoGroups: 'No groups to move into', tgNoName: 'No name', tgDivNoName: '(unnamed divider)',
    tgPickHint: 'Pick a kind to add', tgPickTitle: 'Toggle kind', tgHint_check: 'A switch', tgHint_select: 'Pick one from a list', tgHint_text: 'One line of text', tgHint_textarea: 'Several lines of text', tgHint_group: 'Folds toggles away', tgHint_divider: 'A dividing line (title optional)', tgHint_caption: 'A small note',
    tgPasteText: 'Paste as text', tgPasteHint: 'One entry per line. Lines go into the list exactly as written', tgPasteLbl: 'Lines to paste', tgPasteDo: 'Add',
    tgNew_check: 'New toggle', tgNew_select: 'New choice', tgNew_text: 'New short text', tgNew_textarea: 'New long text', tgNew_group: 'New group', tgNew_caption: 'Write a note', tgOptN: 'Option {n}',
    tgEditRow: 'Edit toggle', tgPickRow: 'Pick a toggle from the list', tgName: 'Name', tgLblGroup: 'Group name', tgLblCaption: 'Note text', tgOptional: '(optional)', tgTypeLbl: 'Kind', tgOptionN: 'Option {n}', tgOptUp: 'Move option {n} up', tgOptDown: 'Move option {n} down', tgOptDel: 'Remove option {n}',
    tgKeySpace: 'The key has leading or trailing spaces. The engine reads them as part of the key', tgCopy: 'Copy CBS snippet', tgCopied: 'Copied', tgGroupKeyNote: 'The engine does not use a group\'s key (it is only written on the line)', tgRawLine: 'Line', tgBadKept: 'It is kept as written until you fix or delete it', tgBackToList: 'Back to the list', tgListLbl: 'Toggle list', tgOptsDropped: 'Options removed',
    tgHelpTitle: 'Format help', tgHelpLead: 'One per line: key=name=kind=options. Anything after the fourth ‘=’ is ignored. ‘=’ can\'t appear in a key, name or option, and ‘,’ can\'t appear in an option', tgHelpCheck: 'On/off (kind omitted)', tgHelpSelect: 'Choice (options separated by commas)', tgHelpText: 'Short text', tgHelpArea: 'Long text', tgHelpGroup: 'Group: a start line and an end line belong together. Groups can\'t nest', tgHelpDiv: 'Divider (name optional)', tgHelpCap: 'Note (needs text)',
    tgTextHint: 'What you type is saved as is. Only lines you touch in the list are rewritten', tgLintTitle: 'Checks', tgLineN: 'Line {n}', tgLintNone: 'No problems', tgLintExtra: 'Anything after the fourth ‘=’ is ignored', tgLintUnknown: 'Unknown kind ‘{type}’ is read as on/off', tgLintNest: 'Groups don\'t nest. This starts a new group', tgLintOrphanEnd: 'A group end line without a start',
    fToggleHelp: 'Edit toggle definitions as a list. The text view saves exactly what you type', phToggles: 'The toggle preview is in the Preview tab'
  };
  /* rev 2 copy (review M-1..M-7, DD-109..DD-114): overrides and additions */
  var K2 = {
    tgErrEq: '‘=’는 쓸 수 없어요 — 토글 형식이 ‘=’로 칸을 나눠요', tgNotWritten: '이 글자는 반영되지 않았어요', tgCopy: '복사하기', tgRowMenu: '줄 메뉴', tgBadList: '읽을 수 없는 줄 {n}개 · 채팅에는 나오지 않아요',
    tgEmptyGroup: '빈 묶음 · 채팅에는 나오지 않아요. 채우거나 지워 주세요',
    tgCarryHead: '저장된 값을 확인해 주세요', tgCarryAskKey: '저장된 값은 앱 전체에서 하나(전역 값)예요. 값을 고정해 둔 채팅은 그 채팅이 따로 가지고 있어요. 키를 바꾸면 이전 키의 값이 새 키로 이어지지 않아요.',
    tgCarryAskOpts: '선택한 값은 선택지의 번호로 저장돼요. 순서나 개수가 바뀌면 저장된 번호가 다른 선택지를 가리켜요. 값 옮기기는 번호만 새 순서에 맞게 바꿔요.',
    tgCarryAskType: '저장된 값은 지워지지 않지만 새 종류로 다르게 읽혀요 (선택은 번호로 저장돼요). 값은 변환할 수 없어요.',
    tgCarryAskDrop: '이 줄은 더 이상 토글이 아니라서 저장된 값을 읽는 곳이 없어요. CBS에서 쓰고 있다면 같이 고쳐 주세요.',
    tgCarryYes: '값 옮기기', tgCarryNo: '그대로 두기', tgCarryOk: '확인', tgCarryYesHint: '전역 값과 값을 고정한 채팅의 값을 함께 옮겨요. 이 단계는 따로 되돌릴 수 있어요.',
    tgCarried: '값을 옮겼어요 (전역 값과 값을 고정한 채팅)', tgCarriedUndo: '값 옮김 되돌리기', tgLeft: '값을 그대로 두었어요',
    tgCarryLineKey: '키 {from} → {to}', tgCarryLineOpts: '‘{name}’ 선택지의 순서나 개수', tgCarryLineType: '‘{name}’ 종류 {from} → {to}', tgCarryLineDrop: '‘{key}’ 줄이 {to}(으)로 바뀜',
    tgCarryOverwrite: '‘{key}’는 {owner}도 쓰고 있어요. 옮기면 그 값을 덮어써요.', tgCarryOthers: '이전 키 ‘{key}’는 {owner}도 쓰고 있어요. 그쪽 값은 그대로예요.',
    tgCarryPending: '값을 옮길지 정해 주세요', tgCarryPendingProb: '저장된 값을 어떻게 할지 정해 주세요', tgStepCarry: '값 옮김: {what}', tgStepCarried: '값 옮김', tgStepLeft: '값 그대로 둠',
    tgRefsTitle: 'CBS에서 ‘toggle_{key}’를 쓰는 곳 {n}곳', tgRefsRow: '{owner} › {item} · {field}', tgRefsUpdate: '모두 새 키로 바꾸기', tgRefsSearch: '검색에서 보기', tgRefsDone: '{n}곳을 새 키로 바꿨어요', tgRefsUndo: '모두 되돌리기', tgStepRefs: '사용처 {from} → {to} 바꿈',
    tgKeyInner: '공백이 있는 키는 CBS에서 쓰기 번거로워요', tgKeyTwin: '‘{other}’와 대소문자나 공백만 달라요. 헷갈릴 수 있어요',
    tgPasteMoved: '묶음 안에는 묶음을 넣을 수 없어 묶음 밖에 붙여넣었어요', tgOrphanEnd: '짝 없는 묶음 끝 줄', tgWhyOrphan: '짝이 되는 묶음 시작 줄이 없어요. 엔진은 이 줄을 건너뛰어요',
    tgWarnTail: '이 줄을 고치면 넷째 ‘=’ 뒤의 글자는 지워져요', tgWarnUnknown: '이 줄을 고치면 알 수 없는 종류 ‘{type}’는 켜기/끄기 줄로 바뀌어요', tgAddInGroup: '묶음에 토글 추가',
    tgPvUnset: '(값 없음)', tgUnknownState: '알 수 없는 상태예요: {name}. 이름을 확인해 주세요', tgSplitGroup: '묶음의 끝 줄이 다른 출처에 있어요', tgPvKeyTip: '키 · {key}'
  };
  var E2 = {
    tgErrEq: "You can't use ‘=’ — the toggle format splits its fields at it", tgNotWritten: 'This text was not applied', tgCopy: 'Copy', tgRowMenu: 'Line menu', tgBadList: '{n} unreadable lines · they do not appear in the chat',
    tgEmptyGroup: 'Empty group · it does not appear in the chat. Fill it or delete it',
    tgCarryHead: 'Check the saved values', tgCarryAskKey: "A saved value is one entry for the whole app (the global value); chats that pinned a value keep their own copy. After a key rename the old key's value no longer follows the toggle.",
    tgCarryAskOpts: 'A chosen value is saved as the option number. If the order or the number of options changes, a saved number points to another option. Carry values over only renumbers to the new order.',
    tgCarryAskType: "The saved value is not erased, but the new kind reads it differently (a choice is saved as a number). Values can't be converted.",
    tgCarryAskDrop: 'This line is no longer a toggle, so nothing reads its saved value. If CBS uses it, fix that too.',
    tgCarryYes: 'Carry values over', tgCarryNo: 'Leave them', tgCarryOk: 'OK', tgCarryYesHint: 'Moves the global value and the values of chats that pinned it. This step can be undone on its own.',
    tgCarried: 'Values moved (global value and pinned chats)', tgCarriedUndo: 'Undo the carry', tgLeft: 'Values left as they are',
    tgCarryLineKey: 'Key {from} → {to}', tgCarryLineOpts: 'Options order or count of ‘{name}’', tgCarryLineType: '‘{name}’ kind {from} → {to}', tgCarryLineDrop: '‘{key}’ became a {to}',
    tgCarryOverwrite: '‘{key}’ is also used by {owner}. Carrying over overwrites that value.', tgCarryOthers: "The old key ‘{key}’ is also used by {owner}. Their value stays.",
    tgCarryPending: 'Decide about saved values', tgCarryPendingProb: 'Decide what happens to the saved values', tgStepCarry: 'Carried values: {what}', tgStepCarried: 'values carried over', tgStepLeft: 'values left',
    tgRefsTitle: '{n} places in CBS use ‘toggle_{key}’', tgRefsRow: '{owner} › {item} · {field}', tgRefsUpdate: 'Change all to the new key', tgRefsSearch: 'Show in search', tgRefsDone: 'Changed {n} places to the new key', tgRefsUndo: 'Undo all', tgStepRefs: 'Uses {from} → {to} changed',
    tgKeyInner: 'A key with a space is awkward to use in CBS', tgKeyTwin: 'Differs from ‘{other}’ only by case or spaces. Easy to mix up',
    tgPasteMoved: "A group can't go inside a group, so the lines were pasted outside it", tgOrphanEnd: 'Group end without a start', tgWhyOrphan: 'There is no matching group start line. The engine skips this line',
    tgWarnTail: 'Editing this line removes everything after the fourth ‘=’', tgWarnUnknown: "Editing this line turns the unknown kind ‘{type}’ into an on/off line", tgAddInGroup: 'Add toggle to group',
    tgPvUnset: '(no value)', tgUnknownState: 'Unknown state: {name}. Check the name', tgSplitGroup: 'The group end line is in another source', tgPvKeyTip: 'Key · {key}'
  };
  Object.keys(K2).forEach(function (k) { K[k] = K2[k]; }); Object.keys(E2).forEach(function (k) { E[k] = E2[k]; });
  /* rev 2.1 copy */
  var K3 = {
    tgCarryYesHint: '전역 값과 값을 고정한 채팅의 값을 함께 옮겨요. 이 항목을 연 동안에는 이 단계만 따로 되돌릴 수 있어요.', tgCarryNoUndo: '값 옮김은 이전에 연 때의 일이라 되돌려지지 않아요. 저장된 값은 그대로예요', tgCarryCancelled: '저장된 값을 확인할 일이 없어졌어요',
    tgPlaces: '곳', tgRefsSkipped: '건너뛴 출처 · 이 출처도 ‘{key}’ 토글을 가지고 있어서, 거기서 쓰는 ‘toggle_{key}’는 그 출처의 토글을 가리킬 수 있어요', tgRefsAlso: '{owner}도 바꾸기',
    tgRefsBlocked: '되돌리지 못했어요: {owners}이(가) 그 뒤에 바뀌었어요. 그 변경을 먼저 되돌려 주세요. 아무것도 바뀌지 않았어요', tgRefsUndo: '모두 되돌리기'
  };
  var E3 = {
    tgCarryYesHint: 'Moves the global value and the values of chats that pinned it. While you are in this item this step can be undone on its own.', tgCarryNoUndo: 'The carry belongs to an earlier visit, so it is not undone. The saved values stay as they are', tgCarryCancelled: 'There is nothing left to decide about the saved values',
    tgPlaces: ' places', tgRefsSkipped: 'Skipped sources · these also define ‘{key}’, so their ‘toggle_{key}’ may mean their own toggle', tgRefsAlso: 'Change {owner} too',
    tgRefsBlocked: 'Could not undo: {owners} changed afterwards. Undo that change first. Nothing was changed', tgRefsUndo: 'Undo all'
  };
  Object.keys(K3).forEach(function (k) { K[k] = K3[k]; }); Object.keys(E3).forEach(function (k) { E[k] = E3[k]; });
  Object.keys(K).forEach(function (k) { D.I18N.ko[k] = K[k]; }); Object.keys(E).forEach(function (k) { D.I18N.en[k] = E[k]; });

  var origBuild = D.build;
  // fixtures: lines are written the way an author (or an older tool) might: odd spacing, comments, unknown types
  var FX = {
    ko: {
      p1: 'longform=긴 답변\nstyle_warm=따뜻한 문체 (프리셋)\n=응답=divider\nreply_len=답변 길이=select=짧게,보통,길게\n=길이를 늘리면 응답이 느려질 수 있어요=caption\ndetail=세부 묘사=group\nsense=감각 묘사\ninner=내면 독백\ndetail_end=세부 묘사=groupEnd\n=이름=divider\nnick=호칭=text\nmemo=메모=textarea\nadv=고급 설정=group\nlong_ctx=긴 문맥 쓰기\nadv_end=고급 설정=groupEnd',
      m1: 'style_warm=따뜻한 문체\nsense_words=감각어 수=select=적게,보통,많이\nfmt=서식 강조=text',
      m2: 'scene_cards=장면 카드 보이기\ncard_style=카드 스타일=select=얇게,보통,굵게\ncards_extra=카드 추가 설정=group\ncard_anim=카드 움직임\ncards_extra_end=카드 추가 설정=groupEnd',
      m4: 'hardcore=어려운 전투\n# 아래 묶음은 끝 줄을 빼먹었어요\nopen_rules=전투 규칙=group\nrule_a=반격 허용\nrule_b=도망 허용',
      c1: 'combat=전투 모드\nlantern=등불 켜기\nmood=분위기=select=차분,신비,장난\n# 위 세 개는 기본 토글이에요\nhint==caption\nAlly mode=Ally mode=\nally_mode=Ally mode\nbroken=\ntrust=신뢰도=select=낮음,보통,높음,아주 높음=무시되는 조각',
      roundtrip: 'a=첫째  \n  b=둘째 (앞 공백)\nc = 셋째 =select= x ,y\nd=넷째=weird\n\n# 메모\ne=다섯째=text'
    },
    en: {
      p1: 'longform=Long replies\nstyle_warm=Warm tone (preset)\n=Replies=divider\nreply_len=Reply length=select=short,medium,long\n=Longer replies can be slower=caption\ndetail=Detail=group\nsense=Sensory detail\ninner=Inner monologue\ndetail_end=Detail=groupEnd\n=Names=divider\nnick=Nickname=text\nmemo=Memo=textarea\nadv=Advanced=group\nlong_ctx=Use long context\nadv_end=Advanced=groupEnd',
      m1: 'style_warm=Warm tone\nsense_words=Sensory words=select=few,some,many\nfmt=Emphasis style=text',
      m2: 'scene_cards=Show scene cards\ncard_style=Card style=select=thin,normal,thick\ncards_extra=More card options=group\ncard_anim=Card motion\ncards_extra_end=More card options=groupEnd',
      m4: 'hardcore=Hard combat\n# the group below has no end line\nopen_rules=Combat rules=group\nrule_a=Allow counterattack\nrule_b=Allow fleeing',
      c1: 'combat=Combat mode\nlantern=Light the lantern\nmood=Mood=select=calm,mystic,playful\n# the three above are the basics\nhint==caption\nAlly mode=Ally mode=\nally_mode=Ally mode\nbroken=\ntrust=Trust=select=low,normal,high,very high=ignored tail',
      roundtrip: 'a=First  \n  b=Second (leading space)\nc = Third =select= x ,y\nd=Fourth=weird\n\n# note\ne=Fifth=text'
    }
  };
  D.build = function (lang) {
    var DB = origBuild(lang), L = lang === 'en' ? 'en' : 'ko', f = FX[L];
    var set = function (id, text) { Object.keys(DB.owners).forEach(function (oid) { DB.owners[oid].items.forEach(function (it) { if (it.id === id) it.f.defs = text; }); }); };
    set('p1.tg', f.p1); set('m1.tg', f.m1); set('m2.tg', f.m2); set('m4.tg', f.m4); set('c1.tg', f.c1);
    return DB;
  };
  window.StudioData2 = { roundtrip: FX.ko.roundtrip, FX: FX };
})();
