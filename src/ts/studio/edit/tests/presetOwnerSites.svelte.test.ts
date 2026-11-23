// The places that decide something per owner kind, pinned for the preset owner: the name a result line shows, the
// refusal wording, the kind of the not-restored places list, the label of the toggle text, whether a private bound
// character hides its history and whether the restore sheet shows the chat note. A preset's toggle text is no
// registry target, so both place kinds label it with its raw path; the pinned answer is the character kind.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getSaveMarkCount: () => 0,
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { placeLabelOf } from 'src/ts/studio/assets/mergeCommit'
import { refusalTextOf } from 'src/ts/studio/edit/studioToasts'
import { moduleOwnerKey, parseOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { boundCharacterHides, hasChatNote } from 'src/ts/studio/history/ownerKindRules'
import { resetStudioScreenForTests, setStudioNotRestoredNotice, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { presetNameOf, presetOwnerKey } from '../presetTarget'
import { presetNamed, seedPresetDb } from './presetFixture.test-helpers'

let ids: string[]

beforeEach(() => {
    resetStudioScreenForTests()
    ids = seedPresetDb([presetNamed('Alpha', 'a'), presetNamed('', 'b')], 0, 'a')
})

afterEach(() => {
    resetStudioScreenForTests()
})

describe('ownerName', () => {
    test('is the preset name by id, and the id for a nameless or gone preset', () => {
        expect(presetNameOf(ids[0])).toBe('Alpha')
        expect(presetNameOf(ids[1])).toBe(ids[1])
        expect(presetNameOf('gone-id')).toBe('gone-id')
        DBState.db.botPresets.splice(0, 1)
        expect(presetNameOf(ids[0])).toBe(ids[0])
    })
})

describe('isModuleOwner wording', () => {
    test('a preset owner gets the generic refusal text, a module owner its own', () => {
        const generic = refusalTextOf({ reason: 'gone' })
        expect(refusalTextOf({ reason: 'gone' }, presetOwnerKey(ids[0]))).toBe(generic)
        expect(refusalTextOf({ reason: 'gone' }, moduleOwnerKey('M1'))).toBe(language.studioRefusalModuleGone)
        expect(generic).not.toBe(language.studioRefusalModuleGone)
    })
})

describe('place wording', () => {
    test('the not-restored list of a preset owner uses the character place kind', () => {
        setStudioNotRestoredNotice(presetOwnerKey(ids[0]), 'one place not restored', ['customModuleToggle'])
        expect(studioScreen.noticePlaces).toEqual({ ownerKind: 'character', places: ['customModuleToggle'] })
    })

    test('the toggle text has no registry label, so either place kind shows its raw path', () => {
        expect(placeLabelOf('character', 'customModuleToggle')).toBe('customModuleToggle')
        expect(placeLabelOf('module', 'customModuleToggle')).toBe('customModuleToggle')
    })
})

describe('panel rules', () => {
    test('a private or group bound character does not hide a preset owner, nor a module owner, and hides the others', () => {
        expect(boundCharacterHides(parseOwnerKey(presetOwnerKey(ids[0])))).toBe(false)
        expect(boundCharacterHides(parseOwnerKey(moduleOwnerKey('M1')))).toBe(false)
        expect(boundCharacterHides(parseOwnerKey('character:A'))).toBe(true)
        expect(boundCharacterHides(parseOwnerKey('chat:A/c1'))).toBe(true)
        expect(boundCharacterHides(null)).toBe(true)
    })

    test('the chat note belongs to a character restore point only', () => {
        expect(hasChatNote(parseOwnerKey(presetOwnerKey(ids[0])))).toBe(false)
        expect(hasChatNote(parseOwnerKey(moduleOwnerKey('M1')))).toBe(false)
        expect(hasChatNote(parseOwnerKey('chat:A/c1'))).toBe(false)
        expect(hasChatNote(parseOwnerKey('character:A'))).toBe(true)
        expect(hasChatNote(null)).toBe(false)
    })
})
