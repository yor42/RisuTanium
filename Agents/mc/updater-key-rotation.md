### MC-4950 — Updater key rotated before the first release, no bridge release, 2026-11-28

- Tag: maintainer decision (AskUserQuestion and typed). Date: 2026-11-28. Exact times: UNKNOWN. Sweep ref: none. Related: `MC-011`, `MC-350`, `src-tauri/tauri.conf.json`, `src/ts/appIdentity.test.ts`.

The fork has no public release, so the maintainer regenerated the Tauri updater (minisign) key pair once more. No installed desktop build needs to keep updating, so there is no bridge release signed by the old key. `plugins.updater.pubkey` now decodes to key ID 159040A7D677A273 (old: ED1D63FEDD9B600F); the endpoints are unchanged. The pin in `appIdentity.test.ts` carries the new value.

### MC-4951 — Updater signing key lives in a separate environment `desktop-release`, 2026-11-28

- Tag: maintainer decision. Date: 2026-11-28. Exact times: UNKNOWN. Sweep ref: none. Related: `MC-4950`, `.github/workflows/release-desktop.yml`.

The maintainer created the GitHub environment `desktop-release` (branch rule main only, admin bypass off) holding TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD. Only `build-desktop` names it, so a run dispatched from another branch cannot read the key. The workflow must be dispatched from main.

### MC-4952 — Old repository-level signing secrets are deleted after this PR merges, 2026-11-28

- Tag: maintainer action owed. Date: 2026-11-28. Exact times: UNKNOWN. Sweep ref: none. Related: `MC-4951`.

The maintainer deletes the two old repository-level secrets (same names) after merge. Until then a repository-level secret of the same name is shadowed by the environment secret on `build-desktop`.

### MC-4953 — Guard against leftover repository-level signing secrets not landed yet, 2026-11-28

- Tag: follow-up, decision owed (lane A). Date: 2026-11-28. Exact times: UNKNOWN. Sweep ref: none. Related: `MC-4952`.

A guard in the pattern of android-release-apk.yml (a keyless job with no environment reading `secrets.X != ''` into `REPO_HAS_*`, failing when true) would fail every run until the old secrets are deleted. It is omitted from this PR pending lane A's answer; it needs no new action.

### MC-4954 — Device rows: none, 2026-11-28

- Tag: records (MC-2713). Date: 2026-11-28. Exact times: UNKNOWN. Sweep ref: none. Related: `MC-4950`.

No device row: the change is a config pin, a workflow environment name and tests. The first real check is the first dispatch from main (signed `.sig` verifies against the new pubkey).
