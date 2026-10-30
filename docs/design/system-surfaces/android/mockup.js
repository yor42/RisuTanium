/* Android system surfaces mockup. Synthetic data, no network, no storage. */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- Copy (SPEC §3 tables, §5.2, §9) ---------------- */
  const APP = 'Risutanium'; // shipped Android app_name (lowercase t)
  const TXT = {
    en: {
      char: 'Seraphina', chat: 'Moonlit library', stop: 'Stop',
      preview: 'The lanterns flickered as she turned the page and whispered about the old map hidden between the shelves, then smiled.',
      numbers: (n, r) => `${n} tokens · ${r} tok/s`,
      hint: 'Notifications are off, so background replies have no Stop button in the notification shade. [Open settings]',
      quitNew: 'Press Back again to quit', quitCur: 'Press the Back button once more to quit.',
      states: {
        generating: ['Generating a reply…', null], speaking: ['Reading the reply aloud', null],
        image: ['Generating an image…', null], translating: ['Translating…', null], other: ['Working…', null],
        stopping: ['Stopping…', null], failed: ['Reply failed', 'Open the app to see why.'], stopped: ['Stopped', null]
      }
    },
    ko: {
      char: '세라피나', chat: '달빛 도서관', stop: '중지',
      preview: '등불이 일렁이자 그녀는 책장을 넘기며 서가 사이에 숨겨진 오래된 지도에 대해 낮게 속삭였다.',
      numbers: (n, r) => `${n}토큰 · 초당 ${r}토큰`,
      hint: '알림이 꺼져 있어 백그라운드 답변을 알림창에서 중지할 수 없습니다. [설정 열기]',
      quitNew: '종료하려면 뒤로 가기를 한번 더 누르세요', quitCur: "'뒤로' 버튼을 한 번 더 누르면 종료됩니다.",
      states: {
        generating: ['답변 생성 중…', null], speaking: ['답변 읽는 중', null],
        image: ['이미지 생성 중…', null], translating: ['번역 중…', null], other: ['작업 중…', null],
        stopping: ['중지하는 중…', null], failed: ['답변 생성 실패', '앱을 열어 확인하세요.'], stopped: ['중지됨', null]
      }
    }
  };

  /* Gallery order. base = key into TXT.states; stop = Stop action; chrono = 'run' | 'hidden'. */
  const GALLERY = [
    { id: 'generating', base: 'generating', stop: true, chrono: 'run', cap: 'Generating, chronometer' },
    { id: 'generating-bar', base: 'generating', stop: true, chrono: 'run', bar: true, cap: 'Generating, chronometer + indeterminate bar', d: 'D-5' },
    { id: 'speaking', base: 'speaking', stop: true, chrono: 'run', cap: 'Speaking, chronometer restarts' },
    { id: 'image', base: 'image', stop: false, chrono: 'run', cap: 'Image, no action' },
    { id: 'translating', base: 'translating', stop: false, chrono: 'run', cap: 'Translating, no action' },
    { id: 'other', base: 'other', stop: false, chrono: 'run', cap: 'Other work, no action' },
    { id: 'stopping', base: 'stopping', stop: false, chrono: 'hidden', cap: 'Stopping, time hidden, Stop returns after 10 s' },
    { id: 'failed', base: 'failed', stop: false, chrono: 'hidden', cap: 'Failed (2 s linger), chronometer hidden' },
    { id: 'stopped', base: 'stopped', stop: false, chrono: 'hidden', cap: 'Stopped (2 s linger after user Stop), time hidden' }
  ];
  const BY_ID = Object.fromEntries(GALLERY.map(s => [s.id, s]));
  const PROMOTED = new Set(['generating', 'generating-bar', 'speaking']); // SPEC §5.3

  /* ---------------- Variant state (query params, SPEC task item 7) ---------------- */
  const q = new URLSearchParams(location.search);
  const flag = k => q.get(k) === '1';
  // Decided defaults (DD-003, DD-004): on unless the query turns them off.
  const flagOn = k => q.get(k) !== '0';
  const v = {
    lang: q.get('lang') === 'ko' ? 'ko' : 'en',
    theme: q.get('theme') === 'light' ? 'light' : 'dark',
    platform: ['10', '12', '16'].includes(q.get('platform')) ? q.get('platform') : '12',
    width: q.get('width') === '360' ? '360' : '412',
    identity: flagOn('identity'), subtext: flag('subtext'), preview: flag('preview'), numbers: flagOn('numbers'),
    lock: flag('lock'), denied: flag('denied'),
    lockstop: ['keep', 'unlock', 'remove'].includes(q.get('lockstop')) ? q.get('lockstop') : 'unlock', // D-13
    state: BY_ID[q.get('state')] ? q.get('state') : null,
    freeze: flag('freeze')
  };

  /* ---------------- Clocks (1 Hz) ---------------- */
  const t0 = performance.now();
  const galleryElapsed = () => (v.freeze ? 12 : 12 + Math.floor((performance.now() - t0) / 1000));
  const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const tokens = () => 312 + (v.freeze ? 0 : (galleryElapsed() - 12) * 24);
  const elapsedLabel = s => (v.lang === 'ko' ? `경과 시간 ${fmt(s)}` : `Elapsed ${fmt(s)}`);
  const timeEl = (clock, s, cls) => `<time class="${cls || 'nchrono'}" data-clock="${clock}" aria-label="${elapsedLabel(s)}">${fmt(s)}</time>`;

  /* ---------------- Card builder ---------------- */
  const smallIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#stat" width="24" height="24"/></svg>';
  const avatar = '<svg viewBox="0 0 48 48" aria-hidden="true"><use href="#avatar" width="48" height="48"/></svg>';

  /* ctx: { clock: 'g' | 's', elapsed(): number, onStop?: fn, pub?: boolean (public/lock version), noStop?: boolean } */
  function buildCard(spec, ctx) {
    const L = TXT[v.lang];
    const [stTitle, stText] = L.states[spec.base];
    const pub = !!ctx.pub;                     // public version: SPEC §4
    // Identity belongs to a reply (SPEC §6): never on image, translate or other work.
    const replyState = !['image', 'translating', 'other'].includes(spec.base);
    const identity = v.identity && !pub && replyState;
    const sub = v.subtext && !pub && replyState ? L.chat : null;
    const title = identity ? L.char : stTitle;
    // With identity on the state title moves into the text line (D-1); the Failed hint is appended.
    const text = identity ? [stTitle, stText].filter(Boolean).join(' · ') : (pub ? null : stText);
    const showNumbers = v.numbers && !pub && spec.base === 'generating';
    const showPreview = v.preview && !pub && (spec.base === 'generating' || spec.base === 'speaking');
    // Stop in the public version follows D-13; Android 10 cannot require unlock, so it falls back to Keep.
    const stop = spec.stop && !ctx.noStop && !(pub && v.lockstop === 'remove');

    const art = document.createElement('article');
    art.className = `ncard p${v.platform}`;
    art.setAttribute('aria-label', `Risutanium: ${title}`);

    const chrono = spec.chrono === 'run' ? `<span class="sep" aria-hidden="true">·</span>${timeEl(ctx.clock, ctx.elapsed())}` : '';
    let html = `<div class="nhead"><span class="nicon">${smallIcon}</span><span class="napp">${APP}</span>` +
      (sub ? `<span class="sep" aria-hidden="true">·</span><span class="nsub">${sub}</span>` : '') + chrono + '</div>';
    html += '<div class="nbody"><div class="ntext">' +
      `<div class="ntitle">${title}</div>` + (text ? `<div class="nline">${text}</div>` : '') +
      (showNumbers ? `<div class="nline sm" data-numbers>${L.numbers(tokens(), 24)}</div>` : '') +
      (showPreview ? `<div class="nline sm">${L.preview}</div>` : '') + '</div>' +
      (identity ? `<div class="nlarge">${avatar}</div>` : '') + '</div>';
    if (spec.bar && !pub) html += '<div class="nbar" role="progressbar" aria-label="Indeterminate progress"></div>';
    if (stop) html += `<div class="nactions"><button type="button" class="nstop">${L.stop}</button></div>`;
    art.innerHTML = html;

    const btn = $('.nstop', art);
    if (btn) btn.addEventListener('click', () => {
      if (pub && v.lockstop === 'unlock' && v.platform !== '10') { lockMsg(ctx); return; }
      (ctx.onStop || galleryStop)();
    });
    return art;
  }

  function lockMsg(ctx) {
    const msg = 'Unlock to stop (simulated). Android 12+ would show the keyguard before stopping.';
    $(ctx.clock === 's' ? '#story-status' : '#gallery-status').textContent = msg;
  }
  function galleryStop() {
    $('#gallery-status').textContent = 'Stop tapped (simulated). In the real service this switches to Stopping; try the storyboard below.';
  }

  /* Wraps a card with the Android 16 chip row when applicable. */
  function cell(spec, ctx, showCaption) {
    const wrap = document.createElement('div');
    wrap.className = 'ncell';
    if (showCaption) {
      const cap = document.createElement('p');
      cap.className = 'ncap';
      cap.innerHTML = `<span>${spec.cap}</span>` + (spec.d ? `<span class="dbadge">${spec.d}</span><span class="dbadge">decided off DD-004</span>` : '');
      wrap.appendChild(cap);
    }
    if (v.platform === '16') {
      const row = document.createElement('div');
      row.className = 'chiprow';
      if (PROMOTED.has(spec.id) && !ctx.noStop) {
        row.innerHTML = `<span class="statusbar"><span class="chip" role="img" aria-label="Status bar chip: small icon and elapsed time"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#stat" width="24" height="24"/></svg><time data-clock="${ctx.clock}" aria-label="${elapsedLabel(ctx.elapsed())}">${fmt(ctx.elapsed())}</time></span></span><span class="note">Status-bar chip (max 96 dp)</span>`;
      } else {
        row.innerHTML = '<span class="note">Not promoted (no status-bar chip): only Generating and Speaking request it.</span>';
      }
      wrap.appendChild(row);
    }
    wrap.appendChild(buildCard(spec, ctx));
    return wrap;
  }

  /* ---------------- Gallery render ---------------- */
  function makeShade(label, pub) {
    const s = document.createElement('div');
    s.className = 'shade';
    s.dataset.theme = v.theme;
    if (pub) {
      s.classList.add('lock');
      const clk = document.createElement('div');
      clk.className = 'lock-clock';
      clk.innerHTML = '<b>9:41</b><span>Sat, Oct 25</span>';
      s.appendChild(clk);
    }
    if (label) s.setAttribute('aria-label', label);
    s.setAttribute('role', 'region');
    return s;
  }
  function renderGallery() {
    const set = $('#shade');
    set.innerHTML = '';
    set.classList.toggle('pair', v.lock && !v.denied);
    const list = v.state ? [BY_ID[v.state]] : GALLERY;
    const make = (label, pub) => {
      const col = document.createElement('div');
      col.className = 'shade-item';
      if (v.lock && !v.denied) { const h = document.createElement('h3'); h.className = 'shade-label'; h.textContent = label; col.appendChild(h); }
      const s = makeShade(`${label} (illustration)`, pub);
      if (v.denied) {
        const e = document.createElement('div');
        e.className = 'empty-shade';
        e.textContent = 'No notifications';
        s.appendChild(e);
      } else {
        const ctx = { clock: 'g', elapsed: galleryElapsed, pub };
        list.forEach(st => s.appendChild(cell(st, ctx, true)));
      }
      col.appendChild(s);
      set.appendChild(col);
    };
    if (v.lock && !v.denied) { make('Unlocked / full', false); make('Lock screen / public', true); }
    else make(v.lock ? 'Lock screen / public' : 'Notification shade', v.lock);
  }

  function renderNotes() {
    const n = $('#gallery-notes');
    const plat = {
      10: 'Android 10 (One UI 2-like): app name tinted with the accent, text-only actions.',
      12: 'Android 12+: small icon in an accent circle at left, rounder card, text actions.',
      16: 'Android 16 Live Update: expanded card plus a status-bar chip (small icon + elapsed time) for Generating and Speaking only.'
    }[v.platform];
    let html = `<div class="note-box"><h3>Current view</h3><p>${plat}</p>` +
      `<p>Brand <code>#587BFF</code> is passed to setColor. Chronometer counts up in the system; it is hidden in Stopping, Stopped and Failed.</p>` +
      (v.platform === '16' ? '<p><span class="dbadge">D-12</span> <span class="dbadge">deferred DD-010</span> Live Updates stay off until the Tab S9 check and a policy call.</p>' : '') + '</div>';
    if (v.lock) html += '<div class="note-box"><h3>Lock screen (SPEC §4)</h3><p>Public version: small icon and the state title only. No character or chat name, no avatar, no reply preview or numbers. Chronometer kept. Stop follows D-13 (control above). The full version is shown beside it for comparison.</p></div>';
    if (v.lock && v.lockstop === 'unlock' && v.platform === '10') html += '<div class="note-box"><p><strong>Require unlock is not available on Android 10, falls back to Keep.</strong></p></div>';
    if (v.denied) {
      html += '<div class="note-box"><h3>Permission denied (Android 13+, SPEC §5.2)</h3>' +
        '<p>The shade shows nothing. The service still runs; the work appears only in the system Task Manager (which ends the app), and the in-app Stop remains.' +
        (v.platform === '10' ? ' Note: Android 10 has no runtime notification permission, so this state only applies on Android 13+.' : '') + '</p>' +
        '<p class="hint-row"><strong>Proposed Settings hint <span class="dbadge">D-9</span> <span class="dbadge">decided DD-009</span></strong></p>' +
        `<p lang="en">EN: ${TXT.en.hint}</p><p lang="ko">KO: ${TXT.ko.hint}</p></div>`;
    }
    n.innerHTML = html;
  }

  /* ---------------- Storyboard ---------------- */
  const sb = { key: null, start: 0, timers: [], seq: null, fail: false, noTake: false, linger: false, prev: 'generating', noStop: false };
  const sbElapsed = () => (sb.start ? Math.floor((performance.now() - sb.start) / 1000) : 0);
  const STEPS = {
    stop: ['Generating (chronometer counts up, Stop shown)', 'Tap Stop: Stopping (time hidden, Stop removed)', 'Work ends: Stopped (or Failed), 2 s linger', 'Notification disappears'],
    speak: ['Generating (3 s)', 'Speaking (chronometer restarts)', 'Speaking title stays for the 2 s linger (no Done state)', 'Notification disappears']
  };

  function sbClear() { sb.timers.forEach(t => { clearTimeout(t); clearInterval(t); }); sb.timers = []; $('#story-note').textContent = ''; }
  function sbAfter(ms, fn) { sb.timers.push(setTimeout(fn, ms)); }
  function setStep(i, msg) {
    $$('#steps li').forEach((li, n) => (n === i ? li.setAttribute('aria-current', 'step') : li.removeAttribute('aria-current')));
    if (msg) $('#story-status').textContent = msg;
  }
  function showSb(id, noStop) {
    sb.key = id;
    sb.noStop = !!noStop;
    renderStory();
  }
  function renderStory() {
    const shade = $('#story-shade');
    shade.dataset.theme = v.theme;
    shade.classList.toggle('lock', v.lock);
    const slot = $('#story-slot');
    slot.innerHTML = '';
    if (v.denied) { slot.innerHTML = '<div class="empty-shade">No notifications (permission denied)</div>'; return; }
    if (!sb.key) { slot.innerHTML = '<div class="gone">No notification yet</div>'; return; }
    if (sb.key === 'gone') { slot.innerHTML = '<div class="gone">Notification removed</div>'; return; }
    const ctx = { clock: 's', elapsed: sbElapsed, onStop: sbStop, pub: v.lock, noStop: sb.noStop };
    slot.appendChild(cell(BY_ID[sb.key], ctx, false));
  }
  function sbStart(seq) {
    sbClear();
    sb.seq = seq;
    sb.linger = false;
    $('#steps').innerHTML = STEPS[seq].map(s => `<li>${s}</li>`).join('');
    sb.start = performance.now();
    showSb('generating');
    if (seq === 'stop') {
      setStep(0, 'Generating. Tap Stop in the notification.');
    } else {
      setStep(0, 'Generating for 3 s.');
      sbAfter(3000, () => { sb.start = performance.now(); showSb('speaking'); setStep(1, 'Speaking. The chronometer restarted at 0:00.'); });
      sbAfter(6000, () => {
        // Normal completion: the last title simply stays for the linger, then the card goes.
        sb.linger = true;
        showSb('speaking', true);
        setStep(2, 'Work ended. Speaking title stays for the 2 s linger.');
      });
      sbAfter(8000, () => sbGone());
    }
  }
  function sbGone() { sb.linger = false; showSb('gone'); setStep(3, 'Notification removed.'); }
  function sbStop() {
    if (sb.key === 'stopping' || sb.key === 'gone' || sb.linger) return;
    sbClear();
    sb.prev = sb.key;
    showSb('stopping');
    setStep(1, 'Stopping. The Stop action is gone, so it cannot be tapped twice.');
    $('#story-slot').focus();
    if (!sb.noTake) {
      sbAfter(1500, () => sbEndStopped());
      return;
    }
    // "Abort does not take": after 10 s the Stop action returns (SPEC §3.3).
    let left = 10;
    const note = $('#story-note');
    const upd = () => { note.textContent = `Abort did not take: Stop returns in ${left} s.`; };
    upd();
    sb.timers.push(setInterval(() => { left -= 1; if (left > 0) upd(); }, 1000));
    sbAfter(10000, () => {
      sb.timers.forEach(clearInterval);
      note.textContent = 'Timeout reached: previous state restored with its Stop action.';
      showSb(sb.prev);
      setStep(0, 'Stopping timed out after 10 s; Stop is back.');
    });
  }
  function sbEndStopped() {
    sb.linger = true;
    showSb(sb.fail ? 'failed' : 'stopped');
    setStep(2, sb.fail ? 'Reply failed, lingering for 2 s.' : 'Stopped, lingering for 2 s.');
    sbAfter(2000, sbGone);
  }

  /* ---------------- Launcher ---------------- */
  const MASKS = [['m-circle', 'Circle'], ['m-squircle', 'Squircle'], ['m-round', 'Rounded square']];
  function launcherItem(inner, mask, size, label, style) {
    return `<div class="l-item"><span class="licon ${mask} s${size}"${style ? ` style="${style}"` : ''}>${inner}</span><span>${label} ${size}px</span></div>`;
  }
  const adaptiveSvg = '<svg viewBox="18 18 72 72" aria-hidden="true"><use href="#adaptive" width="108" height="108"/></svg>';
  const monoSvg = '<svg viewBox="18 18 72 72" aria-hidden="true"><use href="#mono" width="108" height="108"/></svg>';
  const pngImg = '<img src="../reference/current-ic_launcher-xxxhdpi.png" alt="" width="192" height="192">';

  function renderLauncher() {
    const g = $('#launcher-grid');
    const rows = (inner, style) => MASKS.map(([m, n]) =>
      `<div class="l-row">${launcherItem(inner, m, 72, n, style)}${launcherItem(inner, m, 48, n, style)}</div>`).join('');
    g.innerHTML =
      `<section class="l-card" aria-label="Current legacy icon"><h3>Current (legacy PNG, xxxhdpi)</h3><div class="l-rows">${rows(pngImg)}</div></section>` +
      `<section class="l-card" aria-label="Proposed adaptive icon"><h3>Proposed adaptive (teal to blue, white mark)</h3><div class="l-rows">${rows(adaptiveSvg)}</div></section>` +
      `<section class="l-card" aria-label="Themed monochrome icon"><h3>Proposed themed monochrome (Android 13+)</h3>` +
      `<div class="wp light"><div class="l-rows">${rows(monoSvg, 'background:#c3d0f6;color:#1d3a9e')}</div></div>` +
      `<div class="wp dark" style="margin-top:10px"><div class="l-rows">${rows(monoSvg, 'background:#34406b;color:#dbe4ff')}</div></div></section>`;
  }

  /* ---------------- Splash ---------------- */
  const SPLASH = [
    { id: 'cur-day', label: 'Current, light', seq: ['#3B82F6', '#101828', '#00011C'] },
    { id: 'cur-night', label: 'Current, night', seq: ['#282A36', '#101828', '#00011C'] },
    { id: 'new', label: 'Proposed (D-10)', seq: ['#00011C', '#00011C', '#00011C'] }
  ];
  const PHASES = ['splash (white mark)', 'loading background', 'boot screen'];
  let splashTimers = [];
  function renderSplash() {
    $('#splash-row').innerHTML = SPLASH.map(s =>
      `<figure class="sp-fig"><div class="sp-phone ${reduced() ? '' : 'fade'}" id="sp-${s.id}" style="background:${s.seq[0]}" role="img" aria-label="${s.label} phone frame">` +
      `<span class="sp-mark"><svg viewBox="18 30 72 62" aria-hidden="true"><use href="#mark108" width="108" height="108"/></svg></span><span class="sp-boot" hidden>boot screen</span></div>` +
      `<figcaption>${s.label}<br><span class="sp-hex" id="hex-${s.id}">${s.seq[0]}</span></figcaption></figure>`).join('');
  }
  function setSplash(i) {
    SPLASH.forEach(s => {
      const el = $('#sp-' + s.id);
      el.style.background = s.seq[i];
      $('.sp-mark', el).hidden = i !== 0;
      $('.sp-boot', el).hidden = i !== 2;
      $('#hex-' + s.id).textContent = s.seq[i];
    });
    $('#splash-status').textContent = `Phase ${i + 1} of 3: ${PHASES[i]}.`;
  }
  function replaySplash() {
    splashTimers.forEach(clearTimeout);
    renderSplash();
    setSplash(0);
    splashTimers = [setTimeout(() => setSplash(1), 900), setTimeout(() => setSplash(2), 1800)];
  }

  /* ---------------- Back / quit toast ---------------- */
  const QUIT_WINDOW_MS = 2000;
  const quit = { open: false, t: 0, timer: null, tick: null, curAnim: null, newAnim: null };
  function pressBack() {
    const status = $('#toast-status');
    if (quit.open) {
      endWindow();
      status.textContent = 'Second press inside the window: Quit (simulated). The app would exit here.';
      return;
    }
    quit.open = true;
    quit.t = performance.now();
    status.textContent = 'First press: quit window open for 2 s. Press Back again to quit.';
    const L = TXT[v.lang];
    const cur = $('#toast-cur'), nu = $('#toast-new-inner');
    cur.textContent = L.quitCur;
    $('#toast-new-text').textContent = L.quitNew;
    nu.hidden = false;
    // Current: AlertComp's toastAnime, 0 → 1 at 0.5 s → 0 at 1 s with no hold, inside a 2 s window (the mismatch this mockup shows).
    quit.curAnim && quit.curAnim.cancel();
    quit.curAnim = cur.animate([{ opacity: 0, offset: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 1 }], { duration: 1000, easing: 'ease-out', fill: 'forwards' });
    // Proposed: 150 ms in, hold, 200 ms out ending at 2000 ms. Reduced motion = opacity only.
    const rise = reduced() ? 'none' : 'translateY(8px)';
    const k = [
      { opacity: 0, transform: rise, offset: 0 },
      { opacity: 1, transform: 'none', offset: 150 / QUIT_WINDOW_MS },
      { opacity: 1, transform: 'none', offset: (QUIT_WINDOW_MS - 200) / QUIT_WINDOW_MS },
      { opacity: 0, transform: 'none', offset: 1 }
    ];
    quit.newAnim && quit.newAnim.cancel();
    quit.newAnim = nu.animate(k, { duration: QUIT_WINDOW_MS, easing: 'linear', fill: 'forwards' });
    quit.timer = setTimeout(() => {
      endWindow();
      status.textContent = 'Quit window closed after 2 s. The next Back press starts a new window.';
    }, QUIT_WINDOW_MS);
    clearInterval(quit.tick);
    quit.tick = setInterval(() => {
      const p = Math.min(1, (performance.now() - quit.t) / QUIT_WINDOW_MS);
      $('#tl-window').style.width = `${p * 100}%`;
    }, 100);
  }
  function endWindow() {
    quit.open = false;
    clearTimeout(quit.timer);
    clearInterval(quit.tick);
    $('#tl-window').style.width = '0';
    if (quit.curAnim) quit.curAnim.cancel();
    if (quit.newAnim) quit.newAnim.cancel();
    $('#toast-new-inner').hidden = true;
    $('#toast-cur').style.opacity = 0;
  }

  /* ---------------- Controls ---------------- */
  function syncControls() {
    $$('[data-set]').forEach(b => b.setAttribute('aria-pressed', String(v[b.dataset.set] === b.dataset.val)));
    $$('[data-toggle]').forEach(b => b.setAttribute('aria-pressed', String(!!v[b.dataset.toggle])));
    document.documentElement.lang = v.lang;
    $('#lockstop-grp').hidden = !v.lock;
    $('#lockstop-note').hidden = !(v.lock && v.lockstop === 'unlock' && v.platform === '10');
    document.documentElement.style.setProperty('--shade-w', v.width + 'px');
    const hint = $('#state-hint');
    hint.hidden = !v.state;
    hint.textContent = v.state ? `Showing only the "${v.state}" state (?state=). Remove the parameter to see all states.` : '';
  }
  function renderAll() {
    syncControls();
    renderGallery();
    renderNotes();
    renderStory();
  }
  $$('[data-set]').forEach(b => b.addEventListener('click', () => { v[b.dataset.set] = b.dataset.val; renderAll(); }));
  $$('[data-toggle]').forEach(b => b.addEventListener('click', () => { v[b.dataset.toggle] = !v[b.dataset.toggle]; renderAll(); }));
  $('#play-stop').addEventListener('click', () => sbStart('stop'));
  $('#play-speak').addEventListener('click', () => sbStart('speak'));
  $('#story-fail').addEventListener('click', e => {
    sb.fail = !sb.fail;
    e.currentTarget.setAttribute('aria-pressed', String(sb.fail));
  });
  $('#story-notake').addEventListener('click', e => {
    sb.noTake = !sb.noTake;
    e.currentTarget.setAttribute('aria-pressed', String(sb.noTake));
  });
  $('#splash-replay').addEventListener('click', replaySplash);
  $('#press-back').addEventListener('click', pressBack);

  /* 1 Hz: update chronometers and live numbers in place, so bar animation and focus are untouched. */
  function tick() {
    $$('time[data-clock]').forEach(el => { const s = el.dataset.clock === 'g' ? galleryElapsed() : sbElapsed(); el.textContent = fmt(s); el.setAttribute('aria-label', elapsedLabel(s)); });
    $$('[data-numbers]').forEach(el => { el.textContent = TXT[v.lang].numbers(tokens(), 24); });
  }
  if (!v.freeze) setInterval(tick, 1000);

  renderLauncher();
  renderSplash();
  setSplash(0);
  renderAll();
  $('#steps').innerHTML = STEPS.stop.map(s => `<li>${s}</li>`).join('');
})();
