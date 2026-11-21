/**
 * `importDroppedFile` in `src/ts/dropImport.ts`: a dropped preset or module never reaches the character importer.
 * The importer is a recorder; the card route and its task card are in `dropImport.task.test.ts`.
 *
 * Label: "guard" passes before and after the change that removed the archive flag.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    imports: [] as Array<{ name: string }>,
}))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => false),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

//The drop reads a card through `importCharacterFile`.
vi.mock(import('src/ts/characterCards'), () => ({
    importCharacterFile: vi.fn(async (f: { name: string }) => { h.imports.push(f); return { kind: 'imported', index: 0 } }),
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
import { resetTaskHostForTests } from 'src/ts/alertTask.svelte'
import { answerImportCard } from 'src/ts/process/tests/answerImportCard'

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name)

beforeEach(() => {
    h.imports = []
})

afterEach(() => {
    resetTaskHostForTests()
})

describe('a dropped file', () => {
    test.each(['preset.risup', 'module.risum'])('guard: %s never reaches the character importer', async (name) => {
        await answerImportCard(() => importDroppedFile(file(name)))

        expect(h.imports).toEqual([])
    })
})
