// @vitest-environment happy-dom

/**
 * `WelcomeRisu.svelte` offers Spanish as an app language: the browser-language auto-detect
 * accepts `es`, and the language step has a "Español" button.
 *
 * MOCKED: the chat bubble component (renders only its message text), the database module,
 * the preset templates, the colour-scheme updater and the alert module, so nothing is
 * written. The translator choice made by the first-setup switch is only reachable through
 * the whole setup flow and is not covered here. Titles beginning "guard:" pin behaviour that
 * holds before and after the change; titles beginning "regression reproducer:" fail against
 * the version whose language list lacks Spanish.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

vi.mock('../ChatScreens/Chat.svelte', () => ({
    default: (anchor: Comment, props: { message: string }) => {
        const node = document.createElement('div')
        node.className = 'chat-stub'
        node.textContent = props.message
        anchor.before(node)
    },
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    setPreset: vi.fn((db: unknown) => db),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    risuChatParser: vi.fn((text: string) => text),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
    getFileSrc: vi.fn(async (loc: string) => loc),
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
    isPlainHttpFileSrc: vi.fn(() => false),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/process/templates/templates'), () => ({
    prebuiltPresets: {},
}) as unknown as typeof import('src/ts/process/templates/templates'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

import { changeLanguage } from 'src/lang'
import { languageSpanish } from 'src/lang/es'
import { languageKorean } from 'src/lang/ko'
import { DBState } from 'src/ts/stores.svelte'
import WelcomeRisu from './WelcomeRisu.svelte'

let mounted: ReturnType<typeof mount> | undefined
let languageSpy: ReturnType<typeof vi.spyOn> | undefined

function mountWelcome(browserLanguage: string): HTMLElement {
    languageSpy = vi.spyOn(navigator, 'language', 'get').mockReturnValue(browserLanguage)
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = mount(WelcomeRisu, { target })
    return target
}

/** Ends the logo animation, which reveals the language step or the first chat message. */
function finishLogoAnimation(target: HTMLElement): void {
    target.querySelector('.logo-animation')!.dispatchEvent(new Event('animationend'))
    flushSync()
}

beforeEach(() => {
    DBState.db = {} as Database
})

afterEach(() => {
    if (mounted) unmount(mounted)
    mounted = undefined
    document.body.innerHTML = ''
    languageSpy?.mockRestore()
    languageSpy = undefined
    changeLanguage('en')
})

describe('Spanish in the first-run welcome screen', () => {
    test('regression reproducer: an es-ES browser language selects Spanish and skips the language step', () => {
        const target = mountWelcome('es-ES')
        finishLogoAnimation(target)

        expect(DBState.db.language).toBe('es')
        expect(target.textContent).not.toContain('Choose your language')
        expect(target.querySelector('.chat-stub')?.textContent).toBe(languageSpanish.setup.welcome)
    })

    test('regression reproducer: the language step has a Spanish button that selects Spanish', () => {
        const target = mountWelcome('fr-FR')
        finishLogoAnimation(target)

        const button = [...target.querySelectorAll('button')].find((b) => b.textContent === '• Español')
        expect(button).toBeDefined()
        button!.click()
        flushSync()

        expect(DBState.db.language).toBe('es')
        expect(target.querySelector('.chat-stub')?.textContent).toBe(languageSpanish.setup.welcome)
    })

    test('guard: a ko-KR browser language still selects Korean and skips the language step', () => {
        expect(languageKorean.setup.welcome).not.toBe(languageSpanish.setup.welcome)
        const target = mountWelcome('ko-KR')
        finishLogoAnimation(target)

        expect(DBState.db.language).toBe('ko')
        expect(target.querySelector('.chat-stub')?.textContent).toBe(languageKorean.setup.welcome)
    })

    test('guard: an unsupported browser language shows the language step', () => {
        const target = mountWelcome('fr-FR')
        finishLogoAnimation(target)

        expect(target.textContent).toContain('Choose your language')
        expect(DBState.db.language).toBeUndefined()
    })
})
