// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    canShowAll, defaultVisibleModes, HOME_MODES, isRepairState, lockOf, normalizeHideUnusedModes, normalizeVisibleModes,
    setHideUnusedModes, setVisibleModes, shownModes, showAllModes, withModeToggled,
    type HomeMode, type ModeState,
} from './homeModes'

/**
 * The pure rules behind the profile-wide mode set (CHORE-584): normalisation, the lock table, the repair state and the
 * setters. The remembered set is kept while hiding is off (DS-170), so only `setVisibleModes` and `showAllModes` ever
 * write it.
 */

const ALL: HomeMode[] = ['rp', 'hybrid', 'utility']

const state = (visibleModes: HomeMode[], hideUnusedModes: boolean): ModeState => ({ visibleModes, hideUnusedModes })

describe('normalizeVisibleModes', () => {
    test.each([
        ['an empty array', []],
        ['an array with no valid token', ['bogus', 3, null]],
        ['a string', 'rp'],
        ['null', null],
        ['undefined', undefined],
        ['an object', { 0: 'rp' }],
    ])('%s gives all three modes', (_label, value) => {
        expect(normalizeVisibleModes(value)).toEqual(ALL)
    })

    test('unknown tokens are dropped', () => {
        expect(normalizeVisibleModes(['rp', 'bogus', 'utility'])).toEqual(['rp', 'utility'])
    })

    test('duplicates are removed', () => {
        expect(normalizeVisibleModes(['hybrid', 'hybrid', 'hybrid'])).toEqual(['hybrid'])
    })

    test('the order is canonical, not the input order', () => {
        expect(normalizeVisibleModes(['utility', 'rp', 'hybrid'])).toEqual(ALL)
        expect(normalizeVisibleModes(['utility', 'rp'])).toEqual(['rp', 'utility'])
    })

    test('the result is a new array, also when the input is already canonical', () => {
        const input: HomeMode[] = ['rp', 'hybrid']
        const out = normalizeVisibleModes(input)
        expect(out).toEqual(input)
        expect(out).not.toBe(input)
    })

    test('defaultVisibleModes is a fresh array on every call', () => {
        const a = defaultVisibleModes()
        a.pop()
        expect(defaultVisibleModes()).toEqual(ALL)
        expect(HOME_MODES).toEqual(ALL)
    })
})

describe('normalizeHideUnusedModes', () => {
    test.each([['yes'], [1], [null], [undefined], ['true'], [0], [{}]])('%s is false', (value) => {
        expect(normalizeHideUnusedModes(value)).toBe(false)
    })

    test('only the boolean true is true', () => {
        expect(normalizeHideUnusedModes(true)).toBe(true)
        expect(normalizeHideUnusedModes(false)).toBe(false)
    })
})

describe('shownModes, isRepairState, canShowAll', () => {
    test('with hiding off every mode is shown whatever the remembered set holds', () => {
        expect(shownModes(state(['hybrid'], false))).toEqual(ALL)
    })

    test('with hiding on the remembered set is shown', () => {
        expect(shownModes(state(['utility', 'rp'], true))).toEqual(['rp', 'utility'])
    })

    test('the repair state needs hiding on and fewer than three shown', () => {
        expect(isRepairState(state(['hybrid'], true))).toBe(true)
        expect(isRepairState(state(['rp', 'hybrid'], true))).toBe(true)
        expect(isRepairState(state(ALL, true))).toBe(false)
        expect(isRepairState(state(['hybrid'], false))).toBe(false)
    })

    test('show-all has work only while a mode is hidden', () => {
        expect(canShowAll(state(['hybrid'], true))).toBe(true)
        expect(canShowAll(state(ALL, true))).toBe(false)
        expect(canShowAll(state(['hybrid'], false))).toBe(false)
    })
})

describe('lockOf', () => {
    test('every mode is locked off while hiding is off', () => {
        for (const mode of ALL) {
            expect(lockOf(mode, state(ALL, false))).toBe('off')
            expect(lockOf(mode, state(['hybrid'], false))).toBe('off')
        }
    })

    test('the only visible mode is locked last when hiding is on', () => {
        expect(lockOf('hybrid', state(['hybrid'], true))).toBe('last')
        expect(lockOf('rp', state(['hybrid'], true))).toBeNull()
    })

    test('no mode is locked while several are visible and hiding is on', () => {
        for (const mode of ALL) {
            expect(lockOf(mode, state(['rp', 'hybrid'], true))).toBeNull()
        }
    })
})

describe('withModeToggled', () => {
    test('a write is refused while hiding is off', () => {
        expect(withModeToggled(state(['hybrid'], false), 'rp', true)).toBeNull()
        expect(withModeToggled(state(ALL, false), 'rp', false)).toBeNull()
    })

    test('unchecking the last visible mode is refused', () => {
        expect(withModeToggled(state(['hybrid'], true), 'hybrid', false)).toBeNull()
    })

    test('checking a mode while another is the last one is allowed and keeps canonical order', () => {
        expect(withModeToggled(state(['hybrid'], true), 'rp', true)).toEqual(['rp', 'hybrid'])
    })

    test('unchecking one of several is allowed', () => {
        expect(withModeToggled(state(ALL, true), 'hybrid', false)).toEqual(['rp', 'utility'])
    })

    test('the result is a new array and the input state is not mutated', () => {
        const visible: HomeMode[] = ['rp', 'hybrid']
        const out = withModeToggled(state(visible, true), 'utility', true)
        expect(out).toEqual(ALL)
        expect(out).not.toBe(visible)
        expect(visible).toEqual(['rp', 'hybrid'])
    })
})

describe('setters', () => {
    test('setVisibleModes assigns a normalised new array and aliases neither the old array nor the caller array', () => {
        const old: HomeMode[] = ['rp', 'hybrid', 'utility']
        const target = { visibleModes: old, hideUnusedModes: true }
        const input: HomeMode[] = ['utility', 'rp']
        setVisibleModes(target, input)

        expect(target.visibleModes).toEqual(['rp', 'utility'])
        expect(target.visibleModes).not.toBe(old)
        expect(target.visibleModes).not.toBe(input)
        expect(old).toEqual(ALL)
        expect(input).toEqual(['utility', 'rp'])
    })

    test('setHideUnusedModes leaves the remembered set the same array with the same value, on and off', () => {
        const remembered: HomeMode[] = ['hybrid']
        const target = { visibleModes: remembered, hideUnusedModes: false }

        setHideUnusedModes(target, true)
        expect(target.hideUnusedModes).toBe(true)
        expect(target.visibleModes).toBe(remembered)
        expect(target.visibleModes).toEqual(['hybrid'])

        setHideUnusedModes(target, false)
        expect(target.hideUnusedModes).toBe(false)
        expect(target.visibleModes).toBe(remembered)
        expect(target.visibleModes).toEqual(['hybrid'])
    })

    test('showAllModes assigns all three modes in a fresh array and turns hiding off', () => {
        const old: HomeMode[] = ['hybrid']
        const target = { visibleModes: old, hideUnusedModes: true }
        showAllModes(target)

        expect(target.visibleModes).toEqual(ALL)
        expect(target.visibleModes).not.toBe(old)
        expect(target.hideUnusedModes).toBe(false)
        expect(old).toEqual(['hybrid'])
    })
})
