// @vitest-environment jsdom
/**
 * The Combined entries: the rows, their order, their numbers and the partial notice must be exactly what
 * `mergedView` computes, so a UI that re-sorts, renumbers or drops the notice fails here. The stores and the
 * locale are replaced; the owner model, the merged view and the screen store are real.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { buildMergedView, type MergedKind } from '../../ts/studio/mergedView'
import { buildOwnerModel } from '../../ts/studio/ownerModel'
import {
    makeCharacter,
    makeChat,
    makeInput,
    makePreset,
    regexEntries,
    residentModule,
    stubModule,
    studioDbOf,
} from '../../ts/studio/studioFixtures.test-helpers'

const db = $state({ db: {} as ReturnType<typeof studioDbOf> })
const selection = $state({ selId: 0 })
const ReloadGUIPointer = writable(0)
const MobileGUI = writable(false)
const settingsOpen = writable(false)
const CharConfigSubMenu = writable(0)
const SettingsMenuIndex = writable(-1)
const botMakerMode = writable(false)
const sideBarStore = writable(false)
const QuickSettings = $state({ open: true })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('../../ts/stores.svelte', () => ({
    get DBState() { return db },
    get selIdState() { return selection },
    get ReloadGUIPointer() { return ReloadGUIPointer },
    get MobileGUI() { return MobileGUI },
    get settingsOpen() { return settingsOpen },
    get CharConfigSubMenu() { return CharConfigSubMenu },
    get SettingsMenuIndex() { return SettingsMenuIndex },
    get botMakerMode() { return botMakerMode },
    get sideBarStore() { return sideBarStore },
    get QuickSettings() { return QuickSettings },
}))
vi.mock('../../ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('../../lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import { resetStudioScreenForTests, studioScreen } from '../../ts/studio/studioScreen.svelte'
import { setWindowGeometryForTests, type WindowGeometry } from '../../ts/windowing/windowHost.svelte'
import StudioCombined, { combinedKeyOf, combinedKindOf } from './StudioCombined.svelte'

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined

function inputOf(withStub: boolean) {
    return makeInput({
        character: makeCharacter({
            customscript: regexEntries(2, 'char'),
            globalLore: [{ comment: 'char lore', key: 'k', mode: 'normal' }],
            chats: [makeChat({ id: 'chat-1', name: 'First chat', localLore: [{ comment: 'chat lore', key: 'k', mode: 'normal' }] })],
            modules: withStub ? ['stub', 'res'] : ['res'],
        }),
        presets: [makePreset('P0', { regex: regexEntries(2, 'preset') })],
        activePreset: 0,
        modules: withStub
            ? [stubModule('stub'), residentModule('res', { regex: [{ comment: 'mod', in: 'a', out: 'b', type: 'editdisplay' }] })]
            : [residentModule('res', { regex: [{ comment: 'mod', in: 'a', out: 'b', type: 'editdisplay' }] })],
    })
}

function show(input: ReturnType<typeof inputOf>, kind: MergedKind): void {
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(StudioCombined, { target: host, props: { model: buildOwnerModel(input), kind } })
    flushSync()
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const rowElements = () => Array.from(document.querySelectorAll<HTMLElement>('[data-part="studio-combined-row"]'))

beforeEach(() => {
    resetStudioScreenForTests()
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    host = undefined
    resetStudioScreenForTests()
})

describe('combined selection keys', () => {
    test('only the mergeable kinds have a key, and a real owner key is never one', () => {
        expect(combinedKindOf(combinedKeyOf('regex'))).toBe('regex')
        expect(combinedKindOf(combinedKeyOf('lore'))).toBe('lore')
        expect(combinedKindOf(combinedKeyOf('toggles'))).toBe('toggles')
        expect(combinedKindOf('combined:scripts')).toBeNull()
        expect(combinedKindOf('character:cha-1')).toBeNull()
        expect(combinedKindOf(null)).toBeNull()
    })
})

describe('3d regex entry', () => {
    test('rows come in the merged view order with its numbers and no notice when everything shows', () => {
        const input = inputOf(false)
        show(input, 'regex')
        const expected = buildMergedView(buildOwnerModel(input)).groups.find((group) => group.kind === 'regex')!.rows()
        expect(expected.length).toBe(5)
        expect(rowElements().map((element) => element.dataset.itemId)).toEqual(expected.map((row) => row.item.id))
        expect(rowElements().map((element) => element.dataset.itemId)).toEqual([
            '0/regex:0', '0/regex:1', 'cha-1/regex:0', 'cha-1/regex:1', 'res/regex:0',
        ])
        expect(rowElements().map((element) => element.querySelector('[data-part="studio-combined-ordinal"]')?.textContent)).toEqual(['1', '2', '3', '4', '5'])
        expect(part('studio-combined-partial')).toBeNull()
        expect(part('studio-combined')?.textContent).toContain('studioMergedOrdered')
    })

    test('numbering stops after a part that cannot be shown and the partial notice says how many', () => {
        const input = inputOf(true)
        show(input, 'regex')
        const group = buildMergedView(buildOwnerModel(input)).groups.find((candidate) => candidate.kind === 'regex')!
        expect(group.unshownSegments).toBe(1)
        expect(part('studio-combined-partial')?.textContent).toBe(`studioMergedPartial(${group.unshownSegments})`)
        const shown = rowElements().map((element) => ({
            id: element.dataset.itemId,
            numbered: element.dataset.numbered,
            ordinal: element.querySelector('[data-part="studio-combined-ordinal"]')?.textContent,
        }))
        expect(shown).toEqual(group.rows().map((row) => ({
            id: row.item.id,
            numbered: String(row.ordinal !== null),
            ordinal: String(row.ordinal ?? row.position),
        })))
        expect(shown[shown.length - 1]).toEqual({ id: 'res/regex:0', numbered: 'false', ordinal: '1' })
    })

    test('opening a row selects that item of its owner', () => {
        show(inputOf(false), 'regex')
        rowElements()[2].click()
        flushSync()
        expect(studioScreen.selectedOwnerKey).toBe('character:cha-1')
        expect(studioScreen.selectedKind).toBe('regex')
        expect(studioScreen.selectedItemId).toBe('cha-1/regex:0')
        expect(studioScreen.detailShown).toBe(true)
    })
})

describe('3d lore entry', () => {
    test('the chat lore sits between the character and the modules', () => {
        show(inputOf(false), 'lore')
        expect(rowElements().map((element) => element.dataset.itemId)).toEqual(['cha-1/lore:0', 'chat-1/lore:0'])
    })

    test('private content is a part that cannot be shown', () => {
        const input = inputOf(false)
        input.character = { ...input.character, license: 'private' }
        show(input, 'lore')
        expect(rowElements()).toEqual([])
        expect(part('studio-combined-partial')?.textContent).toBe('studioMergedPartial(2)')
    })
})

describe('3d long lists are windowed', () => {
    const ROWS = 1000
    const BAND_PX = 500
    // A real row is 44 px; a band of 500 px holds about a dozen, and the overscan at most about as many again.
    const MOUNT_LIMIT = 40

    function longLore(count: number): ReturnType<typeof inputOf> {
        const input = inputOf(false)
        const globalLore = Array.from({ length: count }, (_, index) => ({ comment: `lore ${index}`, key: `k${index}`, mode: 'normal' }))
        input.character = { ...input.character, globalLore, chats: [makeChat({ id: 'chat-1', name: 'First chat' })] }
        return input
    }

    // The list's own element sits `top` px from the band's top; everything else reads as zero.
    function geometryAt(top: () => number): WindowGeometry {
        return {
            rectOf: (element) => ({ top: element instanceof HTMLElement && element.dataset.part === 'studio-combined-rows' ? top() : 0, height: 0 }),
            viewport: () => BAND_PX,
            scrollBy: () => {},
            schedule: (callback) => {
                callback()
                return () => {}
            },
        }
    }

    // The segment reads its top after it binds, so its rows mount one flush after the list.
    async function settle(): Promise<void> {
        await Promise.resolve()
        flushSync()
        await Promise.resolve()
        flushSync()
    }

    afterEach(() => setWindowGeometryForTests(undefined))

    test('a thousand lore entries mount only the rows near the band, with spacers for the rest', async () => {
        setWindowGeometryForTests(geometryAt(() => 0))
        show(longLore(ROWS), 'lore')
        await settle()
        const ids = rowElements().map((element) => element.dataset.itemId)
        expect(ids.length).toBeGreaterThan(0)
        expect(ids.length).toBeLessThanOrEqual(MOUNT_LIMIT)
        expect(ids[0]).toBe('cha-1/lore:0')
        expect(part('studio-combined-rows')?.querySelector('[data-window-spacer]')).not.toBeNull()
        expect(part('studio-combined-more')).toBeNull()
        const wrapper = rowElements()[0].closest('[data-window-key]')
        expect(wrapper?.getAttribute('aria-setsize')).toBe(String(ROWS))
        expect(wrapper?.getAttribute('aria-posinset')).toBe('1')
    })

    test('the last entry is reached by scrolling, with no Show more step, and keeps its merged number', async () => {
        // The list scrolled to its end: its top sits a full list height above the band, less one band.
        setWindowGeometryForTests(geometryAt(() => -(ROWS * 44 - BAND_PX)))
        show(longLore(ROWS), 'lore')
        await settle()
        const ids = rowElements().map((element) => element.dataset.itemId)
        expect(ids.length).toBeLessThanOrEqual(MOUNT_LIMIT)
        expect(ids).toContain(`cha-1/lore:${ROWS - 1}`)
        expect(ids).not.toContain('cha-1/lore:0')
        const last = rowElements().find((element) => element.dataset.itemId === `cha-1/lore:${ROWS - 1}`)!
        expect(last.querySelector('[data-part="studio-combined-ordinal"]')?.textContent).toBe(String(ROWS))
        expect(last.closest('[data-window-key]')?.getAttribute('aria-posinset')).toBe(String(ROWS))
    })

    test('a long regex list is windowed the same way', async () => {
        setWindowGeometryForTests(geometryAt(() => 0))
        const input = inputOf(false)
        input.character = { ...input.character, customscript: regexEntries(250, 'many') }
        show(input, 'regex')
        await settle()
        expect(rowElements().length).toBeLessThanOrEqual(MOUNT_LIMIT)
        expect(rowElements()[0].dataset.itemId).toBe('0/regex:0')
    })
})
