# Main menu in three modes

Date: 2026-10-16. **Status: design mockup.** It follows audit sections 3 and 4 (the 3-mode direction the maintainer approved). Storage and the prompt pipeline are not settled; see [AUDIT_RESPONSE.md](AUDIT_RESPONSE.md) R-10. Mockup: [mockups/home.html](mockups/home.html). The run-status showcase that used to be on that page is now [mockups/run-status.html](mockups/run-status.html). Independent review: [reviews/2026-10-16-main-menu-review.md](reviews/2026-10-16-main-menu-review.md) (accept with changes). Its F-1 to F-10 and notes N-1, N-2, N-3 (Home/End) and N-7 are fixed; see "Review follow-up". The maintainer then settled five of the open questions; see "Maintainer decisions".

## What the mockup shows

**All modes share one shell:**
- A brand mark and name on the left of the top bar.
- A mode switcher in the centre: Roleplay ✦, Hybrid ◆, Utility ⌘.
- On the right: a **Tasks** button (a count badge while anything runs) and each mode's pill.
- A left rail whose contents depend on the mode.
- The network background behind everything.

Switching modes re-renders the rail and the page. If the current composer holds a draft, a dialog warns first ("You have an unsent message in Hybrid"; Stay, or Switch to the other mode); the draft is kept either way. Switching updates `?mode=` and tells screen readers "<Mode> home". The warm bloom is 18 % in Roleplay, 13 % in Hybrid (the token default) and 4 % in Utility (audit 3.2).

| | Roleplay | Hybrid | Utility |
|---|---|---|---|
| Rail | Slim avatar rail: Home, five recent characters (the last chat ringed in warm), new character; at the bottom Prompt settings and Settings | 220 px: Home, Companion tasks, Switch character, Plugin & Script Studio, Playground tools; pinned companions with a cyan dot on the active one; at the bottom Models & presets and Settings | 240 px, collapses to 64 px: New task, Workspaces with counts, Recent (the task type is the row's icon), Tools (Studio, MCP, Tokenizer, Jinja, Parser, Embedding, Translation), Models & presets, Settings |
| Top-right pill | Persona (opens a persona picker) | Model and preset | Model and context used (`12k / 100k`) |
| Page | "Welcome back, *persona*"; Continue your story shelf (portrait, branch, last line, memory pill); character library with search, sort (My order, Recent, Name), folder filters; right column with the RisuRealm card and a 2×2 Community and source card | Companion card (72 px portrait in a warm ring, greeting, Change companion, Voice, Personality: Focused task / Balanced companion / Full in-character); composer (Attach, Tools, Lorebook, Send); Tasks (run card with the 64 px mark, recent threads with the helper's avatar); quick starts; "Browse RisuRealm" link | "What are we building, *nickname*?", or "What are we building?" when there is no nickname or it is the default "User"; large composer (Attach, MCP tools, preset, Web, Run); quick-launch chips; Current run card and Recent |

### Runs and the composer

All of this is simulated.

- **Sending.** Enter sends and Shift+Enter adds a new line. Enter never sends while an IME composition is active, because Korean, Japanese and Chinese input commit with Enter.
- **Stop.** While a run is active, Send or Run becomes **Stop** in the same place.
  - Enter does not replace a running task; it says "A task is running. Stop it before sending another."
  - Stop leaves the run card at "Stopped at step *n*".
  - Each sample run is live on load, so it has a Stop button too (`still=1` freezes the sample runs).
- **Failure.** "Mockup controls → Next task" picks the next task's outcome:
  - **Succeeds.**
  - **Fails:** the run errors after its tool step, and the card offers Retry.
  - **Offline:** nothing is sent, the composer says so and the text stays.
- **Mode changes.** A run keeps going when the mode changes, and its card is current on return. Each mode's run card shows only that mode's run.
- **Ongoing tasks.** The Tasks button in the top bar opens a list of every run from every mode, with its mode, status and step, plus Open (switches to that mode and focuses its run card) and Stop. The list updates while open. Its badge counts active runs; screen readers hear "Tasks, 2 running".
- **Recents.** A sent task is added to Recents at once. The run card then shows how it went (running, done, stopped or failed), so the card never contradicts the list.

### Other interactions

- **Library.** Search, sort and folder filters work on the synthetic library. The result count is a polite live region.
- **RisuRealm card.** See the next section.
- **Pickers.** The persona and companion pickers are modal dialogs. Focus returns to the button that opened them.
- **Focus after re-renders.** It returns to the same control, for example the companion row, the collapse button or a folder.
- **Narrow screens.** Below 900 px the rail becomes a modal drawer:
  - The rest of the page is `inert` and does not scroll.
  - Tab cycles between the rail and the menu button.
  - Escape or the scrim closes it and returns focus to the menu button.
  - Widening the window past 900 px closes it.
- **Mode switcher on phones.** At 680 px and below it gets a full-width row of its own. The top-bar pill labels are then hidden visually but keep their accessible names.

**Query parameters:**
- `mode=rp|hybrid|utility`.
- `only=rp|utility`: onboarding's "hide unused modes" is on, so there is no switcher.
- `realm=populated|pending|failed|empty|offline|consent|hidden`.
- `name=`: nickname, or persona override.
- `lowpower=1`, `wave=`, `pointer=`, `still=1` and `t=`. A non-numeric `t` falls back to 0.

A "Mockup controls" disclosure in the corner sets low power, hide unused, the RisuRealm state and the next task's outcome. It is not part of the design.

## RisuRealm card (Roleplay only)

The card follows `src/lib/UI/MainMenu.svelte` (read-only reference), restyled.

- **Agreement.** "Agree and show" only asks: it opens a simulated `askUpstreamAgreement()` dialog with the app's strings (`en.ts` `upstreamAgreement*`).
  - Accept loads the card.
  - "Do not accept" or Escape keeps the placeholder, with focus back on the button (MC-086/087).
- **Stable height (MC-053).** The card's min-height and the list's cap move together, as in the source:
  - card at least 296 px, list capped at 150 px;
  - from 1024 px up, 380 px and 200 px.

  The card is the same height in every state; at 1440 px it was 380 px for failed, pending and populated.
- **Rows.** `data-realm-preview-list` is on the list panel. Ten rows are shown, the source's clamp.
- **Status region.** One `role="status" aria-live="polite"` region holds every non-list state. It is the same node across states.
  - When the list loads, the region says "10 characters loaded" to screen readers only.
  - The source instead unmounts the region; either works, and the app keeps its own.
- **Retry focus.** Focus moves to the status region while pending, then to the first row.
- **Latest uploads and See more.** The list is labelled "Latest uploads". Below it, **See more on RisuRealm** opens the full hub (simulated as a page with Back to home; focus moves to its heading and returns to the button). It is offered when the card is populated or empty, not before consent or while the preview cannot load. Hybrid's "Browse RisuRealm" link opens the same hub.
- **Consent placeholder.** It keeps its `data-testid`s and the current English strings for consent, pending, offline (Retry `aria-disabled`), failed (Retry) and empty.
- **Hidden.** `realm=hidden` (`hideRealm`) removes the card and Hybrid's RisuRealm link.

Not copied: `realmDirectOpen` click handling and the announcement's sanitised HTML. The MC-053/054/056/057/060/086 tests still have to pass against the real component; the mockup only shows the states.

## Where it departs from the audit

These were my calls. The maintainer can overrule them.

- **Roleplay rail.** The audit does not specify one for Roleplay. The mockup keeps a slim avatar rail like today's sidebar, so Roleplay stays recognisably Risu.
- **Mode switcher.** It is a native radio group, not three buttons, so arrow keys move between modes.
  - It draws the same inset bar as `.nexus-selected` with its own rule, so it does not inherit the token file's forced-colours handling; an implementation should use the class.
  - In Roleplay the glyph and tab accents are warm.
- **Utility sidebar recent rows.** They show the task type as an icon, not a badge, because at 240 px a badge left about 60 px for the title. The Recent panel on the page keeps the badges.
- **Pills.** Hybrid's model and preset pill and Utility's model and context pill both sit in the top bar, so all three modes put their pill in the same place. The audit puts Hybrid's in the composer bar and Utility's under the greeting.
- **Quick-launch chips** use line icons instead of emoji.
- **Utility composer.** It has a Web toggle but no separate Translation toggle; translation is a Tools entry and a quick-launch chip. Plugin & Script Studio sits in the Tools list rather than its own section.
- **Hybrid run card.** It is always shown, including an idle "Nothing running" card. The audit shows it only while a task runs.
- **Default mode.** The mockup defaults to Roleplay. The audit derives the mode from onboarding's "use" (both → Hybrid, tools → Utility), which `?mode=` stands in for.
- **Roleplay right column** stacks at 1100 px and below (the audit says below 1024 px). Approved by the maintainer.
- **No My World / RisuRealm Hub tabs.** The audit's tabs are dropped: the card is the preview and See more opens the full hub. The maintainer found the tab redundant with the card.
- **Ongoing tasks** is an addition the audit does not have, requested by the maintainer.
- **Personality hint.** One line under the selector describes each Personality level by intent only ("Mostly the task." and so on). What each level changes in the prompt is part of R-10's pipeline work.
- **Voice without TTS.** When the companion has no TTS, Voice stays visible but disabled, with the reason, rather than disappearing.

## Open questions

These are in addition to R-10's.

1. **Hide unused modes.** Does it remove the switcher entirely, as the mockup does, or keep it with the hidden modes under a "Show all modes" item? Settings must be able to bring them back either way.
2. **Hybrid when "hide unused" is on.** Onboarding offers "hide unused" only for stories or tools, never for both. Can Hybrid ever be the only mode?
3. **Persona vs nickname.** Roleplay greets the persona name and Utility greets the nickname (onboarding asks for one or the other). If both exist, which does Hybrid use? The mockup's Hybrid greets nobody by name.
4. **Companion-chat isolation.** The copy no longer promises it. Whether a companion's task chats stay apart from their story chats depends on R-10's storage decision (`chat.mode` or `hybridChats[]`).
5. **Personality vs Lorebook.** The Personality level and the Lorebook toggle can disagree (Full in-character with Lorebook off). Which wins, or should the level set the toggle?
6. **Roleplay selection bars.** The warm inset bar on the Roleplay mode glyph and selected segments was not covered by the decision below. Keep warm, or use cyan like other selection?
7. **Where Ongoing tasks lives on phones.** It is a top-bar button at every width. If the top bar gets crowded, it could move into the drawer.

## Maintainer decisions (2026-10-16)

| Question | Decision | In the mockup |
|---|---|---|
| Runs across a mode change | A run need not show in other modes, but there should be a separate way to see all ongoing tasks | Tasks button and Ongoing tasks dialog |
| Warn about a draft when switching modes | Yes, warn when there is one | "You have an unsent message" dialog with Stay and Switch |
| Warm colour beyond people | Warm is fine for the Upstream tag; the active-companion dot should be blue | Upstream tag stays warm; the dot is cyan (`--nexus-accent`) |
| Stack breakpoint | 1100 px is fine | Unchanged |
| RisuRealm Hub tab | If kept, it should show a short preview of latest uploads with a See more button to the full hub, but it feels redundant with the card | Tab removed; the card is labelled "Latest uploads" and has See more |
| Utility greeting with the default nickname | No name when the nickname is "User" | "What are we building?" |
| Missing rail buttons | Hybrid needs Settings and Models & presets; Roleplay needs a prompt settings button | Both rails end with those buttons |

### Not designed yet

- First-run empty states: no characters or stories, and no companion chosen.
- Utility with no model or no key.
- The real provider errors behind the synthetic failure.
- The persona list beyond the picker.

## Mode-switch transition

Specified behaviour (proposal; `mockups/home.html` implements it). Easing is `--nexus-ease`, `cubic-bezier(0.4, 0, 0.2, 1)`. Mode order is Roleplay, Hybrid, Utility; `dir = sign(order[next] - order[prev])`.

| Part | Behaviour |
|---|---|
| Stage | `main` fades from opacity 0 and slides from `dir * 14px` to none over 220 ms; `#topbar-right` from `dir * 8px` over 180 ms. New rail items fade in over 180 ms. |
| Rail (above 900 px) | `transition: width 220ms` on `.rail`. Widths 76 (Roleplay), 220 (Hybrid), 240 (Utility), 64 (Utility collapsed) interpolate; the rail already uses a plain `width`, so no layout change was needed. At 900 px and below the drawer is untouched. |
| Mode thumb | One `.mode-thumb` pill slides under the three radio labels over 180 ms, placed from measured `offsetLeft/Top/Width/Height` and re-placed (without animation) by a ResizeObserver and on resize, so the wrapped 375 px layout follows. Its inset 3 px bar morphs from `--nexus-warm` (Roleplay) to `--nexus-accent` (Hybrid, Utility). The radios stay native, with their focus rings. |
| Bloom | `--nexus-canvas-warm` is registered with `@property` (in `theme/nexus-tokens.css`) so `body.nexus-canvas` can transition it over 360 ms: 18 % Roleplay, 13 % Hybrid, 4 % Utility. |
| Rules | No animation on first render. The stage uses the Web Animations API: a new switch cancels the running animations first, so `main` is never left at opacity 0 or offset. `restoreFocus` runs synchronously inside `render()`. Nothing animates while the leave-draft dialog is open (the switch has not happened); the `?mode=` param and the "... home" status are unchanged. |
| Reduced motion | Under `prefers-reduced-motion: reduce`, `.nexus-low-power` (`lowpower=1`) or `?still=1`, the Web Animations are skipped and the rail, thumb and bloom transitions are 0 s. The thumb and bloom still land on the right values. |

Svelte mapping: `in:fly={{ x: dir * 14, duration: 220 }}` on the stage wrapper (and `x: dir * 8, duration: 180` on the top-bar actions); the rail width, thumb and bloom are CSS transitions, with the bloom needing the registered property.

Observed (private headless Chrome via `seasonal/tools/cdp.mjs`, 1280 and 375 px; log `reviews/home-transition/check.log`, script `check.mjs`, screenshots alongside):
- All six mode pairs: the animation sampled at 110 ms gave `main` translateX of +3.14 px (forward) or -3.14 px (backward) at opacity 0.776, and `#topbar-right` +/-1.8 px; the rail width, thumb transform and bloom were all part-way; at the end `main` was `none` at opacity 1, with the rail at 76/220/240 px and the bloom at 0.18/0.13/0.04.
- Utility collapsed: 64 px, morphing to 220 px (185 px mid-flight) when going to Hybrid.
- Rail transition is `width 0.22s` at 901 px and unchanged (transform drawer) at 900 px.
- Thumb sits within 0.5 px of each label at 1280 px and exactly on each at 375 px; bar colour warm for Roleplay, accent for the others.
- Six rapid radio switches, and six real ArrowRight key events: focus stayed on the checked radio, `main` ended at opacity 1 and no transform, and no stray animations were left.
- Reduced-motion emulation, `?still=1` and `?lowpower=1`: no animations were created and body, rail and thumb transition durations read 0 s.
- With a draft in Hybrid, choosing Utility opened the dialog, left the mode as Hybrid, started no animation and kept the thumb on Hybrid.
- No console errors; no horizontal overflow at 375 px.

Not verified: frame pacing or visual smoothness (samples were seeked, not watched), Safari/Firefox, a real touch device, and the Svelte implementation. Limit: the rail's items can wrap briefly while its width shrinks.

## Checks done

All checks ran in the browser pane (Chromium), served from `docs/design` over a local static server, after the review fixes. They used synthetic events where noted.

**Layout**
- No horizontal overflow at 375, 935, 1000 and 1440 px in all three modes.
- At 901 px Hybrid also has no overflow (886/886). The model pill's label ends in an ellipsis there.

**Composer and runs (Utility, 1440 px)**
- The sample run shows Stop. Stop gives "Stopped at step 2 of 7" and the button returns to Run.
- A synthetic Enter with `isComposing: true` kept "한국" in the textarea and started no run.
- The draft survived Roleplay → Utility and a sidebar collapse; focus stayed on the collapse button.
- Enter during a run kept the run and showed the "A task is running" note.
- A run kept stepping during a trip to Hybrid and back.
- The "Fails" outcome ended at "Failed at step 3 of 7" with Retry. The "Offline" outcome showed the offline note and kept the text.

**RisuRealm card (1440 px)**
- Failed, pending and populated are all 380 px high, with 10 rows and a 200 px cap.
- Retry kept the same status node. Focus went to the region, then to the first row, and the region read "10 characters loaded".
- The agreement dialog opens on "Agree and show". "Do not accept" kept the placeholder with focus back on the button; Accept went to loading.

**Keyboard and focus**
- Tabs: End and Home moved focus between the tabs (the tabs were later removed; see "Maintainer decisions").
- Folders: focus stays on the folder after filtering ("2 of 8"), and the count has `role="status"`.
- A Hybrid rail companion row keeps focus after re-render, and Voice reads `aria-pressed="false"` for Professor Hollis.

**375 px**
- Drawer open: `main` and the switcher are inert and the page does not scroll.
- 24 synthetic Tabs stayed within the rail and the menu button. Shift+Tab from the menu button goes into the rail. Escape closes the drawer and returns focus.
- Widening to 1200 px with the drawer open closes it and clears `inert`.
- The pills' names are "Persona: Juno, change persona", "Claude · Balanced preset, model and preset" and "Claude 12k / 100k context used".

**Console**
- No errors, including with `t=abc`.

**After the maintainer decisions (1440 and 375 px)**
- Tasks shows "Tasks, 2 running" with both sample runs. Stop in the dialog stopped the Hybrid run, focus moved to its Open button and the count dropped to 1. Open switched to Hybrid and focused the run card's title.
- With a draft in Hybrid, choosing Roleplay opened the warning with focus on Stay and the Hybrid radio still checked. Stay returned focus to the checked radio; Switch went to Roleplay with focus on its radio.
- Roleplay: no tabs; the card shows "Latest uploads" and See more, which opens the hub page (focus on its heading) and Back returns focus to See more. Rails: Roleplay ends with Prompt settings and Settings, Hybrid with Models & presets and Settings. The active-companion dot is `rgb(56, 217, 255)`.
- Utility greets "What are we building?" with no name and "What are we building, Dana?" with `name=Dana`.
- No horizontal overflow at 375 px in any mode; no console errors.

**Not checked:** real IME, real screen readers, touch devices, forced colours, WebKit and Firefox. Reduced motion was checked by the reviewer by emulation only.

## Review follow-up

| Review item | Change |
|---|---|
| F-1 IME Enter | Enter is ignored while `isComposing` or `keyCode` is 229 |
| F-2 Drafts and runs | Drafts are kept per mode in state. Runs keep going across mode changes, so Recents and the card agree |
| F-3 Stop and failure | Send/Run becomes Stop while a run is active, and Enter does not replace a run. Failing and offline outcomes are added (Mockup controls). States not designed yet are listed above |
| F-4 Drawer | Modal drawer: the rest of the page is inert, Tab cycles, scrolling is locked, it closes on widening, and the slide-out is visible |
| F-5 Focus | Focus is restored after every re-render. Retry moves focus to the status region, then to the first row |
| F-6 Overflow at 901–935 px | Top-bar grid columns are `minmax(0, 1fr)` and the pill label ends in an ellipsis |
| F-7 Consent | A simulated agreement dialog with Accept and Do not accept |
| F-8 Card height | The source's paired min-heights and caps (296/150, 380/200 from 1024 px); 10 rows |
| F-9 Pill names | Labels are hidden visually only at 680 px and below |
| F-10 Copy | The isolation sentence is removed. Personality hints describe intent only. Questions 6 and 7 are added |
| N-1 | A non-numeric `t` falls back to 0 |
| N-2 | Voice `aria-pressed` is always `true` or `false` |
| N-3 | Home and End on the tabs (the tabs were later removed). Folder clicks now update only the folders and grid; tab clicks still re-render the page |
| N-7 | The library count is a polite live region |

The other notes stand as recorded in the review. N-4 and N-5 are now open question 8 and the departures list; N-6 is partly addressed by the "loaded" text. N-8 (target sizes), N-9 (a click in the picker padding closes it), N-10 (Utility Recent's `aria-current`, the non-interactive pill's style), N-13 and N-14 are unchanged.
