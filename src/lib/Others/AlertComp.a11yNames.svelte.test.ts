// @vitest-environment jsdom

/**
 * `AlertComp.svelte` accessible names and selection cues: the input dialog's text field is named by the visible
 * message, the hypaV2 chunk editors are named by existing visible text, icon-only close buttons carry the
 * existing close string, and tab / type buttons expose `aria-pressed` plus a non-colour second cue on the
 * selected one. Mounts the REAL component over the same module mocks as `AlertComp.valueNames.svelte.test.ts`.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import 'src/ts/polyfill'

//#region module mocks (see file header)

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => {}),
            },
            getFileSrc: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
            checkCharOrder: vi.fn(),
            requiresFullEncoderReload: { state: false },
            AppendableBuffer: class {},
            VirtualWriter: class {},
            LocalWriter: class {},
            BlankWriter: class {},
            downloadFile: vi.fn(),
            openURL: vi.fn(),
            loadAsset: vi.fn(),
            saveAsset: vi.fn(),
            readImage: vi.fn(),
            globalFetch: vi.fn(),
            aiWatermarkingLawApplies: vi.fn(() => false),
            changeChatTo: vi.fn(),
            hubURL: '',
            usingSw: false,
            getFetchLogs: vi.fn(() => []),
            getFetchData: vi.fn(() => ({})),
            aiLawApplies: vi.fn(() => false),
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('../../ts/stores.svelte')
    return {
        getDatabase: vi.fn((options?: { snapshot?: boolean }) => DBState.db),
        getCurrentCharacter: vi.fn(() => DBState.db.characters?.[0]),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
    getDetailedOSLabel: vi.fn(async () => 'test-os'),
    getFallbackOSLabel: vi.fn(() => 'test-os'),
    getRisuEnvironmentLabel: vi.fn((): RisuEnvironmentLabel => 'web'),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    remove: vi.fn(),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        MobileGUIStack: writable([]),
        CharEmotion: writable(new Map()),
        OpenRealmStore: writable({ isOpen: false }),
        MobileSearch: writable(''),
        alertStore: writable({ type: 'none', msg: '' }),
        selIdState: { state: -1 },
        SettingsMenuIndex: writable(0),
        ShowRealmFrameStore: writable(false),
        settingsOpen: writable(false),
        botMakerMode: writable(false),
        DynamicGUI: writable(false),
        sideBarClosing: writable(false),
        sideBarStore: writable({ tab: 0 }),
        PlaygroundStore: writable({ open: false }),
        QuickSettings: writable([]),
        additionalHamburgerMenu: writable([]),
        CharConfigSubMenu: writable(0),
        MobileGUI: writable(false),
        hypaV3ModalOpen: writable(false),
        ReloadGUIPointer: writable(0),
        bookmarkListOpen: writable(false),
        alertGenerationInfoStore: writable(null),
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock(import('../../ts/characters'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        changeChar: vi.fn(),
    }
})

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

vi.mock(import('src/ts/gui/branches'), () => ({
    getChatBranches: vi.fn(() => []),
}) as unknown as typeof import('src/ts/gui/branches'))

//#endregion

import { alertStore, DBState } from '../../ts/stores.svelte'
import { alertGenerationInfoStore, alertRequestLogs } from '../../ts/alert'
import { language } from 'src/lang'
import { unnamedControls } from 'src/lib/a11yNames.test-helpers'
import AlertComp from './AlertComp.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountAlertComp(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(AlertComp, { target, props: {} }))
    return target
}

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    alertStore.set({ type: 'none', msg: '' } as never)
})

function buttonByText(target: HTMLElement, text: string): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)
    if (!found) expect.fail(`no button "${text}"`)
    return found
}

/** Text of the aria-labelledby targets, which must also lead aria-describedby (the helper's strict text-field rule). */
function labelledText(control: Element): string {
    const labelIds = (control.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter((id) => id !== '')
    const describedIds = (control.getAttribute('aria-describedby') ?? '').split(/\s+/)
    expect(describedIds.slice(0, labelIds.length)).toEqual(labelIds)
    return labelIds.map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ')
}

function pressedStates(buttons: HTMLElement[]): (string | null)[] {
    return buttons.map((b) => b.getAttribute('aria-pressed'))
}

/** The second cue is an inset ring; the selected button carries it and no other tab does. */
function hasCue(button: HTMLElement): boolean {
    return button.classList.contains('ring-inset') && button.classList.contains('ring-2')
}

function seedHypa(): void {
    DBState.db = {
        characters: [{
            type: 'character',
            chaId: 'c0',
            chatPage: 0,
            chats: [{
                hypaV2Data: {
                    chunks: [{ text: 'chunk one' }, { text: 'chunk two' }],
                    mainChunks: [{ text: 'summary one' }, { text: 'summary two' }],
                },
            }],
        }],
    } as unknown as Database
}

describe('AlertComp accessible names', () => {
    test('the input dialog text field is named by the visible message and keeps its #alert-input id', () => {
        DBState.db = { characters: [] } as unknown as Database
        alertStore.set({ type: 'input', msg: 'Enter your nickname', defaultValue: '' } as never)
        const target = mountAlertComp()
        flushSync()
        const input = target.querySelector('#alert-input')
        expect(input).not.toBeNull()
        expect(labelledText(input as Element)).toBe('Enter your nickname')
        expect(unnamedControls(target, { fields: true, values: true })).toEqual([])
    })

    test('hypaV2 chunk editors are named in both tabs and the close button has a name', () => {
        seedHypa()
        alertStore.set({ type: 'hypaV2', msg: '' } as never)
        const target = mountAlertComp()
        flushSync()
        expect(target.querySelectorAll('textarea').length).toBe(2)
        expect(unnamedControls(target, { fields: true, values: true })).toEqual([])
        expect(Array.from(target.querySelectorAll('textarea')).map(labelledText)).toEqual(['Chunks', 'Chunks'])

        buttonByText(target, language.alertComp.summarized).click()
        flushSync()
        expect(target.querySelectorAll('textarea').length).toBe(2)
        expect(unnamedControls(target, { fields: true, values: true })).toEqual([])
        expect(Array.from(target.querySelectorAll('textarea')).map(labelledText)).toEqual([language.active, language.alertComp.inactive])

        expect(target.querySelector(`button[aria-label="${language.uiCommon.close}"]`)).not.toBeNull()
    })

    test('the card export close button and the generation info close button have names', () => {
        DBState.db = {
            characters: [{ type: 'character', chaId: 'c0', ccAssets: [], additionalAssets: [], emotionImages: [], image: '' }],
        } as unknown as Database
        alertStore.set({ type: 'cardexport', msg: '', submsg: '' } as never)
        const exportTarget = mountAlertComp()
        flushSync()
        expect(exportTarget.querySelector(`button[aria-label="${language.uiCommon.close}"] svg`)).not.toBeNull()

        alertGenerationInfoStore.set({
            idx: 0,
            genInfo: { inputTokens: 1, outputTokens: 1, maxContext: 10, model: 'm', generationId: 'g', log: '', prompt: '[]' },
        } as never)
        alertStore.set({ type: 'requestdata', msg: 'g' } as never)
        flushSync()
        expect(exportTarget.querySelector(`button[aria-label="${language.uiCommon.close}"]`)).not.toBeNull()
    })

    // Guards: both close buttons were named before this suite pinned them, so these pass with or without a code change.
    test('guard: the branches close button is named and holds the X icon', () => {
        DBState.db = { characters: [] } as unknown as Database
        alertStore.set({ type: 'branches', msg: '' } as never)
        const target = mountAlertComp()
        flushSync()
        expect(target.querySelector(`button[aria-label="${language.uiCommon.close}"] svg`)).not.toBeNull()
    })

    test('guard: the request logs close button is named and holds the X icon', () => {
        DBState.db = { characters: [] } as unknown as Database
        alertRequestLogs()
        const target = mountAlertComp()
        flushSync()
        expect(target.querySelector(`button[aria-label="${language.uiCommon.close}"] svg`)).not.toBeNull()
    })
})

describe('AlertComp selection cues', () => {
    test('generation info tabs expose aria-pressed and a second cue that moves with the selection', () => {
        alertGenerationInfoStore.set({
            idx: 0,
            genInfo: { inputTokens: 1, outputTokens: 1, maxContext: 10, model: 'm', generationId: 'g', log: '', prompt: '[]' },
        } as never)
        alertStore.set({ type: 'requestdata', msg: 'g' } as never)
        const target = mountAlertComp()
        flushSync()
        const tabs = [language.tokens, language.metaData, language.log, language.prompt].map((t) => buttonByText(target, t))
        expect(pressedStates(tabs)).toEqual(['true', 'false', 'false', 'false'])
        expect(tabs.map(hasCue)).toEqual([true, false, false, false])
        tabs[2].click()
        flushSync()
        expect(pressedStates(tabs)).toEqual(['false', 'false', 'true', 'false'])
        expect(tabs.map(hasCue)).toEqual([false, false, true, false])
    })

    test('hypaV2 tabs expose aria-pressed and a second cue that moves with the selection', () => {
        seedHypa()
        alertStore.set({ type: 'hypaV2', msg: '' } as never)
        const target = mountAlertComp()
        flushSync()
        const tabs = [buttonByText(target, 'Chunks'), buttonByText(target, language.alertComp.summarized)]
        expect(pressedStates(tabs)).toEqual(['true', 'false'])
        expect(tabs.map(hasCue)).toEqual([true, false])
        tabs[1].click()
        flushSync()
        expect(pressedStates(tabs)).toEqual(['false', 'true'])
        expect(tabs.map(hasCue)).toEqual([false, true])
    })

    test('card export type buttons carry aria-pressed matching their ring', () => {
        DBState.db = {
            characters: [{ type: 'character', chaId: 'c0', ccAssets: [], additionalAssets: [], emotionImages: [], image: '' }],
        } as unknown as Database
        alertStore.set({ type: 'cardexport', msg: '', submsg: '' } as never)
        const target = mountAlertComp()
        flushSync()
        const types = ['RisuRealm', 'Character Card V3', 'Character Card V2'].map((t) => buttonByText(target, t))
        expect(pressedStates(types)).toEqual(['true', 'false', 'false'])
        expect(types.map((b) => b.classList.contains('ring-1'))).toEqual([true, false, false])
        types[2].click()
        flushSync()
        expect(pressedStates(types)).toEqual(['false', 'false', 'true'])
        expect(types.map((b) => b.classList.contains('ring-1'))).toEqual([false, false, true])
    })
})
