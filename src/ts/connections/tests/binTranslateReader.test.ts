/**
 * The `.bin` translation reads connection keys through an injected, synchronous reader, never through the
 * async key seam: after the writer opens, a vault call could stall or reject and fail the export. The reader
 * here is a literal fake; the store's own reader is tested in exportKeys.svelte.test.ts. Keys are synthetic.
 *
 * T38(d) is the regression reproducer against the S2a code, where the translation awaited `connectionKey`.
 */
import { describe, expect, it, vi } from 'vitest'
import type { StoredDatabase } from 'src/ts/storage/database.svelte'
import type { Connection } from '../connections'
import { keyStateOf, writeLegacyFromConnections } from '../binTranslate'
import { migrateConnections } from '../migrate'

const seamSpy = vi.hoisted(() => ({ connectionKey: vi.fn(async (conn: { key: string }) => conn.key) }))

vi.mock('src/ts/connections/keyAccess', () => ({
    connectionKey: seamSpy.connectionKey,
}))

type Reader = { keyOf(conn: Connection): string, late(): string[] }

const ENVELOPE = 'SYNTH-ENVELOPE-A'

function wrappedDb(): StoredDatabase {
    return {
        connections: [{ id: 'conn-1', name: 'OpenAI', provider: 'openai', key: '', keyWrapped: ENVELOPE }],
        openAIKey: '',
        botPresets: [],
        customModels: [],
    } as unknown as StoredDatabase
}

function readerOf(values: Record<string, string>, lateNames: string[] = []): Reader {
    return {
        keyOf: (conn) => conn.key !== '' ? conn.key : (conn.keyWrapped !== undefined ? (values[conn.keyWrapped] ?? '') : ''),
        late: () => lateNames,
    }
}

function translate(live: StoredDatabase, reader: Reader): unknown {
    const plain = structuredClone(live)
    const state = keyStateOf(plain)
    migrateConnections(state)
    const result = (writeLegacyFromConnections as (state: StoredDatabase, plain: StoredDatabase, keys: Reader) => unknown)(state, plain, reader)
    translated = plain
    return result
}

let translated: StoredDatabase

describe('writeLegacyFromConnections with an injected reader', () => {
    // regression reproducer: T38(d)
    it('T38(d): never calls connectionKey and returns synchronously', () => {
        seamSpy.connectionKey.mockClear()

        const result = translate(wrappedDb(), readerOf({ [ENVELOPE]: 'SYNTH-PLAIN-A' }))

        expect(seamSpy.connectionKey).not.toHaveBeenCalled()
        expect(result).toBeUndefined()
    })

    it('T38(a): a wrapped carrier resolves through the projection copy to its plain in the legacy field', () => {
        translate(wrappedDb(), readerOf({ [ENVELOPE]: 'SYNTH-PLAIN-A' }))

        expect(translated.openAIKey).toBe('SYNTH-PLAIN-A')
    })

    it('a carrier the reader cannot resolve is written empty', () => {
        translate(wrappedDb(), readerOf({}))

        expect(translated.openAIKey).toBe('')
    })
})
