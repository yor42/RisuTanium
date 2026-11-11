// @vitest-environment node
import { describe, expect, test } from 'vitest'
import type { Database } from '../../database.svelte'
import { previousFrom } from '../../store2/codec'
import { newManifestKey, newShardKey, newUnitKey } from '../../store2/format/keys'
import { createSaveEncoder } from '../../store2/saveEncoder'
import { buildSmall, buildT5Chat, encodeWith, fakeLists, seededEnv, type Obj } from './codecFixtures'

/**
 * Guard (passes before and after; the memo does not exist on the pre-change base): a plan that throws after the chunk
 * memo has remembered a chunk's new text, or a plan that is built but never acknowledged, leaves the memo holding that
 * text. The next pass over the same acknowledged encoding must still write the chunk, because the acknowledged
 * encoding's unit at that identity does not carry the remembered digest. Killed by a memo hit that skips the
 * previous-digest comparison.
 */

const NOW = 1_700_000_000_000

function mintOf(seed: number) {
    const env = seededEnv(seed)
    return { shard: () => newShardKey(env), unit: () => newUnitKey(env), manifest: () => newManifestKey(env) }
}

function writtenText(units: readonly { bytes: Uint8Array }[]): string {
    return units.map(unit => new TextDecoder().decode(unit.bytes)).join('\n')
}

function profile(): { db: Obj, slots: Obj[], messages: Obj[] } {
    const db = buildSmall(3) as unknown as Obj
    const slots = db.characters as Obj[]
    slots[0].chats = [buildT5Chat(400), ...(slots[0].chats as Obj[]).slice(1)]
    return { db, slots, messages: (slots[0].chats as Obj[])[0].message as Obj[] }
}

describe('a chunk the memo remembered from a plan that did not commit is written by the next pass', () => {
    test('the plan threw (a non-object character slot after the edited character)', async () => {
        const { db, slots, messages } = profile()
        const encoder = createSaveEncoder({ previous: previousFrom(encodeWith(db as unknown as Database, { env: seededEnv(1) })), lists: fakeLists, env: seededEnv(77), now: () => NOW })
        const marked = { marked: new Set([slots[0].chaId as string]), modules: false, whole: false }
        messages.push({ ...messages[messages.length - 1], data: 'MARK-THROWING-PLAN' })
        const saved = slots[2]
        slots[2] = 42 as unknown as Obj
        await expect(encoder.plan(db as unknown as Database, marked)).rejects.toThrow(/not an object/)
        expect(encoder.chunkMemoStats().entries).toBeGreaterThan(0)
        slots[2] = saved
        const plan = await encoder.plan(db as unknown as Database, marked)
        const built = await plan.commitRequest().build({ mint: mintOf(5), seq: 2, now: NOW })
        expect(writtenText(built.units)).toContain('MARK-THROWING-PLAN')
    })

    test('the plan was built but its commit failed, and the next pass sees the same text', async () => {
        const { db, slots, messages } = profile()
        const encoder = createSaveEncoder({ previous: previousFrom(encodeWith(db as unknown as Database, { env: seededEnv(1) })), lists: fakeLists, env: seededEnv(77), now: () => NOW })
        const marked = { marked: new Set([slots[0].chaId as string]), modules: false, whole: false }
        messages.push({ ...messages[messages.length - 1], data: 'MARK-FAILED-COMMIT' })
        const failed = await encoder.plan(db as unknown as Database, marked)
        await failed.commitRequest().build({ mint: mintOf(5), seq: 2, now: NOW })
        // No acknowledge: the commit did not land.
        const plan = await encoder.plan(db as unknown as Database, marked)
        const built = await plan.commitRequest().build({ mint: mintOf(6), seq: 2, now: NOW })
        expect(writtenText(built.units)).toContain('MARK-FAILED-COMMIT')
    })
})
