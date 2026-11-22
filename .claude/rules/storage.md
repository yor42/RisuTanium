---
paths:
  - "src/ts/storage/**"
  - "src/ts/globalApi.svelte.ts"
  - "src/ts/process/coldstorage.svelte.ts"
  - "src-tauri/src/**"
---

Persisted main files, backups, remote blocks, assets and cold units use the page's byte store selected by appStore.ts. Trace that selection and the actual write path; do not add platform bypasses. Data is stored by the Tauri files store or the Node server store; a plain web page has no storage. OPFS and the IndexedDB byte store were removed (#509, #542), and data an older build left there is neither read nor deleted.
Dirty tracking must retain every mutation dependency. Partition expensive work without narrowing away dependencies that decide which blocks save. Trace asset-cache correctness contracts before changing them.
Save/persistence, save format, reactive database, asset-cache or silent-loss changes require opus-reviewer for the first review and for any fix touching the contract; other fix re-checks follow [routing](../../docs/workflow/routing.md#remediation-re-checks-mc-3767). Keep the upstream .bin round trip and its named-warning omission exceptions (oversize data after confirmation, MC-223; fork-only data, MC-774; connection keys the Android Keystore cannot decrypt, written empty after a confirm, MC-3074/MC-3076); see [gates](../../docs/workflow/gates.md) and [project reference](../../docs/workflow/project-reference.md).
Before citing Rust crate behavior, inspect the build's actual Cargo.lock and resolved crate source. Cargo.toml ranges do not pin versions. Never read signing secrets or design recovery for already-corrupted fork-local state.
