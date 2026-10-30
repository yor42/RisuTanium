/* Studio slice 4: copy (ko/en, SLICE4_SPEC section 13 plus the field labels the spec leaves to the build), the group owner type, and synthetic fixtures for the character and group forms.
   All data is invented; nothing is read from the app. Load after data3.js, before lte-early.js. Wraps StudioData.build (moves slice 3's extra long texts from the basics to the advanced item, adds
   the Advanced / Display fixtures, two more characters, three groups and the chat's note and memory). Never redefines a shared theme token (this file has no CSS). */
(function () {
  'use strict';
  var D = window.StudioData; window.StudioSS = 'st4:';
  var K = {}, E = {};
  function T(k, ko, en) { K[k] = ko; E[k] = en; }

  /* ---- spec section 13, verbatim ---- */
  T('fKindBasic', '기본 정보', 'Basics'); T('fKindDisplay', '표시와 에셋', 'Display and assets'); T('fKindAdvanced', '고급', 'Advanced');
  T('fAddField', '필드 추가 ({n})', 'Add a field ({n})'); T('fGroupEmpty', '비어 있어요 · 필드 추가 ({n})', 'Empty · Add a field ({n})');
  T('fGroupPrompt', '프롬프트', 'Prompt'); T('fGroupConv', '대화', 'Conversation'); T('fGroupInfo', '작품 정보', 'About the work'); T('fGroupVars', '변수와 번역', 'Variables and translation'); T('fGroupGen', '생성 조정', 'Generation'); T('fGroupMemory', '기억', 'Memory'); T('fGroupModule', '모듈', 'Module');
  T('fNotRecommended', '권장하지 않음', 'Not recommended'); T('fToggleLink', '토글 정의 · {n}개', 'Toggle definitions · {n}'); T('fChatScope', '이 채팅', 'This chat');
  T('fNoteNoChat', '작가 노트는 채팅마다 따로예요. 채팅을 열면 여기서 고칠 수 있어요', 'The author note belongs to each chat. Open a chat to edit it here');
  T('fNameEmpty', '이름은 비울 수 없어요', "The name can't be empty"); T('fPrivate', '이 캐릭터는 편집할 수 없어요', "This character can't be edited");
  T('fFieldGone', '그 칸은 없어요 · {kind} 맨 위로 열었어요', "That field doesn't exist · opened {kind} at the top");
  T('fSegPhoto', '사진', 'Portrait'); T('fSegScreen', '화면', 'Screen'); T('fSegAssets', '에셋', 'Assets');
  T('fMainPortrait', '대표 사진', 'Main portrait'); T('fMakeMain', '대표로 쓰기', 'Make main');
  T('fAddPhoto', '사진 추가', 'Add a photo'); T('fAddPhotoNote', '새 사진이 대표가 되고, 이전 대표는 다른 사진으로 남아요', 'The new photo becomes the main one; the previous main stays as another photo');
  T('fTallPhoto', '세로 사진', 'Tall portrait'); T('fHidePhoto', '채팅에서 사진 숨기기', 'Hide the picture in chat');
  T('fPromoted', '대표 사진을 지웠어요 · 다음 사진이 대표가 됐어요', 'Removed the main portrait · the next photo is now main');
  T('fScreenMode', '화면 방식', 'Screen mode'); T('fScreenNone', '없음', 'None'); T('fScreenEmotion', '감정 이미지', 'Emotion images'); T('fScreenImgGen', '이미지 생성', 'Image generation');
  T('fScreenFilled', '이 방식에 맞는 기본 문구로 채웠어요 · 직접 쓴 문구는 그대로예요', "Filled in this mode's default wording · your own wording is kept"); T('fDefaultTag', '기본값', 'Default'); T('fDefaultReset', '기본값으로 되돌리기', 'Reset to default');
  T('fAuxModel', '채팅 분석에 보조 모델을 써요', 'Chat analysis uses an auxiliary model'); T('fInlay', '채팅 화면에 넣기', 'Show inside the chat');
  T('fEmotionInstr', '감정 지시사항', 'Emotion instructions'); T('fImgPrompt', '프롬프트', 'Prompt'); T('fImgNeg', '부정 프롬프트', 'Negative prompt'); T('fImgInstr', '지시사항', 'Instructions');
  T('fEmotionName', '감정 이름', 'Emotion name'); T('fEmotionDup', '같은 이름이 있어요', 'Another image has this name'); T('fNoImages', '아직 이미지가 없어요', 'No images yet');
  T('fAssetUses', '글에서 쓰는 곳 {n}', 'Used in {n} places'); T('fAssetRenamed', '글에서 {n}곳이 예전 이름을 써요', '{n} places in the text still use the old name');
  T('fAssetHelp', '글에서 {{image::이름}}처럼 이름으로 불러요', 'Call it by name in text, like {{image::name}}');
  T('fPreviewOn', '미리보기에 넣기', 'Include in preview'); T('fPreviewOff', '미리보기에서 빼기', 'Leave out of preview'); T('fPlay', '재생', 'Play');
  T('fPickTitle', '샘플 이미지 고르기', 'Pick sample images'); T('fPickAdd', '추가', 'Add'); T('fPickClose', '닫기', 'Close');
  T('fPickResult', '{n}개 추가, {m}개 못 가져왔어요', "Added {n}, {m} couldn't be imported"); T('fPickBadType', '지원하지 않는 형식이에요: {ext}', 'Unsupported type: {ext}'); T('fStoreFail', '저장하지 못했어요', "Couldn't store it"); T('fRetry', '다시 시도', 'Try again'); T('fDropRow', '빼기', 'Remove');
  T('fImporting', '가져오는 중', 'Importing'); T('fLoadFail', '불러오지 못했어요', "Couldn't load it");
  T('fPngNote', '사진에 들어 있던 설명 글 {n}개를 가져왔어요', 'Imported {n} text notes that were inside the picture');
  T('fBiasValue', '값 (-100~100)', 'Value (-100 to 100)'); T('fBiasDup', '같은 토큰이 있어요', 'This token is already listed'); T('fBiasClamp', '범위 안으로 맞췄어요', 'Adjusted to the range');
  T('fModuleApply', '모듈 적용', 'Apply a module'); T('fModuleApplyNote', '모듈의 내용을 이 캐릭터로 복사해요 · 모듈과 이어지지는 않아요', "Copies the module's content into this character · it is not linked"); T('fModuleConvert', '모듈로 변환', 'Convert to module'); T('fModuleMade', '모듈을 만들었어요', 'Made a module');
  T('fRiskyTitle', '위험한 설정', 'Risky settings'); T('fRiskyWarn', '이 설정은 캐릭터가 할 수 있는 일을 바꿔요. 꼭 필요할 때만 켜세요.', 'These settings change what the character can do. Turn them on only when you need to.');
  T('fFlagLow', '낮은 수준 접근', 'Low-level access'); T('fFlagUtility', '유틸리티 봇', 'Utility bot'); T('fFlagEscape', '출력 이스케이프', 'Escape output');
  T('fFlagLowExplain', '높은 컴퓨팅 파워가 필요한 기능과, 트리거를 통한 AI 모델 실행을 허용해요. 꼭 필요할 때만 켜세요', 'Allows features that need high computing power and running the AI model through triggers. Turn on only if you need it');
  T('fFlagUtilityExplain', '메인 프롬프트, jailbreak 등 다른 프롬프트를 무시해요. 역할극이 아닌 유틸리티용이에요', 'Ignores the main prompt, jailbreak and other prompts. For utility bots, not role play');
  T('fFlagEscapeExplain', '답장을 표시하는 방식이 바뀌어요. 정확한 효과는 아직 확인 중이에요', 'Changes how replies are shown. The exact effect is still being confirmed');
  T('fRiskyAsk', '{name}을(를) 켤까요?', 'Turn on {name}?'); T('fRiskyAskLow', '이 캐릭터가 AI 모델과 저장소에 직접 접근할 수 있게 돼요', 'This character will be able to reach the AI model and your storage directly');
  T('fRiskyCancel', '취소', 'Cancel'); T('fRiskyOn', '켜기', 'Turn on'); T('fRiskyAnnounce', '{name} 켜짐', '{name} on');
  T('fMembers', '멤버', 'Members'); T('fMemberTalk', '말 수 {n}/6', 'Talkativeness {n}/6'); T('fMemberOn', '참여', 'Taking part'); T('fMemberOff', '쉬는 중', 'Sitting out');
  T('fMemberOpen', '캐릭터 열기', 'Open character'); T('fMemberRemove', '그룹에서 빼기', 'Remove from group'); T('fMemberMissing', '삭제됨', 'Deleted');
  T('fMemberAlready', '이미 그룹에 있어요', 'Already in the group'); T('fMemberAddFirst', '첫 메시지도 넣기', 'Also add the first message');
  T('fLastMember', '그룹에는 멤버가 한 명 이상 있어야 해요', 'A group needs at least one member'); T('fNoMembers', '아직 멤버가 없어요', 'No members yet');
  T('fOrderLabel', '말하는 순서', 'Speaking order'); T('fOrderRandom', '말 수에 따라', 'By talkativeness'); T('fOrderList', '순서대로', 'In order'); T('fOrderHelp', '메시지에서 이름을 부르면 그 멤버가 먼저 말해요', 'Name a member in a message and they speak first');
  T('fGroupPic', '그룹 사진', 'Group picture'); T('fGroupPicMake', '멤버 사진으로 만들기', 'Make from member pictures'); T('fGroupPicPick', '사진 고르기', 'Choose a picture'); T('fGroupView', '화면 방식', 'Screen mode');
  T('fViewSingle', '한 캐릭터', 'One character'); T('fViewMulti', '여러 캐릭터', 'Several characters'); T('fViewEmp', '두 캐릭터 강조', 'Two characters, highlighted');

  /* ---- field labels, one-line descriptions (shown in the add-a-field list) and help text. The spec says the help text comes from today's help keys, which were not re-read here: these are placeholders in the same spirit ---- */
  T('fl_name', '이름', 'Name'); T('fl_desc', '설명', 'Description'); T('fl_firstMessage', '첫 메시지', 'First message'); T('fl_alternateGreetings', '다른 첫 메시지', 'Alternate first messages'); T('fl_note', '작가 노트', 'Author note');
  T('fl_systemPrompt', '시스템 프롬프트', 'System prompt'); T('fl_replaceGlobalNote', '전역 노트 대체', 'Replace the global note'); T('fl_additionalText', '추가 설명', 'Additional description'); T('fl_personality', '성격', 'Personality'); T('fl_scenario', '시나리오', 'Scenario'); T('fl_depth_prompt', '깊이 프롬프트', 'Depth prompt');
  T('fl_exampleMessage', '예시 대화', 'Example messages'); T('fl_creatorNotes', '제작자 코멘트', "Creator's comment"); T('fl_creator', '제작자', 'Creator'); T('fl_version', '버전', 'Version'); T('fl_nickname', '별명', 'Nickname');
  T('fl_defaultVariables', '기본 변수', 'Default variables'); T('fl_translatorNote', '번역가 메모', "Translator's note"); T('fl_customModuleToggle', '토글 정의', 'Toggle definitions'); T('fl_bias', '토큰 편향', 'Token bias'); T('fl_supaMemoryData', '슈퍼메모리', 'Super memory');
  T('fd_systemPrompt', '이 캐릭터에게만 쓰는 시스템 프롬프트예요', 'A system prompt used only for this character'); T('fd_replaceGlobalNote', '비워 두면 전역 노트를 바꾸지 않아요', 'Leave empty to keep the global note'); T('fd_additionalText', '필요할 때만 설명에 덧붙는 글이에요', 'Text added to the description only when needed');
  T('fd_personality', '성격 설명이에요. 설명 안에 쓰는 편이 좋아요', 'Personality text; usually better written inside the description'); T('fd_scenario', '시나리오 설명이에요. 설명 안에 쓰는 편이 좋아요', 'Scenario text; usually better written inside the description');
  T('fd_depth_prompt', '대화 속 정한 깊이에 끼워 넣는 글이에요', 'Text inserted at a set depth in the conversation'); T('fd_exampleMessage', '말투를 보여 주는 대화 예시예요', 'Sample dialogue that shows how the character speaks');
  T('fd_creatorNotes', '작품을 소개하는 제작자의 글이에요. 언어별로 쓸 수 있어요', "The creator's introduction; one per language"); T('fd_creator', '만든 사람 이름이에요', "The creator's name"); T('fd_version', '캐릭터 버전이에요', "The character's version"); T('fd_nickname', '{{char}}와 <char> 대신 쓰는 이름이에요', 'The name used in place of {{char}} and <char>');
  T('fd_defaultVariables', '대화를 시작할 때 쓰는 변수 값이에요. 한 줄에 하나, 키=값', 'Variable values at the start of a chat; one per line, key=value'); T('fd_translatorNote', '번역할 때 지킬 점을 적어요', 'Notes to follow when translating'); T('fd_bias', '특정 토큰이 나올 확률을 -100에서 100으로 조절해요', 'Raise or lower the odds of a token, from -100 to 100');
  T('fh_depth_prompt', '숫자는 마지막 메시지에서 몇 번째 앞에 글을 끼울지 정해요. 0이면 맨 끝이에요.', 'The number says how many messages back the text is inserted. 0 is the very end.');
  T('fh_nickname', '캐릭터 이름 대신 {{char}}와 <char>에 들어가는 이름이에요. 비워 두면 이름을 써요.', 'This name goes into {{char}} and <char> instead of the character name. Empty uses the name.');
  T('fh_bias', '토큰을 적고 -100(거의 안 나옴)에서 100(자주 나옴) 사이 값을 정해요. 모든 모델이 따르지는 않아요.', 'Enter a token and a value from -100 (rarely) to 100 (often). Not every model honours it.');
  T('fh_defaultVariables', '한 줄에 하나씩 키=값으로 적어요. 매크로는 쓸 수 없어요.', 'One key=value per line. Macros are not expanded here.');
  T('fh_systemPrompt', '비워 두면 프리셋의 시스템 프롬프트를 써요.', "Empty uses the preset's system prompt.");
  T('fh_replaceGlobalNote', '비워 두면 바꾸지 않아요. 글이 있으면 전역 노트 대신 이 글이 들어가요.', 'Empty does not replace anything. With text, it is used instead of the global note.');
  T('fh_creatorNotes', '언어마다 따로 써요. 앱 화면에서 캐릭터를 소개할 때 보여요.', 'One per language. Shown when the character is presented in the app.');
  T('fh_exampleMessage', '<START> 줄로 나뉜 블록이 카드 하나예요.', 'Each block that starts with a <START> line is one card.');
  T('fh_assetName', '글에서 {{image::이름}}, {{img::이름}}, {{bg::이름}}, {{audio::이름}}, {{video::이름}}처럼 불러요. "쓰는 곳"은 이 캐릭터의 설명, 첫 메시지, 고급 글, 표시 글, 로어북, 정규식, 스크립트에서 찾아요.', 'In text use {{image::name}}, {{img::name}}, {{bg::name}}, {{audio::name}} or {{video::name}}. "Used in" looks in this character\'s description, first messages, advanced texts, display texts, lorebook, regex and scripts.');

  /* ---- other form strings (build additions, same terms as the spec) ---- */
  T('s4Help', '설명 보기', 'Show help'); T('s4SecOpen', '펼치기', 'Expand'); T('s4SecClose', '접기', 'Collapse'); T('s4FieldTagChat', '이 채팅', 'This chat'); T('s4EmptyField', '비어 있음', 'Empty');
  T('s4AddFieldList', '빈 필드 목록', 'Empty fields'); T('s4FoldAnn', '고급 · {g}: 빈 칸 {n}개 접힘', 'Advanced · {g}: {n} empty fields folded'); T('s4FieldAdded', '{f} 칸을 보여 줬어요', 'Showing the {f} field');
  T('s4NoteDefault', '[작가 노트] 지금 이 채팅에서 지킬 점이나 분위기를 적어요.', '[Author note] Write what to keep in mind or the mood for this chat.');
  T('s4ToggleBack', '토글 값은 채팅에서 바꿔요', 'Toggle values are changed in the chat'); T('s4BackToChat', '채팅으로 돌아가기', 'Back to the chat');
  T('s4AltsCount', '다른 첫 메시지 {n}개', '{n} alternate first messages'); T('s4PrivateSummary', '읽기 전용이에요', 'Read only');
  T('s4Filled', '채워진 칸 {n}', '{n} filled'); T('s4DepthLabel', '깊이', 'Depth'); T('s4LangAdd', '언어 추가', 'Add a language'); T('s4LangTabs', '언어', 'Language');
  T('s4BiasToken', '토큰', 'Token'); T('s4BiasAdd', '편향 추가', 'Add a bias'); T('s4BiasDel', '편향 지우기', 'Remove the bias'); T('s4BiasEmpty', '편향이 없어요', 'No biases yet');
  T('s4ToggleOpen', '토글 정의 열기', 'Open toggle definitions'); T('s4HypaV2', '하이파 메모리 V2 열기', 'Open Hypa memory V2'); T('s4HypaV3', '하이파 메모리 V3 열기', 'Open Hypa memory V3'); T('s4HypaSim', '기존 하이파 메모리 창이 열려요 (목업)', 'The existing Hypa memory window would open (mockup)');
  T('s4ModulePick', '어느 모듈을 복사할까요?', 'Which module should be copied?'); T('s4ModuleApplied', '{m}의 내용을 복사했어요', 'Copied the content of {m}'); T('s4ModuleUndone', '모듈 복사를 취소했어요', 'Cancelled the copy of the module'); T('s4ModuleOpen', '모듈 열기', 'Open the module'); T('s4ModuleNameFor', '{c} 모듈', '{c} module');
  T('s4AskLowConsequence', '켜면 이 캐릭터의 코드가 AI 모델과 저장소에 직접 접근할 수 있어요.', 'With this on, the character code can reach the AI model and storage directly.');
  T('s4StepRiskyOn', '위험한 설정 켬: {name}', 'Turned on: {name}'); T('s4StepRiskyOff', '위험한 설정 끔: {name}', 'Turned off: {name}');
  T('s4StepField', '{f} 고침', 'Edited {f}'); T('s4StepFieldAdd', '{f} 추가', 'Added {f}'); T('s4StepName', '이름 고침', 'Renamed'); T('s4StepPortraitAdd', '사진 추가', 'Photo added'); T('s4StepPortraitMain', '대표 사진 바꿈', 'Main portrait changed'); T('s4StepPortraitDel', '사진 삭제', 'Photo deleted'); T('s4StepPortraitSwitch', '{f} 바꿈', 'Changed {f}');
  T('s4StepScreen', '화면 방식 바꿈', 'Screen mode changed'); T('s4StepDefault', '기본값으로 되돌림', 'Reset to default'); T('s4StepEmotionAdd', '감정 이미지 추가', 'Emotion images added'); T('s4StepEmotionName', '감정 이름 고침', 'Emotion renamed'); T('s4StepEmotionMove', '감정 이미지 옮김', 'Emotion image moved'); T('s4StepEmotionDel', '감정 이미지 삭제', 'Emotion image deleted');
  T('s4StepAssetAdd', '에셋 추가', 'Assets added'); T('s4StepAssetName', '에셋 이름 고침', 'Asset renamed'); T('s4StepAssetMove', '에셋 옮김', 'Asset moved'); T('s4StepAssetDel', '에셋 삭제', 'Asset deleted'); T('s4StepAssetPreview', '에셋 미리보기 바꿈', 'Asset preview changed'); T('s4StepBias', '토큰 편향 고침', 'Token bias edited'); T('s4StepBiasDel', '토큰 편향 삭제', 'Token bias deleted');
  T('s4StepMember', '멤버 바꿈', 'Members changed'); T('s4StepMemberAdd', '멤버 추가', 'Member added'); T('s4StepMemberDel', '멤버 빼기', 'Member removed'); T('s4StepMemberMove', '멤버 순서 바꿈', 'Member moved'); T('s4StepTalk', '말 수 바꿈', 'Talkativeness changed'); T('s4StepMute', '참여 바꿈', 'Participation changed'); T('s4StepOrder', '말하는 순서 바꿈', 'Speaking order changed'); T('s4StepGroupPic', '그룹 사진 바꿈', 'Group picture changed'); T('s4StepNote', '작가 노트 고침', 'Author note edited'); T('s4StepLang', '언어 추가', 'Language added'); T('s4StepRestoreRow', '삭제 되돌림', 'Delete undone');
  T('s4Moved', '{n}번째가 됐어요', 'is now number {n}'); T('s4MovedAnn', '{name}이(가) {n}번째가 됐어요', '{name} is now number {n}'); T('s4Deleted', '삭제했어요: {name}', 'Deleted: {name}'); T('s4Removed', '빼냈어요: {name}', 'Removed: {name}');
  T('s4Handle', '끌어서 옮기기', 'Drag to reorder'); T('s4Menu', '메뉴', 'Menu'); T('s4MenuOf', '{name} 메뉴', 'Menu for {name}'); T('s4Replace', '바꾸기', 'Replace'); T('s4Name', '이름', 'Name'); T('s4Preview', '미리보기', 'Preview'); T('s4Stop', '멈추기', 'Stop');
  T('s4AltPhotos', '다른 사진', 'Other photos'); T('s4NoMain', '대표 사진이 없어요', 'No main portrait'); T('s4Sample', '샘플 {n}', 'Sample {n}'); T('s4PickPortrait', '대표로 쓸 사진을 고르세요', 'Pick the photo to use as main');
  T('s4ScreenFields', '이미지 생성 문구', 'Image generation wording'); T('s4InlayHint', '켜면 화면 이미지가 채팅 글 사이에 들어가요', 'When on, the screen image appears between chat messages');
  T('s4EmotionHint', '이미지가 하나도 없으면 아무것도 보이지 않아요', 'Nothing shows until at least one image is added'); T('s4EmotionList', '감정 이미지 목록', 'Emotion images'); T('s4AssetList', '에셋 목록', 'Assets');
  T('s4Ext', '{ext} · {size}', '{ext} · {size}'); T('s4Kb', '{n} KB', '{n} KB'); T('s4FakeKb', '가상 {n} KB', 'Mock {n} KB');
  T('s4Counting', '세는 중', 'Counting'); T('s4UsesNone', '글에서 쓰지 않아요', 'Not used in text'); T('s4UsesTitle', '{name}을(를) 쓰는 곳', 'Where {name} is used'); T('s4UsesLine', '{n}번째 줄', 'line {n}'); T('s4Show', '보기', 'Show'); T('s4Hide', '접기', 'Hide');
  T('s4Rejected', '못 가져온 파일', "Files that couldn't be imported"); T('s4Dismiss', '닫기', 'Dismiss'); T('s4Importing', '가져오는 중 · {name}', 'Importing · {name}'); T('s4PickHint', '실제 파일은 건드리지 않아요. 목업의 샘플이에요.', 'No real file is touched. These are mockup samples.');
  T('s4PickSelected', '추가 ({n})', 'Add ({n})'); T('s4PngSample', 'PNG', 'PNG'); T('s4PlayAudio', '재생', 'Play'); T('s4PlayVideo', '재생', 'Play');
  T('s4PeerField', '{f}이(가) 다른 곳에서 바뀌었어요', '{f} was changed elsewhere'); T('s4On', '켜짐', 'On'); T('s4Off', '꺼짐', 'Off'); T('s4CountN', '{n}개', '{n}');
  T('s4PrivateGone', '이 캐릭터의 내용은 숨겨져 있어요 · "내용 보기"를 누르면 열려요', 'This character\'s content is hidden · press "Show content" to open it');
  T('s4FieldCond', '{f} 칸은 지금 보이지 않아요 · {why}', '{f} is not shown right now · {why}'); T('s4CondChat', '채팅을 열고 기억 글이 있을 때 보여요', 'shown when a chat is open and has memory text'); T('s4CondSetting', '앱 설정에서 켜면 보여요', 'shown when the app setting is on');
  T('s4PrivateHidden', '내용은 기본으로 숨겨져 있어요. 내보내기는 계속 막혀 있어요.', 'The content is hidden by default. Export stays blocked.'); T('s4PrivateShown', '내용을 보는 중이에요 · 읽기 전용 · 스튜디오를 닫으면 다시 숨겨져요', 'Showing the content · read only · it hides again when Studio closes');
  T('s4PrivateShow', '내용 보기', 'Show content'); T('s4PrivateHide', '다시 숨기기', 'Hide again'); T('s4PrivateAskTitle', '내용을 볼까요?', 'Show the content?');
  T('s4PrivateAskBody1', '이 캐릭터는 내용을 숨기도록 설정돼 있어요. 보기만 하고 고칠 수는 없어요.', 'This character is set to hide its content. You can read it but not edit it.'); T('s4PrivateAskBody2', '스튜디오를 닫으면 다시 숨겨져요. 내보내기는 계속 막혀 있어요.', 'It hides again when Studio closes. Export stays blocked.');
  T('s4PrivateRevealed', '내용을 보여 줘요 · 읽기 전용', 'Showing the content · read only'); T('s4PrivateHiddenAgain', '내용을 다시 숨겼어요', 'Hid the content again');
  T('s4MockupNote', '목업 문구 · 확인 뒤 교체', 'Mockup text · replace once confirmed'); T('s4ToggleAdd', '토글 정의 추가', 'Add a toggle definition'); T('s4NoSpeakers', '말할 수 있는 멤버가 없어요', 'No member can speak');
  T('s4FillHidden', '감정 지시사항은 채팅 화면에 넣기를 켜면 보여요', 'The emotion instructions show once "Show inside the chat" is on'); T('s4ImportOpen', '보기', 'Open'); T('s4ImportOpenApp', 'Studio에서 보기', 'View in Studio'); T('s4BiasZeroed', '비워서 0으로 했어요', 'Left empty, so it is 0'); T('s4ToastGone', '이미 되돌렸어요', 'Already undone');
  T('s4PickOk', '{n}개 추가했어요', 'Added {n}'); T('s4FillAnn', '기본 문구 {n}개를 채웠어요', 'Filled in {n} default wordings'); T('s4MoreUses', '쓰는 곳 보기', 'Show where it is used'); T('s4AssetPrompt', '에셋 프롬프트 넣기', 'Include the asset prompt'); T('s4AssetStyle', '에셋 스타일', 'Asset style'); T('s4StyleStatic', '고정', 'Static'); T('s4StyleDynamic', '동적', 'Dynamic'); T('s4PreviewExcluded', '미리보기에서 빠짐', 'Left out of preview');
  T('s4MemberRow', '{name}', '{name}'); T('s4TalkName', '{name}: 말 수', '{name}: talkativeness'); T('s4TalkValue', '6단계 중 {n}', '{n} of 6'); T('s4TalkSeg', '{n}/6', '{n}/6'); T('s4MuteName', '{name}: {state}', '{name}: {state}'); T('s4Speakers', '말하는 멤버 {n}명', '{n} members can speak'); T('s4SpeakersOf', '{n}/{m}명', '{n} of {m}');
  T('s4MemberPicker', '멤버 추가', 'Add a member'); T('s4MemberSearch', '캐릭터 찾기', 'Find a character'); T('s4MemberAdded', '{name}을(를) 넣었어요', 'Added {name}'); T('s4MemberFirstPushed', '{name}의 첫 메시지도 채팅에 넣었어요', "Also added {name}'s first message to the chat");
  T('s4OrderHelpNote', '순서대로를 고르면 위에서부터 차례로 말해요', 'In order means members speak one after another from the top'); T('s4GroupPicNote', '멤버 사진으로 만들어져요 · 나중에 바꿀 수 있어요', 'Made from the member pictures · you can change it later');
  T('s4GroupPicMade', '멤버 사진으로 그룹 사진을 만들었어요', 'Made the group picture from member pictures'); T('s4NoGroupPic', '그룹 사진이 없어요', 'No group picture'); T('s4GroupAdvNote', '그룹에는 낮은 수준 접근만 있어요', 'Only low-level access applies to a group');
  T('s4PrivateBadge', '읽기 전용', 'Read only'); T('s4Unsaved', '저장하지 않은 글', 'Unsaved text');
  T('s4Recount', '다시 세기', 'Recount'); T('s4SearchEmpty', '비어 있음', 'empty'); T('s4SearchEmptyTag', '비어 있음', 'empty');

  /* ---- merge into the shared dictionary; never overwrite an existing key (the list of clashes is exposed for the check) ---- */
  var clash = [];
  Object.keys(K).forEach(function (k) { if (Object.prototype.hasOwnProperty.call(D.I18N.ko, k)) clash.push(k); else D.I18N.ko[k] = K[k]; });
  Object.keys(E).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(D.I18N.en, k)) D.I18N.en[k] = E[k]; });

  /* ---- the group owner type ---- */
  D.SUPPORT.group = ['basic', 'display', 'advanced']; D.OWNER_ICON.group = 'users';

  /* ---- simulated app settings that today decide what the forms show (all synthetic) ---- */
  var SETTINGS = { previewSetting: true, assetCommandSetting: false, newImageBeta: false, hypav2: false, hypav3: false };

  /* ---- fixtures ---- */
  var DEFAULTS = {
    emotionInstr: { ko: '대화의 분위기에 맞는 감정을 하나 골라 {{emotion}}으로 표시해 주세요.', en: 'Pick one emotion that fits the mood of the conversation and show it with {{emotion}}.' },
    imgPrompt: { ko: '{{char}}의 모습, 부드러운 빛, 고요한 숲', en: '{{char}}, soft light, a quiet forest' },
    imgNeg: { ko: '흐릿함, 일그러진 손, 글자', en: 'blurry, distorted hands, text' },
    imgInstr: { ko: '장면이 바뀔 때마다 그림 한 장을 그려 주세요.', en: 'Draw one picture whenever the scene changes.' }
  };
  function fx4(L) {
    var c = function (ko, en) { return L === 'en' ? en : ko; };
    return {
      adv: {
        replaceGlobalNote: c('이 캐릭터와 대화할 때는 전역 노트 대신 이 지침을 따른다. 항상 3인칭 시점으로 쓴다.', 'When chatting with this character follow these instructions instead of the global note. Always write in third person.'),
        additionalText: c('세라핀은 등불을 들고 다닌다. {{#when::{{getglobalvar::toggle_lantern}}}}지금은 등불이 켜져 있다.{{/when}}', 'Seraphina carries a lantern. {{#when::{{getglobalvar::toggle_lantern}}}}It is lit now.{{/when}}'),
        personality: c('차분하고 믿음직하며 말수가 적다.', 'Calm, dependable and sparing with words.'),
        scenario: c('숲길 어귀에서 길 잃은 나그네를 만난다.', 'Meets a lost traveller at the forest gate.'),
        depth: 4, depthPrompt: c('[세라핀은 대화 중에도 늘 등불의 불빛을 살핀다.]', '[Seraphina keeps an eye on the lantern light even while talking.]'),
        creatorNotes: { ko: '등불 숲 시리즈의 첫 캐릭터예요.', en: 'The first character of the Lantern Forest series.' },
        creator: c('숲의 서기', 'The forest scribe'), version: '1.2', nickname: c('세라', 'Sera'),
        bias: [{ id: 'b1', token: c('등불', 'lantern'), value: 12 }, { id: 'b2', token: c('어둠', 'darkness'), value: -8 }]
      },
      displayC1: {
        main: { id: 'p0', name: c('세라핀 기본', 'Seraphina main'), ext: 'png', size: 14, tone: 2 },
        alts: [{ id: 'p1', name: c('웃는 얼굴', 'Smiling'), ext: 'webp', size: 9, tone: 3 }, { id: 'p2', name: c('밤의 등불', 'Night lantern'), ext: 'png', size: 18, tone: 5 }],
        emotions: [{ id: 'e1', name: c('기본', 'neutral'), ext: 'png', size: 11, tone: 1, state: 'ok' }, { id: 'e2', name: c('기쁨', 'joy'), ext: 'webp', size: 8, tone: 3, state: 'ok' }, { id: 'e3', name: c('놀람', 'surprise'), ext: 'png', size: 12, tone: 4, state: 'ok' }, { id: 'e4', name: c('슬픔', 'sorrow'), ext: 'png', size: 10, tone: 6, state: 'ok' }],
        assets: [{ id: 'a1', name: c('등불', 'lantern'), ext: 'png', size: 21, tone: 2 }, { id: 'a2', name: c('숲', 'forest'), ext: 'webp', size: 33, tone: 4 }, { id: 'a3', name: c('숲길배경', 'path_bg'), ext: 'jpg', size: 54, tone: 5 }, { id: 'a4', name: c('숲소리', 'forest_sound'), ext: 'mp3', size: 240 }, { id: 'a5', name: c('오프닝', 'opening'), ext: 'mp4', size: 910 }, { id: 'a6', name: c('손글씨', 'handwriting'), ext: 'ttf', size: 88 }]
      },
      fill: DEFAULTS
    };
  }
  /* the sample files the simulated picker offers (synthetic: nothing is read) */
  function pickerFiles(L) {
    var c = function (ko, en) { return L === 'en' ? en : ko; };
    return [
      { id: 'f1', name: c('숲길', 'forest_path'), ext: 'png', size: 12, tone: 1 },
      { id: 'f2', name: c('등불켜짐', 'lantern_on'), ext: 'webp', size: 9, tone: 3 },
      { id: 'f3', name: c('웃음', 'laugh'), ext: 'gif', size: 48, tone: 5 },
      { id: 'f4', name: c('아주아주긴파일이름은가끔이렇게길어질수도있어서줄바꿈이필요해요정말로', 'a_really_long_file_name_that_has_to_wrap_onto_a_second_line_to_be_read_in_full'), ext: 'png', size: 15, tone: 2 },
      { id: 'f5', name: c('기쁨', 'joy'), ext: 'png', size: 10, tone: 4, dup: true },
      { id: 'f6', name: c('옛그림', 'old_drawing'), ext: 'bmp', size: 300, tone: 6 },
      { id: 'f7', name: c('깨진파일', 'broken_file'), ext: 'png', size: 7, tone: 2, fail: true },
      { id: 'f8', name: c('배경음악', 'bgm'), ext: 'mp3', size: 320 },
      { id: 'f9', name: c('소개영상', 'intro_clip'), ext: 'mp4', size: 1400 },
      { id: 'f10', name: c('손글씨2', 'handwriting2'), ext: 'ttf', size: 92 }
    ];
  }

  var origBuild = D.build;
  D.build = function (lang) {
    var DB = origBuild(lang), L = lang === 'en' ? 'en' : 'ko', c = function (ko, en) { return L === 'en' ? en : ko; }, X = fx4(L);
    function owner(id, type, name, extra) { var o = Object.assign({ id: id, type: type, name: name, items: [] }, extra || {}); DB.owners[id] = o; DB.order.push(id); return o; }
    function item(o, id, kind, name, f) { var it = { id: id, kind: kind, name: name, on: true, f: f || {} }; o.items.push(it); return it; }
    var T2 = function (ko, en) { return { ko: ko, en: en }; };
    var EMPTY_ADV = function () { return { systemPrompt: '', replaceGlobalNote: '', additionalText: '', personality: '', scenario: '', depth: 4, depthPrompt: '', examples: '', creatorNotes: { ko: '', en: '' }, creator: '', version: '', nickname: '', defvars: '', tnote: '', bias: [], lowLevel: false, utilityBot: false, escapeOutput: false }; };
    var EMPTY_DISP = function () { return { main: null, alts: [], largePortrait: false, hideChatIcon: false, viewScreen: 'none', inlay: false, emotionInstr: '', imgPrompt: '', imgNeg: '', imgInstr: '', isDefault: {}, emotions: [], assets: [] }; };
    // slice 3 put system prompt, default variables and the translator's note on the basics; here they belong to Advanced
    var c1 = DB.owners.c1, b = c1.items.find(function (i) { return i.id === 'c1.basic'; }), moved = { systemPrompt: b.f.system || '', defvars: b.f.defvars || '', tnote: b.f.tnote || '', examples: b.f.examples || '' };
    ['system', 'bghtml', 'defvars', 'tnote', 'examples'].forEach(function (k) { delete b.f[k]; });
    Object.keys(DB.owners).forEach(function (oid) { DB.owners[oid].items.forEach(function (it) { if (it.kind === 'basic') { if (!Array.isArray(it.f.alts)) it.f.alts = []; delete it.f.system; delete it.f.bghtml; delete it.f.defvars; delete it.f.tnote; delete it.f.examples; } }); });
    b.f.description += c(' {{img::등불}}', ' {{img::lantern}}');
    var lo1 = c1.items.find(function (i) { return i.id === 'c1.lore1'; }); if (lo1) lo1.f.content += c(' {{bg::숲길배경}}', ' {{bg::path_bg}}');
    if (b.f.alts[0]) b.f.alts[0] += c(' {{audio::숲소리}}', ' {{audio::forest_sound}}');
    var adv = c1.items.find(function (i) { return i.id === 'c1.adv'; }); adv.name = T2('고급', 'Advanced');
    adv.f = Object.assign(EMPTY_ADV(), X.adv, { systemPrompt: moved.systemPrompt + c(' 필요하면 {{img::등불}}을 보여 준다.', ' Show {{img::lantern}} when it helps.'), examples: moved.examples, defvars: moved.defvars, tnote: moved.tnote });
    var disp = c1.items.find(function (i) { return i.id === 'c1.display'; }); disp.name = T2('표시와 에셋', 'Display and assets');
    disp.f = Object.assign(EMPTY_DISP(), { main: X.displayC1.main, alts: X.displayC1.alts, viewScreen: 'emotion', inlay: true, emotionInstr: c('감정을 하나 골라 {{emotion}}으로 표시해 주세요. 세라핀은 잘 웃지 않아요.', 'Pick one emotion and show it with {{emotion}}. Seraphina rarely smiles.'), emotions: X.displayC1.emotions, assets: X.displayC1.assets });
    // two more characters: Haru is almost empty (folding), the sealed record has a private licence (read only)
    var c4 = owner('c4', 'char', T2('하루', 'Haru'), { other: true });
    item(c4, 'c4.basic', 'basic', T2('기본 정보', 'Basics'), { name: c('하루', 'Haru'), description: c('아직 설정이 거의 없는 새 캐릭터.', 'A new character with hardly any settings yet.'), first: '', alts: [] });
    item(c4, 'c4.display', 'display', T2('표시와 에셋', 'Display and assets'), EMPTY_DISP());
    item(c4, 'c4.adv', 'advanced', T2('고급', 'Advanced'), Object.assign(EMPTY_ADV(), { creator: c('하루 팀', 'Team Haru') }));
    var c5 = owner('c5', 'char', T2('봉인된 기록', 'Sealed record'), { other: true });
    item(c5, 'c5.basic', 'basic', T2('기본 정보', 'Basics'), { name: c('봉인된 기록', 'Sealed record'), description: c('열람이 제한된 기록. 내용은 비공개예요.', 'A record with restricted access. Its content is private.'), first: c('{{char}}는 말이 없다.', '{{char}} says nothing.'), alts: [c('봉인이 풀리지 않는다.', 'The seal does not break.')], license: 'private' });
    item(c5, 'c5.display', 'display', T2('표시와 에셋', 'Display and assets'), Object.assign(EMPTY_DISP(), { main: { id: 'p0', name: c('봉인', 'Seal'), ext: 'png', size: 13, tone: 6 } }));
    item(c5, 'c5.adv', 'advanced', T2('고급', 'Advanced'), Object.assign(EMPTY_ADV(), { systemPrompt: c('열람 권한이 없는 사용자에게 내용을 말하지 않는다.', 'Never reveal the content to users without access.'), creator: c('기록 보관소', 'Archive') }));
    // groups
    var g1 = owner('g1', 'group', T2('등불 일행', 'Lantern party'), { other: true });
    item(g1, 'g1.basic', 'basic', T2('기본 정보', 'Basics'), { name: c('등불 일행', 'Lantern party'), members: [{ id: 'c1', talk: 4, active: true }, { id: 'c2', talk: 2, active: false }, { id: 'cx', talk: 3, active: true }], orderByOrder: false });
    item(g1, 'g1.display', 'display', T2('표시와 에셋', 'Display and assets'), { pic: { name: c('그룹 사진', 'Group picture'), tone: 4, made: true }, viewScreen: 'multi' });
    item(g1, 'g1.adv', 'advanced', T2('고급', 'Advanced'), { lowLevel: false });
    var g2 = owner('g2', 'group', T2('혼자 남은 일행', 'Last one standing'), { other: true });
    item(g2, 'g2.basic', 'basic', T2('기본 정보', 'Basics'), { name: c('혼자 남은 일행', 'Last one standing'), members: [{ id: 'c1', talk: 3, active: true }], orderByOrder: false });
    item(g2, 'g2.display', 'display', T2('표시와 에셋', 'Display and assets'), { pic: null, viewScreen: 'single' });
    item(g2, 'g2.adv', 'advanced', T2('고급', 'Advanced'), { lowLevel: false });
    var g3 = owner('g3', 'group', T2('빈 그룹', 'Empty group'), { other: true });
    item(g3, 'g3.basic', 'basic', T2('기본 정보', 'Basics'), { name: c('빈 그룹', 'Empty group'), members: [], orderByOrder: false });
    item(g3, 'g3.display', 'display', T2('표시와 에셋', 'Display and assets'), { pic: null, viewScreen: 'none' });
    item(g3, 'g3.adv', 'advanced', T2('고급', 'Advanced'), { lowLevel: false });
    // the open chat's author note and memory text: chat-scoped values live on the chat owner (DD-172). The item is not a tree kind of a chat, so it never shows in the tree
    item(DB.owners.chat1, 'chat1.n', 'advanced', T2('작가 노트와 기억', 'Author note and memory'), { note: c('이 채팅에서는 안개가 짙다. 세라핀은 목소리를 낮춘다.', 'The fog is thick in this chat. Seraphina keeps her voice low.'), supa: c('[요약] 세라핀과 나그네는 숲길 어귀에서 만났다. 나그네는 짐이 많은 약사다.', '[Summary] Seraphina met the traveller at the forest gate. He is an apothecary with a heavy pack.') });
    DB.owners.chat1.items.find(function (i) { return i.id === 'chat1.n'; }).noTree = true;
    return DB;
  };
  window.StudioData4 = { clash: clash, SETTINGS: SETTINGS, fx4: fx4, pickerFiles: pickerFiles, DEFAULTS: DEFAULTS, K: K, E: E };
})();
