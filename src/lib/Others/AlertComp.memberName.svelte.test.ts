// @vitest-environment jsdom

/**
 * `AlertComp.svelte` generation-info metadata for a group message: the "saying" row shows the speaker's
 * resolved name with its id in parentheses (live member, else the group's join record, else
 * "Unknown Character"); a message with no saying shows exactly what it showed before (an empty cell).
 * Mounts the REAL component over the same module mocks as `AlertComp.a11yNames.svelte.test.ts`.
 *
 * Classes: `regression reproducer:` fails on the code before the member record existed (the cell showed
 * the raw id only); `guard:` passes before and after.
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
import { alertGenerationInfoStore } from '../../ts/alert'
import { language } from 'src/lang'
import AlertComp from './AlertComp.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    alertStore.set({ type: 'none', msg: '' } as never)
})

type Members = Record<string, unknown> | undefined

// `members` is the group's `risutanium_members` exactly as joinRecord writes it ({name, slot 0..7}
// under the member's chaId); `live` are the member characters still in the list.
function seed(saying: string | undefined, members: Members, live: { chaId: string, name: string }[]): void {
    const group = {
        type: 'group', chaId: 'g0', name: 'Group', chatPage: 0, characters: [], image: '',
        chats: [{ message: [{ role: 'char', data: 'spoken', chatId: 'x0', ...(saying === undefined ? {} : { saying }) }] }],
        ...(members === undefined ? {} : { risutanium_members: members }),
    }
    DBState.db = {
        characters: [group, ...live.map((c) => ({ ...c, type: 'character', chats: [], chatPage: 0 }))],
    } as unknown as Database
}

// The text of the "saying" row on the metadata tab of the generation-info alert.
function sayingCell(): string | null {
    alertGenerationInfoStore.set({
        idx: 0,
        genInfo: { inputTokens: 1, outputTokens: 1, maxContext: 10, model: 'm', generationId: 'g', log: '', prompt: '[]' },
    } as never)
    alertStore.set({ type: 'requestdata', msg: 'g' } as never)
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(AlertComp, { target, props: {} }))
    flushSync()
    const metaTab = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.metaData)
    if (!metaTab) expect.fail('no metadata tab')
    metaTab.click()
    flushSync()
    const label = Array.from(target.querySelectorAll('dt')).find((dt) => dt.textContent?.trim() === language.alertComp.saying)
    if (!label) expect.fail('no saying row')
    return label.nextElementSibling?.textContent ?? null
}

describe('AlertComp generation info: speaker of a group message', () => {
    test('regression reproducer: a deleted member shows the recorded name with its id', () => {
        seed('m-1', { 'm-1': { name: 'Alice', slot: 0 } }, [])
        expect(sayingCell()).toBe('Alice (m-1)')
    })

    test('regression reproducer: a live member shows its own name with its id, not the record', () => {
        seed('m-1', { 'm-1': { name: 'Alice', slot: 0 } }, [{ chaId: 'm-1', name: 'Alicia' }])
        expect(sayingCell()).toBe('Alicia (m-1)')
    })

    test('regression reproducer: a deleted member with no record shows Unknown Character with its id', () => {
        seed('m-1', undefined, [])
        expect(sayingCell()).toBe('Unknown Character (m-1)')
    })

    test('guard: a message with no saying keeps today\'s output (an empty cell)', () => {
        seed(undefined, { 'm-1': { name: 'Alice', slot: 0 } }, [])
        expect(sayingCell()).toBe('')
    })
})
