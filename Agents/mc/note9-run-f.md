### MC-5070 — Run F: async-study measurements taken on the Note 9, no application code

Measurement-only run on phone 2 with a MEASURE build and scratch probes; results are in `Agents/Findings-2026-11-28-async-measurements.md`. No product decision was made.

### MC-5071 — D-301-SAVE first Note 9 pass: edit 130 ms, Undo all 207 ms (n=1)

The staged save pass meets the 200 ms target for the edit and misses it by 7 ms for Undo all on one run; the verdict stays inconclusive until 3 to 5 cold runs exist. The Studio was reached through the device-local `risuStudio.enabled` switch set over CDP.

### MC-5072 — Thermal gate noted

Battery was 34.8 C at the start of the save pass, above the 34.0 C cap, and the windows ran after a screen-off cool-down to 33.4 C. The CPU zone cannot be read without root, so only the battery half of the gate was checked.

### MC-5073 — Row 4, #193 and #508 not run; handed to a device-runner dispatch

By the maintainer rule of 2026-11-28 (orchestrate, do not drive devices inline) the remaining rows go to one device-runner subagent per device with their own briefs.
