// @vitest-environment node
/**
 * Kind 30 over a `.bin` import of a store2 page (#272 S1): a `.bin` never carries drafts, so a key of that name in a file is
 * dropped before anything is encoded, by the root half of the resolve that the whole and the streamed import share; and the
 * import builds over the manifest the commit key names, so the `chat-drafts` token of a page that held drafts is never lowered.
 * Driven over a memory backend whose base is the real producer's tree. Labels: PIN pins a rule of a unit that does not exist
 * before the change.
 */
import { describe, expect, test, vi } from 'vitest'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) }) },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) },
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))

import type { Database } from 'src/ts/storage/database.svelte'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import type { Manifest } from 'src/ts/storage/store2/format'
import { importLegacyTree, type ImportOutcome, type ImportRequest } from 'src/ts/storage/store2/legacy/importTree'
import { resolveLegacyRoot, resolveLegacyTree } from 'src/ts/storage/store2/legacy/resolve'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { createClock, seedTree, testEnv } from '../store2SaveKit'
import { asDatabase, buildSmall, fakeLists, type Obj } from './codecFixtures'
import { committerOf, parsedCommit } from './commitFixtures'
import { readerOver } from './legacyFixtures'

const OPTIONS = { newId: () => 'placeholder-chat-id', now: () => 1_700_000_000_001 }
const accept = { async confirmIncomplete() { return true } }
const BH = '0123456789abcdef0123456789abcdef'

const FILE_DRAFTS = (): Obj[] => [{ cha: 'FROM-FILE', chat: 'file-chat', shown: true, drafts: [{ m: 'id:f', text: 'FROM-FILE-TEXT', bh: BH, at: 1 }] }]
const PAGE_DRAFTS = (): Obj[] => [{ cha: 'page', chat: 'page-chat', shown: true, drafts: [{ m: 'id:p', text: 'page text', bh: BH, at: 2 }] }]

interface Rig {
    memory: MemoryBackend
    request(tree: Database): ImportRequest
}

/** A page over a memory backend whose current tree is the real producer's encoding of `base`. */
async function rig(base: Obj): Promise<Rig> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const source = asDatabase({ ...buildSmall(2) as unknown as Obj, ...base })
    await seedTree(memory, JSON.parse(JSON.stringify(source)) as Database, testEnv(clock, 1), fakeLists)
    const committer = committerOf(memory, clock, 100)
    clock.advance(1000)
    return {
        memory,
        request: tree => ({
            source: { tree },
            reader: readerOver(new Map()),
            committer,
            backend: memory,
            lists: fakeLists,
            env: testEnv(clock, 300),
            resolve: OPTIONS,
        }),
    }
}

function committedOf(outcome: ImportOutcome): void {
    expect(outcome.status).toBe('committed')
}

async function currentTree(memory: MemoryBackend): Promise<{ manifest: Manifest, stored: Database }> {
    const key = (await parsedCommit(memory)).current
    const read = await readTreeBytes(memory, key?.key ?? '')
    if (read.status !== 'ok') {
        throw new Error(`The stored tree reads ${read.status}.`)
    }
    return { manifest: read.tree.manifest, stored: assembleDatabase(read.tree.manifest, read.tree.source) }
}

const imported = (extra: Obj = {}): Database => asDatabase({ ...buildSmall(3) as unknown as Obj, ...extra })

describe('T1.5 the token over a page .bin import', () => {
    test('PIN: the import keeps the token of a page that held drafts, and the file brings none of its own', async () => {
        const page = await rig({ chatDrafts: PAGE_DRAFTS() })
        expect((await currentTree(page.memory)).manifest.req).toContain('chat-drafts')

        committedOf(await importLegacyTree(page.request(imported({ chatDrafts: FILE_DRAFTS() })), accept))

        const { manifest, stored } = await currentTree(page.memory)
        expect(manifest.req).toContain('chat-drafts')
        expect(Object.hasOwn(manifest.fixed, 'chatDrafts')).toBe(false)
        expect(Object.hasOwn(stored, 'chatDrafts')).toBe(false)
        expect(JSON.stringify(stored)).not.toContain('FROM-FILE')
    })

    test('PIN: a page that never held drafts and a file that has some end with no unit, no field and no token', async () => {
        const page = await rig({})

        committedOf(await importLegacyTree(page.request(imported({ chatDrafts: FILE_DRAFTS() })), accept))

        const { manifest, stored } = await currentTree(page.memory)
        expect(Object.hasOwn(manifest.fixed, 'chatDrafts')).toBe(false)
        expect(manifest.req).not.toContain('chat-drafts')
        expect(Object.hasOwn(stored, 'chatDrafts')).toBe(false)
        expect(JSON.stringify(stored)).not.toContain('FROM-FILE')
    })
})

describe('T1.14 a file\'s own draft key is dropped where both import paths pass', () => {
    const FILE_TREE = (): Database => asDatabase({ ...buildSmall(1) as unknown as Obj, chatDrafts: FILE_DRAFTS() })

    test('PIN: the whole-tree resolve drops it', async () => {
        const resolved = await resolveLegacyTree(FILE_TREE(), readerOver(new Map()), OPTIONS)
        expect(Object.hasOwn(resolved.database, 'chatDrafts')).toBe(false)
    })

    test('PIN: the root half of the resolve, the one the streamed import calls on its own, drops it', async () => {
        const tree = FILE_TREE()
        const database = await resolveLegacyRoot(tree, tree.characters as unknown[], readerOver(new Map()), [], OPTIONS)
        expect(Object.hasOwn(database, 'chatDrafts')).toBe(false)
        // The caller's copy of the file's root is not changed.
        expect(Object.hasOwn(tree, 'chatDrafts')).toBe(true)
    })
})
