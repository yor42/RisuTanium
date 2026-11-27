# #620 warm workspace delete: phase 1 findings (report only, no product change)

Branch `claude/620-warm-delete`, base `origin/main` ad45e394a (merge of #795). Ticket: yor42/RisuTanium #620 (leftover of #202 PR-F / #615, lane B's Note 9 run D-1). Closing keyword until a fix is proven on the Note 9: `Refs #620`. MC block MC-4440..4449 (entries in `Agents/mc/620.md`).

## Verdict

**The PC does not reproduce the slowdown, and no stage that grows with session age was found.** On the Node-server store2 page, in a measurement production build, a delete after four full imports takes 0.6 to 0.9 s (all of it save-loop debounce plus a 13 to 16 ms commit), and the first save after a fresh boot is the slower one (1.6 s), the opposite of the Note 9 observation. That matches the earlier source reading (`dv-inv-result.md`, Q3: warm path cheaper than cold). What the PC cannot show is Android storage speed, and that is where the data points: the Note 9 import commits took 6 to 11 s against 0.4 to 0.5 s here (about 15x to 25x). The leading hypothesis is candidate A below, unconfirmed.

## What was run (evidence)

- Code: worktree HEAD `ad45e394a`, `git status --short` clean. The measurement build is `VITE_RISU_MEASURE=1` production (`vite build`) with a scratch-only vite wrapper outside the repo that appends read-only probe globals (`DBState`, `createWorkspace`, `deleteWorkspace`, `commitWorkspaceChange`, `listWorkspaces`) to `stores.svelte.ts` and `workspaceModel.svelte.ts`. No repo file changed. Heavy-job slot B held for the build and runs, released.
- Harness: `Agents/Tools/node-scale` (`c806-server`, `c806-page`, own server port in 6800-6899, own CDP port, synthetic 3-character tree `t620`, Chrome through `launch-chrome.mjs` with the resolver block). Driver (scratch, outside the repo): `%TEMP%\risu-b715\b61\c806\scratch\620\repro620.mjs`. Dist `index.html` sha256 `6e4558eea9bf87ba9d8534e9fb3ea348bb09a5d51fd4c9ca35a5dde843ce85ca`.
- Hardware: the maintainer's PC (best case, a lower bound; not a statement about the phone).
- Data: four workspaces of 26 files of about 900 KiB (about 22.9 MiB each, 91 MiB total, inside the 25 MiB / 100 MiB caps), text decoded through `TextDecoder` with Korean and Latin words, written by `commitWorkspaceChange` in one op list per workspace (the same call `importPickedFiles` makes).
- Run `t620b`, raw log `%TEMP%\risu-b715\b61\c806\runs\620\t620b-*\log.jsonl`, CPU profiles beside it (`*.cpuprofile`). A first run `t620a` is **superseded**: my files overshot the 1 MiB file cap, every import was refused, nothing was stored.

| Step (run `t620b`) | tap to first commit | commit | save pass | JS heap | main-thread long tasks |
|---|---|---|---|---|---|
| import ws1..ws4 (26 files each) | 1.64 to 1.80 s | 405 to 475 ms, 28 units, 25.7 MB | 267 to 295 ms | 98 to 143 MB | one block of about 0.4 s (my text generation) plus the 0.27 to 0.30 s pass |
| warm delete of one file, straight after the 4 imports (no idle) | 0.58 s | 16 ms, 2 units | 3.6 ms edit | 154 MB | none |
| warm delete of one file after 60 s idle (no commit during the idle) | 0.92 s | 15 ms | 4.9 ms | 118 MB | none |
| warm delete of a whole workspace | 0.60 s | 15 ms, 1 unit | 3.8 ms | 118 MB | none |
| fresh boot (navigate again, same data), delete one file | 1.62 s | 13 ms | 890 ms (memo cold, hashes every text) | 326 MB | one 887 ms block |
| fresh boot, delete a workspace | 1.07 s | 13 ms | 3.1 ms | 328 MB | none |

Reading:

- **Nothing grows with age.** The delete pass and commit cost the same after four 25 MB imports as the first one; the CPU profile of every warm delete is 98% idle, with the debounce as the only wait. No `putText`, digest, flatten or walk shows in the warm profiles.
- **The cold first save is the expensive one**, as the source reading predicted: the workspace memo is empty after a boot, so that pass frames and digests all 91 MiB (890 ms on this PC; `encode`, `block`, `keys` in the profile).
- **Refuted on the PC, together with the source reading:** per-save re-hashing of workspace text (warm is the cheap path), unpruned memo growth, string-representation effects (the text came through `TextDecoder` like the zip path), debug-build proxy overhead (this is a production build), a GC or sweep walk (the collector runs once per page load from the maintenance step, `gc/autoGc.ts`, never per delete), and the delete itself (`deleteWorkspace` is a synchronous array filter plus an async grant removal).

## Where the 15 to 17 s can come from (not measured)

The D-1 number was measured as tap to the first change of `store2-commit`. In that session each import commit took 6 to 11 s. A delete tapped while an earlier import's commit (about 25 MB of fsynced unit writes on the Tauri backend, under `underMutex`) was still running, or while a second pass queued behind it, waits for the remainder before its own 15 ms commit can start. A fresh boot has no such backlog, which also explains the 2.4 s (debounce plus the cold pass seen here, slower storage). This is **candidate A** of `dv-inv-result.md`. It needs the Note 9 to confirm; the PC cannot, because its commits finish in under half a second so the backlog never exists. Nothing here shows a defect in the delete path itself.

## Note 9 leg (plan, not run; needs lane A's go for the lease and the build)

Goal: separate wait, pass and commit for a warm delete, and test candidate A directly. One PR session owns it (this one), rows through fresh `device-runner` dispatches under the lease.

- Build: debug-signature APK of this worktree with `VITE_RISU_MEASURE=1` and the same scratch probe wrapper (exposes `__risuCommitMeter`, `__risuSavePassMeter`, probe globals), same variant D-1 used so the numbers compare. Needs the `android-build` lease and a heavy-job slot, in that order; `note9` is requested only after the build lease is released (lock order).
- Device: Note 9 phone 1 or 2 from the `note9` pool, synthetic data only, all adb through `adbg` (own ports from the grant, own package), Wi-Fi off read back at start and end, `reverse` only to own ports, STOP rules of the Note 9 profile in every brief. `pm clear` is allowed on a playground phone and destroys only synthetic data; the profile is recreated by the run.
- Rows (each: expected, pass/fail exit, ceiling and time):
  - **DV-620-1** (non-gating, diagnostic): import four full workspaces through the probe, recording per import the commit meter `ms` and the wall time to the commit-key change. Expected: about 6 to 11 s each, as in D-1.
  - **DV-620-2**: delete a file immediately after the last import (no idle), with `performance.now()` stamps at call, at the start of the delete's save pass (savepass meter `at`), and at its commit. Expected under candidate A: the gap between call and pass start is the in-flight remainder. Repeat after waiting until no commit-key change for 60 s: expected about 1 s.
  - **DV-620-3**: warm delete of a whole workspace after idle, then after a force-stop and relaunch, to repeat the 15 s versus 2.4 s contrast with the meters on.
  - A CDP CPU profile (`Profiler`) around DV-620-2 to rule out main-thread work if the gap is not backlog.
- Pass: the 15 s reproduces and the stamps assign it to a named stage, or it does not reproduce once the store is idle (then the answer is "backlog, not a defect"). Time limit per row 3 min; data ceiling 4 x 22.9 MiB.

## Candidate fix and tier

- **If candidate A holds:** there is no defect in the delete. Options, in order of cost: (1) none, document it as expected latency behind an import burst (Tier 0, no code; close #620 with the evidence); (2) a visible "saving" state while the commit is pending (UI only, Tier 1, a product choice for the maintainer); (3) change the save loop so a tiny commit does not queue behind a bulk one, or commit the import in smaller steps. Option 3 touches commit order and durability, a **critical contract: Tier 2 with Opus Gates** (designer plan, Gate 1, `opus-reviewer` Gate 2, mutants), and I do not recommend it for a latency-only item on evidence this thin.
- **If the Note 9 shows a stage that grows** (a flush, a queue or memo effect not visible on the PC): the tier follows the file touched; anything in `saveLoop`, `commit`, `saveEncoder` or the backend is Tier 2 critical.
- No fix is proposed or written before the Note 9 row names the stage.

## Limits

- One PC run (`t620b`) plus the aborted `t620a`; no repeat for variance, because the warm delete numbers sit on the debounce and show no spread worth a second run.
- Synthetic text through `commitWorkspaceChange`, not the real zip picker path (the CRC check and `TextDecoder` stage were mimicked, not run).
- Node-server backend, not Tauri: the `underMutex`/fsync cost of candidate A is exactly what it cannot show.
- Debug versus release Note 9 build effect (candidate C) stays open until the phone run.
