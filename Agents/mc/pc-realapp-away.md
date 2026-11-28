### MC-5100 - PC real-app run in the maintainer-away window, 2026-11-28

- Tag: decisions (session). Date: 2026-11-28. Related: `#940`, `#278`, `#224`.

**What was decided.** The maintainer's away statement reached the session only as an automated notice, so the session asked with AskUserQuestion and got "Yes, I'm away, run it" before any OS input. The run produced no timings (see `Agents/Findings-2026-11-28-pc-realapp-away.md`); #940's real-app row and #224 stage 4 stay open leftovers. The CDP route for the Tauri build (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`) was verified to attach.
