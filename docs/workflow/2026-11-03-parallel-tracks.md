# Parallel code, device and records tracks — 2026-11-03

The maintainer's follow-up explicitly authorizes separating device runs/records from code, using Git worktrees for simultaneous TODOs, and dedicating Haiku to routine records. This later instruction amends conflicting fallback-only/global-serialization wording of MC-1036's implementation. Scheduling ID: `2026-11-03-parallel-records`; compatible policy revision: `2026-11-03.1`. Preserve existing registered/running identities and accepted evidence. Record this supplied decision in the next approved records pass with a confirmed ID; this amendment allocates no MC block and overwrites no original decision.

## Ready tracks

| Track | Parallel ownership | Waiting scope |
|---|---|---|
| Code | Two actual application writers, disjoint planned files, separate Git worktrees | Actual dependencies/integration conflicts |
| Device | One runner, owned device/ports and pinned artifact | Required unmet claims block affected acceptance/release only |
| Records | One primary Haiku record-clerk, frozen facts packet | Missing closeout blocks affected COMPLETE where applicable |
| Other documents/read-only work | Existing exact named ownership/resources | Does not consume a code-writer slot |

At start/resume, worker completion and parked waits, keep eligible authorized code tracks filled. A device/records wait on the queue's first item is not a global ticket barrier. Name an actual dependency if a second task cannot proceed, or continue bounded discovery/planning for an already-authorized next task. Never invent product scope or combine unrelated tickets merely for throughput. Keep serial stage writers and coherent combined gates within each worktree.

## Git worktrees and resources

Parent preparation of up to two code worktrees from explicit verified bases is already authorized. Follow [the procedure](ownership.md#independent-tracks-and-worktree-procedure); dirty/untracked main changes are separate named inputs, not inherited automatically. Normal external workers run in sanitized exports from their assigned source worktree through the central parent/controller. No extra Claude parent/relay is required. Native direct-write fallback retains its own rooted hooks/grants.

One integration owner imports reviewed named deltas serially with checked preimages/journal provenance. No implicit merge, commit, push, stash/reset/clean or destructive worktree cleanup. This amendment itself starts no application TODO, real device run or real worktree.

Use canonical declared resources: `device:<serial>`, individual `tcp:<port>`, `checkout:<absolute-path>`, `build:<absolute-path>`. Expand port ranges into individual claims; arbitrary overlapping range spellings cannot establish nonoverlap. Normalize filesystem case/trailing separators. The guard checks declared claims, not undisclosed OS activity.

Separate device build/run phases. For device-class dispatches, set devicePhase build for the source/build phase and claim checkout:<source-root>; the default/run phase supplies artifact with a 64-hex sha256 and sourceRevision plus its device resource. These fields pin declared provenance structurally; the parent must verify the actual artifact bytes/configuration before use. Reserve mutable source/output while building; once the immutable APK exists, record hash/source revision/relevant configuration, finish/release the build phase and run the device on that artifact while code advances. Shared builds/devices/ports/output remain real conflicts. Serialize quantitative benchmarks against competing heavy builds/full suites if load invalidates measurements, rather than blocking all unrelated coding.

## Primary Haiku records

New clerical authoring is `workClass: records`, `mode: implement`, native `record-clerk`, Haiku low, without external preflight or fabricated failure. Haiku still uses Claude quota; savings/throughput are unmeasured until real work supplies evidence.

Supply bounded facts/source excerpts, exact approved quotations/reserved IDs, target anchors/schema, accepted gate/test provenance and limits. Draft factual summaries/tables/status/commit text without upgrading confidence. Missing facts remain TODO(evidence), with one ambiguity packet to the parent. Product judgement, contradiction arbitration and independent acceptance stay with responsible roles. Haiku exhaustion/unavailability is reported/parked for an explicit parent fallback decision, never silently upgraded.

The write guard stays unchanged: exact-grant ordinary Markdown may be edited. Maintainer-Context/governance/Decision-Index/state changes return as scratch drafts/patches for verified parent application and existing index/state helpers. No shell workaround, unconfirmed ID allocation or self-acceptance. Parent application is clerical integration, not a second whole-batch rewrite. Independently check consequential claims once at consumption using correctly scoped source inputs.

Observed records failures included forbidden AGENTS.md dependency scope and native Edit-tool/real-checkout instructions sent to an isolated CLI. These are tool/input-contract mismatches, not proof that all external models inherently fail at records. Primary Haiku is the maintainer's chosen simpler clerical route.

## Compatibility and validation

Mode remains execution; workClass is scheduling. Records/documents cannot disguise app/configuration writes to escape code admission. Legacy scheduling inference for counts is separate from original route validation: preserve old saved dispatch JSON/hash, roles/models, jobs/corrections, queue and acceptance. Existing active workers finish normally.

The active records writer keeps canonical records until handback. This amendment edits only named workflow docs/profiles/skills and parent-owned controller/policy/tests. Current Live-State/handoff progress overrides the historical original resume queue; [the current prompt](resume-main-campaign.md) reconciles it before dispatch.

Parent closeout records focused tests and independent implementation review. These fixtures prove orchestration admission, not actual device concurrency, native model usefulness or quota savings. Existing compatibility, required device acceptance, independent app review, paid caps and provider activation limits remain.
