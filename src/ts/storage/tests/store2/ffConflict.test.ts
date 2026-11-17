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

import type { Database } from 'src/ts/storage/database.svelte'
import { chaIdOf, chars, parsedKey, until } from './lineFixtures'
import { chatsAt, ffSetup, ffTeardown, mergeWorld, peerCommits, personalityOf, resolver, signal, takenBy } from './ffFixtures'

/**
 * Stage 3C: a record both sides changed is asked in one dialog (`resolve`), never parked with Save mine. Every row runs the
 * real save loop over a line-seeded store; the peer is `peerPage`. Nothing in the database changes while the dialog is
 * open, and the answers apply in the next pass over the peer's newest tree.
 */

let hostHandle: ReturnType<typeof ffSetup>

beforeEach(() => {
    hostHandle = ffSetup()
})

afterEach(() => {
    ffTeardown()
})

const idsOf = (calls: ReadonlyArray<{ id: string }>): string[] => calls.map(record => record.id).sort()

function remove(db: Database, index: number): void {
    const id = chaIdOf(db, index)
    ;(db.characters as unknown as unknown[]).splice(index, 1)
    db.characterOrder = db.characterOrder.filter(item => item !== id)
}

describe('one dialog for every record both sides changed (P1, P2, P7)', () => {
    test('P1 a setting, a card and a chat changed on both sides: one resolve call with three rows, the old question is never asked, nothing changes while it is open', async () => {
        const w = await mergeWorld()
        const { b } = w
        const chaId = chaIdOf(b.db, 3)
        const cid = String(chatsAt(b.db, 3)[1].id)
        const held = resolver(w, () => undefined, { held: true })
        b.db.zoomsize = 11
        chars(b.db)[3].personality = 'mine card'
        chatsAt(b.db, 3)[1].note = 'mine note'
        const outcome = await peerCommits(w, (db) => {
            db.zoomsize = 22
            chars(db)[3].personality = 'peer card'
            chatsAt(db, 3)[1].note = 'peer note'
        })
        expect(outcome.kind).toBe('conflict')
        await until(() => held.calls.length === 1, 'the dialog', 8000)
        expect(idsOf(held.calls[0])).toEqual([`char:${chaId}:chat:${cid}`, `char:${chaId}:core`, 'config:zoomsize'].sort())
        const byId = new Map(held.calls[0].map(record => [record.id, record]))
        expect(byId.get('config:zoomsize')).toMatchObject({ choices: ['mine', 'theirs', 'both'], keepBoth: 'restore-point', preselect: 'both', label: { kind: 'setting', name: 'zoomsize' } })
        expect(byId.get(`char:${chaId}:core`)).toMatchObject({ keepBoth: 'restore-point', label: { kind: 'core' } })
        expect(byId.get(`char:${chaId}:chat:${cid}`)).toMatchObject({ keepBoth: 'copy', label: { kind: 'chat' } })
        // P2: the dialog is open; DBState is this page's, and the old question was never asked.
        expect(b.db.zoomsize).toBe(11)
        expect(personalityOf(b.db, 3)).toBe('mine card')
        expect(chatsAt(b.db, 3)[1].note).toBe('mine note')
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        held.release()
        await takenBy(b, w.memory)
        expect(w.world.crashed).toEqual([])
    })

    test('P7 a same-record park never offers Save mine or Export and never saves over the peer, whatever the page is dirty with', async () => {
        const w = await mergeWorld()
        const { b } = w
        const held = resolver(w, () => undefined, { held: true })
        const saveMine = vi.spyOn(b.context.session.committer, 'saveMine')
        chars(b.db)[3].personality = 'mine card'
        w.world.state.dirty = true
        await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card' })
        await until(() => held.calls.length === 1, 'the dialog', 8000)
        expect(b.peer.asked).toEqual([])
        expect(saveMine).not.toHaveBeenCalled()
        held.release()
        await takenBy(b, w.memory)
        expect(saveMine).not.toHaveBeenCalled()
    })

    test('P14 the only mine edit is unmarked and the page is not dirty: the dialog is still asked, and no clean prompt is shown', async () => {
        const w = await mergeWorld()
        const { b } = w
        const held = resolver(w, () => undefined, { held: true })
        Reflect.set(chars(b.db)[3], 'personality', 'raw unmarked card')
        expect(w.world.state.dirty).toBe(false)
        await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card' })
        await until(() => held.calls.length === 1, 'the dialog', 8000)
        expect(b.peer.clean).toEqual([])
        expect(b.peer.asked).toEqual([])
        held.release()
        await takenBy(b, w.memory)
    })

    test('P8 conflicts together with an uncovered park (characterOrder changed on both sides): the park wins, with today\'s question and Save mine, and no dialog', async () => {
        const w = await mergeWorld()
        const { b } = w
        const held = resolver(w, () => undefined)
        chars(b.db)[3].personality = 'mine card'
        b.db.zoomsize = 11
        b.db.characterOrder = [...b.db.characterOrder].reverse()
        w.world.state.dirty = true
        const outcome = await peerCommits(w, (db) => {
            chars(db)[3].personality = 'peer card'
            db.zoomsize = 22
            db.characterOrder = [...db.characterOrder.slice(1), db.characterOrder[0]]
        })
        expect(outcome).toEqual({ kind: 'park', reason: 'character-order' })
        await until(() => b.peer.asked.length === 1, 'the old question', 8000)
        expect(b.peer.asked[0].offers).toContain('save-mine')
        expect(held.calls).toEqual([])
    })

})

describe('the park lifecycle with an open dialog (P3, P4, P5)', () => {
    test('P3 the peer commits a change to a second record both sides changed while the dialog is open: after the answer a second dialog lists only that record, and then every answer applies together', async () => {
        const w = await mergeWorld()
        const { b } = w
        const chaId = chaIdOf(b.db, 3)
        const calls: string[][] = []
        const gates: Array<() => void> = []
        b.peer.resolve = async ({ conflicts }) => {
            calls.push(conflicts.map(record => record.id).sort())
            await new Promise<void>((resolve) => { gates.push(resolve) })
            return Object.fromEntries(conflicts.map(record => [record.id, 'theirs' as const]))
        }
        chars(b.db)[3].personality = 'mine card'
        b.db.zoomsize = 11
        await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card' })
        await until(() => calls.length === 1, 'the first dialog', 8000)
        expect(calls[0]).toEqual([`char:${chaId}:core`])
        const reads = vi.spyOn(b.context.session.committer, 'readCommit')
        await w.page.commitEdit((db) => { db.zoomsize = 22 })
        signal(w.world)
        // The dialog stays open until the loop has re-judged the new descending commit: a same-record park must stand over it.
        await until(() => reads.mock.calls.length > 0, 'the loop re-reading the new commit', 8000)
        await Promise.all(reads.mock.results.map(result => result.value))
        await new Promise<void>(resolve => setTimeout(resolve, 100))
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        expect(calls).toHaveLength(1)
        gates[0]()
        await until(() => calls.length === 2, 'the second dialog', 8000)
        expect(calls[1]).toEqual(['config:zoomsize'])
        // Nothing applied yet: the first answer waits for the second.
        expect(personalityOf(b.db, 3)).toBe('mine card')
        expect(b.db.zoomsize).toBe(11)
        gates[1]()
        await takenBy(b, w.memory)
        expect(personalityOf(b.db, 3)).toBe('peer card')
        expect(b.db.zoomsize).toBe(22)
        expect(calls).toHaveLength(2)
    })

    test('P4 the peer restores an older tree while the dialog is open: the answer is dropped, the page parks on tree-replaced and its database is untouched', async () => {
        const w = await mergeWorld()
        const { b } = w
        const held = resolver(w, () => 'theirs', { held: true })
        chars(b.db)[3].personality = 'mine card'
        await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card' })
        await until(() => held.calls.length === 1, 'the dialog', 8000)
        const key = await parsedKey(w.memory)
        const target = key.retained[key.retained.length - 1].key
        await w.page.restore(target)
        signal(w.world)
        await until(() => b.peer.asked.length + b.peer.clean.length >= 1, 'the tree-replaced question', 8000)
        const shown = [...b.peer.asked, ...b.peer.clean][0]
        expect(shown).toMatchObject({ reason: 'tree-replaced' })
        const shownBefore = b.peer.asked.length + b.peer.clean.length
        held.release()
        await new Promise<void>(resolve => setTimeout(resolve, 200))
        expect(personalityOf(b.db, 3)).toBe('mine card')
        expect(held.calls).toHaveLength(1)
        // The dropped answer neither unparks the page nor asks anything again.
        expect(b.peer.asked.length + b.peer.clean.length).toBe(shownBefore)
    })

    test('P5 after the answer and before the pass, B edits the record again: it is asked again, with the current fingerprint', async () => {
        const w = await mergeWorld()
        const { b } = w
        const chaId = chaIdOf(b.db, 3)
        let gate: () => void = () => { }
        const open = new Promise<void>((resolve) => { gate = resolve })
        // The second dialog stays open until the test has read the state it pins; an immediate answer
        // would let the loop apply 'theirs' before the read under load.
        let releaseSecond: () => void = () => { }
        const openSecond = new Promise<void>((resolve) => { releaseSecond = resolve })
        const calls: string[][] = []
        const fingerprints: string[] = []
        b.peer.resolve = async ({ conflicts }) => {
            calls.push(conflicts.map(record => record.id))
            fingerprints.push(JSON.stringify(conflicts.map(record => record.fingerprint)))
            if (calls.length === 1) {
                // The answer comes back and, in the same step, the page edits the record again.
                queueMicrotask(() => { chars(b.db)[3].personality = 'mine card again' })
                await open
            } else {
                await openSecond
            }
            return Object.fromEntries(conflicts.map(record => [record.id, 'theirs' as const]))
        }
        chars(b.db)[3].personality = 'mine card'
        await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card' })
        await until(() => calls.length === 1, 'the first dialog', 8000)
        gate()
        await until(() => calls.length === 2, 'the second dialog', 8000)
        expect(calls[1]).toEqual([`char:${chaId}:core`])
        // The stale answer was dropped because the shown record's fingerprint changed.
        expect(fingerprints[1]).not.toBe(fingerprints[0])
        expect(personalityOf(b.db, 3)).toBe('mine card again')
        releaseSecond()
    })
})

describe('deleted against edited (P11, R13)', () => {
    test('P11 the peer deletes D that this page edited: a deletedThere row with two choices and mine preselected; keep theirs removes D', async () => {
        const w = await mergeWorld()
        const { b } = w
        const id = chaIdOf(b.db, 1)
        const held = resolver(w, () => 'theirs')
        chars(b.db)[1].personality = 'mine edit of D'
        await peerCommits(w, db => remove(db, 1))
        await until(() => held.calls.length === 1, 'the dialog', 8000)
        expect(held.calls[0]).toHaveLength(1)
        expect(held.calls[0][0]).toMatchObject({ id: `char:${id}:deletedThere`, choices: ['mine', 'theirs'], keepBoth: null, preselect: 'mine' })
        await takenBy(b, w.memory)
        expect(chars(b.db).map(slot => String(slot.chaId))).not.toContain(id)
    })

    test('R13 this page deleted D that the peer edited: a deletedHere row with theirs preselected; keep theirs puts D back', async () => {
        const w = await mergeWorld()
        const { b } = w
        const id = chaIdOf(b.db, 1)
        const held = resolver(w)
        remove(b.db, 1)
        await peerCommits(w, (db) => { chars(db)[1].personality = 'peer edit of D' })
        await until(() => held.calls.length === 1, 'the dialog', 8000)
        expect(held.calls[0][0]).toMatchObject({ id: `char:${id}:deletedHere`, choices: ['mine', 'theirs'], keepBoth: null, preselect: 'theirs' })
        await takenBy(b, w.memory)
        expect(chars(b.db).map(slot => String(slot.chaId))).toContain(id)
        expect(chaIdOf(b.db, 1)).toBe(id)
    })
})
