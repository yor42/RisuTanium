# UI-S1 cross-mode seam note (2026-11-02)

Status: input to UI-S1 sizing. This is not a design, a plan, a decision or a Gate verdict. It holds questions and constraints only (MC-1002). Nothing here authorizes application code.

Serves: MC-1002 (one bounded note, six seams), MC-1003 (Back decided at UI-S1 sizing), MC-1004 (consumer plan names the default), MC-1005 (store2-first sizing assumption), with MC-890, MC-892, MC-774, MC-350.
Snapshot: main `8015ba56e`. The working tree has unrelated dirty files. Citations are `file:line` at that HEAD unless marked otherwise.
Gate: UI-S1 stays behind CHORE-205 (the MC-516 gate; the ruling is still owed). Each UI batch asks at most 10 new maintainer questions (MC-890 item 3).
Confidence: observations come from an evidence packet read-only pass. Items marked INFERRED or UNKNOWN are not confirmed.

## 1. Navigation ownership

What exists:
- Screens switch by store flags in `src/App.svelte:205-234` (`settingsOpen`, `MobileGUI`, `gridOpen`, `selectedCharID`). There are no routes.
- Utility is a flag (`utilityOpen`/`utilityVisible`) inside `DefaultChatScreen.svelte:570`.
- Deep links use URL parameters only, cleared after reading (`characterCards.ts:918-1023`).

Settled:
- MC-1003: one Back mechanism for all new screens and Android is decided at UI-S1 sizing. Nothing else in MC-892 changes.
- MC-892 item 3: one mechanism for new screens and Android.
- MC-890 item 4: each surface batch migrates its own call sites. In-app switch per surface, no long-lived branch.
- DD-008 (the root Back toast) exists as a design spec.

Open questions for UI-S1 sizing:
- Q1.1 Who owns mode switching (Chat, Utility, Workspace), and does it survive Back from the root?
- Q1.2 Does the existing alert-first rule stay above any new layer? If yes, new containers (seam 3) must be classified in `ALERT_BACK_ACTIONS`.
- Q1.3 Utility has no Back handler today (see section 7). Does UI-S1 inherit that gap or fix it?
- The Back mechanism itself is section 7.

Stays open on purpose: Workspace navigation and mode content.

Carried check: UI-S0's focus, inert, capture-phase Escape and arm-delay checks run at the first mounting batch, UI-S1 (Roadmap.md:224, MC-921). Escape and Back share the `alertEscape` and `alertBack` paths.

## 2. Renderer and composer

What exists:
- Chat messages: `src/lib/ChatScreens/{Chats,Chat,Message,ChatBody}.svelte`. Composer: `DefaultChatScreen.svelte`.
- Utility has its own renderer and composer. Turns are plain text, "never parsed as markup" (`UtilityScreen.svelte:140-155`, comment at 145). It uses a plain textarea with Send/Stop (158-164). History lives in `utilityConversation` and is not persisted (`notSavedNote`, line 137).
- Nothing is shared with the chat renderer (INFERRED from the imports at `UtilityScreen.svelte:29-44`).

Settled:
- UI-S1 is the chat shell (Roadmap.md:225). Acceptance covers CHORE-155, CHORE-482 and CHORE-168 (Continue Response). It absorbs CHORE-154 item 5. CHORE-323 folds in (proposed).
- MC-1004: for CHORE-568 the consumer plan names the default when the setter is missing (the package's example: field absent means off; a plan item, not a recorded product decision).

Open questions:
- Q2.1 Is the UI-S1 message renderer a component fed by plain data (role, text, state, error) that Utility could use later, or is it chat-specific? Sharing means it must not assume a character or chat store. Chat-specific means Utility keeps its own and UI-S4 migrates it separately.
- Q2.2 Same question for the composer. Send/Stop states mirror chat, but cancellation semantics differ (proposal N2).
- Q2.3 Does the renderer parse markup? Chat does; Utility deliberately does not. A shared renderer needs a plain mode or Utility output gets parsed.

Stays open: tool-call rendering and artifact views.

## 3. Status and approval containers

What exists:
- Approvals are `alertConfirm` (`alert.ts:292`) with the `mcpAccessPrompt` text "{{tool}} is trying to ... Do you want to allow this?" (`en.ts:1994`). It does not say who asked.
- Toasts are `alertToast` (`alert.ts:237`). Notice, prompt, wait and toast share one slot on the single `alertStore` (`alertData['type']`).
- UI-S0 added `PatternDialog`, `PatternWarning` and `PatternPrompt` (`src/lib/Nexus/pattern/*`). They are mounted nowhere.

Settled:
- Critical surfaces take tokens only and carry `data-part-critical` (THEMING.md:11). Protected surfaces stay opaque and readable. Selectors naming no part cannot restyle or resize them (THEMING.md:34, 38; DD-265).
- MC-1004: a host ticket (CHORE-572 toast host) is staged with its first consumer.
- CHORE-563 (typed send failure) is S1, with S2 fix link. CHORE-617 sizing decisions 5, 8 and 9 stay open.

Open questions:
- Q3.1 Does UI-S1 keep the single `alertStore` slot, or add a container with who/what/effect fields? A new container must still classify under Back and the critical-surface rule.
- Q3.2 Which consumer first mounts the toast host? The CHORE-572 rows say S3 with consumers in S0, S2 and S3. S1 is not named. MC-1004 says stage the host with its first consumer.
- Q3.3 Which UI-S1 failure shows (CHORE-563) go in a new container and which stay in the existing alert? The persisted Message field is open (fork-only; `.bin` leave-out per MC-774).

Stays open: specific tool dialogs and CHORE-617 permission defaults.

Carried: PatternDialog's generic global selectors (for example `[data-low-power]`) are to be scoped at the mounting batch.

## 4. Extension parts

What exists:
- `data-part` appears in `src` only in the seven unmounted Nexus files (proposal.md:158 gives 91 occurrences; not re-counted, UNVERIFIED).
- `docs/design/THEMING.md` is the spec. The pack validator is not in `src/`; its port waits for UI-S6 (MC-891 item 1).
- The `nexus` preset is hidden until UI-S1 (MC-921).

Settled: MC-890 and MC-891; the THEMING rules in seam 3; CHORE-463 is folded into UI-S0 (tokens) and UI-S6 (installer).

Open questions:
- Q4.1 Do UI-S1's mounted chat parts carry `data-part` names per the THEMING list from the first mount? Late naming means renaming churn and packs that cannot target them.
- Q4.2 Which UI-S1 surfaces are `data-part-critical` (send failure, approval, restore/export)?
- Q4.3 Settled in part, not asked: MC-921 (as the UI-S0 Roadmap row paraphrases it) lists the `nexus` preset in the Settings picker from UI-S1. Open only: whether it appears at UI-S1's first mount or at UI-S1 acceptance. Confirm MC-921's own wording at sizing.

Stays open: any extension API. Plugin isolation is unaddressed (ticket-matrix.md:143).

## 5. Platform capability reporting

What exists: no reporting function. Capability is decided at the point of use.
- `stdioSpawnRefusal` (`mcp.ts:102-107`): outside Tauri it refuses "only supported in Local Version"; the Android transport refuses "only in the desktop app". The refusal comes before any consent prompt.
- `internal:fs` checks `'showDirectoryPicker' in window` at connect time (`filesystemclient.ts:24`).
- The Tauri fs scope excluding project folders comes from the CHORE-617 row and was not re-read.
- The native `isDesktopTransport` probe was not run (CHORE-616 open item).

Settled: MC-933 decision 2 (Workspace is desktop first; Android reach is open, proposal section 8.2). Never simulate success (proposal wording).

Open questions:
- Q5.1 Does UI-S1 need a capability read (for example "can this device show tools or Workspace"), or does it hide by static platform checks? A read-only query keeps the UI honest on Android and web. Static checks drift, as `isTauri` branches have.
- Q5.2 Where does Android show "not available here": disabled with a reason, or hidden? MC-1004 applies: the consumer plan names the default.

Stays open: a capability model for tools; CHORE-617 permission design.

## 6. Persistence ownership

What exists: `taskPresets` is a plain optional `DBState.db` field (`database.svelte.ts:907`). Utility conversations are not persisted. Persisted kinds go through `storage/store/appStore.ts` (AGENTS.md). Store2 kind definitions were not read.

Settled:
- MC-1005: Workspace is sized assuming a store2 record first. No schema. Fork-only data follows MC-774 (left out of `.bin` with a warning naming it). MC-350 carry-forward applies to any later Android build.
- MC-892 items 6 to 8: retired settings keep their data; the low-power and update-check last-check values are device-local, not in the profile or `.bin`; one ticket per storage home.
- MC-1004: the consumers of CHORE-568, 584 and 573 precede their setters, so each consumer plan names the default.
- Homes for rows 563 to 571 in the ticket matrix are INFERRED until designed.

Open questions:
- Q6.1 For each new persisted field UI-S1 adds (CHORE-563 Message field, 564-566 chat fields and favourites store, 569 group identity): owner, `.rtb` presence, `.bin` translation or named omission, MC-350 forward migration. One checklist row each.
- Q6.2 Do 564, 565 and 566 (separate homes per MC-892 item 8) all ship in UI-S1, or is the stored-state batch split? ticket-matrix.md:111 says one batch spans at least four homes.
- Q6.3 Does any UI-S1 persistence choice presuppose a character-free chat shard that a later Workspace needs? Keeping UI-S1 fields on existing chat and character units keeps MC-1005 an assumption.

Stays open: any Workspace schema, kind, writer, journal or GC.

## 7. The Back mechanism (MC-1003)

Decided at UI-S1 sizing. The choice is the maintainer's. The tension stays recorded, not resolved: DD-207 (`docs/design/DECISIONS.md:1268`, hub and Trash push history entries; root Back uses the DD-008 toast at DECISIONS.md:65) against MC-278 item 4 (Android first; does not touch browser history; original text not read, cited through MC-892).

How Back works today (VERIFIED in source):
- Android: `MainActivity.kt:54-82` registers an `OnBackPressedCallback` (registered at 96) that evaluates `window.__risuTaniumBack?.() === true` in the WebView. Any other answer, a missing page or a timeout falls to the default Back (`defaultBack`, `MainActivity.kt:260`).
- Page: `src/ts/backHandlers.ts`, `dispatchBack` (51-76). If an alert covers the page, `closeDialogForBack` (`alertBack.ts:65`) handles it and returns true. Otherwise registered handlers run newest first and the first true wins. Otherwise the quit guard (`unhandledPress`, 92-115) shows a "press Back again to quit" toast (`main.ts:27-30`) and flushes pending saves. A second press within `QUIT_WINDOW_MS` (2000 ms) returns false and the app leaves.
- `registerBackHandler` is at 133. `backCloseHandler` (165) answers true only if its snapshot changed, so Back is never trapped.
- About 20 non-test registrants, mostly modals, plus `GridCatalog.svelte:401` (edit mode), `panelGestureBinding.ts:342` (phone overlay sidebar) and `MobileHeader.svelte:12` via `mobileBack.ts` (Beta Mobile shell).
- `UtilityScreen.svelte` has no `registerBackHandler`. Its arrow calls `utilityOpen.set(false)` (line 95). Back on Utility therefore reaches the quit guard (INFERRED from absence).
- The browser has no equivalent. There is no `popstate` handler and no history entry is pushed for any screen. A grep for `popstate|history.pushState|backbutton` over `src` finds only URL-parameter cleanup (`characterCards.ts:920,1023,1085,1156`, `drive/restoreReload.ts:19`; 1023 is a `pushState` used for that cleanup, not for a screen). DD-207 describes a mechanism the app does not have today.

Options, with consequences:
- A. Keep the `registerBackHandler` stack as the single mechanism. Smallest change and Android works unchanged. Web and hosted get no Back integration. Each screen must register or Back hits the quit guard. DD-207 needs amending.
- B. Add the history API for web (push per layer, `popstate` pops the top layer) and keep the Android page hook. Needs a rule so one press never pops both a history entry and a registered handler. Resolves DD-207 but contradicts the wording of MC-278 item 4 unless that is amended. Browser Back, forward, reload and URL behaviour become product surface.
- C. Android-only layer stack that Android Back pops, no history API. Matches MC-278 item 4. Web users keep no Back for new screens.

## 8. Rules restated

- MC-1004: the stage plan of the consumer names the default when the setter does not exist yet. A host ticket (CHORE-572) is staged with its first consumer. Stage rows are not re-staged. The defaults are plan items for each sizing; none is set here.
- MC-1005: size a store2 record first. No schema. Fork-only data follows MC-774. Platform reach stays open (MC-933 decision 2). Backup, trash and MC-350 forward-migration rules still need their own answers in sizing.

## 9. Left open on purpose

Workspace schemas and navigation; the full agent platform; CHORE-617 sizing decisions 5 (tool permission default and scope), 8 (instruction-file scope) and 9 (MCP and stdio in presets); tool-call and artifact rendering; any extension API.

## 10. Gaps in evidence

- TODO(evidence): MC-278 original text not read (cited through MC-892).
- TODO(evidence): `docs/design/THEMING.md` beyond lines 11, 34, 38 and `pattern.css` were not read in full.
- TODO(evidence): the `data-part` count of 91 is from proposal.md, not re-run.
- UNKNOWN: whether UI-S1 may ship the CHORE-573 preset chip before S2 (ticket-matrix.md:69).
- Not run: native `isDesktopTransport` probe; no device run is authorized by this note.
- Not read: Nexus component sources, store2 internals and kind definitions.
- The package queue does not give the question texts the maintainer saw (TODO(evidence) in MC-1002 to MC-1005).
- Proposal.md:155 puts the Back decision at UI-S4 sizing; MC-1003 supersedes it.
