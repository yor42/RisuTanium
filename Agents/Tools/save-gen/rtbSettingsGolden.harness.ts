// @vitest-environment node
/**
 * Generator of the settings-only golden `v1-settings-small.rtb` (#161).
 *
 * The file is written by the real producer path of a settings-only file, `writeSettingsRtb`, over a fixed list of
 * records (explicit values, so the golden does not follow the database defaults), with a fixed clock and a fixed
 * injected key environment. The generator checks, before it writes anything, that the file classifies `settings`
 * and verifies, and that the frozen pre-change reader calls it damaged.
 *
 * Writes only through `writeGoldenFile` (exclusive create, refused under any repository) and only when
 * RTB_GENERATE=1, so a run of the whole save-gen folder generates nothing. The checked-in copy is a deliberate hand
 * copy; the size and SHA-256 printed here are written by hand into the golden's consumers.
 *
 * Run (repository root):
 *   $env:RTB_GENERATE = '1'
 *   node node_modules/vitest/vitest.mjs run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/rtbSettingsGolden.harness.ts
 */
import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { classifyRtb } from 'src/ts/drive/rtb/rtbClassify'
import { verifyRtb } from 'src/ts/drive/rtb/rtbVerify'
import { goldenOutDir, writeGoldenFile } from 'src/ts/drive/tests/rtb/goldenOut'
import { classifyRtb as classifyOld } from 'src/ts/drive/tests/rtb/oldReader/rtbClassify'
import { SETTINGS_GOLDEN_RECORDS, SETTINGS_GOLDEN_UI_PREFS } from 'src/ts/drive/tests/rtb/settingsGoldenInput'
import { settingsFile } from 'src/ts/drive/tests/rtb/settingsFileKit'

const GENERATE = process.env.RTB_GENERATE === '1'
const NAME = 'v1-settings-small.rtb'

describe.skipIf(!GENERATE)('settings golden generation (RTB_GENERATE=1)', () => {
    test('writes v1-settings-small.rtb', async () => {
        const file = await settingsFile({ settings: SETTINGS_GOLDEN_RECORDS, uiPrefs: SETTINGS_GOLDEN_UI_PREFS })
        expect((await classifyRtb(file.source)).kind).toBe('settings')
        expect((await verifyRtb(file.source)).kind).toBe('settings')
        expect((await classifyOld(file.source)).kind).toBe('damaged')

        const bytes = file.bytes()
        const written = writeGoldenFile(goldenOutDir(), NAME, bytes)
        process.stdout.write(`settings golden file: ${written}\n`)
        process.stdout.write(`settings golden size: ${bytes.length} bytes\n`)
        process.stdout.write(`settings golden sha256: ${createHash('sha256').update(bytes).digest('hex')}\n`)
    })
})
