// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import type { JsonObject } from '../../blockFrame'
import type { Database } from '../../database.svelte'
import {
    assembleChat, assembleDatabase, planScopedEncode, splitChat, unitsToWrite,
    type EncodedTree, type EncodeOptions, type EncodeScope, type PreviousEncoding,
} from '../../store2/codec'
import { createKeyMint, type BuildContext } from '../../store2/commit'
import { readUnit, UNIT_TYPE, type Manifest, type UnitType } from '../../store2/format'
import { createListDerivation } from '../../store2/lists/derive'
import { previousOfTree } from '../../store2/previousOfTree'
import { asDatabase, bodyOf, dbWithCharacters, encodeWith, mulberry32, prosePool, roundTrip, seededEnv, sparseCharacter, type Obj } from './codecFixtures'
import { createClock, testEnv } from './commitFixtures'

/**
 * `Chat.unseenReply` (the new-reply or error mark of a chat, CHORE-685 S1d) is per-send state: it is written by a send's
 * settle, which already rewrites the last chunk, so it travels in that chunk's `st` and not in the chat core (which can hold
 * large memory data). Labels: "reproducer" fails on the code before the placement, "guard" passes before and after.
 * The frozen fixture holds a store written by the build before the placement (generator in the `.fixture.md`).
 */

const NOW = 1_700_000_000_000

function chat(extra: JsonObject = {}): JsonObject {
    return { id: 'chat-1', name: 'C', note: 'n', localLore: [], hypaV3Data: { big: 1 }, message: [{ role: 'user', data: 'hi', time: 1 }], ...extra }
}

describe('placement of unseenReply in the chat encoding', () => {
    test('reproducer: the mark travels in the last chunk st and not in the chat core', () => {
        const split = splitChat(chat({ unseenReply: 'reply' }), 'chat')
        expect('unseenReply' in split.core.f).toBe(false)
        expect(split.chunks[split.chunks.length - 1].st).toEqual({ unseenReply: 'reply' })
    })

    test('reproducer: with several chunks the mark is in the last chunk only', () => {
        const messages = Array.from({ length: 6 }, (_, i) => ({ role: 'user', data: 'x'.repeat(80_000 + i), time: i }))
        const split = splitChat(chat({ message: messages, unseenReply: 'error' }), 'chat')
        expect(split.chunks.length).toBeGreaterThanOrEqual(3)
        split.chunks.forEach((piece, index) => {
            expect('st' in piece).toBe(index === split.chunks.length - 1)
        })
        expect('unseenReply' in split.core.f).toBe(false)
        expect(split.chunks[split.chunks.length - 1].st?.unseenReply).toBe('error')
    })

    test('guard: the mark round-trips through split and assemble, and a chat without it gains none', () => {
        for (const value of ['reply', 'error', 'a value of a later build']) {
            const source = chat({ unseenReply: value })
            const split = splitChat(source, 'chat')
            expect(assembleChat(split.core, split.chunks, 'chat', split.alt)).toEqual(source)
        }
        const bare = splitChat(chat(), 'chat')
        expect('unseenReply' in assembleChat(bare.core, bare.chunks, 'chat')).toBe(false)
        expect(bare.chunks[bare.chunks.length - 1].st).toBeUndefined()
    })

    test('reproducer: in the encoded tree the mark is in the last chunk unit and the core unit lacks it', () => {
        const rng = mulberry32(5)
        const holder = sparseCharacter(rng, prosePool(rng, 5, 10, 40), 'holder', 'Holder', [{ message: [{ role: 'user', data: 'a', time: 1 }], name: 'a', id: 'a', unseenReply: 'reply' }], [])
        const tree = encodeWith(dbWithCharacters([holder]))
        const core = tree.units.find(unit => unit.identity.endsWith(':a:core'))
        const chunk = tree.units.find(unit => unit.identity.endsWith(':a:chunk:0'))
        if (core === undefined || chunk === undefined) {
            throw new Error('The chat units are missing.')
        }
        expect((bodyOf(core).f as JsonObject).unseenReply).toBeUndefined()
        expect((bodyOf(chunk).st as JsonObject).unseenReply).toBe('reply')
        const { assembled } = roundTrip(dbWithCharacters([holder]))
        expect(assembled.characters[0].chats[0].unseenReply).toBe('reply')
    })
})

describe('MC-350: a store written before the placement reads in place', () => {
    interface FixtureFile {
        generatedBy: string
        manifestKey: string
        markedChaId: string
        markedChatId: string
        cleanChaId: string
        units: { identity: string, key: string, bytes: string }[]
        database: Obj
    }
    const fixture = JSON.parse(readFileSync(new URL('./chatUnseenReplyPreS1d.fixture.json', import.meta.url), 'utf8')) as FixtureFile

    function loaded(): { store: Map<string, Uint8Array>, manifest: Manifest } {
        const store = new Map<string, Uint8Array>()
        for (const unit of fixture.units) {
            store.set(unit.key, new Uint8Array(Buffer.from(unit.bytes, 'base64')))
        }
        const bytes = store.get(fixture.manifestKey)
        const parsed = bytes === undefined ? undefined : readUnit(bytes, UNIT_TYPE.manifest)
        if (parsed === undefined || parsed.status !== 'ok') {
            throw new Error('The fixture manifest does not parse.')
        }
        return { store, manifest: parsed.value.body as Manifest }
    }

    function bodyAt(store: Map<string, Uint8Array>, identity: string, type: UnitType): JsonObject {
        const unit = fixture.units.find(candidate => candidate.identity.endsWith(identity))
        const bytes = unit === undefined ? undefined : store.get(unit.key)
        const parsed = bytes === undefined ? undefined : readUnit(bytes, type)
        if (parsed === undefined || (parsed.status !== 'ok' && parsed.status !== 'stale')) {
            throw new Error(`The fixture unit ${identity} does not parse.`)
        }
        return parsed.value.body as unknown as JsonObject
    }

    let envSeed = 600
    let mintSeed = 8200
    async function pass(database: Database, previous: PreviousEncoding | null, scope: EncodeScope, seq: number): Promise<{ plan: Awaited<ReturnType<typeof planScopedEncode>>, tree: EncodedTree }> {
        const options: EncodeOptions = { env: seededEnv(envSeed++), lists: createListDerivation(), seq, createdAt: NOW, previous }
        const plan = await planScopedEncode(database, options, scope)
        const context: BuildContext = { mint: createKeyMint(testEnv(createClock(), mintSeed++), null).mint, seq, now: NOW }
        return { plan, tree: plan.finalize(context) }
    }

    function bootPrevious(store: Map<string, Uint8Array>, manifest: Manifest): PreviousEncoding {
        return previousOfTree({ manifestKey: fixture.manifestKey, manifest, source: { get: key => store.get(key) } })
    }

    test('guard: the fixture was written by the build before the placement, with the mark in the chat core and none in the chunk', () => {
        const { store } = loaded()
        const core = bodyAt(store, `${fixture.markedChatId}:core`, UNIT_TYPE.chatCore)
        expect((core.f as JsonObject).unseenReply).toBe('reply')
        const chunk = bodyAt(store, `${fixture.markedChatId}:chunk:0`, UNIT_TYPE.chatChunk)
        expect((chunk.st as JsonObject | undefined)?.unseenReply).toBeUndefined()
    })

    test('guard (MC-350 i): a character that has no mark reads in place and the first save pass writes none of its units', async () => {
        const { store, manifest } = loaded()
        const database = asDatabase(JSON.parse(JSON.stringify(fixture.database)) as Obj)
        const settled = await pass(database, bootPrevious(store, manifest), { modules: false, characters: new Set([fixture.cleanChaId]) }, 2)
        expect(settled.plan.unchanged).toBe(true)
        expect(unitsToWrite(settled.tree).filter(unit => unit.identity.startsWith('chat:') || unit.identity.startsWith('char:'))).toEqual([])
    })

    /** Reads the fixture, re-saves the character that holds the mark, and returns what the pass wrote. */
    async function resaveMarked() {
        const { store, manifest } = loaded()
        const before = assembleDatabase(manifest, { get: key => store.get(key) })
        const database = asDatabase(JSON.parse(JSON.stringify(before)) as Obj)
        const resaved = await pass(database, bootPrevious(store, manifest), { modules: false, characters: new Set([fixture.markedChaId]) }, 2)
        const written = unitsToWrite(resaved.tree)
        for (const unit of written) {
            store.set(unit.key, unit.bytes)
        }
        const after = assembleDatabase(resaved.tree.manifest, { get: key => store.get(key) })
        return { before, after, written }
    }

    test('guard (MC-350 ii): a core that holds the key, as the earlier build wrote it, reads with the mark and re-saves without loss', async () => {
        const { before, after } = await resaveMarked()
        const markedBefore = before.characters.find(character => character.chaId === fixture.markedChaId)?.chats.find(candidate => candidate.id === fixture.markedChatId)
        expect(markedBefore?.unseenReply).toBe('reply')
        expect(JSON.parse(JSON.stringify(after.characters))).toEqual(JSON.parse(JSON.stringify(before.characters)))
    })

    test('reproducer (MC-350 ii): the re-save moves the key from the core into the last chunk st, and leaves the other character alone', async () => {
        const { written } = await resaveMarked()
        const core = written.find(unit => unit.identity.endsWith(`:${fixture.markedChatId}:core`))
        const chunk = written.find(unit => unit.identity.endsWith(`:${fixture.markedChatId}:chunk:0`))
        if (core === undefined || chunk === undefined) {
            throw new Error('The marked chat was not re-saved.')
        }
        expect('unseenReply' in (bodyOf(core).f as JsonObject)).toBe(false)
        expect((bodyOf(chunk).st as JsonObject).unseenReply).toBe('reply')
        const cleanChats = (fixture.database.characters as Obj[]).find(character => character.chaId === fixture.cleanChaId)?.chats as Obj[]
        for (const cleanChat of cleanChats) {
            expect(written.filter(unit => unit.identity.includes(`:${String(cleanChat.id)}:`))).toEqual([])
        }
    })
})
