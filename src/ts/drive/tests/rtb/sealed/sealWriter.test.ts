// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { nobleAead, type AeadBackend } from 'src/ts/drive/rtb/sealed/aead'
import { prepareSeal } from 'src/ts/drive/rtb/sealed/sealWriter'
import { seededBytes, sequenceRandom } from './sealedReference'

const PARAMS = { m: 8, t: 1, chunkSize: 64 }
const allZero = (bytes: Uint8Array) => bytes.every((byte) => byte === 0)

async function prepared() {
    const inner = nobleAead()
    const keys: Uint8Array[] = []
    const aead: AeadBackend = {
        ...inner,
        importKey: async (raw) => {
            const key = await inner.importKey(raw)
            keys.push(key as Uint8Array)
            return key
        },
    }
    const seal = await prepareSeal('password one', PARAMS, {
        random: sequenceRandom([seededBytes(32, 1), seededBytes(16, 2), seededBytes(12, 3), seededBytes(16, 4)]),
        kdf: async () => seededBytes(32, 9),
        aead,
    })
    // The second imported key is the payload key the sink would use.
    return { seal, payloadKey: keys[1] }
}

describe('PreparedSeal abandon', () => {
    test('with no sink taken it zeroes the payload key and sink() then throws', async () => {
        const { seal, payloadKey } = await prepared()
        expect(allZero(payloadKey)).toBe(false)
        seal.abandon()
        expect(allZero(payloadKey)).toBe(true)
        expect(() => seal.sink(() => undefined)).toThrow('abandoned')
    })

    test('a second abandon does not throw', async () => {
        const { seal } = await prepared()
        seal.abandon()
        expect(() => seal.abandon()).not.toThrow()
    })

    test('with a sink taken it poisons that sink and zeroes the key', async () => {
        const { seal, payloadKey } = await prepared()
        const sink = seal.sink(() => undefined)
        await sink.write(seededBytes(10, 5))
        seal.abandon()
        expect(allZero(payloadKey)).toBe(true)
        await expect(sink.write(seededBytes(1, 6))).rejects.toThrow('failed earlier')
        await expect(sink.finish()).rejects.toThrow('failed earlier')
    })
})
