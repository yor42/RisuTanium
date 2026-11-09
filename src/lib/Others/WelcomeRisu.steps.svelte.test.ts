// @vitest-environment happy-dom

/**
 * The Welcome step card: the walk through the steps, the key and nickname rules, the Restore entry, the heading
 * focus, Android Back, IME Enter and the finish lifecycle.
 *
 * MOCKED: the database module, the preset templates, the colour-scheme updater, the persona picker, the character
 * image lookup and the restore entries, and `finishFirstRun` (the choices it receives are asserted instead of written).
 * The rest of `firstRunChoices` is real. The sanitizer is not involved (all copy is plain text), so happy-dom is enough.
 * Keys in this file are synthetic placeholders. Mocked tests do not prove the native picker, the restore commit or the
 * reload; those are device checks.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { dispatchBack, resetBackHandlersForTests } from 'src/ts/backHandlers'
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
const restoreFromSettings = vi.hoisted(() => vi.fn(async () => {}))
vi.mock(import('src/ts/drive/settingsRestore'), () => ({
    restoreFromBinFileAtFirstRun: restoreAtFirstRun,
    restoreFromBinFile: restoreFromSettings,
}) as unknown as typeof import('src/ts/drive/settingsRestore'))

const finishFirstRunMock = vi.hoisted(() => vi.fn())
vi.mock(import('src/ts/firstRun/firstRunChoices'), async (importOriginal) => ({
    ...(await importOriginal()),
    finishFirstRun: finishFirstRunMock,
}))

import { changeLanguage, language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import WelcomeRisu from './WelcomeRisu.svelte'
import { FINISH_DISPLAY_MS, WelcomeFlow } from './Welcome/welcomeFlow.svelte'

const SYNTHETIC_KEY = 'sk-test-placeholder-0001'

let mounted: ReturnType<typeof mount> | undefined
let languageSpy: ReturnType<typeof vi.spyOn> | undefined

function mountWelcome(browserLanguage = 'en-US'): HTMLElement {
    languageSpy = vi.spyOn(navigator, 'language', 'get').mockReturnValue(browserLanguage)
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = mount(WelcomeRisu, { target })
    flushSync()
    return target
}

function unmountWelcome(): void {
    if (mounted) unmount(mounted)
    mounted = undefined
}

function buttonWithText(target: HTMLElement, text: string): HTMLButtonElement {
    const button = [...target.querySelectorAll('button')].find((b) => b.textContent === text)
    expect(button, `button "${text}"`).toBeDefined()
    return button!
}

function press(target: HTMLElement, text: string): void {
    buttonWithText(target, text).click()
    flushSync()
}

function continueButton(target: HTMLElement): HTMLButtonElement {
    return buttonWithText(target, language.onboarding.continue)
}

function radio(target: HTMLElement, name: string, value: string): HTMLInputElement {
    const found = target.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)
    expect(found, `radio ${name}=${value}`).not.toBeNull()
    return found!
}

function choose(target: HTMLElement, name: string, value: string): void {
    radio(target, name, value).click()
    flushSync()
}

function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

function textInput(target: HTMLElement, label: string): HTMLInputElement {
    const labelled = [...target.querySelectorAll('label')].find((l) => (l.querySelector('span') ?? l).textContent === label)
    const field = labelled?.control ?? labelled?.querySelector('input')
    expect(field, `input labelled ${label}`).toBeTruthy()
    return field as HTMLInputElement
}

function heading(target: HTMLElement): string {
    return target.querySelector('[data-step-heading]')?.textContent ?? ''
}

function railText(target: HTMLElement): string {
    return target.querySelector('[data-step-rail]')?.textContent ?? ''
}

/** Welcome, then Use = stories, then the persona step with the given name. */
function toPersona(target: HTMLElement, name = ''): void {
    press(target, language.onboarding.startSetup)
    choose(target, 'welcome-use', 'stories')
    press(target, language.onboarding.continue)
    if (name !== '') {
        typeInto(textInput(target, language.name), name)
    }
}

function toProvider(target: HTMLElement): void {
    toPersona(target)
    press(target, language.onboarding.continue)
}

beforeEach(() => {
    DBState.db = { userIcon: '' } as Database
    restoreAtFirstRun.mockReset().mockImplementation(async () => {})
    restoreFromSettings.mockClear()
    finishFirstRunMock.mockClear()
})

afterEach(() => {
    unmountWelcome()
    document.body.innerHTML = ''
    languageSpy?.mockRestore()
    languageSpy = undefined
    vi.useRealTimers()
    // The Back handler list is module state: a case that leaves one registered would answer in the next.
    resetBackHandlersForTests()
    changeLanguage('en')
})

describe('the Welcome walk', () => {
    test('walks Welcome, Use, Persona, Provider, Memory and Review, then finishes with the resolved choices', () => {
        vi.useFakeTimers()
        const target = mountWelcome()
        expect(railText(target)).toBe(language.onboarding.stepOf(1, 6, language.onboarding.stepWelcome))

        toPersona(target, 'Mira')
        expect(railText(target)).toBe(language.onboarding.stepOf(3, 6, language.persona))
        press(target, language.onboarding.continue)

        choose(target, 'welcome-provider', 'claude')
        typeInto(textInput(target, language.apiKey), SYNTHETIC_KEY)
        press(target, language.onboarding.continue)

        expect(heading(target)).toBe(language.onboarding.stepMemory)
        press(target, language.onboarding.continue)

        expect(heading(target)).toBe(language.onboarding.readyNamed('Mira'))
        press(target, language.onboarding.finish)
        expect(finishFirstRunMock).not.toHaveBeenCalled()
        vi.advanceTimersByTime(FINISH_DISPLAY_MS)

        expect(finishFirstRunMock).toHaveBeenCalledTimes(1)
        expect(finishFirstRunMock).toHaveBeenCalledWith({
            provider: 'claude',
            apiKey: SYNTHETIC_KEY,
            memory: 'balanced',
            chatLanguage: 'unchanged',
            persona: { name: 'Mira', description: '', keepPicture: false },
            onlyMode: null,
        })
    })

    test('Skip setup finishes with the Balanced, set-up-later choices', () => {
        vi.useFakeTimers()
        const target = mountWelcome()

        press(target, language.onboarding.skipSetup)
        vi.advanceTimersByTime(FINISH_DISPLAY_MS)

        expect(finishFirstRunMock).toHaveBeenCalledTimes(1)
        expect(finishFirstRunMock.mock.calls[0][0]).toMatchObject({ provider: 'later', apiKey: '', memory: 'balanced', chatLanguage: 'unchanged' })
    })

    test('the Restore button runs the first-run restore and not the Settings one', () => {
        const target = mountWelcome()

        press(target, language.onboarding.restoreBackup)

        expect(restoreAtFirstRun).toHaveBeenCalledTimes(1)
        expect(restoreFromSettings).not.toHaveBeenCalled()
        expect(heading(target)).toBe(language.onboarding.welcomeTitle)
    })

    test('nothing is preselected on the Use step and Continue stays disabled until the person chooses', () => {
        const target = mountWelcome()
        press(target, language.onboarding.startSetup)

        for (const value of ['stories', 'both', 'tools']) {
            expect(radio(target, 'welcome-use', value).checked).toBe(false)
        }
        expect(continueButton(target).disabled).toBe(true)

        choose(target, 'welcome-use', 'both')
        expect(continueButton(target).disabled).toBe(false)
    })

    test('chat language shows for a non-English app language only, and nothing is preselected', () => {
        const target = mountWelcome('ko-KR')
        press(target, language.onboarding.startSetup)
        choose(target, 'welcome-use', 'stories')
        press(target, language.onboarding.continue)
        press(target, language.onboarding.continue)
        choose(target, 'welcome-provider', 'openai')
        typeInto(textInput(target, language.apiKey), SYNTHETIC_KEY)
        press(target, language.onboarding.continue)

        expect(heading(target)).toBe(language.onboarding.stepChatLanguage)
        expect(continueButton(target).disabled).toBe(true)
        choose(target, 'welcome-chat-language', 'englishProcessing')
        expect(continueButton(target).disabled).toBe(false)
    })

    test('an English app language has no chat language step', () => {
        const target = mountWelcome('en-US')
        toProvider(target)
        choose(target, 'welcome-provider', 'openai')
        typeInto(textInput(target, language.apiKey), SYNTHETIC_KEY)
        press(target, language.onboarding.continue)

        expect(heading(target)).toBe(language.onboarding.stepMemory)
    })
})

describe('the key step', () => {
    test('a key of another shape shows the advisory and still continues; an empty or blank key does not continue', () => {
        const target = mountWelcome()
        toProvider(target)
        choose(target, 'welcome-provider', 'claude')
        expect(continueButton(target).disabled).toBe(true)

        const field = textInput(target, language.apiKey)
        typeInto(field, '   ')
        expect(continueButton(target).disabled).toBe(true)
        expect(target.querySelector('[data-key-advisory]')).toBeNull()

        typeInto(field, 'abc')
        expect(continueButton(target).disabled).toBe(false)
        expect(target.querySelector('[data-key-advisory]')).not.toBeNull()

        typeInto(field, SYNTHETIC_KEY)
        expect(target.querySelector('[data-key-advisory]')).toBeNull()
    })

    test('the key input is named by its label alone, not by the Show button', () => {
        const target = mountWelcome()
        toProvider(target)
        choose(target, 'welcome-provider', 'claude')

        const field = textInput(target, language.apiKey)
        expect([...field.labels ?? []].map((l) => l.textContent)).toEqual([language.apiKey])
        expect(field.labels?.[0].querySelector('button')).toBeNull()
    })

    test('changing the provider empties the typed key', () => {
        const target = mountWelcome()
        toProvider(target)
        choose(target, 'welcome-provider', 'claude')
        typeInto(textInput(target, language.apiKey), SYNTHETIC_KEY)

        choose(target, 'welcome-provider', 'openai')

        expect(textInput(target, language.apiKey).value).toBe('')
        expect(continueButton(target).disabled).toBe(true)
    })

    test('the key is a password field until Show is pressed', () => {
        const target = mountWelcome()
        toProvider(target)
        choose(target, 'welcome-provider', 'gemini')

        expect(textInput(target, language.apiKey).type).toBe('password')
        press(target, language.onboarding.showKey)
        expect(textInput(target, language.apiKey).type).toBe('text')
    })

    test('a key with the standard prefix turns the mark to done; another shape does not', () => {
        const target = mountWelcome()
        toProvider(target)
        choose(target, 'welcome-provider', 'claude')
        const field = textInput(target, language.apiKey)

        typeInto(field, 'abc')
        expect(target.querySelector('svg.nexus-mark')?.getAttribute('data-status')).toBe('idle')
        typeInto(field, SYNTHETIC_KEY)
        expect(target.querySelector('svg.nexus-mark')?.getAttribute('data-status')).toBe('done')
    })

    test('the Review step shows the provider and a mask, never the key text', () => {
        const target = mountWelcome()
        toProvider(target)
        choose(target, 'welcome-provider', 'claude')
        typeInto(textInput(target, language.apiKey), SYNTHETIC_KEY)
        press(target, language.onboarding.continue)
        press(target, language.onboarding.continue)

        expect(heading(target)).toBe(language.onboarding.ready)
        expect(target.textContent).toContain('Claude')
        expect(target.textContent).not.toContain(SYNTHETIC_KEY)
        expect(target.innerHTML).not.toContain(SYNTHETIC_KEY)
        expect([...target.querySelectorAll('input')].some((input) => input.value.includes(SYNTHETIC_KEY))).toBe(false)
    })

    test('Finish clears the typed key from the flow state', () => {
        vi.useFakeTimers()
        const flow = new WelcomeFlow('en-US')
        flow.use = 'stories'
        flow.chooseProvider('claude')
        flow.apiKey = SYNTHETIC_KEY
        flow.showKey = true

        flow.finish()

        expect(flow.apiKey).toBe('')
        expect(flow.showKey).toBe(false)
        flow.dispose()
    })
})

describe('the nickname and set-up-now questions', () => {
    test('Tools asks for a nickname: no answer, or Yes without a nickname, cannot continue; No can', () => {
        const target = mountWelcome()
        press(target, language.onboarding.startSetup)
        choose(target, 'welcome-use', 'tools')
        press(target, language.onboarding.continue)

        expect(heading(target)).toBe(language.onboarding.nicknameQuestion)
        expect(continueButton(target).disabled).toBe(true)
        choose(target, 'welcome-nickname', 'yes')
        expect(continueButton(target).disabled).toBe(true)
        typeInto(textInput(target, language.nickname), '   ')
        expect(continueButton(target).disabled).toBe(true)
        typeInto(textInput(target, language.nickname), 'Mira')
        expect(continueButton(target).disabled).toBe(false)
        choose(target, 'welcome-nickname', 'no')
        expect(continueButton(target).disabled).toBe(false)
    })

    test('Horde needs an answer to set-up-now; No goes to Review, Yes adds Memory', () => {
        const target = mountWelcome()
        toProvider(target)
        choose(target, 'welcome-provider', 'horde')

        expect(radio(target, 'welcome-set-up-now', 'yes').checked).toBe(false)
        expect(radio(target, 'welcome-set-up-now', 'no').checked).toBe(false)
        expect(continueButton(target).disabled).toBe(true)

        choose(target, 'welcome-set-up-now', 'no')
        expect(continueButton(target).disabled).toBe(false)
        expect(railText(target)).toBe(language.onboarding.stepOf(4, 5, language.provider))

        choose(target, 'welcome-set-up-now', 'yes')
        expect(railText(target)).toBe(language.onboarding.stepOf(4, 6, language.provider))
        press(target, language.onboarding.continue)
        expect(heading(target)).toBe(language.onboarding.stepMemory)
    })

    test('Tools without a nickname never greets by the name typed on the persona step', () => {
        vi.useFakeTimers()
        const target = mountWelcome()
        toPersona(target, 'Mira')
        press(target, language.onboarding.back)

        choose(target, 'welcome-use', 'tools')
        press(target, language.onboarding.continue)
        choose(target, 'welcome-nickname', 'no')
        press(target, language.onboarding.continue)
        choose(target, 'welcome-provider', 'later')
        choose(target, 'welcome-set-up-now', 'no')
        press(target, language.onboarding.continue)

        expect(heading(target)).toBe(language.onboarding.ready)
        expect(target.textContent).not.toContain('Mira')
        press(target, language.onboarding.finish)
        expect(heading(target)).toBe(language.onboarding.allSet)
        expect(target.textContent).not.toContain('Mira')
        vi.advanceTimersByTime(FINISH_DISPLAY_MS)
        expect(finishFirstRunMock.mock.calls[0][0].persona.name).toBe('')
    })

    test('Use to Tools clears the description typed for the persona', () => {
        const target = mountWelcome()
        toPersona(target)
        const description = target.querySelector('textarea')!
        typeInto(description, 'a long description')
        press(target, language.onboarding.back)

        choose(target, 'welcome-use', 'tools')
        choose(target, 'welcome-use', 'stories')
        press(target, language.onboarding.continue)

        expect(target.querySelector('textarea')!.value).toBe('')
    })
})

describe('the heading focus', () => {
    test('the step heading takes focus after the step changes', async () => {
        const target = mountWelcome()

        press(target, language.onboarding.startSetup)
        await tick()
        expect(document.activeElement).toBe(target.querySelector('[data-step-heading]'))
        expect(document.activeElement?.textContent).toBe(language.onboarding.useTitle)

        choose(target, 'welcome-use', 'stories')
        press(target, language.onboarding.continue)
        await tick()
        expect(document.activeElement).toBe(target.querySelector('[data-step-heading]'))
        expect(document.activeElement?.textContent).toBe(language.onboarding.personaTitle)
    })
})

describe('Android Back', () => {
    test('Back steps back from a later step and is not handled on Welcome', () => {
        const target = mountWelcome()
        expect(dispatchBack()).toBe(false)

        press(target, language.onboarding.startSetup)
        expect(railText(target)).toBe(language.onboarding.stepOf(2, 6, language.onboarding.stepUse))
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(railText(target)).toBe(language.onboarding.stepOf(1, 6, language.onboarding.stepWelcome))
        expect(dispatchBack()).toBe(false)
    })

    test('the handler is unregistered when the card goes away', () => {
        const target = mountWelcome()
        press(target, language.onboarding.startSetup)

        unmountWelcome()

        expect(dispatchBack()).toBe(false)
    })

    test('Back is not handled while finishing', () => {
        vi.useFakeTimers()
        const target = mountWelcome()
        toProvider(target)
        choose(target, 'welcome-provider', 'later')
        choose(target, 'welcome-set-up-now', 'no')
        press(target, language.onboarding.continue)
        press(target, language.onboarding.finish)

        expect(dispatchBack()).toBe(false)
        expect(buttonWithText(target, language.onboarding.back).disabled).toBe(true)
    })
})

describe('IME Enter', () => {
    function enter(field: HTMLInputElement, isComposing: boolean): void {
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing, bubbles: true, cancelable: true }))
        flushSync()
    }

    test('Enter during composition does not advance; Enter after it does', () => {
        const target = mountWelcome()
        toPersona(target)
        const field = textInput(target, language.name)

        enter(field, true)
        expect(heading(target)).toBe(language.onboarding.personaTitle)

        enter(field, false)
        expect(heading(target)).toBe(language.onboarding.providerTitle)
    })

    test('Enter during composition in the key input does not advance; Enter after it does', () => {
        const target = mountWelcome()
        toProvider(target)
        choose(target, 'welcome-provider', 'claude')
        const field = textInput(target, language.apiKey)
        typeInto(field, SYNTHETIC_KEY)

        enter(field, true)
        expect(heading(target)).toBe(language.onboarding.providerTitle)

        enter(field, false)
        expect(heading(target)).toBe(language.onboarding.stepMemory)
    })

    test('Enter during composition in the nickname input does not advance; Enter after it does', () => {
        const target = mountWelcome()
        press(target, language.onboarding.startSetup)
        choose(target, 'welcome-use', 'tools')
        press(target, language.onboarding.continue)
        choose(target, 'welcome-nickname', 'yes')
        const field = textInput(target, language.nickname)
        typeInto(field, 'Mira')

        enter(field, true)
        expect(heading(target)).toBe(language.onboarding.nicknameQuestion)

        enter(field, false)
        expect(heading(target)).toBe(language.onboarding.providerTitle)
    })
})

describe('IME Enter after a composition (Samsung Cheonjiin order)', () => {
    // Only a live composition holds an Enter; there is no time window. Each dispatch sets the clock first so the
    // +2 ms and +200 ms rows place the Enter at an explicit gap after compositionend.
    let now: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        now = vi.spyOn(performance, 'now')
    })

    afterEach(() => {
        now.mockRestore()
    })

    function compose(field: HTMLInputElement, type: 'compositionstart' | 'compositionend', at: number): void {
        now.mockReturnValue(at)
        field.dispatchEvent(new Event(type, { bubbles: true }))
    }

    function pressEnter(field: HTMLInputElement, at: number, keyCode = 13, shiftKey = false, isComposing = false): void {
        now.mockReturnValue(at)
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode, shiftKey, isComposing, bubbles: true, cancelable: true }))
        flushSync()
    }

    function toNicknameField(target: HTMLElement): HTMLInputElement {
        press(target, language.onboarding.startSetup)
        choose(target, 'welcome-use', 'tools')
        press(target, language.onboarding.continue)
        choose(target, 'welcome-nickname', 'yes')
        const field = textInput(target, language.nickname)
        typeInto(field, 'Mira')
        return field
    }

    function toKeyField(target: HTMLElement): HTMLInputElement {
        toProvider(target)
        choose(target, 'welcome-provider', 'claude')
        const field = textInput(target, language.apiKey)
        typeInto(field, SYNTHETIC_KEY)
        return field
    }

    const fields = [
        { label: 'name', open: (target: HTMLElement) => { toPersona(target); return textInput(target, language.name) }, stays: () => language.onboarding.personaTitle, advances: () => language.onboarding.providerTitle },
        { label: 'API key', open: toKeyField, stays: () => language.onboarding.providerTitle, advances: () => language.onboarding.stepMemory },
        { label: 'nickname', open: toNicknameField, stays: () => language.onboarding.nicknameQuestion, advances: () => language.onboarding.providerTitle },
    ]

    describe.each(fields)('$label field', ({ open, stays, advances }) => {
        test.each([2, 200])('the Enter %i ms after compositionend advances', (gap) => {
            const target = mountWelcome()
            const field = open(target)

            compose(field, 'compositionstart', 900)
            compose(field, 'compositionend', 1000)
            pressEnter(field, 1000 + gap)
            expect(heading(target)).toBe(advances())
        })

        test('after compositionstart with no compositionend, a plain Enter advances', () => {
            const target = mountWelcome()
            const field = open(target)

            compose(field, 'compositionstart', 1000)
            pressEnter(field, 1000)
            expect(heading(target)).toBe(advances())
        })

        test('a composition that never reported its end does not hold a later Enter', () => {
            const target = mountWelcome()
            const field = open(target)

            compose(field, 'compositionstart', 1000)
            pressEnter(field, 2000)
            expect(heading(target)).toBe(advances())
        })

        test('Enter with keyCode 229 does not advance', () => {
            const target = mountWelcome()
            const field = open(target)

            pressEnter(field, 1000, 229)
            expect(heading(target)).toBe(stays())
        })

        test('Enter with isComposing true does not advance', () => {
            const target = mountWelcome()
            const field = open(target)

            pressEnter(field, 1000, 13, false, true)
            expect(heading(target)).toBe(stays())
        })
    })

    test('a plain Enter with no composition advances', () => {
        const target = mountWelcome()
        toPersona(target)
        const field = textInput(target, language.name)

        pressEnter(field, 1000)
        expect(heading(target)).toBe(language.onboarding.providerTitle)
    })

    test('name: Shift+Enter with no composition does not advance', () => {
        const target = mountWelcome()
        toPersona(target)
        const field = textInput(target, language.name)

        pressEnter(field, 1000, 13, true)
        expect(heading(target)).toBe(language.onboarding.personaTitle)
    })

    test('nickname: Shift+Enter with no composition does not advance', () => {
        const target = mountWelcome()
        const field = toNicknameField(target)

        pressEnter(field, 1000, 13, true)
        expect(heading(target)).toBe(language.onboarding.nicknameQuestion)
    })

    test('API key: Shift+Enter with no composition does not advance', () => {
        const target = mountWelcome()
        const field = toKeyField(target)

        pressEnter(field, 1000, 13, true)
        expect(heading(target)).toBe(language.onboarding.providerTitle)
    })
})

describe('the finish lifecycle', () => {
    function toReviewViaLater(target: HTMLElement): void {
        toProvider(target)
        choose(target, 'welcome-provider', 'later')
        choose(target, 'welcome-set-up-now', 'no')
        press(target, language.onboarding.continue)
    }

    test('a second Finish tap does not write twice, and every control is disabled while finishing', () => {
        vi.useFakeTimers()
        const target = mountWelcome()
        toReviewViaLater(target)

        const finish = buttonWithText(target, language.onboarding.finish)
        finish.click()
        flushSync()
        finish.click()
        flushSync()

        expect(heading(target)).toBe(language.onboarding.allSet)
        expect([...target.querySelectorAll('button')].every((b) => b.disabled)).toBe(true)
        vi.advanceTimersByTime(FINISH_DISPLAY_MS * 2)
        expect(finishFirstRunMock).toHaveBeenCalledTimes(1)
    })

    test('two synchronous Finish taps before the DOM flush write once', () => {
        vi.useFakeTimers()
        const target = mountWelcome()
        toReviewViaLater(target)

        const finish = buttonWithText(target, language.onboarding.finish)
        finish.click()
        finish.click()
        flushSync()

        vi.advanceTimersByTime(FINISH_DISPLAY_MS * 2)
        expect(finishFirstRunMock).toHaveBeenCalledTimes(1)
    })

    test('the Welcome buttons ignore a tap while finishing', () => {
        vi.useFakeTimers()
        const flow = new WelcomeFlow('en-US')
        flow.skipSetup()

        flow.restore()
        flow.startSetup()
        flow.skipSetup()

        expect(restoreAtFirstRun).not.toHaveBeenCalled()
        expect(flow.index).toBe(0)
        vi.advanceTimersByTime(FINISH_DISPLAY_MS)
        expect(finishFirstRunMock).toHaveBeenCalledTimes(1)
        flow.dispose()
    })

    test('the finish timer is cancelled when the card is destroyed first', () => {
        vi.useFakeTimers()
        const target = mountWelcome()
        toReviewViaLater(target)
        press(target, language.onboarding.finish)

        unmountWelcome()
        vi.advanceTimersByTime(FINISH_DISPLAY_MS * 2)

        expect(finishFirstRunMock).not.toHaveBeenCalled()
    })
})

describe('the Hide unused modes checkbox', () => {
    function hideBox(target: HTMLElement): HTMLInputElement | null {
        return target.querySelector<HTMLInputElement>('input[type="checkbox"]')
    }

    function tickHide(target: HTMLElement, checked = true): void {
        const box = hideBox(target)
        expect(box, 'the Hide unused modes checkbox').not.toBeNull()
        if (box!.checked !== checked) {
            box!.click()
            flushSync()
        }
    }

    /** The text of every element the checkbox names in aria-describedby. */
    function descriptions(box: HTMLInputElement): string[] {
        return (box.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id !== '').map((id) => document.getElementById(id)?.textContent ?? '')
    }

    /** From the Use step, through the person's use, to Review, answering the later questions with the cheapest option. */
    function useThroughToReview(target: HTMLElement, use: 'stories' | 'tools', tick: boolean): void {
        press(target, language.onboarding.startSetup)
        choose(target, 'welcome-use', use)
        if (tick) {
            tickHide(target)
        }
        press(target, language.onboarding.continue)
        if (use === 'tools') {
            choose(target, 'welcome-nickname', 'no')
        }
        press(target, language.onboarding.continue)
        choose(target, 'welcome-provider', 'later')
        choose(target, 'welcome-set-up-now', 'no')
        press(target, language.onboarding.continue)
    }

    test('no checkbox before a pick or for Both', () => {
        const target = mountWelcome()
        press(target, language.onboarding.startSetup)
        expect(hideBox(target)).toBeNull()

        choose(target, 'welcome-use', 'both')
        expect(hideBox(target)).toBeNull()
    })

    test('Stories offers an unticked checkbox named by its label and described by the hint, with no Tools note', () => {
        const target = mountWelcome()
        press(target, language.onboarding.startSetup)
        choose(target, 'welcome-use', 'stories')

        const box = hideBox(target)!
        expect(box.checked).toBe(false)
        expect([...box.labels ?? []].map((label) => label.textContent?.trim())).toEqual([language.onboarding.hideUnused])
        expect(box.labels?.[0].className).toContain('min-h-11')
        expect(descriptions(box)).toEqual([language.onboarding.hideUnusedHintStories])

        tickHide(target)
        expect(target.textContent).not.toContain(language.onboarding.hideUnusedToolsLater)
        expect(descriptions(hideBox(target)!)).toEqual([language.onboarding.hideUnusedHintStories])
    })

    test('Tools shows the note beside the unticked box and keeps it once ticked', () => {
        const target = mountWelcome()
        press(target, language.onboarding.startSetup)
        choose(target, 'welcome-use', 'tools')

        const unticked = hideBox(target)!
        expect(unticked.checked).toBe(false)
        expect(descriptions(unticked)).toEqual([language.onboarding.hideUnusedHintTools, language.onboarding.hideUnusedToolsLater])

        tickHide(target)
        expect(hideBox(target)!.checked).toBe(true)
        expect(descriptions(hideBox(target)!)).toEqual([language.onboarding.hideUnusedHintTools, language.onboarding.hideUnusedToolsLater])
    })

    test('changing the use clears the tick, and Both offers no box', () => {
        const target = mountWelcome()
        press(target, language.onboarding.startSetup)
        choose(target, 'welcome-use', 'stories')
        tickHide(target)

        choose(target, 'welcome-use', 'tools')
        expect(hideBox(target)!.checked).toBe(false)
        tickHide(target)
        choose(target, 'welcome-use', 'both')
        expect(hideBox(target)).toBeNull()
        choose(target, 'welcome-use', 'stories')
        expect(hideBox(target)!.checked).toBe(false)
    })

    test('the flow ignores a tick when no box is offered, and clears it when the use changes', () => {
        const flow = new WelcomeFlow('en-US')

        flow.setHideUnused(true)
        expect([flow.hideUnused, flow.hidesUnused]).toEqual([false, false])
        flow.chooseUse('both')
        flow.setHideUnused(true)
        expect([flow.hideUnused, flow.hidesUnused]).toEqual([false, false])

        flow.chooseUse('stories')
        flow.setHideUnused(true)
        expect(flow.hidesUnused).toBe(true)
        flow.chooseUse('tools')
        expect([flow.hideUnused, flow.hidesUnused]).toEqual([false, false])
    })

    test('Review names the hidden modes on the Use row only when ticked, and Change returns to Use with the tick kept', () => {
        const ticked = mountWelcome()
        useThroughToReview(ticked, 'stories', true)
        expect(ticked.textContent).toContain(language.onboarding.hideUnusedReview)

        const change = ticked.querySelector<HTMLButtonElement>(`button[aria-label="${language.onboarding.change}: ${language.onboarding.stepUse}"]`)
        expect(change, 'the Change button of the Use row').not.toBeNull()
        change!.click()
        flushSync()
        expect(heading(ticked)).toBe(language.onboarding.useTitle)
        expect(hideBox(ticked)!.checked).toBe(true)
    })

    test('Review shows no hidden-modes line for an unticked box', () => {
        const target = mountWelcome()
        useThroughToReview(target, 'stories', false)

        expect(target.textContent).not.toContain(language.onboarding.hideUnusedReview)
    })

    test.each([
        ['stories', 'rp'],
        ['tools', 'utility'],
    ] as const)('a ticked %s walk finishes with only mode %s', (use, onlyMode) => {
        vi.useFakeTimers()
        const target = mountWelcome()
        useThroughToReview(target, use, true)

        press(target, language.onboarding.finish)
        vi.advanceTimersByTime(FINISH_DISPLAY_MS)

        expect(finishFirstRunMock).toHaveBeenCalledTimes(1)
        expect(finishFirstRunMock.mock.calls[0][0].onlyMode).toBe(onlyMode)
    })

    test('an unticked walk finishes with no only mode', () => {
        vi.useFakeTimers()
        const target = mountWelcome()
        useThroughToReview(target, 'stories', false)

        press(target, language.onboarding.finish)
        vi.advanceTimersByTime(FINISH_DISPLAY_MS)

        expect(finishFirstRunMock.mock.calls[0][0].onlyMode).toBeNull()
    })

    test('while finishing, the tick cannot change and the finish keeps the only mode', () => {
        vi.useFakeTimers()
        const flow = new WelcomeFlow('en-US')
        flow.chooseUse('stories')
        flow.setHideUnused(true)
        flow.chooseProvider('later')
        flow.setUpNow = false
        flow.finish()

        flow.setHideUnused(false)
        vi.advanceTimersByTime(FINISH_DISPLAY_MS)

        expect(flow.hideUnused).toBe(true)
        expect(finishFirstRunMock).toHaveBeenCalledTimes(1)
        expect(finishFirstRunMock.mock.calls[0][0].onlyMode).toBe('rp')
        flow.dispose()
    })

    test('a tick, Back to Welcome, then Restore does not finish and leaves the stored mode fields alone', () => {
        DBState.db = { userIcon: '', visibleModes: ['hybrid'], hideUnusedModes: true } as unknown as Database
        const target = mountWelcome()
        press(target, language.onboarding.startSetup)
        choose(target, 'welcome-use', 'stories')
        tickHide(target)
        press(target, language.onboarding.back)

        press(target, language.onboarding.restoreBackup)

        expect(restoreAtFirstRun).toHaveBeenCalledTimes(1)
        expect(finishFirstRunMock).not.toHaveBeenCalled()
        expect(DBState.db.visibleModes).toEqual(['hybrid'])
        expect(DBState.db.hideUnusedModes).toBe(true)
    })

    test('a tick, Back to Welcome, then Skip finishes with no only mode', () => {
        vi.useFakeTimers()
        const target = mountWelcome()
        press(target, language.onboarding.startSetup)
        choose(target, 'welcome-use', 'stories')
        tickHide(target)
        press(target, language.onboarding.back)

        press(target, language.onboarding.skipSetup)
        vi.advanceTimersByTime(FINISH_DISPLAY_MS)

        expect(finishFirstRunMock.mock.calls[0][0].onlyMode).toBeNull()
    })
})

describe('the Welcome restore lock', () => {
    /** The next restore entry call stays pending, standing in for the confirmations plus the picker. */
    function holdRestoreEntry(): { release: () => void, fail: (error: Error) => void } {
        let release: () => void = () => { }
        let fail: (error: Error) => void = () => { }
        restoreAtFirstRun.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
            release = resolve
            fail = reject
        }))
        return { release: () => release(), fail: (error) => fail(error) }
    }

    async function settled(): Promise<void> {
        await tick()
        await tick()
        flushSync()
    }

    function welcomeControls(target: HTMLElement): { start: HTMLButtonElement, restore: HTMLButtonElement, skip: HTMLButtonElement, languages: HTMLFieldSetElement } {
        return {
            start: buttonWithText(target, language.onboarding.startSetup),
            restore: buttonWithText(target, language.onboarding.restoreBackup),
            skip: buttonWithText(target, language.onboarding.skipSetup),
            languages: target.querySelector('fieldset')!,
        }
    }

    test('while the restore entry is pending, Start, Restore, Skip and the language radios are disabled', async () => {
        const target = mountWelcome()
        const held = holdRestoreEntry()

        press(target, language.onboarding.restoreBackup)

        const controls = welcomeControls(target)
        expect(controls.start.disabled).toBe(true)
        expect(controls.restore.disabled).toBe(true)
        expect(controls.skip.disabled).toBe(true)
        expect(controls.languages.disabled).toBe(true)
        held.release()
        await settled()
    })

    test('while the restore entry is pending, a second Restore, Start, language pick and Skip do nothing', async () => {
        vi.useFakeTimers()
        const flow = new WelcomeFlow('en-US')
        const held = holdRestoreEntry()

        flow.restore()
        flow.restore()
        flow.startSetup()
        flow.pickLanguage('de')
        flow.skipSetup()
        vi.advanceTimersByTime(FINISH_DISPLAY_MS)

        expect(restoreAtFirstRun).toHaveBeenCalledTimes(1)
        expect(flow.index).toBe(0)
        expect(flow.appLanguage).toBe('en')
        expect(flow.finishing).toBe(false)
        expect(finishFirstRunMock).not.toHaveBeenCalled()
        held.release()
        await settled()
        flow.dispose()
    })

    test('guard: when the entry settles, every control is enabled again and Restore starts exactly one new entry', async () => {
        const target = mountWelcome()
        const held = holdRestoreEntry()
        press(target, language.onboarding.restoreBackup)

        held.release()
        await settled()

        const controls = welcomeControls(target)
        expect(controls.start.disabled).toBe(false)
        expect(controls.restore.disabled).toBe(false)
        expect(controls.skip.disabled).toBe(false)
        expect(controls.languages.disabled).toBe(false)
        press(target, language.onboarding.restoreBackup)
        expect(restoreAtFirstRun).toHaveBeenCalledTimes(2)
        expect(heading(target)).toBe(language.onboarding.welcomeTitle)
    })

    test('an entry that rejects unlocks the controls and leaves the rejection unhandled for the global handler', async () => {
        const target = mountWelcome()
        const failure = new Error('picker threw')
        let fail: (error: Error) => void = () => { }
        const entry = new Promise<void>((_resolve, reject) => {
            fail = reject
        })
        // The promise the flow derives from the entry is the one the global rejection handler would see: nothing in the
        // flow may attach a handler to it.
        const originalFinally = entry.finally.bind(entry)
        let derived: Promise<void> | undefined
        // Plain counters, not vi.fn: a vitest spy attaches its own handler to a returned promise and would hide the check.
        const attached = { then: 0, catch: 0, finally: 0 }
        entry.finally = (onFinally) => {
            const made = originalFinally(onFinally)
            const originalThen = made.then.bind(made)
            const originalCatch = made.catch.bind(made)
            const originalFinallyOfMade = made.finally.bind(made)
            made.then = ((...handlers: Parameters<typeof originalThen>) => {
                attached.then += 1
                return originalThen(...handlers)
            }) as typeof made.then
            made.catch = ((...handlers: Parameters<typeof originalCatch>) => {
                attached.catch += 1
                return originalCatch(...handlers)
            }) as typeof made.catch
            made.finally = ((...handlers: Parameters<typeof originalFinallyOfMade>) => {
                attached.finally += 1
                return originalFinallyOfMade(...handlers)
            }) as typeof made.finally
            derived = made
            return made
        }
        restoreAtFirstRun.mockImplementationOnce(() => entry)

        press(target, language.onboarding.restoreBackup)

        expect(derived).toBeDefined()
        expect(attached).toEqual({ then: 0, catch: 0, finally: 0 })
        // The test's own handler goes on only after that check, so the rejection is never left unhandled.
        const seen = derived!.then(() => undefined, (error: unknown) => error)
        expect(attached.then).toBe(1)
        fail(failure)
        await settled()

        await expect(seen).resolves.toBe(failure)
        const controls = welcomeControls(target)
        expect(controls.restore.disabled).toBe(false)
        expect(controls.start.disabled).toBe(false)
        expect(controls.skip.disabled).toBe(false)
        expect(controls.languages.disabled).toBe(false)
    })
})
