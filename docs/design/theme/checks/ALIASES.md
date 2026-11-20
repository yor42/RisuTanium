# DD-235 shared tokens: values chosen and the aliases each area should adopt

Added to `theme/nexus-tokens.css` (additive). Nothing in the areas is rewired by this change; each area adopts the aliases in its next round, then packs state each value once.

| Shared token | Value | Taken from | Why |
|---|---|---|---|
| `--nexus-warm-rgb` | `255 179 138` | = `--nexus-warm` (#ffb38a); Home `--home-warm-rgb` and Studio `--studio-warm-rgb` already hold it | three definitions agree; no visible change. `--nexus-warm` stays a literal (additive); deriving it from the channel is the DD-158 step |
| `--nexus-success-rgb` | `110 231 168` | Settings `--color-success` (#6ee7a8) | Settings' packs already restate that name; Home's `111 227 160` is within 2 per channel, so the difference is not visible. Studio's `--studio-ok-rgb` (94 234 212, teal) is a different status colour and is not aliased |
| `--nexus-touch` | `44px` | chat `--size-touch`, Settings `--size-touch`, Home `--home-touch` | all three are 44 px; the 36 px (-sm) and 48 px (-lg) variants stay per area |
| `--nexus-focus-ring-width` | `2px` | chat/Settings `--focus-ring-w`, Home `--home-focus-w` | all three are 2 px. Lint: the shared token 1 to 4 px; chat and Settings `--focus-ring-w` and `--focus-ring-w-forced` 1 to 4 px (Settings' `--focus-ring-w` reads the shared token, so a Settings sheet keeps it at 4 px or under); Home `--home-focus-w` 1 to 8 px |
| `--nexus-focus-ring-offset` | `2px` | chat/Settings `--focus-ring-offset`, Home `--home-focus-offset` | all three are 2 px. Lint: the shared token -4 to 6 px; chat `--focus-ring-offset`, `--focus-ring-offset-inset` and `--focus-ring-offset-wide` -6 to 6 px (Settings' `--focus-ring-offset` reads the shared token, so through it the effective offset is up to 6 px); Home `--home-focus-offset` -4 to 8 px |

`--nexus-field-border` is 36% (DD-236).

## Aliases per area (to adopt; not done here)

- **chat** (`chat/theme-tokens.css`): `--size-touch: var(--nexus-touch)`; `--focus-ring-w: var(--nexus-focus-ring-width)`; `--focus-ring-offset: var(--nexus-focus-ring-offset)`; stop defining `--chat-speaker-0`'s warm copy if it equals `rgb(var(--nexus-warm-rgb))`.
- **Settings** (`settings/theme-tokens.css`): `--color-success: rgb(var(--nexus-success-rgb))`; `--size-touch: var(--nexus-touch)`; `--focus-ring-w: var(--nexus-focus-ring-width)`; `--focus-ring-offset: var(--nexus-focus-ring-offset)`; `--color-warning` already derives from `--nexus-warning-rgb`.
- **Home** (`home/home-tokens.css`): `--home-warm-rgb: var(--nexus-warm-rgb)`; `--home-success-rgb: var(--nexus-success-rgb)`; `--home-touch: var(--nexus-touch)`; `--home-focus-w: var(--nexus-focus-ring-width)`; `--home-focus-offset: var(--nexus-focus-ring-offset)`; `--home-warning-rgb: var(--nexus-warning-rgb)` (Home's `255 210 122` differs from the shared `255 209 102`: one pixel check).
- **Studio** (`studio/studio-tokens.css`): `--studio-warm-rgb: var(--nexus-warm-rgb)`; `--studio-size-touch: var(--nexus-touch)`; `--studio-size-ring: var(--nexus-focus-ring-width)`; `--studio-ring-offset: var(--nexus-focus-ring-offset)`.

Once an area aliases a token, its registry floors for the old name can move to the shared name (the shared floors are already in `chat/checks/th/packlint.mjs`, `SHARED_MINIMUMS` / `SHARED_MAXIMUMS`).
