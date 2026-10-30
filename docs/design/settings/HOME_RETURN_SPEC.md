# Settings: Home return item (DD-210, DD-203, DD-239, DD-229)

Rev 1, 2026-10-28. Small item between slices 5b and 5c. Decisions: DD-203, DD-210, DD-229 and DD-239 in [../DECISIONS.md](../DECISIONS.md); DS-148 in [DECISIONS-settings.md](DECISIONS-settings.md).

## 0. Today (observed 2026-10-28 on the preview server)

- Home's links come from `home/nav.js` `Nav.href`. The base is `../settings/slice1.html`, and every link carries `from=home&lang=&mode=&return=<encoded ../home/home.html?…restore=1…>` plus extras:
  - persona: `page=persona`
  - models: `page=models`
  - prompts: `page=models&section=prompts`
  - settings: no page
  - repair: `page=display&fixture=all-modes-hidden-repair`
  Home also forwards `theme`, `lowpower`, `occasion` and similar keys.
- Settings already reads `from=home` (the Back label reads "홈으로 돌아가기" / "Back to Home") and `lang`.
- Back at the origin step shows the mockup's simulated origin stub. It never goes to `return` (`home/checks/return-probes.json`: `readsReturn:false`, "stayed on /settings/slice1.html").
- `slice1.html?page=persona` opens slice 1's placeholder persona page. The real one is in slice 5a. Home's reviewers saw the first heading, "Recent", which belongs to the hidden index.
- `section=prompts` is not a section id, so Settings shows "설정을 찾지 못했어요". The section exists as `models.prompt` ("프롬프트 설정" / "Prompt settings"), which matches Home's "Prompt settings" label.
- 5a 최근 삭제 › 영구 삭제 purges at once, with no confirm (DD-229 names this).

## 1. Stable entry page (DS-148)

- New `settings/index.html`. Before anything renders, it calls `location.replace('slice5b.html' + location.search + location.hash)`, so the query and hash are kept unchanged.
- It sets the target in one constant, so slice 5c later changes one line.
- It has a `<noscript>` link and the KO and EN title "설정 · Settings".
- It loads no other script and adds no history entry.
- Home changing `BASES.settings` to `../settings/index.html` is a Home-lane edit. Settings does not make it; the main session asks Home for it.

## 2. Return to Home (DD-210)

Applies to every slice, so it lives in `slice1.js`, the shared base.

- **Validation.** Accept `return` only when `from=home` and the raw (decoded) value starts with exactly `../home/home.html` or `../mockups/home.html`, followed by the end, `?` or `#`.
  - Additionally, `new URL(ret, location.href)` must be same-origin and its pathname must end in `/home/home.html` or `/mockups/home.html`.
  - Reject anything with a scheme, `//`, a backslash, control characters or whitespace, or an encoded slash or dot segment in the path part.
  - A rejected value behaves as if absent, with a `console.warn` naming the rule. Never echo it into the DOM.
- **Back.** When the Back chain reaches the origin step (`goBack` would return `'origin'`) and a valid `return` exists, navigate with `location.assign(returnUrl)`. Use the value as given and keep `restore=1`. Do not read, write or clear `sessionStorage` `nexus-home-handoff`; that is Home's.
  - This applies equally to the Back button, Esc at the root, the mouse back button and the browser back (popstate) that ends at the origin.
  - The inner steps are unchanged. Dialog, menu, slice-2 sub-states, jump return, search results and the phone page → index step still come first.
- **No return or invalid return.** Today's behaviour stays: the simulated origin stub.
- **Label.** Unchanged: "홈으로 돌아가기" / "Back to Home", visible "홈" / "Home".
- **Unsaved state.** Slice 2's `X.closing` veto (a failed save) still blocks leaving; the navigation happens only if closing would have succeeded.
- **`lang`.** Already read. Keep the html `lang` and the title in sync (the probe saw this pass). `mode` is accepted and ignored.
- **Phone.** An open page goes Back to the index first (unchanged), then to Home.

## 3. `section=prompts` (DD-239)

- Add a section alias map in the deep-link step: `prompts` → `models.prompt`. Accept it with or without `page=models`.
- The page opens and scrolls to "프롬프트 설정" exactly as `section=models.prompt` would.
- Other unknown sections still show the not-found notice.
- Only Home's documented alias is added; no other aliases.

## 4. Purge confirm (DD-229)

- 5a 최근 삭제 › 영구 삭제 opens one confirm dialog (the existing `openDialog` pattern; Cancel focused, Esc cancels). It names the item, the count and the total size:
  - KO: "‘{name}’을(를) 영구 삭제할까요?" with the body "항목 1개 · {size}. 되돌릴 수 없어요."
  - EN: "Delete ‘{name}’ for good?" with the body "1 item · {size}. This can't be undone."
  - Use the existing Korean particle helpers, not "을(를)".
  - The confirm button is the danger style, with a lucide `trash-2` icon plus text.
- Sizes are synthetic fixture values (persona with image ≈ 180 KB, plugin ≈ 40 KB, module ≈ 12 KB), formatted with the existing number helpers. Each value carries a `// synthetic` comment.
- On confirm, the current purge runs, with its toast and with the undo step taken with it (R5-8a).
- If 최근 삭제 has a "purge all" action, it confirms with the total count and size. If it doesn't, don't add one.
- "되돌릴 수 없어요" is correct here, because purge removes the undo step.

## 5. Out of scope (report, do not do)

- Home's `settingsRepair` link (`page=display&fixture=all-modes-hidden-repair`). That fixture belongs to the older `mockups/settings.html`; `settings/` has no such fixture. It is left for slice 5c or a main-session decision.
- DD-223 (one 10 s undo window), DD-228 (`.bin` / `.rtb`) and the patterns/ adoption: queued separately.

## 6. Checks

New suite `hr` in `checks/run.mjs`, under `checks/hr/`. Run with `--jobs 3`, one suite at a time, with a distinct `--tag` and a log in `checks/logs/`. Start no other servers; use http://localhost:6141/.

1. `index.html` forwards to `slice5b.html` with the query and hash intact, adding no history entry (`history.length` unchanged).
2. Each Home link shape opens the right place in KO and EN, at desktop 1280 and phone 375:
   - persona → the 5a persona page;
   - models → 모델;
   - prompts → "프롬프트 설정", focused heading in view;
   - settings with no page → Settings index or default page, as today.
3. Back with a valid return:
   - by button, Esc, mouse back and popstate, at desktop and phone, each reaches the return URL with the query (including `restore=1`) unchanged;
   - a phone page goes to the index first;
   - from=home without `return` shows the stub;
   - `nexus-home-handoff` in sessionStorage is untouched (set a sentinel, check it is still there).
4. Rejection table: each of the following stays on Settings, shows the stub at origin, logs a warning and puts nothing in the DOM:
   - `https://evil.example/home/home.html`
   - `//evil.example/home/home.html`
   - `/home/home.html`
   - `../home/home.html.evil`
   - `../home/x.html`
   - `..%2Fhome%2Fhome.html` double-encoded
   - `..\home\home.html`
   - `javascript:…`
   - `../home/home.html` with `from=chat`
   - `../home/../home/home.html`
5. `section=prompts` with and without `page=models`; `section=nope` still shows the notice.
6. Purge confirm:
   - KO and EN text and particles;
   - Cancel focused; Esc and Cancel keep the item;
   - Confirm purges with the toast;
   - focus returns sensibly;
   - axe-style checks for the name, role and dialog labelling as in the earlier suites;
   - reduced motion.
7. Regression, one at a time: ss1, ss2, ss3 (`--instant-scroll` where the suite needs it, as before), ss4, ss5a, ss5b, th, th4, th5a, th5b. Update existing assertions only where this item changes the behaviour (the 5a purge test), and list each one changed.

Record the results in `checks/builder-checks-hr.md`, with what was not checked.

## Build notes

Built 2026-10-28. Details, results per suite and logs: [checks/builder-checks-hr.md](checks/builder-checks-hr.md).

- **Files.** New `index.html` and `checks/hr/**`; changed `slice1.js` (return validation, `closeSettings({home})`, alias, dialog button `icon`), `slice5a.js` (`confirmPurge`), `data5a.js` (copy and `TRASH_KB`), `checks/run.mjs` (suite `hr`), `checks/ss5a/persona.mjs` (the purge test now confirms).
- **Return.** The trip goes through `closeSettings({ home: true })`, so slice 2's failed-save veto is honoured. If it vetoes, the trip is held (`S.homePending`) and the guard's 버리기 or a finished retry then goes home; cancelling the guard or any later Back forgets it. Going home unwinds first (see "Build notes: fix round 1").
- **Phone.** The visible "홈" is the header subtitle; the button's accessible name is "홈으로 돌아가기" at the index and "설정 메뉴로 돌아가기" while a page is open.
- **Copy.** The mockup's not-found notice is "찾는 설정이 없어요", not the "설정을 찾지 못했어요" quoted in section 0. Particles use slice 2's `josa` (it reads Latin names), with `pEul` as fallback.
- **Open for the main session.** Home's `BASES.settings` change to `../settings/index.html` (Home lane); `settingsRepair` (section 5); `?section=constructor` / `__proto__` open the page without a notice (pre-existing prototype lookup in `SEC[section]`, one `hasOwnProperty` away); 42 + 2 + 2 + 2 th failures that come from other lanes' uncommitted token and pack edits (see the builder-checks file).

### Build notes: fix round 1

Detail in [checks/builder-checks-hr.md](checks/builder-checks-hr.md). hr 129/129; ss1 to ss5b green; th suites not run.

- **Going Home (DS-149).** `goHome()` calls `history.back()` for Settings own pushed entry, waits for the popstate (400 ms timeout fallback), then `location.replace(returnUrl)`; the popstate source replaces at once. Browser Back from Home reaches the page before Settings. This supersedes the earlier "no `history.back()`" note.
- **Ctrl+S (DS-150)** unchanged: it toggles the stand-in stub.
- **Sections (DS-151).** A known section (alias included) opens its own page whatever `page=` says. Page, section and row lookups are own-property, so `constructor`, `__proto__` and `toString` show the notice; this closes the `constructor` item listed under "Open for the main session" above.
- **Purge confirm.** Sizes are per item and read "약 N KB" / "about N KB". Confirm returns to the 최근 삭제 list when items remain (focus on the next item); with none left, focus goes to the toolbar button. The noscript link on `index.html` carries no query and says so.
