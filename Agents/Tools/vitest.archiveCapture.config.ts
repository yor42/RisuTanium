/**
 * Vitest config of the archive capture harness (`save-gen/archiveCapture.svelte.harness.ts`).
 *
 * It merges the repository's own `vitest.config.ts`, so the capture runs under the same plugin set as `pnpm test`: the
 * Svelte proxy patch, the Svelte plugin with the async flag, the async-flag default, the `src` alias, happy-dom and
 * `vitest.setup.ts`. Only `root` and `include` are set here. `ARCHIVE_CAPTURE_CONFIG` tells the harness it runs under
 * this config; under any other config that includes it (the save-gen harness config matches `*.harness.ts`) the
 * harness skips itself, so it never rewrites or re-checks fixtures by accident.
 *
 * Run from the repository root:
 *   npx vitest run --config Agents/Tools/vitest.archiveCapture.config.ts
 * The default run only verifies the committed fixtures. Writing needs `ARCHIVE_CAPTURE_WRITE=1`, and
 * `ARCHIVE_CAPTURE_OUT` redirects the output directory. Never point vitest at the whole save-gen folder: that
 * rewrites binGoldens.
 */
import { fileURLToPath } from 'node:url'
import { mergeConfig } from 'vitest/config'
import repoConfig from '../../vitest.config.ts'

// Agents/Tools/vitest.archiveCapture.config.ts -> repo root is two levels up.
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

export default mergeConfig(repoConfig, {
    root: REPO_ROOT,
    test: {
        include: ['Agents/Tools/save-gen/archiveCapture*.svelte.harness.ts'],
        env: { ARCHIVE_CAPTURE_CONFIG: '1' },
    },
})
