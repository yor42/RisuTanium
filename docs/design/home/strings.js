/* Home strings (DD-202): Korean first, English second. ?lang=ko|en (anything else falls back to ko). Synthetic copy; the app's locale files are not touched.
   A value is a string with {name} slots or a function of the slots. Names go through josa() where a particle follows (rule from chat slice 1 section 8: 이/가, 은/는, 을/를, 와/과, 으로/로).
   t(key, vars) logs a missing key once and returns the key, so a typo is visible (the check suite fails on any missing key).
   Product copy vs mock annotations: anything that only explains the mockup lives under a key starting with "mock." and is rendered in an element carrying data-mock. */
(function () {
  'use strict';
  var KO = {
    'title': '홈 · RisuTanium', 'title.mode': '{mode} 홈 · RisuTanium',
    'skip': '본문으로 건너뛰기', 'menu': '메뉴', 'menu.close': '메뉴 닫기',
    'mode.legend': '모드', 'mode.rp': '롤플레이', 'mode.hybrid': '하이브리드', 'mode.utility': '유틸리티', 'mode.home': '{mode} 홈', 'mode.menu': '{mode} 메뉴', 'mode.opening': '{target} 여는 중',
    'rail.home': '홈', 'rail.newChar': '새 캐릭터', 'rail.prompts': '프롬프트 설정', 'rail.settings': '설정', 'rail.lastChat': '마지막 대화', 'rail.recent': '최근 캐릭터', 'rail.bgBadge': '{state}',
    'tasks': '작업', 'tasks.none': ', 실행 중인 작업 없음', 'tasks.n': ', {n}개 실행 중',
    'persona.chip': '페르소나: {name}', 'persona.hint': '지정 없는 채팅에 써요', 'persona.go': '설정 › 페르소나에서 관리', 'persona.caption': '지정 없는 채팅에 써요. 설정 › 페르소나에서 바꿀 수 있어요.',
    'persona.default': '주노',

    'rp.eyebrow': '롤플레이', 'rp.welcomeBack': '다시 오셨네요, {name}님', 'rp.welcome': '환영해요, {name}님',
    'continue.h': '이야기 이어가기', 'story.noMemory': '기억 없음',
    'lib.h': '캐릭터', 'lib.count': '{shown}/{total}', 'lib.countTrash': '{shown}/{total}', 'lib.views': '라이브러리 보기',
    'lib.tab.chars': '캐릭터', 'lib.tab.trash': '최근 삭제', 'lib.search': '캐릭터 검색', 'lib.sort': '정렬', 'lib.sort.order': '내 순서', 'lib.sort.recent': '최근', 'lib.sort.name': '이름', 'lib.new': '새로 만들기', 'lib.manage': '라이브러리 관리',
    'lib.folders': '폴더', 'folder.fantasy': '판타지', 'folder.scifi': 'SF', 'folder.drafts': '초안',
    'char.chats': '채팅 {n}개', 'char.group': '그룹 · 채팅 {n}개', 'char.builtIn': '기본 제공', 'char.noMatch': '검색과 맞는 캐릭터가 없어요', 'char.noFolder': '이 폴더에는 캐릭터가 없어요.', 'char.clearSearch': '검색 지우기',
    'char.reorderHint': '순서를 바꾸려면 "내 순서", 모든 폴더, 검색어 없음이어야 해요.', 'char.up': '{name} 위로 이동', 'char.down': '{name} 아래로 이동', 'char.select': '{name} 선택',
    'sel.none': '선택한 항목이 없어요. 옮기거나 삭제할 캐릭터를 체크하세요.', 'sel.none2': '선택 없음', 'sel.n': '{n}개 선택됨', 'sel.hidden': '{n}개 선택됨 (현재 검색·폴더에 안 보이는 것 {h}개 포함)',
    'sel.group': '선택 작업', 'sel.all': '보이는 것 모두 선택', 'sel.move': '폴더로 옮기기', 'sel.trash': '최근 삭제로 보내기', 'sel.actions': '작업', 'sel.actionsN': '선택한 {n}개 작업', 'sel.actions0': '작업 (선택 없음)', 'sel.done': '완료',
    'move.title': '{n}개를 폴더로 옮겨요', 'move.noFolder': '폴더 없음', 'move.cancel': '취소', 'move.result': '{n}개를 {folder}(으)로 옮겼어요.', 'move.resultNone': '{n}개를 폴더에서 뺐어요.',
    'order.moved': '{name}을(를) {pos}/{total}번째로 옮겼어요.',
    'trash.title': '캐릭터 {n}개를 최근 삭제로 보낼까요?', 'trash.text': '{names}{more}은(는) 라이브러리, 이어가기 목록, 동반자 후보에서 사라져요. 채팅도 함께 숨겨지고, 복원하면 돌아와요. 최근 삭제에 30일 동안 보관돼요.',
    'trash.moreN': ' 외 {n}명', 'trash.go': '{n}개 보내기', 'trash.moving': '캐릭터 {n}개를 최근 삭제로 보내는 중…',
    'trash.partial': '{ok}/{all}개를 보냈어요. {names}은(는) 옮기지 못했어요(다른 탭에서 잠겨 있어요). 아직 라이브러리에 있고 선택된 채예요.', 'trash.partialRetry': '{who} 다시 시도',
    'trash.ok': '캐릭터 {n}개를 최근 삭제로 보냈어요. 30일 동안 보관돼요.', 'trash.view': '최근 삭제 보기',
    'trash.scopeAll': '최근 삭제 {total}개를 모두 보여 줘요. 비우면 {total}개가 완전히 삭제돼요.', 'trash.scopeQ': '“{q}”와 맞는 {m}/{total}개를 보여 줘요. 맞는 것만 비우면 {m}개가 완전히 삭제되고 나머지 {rest}개는 남아요.',
    'trash.search': '최근 삭제 검색', 'trash.empty': '최근 삭제 비우기 ({n})', 'trash.emptyQ': '맞는 항목 비우기 ({n})',
    'trash.none': '<b>최근 삭제가 비어 있어요</b><br>삭제한 캐릭터는 여기에서 30일 동안 복원할 수 있어요.', 'trash.noMatch': '“{q}”와 맞는 항목이 없어요.', 'trash.clearSearch': '검색 지우기',
    'trash.days': '{d}일 남음', 'trash.restore': '복원', 'trash.restoring': '복원하는 중…', 'trash.retry': '다시 시도', 'trash.restoreFail': '복원하지 못했어요(저장소가 바빠요). 아직 최근 삭제에 있어요.',
    'trash.restoreDone': '{name}을(를) 라이브러리로 복원했어요. 채팅도 돌아왔어요.', 'trash.filtersCleared': ' 보이도록 필터를 지웠어요.',
    'trash.delTitleAll': '최근 삭제의 {n}개를 완전히 삭제할까요?', 'trash.delTitleQ': '맞는 {n}개를 완전히 삭제할까요?', 'trash.delText': '{names}. 되돌릴 수 없어요.', 'trash.delTextRest': '나머지 {rest}개는 최근 삭제에 남아요. ', 'trash.delGo': '완전히 삭제',
    'trash.deleted': '{n}개를 완전히 삭제했어요. {rest}', 'trash.restKept': '나머지 {n}개는 남겨 뒀어요.', 'trash.nowEmpty': '최근 삭제가 비었어요.',
    'msg.dismiss': '닫기', 'msg.dismissLabel': '알림 닫기',
    'empty.h': '첫 이야기를 시작해 봐요.', 'empty.p': '캐릭터를 만들거나, 갖고 있는 캐릭터를 가져오세요.', 'empty.create': '캐릭터 만들기', 'empty.import': '캐릭터 가져오기', 'empty.browse': '또는 RisuRealm 둘러보기 ↗',
    'add.titleCreate': '캐릭터 만들기', 'add.titleImport': '캐릭터 가져오기', 'add.text': '샘플 캐릭터 한 명을 추가해서 라이브러리를 채워요.', 'add.go': '샘플 캐릭터 추가', 'add.nameCreate': '새 캐릭터 {n}', 'add.nameImport': '가져온 카드 {n}', 'add.done': '{name}을(를) 추가했어요.',

    'realm.h': 'RisuRealm', 'realm.upstream': '업스트림', 'realm.sub': 'RisuRealm에서 캐릭터를 더 둘러보세요.', 'realm.latest': '최신 업로드', 'realm.more': 'RisuRealm에서 더 보기', 'realm.page': 'RisuRealm 페이지 열기',
    'realm.consent': 'RisuRealm의 내용은 업스트림 RisuAI가 운영하는 서비스에서 와요. 약관에 동의하면 보여 드려요.', 'realm.consentBtn': '동의하고 보기', 'realm.gateLink': '새 캐릭터는 RisuRealm에서 찾을 수 있어요. 업스트림 서비스라 약관 동의가 먼저 필요해요.',
    'realm.pending': '불러오는 중...', 'realm.offline': '오프라인이에요. 인터넷에 연결하면 RisuRealm을 둘러볼 수 있어요.', 'realm.failed': 'RisuRealm을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.', 'realm.empty': '지금은 RisuRealm에 캐릭터가 없어요.', 'realm.retry': '다시 시도',
    'realm.loaded': '캐릭터 {n}명을 불러왔어요', 'realm.announce': 'RisuRealm 공지', 'realm.announceBody': '이번 주말에는 등대 이야기를 모아 보여 드려요.', 'realm.chats': '채팅 {n}',
    'realm.hubBack': '홈으로 돌아가기', 'realm.hubText': 'RisuRealm에 올라온 캐릭터를 둘러볼 수 있어요.', 'realm.hubPage': '전체 RisuRealm 페이지 열기', 'realm.hybridLink': '새 캐릭터가 필요한가요? RisuRealm 둘러보기 ↗',
    'realm.item': '{name} 미리보기',
    'agree.text': '이 기능은 이 앱이 아니라 업스트림 RisuAI가 운영하는 서비스를 이용해요. 계속하려면 서비스 약관과 개인정보 처리방침에 동의해 주세요.', 'agree.terms': '서비스 약관', 'agree.privacy': '개인정보 처리방침', 'agree.linksNote': '링크는 새 창에서 열려요.', 'agree.decline': '동의 안 함', 'agree.accept': '동의', 'agree.linksH': '약관 링크',
    'community.h': '커뮤니티와 소스', 'community.discord': '디스코드', 'community.web': '웹사이트', 'community.src': '소스 코드', 'community.mail': '이메일', 'community.aside': '디스커버리와 커뮤니티',

    'hy.eyebrow': '내 동반자', 'hy.change': '동반자 바꾸기', 'hy.voice': '음성', 'hy.noVoice': '이 캐릭터는 음성이 설정되지 않았어요', 'hy.personality': '성향',
    'hy.p.focused': '과제 중심', 'hy.p.balanced': '균형 잡힌 동반자', 'hy.p.full': '캐릭터에 완전 몰입', 'hy.h.focused': '주로 과제에 집중해요.', 'hy.h.balanced': '과제가 먼저, 말투는 캐릭터답게요.', 'hy.h.full': '캐릭터로서 완전히 몰입해요.',
    'hy.msgLabel': '{name}에게 메시지', 'hy.ph': '{name}에게 쓰기, 분석, 코딩, 도구 실행을 부탁해 보세요...', 'hy.phNone': '지금 과제를 적어 두고, 보내려면 동반자를 고르세요.',
    'hy.attach': '첨부', 'hy.tools': '도구', 'hy.lore': '로어북', 'hy.send': '보내기', 'hy.tasksH': '작업', 'hy.tasksEarlier': '이전 작업', 'hy.noTasks': '아직 작업이 없어요.',
    'hy.quickH': '{name}와 시작하기', 'hy.quickNone': '과제 시작하기',
    'q.code': '코드 리뷰와 리팩터링', 'q.codeD': '변경 내용을 붙여 넣거나 파일을 첨부하세요.', 'q.book': '문서·설정 요약', 'q.bookD': '메모, 챕터, 로어북을 줄여 줘요.', 'q.lang': '번역과 현지화', 'q.langD': '이름과 말투를 유지해요.', 'q.braces': '플러그인·Lua 스크립트 도움', 'q.bracesD': '스크립트를 설명하고, 쓰고, 고쳐요.',
    'hy.companionH': '동반자를 고르세요', 'hy.companionP': '하이브리드는 답해 줄 캐릭터가 필요해요. {lib}', 'hy.companionLib': '라이브러리에서 고르거나 기본 제공 Airisu를 쓸 수 있어요.', 'hy.companionLib0': '라이브러리가 비어 있어요. 기본 제공 Airisu를 쓰거나 롤플레이에서 캐릭터를 만드세요.', 'hy.choose': '동반자 고르기', 'hy.goRp': '롤플레이 라이브러리로',
    'pick.companion': '동반자 고르기', 'pick.companionSub': '어떤 캐릭터든 과제를 도와줄 수 있어요.', 'pick.close': '닫기', 'pick.current': ', 현재',
    'hy.railTasks': '동반자 작업', 'hy.railSwap': '캐릭터 바꾸기', 'hy.railStudio': '플러그인·스크립트 스튜디오', 'hy.railTools': '플레이그라운드 도구', 'hy.railComp': '동반자', 'hy.railPresets': '모델·프리셋', 'hy.active': ', 사용 중',
    'hy.greet.sera': '“잉크가 아직 마르지 않았어요. 그 패치, 끝내 볼까요?”', 'hy.greet.hollis': '“아, 질문이군요. 좋아요. 앉아요.”', 'hy.greet.lumi': '“언제든 준비됐어요!”', 'hy.greet.airisu': '“안녕하세요! 무엇을 도와드릴까요?”', 'hy.greet.default': '“언제든 준비됐어요.”',
    'model.pill': 'Claude · 균형 프리셋', 'model.pillSr': ', 모델과 프리셋', 'model.noKey': 'Claude · 키 없음', 'model.none': '모델 설정 안 됨', 'model.setupSr': ', 모델 설정', 'model.context': 'Claude', 'model.contextSr': '사용한 컨텍스트',

    'ut.eyebrow': '유틸리티', 'ut.greet': '무엇을 만들까요?', 'ut.greetName': '무엇을 만들까요, {name}님?', 'ut.taskLabel': '작업', 'ut.ph': '작업을 설명하거나, 텍스트를 붙여 넣거나, 파일을 끌어다 놓으세요. /로 명령어.',
    'ut.mcp': 'MCP 도구 · 2', 'ut.preset': '리서치 프리셋', 'ut.web': '웹', 'ut.run': '실행', 'ut.quick': '빠른 실행', 'ut.runH': '진행 중인 작업', 'ut.recentH': '최근',
    'ut.chip.tool': 'MCP 도구 실행', 'ut.chip.code': '플러그인·Lua IDE', 'ut.chip.braces': '프롬프트·Jinja 테스트', 'ut.chip.hash': '토큰 세기', 'ut.chip.lang': '문서 번역',
    'ut.newTask': '새 작업', 'ut.collapse': '사이드바 접기', 'ut.expand': '사이드바 펼치기', 'ut.sidebar': '사이드바', 'ut.workspaces': '작업 공간', 'ut.recent': '최근', 'ut.tools': '도구', 'ut.noRecent': '최근 작업이 아직 없어요.',
    'ut.ws.release': '릴리스 노트', 'ut.ws.parser': '파서 리팩터링', 'ut.ws.thesis': '논문 조사',
    'ut.tool.studio': '플러그인·스크립트 스튜디오', 'ut.tool.mcp': 'MCP', 'ut.tool.tokenizer': '토크나이저', 'ut.tool.jinja': 'Jinja', 'ut.tool.parser': '파서', 'ut.tool.embedding': '임베딩', 'ut.tool.translation': '번역',

    'run.idleTitle': '실행 중인 작업 없음', 'run.step': ' · {n}/{total}단계', 'run.stepAt': ' ({n}/{total}단계에서)', 'run.idleMeta': '작업을 보내면 여기에서 진행 상황을 볼 수 있어요.', 'run.noProviderMeta': '작업을 실행하려면 먼저 모델을 설정하세요.', 'run.waitModel': '모델을 기다리는 중', 'run.waitKey': '키를 기다리는 중',
    'run.stop': '중지', 'run.cancel': '대기 취소', 'run.open': '열기', 'run.retry': '다시 시도', 'run.queued': '대기 중', 'run.queuedMeta': '실행 칸이 나면 시작해요', 'run.stopped': '중지했어요.', 'run.failed': '제공자가 오류를 돌려줬어요. 보낸 글은 최근에 있고, 다시 시도하면 한 번 더 보내요.',
    'run.of': '{n}/{cap}개 실행 중', 'run.cap': '이 모드에서 {cap}개가 이미 실행 중이에요. 이 작업은 기다렸다가 자리가 나면 시작해요.', 'run.queuedNote': '대기열에 올렸어요. 자리가 나면 시작해요.', 'run.full': '이 모드의 대기열이 가득 찼어요(최대 {max}개). 아무것도 보내지 않았어요. 적은 글은 그대로예요.', 'run.empty': '아직 작업이 없어요.', 'run.mark': '작업 상태 표시',
    'run.meta.companion': '{name}와 함께', 'run.meta.tools': ' · 도구 켜짐', 'run.meta.util': '리서치 프리셋', 'run.meta.utilTools': ' · 도구 2개 사용 가능', 'run.meta.web': ' · 웹 켜짐', 'run.meta.withTools': '{name}와 함께 · 도구 2개',
    'tasks.sub': '모든 모드의 작업이에요. 다른 곳에서 시작한 것도 보여요.', 'tasks.capNote': '모드마다 최대 {cap}개까지 동시에 실행돼요.', 'tasks.active': '진행 중', 'tasks.ended': '끝난 작업', 'tasks.waiting': '대기 중', 'tasks.emptyList': '지금은 작업이 없어요.', 'tasks.close': '닫기', 'tasks.rowMode': '{mode} · {status}',
    'tasks.bgRunning': '{name}의 답장', 'tasks.bgDone': '{name}의 답장이 도착했어요', 'tasks.bgFailed': '{name}의 답장을 쓰지 못했어요', 'tasks.bgCancelled': '{name}의 답장을 취소했어요',
    'bg.running': '답장 쓰는 중', 'bg.queued': '대기 중', 'bg.done': '새 답장', 'bg.failed': '답장 실패',
    'note.empty': '먼저 글을 적어 주세요. 아무것도 보내지 않았어요.', 'note.emptyTask': '먼저 작업을 적어 주세요. 아무것도 시작하지 않았어요.', 'note.chooseCompanion': '먼저 동반자를 고르세요. 아무것도 보내지 않았어요. 적은 글은 그대로예요.',
    'note.noKey': '이 모델의 키가 없어요', 'note.noModel': '설정된 모델이 없어요', 'note.noSent': '{why}. 아무것도 {verb} 않았어요. 적은 글은 그대로예요.', 'note.verbSent': '보내지', 'note.verbStarted': '시작하지', 'note.offline': '오프라인이에요. 아무것도 보내지 않았어요. 적은 글은 그대로예요.',
    'note.modelReady': '모델이 준비됐어요. 아직 아무것도 실행하지 않았어요. 준비되면 {word}를 누르세요.', 'note.attached': '', 'composer.hint': '모드를 바꿔도 적고 있는 글은 이 화면에 남아 있어요.',
    'setup.noModel': '모델이 아직 설정되지 않았어요', 'setup.noKey': '이 모델의 키가 없어요', 'setup.hint': '지금 글을 적어 둘 수 있어요. {what} 실행해요.', 'setup.whatModel': '모델을 설정하면', 'setup.whatKey': '키를 추가하면', 'setup.btnModel': '모델 설정', 'setup.btnKey': '키 추가',
    'setup.title': '모델 설정', 'setup.titleKey': '키 추가', 'setup.text': '모델 설정 화면은 설정 › 모델·프리셋에 있어요.', 'setup.cancel': '취소', 'setup.open': '모델 설정 열기', 'setup.use': '가상 모델 쓰기', 'setup.useKey': '가상 키 쓰기',
    'draft.text': '메시지에 이미 글이 있어요. “{t}”를 어떻게 할까요?', 'draft.append': '뒤에 붙이기', 'draft.replace': '글 바꾸기', 'draft.cancel': '취소', 'draft.replaceTitle': '지금 쓴 글이 사라져요. 되돌릴 수 없어요.',
    'leave.title': '{mode}에 보내지 않은 글이 있어요', 'leave.text': '모드를 바꿔도 적고 있는 글은 이 화면에 남아 있어요.', 'leave.stay': '머무르기', 'leave.go': '{mode}(으)로 전환', 'leave.changeMode': '{mode}로 전환',
    'repair.h': '{mode}만 보이고 있어요', 'repair.p': '다른 모드는 숨겨져 있어요. 설정에서 다시 보이게 할 수 있어요.', 'repair.btn': '모든 모드 보이기',

    'drawer.label': '{mode} 메뉴', 'toast.backQuit': '종료하려면 뒤로 가기를 한번 더 누르세요', 'toast.demo': '“{what}”은(는) 이 목업에서 열리지 않아요.', 'toast.ext': '외부 페이지예요. 여기서는 열지 않아요.', 'toast.close': '닫기', 'thread.history': '“{title}”은(는) 기록이에요. 이 작업의 상세 보기는 아직 연결되지 않았어요.', 'toast.draftLost': '돌아오기 전에 적은 글을 복원하지 못했어요.',
    'link.opening': '{what} 여는 중', 'link.chat': '대화', 'link.settings': '설정', 'link.studio': '스튜디오', 'link.realm': 'RisuRealm', 'link.task': '작업 상세',

    'mock.controls': '목업 컨트롤', 'mock.lowPower': '저전력', 'mock.motion': '움직임 줄이기', 'mock.hideUnused': '쓰지 않는 모드 숨기기', 'mock.hideNo': '아니요(전환기 보임)', 'mock.rpOnly': '롤플레이만', 'mock.utOnly': '유틸리티만',
    'mock.realm': 'RisuRealm 카드', 'mock.seasonal': '시즌 로고', 'mock.seasonalAuto': '오늘 날짜', 'mock.seasonalNone': '없음(평소)', 'mock.outcome': '다음 작업', 'mock.ok': '성공', 'mock.fail': '실패(제공자 오류)', 'mock.offline': '오프라인(안 보냄)',
    'mock.fixture': '상태 모음(다시 불러옴)', 'mock.runs': '샘플 작업 보이기', 'mock.runsOn': '샘플 작업 숨기기', 'mock.lang': '언어', 'mock.bgStart': '롤플레이 백그라운드 답장 시작', 'mock.trashNote': '(가상) 실제로 삭제되지 않아요.', 'mock.agreeNote': '(가상) 약관 링크는 열리지 않아요.',
    'mock.hubNote': '(가상) 이 목업은 네트워크 요청을 보내지 않아요.', 'mock.quit': '(가상) 앱이 종료돼요.', 'mock.opens': '(가상) {url}',
    'mock.dlgTrash': '(가상) 실제로 삭제되지 않아요. 진행 중인 답장은 취소돼요.'
  };
  var EN = {
    'title': 'Home · RisuTanium', 'title.mode': '{mode} home · RisuTanium',
    'skip': 'Skip to content', 'menu': 'Menu', 'menu.close': 'Close menu',
    'mode.legend': 'Mode', 'mode.rp': 'Roleplay', 'mode.hybrid': 'Hybrid', 'mode.utility': 'Utility', 'mode.home': '{mode} home', 'mode.menu': '{mode} menu', 'mode.opening': 'Opening {target}',
    'rail.home': 'Home', 'rail.newChar': 'New character', 'rail.prompts': 'Prompt settings', 'rail.settings': 'Settings', 'rail.lastChat': 'last chat', 'rail.recent': 'Recent characters', 'rail.bgBadge': '{state}',
    'tasks': 'Tasks', 'tasks.none': ', none running', 'tasks.n': ', {n} running',
    'persona.chip': 'Persona: {name}', 'persona.hint': 'Used for chats without one', 'persona.go': 'Manage in Settings › Personas', 'persona.caption': 'Used for chats without a persona of their own. Change it in Settings › Personas.',
    'persona.default': 'Juno',

    'rp.eyebrow': 'Roleplay', 'rp.welcomeBack': 'Welcome back, {name}', 'rp.welcome': 'Welcome, {name}',
    'continue.h': 'Continue your story', 'story.noMemory': 'No memory',
    'lib.h': 'Characters', 'lib.count': '{shown} of {total}', 'lib.countTrash': '{shown} of {total} in Recently deleted', 'lib.views': 'Library view',
    'lib.tab.chars': 'Characters', 'lib.tab.trash': 'Recently deleted', 'lib.search': 'Search characters', 'lib.sort': 'Sort', 'lib.sort.order': 'My order', 'lib.sort.recent': 'Recent', 'lib.sort.name': 'Name', 'lib.new': 'New', 'lib.manage': 'Manage library',
    'lib.folders': 'Folders', 'folder.fantasy': 'Fantasy', 'folder.scifi': 'Sci-fi', 'folder.drafts': 'Drafts',
    'char.chats': function (v) { return v.n + (v.n === 1 ? ' chat' : ' chats'); }, 'char.group': function (v) { return 'Group · ' + v.n + (v.n === 1 ? ' chat' : ' chats'); }, 'char.builtIn': 'Built-in', 'char.noMatch': 'No characters match this search', 'char.noFolder': 'No characters in this folder.', 'char.clearSearch': 'Clear search',
    'char.reorderHint': 'Reordering needs My order, all folders and no search.', 'char.up': 'Move {name} up', 'char.down': 'Move {name} down', 'char.select': 'Select {name}',
    'sel.none': 'None selected. Tick characters to move or delete them.', 'sel.none2': 'None selected', 'sel.n': '{n} selected', 'sel.hidden': '{n} selected ({h} not shown by the current search or folder)',
    'sel.group': 'Selection actions', 'sel.all': 'Select all shown', 'sel.move': 'Move to folder', 'sel.trash': 'Move to Recently deleted', 'sel.actions': 'Actions', 'sel.actionsN': 'Actions for {n} selected', 'sel.actions0': 'Actions (none selected)', 'sel.done': 'Done',
    'move.title': 'Move {n} to a folder', 'move.noFolder': 'No folder', 'move.cancel': 'Cancel', 'move.result': 'Moved {n} to {folder}.', 'move.resultNone': 'Took {n} out of their folder.',
    'order.moved': 'Moved {name} to position {pos} of {total}.',
    'trash.title': 'Move {n} to Recently deleted?', 'trash.text': '{names}{more} will leave the library, the Continue shelf and companion choices. Their chats are hidden with them and come back if you restore. Kept in Recently deleted for 30 days.',
    'trash.moreN': ' and {n} more', 'trash.go': 'Move {n}', 'trash.moving': 'Moving {n} to Recently deleted…',
    'trash.partial': 'Moved {ok} of {all}. {names} could not be moved (locked by another tab). They are still in the library and still selected.', 'trash.partialRetry': 'Retry {who}',
    'trash.ok': 'Moved {n} to Recently deleted. Kept for 30 days.', 'trash.view': 'View Recently deleted',
    'trash.scopeAll': 'Showing all {total} items. Emptying would permanently delete all {total}.', 'trash.scopeQ': 'Showing {m} of {total} matching “{q}”. Emptying the matches would permanently delete {m}; the other {rest} stay.',
    'trash.search': 'Search Recently deleted', 'trash.empty': 'Empty Recently deleted ({n})', 'trash.emptyQ': 'Empty matching ({n})',
    'trash.none': '<b>Recently deleted is empty</b><br>Characters you delete can be restored here for 30 days.', 'trash.noMatch': 'Nothing matches “{q}”.', 'trash.clearSearch': 'Clear search',
    'trash.days': '{d} days left', 'trash.restore': 'Restore', 'trash.restoring': 'Restoring…', 'trash.retry': 'Retry', 'trash.restoreFail': 'Couldn’t restore (storage is busy). It is still in Recently deleted.',
    'trash.restoreDone': '{name} was restored to the library, with its chats.', 'trash.filtersCleared': ' Filters were cleared so you can see it.',
    'trash.delTitleAll': 'Permanently delete all {n}?', 'trash.delTitleQ': 'Permanently delete the {n} matching?', 'trash.delText': '{names}. This cannot be undone.', 'trash.delTextRest': 'The other {rest} stay in Recently deleted. ', 'trash.delGo': 'Delete permanently',
    'trash.deleted': 'Permanently deleted {n}. {rest}', 'trash.restKept': 'The other {n} were kept.', 'trash.nowEmpty': 'Recently deleted is now empty.',
    'msg.dismiss': 'Dismiss', 'msg.dismissLabel': 'Dismiss message',
    'empty.h': 'Your first story starts here.', 'empty.p': 'Create a character, or import one you already have.', 'empty.create': 'Create character', 'empty.import': 'Import character', 'empty.browse': 'Or browse RisuRealm ↗',
    'add.titleCreate': 'Create character', 'add.titleImport': 'Import character', 'add.text': 'Adds one sample character so the library is no longer empty.', 'add.go': 'Add sample character', 'add.nameCreate': 'New Character {n}', 'add.nameImport': 'Imported Card {n}', 'add.done': 'Added {name}.',

    'realm.h': 'RisuRealm', 'realm.upstream': 'Upstream', 'realm.sub': 'Browse more characters using RisuRealm.', 'realm.latest': 'Latest uploads', 'realm.more': 'See more on RisuRealm', 'realm.page': 'Open the RisuRealm page',
    'realm.consent': 'Realm content comes from a service operated by upstream RisuAI. Agree to its terms to show it.', 'realm.consentBtn': 'Agree and show', 'realm.gateLink': 'You can find new characters on RisuRealm. It is an upstream service, so its terms come first.',
    'realm.pending': 'Loading...', 'realm.offline': 'You’re offline. Connect to the internet to browse RisuRealm.', 'realm.failed': 'Failed to load RisuRealm. Please check your connection and try again.', 'realm.empty': 'No characters found in RisuRealm right now.', 'realm.retry': 'Retry',
    'realm.loaded': '{n} characters loaded', 'realm.announce': 'Announcement from RisuRealm', 'realm.announceBody': 'Lighthouse stories are featured this weekend.', 'realm.chats': function (v) { return v.n + (v.n === 1 ? ' chat' : ' chats'); },
    'realm.hubBack': 'Back to home', 'realm.hubText': 'Browse the characters uploaded to RisuRealm.', 'realm.hubPage': 'Open the full RisuRealm page', 'realm.hybridLink': 'Need a new character? Browse RisuRealm ↗',
    'realm.item': 'Preview {name}',
    'agree.text': 'This feature uses a service operated by upstream RisuAI, not by this app. To continue, accept its Terms of Service and Privacy Policy.', 'agree.terms': 'Terms of Service', 'agree.privacy': 'Privacy Policy', 'agree.linksNote': 'The links open in a new window.', 'agree.decline': 'Do not accept', 'agree.accept': 'Accept', 'agree.linksH': 'Terms links',
    'community.h': 'Community and source', 'community.discord': 'Discord', 'community.web': 'Website', 'community.src': 'Source code', 'community.mail': 'Email', 'community.aside': 'Discover and community',

    'hy.eyebrow': 'Your companion', 'hy.change': 'Change companion', 'hy.voice': 'Voice', 'hy.noVoice': 'No voice set up for this character', 'hy.personality': 'Personality',
    'hy.p.focused': 'Focused task', 'hy.p.balanced': 'Balanced companion', 'hy.p.full': 'Full in-character', 'hy.h.focused': 'Mostly the task.', 'hy.h.balanced': 'The task first, in their voice.', 'hy.h.full': 'Fully in character.',
    'hy.msgLabel': 'Message {name}', 'hy.ph': 'Ask {name} to write, analyse, code or run a tool...', 'hy.phNone': 'Write your task now; choose a companion to send it.',
    'hy.attach': 'Attach', 'hy.tools': 'Tools', 'hy.lore': 'Lorebook', 'hy.send': 'Send', 'hy.tasksH': 'Tasks', 'hy.tasksEarlier': 'Earlier tasks', 'hy.noTasks': 'No tasks yet.',
    'hy.quickH': 'Start with {name}', 'hy.quickNone': 'Start a task',
    'q.code': 'Code review and refactor', 'q.codeD': 'Paste a diff or attach files.', 'q.book': 'Document or lore summary', 'q.bookD': 'Condense notes, chapters or a lorebook.', 'q.lang': 'Translation and localisation', 'q.langD': 'Keeps names and tone.', 'q.braces': 'Plugin or Lua script help', 'q.bracesD': 'Explain, write or fix a script.',
    'hy.companionH': 'Choose a companion', 'hy.companionP': 'Hybrid needs a character to answer as. {lib}', 'hy.companionLib': 'Pick one from your library, or use the built-in Airisu.', 'hy.companionLib0': 'Your library is empty: use the built-in Airisu, or create a character in Roleplay.', 'hy.choose': 'Choose companion', 'hy.goRp': 'Go to Roleplay library',
    'pick.companion': 'Choose a companion', 'pick.companionSub': 'Any character can help with tasks.', 'pick.close': 'Close', 'pick.current': ', current',
    'hy.railTasks': 'Companion tasks', 'hy.railSwap': 'Switch character', 'hy.railStudio': 'Plugin & Script Studio', 'hy.railTools': 'Playground tools', 'hy.railComp': 'Companions', 'hy.railPresets': 'Models & presets', 'hy.active': ', active',
    'hy.greet.sera': '“Ink’s still wet on that parser patch. Shall we finish it?”', 'hy.greet.hollis': '“Ah, a question. Splendid. Do sit down.”', 'hy.greet.lumi': '“Ready when you are!”', 'hy.greet.airisu': '“Hi! What can I help you with today?”', 'hy.greet.default': '“Ready when you are.”',
    'model.pill': 'Claude · Balanced', 'model.pillSr': ', model and preset', 'model.noKey': 'Claude · key missing', 'model.none': 'No model set up', 'model.setupSr': ', set up a model', 'model.context': 'Claude', 'model.contextSr': 'context used',

    'ut.eyebrow': 'Utility', 'ut.greet': 'What are we building?', 'ut.greetName': 'What are we building, {name}?', 'ut.taskLabel': 'Task', 'ut.ph': 'Describe a task, paste text or drop files. / for commands.',
    'ut.mcp': 'MCP tools · 2', 'ut.preset': 'Research preset', 'ut.web': 'Web', 'ut.run': 'Run', 'ut.quick': 'Quick launch', 'ut.runH': 'Current run', 'ut.recentH': 'Recent',
    'ut.chip.tool': 'Run an MCP tool', 'ut.chip.code': 'Plugin & Lua IDE', 'ut.chip.braces': 'Test a prompt or Jinja', 'ut.chip.hash': 'Count tokens', 'ut.chip.lang': 'Translate a document',
    'ut.newTask': 'New task', 'ut.collapse': 'Collapse sidebar', 'ut.expand': 'Expand sidebar', 'ut.sidebar': 'Sidebar', 'ut.workspaces': 'Workspaces', 'ut.recent': 'Recent', 'ut.tools': 'Tools', 'ut.noRecent': 'No recent tasks yet.',
    'ut.ws.release': 'Release notes', 'ut.ws.parser': 'Parser refactor', 'ut.ws.thesis': 'Thesis research',
    'ut.tool.studio': 'Plugin & Script Studio', 'ut.tool.mcp': 'MCP', 'ut.tool.tokenizer': 'Tokenizer', 'ut.tool.jinja': 'Jinja', 'ut.tool.parser': 'Parser', 'ut.tool.embedding': 'Embedding', 'ut.tool.translation': 'Translation',

    'run.idleTitle': 'Nothing running', 'run.step': ' · step {n} of {total}', 'run.stepAt': ' at step {n} of {total}', 'run.idleMeta': 'Send a task and its progress shows here.', 'run.noProviderMeta': 'Set up a model before running a task.', 'run.waitModel': 'Waiting for a model', 'run.waitKey': 'Waiting for the missing key',
    'run.stop': 'Stop', 'run.cancel': 'Cancel wait', 'run.open': 'Open', 'run.retry': 'Retry', 'run.queued': 'Waiting', 'run.queuedMeta': 'Starts when a slot frees up', 'run.stopped': 'Stopped.', 'run.failed': 'The provider returned an error. Your text is in Recent; Retry sends it again.',
    'run.of': '{n} of {cap} running', 'run.cap': '{cap} are already running in this mode. This one waits and starts when a slot frees up.', 'run.queuedNote': 'Queued. It starts when a slot frees up.', 'run.full': 'The queue for this mode is full (up to {max} waiting). Nothing was sent; your text is still here.', 'run.empty': 'No tasks yet.', 'run.mark': 'Task status',
    'run.meta.companion': 'with {name}', 'run.meta.tools': ' · tools on', 'run.meta.util': 'Research preset', 'run.meta.utilTools': ' · 2 tools available', 'run.meta.web': ' · web on', 'run.meta.withTools': 'with {name} · 2 tools',
    'tasks.sub': 'Tasks from every mode, including ones started elsewhere.', 'tasks.capNote': 'Up to {cap} run at once in each mode.', 'tasks.active': 'Active', 'tasks.ended': 'Finished or stopped', 'tasks.waiting': 'Waiting', 'tasks.emptyList': 'No tasks right now.', 'tasks.close': 'Close', 'tasks.rowMode': '{mode} · {status}',
    'tasks.bgRunning': 'Reply from {name}', 'tasks.bgDone': 'Reply from {name} arrived', 'tasks.bgFailed': 'Reply from {name} failed', 'tasks.bgCancelled': 'Reply from {name} cancelled',
    'bg.running': 'Writing a reply', 'bg.queued': 'Waiting', 'bg.done': 'New reply', 'bg.failed': 'Reply failed',
    'note.empty': 'Write a message first. Nothing was sent.', 'note.emptyTask': 'Describe a task first. Nothing was started.', 'note.chooseCompanion': 'Choose a companion first. Nothing was sent; your text is still here.',
    'note.noKey': 'The key for this model is missing', 'note.noModel': 'No model is set up', 'note.noSent': '{why}. Nothing was {verb}; your text is still here.', 'note.verbSent': 'sent', 'note.verbStarted': 'started', 'note.offline': 'You’re offline. Nothing was sent; your text is still here.',
    'note.modelReady': 'Model ready. Nothing was run; press {word} when you are ready.', 'note.attached': '', 'composer.hint': 'Your text stays in the box if you switch modes on this screen.',
    'setup.noModel': 'No model set up yet', 'setup.noKey': 'The key for this model is missing', 'setup.hint': 'You can write your task now. {what} to run it.', 'setup.whatModel': 'Set up a model', 'setup.whatKey': 'Add the key', 'setup.btnModel': 'Set up a model', 'setup.btnKey': 'Add key',
    'setup.title': 'Set up a model', 'setup.titleKey': 'Add the missing key', 'setup.text': 'Model setup lives in Settings › Models & presets.', 'setup.cancel': 'Cancel', 'setup.open': 'Open model setup', 'setup.use': 'Use a synthetic model', 'setup.useKey': 'Use a synthetic key',
    'draft.text': 'Your message already has text. What should “{t}” do?', 'draft.append': 'Append', 'draft.replace': 'Replace draft', 'draft.cancel': 'Cancel', 'draft.replaceTitle': 'Discards your current draft. It cannot be undone here.',
    'leave.title': 'You have an unsent message in {mode}', 'leave.text': 'Your text stays in the box if you switch modes on this screen.', 'leave.stay': 'Stay', 'leave.go': 'Switch to {mode}',
    'repair.h': 'Only {mode} is shown', 'repair.p': 'The other modes are hidden. You can show them again in Settings.', 'repair.btn': 'Show all modes',

    'drawer.label': '{mode} menu', 'toast.backQuit': 'Press Back again to quit', 'toast.demo': '“{what}” is a demo item and does not open yet.', 'toast.ext': 'An external page. It does not open here.', 'toast.close': 'Close', 'thread.history': '“{title}” is a history entry. Its detail view is not connected yet.', 'toast.draftLost': 'The text you had typed before you left could not be restored.',
    'link.opening': 'Opening {what}', 'link.chat': 'chat', 'link.settings': 'Settings', 'link.studio': 'Studio', 'link.realm': 'RisuRealm', 'link.task': 'task details',

    'mock.controls': 'Mockup controls', 'mock.lowPower': 'Low power', 'mock.motion': 'Reduce motion', 'mock.hideUnused': 'Hide unused modes', 'mock.hideNo': 'No (show switcher)', 'mock.rpOnly': 'Roleplay only', 'mock.utOnly': 'Utility only',
    'mock.realm': 'RisuRealm card', 'mock.seasonal': 'Seasonal logo', 'mock.seasonalAuto': 'Today\'s date', 'mock.seasonalNone': 'None (everyday)', 'mock.outcome': 'Next task', 'mock.ok': 'Succeeds', 'mock.fail': 'Fails (provider error)', 'mock.offline': 'Offline (not sent)',
    'mock.fixture': 'Fixture (reloads preview)', 'mock.runs': 'Show sample tasks', 'mock.runsOn': 'Hide sample tasks', 'mock.lang': 'Language', 'mock.bgStart': 'Start a Roleplay background reply', 'mock.trashNote': '(Simulated) Nothing is really deleted.', 'mock.agreeNote': '(Simulated) The terms links do not open.',
    'mock.hubNote': '(Simulated) This mockup makes no network requests.', 'mock.quit': '(Simulated) The app quits.', 'mock.opens': '(Simulated) {url}',
    'mock.dlgTrash': '(Simulated) Nothing is really deleted. A running reply is cancelled.'
  };
  var STATUS_KO = { idle: '준비됨', waiting: '대기 중', preparing: '준비 중', memory: '기억 정리 중', thinking: '생각 중', generating: '쓰는 중', tool_call: '도구 사용 중', translating: '번역 중', imaging: '이미지 만드는 중', speaking: '말하는 중', finishing: '마무리 중', done: '완료', stopped: '중지됨', error: '실패', transfer_in: '데이터 받는 중', transfer_out: '데이터 보내는 중', scanning: '데이터 확인 중' };
  // Korean strings with a particle after a name are functions, so the particle follows the name (josa below).
  function J(w, k) { return w + josa(w, k); }
  KO['move.result'] = function (v) { return v.n + '개를 ' + J(v.folder, '으로/로') + ' 옮겼어요.'; };
  KO['order.moved'] = function (v) { return J(v.name, '을/를') + ' ' + v.total + '명 중 ' + v.pos + '번째로 옮겼어요.'; };
  KO['trash.text'] = function (v) { return J(v.names + (v.more || ''), '은/는') + ' 라이브러리, 이어가기 목록, 동반자 후보에서 사라져요. 채팅도 함께 숨겨지고, 복원하면 돌아와요. 최근 삭제에 30일 동안 보관돼요.'; };
  KO['trash.partial'] = function (v) { return v.ok + '/' + v.all + '개를 보냈어요. ' + J(v.names, '은/는') + ' 옮기지 못했어요(다른 탭에서 잠겨 있어요). 아직 라이브러리에 있고 선택된 채예요.'; };
  KO['trash.restoreDone'] = function (v) { return J(v.name, '을/를') + ' 라이브러리로 복원했어요. 채팅도 돌아왔어요.'; };
  KO['add.done'] = function (v) { return J(v.name, '을/를') + ' 추가했어요.'; };
  KO['leave.go'] = function (v) { return J(v.mode, '으로/로') + ' 전환'; };
  KO['hy.quickH'] = function (v) { return J(v.name, '와/과') + ' 시작하기'; };
  KO['run.meta.companion'] = function (v) { return J(v.name, '와/과') + ' 함께'; };
  KO['run.meta.withTools'] = function (v) { return J(v.name, '와/과') + ' 함께 · 도구 2개'; };
  KO['toast.demo'] = function (v) { return '“' + v.what + '”' + josa(v.what, '은/는') + ' 데모 항목이라 아직 열리지 않아요.'; };
  KO['mock.runsOn'] = '샘플 작업 숨기기';
  delete KO['leave.changeMode'];
  var params = new URLSearchParams(location.search);
  var lang = params.get('lang') === 'en' ? 'en' : 'ko';
  var T = lang === 'en' ? EN : KO;
  var warned = {};
  function t(key, v) {
    var s = Object.prototype.hasOwnProperty.call(T, key) ? T[key] : undefined;
    if (s === undefined) { if (!warned[key]) { warned[key] = 1; console.warn('[home] missing string: ' + key + ' (' + lang + ')'); } return key; }
    if (typeof s === 'function') return s(v || {});
    if (!v) return s;
    return s.replace(/\{(\w+)\}/g, function (m, k) { return v[k] === undefined ? m : String(v[k]); });
  }
  // Korean particles. batchim: does the last syllable end in a consonant? (rieul counts as "no batchim" for 으로/로.)
  function josa(word, kind) {
    word = String(word); var last = word.trim().slice(-1); if (!last) return '';
    var code = last.charCodeAt(0); var hangul = code >= 0xAC00 && code <= 0xD7A3; var jong = hangul ? (code - 0xAC00) % 28 : -1;
    var has = hangul ? jong !== 0 : /[013678mnlMNL]/.test(last);
    var pairs = { '이/가': ['이', '가'], '은/는': ['은', '는'], '을/를': ['을', '를'], '와/과': ['과', '와'], '으로/로': ['으로', '로'] };
    var pr = pairs[kind]; if (!pr) return '';
    if (kind === '으로/로') return jong === 8 || !has ? pr[1] : pr[0];
    return has ? pr[0] : pr[1];
  }
  window.HomeStrings = { lang: lang, KO: KO, EN: EN, STATUS_KO: STATUS_KO, t: t, josa: josa, keys: function () { return Object.keys(KO); } };
})();
