// @vitest-environment node
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

import { createMemoryBackend, Store2BackendFailureError, type Store2Backend } from 'src/ts/storage/store2/backend'
import { keyOfRef, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { readEntityUnits, readPeerTree } from 'src/ts/storage/store2/fastForward/read'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { chaIdOf, chars, parsedKey, until } from './lineFixtures'
import { chatsAt, ffSetup, ffTeardown, ffWorldOver, mergeWorld, peerCommits, signal } from './ffFixtures'

/**
 * Stage 3B read rows: the units of the characters the peer changed are fetched after the first decision named them
 * (phase 3), at most twice per run, and everything is decided again over the same tree.
 */

let hostHandle: ReturnType<typeof ffSetup>

beforeEach(() => {
    hostHandle = ffSetup()
})

afterEach(() => {
    ffTeardown()
})

/** A memory backend that reports every `readUnits` request to `onRead`. */
function watched(onRead: (keys: readonly string[], count: number) => void): { backend: Store2Backend, reads: Array<readonly string[]> } {
    const inner = createMemoryBackend()
    const reads: Array<readonly string[]> = []
    const backend: Store2Backend = {
        ...inner,
        readUnits: async (keys) => {
            reads.push(keys)
            onRead(keys, reads.length)
            return inner.readUnits(keys)
        },
    }
    return { backend, reads }
}

describe('readEntityUnits', () => {
    test('RD1 the units that are missing are fetched once, the given tree is left alone, and a second request reads nothing', async () => {
        const { backend, reads } = watched(() => { })
        const { page } = await ffWorldOver(backend)
        const before = await readTreeBytes(backend, (await parsedKey(backend)).current?.key ?? '')
        if (before.status !== 'ok') {
            throw new Error('The base tree did not read.')
        }
        const old = previousOfTree(before.tree)
        const edited = await page.commitEdit((db) => { chars(db)[3].personality = 'peer card' })
        const read = await readPeerTree(backend, edited.current?.key ?? '', old)
        if (read.status !== 'ok') {
            throw new Error(`The peer tree read ${read.status}.`)
        }
        const shard = read.tree.manifest.shards.flatMap((_, index) => old.objects?.shards[index]?.entries ?? [])[3]
        const entry = shard === undefined ? undefined : [...(old.objects?.shards ?? [])].flatMap(item => item.entries).find(candidate => candidate.chaId === shard.chaId)
        expect(entry).toBeDefined()
        const ref = entry?.chats[0].core
        if (ref === undefined) {
            throw new Error('No chat core ref.')
        }
        const count = reads.length
        const first = await readEntityUnits(backend, read.tree, [{ ref, type: UNIT_TYPE.chatCore }])
        expect(first.status).toBe('ok')
        expect(reads.length).toBe(count + 1)
        expect(read.tree.source.get(keyOfRef(ref))).toBeUndefined()
        if (first.status !== 'ok') {
            return
        }
        expect(first.tree.source.get(keyOfRef(ref))).toBeDefined()
        const second = await readEntityUnits(backend, first.tree, [{ ref, type: UNIT_TYPE.chatCore }])
        expect(second.status).toBe('ok')
        expect(reads.length).toBe(count + 1)
    })

    test('RD2 a store that fails the read is a retry, never a park', async () => {
        const fail = { on: false }
        const { backend } = watched(() => {
            if (fail.on) {
                throw new Store2BackendFailureError('the store is unreadable')
            }
        })
        const { page } = await ffWorldOver(backend)
        const before = await readTreeBytes(backend, (await parsedKey(backend)).current?.key ?? '')
        if (before.status !== 'ok') {
            throw new Error('The base tree did not read.')
        }
        const old = previousOfTree(before.tree)
        const edited = await page.commitEdit((db) => { chars(db)[3].personality = 'peer card' })
        const read = await readPeerTree(backend, edited.current?.key ?? '', old)
        if (read.status !== 'ok') {
            throw new Error(`The peer tree read ${read.status}.`)
        }
        const entry = [...(old.objects?.shards ?? [])].flatMap(item => item.entries)[3]
        fail.on = true
        const result = await readEntityUnits(backend, read.tree, [{ ref: entry.chats[0].core, type: UNIT_TYPE.chatCore }])
        expect(result.status).toBe('retry')
    })
})

describe('the incremental read in a run (R16, R16b)', () => {
    test('R16 a character opened while the peer\'s tree is read: its units are read once more and its change is taken in place', async () => {
        let opened = false
        let chaId = ''
        const { backend, reads } = watched(() => {
            if (!opened && chaId !== '') {
                opened = true
                hostHandle.host.state.inUse.add(chaId)
            }
        })
        const w = await mergeWorld({ backend })
        chaId = chaIdOf(w.b.db, 3)
        const before = reads.length
        const outcome = await peerCommits(w, (db) => { chatsAt(db, 3)[1].note = 'peer note' })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(chatsAt(w.b.db, 3)[1].note).toBe('peer note')
        expect(reads.length).toBeGreaterThan(before)
    })

    test('R16b every read opens another character the peer changed: the third need parks entity-late and nothing is written', async () => {
        const order: string[] = []
        const armed = { on: false, step: 0 }
        const { backend } = watched(() => {
            const next = armed.on ? order[armed.step] : undefined
            if (next !== undefined) {
                armed.step += 1
                hostHandle.host.state.inUse.add(next)
            }
        })
        const w = await mergeWorld({ backend })
        order.push('', chaIdOf(w.b.db, 3), chaIdOf(w.b.db, 2), chaIdOf(w.b.db, 1))
        const before = JSON.stringify(w.b.db.characters)
        const runs = w.run.mock.calls.length
        await w.page.commitEdit((db) => {
            for (const index of [1, 2, 3]) {
                chatsAt(db, index)[1].note = `peer note ${index}`
            }
        })
        armed.on = true
        signal(w.world)
        await until(() => w.run.mock.calls.length > runs, 'the fast-forward run', 8000)
        expect(await w.run.mock.results[runs].value).toEqual({ kind: 'park', reason: 'entity-late' })
        expect(JSON.stringify(w.b.db.characters)).toBe(before)
        expect(armed.step).toBe(4)
    })
})

describe('a unit read that edits the page (R5)', () => {
    test('R5 the page edits chat Y while the peer\'s units are read for the second time: the edit is compared after that read, Y parks as a conflict and keeps this page\'s edit', async () => {
        const state: { armed: boolean, calls: number, edit: () => void } = { armed: false, calls: 0, edit: () => { } }
        const { backend } = watched(() => {
            if (state.armed) {
                state.calls += 1
                // The first read after arming is the peer tree's own; the second is the incremental read of its units.
                if (state.calls === 2) {
                    state.edit()
                }
            }
        })
        const w = await mergeWorld({ backend })
        const chaId = chaIdOf(w.b.db, 3)
        const cid = String(chatsAt(w.b.db, 3)[1].id)
        state.edit = () => { chatsAt(w.b.db, 3)[1].note = 'mine during the read' }
        const runs = w.run.mock.calls.length
        await w.page.commitEdit((db) => { chatsAt(db, 3)[1].note = 'peer note' })
        state.armed = true
        signal(w.world)
        await until(() => w.run.mock.calls.length > runs, 'the fast-forward run', 8000)
        expect(state.calls).toBeGreaterThanOrEqual(2)
        expect(await w.run.mock.results[runs].value).toEqual({ kind: 'park', reason: `conflict:char:${chaId}:chat:${cid}` })
        expect(chatsAt(w.b.db, 3)[1].note).toBe('mine during the read')
    })
})
