# Per-PR MC record files

Each ticket PR writes its new maintainer-decision entries to its own file here, `Agents/mc/<ticket>.md` (MC-3044), instead of appending to [Maintainer-Context](../Maintainer-Context.md). Two PRs then never conflict over records.

- Use IDs from the session's own MC block (MC-2713) and the log's heading shape: `### MC-NNN — literal title`, then the entry body. The file holds no other `MC-` headings.
- Do not regenerate [Decision-Index](../Decision-Index.md) in a ticket PR. Run `pwsh -NoProfile -File .claude/scripts/update-decision-index.ps1 -Check` before merge: it checks the heading shape, fails on an ID used twice in the log or here, and lists the pending entries.
- Cite a pending entry by its ID, not by a link to its file here: lane A folds these files into Maintainer-Context in a records-only PR and deletes them.

The full procedure, including the fold, is in [item records](../../docs/workflow/records.md).
