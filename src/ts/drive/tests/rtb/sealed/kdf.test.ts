// @vitest-environment node
import { argon2id } from '@noble/hashes/argon2.js'
import { describe, expect, test } from 'vitest'
import { deriveKek } from 'src/ts/drive/rtb/sealed/kdf'
import { argon2Sync, HAS_NODE_ARGON2 } from './sealedReference'

function hex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('hex')
}

const RFC9106 = '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659'
const PHC = '09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7'

// The node:crypto legs run where `argon2Sync` exists; on a Node without it they are skipped locally and still fail under CI, which runs a Node that has it.
const nodeLeg = test.skipIf(!HAS_NODE_ARGON2 && !process.env.CI)

describe('Argon2id known answers', () => {
    test.runIf(process.env.CI)('node:crypto provides argon2Sync under CI', () => {
        expect(typeof argon2Sync).toBe('function')
    })

    test('KA1: RFC 9106 section 5.3 through @noble/hashes', () => {
        const fill = (length: number, value: number) => Buffer.alloc(length, value)
        const noble = argon2id(fill(32, 1), fill(16, 2), { t: 3, m: 32, p: 4, dkLen: 32, key: fill(8, 3), personalization: fill(12, 4) })
        expect(hex(noble)).toBe(RFC9106)
    })

    nodeLeg('KA1: RFC 9106 section 5.3 through node:crypto', () => {
        const fill = (length: number, value: number) => Buffer.alloc(length, value)
        const node = argon2Sync('argon2id', { message: fill(32, 1), nonce: fill(16, 2), secret: fill(8, 3), associatedData: fill(12, 4), parallelism: 4, tagLength: 32, memory: 32, passes: 3 })
        expect(Buffer.from(node).toString('hex')).toBe(RFC9106)
    })

    test('KA2: the PHC reference vector through deriveKek (hash-wasm)', async () => {
        const derived = await deriveKek(Buffer.from('password'), Buffer.from('somesalt'), { m: 65536, t: 2, p: 1 })
        expect(hex(derived)).toBe(PHC)
    })

    nodeLeg('KA2: the PHC reference vector through node:crypto', () => {
        const node = argon2Sync('argon2id', { message: Buffer.from('password'), nonce: Buffer.from('somesalt'), parallelism: 1, tagLength: 32, memory: 65536, passes: 2 })
        expect(Buffer.from(node).toString('hex')).toBe(PHC)
    })

    test('KA3: deriveKek equals @noble/hashes (and node:crypto where it exists) over a grid of parameters', async () => {
        const password = Buffer.from('päss 한글', 'utf8')
        const salt = Buffer.alloc(16, 0x5a)
        for (const [m, t, p] of [[8, 1, 1], [16, 2, 2], [256, 2, 1], [1024, 3, 1], [1000, 1, 1], [4096, 1, 4], [64, 5, 8]]) {
            const ours = await deriveKek(password, salt, { m, t, p })
            const noble = argon2id(password, salt, { t, m, p, dkLen: 32 })
            expect(hex(ours), `m=${m} t=${t} p=${p} noble`).toBe(hex(noble))
            if (HAS_NODE_ARGON2) {
                const node = argon2Sync('argon2id', { message: password, nonce: salt, parallelism: p, tagLength: 32, memory: m, passes: t })
                expect(hex(ours), `m=${m} t=${t} p=${p} node`).toBe(Buffer.from(node).toString('hex'))
            }
        }
    })

    test('the output is 32 bytes and a returned plain Uint8Array', async () => {
        const derived = await deriveKek(Buffer.from('pw'), Buffer.alloc(16, 1), { m: 8, t: 1, p: 1 })
        expect(derived).toBeInstanceOf(Uint8Array)
        expect(derived.length).toBe(32)
    })
})
