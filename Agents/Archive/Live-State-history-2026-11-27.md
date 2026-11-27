# Live State history, replaced 2026-11-27

These current-state paragraphs of [Live-State](../Live-State.md) were replaced by lane A on 2026-11-27 (records PR of that date). They are kept verbatim.

- **Merged work and open PRs:** read `git log origin/main` and the open PR list on yor42/RisuTanium; the records batch 5 paragraph that stood here is archived verbatim in [Archive/Live-State-history-2026-11-20.md](Archive/Live-State-history-2026-11-20.md). MC IDs come from per-session blocks of 10 assigned by lane A (MC-2713); blocks are granted through MC-4089 as of 2026-11-23 (the next block starts at MC-4090; lane A's own next free ID is MC-3878), and pending entries live in `Agents/mc/` until folded. The 2026-11-22 and 2026-11-24 records batches folded every entry merged by then.

- **New sessions:** the 2026-11-22 hold is lifted (MC-3615). Every new session start is asked, naming its model (MC-3622, MC-3764). New work goes first to the MVP-update blockers (MC-3616): #590 (open), #603 (closed 2026-11-23) and #596 (open; stages 1, 2, 5 and 7, MC-3734/3735). After those, the performance tickets come next (MC-3618).

- **Release blockers (MC-3870, MC-3871):** issues labelled `release-blocker` on yor42/RisuTanium: the remaining Studio work and the theme-pack rework (#654, after #560 and #438). Studio S1 (#679), S2 (#680), S4 (#682) and S5 (#683) are merged and closed; S3 (#681), S6 (#684), S7 (#685) and S8 (#686) are open.

- **Current MVP (batch 54, 2026-11-05):** the release-signed APK of main `a3b5d706e` (`MC-1082`), built by the maintainer and installed on their phone at 14:39 KST; APK sha256 `4716857a605c614beebe0888e3e67291006de53112313317102b470c29f30cc4` (as typed, matches `result.json`); the maintainer reports no data loss (not checked by the lane). It contains CHORE-412 layout 2, so an older APK cannot read the store after the update and the way back is the pre-update `.bin` (`MC-1074`). `MC-350` carry-forward is live from this build. Dirty tree at build time: `dirty: true` (the unowned files, including the Android manifest edit). Owed: the Note 9 check of the streamed-fetch port (`MC-1078`).
