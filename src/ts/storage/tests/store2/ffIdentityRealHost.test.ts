// @vitest-environment happy-dom
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
    alertNormal: vi.fn(),
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
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import type { Database } from 'src/ts/storage/database.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { resetPutBackForTest } from 'src/ts/process/memory/characterPutBack'
import { hasLoaded, loadedRecordOf } from 'src/ts/process/coldRetained'
import { restoreColdCharacter } from 'src/ts/process/coldCharacterRestore'
import { isColdStub } from 'src/ts/storage/store2/codec'
import { setFastForwardHostForTest } from 'src/ts/storage/store2/fastForward'
import { markIdentitySeen } from 'src/ts/storage/dbChangeEffects.svelte'
import { withQuietCharacterInstall } from 'src/ts/storage/dbWriteHook'
import { getResidency } from 'src/ts/storage/store2/residencyActive'
import { bootB, FF_HOSTS, ffSetup, ffTeardown, ffWorld, runLoopWorld, signal, useFfHost } from './ffFixtures'
import { chaIdOf, chars, clone, until } from './lineFixtures'

/**
 * The real fast-forward host (the page modules, not the suites' stand-in) on both hosts, with `markIdentitySeen` and the
 * residency mocked to record what the host hands them: a take reports the live read-back of the slot it installed, and the
 * retained-loaded bookkeeping drops the record of the character a take replaced.
 */

beforeEach(() => {
    ffSetup()
    setFastForwardHostForTest(null)
    resetPutBackForTest()
    vi.mocked(markIdentitySeen).mockClear()
})

afterEach(() => {
    resetPutBackForTest()
    selectedCharID.set(-1)
    DBState.db = {} as unknown as Database
    ffTeardown()
})

async function world() {
    const base = await ffWorld()
    const b = await bootB(base.memory)
    DBState.db = b.db
    const loop = runLoopWorld(b.context, b.db)
    return { base, b, loop }
}

type World = Awaited<ReturnType<typeof world>>

async function peer(w: World, edit: (db: Database) => void): Promise<{ kind: string, reason?: string }> {
    const fastForward = w.b.context.fastForward
    if (fastForward === undefined) {
        throw new Error('The page has no fast-forward.')
    }
    const spy = vi.spyOn(fastForward, 'run')
    const before = spy.mock.results.length
    await w.base.page.commitEdit(edit)
    signal(w.loop)
    await until(() => spy.mock.results.length > before, 'the fast-forward run', 8000)
    return await spy.mock.results[before].value as { kind: string, reason?: string }
}

/** Whether some `markIdentitySeen` call received exactly `slot`: deep equality cannot tell a raw stub from the live read-back. */
const reportedSlot = (slot: unknown): boolean => vi.mocked(markIdentitySeen).mock.calls.some(([reported]) => reported === slot)

describe.each(FF_HOSTS)('the real host reports and forgets what a take installs (%s host)', (mode) => {
    useFfHost(mode)

    test('T31 RH-r a replacement take reports the live read-back of the slot it installed', async () => {
        const w = await world()
        expect(await peer(w, (db) => { chars(db)[3].personality = 'peer body edit' })).toEqual({ kind: 'applied' })
        expect(reportedSlot(chars(w.b.db)[3])).toBe(true)
    })

    test('T32 RH-i an insertion take reports the live read-back of the slot it installed', async () => {
        const w = await world()
        const outcome = await peer(w, (db) => {
            const added = clone(chars(db)[0])
            added.chaId = 'rh-added'
            added.name = 'Added rh'
            ;(db.characters as unknown as unknown[]).splice(2, 0, added)
            db.characterOrder = [...db.characterOrder.slice(0, 2), 'rh-added', ...db.characterOrder.slice(2)]
        })
        expect(outcome).toEqual({ kind: 'applied' })
        const at = chars(w.b.db).findIndex(slot => slot.chaId === 'rh-added')
        expect(at).toBeGreaterThanOrEqual(0)
        expect(reportedSlot(chars(w.b.db)[at])).toBe(true)
    })

    test('T20 RH-A1 the real forgetLoaded drops the retained record of a taken residency-loaded character', async () => {
        const w = await world()
        const residency = getResidency()
        if (!residency) {
            throw new Error('The page has no residency.')
        }
        const stub = residency.stubFor(chars(w.b.db)[1] as never)
        expect(stub).not.toBeNull()
        withQuietCharacterInstall(() => { w.b.db.characters[1] = stub as never })
        const restored = await restoreColdCharacter(w.b.db.characters[1] as never)
        expect(restored.status).toBe('restored')
        const loadedSlot = w.b.db.characters[1]
        expect(loadedRecordOf(loadedSlot as never)).toBeTruthy()
        expect(hasLoaded()).toBe(true)
        const before = chaIdOf(w.b.db, 1)
        expect(await peer(w, (db) => { chars(db)[1].personality = 'peer body edit' })).toEqual({ kind: 'applied' })
        expect(isColdStub(chars(w.b.db)[1])).toBe(true)
        expect(chaIdOf(w.b.db, 1)).toBe(before)
        expect(loadedRecordOf(loadedSlot as never)).toBeFalsy()
        expect(hasLoaded()).toBe(false)
    })
})
