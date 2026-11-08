// @vitest-environment happy-dom

/**
 * `WelcomeRisu.svelte` offers Spanish as an app language: the browser-language auto-detect accepts `es`, and the
 * language step has an "Español" radio. An unsupported browser language shows English selected and writes nothing
 * until the person starts or skips setup; a restore never writes the language.
 *
 * MOCKED: the database module, the preset templates, the colour-scheme updater, the persona picker, the character
 * image lookup and the restore entry, so nothing is written or restored. The setup choices made after the language
 * step are covered by `WelcomeRisu.steps.svelte.test.ts`. Titles beginning "guard:" pin behaviour that holds before and
 * after the change; titles beginning "regression reproducer:" fail against the version whose language list lacks
 * Spanish.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import type { Database } from '../../ts/storage/database.svelte'

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
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/process/templates/templates'), () => ({
    prebuiltPresets: {},
}) as unknown as typeof import('src/ts/process/templates/templates'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/persona'), () => ({
    selectUserImg: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/persona'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/characters'))

const restoreAtFirstRun = vi.hoisted(() => vi.fn(async () => {}))
vi.mock(import('src/ts/drive/settingsRestore'), () => ({
    restoreFromBinFileAtFirstRun: restoreAtFirstRun,
}) as unknown as typeof import('src/ts/drive/settingsRestore'))

import { changeLanguage, language } from 'src/lang'
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
    flushSync()
    return target
}

function languageRadio(target: HTMLElement, code: string): HTMLInputElement {
    const radio = target.querySelector<HTMLInputElement>(`input[name="welcome-language"][value="${code}"]`)
    expect(radio).not.toBeNull()
    return radio!
}

function buttonWithText(target: HTMLElement, text: string): HTMLButtonElement {
    const button = [...target.querySelectorAll('button')].find((b) => b.textContent === text)
    expect(button).toBeDefined()
    return button!
}

beforeEach(() => {
    DBState.db = {} as Database
    restoreAtFirstRun.mockClear()
})

afterEach(() => {
    if (mounted) unmount(mounted)
    mounted = undefined
    document.body.innerHTML = ''
    languageSpy?.mockRestore()
    languageSpy = undefined
    resetBackHandlersForTests()
    changeLanguage('en')
})

describe('Spanish in the first-run welcome screen', () => {
    test('regression reproducer: an es-ES browser language selects Spanish and shows the Spanish welcome', () => {
        const target = mountWelcome('es-ES')

        expect(DBState.db.language).toBe('es')
        expect(languageRadio(target, 'es').checked).toBe(true)
        expect(target.querySelector('[data-step-heading]')?.textContent).toBe(languageSpanish.onboarding.welcomeTitle)
    })

    test('regression reproducer: the language step has a Spanish radio that selects Spanish', () => {
        const target = mountWelcome('fr-FR')

        const radio = languageRadio(target, 'es')
        expect(radio.closest('label')?.textContent).toContain('Español')
        radio.click()
        flushSync()

        expect(DBState.db.language).toBe('es')
        expect(target.querySelector('[data-step-heading]')?.textContent).toBe(languageSpanish.onboarding.welcomeTitle)
    })

    test('guard: a ko-KR browser language still selects Korean', () => {
        expect(languageKorean.onboarding.welcomeTitle).not.toBe(languageSpanish.onboarding.welcomeTitle)
        const target = mountWelcome('ko-KR')

        expect(DBState.db.language).toBe('ko')
        expect(languageRadio(target, 'ko').checked).toBe(true)
        expect(target.querySelector('[data-step-heading]')?.textContent).toBe(languageKorean.onboarding.welcomeTitle)
    })

    test('guard: an unsupported browser language shows English selected and writes nothing at mount', () => {
        const target = mountWelcome('fr-FR')

        expect(languageRadio(target, 'en').checked).toBe(true)
        expect(DBState.db.language).toBeUndefined()
        expect(target.querySelector('[data-step-heading]')?.textContent).toBe(language.onboarding.welcomeTitle)
    })

    test('guard: an unsupported browser language writes en on Start setup', () => {
        const target = mountWelcome('fr-FR')

        buttonWithText(target, language.onboarding.startSetup).click()
        flushSync()

        expect(DBState.db.language).toBe('en')
    })

    test('guard: an unsupported browser language writes en on Skip setup', () => {
        const target = mountWelcome('fr-FR')

        buttonWithText(target, language.onboarding.skipSetup).click()
        flushSync()

        expect(DBState.db.language).toBe('en')
    })

    test('guard: Restore a backup never writes the language and calls the first-run restore', () => {
        const target = mountWelcome('fr-FR')

        buttonWithText(target, language.onboarding.restoreBackup).click()
        flushSync()

        expect(restoreAtFirstRun).toHaveBeenCalledTimes(1)
        expect(DBState.db.language).toBeUndefined()
    })
})
