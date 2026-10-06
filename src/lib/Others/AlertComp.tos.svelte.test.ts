// @vitest-environment happy-dom

/**
 * Coverage for `AlertComp.svelte`'s `'tos'` block (T-C16): the answer values
 * its own buttons write are exactly the ones `src/ts/upstreamAgreement.ts`
 * treats as an explicit Accept or Decline. If they ever drifted apart, every
 * real click through this component would re-post the prompt forever
 * instead of resolving it. With the legal-configuration flag unset, the
 * block renders no buttons at all (`Legal.svelte`'s own gate covers that
 * case elsewhere; MC-087 3d).
 *
 * The buttons are found by role and position, not by new test ids or by
 * their visible text, so a later wording change in `src/lang` for this
 * block does not affect this file.
 *
 * MOCKED, following `charlistAvatarLazy.svelte.test.ts`'s precedent for
 * mounting this same component (`localforage`, `src/ts/globalApi.svelte`,
 * `src/ts/storage/database.svelte`, `src/ts/platform`,
 * `@tauri-apps/plugin-fs`, a reactive `stores.svelte` stand-in, and partial
 * `src/ts/characters`/`src/ts/media/avatarThumb` mocks) -- none of that
 * machinery is exercised by the `'tos'` block itself, but `AlertComp.svelte`
 * needs all of it to import and mount cleanly. `src/ts/upstreamAgreement`
 * is never mocked.
 */

import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import { UPSTREAM_AGREEMENT_ACCEPT, UPSTREAM_AGREEMENT_DECLINE } from 'src/ts/upstreamAgreement'

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

const { changeCharSpy, avatarThumbSpy, openUrlSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    avatarThumbSpy: vi.fn(async () => null),
    openUrlSpy: vi.fn(),
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
            openURL: openUrlSpy,
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
        selectedCharID: writable(-1),
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
        changeChar: changeCharSpy,
    }
})

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: avatarThumbSpy,
    }
})

//#endregion

import { alertStore } from '../../ts/stores.svelte'
import AlertComp from './AlertComp.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountAlertComp(): { target: HTMLElement } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(AlertComp, { target, props: {} })
    mountedInstances.push(instance)
    return { target }
}

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    alertStore.set({ type: 'none', msg: '' } as never)
    vi.unstubAllEnvs()
    vi.clearAllMocks()
})

describe("AlertComp.svelte 'tos' block: the buttons answer with the agreement module's own values", () => {
    test('with the flag set, the first button writes the accept value and the second writes the decline value', () => {
        vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
        vi.useFakeTimers()
        try {
            alertStore.set({ type: 'tos', msg: 'tos' } as never)
            const { target } = mountAlertComp()
            flushSync()

            let buttons = Array.from(target.querySelectorAll('button'))
            expect(buttons.length).toBe(2)

            vi.advanceTimersByTime(401)
            buttons[0].click()
            flushSync()
            expect(get(alertStore)).toEqual({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT })

            alertStore.set({ type: 'tos', msg: 'tos' } as never)
            flushSync()
            buttons = Array.from(target.querySelectorAll('button'))
            expect(buttons.length).toBe(2)

            vi.advanceTimersByTime(401)
            buttons[1].click()
            flushSync()
            expect(get(alertStore)).toEqual({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE })
        } finally {
            vi.useRealTimers()
        }
    })

    // Guard: the agreement popup keeps pointing at the upstream service's own documents, not at
    // this fork's (`src/ts/forkLegalLinks.ts`).
    test('the two document links open the upstream service terms and privacy pages', () => {
        vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
        alertStore.set({ type: 'tos', msg: 'tos' } as never)
        const { target } = mountAlertComp()
        flushSync()

        const links = Array.from(target.querySelectorAll('a[role="button"]')) as HTMLElement[]
        expect(links.length).toBe(2)

        links[0].click()
        expect(openUrlSpy).toHaveBeenLastCalledWith('https://account.sionyw.com/terms')
        links[1].click()
        expect(openUrlSpy).toHaveBeenLastCalledWith('https://account.sionyw.com/privacy')
        expect(openUrlSpy).toHaveBeenCalledTimes(2)
    })

    // Guard: this block never renders its Accept/Decline buttons for a flag that would keep
    // `askUpstreamAgreement()` from ever posting the prompt in the first place.
    test('with the flag unset, the block renders no buttons', () => {
        vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', '')
        alertStore.set({ type: 'tos', msg: 'tos' } as never)
        const { target } = mountAlertComp()
        flushSync()

        expect(target.querySelectorAll('button').length).toBe(0)
    })
})
