// @vitest-environment jsdom
/**
 * The combined toggles view: its sources come in the merged view's order, each is read on its own, a shared key names
 * the other owners of the app, and nothing here writes. The stores and the locale are replaced; the owner model, the
 * merged view, the pure models and the screen store are real. Guards by construction (class G) except CU-1, which
 * fails on the generic row list of the base.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { buildOwnerModel } from '../../ts/studio/ownerModel'
import { makeCharacter, makeChat, makeInput, makePreset, residentModule, stubModule, studioDbOf } from '../../ts/studio/studioFixtures.test-helpers'

vi.mock('../../ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => 0,
    readImage: () => Promise.resolve(undefined),
    getFileSrc: () => Promise.resolve(''),
    saveAsset: vi.fn(),
    aiWatermarkingLawApplies: () => false,
}))

const db = $state({ db: {} as ReturnType<typeof studioDbOf> & Record<string, unknown> })
const selection = $state({ selId: 0 })
const ReloadGUIPointer = writable(0)
const MobileGUI = writable(false)
const settingsOpen = writable(false)
const CharConfigSubMenu = writable(0)
const SettingsMenuIndex = writable(-1)
const botMakerMode = writable(false)
const sideBarStore = writable(false)
const selectedCharID = writable(0)
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
    get selectedCharID() { return selectedCharID },
    get QuickSettings() { return QuickSettings },
}))
vi.mock('../../ts/storage/database.svelte', () => ({ appVer: '1', getCurrentCharacter: () => undefined, getCurrentChat: () => undefined, getDatabase: () => db.db }))
vi.mock('../../ts/process/modules', () => ({ getModules: () => [], getModuleToggles: () => '', getModuleAssets: () => [] }))
vi.mock('../../ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('../../ts/alertPrompts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../ts/alertPrompts')>()), pageCovered: () => false }))
vi.mock('../../lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const withArguments = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const own: Record<string, unknown> = {}
    for (const key of ['studioTgCombinedShared', 'studioTgUnreadableCount', 'studioTgPreviewKeyTip', 'studioTgPreviewGroupCount', 'studioTgPreviewHidden', 'studioTgPreviewSelected']) own[key] = withArguments(key)
    return { language: new Proxy(base, { get: (target, key) => typeof key === 'string' && key in own ? own[key] : Reflect.get(target, key) }) }
})

import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'
import { installStudioBack } from '../../ts/studio/studioBack.svelte'
import { resetStudioScreenForTests, studioScreen } from '../../ts/studio/studioScreen.svelte'
import StudioCombined from './StudioCombined.svelte'

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined

const OTHER = 'tone=Tone=check\nbob=Bob=check'

function inputOf(overrides: { secret?: boolean } = {}) {
    return makeInput({
        character: makeCharacter({
            chaId: 'cha-1',
            name: 'Alice',
            customModuleToggle: 'tone=Tone=check\nch=Char=check\nbad line\nanother bad line',
            chats: [makeChat({ id: 'chat-1' })],
            modules: ['stub', 'res'],
            ...(overrides.secret ? { license: 'private' } : {}),
        } as Parameters<typeof makeCharacter>[0]),
        presets: [makePreset('P0', { toggles: 'tone=Tone=check\np=Pre=check\ng=Open=group\ng1=Inner=check' }), makePreset('P1', { toggles: 'tone=Tone=check\nonly1=Only=check' })],
        activePreset: 0,
        enabledModules: ['stub', 'res'],
        modules: [
            stubModule('stub'),
            residentModule('res', { customModuleToggle: 'm=Mod=check\ngr=Grp=group\nin=In=check\ngr_end=x=groupEnd' }),
            residentModule('off', { customModuleToggle: 'offkey=Dim=check' }),
        ],
    })
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const sources = () => parts('studio-tg-combined-source')
const entriesOf = (source: HTMLElement) => Array.from(source.querySelectorAll<HTMLElement>('[data-part="studio-tg-combined-entry"]')).map((entry) => entry.dataset.key)

async function show(input: ReturnType<typeof inputOf>, kind: 'toggles' | 'lore' = 'toggles'): Promise<void> {
    const rows = [...studioDbOf(input).characters]
    db.db = {
        ...studioDbOf(input),
        characters: [
            ...rows,
            { chaId: 'B', type: 'character', name: 'Bob', customModuleToggle: OTHER, chats: [], chatPage: 0 },
            { chaId: 'S', type: 'character', name: 'Secret', license: 'private', customModuleToggle: 'tone=Tone=check\nhush=Hush=check', chats: [], chatPage: 0 },
        ],
    } as unknown as typeof db.db
    selection.selId = 0
    studioScreen.chaId = 'cha-1'
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(StudioCombined, { target: host, props: { model: buildOwnerModel(input), kind } })
    flushSync()
    // The toggles view is loaded when its kind is first shown.
    if (kind === 'toggles') await vi.waitFor(() => expect(part('studio-tg-combined')).not.toBeNull())
}

// The sheet is loaded on the first opening.
beforeAll(async () => {
    await import('./StudioTogglePreview.svelte')
    await import('./StudioToggleCombined.svelte')
}, 120_000)

beforeEach(() => {
    resetStudioScreenForTests()
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    host = undefined
    resetStudioScreenForTests()
    resetBackHandlersForTests()
})

describe('CU-1 the combined toggles of the chat', () => {
    test('one list per source in the merged order with the off module after, dimmed, and no generic row list', async () => {
        await show(inputOf())
        expect(parts('studio-combined-row')).toEqual([])
        expect(sources().map((source) => source.dataset.ownerKey)).toEqual(['preset:0', 'module:res', 'character:cha-1', 'module:off'])
        expect(entriesOf(sources()[0])).toEqual(['tone', 'p', 'g1'])
        expect(entriesOf(sources()[1])).toEqual(['m', 'in'])
        expect(entriesOf(sources()[2])).toEqual(['tone', 'ch'])
        expect(sources()[3].hasAttribute('data-off')).toBe(true)
        expect(sources()[3].className).toContain('opacity-60')
        expect(sources().slice(0, 3).some((source) => source.hasAttribute('data-off'))).toBe(false)
        expect(part('studio-tg-combined-off')?.textContent).toBe('studioTgCombinedOff')
        expect(part('studio-combined')?.textContent).toContain('studioMergedOrdered')
    })

    test('an active module that is not loaded is counted in the partial note and gets no list', async () => {
        await show(inputOf())
        expect(part('studio-combined-partial')?.textContent).toBe('studioMergedPartial(1)')
        expect(sources().map((source) => source.dataset.ownerKey)).not.toContain('module:stub')
    })

    test('a group and its label sit above the rows it holds', async () => {
        await show(inputOf())
        const groups = parts('studio-tg-combined-group').map((group) => group.textContent)
        expect(groups).toEqual(['Open', 'Grp'])
    })

    test('a key that other owners define carries a badge naming them, the other presets and characters included, never a private one', async () => {
        await show(inputOf())
        const badgeOf = (source: HTMLElement, key: string) => source.querySelector<HTMLElement>(`[data-part="studio-tg-combined-entry"][data-key="${key}"] [data-part="studio-tg-combined-shared"]`)?.textContent
        expect(badgeOf(sources()[0], 'tone')).toBe('studioTgCombinedShared(Alice, Bob, P1)')
        expect(badgeOf(sources()[2], 'tone')).toBe('studioTgCombinedShared(P0, Bob, P1)')
        expect(badgeOf(sources()[0], 'p')).toBeUndefined()
        expect(document.body.textContent).not.toContain('Secret')
        expect(document.body.textContent).not.toContain('hush')
    })

    test('a group left open names only its own source, and unreadable lines are counted for their own source', async () => {
        await show(inputOf())
        expect(sources().map((source) => source.querySelector('[data-part="studio-tg-combined-unclosed"]') !== null)).toEqual([true, false, false, false])
        expect(sources().map((source) => source.querySelector('[data-part="studio-tg-combined-unreadable"]')?.textContent ?? null)).toEqual([null, null, 'studioTgUnreadableCount(2)', null])
    })

    test('a private bound character is a part that cannot be shown and none of its keys appear', async () => {
        await show(inputOf({ secret: true }))
        expect(sources().map((source) => source.dataset.ownerKey)).not.toContain('character:cha-1')
        expect(part('studio-combined-partial')?.textContent).toBe('studioMergedPartial(2)')
        expect(document.body.textContent).not.toContain('Char')
    })

    test('with no toggles in any source the view says so', async () => {
        await show(makeInput({ character: makeCharacter({ chaId: 'cha-1' }), modules: [], presets: [], activePreset: -1 }) as ReturnType<typeof inputOf>)
        expect(part('studio-tg-combined-empty')?.textContent).toBe('studioTgCombinedEmpty')
    })

    test('only a page of entries is drawn and Show more draws the next', async () => {
        const input = inputOf()
        const many = Array.from({ length: 250 }, (_, index) => `k${index}=T${index}=check`).join('\n')
        input.character = { ...input.character, customModuleToggle: many }
        await show(input)
        expect(parts('studio-tg-combined-entry').length).toBe(100)
        part('studio-combined-more')?.click()
        flushSync()
        expect(parts('studio-tg-combined-entry').length).toBe(200)
    })
})

describe('CU-2 opening a source and the preview of everything', () => {
    test('a header or an entry selects that owner with the toggles item, and nothing is written', async () => {
        await show(inputOf())
        const before = JSON.stringify(db.db)
        sources()[1].querySelector<HTMLElement>('[data-part="studio-tg-combined-header"]')!.click()
        flushSync()
        expect(studioScreen.selectedOwnerKey).toBe('module:res')
        expect(studioScreen.selectedKind).toBe('toggles')
        expect(studioScreen.selectedItemId).toBe('res/toggles:0')
        expect(studioScreen.detailShown).toBe(true)
        sources()[0].querySelector<HTMLElement>('[data-part="studio-tg-combined-entry"]')!.click()
        flushSync()
        expect(studioScreen.selectedOwnerKey).toBe('preset:0')
        expect(studioScreen.selectedItemId).not.toBeNull()
        expect(JSON.stringify(db.db)).toBe(before)
    })

    test('the preview of everything opens the joined sheet with no scope switch and outlines no owner', async () => {
        await show(inputOf())
        part('studio-tg-combined-all')?.click()
        flushSync()
        await vi.waitFor(() => expect(part('studio-toggle-preview')).not.toBeNull())
        await vi.waitFor(() => expect(parts('studio-tg-preview-row').length).toBeGreaterThan(0))
        expect(part('studio-tg-preview-scope-owner')).toBeNull()
        expect(part('studio-tg-preview-scope-all')).toBeNull()
        expect(parts('studio-tg-preview-row').some((row) => row.hasAttribute('data-current'))).toBe(false)
        expect(part('studio-tg-combined-all')?.getAttribute('aria-expanded')).toBe('true')
        part('studio-toggle-preview-close')?.click()
        flushSync()
        expect(studioScreen.togglePreviewOpen).toBe(false)
    })

    test('closing the sheet opened from the preview of everything, by Escape in the dialog and by Back, returns focus to that button', async () => {
        const stopLayers = $effect.root(() => { installStudioBack() })
        try {
            await show(inputOf())
            const opener = part('studio-tg-combined-all')!
            for (const close of ['escape', 'back'] as const) {
                opener.click()
                flushSync()
                await vi.waitFor(() => expect(part('studio-toggle-preview')).not.toBeNull())
                if (close === 'escape') {
                    part('studio-toggle-preview')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
                } else {
                    expect(dispatchBack()).toBe(true)
                }
                flushSync()
                await vi.waitFor(() => expect(part('studio-toggle-preview')).toBeNull())
                await vi.waitFor(() => expect(document.activeElement).toBe(opener))
                document.body.focus()
            }
        } finally {
            stopLayers()
        }
    })

    test('with a private bound character the preview of everything shows none of its rows or its name', async () => {
        await show(inputOf({ secret: true }))
        part('studio-tg-combined-all')?.click()
        flushSync()
        await vi.waitFor(() => expect(part('studio-toggle-preview')).not.toBeNull())
        await vi.waitFor(() => expect(parts('studio-tg-preview-row').length).toBeGreaterThan(0))
        expect(document.querySelector('[data-uid^="character:cha-1#"]')).toBeNull()
        expect(part('studio-toggle-preview')?.textContent).not.toContain('Alice')
    })

    test('the view that renders the sheet clears the flag when it is destroyed', async () => {
        await show(inputOf())
        part('studio-tg-combined-all')?.click()
        flushSync()
        expect(studioScreen.togglePreviewOpen).toBe(true)
        await unmount(app!)
        app = undefined
        expect(studioScreen.togglePreviewOpen).toBe(false)
    })
})

describe('CU-3 the lore tester stays with lore (compatibility guard; passes before and after)', () => {
    test('kind lore mounts the tester and kind toggles does not', async () => {
        await show(inputOf(), 'lore')
        expect(part('studio-lore-test')).not.toBeNull()
        expect(part('studio-tg-combined')).toBeNull()
    })

    test('kind toggles mounts the combined view and no tester', async () => {
        await show(inputOf(), 'toggles')
        expect(part('studio-lore-test')).toBeNull()
        expect(part('studio-tg-combined')).not.toBeNull()
    })
})
