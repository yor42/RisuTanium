/**
 * The skip decision of a `.bin` restore for an asset the store already holds,
 * with the held reader, the backup file and the listing injected. The held
 * sources here break the reader contracts on purpose (a total that disagrees
 * with the pieces, a piece past the entry) so each clause C1 to C5 is tested
 * by itself; the real readers never do that.
 */
import { describe, test, expect } from 'vitest'
import {
    chainHeldPieces,
    createHeldAssetJudge,
    equalPieces,
    type HeldSource,
} from '../binAssetHeld'

/** Offset-sensitive bytes: period 251 so a piece boundary never lines up with the period. */
function patterned(length: number, seed = 0): Uint8Array {
    const out = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
        out[i] = (i + seed) % 251
    }
    return out
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.length
    }
    return out
}

interface RecordedHeld {
    held: HeldSource
    /** How many times `return()` was called on the iterator. */
    returnCalls: () => number
    /** How many times `next()` was called. */
    nextCalls: () => number
}

function recordedHeld(pieces: Uint8Array[], total: number, throwAt = -1): RecordedHeld {
    let returns = 0
    let nexts = 0
    const held: HeldSource = {
        total,
        pieces: {
            [Symbol.asyncIterator]() {
                let at = 0
                return {
                    async next() {
                        nexts++
                        if (at === throwAt) {
                            throw new Error('held read failed')
                        }
                        if (at >= pieces.length) {
                            return { done: true, value: undefined }
                        }
                        return { done: false, value: pieces[at++] }
                    },
                    async return() {
                        returns++
                        return { done: true, value: undefined }
                    },
                }
            },
        },
    }
    return { held, returnCalls: () => returns, nextCalls: () => nexts }
}

function fileOf(bytes: Uint8Array) {
    const calls: Array<[number, number]> = []
    return {
        calls,
        read: (start: number, end: number) => {
            calls.push([start, end])
            return bytes.subarray(start, end)
        },
    }
}

const SIZE = 10
const entry = patterned(SIZE)
const neverHalted = () => false

describe('equalPieces', () => {
    test('C1: a held total different from the entry size writes before any piece is pulled', async () => {
        const src = recordedHeld([entry], SIZE + 7)
        const file = fileOf(entry)
        expect(await equalPieces(src.held, file.read, SIZE, neverHalted)).toBe('write')
        expect(file.calls).toEqual([])
        expect(src.nextCalls()).toBe(0)
    })

    test('C2: a piece past the entry size writes and requests no file bytes past the size', async () => {
        const src = recordedHeld([entry, patterned(7, 3)], SIZE)
        const file = fileOf(entry)
        expect(await equalPieces(src.held, file.read, SIZE, neverHalted)).toBe('write')
        expect(file.calls.every(([, end]) => end <= SIZE)).toBe(true)
        expect(src.returnCalls()).toBe(1)
    })

    test('C4: pieces adding up to less than the size write', async () => {
        const src = recordedHeld([entry.subarray(0, SIZE - 1)], SIZE)
        expect(await equalPieces(src.held, fileOf(entry).read, SIZE, neverHalted)).toBe('write')
    })

    test('all bytes equal across several pieces is held, and the pieces are requested in order', async () => {
        const src = recordedHeld([entry.subarray(0, 4), entry.subarray(4, 9), entry.subarray(9)], SIZE)
        const file = fileOf(entry)
        expect(await equalPieces(src.held, file.read, SIZE, neverHalted)).toBe('held')
        expect(file.calls).toEqual([[0, 4], [4, 9], [9, 10]])
        expect(src.returnCalls()).toBe(0)
    })

    test('C3: a different last byte of the last piece writes', async () => {
        const changed = entry.slice()
        changed[SIZE - 1] ^= 0xff
        const src = recordedHeld([changed.subarray(0, 5), changed.subarray(5)], SIZE)
        expect(await equalPieces(src.held, fileOf(entry).read, SIZE, neverHalted)).toBe('write')
        expect(src.returnCalls()).toBe(1)
    })

    test('a rejecting file read is a source failure', async () => {
        const src = recordedHeld([entry], SIZE)
        const outcome = await equalPieces(src.held, () => Promise.reject(new Error('file changed')), SIZE, neverHalted)
        expect(outcome).toBe('source')
        expect(src.returnCalls()).toBe(1)
    })

    test('a short file read is a source failure', async () => {
        const src = recordedHeld([entry], SIZE)
        expect(await equalPieces(src.held, (start, end) => entry.subarray(start, end - 1), SIZE, neverHalted)).toBe('source')
        expect(src.returnCalls()).toBe(1)
    })

    test('a throwing held iterator writes', async () => {
        const src = recordedHeld([entry.subarray(0, 4), entry.subarray(4)], SIZE, 1)
        expect(await equalPieces(src.held, fileOf(entry).read, SIZE, neverHalted)).toBe('write')
    })

    test('a held source whose iterator cannot be created writes', async () => {
        const held: HeldSource = {
            total: SIZE,
            pieces: { [Symbol.asyncIterator]() { throw new Error('closed') } },
        }
        expect(await equalPieces(held, fileOf(entry).read, SIZE, neverHalted)).toBe('write')
    })

    test('halted between pieces stops and closes the iterator', async () => {
        const src = recordedHeld([entry.subarray(0, 4), entry.subarray(4)], SIZE)
        let checks = 0
        const outcome = await equalPieces(src.held, fileOf(entry).read, SIZE, () => ++checks > 1)
        expect(outcome).toBe('stopped')
        expect(src.returnCalls()).toBe(1)
    })

    test('a rejection reading the file never lets the held side win', async () => {
        const src = recordedHeld([entry.subarray(0, 5), entry.subarray(5)], SIZE)
        let call = 0
        const outcome = await equalPieces(src.held, (s, e) => {
            if (call++ === 1) {
                throw new Error('slice failed')
            }
            return entry.subarray(s, e)
        }, SIZE, neverHalted)
        expect(outcome).toBe('source')
    })
})

describe('chainHeldPieces', () => {
    test('yields the first piece and then the rest', async () => {
        const rest = recordedHeld([patterned(3, 1), patterned(2, 5)], 7).held.pieces[Symbol.asyncIterator]()
        const seen: Uint8Array[] = []
        for await (const piece of chainHeldPieces(patterned(2), rest)) {
            seen.push(piece)
        }
        expect(concat(seen)).toEqual(concat([patterned(2), patterned(3, 1), patterned(2, 5)]))
    })

    test('return() before the first pull still closes the inner iterator', async () => {
        const inner = recordedHeld([patterned(3)], 5)
        const chain = chainHeldPieces(patterned(2), inner.held.pieces[Symbol.asyncIterator]())
        await chain[Symbol.asyncIterator]().return?.()
        expect(inner.returnCalls()).toBe(1)
    })

    test('a chained source closes the inner iterator when C1 exits before any pull', async () => {
        const inner = recordedHeld([patterned(3)], 5)
        const held: HeldSource = {
            total: 99,
            pieces: chainHeldPieces(patterned(2), inner.held.pieces[Symbol.asyncIterator]()),
        }
        expect(await equalPieces(held, fileOf(entry).read, SIZE, neverHalted)).toBe('write')
        expect(inner.returnCalls()).toBe(1)
    })
})

describe('createHeldAssetJudge: readWholeSmall path', () => {
    const data = patterned(2048)
    function judgeWith(bytes: (() => Promise<Uint8Array | null>)) {
        return createHeldAssetJudge({
            listing: [{ key: 'assets/a', size: data.length }],
            readWholeSmall: bytes,
            smallLimit: 4096,
        })
    }

    test('equal bytes are held', async () => {
        expect(await judgeWith(async () => data.slice()).judgeBytes('assets/a', data)).toBe('held')
    })

    test('C5: a held value longer than the entry writes', async () => {
        const longer = concat([data, patterned(7, 9)])
        expect(await judgeWith(async () => longer).judgeBytes('assets/a', data)).toBe('write')
    })

    test('a held value shorter than the entry writes', async () => {
        expect(await judgeWith(async () => data.subarray(0, data.length - 1)).judgeBytes('assets/a', data)).toBe('write')
    })

    test('a different byte writes', async () => {
        const changed = data.slice()
        changed[100] ^= 1
        expect(await judgeWith(async () => changed).judgeBytes('assets/a', data)).toBe('write')
    })

    test('null or a throwing read writes', async () => {
        expect(await judgeWith(async () => null).judgeBytes('assets/a', data)).toBe('write')
        expect(await judgeWith(async () => { throw new Error('read failed') }).judgeBytes('assets/a', data)).toBe('write')
    })
})

describe('createHeldAssetJudge: judge', () => {
    const data = patterned(2048)
    const listing = [{ key: 'assets/a', size: data.length }]

    test('equal pieces are held on the small route', async () => {
        const src = recordedHeld([data.subarray(0, 1000), data.subarray(1000)], data.length)
        const judge = createHeldAssetJudge({ listing, openHeld: async () => src.held, smallLimit: 4096 })
        expect(await judge.judgeBytes('assets/a', data)).toBe('held')
    })

    test('held longer than the entry on the small route writes', async () => {
        const src = recordedHeld([data, patterned(7, 2)], data.length + 7)
        const judge = createHeldAssetJudge({ listing, openHeld: async () => src.held, smallLimit: 4096 })
        expect(await judge.judgeBytes('assets/a', data)).toBe('write')
    })

    test('a source outcome on the small route maps to write', async () => {
        // A held source whose total and piece sums agree with the entry cannot make the in-memory
        // reader return short, so a short slice stands for a defect in the reader itself.
        const held: HeldSource = {
            total: data.length,
            pieces: (async function* () { yield data.subarray(0, data.length - 1); yield patterned(1, 4) })(),
        }
        const judge = createHeldAssetJudge({ listing, openHeld: async () => held, smallLimit: 4096 })
        expect(await judge.judgeBytes('assets/a', data)).toBe('write')
    })

    test('an entry above the small limit writes with no open', async () => {
        let opens = 0
        const judge = createHeldAssetJudge({
            listing,
            openHeld: async () => { opens++; return null },
            readWholeSmall: async () => { opens++; return data },
            smallLimit: data.length - 1,
        })
        expect(await judge.judgeBytes('assets/a', data)).toBe('write')
        expect(opens).toBe(0)
    })

    test('a listed size that differs writes with no open', async () => {
        let opens = 0
        const judge = createHeldAssetJudge({
            listing: [{ key: 'assets/a', size: data.length + 1 }],
            openHeld: async () => { opens++; return null },
            smallLimit: 4096,
        })
        expect(await judge.judgeBytes('assets/a', data)).toBe('write')
        expect(await judge.judgeStreamed('assets/a', data.length, fileOf(data).read, neverHalted)).toBe('write')
        expect(opens).toBe(0)
    })

    test('an unlisted key writes', async () => {
        const judge = createHeldAssetJudge({ listing: [], openHeld: async () => recordedHeld([data], data.length).held, smallLimit: 4096 })
        expect(await judge.judgeBytes('assets/a', data)).toBe('write')
    })

    test('a missing or throwing open writes', async () => {
        const absent = createHeldAssetJudge({ listing, openHeld: async () => null, smallLimit: 4096 })
        expect(await absent.judgeBytes('assets/a', data)).toBe('write')
        const failing = createHeldAssetJudge({ listing, openHeld: async () => { throw new Error('gone') }, smallLimit: 4096 })
        expect(await failing.judgeBytes('assets/a', data)).toBe('write')
        expect(await failing.judgeStreamed('assets/a', data.length, fileOf(data).read, neverHalted)).toBe('write')
    })

    test('no reader at all writes', async () => {
        const judge = createHeldAssetJudge({ listing, smallLimit: 4096 })
        expect(await judge.judgeBytes('assets/a', data)).toBe('write')
    })

    test('touch kept: true keeps the skip; kept: false or a throw writes', async () => {
        const open = async () => recordedHeld([data], data.length).held
        const touched: string[] = []
        const kept = createHeldAssetJudge({
            listing, openHeld: open, smallLimit: 4096,
            touch: async (key) => { touched.push(key); return { kept: true } },
        })
        expect(await kept.judgeBytes('assets/a', data)).toBe('held')
        expect(touched).toEqual(['assets/a'])
        const notKept = createHeldAssetJudge({ listing, openHeld: open, smallLimit: 4096, touch: async () => ({ kept: false }) })
        expect(await notKept.judgeBytes('assets/a', data)).toBe('write')
        expect(await notKept.judgeStreamed('assets/a', data.length, fileOf(data).read, neverHalted)).toBe('write')
        const throws = createHeldAssetJudge({ listing, openHeld: open, smallLimit: 4096, touch: async () => { throw new Error('no') } })
        expect(await throws.judgeBytes('assets/a', data)).toBe('write')
    })

    test('touch is not called when the compare fails', async () => {
        const changed = data.slice()
        changed[0] ^= 1
        let touches = 0
        const judge = createHeldAssetJudge({
            listing, openHeld: async () => recordedHeld([changed], data.length).held, smallLimit: 4096,
            touch: async () => { touches++; return { kept: true } },
        })
        expect(await judge.judgeBytes('assets/a', data)).toBe('write')
        expect(touches).toBe(0)
    })

    test('the streamed route passes source and stopped through and held when equal', async () => {
        const open = async () => recordedHeld([data.subarray(0, 1000), data.subarray(1000)], data.length).held
        const judge = createHeldAssetJudge({ listing, openHeld: open, smallLimit: 4096 })
        expect(await judge.judgeStreamed('assets/a', data.length, fileOf(data).read, neverHalted)).toBe('held')
        expect(await judge.judgeStreamed('assets/a', data.length, () => { throw new Error('changed') }, neverHalted)).toBe('source')
        expect(await judge.judgeStreamed('assets/a', data.length, fileOf(data).read, () => true)).toBe('stopped')
    })

    test('the streamed route closes the held iterator on every early exit', async () => {
        const changed = data.slice()
        changed[data.length - 1] ^= 1
        const src = recordedHeld([changed.subarray(0, 1000), changed.subarray(1000)], data.length)
        const judge = createHeldAssetJudge({ listing, openHeld: async () => src.held, smallLimit: 4096 })
        expect(await judge.judgeStreamed('assets/a', data.length, fileOf(data).read, neverHalted)).toBe('write')
        expect(src.returnCalls()).toBe(1)
    })
})

describe('createHeldAssetJudge: observe', () => {
    test('only an exactly listed key whose fold was not seen may be compared', () => {
        const judge = createHeldAssetJudge({
            listing: [{ key: 'assets/pic.png', size: 3 }],
            smallLimit: 4096,
        })
        expect(judge.observe('assets/unlisted')).toBe(false)
        expect(judge.observe('assets/pic.png')).toBe(true)
        expect(judge.observe('assets/pic.png')).toBe(false)
    })

    test('a case variant seen first blocks the exactly listed key', () => {
        const judge = createHeldAssetJudge({
            listing: [{ key: 'assets/pic.png', size: 3 }],
            smallLimit: 4096,
        })
        expect(judge.observe('assets/Pic.PNG')).toBe(false)
        expect(judge.observe('assets/pic.png')).toBe(false)
    })

    test('a Unicode composition variant folds together', () => {
        const nfc = 'assets/café.png'
        const nfd = 'assets/café.png'
        const judge = createHeldAssetJudge({ listing: [{ key: nfc, size: 3 }], smallLimit: 4096 })
        expect(judge.observe(nfd)).toBe(false)
        expect(judge.observe(nfc)).toBe(false)
    })

    test('an entry whose fold is not listed records nothing', () => {
        const judge = createHeldAssetJudge({ listing: [{ key: 'assets/b', size: 3 }], smallLimit: 4096 })
        expect(judge.observe('assets/a')).toBe(false)
        expect(judge.observe('assets/b')).toBe(true)
    })
})
