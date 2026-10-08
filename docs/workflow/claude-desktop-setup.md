# Claude Desktop Code setup

The maintainer primarily uses the local Desktop Code tab (MC-242). The approved additions are scoped rules, language intelligence and Desktop-preview-first live checks (MC-243). Side chats are already part of the maintainer's practice. Repository configuration is prepared; this audit installs no plugins or language-server binaries. [Feature decision record](feature-opportunities-2026-10-08.md).

## Install manually

Run from `C:\Projects\RisuAI` in PowerShell with Node/npm and rustup available. The observed CLI is 2.1.286 and Node is 24.19.0; recheck versions when using this procedure. The application currently uses TypeScript 5.9.3. The global TypeScript pin below matches that observation and does not change application dependencies.

| Plugin | Server and coverage |
|---|---|
| `typescript-lsp@claude-plugins-official` | `typescript-language-server` plus TypeScript; TypeScript/JavaScript source. |
| `rust-analyzer-lsp@claude-plugins-official` | `rust-analyzer`; Rust source. |
| `svelte-lsp@risutanium-lsp` | `svelteserver` from `svelte-language-server`; `.svelte` components, through this repository's local adapter. |

Anthropic's language plugins require separately installed server binaries. The Svelte adapter uses the supported inline `lspServers` manifest form; it is a local plugin, not an Anthropic-maintained plugin. [Official code intelligence](https://code.claude.com/docs/en/plugins/code-intelligence), [manifest reference](https://code.claude.com/docs/en/plugins-reference#lspservers), [Svelte language server](https://github.com/sveltejs/language-tools/tree/master/packages/language-server).

```powershell
npm install -g typescript@5.9.3 typescript-language-server svelte-language-server
rustup component add rust-analyzer

claude plugin marketplace add anthropics/claude-plugins-official --scope project
claude plugin install typescript-lsp@claude-plugins-official --scope project
claude plugin install rust-analyzer-lsp@claude-plugins-official --scope project
claude plugin marketplace add ./.claude/lsp-marketplace --scope project
claude plugin install svelte-lsp@risutanium-lsp --scope project
```

The marketplace/install CLI help was checked for project scope. The explicit `./` identifies the local marketplace path. Project enablement is shared in `.claude/settings.json`, but each machine still needs its installations. Existing user plugins are retained. [Installation and scope](https://code.claude.com/docs/en/discover-plugins#choose-an-install-scope), [local marketplace sources](https://code.claude.com/docs/en/discover-plugins#add-a-marketplace), [rustup components](https://rust-lang.github.io/rustup/concepts/components.html).

Fully quit and restart Claude Desktop after installing binaries so the Code tab inherits the updated PATH. Open a local session rooted in this checkout. Desktop and the standalone CLI share project instructions and settings; this does not establish that a particular Desktop session loaded a plugin successfully. Cloud sessions do not start these plugin language servers. [Shared configuration](https://code.claude.com/docs/en/desktop#shared-configuration), [code intelligence availability](https://code.claude.com/docs/en/plugins/code-intelligence).

## Verify the installed session

```powershell
pwsh -NoProfile -File .claude/scripts/validate-workflow.ps1
pwsh -NoProfile -File .claude/scripts/check-language-intelligence.ps1 -MetadataOnly
pwsh -NoProfile -File .claude/scripts/check-language-intelligence.ps1
claude plugin list
```

`-MetadataOnly` checks repository wiring, not runtime readiness. The normal checker inspects installed plugin inventory and bounded server availability/version probes; it does not demonstrate an initialized LSP connection or prove diagnostics. Before installation, missing prerequisites are expected. At audit discovery, TypeScript/Svelte server binaries were absent, the Rust rustup shim could not run the missing component, and the official marketplace was absent. Installed user plugins were `codex@openai-codex` and `eli5@claude-community`. These are dated observations, not prerequisites to remove anything.

In the Desktop Code session, inspect plugin errors and ask for one read-only definition/reference lookup in an existing `.ts`, `.rs` and `.svelte` file. Record actual tool availability, the source location returned and any startup failure. Open each relevant source file with Read before interpreting it. Scoped rules trigger on Read/Write/Edit, so an LSP lookup alone is insufficient to load its rule. The four rule files cover storage, Svelte, translations and tests; universal compatibility/gates remain in AGENTS.md. [Scoped-rule triggers](https://code.claude.com/docs/en/memory#path-specific-rules).

Successful symbol navigation is evidence for that operation, not for post-edit diagnostics. Observe diagnostics on the next authorized relevant edit and record that separately; do not introduce a source change just to finish setup. LSP results do not replace literal coverage searches, required compiler/tests or independent review. Selected source-reading agent profiles receive `LSP`; tool availability must still be checked at dispatch. A missing server blocks LSP-specific verification, not unrelated source reads or campaign work.

Native write-hook loading is a separate remaining observation. The synthetic ownership-guard suite does not prove Desktop hook execution. Follow [ownership](ownership.md) for exact grants and its stated limits. Use [live checks](live-checks.md) for UI evidence and [the resumption prompt](resume-main-campaign.md) to continue the campaign.
