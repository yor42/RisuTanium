// What the latest commit says about one preset's toggle edit. Pure: the unsavable set and the live preset lookup are
// injected. New-rule guards: the module is new, so each row fails before the change only through the missing module; each
// row except V1 (a baseline guard that passes under every mutant) is bound to a scratch mutant of the verdict.
import { describe, expect, test } from 'vitest'
import type { SkippedItemScope } from 'src/ts/storage/store2/codec/types'
import { presetCommitVerdict } from '../presetCommitVerdict'

function probe(unsavable: string[], live = true) {
    const set = new Set(unsavable)
    return {
        isItemUnsavable: (scope: SkippedItemScope, key: string) => set.has(`${scope}:${key}`),
        presetLive: () => live,
    }
}

describe('presetCommitVerdict', () => {
    test('V1 a clean commit of a live preset is saved', () => {
        expect(presetCommitVerdict('p1', probe([]))).toBe('saved')
    })

    test('V2 a carried preset list is blocked, which Retry can only re-ask', () => {
        expect(presetCommitVerdict('p1', probe(['presets:presets']))).toBe('blocked')
    })

    test('V3 a refused working setting a preset field lives in is unsavable', () => {
        expect(presetCommitVerdict('p1', probe(['settings:customPromptTemplateToggle']))).toBe('unsavable')
    })

    test('V4 a preset that is not exactly one live preset is blocked', () => {
        expect(presetCommitVerdict('p1', probe([], false))).toBe('blocked')
    })

    test('V5 an unrelated refused setting and other scopes do not count', () => {
        expect(presetCommitVerdict('p1', probe(['settings:someOtherKey', 'module:customPromptTemplateToggle', 'presets:other']))).toBe('saved')
    })

    test('V6 a refused working setting outranks a carried list and a gone preset', () => {
        expect(presetCommitVerdict('p1', probe(['presets:presets', 'settings:customPromptTemplateToggle'], false))).toBe('unsavable')
        expect(presetCommitVerdict('p1', probe(['presets:presets'], false))).toBe('blocked')
    })

    test('V7 a refused active regex list is unsavable', () => {
        expect(presetCommitVerdict('p1', probe(['settings:presetRegex']))).toBe('unsavable')
    })

    test('V8 a refused regex list outranks a carried list and a gone preset', () => {
        expect(presetCommitVerdict('p1', probe(['presets:presets', 'settings:presetRegex'], false))).toBe('unsavable')
    })
})