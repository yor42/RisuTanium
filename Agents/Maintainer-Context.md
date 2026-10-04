# Maintainer Context

This document is a durable log of facts stated by the maintainer, and decisions the maintainer
made, across the RisuAI stabilization campaign. It exists so a fresh session does not have to
re-derive context that already lives in a report, the Roadmap, the ledger or a chat log — and so
that context is not lost when a report is superseded, rewritten, or simply not the file a new
session happens to open first.

**This document is append-only.** New entries are added at the end of their section, in the order
they were seeded or discovered. An entry's claim text — its quote, its date, its citation, its tag
— is never altered and never deleted once written.

**The one exception is the back-pointer.** When a later fact or decision reverses an earlier entry,
the new entry is filed normally and tagged `superseded` (if it reverses a `decision`) or the
reversing entry is tagged `corrected` (if it reverses a `stated` fact) — and the **superseded
entry** is allowed exactly one appended line, naming the entry that reverses it. Nothing else about
the old entry changes. This is a deliberate reading of "append-only": rewording an old entry to
match the new understanding would hide that the claim ever read differently, which defeats the
purpose of a log. Recording the reversal only on the new entry would leave the old entry looking
live to a session that reads top-to-bottom and stops at the first match. Marking both ends is what
lets this document be read starting from either entry and still land on the current truth.

## How to read the tags

- **`stated`** — the maintainer asserted it, and nobody has independently checked it.
- **`verified`** — confirmed against source or a measurement; the entry names what confirmed it.
- **`corrected`** — revises an earlier entry; names which entry it corrects.
- **`decision`** — a fork in the work that the maintainer resolved.
- **`superseded`** — a decision later reversed; names which entry reverses it.
- **`open`** — a question addressed to the maintainer that is not yet resolved. An `open` entry is
  never a settled fact or decision, and it is filed in its own section for exactly that reason —
  so no reader mistakes an unanswered question for an answer.

`open` is not one of the five tags used elsewhere in this campaign's review vocabulary. It is added
here because three genuinely unresolved questions exist in the seed material, and grouping them
under `stated` or `decision` would misrepresent them either way.

## Dating

Many facts here predate any dated record — they describe how the app or the community already
behaved before this campaign started measuring it. Three, and only three, forms of date are used:

1. **A stated date** (`2026-09-21`) — the source itself states when the fact was recorded or the
   decision was made.
2. **A commit-bounded date** (`not recorded · on or before 2026-09-21 (54e9dc58)`) — the source
   gives no date, but a `git log -S` search for the exact text against the source file found the
   commit that introduced it. That commit's date is a genuine, verified upper bound on when the
   claim was first recorded in writing — not a guess, and not the same as the fact's real-world
   truth date.
3. **`not recorded`** — no date and no commit bound could be established (most often because the
   source file carrying the claim is not yet committed).

No date here is inferred from a report number, from where an entry sits in a document, or from a
neighboring entry's date. Where the evidence did not supply one of the three forms above, the entry
says `not recorded` and stops there.

## IDs

Every entry has a stable `MC-NNN` id, assigned in the order entries were written into this
document, and never reused. A `Sweep ref:` line carries the id this entry had in the 2026-09-23
extraction sweep that seeded this document (an `F`- or `D`-number) — that sweep's own numbering is
not stable across edits to the sweep, so the sweep ref exists only to trace an entry back to where
it came from, not to be cited elsewhere. Cite entries by their `MC-` id.

---

## Facts

### MC-001 — Real avatars are PNGs under about 10 MB, with 10 MB the stated upper bound

- **Tag:** stated
- **Date:** 2026-09-21
- **Sweep ref:** F1
- **Source:** `Agents/Reports/12-charlist-avatar-plan.md`, "§1 Problem, as measured"; also
  `Agents/Roadmap.md`, Phase 2 item 3 (not item 1 — see note)
- **Related:** MC-006

> Most avatars are PNGs under ~10 MB, with 10 MB the upper bound.

The Roadmap carries the same fact in its own words, under Phase 2 item 3 rather than item 1 (the
seed material named item 1; item 1 is the module-editor keystroke item and does not mention avatar
sizes):

> Maintainer: most avatars are PNGs **under ~10 MB**; 10 MB is the upper bound.

---

### MC-002 — Platform mix: hosted web most common, then local plain HTTP, then Tauri; account sync almost unused

- **Tag:** stated
- **Date:** 2026-09-21
- **Sweep ref:** F2
- **Source:** `Agents/Reports/12-charlist-avatar-plan.md`, "§1 Problem, as measured"; also
  `Agents/Phase2-Handoff.md`, "LIVE STATE — session of 2026-09-21 afternoon" (section removed 2026-09-23 in the handoff/Live-State split; the quoted text is preserved in git history as of `ca27760f`)
- **Related:** MC-003, MC-009

> **Most common:** the hosted web app. It is HTTPS, so it takes the service-worker path: no
> re-encode, but a full-size fetch and decode for each icon.
> **Second:** locally hosted plain HTTP, the base64 path.
> **Third:** Tauri desktop.
> **Account sync** is almost unused.

`Phase2-Handoff.md` restates the same ranking more tersely: "platform mix (hosted web > local HTTP
> Tauri, account sync almost unused)".

---

### MC-003 — Hardware floor is Raspberry Pi 3 (1 GB) and mid-range phones

- **Tag:** stated
- **Date:** 2026-09-21
- **Sweep ref:** F3
- **Source:** `Agents/Reports/12-charlist-avatar-plan.md`, "§1 Problem, as measured";
  `Agents/Reports/17-chore01-item2-plan.md`, "§2 Why option B, not option A"
- **Related:** MC-002, MC-035

> **Hardware floor:** Raspberry Pi 3 (1 GB) and mid-range phones.

Report 17 restates it in the course of a decision: "The hardware floor is a Pi 3 and mid-range
phones. The maintainer chose B." (see MC-035).

---

### MC-004 — Animated avatars exist, though uncommon, and AV-4 must preserve them

- **Tag:** stated
- **Date:** 2026-09-21
- **Sweep ref:** F4
- **Source:** `Agents/Reports/12-charlist-avatar-plan.md`, "§1 Problem, as measured"

> **Animated avatars exist, though uncommon.** AV-4 must preserve them.

---

### MC-005 — Upstream rolled cold storage back

- **Tag:** stated
- **Date:** not recorded · on or before 2026-09-21 (`65c90d7f`)
- **Sweep ref:** F5
- **Source:** `Agents/Phase2-Handoff.md`, "LIVE STATE — session of 2026-09-21 afternoon" (section removed 2026-09-23 in the handoff/Live-State split; the quoted text is preserved in git history as of `ca27760f`)

> **Key facts established this session, all in the Roadmap and ledger rows 13-38:**
> […] and upstream rolled cold storage back.

No further detail on this claim (what was rolled back, or why) appears in the cited source.

**Clarified by the maintainer (2026-09-30),** after the Q&A session found that upstream's main branch
(`ca1345fc`) still has cold storage: "rollback" means it was **scaled down, not removed**. As the
maintainer recalls, cold storage used to be on by default and more aggressive; problems since fixed
in this fork in Phase 0 and later sessions (for example, a failed read that was never retried and
was treated as corrupted) hit upstream's users, so upstream reduced it. In source today it defaults
to off on first load when a plugin is installed (`data.coldstorage ??= data?.plugins?.length === 0`
in `database.svelte.ts`; a user toggle, not a gate), and a character moves to cold storage only
after sitting idle for 10 days. The 10-day threshold is unchanged since it was added upstream
(`52aee0d1`), so what was "more aggressive" is not visible in source (doc-verifier, 2026-09-30).

---

### MC-006 — Maintainer runs 500+ characters; extreme users report 1000+

- **Tag:** stated
- **Date:** 2026-09-21
- **Sweep ref:** F6
- **Source:** `Agents/Reports/12-charlist-avatar-plan.md`, "§1 Problem, as measured"; also
  `Agents/Roadmap.md`, Phase 2 item 3 (not item 1 — see note)
- **Related:** MC-001, MC-007

> The maintainer has 500+ characters; extreme users have 1000+.

Roadmap's own wording, again under Phase 2 item 3 rather than item 1 as the seed material named it:

> Real profiles: maintainer 500+ characters, extreme users 1000+.

---

### MC-007 — Users at 1000+ characters consistently report instability and sudden data/asset loss

- **Tag:** stated
- **Date:** 2026-09-21
- **Sweep ref:** F7
- **Source:** `Agents/Reports/12-charlist-avatar-plan.md`, "§1 Problem, as measured"
- **Related:** MC-006

> Users at 1000+ consistently report instability and sudden data/asset loss.

---

### MC-008 — 100+ modules firsthand; 50+ reported as common in the community (unverified impression)

- **Tag:** stated
- **Date:** 2026-09-21
- **Sweep ref:** F8
- **Source:** `Agents/Reports/10-stage-b-module-draft-copy-plan.md`, "§10.5 Measure before planning
  anything — there is no end-to-end number"
- **Related:** MC-009, MC-010

> The maintainer reports **100+ modules** in their own installation (firsthand), and that **50+
> module installations seem common in the community** (their impression, not measured — record as
> reported, not verified). They explicitly noted they sit at the heavy end and asked that this be
> taken as context.

**Canonical wording note.** `Agents/Phase2-Handoff.md` ("Doctrine learned this checkpoint," item 5)
carries the same two figures without the hedge: "The maintainer runs **100+ modules** and reports
50+ as common in the community." That drops the "their impression, not measured" qualifier this
entry's canonical source (Report 10) attaches to the 50+ figure. The 100+ figure is firsthand in
both; the 50+ figure is impression-only in both, but only Report 10 says so explicitly. Treat the
Handoff's copy as lossy, not as a second, independent confirmation.

---

### MC-009 — Asset modules bundle 10,000+ images to route around RisuRealm's 150 MB card limit, reaching 1-2 GB on disk

- **Tag:** stated
- **Date:** 2026-09-21
- **Sweep ref:** F9
- **Source:** `Agents/Reports/10-stage-b-module-draft-copy-plan.md`, "§10.5b Benchmark result, and
  why it is PROVISIONAL" (not §10.5d as the sweep's location note said — see note); also
  `Agents/Phase2-Handoff.md`, "Doctrine learned this checkpoint," item 5
- **Related:** MC-008

> The maintainer reports real "asset modules" bundling **10,000+ images** to work around
> RisuRealm's 150 MB upload limit, reaching 1-2 GB on disk.

`Phase2-Handoff.md`'s shorter paraphrase of the same fact: "Asset modules bundle **10,000+ images**
to get around RisuRealm's 150 MB limit, reaching 1-2 GB on disk." Both name the same figures; the
wording differs but the claim does not, so this is filed as one fact rather than two.

---

### MC-010 — All Stage-B module-editor measurements were taken on an i9-13900K / RTX 3090 / 64 GB DDR5 machine

- **Tag:** stated
- **Date:** 2026-09-21
- **Sweep ref:** F10
- **Source:** `Agents/Reports/10-stage-b-module-draft-copy-plan.md`, "§10.5h HARDWARE CONTEXT —
  every number above is a BEST CASE"

> Supplied by the maintainer. **All measurements in 10.5b through 10.5g were taken on an
> Intel i9-13900K / RTX 3090 / 64 GB DDR5 machine** — near the top of consumer single-threaded JS
> performance. They are a *lower bound on latency*, not a typical user experience.

**Canonical wording note — three copies of decreasing precision.** This is the full spec, and is
canonical. `Agents/Phase2-Handoff.md` ("Doctrine learned this checkpoint," item 3) drops the GPU:
"All measurements came from an **i9-13900K / 64 GB DDR5**." `Agents/Tools/README.md` drops both the
GPU and the RAM: "Campaign measurements to date were taken on an i9-13900K; see the Stage B plan
[…] before quoting any absolute millisecond figure as a user-facing claim." None of the three
contradicts another — each is a shorter copy of the same fact, progressively losing detail. Treat
only Report 10's wording as complete.

---

### MC-011 — This fork has never shipped and has no userbase; the campaign gates the first release

- **Tag:** stated
- **Date:** 2026-09-23
- **Sweep ref:** F11
- **Source:** `Agents/Reports/21-deferral-re-review.md`, opening ("Why this exists")

> The maintainer established on 2026-09-23 that **this fork has never shipped and has no
> userbase** — the campaign itself gates the first release, and the last build with users is
> upstream.

---

### MC-012 — The RisuAccount hub is maintained entirely upstream and cannot be modified from this repo

- **Tag:** stated
- **Date:** 2026-09-20
- **Sweep ref:** F12
- **Source:** `Agents/Summary.md`, "§5 Multi-Instance / Multi-Writer Conflicts"; also
  `Agents/Roadmap.md`, Phase 1.5 Tier B item 6

> **Update (2026-09-20, confirmed by the project owner directly, not just inferred from the
> absence of hub source in this repo): the hub is maintained entirely upstream and cannot be
> modified from this repo at all.** This was originally flagged as an open investigation question
> ("what does the hub enforce, and could we find out"); it is now a confirmed hard constraint
> instead — not a temporary gap pending more research.

Roadmap's version of the same update: "**Update (2026-09-20):** the project owner directly
confirmed the hub is maintained entirely upstream and cannot be modified from this repo at all —
this is a confirmed hard constraint, not an open question that more investigation could resolve."

---

### MC-013 — The trash implementation is known to be unstable among the community

- **Tag:** stated
- **Date:** not recorded · on or before 2026-09-21 (`54e9dc58`)
- **Sweep ref:** F13
- **Source:** `Agents/Roadmap.md`, "CHORE-03 — Trash: dedicated bug-hunting pass"

> **Maintainer report: the trash implementation is known to be unstable among the community.**

---

### MC-014 — Enabling or disabling a module freezes the UI, from both entry points

- **Tag:** stated
- **Date:** not recorded · on or before 2026-09-21 (`54e9dc58`)
- **Sweep ref:** F14
- **Source:** `Agents/Roadmap.md`, "CHORE-04 — Module enable/disable causes a freeze too, by a
  DIFFERENT mechanism"

> **Maintainer report:** enabling a module from the chat screen (hamburger -> modules) and from
> Settings -> Modules both freeze. Deserves its own investigation.

---

### MC-015 — Much of the UI, dialogs and informational text render in English regardless of the selected language

- **Tag:** stated
- **Date:** not recorded · on or before 2026-09-21 (`54e9dc58`)
- **Sweep ref:** F15
- **Source:** `Agents/Roadmap.md`, "CHORE-05 — Translation coverage: much of the UI is
  English-only"

> **Maintainer report:** a lot of UI, dialogs and informational text render in English regardless
> of the selected language, which dilutes the localised experience.

---

### MC-016 — Old user reports exist of the cold-storage "could not be loaded" error text

- **Tag:** stated
- **Date:** 2026-09-21
- **Sweep ref:** F16
- **Source:** `Agents/Roadmap.md`, "CHORE-07 — A transient cold-storage read failure permanently
  orphans a chat (DATA LOSS, reproduced)"

> **Seen in the wild (maintainer, 2026-09-21):** old user reports exist of this exact
> `[Cold storage data could not be loaded...]` text. Cold storage defaults to on only for installs
> that had no plugins at first load, so the affected population is mostly plugin-free users.

---

### MC-017 — Two community plugins that write the database were supplied by the maintainer as evidence

- **Tag:** stated
- **Date:** 2026-09-21
- **Sweep ref:** F17
- **Source:** `Agents/Roadmap.md`, "CHORE-01 — Mutations to a NON-selected character are never
  marked for save"; also `Agents/Reports/12-charlist-avatar-plan.md`, "§3 AV-2 — lazy avatar
  resolution (constraints; plan after AV-1 lands)"

> **Real plugin exposure (2026-09-21).** Two community plugins, provided by the maintainer
> (`Agents/Evidences of Investigations/`, gitignored, never commit), write the database through the
> plugin API:
> - **AssetGod v3_alt:** `risuai.setDatabase` ×7.
> - **fast-character-import v3 2.0.0:** `setDatabaseLite` and `setCharacterToIndex`.

Report 12's shorter restatement: "**Real plugins checked (2026-09-21):** AssetGod v3_alt and
fast-character-import v3, both maintainer-provided and gitignored."

---

### MC-018 — Korean translations of the save-conflict keys were reviewed by the maintainer; the other five locales are model output

- **Tag:** stated
- **Date:** 2026-09-22
- **Sweep ref:** F18
- **Source:** `Agents/Roadmap.md`, "CHORE-05 — Translation coverage," "Status (2026-09-22)"

> **Status (2026-09-22):** the 9 save-conflict keys below are translated into all six locales
> (`0291ea36`; `ko` reviewed by the maintainer, the other five are model translations).

---

### MC-019 — The character list is the slowest part of the app, by the maintainer's own ranking

- **Tag:** stated
- **Date:** 2026-09-21
- **Sweep ref:** F19
- **Source:** `Agents/Reports/12-charlist-avatar-plan.md`, "§1 Problem, as measured"

> The maintainer ranks the character list as the slowest part of the app.

---

### MC-020 — Keystroke freeze once affected every text field; character and lorebook fields no longer freeze

- **Tag:** corrected
- **Date:** 2026-09-21
- **Sweep ref:** F20
- **Source:** `Agents/Reports/10-stage-b-module-draft-copy-plan.md`, "§10.5e PRIOR ART — the fix
  already exists in this file, for characters"; corrected in
  `Agents/Reports/11-stage-b-module-effect-partition-plan.md`, "§2 Why modules and not
  characters — and why this is NOT the character pattern"
- **Related:** MC-037

> The maintainer reports that this "freeze on every keystroke" behaviour **used to affect every
> text field in the app**, and that character definitions and character lorebook entries **already
> got fixed** — modules are the leftover.

**The correction is subtle, and does not mean the maintainer was wrong.** The maintainer's reported
*outcome* — characters and lorebooks do not freeze, modules do — is confirmed true, and Report 11
restates it independently ("Character definitions and character lorebook entries do **not** have
this problem"). What Report 11 corrected was a *mechanism* claim layered on top during report
drafting, not the maintainer's own words:

> **History note (gate finding F-6).** An earlier draft asserted "characters were fixed while
> modules were not". `git log -S "key !== 'characters'"` gives `b4d08b1f` ("fix save lag"), which
> introduced the entire effect-based tracker with character scoping **already present** -- there
> was no later "characters got fixed" event. The maintainer's report describes the user-visible
> outcome (characters do not freeze, modules do), which is accurate; the historical mechanism claim
> was not. Do not state it as history in a commit message.

So: the fact is accurate and stands as `corrected` only in the sense that a false inference sitting
next to it in an earlier report draft was removed, not because the maintainer's claim was revised.

---

### MC-021 — Four distinct chat-list slowdowns: opening a long chat, scroll-back sluggishness, streaming lag, typing lag

- **Tag:** stated
- **Date:** 2026-09-22
- **Sweep ref:** F21
- **Source:** `Agents/Reports/19-chat-list-window-plan.md`, "Scope"

> **Scope.** This is Roadmap Phase 2 item 3, the chat-list half. The maintainer reports four
> slowdowns in long chats: opening a long chat, sluggishness after scrolling far back, lag while
> streaming, and typing lag. Module toggling is also slow, which is CHORE-04.

---

### MC-022 — Plugins are widely used; the developer strongly discourages V2.* plugin installation for security reasons

- **Tag:** stated
- **Date:** not recorded · on or before 2026-09-19 (`f7e95130`)
- **Sweep ref:** F22
- **Source:** `Agents/Summary.md`, "Cross-Cutting Observations"

> **Plugin ecosystem context** (project owner, not independently investigated here): plugins are
> widely used, but the developer strongly discourages V2.* plugin installation for security
> reasons.

---

### MC-023 — The Android icon/resource claim is confirmed, but more nuanced than "one misplaced folder"

- **Tag:** verified
- **Date:** not recorded
- **Sweep ref:** F23
- **Source:** `Agents/Reports/04-tauri-platform-expansion.md`, "Executive Summary" (the sweep's
  location note said "top summary," which is the same section)

> The Android icon/resource claim from the project owner is **confirmed, but more nuanced than
> "one misplaced folder."** There are two independent, unrelated sets of Android-shaped assets in
> the repo (detailed below): one is an orphaned leftover from a 2024 Capacitor-based Android
> prototype that has nothing to do with Tauri's pipeline, and the other is a correctly-generated,
> Tauri-convention set that is already sitting in the right place, just unused because
> `tauri android init` was never run.

---

### MC-024 — Long-press/right-click on a module's check icon does bind it character-wide; the mechanism works, it is just undiscoverable

- **Tag:** verified
- **Date:** 2026-09-21
- **Sweep ref:** F24
- **Source:** `Agents/Maybe-Later.md`, "QOL-01," §A

> *(Behaviour confirmed by yor42, 2026-09-21: right-click / long-press does work as documented, and
> does bind character-wide. The feature is fine. Finding it is the problem.)*

---

### MC-025 — Maintainer wants to explore speeding up backup specifically on Tauri and local (non-account) paths

- **Tag:** stated
- **Date:** 2026-09-21
- **Sweep ref:** F25
- **Source:** `Agents/Maybe-Later.md`, "QOL-04"

> **yor42, 2026-09-21, after seeing the refutation: wants to explore speeding up backup on Tauri
> and local specifically.** That is the tractable half and it is well scoped, because those are
> exactly the two cases where the `isAccount` throttle never runs.

---

### MC-026 — Upstream's own maintainer objected to a community backup plugin over server strain

- **Tag:** stated
- **Date:** not recorded · on or before 2026-09-21 (`80eec3c1`)
- **Sweep ref:** F26
- **Source:** `Agents/Maybe-Later.md`, "QOL-04"

**Referent note — read carefully.** In every other entry in this document, "the maintainer" means
this fork's maintainer. `Agents/Maybe-Later.md`, QOL-04 is the one place in the seeded material
where "maintainer" means someone else: **upstream's** developer, not this fork's.

> The upstream maintainer's objection to a community backup plugin was specifically that plugins
> run on the public instance and would strain its asset-cache servers; `backuplocal.ts:147-150` is
> that concern encoded in this codebase.

This sits immediately beside the standing rule that the account/sync path must never be made more
aggressive, which is exactly where that rule traces back to. The same paragraph states the rule
directly: "**Do not** make the account/sync path more aggressive. […] Any change here must leave
the `isAccount` branch's behaviour alone, and must not assume a self-hosted deployment is
automatically off that path."

---

### MC-027 — `.gitignore` excludes two specific Evidences subdirectories, not the whole tree

- **Tag:** corrected
- **Date:** 2026-09-23
- **Sweep ref:** none (a standing-practice correction, not part of the F/D sweep table)
- **Source:** `.gitignore` (repo root); `git log --diff-filter=A -- "Agents/Evidences of
  Investigations/Asset Cache/example symptoms.png"`

The campaign's working practice has carried a rule that "`Agents/Evidences of Investigations/` is
gitignored" without qualification. That is too broad. `.gitignore` names exactly two
subdirectories:

> Agents/Evidences of Investigations/Community plugins to solve common pain points/
> Agents/Evidences of Investigations/Asset Cache/Community Mitigation_Webrowser Plugin/

The rest of that tree is tracked, maintainer-supplied evidence. Confirmed directly: `Agents/Evidences
of Investigations/Asset Cache/example symptoms.png` has been committed since `f7e95130`
(2026-09-19), and `git status` at the start of this document's drafting session showed it clean
(no pending change to revert or re-ignore). Verified by the Orchestrator, 2026-09-23.

---

### MC-052 — This is a personal fork about a week old, not a long-lived community fork

- **Tag:** corrected
- **Date:** 2026-09-23
- **Sweep ref:** none (a direct maintainer correction, not part of the F/D sweep table)
- **Source:** stated by the maintainer directly, 2026-09-23. No prior document records it.
- **Corrects:** MC-033
- **Related:** MC-011

`MC-033` quotes a recorded decision containing the line "This work is a long-lived community fork
(like Haejeok-Risu or PocketRisu), not a series of upstream PRs." **The characterization is
wrong.** The maintainer states this is a personal fork, roughly a week old as of 2026-09-23,
created to fix the known data-loss and performance issues directly rather than through upstream
PRs. It has no userbase and no community, and is not comparable to Haejeok-Risu or PocketRisu.

**What MC-033 decided still stands in full.** Only the characterization is corrected, not the
decision. The `risuai.d.ts` note, the instruction that plugin code must keep working on upstream,
the `try/catch` guidance, and the general fork rule — stay fully backward compatible with upstream
characters, modules, presets, `.bin` backups and plugins, and keep changes non-invasive — are all
unaffected. The "not a series of upstream PRs" half of the original line is also correct.

**Provenance is uncertain.** The line sits inside
`Agents/Reports/13-chore07-cold-read-failure-plan.md`, "§5.1 Maintainer decisions (2026-09-21)",
as a sub-bullet supporting the `risuai.d.ts` note, so it was recorded as maintainer-sourced. The
maintainer believes it was an agent's inference. Nothing in the corpus settles which, and the
distinction is not worth pursuing — what matters is that the characterization is not to be
repeated or built on.

**Provenance, settled 2026-09-23.** The paragraph above is superseded: the maintainer stated the
origin directly. It was an agent's inference, and the mechanism is named.

> the long-lived community fork claim is context cross-contamination because I mentioned the other
> forks that was released earlier and has bit more userbase. and previous session decided to
> believe that this is one of the long lasting one too.

**The failure mode generalises, and is the reason this entry is worth its length.** The maintainer
named Haejeok-Risu and PocketRisu as *comparisons* — other forks that exist, shipped, and have some
userbase. A session then transferred those projects' properties onto this one and wrote the result
into a report as a maintainer decision, where it was read as maintainer-sourced ever after. Nothing
was fabricated outright; a real statement was over-extended by one step, and that step was never
marked.

**How to apply.** When the maintainer cites another project, treat the citation as a comparison
until they say otherwise. Properties of the cited project — release status, userbase, age,
governance — do not transfer to this one. If an inference of that kind is load-bearing enough to
record, record it as an inference with its basis, not as a stated fact; `MC-026` is the other place
in this log where a referent slipped, and it carries a similar warning.

**Why this matters beyond wording.** "Long-lived community fork" invites reasoning about
community expectations, contributor onboarding, and an installed base — none of which exist.
Combined with `MC-011` (this fork has never shipped), the correct picture is: no users, no
community, no shipped behaviour to preserve, and therefore no reason to weigh a design by how
little it disrupts the current fork. The upstream compatibility invariant is unaffected, because
it exists for users migrating *from* upstream.

---

## Decisions

### MC-028 — All four avatar stages (AV-1 through AV-4) are in scope, in rising-risk order

- **Tag:** decision
- **Date:** 2026-09-21
- **Sweep ref:** D1
- **Source:** `Agents/Reports/12-charlist-avatar-plan.md`, opening (status block and the
  paragraph that follows it); also `Agents/Phase2-Handoff.md`, "LIVE STATE — session of 2026-09-21
  afternoon" (section removed 2026-09-23 in the handoff/Live-State split; the quoted text is preserved in git history as of `ca27760f`)
- **Reasoning:** the chosen order is stated as being "by rising risk" (quoted below); no further
  reasoning is recorded in source.
- **Alternatives rejected:** not recorded in source.
- **Depends on:** not recorded in source.

> **Scope chosen by the maintainer:** all four stages, A, B, C and D (see §1). […] The maintainer's
> letters map as follows: A → **AV-1**, C → **AV-2**, B → **AV-3**, D → **AV-4**. That is also the
> implementation order, which is by rising risk.

`Phase2-Handoff.md` records the same choice from the maintainer's own session: "Phase 2 **item 3**
first, starting with the **character lists**. The maintainer chose all four avatar stages. […]
Order: AV-1 (stop re-lookups), then AV-2 (lazy-mount), then AV-3 (plain-HTTP encode), then AV-4
(thumbnails). **Keep B (AV-3) before D (AV-4).**"

---

### MC-029 — AV-3: cache the encoded avatar string with a byte budget, not `blob:` URLs; fold in `fileSrcCache`; 64 MiB

- **Tag:** decision
- **Date:** 2026-09-22
- **Sweep ref:** D2
- **Source:** `Agents/Reports/15-av3-plain-http-encode-plan.md`, opening status block
- **Reasoning:** not recorded in source as the maintainer's own stated reasoning (the plan's design
  section argues for option (a), but that is the plan's reasoning, not a quoted maintainer
  rationale).
- **Alternatives rejected:** option (b), `blob:` URLs (named, not explained in the maintainer's own
  words).
- **Depends on:** not recorded in source.

> **Maintainer decisions (2026-09-22):** option (a), caching the encoded string with a byte budget,
> not `blob:` URLs. **Fold in** the chat renderer's unbounded `fileSrcCache`. Budget **64 MiB**.

---

### MC-030 — AV-4: NovelAI 832×1216 PNG as the baseline avatar; first view waits for the thumbnail; animated avatars stay full-size

- **Tag:** decision
- **Date:** 2026-09-22
- **Sweep ref:** D3
- **Source:** `Agents/Reports/16-av4-list-avatar-thumbnails-plan.md`, opening status block
- **Reasoning:** "Many users generate avatars there" (quoted below) is the stated reasoning for the
  baseline choice; no further reasoning recorded for the other two decisions in this entry.
- **Alternatives rejected:** not recorded in source.
- **Depends on:** MC-004 (animated avatars must be preserved).

> **Maintainer decisions (2026-09-22):**
> - Baseline avatar: the NovelAI portrait, **832×1216 PNG**. Many users generate avatars there.
> - **First view waits for the thumbnail.** A list icon without a thumbnail is generated before it
>   shows. Where a thumbnail exists, the lists never hold the full-size image. Each avatar pays
>   this once.
> - Animated avatars exist and must stay animated (Report 12 §1).

---

### MC-031 — CHORE-07 is staged 7a/7b/7c, with 7c split again per the maintainer's "keep it minimal" direction

- **Tag:** decision
- **Date:** 2026-09-21
- **Sweep ref:** D4
- **Source:** `Agents/Reports/13-chore07-cold-read-failure-plan.md`, opening status block and
  "§5 Stage 7c — plan"
- **Reasoning:** the campaign rule to split risky batches into gated stages (stated in the status
  block, quoted below).
- **Alternatives rejected:** not recorded in source.
- **Depends on:** not recorded in source.

> **Status:** revision 3. Revisions 1 and 2 each received "approve with required changes" from
> `opus-reviewer` (ledger 23 and 25), with a new BLOCKER each time. Rev 3 **stages** the work, per
> the campaign rule to split risky batches into gated stages.

And, on splitting 7c further:

> 7b is committed (`3e17c8a3`) as a minimal core. It stops overwriting the chat, adds the send
> guards and shows a soft notice. 7c is split into two sub-stages, following the maintainer's
> "keep it minimal" direction, and **each sub-stage gets its own gate.**

---

### MC-032 — CHORE-07 plugin storage: option A — `getItem`/`setItem` reject on failure

- **Tag:** decision
- **Date:** 2026-09-21
- **Sweep ref:** D5
- **Source:** `Agents/Reports/13-chore07-cold-read-failure-plan.md`, "§5.1 Maintainer decisions
  (2026-09-21)"
- **Reasoning:** not recorded in source beyond the decision itself.
- **Alternatives rejected:** not named in source (the plan calls this "option A" without recording
  what option B was).
- **Depends on:** not recorded in source.

> - **Plugin storage, option A.**
>   - `pluginStorage.getItem` **rejects** when a read fails, and resolves `null` only when the data
>     is really missing.
>   - `pluginStorage.setItem` **rejects** when a write fails. Today it ignores
>     `setColdStorageItem`'s `false`.

---

### MC-033 — Label the reject behaviour fork-specific in `risuai.d.ts`; general fork-compatibility rule

- **Tag:** decision
- **Date:** 2026-09-21
- **Sweep ref:** D6
- **Source:** `Agents/Reports/13-chore07-cold-read-failure-plan.md`, "§5.1 Maintainer decisions
  (2026-09-21)"
- **Reasoning:** stated directly (quoted below) — upstream accepts only small, measurable PRs, so
  this work will not land there, and plugin code must keep working on upstream too.
  **[corrected 2026-09-23]** This line previously opened "this is a long-lived community fork, and
  upstream accepts…". That characterization was wrong and is retired by `MC-052`; the rest of the
  reasoning, and the decision itself, are unchanged.
- **Alternatives rejected:** not recorded in source.
- **Depends on:** MC-032.

> - **`risuai.d.ts` note.** Document that both can reject, and label this **specific to this
>   fork**.
>   - This work is a long-lived community fork (like Haejeok-Risu or PocketRisu), not a series of
>     upstream PRs. Upstream appears to accept only small, measurable PRs.
>   - Plugin code must keep working on upstream too. The note should tell authors to wrap these
>     calls in `try/catch`, which is harmless on upstream, and must not suggest they can count on
>     the rejection happening.

**Corrected by:** `MC-052` — the "long-lived community fork (like Haejeok-Risu or PocketRisu)" characterization is wrong;
this is a personal fork about a week old. The decision recorded here is unaffected.

---

### MC-034 — CHORE-07 7b's minimal core was approved; the firm "data lost" notice waits for 7c

- **Tag:** decision
- **Date:** 2026-09-21
- **Sweep ref:** D7
- **Source:** `Agents/Investigation-Ledger.md`, row 39
- **Reasoning:** stated directly — a failed load that stops writing the error text still leaves the
  pointer on screen indefinitely, so a firm "delete this chat" notice needed a reliable
  missing-vs-error signal that did not exist yet.
- **Alternatives rejected:** shipping the firm notice with the minimal core (rejected because the
  missing-vs-error signal was not yet reliable).
- **Depends on:** MC-031.

> Verdict: **approve with findings**, for a minimal core. Key finding (Orchestrator-verified): once
> a failed load stops writing the error text, the pointer stays on screen indefinitely, so
> `/cut`/`/del`/`/multisend clear` could drop it and a later cleanup could delete the blob — the
> core therefore had to include a `sendMain` guard and a notice, not just 'no mutation'. Deferred
> to 7c: the three-way reader, side-field merges, the plugin `sendChat` guard, save-marking, a
> Retry button. Maintainer approved the core; the firm 'delete this chat' notice waits for a
> reliable missing-vs-error signal in 7c.

---

### MC-035 — CHORE-01 + item 2: option B (selection-scoped partition plus explicit marks), not option A (watch every character)

- **Tag:** decision
- **Date:** 2026-09-22
- **Sweep ref:** D8
- **Source:** `Agents/Reports/17-chore01-item2-plan.md`, opening status block and "§2 Why option
  B, not option A"
- **Reasoning:** option A retains far more memory and boot cost at scale, and the hardware floor
  is a Pi 3 and mid-range phones (quoted below).
- **Alternatives rejected:** option A — "one deep child effect per character."
- **Depends on:** MC-003.

> Design choice made by the maintainer on 2026-09-22: **option B** (selection-scoped partition plus
> explicit marks), not option A (watch every character). §2 records why.

The stated reasoning:

> Option A (one deep child effect per character) fixes CHORE-01 for every writer, but retains about
> **+170 MB** at 1000 characters / ~148k messages (537 → 708 MB, Node) and 1.5-1.7 s at boot on the
> i9, and it would lock in the boot proxy materialisation that is Phase 2 item 8's main lever. The
> hardware floor is a Pi 3 and mid-range phones. The maintainer chose B.

---

### MC-036 — Plugin `setDatabase`/`setDatabaseLite`: mark every character for save rather than reload

- **Tag:** decision
- **Date:** 2026-09-22
- **Sweep ref:** D9
- **Source:** `Agents/Reports/17-chore01-item2-plan.md`, "§10 Gate record," "Gate 1 re-review —
  opus-reviewer (fresh), 2026-09-22 — [APPROVE-WITH-FINDINGS] (rev 2)"; see also §3.3
- **Reasoning:** stated directly — this is "for safety," because V2 plugins edit the database in
  place where the change cannot be observed, and V3 plugins hand back fresh copies (quoted below).
- **Alternatives rejected:** reloading the encoder on a plugin `setDatabase` call — rejected because
  a stale plugin snapshot would then become a new permanent-deletion path.
- **Depends on:** MC-035, MC-017.

> **F3** reload from a stale plugin snapshot is a new permanent-deletion path → **maintainer chose
> marking every character instead of reloading** (§3.3, §7, §8).

§3.3's handler table states the decision itself:

> **Maintainer decision (re-review F3), 2026-09-22: mark, do not reload.**

The "for safety" rationale is **not** in Report 17. It is in `Agents/Roadmap.md`, "CHORE-17":

> That is the maintainer's F3 decision, for safety: V2 edits in place and can't be seen; V3 hands
> back fresh copies. The next save re-encodes all N.

---

### MC-037 — CHORE-17: build "layer 2" (skip unchanged writes) only, for now; layer 1 (setter reconcile) is on hold

- **Tag:** decision
- **Date:** 2026-09-22
- **Sweep ref:** D10
- **Source:** `Agents/Roadmap.md`, "CHORE-17 — Plugin `setDatabase` re-encodes every character (a
  cost, not data loss)"; also `Agents/Reports/18-chore17-skip-unchanged-writes-plan.md`, opening
  "Scope"
- **Reasoning:** the choice followed a real Chromium measurement of the CHORE-01 Stage 2 cost
  (stated in the Roadmap entry); the Roadmap is cited as recording why layer 1 is on hold, but the
  "why" itself is not quoted in the seed material for this entry.
- **Alternatives rejected:** layer 1, the plugin-setter boundary reconcile — deferred, not
  rejected outright.
- **Depends on:** MC-036.

> **Status (2026-09-22):** Sequenced after CHORE-01 Stage 2, by the maintainer's decision. Stage 2
> is now implemented, gated and committed as `fbf799a7`, so CHORE-17 was unblocked and measured in
> real Chromium (see "Measured" below). Based on that measurement, the maintainer chose to build
> **layer 2 only** (the encoder's exact-bytes skip) plus a **remote content-hash write dedupe**,
> now. **Layer 1 (the setter boundary reconcile) is ON HOLD** — see "Why layer 1 is on hold" below.

Report 18's scope statement of the same decision:

> **Scope (maintainer's decision, 2026-09-22):** only "layer 2" from the CHORE-17 entry in
> `Agents/Roadmap.md`: skip storage writes whose bytes are already stored. The plugin-setter
> reconcile ("layer 1") is on hold; the Roadmap records why.

---

### MC-038 — CHORE-17 is sequenced after CHORE-01 Stage 2

- **Tag:** decision
- **Date:** 2026-09-22
- **Sweep ref:** D11
- **Source:** `Agents/Roadmap.md`, "CHORE-17 — Plugin `setDatabase` re-encodes every character (a
  cost, not data loss)"
- **Reasoning:** not recorded in source beyond the sequencing statement itself.
- **Alternatives rejected:** not recorded in source.
- **Depends on:** MC-035.

> **Status (2026-09-22):** Sequenced after CHORE-01 Stage 2, by the maintainer's decision.

---

### MC-039 — Escalation to `senior-advisor` was requested, and its recommended order was approved

- **Tag:** decision
- **Date:** 2026-09-22
- **Sweep ref:** D12
- **Source:** `Agents/Reports/19-chat-list-window-plan.md`, opening status block and "§3 Direction
  (senior-advisor escalation, 2026-09-22; the maintainer approved the order)"; also
  `Agents/Investigation-Ledger.md`, row 97
- **Reasoning:** the trigger for escalating was "several materially different designs failing, and
  a loop" (quoted below); the maintainer's own reasoning for approving the recommended order is not
  separately recorded.
- **Alternatives rejected:** a sixth attempt at guarding the window policy directly, which the
  escalation's own DO-NOT list rules out (recorded as the advisor's recommendation, not a named
  maintainer rejection).
- **Depends on:** not recorded in source.

> Earlier history:
> - Gate 1 rejected revs 1-5, each time finding a new edit-loss path or a false premise (§7).
> - The Orchestrator then escalated to `senior-advisor`. The triggers were several materially
>   different designs failing, and a loop. The maintainer asked for the escalation and approved its
>   recommended order.

The ledger's independent record of the same approval: "The maintainer approved the order and
deferred the multi-tab trade-off to the durable-drafts plan."

---

### MC-040 — Skip the containment experiment's own stage; take the `changeChatTo` fan-out fix instead

- **Tag:** decision
- **Date:** not recorded · on or before 2026-09-23 (`fbc0bd7c`)
- **Sweep ref:** D13
- **Source:** `Agents/Reports/19-chat-list-window-plan.md`, opening status block
- **Reasoning:** the containment experiment "does not pay for itself" (quoted below); §8.6 of the
  same report states this is a recommendation the maintainer's approved order permits changing, but
  does not itself narrate the maintainer's words for choosing the fan-out fix.
- **Alternatives rejected:** shipping containment (`content-visibility: auto`) as its own stage.
- **Depends on:** MC-039.

> Containment experiment: **measured** (§8). It does not pay for itself; the maintainer chose to
> skip it and take the `changeChatTo` fan-out fix instead.

---

### MC-041 — The multi-tab gate ships as option (b): a draft kind, not a Pareto-argued option (a)

- **Tag:** decision
- **Date:** not recorded
- **Sweep ref:** D14
- **Source:** `Agents/Reports/20-durable-drafts-plan.md`, "§6 The multi-tab gate: option (b), as a
  draft kind (maintainer decision)"
- **Reasoning:** stated directly — option (a)'s Pareto argument compares against "a build that has
  never had a user," which is a scope argument, not a shipping one (quoted below).
- **Alternatives rejected:** option (a), a Pareto-based simplification, rejected because its
  comparison is against a build that has never had a user. No other option is recorded in source.
- **Depends on:** MC-011.

> Rev 1 recommended (a) on a Pareto argument. That compares against a build that has never had a
> user, so it is a scope argument, not a shipping one. **Adopted: (b), as a draft kind.**

---

### MC-042 — A restored draft must be visible and reversible: a marker plus a one-click revert

- **Tag:** decision
- **Date:** not recorded
- **Sweep ref:** D15
- **Source:** `Agents/Reports/20-durable-drafts-plan.md`, "§5.4 A restore is visible and reversible
  (maintainer decision)"
- **Reasoning:** stated directly — without this, the stage would add "a new quiet failure": a user
  opening an editor expecting a small edit, finding an hour-old draft, and unknowingly overwriting
  the current message wholesale (quoted below).
- **Alternatives rejected:** a silent restore (the design the stage would default to without this
  decision).
- **Depends on:** not recorded in source.

> Without this the stage adds a new quiet failure: the user opens an editor intending a small
> change to the text they can see, the box holds something typed an hour ago, they edit the tail
> and save, and the message is replaced wholesale.
>
> A restored buffer carries a visible marker and a one-click revert to the stored message text.

---

### MC-043 — The composer's mis-send fix is split into its own stage, after first being folded in

- **Tag:** decision
- **Date:** not recorded
- **Sweep ref:** D16
- **Source:** `Agents/Reports/20-durable-drafts-plan.md`, "§4.5 The composer moves to its own
  stage (maintainer decision)"
- **Reasoning:** stated directly — the fold-in would have re-imported the same freeze-at-open
  hazard already fixed for message editors, because the composer has no "open" event to freeze an
  identity at, and the draft unit needed to move as three linked values, not one (quoted below).
- **Alternatives rejected:** folding the composer fix into this same stage (attempted in revision
  2, then found unsafe by the gate).
- **Depends on:** not recorded in source.

> **Gate 1 round 2 showed the fold-in imports a new instance of rev 1's blocker.** §5.1's whole
> remedy is "freeze at editor-open", and **the composer has no open event** — it is always live.
> [...]
> **The maintainer chose to split it out.** The composer stage needs: a normative
> flush-under-the-old-key-then-restore-under-the-new-one ordering, all three values moving
> together, and a generation token for the async translate writes. It is next, not never.

---

### MC-044 — Module draft-copy durability: full parity with today's behaviour, reaffirmed after a cost correction, decided twice

- **Tag:** superseded
- **Date:** 2026-09-21
- **Sweep ref:** D20
- **Source:** `Agents/Reports/10-stage-b-module-draft-copy-plan.md`, "§3.7 Durability — the flush
  paths (maintainer-directed, full parity)" and "§6 Open questions for the gate," item 1
- **Reasoning:** the maintainer first chose full parity believing it cost one Tauri hook;
  investigation then found it also needed a new awaitable save primitive, and that a cheaper
  debounce-only alternative would land within about 500 ms of today's actual behaviour, because
  today's durability is itself only trailing-debounced. Told this correction, the maintainer
  reaffirmed full parity a second time (quoted below).
- **Alternatives rejected:** a 500 ms debounce alone, with no save-loop change, accepting ~500 ms
  of extra exposure as a documented limitation.
- **Depends on:** MC-008, MC-009, MC-010, MC-020 (the maintainer's own context — profile sizes,
  asset modules, hardware, and the character-editor comparison — is what `Phase2-Handoff.md`
  credits with settling this line of work more than either review gate did; see the closing
  section below).

> The maintainer was shown the cheaper alternative (a 500 ms debounce alone, no save-loop change,
> ~500 ms of extra exposure written up as an accepted limitation) and **reaffirmed full parity**,
> explicitly accepting a change to `saveDb()`. That decision is recorded, not re-litigated here.

The "decided twice" account, from §6:

> **RESOLVED by the maintainer, 2026-09-21 — full durability parity, decided twice.** [...]
> The maintainer first chose full parity believing it cost one Tauri hook. Investigation then
> established that it also requires a new awaitable save primitive inside `saveDb()` (§3.7.4), and
> separately that the cheaper alternative — a 500 ms debounce alone, no save-loop change — lands
> within ~500 ms of today's actual behaviour, because today's durability is itself only
> trailing-debounced (§3.7). Both corrections were put back to the maintainer, who **reaffirmed
> full parity and explicitly accepted the save-loop change.** Recorded, not re-litigated.

**This decision is historical, not binding on what shipped.** It governed the module draft-copy
design end-to-end — the whole design it belongs to was later retired in its entirety (two
`opus-reviewer` gates plus a `senior-advisor` escalation; see "Decisions commonly mis-attributed to
the maintainer," below). This durability decision does **not** bind the effect-partition design
that actually shipped (`Agents/Reports/11-stage-b-module-effect-partition-plan.md`), which does not
move data out of `db.modules` and therefore has no equivalent durability gap to decide. **Superseded
by:** the retirement of the module draft-copy design as a whole. That retirement is not itself a
maintainer decision with its own `MC-` id — see the closing section, which explains why — so this
back-pointer names the closing section rather than a single entry.

---

### MC-045 — OPFS: wire up a real settings toggle rather than delete the dead code

- **Tag:** decision
- **Date:** not recorded · on or before 2026-09-19 (`155c915c`)
- **Sweep ref:** D21
- **Source:** `Agents/Roadmap.md`, Phase 1 item 5
- **Reasoning:** stated directly — the atomicity bug was already fixed (Phase 0), and genuine
  cross-tab-safe migration in both directions now exists (quoted below).
- **Alternatives rejected:** removing the dead OPFS code entirely.
- **Depends on:** not recorded in source.

> **✅ DONE. OPFS settings toggle** — decided (user choice) to wire up a real in-app settings path
> (`src/lib/Setting/Pages/FilesSettings.svelte`, "Local Storage Backend") rather than remove the
> dead code, now that its atomicity bug is fixed (Phase 0) and it has genuine cross-tab-safe
> migration in both directions (see the Status section above for the nine-round review history —
> this ended up being the single hardest-won fix across all phases so far, requiring a real Web
> Locks (`navigator.locks`)-based cross-tab mutex, not just the in-process `dbWriteLock`).

---

### MC-046 — `db.enableRemoteSaving`'s default flips from opt-in to opt-out, as an informed product decision

- **Tag:** decision
- **Date:** not recorded · on or before 2026-09-20 (`724d4334`)
- **Sweep ref:** D22
- **Source:** `Agents/Roadmap.md`, Phase 1.5 Tier B item 5
- **Reasoning:** not recorded in source beyond it being described as "an explicit, informed product
  decision made in-session, not something implemented unilaterally" (quoted below).
- **Alternatives rejected:** leaving the default at opt-in.
- **Depends on:** not recorded in source.

> Extending the existing per-character `remote: 'prefer'` block-splitting mechanism's eligibility to
> account-sync, and flipping `db.enableRemoteSaving`'s default from opt-in to opt-out (the latter an
> explicit, informed product decision made in-session, not something implemented unilaterally), were
> both implemented, then reverted after round 1 of Codex review on item 4's work found a real,
> high-severity data-integrity gap [...]

**Note.** This decision was made, then the feature it enabled (Stage 3, blast-radius reduction) was
implemented and reverted in the same round after a data-integrity gap was found (see the same
Roadmap entry). The decision to flip the default is recorded as made; the source does not state
that the decision itself was reversed, only that the accompanying implementation was.

---

### MC-047 — Android must not be scoped as a standalone task; it is gated behind the RAM/performance rework

- **Tag:** decision
- **Date:** not recorded · on or before 2026-09-19 (`f7e95130`)
- **Sweep ref:** D23
- **Source:** `Agents/Reports/04-tauri-platform-expansion.md`, "Sequencing Constraint: Android Is
  Gated Behind RAM/Performance Fixes"; also `Agents/Summary.md`, "§4 Tauri Platform Expansion"
- **Reasoning:** the current architecture — no virtual scrolling, the entire save database in one
  large reactive in-memory state object — would OOM low-RAM Android devices if cross-compiled as-is
  (stated in both cited sources).
- **Alternatives rejected:** treating Android as a parallel or independent workstream.
- **Depends on:** not recorded in source (the RAM/performance investigation this gate depends on is
  cross-referenced by topic, not by an `MC-` fact seeded here).

> Per explicit instruction from the project owner for this investigation: **do not recommend "just
> add Android support" as a standalone, immediately-actionable item.** A separate investigation
> found the current implementation is RAM-heavy — no virtual scrolling, and the entire save
> database appears to live in one large reactive in-memory state object — and naively
> cross-compiling that as-is to Android would cause OOM crashes on low-RAM Android devices. This
> report treats Android strictly as a **later-phase target**, sequenced strictly *after* that
> RAM/performance rework lands, not as a parallel or independent workstream.

---

### MC-048 — Phase 2 item 3 (character lists) goes first, before the rest of Phase 2

- **Tag:** decision
- **Date:** 2026-09-21
- **Sweep ref:** D24
- **Source:** `Agents/Phase2-Handoff.md`, "LIVE STATE — session of 2026-09-21 afternoon" (section removed 2026-09-23 in the handoff/Live-State split; the quoted text is preserved in git history as of `ca27760f`)
- **Reasoning:** not recorded in source beyond the choice itself.
- **Alternatives rejected:** not recorded in source (Phase 2 items 2 and 4 were the other open
  candidates at the time; the source does not record why they were not chosen first).
- **Depends on:** not recorded in source.

> **Maintainer decisions this session:**
> - Phase 2 **item 3** first, starting with the **character lists**. The maintainer chose all four
>   avatar stages. Plan: `Agents/Reports/12-charlist-avatar-plan.md`. Order: AV-1 (stop
>   re-lookups), then AV-2 (lazy-mount), then AV-3 (plain-HTTP encode), then AV-4 (thumbnails).
>   **Keep B (AV-3) before D (AV-4).**

---

### MC-053 — The home screen's realm block becomes a card in the Related Links grid, not a section above it

- **Tag:** decision
- **Date:** 2026-09-23
- **Sweep ref:** none (stated directly this session)
- **Source:** stated by the maintainer directly, 2026-09-23, answering the open question in the
  home-screen stage brief ("Should the home screen keep a realm *preview* at all, or reduce to a
  single RisuRealm button?").
- **Reasoning:** recorded in the answer itself — the realm block should follow the design
  convention already used by the Related Links buttons rather than being its own full-width
  section.
- **Alternatives rejected:** three options were offered and none was taken: (a) reorder so Related
  Links sit above the realm block, keeping the preview and reserving its height; (b) reduce the
  realm block to a single RisuRealm button; (c) reorder only, without reserving space. The
  maintainer proposed a fourth shape instead.
- **Related:** MC-011, MC-052.

> I think separate widget that follows design convention of other 'related links' button would be
> more fitting to UI scheme. I Imagine it would be a taller, vertical rectangular button that also
> has smaller, more compact list of previews. not sure if its possible though.

**Consequence for the mobile-fold problem.** The brief's Change 1 was that Related Links sit below
the whole realm grid on mobile and are pushed further down when the fetch resolves. This decision
dissolves that by construction rather than by reordering: the realm becomes one card among the
link cards, so link cards exist both above and beside it, and the preview list is bounded inside a
card instead of being an unbounded grid. Giving that card a fixed height also removes the
after-paint shift, since the compact list resolves inside a box whose size is already committed.

**"not sure if its possible though" — it is.** A grid child spanning two rows with a clamped or
scrolling list inside is ordinary CSS grid work and needs no new dependency. This note is recorded
because the uncertainty is in the source and should not be mistaken for a constraint.

---

### MC-054 — Standardise on the `Exy3NrqkGm` Discord invite, and label upstream-owned links as upstream

- **Tag:** decision
- **Date:** 2026-09-23
- **Sweep ref:** none (stated directly this session)
- **Source:** stated by the maintainer directly, 2026-09-23, resolving the two divergent Discord
  invites found in source.
- **Reasoning:** recorded in the answer — this fork has no Discord of its own, so the link points
  at upstream's community and should say so.
- **Alternatives rejected:** dropping the Discord link from the home screen entirely and keeping it
  only on the Communities settings page.
- **Related:** MC-052 (this fork has no community of its own), MC-053.

> Exy3NrqkGm is still live. this fork does not have discord, so I think we can have something like
> a gray text that says 'upstream'.

**The divergence is drift, not intent.** `src/lib/UI/MainMenu.svelte` carries
`https://discord.gg/Exy3NrqkGm` and `src/lib/Setting/Pages/Communities.svelte` carries
`https://discord.gg/JzP8tB9ZK8`. Git history explains how: `JzP8tB9ZK8` was introduced 2023-06-16
(`f72380ef`, "comming soon to offical discord for temp") and appeared in both files; commit
`4063f432` (2024-05-01) removed MainMenu's copy during an unrelated import cleanup; and
`5948aa89` (2024-09-05, "Add related links") added a link block back using a *different* code.
Communities was never revisited. **Liveness is a maintainer-supplied fact, not a git-derived one** —
git establishes only which code is newer.

**The `upstream` label generalises.** It applies to every home-screen link owned by upstream rather
than by this fork, not only Discord — see the brief's Change 2, which adds fork repo and fork issue
links beside the existing upstream ones.

---

### MC-055 — Durable drafts pauses where it is; the home-screen rework finishes first

- **Tag:** decision
- **Date:** 2026-09-23
- **Sweep ref:** none (stated directly this session)
- **Source:** stated by the maintainer directly, 2026-09-23, after a verification pass established
  that the uncommitted durable-drafts work is incomplete rather than finished-but-uncommitted.
- **Reasoning:** stated in the answer — the stage is unfinished, so its state should be recorded
  rather than assumed, and it is picked back up after the home-screen rework rather than
  interleaved with it.
- **Alternatives rejected:** not recorded in source. Finishing durable drafts first, and
  committing the partial work as a checkpoint, were both available and neither was chosen at the
  time of the statement.
- **Related:** MC-042 (the restore affordance that is missing), MC-053, MC-054.

> about the uncommited changes: if those two changes are really unfinished, I think we should
> record it on live status that this is unfinished and we should pick it back up after we finish
> this rework.

**The premise was checked before this decision was made, and the check is why the decision exists.**
The maintainer initially believed the work had been finished by an earlier session that failed to
commit it. A verification pass against `Agents/Reports/20-durable-drafts-plan.md` refuted that: the
main message editor's capture is complete and matches the plan section by section, but the
translation editor is never wired to the draft store (`Chat.svelte` imports only `MessageIdentity`
and never constructs the `TranslationIdentity` that `draftContents.ts` supports), and the `MC-042`
restore marker and one-click revert exist on neither surface — a case-insensitive search for
`revert` or `restored` in `Chat.svelte` returns nothing. Gate 2 was never run; Report 20 §11 stops
at "proceeding to ... Gate 2". `git stash list` is empty and every dangling commit predates the
stage, so there is no lost commit to recover.

**Do not re-open the question of whether this stage is complete.** It was established by source on
2026-09-23. A future session finding substantial, passing, well-tested draft code in the tree is
seeing the *main editor half*, which is genuinely finished — that is precisely what made the work
look complete from the outside.

**Superseded in part (2026-09-24).** The stage resumed after the home-screen rework, as decided
here. The translation editor's capture and the restore marker were then built (`MC-068`), so the
gaps named above describe the tree as of 2026-09-23 only. The sequencing decision itself stands.

---

### MC-056 — The realm feed must distinguish failure from empty; fix it as part of Stage 2

- **Tag:** decision
- **Date:** 2026-09-23
- **Sweep ref:** none (stated directly this session)
- **Source:** stated by the maintainer directly, 2026-09-23, on a defect surfaced while verifying
  the home-screen stage brief.
- **Reasoning:** stated in the answer — the value is diagnostic. The maintainer explicitly accepts
  that upstream's wording is understandable in practice, and fixes it anyway for what it costs
  future debugging.
- **Alternatives rejected:** leaving it, on the grounds that the realm is unlikely to be empty in
  practice — considered by the maintainer in the same breath and rejected.
- **Related:** MC-053 (Stage 2 rebuilds this block, so the two land together).

> "Failed to load" fetch text issue is noted - I can see why upstream dev chose that wording, as
> realm is unlikely to be literally empty, but I think its something that worths to fix as it
> helps diagnosis to future problems too.

**What the code does today.** `src/lib/UI/MainMenu.svelte` renders
`{#await getRisuHub(...) then charas}{#if charas.length > 0}` ... `{:else}` "Failed to load
{language.hub}...". There are four real states and three renderings: a fetch in flight renders
**nothing at all** (the `{#await}` has no pending branch), a failure and a successful-but-empty
response both render "Failed to load", and a populated response renders cards.

**This cannot be fixed in the component alone.** `getRisuHub` in `src/ts/characterCards.ts`
catches every error and returns `[]`, so the distinction is destroyed inside that function before
any caller sees it. It also returns `jso.cards` directly, which is `undefined` when a 200 response
is an object without a `cards` key — and `MainMenu.svelte` then calls `.length` on it with no
`{:catch}` branch anywhere in the block. Fixing the wording therefore means changing
`getRisuHub`'s contract, and `src/lib/UI/Realm/RealmMain.svelte` is a **second consumer** with its
own `getHub()` call sites and its own empty-state handling, so it moves too.

**Related defect in the same function, not separately decided:** the `fetch` has no timeout or
`AbortController`, so an unreachable realm leaves the section blank indefinitely — which is the
same rendering as "in flight". Whatever shape the Stage 2 plan gate chooses should account for it
rather than leaving a fourth indistinguishable state behind.

---

### MC-057 — The realm widget must render a visible pending state: a spinner and "loading..."

- **Tag:** decision
- **Date:** 2026-09-23
- **Sweep ref:** none (stated directly this session)
- **Source:** stated by the maintainer directly, 2026-09-23, as a requirement for the Stage 2
  widget.
- **Reasoning:** stated in the answer — without it the user cannot distinguish a fetch in progress
  from a failure.
- **Alternatives rejected:** none offered; this was volunteered, not chosen from options.
- **Related:** MC-053 (the widget this applies to), MC-056 (the other three states).

> note for when we build widget: Fetch in flight should have something like a loading spinner and
> the word 'loading...'. as currently user can't tell if its fetching, or something else went
> wrong.

**This completes the four-state set opened by `MC-056`.** The in-flight state is the worst of the
three that the current code collapses: `{#await getRisuHub(...) then charas}` has no pending
branch, so a fetch in progress renders **nothing at all** — indistinguishable from a failure, from
an empty result, and from a slow network, with no timeout to bound it.

**No new `src/lang` key is required.** `language.loading` already exists in `src/lang/en.ts` with
the value `"Loading"`, and the sibling branch in `MainMenu.svelte` already uses the trailing-
ellipsis convention (`Failed to load {language.hub}...`), so `{language.loading}...` matches the
file's own style. Reusing it avoids adding a key that would then need translating into six locales
for a state the existing vocabulary already covers — an ordinary scope argument, not a
prohibition. **[corrected 2026-09-23]** This passage previously read "`src/lang/*` is the
maintainer's own territory (see `MC-015` …)". That overstated the rule, and the citation did not
support it — `MC-015` is about UI rendering in English regardless of the selected locale and says
nothing about who may edit those files. See `MC-058`. `animate-spin` is already used elsewhere in `src/lib`, so the
spinner needs no new dependency or component either.

**Two constraints the Stage 2 plan gate should carry:**

- The spinner must not itself cause the layout shift `MC-053` exists to remove. It belongs inside
  the card's already-committed height, not above or before it.
- A purely visual spinner is invisible to a screen reader. The pending state needs an accessible
  announcement (`role="status"` or an `aria-live` region) — the same accessibility standard the
  stage brief sets for the Stage 3 disclosure, which must work by tap and by keyboard rather than
  by hover.

---

### MC-058 — "The maintainer reviews Korean and English" is a rule about not reverting, not a ban on editing `src/lang`

- **Tag:** corrected
- **Date:** 2026-09-23
- **Sweep ref:** none (a direct maintainer correction)
- **Source:** stated by the maintainer directly, 2026-09-23, on noticing the claim had spread.
- **Corrects:** a passage in `Agents/README.md` and a passage in `MC-057`; see below.
- **Related:** MC-015, MC-018, MC-052.

> can you check if any of the documentation(memory, maintainer decision, reports, etc) instructs
> to never touch the korean locale file in src/lang? I merely said "I can also review korean and
> english TL) but I think that might have propagated wrongly.

**What was actually said** is that the maintainer *can review* Korean and English translations —
an offer of review capacity. What it does **not** mean is that `src/lang/ko.ts` is off limits to
agents. The `translator` agent maintains all six non-English locales, Korean included; the real
rule is the narrower one already stated correctly in `AGENTS.md` and `.claude/agents/translator.md`:
**never revert, "normalise" or reword the maintainer's own edits**, and expect diffs there that no
brief mentioned.

**Where it had spread.** Both instances were written by the Orchestrator, not by a subagent:

- `Agents/README.md` carried "Only user-facing `src/lang/*` strings are localised (Korean and
  English), and the maintainer edits those directly". The original constraint attached "Korean and
  English" to *which ones the maintainer edits*; the paraphrase moved it onto *which ones are
  localised*, which is false — there are seven locales. Corrected.
- `MC-057` asserted "`src/lang/*` is the maintainer's own territory" and cited `MC-015` for it.
  `MC-015` is about UI text rendering in English regardless of the selected locale and supports no
  such claim. Corrected, and the citation removed.

**The agent profiles were never wrong.** `.claude/agents/translator.md` lists `ko` among the
locales it translates and scopes the rule correctly to reverting; `AGENTS.md`'s routing entry says
"It never reverts the maintainer's own edits in those files." The drift was confined to the
campaign documentation.

**This is the third recorded instance of the same failure** — see `MC-052` (a maintainer's
comparison to other forks became a claim about this fork) and `MC-026` (a referent slipped between
this fork's maintainer and upstream's developer). In each case a true statement was widened by one
step and the widening was never marked. When restating something the maintainer said, keep the
scope they gave it: an offer to review is not a restriction on editing.

---

### MC-059 — The realm announcement banner moves below the Related Links grid

- **Tag:** decision
- **Date:** 2026-09-23
- **Sweep ref:** none (stated directly this session)
- **Source:** stated by the maintainer directly, 2026-09-23, answering the one design question
  Stage 2 could not settle on its own.
- **Reasoning:** implicit in the option chosen, and recorded here as the argument that was put to
  them: the banner is arbitrary-height content, so it cannot sit inside a card whose whole purpose
  is a committed height; placing it last means it renders nothing in the common case (the string
  is empty), and when it does arrive late there is nothing below it to push.
- **Alternatives rejected:** three were offered. (a) Inside the realm card as a clamped, scrolling
  region — rejected: clips long announcements and competes with the preview list for the card's
  space. (b) Above the grid as today — rejected: it still arrives async above everything and still
  shifts the grid, which is the Change 1 behaviour the stage exists to remove. (c) Realm screen
  only — rejected: this was the option that quietly reduces the reach of what the maintainer had
  called upstream's live announcement channel.
- **Related:** MC-053 (the card this banner cannot live inside), MC-056, MC-057.

**Consequence for Stage 2.** `MainMenu.svelte`'s `{@html sanitizeHubHtml(hubAdditionalHTML)}` sink
moves out of the realm block and becomes a sibling after the Related Links grid. Stage 1's
security properties must survive the move intact: the sanitizer call, the delegated
`handleHubHtmlClick` wrapper, and the `a11y` ignore comments travel together, and
`src/lib/UI/MainMenu.hubHtmlSink.svelte.test.ts` is the guard that proves it — it fails if the
sink is disconnected, which is exactly the risk a move introduces.

**One mechanism this move must not break, and today relies on by accident.**
`hubAdditionalHTML` is a plain module binding in a `.ts` file, not a rune. `MainMenu` reads a
fresh value today only because that read sits *inside* the `{#await … then}` body, which Svelte
creates after the promise resolves. Moved outside that block, the read becomes an ordinary
template expression whose only dependency is non-reactive, and it will render the value as of
mount — empty on first load, and never updated. This is the same defect `RealmMain.svelte`
already has. The move therefore requires the banner's value to become reactive state driven by
the same fetch, not merely a relocated `{@html}`.

---

### MC-060 — An offline device short-circuits the realm fetch instead of timing out

- **Tag:** decision
- **Date:** 2026-09-23
- **Sweep ref:** none (stated directly this session)
- **Source:** stated by the maintainer directly, 2026-09-23, unprompted, while Stage 2's data layer
  was being built.
- **Reasoning:** stated in the answer — the realm cannot work without the internet, so spending the
  timeout to discover that is wasted, and repeated retries against a known-offline device are worse
  than wasted.
- **Alternatives rejected:** none offered; this was volunteered, not chosen from options.
- **Related:** MC-056 (the state set this extends), MC-057 (the pending state it replaces when
  offline), MC-053.

> I think there should be a early return in case of when the device is offline. realm won't work
> without the internet. and I think realm button could disable itself and turn grayed out early
> with 'device is offline' message if device is not connected to internet instead of wasting time
> trying again multiple times.

**This makes it five states, not four.** `MC-056` opened the set with failed and empty, `MC-057`
added pending; offline is the fifth, and it is reached before any request is issued rather than
after one fails.

**One asymmetry the implementation must respect, and it happens to favour this decision.**
`navigator.onLine === false` is reliable: it means there is definitely no network. `=== true` is
not: it means the device is attached to *a* network, not that the internet or the realm host is
reachable. So the check is sound as an early return and unsound as a precondition — `false`
short-circuits, `true` must fall through to the ordinary fetch, timeout and failure handling with
nothing skipped. The maintainer's phrasing ("early return in case of when the device is offline")
is already on the reliable side of that line; recorded here so a later change does not "simplify"
it into a reachability test.

**The maintainer drew the boundary themselves, unprompted, in the same exchange**, which settles it
rather than leaving it as an implementation inference:

> the goal of offline check is for when it is certain that device is offline. I think net
> reachability case should be covered by 'failed' state. not offline state.

So: **offline is a certainty state, not a diagnosis.** Only `navigator.onLine === false` reaches it.
A device attached to a network that cannot reach the realm host — captive portal, DNS failure, host
down, firewall — is a `failed` or `timeout`, arrived at through the ordinary request path. Nothing
in this stage probes reachability, and nothing should be added that does.

**Two consequences the maintainer did not state, decided at implementation.** The card must leave
the offline state by itself when connectivity returns, via an `online` listener removed on
teardown, or the user is stranded until they find the retry control. And the greyed-out retry
control uses `aria-disabled` rather than the `disabled` attribute, so it stays in the tab order and
a keyboard or screen-reader user can reach it and hear why it does nothing — the same
accessibility standard `MC-057` sets for the pending state and the stage brief sets for Stage 3.

---

### MC-061 — The realm card has no separate browse button: the card body is the browse target

- **Tag:** decision
- **Date:** 2026-09-23
- **Sweep ref:** none (stated directly this session)
- **Source:** a Figma prototype the maintainer made — file `Realm Button design`, key
  `RNE62KHJJwu1lz0pdn3SGu`, frame `3:3` ("Android Compact - 1", 412×917) — plus four notes written
  on the canvas and two answers given when the prototype was read back to them. The maintainer
  flagged it as their first time using Figma; the geometry is nonetheless unambiguous and is what
  this entry records.
- **Reasoning:** stated in the notes themselves, quoted below.
- **Alternatives rejected:** a separate "Browse RisuRealm" button in the card header, which is what
  Stage 2 had already built — rejected explicitly ("remove the separate button entirely").
- **Related:** MC-053 (the card this refines), MC-057, MC-060.

**The prototype's geometry.** Four 91×91 placeholder squares in a 2×2 block, and the realm card at
133×191 beside them spanning both rows. Inside the card: a title, a description line, a frame named
"Scrollable entries", and a semi-transparent compass icon bleeding off the bottom-right.

**The canvas notes, verbatim:**

> 1. 'Browse risurealm' button overshoots the right edge
> 2. New button would be in brightest color of current colorset
> 3. Clicking each entry would take user directly to each entry. while clicking outside of the
>    scrollable zone would act same as the original "Browse Risurealm" Button.

**Two ambiguities were put back to the maintainer and answered.**

*The 91×91 squares are placeholders*, not a request to resize the four Related Links cards. Those
cards, and the grid, are unchanged by this decision. Only the realm card is new.

*Note 1 is a bug report about existing behaviour, not a layout instruction.* In their words:
"overshooting is more like a bug report of what is already there. goal is to remove the separate
button entirely and doing what note 3 says."

**Three further clarifications, given unprompted:**

> description and lucide icon is to match the design of how other buttons(emails, discord, etc)
> looks. so copying hovering animation too would be a good idea.

> hiderealm would preferrably hide this new one widget entirely.

> description should be a description for what this button does. like 'browse more characters
> using risurealm'.

**What this means for the implementation, including one reversal.** The card carries no separate
browse button; a click anywhere outside the scrollable entries opens RisuRealm, and each entry
opens that character. Because the whole card is now clickable, the card-level hover lift is honest
and is restored — an earlier instruction had moved it onto the child buttons precisely because a
non-clickable card should not imply otherwise, and that reasoning no longer applies.

**The card stays a `<div>` regardless.** The rows inside it are buttons, and interactive children
inside a `<button>` are invalid and break keyboard navigation — which would silently disable
`realmDirectOpen`, a persisted setting shipping help text in seven locales that names this exact
behaviour. A delegated click handler on the card gives the mouse behaviour; the title is a
focusable control carrying `hubBrowseMore` as its accessible name, so the keyboard path survives
the loss of the visible button.

**Two constraints the design cannot have anticipated, decided at implementation and flagged.**
"Brightest color of current colorset" maps to the user-customisable `--risu-theme-primary-*` scale
rather than the mock's literal blue. On that background the link cards' `textcolor2` description
token lands near 1.3:1 and is effectively unreadable, so the secondary line reproduces the
*relationship* with reduced-opacity `textcolor` instead of copying the token. And "hide this new
one widget entirely" was read as covering the announcement banner as well as the card, because the
banner is realm-server content and sat inside the `hideRealm` guard before Stage 2 moved it. That
was flagged as an interpretation rather than the maintainer's words, put back to them, and
**confirmed**: "I approve that 'hiderealm' should hide the banner too."

---

### MC-062 — The realm announcement must be visibly labelled as coming from RisuRealm

- **Tag:** decision
- **Date:** 2026-09-23
- **Sweep ref:** none (stated directly this session)
- **Source:** stated by the maintainer directly after running the Stage 2 build and looking at the
  home screen.
- **Reasoning:** stated in the answer — an unlabelled announcement can be misread.
- **Related:** MC-059 (which moved this banner below the grid), MC-061, MC-053.

> we should do something about banner's decoration as it does not have any decoration at all. main
> menu currently looks like this, and "we are looking for feedback" just left there with no labels
> or titles such as "announcement from risurealm" can be misreading.

**The misreading is a provenance problem, not only a styling one.** `hubAdditionalHTML` is HTML
supplied by **upstream's** realm server and rendered on this app's own home screen. Unlabelled, a
message like "We are looking for feedback!" reads as first-party — as though RisuAI were asking.
The fix is a container in the cards' visual language plus a heading naming the source, rendered
only when the announcement is non-empty, so an empty labelled box never appears.

The container is **not** clickable and takes no hover lift: only the links inside it are
interactive, through the delegated handler Stage 1 established. Nothing about the sanitization
changes.

**This is also the first time the maintainer has run the Stage 2 build**, and the screenshot
confirmed `MC-061`'s note 1 literally — the "Browse RisuRealm" button overflowed the card's right
edge, in Korean, exactly as the canvas note described. That button is removed by the same pass.

---

### MC-063 — In `cn.ts` the product name is Latin "Risuai", not the 叡苏 transliteration

- **Tag:** decision
- **Date:** 2026-09-23
- **Sweep ref:** none (stated directly this session)
- **Source:** stated by the maintainer directly, answering a question raised by a locale survey.
- **Reasoning:** stated in the answer — RisuAI is a proper noun.
- **Alternatives rejected:** standardising on 叡苏, which had the larger share of existing usage
  (roughly 14 occurrences against 3).
- **Related:** MC-058 (translations are editable, not off limits), MC-061.

> As I said up above: RisuAI is proper noun, so I think Latin Risuai seems more fitting in cn.

**What prompted it.** `src/lang/cn.ts` was internally split: the transliteration 叡苏 in about
fourteen places and the Latin form in about three — including the plugin security warnings, which
are among the highest-stakes strings in the file. The split was an accident rather than a
convention, so a canonical form had to be chosen before ~98 new keys were added on top of it.

**This is a canonical-form decision, so it applies to existing strings too**, which makes it a
deliberate, authorised exception to the standing rule against modifying existing translations. The
exception covers **the product name only** — not wording, punctuation or register in those strings.

**The `welcome` gloss stays.** That string reads "Risu（叡苏）", glossing the transliteration in
parentheses. Dropping a gloss from a welcome message is a different kind of edit from harmonising a
label, so it was referred back rather than decided by an agent, and the maintainer kept it: *"gloss
can stay there."* A one-time introduction of the name survives fine alongside Latin being canonical
everywhere else.

---

### MC-064 — `cn.ts` uses 人设 for the persona concept, not 用户

- **Tag:** decision
- **Date:** 2026-09-23
- **Sweep ref:** none (stated directly this session)
- **Source:** stated by the maintainer directly, in the same exchange as `MC-063`.
- **Reasoning:** stated in the answer — the community standard is the more sensible choice.
- **Alternatives rejected:** leaving the existing 用户-based wording, which was internally
  consistent and had been recorded as "not a defect" before this decision.
- **Related:** MC-063 (the other authorised exception in the same file), MC-058.

> following community standard in terms of persona seems more sensible.

`src/lang/cn.ts` rendered the persona concept — the profile representing the user in a roleplay —
with 用户 wording across roughly fourteen keys, where `zh-Hant.ts` uses 人設. Internally consistent,
but generic enough that a user would not connect "用户信息" to "the character profile I use to
represent myself".

**Like `MC-063`, this is an authorised exception to the rule against modifying existing
translations, and it is scoped to the persona concept only** — not the surrounding wording,
punctuation or register.

**It is a judgement per key, not a search and replace.** `zh-Hant.ts` is the reference because it
draws the line: 人設 for `persona`, `largePersonaPortrait`, `includePersonaName`, `bindPersona` and
the bind/unbind messages, but 使用者設定 for `exportPersona`/`importPersona` and 使用者備註 for
`personaNote`, where the string really does mean user settings. `personality` is the character's
personality and is untouched at both of its keys.

---

### MC-065 — The GitHub card becomes the Source & Issues disclosure; Communities gets only the invite fix

- **Tag:** decision
- **Date:** 2026-09-23
- **Sweep ref:** none (stated directly this session)
- **Source:** stated by the maintainer directly, answering the two questions a Stage 3 evidence
  packet could not resolve from source.
- **Reasoning:** for the second half, stated in the answer — the fork has no Discord server of its
  own.
- **Alternatives rejected:** a separate sixth card beside the existing GitHub one (would put two
  GitHub-ish cards side by side and grow the grid the realm card was just fitted into); folding
  Discord into the same disclosure (would bury the Discord link a level deeper). For Communities:
  giving that page the same four destinations, and leaving it untouched entirely.
- **Related:** MC-054 (the invite standardisation this executes), MC-053, MC-061.

**On the home screen, the existing GitHub card *becomes* the disclosure** rather than gaining a
neighbour. Same position in the Related Links grid; activating it reveals four destinations — this
fork's repository and issues, upstream's repository and issues — instead of navigating straight to
upstream.

**On the Communities settings page, only the stale Discord invite is corrected** — `JzP8tB9ZK8`
becomes `Exy3NrqkGm`, per `MC-054`. That page's GitHub button keeps pointing at upstream and gains
no fork links.

> just fix the invite - fork does not have discord server.

**Two consequences worth carrying into implementation.**

The `RelatedLink` type in `MainMenu.svelte` assumes every entry is a direct-navigate URL —
`onclick={() => openURL(relatedLink.href)}`. One entry now reveals a sub-list instead, so that
assumption breaks and the `{#each}` render must handle both shapes. It looks like a one-line change
and is not.

**There is no accessible disclosure pattern in this codebase to reuse.** A repo-wide search for
`aria-expanded`, `aria-haspopup` and `aria-controls` across `src/lib` returns **zero** matches.
`Accordion.svelte` is a real `<button>`, so Tab and Enter work by native HTML semantics, but it
announces no expand/collapse state; `LoadoutModal.svelte` has no `role="dialog"`, no focus trap and
no Escape handler at all. No accessible-primitives dependency exists — no `bits-ui`, `radix`,
`melt`, `headlessui` or `floating-ui`. So the maintainer's standing constraint for this stage —
*"It must work by tap and by keyboard. Hover may be an enhancement, never the only path"* — has to
be met by building the pattern, not composing one. The `Accordion` is the component most likely to
be copied forward precisely because it is the only reveal-on-click control here, and copying it
would carry its accessibility gap into the one component whose purpose is accessibility.

---

### MC-066 — The Email card becomes a disclosure carrying the maintainer's own address

- **Tag:** decision
- **Date:** 2026-09-23
- **Sweep ref:** none (stated directly this session)
- **Source:** stated by the maintainer directly, unprompted, after seeing the Source & Issues
  disclosure working.
- **Reasoning:** implicit in the request — the same fork-versus-upstream split the GitHub card
  makes, applied to contact. Someone with a bug in *this* build should be able to reach the person
  who maintains it rather than upstream's support.
- **Alternatives rejected:** none offered; volunteered.
- **Related:** MC-065 (the disclosure this reuses), MC-054 (the upstream marker).

> currently E-mail only points to upstream. I think it can have fork submenu too, which should
> point to my email(yoonch1022@naver.com)

The Email card gains two destinations: `mailto:yoonch1022@naver.com` first, then
`mailto:support@risuai.net` carrying the grey upstream marker.

**This entry exists because its absence was caught at a gate.** The implementation shipped the
address while `MC-065` covered only the GitHub card and the plan still described Email as an
untouched plain link. A reviewer reading the records — correctly — flagged it as an implementer
publishing a personal address outside approved scope, and recommended getting an explicit yes
before committing. The decision was real; the record was missing.

The failure was the Orchestrator's: the maintainer gave the decision in conversation and it was
implemented without being written down. **An authorised change that is not recorded is
indistinguishable from drift**, and this campaign already tracks three cases of a claim widening
because nobody could check it against a record. Recording a decision is not bookkeeping after the
fact; it is what makes the difference between the two visible later.

**Worth noting because it is effectively one-way:** a personal address in shipped UI lands in git
history and in every built artifact. That is the maintainer's call to make about their own
application, and they made it — but it is the kind of change that should never reach a commit on an
implementer's initiative.

---

### MC-067 — A bare Space or Enter hotkey steps aside when a control has keyboard focus

- **Tag:** decision
- **Date:** 2026-09-23
- **Sweep ref:** none (stated directly this session)
- **Source:** chosen by the maintainer from three options, after their own hand test showed Space
  does not open the Source & Issues disclosure.
- **Reasoning:** the Orchestrator's recommendation, accepted as offered. It fixes Space for every
  native control in the app while keeping upstream's "Space jumps to the chat input" everywhere a
  control does not hold keyboard focus.
- **Alternatives rejected:** (B) only swallowing Space when `.text-input-area` exists, which fixes
  the home screen but leaves every keyboard-focused button on the chat screen unreachable by Space;
  (C) leaving upstream behaviour alone, which makes the disclosure Enter-only like every other
  button in the app.
- **Related:** MC-065 (the disclosure whose live check exposed this).

> let's go with option A.

**The mechanism being changed.** `src/ts/defaulthotkeys.ts` binds bare Space to `focusInput`
(upstream `f5f05bdf`, 2025-03-20). The document-level keydown handler in `src/ts/hotkey.ts`
matches it whenever focus is outside an input, textarea or contenteditable, counts it as run even
when the chat input does not exist, and then calls `preventDefault()` on the keydown. That cancels
native activation, so **Space activated no `<button>`, `<select>` or `<summary>` anywhere in the
application.** This predates the fork.

**The keyboard-focus condition is what makes this safe, not a refinement.** Chrome focuses a
button when it is clicked with the mouse. Yielding whenever *any* control is focused would mean a
user who clicks reroll and then presses Space to reach the chat input rerolls again instead. The
yield applies only when the control matches `:focus-visible`, which a mouse click on a button does
not produce.

**Scope.** Only the hotkey-matching loop yields, and only for a bare Space or Enter (no Ctrl, Alt,
Shift or Meta). The rest of the handler (the Ctrl+digit presets, Escape, and Enter confirming an
open alert) is unchanged. No stored hotkey data changes: a user's saved bindings keep working,
and the change is to *when* a bare binding fires, not to what is saved.

**Native controls only, and the ARIA-role list was dropped at the gate.** The implementation
brief also yielded for elements with `role="button"`, `checkbox`, `tab` and similar. That was
the Orchestrator's addition, not part of this decision, and the gate found it regressed the
app's own code. Native elements get Space and Enter activation from the browser. ARIA-role
elements only get it if the author wired it up, and about 30 `role="button"` elements here
have no key handler, or handle Enter only (the `SideChatList.svelte` icons) or have an empty
one (the export icon in `ChatList.svelte`). For those, yielding would turn "Space jumps to
the chat input" into "Space does nothing". The yield is therefore limited to `<button>`,
`<select>` and `<summary>` for Space, plus `<a href>` for Enter.

**Maintainer hand test, all three passed:** Space opens the disclosure cards and the ring
follows the card's rounded edge; after clicking reroll, Space jumps to the chat input
instead of rerolling again; Space on the Tab-focused hamburger button beside the chat input
opens its menu.

**How this was found matters.** The automated live check first called Space a harness limitation,
on the strength of a "control" button that did not respond either. The control had been injected
into the same page, so the same document-level hotkey swallowed its Space too. The maintainer's hand
test is what caught it. A control has to be isolated from the thing under test.

*Amended by `MC-161` 2 (2026-10-02): "Enter confirming an open alert" is no longer unchanged. With a button inside the
dialog focused, Enter presses that button.*

---

### MC-068 — The durable-draft restore marker: a bar above the editor, immediate revert, draft age shown

- **Tag:** decision
- **Date:** 2026-09-23
- **Sweep ref:** none (stated directly this session)
- **Source:** the Orchestrator proposed a concrete design for the affordance `MC-042` requires; the
  maintainer chose the recommended option on all three questions.
- **Reasoning:** `MC-042` fixed *that* a restored draft is visible and one-click revertible, not how.
  Report 20 section 5.4's failure case is text typed long ago that the user has forgotten, so the
  marker has to be noticeable and say how old the draft is.
- **Alternatives rejected:** a small "Restored" pill in the message's button row (less noticeable,
  which defeats the purpose); a revert followed by a five-second Undo (more machinery and tests to
  guard against a misclick on text that was never saved as a message).
- **Related:** MC-042 (the marker and revert exist), MC-055 (the stage's sequencing), MC-067 (Space
  and Enter reach the Revert button).

**What was approved:**
- **Placement:** a thin bar directly above the text box, shown only when an editor was seeded from a
  stored draft. It stays up until the editor is saved or left, including while the user types,
  because the text is still based on the draft.
- **Surfaces:** all three: `textBox()`'s original-text editor, `textBox()`'s translation editor,
  and `cardboard`'s own raw textarea for the original text. (`cardboard` has no translation-edit
  button; its `textBox()` shows the translation editor only if the theme is switched while that
  editor is open, and the marker covers that case too.)
- **Look:** a lucide `History` icon, the text "Unsaved edit restored" and the draft's age, and a
  `RotateCcw` Revert button. Default themes use theme tokens. `cardboard` and `mobilechat` use
  fixed greys, because the card and the chat bubble they render in are always light (Gate 2 round 1
  found `mobilechat` at about 2.6:1 with theme tokens). A `customHTML` layout's `<RISUTEXTBOX>`
  sits on the user's own CSS, which the marker cannot know, so it keeps theme tokens. About 150ms
  fade-in, none under `prefers-reduced-motion`.
  Contrast is measured in the browser against 4.5:1.
- **Accessibility:** the bar is a live status region; Revert is a native `<button>`.
- **Revert:** immediate, one click. It replaces the buffer with the saved message text (for a `tr:`
  record, the cached translation `loadTranslationForEdit` seeded), deletes the stored record, and
  hides the bar. The editor stays open.
- **Draft age:** the record gains a last-edited timestamp, formatted with `Intl.RelativeTimeFormat`
  in the UI language, so the age needs no new locale strings.
- **Strings:** the marker text and the Revert label are new keys in all seven locales.

**Two rules the design surfaced.** They are rules, not mechanisms; how the code meets them is the
code's business.

1. **Nothing unchanged is ever offered as a restore.** Opening and leaving an editor untouched must
   not show "Unsaved edit restored" on the next open. "Unchanged" means equal to what the editor
   would otherwise open with: the message text for the original-text editor, and the **cached
   translation** for the translation editor. It is not the record's `baseData`, which for a `tr:`
   record is the source text and can never equal a translation. (`test-warrior` caught this while
   writing the red tests; the Orchestrator's brief had said "base text" for both.) For the
   translation editor the case is reachable, but only when the cached translation comes to *equal*
   the stored draft text. Any write to the translation cache can cause that: for example a
   retranslate that happens to produce that exact text, a partial-edit save (on this message after
   its editor was unmounted, or on another message sharing the cache key), or an import of the LLM
   cache. (A translation-editor save on a message sharing the key deletes the shared record itself.)
2. **The age is the last *edit*, not the last open.** Opening a restored draft, or reverting it,
   must not refresh its age or re-register it.

How Gate 2 converged on a mechanism for these rules, and why the first three attempts failed, is
recorded in Report 20 section 11, not here.

---

### MC-069 — Upstream issues found in passing are recorded in the Roadmap as chores

- **Tag:** decision
- **Date:** 2026-09-24
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, after the durable-drafts live check turned up readability problems
  in the `mobilechat` and `cardboard` themes that predate the fork.
- **Reasoning:** the maintainer's own words below. Upstream defects are frequent, so noticing one is
  routine, and a finding that lives only in a conversation is lost at the next compaction.
- **Related:** MC-011 (the fork has never shipped; upstream is the build with users).

> upstream issues are common in this project - it's GPL 3 community project with tiny userbase
> after all. I think we should put them somewhere in the plan.

**How to apply.** When work runs into an upstream defect outside its scope, record it under the
Roadmap's "Upstream issues found in passing" chores. Say how it was found (live check, review,
reasoning) and how far the cause was traced. Don't fix it inside an unrelated stage, and don't
leave it only in a report's follow-up list or a chat reply. The first three entries are CHORE-19
to CHORE-21.

---

### MC-070 — Self-hosted web builds get the "Leave site?" guard too

- **Tag:** decision
- **Date:** 2026-09-24
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering the question CHORE-22 raised: the accidental-close
  `beforeunload` guard is registered only when `isWeb`, which is true only on the `risuai.xyz`
  host, so self-hosted builds have no accidental-close protection.
- **Reasoning:** the maintainer's own words below.
- **Related:** CHORE-22, MC-069 (the upstream-chore policy that surfaced it), MC-011.

> run chore 22 - I think Leave site guard would be also nice to have on self host.

**How to apply.** A self-hosted web build (the node server) prompts before an accidental tab
close, as `risuai.xyz` does. The guard's existing exemptions still hold there: app-initiated
reloads and the `mailto:`/`tel:` handoff never prompt.

---

### MC-071 — Reported sidebar problems: order not persisting, flaky gestures, no edge scroll, folder drags

- **Tag:** fact
- **Date:** 2026-09-24
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, relaying community reports against upstream builds (per `MC-011`,
  user-reported symptoms are observations of upstream, not of this fork).
- **Reasoning:** input for the sidebar rework (Roadmap Phase 2 item 3, "Sidebar: a rework"). The
  maintainer deferred that rework behind the known data-loss fixes (the composer stage, then
  `updateInlayScreen`).
- **Related:** MC-011, MC-069.

> 1. Changed character order sometimes does not persist
> 2. Inconsistent Behavior - long tap, drag, etc sometimes does not work
> 3. it is hard to move the character beyond the visible scope, as dragging the character to the
>    edge of the viewport sometimes does not correctly scroll the sidebar
> 4. Dragging the character in and out of folder is inconsistent

**How to apply.** The sidebar investigation checks each symptom against source. Symptom 1 is a
possible persistence defect, not only a UX one: if a reorder can fail to reach the save file, it
belongs with the data-loss work and is triaged first. Symptoms are reports, not reproductions, so
none is treated as confirmed until reproduced or traced.

---

### MC-072 — Composer drafts: silent per-chat restore, late files go to their own chat, only the open composer holds the multi-tab reload

- **Tag:** decision
- **Date:** 2026-09-24
- **Sweep ref:** none (stated directly this session)
- **Source:** the Orchestrator asked three questions before writing the composer-stage plan
  (`Agents/Reports/22-composer-drafts-plan.md`); the maintainer chose the recommended option on all
  three.
- **Reasoning:** the composer is always on screen, so restored text is visible without a marker; a
  file the user picked is not silently dropped; and a background draft holding the reload would
  need a cap and a prune rule for little gain, since composer text lives only in memory and an
  ordinary reload already drops it.
- **Alternatives rejected:** showing the `MC-068` restore bar on the composer; discarding a file
  that arrives after a switch; letting every stored composer draft defer the multi-tab reload.
- **Related:** MC-043 (the composer stage and its shape), MC-050, MC-068.

**What was decided:**
1. **Silent restore.** Returning to a chat shows the unsent text, staged files and translation
   left there, with no restore bar.
2. **Late files go to the chat they were started in.** A file picked, or an image pasted, after a
   chat switch lands in the draft of the chat that was open when the pick or paste began, never in
   the chat now on screen.
3. **Only the open composer holds the multi-tab reload.** Unsent text stored for chats not on
   screen does not defer it. This settles `MC-050` for composer drafts only; for message-editor
   records it stays open.

---

### MC-073 — Investigate reworking the chat writer rather than locking switches during a send

- **Tag:** decision
- **Date:** 2026-09-24
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering whether to block chat and character switching during a
  send after Gate 1 round 2 of the composer-drafts plan (`Agents/Reports/22-composer-drafts-plan.md`)
  found that writes in the send and trigger path follow whatever is selected when they land, so a
  switch mid-send can overwrite another chat's history, its variables, or a whole character.
- **Reasoning:** the maintainer's own words below. A lock treats the symptom; the writer is behind
  several persistence issues; the fork has not shipped (`MC-011`), so a structural fix costs least
  now.
- **Alternatives rejected (for now):** blocking switches for the whole send; blocking them only
  until generation starts. Neither is ruled out for good. The investigation decides whether a
  rework is feasible and worth it.
- **Related:** MC-011, MC-043, MC-072, CHORE-25.

> I think blocking writing as whole during generation could feel like a band-aid fix to end users.
> since writer is a source of quite few persistency issue, I think we should investigate if we can
> rework on the writer. currently this fork hasn't shipped. thus if writer rework fixes many core
> problem, now is the best time to fix it.

**Also decided:** if a switch is ever refused, it is refused silently, as clicking a character
already is during generation. No toast, no new strings.

**How to apply.** Before any lock is designed, investigate the writer: every write in the send,
generation and trigger path that goes to the live selection instead of the chat or character it
belongs to. Size a rework in which writes are bound to their origin. The composer stage's
per-chat drafts (Report 22, I2) do not depend on this and are not blocked by it; its send-window
invariants wait for the writer decision.

---

### MC-074 — Multiuser is to be removed; it is not part of the writer rework

- **Tag:** decision
- **Date:** 2026-09-24
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering whether the writer rework (`MC-073`) should bind multiuser
  sync's writes to their origin. Those writes deliberately go to the live selection
  (`src/ts/sync/multiuser.ts`, for save-tracking performance).
- **Reasoning:** the maintainer's own words below.
- **Related:** MC-011, MC-073.

> I think we can drop the multiuser feature as whole. Multiuser is another remnant of this project
> originating from being upstream maintainer's toy project. multiuser session was explored, but
> then dropped because it was unstable and buggy.

**How to apply.** The writer rework leaves `multiuser.ts` out. Removing multiuser is its own
stage. Before anything is deleted, it gets an investigation of everything that depends on it:
- the UI entry points;
- `ConnectionOpenStore` reads (for example `sendMain`'s message `name` field);
- any plugin API surface;
- any saved field.

Upstream data that carries multiuser-related fields must still load (`MC-011`).

---

### MC-075 — The writer rework: `/` commands stay on the chat the send started from; a delete during a write asks first

- **Tag:** decision
- **Date:** 2026-09-24
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering the open questions from the writer investigation (ledger
  row 159).
- **Reasoning:** as stated below; the maintainer chose the behaviour, not the mechanism.
- **Related:** MC-073, MC-074, Report 22.

**What was decided:**
1. **`/` commands are bound to the send's origin** like every other write in the send, not
   resolved from the live selection each time. This supersedes Report 22 section 9's limitation.
2. **Deleting a chat, or its character, while something is writing into it asks first.** A short
   warning in the delete confirmation says something is writing into this chat and asks whether
   to continue. When nothing is writing into it, the delete confirmation is unchanged. If the
   origin chat is gone anyway when a write lands, the write is dropped silently.
3. **Home while a trigger runs** (`selectedCharID = -1`): not investigated now. It is tested when
   the rework actually reaches that path.

The maintainer's words for item 2:

> best approach would be inserting a little warning about "something is currently writing into
> this chat. do you really want to continue?" on deletion message if something is writing into it,
> if not, silent drop should be fine.

---

### MC-076 — The writer rework follows senior-advisor's staging; `updateInlayScreen` goes first

- **Tag:** decision
- **Date:** 2026-09-24
- **Sweep ref:** none (stated directly this session)
- **Source:** the Orchestrator presented `senior-advisor`'s writer strategy (ledger row 161) and
  the HaejeokRisuai comparison (ledger row 160). The maintainer approved the strategy and moved
  `updateInlayScreen` ahead of it.
- **Reasoning:** the maintainer's own words below.
- **Supersedes:** the order "composer, then CHORE-25, then `updateInlayScreen`" (this session,
  before the writer investigation).
- **Related:** MC-073, MC-074, MC-075, CHORE-25, Report 22.

> looks good to me, I think small and independant updateInlayScreen should jump ahead though,
> since its another persistency issue.

**Order:**
1. `updateInlayScreen` (CD-4).
2. W0: every chat has a stable id; the origin resolver and in-flight-writer registry.
3. W1: triggers, Lua and CBS write to their own origin. This closes CHORE-25, which is not a stage
   of its own.
4. The composer stage (Report 22 rev 3), on W0's resolver.
5. W2 (generation, group turns, auto-continue, the delete warning, the Home check) and W3 (`/`
   commands).

**Approved strategy:** writes made for a unit of work (a send, a generation, a trigger run, a `/`
command) resolve their target by identity at write time. Plugin-facing "current" helpers stay
bound to the selection. Whole-object commit stays. No switch lock.

---

### MC-077 — Edited Image Generation Instructions are kept across an Inlay Screen toggle, and documented

- **Tag:** decision
- **Date:** 2026-09-24
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering a question raised by Gate 2 of the `updateInlayScreen` fix
  (CD-4; ledger row 163). The Image Generation Instructions box has two jobs. With Inlay Screen off
  it instructs the auxiliary model that writes the image prompt. With Inlay Screen on it goes into
  the main chat and must ask for `<ImgGen="...">` tags. Keeping edited text across a toggle can
  leave text written for one job doing the other.
- **Reasoning:** text stays in a visible box and is never silently wiped; the user rewrites it for
  the new job.
- **Alternatives rejected:** resetting that box on an Inlay Screen toggle only (it always works,
  but edits are lost, as in the bug); keeping it and showing a notice on toggle (a new string in
  seven locales).
- **Related:** MC-076.

**How to apply.** `updateInlayScreen` keeps user-authored text in every field across every mode
and Inlay Screen change. The wiki page for the Additional Character Screen says that the box has
two jobs and should be rewritten after toggling.

---

### MC-078 — A write whose target id has two holders is skipped with a warning, not guessed

- **Tag:** decision
- **Date:** 2026-09-24
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering the question `senior-advisor` raised after three Gate 1
  rejections of the W0 identity plan (Report 24; ledger rows 165 to 168). A plugin can leave two
  chats (or two characters) holding one id, for example by copying a chat and keeping its id.
  Nothing the app can observe tells which holder is the original.
- **Reasoning:** a skipped write can be seen and redone; a write that lands in the wrong chat is
  silent corruption.
- **Alternatives rejected:** writing to the first holder in array order, the rule boot uses to
  repair duplicates (a plugin's copy placed above the original would receive the writes).
- **Related:** MC-075 (a write whose origin chat is gone drops silently), MC-076.

**What was decided:** while an origin's `chaId` or chat id has more than one holder, writes for
it are skipped and a warning is logged, naming the plugin where known. It is not chosen between.
The writes resume on their own once the duplicate is gone. The plugin can remove it, or, for a
duplicate chat id, the next boot's repair does. Boot's repair rule is unchanged.

**Correction (2026-09-24, Gate 1 round 4 of W0):** a duplicate `chaId` does not last until boot.
The save file holds one block per `chaId`, so the next save keeps only one of the two
characters. This is upstream behaviour; see MC-079.

---

### MC-079 — A duplicate `chaId` losing a character at save gets its own fix, straight after W0

- **Tag:** decision
- **Date:** 2026-09-24
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering a finding from Gate 1 round 4 of the W0 plan (Report 24;
  ledger row 170). When two characters share one `chaId`, the next save keeps only one of them,
  and a plugin's copy can overwrite the original, with no warning. Upstream has the same code.
- **Reasoning:** it keeps W0 out of the save code, and it still prevents the loss soon.
- **Alternatives rejected:** folding the save fix into W0 (a bigger stage whose review must also
  cover the save code); a warning only, recorded as a known upstream issue (nothing prevents the
  loss).
- **Related:** MC-078, CHORE-28.

**What was decided:** CHORE-28 runs straight after W0, as a small change to the save code with
its own review. While two characters share a `chaId`, that block is not rewritten, so the last
good save is kept, and the user sees a visible warning. W0 itself only logs a console warning.

---

### MC-080 — RisuAccount sync is to be dropped from this fork; migration is by `.bin` local backup

- **Tag:** decision
- **Date:** 2026-09-24
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, unprompted, during the W0 stage.
- **Reasoning:** the maintainer's own words below. Account sync is maintained entirely upstream
  (MC-012), almost unused (MC-002), and has been a blocker for asset optimisation and for faster,
  more aggressive local backup creation (MC-025).
- **Related:** MC-002, MC-011, MC-012, MC-025, MC-074 (multiuser removal, the same kind of
  stage).

> It is completely upstream maintained, and iirc it was a blocker that affected lots of asset
> optimization and future implementation of more aggressive and faster local backup creation.
> I think it would be a better call to drop risuaccount sync within this fork - future userbase
> migrating from upstream should still be able to back up their save and import them in this
> fork through .bin local backup instead of starting over.

**What was decided:** account sync (the account-backed storage backend) is removed from this
fork. A user migrating from upstream, including an account-sync user, keeps their data by
making a `.bin` local backup upstream and importing it here. That import path must keep working
(MC-011).

**Scope, decided 2026-09-25.** The maintainer chose the option recommended by
`senior-advisor` (ledger row 175): **remove all of RisuAccount, and keep Realm.**
- **Removed:** the hub sign-in and everything that uses its token. That covers account sync,
  account data save and load, account backup restore, account cold storage, Kei auto-backup
  (already unreachable from the UI), in-app edit and remove of the user's own Realm uploads, and
  the Kei image provider. Upstream data naming the Kei provider shows a clear unsupported-provider
  error.
- **Kept:** Realm browse, info, download, report and anonymous upload; Google Drive backup (its
  token exchange goes through the hub but needs no sign-in); and the self-hosted server's
  `/hub-proxy`.
- **Rejected:**
  - keeping the hub sign-in only for Realm ownership;
  - removing only the sync backend. None of the reference forks stopped there, and it keeps two
    code paths that re-create `db.account` from `localStorage`.

**Timing: deferred** by the maintainer ("decide later"). The removal cannot start before W0 is
committed, because it shares six files with W0.

**Timing, decided 2026-09-25**, after the multiuser removal was committed: "next work would be
RisuAccount removal." It is the next stage, before W1. This is the order `senior-advisor`
recommended.
- `senior-advisor` recommends: W0, CHORE-28, the multiuser removal (MC-074), the account
  removal, then W1, the composer stage, W2 and W3.
- **Acceptable alternative:** both removals after W1.
- **To avoid:** placing either removal after W2.
- The two removals stay separate stages.

Its "keep Google Drive backup" part is superseded by MC-092 (2026-09-26).

---

### MC-081 — Account-sync-encrypted `.bin` backups are not supported; the user is told upfront

- **Tag:** decision
- **Date:** 2026-09-25
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering the RisuAccount removal investigation (ledger rows 173 and
  174). The investigation found three things:
  - Since upstream d0548267 (2026-06-11), a full `.bin` made by an account-sync user on the
    official site is encrypted, with a key served by `sv.risuai.xyz/cryptokey`.
  - A `curl` probe of that endpoint from this machine got HTTP 403.
  - A browser probe was denied by the permission classifier.

  The maintainer has no such backup to test with and asked that the endpoint not be probed.
- **Reasoning:** the maintainer's own words, below. The affected group is small. Account-sync
  users are few because RisuAccount's backup size limit leads the community to recommend
  self-hosting upstream, or a dedicated fork such as PocketRisu reached over LAN/VPN (this adds
  context to MC-002). Reading these files would depend on an upstream endpoint that this fork
  cannot verify or control (MC-012).
- **Alternatives rejected:**
  - keeping the anonymous `/cryptokey` decrypt path, as HaejeokRisuai did;
  - decrypting server-side, as PocketRisu-Kei does.
- **Related:** MC-011 (this narrows its `.bin` guarantee for this one case), MC-002, MC-012,
  MC-080.

> if bin created with risuaccount is encrypted, I think safetest move is just telling the user
> upfront that we can't read the encrypted bin due to various technical limitations and dropping
> backward compat just in this case.

**What was decided:**
- **One narrow exception to MC-011.** A `.bin` carrying the account encryption marker is not
  supported. Detection keys on an entry named `encryption.risudat` being present, whatever its
  content, not only on a well-formed `type: 'account'`. A marker that fails to parse today falls
  through and hands ciphertext to the decoder (ledger row 173, resumed gaps). The import tells the user
  upfront that it cannot be read, for technical reasons, and does not attempt it.
- **Every other upstream `.bin` stays supported**, including one from an account-sync user that
  is not encrypted.
- **"Upfront" means nothing is written before the refusal.** No assets, no cold storage, no
  database.

**The refusal message, decided 2026-09-25.** The message says the file cannot be read, then gives
one line each on the two things a user can do upstream instead:
- **A Partial Local Backup.** It is not encrypted and keeps every chat, including cold-storage
  bodies. It keeps the labelled images: character, group and persona profile images, the user
  icon, the background, and folder and preset images. It drops everything else, including
  emotion images, additional assets and VITS files. (Corrected 2026-09-25 by the Report 25
  fact-check. The option text the maintainer chose said "loses all images except profile
  pictures", which undercounted what it keeps. The decision is unchanged.)
- **Logging out of account sync first, then a full backup.** This keeps the `.png` assets but
  loses the cold-storage chat bodies.

The migration wiki page gives the complete route, which is both backups imported one after the
other. The page marks that route as read from the code and not tested: nobody here has an
account backup. Only official-site account users can hit the refusal, because upstream encrypts
only on `risuai.xyz` origins.

The request not to probe the endpoint is clarified by MC-205 (2026-10-03).

---

### MC-082 — A duplicate `chaId` that has never been saved: the first holder is written once, then frozen

- **Tag:** decision
- **Date:** 2026-09-25
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering a gap the CHORE-28 investigation found in MC-079. MC-079
  keeps "the last good save" of a duplicated `chaId`. When both holders were created since the
  last save, there is no last good save.
- **Reasoning:** writing nothing would lose both characters if the app closed before the user
  resolved the duplicate. Writing one keeps at least one of them.
- **Alternatives rejected:** writing no block for that `chaId` until the duplicate is gone.
- **Related:** MC-078, MC-079, CHORE-28.

**What was decided:** while two characters share a `chaId` that has no saved block yet, the save
writes the first holder in list order once, then treats that block like any other duplicate: it
is not rewritten until the duplicate is gone. The visible warning says only one of the two is
protected.

---

### MC-083 — Multiuser removal: delete the lang keys, keep `Message.name`, leave `§temp` alone

- **Tag:** decision
- **Date:** 2026-09-25
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering ledger row 185's questions from the multiuser removal
  investigation (MC-074).
- **Reasoning:** the maintainer's own words below.
- **Related:** MC-074, MC-011.

> Delete the keys, keep name, leave §temp, edit both docs

**What was decided:**
1. The 7 multiuser-only `src/lang` keys are deleted from all 7 language files (49 entries):
   `joinMultiUserRoom`, `connectionOpen`, `connectionOpenInfo`, `connectionHost`,
   `connectionGuest`, `createMultiuserRoom`, `otherUserRequesting`.
2. `Message.name` stays on the `Message` type (`database.svelte.ts`), so upstream chats that
   carry it round-trip unchanged.
3. Stray `§temp` characters in upstream saves are left alone: never stripped or migrated on
   load; `checkCharOrder`'s `§temp` exclusion stays. Context: upstream's multiuser join pushes a
   `§temp` copy of the host's character into `db.characters` and never removes it.
4. The removal stage edits `docs/wiki/Playground.md` (then `wiki/Playground.md`; its "Join MultiUser Room" row) and `AGENTS.md`'s
   `sync/` "Multi-user synchronization" directory-table row, since `src/ts/sync/` disappears
   entirely.

---

### MC-084 — RisuRealm's standalone site has its own sign-in and upload

- **Tag:** stated
- **Date:** 2026-09-25
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, after reading Report 25, with a screenshot of the site's top bar.
  The bar reads "RisuRealm" with a "Standalone" badge, a search box, and "Upload" and "Account"
  menu items.
- **Related:** MC-080, MC-012. It answers Report 25's open item on whether Realm offers its own
  sign-in (section 10 item 5 and the section 11 uncertainty), which the report had left
  unverified and ruled out probing.

> I've been reading the doc, and noticed that agents marked that it is currently uncertain if
> risurealm provides their own standalone sign in.
> they do. this is the screenshot of top bar for risurealm standalone, and they have login and
> upload menu.

**What this settles:** a user can sign in to and upload on RisuRealm directly, without this app's
hub sign-in. The statement covers the standalone site. It does not say whether the page the app
embeds for its own anonymous upload offers a sign-in.

---

### MC-085 — The legal-documents notice is tied to RisuAccount; upstream's ToS and EULA mostly cover account sync and Realm

- **Tag:** stated
- **Date:** 2026-09-25
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, during the CHORE-33 blast-radius refresh.
- **Related:** MC-080, MC-084. The notice is the "legal documents not configured" screen that
  `App.svelte` shows unless the build sets `VITE_RISU_LEGAL_CONFIGURED`.

> RisuAccount is also related to whole 'please set up legal document' warning that this project
> requires, as when I gave upstream ToS and EULA a read, those were mostly about risu account
> sync and risurealm.

**What this means for the removal:** the legal-documents notice, and the Terms of Service
acceptance it points to, are in scope for the RisuAccount stage's investigation. What, if
anything, changes in them is the maintainer's decision. Realm is kept (MC-080), so the part of
upstream's terms that covers Realm still bears on the fork after the removal. The stage fetches
nothing from upstream's servers.

**The documents, supplied the same day.** The maintainer then gave local copies of upstream's
Korean terms, `ko_EULA.htm` and `ko_privacy.htm`, saying "this might provide more clarification
of our scope." Both are headed "Sionyw Account":
- the unified Terms of Service, effective 2026-04-11;
- the Privacy Policy, effective 2026-04-15.

What each clause means for the stage is recorded in the stage's evidence (ledger), not here.

---

### MC-086 — Ask for agreement to upstream's terms when the user first uses an upstream service, not at boot

- **Tag:** decision
- **Date:** 2026-09-25
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, after the upstream terms were read (MC-085).
- **Related:** MC-080 (Realm, Drive backup and `/hub-proxy` are kept), MC-084, MC-085.

> I think best call would be to move these agreement prompt to when users actually interact with
> these upstream services if possible.

**What was decided:** the direction. The prompt that asks the user to accept upstream's Terms of
Service and Privacy Policy moves from app start to the point where the user first interacts with
an upstream service that the fork keeps. The maintainer made this conditional on feasibility
("if possible"). Whether it is possible, and for which services, is still being investigated. A
request that leaves the app with no user action cannot be gated at the point of use.

---

### MC-087 — RisuAccount removal: answers to the step 1 questions

- **Tag:** decision
- **Date:** 2026-09-25
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering the eight questions from the CHORE-33 blast-radius
  refresh (ledger rows 190 to 192).
- **Related:** MC-080, MC-081, MC-083, MC-084, MC-085, MC-086, MC-011.

> 1. yes.
> 2. I think Init() should detect stale profile
> 3a. initially hide the preview or display placeholder that asks for tos agreement. and start
> displaying previews when user accepts the term.
> 3b.separate ticket. iirc its a simple proxy due to CORS and provider compatibility issues.
> 3c. 1 shared acceptance for both ToS and  Privacy policy would be a safer call. specifically
> mentioning that it is service maintained by upstream.
> 3d. I think we can keep it for now until everything is in place.
> 4. (b)
> 5. delete them.
> 6. yes.
> 7. okay
> 8. yes, rename them.

**What was decided:**
1. **In-place upgrades are a supported migration route.** Swapping a self-hosted upstream install
   for this fork on the same origin, with the same `save/` folder or Docker volume, is supported
   alongside the `.bin` route (MC-080). Report 25's invariant 6 is therefore required on the Node
   server, static web and OPFS profiles.
2. **Stale-profile detection lives in `AutoStorage.Init()`**, and a detected profile lands on
   whatever `Init()` would normally choose for that platform. The maintainer confirmed the
   second half in a follow-up message: "I probably do not have technical knowledges about DBs to
   tell what would be a better option in 2(a) straight from their names. so I will take your
   recommendation on that." Neither choice deletes the frozen local copy.
3. **Upstream-service agreement (refines MC-086):**
   - **(a)** The home-screen Realm preview is hidden until the user agrees, or replaced by a
     placeholder that asks for agreement. Previews start showing once the user accepts.
   - **(b)** Static web builds relaying LLM requests through upstream's `/proxy2` is a separate
     ticket, not this stage. The maintainer's recollection, stated not verified: it is a plain
     proxy, there for CORS and provider-compatibility reasons.
   - **(c)** One shared acceptance covers both the Terms of Service and the Privacy Policy. The
     prompt says explicitly that the service is maintained by upstream.
   - **(d)** `Legal.svelte` and the `VITE_RISU_LEGAL_CONFIGURED` gate stay unchanged for now,
     until everything else is in place.
4. **Sharing to Realm a character that already has a `realmId`:** a fresh upload, plus a one-line
   notice that the existing listing is edited on Realm's own site, with its own sign-in (MC-084).
   The button label stops switching to "Update".
5. **The `src/lang` keys that the removal leaves unused are deleted**, in all 7 language files,
   as with MC-083.
6. **Dead code goes in the same pass:** the server-side Sionyw OAuth code in `server.cjs`,
   `RealmUpload.svelte`, `shareRisuHub2`, `openRealm`, `risuLogin`, `globalFetch`'s
   `useRisuToken`, `fetchNative`'s `useRisuTk`, and the expired `tos2` notice. `LiteMain.svelte`
   gets its own ticket.
7. **The stage edits these documents:** `AGENTS.md`'s Data Layer section; `plugins.md`
   (`saveMethod` and the four "syncs across devices" passages); the fifth such passage, in
   `src/ts/plugins/migrationGuide.md`; and a new migration wiki page. The parallel wiki session's
   files stay untouched.
8. **The "Account & Files" settings tab is renamed**, since the account half is gone. The
   parallel session's wiki page of the same name follows it.

---

### MC-088 — Merge the unreachable Files page into the renamed tab, named "Backup & Files"

- **Tag:** decision
- **Date:** 2026-09-25
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, after the stage plan proposed renaming the tab to "Files".
- **Related:** MC-087 #8, MC-080. Roadmap CHORE-14 UI-1 (the Files page has a render case but no
  menu button, so it is unreachable in this fork and upstream alike).

> iirc there is separate Files options are already there. can you double check? If there is, I
> think we should merge these two and rename it to Backup & Files.

**Checked before recording (Orchestrator, 2026-09-25):**
- `FilesSettings.svelte` is rendered at `SettingsMenuIndex` 5, and nothing sets that index. This
  is the same at upstream/main.
- The page holds the fork's own Phase 1 controls:
  - the Asset Cache Integrity panel, with the `checkCorruption` "Warn on startup" toggle and
    "Verify Asset Cache Now";
  - the OPFS "Local Storage Backend" switch.
- Its Google Drive save and load buttons duplicate the ones on the Account & Files page.

**What was decided:**
- **The pages merge.** The Files page's content moves into the renamed tab, which is now called
  "Backup & Files".
- **The two Phase 1 panels become reachable** from the Settings menu for the first time.
- **Duplicates go.** The duplicate Drive buttons and the unreachable page route are removed.
- **Keys.** The label gets a new key. `files` and `account` are left unused and are deleted
  (MC-087 #5).

---

### MC-089 — Keep the OPFS switch visible after the merge; the fork does not ship until every current ticket is cleared

*Point 1 superseded by `MC-167` 2.*

*Point 2 amended by `MC-177` 1 for CHORE-74.*
*Point 2 amended by `MC-181` for CHORE-55.*

- **Tag:** decision
- **Date:** 2026-09-25
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering the question of whether MC-088's merge should expose the
  OPFS "Local Storage Backend" switch now. It had never been reachable, and Gate 1 round 2 (ledger
  row 194) found a possible quota lockout in its migration.
- **Related:** MC-088, MC-011. Report 28's ticket for the OPFS quota lockout.

> leave it as is, as this fork won't ship until we clear every current tickets.

**What was decided:**
- **The switch stays visible.** The merged Backup & Files tab shows the OPFS switch in the CHORE-33
  stage, as Report 28 plans. *Superseded by `MC-167` 2 (2026-10-02): the OPFS switch in Backup & Files goes away.*
- **Nothing ships until every current ticket is cleared.** The first release of this fork waits
  for every currently open ticket, the OPFS quota-lockout ticket included. A ticket's existence
  is therefore not a reason to hide a feature for the release. This adds to MC-011's "the
  campaign gates the first release".

---

### MC-090 — Bug report: the edit button on earlier messages sometimes opens no editor

- **Tag:** stated
- **Date:** 2026-09-25
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, during the CHORE-33 28A stage. The report does not say which build
  (dev server, production Node, Tauri) or which UI theme it was seen on.
- **Related:** Report 20 (durable drafts), commit `e250089a` (message edits kept across
  involuntary unmounts); upstream `ed1babcb` ("prevent concurrent message edit modes").

> I think I found another bug, but with more vague details this time - edit button on previous
> messages sometimes does not work. it does not create text editor at all.
> to fix, user has to either pick different character or different chat with significantly
> different content, and come back to try again.
> sometimes it fixes the issue, sometimes it does not - then user has to go through all over that
> again to see if it worked this time.

**What this records:**
- **The symptom.** On some earlier messages, clicking Edit opens no text editor.
- **The workaround.** Switching to another character, or to a chat with markedly different
  content, and coming back sometimes restores it, and sometimes does not.

**Details the maintainer gave the same day, answering the Orchestrator's questions:**

> 1. upstream. risuai.xyz to be specific.
> 2. it happens totally randomly. I do not use translations.
> 3. it can happen everywhere in the chat.
> 4. buttons look normal.
> 5. might helpful context is that my save file is extremely heavy, 36gb in .bin format.

- **The build.** Upstream's hosted site, risuai.xyz, not this fork. It is an upstream bug. The
  question for this fork is whether it has the same mechanism (MC-011).
- **No translation is involved.**
- **Where and how.** It happens on any message, at random, and the button looks normal, not
  disabled.
- **The save is about 36 GB as a `.bin`,** which is relevant to timing and load.

**Further answers the same day:**

> 1. all data are stored locally
> 2. yes; can provide all of them as there are multiple enabled.

- **Local storage only.** All data is in that browser. There is no account sync, so
  `AccountStorage` is not involved.
- **Plugins.** Several plugins are enabled. The maintainer offered to provide them; their code is
  to be read as data, never run or installed.

**The plugin files, 2026-09-26.** The maintainer supplied the plugins they still have, in
`C:\Projects\Plugin backups`. Some that they use were taken down by their authors and could not be
included. Ledger row 202 read them as data.

**Answers to the stuck-state questions, 2026-09-26** (asked after ledger rows 201 and 202):

> 1. doesn't look like it from my experience
> 2. no.
> 3. yes.

- **It stays stuck.** Clicking the same message's edit button again, after waiting, does not
  bring the editor back. Only switching away and back sometimes does.
- **No per-reply scripts.** The characters and modules involved do not run scripts on every
  reply: no stat or affection trackers, no "Update Chat At", no Lua `reloadChat`, no buttons
  embedded in messages.
- **The newest message is affected too,** not only older ones.

---

### MC-091 — Adopt the advisor's workflow improvements as a bounded pilot

- **Tag:** decision
- **Date:** 2026-09-26
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, supplying a third-party advisor's review of the workflow
- **Related:** MC-011, MC-047, MC-053, MC-069, MC-080, MC-081, MC-089

> I got the third party advisor to overlook our workflow, and they gave us the following
> improvements. … I'd like to update our workflow to reflect these improvements.

**What was decided:**
1. The workflow changes in Report 29 are adopted as a **pilot over the next 5–10 comparable
   items**, with model assignments and substantive safety gates unchanged; results are logged in
   the ledger (its "Pilot (MC-091)" note, under "## Log") and the pilot is reviewed with the maintainer at its end.
2. **Clarifications recorded with it** (maintainer-supplied through the feedback):
   - The home-screen change (MC-053) addresses mobile access to essential navigation, and the
     RisuAccount removal (MC-080) addresses dependence on an external asset backend and its backup
     and maintenance constraints. Neither is incidental scope creep.
   - Backend licensing uncertainty is a maintainer-reported concern, not an established legal
     conclusion. Removing RisuAccount does not mean removing every upstream service (Realm, Drive
     backup and `/hub-proxy` stay, MC-080).
   - Scope may be amended for required behaviour in the agreed mobile experience, technical
     prerequisites, shared-cause corrections and explicit maintainer decisions to reduce supported
     complexity (AGENTS.md, "Scope amendments"). New product trade-offs remain the maintainer's.
3. **Not changed by this decision:** MC-089's release policy (no ticket is deferred; any change
   must be explicit), MC-047's Android sequencing, and every settled MC decision.
4. Supersedes, for the rules named in Report 29's mapping only: the universal Orchestrator
   re-verification wording, the blanket "a test that passes before and after proves nothing", the
   automatic `/clear`, the fresh-reviewer-every-round rule, and the full-suite-on-every-invocation
   rule. The earlier gate records stay as they are.

---

### MC-092 — Work order, and three infrastructure decisions: Drive, `risuaiAccountCached`, and the Patreon list

- **Tag:** decision
- **Date:** 2026-09-26
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, in reply to the Orchestrator's recommended work order and its
  questions on CHORE-35, CHORE-36 and CHORE-38.
- **Related:** `MC-080` (its "keep Google Drive backup" part is superseded here), `MC-089`,
  `MC-091`.

> go with your order, do the optional items now
> CHORE-39 goes before W1.
> CHORE-35 - proxy was there before EULA was introduced. but making these features opt-in sounds
> more solid. Patreon can be removed though - I do not wish to take a donation, and upstream
> patreon feels off to be in a fork.
> CHORE-36 - let's remove the google drive sync - I do not wish to take a risk related to it.
> CHORE-38 - I think it's safe to clear them

**What was decided:**
- **Work order:** the records; the three optional 28C follow-ups (a test for the Decline
  republish, a store guard on `MainMenu`'s `online` listener, tidy the T-C15 mocks) now; the
  second comment-sweep pass; CHORE-39 before W1; then a removal stage (below); then W1; the
  CHORE-35 opt-in stage after W1.
- **CHORE-36 → remove Google Drive backup.** Orchestrator's reading: remove Google Drive backup
  entirely, web and Tauri — the Save/Load buttons, the OAuth flow, the `?code=`/`?state=`
  handling, and their lang keys. This **supersedes MC-080's "keep Google Drive backup"**; Realm
  and `/hub-proxy` stay kept. The upstream-agreement prompt from 28C then covers Realm only, and
  its wording follows. Migration from upstream is still by local `.bin` backup (MC-011).
  CHORE-36's restore-over-risuai.xyz question is moot once Drive is removed.
- **CHORE-38 → clear `risuaiAccountCached`**; no recovery.
- **CHORE-35 → make the upstream-infrastructure features opt-in** (the maintainer notes `/proxy2`
  predates upstream's EULA). Orchestrator's reading of scope: the `/proxy2` default on static web,
  the transformers CDN, the MCP OAuth helper, `#import=<url>`, `getProxyStreamJobBaseUrl`; design
  to be planned and gated. **Remove the Patreon list** (the maintainer takes no donations, and
  upstream's Patreon does not belong in a fork).
- **Placement:** Drive removal (CHORE-36), CHORE-37 dead code, CHORE-38 and the Patreon removal
  form one removal stage after CHORE-39 and before W1; CHORE-35's opt-in is its own stage after
  W1. The Patreon removal may ride with either; the Orchestrator's default is the removal stage.

---

### MC-093 — Remove the Communities page; guard a local restore against other open tabs

- **Tag:** decision
- **Date:** 2026-09-27
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, in reply to the removal stage's report (Report 31). The report
  noted that `Communities.svelte` has had no menu entry since upstream `3d2d07fe` repointed it to the supporter page. It also asked
  for a product call on CHORE-42: another open tab can overwrite a local-backup restore.
- **Related:** MC-092 (the removal stage), MC-054 (the Discord invite stays on the home
  screen), MC-011 (local `.bin` restore is the migration path from upstream), CHORE-42.

> commit them, and remove the communities page too. I think its good idea to refuse the restore or
> at least warn the user about it before restore if there are other tabs open.

**What was decided:**
- **Remove the Communities settings page.** It joins the removal stage's dead code.
- **CHORE-42: guard a local restore against other open tabs.**
  - When other tabs of the app are open, the restore is refused, or at least the user is warned
    before it starts.
  - Refusal is the stronger of the two options the maintainer allowed. Which one ships is
    to be planned and gated.

---

### MC-094 — A trigger run has no commit step; W1 splits into W1a (writes) and W1b (reads and the parser)

- **Tag:** decision
- **Date:** 2026-09-27
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on two questions the Orchestrator asked
  after W1's scoping (ledger rows 253-254) and the `senior-advisor` escalation (row 255).
- **Reasoning:** at HEAD a trigger's end-of-run whole-object commit puts a chat back to its
  trigger-start copy. So a message sent or edited in that chat while a slow trigger awaits is
  lost, and re-addressing the commit cannot prevent that.
- **Alternatives rejected:** keeping the whole-object commit and only fixing its address (the loss
  would have become a new ticket); one W1 stage.
- **Supersedes:** `MC-076`'s "Whole-object commit stays" (Report 23's W-2).
- **Related:** MC-073, MC-075, MC-076, MC-078, MC-089, CHORE-25, CHORE-26.

**What was decided:**
1. **No commit step (W-2′).**
   - Each change a trigger makes is applied to the live chat or character it belongs to, addressed
     by id, at the moment the effect runs.
   - Nothing typed, edited or generated while a slow trigger runs is lost.
   - A trigger's changes become visible as they happen. For example, a trigger that trims the chat
     and then waits on an LLM shows the trimmed chat while it waits.
   - Lua `setFullChat` still replaces the whole history, as before.
2. **W1 is split by data class.**
   - **W1a:** every write a trigger run makes. It closes CHORE-25 and CHORE-26.
   - **W1b:** the read side and the parser: CBS variables, `loadLoreBookV3Prompt`, `graphmem.ts`
     and the Lua read bindings.
   - Each has its own plan, gates and commit.

---

### MC-095 — The send's own reads, its `{{setvar}}` writes and graph memory are bound in W2, not W1b

- **Tag:** decision
- **Date:** 2026-09-28
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on a question the Orchestrator asked
  after W1b's scoping (ledger row 265).
- **Reasoning:** CBS variable writes happen only inside `sendChatBody` (its `runVar` parse), and
  the graph-memory tool is reached only from the send's model requests. The send has no origin of
  its own until W2, so binding them in W1b would mean giving the send a read-only origin early
  and touching `sendChatBody` twice.
- **Alternatives rejected:** W1b binds the send's parser calls, `runCurrentChatFunction`, its
  lorebook call and the six tool-call sites, and W2 later converts the send's writes.
- **Amends:** `MC-094` 2's W1b list, for `graphmem.ts` and for the send's callers of the parser
  and `loadLoreBookV3Prompt`.
- **Related:** MC-094, MC-091, CHORE-25.

**What was decided:**
1. **W1b builds the mechanism and binds every caller outside the send:** an optional target for the
   parser, the chat variables, `loadLoreBookV3Prompt` and module selection, used by trigger runs,
   the Lua bindings and the `editinput` script.
2. **W2 binds the send:** `sendChatBody`'s parser calls, including the `{{setvar}}` writes, its
   lorebook call and graph memory's reads and writes, together with the send's own writes, under
   one origin.
3. Until W2, `{{setvar}}` in a message and graph memory still follow the selection during a
   send. Nothing ships between the stages (`MC-011`, `MC-089`).

---

### MC-096 — Android wrapper analysis: Capacitor-vs-Tauri OOM mechanisms and the IPC-boundary escape hatches, kept for when Android is scheduled

- **Tag:** decision
- **Date:** 2026-09-28
- **Sweep ref:** none (stated directly this session; no report file — recorded here on the
  maintainer's instruction because it is judged significant enough to reuse)
- **Source:** the maintainer's own rough Android plan, stated directly this session (drop
  Capacitor, build Android on Tauri 2), and two read-only investigations this session against
  this repo (no Android build present) and against `C:\Projects\HaejeokRisuai` (a Capacitor +
  native-SQLite Android fork used only as a reference), followed by the Orchestrator's own
  source verification of the Tauri/wry claims below (pinned versions `tauri 2.11.5`,
  `wry 0.55.1`, `tauri-plugin-fs 2.5.2`, `tauri-runtime-wry 2.11.4`).
- **Reasoning:** MC-047 gates Android behind the Roadmap's RAM/residency rework, but says nothing
  about wrapper choice or IPC cost — a separate axis that a wrapper decision must also account
  for, and one worth fixing in place now rather than rediscovering later.
- **Related:** MC-047 (Android gated behind the RAM rework), MC-002 (platform mix), MC-011 (fork
  never shipped; upstream compatibility). This entry assumes MC-047's rework is done by the time
  Android is scheduled — it is about wrapper/IPC boundary cost, not about the still-open
  residency work.

**What the investigation found:**

1. **Premise check: HaejeokRisu's Android build is Capacitor, not Tauri.** Confirmed from its
   `capacitor.config.ts`, `android/` project and its `publish-android` CI job that builds the
   signed APK users actually install. Upstream's own prior Android attempt (also Capacitor) was
   fully removed in January 2026 (`74bb6aa80`). Neither is evidence about how *our* Tauri
   architecture would behave on Android — this repo has no Android build (`src-tauri/gen` has no
   `android/`, `[lib]` is commented out in `Cargo.toml`).
2. **Capacitor's own OOM mechanisms, confirmed in HaejeokRisu's source:** every file read/write
   crosses its Capacitor↔native bridge as base64 text (`capacitorStorage.ts`), producing several
   simultaneous copies of the same bytes; and its native SQLite plugin builds one Java object per
   result row with no `android:largeHeap` set, so a single large query can hit the Java heap
   ceiling independent of how well-paginated the design is. HaejeokRisu's own git history shows
   they already hit and fixed two adjacent mechanisms (a 32MB-heap-tested streaming restore, and
   device-scaled asset-cache limits) — evidence several "obvious" candidate mechanisms are
   already closed there, narrowing what's left.
3. **Tauri's IPC boundary has an analogous, but narrower, cost — confirmed in the pinned source,
   not general knowledge:**
   - **Write side (page → Rust) is Android-specific, not a Tauri-wide cost.** Android's WebView
     cannot let native code read a custom-protocol request body, so Tauri falls back to
     `postMessage`, which JSON-stringifies a `Uint8Array` into a number array (`ipc-protocol.js`,
     `process-ipc-message-fn.js`) — several times the byte size, transiently. **Desktop does not
     pay this cost**: a binary `invoke()` argument there goes out as a raw
     `application/octet-stream` body over the custom-protocol `fetch()` path, no JSON at all,
     because desktop's WebView backends can read that request body.
   - **Read side (Rust → page) has a real ceiling, also Android-specific.** wry's Android
     response path (`android/binding.rs`, `handle_request`) does exactly one
     `env.byte_array_from_slice(bytes)` JNI copy of the *entire* response body into a Java
     `byte[]`, with no internal chunking — this is a JNI/WebView-API requirement with no desktop
     analogue (desktop protocol handlers never cross a JVM boundary).
   - **The escape hatch already half-exists.** Tauri's shared asset protocol
     (`tauri/src/protocol/asset.rs`) already implements HTTP Range requests and caps every
     ranged response at `MAX_LEN = 1000 * 1024` (~1MB) — so a caller that issues genuine ranged
     reads (streamed `fetch`, or `<video>`/`<img>` elements that request ranges) bounds each JNI
     copy to ~1MB regardless of the underlying file size. This code is shared across all
     platforms already; only the *benefit* is Android-specific, since desktop has no comparable
     ceiling to work around.
   - **For bulk writes, the recommended pattern is a loopback HTTP server in Rust** (e.g.
     `tauri-plugin-localhost`, or a small hand-rolled server), with the page using plain `fetch()`
     against it instead of `invoke()`. A real socket read by Android's own network stack bypasses
     wry's IPC/JNI response path entirely. This needs care if implemented: loopback-only binding
     plus a per-launch random token on every request, to close the known "malicious page probes
     this app's localhost port" class of vulnerability (DNS rebinding and similar).
4. **Scope: both problems, and both fixes, are Android-specific.** Desktop already avoids the
   write-side cost (octet-stream fetch), and the read-side ceiling has no desktop analogue at
   all. Web and Docker/self-hosted are architecturally unaffected either way — they never touch
   Tauri's IPC or protocol code (web uses OPFS/localForage blobs; Docker's self-hosted Node
   server, `server/node/server.cjs`, is a separate implementation with **no Range/206 support
   today**, confirmed by grep — flagged so a future change never assumes ranged reads work
   uniformly across every backend without checking first).
5. **Left unverified, needs a real device or a `node_modules` install to close:** the actual
   Java heap ceiling on target hardware; whether Android gives an in-app WebView page a different
   memory ceiling than a Chrome tab on the same device (this investigation tier could not settle
   it from source); and Capacitor 8.5.0's exact bridge serialization format (its packages were
   not installed in the referenced `HaejeokRisuai` checkout).

> that got me thinking, is there an escape hatch for Java-heap-copy issue too? or is it something
> we have to live with?
>
> does it affect other platforms(tauri-desktop, docker, web, etc) too, or is it something we can
> implement without major downside or sacrifices?
>
> add MC entry recording this Android wrapper analysis - I think this is significant enough to
> come back to during android support.

---

## Open questions

The three entries below are questions addressed to the maintainer that were still unresolved as of
their source's last update. They are grouped separately from Facts and Decisions for one reason:
nothing here is settled, and filing an open question next to a decided one risks a reader treating
it as decided by proximity alone.

### MC-049 — Whether the "Global Regex" setting (`db.globalscript`) not being read by the script engine is a bug or intended

- **Tag:** open
- **Date:** not recorded · on or before 2026-09-22 (`bbdbb07e`)
- **Sweep ref:** F27
- **Source:** `Agents/Roadmap.md`, "CHORE-09 — Scripting, regex and lorebook bugs found during the
  wiki rewrite (none lose data)," table row 8

> Settings → "Global Regex" (`db.globalscript`) is never read by the script engine; it is only an
> import/export staging list. The effective global list is the preset's (`db.presetRegex`).
> Possibly intended; confirm with the maintainer before calling it a bug.

*Answered by `MC-206`: upstream deprecated Global Regex and Global Lorebook on purpose in `8ed4555b` (2024-02-07, "remove global regex and lorebook and add convertion to modules"). The conversion into modules was later disabled: `bootstrap.ts` still carries "//migration removed due to issues", introduced in `b3fddb81`. The maintainer retired the two pages and kept the data (`MC-206`).*

---

### MC-050 — Whether a leftover draft should be allowed to defer the multi-tab auto-reload

- **Tag:** open
- **Date:** not recorded · on or before 2026-09-23 (`b82470a2`)
- **Sweep ref:** D17
- **Source:** `Agents/Reports/19-chat-list-window-plan.md`, "§3 Direction (senior-advisor
  escalation, 2026-09-22; the maintainer approved the order)"; also
  `Agents/Investigation-Ledger.md`, row 97
- **Related:** MC-041

> **Maintainer decisions:** the order was approved. The trade-off in durable drafts (a leftover
> draft could defer the multi-tab auto-reload) is to be decided when that plan is written.

The same open point, in the durable-drafts plan itself (which restates it as still needing a cap
and a prune rule, not as having resolved it):

> **Open maintainer decision:** a leftover draft could defer the multi-tab auto-reload until
> pruned. It needs a cap and a prune rule. The maintainer chose to decide this when the plan is
> written.

---

### MC-051 — Whether `streamingDisplayOptimizationMode` should default to `'off'` or `'balanced'`

- **Tag:** open
- **Date:** not recorded · on or before 2026-09-23 (`b82470a2`)
- **Sweep ref:** D18
- **Source:** `Agents/Reports/19-chat-list-window-plan.md`, "§3 A2, B, D, E (after the above)," "B,
  streaming"

> `'balanced'` already avoids the per-chunk remount by design. Whether the default should stay
> `'off'` is a product question for the maintainer, alongside any engineering fix.

---

## Decisions commonly mis-attributed to the maintainer

Two items in this campaign's own working material named the maintainer as the decision-maker for
something the maintainer did not, in fact, decide. Both mistakes were caught before this document
was written, not after. They are recorded here, stated plainly, because the same mistake is likely
to recur.

### Retiring the module draft-copy design

**What actually happened:** the module-editor draft-copy design (`MC-044`'s durability decision
belonged to it) was rejected twice at `opus-reviewer` plan gates, then formally retired after a
`senior-advisor` escalation — not by the maintainer choosing to abandon it.
`Agents/Phase2-Handoff.md` records this directly:

> Stage B was first planned as a **draft copy** of the edited module. That design was rejected at
> two `opus-reviewer` gates and retired after a `senior-advisor` escalation. Do not revive it as a
> performance fix.

**Unresolved discrepancy — the escalation has no ledger row.** `Agents/Roadmap.md` and
`Agents/Phase2-Handoff.md` both state the design was retired after a `senior-advisor` escalation.
`Agents/Investigation-Ledger.md` contains only two `senior-advisor` rows, and neither is this one:
row 71 is CHORE-17, row 97 is the chat-list window. The rows covering this work run gate (draft-copy
plan), gate round 2 (revision 2), then straight to the partition plan gate, with no escalation
between them. The ledger records every dispatch with its tier and cost, so either the escalation
happened and was never logged, or the "retired after a `senior-advisor` escalation" wording in both
documents is inaccurate. Verified by the Orchestrator, 2026-09-23; **not resolved** — recorded here
so it is not rediscovered. The two `opus-reviewer` rejections are themselves ledger-confirmed and
are not in doubt.

**Where the manifest's citation for this rule did not check out.** The manifest that seeded this
document said the "do not revive it as a performance fix" rule "belongs in Report 10's D2 status
header." It does not: that exact sentence appears only in `Agents/Phase2-Handoff.md`, quoted above.
`Agents/Reports/10-stage-b-module-draft-copy-plan.md` does not contain it. The rule itself is real
and is recorded correctly above; only its citation is corrected here.

**The maintainer's actual role was supplying context, not making this call.** That context —
real profile sizes, real asset-module sizes, real hardware, and the character-editor comparison —
is what `Agents/Phase2-Handoff.md` itself credits with settling the direction of this work more
than either review gate did:

> **Measure the premise before planning.** Three plan revisions for Stage B failed. The design was
> retired because its central premise — that the cost was a persistence problem rather than an
> effect-granularity problem — had never been tested; the revisions only patched the layers built
> on top of it. The maintainer's own context (profile sizes, asset modules, hardware, the
> character-editor comparison) settled more than either review gate did. **Ask the maintainer what
> real usage looks like** before sizing work.

That is real, and worth recording as credit. It is not authorship of the retirement decision
itself, and should not be written up as such.

### Deferring the alertStore mutex

The `alertStore` modal-hijack mutex was investigated, scoped, and deliberately not attempted (see
`Agents/Roadmap.md`, "The alertStore hijack: investigated 2026-09-21, scoped, and deliberately NOT
attempted"). No mention of "maintainer" or "project owner" occurs anywhere near that investigation's
text, its mechanism analysis, or its "shape of a real fix" section. This was an investigation-scoping
outcome — the plan gate that reviewed the mutex-only design rejected it, and the deferral followed
from that rejection — not a call the maintainer made or was asked to make.

---

### MC-097 — Composer stage: generation after a mid-send switch is W2's; the composer empties at Send

- **Tag:** decision
- **Date:** 2026-09-28
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on two questions the Orchestrator asked
  after the composer stage's re-scoping (ledger row 272), before Report 22 rev 3.
- **Reasoning:**
  - W2 binds generation to the send's origin anyway, and nothing ships between the stages
    (`MC-089`), so a stop added now would only be reworked there.
  - Taking the composer's contents at Send removes the double send, and removes rev 2's
    partial-clear rule, which Gate 1 attacked.
- **Alternatives rejected:**
  - Stopping before generation when the chat on screen has changed (Report 22 rev 2's I6).
  - Keeping the text visible until the message is appended, with a "sending" flag and a
    partial clear.
- **Related:** MC-072, MC-073, MC-075, MC-076, MC-089, Report 22.

**What was decided:**
1. **The composer stage does not touch generation.** After a mid-send switch, the user message
   lands in the chat the send started from, and the reply is still generated on the chat now on
   screen, until W2.
2. **Send empties the composer at once.** The text, files and translation are taken out of that
   chat's draft the moment Send is pressed, so while a slow input trigger runs, the text is
   visible nowhere until the message is appended. If the send appends nothing because its chat is
   gone, the text goes back into that chat's draft, which is never shown again.

---

### MC-098 — The Send button shows busy from Send until generation starts; `sendPofile` belongs to W2/W3

- **Tag:** decision
- **Date:** 2026-09-28
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on two questions the Orchestrator asked
  after the `senior-advisor` escalation on the composer stage (ledger row 274).
- **Reasoning:**
  - With `MC-097` 2 the composer is empty during a slow input trigger. Without a busy state, the
    user sees no sign that the send is running, and a press is silently refused.
  - `sendPofile` is a send with no origin, the same subject as generation and `/` commands, not a
    composer draft.
- **Alternatives rejected:**
  - the button staying idle-looking and silently refusing presses;
  - binding `sendPofile` in the composer stage.
- **Amends:** `MC-073`'s "a refused action is silent", for the composer's own actions during this
  window only. No toast or string is added; the existing busy look is reused.
- **Related:** MC-072, MC-073, MC-075, MC-097, Report 22.

**What was decided:**
1. **Busy state.** From the moment Send takes the composer's contents until generation starts,
   the Send button shows the busy look it already has during generation. Switching chats stays
   unrefused.
2. **`sendPofile`** (the `.po` Post File path in `multisend.ts`) is bound to its origin in W2/W3.
   It is not a composer-stage limitation.

---

### MC-099 — The busy button cancels a send that has not reached generation

- **Tag:** decision
- **Date:** 2026-09-28
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on a question the Orchestrator asked
  after Gate 1 round 4 of the composer stage's S1 (ledger row 275).
- **Reasoning:**
  - With `MC-097` 2 the text is out of sight while the input trigger runs.
  - A trigger or plugin hook that never settles would otherwise block every composer action until
    a reload, and the reload loses the text.
- **Alternatives rejected:** no cancel before generation.
- **Related:** MC-094, MC-097, MC-098, Report 22.

**What was decided:**
1. **Clicking the busy button before the user message is appended cancels the send.** The text,
   files and translation go back into the composer, and the Send button is free again.
2. **If the stalled step finishes later,** the message is never appended and nothing is
   generated.
3. **Whatever the trigger itself has already written stays,** as for any trigger (`MC-094`).
4. **After the append,** the button aborts generation, as today.

---

### MC-100 — Lock the composer from Send until generation starts; the reroll history's cross-chat bug is its own ticket

- **Tag:** decision
- **Date:** 2026-09-28
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option after Gate 1 rejected the composer
  stage's S1 plan six rounds running (ledger rows 273 and 275 to 277). Since the escalation (row
  274), each rejection had hit a rule added only to merge text typed during a send's wait back
  into the composer.
- **Reasoning:**
  - At `790643ff`, text typed during that wait is silently lost anyway, because the send clears
    the composer after appending.
  - A lock removes the whole merge family, and cancel (`MC-099`) keeps the user from being stuck.
- **Alternatives rejected:**
  - Keep typing allowed, with rev 7 fixes: track the last-edited field, re-issue its translation,
    and reset the reroll history on every write.
  - A second `senior-advisor` escalation.
- **Related:** MC-073, MC-097, MC-098, MC-099, Report 22, CHORE-43.

**What was decided:**
1. **The lock.** From the moment Send takes the composer's contents until generation starts (or
   the send is cancelled or fails), both composer fields are read-only. Nothing can be added to
   the composer.
   - Switching chats is not locked.
   - Typing is possible again as soon as generation starts, or after a cancel.
2. **The reroll history** stays per composer instance, as it is today. Its cross-chat bug is filed
   separately as `CHORE-43`: an unreroll in one chat can write another chat's reply. It exists
   upstream, and on desktop. *Superseded by `MC-168` and `MC-169` (2026-10-02) for the history's ownership and lifetime: each recent chat keeps its own.*

---

### MC-101 — Finish the composer stage before the upstream sync batch

- **Tag:** decision
- **Date:** 2026-09-28
- **Source:** after the upstream triage (ledger row 287), the maintainer said "let's finish the
  composer stage first", in answer to the Orchestrator's question on order.
- **Reasoning:** as stated. Upstream's reroll perf change (`7fd4b875`) lands inside the composer
  stage's `composerActions.svelte.ts`, so finishing that work first gives it a settled target.
- **Alternatives rejected:** moving upstream's plugin-permission security fix (`5537816a`) ahead of
  the composer stage.
- **Related:** MC-011, MC-089, MC-100, Report 22, ledger row 287.

**What was decided:**
1. The composer stage (S1, then S2) is finished first.
2. The upstream batch follows, in row 287's proposed order:
   - `b544d744`, `e8c063c0`, `a66f81a8` and `851e8ca5`;
   - `5f9e3cbe`, with `opus-reviewer`;
   - then the hand port of `5537816a`, with `opus-reviewer`.
   `7fd4b875` is ported by hand into `composerActions.svelte.ts`, and `ca1345fc` is not ported:
   `zh-Hant`'s `providerPermissionDenied` is translated here.

---

### MC-102 — Composer drafts (S2): the lock stays global; two chats holding one id share one draft

- **Tag:** decision
- **Date:** 2026-09-28
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on two questions the Orchestrator asked
  after S2's scoping (ledger row 291), before Report 22 rev 8.
- **Reasoning:**
  - The global lock is what S1 built, gated and live-checked. It lasts only until generation
    starts, and a per-draft lock would bring back the rules for text typed during a send's wait
    that kept S1's Gate 1 looping (`MC-100`).
  - A duplicate id comes only from a plugin within a session, and boot repairs it. A shared draft
    is visible in the composer before anything is sent, so nothing crosses chats silently.
- **Alternatives rejected:**
  - Locking only the sending chat's draft, so another chat can be typed into during the wait.
  - Keeping no stored draft for a chat whose id is duplicated.
- **Related:** MC-072, MC-073, MC-078, MC-100, Report 22.

**What was decided:**
1. **The lock stays global.** From Send until generation starts, or until a cancel, every
   composer is read-only, whichever chat it shows. Switching chats is not locked.
2. **Two chats of one character holding the same id share one composer draft.** This is recorded
   as a known limitation, not guarded against.

---

### MC-103 — W2: a busy starter is refused silently; a confirmed delete aborts; Home keeps generating; a gone group member is skipped

- **Tag:** decision
- **Date:** 2026-09-29
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on four questions the Orchestrator asked
  after W2's scoping (ledger rows 305-306).
- **Reasoning:** the recommended options, as offered:
  - a silent refusal matches `MC-073` (clicking a character during generation is already refused
    silently);
  - aborting spends no tokens on a chat that no longer exists;
  - keeping generation running on Home matches the unlocked switch (`MC-073`, `MC-102` 1);
  - a member removed from the group mid-send has been removed by the user.
- **Alternatives rejected:**
  - a busy starter: queue it, or abort the running generation;
  - a confirmed delete: let the generation finish and drop its writes;
  - Home: abort on leaving;
  - a gone member: stop the group turn with the "cannot find character" error, or keep generating
    as a blank "Unknown Character".
- **Related:** MC-073, MC-075, MC-076, MC-078, MC-095, MC-097, MC-102, Report 23.

**What was decided:**
1. **A starter that finds another send in flight is refused silently.** This covers auto mode,
   reroll, the hotkey preview, Post File and DevTool. The plugin `sendChat` keeps its current
   contract of throwing.
2. **Confirming the delete of a chat, or of its character, while a reply is being generated into
   it aborts that generation.** A write that still lands on a gone origin is dropped silently
   (`MC-075` 2).
3. **Home, or a switch to another character, during a send does not stop it.** The reply finishes
   into the chat it started in and is saved, and the spurious error alert goes.
4. **A group member who is gone when their turn comes is skipped.** The group continues with the
   remaining members, and nothing is generated for the missing one.

**The stage split, as proposed to the maintainer with these questions:**
- W2a: the send's origin, writes, recursion and one work handle, including the Home case and the
  `{{setvar}}` writes;
- W2b: `doingChat` ownership and the other generation starters;
- W2c: the send's reads (the parser, `@@inject`, lorebook, modules, persona);
- W2d: the request layer, tool calls and graph memory (CHORE-27);
- W3: `/` commands, `/multisend` and `sendPofile`;
- W2e: the delete warning and complete work registration, last.

**Orchestrator defaults, stated with the questions; the maintainer did not object, but did not
decide them either.** Revisit any of them on request:
- the delete warning goes on the first confirmation, for trash and permanent delete alike;
- auto mode still stops on a chat switch;
- only the send's own requests bind the `request` trigger; the translator, the Playground and the
  other callers keep following the selection;
- the model's `risuaccess` tools, called with no `id` during a send, act on the send's chat;
- a `GLGlobalVariables` write whose subject is gone is dropped;
- the preview hotkey and DevTool register as work.

**Deferred to their stages' plans:** whether `/multisend` generates after each segment; a
`loadInternalBackup` mid-work; whether a cancel stops a running `/` command; whether trigger-run
`/` commands bind to the trigger run's origin.

---

### MC-104 — W2a: a send in a chat whose id is duplicated writes to the chat it was sent in; a cold group member is loaded for their turn

- **Tag:** decision
- **Date:** 2026-09-29
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on two questions the Orchestrator asked
  after Gate 1 round 1 of W2a (Report 35; ledger row 307).
- **Reasoning:**
  - The object the send started from is known by identity, so writing to it guesses nothing
    between the two holders. Applying `MC-078` to the whole send would have made Send a silent
    no-op in that chat until a restart, where HEAD works.
  - Cold storage is on by default and a group send updates only the group's `lastInteraction`,
    so a member spoken to only through the group goes cold after 10 days. Skipping them would
    silence them for good.
- **Alternatives rejected:**
  - a duplicated id: refuse with a visible error; stop silently (Report 35 rev 1);
  - a cold member: stop the group turn with an error naming the member.
- **Amends:** `MC-078`, for the send only. Other writers keep `MC-078`'s rule.
- **Related:** MC-075, MC-078, MC-102, MC-103.

**What was decided:**
1. **A duplicated id during a send.** When the send's chat id, or its character's `chaId`, has
   more than one holder, the send writes to the holder that is the very object it started from.
   It gives up (silently, as for a gone chat) only when none of the holders is that object.
2. **A cold group member** is restored from cold storage when their turn comes, the same way
   opening them directly restores them, and their turn runs. If the restore fails, the existing
   "cold storage restore failed" error is shown and the group turn stops.

---

### MC-105 — W2b: `/multisend` replies to every segment; the busy button cancels every generation; a group preview previews the next member

- **Tag:** decision
- **Date:** 2026-09-29
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on three questions the Orchestrator asked
  after W2b's scoping (ledger row 319).
- **Reasoning:**
  - `/multisend`'s code pushes each segment and then generates. Only the first segment gets a reply
    because the busy flag stays set after it. Upstream has the same bug.
  - During a plugin, preview, Autopilot, `/multisend` or `.po` Post File generation, the Send button
    shows its stop icon, but pressing it did nothing.
  - A preview in a group chat ran real replies for every member and then showed a stale preview.
    Upstream does the same.
- **Alternatives rejected:**
  - `/multisend`: only the first segment gets a reply;
  - the busy button: only a composer send can be cancelled;
  - a group preview: refuse previews in group chats, or leave upstream's behaviour and ticket it.
- **Settles:** `MC-103`'s deferred question "does `/multisend` generate a reply after each segment"
  (yes). Binding `/multisend` to an origin stays W3's.
- **Related:** MC-099, MC-103.

**What was decided:**
1. **`/multisend a|||b|||c` posts each segment and generates a reply after it, in order.**
2. **The busy button cancels whatever generation is running**, not only a composer send. This
   covers a plugin's `sendChat`, the prompt previews, DevTool Autopilot, `/multisend` and a `.po`
   Post File job. A cancelled plugin `sendChat` returns normally, without a reply.
3. **A prompt preview in a group chat previews the request of the first member whose turn it would
   be, and generates nothing.**

---

### MC-106 — W2b: `|||` survives the command line; a `/multisend` inside a running send posts its segments without replies; a preview gets a Cancel button

- **Tag:** decision
- **Date:** 2026-09-29
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on three questions the Orchestrator asked
  after W2b's Gate 1 round 1 (Report 36; ledger row 320), which brought new evidence about
  `MC-105`'s consequences.
- **Reasoning:**
  - `processMultiCommand` splits on every unquoted `|`, so a typed `/multisend a|||b|||c` posts
    only `a`, the command then fails, and the composer posts the command text itself as a message.
    Once the busy flag is fixed, the model would reply to that text. A `|||` can never form a
    working pipe (an empty command fails), so leaving it intact changes no working command.
  - A `/multisend` run while another send is generating cannot generate. Upstream posts every
    segment with no reply.
  - A preview's full-screen "Loading..." notice covers the busy button, and Escape does not close
    it, so `MC-105` 2's preview cancel needs a control of its own.
- **Alternatives rejected:**
  - `|||`: leave the splitter to W3;
  - a nested `/multisend`: post the first segment and drop the rest;
  - the preview: not cancellable.
- **Amends:** `MC-105` (what it takes to deliver 1 and 2). `MC-091` scope amendment: the command
  line's splitter, which is otherwise W3's.
- **Related:** MC-011, MC-103, MC-105.

**What was decided:**
1. **An unquoted `|||` in a typed command line stays part of the command's text**, so
   `/multisend a|||b|||c` posts `a`, `b` and `c`, each followed by its reply.
2. **A `/multisend` that runs while another send is generating posts every segment, and none gets
   a reply of its own**, as upstream.
3. **A prompt preview's "Loading..." notice has a Cancel button** (the existing "Cancel" string).
   It stops the preview and closes the notice.

---

### MC-107 — W2b: a stopped `/multisend` does not put its text back; the `|||` rule applies to triggers too

- **Tag:** decision
- **Date:** 2026-09-29
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on two questions the Orchestrator asked
  after the `senior-advisor` escalation on W2b's Gate 1 (Report 36; ledger row 323).
- **Reasoning:**
  - The busy button also cancels the composer's take (`MC-099`), which puts the typed text back.
    After a `/multisend` has posted a segment, that text would repost it on the next Send.
  - The composer and trigger `command` effects share one command-line splitter. Keeping
    upstream's split for triggers would need the splitter to know its caller, which it does not.
- **Alternatives rejected:**
  - put the command text back, as with any cancelled Send;
  - the `|||` rule for the composer only.
- **Amends:** `MC-099`, for a `/multisend` that has posted a segment. Confirms the Orchestrator's
  reading of `MC-106` 1.
- **Related:** MC-099, MC-105, MC-106.

**What was decided:**
1. **Once a `/multisend` has posted a segment, the busy button leaves the composer empty.** What
   was posted stays in the chat, and the command text is not put back.
2. **`MC-106` 1 applies wherever the command line runs**: a trigger's `command` effect running
   `/multisend a|||b` posts both segments, each with a reply (upstream posts only `a`).

---

### MC-108 — W2b-previews: Cancel stops at the next stage; Escape cancels; a group preview names its member; keys are masked; a result waits for another alert

- **Tag:** decision
- **Date:** 2026-09-29
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on four questions the Orchestrator asked
  after W2b-previews' scoping (ledger row 334), and on a fifth after Gate 1 round 1 (Report 38;
  ledger row 335), which found that the plan's own default for it dropped a successful preview.
- **Reasoning:**
  - In a preview, the send's abort reaches only the final request. The start trigger and memory
    summarisation (which can make its own LLM requests) run to their end after a Cancel, and the
    busy flag stays held until then.
  - No "Loading..." notice can be closed with Escape today.
  - Without "order by order", a group's next speaker is a random draw, and the draw can find nobody
    who would speak.
  - The preview displays the whole request, headers and URL included, so API keys are shown.
  - A start trigger, Lua or a plugin can show an alert while a preview runs. It is still up when a
    successful preview finishes.
- **Alternatives rejected:**
  - Cancel: dismiss only, with the work running on in the background; or passing the abort into
    memory summarisation and triggers now (a shared contract that W2d, the request layer, owns);
  - Escape: ignored, as for every other wait notice;
  - group: no member name, and close silently when nobody would speak;
  - keys: shown as upstream shows them;
  - another alert up at the end: replace it with the preview (upstream), or drop the preview.
- **Amends:** `MC-106` 3 (what "stops the preview" means). Refines `MC-105` 3.
- **Related:** MC-105, MC-106.

**What was decided:**
1. **Cancel closes the notice at once and discards the result.** The send also checks for an abort
   at its stage boundaries (around the start trigger, before memory summarisation and before the
   request), and stops at the next one. This applies to the busy button on a normal send too.
   Passing the abort into memory summarisation and triggers stays W2d's.
2. **Escape on a preview's notice does what its Cancel button does.** Other wait notices are
   unchanged.
3. **A group preview names the member it previews.** When nobody would speak, a short message says
   so (one new UI string, translated).
4. **The displayed preview masks API keys** in auth headers and in the URL's key parameters. The
   request itself is unchanged.
5. **A successful preview that finishes while another alert is up waits for it.** The other alert
   stays; the preview shows once it is closed. Starting another preview in the meantime drops the
   pending one.

---

### MC-109 — Escape leaves a prompt alone and closes an information alert; a covered prompt is a second stage

- **Tag:** decision
- **Date:** 2026-09-29
- **Sweep ref:** none (stated directly this session)
- **Source:** after an investigation into Escape on alerts (Report 39; ledger row 348),
  the maintainer chose the recommended option on three questions the Orchestrator asked.
- **Reasoning:**
  - Escape swaps any alert for a toast, and the toast's close answers `''` about a second later.
    `''` is not a safe cancel. On the instant-remove confirm, "No" also removes every message after
    it. On the hosted server's first-run password prompt, it sets the password to the hash of an
    empty string. On export selects it downloads a TXT, and on card export it throws.
  - A text input, and most selects, have no cancel value at all. The instant-remove confirm cannot
    express one through its boolean. Answering "cancel" would therefore need about fifteen caller
    changes.
  - A prompt covered by any other alert takes that alert's answer, whether or not Escape was
    pressed. Escape only adds a one-second window.
- **Alternatives rejected:**
  - Escape writes each prompt's own cancel answer;
  - keep upstream's toast;
  - keep the toast-close on information alerts;
  - fix the covered-prompt hazard in the same change, or as a separate ticket.
- **Amends:** none. Upstream behaviour changes: Escape no longer dismisses a prompt.
- **Related:** MC-011, MC-106, MC-108.

**What was decided:**
1. **Escape on an alert that is waiting for an answer does nothing.** The alert stays up until
   the user answers it. This covers confirm, select, input, the character and module pickers, add
   character, chat options, card export, the consent prompt and the stale-account notice.
2. **Escape on an information alert closes it at once, with no toast.** This covers notices,
   errors, markdown, request logs and branches. Escape leaves a progress bar alone.
3. **A prompt that another alert covers is a second stage** of this item, with its own plan and
   gates.

---

### MC-110 — W2c: a send's prompt reads the chat it started in; its Lua edit triggers keep `MC-078`; the disabled-message index is fixed

- **Tag:** decision
- **Date:** 2026-09-29
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on three questions the Orchestrator asked
  after W2c's scoping (ledger row 355).
- **Reasoning:**
  - `MC-104` 1 sends the reply to the chat the send started in when that chat's id has two
    holders. Building the prompt from an empty chat there would answer a conversation the model
    never saw.
  - The send's start and output triggers already keep `MC-078` in such a chat (Report 35); its Lua
    edit triggers are trigger runs too.
  - In the prompt-building script pass, `@@inject` and `@@repeat_back` count only enabled
    messages, so with a disabled message in the chat they write to or read another message. The
    same happens upstream. W2c rewrites those lines.
- **Alternatives rejected:**
  - reads in a duplicated-id chat: an empty chat, as `MC-078`;
  - Lua edit triggers there: read and write the chat the send started in, as the send's own writes;
  - the disabled-message index: keep upstream's behaviour and open a chore.
- **Extends:** `MC-104` 1 from the send's writes to its reads.
- **Related:** MC-078, MC-095, MC-103, MC-104.

**What was decided:**
1. **The send's own reads follow its writes.** Its prompt parses, scripts, lorebook, persona and
   module selection read the chat the send started in, resolved as its writes are (`MC-104` 1). In
   a chat whose id is not duplicated this is the only holder, and nothing changes.
2. **The send's Lua edit triggers (`editRequest`, `editOutput`) behave like its other trigger runs.**
   Which triggers run is chosen from the send's chat, as above. The Lua's own chat reads and writes
   keep `MC-078`: in a duplicated-id chat they see an empty chat and write nothing. The text the
   triggers return is still used.
3. **`@@inject` and `@@repeat_back` in the prompt-building pass address the real message** when
   the chat has disabled messages.

---

### MC-111 — W2c: the prompt pass's index tags describe the message being processed; its walk-backs skip messages not sent

- **Tag:** decision
- **Date:** 2026-09-29
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer answered two questions the Orchestrator asked after W2c-a's Gate 1
  round 1 (Report 40; ledger row 357), which found that `MC-110` 3 as planned also changed tags
  the decision did not name. The maintainer chose the non-recommended option on the first and the
  recommended option on the second.
- **Reasoning:**
  - In the prompt-building pass, the position `chatID` carries counts only the messages sent to the
    model. So with a disabled message, or an `allBefore` reset, every tag that reads `chatID`
    describes another message, not only `@@inject` and `@@repeat_back`. Upstream has the same
    defect. Their documentation says "the current message index in the chat".
  - A walk-back that reads disabled messages would put text the user hid from the model into the
    prompt.
- **Alternatives rejected:**
  - fix only `@@inject` and `@@repeat_back`, and keep the tags' upstream output (a chore);
  - walk back over the whole chat, disabled and pre-reset messages included.
- **Extends:** `MC-110` 3.
- **Related:** MC-110.

**What was decided:**
1. **In the prompt-building pass, every tag that reads the message index describes the message
   being processed:** `{{chat_index}}`, `{{role}}`, `{{messagetime}}`, `{{messagedate}}`,
   `{{messageidleduration}}`, `{{previouscharchat}}`, `{{previoususerchat}}`, as well as
   `@@inject` and `@@repeat_back`.
2. **In that pass, walking back to an earlier message (`@@repeat_back`, `{{previouscharchat}}`,
   `{{previoususerchat}}`) considers only messages sent to the model:** not disabled messages,
   and nothing before an `allBefore` reset. Walk-backs on the reply keep upstream's behaviour.

---

### MC-112 — W2c: every look-back while the prompt is built skips hidden messages, in W2c-a; the first message is its fallback only if it was sent

- **Tag:** decision
- **Date:** 2026-09-29
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer answered the Orchestrator's disclosure of three details of Report 40
  rev 3 that go beyond `MC-111`'s wording (ledger rows 358-359). They kept the first two as
  planned and widened the third.
- **Reasoning:** `MC-111` 2's reason (text the user hid from the model must not reach the prompt)
  holds for every parse that builds the prompt, not only the per-message script pass.
- **Alternatives rejected:**
  - `{{messageidleduration}}` walking the whole chat;
  - the fallback: always the first message (upstream), or always empty;
  - the rest of the prompt: in W2c-b, or not at all (script pass only).
- **Extends:** `MC-111` 2.
- **Related:** MC-110, MC-111.

**What was decided:**
1. **`{{messageidleduration}}` follows `MC-111` 2** in the prompt-building pass: it skips disabled
   messages and everything up to an `allBefore` reset when it looks back.
2. **When a look-back in the prompt-building pass finds no earlier sent message**, it returns the
   first message (or the chosen alternate greeting) only if that was sent to the model (not a group
   chat, no reset); otherwise it returns nothing.
3. **The rule covers every parse that builds the prompt, and W2c-a delivers it:** the per-message
   script pass, each message's own text, the first message, and the other prompt parses in
   `sendChatBody`.

---

### MC-113 — W2c: the prompt's index tags and hidden-message rule get their own stage, W2c-c

- **Tag:** decision
- **Date:** 2026-09-29
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on a question the Orchestrator asked
  after W2c-a's Gate 1 round 4 (Report 40; ledger row 362), the fourth [REJECT] in a row.
- **Reasoning:** every finding from round 2 on came from `MC-111` and `MC-112`: each round found
  another place the prompt is built (a message's own tags expanded at the send's entry, chatML
  template items, the history tags) or another cache dimension. The rest of W2c-a has held since
  its rev 2.
- **Alternatives rejected:** keep one stage and fix round 4's findings; narrow `MC-111`/`MC-112`
  to the per-message script pass.
- **Amends:** `MC-112` 3 (W2c-c delivers the rule, not W2c-a). `MC-111` and `MC-112` otherwise stand.
- **Related:** MC-110, MC-111, MC-112, MC-103.

**What was decided:**
1. **W2c-a** delivers the binding (the script pass, the Lua edit triggers and the lorebook scan
   read the send's chat) and `MC-110` 3 alone: `@@inject` and `@@repeat_back` in the
   prompt-building pass address the real message. Tags, walk-backs and the script cache keep
   their upstream behaviour there.
2. **W2c-c**, after W2c-b, delivers `MC-111` and `MC-112` with its own plan and gates, starting
   from a complete inventory of every parse that builds the prompt.

---

### MC-115 — Escape on alerts, stage 2: a notice shows over a prompt and the prompt comes back; prompts go in turn; shortcuts wait while a prompt is up; a returning prompt ignores a double-press; duplicate plugin permission requests share one prompt

- **Tag:** decision
- **Date:** 2026-09-29
- **Sweep ref:** none (stated directly this session)
- **Source:** after an investigation into prompts covered by another alert (ledger row 375), the
  maintainer chose the recommended option on three questions the Orchestrator asked, and on two
  more after Gate 1 round 1 (Report 41; ledger row 376). This is `MC-109` 3's second stage.
- **Reasoning:**
  - A prompt covered by any other alert, or closed by code that clears alerts, takes whatever
    answer ends the store's current alert. Enter on a notice answers "yes", so it can grant a
    hidden permission prompt or confirm a hidden delete. A toast or an OK answers `''`, which is
    not a safe cancel (`MC-109`).
  - Background sources raise prompts with no user action: plugin and MCP permission requests, the
    save loop's other-tab prompt, Lua and triggers. A full-storage save failure toasts again every
    few seconds.
  - Default shortcuts run while a prompt is up, so a double-pressed remove opens two delete
    confirms that one answer resolves.
  - Holding notices behind a prompt would let one unanswerable prompt block every later error, and
    Escape no longer dismisses prompts (`MC-109` 1).
  - A prompt that comes back, or the next one in turn, appears where the user just pressed or
    clicked. A fast second press would answer a prompt the user has not seen.
  - A plugin can request one permission several times at once. Today one dialog answers them all.
    Taking prompts in turn would repeat the same dialog.
- **Alternatives rejected:**
  - hold notices, errors, toasts and loading overlays until the prompt is answered;
  - show a newer prompt over the open one;
  - let shortcuts run while a prompt is up;
  - cancel a covered prompt at once with an empty answer;
  - guard a returning prompt against key auto-repeat only, accepting a double-press;
  - show each of several identical plugin permission requests in turn.
- **Amends:** none. Upstream behaviour changes: a prompt no longer takes another alert's answer.
- **Related:** MC-011, MC-108, MC-109.

**What was decided:**
1. **A notice, error, toast or loading overlay that arrives while a prompt is waiting shows at
   once.** When it closes, the prompt comes back, with anything typed into it kept. A prompt only
   takes its own answer.
2. **A second prompt waits its turn.** It shows after the open prompt is answered, and each prompt
   takes only its own answer. The terms prompt and the stale-account notice still go ahead of
   other prompts.
3. **Keyboard shortcuts do nothing while a prompt is waiting for an answer.** This covers every
   configurable shortcut, including those that open an alert or click a chat button. Escape and
   Enter on the alert itself keep `MC-109`'s behaviour.
4. **For about 0.4 s after a prompt comes back, or the next prompt in turn appears, a click or
   key that would answer it is ignored.** Typing into it is not. A prompt that opens fresh answers
   at once, as today.
5. **Identical permission requests from one plugin that are in flight together share one prompt
   and its answer.**

*Amended by `MC-161` (2026-10-02): item 3's "Enter on the alert itself keeps `MC-109`'s behaviour" no longer holds
for Enter (`MC-161` 2), item 3's shortcut rule is extended from waiting prompts to notices, spinners and progress
bars (`MC-161` Orchestrator call 11, put to the maintainer as overrulable), and item 4's "A prompt that opens fresh
answers at once, as today" no longer holds: every prompt pauses for 0.4 s (`MC-161` 5).*

---

### MC-116 — W2c-b: the send's persona block is gated on the chat's own persona

- **Tag:** decision
- **Date:** 2026-09-29
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on a question the Orchestrator asked
  after W2c-b's inventory (ledger row 382).
- **Reasoning:** the send adds the persona block only when `db.personaPrompt`, the selected
  persona's prompt, is non-empty, but the block's content is the persona bound to the chat. So a
  chat bound to a persona with a prompt sends none while the selected persona's prompt is empty,
  and a chat bound to a persona with an empty prompt sends an empty block (in a template, the
  persona card's bare format). Upstream has the same check (`upstream/main`, `ca1345fc`).
- **Alternatives rejected:** keep upstream's check and bind only the content (a chore).
- **Related:** MC-110, MC-011.

**What was decided:**
1. **The send adds the persona block when the persona of the send's own chat has a prompt:** the
   bound persona's, or the selected persona's when the chat has none bound. A chat with no bound
   persona sends what it does upstream.

---

### MC-117 — A chat bound to the selected persona reads the persona as it is being edited

- **Tag:** decision
- **Date:** 2026-09-29
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on a question the Orchestrator asked
  after W2c-b's Gate 1 round 1 (Report 42; ledger row 384).
- **Reasoning:** the selected persona is edited in a buffer (`db.username`, `db.userIcon`,
  `db.personaPrompt`, `db.userNote`) that is copied into its saved entry only when Persona
  settings switches, reorders or deletes a persona, or sets a new avatar. A chat bound to that persona reads the saved entry, so edits do not
  reach it until then. Under `MC-116`, clearing that persona's prompt would also keep sending the
  old saved text. Upstream reads the saved entry too.
- **Alternatives rejected:** keep the saved copy, and record the staleness as a chore.
- **Extends:** `MC-116`.
- **Related:** MC-116.

**What was decided:**
1. **A chat bound to the currently selected persona reads that persona's live values** (prompt,
   name, icon and note, as Persona settings shows them now), in the send and on screen. A chat
   bound to any other persona, and a chat with no bound persona, read what they read before.

---

### MC-118 — W2c-c: a message's own tags, the history tags and the lore scan follow `MC-111` and `MC-112`

- **Tag:** decision
- **Date:** 2026-09-29
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on three questions the Orchestrator asked
  after W2c-c's inventory of the parses that build the prompt (ledger row 393).
- **Reasoning:** the inventory found three places, not named by `MC-111` or `MC-112`, where a wrong
  index or hidden text reaches the prompt. Upstream is the same in all three.
  - When a send starts, every message's own tags are expanded at index -1 and the result is saved
    into the chat. This is the only place `{{setvar}}`, `{{addvar}}` and `{{setdefaultvar}}` run.
  - The chat-history tags return disabled and pre-reset messages. Every branched chat ends with a
    disabled "branched from" comment, which `{{lastmessage}}` returns until a new message is added.
  - The lorebook's keyword scan reads disabled messages, so hidden text can activate lore entries.
- **Alternatives rejected:**
  - the send-start expansion: leave hidden messages unexpanded (their `{{setvar}}` not run) until
    they are sent; or keep upstream's -1 and open a chore;
  - the history tags: make `{{lastmessageid}}` and the chat-length tags count sent messages too; or
    keep upstream and open a chore;
  - the lore scan: keep upstream and open a chore.
- **Extends:** `MC-111`, `MC-112`.
- **Related:** MC-111, MC-112, MC-113.

**What was decided:**
1. **When a send starts, each message's own tags are expanded at that message's own position**, and
   their look-backs skip hidden messages (`MC-111` 2, `MC-112` 2). Disabled and pre-reset messages
   are still expanded, and their `{{setvar}}`, `{{addvar}}` and `{{setdefaultvar}}` still run, as
   upstream. The result is still saved into the chat.
2. **While the prompt is built, the text-returning history tags skip hidden messages:**
   `{{history}}`, `{{userhistory}}`, `{{charhistory}}`, `{{lastmessage}}` and
   `{{previouschatlog::n}}`, with their aliases. `{{previouschatlog::n}}` returns nothing for a
   hidden message, and `{{history}}` includes the first message only if it was sent.
   `{{lastmessageid}}` and the chat-length tags keep upstream's counts.
3. **The lorebook's keyword scan, and its scan depth, consider only messages sent to the model.**
   The decorators that count turns (`activate_only_after`, `activate_only_every`) keep counting the
   whole chat.

**Orchestrator defaults stated to the maintainer with these questions, not objected to (not
decided):**
- the token-count copy of every prompt parse follows the copy that is sent;
- `{{messageidleduration}}` keeps its "no user message found" strings; it has no first-message
  fallback for `MC-112` 2 to apply;
- side requests are out of scope: the memory summarizers, the image-prompt (`igp`) request and a
  trigger's LLM call;
- the first message keeps index -1;
- Lua `getChat*` and the trigger `v2Get*` functions keep reading the whole chat, since cards do
  their own arithmetic on those positions.

---

### MC-119 — The memory-footprint work comes after W2e, and CHORE-45 waits for it

- **Tag:** decision
- **Date:** 2026-09-29
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, on W2c-c's plan (Report 43) leaving CHORE-45 out: "we are currently
  theorizing potential memory savings on Q&A sessions. after W2e, I think we should focus on these
  memory footprint before deciding on chore-45."
- **Reasoning:** a fix for CHORE-45 needs a cache sizing decision, and the heap measurement (ledger
  row 383) shows memory is the scarce resource. The memory savings being worked out in the Q&A
  session may change what the cache can afford.
- **Alternatives rejected:** none offered; stated unprompted.
- **Related:** MC-113.

**What was decided:**
1. **After W2e, the next focus is the application's memory footprint**, from the savings being
   worked out in the Q&A session.
2. **CHORE-45 is decided after that work**, not in W2c-c.

---

### MC-120 — W2c-c: a trigger's system-prompt text follows `MC-112`; other trigger and Lua parses do not

- **Tag:** decision
- **Date:** 2026-09-29
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on a question the Orchestrator asked after
  W2c-c's Gate 1 round 1 (Report 43; ledger row 394), which found that Report 43 rev 1 left every
  trigger and Lua parse reading the whole chat while `MC-112` 3 covers every parse that builds the
  prompt.
- **Reasoning:** the start trigger's system-prompt effects add their parsed text to the prompt, so a
  walk-back or history tag in them can still put a hidden message there. Other trigger and Lua
  parses feed variables and logic the card's author controls, as the Lua and trigger chat functions
  do (`MC-118`'s defaults).
- **Alternatives rejected:** every parse in the send's start trigger and `editRequest` Lua skips
  hidden messages, including values written to variables; none does (a known gap).
- **Extends:** `MC-112` 3, `MC-118`.
- **Related:** MC-111, MC-112, MC-113, MC-118.

**What was decided:**
1. **When the send's start trigger runs, the text of its system-prompt effects (`systemprompt`,
   `v2SystemPrompt`) is parsed under the prompt rule:** walk-backs and history tags skip hidden
   messages.
2. **Every other trigger parse, and Lua's `cbs()`, keep reading the whole chat.**

---

### MC-121 — W2d: a trigger run's model calls follow the run's origin

- **Tag:** decision
- **Date:** 2026-09-29
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on a question the Orchestrator asked
  after W2d's scoping (ledger row 404), which found that five trigger and Lua model calls already
  run under a trigger run's own origin, and that a send's own start and output triggers can contain
  them.
- **Reasoning:** leaving them on the selection would leave part of one send unbound: its start or
  output trigger's model call would run the selected character's `request` trigger and use the
  selected chat's tools, such as graph memory.
- **Alternatives rejected:** keep them on the selection (`MC-103`'s default as first stated).
- **Amends:** `MC-103`'s default that callers other than the send's own requests keep following the
  selection, for trigger-run model calls only.
- **Related:** MC-078, MC-095, MC-103, MC-110.

**What was decided:**
1. **A model call made by a trigger run** (the v2 `runLLM` effects and Lua's `LLM`, `simpleLLM`
   and `axLLM`) runs the `request` trigger and uses the tools of the run's own chat, not the
   selection's. In a chat whose id has two holders the run's own reads and writes keep `MC-078`.
2. **The translator, the Playground, Suggestion and the other callers with no origin** keep
   following the selection.

---

### MC-122 — Three request-layer bugs found during W2d-a are fixed in W2d-b

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose "Fold into W2d-b" on a question the Orchestrator asked when
  W2d-a was ready to commit (Report 44 section 6; ledger rows 405, 409, 413).
- **Reasoning:** none stated beyond the choice; W2d-b edits the same request files.
- **Alternatives rejected:** a Roadmap chore for each (the Orchestrator's recommendation); only
  noting them in Report 44.
- **Related:** MC-091, MC-103, MC-121.

**What was decided:** W2d-b fixes, with tests:
1. the image-prompt block in `sendChatBody` appends the request's result object (`data += rq`)
   instead of its text;
2. `stringlizeAINChat` (NovelList) has a stray unary `+` that appends `NaN` and drops the
   character's name label;
3. with `fallbackModels` set for a mode, the attempts are the list's entries only and the primary
   model is never tried. Whether that is intended is not established; W2d-b's scoping checks
   upstream and the settings text first, and a product question goes to the maintainer.

---

### MC-123 — Fallback models: the selected model is tried first, then the list

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose "Main first, then list" on a question the Orchestrator asked
  during W2d-b's scoping (ledger row 417; scratchpad `w2d/packet-b.md` Q-3).
- **Reasoning:** none stated beyond the choice. The Orchestrator's case: the settings section is
  named "Fallback Model", and "Fallback When Blank Response" advances to the next model.
- **Alternatives rejected:** keep upstream's behaviour (the list replaces the selected model) and
  add a help text.
- **Related:** MC-011, MC-122.

**What was decided:** when a mode has a fallback list, a request tries the model selected for that
mode first, then each list entry in order. With no list, only the selected model is tried, as
today. Upstream tries the list only; an upstream user who filled the list as their real choice
will see the selected model tried first. This fork accepts that difference.

**Also decided (same day, "Move on like any model"):** a failed plugin-provider attempt (after its
retries) moves on to the next model, as any other failed attempt does. Upstream ends the request
there, whichever position the plugin model holds; with the selected model tried first, a plugin
model as the main choice would otherwise never reach the list. Rejected: keep upstream's stop.

---

### MC-124 — W2d-b fixes Claude's JSON-schema extraction

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose "Fold into W2d-b" on a question the Orchestrator asked during
  W2d-b's scoping (ledger row 417; packet RP-4).
- **Reasoning:** none stated beyond the choice; W2d-b edits the same extraction code.
- **Alternatives rejected:** a Roadmap chore.
- **Related:** MC-091, MC-122.

**What was decided:** on Claude models, extraction with a JSON schema uses the extraction path, as
every other provider does; today it is handed the schema text and the reply comes back empty
(upstream has the same bug). W2d-b fixes it, with a red test.

---

### MC-125 — An MCP tool server outlives a character switch by a few minutes of idleness

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose "A few minutes" on a question the Orchestrator asked during
  W2d-b's scoping (ledger row 417; packet Q-1, "Design D").
- **Reasoning:** none stated beyond the choice. The Orchestrator's case: a request bound to its own
  chat may still be calling a server after the user switches character, and switching back and
  forth should not respawn local tool processes.
- **Alternatives rejected:** hold a server exactly while a request uses it and shut it down at once
  (release hooks in every streaming tool loop; switching back respawns local processes).
- **Related:** MC-095, MC-103, MC-121.

**What was decided:** an MCP client is not shut down while a call to it is in flight, nor while it
was used within the last few minutes; after that, the next tool activity shuts down any client the
current selection and the current request do not use. A local (`stdio:`) tool process may linger
that long after its character is left.

---

### MC-126 — W3: `/` commands, `/multisend` and Post File act on their own chat; a cancel stops a pipe at its next command

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on six questions the Orchestrator asked
  after W3's scoping (ledger row 429; packet `w3/packet.md` in that session's scratchpad).
- **Reasoning:** the recommended options, as offered:
  - a trigger run's other effects and model calls already act on its own chat (`MC-075` 1,
    `MC-121`); its command line was the part left on the selection;
  - a pipe that goes on posting after its text went back repeats its posts on the next Send;
  - a button that posts without replies while a send is starting never takes the flag from it
    (`MC-106` 2 already does this while a send is running);
  - a bound `/multisend` behaves like a send when the user leaves (`MC-103` 3);
  - Post File already captures its draft key where it was clicked;
  - a stopped pipe writes nothing elsewhere (`MC-075` 2).
- **Alternatives rejected:**
  - a cancel: also interrupt a step already running (`/speak`, `/trigger`, a prompt); leave the pipe
    running after the text goes back;
  - trigger-run `/` commands: stay on the selection;
  - trigger buttons: refused while a send is starting or running; keep the disclosed contention;
  - `/multisend` after the user leaves: stop at the next segment;
  - Post File: the chat on screen when the file dialog closes;
  - a gone chat mid-pipe: skip the writing commands and continue; stop with an alert.
- **Settles:** `MC-103`'s deferred question on trigger-run `/` commands, and `MC-098` 2's binding of
  Post File.
- **Related:** MC-075, MC-078, MC-098, MC-099, MC-103, MC-104, MC-105, MC-106, MC-121, MC-127.

**What was decided:**
1. **A cancel stops a `/` pipe before its next command** and before the next `/multisend` segment.
   A step already running finishes first. This applies to the composer's pipe and to the pipes of
   a send's triggers. A trigger button's pipe has no cancel, as before.
2. **A trigger run's `/` commands act on the run's own chat**, like its other effects. A button's
   pipe acts on the chat whose button was pressed.
3. **Trigger buttons stay usable while a send is starting or running.** A button's `/multisend`
   treats a send that is starting as running: it posts its segments without replies.
4. **A `/multisend` keeps going in its own chat when the user leaves it**, posting and answering
   the remaining segments there.
5. **Post File belongs to the chat where it was clicked.** Every entry and reply stays there. If
   that chat is gone mid-job, the job stops and still downloads what it has built.
6. **When a pipe's chat is gone mid-pipe, the pipe stops silently** at its next command. A chat
   whose id has two holders follows the rule of the work the pipe runs in: the composer's pipe
   writes to the chat it started from (`MC-104` 1); a trigger run already stops (`MC-078`).

---

### MC-127 — W3 fixes the `/` command bugs it found; `loadInternalBackup` during work goes to W2e

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose all four recommended fixes, and the recommended placement, on
  two questions the Orchestrator asked after W3's scoping (ledger row 429).
- **Reasoning:** W3 rewrites these lines anyway. All the bugs are identical upstream.
- **Alternatives rejected:** leaving the bugs as upstream has them; guarding `loadInternalBackup`
  in W3, or not at all.
- **Not proposed:** the command parser turns any argument containing `=` into a named argument.
  Changing it could break existing presets, so it stays.
- **Related:** MC-075, MC-103, MC-126.

**What was decided:**
1. **`/cut` and `/del` delete what they name.** `/cut N` removes message N, `/cut a-b` removes
   that range, and `/del N` removes the last N messages. Today each keeps what it names and drops
   the rest.
2. **No crash or `NaN`:** `/getvar` on an unset variable, `/addvar` on an unset variable,
   `/comment` in an empty chat, and `/trigger` in a group chat (which passes `undefined` down the
   pipe).
3. **`/trigger` gets the 10-deep recursion bound** that the `runtrigger` effect already has.
4. **Post File's parser:** a `#. Note =` line loses its prefix, and the job is no longer cut off
   after about 100 lines.
5. **`loadInternalBackup` while work is in flight** is handled in W2e, whose complete registration
   provides the "anything in flight" check.

---

### MC-128 — A cancelled `/` pipe that has already written leaves the composer empty

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on a question the Orchestrator asked after
  W3's Gate 1 round 1 (ledger row 432, finding B4).
- **Reasoning:** the recommended option, as offered:
  - With the text back, a resend replays what the pipe already wrote: `/send x` posts twice, `/cut 0`
    cuts a different message, and `/addvar` adds twice.
  - `MC-107` 1 already keeps the composer empty once a `/multisend` has posted.
- **Alternatives rejected:**
  - only visible message writes count, so variable writes replay;
  - only `/multisend` counts, with the replay disclosed.
- **Extends:** `MC-107` 1, from `/multisend` segments to every write of the pipe.
- **Related:** MC-099, MC-107, MC-126.

**What was decided:** when the busy button cancels a composer take during its `/` stage, the
command text goes back only if the take's own pipe has not yet written anything.
- Once any of its commands has written, the composer is left empty and what was written stays. The
  commands that write are `/send`, `/sendas`, `/comment`, `/cut`, `/del`, `/setvar`, `/addvar` and
  a `/multisend` segment.
- A pipe still in its first non-writing step, for example `/speak`, gets its text back.
- Writes by anything else, such as a trigger button or another chat, never count.

**Amendment (2026-09-30, after W3's Gate 1 round 3, ledger row 436):** the maintainer chose the
recommended option on two questions.
1. **`/trigger` and `/test_lorebook` also count as writes.** They count from their start, whether or
   not they then change anything. A resend would re-run the trigger, whose effects can write, and
   the lore scan writes lore flags. Rejected: only `/trigger` counts; neither counts.
2. **A command line that has written and then fails** (an unknown command, `/setinput`) has its
   text handled: it is neither posted as a message nor put back. `/send x|/nosuchcommand` posts only
   `x`. Upstream also posts the raw command text and generates a reply. Rejected: keep upstream's
   behaviour. With no earlier write, an unknown command still sends its text as a message.

---

### MC-129 — W2e: a confirmed delete stops all work in the chat; trash counts; a group member's delete does not warn; a backup load is refused while busy

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on four questions the Orchestrator asked
  after W2e's scoping (ledger row 444).
- **Reasoning:** the recommended options, as offered:
  - a chat the user deletes should have nothing left running in it;
  - trash is how most deletes happen, and `MC-103`'s default already puts the warning on it;
  - deleting a group member deletes no chat, so nothing is lost, and `MC-103` 4 already skips a gone
    member;
  - refusing is the only option under which no work can straddle a restore.
- **Alternatives rejected:**
  - a confirmed delete aborts only the reply, and other work drops its writes;
  - trash warns but stops nothing; trash makes the character gone to the resolver;
  - deleting a member of a busy group warns and stops the group;
  - a backup load asks, stops all work, then restores.
- **Settles:** `MC-127` 5 (`loadInternalBackup` during work).
- **Related:** MC-075, MC-078, MC-103, MC-126, MC-127.

**What was decided:**
1. **Confirming the delete of a chat, or of its character, while work is running in it stops all
   the work bound to that chat:** the reply being generated, auto mode, a `/` command line,
   `/multisend` and Post File. A step that cannot be interrupted (a trigger-button run's current
   step) finishes, and any write it makes to a gone chat drops silently (`MC-075` 2).
2. **Trash behaves the same as a permanent delete:** the same warning, and the work stops. A trashed
   character is not treated as gone; a later restore brings it back as it was when the work
   stopped, including a partly streamed reply.
3. **Deleting a character that is a member of a group whose turn is being generated shows no
   warning.** The group chat is not deleted. The current turn finishes, and later turns skip the
   removed member (`MC-103` 4).
4. **Restoring a backup while work is in progress is refused** with a message saying work is in
   progress and to wait or stop it first. This covers the internal backup list and loading a `.bin`
   file.

**Amendment (2026-09-30, after W2e's Gate 1 round 1, ledger row 446):** the maintainer chose the
recommended option on one question. **A stop ends a trigger's remaining effects**, for a confirmed
delete and for the busy button alike: the effect already running finishes, and no later effect of
that run, or of a run it started, begins. For the busy button this is new: it used to let a send's
start, input or output trigger run its remaining effects before the send gave up. Rejected: only a
delete stops them (a second stop signal); neither stops them (a trash then keeps receiving a
trigger's later messages and model calls). Extends `MC-126` 1 from a trigger's `/` command lines to
all of its effects.

---

### MC-130 — Memory footprint: stop the boot walk and store each chat separately; the full chat stays readable; upstream compatibility means an upstream-readable `.bin` backup

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering four questions the Orchestrator asked about the optimization
  Q&A session's memory-footprint brief (options only; the maintainer had approved none of them).
- **Reasoning:**
  - both changes are wanted in the first stage;
  - plugins expect to read every message of a chat;
  - users move from upstream, and back, by `.bin` local backup (`MC-080`); the internal layout does
    not need to match upstream's for that.
- **Alternatives rejected:**
  - only the boot walk first;
  - older messages of the open chat hidden from the prompt, memory, Lua, triggers or plugins;
  - every internal storage structure identical to upstream's.
- **Extends:** `MC-119`.
- **Related:** MC-005, MC-006, MC-025, MC-080, MC-081.

**What was decided:**
1. **The memory-footprint work covers two changes:** loading the database no longer walks the whole
   of it at boot, and each chat is stored as its own unit, loaded when it is opened.
2. **A limit on how many messages of the open chat are held applies to the display only.** The
   prompt, memory, Lua, triggers and plugins keep access to every message in the chat, because the
   plugin API expects it.
3. **Upstream compatibility for storage means an option to create a local `.bin` backup that
   upstream can restore**, alongside restoring upstream's backups. The fork's own internal storage
   format need not match upstream's.
4. **When creating a `.bin` backup would need more memory than the device has, a warning is enough
   for now.** Streaming or chunking the `.bin` creation is to be looked into.

---

### MC-131 — The maintainer's real local backup is about 36 GB; synthetic images use NovelAI's 832x1216

- **Tag:** stated
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, while asking for the synthetic save generator to add avatars, character
  assets and module assets: "my real save data (in .bin) is around 36gb. so I think that can be a
  good baseline for this"; and, on image sizes, that much community art is generated with NovelAI,
  so its standard 832x1216 ("Normal Portrait") is the baseline size.
- **Related:** MC-006, MC-119, MC-130.

**What was stated:**
1. **The maintainer's own local backup `.bin` is about 36 GB.** How it splits between the database
   and assets was not stated. Synthetic profiles are calibrated to that total; real data is not used
   in measurements.
2. **832x1216 is the baseline size for synthetic avatars and character assets.** The mix: about 60%
   of characters have only an avatar, 30% have 5-30 images and 10% have 50-200; about 5% of avatars
   are animated. Modules with assets are an optional part of a profile.
3. **The maintainer runs the Tauri desktop build on PC, and does not use the self-hosted Node
   server because of its 100 MB limit** ("I am not using self-hosted version just for that 100mb
   limit I am using tauri for PC"), said after the Orchestrator reported that the server's
   `express.raw` limit is 100 MB while the client sends `database.bin` in one request (ledger row
   456).
4. **The maintainer's runtime `database.bin` (Tauri) is about 155 MB,** checked by the maintainer
   on 2026-09-30. So nearly all of the 36 GB backup is assets.
5. **The 100 MB limit is well known among long-time self-hosting users.** They are usually told to
   export and delete unused characters from RisuAI regularly, and to keep chats and characters
   elsewhere. Filed as `CHORE-46`.
6. **Real module mix: a few big asset modules, and a majority of light modules** that hold only
   lorebooks or scripts. A real asset module can hold **5,000+ WebP images** (consistent with
   `MC-009`'s 1-2 GB). Said when the generator's 36 GB calibration needed about 60 images per
   character at 500 characters; the maintainer's profile puts more of the bytes in modules.
   Asked how the 36 GB splits (ledger row 462 needed 26 modules of 2,000-10,000 images), the
   maintainer added: **a few modules are extremely big; as they recall, 3-5 of their modules hold
   near or over 20,000 images each.**

---

### MC-132 — Per-chat storage: V3 plugins load on demand; chats stay loaded while a V2.1 plugin is enabled; snapshots restore chats fully

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on three questions the Orchestrator asked
  after the consumer-side investigation (ledger row 457) found that plugins can read and write back
  every chat of every character, and the persistence-side one (row 456) found that the internal
  snapshots would stop covering chat content once chats leave the main file.
- **Reasoning:**
  - V3 host calls are already awaited, so loading costs no API change;
  - V2.1 reads through a synchronous live object and cannot wait for a load;
  - a snapshot is a recovery point, so it must bring back the chats as they were.
- **Alternatives rejected:**
  - V3 whole-character and whole-database calls returning labelled placeholders for chats that are
    not open;
  - V2.1 seeing labelled placeholders; ending V2.1 support;
  - snapshots restoring only the main file, with chats at their latest version; fewer snapshots.
- **Extends:** `MC-130`.
- **Related:** MC-033, MC-036.

**What was decided:**
1. **A V3 plugin call that returns chats returns them loaded**, with full messages, loading them if
   needed. The API does not change. A call such as `getDatabase('all')` may briefly load every chat.
2. **While any V2.1 plugin is enabled, every chat stays loaded**, as today.
3. **Every internal snapshot still restores chat content exactly.** Chat versions a kept snapshot
   refers to are kept.

---

### MC-133 — Memory footprint stage 1 extends cold storage and leaves the boot pass alone; `CHORE-47` is fixed first, on its own

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on two questions the Orchestrator asked
  after `senior-advisor`'s direction (ledger row 459) and the generator's format check (row 458).
  The maintainer also said that other forks (HaejeokRisu, PocketRisu) feed ideas and are not code
  to port, as was their own plan.
- **Reasoning:**
  - with a loaded chat inline in the main file and a closed one a pointer, memory and file always
    agree, so no second store, per-chat dirty signal or encoder change is needed;
  - the boot pass shrinks with what is in the file, and keeping it keeps repaired chat ids stable
    across boots; whether a rewrite is still worth it is measured afterwards;
  - `CHORE-47` loses user assets at restore, and the fix is small.
- **Alternatives rejected:**
  - rewrite the boot pass in stage 1 as well;
  - fix `CHORE-47` inside the backup stage.
- **Amends:** `MC-130` 1.
- **Related:** MC-069, MC-080, MC-119, MC-132.

**What was decided:**
1. **Stage 1 turns cold storage into the per-chat store.** A chat is archived to its own unit when
   it is no longer open, and loaded when it is opened. Open chats stay inside the main save file.
2. **The boot pass (`RisuSaveEncoder.init` and the full-reload sites) is not rewritten in stage 1.**
   It is measured on the smaller file afterwards and rewritten only if still costly.
3. **`CHORE-47` (a local backup skips every non-`.png` asset) is fixed now, as its own change,**
   before the memory stages.

---

### MC-134 — Stage 1 archiving: its own rule beside the old toggle, all at first boot, manual cleanup only, chats over about 16 KB

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on four questions the Orchestrator asked
  after the stage 1 scoping investigation (ledger row 469).
- **Reasoning:**
  - upstream's `coldstorage` toggle defaults to off on first load for anyone with a plugin
    installed, so tying the new archiving to it would leave many heavy users without it;
  - the profile that runs out of memory today is the one that needs the whole first pass before
    the app opens;
  - automatic cleanup adds snapshot scanning and multi-tab cases to a stage that is already large;
  - on synthetic data shaped like the maintainer's profile, the main file is about 13 MB at a 4 KB
    threshold, 16 MB at 16 KB and 26 MB at 64 KB (row 468), so 16 KB keeps nearly all the saving
    while small chats stay inline.
- **Alternatives rejected:**
  - one toggle for both kinds of archiving, whether kept as it is or reset to on once;
  - archiving a bounded amount at boot and finishing during use;
  - automatic cleanup of unused chat units in stage 1;
  - archiving every closed chat; archiving only chats over about 64 KB.
- **Extends:** `MC-132`, `MC-133`.
- **Related:** MC-005.

**What was decided:**
1. **Archiving closed chats follows its own rule, not the `coldstorage` toggle.** Closed chats are
   archived unless a V2.1 plugin is enabled (`MC-132` 2). The existing toggle keeps controlling only
   the 10-day archiving of whole characters.
2. **The first boot after updating archives every eligible closed chat before the app opens,** with a
   progress screen.
3. **Unused chat units are removed only by the existing manual clean-up button in stage 1,** which
   must first be made safe for the units that kept snapshots still refer to. Automatic clean-up is
   for a later stage.
4. **A closed chat is archived when it is larger than about 16 KB.** Smaller chats stay in the main
   file.

Item 1 is superseded by MC-136 2 and MC-142; item 4 now applies to the later per-chat step (MC-136 1).

---

### MC-135 — The maintainer's real save is character-heavy; chats are kept short because long chats crash Chrome

- **Tag:** stated
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:**
  - the maintainer ran read-only scripts on a copy of their own `database.bin` (Tauri PC, upstream
    build) and passed on the sizes and counts (ledger row 470);
  - the maintainer answered a question about their chat usage.
- **Related:** MC-131, MC-134.

**What the maintainer stated:**
1. **Their save is character-heavy, not chat-heavy.** The `database.bin` is 155.8 MB:
   - 499 characters, but only 770 chats with 2,307 messages;
   - character lorebooks are about 56.5 MB of it, and character asset lists about 16.9 MB;
   - modules are 32.0 MB (164 modules; 116 of them are not in `enabledModules`,
     `moduleIntergration`, any `character.modules` or any `chat.modules`, and persona-embedded
     modules were not checked);
   - there are 14 plugins, all API 3.0; none is an enabled V2/V2.1 plugin.
2. **Chats are short by necessity, not by preference:** "I am having performance issue when
   browsing my character list or scrolling through long chat (chrome straight up crashes if chat
   gets long enough), so I kinda have to keep chats short."
3. **Long chats are common across the community, so chat archiving stays in scope:** "while I only
   have short chats, long chats that goes up to size of megabytes are common among the community. so
   archiving chats should still be considered, not taken off the table entirely."
4. **Their chats are nearly all message text, and the messages are long** (from a read-only script
   the maintainer ran, ledger row 477). Messages are 93.6% of the chat bytes, HypaV2 memory is unused
   and the other memory fields are small. The median message is 5.4 KB, and no chat is over 62
   messages or 488 KB.

---

### MC-136 — Stage 1 archives whole characters when they are not open; the cold-storage toggle becomes an opt-out; `getDatabase('all')` returns placeholders; the retainer gets an in-app fix first

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on four questions. The Orchestrator asked
  them after `senior-advisor` re-directed stage 1 (ledger row 472), once the maintainer's real
  profile had shown the save is character-heavy (row 470, MC-135).
- **Reasoning:**
  - chats are about 12% of the maintainer's file, so archiving chats alone cannot bring such a
    profile under the Node server's 100 MB limit;
  - the character is already the save format's, the change tracker's and cold storage's unit, and
    upstream already reads and restores the character stub form;
  - long chats of characters that are not open archive together with their character (MC-135 3);
  - loading every character on each `getDatabase('all')` call would hold the whole profile in
    memory each time;
  - the in-app fix is reviewable in the tree, and a dependency patch has to be re-checked on every
    Svelte upgrade.
- **Alternatives rejected:**
  - per-chat archiving first, as planned under MC-134;
  - both grains in stage 1;
  - removing the toggle entirely;
  - `getDatabase('all')` returning every character fully loaded;
  - patching Svelte now; never patching dependencies.
- **Amends:** `MC-133` 1 (the per-chat store becomes the second step), `MC-134` 1 (the toggle).
- **Extends:** `MC-132` 1.
- **Related:** MC-130, MC-134, MC-135.

**What was decided:**
1. **Stage 1 archives a whole character, with its chats, when it is not open,** using the existing
   cold-storage character form. Archiving single chats inside the open character comes later, after
   the long-chat display work. `MC-134` 2 (all at the first boot, with progress) and 3 (manual
   clean-up only) apply to characters. `MC-134` 4 (about 16 KB) applies to the later per-chat step.
2. **The `coldstorage` toggle becomes an opt-out that is on by default.** The 10-day idle rule goes.
3. **A V3 `getDatabase('all')` call returns archived characters as placeholders, as upstream does.**
   Calls for one character (`getCharacterFromIndex`, `getChar`) return it fully loaded.
4. **The memory held by the chat screen after a switch is fixed in the app first.** A pnpm patch to
   Svelte is considered only if a measurement shows other screens still hold memory.

Item 2 is amended by MC-142 (the opt-out is a new setting; the `coldstorage` field is left untouched).

---

### MC-137 — Character archiving: a saved OFF is reset once with a notice; startup asset clean-up keeps working; opting out keeps existing archives; reuse of unchanged archives comes later

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:**
  - the maintainer chose the recommended option on three questions the Orchestrator asked after
    the character-grain scoping (ledger row 473);
  - on the fourth question, the maintainer answered "add existence check implementation on later
    stage." The Orchestrator read this as accepting the orphans in stage 1, and the maintainer
    confirmed that reading.
- **Reasoning:**
  - upstream saved `coldstorage: false` automatically for anyone with a plugin at first launch, so a
    saved OFF is usually not a choice;
  - while cold storage is on, startup skips the unused-asset clean-up (`bootstrap.ts`, the same
    upstream), so turning archiving on for everyone would silently stop that clean-up;
  - restoring every archive when a user opts out would bring memory back to today's level;
  - reusing an unchanged archive needs a check that its unit still exists, which is safer to design
    after stage 1.
- **Alternatives rejected:**
  - honouring a saved OFF;
  - accepting that startup asset clean-up stops;
  - restoring every archived character on opt-out;
  - reuse of unchanged archives in stage 1.
- **Extends:** `MC-136` 2, `MC-134` 3.
- **Related:** MC-005.

**What was decided:**
1. **The first boot after the update switches a saved `coldstorage: false` to on once,** with a notice
   saying so and where to turn it off. After that, the user's setting is honoured.
2. **Startup's unused-asset clean-up keeps working when archiving is on.** Archived characters are
   read one at a time to collect the assets they use. The clean-up deletes nothing if any archive
   cannot be read.
3. **Turning archiving off keeps existing archives.** They load when opened, as upstream does. Nothing
   new is archived.
4. **Stage 1 accepts one orphaned unit for each open-and-leave of a character,** until a manual
   clean-up. Putting back an unchanged character's old unit, after checking that the unit still
   exists, is for a later stage.

Item 1 is replaced by MC-142; item 2 is reversed by MC-139 3; item 4 is amended by MC-140.

---

### MC-138 — Character archiving: the two-device Node case is accepted and documented; an unreadable archive pausing asset clean-up is shown with a notice

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on two questions the Orchestrator asked
  after Gate 1 round 1 of the character-grain plan (`memfoot/stage1c/gate1/review-r1.md`, B4, NB6,
  NB7).
- **Reasoning:**
  - archiving runs only when the app is open in a single tab, which closes the multi-tab cases on one
    machine;
  - two devices active at once on one Node server is rare, and the existing conflict prompt handles
    it;
  - a silent pause of the clean-up would leave assets piling up with no way for the user to find the
    cause.
- **Alternatives rejected:**
  - skipping boot-time archiving on the Node server;
  - pausing the clean-up silently.
- **Extends:** `MC-137` 2.

**What was decided:**
1. **On a Node server used from two devices at once, the second device's boot may archive the
   character open on the first.** The first device then gets the existing "another device saved"
   conflict prompt. This is accepted and documented for users.
2. **When startup asset clean-up is paused because an archived character cannot be read,** the user
   sees a notice naming that character, once per boot.

*Extended by `MC-158` 4: where item 1 is documented (the README's self-hosted server section, and a hand-off to the
Wiki session).*

*Premise of item 1 corrected by `MC-159` 3 (2026-10-02): the "existing conflict prompt" reaches only tabs of the same
browser. A second device or browser gets a toast, and its tab stops saving until it is reloaded. The decision to accept
and document the case stands; `MC-159` 1 adds a ticket for gentler recovery (CHORE-62).*

---

### MC-139 — Characters must also be released during a session; the maintainer browses hundreds of characters per session; asset clean-up moves into the manual clean-up; the plugin-storage migration is retired

- **Tag:** decision (1, 3, 4) and stated (2)
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer answered four questions the Orchestrator asked after `senior-advisor`
  recommended archiving only at startup (ledger row 475, `memfoot/advisor-3.md`):
  - on startup-only archiving, the maintainer chose "No, need release while running" over the
    recommended option;
  - on usage, "Hundreds, browse a lot";
  - on asset clean-up and the migration, the recommended option.
- **Reasoning:**
  - a user who browses hundreds of characters in one session would load most of the profile back
    into memory if an opened character stayed loaded until restart;
  - a startup asset sweep that runs while the app is in use kept failing review, and the manual
    clean-up already reads every archive;
  - the migration's only effect is to hide legacy plugin storage from V2/V2.1 plugins; profiles
    with plugins never ran it.
- **Alternatives rejected:**
  - archiving only at startup, with opened characters kept loaded until restart;
  - keeping the asset sweep at startup, before the app opens;
  - keeping the migration but skipping it when V2/V2.1 plugins are installed.
- **Amends:** `MC-137` 2.
- **Related:** MC-135, MC-136, MC-137.

**What was decided / stated:**
1. **Stage 1 must also release characters during a session,** not only archive at startup.
2. **The maintainer browses hundreds of characters in one session** (fact).
3. **Unused-asset clean-up moves into the manual clean-up,** as one exclusive pass over all archives.
   Startup runs no asset clean-up once characters are archived.
4. **The plugin-storage migration into cold storage is retired.** Legacy inline plugin storage stays
   in the main file.

---

### MC-140 — Characters opened during a session are released by an automatic reload at idle moments

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option when the Orchestrator asked how to satisfy
  `MC-139` 1, after `senior-advisor` found that archiving a character at runtime swaps an object
  that other code may still hold (ledger row 475).
- **Reasoning:**
  - archiving at startup is safe, because no other code holds a character yet;
  - reloading reuses that startup pass, so releasing characters during a session adds no new
    archiving mechanism;
  - a runtime engine that archives on leave needs every holder of a character across a wait to
    register itself, and that approach failed review three times.
- **Alternatives rejected:**
  - a runtime engine that archives a character when the user leaves it;
  - the idle reload now and a runtime engine later.
- **Implements:** `MC-139` 1.
- **Amends:** `MC-136` 1 ("when it is not open" becomes "at startup, and again at each idle
  reload"); `MC-137` 4 (orphans arise per character opened between reloads, not per visit).
- **Related:** MC-135, MC-138.

**What was decided:**
1. **Characters are archived only by the startup pass,** under exclusive access from reading the main
   file to committing it. Once opened, a character stays loaded until the next reload.
2. **When the characters opened during a session add up past a threshold, and nothing is in
   progress, the app saves and reloads itself,** reopening the same character and chat. "Nothing in
   progress" means no reply generating, no prompt, picker or unsent draft. The threshold is
   non-normative, about 50 MB.

---

### MC-141 — The idle reload is automatic but conservative; clean-up on a shared Node server accepts a short window, with a warning

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on two questions the Orchestrator asked
  after Gate 1 of plan r3 (`memfoot/stage1c/gate1r3/review-r1.md`, B1 and B2).
- **Reasoning:**
  - a reload discards whatever is in memory and not yet saved, so the reload fires only when the user
    has been idle long enough that nothing can be in progress;
  - the Node window lasts only a few seconds, during another device's startup, and the dialog tells
    the user not to run the clean-up while another device is using the server.
- **Alternatives rejected:**
  - asking before every reload;
  - a banner plus a later automatic reload;
  - never deleting archive files newer than a day.
- **Extends:** `MC-140` 2, `MC-138` 1.

**What was decided:**
1. **The idle reload fires by itself only when all of these hold:**
   - the user has not interacted for a while (non-normative: about 2 minutes);
   - the window has focus;
   - nothing has changed since the final save;
   - nothing is running.
2. **Clean-up on a Node server shared by two devices accepts a short window.** If the other device has
   just archived a character and has not yet saved, the clean-up may delete that archive. The
   clean-up dialog warns not to run it while another device is using the server.

---

### MC-142 — The opt-out is a new setting that is on when absent; the one-time reset of `coldstorage` is dropped

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option when the Orchestrator asked, after Gate 1
  (`memfoot/stage1c/gate1/review-r2.md`, R2-B4) showed that a "reset once" marker can undo a user's
  own first opt-out, and `senior-advisor` proposed a three-state key (`memfoot/advisor-3.md`).
- **Reasoning:**
  - a new key's three states (absent, true, false) encode "once" with nothing beside it: absent means
    on with a one-time notice, and any later `false` is the user's choice;
  - upstream's encoder and decoder copy unknown root keys, so the key survives a round trip;
  - upstream's own `coldstorage` field stays exactly as upstream wrote it.
- **Alternatives rejected:** resetting `coldstorage` once, with a marker written on the first boot.
- **Amends:** `MC-137` 1, `MC-136` 2.
- **Related:** MC-136 2, MC-137 3.

**What was decided:**
1. **Character archiving is controlled by a new root setting.** When the setting is absent, it is on,
   with a one-time notice; any later off is honoured. The upstream `coldstorage` field is left
   untouched, and its 10-day archiving is retired.

---

### MC-143 — Plain-HTTP users mostly run the Node server over a LAN IP or VPN; V3 not seeing legacy plugin storage is accepted; module archiving comes right after stage 1

- **Tag:** decision (2, 3) and stated (1)
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer answered three questions the Orchestrator asked after `doc-verifier`
  checked Report 49 (ledger row 484).
- **Reasoning:**
  - the answer to 1 decides whether the Node server runs in a secure context, and so whether Web
    Locks exist there (Report 49, D1);
  - on 2: nothing that works today stops working, and the maintainer's own plugin storage is
    0.08 MB;
  - on 3: modules are about 32 of the estimated 41-46 MB the main file keeps after stage 1.
- **Alternatives rejected:**
  - keeping the migration for V3;
  - widening stage 1 to include modules;
  - keeping modules after the backup, display and per-chat work.
- **Extends:** `MC-002`, `MC-139` 4.

**What was decided / stated:**
1. **"Local plain HTTP" users mostly run the Node server and open it over a LAN IP or a VPN,** in the
   maintainer's words: "most uses node server via LAN IP or VPN. not sure about static builds but
   pretty sure there are some of them."
2. **Retiring the plugin-storage migration is accepted, knowing the consequence:** V3 plugins, which
   read only `_coldplugin`, keep not seeing legacy inline plugin storage on profiles where the
   migration never ran.
3. **Archiving modules that are not enabled comes right after stage 1,** ahead of the backup and
   per-chat work.

Note: on this code the Node server does not boot over plain HTTP (ledger row 485). From source,
such deployments should have worked on upstream up to `v2026.2.291` (traced, not run). See MC-144.
Item 3 is amended by MC-145 (the inline backup comes before module archiving).

---

### MC-144 — Restore support for the Node server over plain HTTP, as its own ticket

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option after the Orchestrator reported ledger row
  485: the self-hosted Node server opened over plain HTTP from a LAN IP does not boot on this code,
  or on upstream since `v2026.3.330` (upstream `61996dd2`, JWT auth that needs `crypto.subtle`).
- **Reasoning:**
  - the maintainer reports that plain-HTTP users mostly run the Node server over a LAN IP or VPN
    (`MC-143` 1);
  - a user migrating from an older upstream install would hit a boot error;
  - the fix is separate from the memory stages, which stay safe on hosts without Web Locks.
- **Alternatives rejected:**
  - supporting only HTTPS or localhost, with documentation;
  - deferring the decision.
- **Related:** MC-002, MC-011, MC-143, CHORE-49.

**What was decided:**
1. **The fork restores the Node server's ability to boot and save when opened over plain HTTP,** as
   a Roadmap item (CHORE-49), gated and reviewed like any other change. Memory stage 1 does not wait
   for it.

---

### MC-145 — After stage 1: the upstream-compatible inline backup first, then module archiving

- **Tag:** decision
- **Date:** 2026-09-30
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option after `doc-verifier` (ledger row 486)
  noted that `MC-143` 3 put modules ahead of the backup work. Upstream has no archived-module
  form, so a backup taken with archived modules restores on upstream only if it writes everything
  inline.
- **Reasoning:** `MC-130` requires an upstream-restorable `.bin` backup option; module archiving
  without that option would break it. Upstream's restore expects no module units: it skips them,
  gives no warning, and brings the module back as an empty stub. Its manual clean-up would later
  delete those units as unused (`upstream/main` `coldstorageData.ts` and `backuplocal.ts`; checked by
  `doc-verifier`, ledger row 486).
- **Alternatives rejected:** archiving modules first, accepting that backups restore only on this fork
  until the inline option lands.
- **Amends:** `MC-143` 3.
- **Related:** MC-130, MC-135.

**What was decided:**
1. **After stage 1, the upstream-compatible "inline everything" backup option comes first** (a part of
   stage 2), **then archiving of modules that are not enabled,** then the rest of stage 2.

### MC-146 — Stage 1 step 3: an unreadable archive fails the plugin or MCP call with one alert; a group opens without an unreadable member; the Playground restores its archived character; only V2.1 plugins trigger restore-all

- **Tag:** decision
- **Date:** 2026-10-01
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on four questions from the step 3
  investigation (ledger row 504).
- **Reasoning:** the plan (Report 49, D4, D8, D16, D19) left open what happens when an archive
  cannot be read, and whether an enabled V2.0 plugin counts. At HEAD `96772e97` only a V2.1 plugin
  runs code; a V2.0 plugin logs that it is no longer supported and does nothing
  (`loadV2Plugin`, `plugins.svelte.ts`), and importing either version is refused.
- **Alternatives rejected:** a plugin read on an unreadable archive returning null; errors to the
  caller with no alert; refusing to open a group with an unreadable member; discarding an archived
  `§playground` character and creating a blank one; keeping V2.0 in the restore-all trigger.
- **Clarifies:** `MC-132` 2, which already names V2.1 only. Report 49 (3.2, D16) had read it as
  V2/V2.1; decision 4 settles that V2.0 is excluded.
- **Related:** MC-132, MC-136, MC-138, MC-143.

**What was decided:**
1. **A plugin or MCP call that reaches an archived character whose archive is missing or
   unreadable fails.** This covers V3 `getCharacterFromIndex`, `getChatFromIndex` and
   `setChatToIndex`, and the MCP read and write tools. The caller gets an error; an MCP write does not
   report success. The user gets one alert naming the character. Nothing is written into the
   placeholder.
2. **A group opens even when one member's archive cannot be restored.** That member stays archived,
   gets no greeting in a new chat, is skipped in turns, and an alert names it.
3. **An archived `§playground` character is restored when the Playground chat opens,** so its chats
   are kept. If the restore fails, the user is alerted and the Playground chat does not open. It is
   never archived again (D19).
4. **Only an enabled V2.1 plugin restores every archived character** at runtime and keeps characters
   from being archived at boot: until step 5, through a guard on the 10-day path (`MC-091` amendment
   A2, Report 52); from step 5, in the new boot pass. An enabled V2.0 plugin does neither.

---

### MC-147 — Stage 1 step 4: plugin storage is backed up and restored whatever its shape; an absent error-text archive does not warn

- **Tag:** decision
- **Date:** 2026-10-01
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on two questions the Orchestrator asked
  after the step 4 investigation (Report 49, D13) (items 1 and 2); later the same day, after Gate 2,
  the maintainer approved two calls the Orchestrator had made and reported in chat: "changes looks
  like a good call to me; approved." (items 3 and 4).
- **Reasoning:**
  - a local backup carries a V3 plugin storage value only when it is an array or an object holding a
    `message` or `character` key (and is not falsy), so other values (an ordinary object, a string,
    a number, `null`, `false`) are lost at restore, and each one raises the incomplete-backup prompt
    on every backup; upstream behaves the same; the fix sits in the same collection and shape check
    that step 4 already changes;
  - a chat showing the "could not be loaded" error text (`MC-016`) can refer to an archive that no
    longer exists; when it is absent on the device, the backup loses nothing by leaving it out.
- **Alternatives rejected:** a separate ticket for plugin storage; listing every absent error-text
  archive in the incomplete-backup prompt.
- **Extends:** Report 49 D13 (`MC-136`). The naming in item 2 follows the same rule as the startup
  clean-up notice of `MC-138` 2.
- **Related:** MC-016, MC-130, MC-138.

**What was decided:**
1. **Step 4 includes V3 plugin storage.** A fork backup carries every plugin storage value, whatever
   its shape, and a fork restore puts it back. An upstream build restoring such a backup skips the
   values that are not arrays or `message`/`character` objects, as it would miss them today.
2. **When the backup follows a chat's error-text key and that archive is absent on the device, it
   leaves it out without a prompt.** An archive that exists but cannot be read is reported in the
   incomplete-backup prompt, naming the character, as other archives are.
3. **An error-text archive that exists but is not a chat or character is reported too,** in the same
   prompt and naming the character. Only an absent one is left out silently, because only then does
   the backup lose nothing.
4. **The backup follows references inside archived chats as well as inside archived characters.**
   Report 49 D13 names only blobs (character archives): "each blob's inner pointer keys and legacy
   error keys from the value it reads"; following every value the backup reads, chat archives
   included, is its intent.

---

### MC-148 — The boot pass enriches upstream-made stubs once; the stub keeps its own trash state

- **Tag:** decision
- **Date:** 2026-10-01
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer answered the Orchestrator's question on Report 51 section 6 item 1 (P1);
  after the first answer the Orchestrator gave the pros and cons. The Orchestrator recommended keeping the stub's own trash state because
  of the 3-day purge of trashed characters at startup (`checkNewFormat` in `bootstrap.ts`). The
  maintainer's first answer, verbatim: "I think it should add those, but I'd like to know the pros and
  con of this change." The second answer, after the pros and cons: "Agreed. let's add the type, group
  members, last-used time, description and chat count, but keep the placeholder's own trash state."
- **Reasoning** (the Orchestrator's pros and cons, which the maintainer agreed to):
  - users who arrive from upstream hold v1 stubs, which show groups as characters, sort without a
    last-used time, and show no description and a chat count of 1;
  - a unit can carry an old `trashTime` that the stub lacks, and the startup purge deletes
    characters that have been in the trash for more than 3 days.
- **Alternatives rejected:**
  - not enriching (stubs that are never opened stay wrong forever);
  - copying the unit's trash state.
- **Related:** Report 51 (P1, R5), Report 49 (D6, D7), MC-011.

**What was decided:**
1. **The boot pass adds the following to every upstream-made (v1) stub:** the real type, the group
   member list, the last-used time, the description and the chat count.
2. **The stub keeps its own trash state.** The unit's `trashTime` is not copied.

Implied by 1, not stated by the maintainer: each stub is enriched once, marked so that a later boot
does not repeat it; and a missing or unreadable unit, or a `chaId` mismatch, leaves the stub unchanged.

*Extended by `MC-158` 3: the enrichment also runs when `archiveCharacters` is false.*

---

### MC-149 — Stage 1 step 5: four answers after the scoping investigation

- **Tag:** decision
- **Date:** 2026-10-01
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on four questions the Orchestrator asked
  after the step 5 scoping investigation (ledger row 522).
- **Reasoning:**
  - item 2: the root `coldstorage` field still gates the whole startup clean-up after the checkbox is
    rebound (`bootstrap.ts`, the check in the startup clean-up; ledger row 522, premise 8), so the
    field's fate had to be decided;
  - item 4: upstream archived trashed characters into stubs without `trashTime`, and the startup purge
    deletes trash older than 3 days; the restore rule that step 2 set (Report 51) leaves the unit's old
    `trashTime` on such a stub, which the scoping traced as a data-loss chain (ledger row 522). The fix
    flips three guard tests that pinned the old rule;
  - item 1 (the reason the Orchestrator's question gave; the maintainer gave none): a pass commit on a
    fallback boot would rewrite the damaged main save with backup-derived data before the user has
    touched anything;
  - item 3 (likewise): a notice shown only when something was archived would leave users with nothing
    eligible untold until they later find characters archived; the old help text describes the
    retired 10-day archiving.
- **Alternatives rejected** (the other options the Orchestrator offered on each question):
  - item 1: "Run as normal", archiving on a recovery boot too;
  - item 2: "Retire it" (startup clean-up runs for every profile) and "Follow the new setting"
    (archiving on means no startup clean-up);
  - item 3: "Only if something archived" and "Once; keep the old label";
  - item 4: "Keep upstream's behaviour" (the character stays recoverable from its archive until a
    manual clean-up, or from a snapshot).
- **Amends:** by item 4, the restore trash rule that step 2 set (Report 51, P4), and Report 49 D7's
  sentence that an upstream-made stub restores unchanged.
- **Extends:** `MC-142`, by item 3.
- **Related:** MC-139 3 (item 2), MC-142, MC-148, Report 51.

**What was decided:**
1. **Fallback boots.** When the main save cannot be read and the boot falls back to an automatic
   backup copy, the boot pass does not run. Nothing is archived or committed by the pass on that boot.
2. **The upstream `coldstorage` field keeps gating startup clean-up as upstream left it.** There is no
   UI for it after the checkbox is rebound. A profile's existing value is kept. Asset clean-up for those
   profiles is the manual clean-up's job (`MC-139` 3).
3. **The one-time notice shows once,** on the first boot where the new key (`MC-142`) is absent,
   whether or not anything was archived. The checkbox label is renamed (non-normative: "Archive
   characters at startup"), with new help text in all seven languages. Whether the notice shows on a
   boot where the pass does not run is an implementation call for the step 5 report.
4. **The trash fix is made in step 5.** At restore, the stub's trash state wins for every stub: a
   stub with no `trashTime` restores as not trashed. This differs from upstream. The reason is the
   upstream behaviour above: it archived trashed characters into stubs without `trashTime`, and the
   startup purge deletes trash older than 3 days.

The Orchestrator made further implementation calls for step 5. They are recorded in the step 5 report
and are not maintainer decisions.

---

### MC-150 — Community reports of characters lost when deleting from the trash; "deleted" means permanently deleted; CHORE-53 is scheduled right after step 5

- **Tag:** stated (1-3) and decision (4)
- **Date:** 2026-10-01
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer relayed community reports and answered the Orchestrator's question on where
  the ticket belongs in the work order. The Orchestrator had investigated first (ledger row 523).
- **Reasoning:**
  - the reports describe upstream builds (`MC-011`): there is no fork userbase;
  - the Orchestrator's reason for recommending the position (the maintainer gave none): it is the most
    user-visible open data loss, and it does not touch the save or archive code that step 5 and
    CHORE-51 work in.
- **Alternatives rejected** (the other positions the Orchestrator offered):
  - before finishing step 5 (pause after step 5a);
  - after CHORE-51 and CHORE-52.
- **Extends:** `MC-013`, by item 3.
- **Related:** MC-011, MC-013, MC-103, MC-129, ledger row 523, CHORE-03, CHORE-53.

**What was decided / stated:**
1. **The community reports.** The maintainer relayed these, in Korean:
   1. "휴지통 비우고 쓰던 봇 찾아가려는데 리스트에 검색해도 안 나와서 찾아보니까 휴지통 비울 때 왜인지는 모르겠는데 같이 삭제됐음"
   2. "휴지통에서 봇 지울때 엔터 누르면 휴지통 밖에 있는 봇들도 지워지는 것 같음. 폴더 내부에 있는 봇은 안전하다는데 난 폴더 내부 봇도 몇개 날아간 것 같음"
   3. (reply) "엔터 꾹 누르면 날아감. 로어북 지울때도 그럼"
   4. (reply) "로어북 삭제 버그는 밑에 것만 지우는데, 휴지통 버그는 휴지통 밖에 있는것도 지움."

   The Orchestrator's translation, which is not the maintainer's: (1) "I emptied the trash and went to
   find a bot I'd been using, but searching the list didn't find it; it had been deleted along with the
   trash, no idea why." (2) "When deleting bots in the trash, pressing Enter seems to delete bots
   outside the trash too. People say bots inside folders are safe, but I think a few inside folders got
   wiped too." (3) "Hold Enter down and they get wiped. Same when deleting lorebooks." (4) "The lorebook
   delete bug only deletes the ones below; the trash bug deletes ones outside the trash too."
2. **The reports are of upstream builds,** and the maintainer said: "this issue has been reported on
   upstream, so it might have been already fixed in our fork, though." (`MC-011`: user-reported
   symptoms are observations of upstream builds.)
3. **"Deleted" means permanently deleted.** The maintainer: "deleted means deleted - report says that
   its permanently gone." This is the community instability behind CHORE-03 (`MC-013`); the maintainer:
   "yes, this is the main reason why I brought up CHORE-3."
4. **CHORE-53 goes right after memory stage 1 step 5,** before CHORE-51 and CHORE-52. The maintainer:
   "I agree that CHORE-53 should go right after step 5."

The investigation is ledger row 523; the findings are filed as CHORE-53.

---

### MC-151 — Two relayed upstream bug reports on edits and reroll; three QOL ideas; CHORE-43 and CHORE-54 go right after CHORE-53, CHORE-55 with CHORE-51 and CHORE-52; QOL-04 stale, QOL-08 and QOL-09 ideas, a native fast local import, CHORE-57 low priority, CHORE-58 last

- **Tag:** stated (1-2, 4-6) and decision (3, 7-8)
- **Date:** 2026-10-01
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer relayed two bug reports, which they headed "Possibley unconfirmed bug on
  upstream" (their spelling), and three QOL ideas, then answered two placement questions the
  Orchestrator asked after the investigation (ledger row 528; CHORE-55 came from step 5b's Gate 2,
  round 1). Later the same day they stated items 4-5 (the addendum), and items 6-8 (the second
  addendum: the fast-import investigation, ledger row 532, and the placement of CHORE-57 and
  CHORE-58).
- **Reasoning:**
  - the reports describe upstream builds (`MC-011`): there is no fork userbase, and the maintainer
    marked them possibly unconfirmed;
  - the maintainer gave no reason for either placement.
- **Alternatives rejected** (the other options the Orchestrator offered):
  - for CHORE-43 and CHORE-54: after CHORE-51 and CHORE-52; after steps 6 and 7;
  - for CHORE-55: right after CHORE-53; after steps 6 and 7.
- **Related:** MC-011, MC-013, MC-100, MC-133, MC-150, CHORE-43, CHORE-54, CHORE-55, CHORE-57, CHORE-58,
  ledger rows 528 and 532, Maybe-Later QOL-04 to QOL-09.

**What was stated / decided:**
1. **The two relayed bug reports,** verbatim:
   1. "Edits made on LLM's output reverts back to original when user returns to the message after
      either switching the chat or rerolls the message."
   2. "reroll isn't bount to specific chat - rerolling on one chat and tapping 'previous message' on
      another chat loads previous message from previous chat"

   These are reports, not reproductions. The investigation (ledger row 528) matched report 2 to CHORE-43
   (`MC-100` 2 filed it; its scope sentence "on desktop" is not edited here) and filed report 1 as
   CHORE-54. For the findings, see the Roadmap's CHORE-43 amendment and CHORE-54.
2. **Three QOL ideas, recorded as ideas, not decisions.** Nothing here is approved, scheduled or
   estimated. They are entries in `Agents/Maybe-Later.md`:
   1. "you can export character, prompt preset, modules, etc. but you can't export the plugin." (QOL-05)
   2. "\"empty all\" button in trash menu with confirmation prompt" (QOL-06)
   3. "more animations: like last messages being scrollable sideways when either swipe reroll is on or
      there is multiple reroll candidates, and side bar that also accepts gesture control, such as
      sliding right from the edge of screen opening sidebar, and tapping the edge of sidebar and
      sliding it to the left closing it with animation following the tap." (QOL-07)
3. **Placement in the work order.** The maintainer chose the recommended option on two questions:
   1. "Where should the two reroll data-loss bugs go in the work order?" Answer: "Right after CHORE-53
      (Recommended)". The maintainer placed both right after CHORE-53. The Orchestrator's recommendation
      (CHORE-54) is to fix them in one change.
   2. "Where should CHORE-55 go?" Answer: "With CHORE-51/52 (Recommended)", in the same stretch, before
      steps 6 and 7. CHORE-55.

   The work order is now: memory stage 1 step 5; then CHORE-53; then CHORE-43 with CHORE-54; then CHORE-51,
   CHORE-52 and CHORE-55; then steps 6 and 7.

**Addendum (2026-10-01, later the same day; stated, not decided).** The maintainer then stated the
following, verbatim. They are two ideas and a correction to a record, not decisions: nothing here is
approved, scheduled or estimated.
4. **QOL-04 is stale.** "I think QOL-04 in maybe-later.md is now stale, as account/sync that should not
   be made more backed up more aggressively is now removed from this fork." The account sync it names
   was removed by CHORE-33 and Drive by CHORE-36 (`MC-080`, `MC-092`). `MC-025` and `MC-026` quote
   QOL-04's earlier text and stay as dated records: `MC-025` of what this fork's maintainer said on
   2026-09-21, `MC-026` of upstream's maintainer's objection, dated only "on or before 2026-09-21".
   QOL-04 was rewritten for the current fork.
5. **Two more ideas,** then a placement:
   1. "also, I think a path to 'update and replace' the existing card/module would be nice to have.
      currently when creators posts update to their bot, users have to manually backup chat, delete the
      old characters and modules, re-import new module/character, then restore their chats." (QOL-08)
   2. "I think we could also have \"archive this character\" button with dedicated format that exports
      both character and chats in single file." (QOL-09)
   3. "all fits into the maybe later stage. I believe." Both new ideas are entries in
      `Agents/Maybe-Later.md`, with the same status as QOL-05 to QOL-07.

**Addendum 2 (2026-10-01, later again; stated 6, decided 7 and 8).** The maintainer asked for a faster
local-file character import and then placed two tickets from the investigation of it (ledger row 532).
6. **A faster local-file character import, built natively; Lightning Realm Import.** The maintainer, in
   one message of three paragraphs, verbatim:
   1. "about realm: upstream does provide faster realm import under the name of 'lightning realm import' as
      experimental setting. I think we can bring it back if it is removed as it is official feature."
   2. "people already made the plugin to speed up the character import from the local file. refer to faster
      character import plugin in `agents/evidences of investigation/community plugin to solve common pain
      points`"
   3. "I think we can implement something similar to this natively - we won't port this plugin directly,
      though. as it was more of an experiment with few reports of data loss or imperfect lorebook/asset
      loading."

   These are ideas, not decisions: nothing is approved, scheduled or estimated, and they are recorded in
   `Agents/Maybe-Later.md` QOL-04. The "do not port the plugin" direction follows `MC-133`'s rule
   about other forks, applied by analogy to community work. The plugin is third-party work in
   the gitignored evidence folder, so the records describe its techniques in their own words and quote none
   of it.

   **Context, from the Orchestrator and not the maintainer's words.** The Orchestrator explained that the
   setting cannot return as it was; see Maybe-Later QOL-04.
7. **CHORE-57 is low priority.** About the chat import that offers `.txt` and has no `.txt` branch, the
   maintainer: "mark txt import bug as low priority for now. most people uses json anyway." CHORE-57 is
   filed and not placed.
8. **CHORE-58 goes last in the current work order.** The maintainer: "add CHORE-58 in the work order - I'll
   take your recommendation about its placement." The Orchestrator recommended, and the maintainer
   accepted, placing it at the end of the current order, after steps 6 and 7, with a measurement on the
   real module or the live app as its first task. The maintainer delegated the placement and gave no
   reasons of their own. The Orchestrator's stated reason: it is import performance, not data loss, and
   everything ahead of it in the order is data loss or memory stage 1, which is in progress. The code
   facts are under Roadmap CHORE-58.

   *Amended by `MC-182` (2026-10-03): CHORE-58 now goes right after CHORE-59, ahead of steps 6 and 7 and CHORE-62. The "last"
   placement and the work-order sentences below, here and in `MC-152`, are kept as written.*

   The work order is now: memory stage 1 step 5; then CHORE-53; then CHORE-43 with CHORE-54; then CHORE-51,
   CHORE-52 and CHORE-55; then steps 6 and 7; then CHORE-58 (measure first).

---

### MC-152 — Load Internal Backup should offer to load the intact data of a partly damaged snapshot; filed as CHORE-59 and placed with CHORE-51, CHORE-52 and CHORE-55

- **Tag:** decision
- **Date:** 2026-10-01
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer answered an open question that the Orchestrator raised at memory stage 1
  step 5b's plan gate (Gate 1 round 2, non-blocking finding N1; ledger row 527). It was recorded as
  Live-State open follow-up 7: Load Internal Backup refuses a snapshot with a damaged or missing block
  as a whole, so should it offer "load without the N affected characters" instead?
- **Reasoning:**
  - the maintainer gave no reason beyond the answer;
  - the question was a product trade-off, which is why it was theirs to decide.
- **Alternative not chosen:** keeping the current whole-snapshot refusal as the only behaviour.
- **Related:** MC-011, MC-089, MC-149, MC-151, Report 49 section 3.3 D3 (the internal backup load writes
  the snapshot and reloads; step 5b, commit `448962f4`), ledger row 527, CHORE-51, CHORE-52, CHORE-55,
  CHORE-59.

**What was decided:**
1. **A partial load is offered.** The maintainer, verbatim: "5b: yes, there should be a option to load
   other data that is intact." When Load Internal Backup finds a snapshot in which some data is damaged
   or missing, it offers to load the data that is intact, instead of only refusing the whole snapshot.

**Not stated by the maintainer.** These are for the item's own plan and gate:
- what counts as "affected" (a character whose block or remote file is missing or undecodable is the
  case the gate raised);
- how the offer is worded;
- whether the partial load is confirmed by the user;
- how the omitted data is reported.

**Placement (the Orchestrator's choice, not the maintainer's).** The Orchestrator filed this as CHORE-59
and placed it with CHORE-51, CHORE-52 and CHORE-55, each its own change with its own gates, because it
is backup and main-file integrity work like CHORE-55, and because the maintainer's own placements leave
no earlier slot without overriding them: CHORE-53 right after step 5 (`MC-150` 4), and CHORE-43 with
CHORE-54 right after CHORE-53 (`MC-151` 3). The code facts are under Roadmap CHORE-59.

The work order is now: memory stage 1 step 5; then CHORE-53; then CHORE-43 with CHORE-54; then CHORE-51,
CHORE-52, CHORE-55 and CHORE-59; then steps 6 and 7; then CHORE-58 (measure first).

*The maintainer's four CHORE-59 answers are `MC-183`; `MC-182` moves CHORE-58 ahead of steps 6 and 7.*

---

### MC-153 — The README is rewritten for this fork: Docker builds from source under its own names, the screenshots are dropped, the changes are a short list, and it says there are no releases yet

- **Tag:** stated (1) and decision (2)
- **Date:** 2026-10-01
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's own message about the README (item 1), then their answers to the follow-up
  questions the Orchestrator asked with AskUserQuestion (item 2). On each question they chose the
  option the Orchestrator recommended, except the release line, which they wrote themselves.
- **Reasoning:**
  - the maintainer's four reasons are in item 1;
  - they gave no reason beyond the answers for the five choices.
- **Alternatives not chosen:** the other options the Orchestrator offered are not recorded in this entry.
- **Related:** MC-011, MC-080, MC-085, MC-087, MC-089, CHORE-49, CHORE-50. `MC-087` 1 keeps in-place upgrades
  supported for an existing upstream profile; item 2 below makes the fork's default Docker compose use its own
  names, so an upstream Docker volume is opened in place only if the user points the compose file at it
  deliberately.

**What was stated:**
1. **Four problems with the README,** verbatim, from the maintainer on 2026-10-01: "outside of code, I
   think readme.md also needs an update. it re-uses the one from the upstream, and it: 1. doesn't mention
   the changes we've made 2. wiki, points to upstream 3. community and installation can be deleted as it
   points to upstream and we do not have neither discord or public facing web hosted version 4.
   prerequisites are probably stale"

**What was decided:**
2. **The README's shape.** The five answers:
   1. `docker-compose.yml` builds this fork from source, instead of pulling upstream's published image.
   2. The fork's Docker setup uses its own project, container and volume names, so an upstream Docker
      install is never opened in place. Data moves between them by a `.bin` backup, as the wiki's
      `Migrating-from-upstream.md` describes.
   3. The screenshots are dropped. They are hotlinked images of upstream's interface.
   4. The README carries a short list of what differs from upstream, with a link to the wiki's migration
      page.
   5. The README discloses that there are no releases yet and that the fork is experimental and heavily
      work in progress. The maintainer wrote this answer, verbatim: "Disclose that we have no releases
      yet. along with the mention that this is still experimental and heavily WIP."

**Not decided.** How the Docker build handles the legal-documents notice (`MC-085`, `MC-086`). The
README carries a visible `TODO(evidence)` for it.
*Answered by `MC-154` and `MC-155`: the Docker build takes the flag as an opt-in build argument, unset by default (`MC-154` 6), and the README's `TODO(evidence)` is gone. The fork's own builds leave it unset until the maintainer's own Terms of Service and Privacy Policy exist (`MC-155`).*

---

### MC-154 — The CI and Docker setup is reworked for the fork, the desktop updater is disabled until the first release, and whether the fork's own builds set the legal flag is open

- **Tag:** stated (1-3) and decision (4-7)
- **Date:** 2026-10-01
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's messages on 2026-10-01 (items 1 to 3), and their answers to the questions the
  Orchestrator asked with AskUserQuestion after the CI survey and the updater investigation (items 4 to 7).
  On each of those questions they chose the option the Orchestrator recommended.
- **Reasoning:**
  - the maintainer's reason for item 1 is in item 1; for items 4 to 7 they gave no reason beyond the answers;
  - the Orchestrator's reasons, from the two investigations (ledger rows 536 and 538): on 2026-09-16 and
    2026-09-18 a push to the `origin/main` mirror ran upstream's `docker-build` workflow, which published
    `ghcr.io/yor42/risuai:<sha>` images of upstream's code under the fork's name, and `nightly-deploy` failed on
    every push because the fork has no Cloudflare secrets (observed with `gh run list`, 2026-10-01); the
    desktop updater's configuration named upstream's release endpoint and upstream's public key, and
    `bootstrap.ts` runs the check on every Tauri boot, so a fork-built desktop app would have offered to
    replace itself with upstream's build (TRACED);
  - `App.svelte` shows the "legal documents not configured" screen unless the build sets
    `VITE_RISU_LEGAL_CONFIGURED`, and the flag is read at build time, so a Docker build needs a way for the
    builder to set it (item 6).
- **Alternatives not chosen:** the other options the Orchestrator offered with each question are not recorded
  in this entry.
- **Related:** MC-011, MC-085, MC-086, MC-087, MC-089, MC-092, MC-153, MC-155, CHORE-35, CHORE-60.

**What was stated:**
1. **The workflows are a copy of upstream's.** The maintainer, verbatim, on 2026-10-01: "I think we should
   dispatch the agent to clean up the workflow and fix `.dockerignore` too. they are literal fork of upstream
   outside of wiki sync and probably needs some heavy rework."
2. **The published images and the orphaned keystore secrets are gone.** The maintainer, verbatim: "docker
   images and keystore has been cleaned." The Orchestrator's reading: the `ghcr.io/yor42/risuai` images of
   upstream's code, and the repository secrets `KEYSTORE_FILE`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` and
   `KEY_PASSWORD`, which no workflow in this repo referenced (ledger row 536). Checked afterwards: `gh secret list
   -R yor42/RisuAI` on 2026-10-01 shows only `TAURI_PRIVATE_KEY` and `TAURI_KEY_PASSWORD`, so the four
   keystore secrets are gone. The images were not checked (`gh` here lacks the `read:packages` permission).
3. **The fork does not process user data, and the upstream terms mostly concern RisuRealm.** On the legal
   setup, the maintainer, verbatim: "legal setup is genuinely tricky question though: according to our plan,
   We do not process any user data. unlike upstream, we do not have public facing web version that goes
   through cloudflare. Terms of service is more for a RisuRealm, but those are meant for upstream, which we
   display prompt that redirects user to upstream ToS and Privacy policy." This is stated, not checked.

**What was decided** (each the recommended option):
4. **Four upstream files are deleted:** `.github/workflows/nightly-deploy.yml`, `.github/FUNDING.yml`,
   `.github/workflows/mod.yml` and `.github/pull_request_template.md`.
5. **`docker-build` runs on a manual dispatch or on a `v*` tag only.** A push to a branch does not build or
   publish an image.
6. **The legal flag is an opt-in build argument, unset by default.** `VITE_RISU_LEGAL_CONFIGURED` reaches a
   Docker build only when whoever builds sets it. With it unset the image keeps the legal-documents notice.
7. **The desktop updater is disabled until the first release.** Before that release, a signing key of the
   fork's own and the fork's release URL are set up. The work is Roadmap CHORE-60.

The rework of `.dockerignore`, the Dockerfile, `docker-compose.yml` and the workflows, and the updater
disable, followed. That work was accepted at its gates (ledger rows 536 to 539) and has since been committed
as `712a76ad` (CI and Docker) and `38583d3b` (the updater). The mechanisms and the findings are in those rows
and in Roadmap CHORE-60, not here.

**Not decided, as of this entry's date: whether the fork's own builds set the flag.** *Answered later the same
day by `MC-155`: the flag stays unset in every build until the maintainer's own Terms of Service and Privacy
Policy exist. The text below is what was open when this entry was written.* The maintainer's
statement in item 3 does not say whether the fork meets what the notice asks. The Orchestrator offered three
ways forward, and the maintainer had not chosen:
- (a) keep it as a per-builder opt-in, as items 5 and 6 leave it;
- (b) ask upstream's author;
- (c) the maintainer decides what compliance requires, and the fork's own builds then set the flag.

The Orchestrator also offered an investigation: list every request the fork sends to upstream's servers and
set it against what the consent prompt covers. Two examples it gave: `src/ts/process/transformers.ts:15` points
the transformers model path at `https://sv.risuai.xyz/transformers/`, and Roadmap CHORE-35 lists the
upstream-infrastructure features. As of this entry's first writing, one build still set the flag: the manual
desktop release workflow passed `VITE_RISU_LEGAL_CONFIGURED: 'TRUE'` (`.github/workflows/github-actions-builder.yml`,
at line 67 in the working tree then), as the survey found upstream's release workflow did (ledger row 536).
Items 5 and 6 are about the Docker build and did not change it. **That is no longer true:** `712a76ad`
changed the release step to read `${{ vars.VITE_RISU_LEGAL_CONFIGURED }}`, an opt-in repository variable that is
empty by default (`MC-155`).

*Superseded in part by `MC-157` (2026-10-01, later the same day): item 6 no longer holds. The flag is on by default in
every build from the repository, and the release workflow passes no value (`a6a27df5`).*

---

### MC-155 — The legal flag stays unset in every build; the maintainer writes their own Terms of Service and Privacy Policy before the fork ships

- **Tag:** stated (1) and decision (2-4)
- **Date:** 2026-10-01
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's messages on 2026-10-01, in answer to the question left open in `MC-154` (the
  first message arrived at about 08:55 UTC, per the fact-check of the records batch; the second followed it).
- **Reasoning:** the maintainer's reason is in item 1: they looked at how other independent forks that ship
  an installable desktop build handle it.
- **Alternatives not chosen:** the three options the Orchestrator offered in `MC-154` (keep it a per-builder
  opt-in, ask upstream's author, or the maintainer decides what compliance requires and the fork's builds
  then set the flag) are not chosen as stated. The maintainer decided a fourth course, in item 2.
- **Related:** MC-085, MC-086, MC-087, MC-089, MC-154, CHORE-60.

**What was stated:**
1. **How other forks handle it, and what the maintainer will do,** verbatim, from the maintainer on
   2026-10-01: "just reviewed how other fork handled the legal flag. leave the legal flag unset for now. Other
   independant forks that ships installable tauri build has simple ToS and privacy policy that says 'this
   software provided as is, you are responsible for your own data, and we do not process your data'. so I'll
   provide similar my own ToS and Privacy policy before this fork ships." This is the maintainer's
   observation of other forks; no agent has checked it.

**What was decided:**
2. **The flag stays unset in every build for now.** The Docker build and both publishing workflows read it as
   an opt-in setting that is empty by default (`docker-build.yml`, `github-actions-builder.yml`, as changed in
   `712a76ad`), so a build keeps the legal-documents notice.
3. **The maintainer writes their own Terms of Service and Privacy Policy before the fork ships, and the flag
   is set after that.** This is a release blocker, listed in Roadmap CHORE-60.
4. **Agents do not edit the template files in the `docs/` folder.** The maintainer, verbatim: "don't touch the
   ToS and Privacy policy file in docs folder yet - these are WIP template."

**Not changed by this entry:** the Realm consent prompt keeps linking upstream's Terms of Service and Privacy
Policy (`src/lib/Others/AlertComp.svelte`), because Realm is upstream's service (`MC-087` 3, `MC-154` 3).

*Extended by `MC-156`: the fork's own documents are linked from Settings, and the maintainer has stated that
the flag is to be set by default after the documents exist. That is not yet a decision; this entry stands until
the maintainer says so. Note on item 3 above: its clause "and the flag is set after that" is not a recorded
maintainer decision. The maintainer's `MC-155` message said only to leave the flag unset and to provide their own
documents before the fork ships; that the flag is then set is a later stated intention (`MC-156` 2).*

*Superseded in part by `MC-157` (2026-10-01, later the same day): item 2 no longer holds. The maintainer's documents
are committed, and the maintainer decided that the flag is on by default in every build from the repository, now.
Item 3's clause "the flag is set after that" is now a recorded decision (`MC-157` 3 and 4). Item 4 stands, as
`MC-157` records.*

---

### MC-156 — The fork's own Terms of Service and Privacy Policy are linked from Settings, separate from the upstream agreement popup; setting the legal flag by default is a stated intention, not yet a decision

- **Tag:** stated (1, 2; item 5 is carried from item 1) and decision (3, 4, 6)
- **Date:** 2026-10-01
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's messages on 2026-10-01 (items 1 and 2, and item 5 carried from item 1), and their
  answers to the questions the Orchestrator asked with AskUserQuestion after the Orchestrator's finding below
  (items 3, 4 and 6). On each of those questions they chose the option the Orchestrator recommended.
- **Reasoning:** the maintainer's reason is in item 1: the two files and their location are final, so links to
  them can be written now. For items 3 to 6 they gave no reason beyond the answers.
- **Alternatives not chosen** (the other options the Orchestrator offered with each question):
  - placement (item 3): a one-time notice at first launch; an accept-to-continue step at first launch;
  - link target (item 4): the documents bundled in the app;
  - visual check (item 6): the maintainer looks themselves; skip the visual check.
- **Related:** MC-086, MC-154, MC-155, CHORE-60.

**What was stated:**
1. **Separate the fork's own documents from upstream's.** The maintainer, verbatim: "while we are at it, I think
   it is worth to separate our tos and Upstream ToS. filename and location of ToS and Privacy policy is
   final(2 files in docs folder) so i think its safe to make links within our own ToS and Privacy policy popup
   to point here instead of upstream. of course, we should preserve the separate popup that appears when user
   tries to access upstream services like realm with upstream eula."
2. **The documents are being written, and the flag follows them.** The maintainer, verbatim: "I am currently
   working on our own ToS and Privacy policy(Which is practically "We do not collect your data. and This
   software is AS-IS. we do not control upstream services, so you would have to agree to upstream ToS
   Separately") so don't be surprised if you see unexpected commit about it. after that I will tell you to set
   the legal flag true by default as by then we would have our own ToS and Privacy policy as upstream rule
   mandates."

**The Orchestrator's finding that preceded the questions (not a decision):** the app had no popup for the fork's
own documents. The only agreement popup was upstream's (`AlertComp` `'tos'`), which links upstream's documents.

**What was decided** (items 3, 4 and 6, each the recommended option):
3. **Settings links only, with no acceptance step.** The fork's two documents are opened from links in Settings;
   nothing asks the user to accept them.
4. **The links open the GitHub pages** `https://github.com/yor42/RisuAI/blob/HEAD/docs/Terms-of-Services.md` and
   `https://github.com/yor42/RisuAI/blob/HEAD/docs/Privacy-Policy.md`. Until the maintainer commits and pushes the
   two documents (`docs/` is untracked), these links show GitHub's not-found page, so the CHORE-60 blocker is not
   met by the links alone.
5. **The upstream agreement popup is unchanged. Carried from item 1, not an answer to a question:** the
   maintainer's own statement in item 1 ("of course, we should preserve the separate popup ..."). The popup keeps
   linking upstream's documents and keeps appearing before upstream services such as Realm.
6. **The visual check is a local dev run with the legal flag set for that run only.** The flag is not changed
   in any committed file or build setting.

**Not decided:** setting the legal flag by default. The maintainer said in item 2 that they will tell the
Orchestrator when; until then `MC-155` stands and the flag stays unset in every build. The documents in `docs/`
are the maintainer's own, which they write and commit themselves (`MC-155` 4).

The Settings links are committed as `696ba5de` (ledger rows 546 to 548). The mechanism is in those rows and in
the commit, not here.

*Decided later the same day by `MC-157`: the maintainer's documents are committed, and the flag is on by default in
every build from the repository. The "Not decided" paragraph above is what was open when this entry was written.*

---

### MC-157 — The legal flag is on by default in every build from the repository, set now; CHORE-35's missing upstream-service prompts become a CHORE-60 release condition

- **Tag:** stated (1, 2) and decision (3, 4, 5)
- **Date:** 2026-10-01
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's messages on 2026-10-01 (items 1 and 2), and their answers to the two questions the
  Orchestrator asked with AskUserQuestion after the first message (items 3 and 4). On both questions they chose
  the option the Orchestrator recommended. Item 5 is the maintainer's own follow-up (item 2).
- **Reasoning:**
  - the maintainer's reason is in item 1: their own Terms of Service and Privacy Policy now exist, which is the
    condition `MC-155` and `MC-156` set for setting the flag;
  - the Orchestrator's reason for item 4, from the option text quoted there: nothing ships before CHORE-35
    closes (`MC-089`), so the missing prompts never reach a release.
- **Alternatives not chosen** (the other option the Orchestrator offered with each question):
  - scope (item 3): "Only your builds", described in the question as: "Nothing in the repo changes. You set the
    GitHub repository variable to TRUE for CI and Docker releases, and put it in your own git-ignored .env for
    local builds. Forks of this fork still see the notice.";
  - timing (item 4): "Wait for CHORE-35", described as: "Keep the flag unset until every upstream touchpoint has
    its prompt."
- **Supersedes:** `MC-155` 2 ("The flag stays unset in every build for now") and the flag clause of `MC-155` 3;
  `MC-154` 6 (the legal flag as an opt-in Docker build argument, unset by default). Closes the "Not decided"
  paragraph of `MC-156`. Unchanged: `MC-156` 3 to 6 (the Settings links, the GitHub-page target, the unchanged
  upstream popup) and `MC-155` 4's rule that agents do not edit the two documents in `docs/`; the maintainer has
  not said that the "yet" in `MC-155` 4 has lapsed.
- **Related:** MC-085, MC-086, MC-087, MC-089, MC-092, MC-154, MC-155, MC-156, CHORE-35, CHORE-60.

**What was stated:**
1. **The documents exist, and the flag may be set.** The maintainer, verbatim, on 2026-10-01: "commit the docs and
   start step 5d. Also, I've added our ToS and Privacy policy, so I think it is safe to set those flags to true
   now." The two documents are in git: `b84ae444` ("add Privacy policy and ToS": `docs/Privacy-Policy.md` and
   `docs/Terms-of-Services.md`, 63 lines added in all, by `git show --stat`), and `8918e309` ("update privacy
   policy") edited the Privacy Policy. This entry did not open them, and nothing here says what they contain.
2. **CHORE-35 is a release condition, not a reason to move it.** After the Orchestrator's reply that CHORE-35 is
   already item 4 of the work order, the maintainer, verbatim: "if chore-35 is already in the work order, no
   further action is needed. just adding it as release condition is enough". Their earlier message, verbatim (it
   arrived mid-turn at about 10:51 UTC, after their two answers and before the Orchestrator's reply): "just so we
   don't forget, add chore-35 to the work order in somewhere approporiate."

**What was decided** (items 3 and 4, each the recommended option; item 5 follows from the maintainer's own message
in item 2, not from a question):
3. **The flag is on by default in every build made from the repository.** The question, verbatim: "Where should
   the legal flag be on by default?" The answer: "Every build from the repo (Recommended)", described in the
   question as: "Committed so dev, pnpm build, the desktop build, Docker and CI all get TRUE with no setup.
   Anyone who forks this fork inherits it too, which upstream's notice asks forks not to do automatically.
   Builders can still opt out." The clause about what upstream's notice asks of forks is the Orchestrator's
   paraphrase, and it goes beyond the notice. What the notice says (`src/lib/Others/Legal.svelte`, the top comment
   and the body, read for this entry): do not automatically set `VITE_RISU_LEGAL_CONFIGURED` to TRUE without
   complying with the requirements it lists, which are the fork's own Terms of Service page and Privacy Policy
   page with the source URLs changed to its own, and the original Terms and Privacy alerts on the parts that use
   Risuai services; it exempts a private self-hosted instance from the original repository and a simple fork for
   development that PRs back. It says nothing about forks of a fork inheriting the flag. This entry did not assess
   whether the first two requirements are met as worded (the fork's own documents are linked from Settings,
   `MC-156`, and the upstream popup is kept, `MC-156` 5); the third is CHORE-35. A builder opts out with an empty
   value (the commit message of `a6a27df5`).
4. **The flag is set now, and CHORE-35's missing prompts become a CHORE-60 release condition.** The question,
   verbatim: "Upstream's notice has a third condition besides your own ToS and Privacy Policy: an agreement
   prompt wherever the app uses upstream's services. Realm has one. The upstream proxy (/proxy2), MCP sign-in via
   account.sionyw.com, the transformers CDN and #import= URLs don't yet; that's CHORE-35, an open ticket that must
   close before release anyway. Set the flag now, or after CHORE-35?" The answer: "Set it now (Recommended)",
   described in the question as: "Nothing ships before CHORE-35 closes (MC-089), so the gap never reaches a
   release. I'll record it as a CHORE-60 release condition." The list of touchpoints without a prompt is the
   Orchestrator's, in the question; Roadmap CHORE-35 holds the traced list and its own "not checked" notes.
5. **CHORE-35 keeps its place in the work order** (Live-State work order item 4, "CHORE-35's opt-in stage",
   `MC-092`), and is added under CHORE-60 as a release condition only (item 2). The Orchestrator had offered to
   move CHORE-35 earlier (at about 10:51:46 UTC); the maintainer's "no further action is needed" answers that
   offer.

The flag change is committed as `a6a27df5` (ledger rows 552 to 554). The mechanism is in those rows and in the
commit, not here.

---

### MC-158 — Step 5d: five answers on the archive pass's failures, upstream placeholders, the two-device note and a crash in the V2.1 restore-all

- **Tag:** decision
- **Date:** 2026-10-01
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on all five questions the Orchestrator asked with
  AskUserQuestion. Items 1 to 4 came after the step 5d investigation (ledger row 551; the packet's open product
  questions). Item 5 was asked later the same session, after the step 5d-2 investigation (ledger row 566).
- **Reasoning:** the maintainer gave no reason beyond the answers. The reasons in each option's text are the
  Orchestrator's, quoted below.
- **Alternatives rejected** (the other options the Orchestrator offered on each question):
  - item 1: "Skip one startup, then retry" and "Pause after the first failure";
  - item 2: "Stop the pass";
  - item 3: "Only when archiving is on";
  - item 4: "Also in the app's help text" and "README only";
  - item 5: "Keep it on, skip the load" and "No protection".
- **Amends:** Report 49 D2, by item 2 (the failed-write clause below), and D18, by item 1 (the "skips one pass"
  count of the breaker) and by item 5 (what protects the V2/V2.1 restore-all).
- **Extends:** `MC-148`, by item 3; `MC-138` 1, by item 4; `MC-132` 2 and `MC-146` 4, by item 5.
- **Related:** MC-011, MC-132, MC-138, MC-146, MC-148, MC-149, Report 49 (D1, D2, D18), Report 51.

**What was decided** (the question, verbatim, then the answer and the option text):
1. **A failed or interrupted pass is retried once, then archiving pauses.** The question: "If archiving at
   startup fails or is interrupted (app killed mid-pass, a sync conflict with another device, a write error),
   what should later startups do?" The answer: "Retry once, then pause (Recommended)": "One failure: the next
   startup tries again. Two in a row: archiving pauses and a notice says so. Turning the setting off and on
   resumes it. A failure that repeats can't pile up orphaned copies." The options not chosen were "Skip one
   startup, then retry": "The plan's original idea. Simpler, but a failure that repeats still leaves a full set
   of orphaned copies every other startup."; and "Pause after the first failure": "Safest against orphans, but
   one transient error (e.g. a conflict with another device) stops archiving until you re-enable it."
   - **Amends D18.** Report 49 D18 names "a crash-loop breaker that skips one pass, with a notice". The answer
     replaces the skip-one-pass count with one retry and then a pause. D18's other sentences are untouched: that a
     409-aborted pass arms the breaker. What protects the V2/V2.1 restore-all is answered by item 5, and what
     counts as a failed pass is for the step 5d-2 plan.
2. **A character whose archived copy cannot be written is skipped, and the pass continues.** The question: "When
   one character's archived copy can't be written (too big for the self-hosted server's 100 MB limit, or storage
   full), what should the pass do?" The answer: "Skip it and continue (Recommended)": "Archive the others. That
   character stays fully loaded. One notice naming it, not repeated every startup." The option not chosen was
   "Stop the pass": "As today: characters after it never get archived, and the 'archiving stopped' notice repeats
   every startup."
   - **Amends D2.** Report 49 D2 reads: "A failed unit write leaves the character inline and stops the pass.
     Characters already archived stay archived." The answer replaces "and stops the pass": a failed write leaves
     that character inline and the pass goes on with the others. D2's rule that a stub is committed only if its
     unit write succeeded first, and that characters already archived stay archived, is unchanged.
   - The Orchestrator's own bound on this answer, that two failures in a row stop the pass for that start, is
     not a maintainer decision; it is recorded as an Orchestrator's call in Live-State.
3. **Upstream placeholders are enriched even when archiving is off.** The question: "Characters archived by
   upstream show as plain placeholders (no group icon, description or chat count). Filling them in reads each
   archived copy once at startup and rewrites the placeholder. Should that also happen when 'archive characters'
   is turned off?" The answer: "Yes, even when off (Recommended)": "It archives nothing new; it only improves
   placeholders that already exist." The option not chosen was "Only when archiving is on": "Turning the setting
   off means startup never rewrites the save for archiving reasons."
   - **Extends `MC-148`,** which is silent on a profile where `archiveCharacters` is false. The enrichment it
     decided (`MC-148` 1 and 2) now also runs for that profile. Implied by the Orchestrator's reading, not stated
     by the maintainer: the existing test that pins "archiving off writes nothing" changes with it.
4. **The two-device note goes in the README and a hand-off to the Wiki session.** The question: "Where should the
   two-device note go? (A second device's startup can archive the character that's open on the first device; the
   first device then gets the existing conflict prompt.)" The answer: "README + wiki hand-off (Recommended)": "A
   line in the README's self-hosted server section, and a hand-off line asking the Wiki session to add it to the
   wiki." The options not chosen were "Also in the app's help text": "Same, plus the setting's help text in all
   seven languages."; and "README only": "Just the README."
   - **Extends `MC-138` 1,** which accepted the two-device case "and documented for users" without saying where.
5. **After two startups in a row fail during the V2.1 plugin restore-all, the V2.1 plugin is switched off.** The
   question (asked later the same session): "An enabled V2.1 plugin needs every character fully in memory, so on
   each startup the app loads every archived character back in before the app opens. If that load crashes or the
   tab is killed partway (for example out of memory), it crashes again on every startup, and the user can't reach
   Settings to turn the plugin off. What should happen after two startups in a row fail during that load?" The
   answer: "Turn the plugin off (Recommended)": "The V2.1 plugin is switched off, with a notice naming it, and the
   app opens. Characters stay archived and load when opened. Turning the plugin back on tries again. Side effect:
   with no V2.1 plugin on, startup archiving resumes for the remaining characters, so the next full load is
   bigger." The options not chosen were "Keep it on, skip the load": "The plugin stays on but sees placeholders
   instead of the archived characters, with a notice. A plugin that edits or replaces a placeholder can damage that
   character's saved data."; and "No protection": "Leave it as it is: a crash during the load repeats on every
   startup until the browser data or plugin is removed by hand. Your own profile has no V2.1 plugin."
   - **Relation to `MC-146` 4 and `MC-132` 2.** `MC-146` 4 carries the restore-all rule: only an enabled V2.1
     plugin restores every archived character at runtime and keeps characters from being archived at boot (it
     also settles that V2.0 is excluded, which Report 49 had read as V2/V2.1). `MC-132` 2 is the earlier rule that
     every chat stays loaded while a V2.1 plugin is enabled. The answer adds an exit to the restore-all rule: after two failed
     startups the plugin is switched off, so the V2.1 condition no longer holds, and the archiving it blocked
     resumes for the remaining characters. The option text states that side effect, and the maintainer accepted it.
   - **Amends D18.** Report 49 D18 says "The breaker also covers the V2/V2.1 restore-all, so a crash inside it does
     not repeat every boot." The answer fixes the protection as switching the plugin off with a notice, not as a
     pause or a skipped load. D18's reading of "V2/V2.1" is narrowed to V2.1 by `MC-146` 4. Whether this shares the
     pass breaker's count or has its own is not decided here.

**Not decided by this entry:** the breaker's threshold counting, where its state lives, how it is re-armed and its
notice text (the step 5d-2 plan); where the restore-all's failed-startup count lives and settles, and the notice
text (the step 5d-2b plan); the wording of the "unavailable" restore text (step 5d-4).

Step 5d is split into sub-steps, and the first (5d-1) is committed as `e8cf50de` (ledger rows 558 to 565). The
mechanisms and the Orchestrator's calls are in those rows, in Live-State and in the commit, not here.

*Item 4's question text carries the premise corrected by `MC-159` 3: it says the first device "gets the existing
conflict prompt". What the first device gets is a toast and a stopped tab (`MC-159` 3). Item 4's answer, where the note
goes, is unchanged.*

---

### MC-159 — Step 5d-4: two devices on a Node server get a plain README note and a ticket for gentler recovery (CHORE-62); a restore that cannot succeed gets its own wording; `MC-138` 1's "conflict prompt" premise was wrong

- **Tag:** decision (1, 2) and corrected (3)
- **Date:** 2026-10-02 (the Orchestrator's and the session notes' dating; the transcript timestamp of the two answers is
  2026-10-01T20:13:06Z, which is 05:13 on 2026-10-02 at UTC+9)
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer chose the recommended option on both questions the Orchestrator asked with
  AskUserQuestion after the step 5d-4 investigation (ledger row 588). The first question (item 1) was asked because
  that investigation found the consequence in item 3 below; the question text already stated it. Item 3 is not a
  maintainer statement: it is the Orchestrator's check of the investigator's finding in source, and it is recorded
  here because two earlier entries rest on the wrong premise.
- **Reasoning:** the maintainer gave no reason beyond the answers. The reasons in each option's text are the
  Orchestrator's, quoted below.
- **Alternatives rejected** (the other options the Orchestrator offered on each question):
  - item 1: "Document only" and "No archiving on Node";
  - item 2: "No-storage case only".
- **Corrects:** the premise of `MC-138` 1 and of `MC-158` 4's question text (item 3).
- **Extends:** `MC-138` 1 and `MC-158` 4, by item 1 (a ticket in addition to the documentation).
- **Related:** MC-011, MC-089, MC-138, MC-158, Report 49 D1, CHORE-62; ledger rows 588 to 597.

**What was decided** (the question, verbatim, then the answer and the option text; the texts are from the session
transcript):
1. **Two devices on a Node server: the README states the real consequence, and a ticket is filed for gentler
   recovery on the first device.** The question: "On a self-hosted Node server, starting the app on device B archives
   characters and saves. If the app is already open on device A, A's next save is refused: A shows a toast and a
   'this tab has stopped saving' message, keeps nothing until it is reloaded, and loses edits made since its last
   save. Earlier notes said A would just get a conflict prompt. How should part 4 handle this?" The answer:
   "Document + ticket (Recommended)": "The README says plainly: opening the app on a second device can stop saving on
   the first; reload the first, and edits there since its last save are lost. Also file a ticket for gentler
   recovery on the first device (e.g. reload and keep its edits), placed later in the work order." The options not
   chosen were "Document only": "The README line states the real consequence; no ticket. The behaviour is accepted
   as is."; and "No archiving on Node": "Startup archiving never runs when the app is served by the Node server.
   Removes the trigger, but Node-served users lose the memory saving."
   - **Extends `MC-138` 1 and `MC-158` 4.** The README bullet and the Wiki session hand-off (Live-State) carry the
     real consequence; the ticket is Roadmap CHORE-62. "placed later in the work order" is in the option text the
     Orchestrator wrote and the maintainer selected; the maintainer added no placement words. The position after steps
     6 and 7 and before CHORE-58 is the Orchestrator's, to confirm.
2. **A restore that cannot succeed gets its own message in both cases, for characters and for chats.** The question:
   "The 'could not be loaded right now, please try again' message shows in two cases where retrying can never help: a
   browser that has no storage for archived characters on this page (plain HTTP, not localhost), and a stored copy
   that is damaged and cannot be decoded. Which cases should get their own message?" The answer: "Both cases
   (Recommended)": "No storage on this page: say it needs HTTPS or localhost and nothing was changed. Damaged copy:
   say it could not be read, nothing was changed or deleted, and retrying will not help. A real read error keeps 'try
   again'. The same split applies to the archived-chat message. About 4-6 new keys across 7 languages." The option
   not chosen was "No-storage case only": "Only the case the original requirement names. A damaged copy keeps saying
   'try again'. 2 new keys across 7 languages."
   - **The wording that was built differs from the option text in three places** (by the Orchestrator's plan, not a
     maintainer decision. While the plan was in Gate 1 the Orchestrator told the maintainer in chat that the no-storage
     text would not suggest HTTPS, because a different address has different storage, and that the damaged text would
     not promise that retrying is pointless; its reason then, a possible half-written file on a Node server, was
     refuted by Gate 1 F6 (the Node server writes by temp file and rename), and the plan now rests on the cause of
     undecodable bytes being unknown. On the key count: the Orchestrator's chat message at transcript line 182314
     (20:28Z) already said "I drafted the English for the eight new messages", and after the fact-check, at line
     182782, it compared 8 explicitly with the option's "about 4-6"):
     - the no-storage text offers no remedy, because opening the page over HTTPS opens a different origin with
       different storage (plan 5d-4, I4; the 5d-4 commit message draft);
     - the damaged text says the copy "may be damaged" and that nothing was changed or deleted, and does not say that
       retrying will not help, because the cause of bytes that cannot be decoded is not known (plan 5d-4, I4, as
       corrected after Gate 1 round 1 F6);
     - 8 new keys in 7 languages were drafted, not "about 4-6" (the interface file; the coder and the translator).

**What was corrected:**
3. **`MC-138` 1 and `MC-158` 4 call the first device's consequence "the existing conflict prompt". That is wrong for a
   second device or browser.** What the first device gets, read in `src/ts/globalApi.svelte.ts` on 2026-10-02
   (the `NodeStorageConflictError` branch of `saveDb`, `:1451-1504`; `globalApi.svelte.ts` is unchanged by the working
   tree): when a save is refused before it commits, a toast says the local data conflicts with a newer version on the
   self-hosted server and that unsynced local changes will be lost on reload; the loop logs the error, sets
   `savingStoppedReason` to `'node-conflict'` and awaits `sleepForever()`, so nothing ends it but a reload. The tab
   prompt that `MC-138` 1 meant rests on `BroadcastChannel('risu-db')` (`:1040-1051` sets `otherTabSaved` when another
   session posts; the post is at `:1376`); a BroadcastChannel reaches only tabs of the same browser, so a second device
   or browser never sends it (the investigator's finding in row 588 and the fact-check of the README bullet, row 594).
   - **Unproven:** that device B's startup archive commit always makes device A's next save fail. That is INFERRED
     from the shared revision check (the 5c commit carries the Node revision); no real Node server was run (Live-State
     lists it as not run).
   - **Not corrected:** `MC-138` 1's decision to accept the case and document it. Item 1 adds a ticket to it.
   - **The 5d-3 commit message repeats the premise.** `3fca470e` says that, on a shared Node save, an enrichment
     commit means "another device with the app open gets the existing conflict prompt on its next save". A commit
     message is not edited here; this entry is the correction.

Step 5d-2a, 5d-2b, 5d-3 and 5d-4 are committed as `29bf2f24`, `4d23b1b4`, `3fca470e` and `e7d7f093` (ledger rows 570
to 596). The 5d-4 commit message cites `MC-159`, so the records commit that carries this entry should follow it at
once. The mechanisms and the Orchestrator's own calls are in those rows, in Live-State and in the commits, not here.

*Item 1's placement, "after steps 6 and 7 and before CHORE-58", was left to confirm. The maintainer approved it
(`MC-160` 1).*

*Amended by `MC-182` (2026-10-03): CHORE-58 now comes right after CHORE-59, before steps 6 and 7 and CHORE-62.*

---

### MC-160 — CHORE-62's placement approved; the message copy button's failures on upstream (Android, Samsung keyboard); copy is plain text by default, and CHORE-63 goes right after CHORE-53

- **Tag:** decision (1, 3) and stated (2)
- **Date:** 2026-10-02 (the Orchestrator's dating; the transcript timestamps are 2026-10-01T23:20Z to 23:47Z, which is
  08:20 to 08:47 on 2026-10-02 at UTC+9)
- **Sweep ref:** none (stated directly this session)
- **Source:** item 1 is the maintainer's own words. Item 2 is the maintainer's report to the Orchestrator this session;
  the CHORE-40 second investigation (ledger row 600) examined it. Item 3 is two answers, both the recommended option,
  to the two questions the Orchestrator asked with AskUserQuestion after that investigation; the texts are from the
  session transcript (lines 182941 and 182950).
- **Reasoning:** the maintainer gave no reason beyond the answers. The reasons in each option's text are the
  Orchestrator's, quoted below.
- **Alternatives rejected** (the other options the Orchestrator offered on each question):
  - item 3, copy format: "Keep the card, make it reliable" and "Drop the card";
  - item 3, placement: "With CHORE-43+54" and "After steps 6 and 7".
- **Extends:** `MC-159` 1, by item 1 (it confirms the placement `MC-159` left to confirm).
- **Related:** MC-011, MC-089, MC-151 3, MC-159, CHORE-40, CHORE-62, CHORE-63; ledger row 600.

**What was decided:**
1. **CHORE-62's placement is approved.** The maintainer wrote: "I approve the chore-62 placement". The placement is
   after steps 6 and 7 and before CHORE-58 (the Orchestrator's position in `MC-159` 1, which the option text the
   maintainer had selected there, "placed later in the work order", did not fix). The Roadmap's CHORE-62 status and
   placement and the Live-State work order now say the maintainer approved it (`MC-160` 1).

   *"Before CHORE-58" is amended by `MC-182` (2026-10-03): CHORE-58 now goes before steps 6 and 7. CHORE-62's own place after
   steps 6 and 7 is unchanged.*

**What was stated** (an observation of an upstream build, `MC-011`; the fork has no separate evidence):
2. **The message copy button behaves inconsistently on upstream's hosted site.** The maintainer reported it on
   risuai.xyz (upstream), in Chrome on Android, on a Samsung Galaxy S22 Ultra and a Galaxy Z Fold 7, with the stock One
   UI Samsung keyboard (not Gboard and not a third-party keyboard). Three behaviours, as reported:
   - (a) sometimes a long message fails to copy, with no stack trace, and Android shows a "failed to copy into
     clipboard" toast;
   - (b) sometimes the message is there, but the persona name is prepended and "From RisuAI" is appended after the
     message content;
   - (c) sometimes the copy works but the text does not properly appear on the clipboard. The maintainer thinks (c) may
     be unrelated to RisuAI.
   - The maintainer also said that capturing real output is difficult because the problem is random: sometimes it
     works fine and sometimes it does not.
   - **A later statement the same day, on (c):** "I think Card also explains the "Copy that 'works' but doesn't land
     properly" issue too - as samsung clipboard does not seem to support images. so copy might only partially work, and
     clipboard fails as card seems to contain images." This is the maintainer's hypothesis and impression of the
     Samsung clipboard, not a finding from source: the investigation found no documented size or image limit for it
     (Roadmap CHORE-63).
   - The mechanisms the investigation traced for (a) to (c), what was run and what was not, are in Roadmap CHORE-63 and
     ledger row 600, not here. The wording in (b) is the maintainer's; the footer text in the code is "From Risuai".

**What was decided** (the question, verbatim, then the answer and the option text; the texts are from the session
transcript):
3. **A tap on copy puts plain text on the clipboard, and the card becomes a separate action; the ticket is CHORE-63,
   placed right after CHORE-53.**
   - **Copy format.** The question: "The copy button builds a rich 'card' (persona or character name, avatar, message,
     'From Risuai' footer) and puts both that card and the plain text on the clipboard. Apps that accept rich text paste
     the card, which is symptom (b). What should a tap on copy do?" The answer: "Plain text by default
     (Recommended)": "A tap copies only the message text: fast, small, always written within Chrome's tap window. The
     card stays available as a separate 'copy as card' choice (long-press or a menu item; one more translated label)."
     The options not chosen were "Keep the card, make it reliable": "Keep today's rich card as the default, but write
     it the reliable way (clipboard reserved on the tap, images downscaled with timeouts, size capped with a plain-text
     fallback, a visible failure message). Rich-text targets keep pasting the card."; and "Drop the card": "Copy only
     ever puts plain text on the clipboard; the card feature is removed."
   - **Placement.** The question: "This becomes a new copy-button reliability ticket (CHORE-63), fixed in the same
     change as CHORE-40 (the button fetching every web address in the message). Where should it go in the work
     order?" The answer: "Right after CHORE-53 (Recommended)": "Small and self-contained (one handler moved into a
     tested module, about 200 lines, 1-2 translated strings, no save-file code), and seen in the wild on upstream. Goes
     before CHORE-43+54." The options not chosen were "With CHORE-43+54": "Bundle it with the other chat-screen fixes
     (reroll binding, reroll overwriting edits)."; and "After steps 6 and 7": "Keep the memory work first; fix the copy
     button later, before CHORE-62 and CHORE-58."
   - **Relation to `MC-151` 3.** CHORE-43 and CHORE-54 were placed "Right after CHORE-53" there. The option text the
     maintainer selected here says CHORE-63 "goes before CHORE-43+54", so the order is CHORE-53, then CHORE-63 with
     CHORE-40, then CHORE-43 with CHORE-54.
   - **Not decided by this entry:** the gesture for "copy as card" (the option text offered "long-press or a menu item"
     and the maintainer chose the option, not one of the two); its label; and the size caps and timeouts of the plain
     path. The "about 200 lines" and "1-2 translated strings" in the option text are the Orchestrator's estimates.

---

### MC-161 — CHORE-53: no key reaches the page behind a dialog; Enter follows the focused button; every prompt pauses 0.4 s; message delete asks with three choices; each stage is committed on its own

- **Tag:** decision
- **Date:** 2026-10-02
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's answers to the questions the Orchestrator asked with AskUserQuestion while CHORE-53
  was planned and gated (items 1 to 6 and 8, each quoted by the label of the option chosen), and two instructions in
  chat (items 7 and 9, quoted as typed). The rule in each item is the option text the
  Orchestrator wrote and the maintainer selected. The Orchestrator's own calls are listed apart at the end and are
  **not** maintainer decisions.
- **Reasoning:** the maintainer gave no reason beyond the answers. The reasons in the option texts are the
  Orchestrator's.
- **Alternatives rejected** (the other options the Orchestrator offered):
  - item 1: "only Enter stops at a confirm" (the ticket's layer 1) and "no keyboard change";
  - item 2: "Keep: Enter is always Yes";
  - item 4: "Only the 'remove just one?' choices" (only the three-choice question gets the pause); item 5: "only
    follow-up confirms pause";
  - item 6: "Enter never answers it" (a confirm that interrupted typing);
  - item 3 was a multi-select and all three options were chosen;
  - item 7 was the maintainer's own instruction, so no options were offered;
  - item 8: "Merge now" (merge while the two other CHORE-53 stages were uncommitted) and "Don't merge yet" (leave the
    branch for the maintainer).
- **Amends:** `MC-115` 3, for Enter (item 2), and `MC-115` 4, "A prompt that opens fresh answers at once" (item 5).
  Scope: widened by item 3 beyond the ticket's three layers; recorded here as a `MC-091` amendment.
- **Related:** MC-011, MC-091, MC-103, MC-109, MC-115, MC-129, MC-150, CHORE-53; commits `07ea1882`, `1ba98d45`,
  `5747a7e1`; ledger rows 606 to 616 (617 is the records batch).

**What was decided** (the question's answer by option label, then the rule it states):
1. **While a confirm or a notice covers the screen, no key reaches the page behind it.** The answer: "Same as the
   mouse (Recommended)". Not Enter, not Space, not a held key, not the chat input. Typing inside the dialog itself is
   unchanged. The option text added: "This also covers the 17 sidebar and preset icons that press themselves on
   Enter". The option text also said that toasts and progress bars do not block anything, as today. **That is wrong for
   progress bars** (the Orchestrator's check of source, disclosed to the maintainer in chat): on HEAD `progress`,
   `wait` and `wait2` render inside the alert overlay that already blocks the mouse, so under this item they block
   keys too. Only `toast` and `none` do not cover the page.
2. **Enter on a button inside the dialog presses that button.** The answer: "Focused button wins (Recommended)". So
   No means no. With nothing in the dialog focused, Enter answers Yes as before. Shift+Enter no longer answers.
   - **Amends `MC-115` 3** ("Enter on the alert itself keeps `MC-109`'s behaviour") for Enter.
3. **Scope: three more items.** A multi-select; all three were chosen:
   - (a) "Deletes the ticket missed (Recommended)": plugin removal, the HypaV3 summary's "delete this" and "delete
     after", the Playground's "delete selected" for inlay images, and the trigger-type switch each act on the object
     that was clicked, or on nothing;
   - (b) "Held key on deletes with no confirm (Recommended)": a held key never repeats a button press anywhere in the
     app;
   - (c) "Reword the 'remove just one?' question": the chat message delete asks with three explicit choices instead
     of Yes/No, where No removed the message and every message after it. **Fork-only wording change** (upstream asks
     Yes/No).
4. **A confirm that follows another confirm pauses.** The answer: "Pause any confirm that follows one
   (Recommended)": a confirm that opens within about 0.4 s of another being answered ignores clicks, taps and keys for
   its first 0.4 s. **Replaced by item 5** after the 53a escalation. It was asked after Gate 1 round 1 of the chat
   delete stage (finding 1: a double-click on the first confirm's Yes could answer the second). The same double-click
   could answer both of `removeChar`'s confirms on HEAD (traced, not measured, per the 53c commit message).
5. **Every prompt pauses for 0.4 s.** The answer, after three `[REJECT]` rounds on 53a and the escalation to
   `senior-advisor`: "Every confirm pauses 0.4 s (Recommended)". Every prompt (confirm, select, any type) ignores
   clicks, taps and keys for its first 0.4 s, however it got on screen. **Replaces item 4.**
   - **Amends `MC-115` 4** ("A prompt that opens fresh answers at once").
6. **Enter works after the pause.** The answer: "Enter works after the pause (Recommended)". A confirm that opened
   while the user was typing takes keyboard focus; the pause catches an Enter already being pressed; after it, Enter
   answers Yes as on any confirm. This drops the Orchestrator's proposed text-field rule (call 6 below).
   - **Disclosed in chat after the answers, not in the question; no separate answer:** a plugin's own document key
     listeners keep receiving keys while an alert is up, as on upstream (the chat message says "a plugin"; the 53a
     commit message says V2 and V3 plugins); and the partial-edit floating buttons stay reachable by mouse, as today.
7. **Each stage is committed when ready.** The instruction, as typed: "commit each stage when ready." It was a chat
   message, not an answer to a question. Nothing is pushed: that is the standing rule (push only at the maintainer's
   request; Live-State), not part of the message. The stages are 53a
   (the keyboard: items 1, 2 and 3b; one shared mechanism for every prompt), 53b (every prompt-then-remove handler
   removes the clicked object or nothing: item 3a and the list handlers) and 53c (the chat message delete:
   item 3c). They are committed as `1ba98d45` (53a), `5747a7e1` (53b) and `07ea1882` (53c).
8. **The rebranding branch merges after the CHORE-53 commits.** The answer: "Merge after CHORE-53 commits
   (Recommended)". `chore/risutanium-identity` is merged as `cfa4dfa0`; see `MC-162`.
9. **The maintainer's decisions go into the records when the work is committed.** The instruction, as the session
   notes record it: "add the maintainer decisions to the records when you commit". This entry and `MC-162` are that
   record.

**The Orchestrator's own calls** (not maintainer decisions; each is in the commit or the gate record that carries it):
1. A delete whose target is gone by the time it is confirmed does nothing, silently, as `removeChar` and
   `removeChatConfirmed` already do (`MC-075` 2 by analogy). The reason: the user wanted it gone.
2. `removeChar('permanent')` skips a character that was restored from the trash while its confirms were open, and
   stops no work in it (`MC-103`, `MC-129`).
3. "The last remaining entry cannot be deleted" guards hold at the moment of removal, not only at the click.
4. No dedupe of identical in-flight delete prompts: with keys blocked behind dialogs and the overlay blocking the
   mouse, a second flow needs a deliberate second action; `MC-115` 2's prompt queue stays.
5. The HypaV3 reset is in scope with the other prompt-then-act handlers; it is a reset, not a list delete.
6. The text-field rule (Enter never answers a confirm that interrupted typing) was proposed and then dropped by
   item 6.
7. Enter does not close a notice or an error within 0.4 s of it appearing, so that an Enter meant for something else
   does not close an error unread; the OK button and Escape are unchanged.
8. The pause on the terms prompt and the stale-account notice sits in the dialog's buttons, not in the alert logic, to
   avoid re-timing about 90 existing test steps.
9. Focus is not given back to the page when a dialog closes (dropped at the second Gate 1 rejection of the first
   design).
10. The progress-bar error in item 1's option text was the Orchestrator's, and was disclosed to the maintainer in chat.
11. Keyboard shortcuts do nothing under notices, spinners and progress bars, as they already did while a confirm
    waits. This **extends `MC-115` 3**. The Orchestrator put it to the maintainer in chat as a call they could overrule;
    no answer to it is recorded.

---

### MC-162 — The app identity is Risutanium: name, identifier, version scheme, deep-link schemes, and what is not wanted (relayed by the Rebranding session; CHORE-60)

- **Tag:** decision (relayed), plus one stated wish (`isWeb`)
- **Date:** 2026-10-02 (the Rebranding session's hand-off, and the maintainer's confirmation of the merge the same
  day; dates of the individual answers inside that session: not relayed)
- **Sweep ref:** none
- **Source:** **relayed by the Rebranding session**, a parallel session whose name in the session list is "Rebranding"
  and which the maintainer asked to coordinate the rebrand. It is not a direct statement to the Main Campaign
  session. The merge decision (`MC-161` 8) confirms the result. The commits are `98d13e7f`, `63860dfe` and `c9326b67`,
  merged as `cfa4dfa0`.
- **Reasoning:** the reasons given in the relay: the identifier is deliberately a fresh app-data folder, because a
  save structure rework is planned; the `risuailocal` scheme is kept so that upstream Realm's open-in-app links still
  reach the app.
- **Alternatives rejected:** none are recorded in the relay.
- **Related:** MC-011, MC-087, MC-089, MC-154, MC-157, MC-161 8, CHORE-60.

**What was decided:**
1. **The product name is Risutanium**, shown as RisuTanium, Risu-Tan or RT.
2. **The identifier is `io.github.yor42.risutanium`**: a fresh app-data folder on purpose.
3. **The version is SemVer from 0.1.0**, with the upstream base shown as a suffix: `appSubVer` is `up<upstream
   version>`. The home screen's Version line (`MainMenu.svelte`, through `getVersionString`; a nightly build shows its own text
   instead) shows `0.1.0-up2026.8.250`, and `version.json` holds the same string. There is no About screen.
4. **Two deep-link schemes: `risutaniumlocal` and `risuailocal`.** The second stays registered so that upstream's
   Realm open-in-app links keep working.
5. **No FUNDING file is wanted.** The file is already absent from HEAD.
6. **No `risuai.xyz`-hosted special cases.** The `stable.risuai.xyz` "(Stable)" label is removed.

**What was stated:**
7. **`isWeb` should be removed; it is left for now at the maintainer's instruction.** What is known about it: it is
   defined in `src/ts/platform.ts`, its only consumer is `preLoadCheck` in `src/preload.ts`, which writes a
   `mainpage` localStorage key that nothing in `src` reads, and `src/preload.beforeUnload.test.ts` mocks it.

**Consequences the Rebranding session's reviewer noted and the maintainer accepted:**
- CBS `{{version}}` returns `0.1.0` and `{{majorversion}}` returns `0`, so upstream cards that compare against a 2026
  version behave differently.
- The `x-risuai-info` header sends `0.1.0;<platform>` on the Realm search request, to the hub URL: `/hub-proxy` on a
  Node server, `nightly.sv.risuai.xyz` on a nightly build, otherwise `sv.risuai.xyz` (`characterCards.ts`, read by the
  fact-check).

**Not changed by the rebrand:** the updater `pubkey` (upstream's; `endpoints` are empty), the tracked
`src-tauri/key.txt` (its contents are not to be quoted), and the `risuai.xyz` URLs that still work.

---

### MC-163 — CHORE-64: a write to the plugin list through `setDatabase` or `setDatabaseLite` never deletes plugins; updates keep saved settings; a plugin that updates itself, or another plugin, is asked about by name

- **Tag:** decision
- **Date:** 2026-10-02
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's answers to the questions the Orchestrator asked with AskUserQuestion while CHORE-64 was
  investigated and planned, each quoted by the label of the option chosen (items 1 to 10; items 5 to 7 were asked in a
  second round after the maintainer's two plugins were read, and items 8 to 10 in a third, after Gate 1 round 1); the
  answer "Accept all three (Recommended)" to the Orchestrator's three calls (item 11, a fourth round, asked after Gate 1
  closed with round 3 `[EDITORIAL]`); and one fact the maintainer stated in the message that started the work (item 12).
  The rule in each item is the option text the Orchestrator wrote and the maintainer selected. The
  Orchestrator's own calls are listed apart at the end and are **not** maintainer decisions.
- **Reasoning:** the packet records no reasoning beyond the answers and the fact in item 12. The reasons in the option
  texts are the Orchestrator's.
- **Alternatives rejected:** item 1: removal of an omitted plugin with a prompt, and the upstream contributor's fix
  `7221d338` (a branch that was never merged; its rule keeps installed entries and drops the approved names). The other
  options offered (the session's question log):
  - item 2: "Keep, plugin updates only" and "Take what the plugin sends";
  - item 3: "Silent for itself";
  - items 4 and 7: "Fold into CHORE-64";
  - item 5: "Same rule, self-updates silent" and "Leave Lite as upstream";
  - item 6: "Trust the plugin's entry";
  - item 8: "Ask, marking older ones";
  - item 9: "Save nothing";
  - item 10: "Keep both";
  - item 11: "I want to change one".
- **Differs from upstream:** item 2 (upstream resets saved values on an update) and items 1, 5 and 9 (upstream's
  `setDatabase` replaces the list with only the confirmed new or script-changed entries; `setDatabaseLite` takes the list
  as given). Fork-specific behaviour; see the commit `48f00223` and `plugins.md`.
- **Related:** MC-011, MC-036 (the same setters; not amended), MC-089, CHORE-64, CHORE-65, CHORE-66; commit
  `48f00223`; ledger rows 618 to 622.

**What was decided** (the question's answer by option label, then the rule it states):
1. **Merge rule.** The answer: "Compare by name (Recommended)". An unchanged entry stays as it is. An entry with an
   installed name and a changed script is an update, asked about by name. A new name is an install, asked about. An
   installed plugin left out of the written list is kept: a plugin can never delete a plugin.
   - **Scope note (the Orchestrator's, not the maintainer's):** the rule is implemented for `setDatabase` and
     `setDatabaseLite`. A V2.1 plugin can still delete or replace installed plugins through the live `getDatabase()`
     proxy, with no prompt (item 7; CHORE-65). The V2.1 proxy route is CHORE-65.
2. **Saved settings.** The answer: "Keep, every update path (Recommended)". The saved values of the arguments the new
   version still declares, and the on/off state, survive a plugin's self-update, the Update button and re-import. This
   differs from upstream, which resets them.
3. **Self-update prompt.** The answer: "Ask, naming it (Recommended)". The prompt says "Plugin X wants to update
   itself". An update of another plugin is asked about, naming both.
4. **Cross-plugin `getArg`/`setArg`.** The answer: "Separate ticket (Recommended)". It goes to CHORE-65.
5. **`setDatabaseLite`.** The answer: "Same rule and prompts (Recommended)". `setDatabaseLite` follows the same rule and
   prompts. A declined write fails visibly, so a plugin that updates itself can roll back instead of reporting a false
   success.
6. **Where the details come from.** The answer: "Read the header (Recommended)". The details of a script-changed or new
   entry come from the script's own header, not from the fields the plugin sent.
7. **V2.1 direct edits.** The answer: "Separate ticket (Recommended)". Edits through the live `getDatabase` proxy go to
   CHORE-65.
8. **Old copies.** The answer: "Only newer versions (Recommended)". An entry is an update only if its `//@version` is
   newer than the installed one. The same, an older or a missing version is ignored with a console warning, with no
   prompt.
9. **A decline.** The answer: "Save the rest, fail (Recommended)". The call's other data is saved, the plugin list is
   left as it was, and the call fails naming the plugin.
10. **Hot reload.** The answer: "Keep values, switch on (Recommended)". Hot reload keeps the saved values and switches
    the plugin on, as before.
11. **Three Orchestrator calls, accepted.** The answer: "Accept all three (Recommended)":
    - an entry with the same script but other fields edited is ignored with a warning;
    - a saved value carries over only if the declared type is unchanged;
    - a plugin's own entry with a different script that is not newer rejects the call, so the plugin cannot report a
      false success.

**What the maintainer stated:**
12. **The maintainer's words (2026-10-02, in the message that started the work), verbatim:** "about plugin writing in
    the plugin list-I think some plugin uses that feature for auto-update. so we have to take updates into the account."
    The maintainer supplied two provider-manager
    plugins (v1.16.5 and v1.35.11) in `Agents/Evidences of Investigations/` (gitignored; never quote them). What the
    investigation found in them (ledger row 618; counts by the Orchestrator):
    - only v1.35.11 updates itself: it writes the whole list through `setDatabaseLite`;
    - v1.16.5 writes no list and directs the user to the Update button;
    - the maintainer doubted that AssetGod and fast-character-import update themselves. The investigation confirmed it:
      neither writes `plugins`.

**The Orchestrator's own calls** (not maintainer decisions; each is in the commit message of `48f00223`, the plan
(`plan-64-v2.md`, a session gate record in the scratchpad, not a repo file) or the source; calls 5 to 7 are in source
only). The list is not exhaustive; the plan is the full record.
1. A malformed entry or a duplicate name is ignored; the first one counts.
2. Refusals are found before any prompt.
3. Prompts stop at the first decline.
4. A stale copy whose header fails to parse is a refusal.
5. Plugin names in prompts are shown on one line and cut at 200 characters.
6. The old "[WARN] Plugin attempted to access plugin directly" log is removed.
7. The Update button and hot reload are not version-gated.
8. The header must name the entry, and an update or install must declare API 3.0.
9. The host's `compareVersions` is used unchanged, so a pre-release suffix such as `2.0.0` against `2.0.0-rc1` counts
   as not newer.
10. `characters` is reconciled against the live list on both setters.
11. `setDatabaseLite` stays synchronous when nothing is asked.

---

### MC-164 — Identity follow-ups: the repository is yor42/RisuTanium; the README logo; `docs/branding/`; the Cargo crate name stays `risuai` (CHORE-60)

- **Tag:** decision (mixed: some stated or done by the maintainer, some relayed by the Rebranding session; the source of
  each item is named)
- **Date:** 2026-10-02
- **Sweep ref:** none
- **Source:** the maintainer's own actions and requests in this session (items 1, 2, 4 and 7), and **relays from the
  Rebranding session**, the parallel session that coordinates the rebrand (items 3, 5 and 6; see `MC-162`). Dates of
  the individual answers inside that session: not relayed.
- **Reasoning:** none recorded in the packet.
- **Alternatives rejected:** none recorded.
- **Related:** MC-011, MC-162, MC-157, CHORE-60; commits `d722edea`, `e768ef75`, `e9b70b8d`, `33cafe18`, `4a7ed14d`,
  `b745fc29`.

**What was decided or done:**
1. **The GitHub repository is yor42/RisuTanium.** The maintainer renamed it from yor42/RisuAI and updated the local
   remote. GitHub redirects the old URL. The fork's links in Settings and on the home screen now point at the new name
   (`b745fc29`); the links to upstream kwaroran/RisuAI are unchanged.
2. **The maintainer updated the repository URL in the Terms of Service and the Privacy Policy themselves** (`4a7ed14d`).
   They write and commit those documents.
3. **The README logo is a `<picture>` of the bright and dark wordmark SVGs.** The maintainer chose it (relayed by the
   Rebranding session). Upstream's `public/logo_typo_small.avif` was removed, which the maintainer approved (`e9b70b8d`).
4. **`docs/branding/` was committed at the maintainer's request** (`33cafe18`): their Inkscape sources and exports,
   18 SVGs. They were checked before the commit for a path or personal metadata: none was found, only file names and the
   NanumSquare Neo font name.
5. **The Cargo crate name stays `risuai`.** The maintainer's decision, relayed by the Rebranding session.
6. **`Title.svelte` still links risuai.net.** The maintainer has not decided on it (relayed).
7. **The Rebranding session's leftovers merge** (`82776b3b` and `94d7be86`, merged as `e768ef75`) was first deferred by
   the maintainer, then approved.

---

### MC-165 — CHORE-63: "Copy as card" is a menu item; web images stay links; the card keeps app colours only and drops hidden text; the work is split, stage A first (and closes CHORE-40); CHORE-65 is low priority

- **Tag:** decision (items 1, 2, 4, 5 and 6), stated or decided in chat (items 3 and 8), and an incident record (item 7)
- **Date:** 2026-10-02
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's answers to the questions the Orchestrator asked with AskUserQuestion while the CHORE-63
  plan was gated (items 1, 2, 4, 5, 6 and 7, each with the question's text, the option chosen and its text, and the
  options not chosen; the packet records that the questions on style and hidden content and the split followed the
  `senior-advisor` escalation after three Gate 1 `[REJECT]` rounds, and does not date the others), and the maintainer's own
  words in chat (items 3 and 8, quoted as typed). The rule in each item is the option text the Orchestrator wrote and
  the maintainer selected. The Orchestrator's own calls are listed apart at the end and are **not** maintainer
  decisions.
- **Reasoning:** the maintainer gave no reason beyond the answers. The reasons in the option texts are the
  Orchestrator's. The only reason the maintainer gave is in item 3.
- **Alternatives rejected** (the other options the Orchestrator offered):
  - item 1: "Long-press on copy" and "Both";
  - item 2: "Leave them out";
  - item 4: "Some inline styles" and "Exactly as on screen";
  - item 5: "Include everything";
  - item 6: "One change";
  - item 7: "I'll run git myself";
  - items 3 and 8 were the maintainer's own words in chat, so no options were offered.
- **Extends:** `MC-160` 3 (it decides the "copy as card" gesture that `MC-160` 3 left open). It
  does not change `MC-160` 3's rule that a tap on copy writes plain text.
- **Related:** MC-011, MC-160, MC-161, MC-162, CHORE-40, CHORE-63, CHORE-65; commit `d013e7cf` (stage A); ledger rows
  623 to 626.

**What was decided** (the question verbatim, then the answer and the option text):
1. **The gesture for "copy as card" is a menu item.** The question: "Where should the new "copy as card" action live?
   (A tap on the copy button will copy plain text, as already decided.)" The answer: "Menu item (Recommended)": "A
   "Copy as card" entry in the message's existing "…" popup menu. On phones the copy button is already in that menu,
   so the two sit side by side. The app's long-press helper only listens for mouse events, which a held finger on
   Android Chrome likely never sends (inferred from how browsers handle touch, not tested), so a long-press probably
   wouldn't work on your Galaxy phones." The options not chosen were "Long-press on copy": "Hold the copy button to
   copy the card, like holding the remove button. The helper would need touch support added, and holding a finger down
   on Android can also bring up text selection."; and "Both": "The menu item, plus a long-press on desktop." The
   touch-event claim in the chosen option's text is the Orchestrator's inference, labelled there as not tested.
   - **Not decided by this entry:** the label's translations and the card's caps and timeouts. "Copy as card" is the
     wording of the option text.
2. **An image from an outside website stays a link in the card; the app fetches no outside host.** The question: "When
   the card contains an image from an outside website, what should it do? (CHORE-40: the app will stop fetching
   outside websites itself.)" The answer: "Keep as a link (Recommended)": "The card keeps the image's original web
   address. The app downloads nothing; the app you paste into decides whether to load the image. Images stored in the
   app (avatars, assets) are still embedded, shrunk to a capped size." The option not chosen was "Leave them out":
   "Outside images are removed from the card entirely, so it only ever shows the app's own images."
3. **CHORE-65 is low priority, and the work order stands.** The maintainer's words in chat: "old V2.1 plugins are
   getting rare, so I think it can be marked as low priority." The same message: "let's stick with work order and
   start working on CHORE-63 with CHORE-40." The work order is `MC-160` 3's: CHORE-53, then CHORE-63 with CHORE-40,
   then CHORE-43 with CHORE-54.
4. **The card keeps app colours only.** The question: ""Copy as card" turns the message into a formatted card. How
   much of the message's own styling should the card keep? (Plain-text copy is unaffected either way.)" The answer:
   "App colours only (Recommended)": "The card styles paragraphs, italics, bold and quotes in your theme colours, as
   today. Colours, boxes and layouts that a character card writes into its own HTML don't carry over, so heavily
   styled status panels paste as clean text. This is the version that can be reviewed with confidence." The options
   not chosen were "Some inline styles": "Also keep a short list of styles written directly on the message's
   elements: text colour, background colour, bold, italic, underline, alignment. Styles from a card's stylesheets and
   class names still don't carry over. More faithful, but another list to review."; and "Exactly as on screen":
   "Read the styling from the message as it's actually shown. Most faithful, but a much bigger change: the card would
   then copy whatever is on screen at that moment, which could be a translation or a reply that's still streaming."
5. **Hidden text is left out of the card.** The question: "Messages can contain content the chat doesn't show: hidden
   blocks, and collapsed sections such as the model's thinking. What should the card do with it?" The answer: "Leave
   it out (Recommended)": "The card shows what the message shows: hidden blocks and collapsed sections, including
   the thinking section, are dropped. One caveat: content hidden by a card's stylesheet rule, rather than directly on
   the element, can't be detected and would appear." The option not chosen was "Include everything": "The card
   carries all of the message's text, with hidden and collapsed parts shown."
6. **The work is split: stage A (plain text) now, the card next.** The question: "The plain-text half of the fix (tap
   copies text instantly, errors are shown, no outside fetches, the "…" menu reopens on one tap) is already agreed
   with the reviewer. Should it go ahead now, with the card following as a separate gated change?" The answer:
   "Split: text now, card next (Recommended)": "Commit the plain-text fix first, which also closes CHORE-40, then the
   card as its own change, and optionally embedding the message's own images as a third. Until the card change lands,
   "Copy as card" isn't there yet. The fork hasn't shipped, so nobody is affected." The option not chosen was "One
   change": "Keep everything in a single change and commit only when the card is done too."
   - **This supersedes "fixed in the same change as CHORE-40"** in `MC-160` 3's placement question, the Roadmap and the
     Live-State work order. Stage A is committed as `d013e7cf` and closes CHORE-40. Stage B is the "Copy as card" menu
     item with the card contract of items 1, 2, 4 and 5; stage C is optional (embedding the message's own local images).
     Stage B must keep the app from fetching outside hosts (item 2).
7. **Chat.svelte was restored by the Orchestrator.** An incident record, not a product rule. The question: "How should
   src/lib/ChatScreens/Chat.svelte be put back to the committed version? It had no changes of yours before the
   coder's broken edit, so nothing is lost either way." The answer: "You restore it (Recommended)". The option not
   chosen was "I'll run git myself". The coder's PowerShell edit had split the file's CRLF line endings and corrupted
   it; the Orchestrator restored it from the HEAD blob with this approval, and the work was finished with the Edit tool
   (ledger row 626).
8. **Commit stage A, and defer the live check until stage B is done.** The maintainer's words in chat: "commit stage
   A. and defer live check until we finish stage B." and "I will take a look if I can fix the live pane while you are
   working on stage B." Stage A is committed as `d013e7cf`. The live check of the copy button in a browser has not
   been run.

**The Orchestrator's own calls** (not maintainer decisions; calls 2 to 5 are in the `d013e7cf` commit message or the source; call 1 is a stage B intention recorded here only):
1. The brand strings in the card become "RisuTanium" (`MC-162` 1), in stage B.
2. The status text beside the message buttons replaces the blocking "Loading" and "Copied" dialogs.
3. The plain copy falls back to `document.execCommand('copy')` when the clipboard API is absent or rejects.
4. The status span uses `aria-live="polite"`, not `role="status"`, because the draft-restore marker tests find that
   marker by `role="status"`.
5. The popup reopen fix (the "…" menu opens on one tap after an item was used or the menu was closed by a click
   elsewhere) is folded into stage A: an adjacent defect on the same path.

---

### MC-166 — CHORE-63 stage B: a formula is copied as its TeX source; a simplified card says so; stage C, the plain-copy question and the DOMPurify test question become tickets (CHORE-68, CHORE-69, CHORE-67); the live check follows the commit

- **Tag:** decision (items 1, 2, 4, 5 and 6) and stated in chat (item 3)
- **Date:** 2026-10-02
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's answers to the questions the Orchestrator asked with AskUserQuestion during CHORE-63
  stage B (items 1, 2, 4, 5 and 6, each with the question's text, the option chosen and its text, and the options not
  chosen; the answers are not dated within the day), and the maintainer's own words in chat (item 3, quoted as typed).
  The rule in each item is the option text the Orchestrator wrote and the maintainer selected. The Orchestrator's own
  calls are listed apart at the end and are **not** maintainer decisions.
- **Reasoning:** the maintainer gave no reason beyond the answers. The reasons in the option texts are the
  Orchestrator's.
- **Alternatives rejected** (the other options the Orchestrator offered):
  - item 1: "Keep it as a formula" and "Leave it out";
  - item 2: "Just "Copied"";
  - item 4: "Do it now" and "Drop it";
  - item 5: "It's fine as is";
  - item 6: "Don't file";
  - item 3 was the maintainer's own words in chat, so no options were offered (an earlier AskUserQuestion on the same
    point was dismissed, and the chat message answered it).
- **Extends:** `MC-165` (it settles two points of the card contract that `MC-165` left open, the formula and the fallback
  status, and decides what happens to stage C; it changes no rule of `MC-165`). The option text chosen in `MC-165` 2
  said images stored in the app "are still embedded"; stage B embeds only the avatar, and the rest is CHORE-68 (item 4).
- **Related:** MC-011, MC-160, MC-162, MC-165, CHORE-63, CHORE-67, CHORE-68, CHORE-69; commit `7ca8f2a9` (stage B);
  ledger rows 627 to 632.

**What was decided** (the question verbatim, then the answer and the option text):
1. **A formula appears in the copied card as its TeX source.** The question: "Messages can contain math formulas
   (written as $$...$$ and shown rendered in the chat). How should a formula appear in a copied card?" The answer: "As
   its TeX source (Recommended)": "The formula appears as the text you wrote, e.g. \frac{a}{b}, so it is never lost and
   pastes the same everywhere. Simple and predictable." The options not chosen were "Keep it as a formula": "Keep the
   formula markup in the card. Apps that understand it (some browsers and editors) show it rendered; apps that don't
   show a jumble of symbols or nothing. One more set of elements to review."; and "Leave it out": "Drop formulas from the
   card, like the other non-text parts."
2. **The status says when the card was simplified.** The question: "Sometimes a card can't be made in full: the message
   is too big, the 3-second time limit runs out, or something fails, and you get a simpler card or plain text instead.
   What should the status beside the buttons say?" The answer: "Say it was simplified (Recommended)": "Show a short note
   such as "Copied as text" or "Copied (simple card)", so you know before pasting. Needs one or two more translated
   strings." The option not chosen was "Just "Copied"": "Show the normal "Copied" either way. Fewer strings; you'd only
   notice when you paste."
3. **Commit stage B, then run the live check.** The maintainer's words in chat: "let's commit now and do live check
   after that." and "I brought up the claude app and live pane up front. so it should work now." (An earlier
   AskUserQuestion on the same point was dismissed; the chat message answered it.) Stage B is committed as `7ca8f2a9`.
   The live check was then run in the maintainer's built-in pane (Roadmap CHORE-63, third status paragraph).
4. **Stage C is ticketed for later, and the work order moves on.** The question: "Stage C would embed the app's own
   pictures from inside a message (stickers, inlay images, assets) into the card, shrunk and size-capped. Right now the
   card leaves them out. What should happen with it?" The answer: "Ticket it for later (Recommended)": "Record stage C
   as its own open ticket, not scheduled, and move on to the next work-order item (CHORE-43 with CHORE-54). The card
   works without it." The options not chosen were "Do it now": "Plan, review and build stage C next, before moving
   on."; and "Drop it": "The card never embeds the message's own pictures; record that as the final design." Stage C is
   CHORE-68.
5. **The plain Copy button's raw text is ticketed, with no change now.** The question: "The plain Copy button copies the
   message's raw text, which includes the model's thinking section and any hidden blocks as raw markup (e.g.
   <Thoughts>…</Thoughts>). Is that a problem worth a ticket?" The answer: "File a ticket (Recommended)": "Record it as
   a new ticket to decide later what plain copy should leave out; no change now." The option not chosen was "It's fine
   as is": "Plain copy keeps copying the raw text, thinking and markup included. Recorded as intended." The ticket is
   CHORE-69.
6. **The DOMPurify-under-happy-dom test question is filed as CHORE-67.** The question: "Our test environment
   (happy-dom) makes DOMPurify stop cleaning after its first removal, so some existing tests of the app's own HTML
   cleaning may pass for the wrong reason. Should I file that as CHORE-67?" The answer: "File CHORE-67 (Recommended)":
   "Open ticket: find which existing tests rely on DOMPurify removals under happy-dom and make them trustworthy. Not
   scheduled yet." The option not chosen was "Don't file": "Leave it unrecorded."

**The Orchestrator's own calls** (not maintainer decisions; in the `7ca8f2a9` commit message or the source unless noted):
1. The card body is rebuilt into an inert document from an allowlist, not sanitised with DOMPurify. This followed the
   `senior-advisor`'s follow-up on the stage B investigation's evidence (ledger rows 627 and 628).
2. The plain fallback ("Copied as text") registers its text so it is written again over an older, already-resolved card
   write. The plan's item B7 said fallbacks "do not register as newer copies"; the implementation and the code review
   found the registration necessary, so the plan text was wrong.
3. Status durations: "Copied" 3 s, "Copied (simple card)" and "Copied as text" 5 s, a failure 10 s, "Loading" up to 5 s.
4. The fallback theme colours are fixed neutral values; outside images kept in the body get `max-width: 100%`.
5. A card whose avatar is absent because there is none (an empty path) says "Copied". A card whose avatar was expected
   but could not be made says "Copied (simple card)".
6. CHORE-63 is closed with stage B and the live check (not a maintainer decision); the checks not run (an avatar live,
   a plain copy during a pending card live, a failure display, WebView2, WebKit, Android, pasting into a real app) are
   recorded in the Roadmap and not ticketed.

---

### MC-167 — CHORE-55 becomes one storage interface with three adapters and no bypasses; OPFS is no longer written (read-through, no migration); the work stays before memory steps 6 and 7, stage 0 first; the partial-load question is CHORE-70

- **Tag:** decision (items 1 to 9; the maintainer's own proposal in item 1, and their answers to the Orchestrator's
  questions in items 2 to 7 and 9), stated in chat (items 1 and 8, and the question in item 10)
- **Date:** 2026-10-02
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's chat messages S1 and S2 (quoted below as typed), and their answers to the
  `AskUserQuestion` sets the Orchestrator asked during the sizing of that proposal. The times are those stamped in the
  question log: the 08:57 set (items 2 and 4, and the "155 MB" answer in item 3), the 09:27 set (items 2, 5, 6 and 7)
  and the 09:31 set (items 4 and 9). The rule in each item is the option text the Orchestrator wrote and the maintainer
  selected. The Orchestrator's own calls are listed apart at the end and are **not** maintainer decisions.
- **Reasoning:** the maintainer's reasons are in the quoted messages: one interface means a save-path fix is made once,
  and "the Tauri copy is where gaps like CHORE-55 (no write-then-rename) survive". The reasons in the option texts are
  the Orchestrator's.
- **Alternatives rejected** (the other options the Orchestrator offered):
  - item 2: "Copy OPFS into IndexedDB once" and "Keep OPFS for archived data";
  - item 4: "Next, right now", "After steps 6 and 7", "Right after CHORE-43/54" and "Now, before CHORE-43/54";
  - item 5: "Mostly static web" and "Both, or not sure";
  - item 6: "No, use mocks";
  - item 7: "Leave them out" and "Include early";
  - item 9: "Fold into CHORE-55" and "Leave it".
- **Supersedes:** `MC-089` 1 ("The switch stays visible"). `MC-089` 2 (nothing ships until every current ticket is
  cleared) stands.
- **Related:** MC-011, MC-089, MC-151, MC-152, CHORE-55, CHORE-48, CHORE-59, CHORE-70; ledger rows 633 to 636.

**What the maintainer said** (S1 and S2, as typed):

S1, the proposal:

> during chore-55, I think better approach would be a one storage interface that every save and load goes through, with three adapters (Tauri files, Node HTTP and one browser store), and no code that bypasses the interface.
>
> and instead of maintaining both indexedDB and OPFS, I think we can consider only keep IndexedDB as chat larger than 155 MB is rare. (currently node straight up refuses to accept db larger than 100mb)
> Also, currently Tauri bypasses the interface. saveDb() calls writeFile directly for database.bin and its backups instead of going through forageStorage. Every save-path fix therefore has to be made twice, and the Tauri copy is where gaps like CHORE-55 (no write-then-rename) survive.
> plus, through that interface we can later add cross-chat search without changing the storage engine. A JavaScript full-text index library (such as MiniSearch or FlexSearch) can be kept up to date at save time and stored in the browser store which can be used for cross chat search.

S2, after the investigation was started (after the context compaction):

> you may start designing when chore 43 investigation lands. about storage interface: weren't we planning to implement DB Atomicity too? should we fold that into this investigation too?

**What was decided:**
1. **CHORE-55 is one storage interface that every save and load goes through, with three adapters (Tauri files, Node
   HTTP and one browser store), and no code that bypasses the interface for the persisted kinds.** The browser store is
   IndexedDB. The rule is the maintainer's proposal in S1 (its first paragraph, and "Also, currently Tauri bypasses the
   interface"). The maintainer's words say "every save and load"; "the persisted kinds" is the scope the
   `senior-advisor` recommended ("the six persisted kinds, plus inlays later"), which the Orchestrator accepted as the
   planning basis. The advisor's hand-back summary does not list the six kinds; the CHORE-55 plan will.
2. **OPFS is not written again; data missing from IndexedDB is read from OPFS; there is no migration step.** The
   question (09:27 set): "On the web build, the main save, backups and images already live in IndexedDB. Only archived
   chats and v3 plugin save data are in the browser's file storage (OPFS), which upstream also writes. How should the
   fork handle them?" The answer: "IndexedDB, read old OPFS (Recommended)": "Everything new goes to IndexedDB only. When
   something isn't there yet, it is read from OPFS, so upstream's archived chats keep working with no migration step.
   OPFS is never written again, and the OPFS switch in Backup & Files goes away." The options not chosen were "Copy OPFS
   into IndexedDB once": "A one-time migration at startup. It needs about twice the free space while it runs, and has
   crash and two-tab cases to handle. It reaches the same end state with more risk."; and "Keep OPFS for archived data":
   "Only the main save goes through the new storage interface's browser store. Archived chats stay in OPFS, so two
   browser stores remain."
   - **Before this, the maintainer chose to have it sized first.** The question (08:57 set): "Cold storage (chats moved
     out of memory) and the recent memory work (boot archive pass, load-time listing, manual cleanup) store data in OPFS
     directly. Should "only keep IndexedDB" cover them too?" The answer: "Investigate first": "Have the investigator
     size both options (files touched, data migration, IndexedDB size limits on phones) before deciding." The options
     not chosen were "Yes, everything to IndexedDB (Recommended)" and "Main database only". The 09:27 answer above is the
     decision that followed the sizing (ledger rows 633 and 635).
3. **"155 MB" was a rough figure, not a limit.** The question (08:57 set): "You mentioned chats larger than 155 MB are
   rare. What does the 155 MB figure refer to (so the design rests on the right limit)?" The answer: "Typo or rough
   guess": "Not a specific limit; the point is that very large chats are rare." The options not chosen were "A browser
   size limit" and "Largest real chat seen". No size limit is therefore recorded from this answer.
4. **Placement, and the order inside it.** The question (08:57 set): "This is much bigger than CHORE-55's
   write-then-rename fix. Where should the storage interface go in the work order?" The answer: "Before steps 6 and 7
   (Recommended)": "Keep it in CHORE-55's slot (after CHORE-43/54, with CHORE-51/52/59), before memory steps 6 and 7,
   so the remaining memory work is built on the interface instead of on the old paths." The 09:31 set then asked when
   the write-then-rename fix (stage 0) should land: "Keep the order (Recommended)": "Finish CHORE-43/54 (its plan is in
   review now), then CHORE-51/52, then CHORE-55 with stage 0 first. It needs a crash mid-save plus an empty cache, so
   it's rare, and the fork isn't released." The options not chosen were "Right after CHORE-43/54": "Do stage 0 next,
   ahead of CHORE-51/52; the rest of the storage work stays in CHORE-55's slot." and "Now, before CHORE-43/54": "Pause
   CHORE-43/54 after its plan review and land stage 0 first." The question's own text said the fix is "about 60 lines"
   and that the next startup loads "the save with characters silently missing and never tries the backups"; those are
   the Orchestrator's statements of the evidence in the Roadmap's CHORE-55 entry, not the maintainer's.
5. **Hosted web users mostly run the Node server.** The question (09:27 set): "When users run 'hosted web', is that
   mostly the static web build (data in the browser) or the Docker/Node server (data on the server)? It decides how many
   people the archived-data change touches." The answer: "Mostly the Node server": "Docker or node server.cjs; the data
   lives on the server, so the browser-store change barely matters to them." The options not chosen were "Mostly static
   web" and "Both, or not sure".
6. **`fake-indexeddb` may be added as a dev-only dependency.** The question (09:27 set): "May I add fake-indexeddb as a
   dev-only dependency? It lets the tests run the real browser storage code against an in-memory IndexedDB instead of
   hand-written mocks. It isn't shipped in any build." The answer: "Yes, add it (Recommended)": "One devDependency in
   package.json and the lockfile; the browser store gets the same contract tests as the Tauri and Node stores." The
   option not chosen was "No, use mocks". It is not added by this entry.
7. **Inlays move under the interface in a later stage, together with CHORE-48.** The question (09:27 set): "Images
   pasted into chats (inlays) are kept in a separate browser store on every platform, Tauri included, and are never in a
   local backup (CHORE-48). Should they move under the new storage interface too?" The answer: "Later stage
   (Recommended)": "Plan it as a stage after the main save, assets and archived data, together with CHORE-48 (inlays in
   backups)." The options not chosen were "Leave them out" and "Include early".
8. **Cross-chat search through the interface is a later feature.** The maintainer's words in S1 (the sentence beginning
   "plus,"): "through that interface we can later add cross-chat search without changing the storage engine." It is not part of the first
   stages and is not scheduled; the library names in S1 are the maintainer's suggestion, not a decision.
9. **The question about a save that only partly decodes at startup is filed as CHORE-70, not scheduled.** The question
   (09:31 set; the clause is "startup accepts a save that only partly decodes"):
   "Separately from the cut-off write: on every platform, startup accepts a save that only partly decodes and uses it
   as-is, without checking whether a backup is complete. After stage 0 only disk damage would cause this, but it would
   still be silent. File a ticket to decide what startup should do then? For example, offer the newest complete backup,
   or load the partial save and say what is missing." The answer: "File a ticket (Recommended)": "New CHORE ticket, not
   scheduled; it goes with the CHORE-59 family (recovering from partly damaged saves). Nothing changes now." The options
   not chosen were "Fold into CHORE-55" and "Leave it". What startup should do is not decided.
10. **S2 is a question, not a decision.** The maintainer asked whether DB atomicity should be folded into the
    investigation. The Orchestrator folded it into the running sizing investigation as its question 9 (cross-file
    atomicity); what that found is in the Roadmap's CHORE-55 entry and ledger row 633. Whether a cross-file atomicity
    mechanism (such as a collector for orphaned blocks) is built is not decided.

**The Orchestrator's own calls** (not maintainer decisions):
1. The staging (stage 0 to stage 4, and later) is the `senior-advisor`'s recommended strategy (ledger row 635),
   accepted by the Orchestrator as the planning basis. **It is not a gated plan.** Each stage still needs its own plan,
   gates and tests, and the contract has not been written. The Roadmap's CHORE-55 entry lists it.

---

### MC-168 — The reroll history survives Settings, the character list and a theme change

- **Tag:** decision
- **Date:** 2026-10-02
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's answer to the question the Orchestrator asked with `AskUserQuestion` while the CHORE-43
  plan was being written (the 09:15 answer in the question log).
- **Reasoning:** the maintainer gave no reason beyond the answer. The reasons in the option text are the Orchestrator's.
- **Alternatives rejected:** "Forget them, as today".
- **Partly superseded by `MC-169`:** the chosen option's first sentence ends "until you send a new message there or
  reroll in another chat" (the option text goes on). Under `MC-169` a send or reroll in another chat no longer ends a
  chat's history, although the limit of 5 chats can still drop a history.
- **Related:** MC-100, MC-151, MC-169, CHORE-43, CHORE-54; commit `71e75d9d`; ledger rows 637 to 641.

**What was decided** (the question verbatim, then the answer and the option text):
1. **The left and right arrows keep stepping through the earlier replies after Settings, the character list or a theme
   change.** The question: "After you reroll a reply, then open Settings or the character list and come back to the
   chat, should the ← / → buttons still step through the earlier replies? Today they quietly forget them in that case
   (and on a theme change). They do remember them when you go Home or switch chats, which is where the wrong-chat bug
   comes from. The fix ties the remembered replies to the one chat they came from, so keeping them is safe either way."
   The answer: "Keep them (Recommended)": "← / → keep working for the chat you rerolled in, even after Settings, the
   character list or a theme change, until you send a new message there or reroll in another chat. Stored the same way
   unsent drafts already are. Never saved to disk." The option not chosen was "Forget them, as today": "Opening
   Settings, the character list or changing the theme still clears them. Slightly smaller change; same safety fix
   otherwise."

---

### MC-169 — Each recent chat keeps its own reroll history (the last 5 chats)

- **Tag:** decision (the maintainer's choice) and an Orchestrator call (the number 5 and the drop order)
- **Date:** 2026-10-02
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's answer to the question the Orchestrator asked with `AskUserQuestion` (the 09:21 answer in
  the question log). **The maintainer chose the option that was not the recommended one.**
- **Reasoning:** the maintainer gave no reason beyond the answer. The Orchestrator recommended "One chat is fine
  (Recommended)" as the smallest change; the maintainer chose the other.
- **Alternatives rejected:** "One chat is fine (Recommended)".
- **Supersedes:** `MC-100` 2 ("The reroll history stays per composer instance") for the history's ownership and
  lifetime. `MC-100` 1 (the composer lock) is unchanged.
- **Related:** MC-100, MC-168, CHORE-43, CHORE-54; commit `71e75d9d`, made at the maintainer's word "looks good to me. go
  ahead and commit."; ledger rows 637 to 641.

**What was decided** (the question verbatim, then the answer and the option text):
1. **Each recent chat keeps its own left and right history.** The question: "The ← / → history remembers one chat at a
   time, as today. That means sending a message in a different chat also replaces it, not only rerolling there. Example:
   reroll in chat A, go to chat B and send something, come back to A — ← no longer has A's earlier replies. Is that OK,
   or should it remember a few chats at once?" The answer: "Remember a few chats": "Each recent chat keeps its own ← /
   → history (for example the last 5 chats), so going back to A still works after sending in B. Slightly more memory
   (copies of the rerolled replies) and a bit more code." The option not chosen was "One chat is fine (Recommended)":
   "Smallest change and the same as today: any send or reroll elsewhere starts over. Memory use stays as it is."

**The Orchestrator's own calls** (not maintainer decisions; recorded in the Roadmap's CHORE-43 and CHORE-54 entries and in
ledger row 637):
1. The limit is 5 chats, and the least recently used is dropped first. The option text said "for example the last 5
   chats".
2. Continue ends its chat's history (plan invariant I14). `MC-168`'s option text does not name Continue; the
   Orchestrator kept the reset Continue has at the parent commit.

---

### MC-170 — The manual clean-up follows references inside archived chats (a missing or corrupt one is kept and the run carries on), cold-storage keys must be a safe file name, a plugin save over an archive that something else links is refused, and the guard's memory cost is kept with an index ticket (CHORE-71)

- **Tag:** decision (items 1 to 6, the maintainer's answers to `AskUserQuestion`), and the Orchestrator's own calls listed
  at the end (not maintainer decisions)
- **Date:** 2026-10-02
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's answers Q1 to Q5 and Q7 to the questions the Orchestrator asked with `AskUserQuestion`
  while CHORE-51 and CHORE-52 were investigated, planned and gated; Q6 is the commit approval. The question text and the
  chosen option labels are in the session scratchpad (`chore51\questions-1002b.txt`, not a repo file) and are quoted
  below. The reasons given in the questions and option texts are the Orchestrator's.
- **Reasoning:** for item 3, the reason put to the maintainer was that the app can never read anything out of a corrupt
  archived chat either, so a stop on one would repeat on every run and last until the snapshots that hold it rotate out.
  The decision stands on "stopping protects nothing reachable", not on how often corrupt archives occur. **That frequency
  is unknown:** Q5's wording to the maintainer overstated what the Gate 1 reviewer had found, and the reviewer had
  reported the size of that group as unknown. That wording is not repeated here and is not a finding.
- **Alternatives rejected** (the other options the Orchestrator offered):
  - item 1: "Stop the clean-up";
  - item 2: "Skip it and say so";
  - item 3: "Stop, and name the chat";
  - item 4: "UUID only";
  - item 5: "Own ticket, later" and "Leave it";
  - item 6: "Keep it, no ticket" and "Remove the guard".
- **Related:** MC-011, MC-016, MC-134, MC-139, MC-141, MC-147; CHORE-51, CHORE-52, CHORE-71, CHORE-72, CHORE-73; commit
  `59881788`, made at the maintainer's answer "Commit both (Recommended)" (Q6); ledger rows 642 to 657.

**What was decided** (each question as put to the maintainer, then the answer and, where the option had one, its text):
1. **A reachable archived chat that is not on disk is skipped by the manual clean-up.** It is kept by name, nothing is
   followed from it, and the run continues. Q1 (header "Missing chat"): "CHORE-51: the clean-up will now open archived
   chats to find other archives they point to. What should happen when one of those archived chats isn't on disk at all?
   (This can happen. The 'could not be loaded' text exists because a load once failed.)" The answer: "Skip it
   (Recommended)". The option not chosen was "Stop the clean-up".
2. **A reachable archived chat whose read fails with no known reason stops the clean-up before any deletion.** Q2 (header
   "Unreadable"): "CHORE-51: what if an archived chat exists but can't be read (a read error, or a corrupt file)?" The
   answer: "Stop before deleting (Recommended)". The option not chosen was "Skip it and say so". **Item 3 narrows this
   answer:** the corrupt file is no longer a stop.
3. **A corrupt archived chat (its bytes are present and do not decode) is kept, followed nowhere, and the clean-up carries
   on.** Only a read error with no explanation stops the run. Q5 (header "Corrupt chat", asked after Gate 1 round 1
   rejected the stop on a corrupt chat): "You chose \"stop before deleting\" when an archived chat can't be read. [One
   sentence omitted here: it stated a frequency for corrupt archives that the reviewer had reported as unknown; see
   Reasoning.]
   Upstream wrote the 'could not be loaded' text for exactly these. The app can never read anything out of them either:
   opening one shows 'damaged' and follows nothing. So stopping on one blocks every future clean-up and protects nothing.
   It also lasts until any of the last 20 snapshots that point to it rotate out, even after you delete the chat. How
   should a corrupt archived chat be handled?" The answer: "Keep it, carry on (Recommended)": "Keep the file, follow
   nothing from it, and continue the clean-up. Only an unexplained read error (one that might work next time) stops the
   run. That still covers your 'stop' answer for the case where data could really be hidden." The option not chosen was
   "Stop, and name the chat".
   - **Wider than the option text:** a read that fails with the kind "unavailable" (the page has no OPFS directory API at
     all) stops the run too. The listing taken at load throws first on such a page, so this is not expected to be reached
     in practice (stated in the plan, Revision 2, E5).
   - **Unchanged by this item:** a stub's blob that is missing, unreadable (any kind) or belongs to another character still
     stops the run, because blobs also decide which assets are kept.
4. **An archive key must be a safe file name.** Q3 (header "Key rule"): "CHORE-52: what rule should an archive key follow
   before it becomes a file name? Upstream has only ever pointed at UUID keys. It also left behind unreferenced
   '<uuid>_accessMeta' files (Mar 2025 to Apr 2026) that the clean-up should still be able to delete." The answer: "Safe
   file name (Recommended)": "A string, not empty, at most about 100 characters, with no / \ : or NUL. A key that fails
   reads as an error (never 'missing') and its write fails. Valid data behaves as it does now, and the _accessMeta
   orphans stay deletable." The option not chosen was "UUID only".
   - **How the rule was made exact** (the Orchestrator's calls inside this decision, see below): "about 100 characters"
     became 100 UTF-8 bytes, and the rejected set grew. A rejected key reads as an error of kind "damaged", not as a bare
     error, which is still an error and never "missing".
5. **The plugin overwrite is fixed in this change, with no format change.** A plugin save is refused when its target
   archive is linked from anything else in the database. Q4 (header "Overwrite"): "CHORE-52: a plugin (through
   setDatabase, with no prompt) or a crafted .bin can point a plugin's storage slot at another character's or chat's
   archive. The plugin's next save then overwrites that archive. A plugin can already overwrite any character in the
   database, so this isn't a new power, but the archive damage gets past the database checks. Fix it here?" The answer:
   "Fix it here, no format change (Recommended)": "A plugin save is refused when its target archive is linked from
   anything else in the database (a character, a chat link or error text, another plugin slot). No format change. It is
   not covered when the link sits only inside an unopened character archive." The options not chosen were "Own ticket,
   later" and "Leave it".
   - **The option text understated the gap.** The guard reads the live database only. It does not see a link held only
     inside any unopened archive (a character's or a chat's), or only in the saved main file or a snapshot. The
     Orchestrator reported this wider gap to the maintainer in chat before the commit approval (Q6).
6. **The guard's memory cost is accepted, and a low-priority ticket is filed for a cheaper way to find links.** Q7 (header
   "Guard cost"): "The plugin overwrite guard's memory cost: with archiving off, a profile keeps about 16 to 70 MB of
   extra wrappers after the first plugin save over an existing slot. What should happen?" The answer: "Keep it, file an
   index ticket (Recommended)". The options not chosen were "Keep it, no ticket" and "Remove the guard". The ticket is
   CHORE-71. The figures are measured on best-case hardware (an i9-class machine).
7. **The commit.** Q6 (header "Commit"): "Commit CHORE-51/52 now? This is one commit with the fact-checked message,
   followed by a records commit (MC-170, ledger rows from 642, Roadmap and Live-State). Nothing is pushed." The answer:
   "Commit both (Recommended)".

**The Orchestrator's own calls** (not maintainer decisions; recorded in the Roadmap's CHORE-51 and CHORE-52 entries and in
ledger rows 644 to 657):
1. The key rule's exact form: at most 100 UTF-8 bytes (the Node server's file-name limit is in bytes), well-formed UTF-16
   only, and none of `/ \ : < > " | ? *` or the characters U+0000 to U+001F. Every UUID key and every
   `<uuid>_accessMeta` key still passes. The maintainer's option text named only `/ \ :` and NUL. This was set after the
   plan review and is not case-folded (a Tauri case-folding alias is recorded, not closed).
2. A rejected key reads as an error of kind "damaged", so a chat's notice hides a Retry that cannot succeed and a restore
   shows its damaged-copy text. A rejected key that a chat names is kept by name and followed nowhere, and does not stop
   the clean-up; a rejected key on a stub's blob still stops it (the blob rule; plan R3).
3. On the desktop app, a read that fails without a kind counts as "missing" for the clean-up only when the listing taken at
   load held no unit and the folder check reports the units folder absent (Windows reports a read inside a missing
   folder as "os error 3"). This came out of Gate 2 and was made narrower in a second round.

**Not decided and recorded as out of scope** (the packet's list; none was put to the maintainer): a restore writes units
before the database commit and keeps them if the user cancels (designed); Tauri case folding of keys on NTFS and APFS is not
canonicalised; Windows reserved device names (`NUL`, `CON`) pass the key rule (reachable by crafted data only); a plugin's
`getItem` cross-read is not guarded.

---

### MC-171 — CHORE-55 stage 0 is committed as a code commit and then a records commit (nothing pushed); its Windows live check is recorded as not run and stays open; a toolchain-pinning ticket was offered and not chosen

- **Tag:** decision (items 1 to 3, the maintainer's answers to `AskUserQuestion`), and one item of information the
  Orchestrator gave in chat, listed at the end (not a decision)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's answers Q1 and Q2 to the two questions the Orchestrator asked with `AskUserQuestion` after
  CHORE-55 stage 0's Gate 2 had closed. The question and option texts are quoted below. The reasons in the option texts
  are the Orchestrator's.
- **Reasoning:** the reasons given in the option texts: for Q1, the records (Roadmap, ledger, Live-State) are written and
  fact-checked after the code is committed, as a second commit; for Q2, the Orchestrator cannot drive a native app window
  from its own environment, so the check waits for the next time the maintainer runs the desktop app on Windows.
- **Alternatives rejected** (the other options the Orchestrator offered):
  - item 1: "Code only" and "Hold";
  - item 2: "I'll run it now" and "Pin the Rust toolchain".
- **Related:** MC-167, MC-011, MC-089 2; CHORE-55; commit `d0decfb6` (CHORE-55 stage 0, local); the records commit that
  carries this file; ledger rows 658 to 665.

**What was decided** (each question as put to the maintainer, then the answer and its option text):
1. **Stage 0's code is committed first, and its records follow as a second commit. Nothing is pushed.** Q1: "CHORE-55
   stage 0 has passed both reviews and every check, and its commit message is fact-checked. How should I commit it?" The
   answer: "Commit both (Recommended)": "Commit the code now, then write and fact-check the records (Roadmap, ledger rows
   658 onward, Live-State) and commit them as a second commit. Nothing is pushed." The options not chosen were "Code
   only" and "Hold".
2. **Stage 0's live check on Windows is recorded as not run, and it stays open.** It is not a gate on stage 1. Q2: "So far
   the Windows rename has only been tried in a small Rust test program, never in the real desktop app. Should the desktop
   app be checked before stage 1 starts?" The answer: "Record as not run (Recommended)": "Note it as an open check in the
   Roadmap. It can be done whenever you next run the desktop app on Windows: save a few times, then restore a backup. I
   can't drive a native app window from here." The options not chosen were "I'll run it now" and "Pin the Rust toolchain".
3. **The option to file a ticket to pin the Rust toolchain in CI was offered and not chosen; no ticket is filed with this
   record.** Its text: "Also file a
   ticket to pin the Rust toolchain in CI, so the std rename behaviour the fix relies on can't change between builds."

**Information given to the maintainer in chat before Q1** (not a decision): a new loud failure mode was described to the
maintainer; the commit message of `d0decfb6` states it.

---

### MC-172 — CHORE-55 stage 1 is committed as a code commit and then a records commit (nothing pushed)

- **Tag:** decision (the maintainer's answer to `AskUserQuestion`)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's answer to the one question the Orchestrator asked with `AskUserQuestion` after CHORE-55
  stage 1's Gate 2 had closed and its commit message had been fact-checked. The question and option text are quoted
  below. The reason in the option text is the Orchestrator's.
- **Reasoning:** the reason given in the option text: the records (Roadmap, ledger, Live-State) are written and
  fact-checked after the code is committed, as a second commit.
- **Alternatives rejected** (the other options the Orchestrator offered): "Code only" and "Hold".
- **Related:** MC-167, MC-171, MC-011, MC-091; CHORE-55; commit `d95b07da` (CHORE-55 stage 1, local; its message states
  what it changed); the records commit that carries this file; ledger rows 666 to 678.

**What was decided:**
1. **Stage 1's code is committed first, and its records follow as a second commit. Nothing is pushed.** The question: "CHORE-55
   stage 1 has passed both reviews and every check, and its commit message is fact-checked. How should I commit it?" The
   answer: "Commit both (Recommended)": "Commit the code now, then write and fact-check the records (Roadmap, ledger rows
   666 onward, Live-State) and commit them as a second commit. Nothing is pushed." The options not chosen were "Code
   only" and "Hold".

---

### MC-173 — CHORE-55 stage 2: profiles whose main save is in OPFS are left until stage 4, a browser without IndexedDB stops with a message, the AGENTS.md Tauri line is corrected, and stage 2a is committed as a code commit and then a records commit (nothing pushed)

- **Tag:** decision (items 1, 2 and 4, the maintainer's answers to `AskUserQuestion`); item 3 is stated in chat
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's answers to three questions the Orchestrator asked with `AskUserQuestion` (items 1, 2 and 4),
  and two chat messages (item 3). The question and option texts are quoted below. The reasons in the option texts are the
  Orchestrator's.
- **Reasoning:** the reasons given in the option texts. For item 1, the copy into OPFS never removes a LocalForage key, so
  the LocalForage copy of an OPFS-main profile is stale (the Orchestrator's, from the stage 2 facts packet, ledger row
  680; the Orchestrator re-read `autoStorage.ts`). This qualifies `MC-167` 2's read-through for the stage 2 kinds; `MC-167`
  2 stands for cold units (stage 4). For item 4, the records are written and fact-checked after the code is committed.
- **Alternatives rejected** (the other options the Orchestrator offered):
  - item 1: "Copy back in stage 2" and "Stop with a notice";
  - item 2: "Keep the fallback";
  - item 4: "Code now, records after 2b" and "Hold until 2b".
- **Related:** MC-167, MC-171, MC-172, MC-011, MC-089, MC-091, MC-159; CHORE-55; commit `a29335f7` (CHORE-55 stage 2a,
  local; its message states what it changed); the records commit that carries this file and the `AGENTS.md` change;
  ledger rows 679 to 690.

**What was decided:**
1. **Browser profiles whose main save is in OPFS stay on OPFS until stage 4.** The question: "Some browser profiles keep
   the main save in the browser's file storage (OPFS): anyone who turned on the OPFS switch in Backup & Files, or an
   upstream user who set the flag by hand (upstream has no switch for it). For those profiles IndexedDB still holds an old
   copy of the save from before the switch, so stage 2's "read IndexedDB, fall back to OPFS" would start with that old
   save and overwrite the newer one on the next save. Stage 4 was already going to copy OPFS back into IndexedDB once when
   the switch goes away. What should stage 2 do for these profiles?" The answer: "Leave them until stage 4
   (Recommended)": "Profiles with the switch on keep saving and loading the main file and backups through OPFS exactly as
   today; everyone else moves to the new store. Stage 4 then copies them back and removes the switch. Stage 2 stays
   smaller, at the cost of one extra browser path for the save until stage 4." The options not chosen were "Copy back in
   stage 2" and "Stop with a notice".
2. **A browser without IndexedDB stops with a clear message after stage 2, instead of the silent fallback.** The
   question: "The new browser store uses IndexedDB only. Today, a browser without IndexedDB (very old browsers, some old
   private-browsing modes) silently falls back to a much smaller store that a real save usually doesn't fit in. What
   should happen there after stage 2?" The answer: "Say it can't save here (Recommended)": "The app starts with a clear
   message that this browser can't store RisuAI data, instead of the silent fallback. One store for every browser, all
   covered by the same tests." The option not chosen was "Keep the fallback". Note (the Orchestrator's, from Gate 1): one
   failed open of a pinned LocalForage instance looks the same as a missing IndexedDB, so the message says nothing was
   changed and to reload first.
3. **The `AGENTS.md` Tauri version line is corrected, and `AGENTS.md` is committed with the stage 2 records.** The
   maintainer, as typed: "also fix the AGENTS.md tauri version line while we are at it", then "commit agent.md with the
   stage 2 records". The Orchestrator corrected the line: the `tauri` crate is not pinned (`Cargo.toml` versions are
   minimums, and `Cargo.lock` is gitignored), and the JS packages are exact. The diff is the one Desktop bullet in "Project
   Overview".
4. **Stage 2a's code is committed first, and its records follow, with the `AGENTS.md` change, as a second commit. Nothing
   is pushed.** The question: "CHORE-55 part 2a has passed both reviews and all checks, and its commit message is
   fact-checked. How should I commit it? (Part 2b, remote blocks, comes next either way; nothing is pushed.)" The answer:
   "Code, then records (Recommended)": "Commit 2a's code now, then write and fact-check the records (your two answers
   today as MC-173, the Roadmap, ledger rows 679 onward, Live-State) and commit them together with the AGENTS.md fix as a
   second commit. Part 2b gets its own code and records commits later." The options not chosen were "Code now, records
   after 2b" and "Hold until 2b".

**The Orchestrator's call, not a maintainer decision:** the stage 2 read packet asked whether to accept the whole-file
memory cost or build a separately gated ranged path. It was not put to the maintainer, because both read routes cost the
same and stage 2 does not change the cost (ledger row 679).

---

### MC-174 — CHORE-55 stage 2b starts, and is committed as a code commit and then a records commit (nothing pushed)

- **Tag:** decision (item 2, the maintainer's answer to `AskUserQuestion`); item 1 is stated in chat
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** one chat message (item 1) and the maintainer's answer to the one question the Orchestrator asked with
  `AskUserQuestion` after stage 2b's Gate 2 had closed and its commit message had been checked (item 2). The question and
  option text are quoted below. The reason in the option text is the Orchestrator's.
- **Reasoning:** the reason given in the option text: the same order as stage 2a. The records are written and
  fact-checked after the code is committed, as a second commit.
- **Alternatives rejected** (the other options the Orchestrator offered): "One commit" and "Don't commit yet".
- **Related:** MC-167, MC-173; CHORE-55; commit `cbaeddd6` (CHORE-55 stage 2b, local; its message states what it
  changed); the records commit that carries this file; ledger rows 691 to 696.

**What was decided:**
1. **Stage 2b starts.** The maintainer, as typed after the context compaction: "resume the work order. start part 2b."
2. **Stage 2b's code is committed first, and its records follow as a second commit. Nothing is pushed.** The question:
   "Part 2b has passed review and its commit message is checked. How should I commit it?" The answer: "Code, then
   records (Recommended)": "Same as 2a: commit the code now (24 files, staged by name), then write the records (decision
   log, roadmap, ledger rows 691-694, live state), fact-check them and commit them separately." The options not chosen
   were "One commit" and "Don't commit yet".

### MC-175 — The compatibility invariant is a two-way round trip: a `.bin` backup moves between upstream and this fork in both directions; upstream need not read the fork's own storage

- **Tag:** stated in chat (a correction of how the campaign had read the compatibility invariant), and a request (item 2)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** two chat messages, quoted below. The first followed the Orchestrator's report that upstream's decoder reads
  only v1 `remotes/<chaId>.local.bin` pointers, so upstream cannot read this fork's v2 remote blocks from the fork's
  profile folder.
- **Reasoning:** the maintainer's own words in item 1.
- **Alternatives rejected:** none offered.
- **Related:** `AGENTS.md` ("AI Coding Agent Requirements": the compatibility invariant and the release-status bullet,
  updated by the Orchestrator at the maintainer's request); MC-011, MC-089 (the release framing that the invariant had
  been read with); MC-174; ledger row 697 (whether a `.bin` exported by this fork restores everything on upstream).

**What was decided:**
1. **The invariant is the round trip.** The maintainer, as typed: "correction: by the "upstream data must keep working in
   our fork", I meant "there must be a way to go back and forth between upstream and the fork. so .bin export/import that
   is compatible with upstream is enough for that condition." So a `.bin` backup exported by upstream must import into
   this fork, and one exported by this fork must import into upstream, with nothing lost. Upstream reading this fork's
   own storage directly (its profile folder, remote blocks or cold storage) is not required.
2. **`AGENTS.md` is updated to say so.** The maintainer, as typed: "yes, update the agents.md while we are at it." The
   Orchestrator kept, in the same sentence, the existing requirement that upstream characters, modules, presets, plugins
   and other supported integrations continue to work on this fork.

### MC-176 — Upstream's own `.bin` limits do not count against the round-trip invariant; the fork's export warns when the backup holds plugin data upstream will not restore (CHORE-74)

- **Tag:** decision (the maintainer's answers to `AskUserQuestion`)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's answers to three questions the Orchestrator asked with `AskUserQuestion` (item 3 holds the
  later two). The first came after the round-trip
  investigation (ledger row 697) found that a `.bin` exported by this fork and imported into upstream does not restore
  v3 plugin storage values that are not an array or an object with a `character` or `message` key. The question and
  option text are quoted below. The reason in the option text is the Orchestrator's.
- **Reasoning:** the reason given in the option text: upstream's own backups already lose these values, and the fork
  cannot change what upstream accepts.
- **Alternatives rejected:** "Treat as a blocker" ("Keep it open against the release. Only fixable by changing upstream,
  which this fork doesn't do, so it would stay open indefinitely."). The recommended option, "Accept, document it
  (Recommended)", was not chosen as offered; the answer took it as its base and added a ticket.
- **Related:** MC-175 (the round-trip invariant); MC-081 (an encrypted `.bin` is refused); CHORE-74; ledger row 697.

**What was decided:**
1. **Upstream's own limits are documented and do not count against the invariant (`MC-175`).** The question: "Under the
   round-trip rule, a fork .bin imported into upstream loses v3 plugin storage values that aren't lists or
   chat/character-shaped. Upstream's own backups already lose them and the fork can't change what upstream accepts. How
   should we treat it?" The answer: "Accept, warn at export": "Same, plus a new ticket: the fork's backup export tells
   the user when it holds plugin data that upstream will not restore. Small UI change, gated as usual." "Same" refers to
   the option "Accept, document it (Recommended)": "Record it (with upstream's non-.png asset drop) as upstream's own
   limits that don't count against the invariant; note them in the records and later in the wiki. No code change." The two
   limits are G1 (the plugin storage values above) and B1 (upstream's exporter drops assets that are not `.png`); both
   are described in ledger row 697.
2. **CHORE-74 is filed:** the fork's `.bin` export tells the user when the backup holds plugin data that upstream will not
   restore. The notes for the wiki come later, in the Wiki session's lane.
3. **CHORE-74 is LOW priority, and these records are committed now.** Two further `AskUserQuestion` answers: for "What
   priority should CHORE-74 (the export warning about plugin data upstream won't restore) carry?", "LOW (Recommended)"
   ("A small notice; no data is lost in the fork itself, only when moving a backup to upstream."; not chosen: "MEDIUM",
   "Leave unset"); for "The round-trip records (MC-176, ticket CHORE-74, ledger rows 697-699) are written and
   fact-checked. Commit them now?", "Commit now (Recommended)" (not chosen: "Hold them"). Nothing is pushed.

### MC-177 — CHORE-74 is not a release blocker; documentation (the wiki, later) is enough to clear its blocker, the G1-type plugin data loss; CHORE-55 stage 3 starts

- **Tag:** stated in chat (two items in one message)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** one chat message, quoted below. It followed the records commit for `MC-176`, in which the Roadmap and
  Live-State had placed CHORE-74 before release.
- **Reasoning:** the maintainer's own words in item 2: it is upstream behaviour.
- **Alternatives rejected:** none; this was stated directly, not chosen from options.
- **Supersedes:** the Orchestrator's reading of `MC-089` for CHORE-74, written in the Roadmap's CHORE-74 entry and in
  Live-State ("a release item", "before release"). That reading was the Orchestrator's, not a maintainer decision.
- **Amends:** `MC-089` 2, for CHORE-74 only: CHORE-74 no longer has to clear before release.
- **Related:** `MC-175`, `MC-176`, `MC-089`; CHORE-74; CHORE-55. `MC-177` is consistent with `MC-176` 1, which had
  already rejected "Treat as a blocker" for G1.

**What was decided:** the maintainer, as typed: "1. start stage 3" and "2. about chore-74, I think this shouldn't be a
release blocker at all. it's upstream behavior, so documentation(later wiki) would be enough to consider this blocker
cleared. instead, warning on chore-74 would be later QOL."
1. **CHORE-74 is not a release blocker.** It stays filed, open and unscheduled at LOW (`MC-176` 2 and 3). The export
   warning is a later quality-of-life item.
2. **Documentation is enough to clear CHORE-74's blocker.** The maintainer's words are about CHORE-74's blocker, which is
   the G1-type plugin data loss (v3 plugin storage values that upstream's import does not restore). They name the
   documentation as the wiki, later. They never name G1 or B1. Applying the same clearance to B1 (upstream's exporter
   drops assets that are not `.png`), which `MC-176` 1 groups with G1 as an upstream limit, is the Orchestrator's
   reading, not stated. The wiki is the Wiki session's lane (`docs/wiki/**`); the notes are owed to it and this session
   does not write them. The maintainer did not say whether the release must wait for the wiki page to exist; that is not
   stated.
3. **CHORE-55 stage 3 (assets) starts** on the maintainer's word, "start stage 3".

### MC-178 — CHORE-55 stage 3: restoring a `.bin` skips an asset entry the store refuses, restores everything else, and reports the skipped names

- **Tag:** decision (the maintainer's answer to an `AskUserQuestion`)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's answer to one question the Orchestrator asked with `AskUserQuestion` during CHORE-55 stage
  3. The question and the option text are quoted below. The reasons in the option text are the Orchestrator's.
- **Reasoning:** the reasons in the option text, which are the Orchestrator's, not the maintainer's.
- **Alternatives rejected:** "Rename and restore" ("Store it under a safe name and rewrite the database's reference to
  it. Keeps every asset, but adds a rename map to the restore path, which is more code in a data-loss-sensitive area.")
  and "Refuse the whole restore" ("Check every name before writing anything; if any is refused, stop with an error and
  write nothing. Safe, but one stray .DS_Store blocks a restore.").
- **Related:** CHORE-55 stage 3; `MC-175` (the two-way `.bin` round trip); `MC-167`.

**What was decided:** the question: "Stage 3 puts every asset write through the new store, which refuses unsafe file
names (empty or odd extensions, names starting with a dot like macOS's .DS_Store, characters Windows forbids). Restoring
a .bin writes each asset under the name stored in the file, so one such name would now stop the whole restore partway,
with some assets already written. Upstream .bin files only hold normal .png names, so in practice this is junk files the
fork's own export picked up from the assets folder. What should restore do with an entry the store refuses?" The answer:
"Skip and report (Recommended)": "Restore everything else, then show the user the list of entries that were skipped. A
skipped name that a character actually uses would show as a missing image."

### MC-179 — UI work moves to a separate session on `feat/ui-batch`; a records commit now; the branch is merged before memory step 6

- **Tag:** decision (the maintainer's notice, headed "NOTICE FROM THE MAINTAINER: UI work moves to a separate session;
  records commit; merge before memory step 6")
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's notice, five numbered items. The decisive sentences are quoted below; the rest is
  summarised.
- **Reasoning:** the notice gives a reason only for the merge rule (step 6 adds the busy registry to UI-lane files,
  Report 49 D17); none for the rest.
- **Alternatives rejected:** none; stated directly, not chosen from options.
- **Related:** `MC-177`, `MC-178`; CHORE-55 stages 3 and 4; memory step 6 (Report 49, D17); CHORE-68; CHORE-74.

**What was decided:**
1. **Delegation.** A separate UI session works on branch `feat/ui-batch`, in its own worktree (`C:\Projects\RisuAI-ui`),
   made from the records commit in item 2. The maintainer: "I will create the worktree myself. Do not run any `git
   worktree` command."
   - **Tickets moving to the UI session:** CHORE-11 (CD-1 to CD-5), CHORE-19, CHORE-20, CHORE-56, CHORE-69, CHORE-21,
     CHORE-44, CHORE-14 (UI-1 and UI-2), CHORE-15, CHORE-16 (PG-2 to PG-4), CHORE-12, CHORE-13, CHORE-23, CHORE-57,
     CHORE-05, CHORE-09, and the follow-up "a rejected avatar image shows no icon".
   - **Moving later:** "CHORE-68 and CHORE-74 also go to the UI session, but only after CHORE-55 stage 3 is committed and
     merged into its branch."
   - **Tickets staying with the Main Campaign:** CHORE-55 stages 3 and 4, CHORE-59, memory steps 6 and 7, CHORE-62,
     CHORE-58, CHORE-70, CHORE-48, CHORE-46, CHORE-49, CHORE-50, CHORE-65, CHORE-71 to 73, CHORE-04, CHORE-10, CHORE-60
     (with the Rebranding session), and the existing Wiki hand-offs.
   - **Roadmap entries:** "From now on, do not edit the delegated tickets' Roadmap entries. The UI session owns their
     status lines."
   - **The UI session's out-of-bounds list (the Main Campaign's lane):** `src/ts/storage/**`, `globalApi.svelte.ts`,
     `bootstrap.ts`, `src/ts/drive/**`, `risuSave.ts`, `coldstorage*.ts`, `process/memory/**`, `manualCleanup.ts`,
     `loadTimeListing.ts`, `assetSweep.ts`, `bootArchive*.ts`, `autoStorage.ts`, `opfsStorage.ts`, `nodeStorage.ts`,
     `StorageMaintenanceSettings.svelte`, `server/**`.
   - **The Main Campaign's out-of-bounds list (the UI lane), in return:** "keep stage 3, stage 4 and CHORE-59 out of the
     UI-lane files, except where your own work needs them": `CharConfig.svelte`, `AssetInput.svelte`,
     `ModuleMenu.svelte`, `inlayScreen.ts`, `tts.ts`, the Playground, `Chat.svelte`'s copy code, the mobile layout and
     `Settings.svelte`. "If you must touch one of them, keep the change minimal and list it in your report, so the merge
     is expected."
2. **A records commit, now.** Write MC-178 (the maintainer's restore answer, "Skip and report") so the number is used in
   order, and record this delegation as MC-179. Add the owed ledger rows (the MC-177 records and their fact-check, from
   row 700 on). Update Live-State: the commit list and count, the delegation and the UI lane, the reserved ranges, an
   empty block titled "UI session (feat/ui-batch)" that only that session edits, and the merge rule. Run `doc-verifier`
   on these records as usual. When the maintainer gives the word, commit only by explicit path:
   `Agents/Maintainer-Context.md`, `Agents/Roadmap.md`, `Agents/Live-State.md` and `Agents/Investigation-Ledger.md`.
   "Do NOT stage anything under src/. The 3a/3b changes are uncommitted and pre-Gate 2, and stay out of this commit."
   Check `git diff --cached --name-only` before committing, and tell the maintainer the commit hash, because the UI
   worktree is created from it.
3. **Reserved number ranges.** "Tell me before your range runs out; never take a number from the other range."

   | | Main Campaign | UI session |
   |---|---|---|
   | MC ids | MC-178 to MC-199 | MC-200 to MC-229 |
   | Ledger rows | 700 to 799 | 800 to 899 |
   | CHORE ids | CHORE-75 to CHORE-89 | CHORE-90 to CHORE-109 |
   | Reports | 57 to 64 | 65 to 74 |
4. **Merges.**
   - When stage 3 is committed, tell the maintainer. The maintainer will have its commits merged into `feat/ui-batch`,
     so the UI session can take CHORE-68 and CHORE-74.
   - "feat/ui-batch MUST be merged into fix/persistence-conflict-platform-hardening BEFORE memory step 6 begins." Step 6
     adds the busy registry to `AssetInput`, the emotion and image pickers, imports and exports, image generation, TTS
     and the composer draft guards (Report 49, D17).
   - "Before you start step 6 planning, check that this merge has happened. If it has not, stop and ask me."
   - The merge is done on the maintainer's word, by explicit merge, not rebase. Afterwards run `pnpm check`, the full
     suite and `pnpm build` on the merged tree, and record the result in the post-merge checks, as for `cfa4dfa0`.
   - Expected conflicts: appends in `Agents/Investigation-Ledger.md` and `src/lang/*.ts` (keep both sides); the two
     Live-State blocks (keep both).
5. **Shared resources.** `src/lang/*.ts`: both sessions add keys; add yours as one contiguous block (stage 3b's restore
   notice is one example). Live checks: the Main Campaign keeps port 6011 and `risuai-prod-scratch`; the UI session uses
   6012. "Never stop a process you did not start."

#### Amendment to MC-179 (2026-10-04): the Main Campaign's ledger rows continue at 1001

- **Tag:** decision (stated in chat), amending item 3's ledger-row range. The table in item 3 is kept as recorded.
- **Date:** 2026-10-04
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, in chat, after the Main Campaign's range 700 to 799 was used up by the CHORE-77 Stage C2 rows
  (ledger rows 793 to 799): "900-1000 is also used by ui session, so use 1001 and onwards."
- **What was decided:** the Main Campaign's next ledger rows are 1001 and onwards. Rows 800 to 899 stay the UI session's
  (item 3) and 900 to 1000 are also used by the UI session. Other ranges in item 3 are unchanged.
- **Context:** on 2026-10-03 the maintainer gave the UI session rows 900 to 1000. That grant was made to the UI session and is not
  recorded in this checkout's `Agents/` files.

### MC-180 — CHORE-55 stage 4: deleting a unit removes it from IndexedDB and OPFS; an OPFS profile is copied back at startup and falls back to OPFS with a notice; web archiving runs wherever IndexedDB works; the phone check runs on the maintainer's emulator; leftover OPFS copies are deleted at the next normal start; the copy-back wording says "browser storage"; stage 4 is committed as code, then records

- **Tag:** decision (items 2, 3, 4, 6 and 8, the maintainer's answers to `AskUserQuestion`); items 1, 5 and 7 are stated in chat (item 5 is a typed answer to a question that offered options)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** one chat message (item 1), the maintainer's answers to five questions the Orchestrator asked with
  `AskUserQuestion` (items 2, 3, 4, 6 and 8; item 5 was a typed answer to a sixth), and one chat message (item 7). The
  question and option texts are quoted below. The reasons in the option texts are the Orchestrator's, not the
  maintainer's.
- **Reasoning:** the reasons in the option texts.
- **Alternatives rejected** (the other options the Orchestrator offered):
  - item 2: "Never touch OPFS";
  - item 3: "Auto at startup, else stop" and "No copy, message only";
  - item 4: "Keep today's reach";
  - item 5: "Record as not run (Recommended)" and "I'll run it" (the maintainer typed an answer instead);
  - item 6: "Delete right after copy" and "Keep them, file a ticket";
  - item 8: "Hold".
- **Amends:** `MC-167` 2, in how its "OPFS is never written again" is read: deletions in OPFS are allowed (item 2), and
  a page whose copy-back could not run still writes to OPFS (item 3's option text: "start from OPFS this time as
  today"). New data goes to OPFS only from such a page.
- **Related:** `MC-167`, `MC-170`, `MC-173`, `MC-175`, `MC-011`, `MC-179`; CHORE-55 stage 4; commit `980791fa` (local;
  its message states what it changed); the records commit that carries this file; ledger rows 718 to 733.

**What was decided** (the dates are 2026-10-03):
1. **Stage 4 starts.** The maintainer, as typed: "start CHORE-55 stage 4".
2. **Deleting an archived chat or plugin slot removes it from OPFS too.** The question ("OPFS delete"): "Stage 4 keeps
   old archived chats readable from OPFS when they aren't in IndexedDB yet. But if deleting one removes only the
   IndexedDB copy, the OPFS copy comes back on the next read, and the manual clean-up can never free that space. May the
   fork delete files in OPFS (it still never writes new data there)?" The answer: "Delete in both (Recommended)":
   "Deleting an archived chat or plugin slot removes it from IndexedDB and from OPFS. OPFS gets no new data, only
   deletions. Clean-up frees the old space and deleted items never come back." The option not chosen was "Never touch
   OPFS".
3. **At startup an OPFS-main profile is copied back into IndexedDB, with a fallback.** The question ("Copy-back"):
   "Profiles whose main save is in OPFS (the switch in Backup & Files, or a flag an upstream user set by hand) must be
   moved back to IndexedDB when the switch goes away. Today the only copy-back is the switch's 'turn off' button;
   nothing does it at startup. What should stage 4 do?" The answer: "Auto at startup, fall back (Recommended)": "At
   startup, copy the OPFS save back into IndexedDB once (one tab at a time, checked before the flag is cleared). If it
   can't run (another tab open, not enough space), start from OPFS this time as today, show a notice, and try again next
   start. Data is never lost, but the old OPFS save path stays in the code as the fallback." The options not chosen were
   "Auto at startup, else stop" and "No copy, message only".
4. **Web archiving runs wherever IndexedDB works.** The question ("Archive gate"): "In browsers, archiving old chats
   (moving them out of memory at startup) only runs where the browser can write OPFS files. Once archives go to
   IndexedDB, that check no longer fits. Where should archiving run?" The answer: "Wherever IndexedDB works
   (Recommended)": "Archiving runs in every browser that can store data, which adds browsers without OPFS file writing,
   including some phones. Phones are where the memory saving matters most, but they get the boot archive pass for the
   first time." The option not chosen was "Keep today's reach".
5. **The phone check runs on the maintainer's emulator.** The Orchestrator offered "Record as not run (Recommended)"
   and "I'll run it". The maintainer typed instead: "I have avd installed, with virtual 2gb device.(Pixel_6a_LowRam).
   see if we can use that." The outcome is a fact, not a decision: `perf-analyzer` ran it on that emulator (ledger row
   719; the Roadmap's CHORE-55 stage 4 block has the figures).
6. **The OPFS copies left after a copy-back are deleted at the next normal start.** The question ("OPFS leftover"):
   "After a successful copy-back, the profile's old OPFS files (main save, backups, images) stay in OPFS. The reviewer
   points out the cost: that space (as large as the whole profile) is never freed, there's no button to free it, and
   every start still has to walk past those files when it lists old archived chats. What should happen to them?" The
   answer: "Delete after next start (Recommended)": "Keep them through the copy-back. At the first later start that
   loads normally from IndexedDB, delete the old OPFS copies (not archived chats that are only in OPFS). The data has
   then been used from IndexedDB once, so the copy is proven before the fallback goes." The options not chosen were
   "Delete right after copy" and "Keep them, file a ticket".
7. **The English copy-back strings say "browser storage".** The maintainer, as typed: "use "browser storage" instead of
   "main storage" in english. I think that explains this better." The six translations followed.
8. **Stage 4's code is committed first, and its records follow as a second commit. Nothing is pushed.** The question
   ("Commit 4"): "CHORE-55 stage 4 has passed both reviews and all checks, and its commit message is fact-checked. How
   should I commit it?" The answer: "Code, then records (Recommended)": "Commit stage 4's code now (by explicit path,
   about 70 files under src/), then write and fact-check the records (MC-180 with your answers today, Roadmap, ledger
   rows from 718, Live-State, AGENTS.md's data-layer paragraph about the OPFS flag) and commit them as a second commit.
   Nothing is pushed." The option not chosen was "Hold". The code commit staged 65 paths; "about 70" was the question's
   estimate.

**The Orchestrator's own calls, not maintainer decisions:**
- O1: Node unit writes keep the per-key conflict refusal.
- O2: the cold-key rule stays, and a store refusal reads as damaged.
- O4: no archive pass runs on a fallback page.
- O5: an OPFS-authoritative profile with no OPFS main file clears the flag and uses IndexedDB.
- E-3: a failed IndexedDB open or deciding read is a loud boot failure; the fallback to OPFS applies only when IndexedDB
  is unsupported.
- F3: the restart cost of an interrupted copy-back is accepted (no resume).

---

### MC-181 — CHORE-55 is no longer a release blocker

- **Tag:** decision (stated in chat)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's chat message, in answer to the Orchestrator's report that CHORE-55 stages 0 to 4 are done and
  that no record stated whether CHORE-55's release blocker was closed.
- **Reasoning:** none given.
- **Alternatives rejected:** none (not chosen from options).
- **Related:** `MC-089` (2: nothing ships until every current ticket is cleared), `MC-167`, `MC-180`; CHORE-55; commits
  `d0decfb6` (stage 0) and `980791fa` (stage 4); ledger rows 734 and 735.

**What was decided:**
1. **CHORE-55 no longer blocks the first release.** The maintainer, as typed: "CHORE-55 is no longer a release blocker".
   This clears CHORE-55 from the set of tickets that must be cleared before release. `MC-089` 2 says the fork does not ship
   until every current ticket is cleared; this decision removes CHORE-55 from that set and does not change `MC-089` for any
   other ticket.
2. **What this does not say.** The maintainer did not say CHORE-55 is closed, and did not cancel its later stages (stage 5
   or later: inlays with CHORE-48, the search index, CHORE-46's streaming). The Roadmap's CHORE-55 entry lists them as not
   scheduled, and they stay as later work. The stage 0 Windows live check recorded as not run (`MC-171` 2) stays open;
   this decision does not change it.

---

### MC-182 — CHORE-59 starts, and CHORE-58 goes right after it, ahead of memory steps 6 and 7 and CHORE-62

- **Tag:** decision (stated in chat)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's chat message.
- **Reasoning:** the maintainer's own words give it: the PNG import problem "could be huge UX problem" if it is real. Whether it is
  real is not yet measured (Roadmap CHORE-58: TRACED in source; replica timings only).
- **Alternatives rejected:** none (not chosen from options).
- **Amends:** `MC-151` 8 (CHORE-58 "goes last in the current work order"), and the order restated in `MC-152`, `MC-159` 1 and
  `MC-160` 1 ("after steps 6 and 7 and before CHORE-58"). Those entries stay as written; this entry governs where they
  differ. CHORE-62's own placement after steps 6 and 7 (`MC-160` 1) is unchanged; only CHORE-58 moved ahead of it.
- **Related:** `MC-151`, `MC-152`, `MC-159`, `MC-160`, `MC-179` 4, `MC-183`; CHORE-58; CHORE-59; CHORE-62.

**What was decided:**
1. **CHORE-59 starts, and CHORE-58 is next.** The maintainer, as typed: "start CHORE-59, and do chore-58 next, as it could be
   huge UX problem if PNG buffer issue is real."
2. **The work order is now:** CHORE-59; then CHORE-58 (measure first, as in the Roadmap's CHORE-58 entry); then memory steps 6
   and 7; then CHORE-62.
3. **What this does not change.** Memory step 6 still waits for `feat/ui-batch` to be merged (`MC-179` 4: "feat/ui-batch MUST
   be merged into fix/persistence-conflict-platform-hardening BEFORE memory step 6 begins"). CHORE-58 is in the Main
   Campaign's lane (`MC-179` 1).

---

### MC-183 — CHORE-59: any part of a partly damaged snapshot but the root is offered, from that snapshot only, after a confirm that lists what is left out; every load keeps the current data as a numbered backup first

- **Tag:** decision (the maintainer's four answers to a multiple-choice question; each chosen option was the one the Orchestrator
  marked "(Recommended)")
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's answers to the four questions the Orchestrator asked after the CHORE-59 investigation (ledger row
  736). The option labels are quoted below. The full question and option texts are not in the records available to this entry:
  `TODO(evidence)`: the verbatim question and option texts. The wording of items 1 to 4 below is the Orchestrator's plan wording
  for the chosen option, not the maintainer's.
- **Reasoning:** the maintainer gave no reason beyond the answers. The reasons in the option texts are the Orchestrator's.
- **Alternatives rejected:** the other options the Orchestrator offered on each question. Their labels are not in the available
  records: `TODO(evidence)`.
- **Extends:** `MC-152` 1 ("5b: yes, there should be a option to load other data that is intact."), which left the four points
  below "for the item's own plan and gate".
- **Related:** `MC-152`, `MC-175` (the `.bin` round trip with upstream), `MC-011` (no fork userbase), `MC-182`; CHORE-59; commit
  `4801a2f9` (local; its message states what it changed); ledger rows 736 to 747.

**What was decided** (the dates are 2026-10-03):
1. **Scope: "Any part but the root (Recommended)".** A missing or damaged character is left out on its own. Presets, modules,
   loadouts, plugins and plugin data are each one block, so damage to one leaves out all of that kind (presets fall back to the
   default preset). A damaged root, framing damage and an unknown format version stay refused whole.
2. **Source: "This snapshot only (Recommended)".** A partial load uses only what the snapshot holds and the remote character
   files it points to in storage. It reads nothing from the block cache. A v1 `.local.bin` remote file is read as it is stored
   now, which may be newer than the snapshot.
3. **Offer: "Confirm with a list first (Recommended)".** Before anything is written, the user is shown what would be left out and
   chooses Load or Cancel. A character is named from another copy that knows it (the current data), otherwise by its id.
   Cancel writes nothing.
4. **Keep current: "Yes, for every load (Recommended)".** Before a load writes the main file, whether the load is partial or
   full, the current main file is saved as a new numbered internal backup, so the load can be undone from the same list.

**The Orchestrator's own calls, not maintainer decisions:**
- O1: a cold-storage unit or an asset that a loaded character refers to, and that is missing, is not "affected" and is out of
  scope (neither decoder looks at it).
- O2: a snapshot that decodes strictly is still written as its exact bytes; only a partial load writes a rebuilt main file.
- O3: a left-out character is named from the page's current in-memory data only; if that data does not hold the id, the id is
  shown.

---

### MC-184 — CHORE-58: keep the exact percentage

- **Tag:** decision (stated in chat)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's chat message, before Gate 1 (the plan's Revision 0 already cites it). The question it answered is not in
  the records available to this entry: `TODO(evidence)`: the verbatim question.
- **Reasoning:** none given beyond the words below.
- **Alternatives rejected:** none stated by the maintainer. The Roadmap's CHORE-58 entry listed, as a non-normative shape, a
  progress figure of bytes read over file size; "keep the exact percentage" is read as not taking it.
- **Related:** `MC-182`, `MC-175` (the `.bin` round trip and upstream-compatible cards), `MC-003` (the hardware floor); CHORE-58;
  commit `282b2da5`; ledger rows 748 to 758.

**What was decided:**
1. **The maintainer approved the fix plan (Revision 0, before Gate 1) and asked to keep the exact percentage.** As typed: "go
   ahead with the fix plan, keep the exact percentage."
2. **Implemented as:** the import progress keeps the exact asset-count percentage. The counting prereader in
   `importCharacterProcess` stays, so the percentage is computed from the number of assets as before. This item is how the
   request was implemented, not a further maintainer statement.

---

### MC-185 — CHORE-58 is committed; CHORE-76 and CHORE-77 are taken up while `feat/ui-batch` is unmerged

- **Tag:** decision (stated in chat), with one direction proposed and not yet decided (item 3)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's chat message, sent after CHORE-58's implementation was finished and reviewed.
- **Reasoning:** the maintainer's own words give it: the UI session "needs more time", so "we can use this spare time".
- **Alternatives rejected:** none (not chosen from options).
- **Amends:** the work order of `MC-182` (CHORE-59, CHORE-58, memory steps 6 and 7, CHORE-62): CHORE-76 and CHORE-77 are inserted
  after CHORE-58 and before steps 6 and 7. `MC-182` stays as written; this entry governs where they differ.
- **Related:** `MC-179` 4 (the `feat/ui-batch` merge before step 6), `MC-182`, `MC-184`; CHORE-58; CHORE-76; CHORE-77; commit
  `282b2da5`.

**What was decided:** the maintainer, as typed: "yes commit both, but since UI session needs more time, I think we can use this
spare time to tackle truncation issue and Realm PNG download being held in memory. what if we download them as temporary file
instead of holding it in memory?"
1. **Commit CHORE-58's code and its records.** The code is `282b2da5`. The records are this records commit, which follows it.
2. **Two new tickets go ahead of memory steps 6 and 7, while `feat/ui-batch` is unmerged:** CHORE-76 (the "truncation issue":
   a PNG card cut short inside a tEXt chunk) and CHORE-77 (the Realm PNG download held in memory, in the maintainer's words; the hold is measured in Node streams and not in a browser, Roadmap CHORE-77). Memory step 6 still waits for
   the `feat/ui-batch` merge (`MC-179` 4).
3. **Direction proposed for CHORE-77, not yet a decided mechanism.** The maintainer asked "what if we download them as temporary
   file instead of holding it in memory?". It is to be investigated per platform (web, Tauri, Node server) before a plan. What
   the platforms allow is not yet established.

---

### MC-186 — CHORE-76 and CHORE-77: the Realm download is a browser Blob, a cut card is refused, and the work is split

- **Tag:** decision (chosen from options put by the Orchestrator)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's answers to four questions the Orchestrator put on CHORE-76 and CHORE-77, as chosen options. The
  question texts, as the Orchestrator supplied them for this entry:
  - Q1: "CHORE-77 (a Realm PNG kept in memory during import): how should the download be held?"
  - Q2: "Realm .charx downloads are also loaded whole into memory, through a different path (zip). Include them in CHORE-77?"
  - Q3: "CHORE-76 (truncated cards): what should an import do with a card that ends early?"
  - Q4 (asked after Gate 1 round 1): "A .charx (zip) cut short at certain points, such as between two files inside it, currently
    imports without error and just lacks a file. Before anything is saved, the import could check the zip's closing directory,
    which sits at the very end. That catches every cut, but it also refuses a zip cut only in that closing directory, where every
    file is in fact intact. Which do you want?" The question itself said that it refuses such a zip.

  Item 5 is the maintainer's own words in chat, as relayed by the Orchestrator.
- **Reasoning:** none recorded beyond the option labels and item 5.
- **Alternatives rejected:** Q1: "Blob + desktop temp file" and "Download it twice" (the chosen option was "Browser blob, all
  (Recommended)"). Q2: "Separate ticket (Recommended)" was the recommended option; the maintainer chose "Include in CHORE-77".
  Q3: "Refuse any early end" and "Import with a warning" (the chosen option was "Refuse if data missing (Recommended)"). Q4:
  "Known gap" (the chosen option was "Check the end (Recommended)").
- **Related:** `MC-175`, `MC-184`, `MC-185`, `MC-179`, `MC-091` (the scope amendment of item 6); CHORE-76; CHORE-77; commit
  `6173f58a`; ledger rows 759 to 772.

**What was decided:**
1. **CHORE-77, how the Realm download is held. Chosen option: "Browser blob, all".** The download is held as a browser Blob.
2. **Realm `.charx`. Chosen option: "Include in CHORE-77".** The Realm `.charx` download is in CHORE-77's scope.
3. **A truncated PNG. Chosen option: "Refuse if data missing".** Refuse a card that ends early, with a clear message, when its
   character data or a referenced asset is missing.
4. **A truncated `.charx`. Chosen option: "Check the end".** Check the zip's closing directory before anything is saved. For Stage
   B.
5. **The translations of `cardFileIncomplete` are approved.** The maintainer said Korean users widely use "임포트" (import);
   "불러오기" would also work but would mean rephrasing other strings, which they want to avoid.
6. **The work is split (Orchestrator's record, `MC-091` scope amendment; not a maintainer statement).** It was recorded at the
   `senior-advisor` escalation after three Gate 1 `[REJECT]` rounds on the combined plan (ledger rows 761 to 764). Stage A, the PNG
   half, was committed as `6173f58a`. Stage B, the `.charx` half, is next and needs its own plan and Gate 1.

**Orchestrator's implementation notes (not maintainer statements):**
- Item 1 is read as "all" meaning web and Tauri alike: the download is held as a browser Blob on both and read twice, the first
  read counting the assets by skipping their bodies, so the exact percentage stays (`MC-184`). No Tauri temporary file.
- Item 3 is implemented as: refuse with the new message; the in-memory path no longer saves a half-written asset. What counts as
  "cut" is the per-kind rule below, as `PngChunk.scanCard` implements it.
- Item 4 is stricter than the PNG rule: it refuses any `.charx` whose end-of-central-directory record is missing or cut, including
  a zip cut only in that record, where every file is intact (the question said so).
- The accepted rule for Stage A is per chunk kind. A `tEXt` chunk is whole when its body is complete, and its CRC may be cut. Any
  other chunk before `IEND` also needs its CRC, since it is copied into the stored image. A file that ends inside `IEND`'s header,
  or right before `IEND`, is whole. A file with neither a `chara` nor a `ccv3` key is refused before any save.
- The residual: a card cut exactly at a chunk boundary reads as whole. So does a cut that leaves 1 to 7 bytes at a chunk boundary
  when they are a prefix of `00 00 00 00 49 45 4E 44` (`IEND_HEADER` in `PngChunk.scanCard`, `src/ts/pngChunk.ts`): 1 to 4
  bytes, all zero, of a header; or 5 to 7 bytes that are `00 00 00 00` followed by `49`, `49 45` or `49 45 4E` (an empty chunk
  whose type begins with "I", "IE" or "IEN"). The commit message's "1 to 3 bytes" understates this bound (checked against
  `scanCard` in the working tree at `6173f58a`). A later missing asset then fails with "asset N not found" after the earlier
  assets were saved. A card that stores its character data before the image data (not RisuAI's own export order) and is cut inside a later
  image chunk imports with a truncated image and no error.

---

### MC-187 — CHORE-77 follow-ups: a limit on files inside a .charx, the PWA share path, and the other whole-card downloads

- **Tag:** decision (chosen from options put by the Orchestrator)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's answers to six questions the Orchestrator put on the CHORE-77 follow-ups (the `.charx` save backlog
  and the 50 MB cap; `#share_character`), as chosen options. The question texts, as the Orchestrator supplied them for this entry:
  - Q1: "When a file inside a .charx is over 50 MB (an image, the card's data file, or its module file), what should the import do?
    Today an oversized image or module is dropped with no message, so a card can import without its scripts and lorebook."
  - Q2: "Sharing a file to the installed web app is broken at three separate points, so the #share_character fix can't be tested.
    What should happen to it?"
  - Q3: "Should the memory fix (a) also cover the other downloads that still load a whole card into memory (#import= links and Chub
    links)?"
  - Q4 (a follow-up to Q1, asked because the Orchestrator found that upstream imports such a card and quietly drops the over-50 MB
    file, so "refuse whole card" would refuse a card upstream imports; `MC-175`): "How should the limit work?" The option
    "Raise the limit" was described as: raise or remove the 50 MB limit for images and videos, keeping memory bounded by
    streaming; card data and module over the limit still refuse.
  - Q5: "What should the new limit for a single image or video inside a .charx be?"
  - Q6: "If an image or video is still over the new limit, what happens?"
- **Reasoning:** none recorded beyond the option labels.
- **Alternatives rejected:** Q1: "Import and warn" and "Refuse only data/module" (the chosen option was "Refuse whole card
  (Recommended)", later changed in effect by Q4). Q2: "File a ticket (Recommended)" was the recommended option; the maintainer
  chose "Repair now"; "Remove it" was also rejected. Q3: "Charx fix only (Recommended)" was the recommended option; the maintainer
  chose "Include them". Q4: "Refuse anyway" and "Refuse data, warn asset (Recommended)". Q5: "100 MB" and "No limit". Q6: "Refuse
  the card".
- **Related:** `MC-175`, `MC-184`, `MC-186`, `MC-179`, `MC-011`; CHORE-77; ledger row 783.

**What was decided (chosen option labels, quoted):**
1. **Q1. Chosen: "Refuse whole card (Recommended)".**
2. **Q2. Chosen: "Repair now".**
3. **Q3. Chosen: "Include them".**
4. **Q4. Chosen: "Raise the limit".**
5. **Q5. Chosen: "200 MB (Recommended)".**
6. **Q6. Chosen: "Import, name what's left out (Recommended)".**

**As the Orchestrator reads it (a reading, not a maintainer statement):** `card.json` and `module.risum` keep the 50 MB limit, and
a card with either over it is refused. An image or video asset inside a `.charx` has a limit of 200 MB; an asset over 200 MB is
skipped, and the user is told which file. The PWA share path is repaired now. The `#import=` and Chub downloads are included in
the memory fix.

**Orchestrator's implementation notes (not maintainer statements):**
- The work is two stages. Stage C1 is `processzip`: a bounded save backlog, streaming size limits, and the outcomes above; it has
  an `opus-reviewer` Gate 1. Stage C2 is the share-path repair and the `#import=` and Chub downloads read as a Blob; it has its own
  plan.
- The Orchestrator's plan proposes refusing before any save, by reading the zip's central directory. This is pending Gate 1.

#### Amendment to MC-187 (2026-10-03): the first round rested on a false premise, and the limit questions were re-asked

- **Tag:** decision (chosen from options put by the Orchestrator), amending the round above. The round above is kept as recorded.
- **Date:** 2026-10-03
- **The false premise.** In Q1 and Q4 the Orchestrator said an over-50 MB asset is dropped with no message, and that upstream
  imports such a card without it. Gate 1 of Stage C1 traced and ran this at HEAD `0df2e266`, and read upstream `f9728b14` by
  source. For any asset that `card.json` references, both the fork and upstream throw "Error while importing, asset <key> not
  found" from `importCharacterCardSpec`, after the card's other assets have been saved. Only a file the card does not reference is
  dropped silently. The `module.risum` outcome stated in round 1 was true; an over-50 MB `card.json` gave `noData`, after the assets were saved.
- **The re-ask (2026-10-03, with the correction).** The two questions, with the chosen option first:
  - Q7: "Correction: I told you an over-50 MB image is quietly dropped and that upstream imports such a card without it. That was
    wrong for any image the card actually uses. Both upstream and this fork refuse the whole card with "asset … not found", after
    already saving the card's other assets. With that corrected, what should happen to an image or video over the new limit?"
    Chosen: "Refuse before saving (Recommended)". The other option was "Import without it".
  - Q8: "The limit's real memory cost is higher than I said. Today a 200 MB asset takes about 3.3x its size (about 0.7 GB) while it
    saves. Sizing the buffer exactly from the zip's file list brings that to about 2x (about 0.4 GB). Which limit for one image or
    video?" Chosen: "200 MB, exact sizing (Recommended)". The other options were "100 MB, exact sizing" and "Keep 50 MB".
  - Q9 (asked 2026-10-03, after Gate 1 round 2 of Stage C1 raised it as a maintainer decision, finding N2): "A .charx can
    contain a file over 200 MB that the card never uses (only hand-repacked cards; RisuAI's own export never writes one).
    Upstream and today's fork import such a card and silently drop that file. What should this fork do?" Chosen: "Refuse the
    card (Recommended)". The other option was "Drop it like upstream".
- **What now stands, as the Orchestrator reads it (a reading, not a maintainer statement):**
  - `card.json` and `module.risum` have a 50 MB limit; an image or video has a 200 MB limit.
  - Any entry over its limit refuses the card, with a message naming the file. The refusal comes before anything is saved when
    the zip's central directory is readable; otherwise it comes while the entry streams in, and assets saved before that point
    remain. Round 1's "Import, name what's left out" (Q6) is superseded: nothing is skipped.
  - This includes a file the card never uses (Q9): such a card is refused, although upstream and today's fork import it and drop
    that file.
  - Exact buffer sizing is part of the work. As implemented in `96ffb490` it is an exact-length join of the copied chunks, not
    preallocation from the central directory's declared size (see the Roadmap CHORE-77 entry).
  - The share-path repair (Q2) and the inclusion of the `#import=` and Chub downloads (Q3) are unchanged.
- **Orchestrator's implementation note (not a maintainer statement):** a `.charx` holding an unreferenced file over 200 MB, which
  upstream and HEAD drop silently today, would now be refused. RisuAI's exporter never writes one. This is recorded in the plan
  for Gate 1.

---

### MC-188 — CHORE-77 Stage C2: which file types the PWA share target accepts

- **Tag:** decision (chosen from options put by the Orchestrator)
- **Date:** 2026-10-04
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's answer to one question the Orchestrator put after the Stage C2 investigation (ledger row 792). The
  question text, as the Orchestrator supplied it for this entry: "Sharing a file to the installed web app (Android/ChromeOS share
  sheet) never worked, here or upstream. The app's manifest only offers RisuAI as a share target for .charx, .risup and .risum
  files, so a PNG card or a .json card shared from a phone's gallery or files app never shows RisuAI as a destination. When I
  repair it, which file types should the share target accept?"
- **Reasoning:** none recorded beyond the option label.
- **Alternatives rejected:** "Keep the three (Recommended)": "Repair only: .charx cards, .risup presets and .risum modules.
  Smallest change; matches what the manifest already declares and what upstream intended."
- **Related:** `MC-187`, `MC-175`; CHORE-77; ledger row 792.

**What was decided (chosen option label, quoted):** **Chosen: "Add PNG/JPEG/JSON cards".** The option was described to the
maintainer as: "Also accept .png, .jpg/.jpeg and .json character cards through share. More useful on a phone (cards are often
saved as images), but widens what the share sheet offers RisuAI for: any shared PNG would list RisuAI as a target."

---

### MC-189 — CHORE-77 Stage C2: the share target also accepts files of unknown type

- **Tag:** decision (chosen from options put by the Orchestrator)
- **Date:** 2026-10-04
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's answer to question Q-A, which the Stage C2 Gate 1 reviewer raised in round 1 (ledger row 793) and the
  Orchestrator put to the maintainer. The premise given with the question: on Android, Chromium routes a shared file by the
  extension in the content URI or by its MIME type, so a `.charx`, `.risum` or `.risup` from another app often arrives typed
  `application/octet-stream` (the reviewer's inference from Android's `MimeTypeMap`; neither this nor the Chromium reading was run on a device). The reviewer read this in Chromium source (`WebApkShareTargetUtil` and `MimeTypeFilter`); it was
  not run on a device. The question text, as the Orchestrator supplied it for this entry: "On Android, Chrome matches a shared file against the share target's accept list by the extension in the sending app's file URI (which often has none), or by MIME type. A .charx, .risum or .risup shared from a file manager or chat app usually arrives as application/octet-stream, so with an extension-only list, RisuAI often won't appear in the share sheet at all. (The reviewer read this in Chromium source but did not test it on a device.) How should the share target accept these files?" The options were "Also accept octet-stream (Recommended)" and "Extensions only".
- **Reasoning:** none recorded beyond the option label.
- **Alternatives rejected:** "Extensions only" (sharing a `.charx`, `.risup` or `.risum` then depends on the sending app).
- **Related:** `MC-188`, `MC-187`, `MC-175`, `MC-179`; CHORE-77; ledger rows 793 to 795.

**What was decided (chosen option label, quoted):** **Chosen: "Also accept octet-stream (Recommended)".** The share target also
accepts `application/octet-stream` and `application/zip`, so RisuAI appears for files of unknown type. The page sorts files by
name suffix and reports any file it cannot use.

As implemented (the Orchestrator's addition, not a maintainer statement): the character field also accepts `application/zip`, and, at Gate 1's optional suggestion, `application/x-zip-compressed` (ledger rows 793 to 795).

---

### MC-190 — Idea: an API-key field could hold an environment-variable reference instead of the key

- **Tag:** idea stated in chat. It is not a decision to implement now; the maintainer placed it in a later, unscheduled section.
- **Date:** 2026-10-04
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, in chat on 2026-10-04, quoted exactly: "I think I have found another potential QOL improvement that can go into maybe later section. environment variable support in API keys. Best practice for API key is to store keys in environment variables, under names such as OPENAI_API_KEY. so instead of holding whole API key in the save file, we can let this app to load API key through environment variable with unique syntax like `$OPENAI_API_KEY`."
- **Reasoning:** the maintainer's own words, above. Nothing else is recorded.
- **Alternatives rejected:** none stated.
- **Related:** `MC-175`, `MC-143`, `MC-191`; Roadmap CHORE-80.

**What was stated:** an API-key field may hold a reference such as `$OPENAI_API_KEY`. The app resolves the reference from an
environment variable. The key itself is then not stored in the save file. No mechanism, scope or syntax was decided. The
Orchestrator's open questions are in Roadmap CHORE-80.

---

### MC-191 — The hosted build is for private networks only (LAN or VPN); its security is barebones by design

- **Tag:** fact and rule stated by the maintainer, first on 2026-09-22 and confirmed for the record on 2026-10-04.
- **Date:** 2026-10-04 (first stated 2026-09-22)
- **Sweep ref:** none (stated directly)
- **Source:** the maintainer. First stated on 2026-09-22 and kept only in the Orchestrator's memory note, whose wording was:
  "The hosted (node server / web) version of RisuAI is never meant to be public-facing. Its security is barebones and not
  deploy-ready by design; it exists solely for private self-hosting (Raspberry Pi, mini PC) reached over VPN or LAN." On
  2026-10-04 the Orchestrator asked to record it, and the maintainer confirmed in chat, quoted exactly: "yes, hosted is meant
  to be private-only, record it."
- **Reasoning:** none recorded beyond the statement.
- **Alternatives rejected:** none stated.
- **Related:** `MC-143`, `MC-190`.

**What was stated:** the hosted build is never meant to be public-facing. It is for private self-hosting (for example a
Raspberry Pi or a mini PC) reached over LAN or VPN. Its security is deliberately barebones.

**Rule for agents (the consequence, as the Orchestrator put it for this entry):** hardening of inbound data is framed as
integrity and correctness, not as internet-facing security. Authentication, rate-limit and public-exposure work is not
proposed as a bug fix.

---

### MC-192 — CHORE-78 and CHORE-79: how a multi-file import reports failures, and what a failed `.charx` module import shows

- **Tag:** decisions (three, chosen from options put by the Orchestrator)
- **Date:** 2026-10-04
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's answers to the Orchestrator's questions while planning CHORE-78 and CHORE-79, after the
  investigation (ledger row 1002). The options came from section 13 of that investigation packet (A: four ways to report the
  outcomes of a multi-file import; C: whether the `readModule` return is part of CHORE-79; D: the real error or the generic
  one). The exact question and option wording as the Orchestrator put them was not supplied for this entry; the decisions are
  as the Orchestrator reported them and as the plan (revision 2) states them.
- **Reasoning:** none recorded beyond the choices.
- **Alternatives rejected:** none recorded for D1 (the exact options offered are not in the evidence). D2: keeping the generic "file is
  invalid" message. D3: ticketing the `readModule` fix separately.
- **Related:** `MC-175`, `MC-179`, `MC-185`, `MC-089`; CHORE-78, CHORE-79; ledger rows 1002 to 1016.

**What was decided:**
1. **D1 (CHORE-78).** A multi-file import imports every file, then shows one message at the end that lists each file that was
   not imported and why.
2. **D2 (CHORE-79).** A failed `.charx` module import shows the real reason (for example "Failed to save 3 assets"), not the
   generic "file is invalid" message.
3. **D3 (CHORE-79).** The fix for `readModule` returning `undefined` on a malformed `.risum` is folded into CHORE-79. It is not
   ticketed separately.

---

### MC-193 — Memory step 6 and step 7: drafts carried across the idle reload, plugin calls count as activity, desktop relaunch, the PWA guard, module archiving moves ahead of the inline backup, 6b ships with the phone heap risk, explore in-session unloading

- **Tag:** decisions (several chosen from options put by the Orchestrator; some typed by the maintainer)
- **Date:** 2026-10-04
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer's answers while step 6 (the idle reload, D17) was planned, built, gated and live-checked, and
  while step 7 (the D20 measurements) ran. Where an answer was a choice from options, the chosen option's label is quoted;
  typed answers are quoted as typed. The text of each question is given in short; the full option text was not kept.
- **Reasoning:** none stated, except where a quotation below carries it.
- **Alternatives rejected:** item 1: the other options of that question (not recorded). Item 2: the other options (not
  recorded). Item 5: archiving the inline backup first (`MC-145`'s order). Item 6: not recorded; the alternative was to hold
  6b until module archiving was done.
- **Amends:** `MC-145` (item 5).
- **Related:** `MC-139`, `MC-140`, `MC-141`, `MC-143`, `MC-145`, `MC-158`, `MC-159`, `MC-175`, `MC-179`, `MC-011`,
  `MC-089`; CHORE-81 to CHORE-86; ledger rows 1018 to 1030; commits `88c509de`, `cd26764d` (step 6a), `cdf700f3` (step 6b).

**What was decided:**
1. **Drafts across the idle reload.** The question was about unsent text that is not in an open editor. Answer: "Keep it
   across reload (Recommended)". Text in chats that are not on screen, and text left over from an editor that has closed,
   is carried across the idle reload and put back. It never blocks the reload. The chat on screen (its composer text) and
   open editors (message editor, partial-message editor, HypaV3 modal) keep blocking it, as the question's stated premise
   and Report 49 D17's scenario "a draft in the composer, no reload" have it. The wording is plan section 0 as corrected
   at Gate 1 round 3.
2. **Plugin and Realm UI.** Answer: "Plugin calls count as activity (Recommended)". A V3 plugin call into the host counts
   as activity for the idle timer, and an open plugin panel or the Realm window blocks the reload.
3. **Desktop.** The maintainer typed: "yes it does come back up on its own after load." This is about `relaunch()` after
   Load Internal Backup and Load Local Backup, observed by the maintainer on Windows, not by an agent. So `relaunch()` is
   the desktop reload. Whether to turn the desktop idle reload on is not decided here; it ships off (CHORE-86).
4. **PWA launch guard.** The maintainer typed: "add guard for pwa just in case." The guard ships without the observation
   the plan wanted first (plan section 4.5): the boot right after an idle reload does not import files the installed app hands
   over again; other boots import as before.
5. **Order of the work after step 6.** Answer: "Modules first (Recommended)". After step 6: archive modules that are not
   enabled, then the upstream-compatible full ("inline everything") backup, then the rest of stage 2. This reverses the
   order in `MC-145`. The maintainer had asked to "wait for the retry result first" (item 8) before deciding this.
6. **6b on phones before module archiving.** Answer: "Ship as planned (Recommended)". The risk is recorded and no extra
   code is written. The risk: on the 2 GB emulator, in-tab reloads of the full module-heavy profile hit the V8 heap limit
   (6 of 7 reloads in a live renderer; 0 of 5 first loads in a fresh renderer). The idle reload is such a reload. Not
   observed on a real phone.
7. **AVD retry.** The maintainer typed: "give avd another try after taskkill." (the commit instruction in item 12 carries the
   same words). No emulator, qemu or adb process of ours was running, and nothing was killed.
8. **Order of decisions.** The maintainer typed: "lets wait for the retry result first", before item 5 was decided.
9. **6b commit.** The maintainer typed: "yes. lets commit." The commit is `cdf700f3`.
10. **The post-reload boot time, and a request to explore.** After a 100-character session the boot after an idle reload
    takes about 6.5 s on an i9 (Part B). The maintainer accepted it: "acceptable, but I'd like to explore the room for
    improvement, for example, aggressively unloading the previous character into the cold storage when user selects another
    character, and only loading currently active ones instead of idle reload." An investigation was started on 2026-10-04;
    it has no result yet. Nothing is decided about in-session unloading.
11. **The breaker left at 'one' after a browser crash.** The maintainer typed: "yep. file it as low priority ticket." This is
    CHORE-85.
12. **6a commit and records.** The maintainer typed: "commit stage 6a, and give avd another try after taskkill." The commit
    is `cd26764d`. For the merge records the maintainer typed: "commit the records for now" (no period). The commit is `88c509de`.

**The Orchestrator's own call (not a maintainer decision).** At Gate 2 of step 6b, after the reviewer's round 1 finding that
a heap-limit crash after the put-back could lose the carried drafts, the Orchestrator chose that the carried drafts are kept until the new page has saved once, so a crash during its start-up
cannot lose them. This supersedes plan I2's rule of deleting them in the same synchronous task as the put-back. The stated
cost: text the user cleared can come back after such a crash.

---

### MC-200 — The UI session's work order; CHORE-56 confirmed; CHORE-44 re-verified and closed; CHORE-23 may edit `openURL` minimally

- **Tag:** decision (the maintainer's answers to the UI session Orchestrator's multiple-choice questions)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering the UI session Orchestrator's multiple-choice questions. The selected option
  labels are quoted below.
- **Reasoning:** none stated.
- **Alternatives rejected:** item 1: "Approve with changes". Item 2 (CHORE-56): "Not seen, drop it". Item 3 (CHORE-44):
  "There's a remaining part". Item 4: "hand to the Main Campaign" and "defer".
- **Related:** `MC-179`

**What was decided:**
1. **Work order.** "Approve as proposed (Recommended)": CHORE-11 (CD-4 first, CD-3 folded in), then the mobile batch
   (CHORE-56, CHORE-20, CHORE-19), then the chat UI batch (CHORE-21, the rejected-avatar-icon follow-up, CHORE-69,
   CHORE-44), then TTS (CHORE-15: TTS-1 and TTS-2 first), then settings (CHORE-14), then Playground and modules
   (CHORE-16 PG-2 to PG-4, CHORE-12), then small items (CHORE-13, CHORE-57, CHORE-23, optional CHORE-09), then
   translations (CHORE-05).
2. **CHORE-56.** "Yes, fix it (Recommended)": fix it in the mobile batch.
3. **CHORE-44.** "Re-verify and close (Recommended)": no code change unless it has regressed.
4. **CHORE-23.** "Allow a minimal edit": the UI session may edit only `openURL` in `src/ts/globalApi.svelte.ts`
   (otherwise out of bounds under `MC-179`). The edit is kept minimal and listed in the session's report, so the merge
   is expected.

### MC-201 — The mobile batch's product choices

- **Tag:** decision (the maintainer's answers to the UI session Orchestrator's multiple-choice questions)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering the UI session Orchestrator's multiple-choice questions. The selected option
  labels are quoted below.
- **Reasoning:** none stated.
- **Alternatives rejected:** listed per item below.
- **Related:** `MC-068`, `MC-179`, `MC-200`

**What was decided:**
1. **CHORE-20.** "Save/discard pair in edit mode (Recommended)": while a `mobilechat` message is being edited, a Save and
   a Discard button are shown inside the bubble. The editor still opens by "click to edit". Not chosen: the full
   standard button row under each `mobilechat` bubble; both.
2. **Long-press (amended within the same session).** The maintainer first chose "Yes, add touch (Recommended)" for the
   long-press helper. The Orchestrator then raised that on a touchscreen a long-press inside a textarea is the normal way
   to select text or open the paste menu, so touch long-press in the message editor would discard the typed edit, and in
   the translation editor would save and close it mid-edit. The maintainer then chose "Delete button only
   (Recommended)": touch long-press is added for the delete button only (force delete on touch); both editors keep a
   mouse-only long-press, and on `mobilechat` the new Save and Discard pair is the exit. Not chosen: everywhere, as first
   answered; nowhere.
3. **CHORE-56.** "No, just stop the error (Recommended)": a touch that starts on a button, input, select or textarea
   still does not count as a swipe. Only the error, and the skipped tracking of the other touches in the same event, is
   fixed. Not chosen: allow swipes from controls.
4. **CHORE-19.** "Fixed dark text there (Recommended)": on the always-light `mobilechat` bubble and the `cardboard` card
   only, text uses fixed dark colours, as the draft restore marker already does (`MC-068`). Other themes are unchanged.
   Not chosen: make those surfaces follow the colour scheme.

### MC-202 — CD-3, the first records and the mobile batch are committed as one commit; `.claude/launch.json` stays out

- **Tag:** decision (the maintainer's answer to the UI session Orchestrator's multiple-choice question, and the
  maintainer's instruction to commit)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer. The question put was "The 7 language files contain both CD-3's key and the mobile batch's
  keys on adjacent lines. How should I commit?" The selected option label is quoted below, as is the maintainer's
  instruction.
- **Reasoning:** none stated.
- **Alternatives rejected:** "Two commits via staged blobs" (build CD-3-only copies of the seven language files in the
  scratchpad and stage them through index plumbing, so CD-3 and the mobile batch commit separately); "I'll split it
  myself" (the Orchestrator stops and the maintainer stages and commits the two parts).
- **Related:** `MC-179`, `MC-200`, `MC-201`

**What was decided:**
1. **One commit.** "One combined commit (Recommended)": CD-3, the mobile batch with its tests, and the first batch of
   records are committed together. The Orchestrator had planned two commits, but the in-place split of the shared
   language files was blocked by the tool-permission classifier; the Orchestrator did not work around the block and asked.
   The commit is `e9a80ec5` on `feat/ui-batch` (local, not pushed).
2. **`.claude/launch.json` stays uncommitted.** The maintainer's word was "commit both, leave launch.json out".
   `launch.json` carries a new `risuai-ui-scratch` entry.

### MC-203 — The chat UI batch: what the plain Copy leaves out (CHORE-69), and the translation editor stays open (CHORE-21)

- **Tag:** decision (the maintainer's answers to the UI session Orchestrator's multiple-choice questions)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering the UI session Orchestrator's multiple-choice questions. The selected option
  labels are quoted below. Item 1's second and third points record what the maintainer accepted when the Orchestrator
  put them, on 2026-10-03.
- **Reasoning:** none stated.
- **Alternatives rejected:** for CHORE-69, "Thinking + hidden blocks" (also drop hidden or collapsed HTML, as the card
  does), "Exactly what is shown" (copy the rendered message as plain text) and "Keep as is" (record the raw copy as
  intended); for CHORE-21, "Lock while saving" (disable the textarea and Save during the write).
- **Related:** `MC-166` 5, `MC-179`, `MC-200` 1

**What was decided:**
1. **CHORE-69, what the plain Copy button leaves out.** "Thinking only (Recommended)":
   - The plain Copy button leaves out closed `<Thoughts>` sections only. Markdown, hidden HTML and inlay tags stay in the
     copied text.
   - **Fallback (accepted):** if only thinking remains, the message is copied unchanged.
   - **Line breaks at a removal point (accepted):** a block at the very start of the message drops the line breaks after
     it. Line breaks only, never spaces or tabs. Anywhere else, the two runs of line breaks that the removal joins become
     the longer of the two, with no cap; on a tie the run before the block wins. Spaces before a block mean it is not "at
     the start".
   - **Copy as card, and its `text/plain` companion, are unchanged.** CHORE-68 is locked until the maintainer says
     CHORE-55 stage 3 is merged (`MC-179` 4), so the card's code is not touched in this batch.
2. **CHORE-21, the translation editor after a save.** "Keep editor open (Recommended)": if the user typed during a
   translation save, the editor stays open and that text is kept as a draft. The rule: only the save that leaves no save
   from that view pending treats its text as final.

### MC-204 — The TTS batch's product choices (CHORE-15): the Hugging Face endpoint, what is spoken, Stop, and continuations

- **Tag:** decision (the maintainer's answers to the UI session Orchestrator's multiple-choice questions)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering the UI session Orchestrator's multiple-choice questions. The selected option
  labels are quoted below. Items 4 and 5 were asked after the Gate 1 escalation to `senior-advisor` (ledger row 840); items
  1 to 3 were asked earlier.
- **Reasoning:** none stated, except the maintainer's own words quoted in item 1.
- **Alternatives rejected:** listed per item below.
- **Related:** `MC-011`, `MC-179`, `MC-200`, `MC-205`; CHORE-15; ledger rows 834 to 853.

**What was decided:**
1. **The Hugging Face endpoint.** "Fix and switch endpoint". The maintainer's words: "can confirm that current
   api-inference.huggingface.co is indeed outdated. fix and switch the endpoint." The Huggingface voice mode's request
   moves to `https://router.huggingface.co/hf-inference/models/${model}`, found by the Orchestrator's web lookup (ledger row
   835). Not chosen: "Fix TTS-1/2, file a ticket (Recommended)" (fix the language and retry bugs, and file the endpoint as a
   ticket); "I'll check it myself first".
2. **What is spoken.** "Parse in all three (Recommended)": the speaker button, auto-TTS and `/speak` speak CBS-parsed text
   with closed `<Thoughts>` sections removed. Not chosen: "Button only".
3. **Stop TTS.** "Full stop (Recommended)": the Stop TTS entry is shown for every voice mode, stops all audio including
   VITS, and cancels requests in flight. Not chosen: "Show for all modes only".
4. **Continuations.** "Speak only the addition (Recommended)": a fresh reply is spoken whole; a continuation (auto-continue
   or the Continue button) speaks only its addition. Not chosen: "Speak the whole reply each time"; "Don't speak
   continuations".
5. **Text changed earlier in the reply.** "Speak from the first change (Recommended)": when a script or trigger changed
   earlier text, speech starts at the first point where the new text differs from the old. Not chosen: "Speak the whole
   reply".

### MC-205 — "Do not probe upstream" means do not overload or interfere with upstream services; looking up documentation online is fine (clarifies MC-081)

- **Tag:** clarification (of `MC-081`)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, in the same exchange as `MC-204`. `MC-081` records the maintainer's request that the
  `sv.risuai.xyz/cryptokey` endpoint not be probed; Live-State carries it as "do not probe upstream services (`MC-081`)".
- **Reasoning:** the maintainer's own words, below.
- **Alternatives rejected:** none; stated directly, not chosen from options.
- **Related:** `MC-081`, `MC-204`; ledger row 835.

> small correction to my past decision: "do not probe upstream" means 'do not overload or mess with risurealm or other
> upstream risuAI services. looking up docs or informations online is okay.

**What was decided:**
- **The rule means** not to overload or interfere with RisuRealm or other upstream RisuAI services. Looking up
  documentation or information online is allowed.
- **Applied in this session:** the Orchestrator's web lookup of the Hugging Face documentation and the `huggingface.js`
  source for CHORE-15 (ledger row 835).
- **Left unchanged:** `MC-081`'s body, which still carries the old wording (it has a one-line forward reference to this
  entry), and the Live-State "Network" bullet in the browser-check section ("do not probe upstream services (`MC-081`)"),
  which sits outside the UI session's block.

### MC-206 — The Global Lorebook and Global Regex settings pages are retired with their data kept; the sidebar's close strip shows an X (CHORE-14)

- **Tag:** decision (the maintainer's answers to the UI session Orchestrator's multiple-choice questions)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering the UI session Orchestrator's multiple-choice questions. The selected option
  labels are quoted below, with the option text each one carried.
- **Reasoning:** none stated.
- **Alternatives rejected:** for UI-1, "Retire + export leftovers" (also add a Settings button, shown only when leftover global lorebook or regex data exists, that exports it as a module file) and "Leave as is" (close UI-1 as upstream's intended behaviour); for UI-2, "Remove the empty strip" and "Leave as is".
- **Related:** `MC-049`, `MC-088`, `MC-093`, `MC-175`; CHORE-14; ledger rows 854 to 858.

**What was decided:**
1. **UI-1, the Global Lorebook and Global Regex pages.** "Retire, keep data (Recommended)". The option text read: "Delete
   the two pages and their dead code (about 5-7 UI files: the two pages, lorepreset, the global-mode code). The saved
   fields stay in the save file untouched, so moving a backup to and from upstream keeps working. Old leftover entries
   stay invisible, as they are today."
2. **UI-2, the character sidebar's close strip.** "Restore the X (Recommended)". The option text read: "Put the X icon
   back inside the existing close strip, so the close action is visible, especially on touch. One file (Sidebar.svelte)."

**Rules that follow:**
- The Global Lorebook and Global Regex settings pages are retired.
- `db.loreBook`, `db.loreBookPage` and `db.globalscript` are kept untouched, for the round trip (`MC-175`).
- The character sidebar's close strip shows an X.

### MC-207 — The Playground and modules batch: the Embedding tool's own key and URL, the modules' real order, one refresh on editor close, and the persona's embedded module stays inert (CHORE-16 PG-4, CHORE-12 MOD-1, MOD-2, MOD-6)

- **Tag:** decision (the maintainer's answers to the UI session Orchestrator's multiple-choice questions, in two rounds,
  and one instruction in chat)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering the UI session Orchestrator's multiple-choice questions. The selected option labels are
  quoted below; the option text each one carried is not reproduced here. MOD-1's second question was asked after Gate 1
  round 1 (ledger row 863) found that turning MOD-1 on would also connect the embedded module's MCP and stamp its low-level
  access on Lua triggers with no consent step.
- **Reasoning:** for MOD-1, the instruction quoted below. None stated for the others.
- **Alternatives rejected:** for PG-4, "Fully separate" and "Keep shared, add a note"; for MOD-1's first question, none (it
  was answered "Turn it on", then superseded); for MOD-1's second question, "Content only (Recommended)" and "Everything, as
  upstream wrote it"; for MOD-2, "Real order + reordering" and "Leave as is" in the first round, and "Settings list only"
  in the follow-up; for MOD-6, "Leave it (Recommended)".
- **Related:** `MC-011`, `MC-175`, `MC-179`, `MC-206`; CHORE-16; CHORE-12; CHORE-04 (the Main Campaign's); CHORE-05; QOL-10
  in `Agents/Maybe-Later.md`; ledger rows 860 to 868.

**What was decided:**
1. **PG-4, the Playground Embedding tool's shared settings.** "Own key+URL, label rest (Recommended)".
2. **MOD-1, a persona's embedded module is never applied to chats.** First "Turn it on". After Gate 1 round 1 (B1), the
   follow-up question offered "Content only (Recommended)", "Everything, as upstream wrote it" and "Back out: leave it
   inert". The answer was "Back out: leave it inert". The maintainer then wrote in chat: "MOD-1 seems more like a leftover
   feature that is left half-implemented. add it into maybe later.md so we can come back to it properly later." That is
   QOL-10 in `Agents/Maybe-Later.md`.
3. **MOD-2, the order of the module lists.** "Show the real order (Recommended)". For the chat's module picker, the
   follow-up was answered "Both lists (Recommended)".
4. **MOD-6, a module editor's edits do not refresh an open chat.** "Refresh once on close".

**Rules that follow:**
- The Playground Embedding tool has its own copy of the OpenAI key and the custom URL, which editing never writes back to
  the settings. The custom key and the request model stay the live memory settings, and the page says so.
- The persona's embedded module stays inert. It is not applied in this fork, as in upstream, until the maintainer picks
  QOL-10 up.
- The Modules settings list and the chat's module picker show the modules in the order they are stored. The search still
  filters.
- Closing the module editor refreshes the open chat once.

**Orchestrator dispositions (not maintainer decisions):** MOD-3 (`RisuModule.cjs` is declared and carried as data, never
read) is left as it is. MOD-4's two unused language keys go to CHORE-05. MOD-5 (no editing UI for a module's icon) is a new
feature and stays open. PG-4's two blank-field error messages and the Playground pages' other labels are hard-coded
English, left for CHORE-05. The Vietnamese and German wording of the new note is low-confidence, by the translator's own report (ledger row 865).

### MC-208 — The small-items batch: the chat import drops `.txt`, `runAxLLM` is implemented, nested trigger runs are capped, and move scripts honour `g` (CHORE-57, CHORE-09 items 1, 3, 5 and 6)

- **Tag:** decision (the maintainer's answers to the UI session Orchestrator's multiple-choice questions)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering the UI session Orchestrator's multiple-choice questions. The selected option labels
  are quoted below; the option text each one carried is not reproduced here. The `g` question was asked after the
  Orchestrator disclosed that a script with the flag box off defaults to `g`, which a move now honours.
- **Reasoning:** none stated.
- **Alternatives rejected:** for CHORE-57's `.txt`, "Parse Risu's TXT export" and "Leave as is"; for CHORE-09's multi-select,
  "Hide runAxLLM in V1" was not selected; for the `runAxLLM` model, "Auxiliary model" (mode `'submodel'`); for the cap
  value, "100" and "1000"; for the `g` flag, "Only explicit g" and "Drop this change".
- **Related:** `MC-011`, `MC-175`, `MC-179`, `MC-200` 4; CHORE-57; CHORE-09; CHORE-13; CHORE-11; CHORE-23; ledger rows 869 to
  877.

**What was decided:**
1. **CHORE-57, the chat import's `.txt`.** "Drop .txt, alert (Recommended)".
2. **CHORE-09, what to fix (multi-select).** "Honour g in move_top", "Cap low-level recursion" and "Implement runAxLLM". "Hide
   runAxLLM in V1" was not selected.
3. **The `runAxLLM` model.** "Other auxiliary (Recommended)": the mode `'otherAx'`, the Lua `axLLM`'s default mode.
4. **The nesting cap's value.** "Measure, then pick (Recommended)".
5. **The `g` flag, after the disclosure that box-off scripts default to `g`.** "Yes, honour g (Recommended)".

**Rules that follow:**
- The chat import picker offers `json`, `jsonl` and `html`. A picked file that matches none of them (possible when `allowAllExtentionFiles` turns the picker's filter off) shows the no-data error.
- `runAxLLM` in a V1 trigger with low-level access calls the other auxiliary model, as `runLLM` calls the main model. This
  is **fork-only**: upstream has the effect's type and editor entry but no runtime for it.
- A nested trigger run started through `runtrigger`, `v2RunTrigger` or `/trigger` is capped at 10 without low-level access and
  at a fixed lower limit with it, instead of unlimited. The limit was set by the measurement the maintainer asked for.
- `@@move_top` and `@@move_bottom` (and the `<move_top>` and `<move_bottom>` flags) honour `g`, including the default `g` of a
  script with the flag box off, so every match moves.

**Disclosures (consequences the maintainer should know; the maintainer has not answered them separately):**
- **(a) The cap counter is per run and cumulative, not only depth.** A low-level run that starts more than 50 nested runs in
  sequence (a loop, for example) has the later ones skipped. At HEAD, low-level runs were unlimited. Normal runs already had
  this cumulative cap of 10.
- **(b) The translator (edittrans) engine now matches the main regex engine for a flag text made only of tags.** With the flag
  box on, a flag text such as `<cbs>`, `<order 1>` or `<move_top>` is now global (`g`) instead of `'u'`. This affects plain
  replace scripts too, not only moves.
- **(c) Fan-out is bounded in depth, not in total work.** A trigger that calls itself twice per level is stopped at the depth
  limit, but the total number of runs it starts is not bounded by it.
- **(d) The cap was measured on Node and Vitest stacks.** Browser and mobile stacks may be smaller.

**Orchestrator dispositions (not maintainer decisions):** PT-1: lorebook and postEverything items no longer count their
`innerFormat` in the token estimate. CHORE-23: `openURL` logs a fixed warning when the system cannot open a link. CHORE-57: JSONL
blank lines are skipped and the extension tests ignore case. CD-1 and CD-2: dead code removed. CHORE-09 item 5 (`$<name>` in a
move's output) fixed with the move change. The cap rule, the Orchestrator's reading of "well under": 1000 if that is at most a
quarter of the smallest measured depth, else the largest round number at most a quarter of it. Closed without code: PT-2 (an
inert field that round-trips with upstream presets; removing it needs storage-lane edits), CD-5 (boot and backup code write and
read `groupChat.emotionImages`: `characterDefaults.ts`, `bootstrap.ts`, `globalApi.svelte.ts`, `drive/backuplocal.ts`),
CHORE-09 item 2 (already fixed on the fork), item 7 (what remains is the no-subject fallback, which belongs to the Main
Campaign's origin plumbing), item 8 (moot after CHORE-14), and items 4, 9, 10 and 11 (left: fixing them would change what
upstream cards do).

### MC-209 — Translation batch 1: errors and the Playground first; names stay English in Settings; dead keys go in their own later batch (CHORE-05)

- **Tag:** decision (the maintainer's answers to the UI session Orchestrator's multiple-choice questions)
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, answering the UI session Orchestrator's multiple-choice questions. The selected option labels
  are quoted below; the option text each one carried is not reproduced here. The questions were asked after the investigator
  (ledger row 878) refuted CHORE-05's key-drift premise.
- **Reasoning:** none stated.
- **Alternatives rejected:** first batch "Errors only" and "Common UI first"; Settings "Decide later"; dead keys "Keep them"
  and "Fold into batch 1".
- **Related:** `MC-011`, `MC-015`, `MC-018`, `MC-058`, `MC-175`, `MC-179`, `MC-200` 4, `MC-207`; CHORE-05; CHORE-12 MOD-4;
  CHORE-16 PG-2 and PG-4; ledger rows 878 to 886.

**What was decided:**
1. **Which batch goes first.** "Errors + Playground (Recommended)": the hard-coded alert and error strings in the in-bounds
   files, and the Playground's labels.
2. **How Settings is translated, in the later Settings batch.** "Names stay English (Recommended)": provider and model
   names, API, URL, JSON and parameter names such as Top P stay English; everything else is translated.
3. **Dead language keys.** "Separate batch (Recommended)": they are removed in their own batch, after a second check, and
   keys that may belong to a planned feature are skipped (persistent storage, license, Claude caching).

**Rules that follow:**
- Batch 1 translates the in-bounds alert and error strings and the Playground's labels. Names that rule 2 keeps in English
  stay English there too.
- The Settings batch keeps provider and model names, API, URL, JSON and parameter names in English and translates the rest.
- No key is removed in a translation batch. The dead-key batch re-checks each key first and skips the planned-feature keys.

**Disclosures (consequences the maintainer should know; the maintainer has not answered them):**
- **(a) The network hint for `Failed to fetch models: {error}` depends on the locale.** `alertError` in `src/ts/alert.ts`
  adds a network and CORS hint when the message text includes `Failed to fetch` or Firefox's `NetworkError when attempting
  to fetch resource.`; it is a text match, not a network test. In English the message's own prefix matches, so the hint
  appears on every error of that message. In the other six locales the translated prefix does not match, so the hint
  appears only when the raw error text appended to the message contains one of those two strings. A guard test covers the
  `Failed to fetch` case (`src/lang/fetchModelsFailed.test.ts`).

**Orchestrator dispositions (not maintainer decisions):**
- **Six messages stay English:** `Failed to fetch model response after tool execution` at five request sites
  (`request/google.ts`, `request/openAI/requests.ts`, `request/openAI/responses.ts`; the Orchestrator's count of sites
  is five) and `Failed to fetch WaveSpeed models` in `OtherBotSettings.svelte`. `alertError` adds its network hint when the
  message includes `Failed to fetch`, and `globalFetch` returns `ok: false` on real network failures as well as on other
  failures, so translating them would lose a hint that is correct for the network case. The Orchestrator checked both in
  source (ledger row 880). Showing the hint only for real network failures needs its own change.
- **Deferred:** messages passed to `throw new Error` (a catch block or a plugin may read them); the five `alertToast`
  strings in `globalApi.svelte.ts` (out of bounds, `MC-200` 4); the `/?` slash-command help in `command.ts`; the
  drag-and-drop debugging dump in `LoreBookList.svelte`.
- **Typo fixes made while routing the strings** (the English text changed on purpose): "screenShot" to "screenshot";
  "There must be least one preset." to "There must be at least one preset." (now one key, shared with
  `TranslatorPresetSettings.svelte`); "File invaid or corrupted" to "invalid"; "copywrite" to "copyright"; "additional
  Assets" to "additional assets"; "Converting  video" (two spaces) to one space.
- **New keys are flat strings with `{name}` placeholders**, filled by `fillLang` in the new `src/lang/fill.ts`, not
  function-valued keys, because the translation export in `languageSettingsData.svelte.ts` serialises `language` with
  `JSON.stringify` and drops function keys (the Orchestrator verified this, row 879).
- **The locale parity guard** (`src/lang/localeParity.test.ts`) fails when a locale's key set, a value's kind, or a
  string's `{placeholder}` set differs from `en.ts`. It will fail any branch, the Main Campaign's included, that adds an
  English key without all six translations. That is intended.
- **Translation choices, low-confidence by the translator's own report (row 882):** Korean `{type}과(와)` and
  `{version}(으)로`, 네거티브 프롬프트 and 바이브; Vietnamese does not copy three odd existing terms (Tính cách for
  character, Cắm vào for plugin, Sách truyền thuyết for lorebook); German uses the formal "Sie", Spanish the informal "tú".
  A native-speaker review is optional and listed in CHORE-05.

### MC-210 — Translation batch 2: the Settings pages next (CHORE-05); the rest are the Orchestrator's dispositions

- **Tag:** decision (the order of work); the dispositions below are the Orchestrator's, not the maintainer's
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, after batch 1 was gated: "let's commit and do settings page next." The rule that names stay
  English in Settings is `MC-209`'s; this entry adds no new maintainer rule.
- **Reasoning:** none stated.
- **Alternatives rejected:** none stated.
- **Related:** `MC-091`, `MC-179`, `MC-209`; CHORE-05; ledger rows 887 to 894.

**What was decided:**
1. **Which batch goes next.** The Settings pages (`src/lib/Setting/**` and the settings registries in `src/ts/setting`).
   `MC-209`'s rule applies unchanged: provider and model names, API, URL, JSON and parameter names stay English; the rest is
   translated.

**Rules that follow:**
- Names that `MC-209` keeps English stay English in this batch. Everything below is how the Orchestrator applied that rule;
  none of it was put to the maintainer.

**Disclosures (consequences the maintainer should know; the maintainer has not answered them):**
- **(a) New custom sidebar items store a readable label, not an id.** `CustomSidebarConfig.svelte` showed and stored
  `language[type.labelKey] || type.id`. It now shows and stores `getLabel(type) || type.id`. A newly added custom sidebar
  item therefore stores its label (the language value if it has a `labelKey`, otherwise its English `fallbackLabel`, as
  for the parameter items Top P, Top K and the like) instead of an id such as `adv.visionQual`; only an item with neither
  keeps its id. Items already stored are untouched.
- **(b) Three English strings changed whitespace.** `Upload<br />Image`, `Upload<br />Vibe` and `Uploading<br />Image..`
  became single strings with a space. The English `textContent` gains a space, and the forced line break is gone: the
  text now wraps naturally inside the 80px box and may fit on one line.
- **(c) The NovelAI reference area is translated unevenly.** "Image Reference", "Vibe Trasfer", "Character Reference" and
  "Upload Vibe" are translated, while sibling NovelAI labels such as "Vibe Model", "Use SMEA" and "Variety+" stay English
  (feature names). Gate 2 flagged it (SHOULD 3). It is left as is; a native-speaker or maintainer call for a later pass.

**Orchestrator dispositions (not maintainer decisions):**
- **R3, scope amendment for `CustomSidebarConfig.svelte`** (`MC-091`, a shared-cause correction; the file is in
  `src/lib/Others`, which the next batch covers). The old expression showed the id of every item without a `labelKey`,
  including those with a `fallbackLabel`, and adding `labelKey`s would have changed which items showed ids.
  It is changed together with the registry; see disclosure (a).
- **R4, settings search also matches `fallbackLabel`,** so an English search still finds an item whose label is now
  translated. Known limitation: an item with only a `labelKey` stays searchable only in the current language, as before.
- **R5, parameter `fallbackLabel`s stay English** and get no `labelKey`: Top P, Top K, Min P, Top A, Repetition penalty,
  Reasoning Effort (two items), Verbosity, Thinking Mode and Jinja Template. The prose `fallbackLabel`s are translated.
- **R6, names that stay English:** sampler and scheduler names, the Stability style presets, resolutions and ratios, the UI
  mode names (Standard Risu, Waifulike, Mobile Chat, CardBoard, Custom HTML), tokenizer and `LLMFormat` names, Ooba's
  snake_case parameter names and modes, NovelAI feature names (Vibe Model, Use SMEA, Variety+ and similar), the role labels
  User, System and assistant in `PromptSettings.svelte`, colour-scheme preset names, and keyboard key names. Translator
  target-language names are translated (one key per language, shared by both translator dropdowns); endonyms stay. The
  `[Translate in your own language]` option is translated.
- **English typos kept byte-identical:** "Vibe Trasfer", "Text Spliting", "Seperator", "Malaysian", "Ukranian". Fixing them
  is not part of this batch.
- **Stored defaults are not translated:** `New Persona`, `New Preset`, `New Lore`, `New Folder`, `New Event`.
- **Two fixes folded in:** (1) `accessibilitySettingsData.ts` set its six new-message-button option labels from `language.x`
  at module level, which freezes them at import; they are now `labelKey` plus an English `label`. (2) `acc.longPressToPopupEditor`
  had a `labelKey` with no `en.ts` key (upstream commit `e03c3897` renamed the item without adding one), so its checkbox had
  no label; it now has a fork-only `en.ts` key, "Long Press to Open Popup Editor", and a `fallbackLabel`.
- **Deferred:** the registry `options.placeholder` strings ("Leave it blank to use default", "Leave it blank to not use" in
  `advancedSettingsData.ts`) need a `placeholderKey` mechanism. `CustomSidebarConfig.svelte`'s other strings ("No custom
  sidebar items configured", "Delete", "Add Item", "Close", "Back to List"), `LoreBookSetting.svelte` and the Playground
  Embedding "Custom (OpenAI-compatible)" option go to the next batch (SideBars and Others).
- **Translation choices, low-confidence by the translator's own report (row 890):** `optViaSound`, `optAxModel` ("auxiliary
  model"), `nameThinking`, `hotBadge`, `starter`, `bias`, and the German and Vietnamese wording of `visionQuality`.
  Vietnamese uses "nhân vật" for character. A native-speaker review is optional and listed in CHORE-05.

### MC-211 — Translation batch 3: SideBars, Others and the common UI in one batch (CHORE-05); the dev panels, Easter eggs, Iris dialog and split are the maintainer's, the rest are the Orchestrator's dispositions

- **Tag:** decision (four choices put to the maintainer); the dispositions and disclosures below are the Orchestrator's, not the
  maintainer's
- **Date:** 2026-10-03
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, in chat: "commit and start batch 3" (also the commit word for batch 2, `694a4c89` code and
  `258e2701` records), then four answers to `AskUserQuestion`. Dev panels: "Translate labels only (Recommended)". Easter eggs:
  "Keep English (Recommended)". Iris dialog: "Move into language files". Split: "One batch (Recommended)".
- **Reasoning:** none stated.
- **Alternatives rejected:** dev panels: "Translate everything" and "Leave in English"; Easter eggs: "Translate them"; Iris
  dialog: "Leave the dictionaries" (the recommended option, not chosen); split: "Two batches" (Others first, then the rest).
- **Related:** `MC-091`, `MC-179`, `MC-200` 4, `MC-209`, `MC-210`; CHORE-05; ledger rows 895 to 899.

**What was decided (the maintainer's):**
1. **Dev panels.** The Dev Tool sidebar and the alert dialog's request-log and generation-info panels: translate the labels
   only. The option chosen read "translate ordinary words ...; keep technical terms like GenID, Request Body, Chunks
   English". The full list of terms kept English is the Orchestrator's disposition below.
2. **Easter eggs stay English:** the `App.svelte` "RisyGTP" parody, the `UI/Title.svelte` anniversary text and the
   `UI/Googli.svelte` "TEST".
3. **Iris dialog.** The intro and unsupported-model text move into the language files, so all seven languages get them; the
   existing ko and zh-Hant text is carried over.
4. **One batch** for SideBars, Others and the common UI.

**Rules that follow:**
- `MC-209`'s rule (provider, model, API, URL, JSON and parameter names stay English) and `MC-210`'s (stored defaults are not
  translated; English typos kept byte-identical; NovelAI feature names stay English) apply unchanged. This entry adds no new
  maintainer rule beyond the four answers above.

**Disclosures (consequences the maintainer should know).** *Answered:* the maintainer approved the batch's changes and
dispositions together, before the commit: "changes made by you seems reasonable; approved. go ahead and commit batch 3."
- **(a) Folder colour select, non-index answers.** In `Sidebar.svelte` and `SideChatList.svelte`, an answer to the folder
  colour select that is not a list index now writes nothing. At HEAD, Sidebar threw an unhandled TypeError
  (`colors[sel].toLocaleLowerCase()` on undefined) and `SideChatList` stored undefined as the folder colour. The stored colour
  values are unchanged (the English lower-case names).
- **(b) The Iris intro line is sent to the model.** It is the first assistant turn in the history. Users of cn, vi, de and es
  now send it in their language (they sent English before); ko and zh-Hant are unchanged.
- **(c) zh-Hant Iris unsupported-model line.** It was in Simplified characters at HEAD and is rewritten in Traditional
  characters.
- **(d) `GridCatalog` description.** An entry without creator notes now has `desc` `''` instead of 'No description'. The
  display is the same in English.

**Orchestrator dispositions (not maintainer decisions):**
- **Kept English:** the `CharConfig` TTS engine parameter labels (the Orchestrator's reading of `MC-209`; the maintainer may
  revisit); Realm NSFW/SFW tags; WelcomeRisu "Choose your language"; stored defaults ("New Folder", "New Lore", "New Persona");
  the "Performace" typo; the Iris speaker names "Iris" and "You"; the technical labels of the alert dialog panels (ID, GenID,
  Bytes, URL, Request Body, Request Header, Response, Chunks, the OK/ERR badge, export format names, the bug-report block);
  "XHigh".
- **Translated:** the folder colour names, through one list of value and label pairs (the stored value is the English name as
  before); the "Unnamed X" display fallbacks; PluginAlertModal "Dev Info"; EasyPanel "Beta"; `OptionalInput` "Using default",
  "True" and "False"; `ModelGrid` "SUB"; alt texts; Realm strings; `DefaultChatScreen` fallbacks; six `HypaV3Modal` conversion
  errors (shown through `alertNormalWait`).
- **Reuse rule:** an existing key is reused only when its English value is byte-identical to the literal and the key is
  generic: a top-level key, or one of the generic `settingsPage` keys `back`, `unnamed` and `customOpenAiCompatible`. Other
  domain-group keys (`setup.*`, `triggerCategories.*`, `triggerInputLabels.*` and the like) are not reused.
- **Deferred:** `MobileCharacters.svelte` "Unnamed"; the `HypaV3Modal` conversion errors have no component test; the registry
  `options.placeholder` strings (they need a `placeholderKey`); thrown errors; `globalApi` toasts (out of bounds, `MC-200` 4);
  the `/?` help; the `LoreBookList` drag debug dump; UI text produced in `src/ts/**` (for example `devToolActions` output);
  `Legal.svelte` (never edited).
- **Translation choices, low-confidence by the translator's own report (row 897):** the regex flag names; the prompt-diff view
  names (Unified, Split, Intraline, Legacy); Autopilot; Instruct; Join; Forked; the vi CHAR/CHAT badge length; the de and es
  Iris text uses informal du and tú against the file's formal register; the zh-Hant intro and tip read as mainland wording
  (kept). A native-speaker review is optional and listed in CHORE-05.

### MC-212 — Translation batch 4: dead-key removal (CHORE-05); the request and the review deferral are the maintainer's, the dispositions are the Orchestrator's

- **Tag:** decision (the request and the deferral); the dispositions below are the Orchestrator's, not the maintainer's
- **Date:** 2026-10-04
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, in chat: "let's remove the unused key next." Then, on the native-speaker review: "full native
  speaker check has to be deferred as while I am capable of english and korean, as a single maintainer I can't check all 6
  languages." Then: "korean and english translations looks good to me. will report if I find any issue." (The quote does
  not name its scope; the Orchestrator reads it as the translations so far, batches 1 to 3.)
- **Reasoning:** the maintainer's, on the deferral: they read English and Korean, and as the only maintainer cannot check all
  six non-English languages. No reasoning was stated for the request.
- **Alternatives rejected:** none stated.
- **Related:** `MC-179`, `MC-207`, `MC-209`, `MC-210`, `MC-211`; CHORE-05; ledger rows 900 to 904.

**What was decided (the maintainer's):**
1. **Remove the unused translation keys** as the next batch (batch 4).
2. **The full native-speaker review is deferred.** The reason is the maintainer's own, quoted above.
3. **The Korean and English translations look good to the maintainer**, who will report any issue they find (scope as read
   above). The other five locales (cn, zh-Hant, vi, de, es) remain unreviewed by a native speaker.

**Orchestrator dispositions (not maintainer decisions):**
- **The seven planned-feature keys stay.** The maintainer's rule is `MC-209` decision 3 (three categories: persistent
  storage, license, Claude caching); the seven key names are the investigator's.
- **Keep `globalLoreBook` and `globalRegexScript` until after the merge.** The Main Campaign branch
  `fix/persistence-conflict-platform-hardening` still reads them in `GlobalLoreBookSettings.svelte` and `GlobalRegex.svelte`;
  they were retired on this branch in `408c32dd`. Delete them after the merge if those pages go.
- **Leave the 35 possibly-dead names inside computed groups for later** (`help` 11, `setup` 18, `triggerDesc` 6). The scan
  treats those groups as wholly live because they are read by computed access.
- **No new test.** There is no defect to reproduce. A guard that every key is referenced was rejected: computed groups make it
  unsound, or it needs a hand-kept allowlist.
- **Scope of the removal:** 131 keys, deleted from all seven language files together (ledger rows 900 to 903).

### MC-213 — Translation batch 5: finish the deferred items in three gated batches (CHORE-05); the request, the split and the TTS rule are the maintainer's, the dispositions are the Orchestrator's

- **Tag:** decision (the request, the split and the TTS label rule); the dispositions below are the Orchestrator's, not the maintainer's
- **Date:** 2026-10-04
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, in chat: "let's complete the earlier deferral and possible leftovers." They then answered two
  questions the Orchestrator asked (the split, and the `CharConfig` TTS labels); the answers are in the list below.
- **Reasoning:** none stated for the request or the answers.
- **Alternatives rejected:** the options not chosen. On the split: "One big batch" and "5a only for now". On the TTS
  labels: "Keep all English" (batch 3's disposition) and "Translate all". The chosen options were the ones marked
  "(Recommended)".
- **Related:** `MC-179`, `MC-200`, `MC-209`, `MC-211`, `MC-212`; CHORE-05; ledger rows 905 to 910.

**What was decided (the maintainer's):**
1. **Finish the deferred translation items and the leftovers** from batches 3 and 4.
2. **Split the work into three gated batches.** The maintainer chose "Three gated batches (Recommended)"; the option
   text, written by the Orchestrator from the investigator's sizing (row 906), proposed 5a small and safe items, 5b
   user-visible errors (about 40 keys) and 5c the dev-tool preview text and the `CharConfig` TTS labels.
3. **`CharConfig` TTS labels:** translate the descriptive (prose) labels and keep parameter and engine names in English (the
   `MC-209` rule).

**Orchestrator dispositions (not maintainer decisions):**
- **`characterCards.ts` and `processzip.ts` strings wait until after the Main Campaign merge.** They sit inside Main Campaign
  hunks (`MC-179`).
- **Stay English:** plugin API v3 throws (47, plugin-author-facing), MCP throws (22), internal and swallowed throws, JSON-dump
  throws, the `scriptings` `'Error: '` strings returned to Lua, and the `cbs.ts` tag docs.
- **`v2UnsupportedTrigger` is kept.** It is dead in code but reachable through `triggerDesc[type]` from saved effect data (row
  905).
- **`LoreBookList` debug dumps:** both are commented out, so there is nothing to translate and no change.
- **The `globalApi` toasts are not touched:** `globalApi.svelte.ts` is out of bounds for the UI session except `openURL`
  (`MC-200` 4).
- **The reroll Apply defect is folded into batch 5a** (found by Gate 1, row 907).
- **`OtherAx` is translated.** Its siblings in the same accordion are translated (Gate 1 N1 asked the Orchestrator to confirm).
- **Scope of batch 5a:** 29 dead computed-group names deleted, 5 new keys, ledger rows 905 to 910.

### MC-214 — HypaV3 re-roll: an edit after a failed re-roll re-enables Apply (CHORE-05 batch 5a follow-up)

- **Tag:** decision
- **Date:** 2026-10-04
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, in chat, after the Orchestrator reported batch 5a and listed Gate 2's optional item (after a
  failed re-roll, hand-typed text in the re-roll box cannot be applied): "let's commit and apply the optional idea." The same
  message was the commit word for batch 5a (`fb454bc0` code, `e6c45b3d` records).
- **Reasoning:** none stated.
- **Alternatives rejected:** none stated.
- **Related:** `MC-213`; CHORE-05; ledger rows 911 to 913.

**What was decided (the maintainer's):** after a failed re-roll, once the user edits the re-roll text, Apply is enabled and
applies the edited text.

### MC-215 — Translation batch 5b: user-visible error and request-failure strings (CHORE-05)

- **Tag:** decision (the request and the three answers); the dispositions below are the Orchestrator's, not the maintainer's
- **Date:** 2026-10-04
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, in chat: "go ahead with 5b." They then answered three questions the Orchestrator asked
  (AskUserQuestion). The option text was the Orchestrator's; the maintainer chose by label: "Translate all (Recommended)",
  "Fix them (Recommended)" and "Translate it (Recommended)".
- **Reasoning:** none stated.
- **Alternatives rejected:** the options not chosen. On the request-failure messages: "Alert-only rows" (about 22 keys;
  request results stay English). On the three defective English strings: "Keep byte-identical". On the plugin rename error: "Keep
  English".
- **Related:** `MC-209`, `MC-211`, `MC-213`, `MC-200`, `MC-179`; CHORE-05; ledger rows 914 to 918.

**What was decided (the maintainer's):**
1. **Translate all the user-visible request-failure messages**, not only the ones shown in an alert. The question the
   maintainer answered said that these texts are also read by Lua, triggers, MCP and plugins (`runLLMModel`), and are saved in
   the chat when "inlay error response" is on, and that some results already carry translated prefixes.
2. **Fix three defective English strings** while translating them: the Horde "Response not possible" message joined to its
   "with ..." text without a space; the "not allowed dude to browser/os security policy" text; and the "failed ... failed!"
   WebSocket text.
3. **Translate the plugin-update rename error** shown to the installer.

**Disclosures:**
- **(a) Translated failure text now reaches scripts.** A request-failure text is returned as `{type:'fail', result}`. By the
  investigator (row 914), that text reaches Lua `LLM` and `axLLM` (prefixed `'Error: '` in `scriptings.ts`), the trigger `runLLM`
  result (a chat variable), MCP `aiaccess` and the plugin v3 `runLLMModel`. `throwError` also saves the text into the chat as a
  `risuerror` block when `inlayErrorResponse` is on (the setting has no default). A script that matches English words in these
  results would stop matching in a non-English UI. The investigator found no such match in the repository. The investigator
  found no TRANSLATE literal that contains `'Failed to fetch'` or `'NetworkError'`, which are the texts `alertError` matches.
- **(b) Three English texts changed** (all other English values are byte-identical to HEAD; Gate 2 compared every value and
  composite):
  - `websocketConnectFailed`: "WebSocket connection to '{url}' failed." (HEAD: "WebSocket connection failed to '...' failed!").
  - `hordeNotPossible` "Response not possible." and `hordeNotPossibleWith` "Response not possible: {message}" (HEAD joined the
    two parts with no space: "Response not possiblewith ..."). The punctuation is Gate 1's NIT, accepted.
  - `localStreamingBlocked`: "Local requests cannot use streaming because of browser and OS security policy. Turn off
    streaming."

**Orchestrator dispositions (not maintainer decisions):**
- **Sites:** 36 new keys and 2 reused keys (`errors.unexpectedResponseType`, `errors.vertexAuthIncomplete`), from the
  investigator's table of 42 TRANSLATE sites (row 914) plus the plugin rename error.
- **Keys sit under `errors`** (the existing precedent), not top level (Gate 1 m2). Placeholders live inside the key text, for
  example `{provider}: {error}` and `{tokens}` (m3).
- **`chatTemplate.ts` "Template type is not set" stays English** (m1). It is unreachable in normal use: the type defaults with
  `??= "chatml"` and the select has no empty option, so only a crafted `.risup` or a plugin could reach it.
- **The `src/main.ts` vite-preload alert stays English** (m4). It can fire before the language loads, and while module loading
  is failing.
- **Other English typos stay byte-identical** outside the three fixes: "seperate", "SyntaxError Found", "Unsupported Type
  Detected", "Failed to Auto get path".
- **Stay English (the keep-English list in the investigator's table):** the five "Failed to fetch model response after tool
  execution" sites, "Aborted", "All models failed", the plugin-blocked text, the preview JSON, tool-call failure texts sent to
  the model, the Anthropic stream "Overload detected, retrying..." and "Error:" plus message, `sp.error` from `memory/**`, the
  `pluginListMerge` header errors and the Rust `unsupportedReason`.
- **Known leftovers:** `hanuraiMemory.ts` "Required Tokens" (`process/memory`, out of bounds); the `processzip.ts` "Failed to save
  N assets" text until the Main Campaign merge (`MC-179`), and the `characterCards.ts` and `processzip.ts` strings after it.
- **Test mock:** `requests.responses.test.ts` mocks `src/lang` as `{errors:{httpError:'HTTP '}}`. The plan's claim that it was
  unaffected was false (Gate 1 M1); the mock now carries the English `incompleteResponse` keys.
- **Low-confidence translation choices, for the deferred native-speaker review (`MC-212`):** "sidecar" is kept in English in
  cn, zh-Hant, vi, de and es, and written 사이드카 in ko; cn and zh-Hant use "access token" (访问令牌, 存取權杖) where `toomuchtoken`
  uses Token; vi keeps "plugin" in English and its `requiredTokens` "Số Token bắt buộc" differs from `toomuchtoken`'s term; de
  uses "Charakter", "Voreinstellung" and "Assets"; es uses tú, "Reverificando tokens" and "solicitud por lotes"; ko
  `hordeNoGenerations` is interpretive ("작업이 완료되었지만 생성된 결과가 없습니다"). The ko "에셋" form follows `ko.ts` (at HEAD
  `a5699f55`: 에셋 on 39 lines, 프리셋 on 24, 애셋 on 0).
- **Scope of batch 5b:** 36 new keys in seven languages, 14 production files, 1 edited test mock, 6 new test files, ledger rows 914 to 918.

### MC-216 — Translation batch 5c: dev-tool preview text, the CharConfig TTS labels and Bias (CHORE-05)

- **Tag:** decision (the request); the dispositions below are the Orchestrator's, not the maintainer's
- **Date:** 2026-10-04
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, in chat: "commit and start 5c". It was also the commit word for batch 5b (`edc8c8b6` code,
  `ce33d027` records). No question was put to the maintainer for 5c.
- **Reasoning:** none stated. The TTS rule is `MC-213` decision 3 ("Translate prose, keep names (Recommended)"); the dev-panel
  rule is `MC-211` decision 1 (translate labels only, technical terms English). No new maintainer decision.
- **Alternatives rejected:** none stated.
- **Related:** `MC-209`, `MC-210`, `MC-211`, `MC-213`, `MC-215`; CHORE-05; ledger rows 919 to 923.

**What was decided (the maintainer's):** start batch 5c, the last of the three gated CHORE-05 batches: the text built in
`devToolActions.ts` and `previewRunner.ts`, the `CharConfig` TTS tab labels, and the `CharConfig` Bias section.

**Disclosures:**
- **(a) VOICEVOX "Speed scale" and "Volume scale" stay English** (part of the "… scale" parameter names), beside the
  translated GPT-SoVITS "Speed" and "Volume" (`sidebarUi.ttsSpeed`, `ttsVolume`).
- **(b) "Temperature" is translated** (the existing `language.temperature` is reused) while "Top P" and "Top K" stay English.
- **(c) `MC-211` kept the `CharConfig` TTS engine parameter labels English as the Orchestrator's reading of `MC-209`;
  `MC-213` decision 3 supersedes that for the prose labels.** Names, such as
  the engine names and "TTS", stay English.
- **(d) Preview text is not sent to the model and is not saved.** It is rendered by `alertMd` in the dev-tool preview (row 919).

**Orchestrator dispositions (not maintainer decisions):**
- **Sites:** 39 new keys (8 in `devTool`, 31 in `sidebarUi`) from the investigator's table (row 919): 9 literals in
  `devToolActions.ts` and `previewRunner.ts`, 51 in the `CharConfig` TTS tab and 1 for Bias (label and header). Reused keys:
  `language.prompt`, `language.model`, `language.language`, `language.temperature`, and `languageNameEnglish`,
  `languageNameChinese`, `languageNameJapanese` and `languageNameKorean` for the matching text-language names.
- **Q1, role headings stay English** (Function, User, System, Assistant): by analogy with `MC-210` R6, which kept User,
  System and assistant English in `PromptSettings.svelte`; extending it to Function, Assistant and the preview headings is
  the Orchestrator's own.
- **Q2, Speaker, Style, Volume and Speed are translated** as ordinary words (`MC-213` decision 3).
- **Q3, Temperature reuses `language.temperature`** (top-level, byte-identical English, already translated).
- **Q4, the "string" placeholder and "chars" are translated** (`sidebarUi.biasTokenPlaceholder`; `maskedChars`
  "{mask} ({count} chars)").
- **Gate 1 (row 920), `[APPROVE]`:** M1, `botpreset.svelte` "string" is the preset-name placeholder, not the bias token (the
  Orchestrator verified the line), so it is not shared and not touched. m1, the `CharConfig` keys go in `sidebarUi` (batch 3
  put the sibling TTS strings there) and the preview keys in `devTool`. m2, Bias is a new `sidebarUi.bias`, translated the
  same as `settingsPage.bias`, because the `MC-211` rule rules out reusing a domain-group key. m3 and m4 were
  test-fixture and fallback notes: a missing key shows English in the other locales and "undefined" only in `en`.
- **Stay English:** the engine names, "TTS", the VOICEVOX Speed, Pitch, Volume and Intonation scale names, Base URL, URL,
  Response Format and the format names, Top P and Top K, Chunk Length, Normalize, v1 and v2, the example placeholders and the
  role headings. `getRequestLog` in `globalApi.svelte.ts` is out of bounds.
- **Leftovers, left alone:** the `botpreset.svelte` "string" placeholder, `PlaygroundImageTrans` "fontSize", `ToolConversion`
  "NOTSUPPORTED" and the `CharConfig` CSS class typo `text=neutral-200`; the ko `noBias` "Bias 없음" beside `bias` "편향"
  (existing wording, Gate 2 NIT).
- **Locale files:** CRLF, no BOM, additions only (en +39/-0; each other locale +41/-2, the
  two removed lines being `requestLog` and `avatarAlt`, re-added with a comma). `sidebarUi.bias` equals `settingsPage.bias` in
  every locale (ko 편향, cn and zh-Hant 偏置, vi Độ lệch, de Bias, es Sesgo).
- **Low-confidence translation choices, for the deferred native-speaker review (`MC-212`):** ko `instruction` 지시문 and
  `cachePointNote` 캐시 지점; cn and zh-Hant 指令 and 参考音频文本 / 參考音訊文本, zh-Hant 快取點 and 音訊; vi `instruction`,
  "cache point", "custom voice seed" and the "Trộn …" labels; de "Eigener Stimm-Seed", "Cache-Punkt" and
  "Nicht-Text-Inhalt(e)"; es "Instrucción", "guion" and "cadena". "Cut N" is kept as the leading name in every locale.
- **Scope of batch 5c:** 39 new keys in seven languages, 3 production files (`devToolActions.ts`, `previewRunner.ts`,
  `CharConfig.svelte`, display text only), 2 new test files, ledger rows 919 to 923.

### MC-217 — Translation batch 5d: the leftovers, and Spanish as a selectable app language (CHORE-05)

- **Tag:** decision (the five answers); the dispositions below are the Orchestrator's, not the maintainer's
- **Date:** 2026-10-04
- **Sweep ref:** none (stated directly this session)
- **Source:** the maintainer, in chat: "main session is on the last stretch before merging, so I think we have time to tackle
  the leftovers before merging." Then five answers in two question rounds, all to the option marked "(Recommended)". The option
  text was written by the Orchestrator. Round 1 (four questions): No Bias, "Fix all six (Recommended)" (not chosen: "Korean
  only", "Leave them"); English, "Fix all four (Recommended)" (not chosen: "Keep byte-identical"); CSS typo, "Use theme colour
  (Recommended)" (not chosen: "Leave it"); es export, "Add es (Recommended)" (not chosen: "Leave it"). Round 2 (after Gate 2's
  MINOR): Spanish UI language, "Add to both (Recommended)" (not chosen: "Settings only", "Leave it").
- **Reasoning:** none stated beyond the quote.
- **Alternatives rejected:** the not-chosen options above.
- **Related:** `MC-209`, `MC-210`, `MC-211`, `MC-216`, `MC-179`; CHORE-05; ledger rows 924 to 928.

**What was decided (the maintainer's):**
1. **No Bias: fix all six non-English values.** The investigator found that none uses its locale's `bias` word (row 924).
2. **English: fix all four.** `fontSize` becomes "Font Size"; the unsupported badge "NOTSUPPORTED" becomes "Not supported" (the
   internal value `'NOTSUPPORTED'` stays); "Loading.." becomes "Loading..." (reusing the existing key); the preset name
   placeholder "string" becomes "Name" (reusing an existing key).
3. **CSS typo: use the theme colour.** The `CharConfig` Style label class `text=neutral-200` becomes `text-textcolor`.
4. **es export: add `es`** to the `translang` export list in `languageSettingsData.svelte.ts`.
5. **Spanish UI language: add it to both** the Language setting and the welcome screen, including browser-language
   auto-detect.

**Disclosures:**
- **(a) English text changes** (answer 2): the label "fontSize" is now "Font Size"; the badge "NOTSUPPORTED" is now "Not
  supported"; "Loading.." is now "Loading..."; the preset name placeholder "string" is now "Name".
- **(b) All six `noBias` values are replaced** (answer 1). They were upstream's strings (the Orchestrator verified the ko value
  was authored upstream, blame `c422000c`, kwaroran). New values: ko "편향 없음" (was "Bias 없음"), cn "无偏置" (was "No
  Bias"), zh-Hant "無偏置" (was "未設定 Bias"), vi "Không có độ lệch" (was "Không thiên vị", which means impartial), de
  "Kein Bias" (was "Keine Voreingenommenheit", which means no prejudice), es "Sin sesgo" (was "Sin Bias"). English stays "No
  Bias".
- **(c) The `CharConfig` Style label's colour now follows the theme** (answer 3). `text=neutral-200` matched no CSS, so the
  label inherited the parent colour.
- **(d) Spanish is now selectable** in the Language setting and on the welcome screen (answer 5), and a Spanish browser language
  (`es`, `es-ES` and so on) auto-selects it on first run. `es.ts` has existed since upstream `7944bb3d` (2024-08-10), but
  neither list offered it, and `upstream/main` has the same gap. This is a **fork difference** that users coming from upstream
  will see. The first-setup translator case for `es` (the welcome screen's `case 'es'`, which sets `db.translator = 'es'`) is
  untested.

**Orchestrator dispositions (not maintainer decisions):**
- **Reuse rulings:** `language.settingsPage.unknown` is reused in `MobileCharacters.svelte`, an extension of `MC-211`'s list
  of generic `settingsPage` keys (the file already uses `settingsPage.unnamed`). `language.alerts.addingAssets` is reused for
  the legacy module export, an exception to the `MC-211` reuse rule: a domain-group key, reused because the feature and the
  English text are identical and the same file's other asset path already uses it. `language.name` and
  `language.loadingEllipsis` (top-level keys) are reused for the preset placeholder and `makeGroupImage`.
- **New keys (4, in seven languages):** top-level `fontSize`; `playground.notSupported`; `alerts.writingExif` "Loading...
  (Writing Exif)"; `alerts.writingPng` "Loading... (Writing)".
- **Gate 1 skipped** under the `AGENTS.md` carve-out (string swaps and one-line fixes). Gate 2 judged the skip justified.
- **KEEP list (stays English):** the image-generator parameter names (Steps, Strength, Noise, Upscaler and so on; `MC-209`), the
  Ooba parameter checkboxes, stored defaults, units, Easter eggs, plugin and CBS messages, console text, and the sentinel value
  `'NOTSUPPORTED'` (used in `ToolConversion.svelte` and `prompt.ts`).
- **Translator low-confidence items, for the deferred native-speaker review (`MC-212`):** vi `noBias` (it follows the locale's
  unusual "Độ lệch"), vi `notSupported`, de `writingPng` "(Wird geschrieben)", es `notSupported` "No compatible".
- **Merge:** of this batch's production files only `modules.ts` also changed on the Main Campaign branch, in other lines;
  the overlap is re-checked at merge time.
- **Out of bounds, not done:** the `globalApi` toasts and `getRequestLog`, the
  `hanuraiMemory.ts` "Required Tokens", and `Legal.svelte`.
- **Scope of batch 5d:** 4 new keys in seven languages, 6 `noBias` values replaced, 10 production files besides the seven
  locale files (`botpreset.svelte`, `PlaygroundImageTrans.svelte`, `ToolConversion.svelte`, `CharConfig.svelte`,
  `languageSettingsData.svelte.ts`, `MobileCharacters.svelte`, `characters.ts`, `persona.ts`, `modules.ts`,
  `WelcomeRisu.svelte`), 9 new test files and 3 tests added to `CharConfig.ttsLabels.svelte.test.ts`, ledger rows 924 to 928.
