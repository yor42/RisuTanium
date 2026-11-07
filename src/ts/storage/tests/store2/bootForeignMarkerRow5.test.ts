import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} },
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        loadedStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/process/index.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
})
vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    markIdentitySeen: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/characters'), () => ({
    characterFormatUpdate: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: async () => ({ bytes: null, version: null }),
        has: async () => false,
    })),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

import type { Database } from 'src/ts/storage/database.svelte'
import { resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { Store2BackendFailureError } from 'src/ts/storage/store2/backend/errors'
import type { Store2Backend } from 'src/ts/storage/store2/backend/types'
import { resetStore2BootForTest } from 'src/ts/storage/store2/bootActive'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { createCommitter, IMPORT_REPLACES_BASE } from 'src/ts/storage/store2/commit'
import { openDeleterGate } from 'src/ts/storage/store2/boot'
import type { MarkerLiveness, MarkerOwnerProbe } from 'src/ts/storage/store2/abandonedMarker'
import { resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { getActiveStore2Save, resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import { resetRetainedForTest } from 'src/ts/process/coldRetained'
import { bootThroughDispatch, countedBackend, createClock, seedTree, testEnv, type CountedBackend } from '../store2SaveKit'
import { buildSmall, fakeLists } from './codecFixtures'

/**
 * Boot row 5 over a bulk marker of another page: a probe that proves the owner gone clears it and the boot reads the key
 * again; every other answer opens the store as before, and the boot never asks. A pass says nothing about a real store.
 */

function resetPage(): void {
    resetStore2SaveForTest()
    resetResidencyForTest()
    resetStore2BootForTest()
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
    resetRetainedForTest()
}

beforeEach(() => {
    vi.clearAllMocks()
    resetPage()
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    resetPage()
    vi.restoreAllMocks()
})

/** A seeded profile with a marker of 'peer-page' left by a bulk whose build never returns, as a dead page leaves it. */
async function profileWithForeignMarker(): Promise<CountedBackend> {
    const counted = countedBackend()
    await seedTree(counted.memory, JSON.parse(JSON.stringify(buildSmall(3))) as Database, testEnv(createClock(), 4242), fakeLists)
    const peer = createCommitter(counted.memory, { owner: 'peer-page' })
    void peer.commit(await peer.readCommit(), {
        newUnits: 100,
        carry: IMPORT_REPLACES_BASE,
        label: 'bulk',
        build: () => new Promise(() => { }),
    })
    for (let attempt = 0; attempt < 200 && (await standingOwner(counted)) === null; attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 5))
    }
    expect(await standingOwner(counted)).toBe('peer-page')
    counted.reset()
    return counted
}

async function standingOwner(counted: CountedBackend): Promise<string | null> {
    const classified = classifyCommitRead(await counted.memory.readCommit())
    return classified.status === 'parsed' ? (classified.value.staging?.owner ?? null) : null
}

function probeAnswering(answer: MarkerLiveness): { probe: MarkerOwnerProbe, calls: number[] } {
    const calls: number[] = []
    const probe: MarkerOwnerProbe = async () => {
        calls.push(calls.length)
        return answer
    }
    return { probe, calls }
}

describe('boot row 5 over a foreign bulk marker', () => {
    test('a probe that proves the owner gone clears the marker, opens the store and leaves the sweep gate open (regression)', async () => {
        const counted = await profileWithForeignMarker()
        const { probe, calls } = probeAnswering('gone')
        const factory = vi.fn((_kind: string) => probe)

        const boot = await bootThroughDispatch(counted.backend, { kind: 'indexeddb', markerOwnerProbe: factory })

        expect(boot.result.kind).toBe('store2')
        expect(await standingOwner(counted)).toBeNull()
        expect((await openDeleterGate(counted.memory, 'sweep')).status).toBe('open')
        expect(calls.length).toBe(1)
        expect(factory).toHaveBeenCalledWith('indexeddb')
        expect(getActiveStore2Save()?.markerOwnerProbe).toBe(probe)
        expect(boot.foreignMarkerAsked).toBe(0)
    })

    test.each(['alive', 'unknown'] as const)('a probe answering %s opens the store with the marker standing and asks nothing (guard)', async (answer) => {
        const counted = await profileWithForeignMarker()
        const { probe } = probeAnswering(answer)

        const boot = await bootThroughDispatch(counted.backend, { kind: 'indexeddb', markerOwnerProbe: () => probe })

        expect(boot.result.kind).toBe('store2')
        expect(await standingOwner(counted)).toBe('peer-page')
        expect(boot.foreignMarkerAsked).toBe(0)
    })

    test('a clear that fails opens the store as before with the marker standing (guard)', async () => {
        const counted = await profileWithForeignMarker()
        let casCalls = 0
        const failing: Store2Backend = {
            ...counted.backend,
            casCommit: (expected, next) => {
                casCalls += 1
                if (casCalls === 1) {
                    throw new Store2BackendFailureError('down')
                }
                return counted.backend.casCommit(expected, next)
            },
        }
        const { probe } = probeAnswering('gone')

        const boot = await bootThroughDispatch(failing, { kind: 'indexeddb', markerOwnerProbe: () => probe })

        expect(boot.result.kind).toBe('store2')
        expect(await standingOwner(counted)).toBe('peer-page')
        expect(boot.foreignMarkerAsked).toBe(0)
    })

    test('the last boot round never clears: the store opens with the marker standing and the probe is not asked (guard)', async () => {
        const counted = await profileWithForeignMarker()
        const { probe, calls } = probeAnswering('gone')

        const boot = await bootThroughDispatch(counted.backend, { kind: 'indexeddb', markerOwnerProbe: () => probe, maxRounds: 1 })

        expect(boot.result.kind).toBe('store2')
        expect(await standingOwner(counted)).toBe('peer-page')
        expect(calls.length).toBe(0)
    })
})
