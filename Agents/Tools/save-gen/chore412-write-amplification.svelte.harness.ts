// @vitest-environment node
/**
 * CHORE-412 measurement (diagnostic experiment, not a regression test): the bytes of the units a store2 save pass
 * writes after ONE small edit, against the bytes the edit changed. Everything runs through the real
 * `createSaveEncoder` plan, `commitRequest().build` and `acknowledge`, over an acknowledged encoding made by the real
 * `encodeDatabase`; no backend, no commit. The written units are exactly `builtCommitOf`'s units (reused units are
 * not in it), keyed back to identities through the acknowledged encoding after `acknowledge`.
 *
 * Run (from the repo root; the file is named, never the whole folder):
 *   npx vitest run --config Agents/Tools/vitest.harness.config.ts chore412-write-amplification
 *
 * Output: one JSON line per scenario on stdout, and the same rows plus the profile censuses in the file named by
 * RISU_C412_OUT (default: the OS temp directory). The data is seeded and synthetic; every scenario edits in place and
 * reverts, so one baseline encoding serves a whole tier.
 *
 * Definitions: `changedBytes` is the UTF-8 size of what the edit added or replaced (a whole new message for an append,
 * the inserted text for an in-place edit). `writtenBytes` is the sum of the framed bytes of the written units, the
 * manifest excluded; `manifestJsonBytes` is the manifest body's plain JSON length (an approximation of its framed size).
 */
import { describe, expect, test } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { previousFrom } from 'src/ts/storage/store2/codec'
import type { PreviousEncoding, ReusableUnit } from 'src/ts/storage/store2/codec'
import { createKeyMint } from 'src/ts/storage/store2/commit'
import { createSaveEncoder, type SavePassRequest } from 'src/ts/storage/store2/saveEncoder'
import type { Database } from 'src/ts/storage/database.svelte'
import {
    asDatabase, chat, encodeWith, fakeLists, loreEntry, message, prosePool, seededEnv, sparseCharacter, uuidLike, buildSmall, mulberry32,
    type Obj,
} from 'src/ts/storage/tests/store2/codecFixtures'

const NOW = 1_700_000_000_000
const EDIT_TEXT = ' [edited]'
const OUT = process.env.RISU_C412_OUT ?? path.join(os.tmpdir(), 'chore412-write-amplification.json')

interface Tier {
    name: string
    characters: number
    longChatMessages: number
    modules: number
    moduleBytes: number
}

const TIERS: Tier[] = [
    { name: 'small', characters: 10, longChatMessages: 100, modules: 8, moduleBytes: 7_000 },
    { name: 'medium', characters: 100, longChatMessages: 1_000, modules: 50, moduleBytes: 30_000 },
    { name: 'large', characters: 500, longChatMessages: 5_000, modules: 164, moduleBytes: 30_000 },
]

interface Profile {
    db: Database
    longChat: Obj
    holder: Obj
    modules: Obj[]
}

function utf8(text: string): number {
    return new TextEncoder().encode(text).length
}

function textOfSize(rng: () => number, pool: string[], bytes: number): string {
    const parts: string[] = []
    let length = 0
    while (length < bytes) {
        const piece = pool[Math.floor(rng() * pool.length)]
        parts.push(piece)
        length += piece.length + 1
    }
    return parts.join(' ').slice(0, bytes)
}

/** Character 0 holds the one long chat; the rest hold two small chats each. The global parts come from `buildSmall`. */
function buildProfile(tier: Tier): Profile {
    const rng = mulberry32(412)
    const pool = prosePool(rng, 60, 200, 900)
    const longMessages = Array.from({ length: tier.longChatMessages }, (_, i) => message(rng, pool, i, 200 + Math.floor(rng() * 700), i % 2 === 1 && rng() < 0.15))
    const longChat = chat(rng, 0, longMessages)
    const characters: Obj[] = []
    for (let c = 0; c < tier.characters; c++) {
        const chats = c === 0
            ? [longChat, chat(rng, 1, [message(rng, pool, 0, 200)])]
            : [chat(rng, 0, Array.from({ length: 3 }, (_, m) => message(rng, pool, m, 300))), chat(rng, 1, [message(rng, pool, 0, 100)])]
        characters.push(sparseCharacter(rng, pool, uuidLike(rng), `Tier Character ${c}`, chats, [loreEntry(rng, pool, 0, 300)]))
    }
    const modules: Obj[] = Array.from({ length: tier.modules }, (_, index) => ({
        name: `Module ${index}`,
        description: `module ${index}`,
        id: uuidLike(rng),
        lorebook: Array.from({ length: Math.max(1, Math.floor(tier.moduleBytes / 700)) }, (_, i) => loreEntry(rng, pool, i, 400)),
        regex: [],
        trigger: [],
        assets: [],
        cjs: textOfSize(rng, pool, Math.floor(tier.moduleBytes / 2)),
    }))
    const base = buildSmall(1) as unknown as Obj
    const db = asDatabase({ ...base, characters, characterOrder: characters.map(slot => slot.chaId), modules })
    return { db, longChat, holder: characters[0], modules }
}

interface UnitRow {
    identity: string
    type: number
    bytes: number
}

interface Row {
    tier: string
    scenario: string
    request: string
    changedBytes: number
    writtenUnits: number
    writtenBytes: number
    manifestJsonBytes: number
    reusedUnits: number
    totalUnits: number
    ratio: number | null
    dominant: UnitRow[]
    written: UnitRow[]
}

interface Scenario {
    name: string
    request: SavePassRequest
    /** Applies the edit in place and returns its changed bytes and the revert; absent for a control. */
    apply?: () => { changedBytes: number, revert: () => void }
    /** Replaces the acknowledged encoding before the plan (hydration repair). */
    previousOf?: (previous: PreviousEncoding) => PreviousEncoding
}

function request(extra: Partial<SavePassRequest> = {}): SavePassRequest {
    return { marked: new Set(), modules: false, whole: false, ...extra }
}

function describeRequest(value: SavePassRequest): string {
    return `marked=${value.marked.size} modules=${value.modules} whole=${value.whole}`
}

async function measure(tier: string, scenario: Scenario, db: Database, base: PreviousEncoding): Promise<Row> {
    const edit = scenario.apply?.()
    const encoder = createSaveEncoder({
        previous: scenario.previousOf === undefined ? base : scenario.previousOf(base),
        lists: fakeLists,
        env: seededEnv(77),
        now: () => NOW,
    })
    try {
        const plan = await encoder.plan(db, scenario.request)
        const { mint } = createKeyMint(seededEnv(900), null)
        const built = await plan.commitRequest().build({ mint, seq: 2, now: NOW })
        plan.acknowledge()
        const acknowledged = encoder.acknowledged().units
        const identityOfKey = new Map<string, { identity: string, type: number }>()
        for (const [identity, unit] of acknowledged) {
            identityOfKey.set(unit.key, { identity, type: unit.type })
        }
        const written: UnitRow[] = built.units.map(unit => {
            const named = identityOfKey.get(unit.key)
            return { identity: named?.identity ?? `?${unit.key}`, type: named?.type ?? -1, bytes: unit.bytes.length }
        })
        written.sort((a, b) => b.bytes - a.bytes)
        const writtenBytes = written.reduce((sum, unit) => sum + unit.bytes, 0)
        const changedBytes = edit?.changedBytes ?? 0
        // The manifest is one more written unit; the built list excludes it.
        const writtenUnits = written.length + 1
        return {
            tier,
            scenario: scenario.name,
            request: describeRequest(scenario.request),
            changedBytes,
            writtenUnits,
            writtenBytes,
            manifestJsonBytes: utf8(JSON.stringify(built.manifest.body)),
            reusedUnits: acknowledged.size - writtenUnits,
            totalUnits: acknowledged.size,
            ratio: changedBytes === 0 ? null : Math.round((writtenBytes / changedBytes) * 10) / 10,
            dominant: written.slice(0, 3),
            written: written.length <= 14 ? written : written.slice(0, 14),
        }
    } finally {
        edit?.revert()
    }
}

function messagesOf(chatValue: Obj): Obj[] {
    return chatValue.message as Obj[]
}

function appendText(target: Obj, key: string): { changedBytes: number, revert: () => void } {
    const before = target[key] as string
    target[key] = before + EDIT_TEXT
    return { changedBytes: utf8(EDIT_TEXT), revert: () => { target[key] = before } }
}

function scenariosOf(profile: Profile, tier: Tier): Scenario[] {
    const { db, longChat, holder, modules } = profile
    const holderId = String(holder.chaId)
    const otherSlot = (db.characters[Math.min(1, tier.characters - 1)] as unknown) as Obj
    const otherId = String(otherSlot.chaId)
    const messages = messagesOf(longChat)
    const chatScope = request({ marked: new Set([holderId]) })
    const otherScope = request({ marked: new Set([otherId]) })
    const moduleScope = request({ modules: true })
    const middleModule = modules[Math.floor(modules.length / 2)]
    const rngEdit = mulberry32(9)
    const poolEdit = prosePool(rngEdit, 10, 200, 900)
    return [
        { name: 'control-chat-holder-no-edit', request: chatScope },
        {
            name: 'a1-chat-append-one-message',
            request: chatScope,
            apply: () => {
                const added = message(rngEdit, poolEdit, messages.length, 500)
                const lastDate = longChat.lastDate
                messages.push(added)
                longChat.lastDate = NOW + 1
                return { changedBytes: utf8(JSON.stringify(added)), revert: () => { messages.pop(); longChat.lastDate = lastDate } }
            },
        },
        { name: 'a2-chat-edit-last-message', request: chatScope, apply: () => appendText(messages[messages.length - 1], 'data') },
        { name: 'a3-chat-edit-middle-message', request: chatScope, apply: () => appendText(messages[Math.floor(messages.length / 2)], 'data') },
        { name: 'a4-chat-edit-first-message', request: chatScope, apply: () => appendText(messages[0], 'data') },
        { name: 'b0-control-other-character-no-edit', request: otherScope },
        { name: 'b1-character-desc-edit-small-character', request: otherScope, apply: () => appendText(otherSlot, 'desc') },
        { name: 'b2-character-desc-edit-long-chat-holder', request: chatScope, apply: () => appendText(holder, 'desc') },
        { name: 'c0-control-modules-no-edit', request: moduleScope },
        { name: 'c1-module-description-edit', request: moduleScope, apply: () => appendText(middleModule, 'description') },
        { name: 'c2-module-lorebook-content-edit', request: moduleScope, apply: () => appendText((middleModule.lorebook as Obj[])[0], 'content') },
        { name: 'c3-module-cjs-edit', request: moduleScope, apply: () => appendText(middleModule, 'cjs') },
        {
            name: 'd1-module-hydration-repair-digest-missing',
            request: moduleScope,
            previousOf: (previous) => {
                const handle = [...previous.units.keys()].filter(identity => identity.startsWith('module:'))[Math.floor(modules.length / 2)]
                const units = new Map<string, ReusableUnit>(previous.units)
                const bare = handle.slice('module:'.length)
                for (const [identity, unit] of previous.units) {
                    if (identity === handle || identity === `al:module:${bare}` || identity === `il:module:${bare}`) {
                        units.set(identity, { key: unit.key, type: unit.type, ref: unit.ref })
                    }
                }
                return { ...previous, units }
            },
        },
        { name: 'e1-contrast-rewrite-all-no-edit', request: request({ whole: true, rewriteAll: true }) },
    ]
}

/** The chunk (type 8) units of the chat with the most chunks: their identities and framed sizes, in list order. */
function chunkBytesOfLongest(units: ReadonlyArray<{ identity: string, type: number, reused: boolean, bytes?: Uint8Array }>): Array<[string, number]> {
    const byChat = new Map<string, Array<[string, number]>>()
    for (const unit of units) {
        if (unit.type !== 8 || unit.bytes === undefined) {
            continue
        }
        const chatId = unit.identity.split(':').slice(0, 2).join(':')
        const held = byChat.get(chatId) ?? []
        held.push([unit.identity, unit.bytes.length])
        byChat.set(chatId, held)
    }
    return [...byChat.values()].sort((a, b) => b.length - a.length)[0] ?? []
}

describe('CHORE-412 write amplification', () => {
    test('measures every tier', async () => {
        const rows: Row[] = []
        const census: Array<Record<string, unknown>> = []
        for (const tier of TIERS) {
            const profile = buildProfile(tier)
            const tree = encodeWith(profile.db)
            const base = previousFrom(tree)
            const writtenAll = tree.units.filter(unit => unit.reused === false)
            const byPrefix = new Map<string, { count: number, bytes: number }>()
            for (const unit of writtenAll) {
                const bytes = unit.reused === false ? unit.bytes.length : 0
                const prefix = unit.identity.split(':')[0] + ':' + (unit.identity.startsWith('al:') || unit.identity.startsWith('il:') ? unit.identity.split(':')[1] : '')
                const held = byPrefix.get(prefix) ?? { count: 0, bytes: 0 }
                held.count++
                held.bytes += bytes
                byPrefix.set(prefix, held)
            }
            census.push({
                tier: tier.name,
                characters: tier.characters,
                longChatMessages: tier.longChatMessages,
                modules: tier.modules,
                totalUnits: tree.units.length,
                totalBytes: writtenAll.reduce((sum, unit) => sum + (unit.reused === false ? unit.bytes.length : 0), 0),
                byIdentityClass: Object.fromEntries(byPrefix),
                longChatChunkBytes: chunkBytesOfLongest(tree.units),
                sampleIdentities: tree.units.slice(0, 40).map(unit => unit.identity),
            })
            for (const scenario of scenariosOf(profile, tier)) {
                const row = await measure(tier.name, scenario, profile.db, base)
                rows.push(row)
                console.log(JSON.stringify(row))
            }
        }
        console.log(JSON.stringify({ census }))
        fs.writeFileSync(OUT, JSON.stringify({ census, rows }, null, 1))
        expect(rows.length).toBe(TIERS.length * 14)
        // The measurement is sensitive: an unedited pass writes only the manifest, an edited pass writes more, and
        // the rewrite-all contrast writes every unit but the reused stubs.
        for (const row of rows) {
            if (row.scenario.includes('control')) {
                expect(row.writtenUnits).toBe(1)
            } else if (row.changedBytes > 0) {
                expect(row.writtenUnits).toBeGreaterThan(1)
            } else if (row.scenario.startsWith('e1')) {
                expect(row.writtenUnits).toBeGreaterThan(row.totalUnits / 2)
            }
        }
    }, 900_000)
})
