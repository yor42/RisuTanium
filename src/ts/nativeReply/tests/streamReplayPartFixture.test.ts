import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
}))

vi.mock('../../storage/database.svelte', () => ({ getDatabase: () => h.db, setDatabase: vi.fn() }))
vi.mock('../../stores.svelte', () => ({
    get DBState() { return { db: h.db } },
    CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
    CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
    HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
    bodyIntercepterStore: writable(null),
}))

import { replayOpenAIChatStream } from '../streamReplay'
import { openAIChatStreamTransform } from '../../process/request/openAI/chatStreamTransform'
import type { OpenAIChatReadRule } from '../../process/request/openAI/chatBodyParse'
import { createUsageMeter } from '../../usage/usageMeter'

/**
 * T-RT (guard, producer round trip): the committed `part.bin` is written by the real Rust journal writer over four cut
 * chunks (Korean text, an emoji cut inside its UTF-8 bytes, a chunk ending mid-line, an `include_usage` chunk, no
 * `[DONE]`). This reads those bytes as the recovered partial and replays them through the live transform, so a change to
 * what the writer journals, or to how the page reads it, fails here and not on a device.
 */

const FIXTURE = resolve(process.cwd(), 'src-tauri/tests/fixtures/native-reply-part-v1/part.bin')
const rule: OpenAIChatReadRule = { deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false }
const EXPECTED = '안녕하세요, 🙂 세계!'

function fixtureBytes(): Uint8Array {
    return new Uint8Array(readFileSync(FIXTURE))
}

/** The live read of `parts`, written one after another as the pump would enqueue them. */
async function liveRead(parts: Uint8Array[], meter = createUsageMeter()): Promise<string> {
    const transform = openAIChatStreamTransform(rule, { onUsage: (usage) => meter.report(usage) })
    const writer = transform.writable.getWriter()
    const writing = (async () => {
        for (const part of parts) {
            await writer.write(part)
        }
        await writer.close()
    })()
    const reader = transform.readable.getReader()
    let last = ''
    for (;;) {
        const read = await reader.read()
        if (read.done) {
            break
        }
        last = read.value?.['0'] || last
    }
    await writing
    return last
}

describe('the committed part.bin round trip', () => {
    test('the recovered partial replays to the hand-written text and reports its usage once', async () => {
        const meter = createUsageMeter()
        const { modelText } = await replayOpenAIChatStream({ bytes: fixtureBytes(), complete: false, rule }, meter)
        expect(modelText).toBe(EXPECTED)
        expect(meter.reported()).not.toBeNull()
    })

    test('the same bytes cut at every byte give the same text through the live transform', async () => {
        const bytes = fixtureBytes()
        for (let size = 1; size <= 3; size++) {
            const parts: Uint8Array[] = []
            for (let at = 0; at < bytes.length; at += size) {
                parts.push(bytes.slice(at, at + size))
            }
            expect(await liveRead(parts)).toBe(EXPECTED)
        }
    })

    test('a prefix that ends inside the emoji keeps the text before it and never a broken character', async () => {
        const bytes = fixtureBytes()
        const text = new TextDecoder().decode(bytes)
        const emojiAt = new TextEncoder().encode(text.slice(0, text.indexOf('🙂'))).length
        const { modelText } = await replayOpenAIChatStream({ bytes: bytes.slice(0, emojiAt + 2), complete: false, rule }, createUsageMeter())
        expect(modelText).toBe('안녕하세요, ')
        expect(modelText).not.toContain('�')
    })
})
