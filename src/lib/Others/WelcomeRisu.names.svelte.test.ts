// @vitest-environment jsdom

/**
 * Accessible names of the Welcome step controls, walked through the card's own buttons. Radios and the
 * Hide-unused checkbox are named by `aria-label` equal to their visible text; text fields are named by
 * `aria-labelledby` and their `aria-describedby` lists that label first, then their hints. Hints,
 * descriptions and badges reach the radios through `aria-describedby`.
 *
 * These are name-level reproducers: they read the attributes a screen reader computes from, not what
 * Android TalkBack speaks. The Note 9 rows N4 and N5 are the acceptance.
 *
 * MOCKED: the module set of `WelcomeRisu.steps.svelte.test.ts` (database, templates, colour updater,
 * persona picker, image lookup, restore entries, `finishFirstRun`). Keys are synthetic placeholders.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { controlDescription, controlName, controls } from 'src/lib/a11yNames.test-helpers'
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

vi.mock(import('src/ts/drive/settingsRestore'), () => ({
    restoreFromBinFileAtFirstRun: vi.fn(async () => {}),
    restoreFromBinFile: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/drive/settingsRestore'))

vi.mock(import('src/ts/firstRun/firstRunChoices'), async (importOriginal) => ({
    ...(await importOriginal()),
    finishFirstRun: vi.fn(),
}))

import { changeLanguage, language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import { FIRST_RUN_LANGUAGES, MEMORY_SIZES } from 'src/ts/firstRun/firstRunChoices'
import WelcomeRisu from './WelcomeRisu.svelte'
import { LANGUAGE_NAMES } from './Welcome/welcomeFlow.svelte'

// A shape no provider prefix matches, so the non-standard-key advisory is shown.
const SYNTHETIC_KEY = 'placeholder-key-0001'

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

function press(target: HTMLElement, text: string): void {
    const button = [...target.querySelectorAll('button')].find((b) => b.textContent === text)
    expect(button, `button "${text}"`).toBeDefined()
    button!.click()
    flushSync()
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

/** Every radio, checkbox, text input and textarea of the card. */
function fields(target: HTMLElement): Element[] {
    return controls(target, { fields: true }).filter((el) => el.matches('input, textarea'))
}

function expectAllNamed(target: HTMLElement): void {
    for (const field of fields(target)) {
        expect(controlName(field), `<${field.tagName.toLowerCase()} ${field.getAttribute('name') ?? field.id}>`).not.toBe('')
    }
}

function textField(target: HTMLElement, selector: string): HTMLElement {
    const found = target.querySelector<HTMLElement>(selector)
    expect(found, selector).not.toBeNull()
    return found!
}

/** A text field is named by its visible label and described by that label first, then its hints. */
function expectNamedField(field: HTMLElement, name: string, hints: string[] = []): void {
    expect(controlName(field)).toBe(name)
    expect(field.hasAttribute('aria-labelledby')).toBe(true)
    expect(controlDescription(field)).toBe([name, ...hints].join(' '))
    expect((field.getAttribute('aria-describedby') ?? '').split(/\s+/)[0]).toBe(field.getAttribute('aria-labelledby'))
}

/** A radio or checkbox is named by an `aria-label` equal to its visible text, never by `aria-labelledby`. */
function expectChoice(input: Element, name: string, description: string): void {
    expect(controlName(input)).toBe(name)
    expect(input.getAttribute('aria-label')).toBe(name)
    expect(input.hasAttribute('aria-labelledby')).toBe(false)
    expect(controlDescription(input)).toBe(description)
}

beforeEach(() => {
    DBState.db = { userIcon: '' } as Database
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

describe('Welcome step control names', () => {
    test('regression reproducer: the stories walk names every radio, the checkbox and the fields', () => {
        const target = mountWelcome('ko-KR')

        // Step 1: the language radios, with the browser-language tag on the detected one.
        expect(fields(target)).toHaveLength(FIRST_RUN_LANGUAGES.length)
        let tagged = 0
        for (const code of FIRST_RUN_LANGUAGES) {
            const input = radio(target, 'welcome-language', code)
            const tag = input.closest('label')!.querySelectorAll('span')[1]
            tagged += tag ? 1 : 0
            expectChoice(input, LANGUAGE_NAMES[code], tag ? tag.textContent! : '')
        }
        expect(tagged).toBe(1)
        expectAllNamed(target)
        press(target, language.onboarding.startSetup)

        // Step 2: use radios, then the Hide-unused checkbox for stories.
        expectChoice(radio(target, 'welcome-use', 'stories'), language.onboarding.useStories, '')
        expectChoice(radio(target, 'welcome-use', 'both'), language.onboarding.useBoth, '')
        expectChoice(radio(target, 'welcome-use', 'tools'), language.onboarding.useTools, '')
        choose(target, 'welcome-use', 'stories')
        const hide = textField(target, 'input[type="checkbox"]')
        expectChoice(hide, language.onboarding.hideUnused, language.onboarding.hideUnusedHintStories)
        expectAllNamed(target)
        press(target, language.onboarding.continue)

        // Step 3 (persona): name input and description textarea.
        expectNamedField(textField(target, 'input[type="text"]'), language.name)
        expectNamedField(textField(target, 'textarea'), language.description)
        expectAllNamed(target)
        press(target, language.onboarding.continue)

        // Step 4: provider radios, then the API key field with its advisory.
        const providers: [string, string, string][] = [
            ['claude', 'Claude', `${language.recommended} ${language.setup.claudeDesc}`],
            ['openai', 'OpenAI', `${language.recommended} ${language.setup.openAIDesc}`],
            ['gemini', 'Gemini', `${language.recommended} ${language.onboarding.geminiDesc}`],
            ['openrouter', 'OpenRouter', language.setup.openRouterProvider],
            ['horde', 'Horde', language.setup.hordeProvider],
            ['later', language.onboarding.setUpLater, ''],
        ]
        for (const [value, name, description] of providers) {
            expectChoice(radio(target, 'welcome-provider', value), name, description)
        }
        choose(target, 'welcome-provider', 'claude')
        const key = textField(target, '#welcome-api-key')
        expectNamedField(key, language.apiKey)
        typeInto(key as HTMLInputElement, SYNTHETIC_KEY)
        const advisory = textField(target, '[data-key-advisory]')
        expectNamedField(key, language.apiKey, [advisory.textContent!])
        expectAllNamed(target)
        press(target, language.onboarding.continue)

        // Step 5: chat language radios (the language is not English).
        const chatOptions: [string, string, string][] = [
            ['english', language.setup.chooseChatTypeOption1, language.setup.chooseChatTypeOption1Desc],
            ['englishProcessing', language.setup.chooseChatTypeOption2, language.setup.chooseChatTypeOption2Desc],
            ['ownLanguage', language.setup.chooseChatTypeOption3, language.setup.chooseChatTypeOption3Desc],
        ]
        for (const [value, name, description] of chatOptions) {
            expectChoice(radio(target, 'welcome-chat-language', value), name, description)
        }
        expectAllNamed(target)
        choose(target, 'welcome-chat-language', 'english')
        press(target, language.onboarding.continue)

        // Step 6: memory radios, with the badge on Balanced only.
        const memoryOptions: [string, string, string, boolean][] = [
            ['cheap', language.setup.chooseCheapOrMemoryOption2, language.setup.chooseCheapOrMemoryOption2Desc, false],
            ['balanced', language.setup.chooseCheapOrMemoryOption3, language.setup.chooseCheapOrMemoryOption3Desc, true],
            ['memory', language.setup.chooseCheapOrMemoryOption1, language.setup.chooseCheapOrMemoryOption1Desc, false],
            ['unlimited', language.setup.chooseCheapOrMemoryOption4, language.setup.chooseCheapOrMemoryOption4Desc, false],
        ]
        for (const [value, name, description, recommended] of memoryOptions) {
            const sizes = MEMORY_SIZES[value as keyof typeof MEMORY_SIZES]
            const hint = language.onboarding.tokenSizes(sizes.maxContext, sizes.maxResponse)
            const expected = [recommended ? language.recommended : '', description, hint].filter((part) => part !== '').join(' ')
            expectChoice(radio(target, 'welcome-memory', value), name, expected)
        }
        expectAllNamed(target)
    })

    test('regression reproducer: the tools walk names the checkbox note, the nickname and the set-up-now radios', () => {
        const target = mountWelcome('ko-KR')
        press(target, language.onboarding.startSetup)
        choose(target, 'welcome-use', 'tools')
        const hide = textField(target, 'input[type="checkbox"]')
        expectChoice(hide, language.onboarding.hideUnused, `${language.onboarding.hideUnusedHintTools} ${language.onboarding.hideUnusedToolsLater}`)
        expectAllNamed(target)
        press(target, language.onboarding.continue)

        expectChoice(radio(target, 'welcome-nickname', 'yes'), language.onboarding.yes, '')
        expectChoice(radio(target, 'welcome-nickname', 'no'), language.onboarding.no, '')
        choose(target, 'welcome-nickname', 'yes')
        expectNamedField(textField(target, 'input[type="text"]'), language.nickname)
        expectAllNamed(target)
        typeInto(textField(target, 'input[type="text"]') as HTMLInputElement, 'Mira')
        press(target, language.onboarding.continue)

        choose(target, 'welcome-provider', 'later')
        expectChoice(radio(target, 'welcome-set-up-now', 'yes'), language.onboarding.yes, '')
        expectChoice(radio(target, 'welcome-set-up-now', 'no'), language.onboarding.no, '')
        expectAllNamed(target)
    })
})
