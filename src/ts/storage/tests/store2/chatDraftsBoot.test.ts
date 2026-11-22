import { afterEach, describe, expect, test, vi } from 'vitest'

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
import { crc32 } from 'src/ts/storage/blockFrame'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { resetStore2BootForTest } from 'src/ts/storage/store2/bootActive'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { assembleDatabase, CodecAssembleError, planScopedEncode, previousFrom, type EncodedTree } from 'src/ts/storage/store2/codec'
import { createKeyMint } from 'src/ts/storage/store2/commit'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { encodeUnit, FRAME_HEADER_BYTES, keyOfRef, refOfFrame, UNIT_TYPE, type Manifest } from 'src/ts/storage/store2/format'
import { markLiveKeys } from 'src/ts/storage/store2/gc/mark'
import { previousOfTree, type StoredTree } from 'src/ts/storage/store2/previousOfTree'
import { resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { resetRetainedForTest } from 'src/ts/process/coldRetained'
import { bootThroughDispatch, commitActivePass, createClock, seedTree, testEnv } from '../store2SaveKit'
import { asDatabase, buildSmall, fakeLists, seededEnv, type Obj } from './codecFixtures'

/**
 * The boot read of the draft unit (#272 S1, MC-3593): `readTreeBytes` reads it as an optional unit and `previousOfTree`
 * registers it under the identity the encoder gives it, so the first save after a reboot reuses an untouched unit. A missing
 * or damaged unit is dropped by the boot read, never a finding that sends the profile to recovery, and its bytes stay under
 * their write-once key. Labels: PIN pins a rule of a format that does not exist before the change (its evidence is the
 * scratch mutant that breaks it); GUARD passes before and after.
 */

const NOW = 1_700_000_000_000
const BASE_HASH = 'c82329ae1484ab97b016fe0d3ab4818f'

function draft(m: string, text: string): Obj {
    return { m, text, bh: BASE_HASH, at: NOW }
}

const DRAFTS = (): Obj[] => [
    { cha: 'c1', chat: 'k1', shown: true, drafts: [draft('id:m1', 'one'), draft('idx:2', 'two')] },
    { cha: 'c2', chat: 'k3', shown: true },
]

function profile(extra: Obj = { chatDrafts: DRAFTS() }): Database {
    return asDatabase({ ...buildSmall(2) as unknown as Obj, ...extra })
}

interface World {
    memory: MemoryBackend
    tree: EncodedTree
    manifestKey: string
    stored: StoredTree
}

async function seedWorld(db: Database = profile()): Promise<World> {
    const memory = createMemoryBackend()
    const seeded = await seedTree(memory, JSON.parse(JSON.stringify(db)) as Database, testEnv(createClock(), 4242), fakeLists)
    const read = await readTreeBytes(memory, seeded.manifestKey)
    if (read.status !== 'ok') {
        throw new Error(`The seeded tree reads ${read.status}.`)
    }
    return { memory, tree: seeded.tree, manifestKey: seeded.manifestKey, stored: read.tree }
}

function draftKeyOf(world: World): string {
    return keyOfRef(world.tree.manifest.fixed.chatDrafts ?? ['', 0, 0])
}

function flipped(bytes: Uint8Array, at: number): Uint8Array {
    const out = new Uint8Array(bytes)
    out[at] ^= 0xff
    return out
}

function tooNew(bytes: Uint8Array): Uint8Array {
    const out = new Uint8Array(bytes)
    out[4] = 9
    new DataView(out.buffer, out.byteOffset + 12, 4).setUint32(0, crc32(out.subarray(0, 12)), true)
    return out
}

describe('T1.6 boot: the first save after a reboot treats the draft unit as the encoder named it', () => {
    test('PIN: previousOfTree registers the unit with its stored key, Ref and digest, and its body', async () => {
        const world = await seedWorld()
        const read = previousOfTree(world.stored)
        const kept = previousFrom(world.tree)
        const unit = read.units.get('chatDrafts')
        expect(unit?.type).toBe(30)
        expect(unit?.key).toBe(draftKeyOf(world))
        expect(unit?.digest).toBeDefined()
        expect(unit).toEqual(kept.units.get('chatDrafts'))
        expect(read.objects?.chatDrafts).toEqual(DRAFTS())
    })

    test('PIN: a first pass over the booted previous reuses the unit under the same key, and an edit writes only that unit', async () => {
        const world = await seedWorld()
        const previous = previousOfTree(world.stored)
        const assembled = assembleDatabase(world.stored.manifest, world.stored.source)
        const same = await planScopedEncode(
            assembled, { env: seededEnv(2), lists: fakeLists, seq: 2, createdAt: NOW, previous }, { modules: false, characters: new Set<string>() },
        )
        expect(same.written.has('chatDrafts')).toBe(false)

        const edited = JSON.parse(JSON.stringify(assembled)) as { chatDrafts: Obj[] }
        edited.chatDrafts[0].shown = undefined
        const plan = await planScopedEncode(
            edited as unknown as Database, { env: seededEnv(3), lists: fakeLists, seq: 2, createdAt: NOW, previous }, { modules: false, characters: new Set<string>() },
        )
        expect([...plan.written.keys()]).toEqual(['chatDrafts'])
    })

    test('PIN: the plan keeps the body of the unit through the commit-time rekey, so a later draft fault finds it', async () => {
        const world = await seedWorld()
        const previous = previousOfTree(world.stored)
        const edited = JSON.parse(JSON.stringify(assembleDatabase(world.stored.manifest, world.stored.source))) as { chatDrafts: Obj[] }
        edited.chatDrafts.push({ cha: 'c9', chat: 'k9', shown: true })
        const plan = await planScopedEncode(
            edited as unknown as Database, { env: seededEnv(3), lists: fakeLists, seq: 2, createdAt: NOW, previous }, { modules: false, characters: new Set<string>() },
        )
        const tree = plan.finalize({ mint: createKeyMint(testEnv(createClock(), 77), null).mint, seq: 2, now: NOW })
        expect(tree.index.objects?.chatDrafts).toEqual(edited.chatDrafts)
    })

    test('GUARD: a store without the unit registers none and its manifest names none', async () => {
        const world = await seedWorld(profile({}))
        expect(Object.hasOwn(world.stored.manifest.fixed, 'chatDrafts')).toBe(false)
        expect(previousOfTree(world.stored).units.has('chatDrafts')).toBe(false)
        expect(previousOfTree(world.stored).objects?.chatDrafts).toBeUndefined()
    })
})

describe('T1.7 boot: a missing or damaged draft unit is dropped, never a finding that stops the boot', () => {
    const DAMAGES: { name: string, why: 'missing' | 'damaged', apply: (bytes: Uint8Array) => Uint8Array | null }[] = [
        { name: 'missing', why: 'missing', apply: () => null },
        { name: 'a flipped payload byte', why: 'damaged', apply: bytes => flipped(bytes, FRAME_HEADER_BYTES + 1) },
        { name: 'a changed stored checksum', why: 'damaged', apply: bytes => flipped(bytes, bytes.length - 1) },
    ]

    for (const damage of DAMAGES) {
        test(`PIN: ${damage.name} reads the tree ok, names the unit as dropped and withholds its bytes`, async () => {
            const world = await seedWorld()
            const key = draftKeyOf(world)
            world.memory.poke(key, damage.apply(world.memory.snapshot().get(key) as Uint8Array))
            const read = await readTreeBytes(world.memory, world.manifestKey)
            expect(read.status).toBe('ok')
            if (read.status !== 'ok') {
                return
            }
            expect(read.flagged).toEqual([])
            expect(read.dropped).toEqual([{ key, type: 30, why: damage.why }])
            expect(read.tree.source.get(key)).toBeUndefined()
            // The rest of the profile reads: only the draft unit is left out.
            const assembled = assembleDatabase(read.tree.manifest, read.tree.source, { skipChatDrafts: true })
            expect(Object.hasOwn(assembled, 'chatDrafts')).toBe(false)
            expect((assembled.characters as unknown[]).length).toBe(2)
            // Every other caller stays strict about the unit.
            expect(() => assembleDatabase(read.tree.manifest, read.tree.source)).toThrow(CodecAssembleError)
        })
    }

    test('PIN: a body that is not the list the assembly reads is as damaged as a failed checksum', async () => {
        const world = await seedWorld()
        const key = draftKeyOf(world)
        const bytes = encodeUnit(UNIT_TYPE.chatDrafts, { v: 1, chats: 'not a list' })
        const manifest: Manifest = JSON.parse(JSON.stringify(world.stored.manifest))
        manifest.fixed.chatDrafts = refOfFrame(key, bytes)
        world.memory.poke(key, bytes)
        world.memory.poke(world.manifestKey, encodeUnit(UNIT_TYPE.manifest, manifest))
        const read = await readTreeBytes(world.memory, world.manifestKey)
        expect(read.status).toBe('ok')
        expect(read.status === 'ok' && read.dropped).toEqual([{ key, type: 30, why: 'damaged' }])
    })

    test('PIN: a unit a newer build wrote is still too-new, which wins, so the page goes read-only and keeps the bytes', async () => {
        const world = await seedWorld()
        const key = draftKeyOf(world)
        world.memory.poke(key, tooNew(world.memory.snapshot().get(key) as Uint8Array))
        expect((await readTreeBytes(world.memory, world.manifestKey)).status).toBe('too-new')
        const future = encodeUnit(UNIT_TYPE.chatDrafts, { v: 2, chats: [] })
        const manifest: Manifest = JSON.parse(JSON.stringify(world.stored.manifest))
        manifest.fixed.chatDrafts = refOfFrame(key, future)
        world.memory.poke(key, future)
        world.memory.poke(world.manifestKey, encodeUnit(UNIT_TYPE.manifest, manifest))
        expect((await readTreeBytes(world.memory, world.manifestKey)).status).toBe('too-new')
    })

    test('GUARD: an undamaged tree with drafts reads ok with nothing flagged or dropped', async () => {
        const world = await seedWorld()
        const read = await readTreeBytes(world.memory, world.manifestKey)
        expect(read.status === 'ok' && read.flagged).toEqual([])
        expect(read.status === 'ok' && read.dropped).toBeUndefined()
        expect(read.status === 'ok' && assembleDatabase(read.tree.manifest, read.tree.source).chatDrafts).toEqual(DRAFTS())
    })
})

describe('MC-3593: a damaged draft unit through the real boot dispatch', () => {
    afterEach(() => {
        resetStore2SaveForTest()
        resetResidencyForTest()
        resetStore2BootForTest()
        resetPageStorageModeForTests()
        resetRetainedForTest()
    })

    test('PIN: the boot opens without asking, the profile loads without drafts, and the bytes survive a commit and a mark', async () => {
        const world = await seedWorld()
        const key = draftKeyOf(world)
        const damaged = flipped(world.memory.snapshot().get(key) as Uint8Array, FRAME_HEADER_BYTES + 1)
        world.memory.poke(key, damaged)

        // The UI port of the kit declines every question, a flagged-leaf question included: reaching `store2` means none was asked.
        const booted = await bootThroughDispatch(world.memory, { lists: fakeLists })
        expect(booted.result.kind).toBe('store2')
        if (booted.result.kind !== 'store2') {
            return
        }
        const db = booted.result.database
        expect(Object.hasOwn(db, 'chatDrafts')).toBe(false)
        expect((db.characters as unknown[]).length).toBe(2)
        // The only notice a first boot of a profile raises is the archive switch; nothing names a damaged or dropped unit.
        expect(booted.notices.filter(notice => notice.name !== 'archive-enabled')).toEqual([])

        // A further commit: the manifest stops naming the unit, the token stays, the damaged bytes are untouched.
        await commitActivePass(db, [])
        const current = await world.memory.readCommit()
        const keyNow = classifyCommitRead(current)
        expect(keyNow.status).toBe('parsed')
        const currentKey = keyNow.status === 'parsed' ? keyNow.value.current?.key : undefined
        expect(currentKey).toBeDefined()
        expect(currentKey).not.toBe(world.manifestKey)
        const now = await readTreeBytes(world.memory, currentKey as string)
        expect(now.status).toBe('ok')
        if (now.status === 'ok') {
            expect(Object.hasOwn(now.tree.manifest.fixed, 'chatDrafts')).toBe(false)
            expect(now.tree.manifest.req).toContain('chat-drafts')
        }
        expect(world.memory.snapshot().get(key)).toEqual(damaged)

        // The retained manifest still names the unit, so a mark keeps it live, and a new draft is written beside it.
        const marked = await markLiveKeys(world.memory, current)
        expect(marked.status).toBe('marked')
        expect(marked.status === 'marked' && marked.live.has(key)).toBe(true)
        db.chatDrafts = [{ cha: 'c1', chat: 'k1', drafts: [draft('id:m7', 'after the boot')] }] as Database['chatDrafts']
        await commitActivePass(db, [])
        const again = await world.memory.readCommit()
        const remarked = await markLiveKeys(world.memory, again)
        expect(remarked.status === 'marked' && remarked.live.has(key)).toBe(true)
        expect(world.memory.snapshot().get(key)).toEqual(damaged)
    })
})
