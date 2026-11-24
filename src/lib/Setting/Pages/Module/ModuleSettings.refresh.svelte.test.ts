// @vitest-environment jsdom

/**
 * Deleting a module on the classic Modules page refreshes the `getModules` memo at once. A module that a bound
 * character still lists keeps its id in the reference list, and the memo is keyed on that list and on the
 * database's module array, so without a refresh the deleted row would keep feeding prompts until the page closes.
 *
 * Mounts the REAL `ModuleSettings.svelte` over a real `$state` database, with the real `getModules` and
 * `refreshModules`. MOCKED: the alert (the confirm answers yes), the database accessors, the file, card and
 * asset collaborators of `modules.ts`, and the module menu.
 *
 * T9-REFRESH is a regression reproducer: it fails on the page that refreshes only in `onDestroy`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'

//#region module mocks

vi.mock('uuid', () => ({ v4: () => 'uuid' }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertModuleSelect: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => '0'),
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    AssetSourceChangedError: class AssetSourceChangedError extends Error {},
    LocalWriter: class {},
    VirtualWriter: class {},
    checkCharOrder: vi.fn(),
    downloadFile: vi.fn(),
    forageStorage: {},
    getSaveMarkCount: () => 0,
    readImage: vi.fn(async () => undefined),
    saveAsset: vi.fn(async () => 'saved.png'),
    saveAssetFromPieces: vi.fn(async () => 'piece.png'),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkPersonaBinded: vi.fn(() => null),
    selectFileByDom: vi.fn(async () => []),
    sleep: vi.fn(async () => undefined),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (data: Uint8Array) => data),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterFile: vi.fn(async () => ({ kind: 'declined' })),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/process/mcp/mcp'), () => ({
    importMCPModule: vi.fn(),
}) as unknown as typeof import('src/ts/process/mcp/mcp'))

vi.mock(import('src/ts/gui/tooltip'), () => ({
    tooltip: () => ({}),
}) as unknown as typeof import('src/ts/gui/tooltip'))

vi.mock('src/lib/Setting/Pages/Module/ModuleMenu.svelte', () => ({ default: () => {} }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        selIdState: { selId: 0 },
        ReloadGUIPointer: writable(0),
        HideIconStore: { set: vi.fn() },
        moduleBackgroundEmbedding: { set: vi.fn() },
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('src/ts/stores.svelte')
    return {
        getCurrentCharacter: vi.fn(() => DBState.db.characters[0]),
        getCurrentChat: vi.fn(() => null),
        getDatabase: vi.fn(() => DBState.db),
        setCurrentCharacter: vi.fn(),
        setDatabase: vi.fn(),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import { getModules } from 'src/ts/process/modules'
import ModuleSettings from './ModuleSettings.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

function makeModule(name: string, id: string): RisuModule {
    return { name, description: '', id } as RisuModule
}

let mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

beforeEach(() => {
    DBState.db = {
        modules: [makeModule('Mod A', 'A'), makeModule('Mod M', 'M')],
        enabledModules: [],
        moduleIntergration: '',
        characters: [{ chaId: 'cha', modules: ['M'] }],
    } as unknown as Database
})

afterEach(async () => {
    for (const entry of mounted) {
        await unmount(entry.app as never)
        entry.target.remove()
    }
    mounted = []
})

describe('T9-REFRESH: a delete on the classic page refreshes the module memo', () => {
    test('a referenced module that was deleted is gone from getModules while the page is still mounted', async () => {
        // Primes the memo with the row the bound character lists.
        expect(getModules().map((module) => module.id)).toEqual(['M'])

        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(ModuleSettings, { target, props: {} }) as unknown as Record<string, unknown>
        mounted.push({ target, app })
        flushSync()
        await Promise.resolve()
        flushSync()

        const span = Array.from(target.querySelectorAll('span.text-lg')).find((s) => s.textContent?.trim() === 'Mod M')!
        const buttons = Array.from(span.parentElement!.querySelectorAll('button')) as HTMLButtonElement[]
        buttons[buttons.length - 1].click()
        await settle()

        expect(DBState.db.modules.map((module) => module.id)).toEqual(['A'])
        expect(getModules().map((module) => module.id)).toEqual([])
    })
})
