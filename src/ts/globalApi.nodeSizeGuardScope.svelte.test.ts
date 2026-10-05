/**
 * Which 413s from the Node server park the save loop. A 413 to a write that is
 * part of the commit (a block, the root) comes before the commit lands, so the
 * changes are still unsaved and the loop parks. A 413 to the numbered backup
 * comes after the commit landed: it parks nothing, and the next change is
 * saved. The real `globalApi.svelte.ts`, `RisuSaveEncoder` and block-store
 * owner run over an in-memory store that answers 413 to chosen writes. One save
 * loop runs for the whole file (it never returns); the test that parks it is
 * the last one. A passing test here says nothing about the real server.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { get } from 'svelte/store'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { backupWrites, isBackupKey, isRootKey, makeDb, rootWrites } from 'src/ts/storage/tests/saveLoopSupport'
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

beforeAll(async () => {
    h.db = makeDb('first', [CHA_ID])
    w = await kit.startWorld({ kind: 'node', isolate: false })
})

afterAll(() => {
    h.parkedAll = true
})

describe('saveDb on a Node server that answers 413 outside the commit', () => {
    test('a 413 on the numbered backup, after the commit landed, does not park and the next change is saved', async () => {
        w.store.faults.push({
            match: (op) => op.kind === 'write' && isBackupKey(op.key),
            mode: 'before',
            times: 1,
            error: new NodeHttpError(413, 'write'),
        })
        requestSave('with a refused backup')
        await until(() => rootWrites(w.store).length === 1, 'the commit')
        await until(() => backupWrites(w.store).length === 1, 'the refused backup')
        await sleepReal(150)
        expect(get(savingStoppedReason)).toBeNull()
        expect(vi.mocked(alertToast)).not.toHaveBeenCalled()

        requestSave('after the refused backup')
        await until(() => rootWrites(w.store).length === 2, 'the next commit')
        await until(() => w.api.isSaveClean(), 'the loop to go clean')
        expect(get(savingStoppedReason)).toBeNull()
    })

    test('a 413 on the root write, before the commit lands, parks the loop and leaves the changes unsaved', async () => {
        w.store.faults.push({
            match: (op) => op.kind === 'write' && isRootKey(op.key),
            mode: 'before',
            times: 1000,
            error: new NodeHttpError(413, 'write'),
        })
        const commits = rootWrites(w.store).length
        const committed = vi.fn()
        w.api.afterNextSaveCommit(committed)

        requestSave('refused root')
        await until(() => get(savingStoppedReason) === 'too-large', 'the loop to park')
        await sleepReal(300)
        const ops = w.store.ops.length
        await sleepReal(300)

        expect(w.store.ops.length).toBe(ops)
        expect(rootWrites(w.store)).toHaveLength(commits + 1)
        expect(committed).not.toHaveBeenCalled()
        expect(w.api.isSaveClean()).toBe(false)
        expect(alertError).not.toHaveBeenCalled()
        expect(vi.mocked(alertToast).mock.calls).toHaveLength(1)
        expect(String(vi.mocked(alertToast).mock.calls[0][0])).toContain('stopped saving')
    }, 20000)
})
