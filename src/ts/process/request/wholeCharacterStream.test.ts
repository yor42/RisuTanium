import { describe, expect, test } from 'vitest'
import { wholeCharacterStream } from './wholeCharacterStream'

const encoder = new TextEncoder()

/** A body delivered as the given reads, the way a socket splits it. */
function responseOf(reads: Uint8Array[], init: ResponseInit = {}): Response {
    return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
            for (const read of reads) {
                controller.enqueue(read)
            }
            controller.close()
        },
    }), init)
}

async function readAll(response: Response): Promise<{ reads: string[], bytes: number[] }> {
    const reader = response.body!.getReader()
    const reads: string[] = []
    const bytes: number[] = []
    const strictDecoder = new TextDecoder('utf-8', { fatal: true })
    for (;;) {
        const { done, value } = await reader.read()
        if (done) {
            break
        }
        // A read that ends inside a character throws here, so each read is proven whole on its own.
        reads.push(strictDecoder.decode(value))
        bytes.push(...value)
    }
    return { reads, bytes }
}

/** The reads of `bytes` cut after each offset. */
function cutAt(bytes: Uint8Array, offsets: number[]): Uint8Array[] {
    const out: Uint8Array[] = []
    let from = 0
    for (const offset of [...offsets, bytes.length]) {
        out.push(bytes.slice(from, offset))
        from = offset
    }
    return out
}

describe('wholeCharacterStream', () => {
    const text = '{"c":"A가😀 end"}\n'
    const bytes = encoder.encode(text)
    const hangulStart = bytes.indexOf(0xEA)
    const emojiStart = bytes.indexOf(0xF0)

    test('a read that ends inside a three-byte character and one inside a four-byte character come out whole', async () => {
        const out = await readAll(wholeCharacterStream(responseOf(cutAt(bytes, [hangulStart + 1, emojiStart + 2]))))

        expect(out.reads.join('')).toBe(text)
        expect(out.reads.join('')).not.toContain('�')
    })

    test('every single-byte read is rejoined into whole characters', async () => {
        const out = await readAll(wholeCharacterStream(responseOf(Array.from(bytes, (byte) => new Uint8Array([byte])))))

        expect(out.reads.join('')).toBe(text)
    })

    test('the bytes are those of the original body and no line break is added', async () => {
        const plain = encoder.encode('{"a":1}\n{"b":2}')
        const out = await readAll(wholeCharacterStream(responseOf(cutAt(plain, [4, 9]))))

        expect(out.bytes).toEqual([...plain])
    })

    test('a body that ends inside a character emits the decoder\'s flush output', async () => {
        const out = await readAll(wholeCharacterStream(responseOf([bytes.slice(0, hangulStart + 1)])))

        expect(out.reads.join('')).toBe('{"c":"A�')
    })

    test('an empty body stays empty', async () => {
        const out = await readAll(wholeCharacterStream(responseOf([])))

        expect(out.bytes).toEqual([])
    })

    test('a null body returns the same Response object', () => {
        const response = new Response(null, { status: 204 })

        expect(wholeCharacterStream(response)).toBe(response)
    })

    test('status, status text and headers pass through', () => {
        const response = responseOf([bytes], { status: 202, statusText: 'Accepted', headers: { 'Content-Type': 'application/x-ndjson', 'X-Probe': 'kept' } })

        const wrapped = wholeCharacterStream(response)

        expect(wrapped.status).toBe(202)
        expect(wrapped.statusText).toBe('Accepted')
        expect(wrapped.headers.get('Content-Type')).toBe('application/x-ndjson')
        expect(wrapped.headers.get('X-Probe')).toBe('kept')
    })
})
