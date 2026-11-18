// @vitest-environment happy-dom
import { describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { presetTemplate, setDatabase, type Database } from 'src/ts/storage/database.svelte'
import { decodeRisuSave } from 'src/ts/storage/risuSave'
import { writeRisuSaveV0 } from 'src/ts/storage/risuSaveV0'
import { takePresetIdsMinted } from 'src/ts/storage/presetMeta'

/**
 * A decoded save whose preset list is empty gets a default preset for the page. That preset is its own object: the
 * module's `presetTemplate` is never handed out, so giving the decoded preset an id (or any other change) can never
 * reach the template every later creation site starts from.
 */
describe('a decoded save with an empty preset list', () => {
    test('A14 the repair puts a clone of the template in the list, and setDatabase gives the clone an id without touching the template', async () => {
        const saved = writeRisuSaveV0({ botPresets: [] }, {})
        const decoded = await decodeRisuSave(saved) as Database
        expect(decoded.botPresets).toHaveLength(1)
        expect(decoded.botPresets[0]).not.toBe(presetTemplate)
        expect(decoded.botPresets[0].name).toBe(presetTemplate.name)
        expect(decoded.botPresetsId).toBe(0)

        takePresetIdsMinted()
        setDatabase(decoded)
        expect(typeof decoded.botPresets[0].id).toBe('string')
        expect(presetTemplate.id).toBeUndefined()
        expect(takePresetIdsMinted()).toBe(true)
    })
})
