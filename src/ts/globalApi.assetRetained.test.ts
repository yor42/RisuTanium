/**
 * The legacy asset keep-set and the retained-paths field: `getUncleanablesSync` adds the paths an owner's history
 * retains for every character slot (groups included), every non-stub module and every persona embedded module, by the
 * basename the sweeps compare. A value of any shape is read through `retainedNamesOf`, and an upstream field of the bare
 * name `assetRetained` is never read as ours. Every test is a feature guard: the field did not exist before.
 *
 * What runs for real: `getUncleanablesSync`, `buildColdStub` and `coldUnitCharacter` (the cold unit a stub points at)
 * and the store2 closure keep-set. What is replaced: the page's database and every service `globalApi.svelte` imports.
 */
import { afterEach, describe, test, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn() }) },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => { throw new Error('no live database in tests') }),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    selIdState: { state: -1 },
    alertStore: writable({ type: 'none', msg: '' }),
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    loadedStore: writable(false),
    LoadingStatusState: { text: '' },
    ReloadGUIPointer: writable(0),
    bodyIntercepterStore: writable(null),
    savingStoppedReason: writable(null),
    CharEmotion: writable({}),
    MobileGUIStack: writable([]),
    OpenRealmStore: writable(false),
    frozenSaveKeysStore: writable([]),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

import { getBasename, getUncleanablesSync } from 'src/ts/globalApi.svelte'
import { buildClosureAssetKeepSet } from 'src/ts/storage/store2/sweep'
import { commitKeyOf, Tree } from 'src/ts/storage/tests/store2/sweepFixtures'
import { coldUnitCharacter } from 'src/ts/process/coldCharacter'
import { buildColdStub } from 'src/ts/process/tests/coldStubFixture'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { watchBodyKeys, stubModule } from 'src/ts/studio/studioFixtures.test-helpers'
import { deriveCharacterAssets, deriveModuleAssets } from 'src/ts/storage/store2/lists'
import { ASSET_RETAINED_KEY } from 'src/ts/studio/assets/assetOwnerKeys'

afterEach(() => {
    resetPageStorageModeForTests()
})

type Slot = Record<string, unknown>

const retained = (...paths: string[]) => paths.map((path, index) => [`name-${index}`, path])

function character(chaId: string, extra: Slot = {}): Slot {
    return { chaId, type: 'character', name: chaId, chats: [], emotionImages: [], additionalAssets: [], ...extra }
}

/** The group slot the app creates: it has no `ccAssets` and holds member ids. */
function group(chaId: string, extra: Slot = {}): Slot {
    return { chaId, type: 'group', name: chaId, chats: [], characters: [], emotionImages: [], ...extra }
}

function dbOf(over: { characters?: Slot[], modules?: Slot[], personas?: Slot[] }): Database {
    return {
        characters: over.characters ?? [], modules: over.modules ?? [], personas: over.personas ?? [],
        characterOrder: [], customBackground: '', userIcon: '',
    } as unknown as Database
}

describe('getUncleanablesSync reads the retained paths', () => {
    test('a character whose only reference to a file is the retained field keeps that file, whatever the value shape', () => {
        const db = dbOf({ characters: [
            character('a', { [ASSET_RETAINED_KEY]: retained('assets/K.png') }),
            character('b', { [ASSET_RETAINED_KEY]: { a: ['assets/K2.png'] } }),
        ] })
        expect(getUncleanablesSync(db).sort()).toEqual(['K.png', 'K2.png'])
    })

    test('a path is kept by its basename, so a nested or backslash path is compared as the sweeps compare it', () => {
        const db = dbOf({ characters: [character('a', { [ASSET_RETAINED_KEY]: retained('assets/sub\\Deep.PNG') })] })
        expect(getUncleanablesSync(db)).toEqual(['Deep.PNG'])
        expect(getBasename('assets/sub\\Deep.PNG')).toBe('Deep.PNG')
    })

    test('a non-stub module and a persona embedded module keep their retained paths', () => {
        const db = dbOf({
            modules: [{ id: 'm1', name: 'M', [ASSET_RETAINED_KEY]: retained('assets/M.png') }],
            personas: [{ icon: '', embeddedModule: { id: 'e1', name: 'E', [ASSET_RETAINED_KEY]: { x: ['assets/E.png'] } } }],
        })
        expect(getUncleanablesSync(db).sort()).toEqual(['E.png', 'M.png'])
    })

    test('a module stub holds no retained field and its retained field is never asked for', () => {
        const reads: string[] = []
        const stub = watchBodyKeys(stubModule('s1'), reads)
        const db = dbOf({ modules: [stub as unknown as Slot, { id: 'm1', name: 'M', [ASSET_RETAINED_KEY]: retained('assets/M.png') }] })
        expect(getUncleanablesSync(db)).toEqual(['M.png'])
        expect(reads).toEqual([])
    })

    test('a group slot and an archived character resolved through its cold unit keep their retained paths', () => {
        const archived = character('cold-1', { [ASSET_RETAINED_KEY]: retained('assets/A.png'), chats: [{ id: 'c', message: [] }] })
        const stub = buildColdStub(archived as never, 'unit-1', [])
        expect(Object.hasOwn(stub, ASSET_RETAINED_KEY)).toBe(false)
        const db = dbOf({ characters: [group('g1', { [ASSET_RETAINED_KEY]: retained('assets/G.png') }), stub as unknown as Slot] })
        const resolved = [db.characters[0], coldUnitCharacter(archived as never)] as unknown as NonNullable<Parameters<typeof getUncleanablesSync>[1]>['chars']

        expect(getUncleanablesSync(db, { chars: resolved }).sort()).toEqual(['A.png', 'G.png'])
    })

    test('an upstream field of the bare name is never read as ours, by the keep-set or by the list derivation', () => {
        const upstream = { assetRetained: retained('assets/U.png') }
        const db = dbOf({
            characters: [character('a', upstream)],
            modules: [{ id: 'm1', name: 'M', ...upstream }],
        })
        expect(getUncleanablesSync(db)).toEqual([])
        expect(deriveCharacterAssets(upstream).l).toEqual([])
        expect(deriveModuleAssets(upstream).l).toEqual([])
    })
})

describe('the store2 keep-set keeps a path that only memory holds', () => {
    test('the store2 keep-set keeps a retained file whose stored lists no longer name it, through the resident references', async () => {
        const tree = new Tree()
        const current = tree.addManifest({ characters: [{ u: 'c1', assets: ['assets/other.png'] }] }, 1)
        const db = dbOf({ characters: [character('a', { [ASSET_RETAINED_KEY]: retained('assets/K.png') })] })

        const result = await buildClosureAssetKeepSet({
            commitKey: commitKeyOf({ current }), reader: tree.reader, residentRefs: getUncleanablesSync(db),
        })

        expect(result.status).toBe('complete')
        expect(result.status === 'complete' && result.keep.holds('assets/K.png')).toBe(true)
        expect(result.status === 'complete' && result.keep.holds('assets/other.png')).toBe(true)
        expect(result.status === 'complete' && result.keep.holds('assets/orphan.png')).toBe(false)
    })
})
