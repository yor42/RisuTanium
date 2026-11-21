// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync } from 'svelte'

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
import { installCharacterSaveMarks, markDbWrite, resetCharacterSaveMarksForTest, type DbWriteMark } from 'src/ts/storage/characterSaveMarks'
import { registerDbChangeEffects } from 'src/ts/storage/dbChangeEffects.svelte'
import { isColdStub } from 'src/ts/storage/store2/codec'
import { createFastForward, type FastForwardOutcome } from 'src/ts/storage/store2/fastForward'
import { applyVerified } from 'src/ts/storage/store2/fastForward/apply'
import { DBState } from 'src/ts/stores.svelte'
import { fakeLists } from './codecFixtures'
import { chaIdOf, chars, clone, until } from './lineFixtures'
import { chatsAt, FF_HOSTS, ffSetup, ffTeardown, mergeWorld, peerCommits, runSpyOf, useFfHost, type MergeWorld } from './ffFixtures'

/**
 * Identity of the characters the fast-forward installs, on a database whose characters read back as state proxies (the
 * page's `DBState.db`) and, for the rows that run on both hosts, on the plain object. Every row asserts `applied` (or the
 * park it forces) before anything else, and a world row that needs an own save pass forces it and waits for `saved`.
 * Real here: `$state`, the write hook, the quiet install, the save loop, the fast-forward, the encoder and committer; the
 * effects rows also run the real `registerDbChangeEffects`. Faked: the page port, the scheduler and the memory backend.
 */

type Slots = unknown[]
type Seed = (db: Database) => void

let hostHandle: ReturnType<typeof ffSetup>
let cleanups: Array<() => void> = []

beforeEach(() => {
    hostHandle = ffSetup()
})

afterEach(() => {
    cleanups.forEach(cleanup => cleanup())
    cleanups = []
    resetCharacterSaveMarksForTest()
    ffTeardown()
})

function made(db: Database, chaId: string) {
    const added = clone(chars(db)[0])
    added.chaId = chaId
    added.name = `Added ${chaId}`
    return added
}

function insertAt(db: Database, index: number, chaId: string): void {
    ;(db.characters as unknown as Slots).splice(index, 0, made(db, chaId))
    db.characterOrder = [...db.characterOrder, chaId]
}

function appendOne(db: Database, chaId: string): void {
    insertAt(db, db.characters.length, chaId)
}

function remove(db: Database, index: number): void {
    const id = chaIdOf(db, index)
    ;(db.characters as unknown as Slots).splice(index, 1)
    db.characterOrder = db.characterOrder.filter(item => item !== id)
}

/** A profile in which characters 1 and 2 share one chaId, which puts the library outside the membership domain. */
const repeated: Seed = (db) => {
    const old = chaIdOf(db, 2)
    chars(db)[2].chaId = chaIdOf(db, 1)
    db.characterOrder = db.characterOrder.map(item => item === old ? chaIdOf(db, 1) : item)
}

const editBody: Seed = (db) => { chars(db)[1].personality = 'peer personality edit' }

function world(seed?: Seed, sink?: (mark: DbWriteMark) => void): Promise<MergeWorld> {
    return mergeWorld({ before: seed === undefined ? undefined : async (page) => { await page.commitEdit(seed) }, sink })
}

/** An own edit of character `index` that is unsaved and unscheduled: marked for the next pass, which no one requests. */
function ownEdit(w: MergeWorld, index: number, text: string): void {
    const slot = chars(w.b.db)[index]
    slot.personality = text
    w.world.tracker.character.push(String(slot.chaId))
    w.world.state.dirty = true
}

/** Requests an own pass and waits until it has saved. */
async function ownPass(w: MergeWorld): Promise<void> {
    const saved = w.world.state.saved
    w.world.state.dirty = true
    w.world.state.due = true
    await until(() => w.world.state.saved > saved, 'the own pass', 8000)
}

/** Appends a step that always fails its verify to every fast-forward the page runs, so each ff that applies is undone. */
function forceFailure(w: MergeWorld): void {
    const env = w.b.context.env
    if (env === undefined) {
        throw new Error('No key environment.')
    }
    w.b.context.fastForward = createFastForward({
        backend: w.memory, kind: 'node', lists: fakeLists, env,
        apply: steps => applyVerified([...steps, { apply: () => () => { }, verify: () => false }]),
    })
    w.run = runSpyOf(w.b)
}

const snapshot = (w: MergeWorld): string => JSON.stringify({
    characters: w.b.db.characters,
    username: Reflect.get(w.b.db, 'username'),
    order: w.b.db.characterOrder,
})

/** The outcome of a forced-failure take, whether the database equals its value before it, and whether every slot is the original object. */
async function forcedTake(w: MergeWorld, edit: Seed, own?: (w: MergeWorld) => void): Promise<{ outcome: FastForwardOutcome, same: boolean, sameObjects: boolean }> {
    forceFailure(w)
    own?.(w)
    const before = snapshot(w)
    const held = [...w.b.db.characters]
    const outcome = await peerCommits(w, edit)
    const sameObjects = w.b.db.characters.length === held.length && w.b.db.characters.every((slot, index) => slot === held[index])
    return { outcome, same: snapshot(w) === before, sameObjects }
}

describe.each(FF_HOSTS)('a peer commit is taken by the installed read-back (%s host)', (mode) => {
    useFfHost(mode)

    test('T1 R1 a peer edit of an untouched resident is taken and the live slot is the peer\'s stub', async () => {
        const w = await world()
        const before = chaIdOf(w.b.db, 1)
        expect(await peerCommits(w, editBody)).toEqual({ kind: 'applied' })
        expect(isColdStub(chars(w.b.db)[1])).toBe(true)
        expect(chaIdOf(w.b.db, 1)).toBe(before)
    })

    test('T2 R6 the same with the slot selected: taken, and the selection stays on it', async () => {
        const w = await world()
        hostHandle.host.state.selected = 1
        expect(await peerCommits(w, editBody)).toEqual({ kind: 'applied' })
        expect(isColdStub(chars(w.b.db)[1])).toBe(true)
        expect(hostHandle.host.state.selected).toBe(1)
    })

    test('T3 R2 a peer append in the domain is taken and the stub is last', async () => {
        const w = await world()
        expect(await peerCommits(w, db => appendOne(db, 'added-tail'))).toEqual({ kind: 'applied' })
        expect(chaIdOf(w.b.db, chars(w.b.db).length - 1)).toBe('added-tail')
        expect(isColdStub(chars(w.b.db)[chars(w.b.db).length - 1])).toBe(true)
    })

    test('T4 R2b a peer that adds two characters at the tail is taken: the second insertion anchors on the first stub', async () => {
        const w = await world()
        const outcome = await peerCommits(w, (db) => {
            appendOne(db, 'added-t1')
            appendOne(db, 'added-t2')
        })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(chars(w.b.db).slice(-2).map(slot => String(slot.chaId))).toEqual(['added-t1', 'added-t2'])
    })

    test('T5 R3 a peer insertion in the middle is taken', async () => {
        const w = await world()
        expect(await peerCommits(w, db => insertAt(db, 1, 'added-mid'))).toEqual({ kind: 'applied' })
        expect(chaIdOf(w.b.db, 1)).toBe('added-mid')
        expect(isColdStub(chars(w.b.db)[1])).toBe(true)
    })

    test('T6 R3b a peer insertion before a slot the peer also edits is taken: the insertion follows the stub that replaced it', async () => {
        const w = await world()
        const successor = chaIdOf(w.b.db, 1)
        const outcome = await peerCommits(w, (db) => {
            insertAt(db, 1, 'added-mid2')
            chars(db)[2].personality = 'peer edit shifted'
        })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(chaIdOf(w.b.db, 1)).toBe('added-mid2')
        expect(chaIdOf(w.b.db, 2)).toBe(successor)
        expect(isColdStub(chars(w.b.db)[2])).toBe(true)
    })

    test('T10 C3m an own edit of character 2 with a peer rename and edit of character 1 is taken with no prompt, and the store holds both', async () => {
        const w = await world()
        ownEdit(w, 2, 'own edit char2')
        const outcome = await peerCommits(w, (db) => {
            chars(db)[1].name = 'Peer renamed'
            chars(db)[1].personality = 'peer personality edit'
        })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(w.b.peer.asked).toEqual([])
        expect(w.b.peer.clean).toEqual([])
        await ownPass(w)
        const read = await w.page.freeze()
        expect(chars(read.db)[1].personality).toBe('peer personality edit')
        expect(chars(read.db)[1].name).toBe('Peer renamed')
        expect(chars(read.db)[2].personality).toBe('own edit char2')
    })

    test('T27 D1 a peer edit of character 3 with a repeated chaId elsewhere is taken by its read-back', async () => {
        const w = await world(repeated)
        const outcome = await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card' })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(isColdStub(chars(w.b.db)[3])).toBe(true)
    })

    test('T28 R4 a peer removal is taken', async () => {
        const w = await world()
        const removed = chaIdOf(w.b.db, 3)
        expect(await peerCommits(w, db => remove(db, 3))).toEqual({ kind: 'applied' })
        expect(chars(w.b.db).map(slot => String(slot.chaId))).not.toContain(removed)
    })

    test('T28 R4b a peer removal ahead of the selection shifts the selection to the same character', async () => {
        const w = await world()
        const kept = chaIdOf(w.b.db, 2)
        hostHandle.host.state.selected = 2
        expect(await peerCommits(w, db => remove(db, 0))).toEqual({ kind: 'applied' })
        expect(hostHandle.host.state.selected).toBe(1)
        expect(chaIdOf(w.b.db, 1)).toBe(kept)
    })

    test('T28 R7 the unit path with a fresh chat: an own view change and a peer message are both kept', async () => {
        const w = await world()
        chars(w.b.db)[1].chatPage = 1
        const outcome = await peerCommits(w, (db) => {
            chatsAt(db, 1)[0].message = [...(chatsAt(db, 1)[0].message as unknown[]), { role: 'user', data: 'peer pushed', time: 1 }]
        })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(chars(w.b.db)[1].chatPage).toBe(1)
    })
})

describe.each(FF_HOSTS)('a failed check restores every step kind (%s host)', (mode) => {
    useFfHost(mode)

    test('T12 U1 a replacement step is undone by a forced failing last step', async () => {
        const w = await world()
        const taken = await forcedTake(w, editBody)
        expect(taken.outcome).toEqual({ kind: 'park', reason: 'check-a' })
        expect(taken.same).toBe(true)
        expect(taken.sameObjects).toBe(true)
    })

    test('T13 U2 an insertion step is undone by a forced failing last step', async () => {
        const w = await world()
        const taken = await forcedTake(w, db => appendOne(db, 'added-u2'))
        expect(taken.outcome).toEqual({ kind: 'park', reason: 'check-a' })
        expect(taken.same).toBe(true)
        expect(taken.sameObjects).toBe(true)
    })

    const guards: Array<[string, Seed, ((w: MergeWorld) => void) | undefined]> = [
        ['T14 U3 a removal step', db => remove(db, 3), undefined],
        ['T14 U4 a root field step', (db) => { Reflect.set(db, 'username', 'peer username') }, undefined],
        ['T14 U5 the unit path', (db) => { chatsAt(db, 1)[0].message = [...(chatsAt(db, 1)[0].message as unknown[]), { role: 'user', data: 'peer pushed', time: 1 }] }, (w) => { chars(w.b.db)[1].chatPage = 1 }],
        ['T14 U6 a moved field step', (db) => { chars(db)[2].lastInteraction = Date.now() + 5000 }, undefined],
    ]
    for (const [name, edit, own] of guards) {
        test(`${name} is undone by a forced failing last step`, async () => {
            const w = await world()
            const taken = await forcedTake(w, edit, own)
            expect(taken.outcome).toEqual({ kind: 'park', reason: 'check-a' })
            expect(taken.same).toBe(true)
            expect(taken.sameObjects).toBe(true)
        })
    }

    test('T15 U7 two appends outside the domain are undone by a forced failing last step', async () => {
        const w = await world(repeated)
        const taken = await forcedTake(w, (db) => {
            appendOne(db, 'app-one')
            appendOne(db, 'app-two')
        })
        expect(taken.outcome).toEqual({ kind: 'park', reason: 'check-a' })
        expect(taken.same).toBe(true)
        expect(taken.sameObjects).toBe(true)
    })

    test('T17 U9 a commit that edits, inserts, removes and appends is undone: the original objects are back in order', async () => {
        const w = await world()
        const taken = await forcedTake(w, (db) => {
            chars(db)[2].personality = 'peer body'
            insertAt(db, 3, 'inserted-mid')
            remove(db, 1)
            appendOne(db, 'appended-last')
        })
        expect(taken.outcome).toEqual({ kind: 'park', reason: 'check-a' })
        expect(taken.same).toBe(true)
        expect(taken.sameObjects).toBe(true)
    })
})

describe.each(FF_HOSTS)('after a park the own edits still save (%s host)', (mode) => {
    useFfHost(mode)

    test('T9 C7n a natural insertion with an own unsaved edit: the take asks nothing, the store holds the added character and the later own edit', async () => {
        const w = await world()
        w.b.peer.answer = 'save-mine'
        ownEdit(w, 2, 'own edit char2')
        const outcome = await peerCommits(w, db => appendOne(db, 'added-c7n'))
        expect(outcome).toEqual({ kind: 'applied' })
        await ownPass(w)
        chars(w.b.db)[3].personality = 'user edit after the peer add'
        const saved = w.world.state.saved
        w.world.mark(chaIdOf(w.b.db, 3))
        await until(() => w.world.state.saved > saved, 'the later pass', 8000)
        const read = await w.page.freeze()
        expect(w.world.failures).toEqual([])
        expect(chars(read.db).map(slot => String(slot.chaId))).toContain('added-c7n')
        expect(chars(read.db)[3].personality).toBe('user edit after the peer add')
    })
})

describe('the identity tracker after a take, with the real change effects (state host)', () => {
    useFfHost('state')

    /** A `$state` world whose write marks reach a tracker and whose characters run through the real identity effect. */
    async function effectsWorld(seed?: Seed): Promise<MergeWorld> {
        const w = await world(seed, markDbWrite)
        installCharacterSaveMarks({ tracker: w.world.tracker, schedule: () => { w.world.state.dirty = true } })
        DBState.db = w.b.db
        cleanups.push($effect.root(() => {
            registerDbChangeEffects({
                tracker: w.world.tracker,
                markChanged: (dirty) => {
                    if (dirty) {
                        w.world.state.dirty = true
                        w.world.state.due = true
                    }
                },
            })
        }))
        flushSync()
        w.world.tracker.character.length = 0
        return w
    }

    test('T21 LB-a an append outside the domain is taken and the tracker does not list the appended stub as a new character', async () => {
        const w = await effectsWorld(repeated)
        expect(await peerCommits(w, db => appendOne(db, 'appended-last'))).toEqual({ kind: 'applied' })
        flushSync()
        expect(chaIdOf(w.b.db, chars(w.b.db).length - 1)).toBe('appended-last')
        expect(w.world.tracker.character).not.toContain('appended-last')
    })

    test('T22 LB-r a replacement take adds the taken chaId to no tracker list', async () => {
        const w = await effectsWorld()
        const taken = chaIdOf(w.b.db, 1)
        expect(await peerCommits(w, editBody)).toEqual({ kind: 'applied' })
        flushSync()
        expect(w.world.tracker.character).not.toContain(taken)
    })

    test('T23 LB-i an insertion take adds the inserted chaId to no tracker list', async () => {
        const w = await effectsWorld()
        expect(await peerCommits(w, db => appendOne(db, 'added-lbi'))).toEqual({ kind: 'applied' })
        flushSync()
        expect(chaIdOf(w.b.db, chars(w.b.db).length - 1)).toBe('added-lbi')
        expect(w.world.tracker.character).not.toContain('added-lbi')
    })
})
