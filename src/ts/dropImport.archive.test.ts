/**
 * `importDroppedFile` in `src/ts/dropImport.ts`: a dropped character card is imported with the archive flag, so the
 * card goes straight to the archive when archiving can run. Presets and modules never carry it. The importer is a
 * recorder; whether the card is archived is decided in `characterCards.ts` (`characterCards.archiveImport.test.ts`).
 *
 * Labels: "new behaviour" fails on the base, where the flag does not exist.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    imports: [] as Array<{ name: string, archive?: boolean }>,
}))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => false),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/characterCards'), () => ({
    importCharacterProcess: vi.fn(async (f: { name: string, archive?: boolean }) => { h.imports.push(f); return 0 }),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/process/modules'), () => ({
    readModule: vi.fn(async () => ({ name: 'Synthetic', id: 'x' })),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/bootWindow'), () => ({
    markBootWrite: vi.fn(),
}) as unknown as typeof import('src/ts/bootWindow'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { modules: [] } } },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    importPreset: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

import { importDroppedFile } from 'src/ts/dropImport'

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name)

beforeEach(() => {
    h.imports = []
})

describe('a dropped file', () => {
    test.each(['card.png', 'card.charx', 'card.json'])('new behaviour: %s is imported with the archive flag', async (name) => {
        await importDroppedFile(file(name))

        expect(h.imports).toHaveLength(1)
        expect(h.imports[0].name).toBe(name)
        expect(h.imports[0].archive).toBe(true)
    })

    test.each(['preset.risup', 'module.risum'])('guard: %s never reaches the character importer', async (name) => {
        await importDroppedFile(file(name))

        expect(h.imports).toEqual([])
    })
})
