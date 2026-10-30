/* Home task engine (DD-204, DD-205). Simulated: timers walk a script of statuses; nothing is sent or stored.
   Up to Home.CAP (3) tasks run at once in each mode. A further send waits ("queued") and starts when one of them ends. Each task is its own row (page card and Tasks dialog), each with its own Stop.
   Roleplay "reply" tasks are chat replies that keep generating after the author leaves the chat (DD-039): they count against the Roleplay cap and show as a badge on the character (DD-205). */
(function () {
  'use strict';
  var H = window.Home; var S = H.S; var store = H.store; var CAP = H.CAP; var QUEUE_MAX = H.QUEUE_MAX; var P = H.P;
  var SCRIPTS = {
    hybrid: [['preparing', 1200], ['thinking', 2200], ['tool_call', 2600], ['memory', 1600], ['generating', 2600], ['speaking', 2200], ['done', 0]],
    utility: [['preparing', 1200], ['thinking', 2200], ['tool_call', 2800], ['thinking', 1400], ['generating', 2600], ['finishing', 1400], ['done', 0]],
    rp: [['preparing', 900], ['generating', 6200], ['done', 0]]
  };
  var FAIL_AFTER = 3;           // a failing run errors after its third step (a tool call)
  var seq = 0; var listeners = [];
  var still = P.get('still') === '1';
  var Tasks = H.Tasks = {
    SCRIPTS: SCRIPTS,
    onChange: function (fn) { listeners.push(fn); },
    emit: function (task) { listeners.forEach(function (fn) { fn(task || null); }); },
    all: function () { return Object.keys(store.tasks).map(function (k) { return store.tasks[k]; }).sort(function (a, b) { return a.seq - b.seq; }); },
    byMode: function (mode) { return Tasks.all().filter(function (x) { return x.mode === mode; }); },
    activeCount: function (mode) { return Tasks.all().filter(function (x) { return x.state === 'active' && (!mode || x.mode === mode); }).length; },
    queuedCount: function (mode) { return Tasks.all().filter(function (x) { return x.state === 'queued' && (!mode || x.mode === mode); }).length; },
    // what the page shows for a mode: everything running or waiting, then the two most recent ended ones
    visible: function (mode) {
      var live = Tasks.byMode(mode).filter(function (x) { return x.state !== 'ended'; });
      var ended = Tasks.byMode(mode).filter(function (x) { return x.state === 'ended'; }).slice(-2).reverse();
      return live.concat(ended);
    },
    get: function (id) { return store.tasks[id]; },
    title: function (task) { return task.kind === 'reply' ? H.t(task.note === 'cancelled' ? 'tasks.bgCancelled' : task.status === 'error' ? 'tasks.bgFailed' : task.state === 'ended' && task.status === 'done' ? 'tasks.bgDone' : 'tasks.bgRunning', { name: H.name(task.charId) }) : H.loc(task.title); },
    // DD-248: at most QUEUE_MAX tasks wait per mode; a further send is refused (returns null) and the caller says the queue is full
    create: function (o) {
      if (Tasks.activeCount(o.mode) >= CAP && Tasks.queuedCount(o.mode) >= QUEUE_MAX) return null;
      var task = { id: 'task-' + (++seq), seq: seq, mode: o.mode, kind: o.kind || 'run', title: o.title || '', meta: o.meta || '', charId: o.charId || '', status: 'waiting', step: 0, total: SCRIPTS[o.mode].length, state: 'queued', fails: !!o.fails, unseen: false, note: '', timer: null };
      store.tasks[task.id] = task;
      if (Tasks.activeCount(o.mode) < CAP) Tasks.begin(task); else { task.note = 'queued'; Tasks.emit(task); }
      return task;
    },
    // shown = how many steps are already on screen (0 = a fresh start). A task resumed at step n shows step n for its duration, then goes on.
    begin: function (task, shown) {
      task.state = 'active'; task.note = '';
      var script = SCRIPTS[task.mode];
      if (shown) {
        task.step = shown; task.status = script[shown - 1][0]; Tasks.emit(task);
        clearTimeout(task.timer);
        if (!still) task.timer = setTimeout(function () { Tasks.play(task, shown); }, script[shown - 1][1]);
      } else { task.step = 0; Tasks.play(task, 0); }
    },
    play: function (task, from) {
      clearTimeout(task.timer);
      var script = SCRIPTS[task.mode];
      var step = function (i) {
        if (task.state !== 'active') return;
        if (task.fails && i === FAIL_AFTER) { Tasks.end(task, 'error', 'failed'); return; }
        task.status = script[i][0]; task.step = i + 1;
        if (task.status === 'done') { Tasks.end(task, 'done', ''); return; }
        Tasks.emit(task);
        if (still) return;
        task.timer = setTimeout(function () { step(i + 1); }, script[i][1]);
      };
      step(from);
    },
    end: function (task, status, note) {
      clearTimeout(task.timer);
      task.state = 'ended'; task.status = status; task.note = note || '';
      if (task.kind === 'reply') task.unseen = true;
      Tasks.emit(task);
      Tasks.promote(task.mode);
    },
    promote: function (mode) {
      var next = Tasks.byMode(mode).filter(function (x) { return x.state === 'queued'; })[0];
      if (next && Tasks.activeCount(mode) < CAP) Tasks.begin(next);
    },
    stop: function (id) {
      var task = store.tasks[id]; if (!task || task.state === 'ended') return;
      var queued = task.state === 'queued';
      clearTimeout(task.timer);
      task.state = 'ended'; task.status = 'stopped'; task.note = queued ? 'cancelled' : 'stopped'; task.unseen = false;
      Tasks.emit(task);
      Tasks.promote(task.mode);
    },
    retry: function (id) {
      var task = store.tasks[id]; if (!task || task.state !== 'ended') return;
      task.fails = S.outcome === 'fail'; task.seq = ++seq; task.step = 0; task.note = '';
      if (Tasks.activeCount(task.mode) < CAP) Tasks.begin(task); else { task.state = 'queued'; task.status = 'waiting'; task.note = 'queued'; Tasks.emit(task); }
    },
    // DD-249: a character moved to Recently deleted stops its running or waiting reply; the row stays, listed as cancelled
    cancelForChar: function (charId) {
      Tasks.byMode('rp').filter(function (x) { return x.kind === 'reply' && x.charId === charId; }).forEach(function (x) {
        if (x.state === 'active' || x.state === 'queued') { clearTimeout(x.timer); x.state = 'ended'; x.status = 'stopped'; x.note = 'cancelled'; x.unseen = false; Tasks.emit(x); Tasks.promote('rp'); }
        else x.unseen = false;
      });
    },
    // the author opened the chat: a finished reply is no longer news
    markSeen: function (charId) {
      Tasks.all().forEach(function (x) { if (x.kind === 'reply' && x.charId === charId && x.state === 'ended') { x.unseen = false; } });
      Tasks.emit(null);
    },
    // 'running' | 'done' | 'failed' | '' for a Roleplay character (DD-205)
    bgOf: function (charId) {
      var mine = Tasks.byMode('rp').filter(function (x) { return x.kind === 'reply' && x.charId === charId; });
      if (mine.some(function (x) { return x.state === 'active'; })) return 'running';
      if (mine.some(function (x) { return x.state === 'queued'; })) return 'queued';
      var last = mine.filter(function (x) { return x.state === 'ended' && x.unseen; }).pop();
      return last ? (last.status === 'error' ? 'failed' : last.status === 'done' ? 'done' : '') : '';
    },
    reply: function (charId, o) {
      o = o || {};
      return Tasks.create({ mode: 'rp', kind: 'reply', charId: charId, fails: !!o.fails });
    },
    clear: function () { Tasks.all().forEach(function (x) { clearTimeout(x.timer); }); store.tasks = {}; Tasks.emit(null); },
    // sample tasks (m8: Home loads idle; ?runs=sample or the mock control shows these)
    seedSample: function () {
      var mk = function (o, step) { var task = Tasks.create(Object.assign({}, o)); if (step && task.state === 'active') { clearTimeout(task.timer); Tasks.begin(task, step); } return task; };
      mk({ mode: 'hybrid', title: { ko: '파서 패치 검토', en: 'Review the parser patch' }, meta: { ko: '세라핀과 함께 · 도구 2개', en: 'with Seraphina · 2 tools' } }, 3);
      mk({ mode: 'hybrid', title: { ko: '4장 설정 요약', en: 'Summarise chapter 4 lore' }, meta: { ko: '홀리스 교수와 함께', en: 'with Professor Hollis' } }, 4);
      mk({ mode: 'utility', title: { ko: '마이그레이션 노트 요약', en: 'Summarise the migration notes' }, meta: { ko: '리서치 프리셋 · 도구 2개 사용 가능', en: 'Research preset · 2 tools available' } }, 2);
      var r1 = Tasks.reply('sera'); clearTimeout(r1.timer); Tasks.begin(r1, 2);
      var r2 = Tasks.reply('kestrel'); clearTimeout(r2.timer); r2.state = 'ended'; r2.status = 'done'; r2.step = 3; r2.unseen = true;
      var r3 = Tasks.reply('nyx'); clearTimeout(r3.timer); r3.state = 'ended'; r3.status = 'error'; r3.step = 2; r3.unseen = true; r3.note = 'failed';
      Tasks.emit(null);
    }
  };
})();
