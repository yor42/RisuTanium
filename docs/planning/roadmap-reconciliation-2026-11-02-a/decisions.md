# Decisions for the maintainer

Status: proposal only. Nothing here is decided. Every label such as "Q1" is a label of this file, not an allocated ID. Evidence snapshot: packets at HEAD `52c4f0516`; HEAD is now `ea14314bd` (records only, see `README.md`).

Nine questions (Q1 to Q9; the MC-890 item 3 cap is ten). Each can be sent as a multiple-choice question. The recommended option is first. The former Q10 (Live-State archival) moved to the note after Q9, because it applies existing policy; Q1 to Q9 keep their numbers.

## Q1. Unadvertised `tool_use` on the Anthropic non-streaming path (top request)

What was found (static reading only; nothing was executed; no live exploit is claimed):
- `anthropic.ts:1137-1139` is the only one of seven `callTool`/`callMCPTool` sites with no requirement that the called tool was advertised. The other five provider sites require a match; the seventh is the Playground page (a-verify, coverage COMPLETE for `src`).
- Utility sends `tools: []`, so a well-behaved provider never returns a tool call. A non-conforming endpoint can. The dispatch then reaches `internal:risuai` read tools, which have no confirmation, and can spawn already-approved stdio programs of the selected character's modules.
- Utility is non-streaming on an Anthropic-format model unless the user switched Response Streaming on. `useStreaming` has no default seeding (a-verify, and lane A's own spot check).
- Writes still prompt. Read tools do not. Reads cover any character by id or name, not only the selected one.
- A related inference, not executed: a plugin holding only the `replacer` grant could rewrite a non-streaming Anthropic body to add `tools`, and so reach the same reads (a-verify N1).

Question: what should happen now?

| Option | What it means | Consequence |
|---|---|---|
| A (recommended) | Authorise one bounded investigation. Synthetic input, stubbed fetch, scratch only, no live provider call. It confirms or refutes the dispatch, the read prompts, the loop bound and Stop behaviour, and the plugin variant (N1). No fix, no ticket change yet. | Cheap. Turns a static trace into evidence. The fix decision comes after the result. |
| B | Skip the investigation and authorise a guard in `anthropic.ts` that rejects a tool with no advertised match, matching the other providers. | Faster. A change to a single enforcement point, so it needs the independent review that `gates.md:10` (MC-912) requires. The cause of the plugin variant stays unconfirmed. |
| C | Record the finding against CHORE-617 and act when tools are designed. | Leaves the path open on a default-non-streaming setup. Not recommended while Utility is merged. |

Category: amendment requiring approval (opens work); the underlying rule ("authorise tools at the execution boundary") is the external proposal's invariant 3 and has no MC. Nothing is opened by this file.

## Q2. Should a Utility run be exempt from V3 body interceptors?

Fact: any installed, enabled V3 plugin holding the `replacer` grant and calling `registerBodyIntercepter` sees and can replace every provider request body, Utility included. The callback gets `(body, label)`; nothing marks the run as Utility. Matches the same population that already sees every RP body (a-verify section 2). MC-934 Q3 decided only the before and after request hooks and MC-937 the plugin model providers. No MC mentions interceptors. The code comment `utilityConversation.svelte.ts:12-16` says plugin hooks cannot reach the body, which is not true for interceptors.

| Option | Consequence |
|---|---|
| A (recommended) | No exemption now. Narrow the comment and any user-facing wording to "no before/after request hooks and no plugin model providers". Revisit with CHORE-617. | No new plugin-visible API. Plugins can still read Utility prompts. |
| B | Exempt Utility, with a run type the callback can see or a flag that skips interceptors. | Real isolation. Adds plugin API surface and a compatibility question for upstream plugins (MC-175). |
| C | Exempt only the follow-up bodies of the tool loop. | Narrow, but depends on Q1 and may be moot after a guard. |

Category: A is a proposed clarification (wording). B and C are amendments requiring approval.

## Q3. Who rules that CHORE-205's device evidence meets the MC-920 bar?

Fact: MC-920 defines "CHORE-205 done" as "device cases only". Record state: items 1 to 4 of the adopted criterion passed with n=2; item 6 (export) NOT REACHED; steps 12, 13, MC-670 and M9 are called accepted gaps (the CHORE-205 Roadmap row). The row itself says the ruling is "not decided here: TODO(evidence)". CHORE-205 is the only UI-S1 entry item without a disposition.

| Option | Consequence |
|---|---|
| A (recommended) | Run the missing export step (item 6) inside the next planned device session, together with the CHORE-396 forced-GC check, then rule. | One extra step in a session that is needed anyway (batched, per `gates.md:58`). Gives a clean ruling. |
| B | Rule now that the current evidence meets the bar and name item 6 as an accepted gap. | Fastest. Leaves an export check unobserved on the device. |
| C | Re-scope the bar. | Amends MC-920. |

Category: A and B are existing policy applied (MC-920 says device cases only); C is an amendment.

## Q4. Which unresolved harvest items gate the MVP refresh?

Fact: MC-983 item 3 says data loss "actually reachable in normal use" gates the refresh. Unresolved and unfixed: #553, #584 (needs Safari/macOS), #596 (Android chat hang, needs a Note 9 run), #230, #681, #718. The Roadmap calls their status unclear (c-gates section 2).

Applying MC-983 item 3 to #553, #584, #230, #681 and #718 (classify when a reproducer exists; only a reproduced normal-use loss gates) is existing policy, so it is not asked. The question is only how to classify the #596 hang.

| Option | Consequence |
|---|---|
| A (recommended) | Classify each item only when a reproducer exists, #596 included. Only a reproduced normal-use loss gates. The rest are recorded as non-gating with the missing observation named. | Keeps the refresh moving and follows the wording of MC-983. Some hangs stay unexamined. |
| B | Treat #596 as gating until a Note 9 run classifies it, others as A. | Safer for the daily phone. Costs a device run. |
| C | Treat all six as gating. | Likely stalls the refresh with no deadline pressure (MC-979 says none). |

Category: existing policy applied (MC-983); B and C narrow or widen it, which needs your approval.

## Q5. When may Utility work resume relative to the UI stages?

Fact: no record ties Utility to UI-S6 or UI-S4. The phrase "following the current conservative ordering" in the external proposal's D-01 has no record behind it. CHORE-616 S2 is already merged. CHORE-617 waits on your answers to sizing decisions 5, 8 and 9, not on a UI stage.

| Option | Consequence |
|---|---|
| A (recommended) | Analysis, diagnostics and CHORE-617 sizing may proceed now. Utility implementation that touches UI starts after UI-S4 acceptance. UI-S5 and UI-S6 proceed separately. | Avoids migrating new Utility screens during UI-S1 to S4 (MC-890 item 4 migrates surfaces per stage). Keeps the engine analysis moving. |
| B | Nothing Utility-related until UI-S6. | Slowest. No authority requires it. |
| C | No linkage. Utility proceeds in parallel under the one-writer rule. | Fastest. Adds rework risk for UI-S4 Home (the Utility card). |

Category: A, B and C are all scheduling amendments requiring approval. No existing policy sets this.

## Q6. Is a bounded cross-mode seam note required before UI-S1 sizing?

The note would cover six seams only: navigation ownership, renderer and composer, status and approval containers, extension parts, platform capability reporting, persistence ownership. See `proposal.md` section 5.

| Option | Consequence |
|---|---|
| A (recommended) | Yes. One bounded note, questions and constraints only, no new design package, produced as input to UI-S1 sizing. | Small cost. UI-S1 is gated anyway by CHORE-205. Reduces rework risk the external proposal names. |
| B | No. Let UI-S1 sizing raise seams as they appear. | No extra work. Risk of reworking S1 screens later. |
| C | A full cross-mode contract before UI-S1. | The external proposal's wording; prompt item 6 says to keep it bounded. Not recommended. |

Category: proposed clarification (A, B); amendment (C).

## Q7. When is the Back mechanism decided?

Fact: MC-892 item 3 decides one Back mechanism for all new screens and Android, at UI-S4 sizing. UI-S1 to S3 add screens before that. Whether they may ship first is UNKNOWN (d-queue).

| Option | Consequence |
|---|---|
| A (recommended) | Decide it at UI-S1 sizing, because S1 adds the first new screens. | Amends the timing of MC-892 item 3. Avoids per-screen Back behaviour that S4 must undo. |
| B | Keep it at UI-S4. S1 to S3 use the existing per-screen behaviour and S4 migrates. | No amendment. Possible rework in S4. |
| C | Block new screens before UI-S4. | Not workable: S1 to S3 are screens. |

Category: A is an amendment (timing); B is existing policy.

## Q8. Rule for tickets whose consumer comes in an earlier stage than the setter or host

Examples (d-queue): CHORE-568 (set in Studio S3, read in chat S1); CHORE-572 toast host (stage S3 row, consumers in S0, S2, S3); CHORE-573 (S2 row, chip in S1); CHORE-584 (S2 fields, Home in S4). The rows give no default or order.

| Option | Consequence |
|---|---|
| A (recommended) | The stage plan for the consumer names the default when the setter does not exist yet (for 568: field absent means off), and a host ticket (572) is staged with its first consumer. | No re-staging of rows. Each default is a one-line plan item. |
| B | Re-stage setters and hosts ahead of consumers. | Cleaner order. Changes the stage rows. |
| C | Leave open until each stage's sizing. | The risk is found late. |

Category: A is a proposed clarification; B amends stage rows.

## Q9. Which home should Workspace sizing assume?

Fact: no MC settles any Workspace persistence rule (index search found none; MC-933 chose ephemeral conversations first). Observed constraints: `internal:fs` is Chromium only (`showDirectoryPicker`), the Tauri fs scope excludes project folders, and a character-free persistent chat would need a new shard type (c-gates section 5, CHORE-617 row). This question picks an assumption for sizing only. It adds no schema.

| Option | Consequence |
|---|---|
| A (recommended) | Size a record in the existing store2 world first (shape not designed here). Fork-only data follows the settled MC-774 rule: kept in store2/`.rtb`, left out of `.bin` with a warning that names it. | Platform reach is open: MC-933 decision 2 is desktop first, and whether Workspace exists on Android is an open question (`proposal.md` section 8.2 item 4). Backup, trash and Android forward-migration rules (MC-350) still need their own answers in sizing. |
| B | Size a filesystem folder first. | Desktop-only at first. External file lifecycle becomes the main risk. |
| C | Size a staged hybrid. | The most to design before any user value. |

Category: proposed clarification; the open Workspace questions stay questions (`proposal.md` section 8).

## Note: records housekeeping under existing policy (formerly Q10)

This is not a product or error-behaviour choice, so it is not a question. It needs your instruction to schedule. Q10 moved here; Q1 to Q9 are not renumbered.

Fact (e-workflow): the real gap is that `Agents/Live-State.md` does not follow MC-321 item 4 (`records.md:25`). It was about 114 KB at the packet snapshot and 117,465 bytes at `ea14314bd` (`git cat-file -s`); the count method for its "Superseded" bullets is not stated; the packets reported no archive since about batch 14 and a pointer in line 7 to a 2026-10-21 handoff. Recommended: apply the existing rule (archive the superseded Live-State bullets byte-preserved, correct line 7) in a records batch, measuring file size and Read tokens before and after; no savings are claimed beyond what is measured. Existing policy applied [E].

Three smaller clarifications are also possible and would edit governance files, so each needs your explicit instruction [C]: a combined-Gate-1 sentence in `routing.md` (W-01), a CONFIRMED or UNVERIFIED label in `review-change/SKILL.md` (W-05), and a device-check-owed sentence in `records.md` (W-07). Batching, one full-check owner, targeted remediation and parallel limits already exist (MC-888, MC-894, `gates.md:29`, `ownership.md:7-11`).

## Questions dropped because an MC already settles them

| Question in the external proposal | Settled by |
|---|---|
| D-07 whether Utility data is in `.bin` | MC-685 and MC-774: fork-only data stays in store2/`.rtb` with a warning naming the omission. |
| D-07 task presets and CHORE-128 | MC-936 item 3 (release gate on CHORE-128). Not a UI-S1 or MVP-refresh gate. |
| Task-preset import and recovery | MC-934 Q1, MC-936 item 1, MC-937 Q16, MC-938 Q17. |
| D-09 mobile scope for the first slice | MC-933 decision 2: desktop first. |
| D-10 batch governance | MC-888 item 2, MC-894, MC-895, MC-899 and `gates.md`/`ownership.md`. |
| Whether Utility has tools in the first slice | MC-933 decision 1: no tools. |
| Plugin model providers in Utility | MC-937: refused. |
| MVP-refresh gate list | MC-979, MC-983, MC-984 item 2, MC-986 item 4. |
| UI-S1 entry gate list | MC-516, MC-890 item 4, MC-920. |
| CHORE-624 device follow-up | You chose a one-run device check of the cause before any fix (MC-995, MC-996). |
| Backup compatibility policy | MC-175, MC-223, MC-350, MC-477, MC-774. |

## Questions kept out of this list on purpose

- Tool permission default and scope, instruction-file scope, MCP or stdio in presets: these are CHORE-617 sizing decisions 5, 8 and 9. They are already open and recorded. Ask them at CHORE-617 sizing, not now.
- Whether the MC-899 reading retires the fresh-arbiter rule in MC-785: an internal tension in `routing.md:53` against `routing.md:69` and `gates.md:11` (e-workflow). It is unrelated to the external proposal. UNKNOWN; raise it only if you want it.
