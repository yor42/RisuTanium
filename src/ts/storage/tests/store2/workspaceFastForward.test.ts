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
import {
    assembleDatabase, CodecAssembleError, encodeScoped, isWrittenUnit, previousFrom, unitMapSource,
    type EncodedTree, type PreviousEncoding,
} from 'src/ts/storage/store2/codec'
import { advancePrevious } from 'src/ts/storage/store2/fastForward/advancePrevious'
import { prepareFastForward } from 'src/ts/storage/store2/fastForward/prepare'
import { defaultKeyEnv } from 'src/ts/storage/store2/format'
import { previousOfTree, type StoredTree } from 'src/ts/storage/store2/previousOfTree'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { asDatabase, buildSmall, encodeWith, fakeLists, seededEnv, storeOf, type Obj } from './codecFixtures'
import { ffSetup, ffTeardown, ffWorld, mergeWorld, peerCommits, testHost } from './ffFixtures'
import { chars, parsedKey } from './lineFixtures'

/**
 * Utility workspaces under the fast-forward (#202 S1a-2): a peer change to the workspace list parks and `advancePrevious`
 * refuses it, so the acknowledged encoding never forgets a workspace unit; a peer change elsewhere carries every workspace
 * unit over unchanged. Labels: R reproducer (fails on a base without the feature), G guard, N new-rule test (scratch mutants).
 */

const NOW = 1_700_000_000_000

function file(id: string, path: string, text: string): Obj {
    return { id, path, text, size: new TextEncoder().encode(text).length, mtime: 5 }
}

function workspaces(): Obj[] {
    return [
        { id: 'w1', name: 'First', createdAt: 1000, files: [file('f1', 'AGENTS.md', 'rules'), file('f2', 'notes/a.md', 'note')] },
        { id: 'w2', name: 'Second', createdAt: 2000, files: [file('f3', 'x.txt', 'ex')] },
    ]
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function profile(): Obj {
    return { ...clone(buildSmall(4) as unknown as Obj), utilityWorkspaces: workspaces() }
}

const workspaceList = (db: Obj | Database): { files: Obj[] }[] => (db as unknown as { utilityWorkspaces: { files: Obj[] }[] }).utilityWorkspaces

/** The tree a peer committed, as the page reads it: the units that tree wrote, nothing else. */
function changedOnly(tree: EncodedTree): StoredTree {
    return { manifestKey: tree.manifestKey, manifest: tree.manifest, source: unitMapSource(tree.units.filter(isWrittenUnit)) }
}

function fullOf(tree: EncodedTree, ...trees: EncodedTree[]): StoredTree {
    return { manifestKey: tree.manifestKey, manifest: tree.manifest, source: storeOf(...trees, tree) }
}

async function nextTree(previous: EncodedTree, db: Obj, seq: number): Promise<EncodedTree> {
    return encodeScoped(
        asDatabase(db),
        { env: seededEnv(seq), lists: fakeLists, seq, createdAt: NOW, previous: previousFrom(previous) },
        { modules: false, characters: new Set<string>() },
    )
}

function expectSamePrevious(actual: PreviousEncoding, expected: PreviousEncoding): void {
    expect([...actual.units.keys()].sort()).toEqual([...expected.units.keys()].sort())
    for (const [identity, unit] of expected.units) {
        expect(actual.units.get(identity), identity).toEqual(unit)
    }
    expect(actual.objects).toEqual(expected.objects)
}

const WORKSPACE_IDENTITIES = ['ws:w1', 'ws:w2', 'wsf:w1:f1', 'wsf:w1:f2', 'wsf:w2:f3']

describe('T7b advancePrevious over a peer tree', () => {
    test('R: a peer change elsewhere carries every workspace unit over, equal to the previous of the whole peer tree', async () => {
        const first = encodeWith(asDatabase(profile()))
        const db = profile()
        ;((db.botPresets as Obj[])[1]).temperature = 999
        const second = await nextTree(first, db, 2)
        const advanced = advancePrevious(previousOfTree(fullOf(first)), changedOnly(second))
        for (const identity of WORKSPACE_IDENTITIES) {
            expect(advanced.units.get(identity), identity).toEqual(previousOfTree(fullOf(first)).units.get(identity))
        }
        expectSamePrevious(advanced, previousOfTree(fullOf(second, first)))
    })

    test('R: a peer change to a file\'s text is refused, so the caller parks with nothing written', async () => {
        const first = encodeWith(asDatabase(profile()))
        const db = profile()
        workspaceList(db)[0].files[1].text = 'peer edit'
        const second = await nextTree(first, db, 2)
        expect(() => advancePrevious(previousOfTree(fullOf(first)), changedOnly(second))).toThrow(CodecAssembleError)
    })

    test('R: an added workspace, a removed workspace and a removal of every workspace are each refused', async () => {
        const first = encodeWith(asDatabase(profile()))
        const added = profile()
        ;(added.utilityWorkspaces as Obj[]).push({ id: 'w3', name: 'Third', createdAt: 3, files: [file('f9', 'z.md', 'z')] })
        const removedOne = profile()
        ;(removedOne.utilityWorkspaces as Obj[]).pop()
        const removedAll = profile()
        removedAll.utilityWorkspaces = []
        for (const [label, db] of [['added', added], ['removed one', removedOne], ['removed all', removedAll]] as const) {
            const second = await nextTree(first, db, 2)
            expect(() => advancePrevious(previousOfTree(fullOf(first)), changedOnly(second)), label).toThrow(CodecAssembleError)
        }
    })

    test('G: a store that never held a workspace advances as before and registers none', async () => {
        const first = encodeWith(buildSmall(4))
        const db = clone(buildSmall(4) as unknown as Obj)
        ;((db.botPresets as Obj[])[1]).temperature = 999
        const second = await nextTree(first, db, 2)
        const advanced = advancePrevious(previousOfTree(fullOf(first)), changedOnly(second))
        expect([...advanced.units.keys()].filter(identity => identity.startsWith('ws'))).toEqual([])
        expectSamePrevious(advanced, previousOfTree(fullOf(second, first)))
    })
})

describe('T7b the fast-forward over a store that holds workspaces', () => {
    beforeEach(() => { ffSetup() })
    afterEach(() => { ffTeardown() })

    async function worldWithWorkspaces() {
        const world = await ffWorld()
        await world.page.commitEdit((db) => { (db as unknown as Obj).utilityWorkspaces = workspaces() })
        return world
    }

    /** `prepareFastForward` over the booted page's acknowledged encoding and the peer tree's own previous (never `advancePrevious`, which refuses first). */
    async function prepareAfterPeer(peer: (db: Database) => void) {
        const world = await worldWithWorkspaces()
        const key = await parsedKey(world.memory)
        const read = await readTreeBytes(world.memory, key.current?.key ?? '')
        if (read.status !== 'ok') {
            throw new Error(`The tree read ${read.status}.`)
        }
        const old = previousOfTree(read.tree)
        const db = assembleDatabase(read.tree.manifest, read.tree.source)
        const edited = await world.page.commitEdit(peer)
        const peerRead = await readTreeBytes(world.memory, edited.current?.key ?? '')
        if (peerRead.status !== 'ok') {
            throw new Error(`The peer tree read ${peerRead.status}.`)
        }
        const { host } = testHost()
        return prepareFastForward({
            db, old, target: peerRead.tree, next: previousOfTree(peerRead.tree), host, replyOwners: new Set(), env: defaultKeyEnv, lists: fakeLists,
        })
    }

    test('R: the prepare parks a peer change to a workspace file as `workspaces`', async () => {
        const prepared = await prepareAfterPeer((db) => { workspaceList(db)[0].files[0].text = 'peer edit' })
        expect(prepared).toEqual({ kind: 'park', reason: 'workspaces' })
    })

    test('G: the prepare does not park a peer change that leaves the workspace list alone', async () => {
        const prepared = await prepareAfterPeer((db) => { chars(db)[1].personality = 'peer card' })
        expect(prepared.kind === 'park' ? prepared.reason : prepared.kind).not.toBe('workspaces')
    })

    test('R: the run parks a peer change to a workspace and leaves the page\'s workspaces and encoder alone', async () => {
        const w = await mergeWorld({ before: async (page) => { await page.commitEdit((db) => { (db as unknown as Obj).utilityWorkspaces = workspaces() }) } })
        const manifest = w.b.context.encoder.manifestKey
        const outcome = await peerCommits(w, (db) => { workspaceList(db)[0].files[0].text = 'peer edit' })
        expect(outcome.kind).toBe('park')
        expect(w.b.context.encoder.manifestKey).toBe(manifest)
        expect(workspaceList(w.b.db)[0].files[0].text).toBe('rules')
    })

    test('R: the run takes a peer change elsewhere, and the encoder still holds every workspace unit', async () => {
        const w = await mergeWorld({ before: async (page) => { await page.commitEdit((db) => { (db as unknown as Obj).utilityWorkspaces = workspaces() }) } })
        const before = new Map(WORKSPACE_IDENTITIES.map(identity => [identity, w.b.context.encoder.acknowledged().units.get(identity)?.key]))
        expect([...before.values()].every(key => key !== undefined)).toBe(true)
        const outcome = await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card' })
        expect(outcome).toEqual({ kind: 'applied' })
        for (const identity of WORKSPACE_IDENTITIES) {
            expect(w.b.context.encoder.acknowledged().units.get(identity)?.key, identity).toBe(before.get(identity))
        }
        expect(workspaceList(w.b.db).map(item => item.files.length)).toEqual([2, 1])
    })
})
