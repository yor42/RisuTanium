/**
 * The packing worker's handler (`drive/stubPackWorker.ts`): the reply carries the job's id, packs exactly what
 * `deflateSync(bytes, { level: 1 })` gives, and answers a malformed message with an error under its id.
 *
 * Labels: (new behaviour) names something that does not exist before the change, so it is shown by mutating the
 * implementation, not by a red base.
 */
import { describe, expect, test } from 'vitest'
import { deflateSync, inflateSync } from 'fflate'
import { handlePackMessage } from 'src/ts/drive/stubPackWorker'

describe('handlePackMessage', () => {
    test('(new behaviour) the reply carries the id of its message, and inflating the packed bytes gives the input', () => {
        const bytes = new TextEncoder().encode(JSON.stringify({ character: { name: 'x'.repeat(500) } }))

        const reply = handlePackMessage({ id: 7, bytes })

        expect(reply).toMatchObject({ id: 7 })
        expect('packed' in reply).toBe(true)
        if ('packed' in reply) {
            expect(Array.from(inflateSync(reply.packed))).toEqual(Array.from(bytes))
            expect(Array.from(reply.packed)).toEqual(Array.from(deflateSync(bytes, { level: 1 })))
        }
    })

    test('(new behaviour) a malformed message gets an error under its id, or under -1 when it has none', () => {
        expect(handlePackMessage({ id: 3, bytes: 'not bytes' })).toEqual({ id: 3, error: expect.any(String) })
        expect(handlePackMessage({ id: 3.5, bytes: new Uint8Array(1) })).toMatchObject({ error: expect.any(String) })
        expect(handlePackMessage(null)).toEqual({ id: -1, error: expect.any(String) })
        expect(handlePackMessage('hello')).toEqual({ id: -1, error: expect.any(String) })
    })

    test('(G) importing the module in a page does not wire a message handler', () => {
        expect((globalThis as { onmessage?: unknown }).onmessage ?? null).toBeNull()
    })
})
