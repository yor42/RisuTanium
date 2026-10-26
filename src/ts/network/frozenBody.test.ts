import { describe, expect, test, vi } from 'vitest'
import { parseJsonBody, readBodyBytes, readBodyText } from './frozenBody'

const encoder = new TextEncoder()

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(chunk)
            }
            controller.close()
        },
    })
}

function responseOf(chunks: Uint8Array[]): Response {
    return { body: streamOf(chunks) } as unknown as Response
}

describe('readBodyBytes', () => {
    test('joins one chunk, many chunks and no chunks exactly', async () => {
        expect(Array.from(await readBodyBytes(streamOf([Uint8Array.of(1, 2, 3)])))).toEqual([1, 2, 3])
        expect(Array.from(await readBodyBytes(streamOf([Uint8Array.of(1), Uint8Array.of(2, 3), Uint8Array.of(), Uint8Array.of(4)])))).toEqual([1, 2, 3, 4])
        expect(Array.from(await readBodyBytes(streamOf([])))).toEqual([])
    })

    test('releases the reader lock after the read', async () => {
        const stream = streamOf([Uint8Array.of(1)])
        await readBodyBytes(stream)
        expect(stream.locked).toBe(false)
    })
})

describe('readBodyText', () => {
    test('a null body is an empty string', async () => {
        expect(await readBodyText({ body: null } as unknown as Response)).toBe('')
    })

    test('a multibyte character split across chunks is decoded once, intact', async () => {
        const bytes = encoder.encode('{"a":"한국어"}')
        expect(await readBodyText(responseOf([bytes.subarray(0, 7), bytes.subarray(7, 9), bytes.subarray(9)]))).toBe('{"a":"한국어"}')
    })

    test('never calls a Body-mixin method', async () => {
        const mixin = vi.fn(() => new Promise(() => {}))
        const response = { body: streamOf([encoder.encode('{"v":1}')]), text: mixin, json: mixin, arrayBuffer: mixin } as unknown as Response
        expect(await parseJsonBody(response)).toEqual({ v: 1 })
        expect(mixin).not.toHaveBeenCalled()
    })
})

describe('parseJsonBody', () => {
    test('rejects with a SyntaxError for a non-JSON body', async () => {
        await expect(parseJsonBody(responseOf([encoder.encode('<html>')]))).rejects.toBeInstanceOf(SyntaxError)
    })
})
