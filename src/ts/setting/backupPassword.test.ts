/**
 * The password rules of the "Make a backup" chooser (CHORE-128 S2). Compatibility guards of a new module: the
 * refusal comes from the engine's own password function, the match compares NFC forms, and the slow-connection
 * test names the same condition as the engine's cipher choice.
 */
import { describe, expect, test } from 'vitest'
import { selectAead } from '../drive/rtb/sealed/aead'
import { backupPasswordProblem, encryptionIsSlow } from './backupPassword'

const NFD = 'Test ' + String.fromCharCode(0x1112, 0x1161, 0x11ab, 0x1100, 0x1173, 0x11af) + ' 1'
const NFC = 'Test 한글 1'

describe('backupPasswordProblem (T-S2-1)', () => {
    test.each([
        ['empty', ''],
        ['a lone high surrogate', '\ud800'],
        ['a trailing high surrogate', 'ab\ud83d'],
        ['a lone low surrogate', 'x\ude00'],
    ])('the first entry is unusable: %s, even when the second is identical', (_name, text) => {
        expect(backupPasswordProblem(text, text)).toBe('unusable')
    })

    test('two different entries mismatch, and a leading space is part of the password', () => {
        expect(backupPasswordProblem('a', 'b')).toBe('mismatch')
        expect(backupPasswordProblem(' pw', 'pw')).toBe('mismatch')
        expect(backupPasswordProblem('pw', '')).toBe('mismatch')
    })

    test('equal entries pass, and so do NFD and NFC spellings of one text', () => {
        expect(backupPasswordProblem('pw', 'pw')).toBeNull()
        expect(NFD).not.toBe(NFC)
        expect(backupPasswordProblem(NFD, NFC)).toBeNull()
        expect(backupPasswordProblem(NFC, NFD)).toBeNull()
    })

    test('an unusable first entry wins over a mismatch', () => {
        expect(backupPasswordProblem('', 'x')).toBe('unusable')
    })
})

describe('encryptionIsSlow (T-S2-2)', () => {
    test('it is the engine\'s own choice of the script cipher', () => {
        const withSubtle = { crypto: { subtle: globalThis.crypto.subtle } }
        const without = { crypto: {} }
        expect(encryptionIsSlow(withSubtle)).toBe(false)
        expect(encryptionIsSlow(without)).toBe(true)
        expect(encryptionIsSlow({})).toBe(true)
        expect(selectAead(withSubtle).name === 'noble').toBe(encryptionIsSlow(withSubtle))
        expect(selectAead(without).name === 'noble').toBe(encryptionIsSlow(without))
    })
})
