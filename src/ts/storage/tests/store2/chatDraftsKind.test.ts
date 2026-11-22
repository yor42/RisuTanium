// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import { Sha256 } from 'src/ts/assetHash'
import type { JsonObject } from '../../blockFrame'
import type { Database } from '../../database.svelte'
import { createMemoryBackend, type Store2Backend } from '../../store2/backend'
import {
    assembleDatabase, CodecInputError, planScopedEncode, previousFrom, unitsToWrite,
    type EncodedTree, type EncodeOptions, type EncodeScope, type PreviousEncoding, type ScopedPlan,
} from '../../store2/codec'
import { createKeyMint } from '../../store2/commit'
import { firstCommitKey } from '../../store2/commitKey'
import {
    encodeUnit, keyOfRef, KNOWN_REQ, parseManifest, parseUnitBody, PARENT_UNIT_TYPES, readUnit, refsOf, refsOfWith, REFS_TABLE,
    UNIT_TYPE, UNITS_WITHOUT_REFS, type Manifest,
} from '../../store2/format'
import { markLiveKeys } from '../../store2/gc/mark'
import { PATH_TYPES, unmappedRefPaths } from '../../store2/recoveryPick'
import { tooLargePartOf } from '../../store2/tooLargeLabel'
import { createClock, testEnv } from './commitFixtures'
import { asDatabase, bodyOf, buildSmall, encodeWith, fakeLists, seededEnv, unitOf, type Obj } from './codecFixtures'
import { bytesToHex, GOLDEN_VECTORS, hexToBytes } from './goldenVectors'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

/**
 * Kind 30, the whole set of unsent message edits and long-chat hint flags (#272 S1): one optional unit named by the single
 * Ref `fixed.chatDrafts`, carrying the `chat-drafts` token. Literals (30, 'chat-drafts') are used where a reproducer must fail
 * on a base that has neither. Labels: PIN pins a rule of a format that does not exist before the change (its evidence is
 * the scratch mutant that breaks it), GUARD passes before and after.
 */

const TOKEN = 'chat-drafts'
const TYPE = 30
const NOW = 1_700_000_000_000
/** First 128 bits of SHA-256 over the UTF-8 bytes of BASE_TEXT, computed once with node:crypto (not by code under test). */
const BASE_TEXT = '안녕 😀 café'
const BASE_HASH = 'c82329ae1484ab97b016fe0d3ab4818f'

function draft(m: string, text: string, extra: Obj = {}): Obj {
    return { m, text, bh: BASE_HASH, at: NOW, ...extra }
}

function entry(cha: string, chat: string, drafts?: Obj[], extra: Obj = {}): Obj {
    return { cha, chat, ...(drafts === undefined ? {} : { drafts }), ...extra }
}

const THREE = (): Obj[] => [
    entry('c1', 'k1', [draft('id:m1', 'one'), draft('idx:2', 'two')]),
    entry('c1', 'k2', [draft('id:m9', 'nine')], { shown: true }),
    entry('c2', 'k3', undefined, { shown: true }),
]

function withDrafts(list: unknown, characters = 2): Database {
    return asDatabase({ ...buildSmall(characters) as unknown as Obj, chatDrafts: list })
}

function assemble(tree: EncodedTree, ...earlier: EncodedTree[]): Database {
    const bytes = new Map<string, Uint8Array>()
    for (const one of [...earlier, tree]) {
        for (const unit of one.units) {
            if (unit.reused === false) {
                bytes.set(unit.key, unit.bytes)
            }
        }
    }
    return assembleDatabase(tree.manifest, { get: key => bytes.get(key) })
}

const draftsOf = (db: Database | Obj): Obj[] => (db as unknown as { chatDrafts: Obj[] }).chatDrafts

describe('T1.1-T1.3 kind 30: encode, assemble and reuse', () => {
    test('PIN: the set is one type 30 unit named by the single Ref fixed.chatDrafts, not a config field, with the token', () => {
        const tree = encodeWith(withDrafts(THREE()))
        const config = bodyOf(unitOf(tree, 'config')).f as JsonObject
        expect(config.chatDrafts).toBeUndefined()
        const named = (tree.manifest.fixed as unknown as { chatDrafts?: unknown[] }).chatDrafts
        expect(named).toHaveLength(3)
        expect(keyOfRef(named as unknown as [string, number, number])).toBe(unitOf(tree, 'chatDrafts').key)
        expect(unitOf(tree, 'chatDrafts').type).toBe(TYPE)
        expect(tree.units.filter(unit => unit.type === TYPE)).toHaveLength(1)
        expect(tree.manifest.req).toEqual([TOKEN])
        expect(bodyOf(unitOf(tree, 'chatDrafts'))).toEqual({ v: 1, chats: THREE() })
    })

    test('PIN: the round trip deep-equals, unknown entry and draft fields stay, duplicate keys pass through, nothing is capped or reordered', () => {
        const duplicated = [
            entry('z', 'k1', [draft('id:m1', 'a')]),
            entry('z', 'k1', [draft('id:m1', 'b', { futureDraft: { n: [1] } })], { futureEntry: 'kept', shown: true }),
            entry('a', 'k0', [draft('id:m5', 'first by key, last by position')]),
        ]
        expect(draftsOf(assemble(encodeWith(withDrafts(duplicated))))).toEqual(duplicated)

        const many = Array.from({ length: 250 }, (_, index) => entry(`c${index}`, 'k', [draft('id:m', `text ${index}`)]))
        expect(draftsOf(assemble(encodeWith(withDrafts(many))))).toEqual(many)
    })

    test('PIN: an unchanged re-encode reuses the unit under its key', () => {
        const first = encodeWith(withDrafts(THREE()))
        const same = encodeWith(assemble(first), { previous: previousFrom(first), seq: 2, env: seededEnv(2) })
        expect(unitOf(same, 'chatDrafts').reused).toBe(true)
        expect(unitOf(same, 'chatDrafts').key).toBe(unitOf(first, 'chatDrafts').key)
    })

    test('PIN (I-3): a one-draft change writes exactly the draft unit and the manifest, no character, chat or config unit', async () => {
        const first = encodeWith(withDrafts(THREE()))
        const changed = assemble(first)
        draftsOf(changed)[0].drafts = [draft('id:m1', 'one, edited'), draft('idx:2', 'two')]
        const plan = await planScopedEncode(
            changed, { env: seededEnv(3), lists: fakeLists, seq: 2, createdAt: NOW, previous: previousFrom(first) },
            { modules: false, characters: new Set<string>() },
        )
        expect([...plan.written.keys()]).toEqual(['chatDrafts'])
        expect(plan.newUnits).toBe(2)
    })
})

describe('T1.4 kind 30: a profile without drafts is what it always was', () => {
    const PRE_272_FIXED = ['config', 'configAl', 'il', 'legacyKeep', 'loadouts', 'moduleIndex', 'order', 'pluginStorage', 'plugins', 'presets', 'statics']

    test('GUARD (I-1, passes before and after): no unit, no field, no token, and the pre-change fixed set', () => {
        const tree = encodeWith(buildSmall(2))
        expect(tree.units.some(unit => unit.identity === 'chatDrafts')).toBe(false)
        expect(Object.keys(tree.manifest.fixed).sort()).toEqual(PRE_272_FIXED)
        expect(tree.manifest.req).toEqual([])
    })

    test('PIN: an empty list is no unit, no field and no token, and leaves the config root as it was', () => {
        const plain = encodeWith(buildSmall(2))
        const empty = encodeWith(withDrafts([]))
        expect(empty.units.some(unit => unit.identity === 'chatDrafts')).toBe(false)
        expect(Object.hasOwn(empty.manifest.fixed, 'chatDrafts')).toBe(false)
        expect(empty.manifest.req).toEqual([])
        expect((bodyOf(unitOf(empty, 'config')).f as JsonObject).chatDrafts).toBeUndefined()
        expect(unitOf(empty, 'config').digest).toBe(unitOf(plain, 'config').digest)
    })
})

describe('T1.5 kind 30: the requirement token', () => {
    test('PIN: the token is known, written with the first entry, and an extra unknown token still reads too-new', () => {
        expect(KNOWN_REQ.has(TOKEN)).toBe(true)
        const tree = encodeWith(withDrafts(THREE()))
        const parsed = parseManifest(JSON.parse(JSON.stringify(tree.manifest)))
        expect(parsed.status).toBe('ok')
        expect(parsed.status === 'ok' && parsed.value.req).toContain(TOKEN)
        const future = JSON.parse(JSON.stringify(tree.manifest)) as Manifest
        future.req = [TOKEN, 'chat-drafts-next']
        expect(parseManifest(future as unknown as JsonObject).status).toBe('too-new')
    })

    test('PIN: the token outlives the set, whether it empties or the field is absent', () => {
        const first = encodeWith(withDrafts(THREE()))
        const emptied = encodeWith(withDrafts([]), { previous: previousFrom(first), seq: 2, env: seededEnv(2) })
        expect(Object.hasOwn(emptied.manifest.fixed, 'chatDrafts')).toBe(false)
        expect(emptied.manifest.req).toEqual([TOKEN])
        const absent = encodeWith(buildSmall(2), { previous: previousFrom(emptied), seq: 3, env: seededEnv(3) })
        expect(absent.manifest.req).toEqual([TOKEN])
        expect(Object.hasOwn(assemble(absent, first), 'chatDrafts')).toBe(false)
    })
})

/** The commit key naming `current`, with `retained` manifests, over `backend`. */
async function publish(backend: Store2Backend, current: string, retained: string[] = []): Promise<ReturnType<Store2Backend['readCommit']>> {
    const key = firstCommitKey({
        current: { key: current, at: 1 }, retained: retained.map(retainedKey => ({ key: retainedKey, at: 1 })), pins: [], staging: null,
    }, testEnv(createClock(), 5))
    await backend.casCommit((await backend.readCommit()).token, encodeUnit(UNIT_TYPE.commit, key))
    return backend.readCommit()
}

async function plant(backend: Store2Backend, tree: EncodedTree): Promise<void> {
    for (const unit of tree.units) {
        if (unit.reused === false) {
            await backend.putUnit(unit.key, unit.bytes)
        }
    }
}

describe('T1.8 kind 30: the production mark', () => {
    test('PIN: the unit is live while the current or a retained manifest names it, and collectable once neither does', async () => {
        const backend = createMemoryBackend()
        const first = encodeWith(withDrafts(THREE()), { env: seededEnv(41) })
        const second = encodeWith(withDrafts([]), { previous: previousFrom(first), seq: 2, env: seededEnv(42) })
        await plant(backend, first)
        await plant(backend, second)
        const key = unitOf(first, 'chatDrafts').key
        expect(Object.hasOwn(second.manifest.fixed, 'chatDrafts')).toBe(false)

        const named = await markLiveKeys(backend, await publish(backend, first.manifestKey))
        expect(named.status === 'marked' && named.live.has(key)).toBe(true)
        const retained = await markLiveKeys(backend, await publish(backend, second.manifestKey, [first.manifestKey]))
        expect(retained.status === 'marked' && retained.live.has(key)).toBe(true)
        const dropped = await markLiveKeys(backend, await publish(backend, second.manifestKey))
        expect(dropped.status).toBe('marked')
        expect(dropped.status === 'marked' && dropped.live.has(key)).toBe(false)
    })
})

describe('T1.9 kind 30: the tables', () => {
    test('PIN: the manifest row, the recovery path, the leaf role and the walk', () => {
        expect(REFS_TABLE.some(row => row.type === UNIT_TYPE.manifest && row.path === 'fixed.chatDrafts' && row.mode === 'ref')).toBe(true)
        expect(PATH_TYPES['fixed.chatDrafts']).toBe(TYPE)
        expect(unmappedRefPaths()).toEqual([])
        expect(UNITS_WITHOUT_REFS).toContain(TYPE)
        expect(PARENT_UNIT_TYPES.has(TYPE as typeof UNIT_TYPE.chatDrafts)).toBe(false)

        const tree = encodeWith(withDrafts(THREE()))
        const named = refsOf(UNIT_TYPE.manifest, tree.manifest).filter(target => target.path === 'fixed.chatDrafts')
        expect(named.map(target => `store2/${target.tail}`)).toEqual([unitOf(tree, 'chatDrafts').key])
        const without = REFS_TABLE.filter(row => row.path !== 'fixed.chatDrafts')
        expect(refsOfWith(without, UNIT_TYPE.manifest, tree.manifest).some(target => target.path === 'fixed.chatDrafts')).toBe(false)
    })

    test('PIN (T1.15): a refused kind 30 body is the generic part', () => {
        expect(tooLargePartOf(null, TYPE)).toBe('generic')
    })
})

describe('T1.11 golden vectors of kind 30', () => {
    const byId = (id: string) => {
        const found = GOLDEN_VECTORS.find(vector => vector.id === id)
        if (found === undefined) {
            throw new Error(`No golden vector ${id}.`)
        }
        return found
    }

    test('PIN: the body vector keeps every extra field through a parse and a re-encode to the committed bytes', () => {
        const vector = byId('type-30-chat-drafts')
        const read = readUnit(hexToBytes(vector.hex), UNIT_TYPE.chatDrafts)
        expect(read.status).toBe('ok')
        if (read.status !== 'ok') {
            return
        }
        const body = JSON.parse(JSON.stringify(read.value.body)) as { v: number, chats: Obj[] }
        expect(body.chats[0]).toMatchObject({ cha: 'c1', chat: 'k1', shown: true, future: true })
        expect((body.chats[0].drafts as Obj[])[0].future).toEqual({ k: 1 })
        expect((body.chats[0].drafts as Obj[])[0].text).toBe(`${BASE_TEXT} edited`)
        expect(bytesToHex(encodeUnit(UNIT_TYPE.chatDrafts, read.value.body))).toBe(vector.hex)
        expect(refsOf(UNIT_TYPE.chatDrafts, read.value.body)).toEqual([])
    })

    test('PIN: a body version above 1 is too-new, below 1 is damaged', () => {
        expect(parseUnitBody(UNIT_TYPE.chatDrafts, { v: 2, chats: [] }).status).toBe('too-new')
        expect(parseUnitBody(UNIT_TYPE.chatDrafts, { v: 0, chats: [] }).status).toBe('damaged')
    })

    test('PIN: the base hash is the first 128 bits of SHA-256 over the UTF-8 bytes, as 32 lowercase hex digits', () => {
        const vector = byId('type-30-chat-drafts')
        const read = readUnit(hexToBytes(vector.hex), UNIT_TYPE.chatDrafts)
        const chats = read.status === 'ok' ? (JSON.parse(JSON.stringify(read.value.body)) as { chats: { drafts?: Obj[] }[] }).chats : []
        expect(chats[0].drafts?.[0].bh).toBe(BASE_HASH)
        const utf8 = new Sha256().update(new TextEncoder().encode(BASE_TEXT)).digestHex().slice(0, 32)
        expect(utf8).toBe(BASE_HASH)
        const utf16 = new Sha256().update(new Uint8Array(new Uint16Array([...BASE_TEXT].map(char => char.charCodeAt(0))).buffer)).digestHex().slice(0, 32)
        expect(utf16).not.toBe(BASE_HASH)
    })

    test('PIN: the manifest vector names its unit by fixed.chatDrafts and carries the token', () => {
        const read = readUnit(hexToBytes(byId('manifest-chat-drafts').hex), UNIT_TYPE.manifest)
        expect(read.status).toBe('ok')
        if (read.status !== 'ok') {
            return
        }
        const manifest = read.value.body as Manifest
        expect(manifest.req).toEqual([TOKEN])
        expect(keyOfRef(manifest.fixed.chatDrafts ?? ['', 0, 0])).toContain('u-cccc')
        expect(refsOf(UNIT_TYPE.manifest, manifest).filter(target => target.path === 'fixed.chatDrafts')).toHaveLength(1)
    })
})

describe('T1.12 kind 30: a draft fault never fails a pass', () => {
    const SKIP = { skipUnsavableItems: true } as const
    const FULL: EncodeScope = { modules: true, characters: 'all', ...SKIP }

    async function pass(db: Database, previous: PreviousEncoding | null, scope: EncodeScope = FULL, seed = 1): Promise<{ plan: ScopedPlan, tree: EncodedTree }> {
        const options: EncodeOptions = { env: seededEnv(seed), lists: fakeLists, seq: 1 + seed, createdAt: NOW, previous }
        const plan = await planScopedEncode(db, options, scope)
        return { plan, tree: plan.finalize({ mint: createKeyMint(testEnv(createClock(), 100 + seed), null).mint, seq: 1 + seed, now: NOW }) }
    }

    /** A set `toPlainJson` refuses: a bigint is no JSON. */
    const bad = (): Obj[] => [entry('c1', 'k1', [draft('id:m1', 'x', { at: 10n })])]
    const briefOf = (plan: ScopedPlan): { scope: string, key: string, saved: boolean }[] => plan.skippedItems.map(({ scope, key, saved }) => ({ scope, key, saved }))

    /** `db` with a character edited, so the pass has something else to commit next to the draft fault. */
    function editedBeside(list: unknown): Database {
        const db = JSON.parse(JSON.stringify(buildSmall(2))) as Obj
        ;((db.characters as Obj[])[0]).personality = 'edited next to the draft fault'
        db.chatDrafts = list
        return asDatabase(db)
    }

    test('PIN: the held list keeps the last saved set, the pass reports it saved and still commits the character edit', async () => {
        const acknowledged = await pass(withDrafts(THREE()), null, { modules: true, characters: 'all' })
        const second = await pass(editedBeside(bad()), previousFrom(acknowledged.tree), FULL, 2)
        expect(briefOf(second.plan)).toEqual([{ scope: 'chatDrafts', key: 'chatDrafts', saved: true }])
        expect(unitOf(second.tree, 'chatDrafts').key).toBe(unitOf(acknowledged.tree, 'chatDrafts').key)
        expect(second.tree.manifest.fixed.chatDrafts).toEqual(acknowledged.tree.manifest.fixed.chatDrafts)
        expect([...second.plan.written.keys()].some(identity => identity.startsWith('char:'))).toBe(true)
        expect(draftsOf(assemble(second.tree, acknowledged.tree))).toEqual(THREE())
        // The held list survives a second faulty pass over the first pass's tree: the rekey carried it.
        const third = await pass(editedBeside(bad()), previousFrom(second.tree), FULL, 3)
        expect(briefOf(third.plan)).toEqual([{ scope: 'chatDrafts', key: 'chatDrafts', saved: true }])
        expect(unitOf(third.tree, 'chatDrafts').key).toBe(unitOf(acknowledged.tree, 'chatDrafts').key)
    })

    test('PIN: without a held list the previous unit is carried as it is and reported saved', async () => {
        const acknowledged = await pass(withDrafts(THREE()), null, { modules: true, characters: 'all' })
        const bytes = new Map(unitsToWrite(acknowledged.tree).map(unit => [unit.key, unit.bytes]))
        const draftKey = unitOf(acknowledged.tree, 'chatDrafts').key
        // A boot that could not read the unit holds its key and Ref but no body.
        const { previousOfTree } = await import('../../store2/previousOfTree')
        const booted = previousOfTree({
            manifestKey: acknowledged.tree.manifestKey, manifest: acknowledged.tree.manifest,
            source: { get: key => (key === draftKey ? undefined : bytes.get(key)) },
        })
        expect(booted.objects?.chatDrafts).toBeUndefined()
        expect(booted.units.get('chatDrafts')?.key).toBe(draftKey)

        const second = await pass(editedBeside(bad()), booted, FULL, 2)
        expect(briefOf(second.plan)).toEqual([{ scope: 'chatDrafts', key: 'chatDrafts', saved: true }])
        expect(second.tree.manifest.fixed.chatDrafts).toEqual(acknowledged.tree.manifest.fixed.chatDrafts)
        expect(second.tree.index.units.get('chatDrafts')?.key).toBe(draftKey)
        expect(unitsToWrite(second.tree).some(unit => unit.key === draftKey)).toBe(false)
    })

    test('PIN: with nothing ever saved the unit is left out, the item is reported unsaved and the pass goes on', async () => {
        const acknowledged = await pass(buildSmall(2), null, { modules: true, characters: 'all' })
        const second = await pass(editedBeside(bad()), previousFrom(acknowledged.tree), FULL, 2)
        expect(briefOf(second.plan)).toEqual([{ scope: 'chatDrafts', key: 'chatDrafts', saved: false }])
        expect(Object.hasOwn(second.tree.manifest.fixed, 'chatDrafts')).toBe(false)
        expect(second.tree.manifest.req).toEqual([])
        expect([...second.plan.written.keys()].some(identity => identity.startsWith('char:'))).toBe(true)
    })

    test('PIN: an encode that does not skip items throws the fault, as the loadouts do', async () => {
        expect(() => encodeWith(withDrafts(bad()))).toThrow(CodecInputError)
        const acknowledged = await pass(withDrafts(THREE()), null, { modules: true, characters: 'all' })
        await expect(planScopedEncode(
            withDrafts(bad()), { env: seededEnv(9), lists: fakeLists, seq: 9, createdAt: NOW, previous: previousFrom(acknowledged.tree) },
            { modules: true, characters: 'all' },
        )).rejects.toThrow(CodecInputError)
    })

    test('PIN: a value that is not a list is a fault of the data, not an invariant', async () => {
        const acknowledged = await pass(withDrafts(THREE()), null, { modules: true, characters: 'all' })
        const second = await pass(editedBeside('not a list'), previousFrom(acknowledged.tree), FULL, 2)
        expect(briefOf(second.plan)).toEqual([{ scope: 'chatDrafts', key: 'chatDrafts', saved: true }])
    })
})
