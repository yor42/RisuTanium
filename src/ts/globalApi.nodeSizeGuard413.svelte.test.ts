/**
 * A 413 from the Node server to a block write is handled like a block over the
 * client's own limit: the loop parks with the `too-large` reason, the changes
 * stay unsaved, no numbered backup is written and one message is shown. The
 * message names no block, because the server's refusal does not say which one
 * was too large. This covers a server configured with a smaller body limit than
 * the client knows. The real `globalApi.svelte.ts`, `RisuSaveEncoder` and
 * block-store owner run over an in-memory store that answers 413 to a character
 * block write. A passing test here says nothing about the real server.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { get } from 'svelte/store'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { backupWrites, incompressible, isBlockKey, makeDb, rootWrites, writesTo } from 'src/ts/storage/tests/saveLoopSupport'
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
import { NodeHttpError } from 'src/ts/storage/store/nodeHttpStore'

const CHA_ID = 'sized-cha'
const SERVER_LIMIT = 2048
const kit = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

let w: World

beforeAll(async () => {
    h.db = makeDb('first', [CHA_ID])
    w = await kit.startWorld({ kind: 'node', isolate: false })
})

afterAll(() => {
    h.parkedAll = true
})

describe('saveDb on a Node server that answers 413 to a block', () => {
    test('the refused write parks the loop with one message, writes no backup and leaves the changes unsaved', async () => {
        w.store.faults.push({
            match: (op) => op.kind === 'write' && isBlockKey(op.key) && op.key.includes('/c/'),
            mode: 'before',
            times: 1000,
            error: new NodeHttpError(413, 'write'),
        })
        const commitsBefore = rootWrites(w.store).length
        const backupsBefore = backupWrites(w.store).length
        const committed = vi.fn()
        w.api.afterNextSaveCommit(committed)

        const chat = ((h.db!.characters as Array<Record<string, unknown>>)[0].chats as Array<Record<string, unknown>>)[0]
        chat.note = incompressible(SERVER_LIMIT * 2)
        w.marks.markCharacterForSave(CHA_ID)
        await until(() => get(savingStoppedReason) === 'too-large', 'the loop to park')

        // A retry loop would send again within a few of the (shortened) sleeps.
        await sleepReal(300)
        const opsAfterPark = w.store.ops.length
        await sleepReal(300)
        chat.note = incompressible(SERVER_LIMIT * 3)
        w.marks.markCharacterForSave(CHA_ID)
        await sleepReal(300)

        expect(w.store.ops.length).toBe(opsAfterPark)
        expect(rootWrites(w.store)).toHaveLength(commitsBefore)
        expect(backupWrites(w.store)).toHaveLength(backupsBefore)
        expect(writesTo(w.store, (key) => key.includes('/c/')).length).toBeGreaterThan(0)
        expect(committed).not.toHaveBeenCalled()
        expect(w.api.isSaveClean()).toBe(false)
        expect(alertError).not.toHaveBeenCalled()
        expect(vi.mocked(alertToast).mock.calls).toHaveLength(1)
        const message = String(vi.mocked(alertToast).mock.calls[0][0])
        expect(message).toContain('stopped saving')
        expect(message).not.toMatch(/archiv/i)
        expect(w.api.getSavingStoppedDetail()).toBe('')
    }, 20000)
})
