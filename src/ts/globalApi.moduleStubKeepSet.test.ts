/**
 * The legacy asset keep-set over module stubs: `getUncleanablesSync` yields only the icon a stub holds and reads no
 * other key of it, and `buildAssetKeepSet` reports the set incomplete while a stub is present so the legacy sweeps
 * delete nothing. The other legacy deleters stay behind the page-mode gate on a store2 page, the only page that holds
 * stubs. Titles beginning "guard:" pin behaviour that must be preserved; every other test is a regression reproducer.
 */
import { describe, test, expect, vi, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE } from 'src/ts/storage/moduleStub'

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

import { buildAssetKeepSet, getUncleanablesSync } from 'src/ts/globalApi.svelte'
import {
    pageRunsLegacyDeleters, recordsLoadTimeListing, resetPageStorageModeForTests, setPageStorageMode,
    startsLegacyStartupCleanup,
} from 'src/ts/storage/pageStorageMode'

afterEach(() => {
    resetPageStorageModeForTests()
})

type Slot = Record<string, unknown>

function fullModule(id: string, assets: [string, string][] = [], icon = ''): Slot {
    return { id, name: `${id} name`, assets, icon }
}

/** The index fields plus the marker, and none of the body arrays. */
function stubModule(id: string, icon?: string): Slot {
    const stub: Slot = { id, name: `${id} name`, unit: [`unit-${id}`], al: ['assets/body-asset'], il: [], [MODULE_STUB_KEY]: MODULE_STUB_VALUE }
    if (icon !== undefined) {
        stub.icon = icon
    }
    return stub
}

/** Throws on a read of any key the target does not own, as a missing key read through a `$state` proxy would misbehave. */
function strictStub(stub: Slot): Slot {
    return new Proxy(stub, {
        get(target, key, receiver) {
            if (typeof key === 'string' && !Object.hasOwn(target, key)) {
                throw new Error(`read of a key the stub does not own: ${key}`)
            }
            return Reflect.get(target, key, receiver)
        },
    })
}

function dbOf(modules: Slot[]): Database {
    return { characters: [], modules, personas: [], characterOrder: [], customBackground: '', userIcon: '' } as unknown as Database
}

describe('getUncleanablesSync over a module stub', () => {
    test('get-uncleanables-reads-only-stub-icon: a stub yields its own icon and no other key is read', () => {
        const db = dbOf([strictStub(stubModule('A', 'assets/a-icon')), fullModule('B', [['x', 'assets/b-asset']])])
        expect(getUncleanablesSync(db).sort()).toEqual(['a-icon', 'b-asset'])
    })

    test('get-uncleanables-reads-only-stub-icon: a stub without an icon yields nothing and reads no missing key', () => {
        expect(getUncleanablesSync(dbOf([strictStub(stubModule('A'))]))).toEqual([])
    })

    test('guard: a full module still yields its assets and icon', () => {
        const db = dbOf([fullModule('B', [['x', 'assets/b-asset']], 'assets/b-icon')])
        expect(getUncleanablesSync(db).sort()).toEqual(['b-asset', 'b-icon'])
    })
})

describe('buildAssetKeepSet over module stubs', () => {
    test('keep-set-incomplete-with-module-stub: a stub makes the set incomplete and keeps its icon', async () => {
        const result = await buildAssetKeepSet(dbOf([fullModule('B'), stubModule('A', 'assets/a-icon')]))
        expect(result.complete).toBe(false)
        expect(Array.from(result.uncleanable)).toEqual(['a-icon'])
    })

    test('guard: keep-set-complete-without-stub: full modules leave the set complete', async () => {
        const result = await buildAssetKeepSet(dbOf([fullModule('B', [['x', 'assets/b-asset']])]))
        expect(result.complete).toBe(true)
        expect(Array.from(result.uncleanable)).toEqual(['b-asset'])
    })
})

describe('legacy deleters on the page that holds stubs', () => {
    test('guard: legacy-deleters-gated-on-store2-with-stub: a store2 page runs none of the legacy deleters', () => {
        setPageStorageMode({ kind: 'legacy' } as Parameters<typeof setPageStorageMode>[0])
        expect(pageRunsLegacyDeleters()).toBe(true)
        setPageStorageMode({ kind: 'store2' } as Parameters<typeof setPageStorageMode>[0])
        expect(pageRunsLegacyDeleters()).toBe(false)
        expect(startsLegacyStartupCleanup()).toBe(false)
        expect(recordsLoadTimeListing()).toBe(false)
    })
})
