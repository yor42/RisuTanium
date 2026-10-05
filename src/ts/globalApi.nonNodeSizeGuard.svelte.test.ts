/**
 * Guard: the Node server's body limit does not apply on other platforms. With
 * the limit module lowered to 4 KiB, a web-platform `saveDb()` still commits a
 * block far over it, writes a numbered backup over it and neither shows a
 * message nor stops saving. The real `saveDb()` loop, `RisuSaveEncoder` and
 * block-store owner run over an in-memory store. A passing test here says
 * nothing about a real platform.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get } from 'svelte/store'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { backupWrites, incompressible, makeDb, rootWrites } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit } from 'src/ts/storage/tests/saveLoopWorld'

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/nodeBodyLimit'), () => ({
    NODE_BODY_LIMIT_BYTES: 4096,
}))

import { alertError, alertToast } from 'src/ts/alert'

const CHA_ID = 'sized-cha'
const LIMIT = 4096
const kit = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

beforeEach(() => {
    vi.clearAllMocks()
    h.db = makeDb('first', [CHA_ID])
})

afterEach(() => {
    kit.parkAll()
})

describe('saveDb on a platform other than the Node server', () => {
    test('a block over the Node body limit is committed and the numbered backup is written, with no message and no stopped-saving reason', async () => {
        const w = await kit.startWorld()
        const chat = ((h.db!.characters as Array<Record<string, unknown>>)[0].chats as Array<Record<string, unknown>>)[0]
        await nextCommit(w, () => {
            chat.note = incompressible(LIMIT * 2)
            w.marks.markCharacterForSave(CHA_ID)
        })
        expect(rootWrites(w.store)).toHaveLength(1)
        expect(backupWrites(w.store)).toHaveLength(1)
        expect(w.store.peek(backupWrites(w.store)[0].key)!.length).toBeGreaterThan(LIMIT)
        const stores = await import('src/ts/stores.svelte')
        expect(get(stores.savingStoppedReason)).toBeNull()
        expect(alertToast).not.toHaveBeenCalled()
        expect(alertError).not.toHaveBeenCalled()
    })
})
