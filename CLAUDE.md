@AGENTS.md

Claude-specific workflow: use the `campaign-workflow` skill and the focused skills it references. Role profiles live in `.claude/agents/`; canonical routing and gates live in `docs/workflow/`. Load task-relevant campaign decisions through the decision index; do not automatically import the full campaign log or archived handoffs.
