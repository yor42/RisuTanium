// @vitest-environment node
// The backup chooser is critical as a whole (MC-3248): every part at or under its marked root is in SETTINGS_CRITICAL, so a pack can
// neither hide nor restyle the encryption warnings or the Cancel and Start controls. MC-3249: no other live Settings part is critical
// because of a marker; the census finds exactly one marked root.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { THEME_PACK_ROW_ROOTS, censusOfFiles, svelteFilesUnder } from './fixtures/criticalClosure'
import { judgeAreaSheet } from './index'
import { SETTINGS_CRITICAL, SETTINGS_CRITICAL_CLOSURE } from './registries/settings'
import { SETTINGS_LINT_REGISTRY } from './registries/settings5b'
import { ESCAPE_ROUTE_PARTS, selectorTier } from './engine'

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const files = [...svelteFilesUnder(path.join(root, 'src/lib/SettingsShell')), ...svelteFilesUnder(path.join(root, 'src/lib/Setting'))].filter((file) => !/\.test\.|Harness|Stub|testHost/.test(file))

const chooser = path.join(root, 'src/lib/SettingsShell/data/BackupChooserSheet.svelte')

describe('S3a-2 the critical chooser (MC-3248)', () => {
    const census = censusOfFiles([chooser])

    it('the census follows every construct under the marked root', () => {
        expect(census.problems).toEqual([])
        expect(census.roots).toEqual(['settings-data-chooser-root'])
    })

    it('MC-3249: the chooser root is the only marked root of the Settings tree apart from the Theme pack row and the escape routes (protected by name)', () => {
        const all = censusOfFiles(files)
        expect(all.roots.filter((name) => !THEME_PACK_ROW_ROOTS.includes(name) && !ESCAPE_ROUTE_PARTS.includes(name))).toEqual(['settings-data-chooser-root'])
    })

    it('the pinned SETTINGS_CRITICAL_CLOSURE equals the census', () => {
        expect(SETTINGS_CRITICAL_CLOSURE, `regenerate: ${JSON.stringify(census.names)}`).toEqual(census.names)
    })

    it('the closure is inside the SETTINGS_CRITICAL literal, so the slice registries that spread it statically carry it', () => {
        for (const name of SETTINGS_CRITICAL_CLOSURE) {
            expect(SETTINGS_CRITICAL, name).toContain(name)
            expect(selectorTier(`[data-part="${name}"]`, SETTINGS_LINT_REGISTRY), name).not.toBe('safe')
        }
    })

    it('a pack cannot name any part of the chooser: the sheet is refused', () => {
        for (const name of SETTINGS_CRITICAL_CLOSURE) {
            const verdict = judgeAreaSheet('settings', `[data-part="${name}"]{background-color:#000}`)
            expect(verdict.result.ok, name).toBe(false)
        }
    })
})
