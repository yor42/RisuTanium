// @vitest-environment node
import { hkdfSync } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { encodeFixedPart } from 'src/ts/drive/rtb/sealed/format'
import { commitEquals, keyCommit, payloadKey } from 'src/ts/drive/rtb/sealed/keys'
import { VECTOR_INPUT } from './sealedReference'

const context = { fileId: new Uint8Array(VECTOR_INPUT.fileId), fixedPart: encodeFixedPart(VECTOR_INPUT.C, VECTOR_INPUT.fileId) }

function hex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('hex')
}

describe('key schedule', () => {
    test('the vector master key gives the vector payload key and key commitment', () => {
        expect(hex(payloadKey(VECTOR_INPUT.master, context))).toBe('ba05b2aeb68a6152119963dc220b41a5f886b9dd6673e492d1e9c9c3019bcc33')
        expect(hex(keyCommit(VECTOR_INPUT.master, context))).toBe('a546d0aad9d3f4ad520627a26273c2bccf8d3f5c625f5b73b7116ed711eccfd1')
    })

    test('both keys equal node:crypto HKDF with salt = file id and info = label || F', () => {
        const info = (label: string) => Buffer.concat([Buffer.from(label, 'ascii'), context.fixedPart])
        const payload = Buffer.from(hkdfSync('sha256', VECTOR_INPUT.master, context.fileId, info('RTBX v1 payload key'), 32))
        const commit = Buffer.from(hkdfSync('sha256', VECTOR_INPUT.master, context.fileId, info('RTBX v1 key commitment'), 32))
        expect(hex(payloadKey(VECTOR_INPUT.master, context))).toBe(payload.toString('hex'))
        expect(hex(keyCommit(VECTOR_INPUT.master, context))).toBe(commit.toString('hex'))
        expect(payload.equals(commit)).toBe(false)
    })

    test('KH1: RFC 5869 A.1 through the HKDF the engine uses', async () => {
        const { hkdf } = await import('@noble/hashes/hkdf.js')
        const { sha256 } = await import('@noble/hashes/sha2.js')
        const okm = hkdf(sha256, Buffer.alloc(22, 0x0b), Buffer.from('000102030405060708090a0b0c', 'hex'), Buffer.from('f0f1f2f3f4f5f6f7f8f9', 'hex'), 42)
        const expected = '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865'
        expect(hex(okm)).toBe(expected)
        const node = Buffer.from(hkdfSync('sha256', Buffer.alloc(22, 0x0b), Buffer.from('000102030405060708090a0b0c', 'hex'), Buffer.from('f0f1f2f3f4f5f6f7f8f9', 'hex'), 42))
        expect(node.toString('hex')).toBe(expected)
    })

    test('a change in any byte of F, in the file id or in the master key changes both keys', () => {
        const base = hex(payloadKey(VECTOR_INPUT.master, context))
        const baseCommit = hex(keyCommit(VECTOR_INPUT.master, context))
        for (let at = 0; at < context.fixedPart.length; at++) {
            const fixedPart = new Uint8Array(context.fixedPart)
            fixedPart[at] ^= 1
            expect(hex(payloadKey(VECTOR_INPUT.master, { fileId: context.fileId, fixedPart })), `F byte ${at}`).not.toBe(base)
            expect(hex(keyCommit(VECTOR_INPUT.master, { fileId: context.fileId, fixedPart })), `F byte ${at}`).not.toBe(baseCommit)
        }
        const otherId = new Uint8Array(context.fileId)
        otherId[0] ^= 1
        expect(hex(payloadKey(VECTOR_INPUT.master, { fileId: otherId, fixedPart: context.fixedPart }))).not.toBe(base)
        const otherMaster = new Uint8Array(VECTOR_INPUT.master)
        otherMaster[31] ^= 1
        expect(hex(payloadKey(otherMaster, context))).not.toBe(base)
    })
})

describe('commitEquals', () => {
    test('equal arrays match; any single differing byte, or a differing length, does not', () => {
        const a = new Uint8Array(32).fill(7)
        expect(commitEquals(a, new Uint8Array(a))).toBe(true)
        for (let at = 0; at < 32; at++) {
            const b = new Uint8Array(a)
            b[at] ^= 0x80
            expect(commitEquals(a, b), `byte ${at}`).toBe(false)
        }
        expect(commitEquals(a, a.subarray(0, 31))).toBe(false)
    })
})
