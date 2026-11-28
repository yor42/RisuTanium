// @vitest-environment jsdom
/**
 * The group visit's entry rules: which selections offer a visit (`studioVisitKind`), how `openStudio` names a group's
 * target, that the content links (Home, toggle links, lore-used taps) keep their character-only answers, the
 * group-only owner model and the classic destination of a group. Stores and the module lister are replaced; the
 * screen store, the switch, the owner source and the owner model are real.
 *
 * Classes: T1 and T3 reproduce the group case (a group was refused and had no model); T2, T2c are compatibility
 * guards that pass before and after the change; T33 reproduces the close watcher.
 */
import { flushSync } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    listerOver,
    makeCharacter,
    makeChat,
    makeInput,
    makePlugin,
    makePreset,
    residentModule,
    studioDbOf,
} from './studioFixtures.test-helpers'

const db = $state({ db: {} as Record<string, unknown> & { characters: Record<string, unknown>[], modules: never[] } })
const selection = $state({ selId: 0 })
const ReloadGUIPointer = writable(0)
const MobileGUI = writable(false)
const settingsOpen = writable(false)
const selectedCharID = writable(0)

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('../stores.svelte', () => ({
    get DBState() { return db },
    get selIdState() { return selection },
    get ReloadGUIPointer() { return ReloadGUIPointer },
    get MobileGUI() { return MobileGUI },
    get settingsOpen() { return settingsOpen },
    get selectedCharID() { return selectedCharID },
    CharConfigSubMenu: writable(0),
    SettingsMenuIndex: writable(-1),
    botMakerMode: writable(false),
    sideBarStore: writable(false),
    QuickSettings: { open: true },
}))
vi.mock('../chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('../process/moduleRefList', () => ({
    moduleListOf: (ids: string[]) => listerOver(db.db.modules as never)(ids),
}))
// Home's own imports reach the character and cold-storage machinery, which this suite does not exercise.
vi.mock('../characters', () => ({ changeChar: vi.fn(), changeCharGeneration: vi.fn(), characterFormatUpdate: vi.fn(), supersedeChangeChar: vi.fn() }))
vi.mock('../process/coldCharacterRestore', () => ({ restoreColdCharacter: vi.fn() }))
vi.mock('../process/coldRestoreText', () => ({ namedRestoreFailureText: vi.fn(), restoreFailureName: vi.fn() }))
vi.mock('../alert', () => ({ alertError: vi.fn() }))
vi.mock('../caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../lang', () => ({ language: new Proxy({}, { get: (_, key) => typeof key === 'symbol' ? undefined : key }) }))
vi.mock('../../lib/UI/Home/homeView.svelte', () => ({ requestHomeLibrary: vi.fn(), requestHomeReturnFocus: vi.fn() }))

import { homeStudioAvailable } from '../../lib/UI/Home/homeStudio.svelte'
import { openLoreEntry } from '../chatShell/openLoreEntry'
import { classicDestinationOf } from './classicLinks.svelte'
import * as classicLinksModule from './classicLinks.svelte'
import { buildOwnerModel } from './ownerModel'
import { readOwnerModel } from './ownerSource.svelte'
import { openStudio, resetStudioScreenForTests, studioScreen } from './studioScreen.svelte'
import * as studioScreenModule from './studioScreen.svelte'
import { setStudioEnabled, studioEligible, studioVisitEligible, studioVisitKind } from './studioSwitch.svelte'
import { toggleLinkTarget } from './studioToggleLinks'
import { studioOpen } from './studioOpen'

const GROUP = 'grp-1'
const CHARACTER = 'cha-1'

function groupRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        chaId: GROUP, type: 'group', name: 'The group', chats: [{ id: 'g-chat', name: 'g', message: [] }], chatPage: 0,
        characters: [CHARACTER], characterTalks: [4 / 6], characterActive: [true], ...overrides,
    }
}

// A database with modules, presets and a plugin, so "the group model lists none of them" is not vacuous.
function setDb(groupOverrides: Record<string, unknown> = {}): void {
    const input = makeInput({
        character: makeCharacter({ chaId: CHARACTER, chats: [makeChat({ id: 'chat-1', name: 'First chat' })], modules: ['res'] }),
        modules: [residentModule('res')],
        presets: [makePreset('P0'), makePreset('P1')],
        activePreset: 0,
        plugins: [makePlugin('legacy', 1)],
    })
    const base = studioDbOf(input)
    db.db = { ...base, characters: [base.characters[0], groupRow(groupOverrides)] } as never
    selection.selId = 1
}

const ownerOfGroup = { owner: { type: 'character', id: GROUP }, from: 'chat' } as const

beforeEach(() => {
    localStorage.clear()
    resetStudioScreenForTests()
    settingsOpen.set(false)
    MobileGUI.set(false)
    setStudioEnabled(true)
    setDb()
})

afterEach(() => {
    vi.restoreAllMocks()
    resetStudioScreenForTests()
    setStudioEnabled(false)
    localStorage.clear()
})

describe('T1 a group selection offers a visit', () => {
    test('a loaded group is visit-eligible and opens the visit bound to the group', () => {
        expect(studioVisitKind()).toBe('group')
        expect(studioVisitEligible()).toBe(true)
        expect(openStudio(ownerOfGroup, null)).toBe(true)
        expect(get(studioOpen)).toBe(true)
        expect(studioScreen.open).toBe(true)
        expect(studioScreen.chaId).toBe(GROUP)
    })

    test('studioEligible keeps meaning character content: false for a group, true for a character', () => {
        expect(studioEligible()).toBe(false)
        selection.selId = 0
        expect(studioVisitKind()).toBe('character')
        expect(studioEligible()).toBe(true)
        expect(studioVisitEligible()).toBe(true)
    })

    test.each([
        ['a cold-storage group', () => { (db.db.characters[1] as Record<string, unknown>).coldstorage = 'stub' }],
        ['the playground', () => { (db.db.characters[1] as Record<string, unknown>).chaId = '§playground' }],
        ['the switch off', () => { setStudioEnabled(false) }],
        ['the mobile GUI', () => { MobileGUI.set(true) }],
        ['no selection', () => { selection.selId = -1 }],
    ])('%s is refused with no state change', (_name, arrange) => {
        arrange()
        expect(studioVisitKind()).toBeNull()
        expect(studioVisitEligible()).toBe(false)
        expect(openStudio({ owner: { type: 'character', id: db.db.characters[1]?.chaId as string }, from: 'chat' }, null)).toBe(false)
        expect(studioScreen.open).toBe(false)
        expect(get(studioOpen)).toBe(false)
    })
})

describe('openStudio names the group target', () => {
    test('a character ref of the selected group becomes a group owner on the basic kind', () => {
        expect(openStudio(ownerOfGroup, null)).toBe(true)
        expect(studioScreen.target).toEqual({ owner: { type: 'group', id: GROUP }, kind: 'basic', from: 'chat' })
    })

    test('a kind the target names is kept', () => {
        expect(openStudio({ ...ownerOfGroup, kind: 'lore' }, null)).toBe(true)
        expect(studioScreen.target.kind).toBe('lore')
        expect(studioScreen.target.owner).toEqual({ type: 'group', id: GROUP })
    })

    test('a character target is stored as given, with no kind added', () => {
        selection.selId = 0
        const target = { owner: { type: 'character', id: CHARACTER }, from: 'chat' } as const
        expect(openStudio(target, null)).toBe(true)
        expect(studioScreen.target).toEqual(target)
        expect('kind' in studioScreen.target).toBe(false)
    })

    test('a ref to another id is not normalised', () => {
        const target = { owner: { type: 'character', id: 'elsewhere' }, from: 'chat' } as const
        expect(openStudio(target, null)).toBe(true)
        expect(studioScreen.target).toEqual(target)
    })
})

describe('T2 Home offers a group entry (S8 follow-up #859)', () => {
    test('homeStudioAvailable is true for a loaded group and unchanged for a character', () => {
        expect(homeStudioAvailable(db.db.characters[1] as never)).toBe(true)
        expect(homeStudioAvailable(db.db.characters[0] as never)).toBe(true)
        expect(homeStudioAvailable({ ...db.db.characters[0], trashTime: 1 } as never)).toBe(false)
    })
})

describe('T2c content links keep opening classic for a group (compatibility guard)', () => {
    test('toggle links are null for character, module and preset owners', () => {
        expect(toggleLinkTarget({ type: 'character' })).toBeNull()
        expect(toggleLinkTarget({ type: 'module', moduleId: 'res' })).toBeNull()
        expect(toggleLinkTarget({ type: 'preset' })).toBeNull()
    })

    test.each(['character', 'chat', 'module'] as const)('a %s lore tap goes to the classic lorebook page', async (type) => {
        const open = vi.spyOn(studioScreenModule, 'openStudio')
        const classic = vi.spyOn(classicLinksModule, 'openInClassicEditor').mockReturnValue(true)
        await openLoreEntry({ owner: { type, id: 'x' }, kind: 'lore' }, document.createElement('button'))
        expect(open).not.toHaveBeenCalled()
        expect(classic).toHaveBeenCalledWith(type, 'lore')
    })
})

describe('T3 the group model holds the group alone', () => {
    test('one owner, the basic kind, no chat and empty lists, over a database with modules, presets and plugins', () => {
        const model = readOwnerModel(GROUP)
        expect(model).not.toBeNull()
        expect(model!.character.type).toBe('group')
        expect(model!.character.key).toBe(`group:${GROUP}`)
        expect(model!.character.name).toBe('The group')
        expect(model!.character.kinds().map((node) => node.kind)).toEqual(['basic'])
        expect(model!.chat).toBeNull()
        for (const list of [model!.modules, model!.otherModules, model!.presets, model!.otherPresets, model!.plugins]) expect(list).toEqual([])
        expect(model!.owners).toHaveLength(1)
        expect(model!.ownerByKey(`group:${GROUP}`)).toBe(model!.character)
        expect(model!.ownerOf('group', GROUP)).toBe(model!.character)
        expect(model!.ownerByKey(`character:${CHARACTER}`)).toBeUndefined()
        expect(model!.ownerByKey('module:res')).toBeUndefined()
    })

    test('a cold-storage group, a different id and a stored character as bound id have no group model', () => {
        expect(readOwnerModel('other')).toBeNull()
        ;(db.db.characters[1] as Record<string, unknown>).coldstorage = 'stub'
        expect(readOwnerModel(GROUP)).toBeNull()
    })

    test('a character visit builds the model the owner model builds from the same input', () => {
        selection.selId = 0
        const model = readOwnerModel(CHARACTER)!
        const expected = buildOwnerModel(makeInput({
            character: db.db.characters[0] as never,
            modules: [residentModule('res')],
            presets: [makePreset('P0'), makePreset('P1')],
            activePreset: 0,
            plugins: [makePlugin('legacy', 1)],
        }))
        expect(model.owners.map((owner) => owner.key)).toEqual(expected.owners.map((owner) => owner.key))
        expect(model.character.kinds().map((node) => node.kind)).toEqual(expected.character.kinds().map((node) => node.kind))
        expect(model.modules.length).toBe(expected.modules.length)
        expect(model.presets.length).toBe(expected.presets.length)
        expect(model.plugins.length).toBe(expected.plugins.length)
        expect(model.chat?.key).toBe(expected.chat?.key)
    })
})

describe('T33 classic destination and the close watcher', () => {
    test('a group owner links to the character Basic tab', () => {
        expect(classicDestinationOf('group', null)).toEqual({ where: 'character', tab: 0 })
        expect(classicDestinationOf('group', 'basic')).toEqual({ where: 'character', tab: 0 })
    })

    test('the visit stays open while the selection is unchanged and closes when it moves', () => {
        expect(openStudio(ownerOfGroup, null)).toBe(true)
        flushSync()
        expect(studioScreen.open).toBe(true)
        selection.selId = 0
        flushSync()
        expect(studioScreen.open).toBe(false)
    })

    test('the visit closes when the group is no longer visit-eligible', () => {
        expect(openStudio(ownerOfGroup, null)).toBe(true)
        flushSync()
        expect(studioScreen.open).toBe(true)
        ;(db.db.characters[1] as Record<string, unknown>).coldstorage = 'stub'
        flushSync()
        expect(studioScreen.open).toBe(false)
    })
})
