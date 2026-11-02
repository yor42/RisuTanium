# Ticket and dependency matrix

Status: proposal only. Verification: see `README.md`.

Sources: `d-queue` (the Roadmap rows for CHORE-03, 117, 205, 475, 398, the UI epic and UI-S0 to UI-S6, CHORE-562 to 588, CHORE-616 and 617, and the batch 22 and 32 text; Roadmap rows are cited by ticket ID, not by row or line number, because records batch 36 shifted lines; MC-516, MC-772, MC-890 to MC-892, MC-920, MC-921, MC-933), `c-gates` (gate dispositions), `b-reuse` (CHORE-617 and 619 to 621). Snapshot of the packets: HEAD `52c4f0516`; HEAD is now `ea14314bd` (records only). The independent verifier read the batch 36 rows for CHORE-17 and CHORE-624 at `ea14314bd`; the CHORE-624 row agrees with this matrix (3 of 3 runs, 2035 to 2138 ms after landing, `preempted` false, commit outcome not shown). Other batch 36 records remain unread, TODO(evidence).

Rules for reading:
- A "stated dependency" is quoted from the Roadmap row. An INFERRED dependency is the packet author's reading and is marked.
- Labels such as PB-1 are proposal labels, not allocated ticket IDs. UI-B1 to UI-B9 are the external proposal's labels.
- "Device obligations" lists only obligations the records name. Nothing is invented.

## 1. UI-S stages

| Stage | Status | Stated prerequisites | Carried obligations and notes |
|---|---|---|---|
| UI epic (Roadmap UI epic row) | opened (MC-890 to MC-893) | UI-S0 first; UI-S1 and later wait for the MC-516 gate | Per-surface in-app switch, no long-lived UI branch. At most 10 new maintainer questions per UI batch (MC-890 item 3). Row text "nothing implemented" is STALE for UI-S0. |
| UI-S0 | COMPLETE, merged `d1f11ea18` | additive; allowed before the gate (MC-890 item 4) | Carried to UI-S1 as the first mounting batch: (a) browser and Android WebView run of the focus, inert, capture-phase Escape and arm-delay checks (happy-dom only so far); (b) scoping of generic global selectors in `pattern-dialog.css`. Also: nexus preset hidden until UI-S1 (MC-921); built-in English moves to language files at the mounting batch; CHORE-351 stays "folds into UI-S0" until the last select/input call site migrates. |
| UI-S1 | queued; "sizing; split S1a/S1b proposed" | MC-516 gate (MC-920 list: CHORE-205, 117, 03, 398) | Closes CHORE-135, moots CHORE-140; acceptance covers CHORE-155, 482, 168; absorbs CHORE-154 item 5. Gate state: 03, 117, 398 closed; CHORE-205 not complete (ruling owed, Q3). No sizing exists for UI-S1 to S6 (the Roadmap sizing TODO for UI-S1 to S6, TODO(evidence)). |
| UI-S2 | queued behind the gate | the gate; engine tickets CHORE-562 to 588 "feed it" | Absorbs CHORE-111, 326, 451. |
| UI-S3 | queued behind the gate | the gate | Absorbs CHORE-320, 321, 325, 327. |
| UI-S4 | queued behind the gate | the gate | Absorbs CHORE-170, 171, 172, 173, 177, 179. The Back mechanism is decided at S4 sizing (MC-892 item 3); 30-day Trash (item 5). The UI-S4 row does not list CHORE-584, which depends on it. |
| UI-S5 | queued behind the gate | none stated | Spec `docs/design/system-surfaces/android/SPEC.md` exists. |
| UI-S6 | queued behind the gate; "follows UI-S0" | UI-S0; validator port waits for UI-S6 (MC-891 item 1) | Installer ports the pack validator (22 files). Pack store; packs travel in `.rtb`, not `.bin`. |

Observation: no record orders UI-S1 to UI-S4 among themselves beyond S1 being behind the gate.

## 2. CHORE-562 to CHORE-588

Source for every row: the `Agents/Roadmap.md` rows for CHORE-562 to CHORE-588. All are "open, queued" as of batch 22. The CHORE-567, 568 and 585 rows carry a batch 32 line: "STILL VALID: a proposed UI feature that never existed in source; no action". No row has a plan (the Roadmap homes-for-564-to-568 note). No row records a device obligation, except CHORE-576's required Note 9 save-cost check at implementation. Rows listed: 27 of 27, COMPLETE.

| CHORE | Short title | Stage | Stated dependency (quote) | First consumer | Persistence boundary | Notes |
|---|---|---|---|---|---|---|
| 562 | `.bin` export leave-out list and translation | S2 | "queued per MC-516 (UI-S2)"; MC-774, MC-175 | Settings backup/export (inferred) | export content; no new store | |
| 563 | typed send failure; pre-send key/model check | S1 (S2 fix link) | "queued (UI-S1, S2 fix link)" | chat message | new Message field; persistence open; fork-only, left out of `.bin` with a warning (MC-774) | links S1 to S2 |
| 564 | per-chat toggle variables | S1 | "one storage home per ticket (MC-892 answer 8)" | chat toggles | per-chat variable values | |
| 565 | chat-level jailbreak/memory; hide names/avatars | S1 | "queued (UI-S1)" | chat | new chat fields (MC-774) | |
| 566 | favourites store keyed by source and key | S1 | "queued (UI-S1)" | chat | a new store | |
| 567 | edit drafts, height cache, hint dismissal, open anchor | S1 | "location open, SLICE4 O-1" | chat | location OPEN | batch 32: feature never existed in source |
| 568 | per-character render-when-complete | S1 consumer, set in S3 | "queued (UI-S1, set in UI-S3)" | chat (S1); setter in Studio (S3) | new character field; `.bin` equivalence not stated | default before S3: UNKNOWN |
| 569 | group member identity (name, colour slot) | S1 | "queued (UI-S1)" | chat (group) | new field; colour slot INFERRED stored | |
| 570 | toggle default-value syntax and rename migration | S3 (S1 reset state) | "queued (UI-S3, UI-S1 reset state)" | Studio authoring (S3); chat reset (S1) | toggle definition text; forward migration (MC-350) | |
| 571 | Studio device-local store | S3 | "queued (UI-S3)" | Studio | device-local, outside database and exports; "MC-350 still applies" | |
| 572 | app-wide toast host and undo-toast helper | S3, S2, S0 consumers | "queued (UI-S3, S2, S0 consumers)" | Studio; also S2 and S0 | none | host needed before the first of those mounts (INFERRED) |
| 573 | preset ids, folders, favourites, slots, slot-hotkey migration | S2 (S1 chip) | "queued (UI-S2, S1 chip)"; "the model-select hotkey joins here" | Settings presets; chat chip; hotkeys | database format; `db.hotkeys` migration | UNKNOWN whether S1 can ship the chip before S2 |
| 574 | preset undo, restore points, 30-day recently-deleted store | S2 | "30 days across restarts, MC-892 answer 5; restore-point cap open" | Settings presets | new store2 data, not `.bin` | shared mechanism with S4 Trash: UNKNOWN |
| 575 | preset field locks held outside the preset | S2 | "queued (UI-S2)" | Settings presets | fields move out of presets (MC-774) | |
| 576 | live write-through preset editing | S2 | "MC-772 asks a save-cost check on the Note 9" | Settings presets | persistence behaviour (save cost) | Note 9 save-cost check required at implementation |
| 577 | preset bundle export/import | S2 | "builds on CHORE-475's converter" | Settings presets | new bundle format; keys stripped from the bundle (MC-772 item 2, shared with CHORE-580) | CHORE-475 code-complete, device check owed (the CHORE-475 Roadmap row) |
| 578 | connections store, request path, custom models, test, migration | S2 | "CHORE-450 (key rotation) is adjacent" | Settings models | database format; `.bin` export translates (MC-772 item 1); forward migration (MC-350) | |
| 579 | service-key migration into connections | S2 | "after CHORE-578" | Settings (memory/embedding keys) | `supaMemoryKey`, `voyageApiKey` become references | |
| 580 | keys stripped from sharing exports only | S2 | ".rtb and .bin keep keys, MC-698"; MC-772 item 2 | sharing exports (bundles, cards, modules) | export content only | both rows cite MC-772 item 2, which names preset bundles; which ticket implements the stripping for the CHORE-577 bundle, and in what order, is not stated |
| 581 | Models-page defaults; legacy flag retirement | S2 | MC-892 answer 6 | Settings models | fields stay; controls go | |
| 582 | parameter off flag; per-task same/own migration | S2 | "queued (UI-S2)" | Settings parameters | per-parameter flag written back as -1000 at `.bin` export; preset migration | |
| 583 | memory engine single choice; HypaV3 presets by id | S2 | "CHORE-328 adjacent" | Settings memory | five fields become one; migration both ways | |
| 584 | profile-wide `visibleModes`, `hideUnusedModes` | S2, S4 Home | "queued (UI-S2, UI-S4 Home)" | Settings writes; Home consumes | two new profile fields, migrated | dependency lives only on the 584 row |
| 585 | `lowPower`, `reducedMotion`, slow-frame sampler | S2 (S0, S1) | "queued (UI-S2, S0, S1)" | Settings; Nexus tokens | DEVICE-LOCAL, not profile or `.bin` (MC-892 answer 7); MC-350 applies | batch 32: feature never existed |
| 586 | new display/input fields (haptics, edge-swipe, Enter-key, ...) | S2, S1 | "adopt per field" | Settings; chat | new profile fields if adopted | |
| 587 | restore flow (abort, pre-decode, safety snapshot, list, result, progress) | S2 | "cites CHORE-103, 141, 159, 70 (adjacent restore tickets, not merged)" | Settings backup/restore | a safety snapshot is written | |
| 588 | settings-file export/import | S2 | "queued (UI-S2)" | Settings backup | new file format (settings and preset choices, no keys or chats) | |

All stored-data rows route to `opus-reviewer` under MC-774 and MC-350 [E].

### Explicit points the governing prompt names

| Point | Result |
|---|---|
| CHORE-570, 571, 572 | 570 is S3 with an S1 reset-state consumer and a forward migration. 571 is S3 device-local. 572 is S3 with S2 and S0 consumers and no stored data. VERIFIED (the CHORE-570, 571 and 572 Roadmap rows). |
| CHORE-568's Studio setting | Setting in S3, chat consumer in S1. S1 would read a field no UI sets until S3. Default before S3: UNKNOWN. MC-892 does not decide it (Q8). |
| Cross-surface preset and hotkey consumers (CHORE-573) | S2 row; consumers in S1 (chip) and app-wide hotkeys. No row says S1 waits for 573. UNKNOWN whether S1 may ship the chip first. |
| CHORE-579 after CHORE-578 | VERIFIED, the CHORE-579 row says "after CHORE-578". |
| CHORE-580 export-specific | VERIFIED: keys are stripped from sharing exports only; full backups keep them (MC-772 item 2, MC-698). |
| CHORE-584 and Home | VERIFIED: fields created in S2, consumed by Home in S4. The UI-S4 row does not list 584. |
| CHORE-577 on CHORE-475 | VERIFIED. The dependency is on merged code, not on an unfinished ticket. |
| 30-day Trash | MC-892 item 5 (S4; CHORE-172 replaces the 3-day boot purge) and CHORE-574 (S2, presets). One shared mechanism or two: UNKNOWN. |
| Back mechanism | MC-892 item 3: decided at S4 sizing, one mechanism for all new screens. The tension DD-207 against MC-278 item 4 is recorded unresolved. Whether S1 to S3 may ship before it: UNKNOWN (Q7). |

## 3. Other tickets named by the brief

| Ticket | Status | Real dependencies | Persistence boundary | First consumer | Open device obligations |
|---|---|---|---|---|---|
| CHORE-616 (Utility) | S2 technically COMPLETE; commit `8c8211de2`, merged `502190194`, pushed (the CHORE-616 Roadmap row) | Gates: Gate 1 r1 [REJECT], r2 [EDITORIAL], advisor PROCEED WITH CHANGES; Gate 2 r1 [REJECT] F1, then [EDITORIAL] | task presets: new store2 entry with `req` token (MC-933 item 5); desktop only | Utility screen | T14 (older build reading S2a bytes), D2 live desktop journey, native `isDesktopTransport` probe (not run). Comment-only leftover: `// Q10 wording pending.` in `en.ts` and 7 locales. |
| CHORE-617 (Utility tools/workspace) | open TODO, low priority, "nothing is sized or planned" (the CHORE-617 Roadmap row) | Waits on your answers to sizing decisions 5, 8, 9, not on any UI stage | none yet; project folder needs new storage | none | none |
| CHORE-619 (pooling) | open, low, needs sizing | CHORE-621 proposed to be sized with it | changes vectors; cache key (content, then model, optional custom model and context suffix) is unversioned | RP memory (HypaV3) and any Utility retrieval | none; M2 numbers are one synthetic set on CPU, not the device backend |
| CHORE-620 (model list) | open, low | default-model question (Note 9 size vs Korean quality) is pending | same cache | same | none |
| CHORE-621 (prefixes) | open, low | with CHORE-619 | changes vectors; prefixes exist only in `hypav2.ts` and `hanuraiMemory.ts`, not in `HypaProcessorV2` | same | none |
| CHORE-624 | merged `031bfddf1` (counters plus hidden-tick yield) | MC-979 net | none | RP generation end-of-reply flush | Device batch 36 (verified 2026-11-02): flush waited for the hidden tick (about 2 s, 3 of 3 runs, `preempted` never fired). Merged, device outcome not shown. One-run cause check chosen by the maintainer. |
| CHORE-396 | no fix designed | MC-979 gate; forced-GC run then attribution | none | Android memory | forced-GC run over CDP queued, not run |
| CHORE-17 S0 to S2 | merged `515025346` | MC-979 gate | read path; opt-in `getLightCharacters` | RP load | batch 36 S1-b recorded (Roadmap CHORE-17 row): default read Bm median 2528 ms vs Nm 2097 ms (n=5 each), WEAK to moderate, saving not attributed to one change; light read 140 ms (no comparator), descriptive; the default cheaper copy (S1) NOT TESTABLE on the fixture; Q3 criterion non-blocking |
| CHORE-623 | merged `621c220d2` | MC-979 rides along | none | none | none; stage S1 and `Legal.svelte` status TODO(evidence) |
| CHORE-128 (`.rtb` backup) | task presets "are in no backup until this ticket and gate release on it" (the CHORE-128 Roadmap row) | MC-936 item 3 | `.rtb` must refuse an unknown `req` token and delete nothing | backup/restore | not stated in the packets: TODO(evidence) |
| CHORE-205 | NOT COMPLETE (the CHORE-205 Roadmap row) | MC-920 "device cases only"; criterion MC-957 | none | memory work | 6a item 6 export NOT REACHED; steps 12, 13, MC-670, M9 "accepted gaps"; the ruling is owed |
| CHORE-117 | CLOSED as a gate ticket; stage 1b `95d68c29b` (the CHORE-117 Roadmap row) | none left | | | stage 1c deferred, low, non-gating |
| CHORE-03 | CLOSED; premise refuted; test `4f986561d`, merge `f4f2e2c0f` (the CHORE-03 Roadmap row) | none left | | | out of scope: boot purge of expired trash, in-flight `removeChar('permanent')`, restore position memory (low) |
| CHORE-398 | CLOSED as a gate ticket; merged `7a94a7b30` (the CHORE-398 Roadmap row) | none left | | | D2 "Saving" sub-case still owed, non-gating |

## 4. The Utility edge (UNPROVEN)

| Claim | Result |
|---|---|
| "Utility must wait for UI-S6" | UNPROVEN. 0 matches for Utility with UI-S1..S6 in Roadmap, Live-State, Decision-Index, Maintainer-Context and Roadmap-parked. The only source is the external proposal's D-01 Option A. |
| "Utility after UI-S4" | A proposed schedule (external 8.4). Needs your choice (Q5). |
| Counter-evidence | CHORE-616 S2 is merged while UI-S1 has not started. CHORE-617 waits on your answers, not on a UI stage. |
| Consequence if Utility UI is built first | Each later UI stage migrates its own surfaces (MC-890 item 4). UI-S4 Home would have to migrate the Utility Home card (INFERRED). |

## 5. Proposed batch grouping and its mismatches

The external Phase 2 table (UI-B1 to UI-B9, labelled provisional) says a batch "does not erase individual tickets" and wants distinct review boundaries for unrelated stored data. Mismatches with the rows:

| External grouping | Match | Mismatch |
|---|---|---|
| UI-B1 (S1 runtime), UI-B2 (S1 stored state, CHORE-563 to 569) | PARTIAL | 568's setter is in S3. 563 also links S2. 567 is a never-implemented feature with an open storage location. 564, 565 and 566 each have a separate storage home (MC-892 item 8), so one stored-state batch spans at least four homes. 570's S1 reset state sits under S3. |
| UI-B3 (573 to 577) | MATCH on stage | Five distinct stored-data formats (573, 574, 575, 576, 577) in one batch conflicts with the external text on distinct review boundaries. 573 also has an S1 chip and a hotkey migration. 577 depends on CHORE-475. 574's 30-day store may duplicate S4 Trash. |
| UI-B4 (578 to 580) | MATCH | 580 touches the bundle format of 577, which sits in B3, so B3 and B4 are linked. |
| UI-B5 (other S2 settings), UI-B6 (backup, restore, export) | NOT ASSIGNED | No ticket numbers given. Candidates: B5 = 581 to 586; B6 = 562, 587, 588. Persistence boundaries differ inside B5: 585 is device-local, 584 and 586 are profile fields, 582 and 583 are migrations with `.bin` round-trip consequences. |
| UI-B7 (integrated S2 acceptance) | NO RECORD | No integrated-acceptance step exists in any row. |
| UI-B8 (S3 Studio) | INCOMPLETE | S3 has 570, 571, 572 plus sub-items. 572's consumers include S2 and S0, so a Studio-batch placement delays a host that S2 needs (INFERRED). |
| UI-B9 (S4 Home, navigation, library, Trash) | INCOMPLETE | Needs CHORE-584, the Back decision, and CHORE-172's 30-day Trash. |
| UI-S5, UI-S6 parallel | PARTIAL | S6 follows UI-S0 only. S5 has no stated prerequisite. No record supports the claim that either affects Utility correctness. |

### A regrouping, by persistence boundary (proposal labels PB-1 to PB-8; not allocated IDs) [C]

This is a planning suggestion. It does not change any row and creates no ticket.

| Proposal label | Tickets | Boundary it respects | Why |
|---|---|---|---|
| PB-1 S1 chat runtime | 563 (chat half), 569, 565 | chat fields | one UI surface; separate homes still reviewed per ticket |
| PB-2 S1 stored state | 564, 566, 567 (location first), 568 | per-chat variables, a favourites store, location open, character field | the homes differ; keep review boundaries per home (MC-892 item 8) |
| PB-3 S2 presets | 573, 574, 575, 576 | preset format and the preset undo store | 576 needs a Note 9 save-cost check |
| PB-4 S2 sharing | 577, 580 | bundle format and key stripping | 580 touches 577's format |
| PB-5 S2 connections | 578, 579, 581 | connections store and key references | 579 after 578 |
| PB-6 S2 profile fields and migrations | 582, 583, 584, 586 | profile fields; `.bin` round-trip | 584 has a Home consumer |
| PB-7 S2 device-local | 585 | device-local | different boundary from every other S2 ticket |
| PB-8 S2 backup, restore, export | 562, 587, 588 | export content, safety snapshot, settings file | |

Stage-spanning tickets (570, 571, 572) stay in the S3 stage and need the Q8 rule. Mismatches this regrouping does not fix: 573's S1 chip, 584's S4 consumer, and whether S2 and S4 share one 30-day mechanism.

Persistence-boundary labels follow the rows. The Roadmap note on the homes for CHORE-564 to 568 says they are "INFERRED from the rows and the designer confirms them" (UNCERTAIN until designed).

## 6. Load-bearing risks (from d-queue)

- The Back mechanism decision (S4 sizing) is unresolved while S1 to S3 add screens.
- Cross-stage couplings the stage rows do not capture: 568 (setter S3, consumer S1), 572 (host needed by S2, S0, S3), 584 (S2 to S4), 573 (S1 chip).
- THEMING enforcement rests on a validator not yet in `src/` and not wired to an installer (UI-S6). Plugin isolation is unaddressed.
- The selectors named by "generic global selectors" in `pattern-dialog.css` were not re-located: UNKNOWN. Settles it: `Grep data-low-power` in that file.
- Sizing text for UI-S1 to S6 does not exist (the Roadmap sizing TODO for UI-S1 to S6).
