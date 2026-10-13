# Second incremental condition check: plan v3.3 against `conditions-check.md` (C11, C13, N1 to N5, R-a) (opus-reviewer, 2026-10-14)

Instance: session b715da7c-9965-4831-b226-4d56438d78ee, agent a1e7bb3f245d95bc2, role opus-reviewer, resumed. This is not a full re-review.

## Inputs

- `S\stage13\plan-v3.3.md`:
  - the change table H1 to H12 (lines 15 to 30);
  - 3.1a (lines 138 to 148);
  - 3.4c (lines 226 to 247);
  - 3.8c to 3.8e (lines 305 to 361);
  - 4.4 and 4.5 (lines 385 to 389);
  - 7.4 (grep, lines 494 to 508).
- Source on `feat/alite` at `ebe3c77a9`, read only:
  - `server/node/server.cjs`, `parseCheckOnly` (lines 391 to 431) and `assertCheckOnly` (lines 468 to 479), plus the remove handler read in round 3 (lines 1778 to 1843);
  - `src/ts/storage/store/contract.ts`, lines 165 to 191;
  - `nodeHttpStore.ts:469` (retire only for prefix keys, read in round 3).
- Nothing was executed.

## Verdict

**[APPROVE WITH CONDITIONS]**

Every item in scope is CLOSED except a residue of N1. The plan's wording of the Node fence check-only entry ("an absent key compares as revision 0") is false for a fence that once existed. Read literally, it makes every GC and sweep batch conflict forever after the first discard. That is a liveness defect, not data loss: a conflicting batch deletes nothing. One editorial item (E1) remains as well.

## A. Items

| Item | Status | v3.3 evidence | Note |
|---|---|---|---|
| C11 Node `rev` | **CLOSED** | Line 318: "at most 500 candidates ... enter the record per pass, every recorded item has a non-null `rev`, and an item whose `rev` is null is never deleted"; H1 line 19; test line 502 | Lines 316 to 317 ("replace the record with the fresh candidates ...") do not repeat the Node cap. Read with line 318 the rule is unambiguous; a cross-reference there would be tidier (editorial). IndexedDB and Tauri still rely on age alone, correctly disclosed (R22) |
| C13 census and exemption | **CLOSED** | Row 2 is Disabled with its source at line 340; mutant rows 2 to 10 and 15 at line 361; exemption timing (initial and resumed run) at line 333; row 19 primitives at line 357; row 4's reader note at line 342; row 16 re-read (H5) | — |
| N1 per-batch fence check | **PARTIAL** | Line 244: the fence version is in the same atomic step on all three backends; the false v3.2 claim is withdrawn; line 311; test line 503 | See D1: the Node entry's revision must be the one observed at the pass-start read, not a constant 0 |
| N2 unparsable fence | **CLOSED** | Line 243 (the exit writes `keys` := the full listing and keeps the damaged bytes in `priorFences`); line 245 (CAS discard at the revision or bytes, parsable or not, plus the "cleanup blocked" notice); vectors F5 and F6 and the mutant at line 247; test line 505 | The superset argument holds: GC deletes nothing while the fence is unparsable, and while it was parsable every listed key was kept live. N1's window is now closed by the per-batch check. See E1 |
| N3 fence read cost | **CLOSED** | Line 244: version per batch, body once per pass and again only after a fence conflict; Node cost stated; IndexedDB cloning disclosed with a sidecar-stamp option to measure | — |
| N4 Tauri ordering | **CLOSED** | Line 239 (the exit waits for `flushed`); line 389 (boot re-flush of `store2-fence`; marker only after `flushed === true`); test line 506 | — |
| N5 case of `u` | **CLOSED** | Line 328 (candidates lower-cased before the `u` lookup); test line 507 | — |
| R-a Tier 2 for version bumps | **CLOSED** | Lines 142 and 308: a bump is Tier 1 with refusal | Sound. An older reader treats a higher `v` as unreadable and deletes nothing. An older writer re-derives the list with its own lower `v`, which a newer build sees as stale and re-derives. The Tier 1 staleness rule (line 141) is met |

## B. The three focus checks

1. **Node fence check-only entry, "an absent key compares as 0" (line 244; also test line 503, "absent compares 0"): FALSE as a general rule.** READ:
   - `assertCheckOnly` compares `revisions[path] ?? 0` (`W:server.cjs:470`).
   - A guarded remove bumps the key's revision and keeps the entry unless `retire` is set (`:1778-1782`, `:1824-1843`).
   - Retire is refused outside `store2/` (`W:nodeHttpStore.ts:469`), and `store2-fence` is outside the prefix.
   - So after the first discard, a CAS delete through the guarded remove, the absent `store2-fence` has revision N + 1 ≥ 2, not 0.
   - The plan cites `W:contract.ts:177-184` ("absent, or retired, compares as version 0"). That stage 0a comment is accurate only for a key that was never written, or was retired. It is inaccurate for a key removed without retire, and for a write that crashed after its revision bump.
   - Consequence, if implemented as worded: every GC and sweep batch after the first discard conflicts on `store2-fence`. Line 244 says a conflicting batch "deletes nothing and restarts the pass", so it restarts forever: GC and the sweep never delete again and the store grows without bound. Safe, but a livelock.
   - (A fence that is absent with N ≥ 1 because a crashed first create bumped the revision has the same effect.)
2. **N2's `priorFences` exit: sound.** It is CAS'd at the unparsable fence's revision or bytes, like any extend (line 239 step 2). See E1 for the interface.
3. **Every recorded item has a non-null `rev`: CLOSED** (line 318). A Node record item with `rev: null`, from any source, is never deleted, so the race is closed for every item that can be deleted.

## C. Did H1 to H12 introduce new defects?

- **D1 (LOW-MEDIUM, liveness; the condition that remains).** The Node fence check-only entry must carry **the revision returned by the pass-start fence read**, as `readState` does for an absent key with `x-risu-revision`, exactly as the first-life create already does (line 239: "the revision returned with an absence read").
  - Fix line 244 and test line 503 to say so.
  - Add a test: "fence created, discarded, then a GC pass deletes garbage: absent, revision 2".
  - Add a mutant: "absent fence checked at revision 0".
  - Optionally record that the stage 0a comment in `contract.ts` needs correcting in P0a or the 1b Gate 2 (an absent key compares at its last revision unless it was retired). That is a documentation fix only.
- **E1 (EDITORIAL; must reach the 1a vectors).**
  - `priorFences` is defined only in prose (line 239: "optional `priorFences: { at, bytes }[]` (Tier 1)"). It is missing from the `FenceRecord` interface (lines 232 to 237), yet vector F5 depends on it. Add `priorFences?: { at: number, bytes: string }[]` to the interface.
  - Being Tier 1 is right: no deleter reads it, and writers copy unknown fields of the fence record (line 141).
- Nothing else: no new data-loss or format defect in H1 to H12.
  - The R-a change is sound, as shown above.
  - The IndexedDB "presence by `count`, body only when present" detects both a fence's creation and its extension, since the body is compared when the fence is present.

## D. Conditions remaining

1. **D1.** The Node per-batch check-only entry on `store2-fence` uses the revision observed at the pass-start read (absent included), not 0. Correct line 244 and test line 503, and add the "absent, revision 2 after discard" test and the mutant.
2. **E1.** Add `priorFences?` to the `FenceRecord` interface for the F5 vector.

## Checked versus inferred

- **READ:** `server.cjs:391-431` and `:468-479`; the remove handler's bump and retire branches (`:1778-1843`, read in round 3); `contract.ts:176-184`; the plan lines cited above.
- **REASONED:** the livelock in D1 and the soundness of the R-a change.
- **Artefacts:** this file only. No processes, and no repository or git writes.
