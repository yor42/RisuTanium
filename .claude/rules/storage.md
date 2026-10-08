---
paths:
  - "src/ts/storage/**"
  - "src/ts/globalApi.svelte.ts"
  - "src/ts/process/coldstorage.svelte.ts"
  - "src-tauri/src/**"
---

Persisted main files, backups, remote blocks, assets and cold units use the page's byte store selected by appStore.ts. Trace that selection and the actual write path; do not add platform bypasses or assume OPFS is the normal web store. OPFS is transitional fallback/copy-back.
Dirty tracking must retain every mutation dependency. Partition expensive work without narrowing away dependencies that decide which blocks save. Trace asset-cache correctness contracts before changing them.
Save/persistence, save format, reactive database, asset-cache or silent-loss changes require opus-reviewer. Keep the upstream .bin round trip and its sole named-warning/confirmed oversize exception; see [gates](../../docs/workflow/gates.md) and [project reference](../../docs/workflow/project-reference.md).
Before citing Rust crate behavior, inspect the build's actual Cargo.lock and resolved crate source. Cargo.toml ranges do not pin versions. Never read signing secrets or design recovery for already-corrupted fork-local state.
