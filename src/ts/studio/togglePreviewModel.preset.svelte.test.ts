// The panel id of a preset's source follows whether the preset is the active one, because the chat panel names only the
// active preset's text ('prompt'); an inactive preset has no source there, so no text replaces anything.
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})

import { DBState } from 'src/ts/stores.svelte'
import type { SourceInput } from '../chatShell/togglePanel'
import { presetNamed, seedPresetDb } from './edit/tests/presetFixture.test-helpers'
import { panelIdOf, withCurrentText } from './togglePreviewModel'

let ids: string[]

beforeEach(() => {
    ids = seedPresetDb([presetNamed('P', 'a=Zero\n'), presetNamed('Q', 'b=One\n')], 0, 'a=Zero\n')
})

const sources: SourceInput[] = [
    { id: 'prompt', kind: 'prompt', name: 'Prompt', text: 'a=Zero\n' },
    { id: 'character:A', kind: 'character', name: 'Char', text: 'ch=Char\n' },
]

describe('T9 the panel id of a preset', () => {
    test('is prompt while the preset is active and the id key otherwise, and follows a switch', () => {
        expect(panelIdOf({ kind: 'preset', presetId: ids[0] })).toBe('prompt')
        expect(panelIdOf({ kind: 'preset', presetId: ids[1] })).toBe(`preset:${ids[1]}`)
        DBState.db.botPresetsId = 1
        expect(panelIdOf({ kind: 'preset', presetId: ids[0] })).toBe(`preset:${ids[0]}`)
        expect(panelIdOf({ kind: 'preset', presetId: ids[1] })).toBe('prompt')
    })

    test('the current text replaces the prompt source only for the active preset', () => {
        const text = 'a=Edited\n'
        const active = withCurrentText(sources, { panelId: panelIdOf({ kind: 'preset', presetId: ids[0] }), text })
        expect(active.map((input) => input.text)).toEqual([text, 'ch=Char\n'])
        const inactive = withCurrentText(sources, { panelId: panelIdOf({ kind: 'preset', presetId: ids[1] }), text })
        expect(inactive.map((input) => input.text)).toEqual(['a=Zero\n', 'ch=Char\n'])
    })
})
