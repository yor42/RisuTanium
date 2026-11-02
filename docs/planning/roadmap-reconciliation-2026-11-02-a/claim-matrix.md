# Claim matrix: the external proposal against the checkout

Status: proposal only. Verification: see `README.md`.

Source of the claim list: `f-claims` (330 rows, numbered C-001 to C-330, line numbers from ripgrep on the external proposal). `f-claims` classified nothing. Classifications below come from the other packets: `a-isolation`, `a-verify`, `b-reuse`, `c-gates`, `d-queue`, `e-workflow`, `g-interop`. Snapshot of the packets: HEAD `52c4f0516`.

## Legend

| Class | Meaning |
|---|---|
| VERIFIED | A packet found it true in code, records or primary documents. |
| WRONG | A packet found it false. |
| STALE | True once, no longer. |
| OVERSTATED | Partly true; the claim goes beyond the evidence. |
| INCOMPLETE | True as far as it goes; omits something that matters. |
| PROPOSED | A recommendation, vision or assessment. It is not a checkable fact and no MC settles it. |
| UNKNOWN | No packet checked it. The "settles it" column says what would. |

Evidence kinds: OC = observed code (a packet author read it; static). PR = previously reported check (record named). DR = diagnostic run (none were run for this folder). REC = recommendation or opinion.

## Accounting

| Set | Raw count (f-claims) | Listed here | Status |
|---|---|---|---|
| FACT rows | 97 | 97, individually (section 2) | COMPLETE |
| DECISION REQUEST rows | 13 | 13, individually (section 1) | COMPLETE |
| RECOMMENDATION rows | 184 | grouped by id range (section 3) | COMPLETE as groups; most rows are not individually classified |
| PRODUCT VISION rows | 36 | grouped (section 3) | COMPLETE as a group |

Total 330. The DECISION REQUEST ids are C-021, C-119, C-290, C-291, C-293, C-295, C-296, C-297, C-298, C-300, C-302, C-304, C-305.

## 1. Decision requests (13)

| Rows | Request | Class | Evidence | Kind | What settles the rest |
|---|---|---|---|---|---|
| C-021 | scheduling change needs approval | PROPOSED | No record sets Utility after UI-S6 or UI-S4 (grep of Roadmap, Maintainer-Context, Live-State: 0 hits). Option B is proposed in the external 8.4 itself. d-queue section 3. | OC (grep) | maintainer choice, `decisions.md` Q5 |
| C-119 | combined-mode needs separate decisions | PROPOSED | No MC. Consistent with MC-933 (no hidden character, no tools). | REC | none needed now |
| C-290 | present choices as bounded requests | PROPOSED | Matches MC-890's question cap. | REC | n/a |
| C-291 (D-01) | Utility start: after UI-S6 or after UI-S4 | UNPROVEN (OVERSTATED as "current conservative ordering"): no record orders Utility after UI-S6 or UI-S4; CHORE-616 S2 merged while UI-S1 has not started | d-queue section 3. Counter-fact: CHORE-616 S2 merged (`502190194`) while UI-S1 has not started. | OC (records) | `decisions.md` Q5 |
| C-293 (D-02) | first Workspace model | PROPOSED, partly constrained | MC-933 decision 3: ephemeral first. CHORE-617 holds the project folder as TODO. Platform limits: `internal:fs` Chromium-only, Tauri fs scope excludes project folders. c-gates sections 5 and 6. | PR | `decisions.md` Q9 |
| C-295 (D-03) | instruction scope and precedence | PROPOSED, recorded as open | sizing decision 8 (instruction-file scope) open under CHORE-617. Literal instructions only for presets (MC-934 item 4). | PR | CHORE-617 sizing |
| C-296 (D-04) | tool permission defaults | PROPOSED, recorded as open | sizing decision 5 open. Utility first slice has no tools (MC-933 decision 1). Current consent covers stdio spawn only (`stdioApproval.ts`, `mcp.ts:354-358`). | OC, PR | CHORE-617 sizing |
| C-297 (D-05) | MCP scope | PROPOSED, recorded as open | sizing decision 9 (MCP or stdio in presets). b-reuse inventory exists. | OC, PR | CHORE-617 sizing |
| C-298 (D-06) | OpenCode compatibility level | UNKNOWN as to any MC; PROPOSED | No MC found (c-gates did not search beyond the index). g-interop shows skills and plugins are different trust classes. | OC (documents) | decide when Skills are sized |
| C-300 (D-07) | where Utility data lives, backup, `.bin`/`.rtb` | PARTLY SETTLED | MC-685, MC-774 (fork-only data stays in store2/`.rtb`, omissions named), MC-933 decisions 3 and 5, MC-936 item 3. Open: Workspace persistence (seven questions in `proposal.md` section 8). | PR | `decisions.md` Q9 |
| C-302 (D-08) | module packaging | PROPOSED | No MC. | REC | later |
| C-304 (D-09) | mobile scope | PARTLY SETTLED | MC-933 decision 2: desktop first for the first slice. Later platforms open. | PR | later |
| C-305 (D-10) | when tickets may share gates | PARTLY SETTLED | MC-888 item 2 (one combined pass per batch), MC-894 (combined Gate 2), `gates.md:29`, `ownership.md:7-11`. The combined Gate 1 wording lives only in MC-888 (e-workflow W-01). | PR | `decisions.md` records-housekeeping note (formerly Q10, moved out of the question list) |

## 2. FACT rows (97)

### 2.1 Utility baseline (10 rows: C-003, C-004, C-052 to C-059)

| Rows | Claim | Class | Evidence | Kind |
|---|---|---|---|---|
| C-052 | independent request entry path | VERIFIED | `utilityConversation.svelte.ts:199-211` calls `requestChatDataMain`, skipping the `requestChatData` wrapper. | OC |
| C-053 | saved task presets | VERIFIED | `utilityConversation.svelte.ts:160-168`; MC-933, MC-934. | OC, PR |
| C-054 | per-run identity and cancellation | VERIFIED at the run layer; INCOMPLETE | The non-streaming Anthropic fetch passes no abort signal (`src/ts/process/request/anthropic.ts:1078-1085`; the repository also has `src/ts/model/providers/anthropic.ts`), so Stop does not cancel it (a-verify N2). `utilityRuns.svelte.ts` internals not read. | OC |
| C-055 | runs execute alongside RP | VERIFIED by decision, not by runtime | MC-933 item 6; separate run id. Runtime concurrency not verified (a-isolation). Shared state exists: global settings, fetch logs, keep-alive slot with `claudeRetrivalCaching` (a-verify N4). | OC, PR |
| C-056 | conversation context deliberately isolated | VERIFIED for prompt content | `utilityPrompt.ts:15-24`; no `subject`, no `currentChar` passed. | OC |
| C-057 | no implicit access to characters, personas, lorebooks, triggers or plugin hooks | OVERSTATED | True for prompt assembly, lorebook, persona, triggers and before/after hooks. WRONG for V3 body interceptors (`globalApi.svelte.ts:3365-3374`, `4516-4527`). The execution scope leaks the selected character's module set and `internal:risuai` on the unguarded Anthropic path. | OC |
| C-058 | desktop-first, ephemeral, no tools | VERIFIED as product; INCOMPLETE as enforcement | MC-933. "No tools" means none advertised, not an enforced guarantee on the Anthropic non-streaming path. | OC, PR |
| C-059 | consistent with MC-933, not accidental | VERIFIED | MC-933 and MC-934 items; MC-937. | PR |
| C-003 | "minimal and isolated from the RP engine" | OVERSTATED | Same as C-057. | OC |
| C-004 | an appropriate foundation (assessment) | PROPOSED | Opinion. | REC |

### 2.2 Sequence, gates, schedule (10 rows: C-017, C-184 to C-188, C-191, C-203, C-204, C-301)

| Rows | Claim | Class | Evidence | Kind |
|---|---|---|---|---|
| C-017 | sequence Stabilization, MVP update, UI Overhaul, Utility expansion "already established" | INCOMPLETE | MVP refresh before the UI overhaul is the plan in MC-979. UI-S1 and later wait for MC-516 (MC-890 item 4). "Then Utility expansion" is not recorded; CHORE-616 S2 already merged. | PR |
| C-184 | UI-S1 to S4 are the primary shared UI foundation | PROPOSED | The external reading of the plan. No record uses that phrase. | REC |
| C-185 | UI-S1 is the chat shell | VERIFIED by ticket mapping | CHORE-563 to 569 are chat tickets (the CHORE-563 to CHORE-569 Roadmap rows). | PR |
| C-186 | UI-S2 is settings and models | VERIFIED by ticket mapping | CHORE-573 to 588 are Settings and Models. | PR |
| C-187 | UI-S3 is Studio | VERIFIED by ticket mapping | CHORE-570 to 572. | PR |
| C-188 | UI-S4 is home, navigation, library | VERIFIED by ticket mapping | The UI-S4 Roadmap row (Home, Trash, Back mechanism). | PR |
| C-191 | the 8.4 change is a proposal, not a decision | VERIFIED | d-queue section 3. | PR |
| C-203 | MVP `7928b5bb1` on 2026-10-31 | VERIFIED | MC-922; `Live-State.md:9`. Hash as the maintainer gave it. | PR |
| C-204 | that is no evidence newer changes reached the device | VERIFIED | MC-979 note; Roadmap batch 35. | PR |
| C-301 | CHORE-128 release dependency for stored task presets | VERIFIED | MC-936 item 3; the CHORE-128 Roadmap row. Release-only; not a UI-S1 or MVP-refresh gate. | PR |

### 2.3 Compatibility (8 rows: C-043 to C-050)

| Rows | Claim | Class | Evidence | Kind |
|---|---|---|---|---|
| C-043 | upstream compatibility vs fork-specific functionality distinguished | VERIFIED | `AGENTS.md`; MC-175, MC-774. | PR |
| C-044, C-046 | upstream-compatible data and presets, modules, plugins keep working | VERIFIED | MC-175 (V2.1 plugin execution excepted: MC-349, MC-504). | PR |
| C-045 | fork-specific data must not silently corrupt upstream exports | VERIFIED | MC-223, MC-774. | PR |
| C-047, C-048, C-049 | Android data survives upgrades; automatic forward migration; unreadable data kept | VERIFIED | MC-350; MC-922 says the carry-forward applies. MC-470 item 2 is partly overtaken, UNCERTAIN how much. | PR |
| C-050 | "relevant decisions include MC-175, MC-223, MC-350, MC-774" | INCOMPLETE | Omits MC-477 (encrypted risuai.xyz refusal) and the task-preset exceptions MC-934, MC-936, MC-937, MC-938. | PR |

### 2.4 Memory (8 rows: C-062 to C-069)

| Rows | Claim | Class | Evidence | Kind |
|---|---|---|---|---|
| C-062 | multiple memory mechanisms exist | VERIFIED | `hypamemory.ts`, `hypav2.ts`, `hypav3.ts`, `hanuraiMemory.ts` exist (b-reuse). | OC |
| C-063 SupaMemory | exists | VERIFIED (existence only) | `src/ts/process/memory/supaMemory.ts` and `supaMemory.test.ts` exist; `supaMemoryKey` is read in `hypamemory.ts`, `hypamemoryv2.ts`, `hypav2.ts` and `hypav3.ts`. Behaviour not traced. | OC |
| C-064, C-065, C-066, C-067 | HypaMemory, V2, V3, Hanurai exist | VERIFIED | As C-062. | OC |
| C-068 | contextual embedding support | VERIFIED | voyage-context-3 in `contextualEmbedding.ts:27`, dispatched from `hypamemoryv2.ts:492-493`. | OC |
| C-069 | `HypaProcessorV2<TMetadata>` gives reusable embedding and similarity-search primitives with metadata | OVERSTATED | Brute-force search returning every vector sorted; metadata returned, not queryable; instance `Map`; one global content-keyed cache; no namespace, no delete; one non-test consumer (`hypav3.ts:646`). The older `HypaProcesser` serves V2 and Hanurai. | OC |

### 2.5 Design and theme (13 rows: C-025, C-072 to C-082, C-173)

| Rows | Claim | Class | Evidence | Kind |
|---|---|---|---|---|
| C-025 | review drew on 17 listed paths including `src/ts/process/utility/` and `src/ts/process/memory/` | VERIFIED: all 17 listed paths exist at HEAD (content not audited) | Author check: both source directories exist; `utilityConversation.svelte.ts` is under `src/ts/process/utility/`. `docs/design` has THEMING, DECISIONS, ENGINE_CHANGES (also listed). a-isolation notes `utilityGate.ts` is in `src/lib/Utility/`, which concerns only that file. The independent verifier ran `Test-Path` on all 17 paths named in the external section 2 and all returned True. | OC |
| C-072 | an unusually developed foundation (assessment) | PROPOSED | Opinion; specification is real, enforcement is not (below). | REC |
| C-073 tokens, C-074 data-part, C-078 protected surfaces, C-080 fail-closed validation | defined by the theme architecture | VERIFIED as specification; STALE or OVERSTATED as a delivered capability | `THEMING.md:11,30-39`. The validator lives only in `docs/design/` (`packlint.mjs`, `failclosed.mjs`, `run.mjs`). No `src` file references it. `data-part` appears in `src` only in seven unmounted Nexus files (91 occurrences). Porting waits for UI-S6 (MC-891 item 1). | OC |
| C-075 part-scoped styling, C-076 layout and input attributes, C-077 reduced motion, C-079 contrast and geometry validation, C-081 reference reskins | defined by the theme architecture | UNKNOWN | d-queue read `THEMING.md` only at lines 11 and 30 to 39 and its plugin grep. Settles it: read the rest of `THEMING.md` and the reskin folders. | OC |
| C-082 | the assets are real, not mockups (assessment) | OVERSTATED | Specification and design-side validator are real; nothing is enforced in `src/` and the UI-S0 components are mounted nowhere. | OC |
| C-173 | docs/design and applicable MC decisions govern the overhaul | VERIFIED with a condition | MC-890: per-surface DD/DS adoption; uncited imported decisions stay advisory. `docs/design/README.md` does not exist. | PR, OC |

### 2.6 Workflow (25 rows)

| Rows | Claim | Class | Evidence | Kind |
|---|---|---|---|---|
| C-033, C-034 | independent plan and implementation reviews; high-risk persistence review | VERIFIED | `gates.md:3,10`; `AGENTS.md`. | PR |
| C-035 | reproducers vs compatibility guards | VERIFIED | `AGENTS.md`; `gates.md:37`. | PR |
| C-036 | mutation verification | VERIFIED | `gates.md:47`; MC-239 note in `AGENTS.md`. | PR |
| C-037 | final integrated-snapshot testing | VERIFIED | `gates.md:29`. | PR |
| C-038 | dedicated mobile-device validation | VERIFIED | `gates.md:55-58`. | PR |
| C-039 | explicit write ownership | VERIFIED | `ownership.md:7-11`. | PR |
| C-040 | maintainer-controlled decisions | VERIFIED | `AGENTS.md`. | PR |
| C-031, C-032, C-041, C-085 | strengths and value (assessments) | PROPOSED | Opinion. | REC |
| C-084 | roles separated | VERIFIED | `routing.md` roles (designer never reviews). | PR |
| C-103, C-104, C-255, C-258, C-262 | tickets duplicate investigation, review and full checks (assessments) | UNKNOWN as to current effect | e-workflow: batching and a combined Gate 2 exist since 2026-10-30 (MC-888, MC-894). The audit window ended 2026-10-28, so whether overhead persists is unmeasured. Settles it: rerun the audit definitions on lane A transcripts from 2026-10-30 on. | PR |
| C-106 | broad historical loading is inefficient (assessment) | VERIFIED as an observation | `Live-State.md` 114,406 bytes, 106 lines, 67 "Superseded" bullets; the Read tool refused it at 28,347 tokens. | OC |
| C-107 | indexes, handoffs and archival exist | VERIFIED but archival has stopped | Decision-Index 881 rows; archive files exist; no archive since about batch 14. | OC |
| C-266 | consistent with final-snapshot testing | VERIFIED | `gates.md:29`; MC-694. | PR |
| C-272 | evidence and instructions differ | PROPOSED | A truism. | REC |
| C-280 | consistent with `records.md` | VERIFIED | `records.md:3`. | PR |
| C-288, C-289 | the review table is a clarification; existing gates remain | VERIFIED | Self-description; the table duplicates existing rules (e-workflow section 12). | PR |

### 2.7 Integration mechanisms (9 rows)

| Rows | Claim | Class | Evidence | Kind |
|---|---|---|---|---|
| C-095 | MCP, skills, native plugins and OpenCode plugins are different mechanisms | VERIFIED | g-interop. | OC (documents) |
| C-097 | MCP exposes capabilities by protocol | VERIFIED | g-interop. | OC (documents) |
| C-098 | skills are portable instructions plus resources | VERIFIED | g-interop. | OC (documents) |
| C-099 | OpenCode plugins run JS/TS hooks | VERIFIED | g-interop. | OC (documents) |
| C-100 | RisuTanium plugin APIs have their own lifecycle | VERIFIED | V3 `getPermission` grants and `registerBodyIntercepter` (a-verify). | OC |
| C-101 | loading arbitrary OpenCode plugins would be risky (assessment) | PROPOSED | Plausible; g-interop shows npm plugins are installed with Bun at startup. | REC |
| C-153 | existing MCP code is not a complete host | VERIFIED but understates | A working tool client exists (HTTP/SSE, stdio, internal, OAuth, prompts); no resources, no per-tool policy, no abort. b-reuse R1. | OC |
| C-157 | skill scripts are executable content | VERIFIED | g-interop. | OC (documents) |
| C-167 | OpenCode plugins cannot be assumed to run unmodified in a Svelte or Tauri frontend | UNKNOWN | g-interop shows they are Bun-installed JS/TS in OpenCode's runtime; running them in this frontend was not examined. | REC |

### 2.8 CHORE-617, UI R-items, assessments (8 rows)

| Rows | Claim | Class | Evidence | Kind |
|---|---|---|---|---|
| C-087 | the overhaul is built on existing RP and app surfaces | VERIFIED | The UI epic and UI-S0 to UI-S6 Roadmap rows. | PR |
| C-089 | late Utility requirements could force UI rework (conditional) | UNKNOWN | Plausible; no packet measured it. Settles it: the seam note. | REC |
| C-092 | CHORE-617 groups project folders, instruction discovery, Skill loading, tool permissions, mutating tools | VERIFIED (wording looser) | The CHORE-617 Roadmap row title: "project-folder workspace and tools (AGENTS.md/SKILL.md discovery, tool permission gate, mutating tools)". "Skill loading" is the external's phrase for SKILL.md discovery; the row records no loader design. Open sizing decisions 5, 8, 9 (tool permission, instruction scope, MCP or stdio in presets). | PR |
| C-093 | the pieces have distinct security models (assessment) | PROPOSED | Supported by b-reuse 3.2. | REC |
| C-110 | designing everything first adds complexity (assessment) | PROPOSED | Opinion; matches prompt item 6. | REC |
| C-002, C-326, C-327 | infrastructure exists; risks are coordination and sequencing (assessments) | PROPOSED | Opinions. The infrastructure part is supported by sections 2.1 to 2.4. | REC |

### 2.9 Self-descriptions (6 rows)

| Rows | Claim | Class | Evidence |
|---|---|---|---|
| C-024, C-029, C-030, C-316 | document status, scope and method, non-authority | UNKNOWN (not repository claims) | Taken as stated. The document is advisory and supersedes no MC (`AGENTS.md`). |
| C-026 | five external references | UNKNOWN | Not checked. |
| C-027 | no build, test or device verification was performed | VERIFIED as a limit | Stated by the document. |

Rows accounted for in section 2: C-002 to C-004, C-017, C-024 to C-027, C-029 to C-041, C-043 to C-050, C-052 to C-059, C-062 to C-069, C-072 to C-082, C-084, C-085, C-087, C-089, C-092, C-093, C-095, C-097 to C-101, C-103, C-104, C-106, C-107, C-110, C-153, C-157, C-167, C-173, C-184 to C-188, C-191, C-203, C-204, C-255, C-258, C-262, C-266, C-272, C-280, C-288, C-289, C-301, C-316, C-326, C-327. That is 97 ids.

## 3. Recommendation and vision rows (grouped)

These rows are not checkable facts. Where a packet gives evidence it is named. Otherwise the class is PROPOSED.

| Rows | Subject | Class | Evidence or note |
|---|---|---|---|
| C-001, C-016, C-325, C-328 to C-330 | verdict, conclusion, strategy | PROPOSED | Opinion. "No wholesale rewrite" matches `AGENTS.md`. |
| C-005 to C-015, C-088, C-109, C-112 to C-125, C-217 to C-219, C-224 to C-226, C-236 to C-238, C-243 | product vision (36 rows) | PROPOSED | No MC. |
| C-018 | preserve the top-level sequence | INCOMPLETE | See C-017. |
| C-019, C-090, C-176 to C-178 | define a cross-mode contract before UI-S1 | PROPOSED | No record schedules it, no ticket. Prompt item 6 requires it be bounded. See `proposal.md` section 5. |
| C-020, C-189, C-190, C-245 | start Utility after UI-S4; S5 and S6 separate | PROPOSED | The only source is the external proposal. S6 follows UI-S0 only (the UI-S6 Roadmap row). S5 has no stated prerequisite. |
| C-022, C-023, C-086, C-105, C-251, C-256 to C-261, C-263 to C-265, C-267 to C-271, C-273 to C-279, C-281 to C-286 | workflow rules W-01 to W-09 | Mostly existing policy | e-workflow: W-02, W-03, W-04, W-08 are existing; W-01, W-05, W-07 partly; W-06 existing but unfollowed; W-09 existing with a tooling gap. See `proposal.md` section 10. |
| C-277 | ten status states | PROPOSED, not adopted anywhere | Existing practice is `records.md:3`. A device-owed state is the only gap. |
| C-287 | risk-based review table | duplicates existing rules | e-workflow section 12 review. |
| C-042 | preserve review principles | PROPOSED | Matches `AGENTS.md`. |
| C-051, C-060, C-061, C-091, C-094, C-096, C-102, C-126, C-127, C-133 to C-137 | extend compatibility to Workspace; keep isolation as an invariant; narrow interfaces; do not build a second design project; split CHORE-617; concept list | PROPOSED | C-060 is not an existing MC. MC-933 only decided the first slice. |
| C-070, C-071 | extract memory capabilities only when needed; no RP rewrite | PROPOSED | Consistent with b-reuse; CHORE-619 to 621 are open. |
| C-128 to C-132 | Layers A to E | PROPOSED | No record. |
| C-138 to C-147 | ten invariants | PROPOSED | Invariant 3 (authorise at the execution boundary) is the one the Q1 finding tests: it is not currently true on the Anthropic non-streaming path. Invariant 7 matches MC-350 for Android. |
| C-148 to C-152, C-154 | MCP first-class and phased; target capabilities; boundaries | PROPOSED | Partly present: transports and prompts exist. Resources, per-tool policy, abort, workspace scoping do not. C-154 is structurally true for HTTP and stdio clients (they receive only tool arguments) but not for internal clients. |
| C-155 to C-160 | skills: progressive loading, scripts disabled | PROPOSED | g-interop supports the premise. |
| C-161 to C-169, C-171, C-172 | OpenCode tiering, native plugins | PROPOSED | No MC. |
| C-170 | preserve existing plugin and module behavior | VERIFIED as policy | MC-175. |
| C-174, C-175, C-179 to C-183 | UI requirements, token contract, reskin tests, malicious theme values | PROPOSED | Specified in `THEMING.md`; enforcement not in `src/`. The contract does not isolate privileged plugins. |
| C-192 to C-194 | phases are dependency order | PROPOSED | |
| C-195 | finish or disposition UI-entry obligations | VERIFIED as intent; INCOMPLETE as a list | MC-516/890/920. Only CHORE-205's ruling and CHORE-398's D2 "Saving" case remain. |
| C-196 | preserve CHORE-117 and CHORE-03 | VERIFIED | MC-923 to MC-925; the CHORE-03 and CHORE-117 Roadmap rows. |
| C-197 | resolve the criteria for CHORE-205 | STALE as phrased | The criterion is decided: MC-920 item 2, MC-957, MC-940 item 4. What is open is the ruling that the evidence meets it. |
| C-198 | reconcile CHORE-398 | VERIFIED, small | D2 "Saving" owed, non-gating. |
| C-199 | verify CHORE-622 and CHORE-04 | STALE | Merged in batch 34 (`905719247`, `ec8480886`, `35ffbd8f5`; MC-966, MC-968). Batch 35 additions are not mentioned. |
| C-200 | separate performance from correctness | PROPOSED, already partly settled | MC-979 and MC-983 separate gating from non-gating. |
| C-201, C-202 | next MVP update with commit and hash | VERIFIED as maintainer intent | MC-979; MC-922 shows the record pattern. |
| C-205 | Phase 0 exit criteria | INCOMPLETE | The actual refresh gate list (MC-979, MC-983, MC-984 item 2, MC-986 item 4) is missing. |
| C-206 to C-209 | Phase 1 deliverables | PROPOSED | No MC. "Do not implement the Workspace or Skill runtime" fits CHORE-617's TODO state. |
| C-210 to C-215 | Phase 2 and the UI-B1 to UI-B9 table | PARTLY wrong | Six mismatches against the ticket matrix: see `ticket-matrix.md` section 5. |
| C-216, C-220 to C-222, C-227 to C-228, C-229 to C-234, C-235, C-239 to C-242, C-244 | Phases 3 to 7 and U-01 to U-16 | PROPOSED | Proposal labels only. |
| C-247 to C-250, C-252 to C-254 | ticket identity, batches, critical path | PARTLY | Identity rule consistent with `AGENTS.md`. The critical path has two links with no record: "Cross-mode Contract" and "Utility after UI-S4". |
| C-306 to C-315 | actions 1 to 3 | PROPOSED | This folder is a response to them. |
| C-317 to C-324 | orchestrator instructions | PROPOSED | The governing prompt supersedes them for this run. |
| C-320 | prepare a proposal document | n/a | Done by this folder. |

Rows in section 3 are a grouping by id range. A few ids may appear under two headings because the claim spans them. The row-by-row check against f-claims found ten recommendation ids absent from the groups above; they are classed in the next table. After it, 184 of 184 recommendation rows and 36 of 36 vision rows are accounted for.

| Rows | Subject | Class | Note |
|---|---|---|---|
| C-028 | revalidate repository observations against the checkout before implementing | PROPOSED | Matches `AGENTS.md` ("trace the current code before changing"); this folder does that. |
| C-083 | treat the theme contract as a foundational requirement | PROPOSED | Same basis as C-174, C-175: specified in `THEMING.md`, not enforced in `src/`. |
| C-108 | improve active-state summaries and targeted retrieval instead of discarding history | PROPOSED | Related to C-106 and C-273 to C-276. |
| C-111 | minimal extensible core, validate on one vertical module, then generalise | PROPOSED | Same basis as C-110, C-126, C-127. |
| C-223 | Phase 4 goal: extensibility without compromising user data | PROPOSED | Phase goal; no MC. |
| C-246 | do not assume a desktop capability exists on Android or hosted web | PROPOSED | Consistent with MC-933 decision 2 (desktop first) and the `internal:fs` Chromium-only finding. |
| C-292 | reviewer recommends D-01 Option B | PROPOSED | See C-291; the edge it depends on is UNPROVEN. |
| C-294 | do not assume native filesystem access is equal on every platform | PROPOSED | Same platform evidence as C-293. |
| C-299 | executable plugin compatibility only after sizing and security review | PROPOSED | Same basis as C-165, C-166. |
| C-303 | start with built-in or declarative manifests, defer executable packaging | PROPOSED | See C-302. |

## 4. Citation mismatches and packet contradictions found while writing

| # | Item | How it was handled |
|---|---|---|
| 1 | a-isolation vs a-verify (interceptor label count 17 vs 20; reverse proxy reaching `mistral`/Responses; streaming default; stdio; read scope; module write prompts) | The verifier wins. Table in `proposal.md` section 4. |
| 2 | a-isolation says the Utility comment's "V2-style" hooks; MC-934 Q3 says "V3 plugin before and after request hooks" | Same mechanism (`addRisuReplacer`, `v3.svelte.ts:1023-1030`); naming slip only (a-verify). Wording in this folder follows MC-934. |
| 3 | c-gates marks the batch 36 CHORE-624 result UNVERIFIED and reports it contradicts the commit's flush claim | Replaced by the independently verified result carried in from lane A: ACCEPT WITH CORRECTIONS. See `proposal.md` section 2.2. |
| 4 | b-reuse "R2/R3/R4" refute premises (per-run MCP scoping; `HypaProcessorV2` as a retrieval store; prefix handling) | No `f-claims` row states R2 as a fact. The nearest are recommendations C-149 and C-154. R3 maps to C-069 (OVERSTATED). R4 is an observation about the proposal's F-04 list, which `f-claims` splits into C-062 to C-068. |
| 5 | `f-claims` numbers lines with ripgrep (1147 lines); `Measure-Object -Line` reports 702 for the same file | Verified: the file has 1147 physical lines (CRLF, 48,574 bytes, untracked so not at a pinned commit); 702 is the non-blank count, because `Measure-Object -Line` skips blank lines. The `f-claims` numbering is the physical line number and is correct for citing the file. |
| 6 | a-isolation: `utilityGate.ts` is under `src/lib/Utility/`, "not process/utility" | Author check: `src/ts/process/utility/` exists and holds `utilityConversation.svelte.ts`. The remark concerns one file only; the external C-025 path is right. |
| 7 | d-queue: the UI epic Roadmap row says "nothing implemented" | STALE for UI-S0; the UI-S0 row supersedes it. |
| 8 | HEAD moved from `52c4f0516` to `ea14314bd` during the run (records only) | README snapshot; records read after `52c4f0516` are TODO(evidence). |
