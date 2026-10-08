# Live UI checks

Use Claude Desktop's Code-tab preview first for local web UI acceptance (MC-243). Anthropic documents DOM inspection, clicks, forms, screenshots and server logs in its preview. The maintainer's `.claude/launch.json` is preserved; do not overwrite it to enable this procedure. Check actual browser tools in the controlling session before promising a check. [Desktop previews](https://code.claude.com/docs/en/desktop#preview-your-app).

The orchestrator owns the live check or names one controller with the tools actually available. Custom agent profiles do not acquire browser capabilities from a written brief. Read-only reviewers can inspect saved artifacts and source; an implementer's auto-verification does not replace the independent gate. [Gates](gates.md), [ownership](ownership.md).

## Evidence procedure

1. Name the acceptance scenario, expected visible behavior and any underlying invariant before interaction. Identify the applicable code/dirty snapshot, dependencies, launch command/configuration, browser surface, operating system and viewport. Use synthetic profiles and local fixtures; never probe external community services.
2. Start or reuse the authorized local preview, checking ownership before stopping or replacing a server. Record readiness or startup failure. Test the specified actions and relevant boundary states, including errors when they belong to the requirement. Do not widen the product scope from an unrelated preview finding.
3. Capture the relevant DOM/interaction result, screenshot and logs or errors. Record observed behavior against the expectation and name retained artifacts. A screenshot alone cannot prove persistence, native behavior or invisible data integrity; add the applicable save/reload checks and source/runtime evidence.
4. Give the independent reviewer the scenario, observed snapshot, results and relevant artifacts. Failed or unavailable checks remain explicit. Keep final reproducible evidence under the item's [curated evidence policy](records.md); do not delete the only raw copy.
5. Stop only processes created for the check and leave pre-existing sessions/configuration intact. State what remains unverified, especially phone hardware, native Tauri/Android behavior or a different browser.

For responsive checks, record both the desktop and the actual narrow viewport used; viewport emulation does not establish phone performance or native system-bar behavior. For persistence, DOM success and a mocked backend are insufficient. Use the applicable storage gates and compatibility fixtures.

## Chrome fallback

Use Claude in Chrome when the specific acceptance scenario requires Chrome behavior, an already authorized browser profile or capabilities unavailable in the Desktop preview. Record that reason and the actual extension/tool connection. Desktop preview has its own browser profile; the Chrome extension uses the Chrome profile's state. Prefer a synthetic Chrome profile for campaign checks. No additional browser plugin is required for the Desktop preview; Chrome-extension installation is conditional on needing that fallback. [Surface comparison](https://code.claude.com/docs/en/desktop#choose-between-the-browser-and-the-chrome-extension), [Chrome integration](https://code.claude.com/docs/en/chrome).

Availability is checked in the active session, not inferred from the CLI version or configuration alone. If neither surface can execute the named scenario, retain it as pending live verification and continue independent work that does not rely on its result.
