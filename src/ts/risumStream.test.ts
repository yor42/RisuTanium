import { describe, expect, it } from 'vitest'
import { AppendableBuffer } from './byteBuffer'
import { risumFileName, risumLength, streamRisum } from './risumStream'

// The whole-file builder this seam replaced, kept here as the reference: AppendableBuffer plus
// Buffer.writeUInt32LE, one record after another, a single 0 byte as terminator.
function oldWholeFile(mainBlock: Uint8Array, bodies: Uint8Array[]): Uint8Array {
    const apb = new AppendableBuffer()
    const writeLength = (len: number) => {
        const lenbuf = Buffer.alloc(4)
        lenbuf.writeUInt32LE(len, 0)
        apb.append(lenbuf)
    }
    const writeByte = (byte: number) => {
        const buf = Buffer.alloc(1)
        buf.writeUInt8(byte, 0)
        apb.append(buf)
    }
    writeByte(111)
    writeByte(0)
    writeLength(mainBlock.length)
    apb.append(mainBlock)
    for (const body of bodies) {
        writeByte(1)
        writeLength(body.length)
        apb.append(body)
    }
    writeByte(0)
    return apb.buffer
}

function joinChunks(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const out = new Uint8Array(total)
    let at = 0
    for (const chunk of chunks) {
        out.set(chunk, at)
        at += chunk.length
    }
    return out
}

// Buffer.equals: toEqual on multi-MiB arrays is orders of magnitude slower.
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    return Buffer.from(left.buffer, left.byteOffset, left.length).equals(right)
}

function patterned(length: number, seed: number): Uint8Array {
    const out = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
        out[i] = (i * 31 + seed) & 0xFF
    }
    return out
}

const mainBlock = patterned(300, 7)

describe('streamRisum byte identity with the whole-file builder', () => {
    const MiB4 = 4 * 1024 * 1024
    const shapes: [string, Uint8Array[]][] = [
        ['no records', []],
        ['one record', [patterned(10, 1)]],
        ['five records', [1, 2, 3, 4, 5].map((n) => patterned(n * 17, n))],
        ['a zero-length body', [patterned(5, 1), new Uint8Array(0), patterned(6, 2)]],
        ['bodies below and above 4 MiB', [patterned(MiB4 - 1, 3), patterned(MiB4 + 1, 4)]],
    ]

    for (const [label, bodies] of shapes) {
        it(`matches for ${label}`, async () => {
            const chunks: Uint8Array[] = []
            await streamRisum(mainBlock, bodies.length, (i) => bodies[i], (chunk) => {
                chunks.push(chunk.slice())
            })
            expect(sameBytes(joinChunks(chunks), oldWholeFile(mainBlock, bodies))).toBe(true)
        })

        it(`matches for ${label} when the sink keeps references`, async () => {
            // Web Blob and held-stream writers keep the chunk objects; a reused or mutated
            // chunk would corrupt every earlier record.
            const chunks: Uint8Array[] = []
            await streamRisum(mainBlock, bodies.length, async (i) => bodies[i], (chunk) => {
                chunks.push(chunk)
            })
            expect(sameBytes(joinChunks(chunks), oldWholeFile(mainBlock, bodies))).toBe(true)
        })
    }

    it('writes the terminator last and as a single zero byte', async () => {
        const chunks: Uint8Array[] = []
        await streamRisum(mainBlock, 2, (i) => patterned(4, i), (chunk) => {
            chunks.push(chunk)
        })
        expect(Array.from(chunks[chunks.length - 1])).toEqual([0])
    })

    it('never hands the produced body or the main block over inside a larger copy', async () => {
        const body = patterned(64, 9)
        const sizes: number[] = []
        await streamRisum(mainBlock, 1, () => body, (chunk) => {
            sizes.push(chunk.length)
        })
        expect(Math.max(...sizes)).toBe(Math.max(mainBlock.length, body.length))
    })
})

describe('streamRisum ordering', () => {
    it('produces record j+1 only after the write of record j body resolved', async () => {
        const log: string[] = []
        const releases: (() => void)[] = []
        const done = streamRisum(
            mainBlock,
            3,
            (i) => {
                log.push(`produce ${i}`)
                return patterned(8, i)
            },
            (chunk) => {
                log.push(`write ${chunk.length}`)
                if (chunk.length === 8) {
                    return new Promise<void>((resolve) => {
                        releases.push(() => {
                            log.push('released')
                            resolve()
                        })
                    })
                }
            },
        )
        for (let round = 0; round < 3; round++) {
            await new Promise((resolve) => setTimeout(resolve, 5))
            expect(releases.length).toBe(round + 1)
            expect(log.filter((entry) => entry.startsWith('produce')).length).toBe(round + 1)
            releases[round]()
        }
        await done
        expect(log.filter((entry) => entry.startsWith('produce'))).toEqual(['produce 0', 'produce 1', 'produce 2'])
    })

    it('stops at the first failing write and writes nothing more', async () => {
        const writes: number[] = []
        let produced = 0
        await expect(streamRisum(
            mainBlock,
            4,
            () => {
                produced++
                return patterned(3, 1)
            },
            (chunk) => {
                writes.push(chunk.length)
                if (writes.length === 5) {
                    throw new Error('disk full')
                }
            },
        )).rejects.toThrow('disk full')
        expect(writes.length).toBe(5)
        expect(produced).toBeLessThan(4)
    })

    it('stops when a body cannot be produced and writes no terminator', async () => {
        const chunks: Uint8Array[] = []
        await expect(streamRisum(
            mainBlock,
            3,
            (i) => {
                if (i === 1) {
                    throw new Error('read failed')
                }
                return patterned(3, i)
            },
            (chunk) => {
                chunks.push(chunk)
            },
        )).rejects.toThrow('read failed')
        const last = chunks[chunks.length - 1]
        expect(last.length === 1 && last[0] === 0).toBe(false)
    })
})

describe('risumLength', () => {
    it('encodes little-endian', () => {
        expect(Array.from(risumLength(0))).toEqual([0, 0, 0, 0])
        expect(Array.from(risumLength(1))).toEqual([1, 0, 0, 0])
        expect(Array.from(risumLength(0x01020304))).toEqual([4, 3, 2, 1])
        expect(Array.from(risumLength(0xFFFFFFFF))).toEqual([255, 255, 255, 255])
    })

    it('rejects values a 32-bit length cannot hold', () => {
        expect(() => risumLength(2 ** 32)).toThrow(RangeError)
        expect(() => risumLength(-1)).toThrow(RangeError)
        expect(() => risumLength(1.5)).toThrow(RangeError)
        expect(() => risumLength(Number.NaN)).toThrow(RangeError)
    })

    it('returns a fresh array each call', () => {
        expect(risumLength(7)).not.toBe(risumLength(7))
    })
})

describe('risumFileName', () => {
    it('removes path and reserved characters', () => {
        expect(risumFileName('a/b:c')).toBe('abc.risum')
        expect(risumFileName('x<y>z"w|v?u*t\\s')).toBe('xyzwvuts.risum')
        expect(risumFileName('tab\there')).toBe('tabhere.risum')
    })

    it('keeps dots and commas inside the name', () => {
        expect(risumFileName('v1.2 Pack')).toBe('v1.2 Pack.risum')
        expect(risumFileName('a, b')).toBe('a, b.risum')
    })

    it('trims and strips trailing dots and spaces', () => {
        expect(risumFileName('  pack. . ')).toBe('pack.risum')
    })

    it('falls back when nothing is left', () => {
        expect(risumFileName('')).toBe('module.risum')
        expect(risumFileName('///')).toBe('module.risum')
        expect(risumFileName(undefined)).toBe('module.risum')
    })

    it('prefixes a Windows-reserved stem', () => {
        expect(risumFileName('con')).toBe('_con.risum')
        expect(risumFileName('LPT1')).toBe('_LPT1.risum')
        expect(risumFileName('console')).toBe('console.risum')
    })
})
