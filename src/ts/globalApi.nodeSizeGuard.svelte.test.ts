/**
 * `saveDb()` on the self-hosted Node server never sends a block over the body
 * limit the client knows: it writes nothing, keeps the changes unsaved, writes
 * no numbered backup, parks the save loop with the `too-large` reason and shows
 * one message that names the block and does not advise archiving. A numbered
 * backup is a whole save file: when it would be over the limit although every
 * block fits, it is skipped with one notice and saving goes on. The real
 * `globalApi.svelte.ts`, `RisuSaveEncoder` and block-store owner run over an
 * in-memory store that keeps revisions as the Node server does. The limit is
 * lowered to a few KiB through the limit module so a small database is "over"
 * it. A passing test here says nothing about the real server.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get } from 'svelte/store'
import { language } from 'src/lang'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import {
    MAIN_FILE_KEY,
    backupWrites,
    incompressible,
    isBlockKey,
    makeDb,
    mutationsOf,
    rootWrites,
    writesTo,
} from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, sleepReal, until } from 'src/ts/storage/tests/saveLoopWorld'

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: true,
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

async function storedStopReason() {
    const stores = await import('src/ts/stores.svelte')
    return get(stores.savingStoppedReason)
}

describe('saveDb size guard on the Node server', () => {
    test('a save whose blocks are under the limit is sent, backed up and committed, and nothing is shown', async () => {
        const w = await kit.startWorld({ kind: 'node' })
        await nextCommit(w, () => {
            h.db!.mainPrompt = 'small'
            w.marks.markCharacterForSave(CHA_ID)
        })
        expect(rootWrites(w.store)).toHaveLength(1)
        expect(backupWrites(w.store)).toHaveLength(1)
        expect(await storedStopReason()).toBeNull()
        expect(alertToast).not.toHaveBeenCalled()
        expect(alertError).not.toHaveBeenCalled()
    })

    test('C5 (R): a block over the limit is not sent, no backup is written, the changes stay unsaved, and the loop parks with one message that names the block and does not advise archiving', async () => {
        const w = await kit.startWorld({ kind: 'node' })
        await nextCommit(w, () => {
            h.db!.mainPrompt = 'small'
            w.marks.markCharacterForSave(CHA_ID)
        })
        const writesBefore = writesTo(w.store, isBlockKey).length
        const backupsBefore = backupWrites(w.store).length
        const committed = vi.fn()
        w.api.afterNextSaveCommit(committed)

        const chat = ((h.db!.characters as Array<Record<string, unknown>>)[0].chats as Array<Record<string, unknown>>)[0]
        chat.note = incompressible(LIMIT * 2)
        w.marks.markCharacterForSave(CHA_ID)
        await until(async () => (await storedStopReason()) === 'too-large', 'the loop to park')

        // A retry loop would send again within a few of the (shortened) sleeps.
        await sleepReal(300)
        const opsAfterPark = w.store.ops.length
        await sleepReal(300)
        chat.note = incompressible(LIMIT * 3)
        w.marks.markCharacterForSave(CHA_ID)
        await sleepReal(300)

        expect(w.store.ops.length).toBe(opsAfterPark)
        expect(writesTo(w.store, isBlockKey)).toHaveLength(writesBefore)
        expect(backupWrites(w.store)).toHaveLength(backupsBefore)
        expect(committed).not.toHaveBeenCalled()
        expect(w.api.isSaveClean()).toBe(false)
        expect(alertError).not.toHaveBeenCalled()
        expect(vi.mocked(alertToast).mock.calls).toHaveLength(1)
        const message = String(vi.mocked(alertToast).mock.calls[0][0])
        expect(message).toContain('stopped saving')
        expect(message).toContain(String(LIMIT / (1024 * 1024)))
        expect(message).toContain(CHA_ID)
        expect(message).not.toMatch(/archiv/i)
        expect(w.api.getSavingStoppedDetail()).toBe(`"${CHA_ID}"`)
    }, 20000)

    test('C5 (R): an over-limit block that is not a character is named in plain words, never by its internal name', async () => {
        const w = await kit.startWorld({ kind: 'node' })
        await nextCommit(w, () => {
            h.db!.mainPrompt = 'small'
            w.marks.markCharacterForSave(CHA_ID)
        })
        // The settings live in the root block.
        h.db!.mainPrompt = incompressible(LIMIT * 2)
        w.marks.markCharacterForSave(CHA_ID)
        await until(async () => (await storedStopReason()) === 'too-large', 'the loop to park')
        const message = String(vi.mocked(alertToast).mock.calls.at(-1)![0])
        expect(message).toContain('your general settings')
        expect(message).not.toContain('"root"')
        expect(w.api.getSavingStoppedDetail()).toBe('your general settings')
    }, 20000)

    test('C5 (R): a legacy profile whose block is over the limit is not converted: the loop parks naming the block, and the main file and the store are untouched', async () => {
        const chat = ((h.db!.characters as Array<Record<string, unknown>>)[0].chats as Array<Record<string, unknown>>)[0]
        chat.note = incompressible(LIMIT * 2)
        const w = await kit.startWorld({ kind: 'node', legacy: true })
        const before = w.store.snapshotValues()
        w.marks.markCharacterForSave(CHA_ID)
        await until(async () => (await storedStopReason()) === 'too-large', 'the loop to park')
        await sleepReal(300)

        expect(w.store.mutating()).toEqual([])
        expect(w.store.snapshotValues()).toEqual(before)
        expect(w.store.peek(MAIN_FILE_KEY)).not.toBeNull()
        expect(mutationsOf(w.store, isBlockKey)).toHaveLength(0)
        expect(vi.mocked(alertToast).mock.calls).toHaveLength(1)
        const message = String(vi.mocked(alertToast).mock.calls[0][0])
        expect(message).toContain(CHA_ID)
        expect(message).not.toMatch(/archiv/i)
        expect(w.api.isSaveClean()).toBe(false)
    }, 20000)

    test('C11 (R): a numbered backup that would be over the limit although every block fits is skipped with one notice, and saving goes on', async () => {
        const characters = Array.from({ length: 30 }, (_, i) => `many-${i}`)
        h.db = makeDb('first', characters)
        const w = await kit.startWorld({ kind: 'node' })
        h.skew = 0
        await nextCommit(w, () => {
            h.db!.mainPrompt = 'second'
            w.marks.markCharacterForSave('many-0')
        })
        expect(rootWrites(w.store)).toHaveLength(1)
        expect(backupWrites(w.store)).toHaveLength(0)
        expect(vi.mocked(alertToast).mock.calls.map((call) => String(call[0]))).toEqual([language.saveSnapshotSkippedTooLarge])

        await nextCommit(w, () => {
            h.db!.mainPrompt = 'third'
            w.marks.markCharacterForSave('many-0')
        })
        expect(rootWrites(w.store)).toHaveLength(2)
        expect(vi.mocked(alertToast), 'notices after the second commit').toHaveBeenCalledTimes(1)
        expect(await storedStopReason()).toBeNull()
        expect(alertError).not.toHaveBeenCalled()
    })
})
