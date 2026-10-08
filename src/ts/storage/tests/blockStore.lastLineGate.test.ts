// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { crc32, frameBlock } from 'src/ts/storage/blockFrame'
import { HEAD_KEY } from 'src/ts/storage/blockKeys'
import { BlockSetInvalidError, type BlockSetInput } from 'src/ts/storage/blockStore'
import {
    characterBlock,
    createFakeStore,
    makeOwner,
    makeSet,
    seedStore,
    withBlock,
    type FakeStore,
} from './blockStoreHarness'

const enc = new TextEncoder()

const FIXED = { preset: '[]', modules: '[]', loadouts: '[]', plugins: '[]' }

function base(): BlockSetInput {
    return makeSet({ characters: [{ chaId: 'alice' }, { chaId: 'bob' }, { chaId: 'stubby' }], packed: ['stubby'], fixed: FIXED })
}

/** A copy of `bytes` whose compression flag is set, with the header checksum made valid again. */
function flaggedCompressed(bytes: Uint8Array): Uint8Array {
    const out = bytes.slice()
    out[1] = 1
    const headerEnd = 3 + out[2] + 4
    new DataView(out.buffer).setUint32(headerEnd, crc32(out.subarray(0, headerEnd)), true)
    return out
}

const BAD: Array<[string, string, (set: BlockSetInput) => BlockSetInput]> = [
    ['a header checksum that does not match', 'alice', (set) => {
        const bytes = set.layout.blocks[set.layout.keys.indexOf('alice')].slice()
        bytes[3 + bytes[2] + 4] ^= 0xff
        return withBlock(set, 'alice', bytes)
    }],
    ['a length that claims more bytes than the value holds', 'alice', (set) => {
        const bytes = set.layout.blocks[set.layout.keys.indexOf('alice')].slice()
        const lengthAt = 3 + bytes[2]
        new DataView(bytes.buffer).setUint32(lengthAt, 1_000_000, true)
        new DataView(bytes.buffer).setUint32(lengthAt + 4, crc32(bytes.subarray(0, lengthAt + 4)), true)
        return withBlock(set, 'alice', bytes)
    }],
    ['two blocks in one value', 'alice', (set) => {
        const first = characterBlock('alice')
        const second = characterBlock('bob')
        const both = new Uint8Array(first.length + second.length)
        both.set(first, 0)
        both.set(second, first.length)
        return withBlock(set, 'alice', both)
    }],
    ['a header name that is not the directory name', 'alice', (set) => withBlock(set, 'alice', characterBlock('other'))],
    ['a fixed block with the wrong type byte', 'preset', (set) => withBlock(set, 'preset', frameBlock(5, 'preset', enc.encode('[]')))],
    ['a stub-pack member named differently', 'stubby', (set) => withBlock(set, 'stubby', characterBlock('x'))],
    ['an empty character payload', 'alice', (set) => withBlock(set, 'alice', frameBlock(2, 'alice', new Uint8Array(0)))],
    ['an empty modules payload', 'modules', (set) => withBlock(set, 'modules', frameBlock(5, 'modules', new Uint8Array(0)))],
    ['a root that is not a JSON object', 'root', (set) => withBlock(set, 'root', frameBlock(1, 'root', enc.encode('[]')))],
    ['a character payload that is not an object', 'alice', (set) => withBlock(set, 'alice', characterBlock('alice', '5'))],
    ['a preset payload that is not a list', 'preset', (set) => withBlock(set, 'preset', frameBlock(4, 'preset', enc.encode('{"a":1}')))],
    ['a loadouts payload that is not a list', 'loadouts', (set) => withBlock(set, 'loadouts', frameBlock(10, 'loadouts', enc.encode('5')))],
]

async function booted() {
    const store = createFakeStore({ versioned: false })
    const generation = await seedStore(store, base())
    const bundle = makeOwner(store)
    const loaded = await bundle.owner.load()
    if (loaded.kind !== 'loaded') {
        throw new Error('seeded store did not load')
    }
    return { store, generation, ...bundle }
}

function valuesOf(store: FakeStore): Map<string, Uint8Array> {
    return store.snapshotValues()
}

function sameValues(a: Map<string, Uint8Array>, b: Map<string, Uint8Array>): boolean {
    if (a.size !== b.size) {
        return false
    }
    for (const [key, bytes] of a) {
        const other = b.get(key)
        if (other === undefined || !Buffer.from(other).equals(Buffer.from(bytes))) {
            return false
        }
    }
    return true
}

describe('commitSave refuses a block that cannot load, before the first write (regression: S12)', () => {
    test.each(BAD)('%s', async (_label, name, damage) => {
        const { store, owner } = await booted()
        const before = valuesOf(store)
        const mutationsBefore = store.mutating().length
        await expect(owner.commitSave(damage(base()))).rejects.toThrow(BlockSetInvalidError)
        expect(store.mutating().length).toBe(mutationsBefore)
        expect(sameValues(valuesOf(store), before)).toBe(true)
        void name
    })

    test('the refusal names the block', async () => {
        const { owner } = await booted()
        await expect(owner.commitSave(BAD[3][2](base()))).rejects.toThrow(/alice/)
    })
})

describe('replaceWholeState refuses the same blocks and keeps the previous generation (regression: S12)', () => {
    test.each(BAD)('%s', async (_label, name, damage) => {
        const store = createFakeStore({ versioned: false })
        await seedStore(store, base())
        const before = valuesOf(store)
        const { owner } = makeOwner(store)
        await expect(owner.replaceWholeState(damage(base()))).rejects.toThrow(BlockSetInvalidError)
        expect(sameValues(valuesOf(store), before)).toBe(true)
        expect(store.peek(HEAD_KEY)).not.toBeNull()
        void name
    })
})

describe('what the gate lets through (guards, pass before and after)', () => {
    test('a well-formed set commits and replaces', async () => {
        const { owner } = await booted()
        const changed = withBlock(base(), 'alice', characterBlock('alice', '{"chaId":"alice","n":1}'))
        expect((await owner.commitSave(changed)).kind).toBe('committed')
        const store = createFakeStore({ versioned: false })
        const replaced = await makeOwner(store).owner.replaceWholeState(base(), { requireAbsentHead: true })
        expect(replaced.kind).toBe('won')
    })

    test('an empty plugin storage payload is allowed', async () => {
        const { owner } = await booted()
        const changed = withBlock(base(), 'pluginStorage', frameBlock(11, 'pluginStorage', new Uint8Array(0)))
        expect((await owner.commitSave(changed)).kind).toBe('committed')
    })

    test('a compressed block is not held to the first-byte rule', async () => {
        const { owner } = await booted()
        const set = base()
        const compressed = flaggedCompressed(characterBlock('alice', 'not json at all'))
        expect((await owner.commitSave(withBlock(set, 'alice', compressed))).kind).toBe('committed')
    })
})
