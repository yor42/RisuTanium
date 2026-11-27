# PC rows run, 2026-11-28 (#613, #686, #283, #540, #861 baseline)

Refs #613, #686, #283, #540, #861. Closes none. Nothing here is an acceptance verdict: the runners recorded what each row showed, and the orchestrator checked two consequential claims (below). MC entries: [Agents/mc/pc-rows-2026-11-28.md](mc/pc-rows-2026-11-28.md) (MC-4640..4649).

## What ran, on what

- Build: production `dist` (`vite build`, `NODE_OPTIONS=--max-old-space-size=8192`, heavy-job slot A taken and released) of **origin/main 2f14903fa**, in a clean worktree `.claude/worktrees/pc-rows-2026-11-28` (detached from the stale main checkout; `node_modules` junction, lockfile hash equal to main's).
- Serve: `server/node/server.cjs` from the worktree, cwd `%TEMP%\pc-rows-2026-11-28\srv` (a `dist` junction plus its own `save/` folder), `127.0.0.1:6011`. The save folder is the synthetic profile; the maintainer's data was never touched. Server stopped at the end (its own PID, name checked).
- Browser: desktop Chrome 158.0.8127.37, only through `Agents/Tools/chatshell-cdp/launch-chrome.mjs` (resolver rules + closed-proxy belt read back from `launch-readback.json` each leg), CDP port 9470, one reused throwaway profile `%TEMP%\pc-rows-2026-11-28\profile-a2`. No mock, no model call, no OS input. **PC, production dist, not Android WebView; nothing here is a phone result.**
- Runner: `device-runner` role, 14 legs (a1-a5, b1-b4, c1-c2, d1-d3), one dispatch each, policy route Haiku/low/20 min. Raw per-leg reports: `%TEMP%\pc-rows-2026-11-28\<leg>\results.md` with screenshots, probe JSON and scripts. Raw files were not deleted; superseded ones are marked in the reports.
- Fixture built through the app's own UI: first-run password dialog of the Node server (throwaway), chat shell switch (documented localStorage key), character SynthA with a first message holding a `js` fence and a no-language fence, SynthB, SynthC, group SynthGroup, synthetic card "C322 Large Card" (imported twice, in the a5 passes; the picker lists two cards of that name).

## Results per row

Status words: RAN-OBSERVED (the row ran and the report records what it showed), PARTIAL, NOT RUN. "Matches" or "does not match" refers only to the expectation written in the PR or issue.

### #861 baseline (before any fix): RAN-OBSERVED (leg a3)

- Right-click (CDP `Input.dispatchMouseEvent`, button right) on the rendered `js` code block produced one trusted `contextmenu` event. Afterwards `[data-part=chat-code-menu]` = 1 (`#code-contextmenu`, 160x90 at the click point) and `[data-part=chat-sheet]` = 1 (340x235 at the same origin). `elementFromPoint` at the code menu's centre hit a sheet button, so the sheet covers the code menu. The orchestrator read `R861-both.png`: the message sheet (Copy / Copy as card / Select text / Customize buttons) is drawn over the area; the code menu is not visible. **Matches the issue text.**
- Escape closed the sheet only; the code menu stayed in the DOM (count 1) and was then reachable (`R861-after-esc.png`).
- Controls: right-click on the no-language fence and on plain text opened only the message sheet (no new code menu). The earlier code menu was **not removed** by Escape or by the control right-clicks (stale `#code-contextmenu`, count 1 throughout); the handler removes it only on the next code-block right-click or a document click, per the runner's source read.
- Not checked: Copy/Download click outcomes; Android long press.

### #613 Home Tasks tab (PR 851)

- **R613-1 layout: RAN-OBSERVED (leg a4).** Dialog title "Tasks" (en) / "작업" (ko). Two tabs "Replies (0)" / "Background (0)" ("답변 (0)" / "백그라운드 (0)"), Replies selected on open. At 360, 320 and 1280 CSS px, ko and en: both tabs share one row (identical `top`), no label clipped (scrollWidth = clientWidth), tabs 44 px high, Tasks button 44x44. **The dialog's Close control measures 40 CSS px high at every width and language (57.9x40 ko, 69.4x40 en): compared with the brief's >= 44 px expectation, it does not match; no PR text was checked.** The Tasks button had no `aria-label` attribute and no badge element at zero counts (name comes from its text). Badge with a non-zero count: not checked.
- **R613-2 empty Background panel: RAN-OBSERVED (leg a4).** Text "Nothing else is running" / "실행 중인 다른 작업 없음". The `[role=tabpanel][data-part=home-task-panel]` for Background measured 0x0 with empty text while the empty-state text rendered outside that element (cause not traced).
- **R613-3a band change: RAN-OBSERVED (leg a4).** With Background selected, widths 1280 -> 360 -> 1280 (bands: phone < 768, mid 768-1279, wide >= 1280 from `homeLayout.ts`): dialog stayed open and Background stayed `aria-selected`. Matches.
- **R613-3b keyboard: RAN-OBSERVED (leg a4).** Arrow/Home/End and Escape were driven; focus ring screenshot `R613-3-focus.png` read by the runner. (Per-key results are in `a4\results.md`.)
- **R613-2b background task card: PARTIAL (leg a5).** The import card (`Importing characters`, subtitle `card-large.png`, background button "Keep going in the background") was caught running and sent to the background twice, but the job ended 0.5-2 s later, so no running row (title/subtitle/progress), **Open and Cancel were never observed**. Row-leaves-at-end was observed only in the sense that the Background tab was empty afterwards. The medium card was refused by the app ("This card file is incomplete or damaged"; not judged).
- **R613-2a prompt preview row and Stop: NOT RUN.** The prompt preview lives in the Dev Tool sidebar, no running row was caught (the report does not show whether the preview was slow or fast). A slow mock was not built; a `usePlainFetch` field exists in `database.svelte.ts` but the runners did not find its setting in the UI, and no model call was needed for any other row.

### #686 Studio group form (PR 858)

- **R686-visit: PARTIAL (leg b1).** Only the route group Character panel > "Open in Studio" ran: `studio-group-form` present, name SynthGroup, member rows SynthA, SynthB, SynthC in order with the full control set. **The three routes the owed row names (the group's sidebar entry, This chat, the More menu) were NOT RUN:** a group opens on the classic screen, where the chat-shell parts do not exist. This agrees with #283 ("group chats stay on the old screen for now") and is a finding about what the owed row can reach, not a defect claim.
- **R686-ops: RAN-OBSERVED for active, talk, order-by-order, remove (legs b2, b3).**
  - Active toggle (SynthB off): one history entry "Changed whether "SynthB" is active"; Undo restored checked, Redo unchecked again.
  - Talk (SynthC level 4 -> 2): one entry "Changed the talkativeness of "SynthC""; Undo -> 4, Redo -> 2.
  - Talk by Order: on, undo, redo, off; the second "Talk by Order" edit cleared the redo branch.
  - Remove SynthC: entry `Removed member "SynthC"`; Undo returned it at index 2 (last) with Active checked and talk 2 preserved; Redo removed it; Undo restored it.
  - Add: the picker was opened and read: "SynthA, C322 Large Card, C322 Large Card, SynthB, SynthC" (it offers the current members and two cards with the same name); cancelled, nothing added. **Adding a member (and the first-message confirm) was only seen in leg b1 setup (answering NO added nothing); an add inside the Studio form with undo was NOT RUN.** Order-by-order on its own and member add are therefore not both covered.
- **R686-history: RAN-OBSERVED (leg b3).** Four entries newest first: undone `Removed member "SynthC"`, `Talk by Order`, `Talk by Order` + "Revert to here", `Changed the talkativeness of "SynthC"` + "Revert to here". 360x740 captures of form and panel taken and read; **the checkbox controls (Active, Talk by Order) are 13 px high**, below 44 px (action buttons were measured too; see `b3\results.md` for the list).
- **R686-archived (group with an archived member): NOT RUN (leg b4).** The leg found no per-character archive action by one source search (five names) and no UI route; the only switch is Settings > Advanced "Archive characters and modules at startup", which archives all characters at boot. It was not tried (all-profile effect, product question for the maintainer if a per-member route is wanted).
- Studio switch ON, Dev Tools ON, language English were left on in the throwaway profile.

### #283 deleted member's join-time name (PR 856)

- Setup observed (leg d2): SynthC renamed SynthCRenamed in the classic editor; the group's Studio form showed "SynthCRenamed" before deletion; deleted by single delete to Trash then "Delete permanently" on the Trash tab, both confirms naming it, Trash empty after.
- **Group Studio form after permanent removal: RAN-OBSERVED (leg d3).** The removed member's row reads the raw id `7abd5135-02ab-4455-a207-b84bb1d4bda2` with tag "Missing member" (`data-tag="missing"`). It shows neither "SynthC", "SynthCRenamed" nor "Unknown Character". The form's own comment says an id stands in for a missing member, and PR 856's stated scope was the prompt/lorebook text, exports, bookmarks and the generation-info dialog, so this is a place the PR did not claim to cover; recorded, not judged.
- **Prompt text: RAN-OBSERVED (leg d3).** Dev Tool prompt preview of the group chat: "SynthC" appears twice, both in the message tags `<SynthC's Message>` / `</SynthC's Message>`; "SynthCRenamed" 0; "Unknown Character" 0. The join-time name is shown. (Orchestrator spot-check of the report's own quoted counts and context, not of the screenshot.)
- **Chat export, bookmarks, generation-info dialog: NOT RUN.** The export was started in leg d3 but no file reached `d3\downloads` (download holder problems), so no counts exist; bookmark and generation-info were not reached. These three owed readers remain unobserved.

### #540 Vault V4 (PR 854)

- **13 service key rows: PARTIAL (legs c1, c2): 10 of 13 reached** (each card `[data-slot=<slot>]` showed "No connection yet. A key typed here is saved as a new connection." + "Manage in Connections" before any key): elevenLabKey, NAIApiKey, huggingfaceKey, fishSpeechKey (Other Bots > TTS), stabilityKey, falToken, openaiCompatImage.key, wavespeedImage.key (Other Bots > Image Generation, provider chosen first), supaMemoryKey, voyageApiKey (Other Bots > Long Term Memory > SupaMemory, embedding model chosen first).
  - **deeplOptions.key and deeplXOptions.token: no render site.** Checked by the orchestrator: `git grep "ServiceConnectionRow service="` over `src` lists only `OtherBotSettings.svelte` (NAIApiKey twice, stabilityKey, falToken, openaiCompatImage.key, wavespeedImage.key, elevenLabKey, huggingfaceKey, fishSpeechKey, supaMemoryKey three times, hypaCustomSettings.key at line 1437, voyageApiKey) and `PlaygroundEmbedding.svelte` (hypaCustomSettings.key); a text search of `.svelte` files found no mention of the two DeepL slots. So 11 of 13 slots have a card in the source and 2 have none. Whether that is intended is a question for the PR 854 owner.
  - hypaCustomSettings.key: NOT RUN (a card exists at `OtherBotSettings.svelte:1437` and in the Playground embedding page; not reached in time).
- **Service card always masks: RAN-OBSERVED for three cases (legs c1, c2).** Plain key typed in elevenLabKey (c1): chip "••••", no tail, no `sk-synth`; plain key in supaMemoryKey: chip "••••", chip does not contain the typed tail, card does not either; `${SYNTH_REF_NAME}` in voyageApiKey: chip "••••", does not contain `SYNTH_REF_NAME` or `${`. Each key was cleared through the UI; after clearing the card reads "Requests through this connection have no key" and the chip is gone. Evidence for B and the second plain key is DOM-probe booleans printed in the leg session (the probe output was not saved as a file); the input's value at blur was not read for B. A third, untouched empty slot as a distinct step was not run (the "No connection yet" state was observed before typing).
- Connections list afterwards: ElevenLabs, Voyage AI, Memory (OpenAI), each "Requests through this connection have no key" (names only; no key text read).

## Rows not run or not complete

| Row | Missing | Why |
|---|---|---|
| R613-2a prompt preview row + Stop | whole row | no running row caught; Dev Tool sidebar route found late |
| R613-2b | running row fields, Open, Cancel | job ends 0.5-2 s after the background press; medium card refused |
| R613 badge with non-zero count | non-zero badge | no reply or background job could be held |
| R686 sidebar / This chat / More visits | three routes | groups open on the classic screen; chat-shell parts absent |
| R686 add inside Studio + undo | add step | picker read and cancelled only |
| R686 archived member | whole row | no per-character archive route found (one source search); startup-archive switch affects every character |
| #283 chat export, bookmarks, generation-info | three readers | export produced no file; bookmark and info dialog not reached |
| #540 deeplOptions.key, deeplXOptions.token | two rows | no render site in `src` (orchestrator-checked) |
| #540 hypaCustomSettings.key | one row | not reached |
| #540 empty slot C as a distinct mask step | one step | not run |

## Disclosures (rule deviations and incidents)

1. **Start-Process used by a runner** twice: leg a1 started its scratch mock with `Start-Process` and an argument array (the mock was never used); leg d3 started a download holder with `Start-Process` in error, stopped it by name and replaced it with a background job. Chrome itself was only started by the launcher.
2. **Screenshot overwrite:** leg b3's copied driver still wrote to `b2\`, so `b2\R686-start-home.png` was replaced by b3's start-of-run screenshot (same size, 54314 bytes; identity not verified). Leg a2's `SETUP-01` screenshot was first written into `a1\` and moved. Leg b2 and others reported superseded attempts in their reports.
3. **Typed throwaway key visible in a screenshot** (leg c1, `R540-mask-A-typed.png`, a throwaway `sk-synth-...` string): renamed `R540-mask-A-typed.WITHHELD-key-visible.png`, not used as evidence. Later legs took no screenshot while a key was typed. The typed strings also appear in the runners' own tool-call commands (not in any result file).
4. **Throwaway app password set** on the scratch Node server's first-run dialog (value never recorded), by the orchestrator's decision for this disposable loopback profile (MC-4640).
5. **Profile state left changed** (throwaway profile only, server stopped): Studio switch ON, Dev Tools ON, language English, Image Generation provider WaveSpeedAI, Long Term Memory embedding model `openai3small` (type None), three keyless connections, imported "C322 Large Card", SynthCRenamed permanently deleted, group SynthGroup with SynthA (active), SynthB (inactive), the deleted member's id.
6. Legs ran longer than the 20-minute route cap in at least one case (b1); the cap was otherwise the reason several legs ended early.
7. Screenshots not opened by anyone for some legs (c2: six of eight unread; their statements come from DOM probes); the a2, a5, d1 reports say which they read.

## Orchestrator checks

- Read `a3\R861-both.png` and confirmed the sheet covers the code menu.
- Re-checked the `ServiceConnectionRow` render sites by `git grep` (list above).
- Not independently checked: the Close control 40 px figure (a4), the b2/b3 history entries, the d3 counts. These are runner observations (probe JSON in the leg folders), each from one run.

## Commands

- Build: `node node_modules\vite\bin\vite.js build` with `NODE_OPTIONS=--max-old-space-size=8192`, in the worktree, slot A claimed by `mkdir` of `%TEMP%\risu-b715\fullrun-slot`, removed after.
- Serve: `PORT=6011 HOST=127.0.0.1 node <worktree>\server\node\server.cjs` from `%TEMP%\pc-rows-2026-11-28\srv`.
- Leg dispatches: registered with `workflow-control.mjs register` (device class declared with a `device:pc-desktop-chrome-cdp` resource and the dist `index.html` SHA-256 45B5DBA0D2BA9AD92136B7EEABC0F71C18F1F237EC038FFE647A7E49496957E7, revision 2f14903fa; see MC-4641).

## Reviewer omissions (doc-verifier, report at %TEMP%\pc-rows-2026-11-28\review\verdict.md)

The review also listed items the runners reported that this file leaves out: arrow-key wrap and focus behaviour in a4, passing phone-width measurements, and two failed first launches. They are in the leg reports.
