# Corrected roadmap proposal, 2026-11-02, run a

Status: proposal only. It is not a maintainer decision, not a Gate verdict, and it amends no record. Verification: see `README.md`.

How to read the tags. Every recommendation carries one of three tags:

| Tag | Meaning |
|---|---|
| [E] existing policy | The rule is already in force. The row says where. |
| [C] proposed clarification | Wording or a small rule that fits inside existing policy. Needs your instruction before any record is edited. |
| [A] amendment requiring approval | Changes a decision, a schedule or a gate. Not in force until you approve it. |

Labels such as P617-1, Q1 or "seam 3" are proposal labels, not allocated ticket IDs. Real IDs come only from `Agents/Roadmap.md`.

Evidence kinds: "observed code" (a packet author read it), "previously reported check" (named with its record), "diagnostic run" (none were run for this folder), "recommendation" (opinion).

Snapshot: packets at HEAD `52c4f0516`. HEAD is now `ea14314bd` (records only, no `src/` change). Records added after `52c4f0516` (batch 36, MC-995, MC-996) were not read by any packet. The independent verifier (2026-11-02) read MC-995, MC-996 and the batch 36 rows for CHORE-17 and CHORE-624; statements changed accordingly in sections 2.2 (CHORE-17, CHORE-624 rows) and in the Roadmap citations (cited by ticket, because batch 36 shifted line numbers). Other batch 36 rows were not read. TODO(evidence).

## 1. Summary and the top decision request

The external proposal is useful as a sequencing and risk checklist. It is wrong or stale in several places that matter (see `claim-matrix.md`). The main corrections:

- The existing Utility is deliberate, not a gap. MC-933 and MC-934 define it. CHORE-616 S2 is merged.
- The next installed MVP has its own gate list (MC-979, MC-983, MC-984 item 2, MC-986 item 4). The external Phase 0 does not name it.
- Nothing in the records says Utility work must wait for UI-S6 or UI-S4. That edge is UNPROVEN. An after-UI-S4 start is a proposed schedule that needs your choice.
- Existing MCP and memory code is more reusable than the proposal assumes in one way (a working tool client exists) and less in another (no per-run ownership, no retrieval store).
- Most of the workflow proposals already exist as policy. The one clear gap is that `Agents/Live-State.md` does not follow MC-321 item 4.

### Top decision request: unadvertised `tool_use` dispatch (Q1 in `decisions.md`)

At your request (2026-11-02), this is the first decision request. Nothing is opened or fixed by this file.

What a-isolation found, and a-verify independently checked at HEAD `52c4f0516` (observed code, static, nothing executed):

- Only one of seven `callTool`/`callMCPTool` sites dispatches a tool the request never advertised: `anthropic.ts:1137-1139` (non-streaming). The other five provider sites require a match in `arg.tools`. The seventh site is the Playground page.
- Utility passes `tools: []` (`utilityConversation.svelte.ts:199-211`). A conforming provider returns no tool call. A non-conforming one (a reverse proxy, a custom `xcustom:::` model, or a user additional parameter that adds `tools`) can.
- The fallback call reaches the selected character's module MCP set plus `internal:risuai`, which is always in scope. `internal:risuai` read tools have no confirmation and read any character by id or name. Mutating tools confirm with `alertConfirm`.
- Approved stdio programs in that module set can be spawned silently by the fallback (`stdioApproval.ts:146-147`, `mcp.ts:166-196`). Desktop only.
- Utility is non-streaming on an Anthropic-format model unless Response Streaming is on. `useStreaming` has no default seeding (a-verify; lane A's own spot check agrees).
- The tool loop has no depth cap, and the non-streaming fetch passes no abort signal, so Stop does not cancel it.
- Streaming Anthropic, batching, OpenAI-compatible, Responses and Gemini paths are not reachable.

No live exploit is claimed. Whether a real endpoint ever returns such a block is UNCERTAIN. A related inference (a plugin holding only `replacer` rewriting the body to add tools, a-verify N1) is not executed.

Proposed follow-up, bounded and not started: one investigation with a stubbed fetch and synthetic input, as described in section 12 item 1. The decision on any fix comes after its result.

## 2. Current baseline and remaining gates

Three gate sets are kept separate. They are related by the maintainer's plan, not by the rules.

### 2.1 Installed MVP

| Fact | Evidence |
|---|---|
| Installed MVP is main `7928b5bb1`, APK sha256 `8b5e0ec8f7f4c2b514244c6f4b8f04b7bb2bf75b744773971dd25cb9383ed9a0`, installed 2026-10-31 | MC-922; `Live-State.md:9`. The hash is as the maintainer gave it; not recomputed. What was counted against what is not stated: TODO(evidence). |
| Nothing merged since is installed | MC-979 note: "plan statement, not a build"; Roadmap batch 35. |
| First baseline `f0e397aae` | MC-475 |
| MC-350 carry-forward is live | MC-922 note |

Previously reported check, not re-run.

### 2.2 Next MVP refresh (MC-979, MC-983, MC-984 item 2, MC-986 item 4)

MC-979: the refresh waits for CHORE-17 S0 to S2, the Settings-return fix, the CHORE-396 fix and the CHORE-624 net. CHORE-623 rides along. No deadline. MC-983 item 3: data loss actually reachable in normal use also gates it. MC-983 item 3 (data loss) is also a lane A count: CHORE-625 U1 is "MVP-gating by lane A's count" (Roadmap CHORE-625 row).

MC-986 item 4 (Q5): the local Ollama multibyte fix gates the MVP refresh (shipped as CHORE-627 S6, `5e574e1dc`; technically accepted, awaiting records review; no test on the Ollama cloud path). MC-984 item 2 ("Before MVP refresh"): the non-gating harvest backlog (issues 1667, the 1387 residual, 1426, 1495, and 1327 after a runtime check) is to be done before the refresh; lane A's gloss says so (`Maintainer-Context.md:20523` and `20528`; all five items shipped in U3, Roadmap CHORE-627 row).

| Item | Code | Device evidence | What remains |
|---|---|---|---|
| CHORE-17 S0 to S2 | merged `515025346` | Note 9, small n. Batch 36 (verifier's grades govern, ACCEPT WITH CORRECTIONS) ran S1-b on a profile with chats and alt, archive OFF: default getDatabase read Bm median 2528 ms (n=5) against Nm 2097 ms (n=5), WEAK to moderate, one session per build, not attributed to one change; light read 140 ms, Nm only, descriptive. S1 default copy NOT TESTABLE (Roadmap CHORE-17 row) | independent records review |
| Settings-return | stage 1 `2eed2f84d` | heavy cases about -15% to -23%, light about -11% WEAK | whether stage 1 satisfies the MC-979 wording is lane A's reading; stage 2 conditional |
| CHORE-396 | none | diagnosis only, +30.8 MiB peak-PSS gap not attributed | forced-GC run, attribution, then a fix. The only gate item with no code. Critical path to a refresh. |
| CHORE-624 | merged `031bfddf1` (counters plus hidden-tick yield) | batch 35: yield works, longest segment about 800 ms against about 7000 ms. Batch 36, independently verified 2026-11-02 (ACCEPT WITH CORRECTIONS): the end-of-reply flush still waited for a hidden module tick (about 2 s, 3 of 3 runs, `preempted` never fired) | Merged, but its device outcome is not shown. You chose a one-run device check of the cause before any fix (MC-995: "One device check first"; MC-996: the durability check "the reply survived force-stop and relaunch" is not recorded, the next device run re-logs post-relaunch counts; the cause is INFERRED, not tested, `Maintainer-Context.md:20693`; no ticket filed, no code change). Source: `%TEMP%\risu-b715\b35\db36-verify\result.md`; MC-995 at `Maintainer-Context.md:20689`. |
| CHORE-623 | merged `621c220d2` | none needed per records | records review; stage S1 and `Legal.svelte` status TODO(evidence) |
| Harvest data loss | U1 `52987bd95`, U2 `f8f5007f1`, U3 `5e574e1dc` | unit tests only | #553, #584, #596, #230, #681, #718 unresolved and unclassified (Q4) |

Observation: no record lists the refresh gate as met. Five of six items have merged code. Every "technically accepted" is awaiting a records review, which is not an application-code gate.

### 2.3 UI-S1 entry gate (MC-516, MC-890 item 4, MC-920)

| Ticket | Disposition |
|---|---|
| CHORE-117 | closed as a gate ticket (stage 1b merged `95d68c29b`) |
| CHORE-03 | closed (premise refuted; test `4f986561d`, merge `f4f2e2c0f`) |
| CHORE-398 | closed as a gate ticket (merged `7a94a7b30`); D2 "Saving" sub-case still owed, non-gating |
| CHORE-205 | NOT COMPLETE. Nobody has ruled that the device evidence meets MC-920's "device cases only" bar (Q3) |

UI-S1 has not started. TODO(evidence): no record says UI-S1 must wait for the refresh install. MC-979 only plans it that way. [E]

### 2.4 Shipping saved task presets (MC-936 item 3)

Task presets gate release on CHORE-128. This is a release gate for presets only. It is not a UI-S1 or MVP-refresh gate. The phrase "as chat alternatives do" is stale: the alternatives gate was superseded (MC-917 item 2). The broader rule is MC-089. [E]

## 3. Existing capabilities worth preserving

All observed code or recorded decisions. None should be rebuilt.

| Capability | Where | Why keep it |
|---|---|---|
| Utility entry path with no hidden character, saved task presets, per-run abort, concurrency with RP, literal instructions, no tools | MC-933, MC-934; `utilityConversation.svelte.ts:199-211`, `utilityPrompt.ts:15-24` | Deliberate. Prompt isolation is VERIFIED. |
| Format allowlist and refused plugin model providers, JSON schema forced off | MC-937; `utilityConversation.svelte.ts:46-51,70-72,208-209` | Narrow, safe starting surface. |
| MCP tool client (Streamable HTTP, legacy SSE, desktop stdio, internal and plugin clients) with one choke point `callMCPTool` | `mcplib.ts`, `mcp.ts:424` | A working base. Missing: per-run ownership and permission, not transport. |
| Stdio consent per module and spec hash, stored outside the database, refused off-desktop | `stdioApproval.ts:140-167`, `mcp.ts:102-107` | The only tool-related consent store that exists. |
| Idle sweep and in-flight accounting for MCP clients | `mcp.ts:75-96,407-422` | Lifecycle base. |
| `HypaProcessorV2<TMetadata>` and its content-keyed embedding cache | `hypamemoryv2.ts:36-39,392` | A reuse candidate for embedding, not a retrieval store. |
| UI-S0 Nexus pattern components (not mounted anywhere yet) | `src/lib/Nexus/pattern/*`; the UI-S0 Roadmap row | Delivered foundation. First-mount obligations carry to UI-S1. |
| Theme specification and the design-side validator | `docs/design/THEMING.md`; `chat/checks/th/*`, `theme/checks/run.mjs` | Specification only. Not enforced in `src/` (section 9). |
| Gates, batching, final-snapshot checks, write ownership, Decision-Index | `docs/workflow/*`, MC-888, MC-894 | Already match most of W-01 to W-09. |

## 4. Utility isolation, with narrowed wording

Three different things were mixed together in the external F-03 and in the code comment. They need separate wording.

| Layer | Finding | Class | Evidence kind |
|---|---|---|---|
| Prompt isolation | Utility builds the preset instructions plus its own turns. No character, persona, lorebook, chat or RP memory enters the prompt. Request triggers and before/after request hooks are skipped. | VERIFIED | observed code (a-isolation, a-verify) |
| Execution authority: V3 body interceptors | An installed, enabled V3 plugin holding `replacer` and calling `registerBodyIntercepter` sees and can replace the body of every provider request that carries an `interceptor` label, Utility included. Nothing marks the run as Utility. `blockPlugins` blocks plugin model providers only. | VERIFIED, and INCOMPLETE in the earlier fact-check | observed code |
| Execution authority: tool dispatch | `anthropic.ts:1137-1139` (section 1). | VERIFIED, with scope corrected by a-verify | observed code, static |
| Non-conforming provider response | A hostile or buggy endpoint can trigger the dispatch above. | UNCERTAIN as to real-world occurrence | not executed |

### Narrowed wording (proposed clarification [C])

Suggested replacements, not applied anywhere:

- Instead of "no plugin hooks": "no before/after request hooks and no plugin model providers. V3 body interceptors still observe and can replace the request body, as they do for RP."
- Instead of "no tools": "no tools are advertised. This is not an enforced guarantee on the Anthropic non-streaming path until Q1 is resolved."
- The code comment at `utilityConversation.svelte.ts:12-16` says no plugin hook or tool can reach the body. It is inaccurate for interceptors and for tool results in the Anthropic loop (a-verify N5). Fixing a comment is code, so this proposal only reports it. OMITTED from any edit.

### Corrections a-verify made to a-isolation (the verifier wins)

| Point | a-isolation | a-verify |
|---|---|---|
| `db.useStreaming` default | UNKNOWN | no default; non-streaming unless the user enabled it |
| Reverse proxy reaching `mistral` and Responses labels | possible | REFUTED (allowlist applies to `customAPIFormat`) |
| Interceptor label sites | 17 | 20 (a quoted-key form was missed) |
| Route to Anthropic format | built-in and reverse proxy | also `xcustom:::` custom models, any URL |
| Claude batching | not listed | must be off for the path |
| Stdio | only already-live clients | approved stdio programs are spawned |
| Read scope of `internal:risuai` | selected character | any character by id or name, plus modules and chats |
| Module write prompts | UNKNOWN | all six module mutators confirm |

### Further static observations (not security findings unless stated)

- N2: Stop does not cancel by default on an Anthropic-format model. The text is discarded but the run id stays set until the HTTP chain returns, so a new send is ignored until then.
- N3: an OpenAI-compatible reply with `tool_calls` to a `tools: []` request can reach the shared alert store, contrary to the Utility comment. Not a security issue.
- N4: with `claudeRetrivalCaching` on, a Utility Anthropic request takes the single global cache keep-alive slot from RP. Low impact.
- Whether Utility should be exempt from interceptors is Q2. No MC covers it.

## 5. The smallest cross-mode seams

Prompt item 6 asks for a minimal seam review that does not design the future agent platform before UI-S1. The seams below are the smallest list the packets support. For each: what must be settled, what stays open, and the evidence. Proposed as one bounded note (Q6, section 12 item 2). [C] unless stated.

| Seam (proposal label) | Settle now (question, not design) | Leave open | Evidence |
|---|---|---|---|
| 1 Navigation ownership | Who owns mode switching and the Back mechanism for all new screens | Mode content, Workspace navigation | MC-892 item 3 puts the Back decision at UI-S4 sizing, while S1 to S3 add screens (Q7). UI-S4 Home would have to migrate the Utility card (INFERRED, MC-890 item 4). |
| 2 Renderer and composer | Whether the message renderer and composer are shared components fed by data, or RP-specific | Tool-call rendering, artifact views | UI-S1 is the chat shell (the UI-S1 Roadmap row). How the Utility screen renders messages: UNKNOWN, no packet read it. Settle by reading the Utility screen. |
| 3 Status and approval containers | One container shape that says who asked, what, and the effect | Specific tool dialogs | Today approvals are plain `alertConfirm` text and do not name Utility (`en.ts:1994`, a-verify). CHORE-572 toast host has no stored data. CHORE-563 is typed send failure. |
| 4 Extension parts | Reserve part names and the rule that new parts publish tokens as they appear | Any extension API | `THEMING.md` specifies parts and protected surfaces. `data-part` appears in `src` only in the seven unmounted Nexus files (91 occurrences). |
| 5 Platform capability reporting | A read-only way to ask "is this available here", never simulating success | A capability model for tools | `stdioSpawnRefusal` (`mcp.ts:102-107`); `internal:fs` is Chromium-only; Tauri fs scope excludes project folders (the CHORE-617 Roadmap row); the native `isDesktopTransport` probe was not run (CHORE-616 open item). |
| 6 Persistence ownership | A checklist per new persisted kind: owner, `.rtb` presence, `.bin` translation or named omission (MC-774), forward migration (MC-350) | Any schema, kind, writer, journal or GC mechanism | MC-892 item 8 (one home per ticket); rows 564 to 568 homes are INFERRED until designed. |

Bound: six items, questions and constraints, no new design package. The note must not specify a Workspace schema.

## 6. CHORE-617 decomposition (proposal labels)

CHORE-617 stays the parent. It is open, low priority, "nothing is sized or planned" (the CHORE-617 Roadmap row). It records sizing decisions 5 (tool permission default and scope), 8 (instruction-file scope) and 9 (MCP or stdio in presets). It does not record client ownership, per-run consent beyond stdio, cancellation, cleanup, tool-call record scoping, or the `RunSubject` mismatch (b-reuse 3.3). The row (Roadmap CHORE-617) names "AGENTS.md/SKILL.md discovery, tool permission gate, mutating tools", and sizing areas 3, 4 and 6 (skill scripts cannot run in the browser or WebView).

Labels are proposal labels. No IDs are allocated. The external proposal's U-labels are noted where they map.

| Proposal label | Content | Maps to external | Open decisions | Persistence boundary | Review route |
|---|---|---|---|---|---|
| P617-1 Run-boundary hardening | Q1 guard (if confirmed), Q2 interceptor policy, abort for non-streaming Anthropic | none | Q1, Q2 | none | security boundary: `opus-reviewer` per `gates.md:10` (MC-912) [E] |
| P617-2 MCP ownership contract for Utility | Who lists servers for a run (no module set, no `RunSubject`), per-run consent for non-stdio, cancel semantics, cleanup, tool-call record scope, visibility of internal clients | U-05 part, D-04, D-05 | sizing decisions 5, 9 | tool-call records (`mcp-tool-calls`) have no run scope | permission gate: `opus-reviewer` |
| P617-3 Read-only tool registry | Typed definitions, validation, cancellation, read-only first | U-05 | after P617-2 | none new | as P617-2 |
| P617-4 Instruction sources | Where instructions come from beyond the preset's literal text | U-04, D-03 | sizing decision 8 | none if preset-only | normal review |
| P617-5 Workspace container | Project record or folder, persistent conversations, files | U-01 to U-03, D-02 | Q9 and the seven questions in section 8 | NEW kind; needs migration and unreadable-data retention (MC-350) | `opus-reviewer`, senior-advisor on the plan |
| P617-6 Skills (read-only) | Loading `SKILL.md`, scripts disabled | U-06 | after P617-4 and P617-5 | skill metadata store: open | normal; security review if scripts |
| P617-7 Mutating tools | Writes with confirmation, visible records | U-08 | after P617-2, P617-3 | execution records | `opus-reviewer` |
| P617-8 Embedding and retrieval | Namespaced index, deletion, backup | U-10 to U-13 | pooling, prefix and model decisions (CHORE-619 to 621) | derived index vs persisted: open | `opus-reviewer` |

Classification: the split into pieces is a proposed clarification [C]. Tool permission, scope and MCP-in-presets remain your decisions at CHORE-617 sizing [E, existing].

## 7. MCP and memory reuse

### 7.1 MCP (observed code, b-reuse)

| Question | Answer |
|---|---|
| Is there an MCP stack? | Yes. Hand-written JSON-RPC client: Streamable HTTP first, legacy HTTP+SSE fallback, desktop stdio, internal clients, OAuth, prompts. No resources. `callTool` has no abort signal, no timeout. |
| What protocol revision does it declare? | `2025-03-26`, falling back to `2024-11-05` (`mcplib.ts:107,520-534,616-621`). The latest revision is 2026-07-28 (g-interop). Current compatibility with the latest revision is UNPROVEN and must not be claimed. |
| Is it scoped per run, chat or mode? | No. Clients are global singletons keyed by URL. The module set of the chat or selection decides what is listed. Nothing is scoped to a Utility run. |
| What does consent cover? | Only spawning a stdio program, per (module id, spec hash). Not tool calls, HTTP URLs or internal clients. |
| Does the proposal's "not a complete host" hold? | Right, but "separate transport adapters" mostly already exist. |
| Is a new MCP stack needed? | No. The missing work is the ownership, permission and lifecycle contract (P617-2). [C] |

Open questions for P617-2 (questions only, from b-reuse 3.2): ownership, per-run consent, cancellation, cleanup (app-exit behaviour UNKNOWN), tool-call record scope, whether a Utility run may see `internal:risuai`, `internal:aiaccess` and `internal:fs` at all.

Side observation, not traced: `decodeToolCall` in `mcp.ts:545` slices with `text.slice('<tool_call>'.length, 0)`, which returns an empty string. A likely defect, impact UNCERTAIN, outside this brief. Not proposed as work here.

### 7.2 Memory (observed code, b-reuse; records for 619 to 621)

- `HypaProcessorV2` has one non-test consumer (`hypav3.ts:646`). Vectors live in an instance `Map`. The only persistence is a global content-keyed embedding cache (localforage `hypaVector`), with no namespace, no access control and no delete path. Similarity search returns all vectors sorted, with no top-k and no metadata filter. So the external C-069, which claims reusable primitives with metadata and not a store, is VERIFIED WITH LIMITS (reclassified from OVERSTATED per the follow-up review F1): the primitives exist; namespace, cache invalidation, deletion and lifecycle are future integration caveats, and a retrieval store does not yet exist.
- Reuse means reusing the V3 summary-chunk embedder. The older `HypaProcesser` serves V2 and Hanurai.
- CHORE-619 (pooling), CHORE-620 (model list) and CHORE-621 (prefixes) each change vectors. The cache key is `content|model[-custom][ctx]` with no version. A Utility index built first would be invalidated later. Whether Utility vectors live in a separate, rebuildable store is a design decision not made here. [C]
- Hypa cache and backups: UNKNOWN (no trace of `hypaVector` in backup surfaces; IndexedDB handling not traced).
- Not proposed: any RP memory rewrite. Embedding via an API sends text to the vendor; Utility documents would take the same path as RP summaries.

## 8. Platform and backup constraints

### 8.1 Settled policy (not reopened) [E]

| Rule | Source |
|---|---|
| `.bin` round trip: upstream imports into the fork and fork imports into upstream; upstream need not read fork storage | MC-175 |
| Upstream to fork always works; fork to upstream may omit data over upstream's limits only after a warning naming it and confirmation before export | MC-223; extended beyond size by MC-774 |
| Encrypted risuai.xyz full backups are refused; never trick the domain | MC-477 |
| `.bin` export translates to upstream's shape where an equivalent exists; otherwise fork-only data stays in store2/`.rtb` and is left out with a warning naming it | MC-774 (rests on MC-685, MC-298, MC-686) |
| Android, from the first release-signed MVP install: later builds read saved data in place; forward migration is automatic; unreadable data is kept, never overwritten | MC-350; MC-470 item 1 live; MC-470 item 2 partly overtaken (UNCERTAIN how much applies) |
| Task presets: kept on `.bin` import over a store that has them; damaged type-26 unit dropped and flagged; recovery-screen import keeps none; release gated on CHORE-128 | MC-934 Q1, MC-936, MC-937 Q16, MC-938 |
| V2.1 plugin execution is retired; data untouched | MC-349, MC-504 |

### 8.2 New Workspace questions (questions only; no schema, kind, writer, journal or GC mechanism is proposed)

No MC settles any of these (index search found no "Workspace" title; bodies not fully searched, PARTIAL):

1. Lifecycle: create, rename, archive, delete; whether a Workspace can exist without a character; where it lives. A character-free persistent chat would need a new shard type.
2. Backup: `.rtb` only, or also translated into `.bin`; the warning wording that names omitted Workspace data.
3. Deletion and retention: no rule like MC-892 item 5 (30-day Trash) or MC-937 Q16 for Workspace files, conversations or indexes.
4. Android: whether Workspace exists there at all (MC-933 decision 2 says desktop first). If it does, MC-350 applies to any new persisted kind.
5. Format gating: how an older build treats a newer Workspace kind it cannot read; whether the `req` token mechanism extends.
6. Filesystem folders: lifecycle when the user moves or edits a folder; platform access; backup of external content.
7. Indexes: derived and rebuildable, or persisted; whether they enter backups.

Q9 in `decisions.md` asks only which home sizing should assume.

## 9. Interoperability: keep four things separate

From g-interop (a fetch summary of primary documents on 2026-11-02; re-fetch before quoting). The UI theme contract is covered in 9.2.

### 9.1 Four classes

| Class | What the documents say | RisuTanium today | Rule |
|---|---|---|---|
| Portable skills | A skill is a directory with `SKILL.md` (`name`, `description` required) and optional `scripts/`, `references/`, `assets/`. Loaded progressively. `scripts/` can hold executable code. | Nothing. Not implemented. | A skill is not inert text. Scripts disabled until a reviewed runner exists (the external proposal's C-158; PROPOSED). |
| Host permissions | `allowed-tools` is "pre-approved tools", marked Experimental and varying by implementation. OpenCode ignores it and keeps the grant host-side (`permission.skill` allow/deny/ask). | Stdio consent per module+spec; `alertConfirm` for internal mutators; V3 plugin `getPermission` grants. No Utility-specific permission. | Descriptive metadata is not a grant. The host decides. |
| MCP tools | Standard transports: stdio and Streamable HTTP. The latest revision (2026-07-28) moves version and capabilities into per-request `_meta`. | Tool client, declared revision 2025-03-26 (section 7.1). | Do not claim "matches the latest spec". |
| Executable JS/TS plugins | OpenCode plugins are JS/TS modules with hooks, auto-loaded; npm plugins are installed with Bun at startup. | V3 plugins with permission grants and body interceptors. V2.1 retired. | A different trust class from skills. Loading OpenCode plugins into the frontend is an unproven, risky step (external C-101 is an assessment). |

[C] Recommendation: a common capability model with separate adapters, tiered compatibility (portable `SKILL.md` first, executable plugins last), exactly as the external proposal says. The tiering is the external proposal's; it has no MC. Choosing the compatibility level (D-06) is PROPOSED and needs your decision when Skills are sized. [A]

### 9.2 Theme contract

- Specification: `THEMING.md` lines 11, 30 to 39 (tokens only on critical surfaces, protected surfaces enforced at install, fail-closed).
- Enforcement: none in `src/`. The validator exists only under `docs/design/`. Porting waits for UI-S6 (MC-891 item 1).
- Plugins: `THEMING.md` does not mention plugins, full-DOM or native capabilities. A part-scoped contract does not isolate separately privileged plugins.
- Per-surface DD/DS adoption is required (MC-890). Uncited imported decisions stay advisory.
- `docs/design/README.md` does not exist at this snapshot. Any handoff that points at it is stale. The tokens/validator work is not blocked by this.

## 10. Workflow improvements (gaps only)

The external W-01 to W-09 mostly restate existing policy. Source: e-workflow. Nothing here adds a governance layer, and no savings are promised.

| Item | Existing policy | Specific gap | Smallest change | How it would be measured | Tag |
|---|---|---|---|---|---|
| W-01 Batch planning | MC-888 (one plan, one Gate 1, one Gate 2 per batch), MC-889 | combined Gate 1 over several tickets appears only in MC-888, not in `routing.md`/`gates.md` | one sentence in `routing.md` | tokens per accepted batch, with the audit-2026-10-29 method | [C] |
| W-02 Review fragmentation | MC-894, MC-895, MC-899 | none | none | n/a | [E] |
| W-03 High-risk boundaries | `gates.md:10` (incl. MC-912 security-boundary clause) | no clause for tool access or external plugin execution; premature, since no tool system exists and V2.1 is retired | revisit when CHORE-617 pieces P617-2 and P617-7 are sized | n/a | [E] |
| W-04 Tests | `gates.md:29`, MC-694 | none | none | n/a | [E] |
| W-05 Review coverage | `review-change/SKILL.md`, `gates.md:33,45,47` | no CONFIRMED/UNVERIFIED label; no outcome table | one clause in `SKILL.md` | overturned reviewer findings per round, counted in the ledger Outcome text (no countable column today) | [C] |
| W-06 Compact view | `records.md:25`, MC-321 item 4 | `Live-State.md` not following it: about 114 KB at the packet snapshot, 117,465 bytes at `ea14314bd` (`git cat-file -s`); the count method for "Superseded" bullets is not stated; last archive about batch 14; line 7 points at a 2026-10-21 handoff | apply the rule; correct line 7 | file bytes and Read tokens before and after | [E] applied; edits a record |
| W-07 Status | `records.md:3` | device-check-owed state not named | one sentence in `records.md` | count Roadmap COMPLETE rows with an owed device check (UNKNOWN today) | [C] |
| W-08 Parallelism | `ownership.md:7-11`, MC-888 | none | none | n/a | [E] |
| W-09 Measurement | MC-896, `audit-2026-10-29.md` | extraction method not in `Agents/Tools/README.md`; `Measure-AgentTools.ps1` existence UNKNOWN; verdicts not joined to usage | save an extraction script under `Agents/Tools/`; join report line-1 verdicts to usage | rerun the audit definitions on lane A transcripts from 2026-10-30 on; tokens are an unweighted size measure, not cost | [C] |

Section 12 of the external proposal (the risk-based review table) duplicates existing rules. Adopting it as a table would create a second classification. Recommendation: do not adopt; fold the two real gaps (combined Gate 1 wording; a Gate 1 security reviewer for the tool-permission boundary, later) into `gates.md`. The latter is premature until tools exist. [C]

R-04 (review overhead) is partly STALE: MC-888 and MC-894 date from 2026-10-30; the audit window ended 2026-10-28. Whether overhead persists is UNKNOWN. An untested point: MC-899 versus MC-785 about the fresh arbiter (`routing.md:53` against `routing.md:69`); UNKNOWN which you meant.

## 11. Proposed sequence

A proposal. Phases show dependency order, not dates. Labels are proposal labels.

| Step | Work | Depends on | Class |
|---|---|---|---|
| 0a | Q1 investigation (stubbed, synthetic) | your Q1 choice | [A] |
| 0b | CHORE-624 one-run device check of the cause | already chosen by you | [E] |
| 0c | CHORE-396 forced-GC run, attribution, then fix | none | [E] (MC-979) |
| 0d | CHORE-205 export step in the same device session, then ruling | Q3 | [E] / [A] |
| 0e | Records review of "technically accepted" items; classify the six harvest items | Q4 | [E] |
| 1 | Build, install and record the refresh (MC-922 pattern) | all of MC-979, MC-983, MC-984 item 2, MC-986 item 4 met | [E] |
| 2 | Seam note, then UI-S1 sizing (S1a/S1b proposed) | gate met; Q6, Q7, Q8 | [C] |
| 3 | UI-S1, then S2, S3, S4 as separately gated stages; batches per `ticket-matrix.md` | each stage's sizing | [E] with [C] batching |
| 4 | UI-S5 and UI-S6 as separate work | UI-S0 (S6); no stated prerequisite (S5) | [E] |
| 5 | CHORE-617 sizing: P617-1 first, then P617-2 and P617-4 | Q1, Q2, Q5; your answers to decisions 5, 8, 9 | [E] / [A] |
| 6 | Workspace, tools, Skills, retrieval pieces, in the order of section 6 | step 5 and Q9 | [A] |
| Anytime | CHORE-128 before any release that ships task presets | MC-936 | [E] |

Notes:
- Steps 0a to 0e do not depend on one another and do not touch the UI.
- Step 1 before step 2 is the maintainer's plan (MC-979), not a rule of MC-516/890/920.
- A hard "Utility waits for UI-S6" edge is UNPROVEN. "Utility implementation after UI-S4" is a proposed schedule (Q5).

## 12. The next three bounded work items

Each is analysis or planning only. Each needs its own authorisation and a brief with named files and write ownership. None is started.

| # | Work item (proposal label) | Question | Scope and output | Done when |
|---|---|---|---|---|
| 1 | Utility tool-dispatch and interceptor diagnostic | Does an unadvertised `tool_use` on non-streaming Anthropic reach `internal:risuai`, do reads prompt, what bounds the loop, what does Stop do, and can a `replacer`-only plugin trigger it? | One investigator. Stubbed `globalFetch` in scratch, synthetic data only. Cases: first POST returns a `tool_use` for `risu-list-characters`, second returns text; variant with a body interceptor adding `tools`; `useStreaming` undefined, Anthropic format, `claudeBatching` off. Check a fresh-profile `useStreaming` in the desktop app. No repository edits, no live provider. | A report states each case CONFIRMED or REFUTED with the exact observation. Then Q1 follow-up. |
| 2 | Cross-mode seam note | The six seams in section 5 | One bounded note feeding UI-S1 sizing. Questions and constraints only. Reads the Utility screen (seam 2 UNKNOWN), `THEMING.md` and the MC-892 Back entry. | Each seam has settle-now, leave-open and an owner. |
| 3 | CHORE-617 breakdown and Workspace question register | P617-1 to P617-8 and the seven Workspace questions | A planning note recording pieces, dependencies, open decisions and review routes; the records edit itself waits for your instruction. | Maintainer can answer decisions 5, 8, 9, Q9 from one page. |

Not proposed as a work item here: the Live-State archival, which is records housekeeping under existing policy (a note in `decisions.md`; it was Q10 in an earlier draft); it needs your instruction to schedule.

## 13. Index of what is existing, clarification and amendment

| Item | Tag |
|---|---|
| Gate lists (MVP refresh, UI-S1, CHORE-128) | [E] |
| Compatibility policy (MC-175/223/350/477/774) | [E] |
| Narrowed isolation wording | [C] |
| Q1 investigation, any later guard | [A] |
| Interceptor exemption (Q2 B, C) | [A] |
| CHORE-205 ruling by option B or C (Q3) | [A] |
| Harvest classification (Q4 B, C) | [A] |
| Utility schedule (Q5) | [A] |
| Seam note (Q6 A) | [C] |
| Back decision timing (Q7 A) | [A] |
| Cross-stage default rule (Q8 A) | [C] |
| Workspace sizing assumption (Q9) | [C] |
| Live-State archival (records housekeeping note in `decisions.md`, formerly Q10) | [E] |
| Three workflow sentences (same note, formerly Q10 B) | [C] |
| CHORE-617 decomposition | [C] |
| Skills, MCP revision and OpenCode compatibility level | [A] when decided |
