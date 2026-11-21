import { afterEach, describe, expect, it } from 'vitest'
import { changeLanguage, language } from 'src/lang'
import {
    armTrigger,
    expectEveryTriggerFired,
    isRestoreCheckText,
    isRestoreCopyText,
    restoreCheckPercent,
    restoreCopyPercent,
} from './restoreWaitText'

// Diagnostic: the helper is new test support, so there is no pre-fix base for it.
describe('restore wait text matchers', () => {
    afterEach(() => {
        changeLanguage('en')
    })

    it.each(['en', 'ko'])('accepts every integer percent of both texts in %s and rejects the other key', (lang) => {
        changeLanguage(lang)
        for (let percent = 0; percent <= 100; percent++) {
            expect(isRestoreCheckText(language.rtbRestoreChecking(percent))).toBe(true)
            expect(isRestoreCopyText(language.rtbRestoreCopying(percent))).toBe(true)
            expect(isRestoreCheckText(language.rtbRestoreCopying(percent))).toBe(false)
            expect(isRestoreCopyText(language.rtbRestoreChecking(percent))).toBe(false)
            expect(restoreCopyPercent(language.rtbRestoreCopying(percent))).toBe(percent)
            expect(restoreCheckPercent(language.rtbRestoreChecking(percent))).toBe(percent)
        }
    })

    it('rejects the old English texts, a fractional percent and out-of-range percents', () => {
        changeLanguage('en')
        expect(isRestoreCheckText('Checking local backup... (50.00%)')).toBe(false)
        expect(isRestoreCopyText('Loading local Backup... (100.00%)')).toBe(false)
        expect(isRestoreCopyText(language.rtbRestoreCopying(99.5))).toBe(false)
        expect(isRestoreCopyText(language.rtbRestoreCopying(101))).toBe(false)
        expect(restoreCopyPercent('unrelated')).toBeNull()
    })
})

describe('trigger guard', () => {
    afterEach(() => {
        // Drop whatever the cases below left armed so this file's own guard does not fail them.
        try {
            expectEveryTriggerFired()
        } catch {
            // Each case asserts its own outcome.
        }
    })

    it('throws for an unfired fires trigger and clears the registry', () => {
        armTrigger('never hit')
        expect(() => expectEveryTriggerFired()).toThrow('trigger "never hit" was armed but never fired')
        expect(() => expectEveryTriggerFired()).not.toThrow()
    })

    it('passes a fired fires trigger and an unfired never trigger', () => {
        const fires = armTrigger('fires')
        armTrigger('stays quiet', { expect: 'never' })
        fires.hit()
        expect(fires.fired()).toBe(1)
        expect(() => expectEveryTriggerFired()).not.toThrow()
    })

    it('throws for a fired never trigger', () => {
        const quiet = armTrigger('expected quiet', { expect: 'never' })
        quiet.hit()
        expect(() => expectEveryTriggerFired()).toThrow('trigger "expected quiet" fired but was expected not to')
    })
})
