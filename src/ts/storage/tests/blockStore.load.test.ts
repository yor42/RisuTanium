// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { checkSingleBlock, frameBlock, frameJsonBlock, parseFramedBlock, BLOCK_TYPE_ROOT, readPack } from 'src/ts/storage/blockFrame'
import { characterBlockKey, fixedBlockKey, isFixedBlockName, keptKey, rootKey, stubsKey, HEAD_KEY } from 'src/ts/storage/blockKeys'
import { BlockOwnerStateError, BlockStoreReadError, assembleLegacyFile, type DamagedItem, type LoadedBlocks, type LoadResult, type ReplaceResult } from 'src/ts/storage/blockStore'
import { encodeHead } from 'src/ts/storage/headSwap'
import { directoryOf, parseBlocks } from './risuSaveBlockFile'
import {
    Interleaver,
    InjectedFault,
    characterBlock,
    createFakeStore,
    makeOwner,
    makeSet,
    seedStore,
    textOf,
    withCharacter,
    type FakeStore,
} from './blockStoreHarness'

const SET = makeSet({ characters: [{ chaId: 'alice' }, { chaId: 'bob' }, { chaId: 'stubby' }], packed: ['stubby'] })

async function seeded(versioned: boolean): Promise<{ store: FakeStore, generation: string }> {
    const store = createFakeStore({ versioned })
    const generation = await seedStore(store, SET)
    return { store, generation }
}

function damagedOf(result: LoadResult) {
    if (result.kind !== 'damaged') {
        throw new Error(`expected damage, got ${result.kind}`)
    }
    return result
}

describe.each([{ versioned: true }, { versioned: false }])('load() with versioned=$versioned', ({ versioned }) => {
    test('an empty store has no head, and nothing is written', async () => {
        const store = createFakeStore({ versioned })
        const { owner } = makeOwner(store)
        expect(await owner.load()).toEqual({ kind: 'no-head' })
        expect(store.mutating()).toEqual([])
        expect(owner.isLive()).toBe(false)
    })

    test('reads every listed value, resolves the pack, and writes nothing', async () => {
        const { store, generation } = await seeded(versioned)
        const before = store.mutating().length
        const { owner } = makeOwner(store)
        const result = await owner.load()
        expect(result.kind).toBe('loaded')
        if (result.kind !== 'loaded') {
            return
        }
        expect(result.loaded.generation).toBe(generation)
        expect(result.loaded.packed).toEqual(['stubby'])
        expect(Array.from(result.loaded.directory)).toEqual(['preset', 'modules', 'loadouts', 'plugins', 'pluginStorage', 'alice', 'bob', 'stubby', 'config'])
        expect(textOf(result.loaded.blocks.get('alice'))).toBe(textOf(characterBlock('alice')))
        expect(result.loaded.blocks.get('stubby')).toEqual(characterBlock('stubby'))
        expect(store.mutating().length).toBe(before)
        expect(owner.isLive()).toBe(true)
    })

    test('assembleLegacyFile gives a block file whose directory and blocks are the loaded ones', async () => {
        const { store } = await seeded(versioned)
        const { owner } = makeOwner(store)
        const result = await owner.load()
        if (result.kind !== 'loaded') {
            throw new Error('not loaded')
        }
        const file = assembleLegacyFile(result.loaded)
        expect(directoryOf(file)).toEqual(Array.from(result.loaded.directory))
        expect(parseBlocks(file).map((block) => block.name)).toEqual(['root', ...result.loaded.directory])
        for (const block of parseBlocks(file)) {
            expect(block.storedDataChecksum).toBeDefined()
        }
    })

    test('a boot followed by a save with no change writes nothing', async () => {
        const { store } = await seeded(versioned)
        const { owner } = makeOwner(store)
        await owner.load()
        const before = store.mutating().length
        const result = await owner.commitSave(SET)
        expect(result).toMatchObject({ kind: 'committed', wrote: false })
        expect(store.mutating().length).toBe(before)
    })
})

describe('damage is reported, never installed or repaired (invariants 2 and P)', () => {
    interface Case {
        title: string
        arrange(store: FakeStore, generation: string): void
        expectItem: { part: string, name: string, kind: string }
    }
    const own = (generation: string, name: string) => characterBlockKey(generation, name)
    const cases: Case[] = [
        { title: 'a character value that is absent', arrange: (s, g) => s.unplant(own(g, 'alice')), expectItem: { part: 'character', name: 'alice', kind: 'absent' } },
        { title: 'a character value that is empty', arrange: (s, g) => s.plant(own(g, 'alice'), new Uint8Array(0)), expectItem: { part: 'character', name: 'alice', kind: 'empty' } },
        {
            title: 'a character whose payload checksum is wrong',
            arrange: (s, g) => {
                const stored = s.peek(own(g, 'alice')) as Uint8Array
                stored[stored.length - 5] ^= 0xff
                s.plant(own(g, 'alice'), stored)
            },
            expectItem: { part: 'character', name: 'alice', kind: 'crc' },
        },
        {
            title: 'a character whose header is cut off',
            arrange: (s, g) => s.plant(own(g, 'alice'), (s.peek(own(g, 'alice')) as Uint8Array).subarray(0, 6)),
            expectItem: { part: 'character', name: 'alice', kind: 'framing' },
        },
        { title: 'a value that holds another character\'s block', arrange: (s, g) => s.plant(own(g, 'alice'), characterBlock('bob')), expectItem: { part: 'character', name: 'alice', kind: 'wrong-name' } },
        { title: 'a fixed block that is absent', arrange: (s, g) => s.unplant(fixedBlockKey(g, 'modules')), expectItem: { part: 'fixed', name: 'modules', kind: 'absent' } },
        { title: 'a fixed block that is empty', arrange: (s, g) => s.plant(fixedBlockKey(g, 'preset'), new Uint8Array(0)), expectItem: { part: 'fixed', name: 'preset', kind: 'empty' } },
        { title: 'a stubs pack that is absent', arrange: (s, g) => s.unplant(stubsKey(g)), expectItem: { part: 'stub', name: 'stubby', kind: 'absent' } },
        { title: 'a stubs pack that is empty', arrange: (s, g) => s.plant(stubsKey(g), new Uint8Array(0)), expectItem: { part: 'stub', name: 'stubby', kind: 'empty' } },
        {
            title: 'a stub missing from the pack',
            arrange: (s, g) => s.plant(stubsKey(g), characterBlock('somebody-else')),
            expectItem: { part: 'stub', name: 'stubby', kind: 'absent' },
        },
        {
            title: 'a stub whose payload checksum is wrong',
            arrange: (s, g) => {
                const pack = s.peek(stubsKey(g)) as Uint8Array
                pack[pack.length - 6] ^= 0x55
                s.plant(stubsKey(g), pack)
            },
            expectItem: { part: 'stub', name: 'stubby', kind: 'crc' },
        },
        { title: 'a root that is absent', arrange: (s, g) => s.unplant(rootKey(g)), expectItem: { part: 'root', name: 'root', kind: 'absent' } },
        { title: 'a root that is empty', arrange: (s, g) => s.plant(rootKey(g), new Uint8Array(0)), expectItem: { part: 'root', name: 'root', kind: 'empty' } },
        {
            title: 'a root with no directory',
            arrange: (s, g) => s.plant(rootKey(g), frameJsonBlock(BLOCK_TYPE_ROOT, 'root', { __seq: 1, __packed: [] })),
            expectItem: { part: 'root', name: 'root', kind: 'bad-root' },
        },
        {
            title: 'a root with no sequence number',
            arrange: (s, g) => s.plant(rootKey(g), frameJsonBlock(BLOCK_TYPE_ROOT, 'root', { __directory: ['config'], __packed: [] })),
            expectItem: { part: 'root', name: 'root', kind: 'bad-root' },
        },
        {
            title: 'a root that lists a packed name outside its directory',
            arrange: (s, g) => s.plant(rootKey(g), frameJsonBlock(BLOCK_TYPE_ROOT, 'root', { __directory: ['config'], __packed: ['ghost'], __seq: 1 })),
            expectItem: { part: 'root', name: 'root', kind: 'bad-root' },
        },
        { title: 'a root whose payload is not JSON', arrange: (s, g) => s.plant(rootKey(g), frameBlock(BLOCK_TYPE_ROOT, 'root', new TextEncoder().encode('not json'))), expectItem: { part: 'root', name: 'root', kind: 'bad-root' } },
        { title: 'a head that is not a pointer', arrange: (s) => s.plant(HEAD_KEY, new TextEncoder().encode('{"current":"nope"}')), expectItem: { part: 'head', name: HEAD_KEY, kind: 'bad-head' } },
    ]

    test.each(cases)('$title', async ({ arrange, expectItem }) => {
        const { store, generation } = await seeded(true)
        arrange(store, generation)
        const before = store.mutating().length
        const { owner } = makeOwner(store)
        const result = damagedOf(await owner.load())
        expect(result.damage.map((item) => ({ part: item.part, name: item.name, kind: item.kind }))).toContainEqual(expectItem)
        expect(store.mutating().length, 'a load that finds damage writes nothing').toBe(before)
        expect(owner.isLive(), 'nothing is installed').toBe(false)
        await expect(owner.commitSave(SET)).rejects.toBeInstanceOf(BlockOwnerStateError)
    })

    test('every damaged item is named, not only the first', async () => {
        const { store, generation } = await seeded(false)
        store.unplant(characterBlockKey(generation, 'alice'))
        store.unplant(fixedBlockKey(generation, 'plugins'))
        store.plant(stubsKey(generation), new Uint8Array(0))
        const { owner } = makeOwner(store)
        const result = damagedOf(await owner.load())
        expect(result.damage.map((item) => item.name).sort()).toEqual(['alice', 'plugins', 'stubby'])
        expect(result.directory).toContain('bob')
        expect(result.generation).toBe(generation)
    })

    test('an unreadable root still reports the generation, and an unreadable head reports none', async () => {
        const { store, generation } = await seeded(false)
        store.unplant(rootKey(generation))
        expect(damagedOf(await makeOwner(store).owner.load()).generation).toBe(generation)
        store.plant(HEAD_KEY, new TextEncoder().encode('garbage'))
        expect(damagedOf(await makeOwner(store).owner.load()).generation).toBeNull()
    })
})

describe('read errors (not damage)', () => {
    test('a read that fails once is retried and the load succeeds', async () => {
        const { store, generation } = await seeded(true)
        const key = characterBlockKey(generation, 'alice')
        store.faults.push({ match: (op) => op.kind === 'read' && op.key === key, mode: 'before', times: 2 })
        const delays: number[] = []
        const { owner } = makeOwner(store, { sleep: async (ms) => { delays.push(ms) } })
        expect((await owner.load()).kind).toBe('loaded')
        expect(delays.length).toBe(2)
    })

    test('a read that keeps failing stops the load with an error, installs nothing and writes nothing', async () => {
        const { store, generation } = await seeded(true)
        const key = characterBlockKey(generation, 'bob')
        store.faults.push({ match: (op) => op.kind === 'read' && op.key === key, mode: 'before', times: 99 })
        const before = store.mutating().length
        const { owner } = makeOwner(store)
        await expect(owner.load()).rejects.toBeInstanceOf(BlockStoreReadError)
        expect(owner.isLive()).toBe(false)
        expect(store.mutating().length).toBe(before)
    })

    test('an unreadable head stops the load with an error', async () => {
        const { store } = await seeded(true)
        store.faults.push({ match: (op) => op.kind === 'read' && op.key === HEAD_KEY, mode: 'before', times: 99, error: new InjectedFault('head down') })
        await expect(makeOwner(store).owner.load()).rejects.toBeInstanceOf(BlockStoreReadError)
    })
})

describe('load() writes and deletes nothing under blocks/ (invariant Q)', () => {
    test('with a leftover generation, a kept generation and an interrupted deletion present', async () => {
        const store = createFakeStore({ versioned: true })
        const live = await seedStore(store, SET)
        const kept = '000000000001-00000001'
        const leftover = '000000000002-00000002'
        const halfDeleted = '000000000003-00000003'
        store.plant(`blocks/${kept}/root`, characterBlock('x'))
        store.plant(keptKey(kept), new TextEncoder().encode('{"kept":true}'))
        store.plant(`blocks/${leftover}/root`, characterBlock('x'))
        store.plant(`blocks/${leftover}/c/6162`, characterBlock('ab'))
        store.plant(`blocks/${halfDeleted}/c/6162`, characterBlock('ab'))
        const opsBefore = store.ops.length
        const { owner } = makeOwner(store)
        expect((await owner.load()).kind).toBe('loaded')
        const during = store.ops.slice(opsBefore)
        expect(during.filter((op) => op.kind === 'write' || op.kind === 'delete' || op.kind === 'deleteMany')).toEqual([])
        const inventory = await owner.inventory()
        expect(inventory.kept).toEqual([kept])
        expect([...inventory.leftover].sort()).toEqual([leftover, halfDeleted].sort())
        expect(inventory.generations.find((info) => info.id === live)).toMatchObject({ hasRoot: true, kept: false })
        expect(store.keys('blocks/').length).toBeGreaterThan(10)
    })

    test('with a replace in flight on another owner, the load writes nothing and the replace then commits and loads', async () => {
        const store = createFakeStore({ versioned: true })
        await seedStore(store, SET)
        const interleaver = new Interleaver((waiting) => waiting[waiting.length - 1])
        const loaderCalls: string[] = []
        const loader = makeOwner(createFakeStoreView(store, interleaver.gate(0), loaderCalls))
        const replacer = makeOwner(createFakeStoreView(store, interleaver.gate(1)))
        const replacement = withCharacter(SET, 'carol')
        const [loadResult, replaceResult] = await interleaver.run<{ kind: string }>([() => loader.owner.load(), () => replacer.owner.replaceWholeState(replacement)])
        expect(replaceResult.kind).toBe('won')
        expect(['loaded', 'damaged']).toContain(loadResult.kind)
        expect(loaderCalls.length).toBeGreaterThan(0)
        expect(loaderCalls.filter((call) => /^(write|delete|deleteMany) /.test(call))).toEqual([])
        const fresh = makeOwner(store)
        const after = await fresh.owner.load()
        expect(after.kind).toBe('loaded')
        if (after.kind === 'loaded') {
            expect(after.loaded.directory).toContain('carol')
        }
    })
})

/** The same store state behind a new object whose calls wait at `gate`. */
function createFakeStoreView(base: FakeStore, gate: () => Promise<void>, observed: string[] = []): FakeStore {
    return new Proxy(base, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver)
            if (typeof value !== 'function' || !['read', 'write', 'delete', 'deleteMany', 'list', 'has'].includes(String(property))) {
                return value
            }
            return async (...args: unknown[]) => {
                await gate()
                observed.push(`${String(property)} ${typeof args[0] === 'string' ? args[0] : ''}`)
                return (value as (...inner: unknown[]) => Promise<unknown>).apply(target, args)
            }
        },
    })
}

describe('a boot that races a replace does not report false damage (scenario 12)', () => {
    test('the generation changing between the head read and the value reads starts the load again', async () => {
        const store = createFakeStore({ versioned: true })
        await seedStore(store, SET)
        // Task 0 loads; after its head and root reads, task 1 runs a whole replace and deletes the old generation.
        const interleaver = new Interleaver((waiting, step) => (step < 2 ? 0 : waiting.includes(1) ? 1 : 0))
        const loader = makeOwner(createFakeStoreView(store, interleaver.gate(0)))
        const replacer = makeOwner(createFakeStoreView(store, interleaver.gate(1)))
        const replacement = withCharacter(SET, 'carol')
        const [loadResult, replaceResult] = await interleaver.run<LoadResult | ReplaceResult>([() => loader.owner.load(), () => replacer.owner.replaceWholeState(replacement)])
        expect(replaceResult.kind).toBe('won')
        expect(loadResult.kind).toBe('loaded')
        if (loadResult.kind === 'loaded') {
            expect(loadResult.loaded.directory).toContain('carol')
        }
    })

    test('damage that is real is still reported after the re-read finds nothing changed', async () => {
        const { store, generation } = await seeded(true)
        store.unplant(characterBlockKey(generation, 'alice'))
        const { owner } = makeOwner(store)
        expect((await owner.load()).kind).toBe('damaged')
    })
})

describe('what the pack and the framing helpers expose', () => {
    test('the pack of a loaded generation is readable block by block', async () => {
        const { store, generation } = await seeded(false)
        const pack = readPack(store.peek(stubsKey(generation)) as Uint8Array)
        expect(Array.from(pack.found.keys())).toEqual(['stubby'])
        expect(checkSingleBlock(pack.found.get('stubby') as Uint8Array, 'stubby').status).toBe('ok')
    })

    test('a stub whose payload checksum fails is reported corrupt and the other stubs of the pack still read', () => {
        const good = characterBlock('one')
        const bad = breakDataChecksumOf(characterBlock('two'))
        const pack = readPack(new Uint8Array([...good, ...bad, ...characterBlock('three')]))
        expect(Array.from(pack.found.keys())).toEqual(['one', 'three'])
        expect(Array.from(pack.corrupt)).toEqual(['two'])
        expect(pack.broken).toBe(false)
    })
})

function breakDataChecksumOf(block: Uint8Array): Uint8Array {
    const copy = block.slice()
    copy[copy.length - 1] ^= 0xff
    return copy
}

// ---------------------------------------------------------------------------
// The pre-install validation hook
// ---------------------------------------------------------------------------

interface DecodedTree {
    names: string[]
}

/** A hook that decodes every character block's payload as JSON: a block with a valid frame and checksum but invalid JSON is damage. */
function jsonValidator(calls: LoadedBlocks[] = []) {
    return async (loaded: LoadedBlocks): Promise<DecodedTree | DamagedItem[]> => {
        calls.push(loaded)
        const damage: DamagedItem[] = []
        for (const name of loaded.directory) {
            if (isFixedBlockName(name)) {
                continue
            }
            const block = loaded.blocks.get(name) as Uint8Array
            try {
                JSON.parse(new TextDecoder().decode(parseFramedBlock(block, 0).payload))
            } catch {
                damage.push({ part: loaded.packed.includes(name) ? 'stub' : 'character', name, key: characterBlockKey(loaded.generation, name), kind: 'unreadable-content', detail: 'The content is not valid JSON.' })
            }
        }
        return damage.length > 0 ? damage : { names: Array.from(loaded.directory) }
    }
}

const BAD_CONTENT = makeSet({ characters: [{ chaId: 'alice' }, { chaId: 'bob', data: 'this is not json' }] })
const GOOD_CONTENT = makeSet({ characters: [{ chaId: 'alice' }, { chaId: 'carol' }] })

describe.each([{ versioned: true }, { versioned: false }])('load() with a validation hook, versioned=$versioned', ({ versioned }) => {
    test('hands the loaded blocks to the hook, installs the generation and returns what the hook decoded', async () => {
        const { store, generation } = await seeded(versioned)
        const { owner } = makeOwner(store)
        const calls: LoadedBlocks[] = []
        const result = await owner.load({ validate: jsonValidator(calls) })
        expect(result.kind).toBe('loaded')
        if (result.kind !== 'loaded') {
            return
        }
        expect(result.tree).toEqual({ names: Array.from(result.loaded.directory) })
        expect(calls).toHaveLength(1)
        expect(calls[0]).toBe(result.loaded)
        expect(owner.isLive()).toBe(true)
        expect(owner.committedState()?.generation).toBe(generation)
    })

    test('damage from the hook is reported as damaged with the hook\'s items, installs nothing and writes nothing', async () => {
        const store = createFakeStore({ versioned })
        const generation = await seedStore(store, BAD_CONTENT)
        const before = store.mutating().length
        const { owner } = makeOwner(store)
        const result = await owner.load({ validate: jsonValidator() })
        expect(result).toMatchObject({ kind: 'damaged', generation })
        if (result.kind !== 'damaged') {
            return
        }
        expect(result.damage.map((item) => ({ name: item.name, kind: item.kind }))).toEqual([{ name: 'bob', kind: 'unreadable-content' }])
        expect(result.directory).toContain('alice')
        expect(result.rootFields).not.toBeNull()
        expect(owner.isLive()).toBe(false)
        expect(store.mutating().length).toBe(before)
        await expect(owner.commitSave(BAD_CONTENT)).rejects.toBeInstanceOf(BlockOwnerStateError)
    })

    test('after damage from the hook a later load is legal, and succeeds once another writer replaced the state', async () => {
        const store = createFakeStore({ versioned })
        const damaged = await seedStore(store, BAD_CONTENT)
        const loser = makeOwner(store)
        expect((await loser.owner.load({ validate: jsonValidator() })).kind).toBe('damaged')
        expect((await loser.owner.load({ validate: jsonValidator() })).kind).toBe('damaged')

        const winner = makeOwner(store)
        const won = await winner.owner.replaceWholeState(GOOD_CONTENT, { keepDamaged: damaged })
        expect(won.kind).toBe('won')

        const again = await loser.owner.load({ validate: jsonValidator() })
        expect(again.kind).toBe('loaded')
        expect(again.kind === 'loaded' && again.loaded.directory).toContain('carol')
        expect(loser.owner.isLive()).toBe(true)
    })

    test('a hook that throws installs nothing, and a later load is legal', async () => {
        const { store } = await seeded(versioned)
        const { owner } = makeOwner(store)
        await expect(owner.load({ validate: async () => { throw new Error('decoder crashed') } })).rejects.toThrow('decoder crashed')
        expect(owner.isLive()).toBe(false)
        expect((await owner.load()).kind).toBe('loaded')
    })

    test('a hook that returns an empty damage list is a programming error, not a clean load', async () => {
        const { store } = await seeded(versioned)
        const { owner } = makeOwner(store)
        await expect(owner.load({ validate: async () => [] })).rejects.toBeInstanceOf(TypeError)
        expect(owner.isLive()).toBe(false)
    })

    test('a replace on the same owner that lands while the hook runs makes the load fail instead of installing over it', async () => {
        const { store } = await seeded(versioned)
        const { owner } = makeOwner(store)
        let replaced: ReplaceResult | null = null
        await expect(owner.load({
            validate: async (loaded) => {
                replaced = await owner.replaceWholeState(GOOD_CONTENT)
                return { names: Array.from(loaded.directory) }
            },
        })).rejects.toBeInstanceOf(BlockOwnerStateError)
        expect(replaced).toMatchObject({ kind: 'won' })
        expect(owner.committedState()?.generation).toBe((replaced as unknown as { generation: string }).generation)
    })

    test('the hook is not consulted when there is no head or the stored state is damaged already', async () => {
        const empty = createFakeStore({ versioned })
        const calls: LoadedBlocks[] = []
        expect(await makeOwner(empty).owner.load({ validate: jsonValidator(calls) })).toEqual({ kind: 'no-head' })
        const { store, generation } = await seeded(versioned)
        store.unplant(characterBlockKey(generation, 'alice'))
        expect((await makeOwner(store).owner.load({ validate: jsonValidator(calls) })).kind).toBe('damaged')
        expect(calls).toEqual([])
    })
})

describe.each([{ versioned: true }, { versioned: false }])('readCommitted() with a validation hook, versioned=$versioned', ({ versioned }) => {
    test('returns the decoded tree and changes nothing about the owner', async () => {
        const { store } = await seeded(versioned)
        const { owner } = makeOwner(store)
        await owner.load()
        const before = owner.committedState()
        const result = await owner.readCommitted({ validate: jsonValidator() })
        expect(result.kind === 'loaded' && result.tree).toEqual({ names: expect.any(Array) })
        expect(owner.committedState()?.generation).toBe(before?.generation)
        expect(owner.committedState()?.seq).toBe(before?.seq)
    })

    test('reports the hook\'s damage as damaged, on an owner that is live and on one that never loaded', async () => {
        const store = createFakeStore({ versioned })
        const generation = await seedStore(store, BAD_CONTENT)
        const idle = makeOwner(store)
        const idleResult = await idle.owner.readCommitted({ validate: jsonValidator() })
        expect(idleResult).toMatchObject({ kind: 'damaged', generation })
        expect(idle.owner.isLive()).toBe(false)

        const live = makeOwner(store)
        await live.owner.load()
        expect(live.owner.isLive()).toBe(true)
        const liveResult = await live.owner.readCommitted({ validate: jsonValidator() })
        expect(liveResult.kind).toBe('damaged')
        expect(live.owner.isLive()).toBe(true)
    })

    test('without a hook it still returns the loaded blocks only', async () => {
        const { store } = await seeded(versioned)
        const result = await makeOwner(store).owner.readCommitted()
        expect(result.kind).toBe('loaded')
        expect(result).not.toHaveProperty('tree')
    })
})

