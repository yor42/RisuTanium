/**
 * `saveDb()` on the self-hosted Node server: a commit's writes are conditional
 * on the revision this page last read or wrote for each key, numbered backups
 * are written without a condition, and another device's save stops saving with
 * the conflict message instead of overwriting it. The real `globalApi.svelte.ts`,
 * `RisuSaveEncoder` and block-store owner run over an in-memory store that keeps
 * revisions and answers a stale write with a conflict, as the Node server does.
 * One save loop runs for the whole file (it never returns); the test that parks
 * it is the last one. A passing test here says nothing about the real server.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { get } from 'svelte/store'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { StoreVersionConflictError } from 'src/ts/storage/store/errors'
import {
    BACKUP_PREFIX,
    backupWrites,
    conditionOf,
    isBackupKey,
    makeDb,
    mainFileMutations,
    rootWrites,
} from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: true,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn((ms: number) => h.parkedAll
        ? new Promise<void>(() => {})
        : new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 5)))),
    sleepForever: vi.fn(() => new Promise<void>(() => {})),
}) as unknown as typeof import('src/ts/util'))

import { alertError, alertToast } from 'src/ts/alert'
import { savingStoppedReason } from 'src/ts/stores.svelte'

const CHA_ID = 'saved-cha'
const kit = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

let w: World

function requestSave(prompt: string): void {
    h.db!.mainPrompt = prompt
    w.marks.markCharacterForSave(CHA_ID)
}

const rootKeyOfLiveGeneration = () => `blocks/${w.owner.committedState()!.generation}/root`

beforeAll(async () => {
    h.db = makeDb('first', [CHA_ID])
    w = await kit.startWorld({ kind: 'node', isolate: false, startLoop: false })
    w.start()
    await sleepReal(100)
})

afterAll(() => {
    h.parkedAll = true
})

describe('saveDb on the Node server', () => {
    test('the first commit presents the revision it read, writes its numbered backup without a condition, and shows nothing', async () => {
        const root = rootKeyOfLiveGeneration()
        const readVersion = w.store.revisionOf(root)

        requestSave('second')
        await until(() => rootWrites(w.store).length === 1, 'the commit')
        await until(() => backupWrites(w.store).length === 1, 'the backup')
        // The prune that follows the backup write is still in flight when the backup request is seen.
        await sleepReal(80)

        expect(conditionOf(rootWrites(w.store)[0])).toEqual({ ifVersion: readVersion })
        expect(conditionOf(backupWrites(w.store)[0])).toBe('unconditional')
        expect(alertToast).not.toHaveBeenCalled()
        expect(alertError).not.toHaveBeenCalled()
        expect(get(savingStoppedReason)).toBeNull()
        expect(mainFileMutations(w.store)).toHaveLength(0)
    })

    test('the next commit presents the revision the previous commit left, with no backup due and so no listing of the backups', async () => {
        w.store.ops.length = 0
        const expected = w.store.revisionOf(rootKeyOfLiveGeneration())

        requestSave('third')
        await until(() => rootWrites(w.store).length === 1, 'the commit')
        await sleepReal(80)

        expect(conditionOf(rootWrites(w.store)[0])).toEqual({ ifVersion: expected })
        expect(backupWrites(w.store)).toHaveLength(0)
        expect(w.store.ops.filter((op) => op.kind === 'list')).toHaveLength(0)
        expect(w.store.ops.filter((op) => op.kind === 'delete')).toHaveLength(0)
        expect(alertToast).not.toHaveBeenCalled()
    })

    test('a save whose backup prune races another tab\'s prune of the same oldest backup shows no conflict and keeps saving', async () => {
        w.store.ops.length = 0
        const oldest = `${BACKUP_PREFIX}100.bin`
        for (let n = 100; n < 121; n++) {
            w.store.plant(`${BACKUP_PREFIX}${n}.bin`, Uint8Array.from([n]))
        }
        let peerRemoved = false
        w.store.faults.push({
            match: (op) => {
                if (op.kind === 'list' && op.key === BACKUP_PREFIX && !peerRemoved) {
                    peerRemoved = true
                    w.store.unplant(oldest)
                }
                return false
            },
            mode: 'after',
            times: Number.MAX_SAFE_INTEGER,
        })
        // The minimum interval between backups has passed, so this save writes one and prunes.
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(Date.now() + 6 * 60 * 1000)
        try {
            requestSave('with a backup')
            await until(() => rootWrites(w.store).length === 1, 'the commit')
            await until(() => peerRemoved, 'the prune')
        } finally {
            vi.useRealTimers()
        }
        await sleepReal(80)

        expect(w.store.peek(oldest)).toBeNull()
        expect(alertToast).not.toHaveBeenCalled()
        expect(alertError).not.toHaveBeenCalled()
        expect(get(savingStoppedReason)).toBeNull()
        const commits = rootWrites(w.store).length
        requestSave('after the race')
        await until(() => rootWrites(w.store).length === commits + 1, 'the next commit')
    })

    test('an injected conflict on the numbered backup after the commit landed shows the saved-anyway notice, does not stop saving, and the next save goes through', async () => {
        w.store.ops.length = 0
        w.store.faults.length = 0
        w.store.faults.push({
            match: (op) => op.kind === 'write' && isBackupKey(op.key),
            mode: 'before',
            times: 1,
            error: new StoreVersionConflictError(`${BACKUP_PREFIX}1.bin`, 7),
        })
        vi.mocked(alertToast).mockClear()
        // A backup is due: the clock is a month past whenever the last backup
        // was written, whichever test that was.
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(Date.now() + 30 * 24 * 60 * 60 * 1000)
        try {
            requestSave('conflicting backup')
            await until(() => rootWrites(w.store).length === 1, 'the commit')
            await vi.waitFor(() => { expect(vi.mocked(alertToast)).toHaveBeenCalledTimes(1) }, { timeout: 8000, interval: 10 })
        } finally {
            vi.useRealTimers()
        }

        expect(String(vi.mocked(alertToast).mock.calls[0][0])).toContain('Your latest changes were saved')
        expect(get(savingStoppedReason)).toBeNull()
        requestSave('after the refused backup')
        await until(() => rootWrites(w.store).length === 2, 'the next commit')
        expect(get(savingStoppedReason)).toBeNull()
        vi.mocked(alertToast).mockClear()
    })

    test('a save after another device saved is refused, saving stops with the node-conflict message, and the other device\'s data is untouched', async () => {
        w.store.ops.length = 0
        const root = rootKeyOfLiveGeneration()
        const peerRoot = Uint8Array.from([9, 9, 9, 9])
        w.store.plant(root, peerRoot)

        requestSave('fourth')
        await until(() => get(savingStoppedReason) === 'node-conflict', 'the page to stop')
        await sleepReal(150)

        expect(rootWrites(w.store)).toHaveLength(1)
        expect(Array.from(w.store.peek(root) ?? [])).toEqual(Array.from(peerRoot))
        expect(backupWrites(w.store)).toHaveLength(0)
        expect(vi.mocked(alertToast).mock.calls.map((call) => String(call[0]))).toEqual([
            expect.stringContaining('conflicts with a newer version'),
        ])
    })
})
