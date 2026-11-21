/**
 * `coldRestoreText.ts`: the wording of an archived-restore failure alert.
 *
 * Invariants: a slot with no name is given the shared unknown-name fallback, and each reason maps to
 * its own named message. Only `missing`, `mismatch` and `ambiguous` use the possible-data-loss text.
 */
import { describe, expect, test } from 'vitest'
import { language } from '../../../lang'
import { namedRestoreFailureText, restoreFailureName } from '../coldRestoreText'

describe('restoreFailureName', () => {
    test('uses the slot name, else the unknown-name fallback', () => {
        expect(restoreFailureName({ name: 'Ann' })).toBe('Ann')
        expect(restoreFailureName({ name: '' })).toBe(language.errors.coldStorageUnknownCharacterName)
        expect(restoreFailureName({})).toBe(language.errors.coldStorageUnknownCharacterName)
    })
})

describe('namedRestoreFailureText', () => {
    test('unreadable, unavailable and damaged each have their own named message', () => {
        expect(namedRestoreFailureText('Ann', 'unreadable')).toBe(language.errors.coldStorageNamedRestoreUnreadable('Ann'))
        expect(namedRestoreFailureText('Ann', 'unavailable')).toBe(language.errors.coldStorageNamedRestoreUnavailable('Ann'))
        expect(namedRestoreFailureText('Ann', 'damaged')).toBe(language.errors.coldStorageNamedRestoreDamaged('Ann'))
    })

    test.each(['missing', 'mismatch', 'ambiguous'] as const)('%s uses the possible-data-loss message', (reason) => {
        expect(namedRestoreFailureText('Ann', reason)).toBe(language.errors.coldStorageNamedRestoreFailed('Ann'))
    })

    test('the non-loss messages differ from the possible-data-loss one', () => {
        const loss = language.errors.coldStorageNamedRestoreFailed('Ann')
        for (const reason of ['unreadable', 'unavailable', 'damaged'] as const) {
            expect(namedRestoreFailureText('Ann', reason)).not.toBe(loss)
        }
    })
})
