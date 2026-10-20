// @vitest-environment node
import { describe, expect, test } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { matchColdStorageLoadErrorKey } from 'src/ts/process/coldstorageData'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import {
    assembleDatabase, CodecAssembleError, checkUnit, unitMapSource, type EncodedTree,
} from 'src/ts/storage/store2/codec'
import { FRAME_HEADER_BYTES, keyOfRef, UNIT_TYPE, type Shard, type ShardEntry } from 'src/ts/storage/store2/format'
import { createLeafFallback } from 'src/ts/storage/store2/leafFallback'
import { readTreeBytes, type FlaggedLeaf, type TreeBytesRead } from 'src/ts/storage/store2/treeBytes'
import { createClock, seedTree, testEnv } from '../store2SaveKit'
import { chat, dbWithCharacters, fakeLists, loreEntry, message, mulberry32, prosePool, sparseCharacter, type Obj } from './codecFixtures'

/**
 * The leaf fallback (`store2/leafFallback.ts`): the assembly of an entity whose tree has damaged or missing leaves is the
 * normal assembly with each damaged unit's contribution replaced by that unit's empty value. Every case below is an
 * instance of that rule. The expected value is computed by `expected*` below from the intact assembly by field, never by
 * calling the override. Labels: new behaviour.
 */

const NOW = 1_800_000_000_000
/** About 60 KB a message: two fit in one chunk of 128 KiB, a third opens the next, so five messages seal into three chunks. */
const BIG = 60_000
const TAIL_FIELDS = ['lastMemory', 'scriptstate', 'suggestMessages', 'lastDate']
const LORE_KEYS = ['globalLore']
const SCRIPT_KEYS = ['customscript', 'triggerscript']
const A_CHA_ID = 'cha-leaf-a'

function fixtureDb(): Database {
    const rng = mulberry32(5150)
    const pool = prosePool(rng, 20, 100, 400)
    const x = chat(rng, 0, Array.from({ length: 5 }, (_, i) => message(rng, pool, i, BIG)))
    x.id = 'chat-x'
    x.scriptstate = { visits: 3 }
    x.lastMemory = 'remembered'
    x.suggestMessages = ['one', 'two']
    const y = chat(rng, 1, [
        message(rng, pool, 0, 200),
        { role: 'char', data: 'see {{inlay::0123abcd-0123-4123-a123-0123456789ab}}', time: 1 },
    ])
    y.id = 'chat-y'
    const z = chat(rng, 2, [message(rng, pool, 0, 150)])
    z.id = ''
    const a = sparseCharacter(rng, pool, A_CHA_ID, 'Leaf A', [x, y, z], [loreEntry(rng, pool, 0, 300)])
    a.customscript = [{ comment: 'script', in: 'a', out: 'b', type: 'editinput', flag: '' }]
    a.creatorNotes = 'a long description '.repeat(400)
    a.lastInteraction = 1_700_000_000_500
    a.trashTime = 1_700_000_000_900
    a.chatPage = 1
    a.firstMsgIndex = 2
    const sibling = sparseCharacter(rng, pool, 'cha-leaf-group', 'Leaf Group', [chat(rng, 3, [message(rng, pool, 0, 120)])], [])
    sibling.type = 'group'
    sibling.characters = [A_CHA_ID]
    return dbWithCharacters([a, sibling])
}

interface World {
    memory: MemoryBackend
    tree: EncodedTree
    manifestKey: string
    /** The entries of the intact tree, by chaId. */
    entries: Map<string, ShardEntry>
    /** The intact assembly, characters as plain objects. */
    intact: Obj[]
    keys: Keys
}

interface Keys {
    core: string
    lore: string
    scripts: string
    al: string
    il: string
    xCore: string
    xChunks: string[]
    yCore: string
    zCore: string
}

async function buildWorld(): Promise<World> {
    const memory = createMemoryBackend()
    const seeded = await seedTree(memory, JSON.parse(JSON.stringify(fixtureDb())) as Database, testEnv(createClock(), 4242), fakeLists)
    const source = unitMapSource(seeded.tree.units)
    const entries = new Map<string, ShardEntry>()
    for (const ref of seeded.tree.manifest.shards) {
        const checked = checkUnit(source, ref, UNIT_TYPE.shard)
        if (checked.status !== 'ok') {
            throw new Error('A shard of the intact tree does not check.')
        }
        for (const entry of (checked.body as Shard).entries) {
            entries.set(entry.chaId, entry)
        }
    }
    const a = entries.get(A_CHA_ID) as ShardEntry
    const keys: Keys = {
        core: keyOfRef(a.core),
        lore: keyOfRef(a.lore as NonNullable<ShardEntry['lore']>),
        scripts: keyOfRef(a.scripts as NonNullable<ShardEntry['scripts']>),
        al: keyOfRef(a.al),
        il: keyOfRef(a.il as NonNullable<ShardEntry['il']>),
        xCore: keyOfRef(a.chats[0].core),
        xChunks: a.chats[0].chunks.map(keyOfRef),
        yCore: keyOfRef(a.chats[1].core),
        zCore: keyOfRef(a.chats[2].core),
    }
    const intact = (assembleDatabase(seeded.tree.manifest, source) as unknown as { characters: Obj[] }).characters
    return { memory, tree: seeded.tree, manifestKey: seeded.manifestKey, entries, intact, keys }
}

function flipPayload(bytes: Uint8Array): Uint8Array {
    const out = new Uint8Array(bytes)
    out[FRAME_HEADER_BYTES + 1] ^= 0xff
    return out
}

type Damage = 'flip' | 'missing'

function damage(world: World, keys: readonly string[], how: Damage): void {
    for (const key of keys) {
        const bytes = world.memory.snapshot().get(key)
        if (bytes === undefined) {
            throw new Error(`No unit ${key}.`)
        }
        world.memory.poke(key, how === 'flip' ? flipPayload(bytes) : null)
    }
}

type OkRead = Extract<TreeBytesRead, { status: 'ok' }>

async function readOk(world: World): Promise<OkRead> {
    const read = await readTreeBytes(world.memory, world.manifestKey)
    if (read.status !== 'ok') {
        throw new Error(`The tree read ${read.status}.`)
    }
    return read
}

function loadError(key: string): Obj {
    return { time: NOW, data: `[Cold storage data could not be loaded. Key: ${key}]`, role: 'char' }
}

/** The chat the table gives for `damaged`, from the intact chat and the entry's chunk counts. */
function expectedChat(intact: Obj, entry: ShardEntry['chats'][number], damaged: ReadonlySet<string>): Obj {
    const messages = intact.message as Obj[]
    const coreKey = keyOfRef(entry.core)
    const tailKey = keyOfRef(entry.chunks[entry.chunks.length - 1])
    const message: Obj[] = []
    let at = 0
    for (const ref of entry.chunks) {
        const slice = messages.slice(at, at + ref[3])
        at += ref[3]
        message.push(...(damaged.has(keyOfRef(ref)) ? [loadError(keyOfRef(ref))] : slice))
    }
    const fields: Obj = {}
    for (const [name, value] of Object.entries(intact)) {
        if (name === 'message') {
            continue
        }
        const tail = TAIL_FIELDS.includes(name)
        if ((tail && damaged.has(tailKey)) || (!tail && damaged.has(coreKey))) {
            continue
        }
        fields[name] = value
    }
    if (damaged.has(coreKey)) {
        message.unshift(loadError(coreKey))
        if (!entry.cid.startsWith('~')) {
            fields.id = entry.cid
        }
    }
    return { ...fields, message }
}

/** The character the table gives for `damaged`. */
function expectedCharacter(intact: Obj, entry: ShardEntry, damaged: ReadonlySet<string>): Obj {
    const out: Obj = {}
    const coreDamaged = damaged.has(keyOfRef(entry.core))
    const loreDamaged = entry.lore !== null && damaged.has(keyOfRef(entry.lore))
    const scriptsDamaged = entry.scripts !== null && damaged.has(keyOfRef(entry.scripts))
    if (coreDamaged) {
        out.type = entry.type
        out.name = entry.name
        if (entry.image !== undefined) {
            out.image = entry.image
        }
        out.chaId = entry.chaId
        if (entry.characters !== undefined) {
            out.characters = entry.characters
        }
        if (entry.tags !== undefined) {
            out.tags = entry.tags
        }
        if (entry.creator !== undefined) {
            out.creator = entry.creator
        }
        out.creatorNotes = entry.creatorNotes
        if (entry.lastInteraction !== undefined) {
            out.lastInteraction = entry.lastInteraction
        }
        if (entry.trashTime !== undefined) {
            out.trashTime = entry.trashTime
        }
        out.chatPage = entry.chatPage
        out.firstMsgIndex = entry.firstMsgIndex
    }
    for (const [name, value] of Object.entries(intact)) {
        if (name === 'chats') {
            continue
        }
        const lore = LORE_KEYS.includes(name)
        const script = SCRIPT_KEYS.includes(name)
        if ((lore && loreDamaged) || (script && scriptsDamaged)) {
            continue
        }
        if (lore || script || !coreDamaged) {
            out[name] = value
        }
    }
    out.chats = (intact.chats as Obj[]).map((one, index) => expectedChat(one, entry.chats[index], damaged))
    return out
}

async function assembled(flagged: readonly FlaggedLeaf[], read: OkRead): Promise<{ characters: Obj[], items: ReturnType<ReturnType<typeof createLeafFallback>['items']> }> {
    const fallback = createLeafFallback(flagged, () => NOW)
    const database = assembleDatabase(read.tree.manifest, read.tree.source, { character: fallback.character }) as unknown as { characters: Obj[] }
    return { characters: database.characters, items: fallback.items() }
}

const INSTANCES: [label: string, pick: (keys: Keys) => string[]][] = [
    ['character core', k => [k.core]],
    ['lore', k => [k.lore]],
    ['scripts', k => [k.scripts]],
    ['asset list', k => [k.al]],
    ['inlay list', k => [k.il]],
    ['chat X core', k => [k.xCore]],
    ['chat X first chunk', k => [k.xChunks[0]]],
    ['chat X middle chunk', k => [k.xChunks[1]]],
    ['chat X tail chunk', k => [k.xChunks[2]]],
    ['chat X core and middle chunk', k => [k.xCore, k.xChunks[1]]],
    ['chat X first and tail chunks', k => [k.xChunks[0], k.xChunks[2]]],
    ['character core and lore', k => [k.core, k.lore]],
    ['chat X middle chunk and chat Y core', k => [k.xChunks[1], k.yCore]],
    ['chat Y core (stable id)', k => [k.yCore]],
    ['chat Z core (positional handle)', k => [k.zCore]],
]

describe('the fixture', () => {
    test('chat X seals into three chunks with its per-send state on the tail, chat Z has a positional handle, the group sibling is a group', async () => {
        const world = await buildWorld()
        const a = world.entries.get(A_CHA_ID) as ShardEntry
        expect(a.chats.map(entry => entry.cid)).toEqual(['chat-x', 'chat-y', '~2'])
        expect(a.chats[0].chunks).toHaveLength(3)
        expect(a.lore).not.toBeNull()
        expect(a.scripts).not.toBeNull()
        expect(a.il).not.toBeNull()
        expect(world.entries.get('cha-leaf-group')?.type).toBe('group')
        expect(world.intact[0].chats).toHaveLength(3)
    })
})

describe.each<[Damage]>([['flip'], ['missing']])('new behaviour: the fallback table, damage by %s', (how) => {
    test.each(INSTANCES)('%s', async (_label, pick) => {
        const world = await buildWorld()
        const damagedKeys = pick(world.keys)
        damage(world, damagedKeys, how)
        const read = await readOk(world)
        expect(read.flagged.map(leaf => leaf.key).sort()).toEqual([...damagedKeys].sort())

        const result = await assembled(read.flagged, read)

        const a = world.entries.get(A_CHA_ID) as ShardEntry
        const sibling = world.entries.get('cha-leaf-group') as ShardEntry
        expect(result.characters[0]).toEqual(expectedCharacter(world.intact[0], a, new Set(damagedKeys)))
        // The group sibling holds no damaged unit: it is what normal assembly gives.
        expect(result.characters[1]).toEqual(world.intact[1])
        expect(sibling.chaId).toBe('cha-leaf-group')

        // The prompt names the character, and the chat for a chat unit.
        expect(result.items.map(item => item.key).sort()).toEqual([...damagedKeys].sort())
        for (const item of result.items) {
            expect(item.name).toBe('Leaf A')
            expect(item.chaId).toBe(A_CHA_ID)
            expect(item.why).toBe(how === 'flip' ? 'damaged' : 'missing')
            if (item.kind === 'chat') {
                const owner = a.chats.find(entry => [keyOfRef(entry.core), ...entry.chunks.map(keyOfRef)].includes(item.key))
                expect(item.chatId).toBe(owner?.cid)
            }
        }
    })
})

describe('new behaviour: what the table says about positions, state and ids', () => {
    test('a damaged middle chunk becomes one load-error message in its position; both neighbours are byte-equal to the intact load', async () => {
        const world = await buildWorld()
        damage(world, [world.keys.xChunks[1]], 'flip')
        const read = await readOk(world)
        const chats = (await assembled(read.flagged, read)).characters[0].chats as Obj[]
        const intact = (world.intact[0].chats as Obj[])[0].message as Obj[]
        const message = chats[0].message as Obj[]
        const counts = (world.entries.get(A_CHA_ID) as ShardEntry).chats[0].chunks.map(ref => ref[3])
        expect(counts).toEqual([2, 2, 1])
        expect(message).toHaveLength(counts[0] + 1 + counts[2])
        expect(message.slice(0, counts[0])).toEqual(intact.slice(0, counts[0]))
        expect(message[counts[0]]).toEqual(loadError(world.keys.xChunks[1]))
        expect(message.slice(counts[0] + 1)).toEqual(intact.slice(counts[0] + counts[1]))
        expect(chats[0].scriptstate).toEqual({ visits: 3 })
    })

    test('a damaged tail chunk takes the per-send state with it: the chat has none of it, and its other fields stay', async () => {
        const world = await buildWorld()
        damage(world, [world.keys.xChunks[2]], 'flip')
        const read = await readOk(world)
        const chat = ((await assembled(read.flagged, read)).characters[0].chats as Obj[])[0]
        for (const name of TAIL_FIELDS) {
            expect(chat, name).not.toHaveProperty(name)
        }
        expect(chat.id).toBe('chat-x')
        expect(chat.name).toBe('Chat 1')
        expect((chat.message as Obj[]).at(-1)).toEqual(loadError(world.keys.xChunks[2]))
    })

    test('a damaged chat core keeps every chunk and the tail state, puts one load-error message first and keeps a stable id', async () => {
        const world = await buildWorld()
        damage(world, [world.keys.xCore], 'flip')
        const read = await readOk(world)
        const chat = ((await assembled(read.flagged, read)).characters[0].chats as Obj[])[0]
        const intact = (world.intact[0].chats as Obj[])[0]
        expect((chat.message as Obj[])[0]).toEqual(loadError(world.keys.xCore))
        expect((chat.message as Obj[]).slice(1)).toEqual(intact.message)
        expect(chat.scriptstate).toEqual({ visits: 3 })
        expect(chat.lastMemory).toBe('remembered')
        expect(chat.id).toBe('chat-x')
        expect(chat).not.toHaveProperty('name')
        expect(chat).not.toHaveProperty('note')
    })

    test('a positional handle is never a chat id: the replaced core carries no id, and the intact load of that chat is unchanged', async () => {
        const world = await buildWorld()
        damage(world, [world.keys.zCore], 'flip')
        const read = await readOk(world)
        const chats = (await assembled(read.flagged, read)).characters[0].chats as Obj[]
        expect(chats[2]).not.toHaveProperty('id')
        expect(JSON.stringify(chats[2])).not.toContain('~2')
        expect(chats[0]).toEqual((world.intact[0].chats as Obj[])[0])
        expect(chats[1]).toEqual((world.intact[0].chats as Obj[])[1])
    })

    test('a damaged character core keeps the identity and the moved fields the entry holds, in the entry\'s own form, with lore, scripts and all three chats', async () => {
        const world = await buildWorld()
        damage(world, [world.keys.core], 'missing')
        const read = await readOk(world)
        const character = (await assembled(read.flagged, read)).characters[0]
        const entry = world.entries.get(A_CHA_ID) as ShardEntry
        expect(character).toMatchObject({
            type: 'character', name: 'Leaf A', chaId: A_CHA_ID, image: '', trashTime: 1_700_000_000_900, lastInteraction: 1_700_000_000_500,
            chatPage: 1, firstMsgIndex: 2, creatorNotes: entry.creatorNotes, tags: entry.tags, creator: entry.creator,
        })
        expect(String(character.creatorNotes).length).toBeLessThan(String(world.intact[0].creatorNotes).length)
        expect(character.globalLore).toEqual(world.intact[0].globalLore)
        expect(character.customscript).toEqual(world.intact[0].customscript)
        expect(character.chats).toEqual(world.intact[0].chats)
        expect(character).not.toHaveProperty('desc')
    })

    test('a damaged asset or inlay list changes nothing in the loaded character', async () => {
        for (const pick of [(k: Keys) => k.al, (k: Keys) => k.il]) {
            const world = await buildWorld()
            damage(world, [pick(world.keys)], 'flip')
            const read = await readOk(world)
            expect((await assembled(read.flagged, read)).characters).toEqual(world.intact)
        }
    })
})

describe('new behaviour: the flags drive the fallback and nothing else does', () => {
    test('a unit that fails the check but is not flagged still throws CodecAssembleError, for a lore bag and for a chat chunk', async () => {
        for (const pick of [(k: Keys) => k.lore, (k: Keys) => k.xChunks[1]]) {
            const world = await buildWorld()
            damage(world, [pick(world.keys)], 'flip')
            const read = await readOk(world)
            const fallback = createLeafFallback([], () => NOW)
            expect(() => assembleDatabase(read.tree.manifest, read.tree.source, { character: fallback.character })).toThrow(CodecAssembleError)
        }
    })

    test('a flag on one unit does not excuse another damaged unit', async () => {
        const world = await buildWorld()
        damage(world, [world.keys.xChunks[1], world.keys.yCore], 'flip')
        const read = await readOk(world)
        const onlyChunk = read.flagged.filter(leaf => leaf.key === world.keys.xChunks[1])
        expect(onlyChunk).toHaveLength(1)
        const fallback = createLeafFallback(onlyChunk, () => NOW)
        expect(() => assembleDatabase(read.tree.manifest, read.tree.source, { character: fallback.character })).toThrow(CodecAssembleError)
    })

    test('the load-error text is the legacy cold-storage text of the damaged unit key, and a message carries the injected time', async () => {
        const world = await buildWorld()
        damage(world, [world.keys.xChunks[0]], 'flip')
        const read = await readOk(world)
        const chats = (await assembled(read.flagged, read)).characters[0].chats as Obj[]
        const first = (chats[0].message as Obj[])[0]
        expect(first.data).toBe(`[Cold storage data could not be loaded. Key: ${world.keys.xChunks[0]}]`)
        expect(matchColdStorageLoadErrorKey(first.data)).toBe(world.keys.xChunks[0])
        expect(first).toEqual({ time: NOW, data: first.data, role: 'char' })
    })
})
