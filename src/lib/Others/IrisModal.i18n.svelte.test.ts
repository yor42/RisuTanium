// @vitest-environment happy-dom

/**
 * `IrisModal.svelte` opens a fresh dialogue with the intro line and tip of the UI language,
 * and shows the unsupported-model notice and its controls in that language. The language is
 * set before mount (the stored language setting and the language module agree) and restored
 * to English afterwards. A dialogue saved in storage loads exactly as saved, in any language,
 * and resetting the dialogue rebuilds the intro in the current language.
 *
 * Mounts the REAL component with fake timers, so the typewriter finishes on demand.
 * MOCKED: `localforage` (an in-memory `current_dialogue` item), the model list lookup,
 * `requestChatData`, `RisuAccessClient`, the Iris system prompt, the alert module and the
 * key-event filter. No request is sent.
 *
 * Tests whose title starts with `guard:` pass with or without the translation work.
 * Tests starting `regression reproducer:` fail while a line is served from the hard-coded
 * English or two-language table.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

const forage = vi.hoisted(() => ({
    saved: null as unknown,
    fail: false,
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => {
                if (forage.fail) throw new Error('storage unavailable')
                return forage.saved
            }),
            setItem: vi.fn(async (_key: string, value: unknown) => { forage.saved = value }),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        irisStore: { open: true },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/model/modellist'), () => ({
    LLMFormat: { Anthropic: 1, OpenAICompatible: 2, VertexAIGemini: 3, GoogleCloud: 4, Other: 99 },
    getModelInfo: (id: string) => ({ format: id.startsWith('supported') ? 2 : 99 }),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: vi.fn(),
}) as unknown as typeof import('src/ts/process/request/request'))

vi.mock(import('src/ts/process/mcp/risuaccess'), () => ({
    RisuAccessClient: class { async getToolList() { return [] } },
}) as unknown as typeof import('src/ts/process/mcp/risuaccess'))

vi.mock(import('src/ts/iris'), () => ({
    getIrisSystemPrompt: vi.fn(async () => 'system'),
}) as unknown as typeof import('src/ts/iris'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/keyEventBlocked'), () => ({
    keyEventBlocked: vi.fn(() => false),
}) as unknown as typeof import('src/ts/keyEventBlocked'))

import { DBState } from 'src/ts/stores.svelte'
import { changeLanguage, language } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import { languageVietnamese } from 'src/lang/vi'
import IrisModal from './IrisModal.svelte'

// happy-dom has no Web Animations API; Svelte transitions call `element.animate`. This stub
// reports each animation finished at once so that intro and outro blocks complete.
interface FinishedAnimation {
    onfinish: (() => void) | null
    cancel: () => void
    finish: () => void
    pause: () => void
    play: () => void
    currentTime: number
}
Element.prototype.animate = (() => {
    const animation: FinishedAnimation = {
        onfinish: null,
        cancel() {},
        finish() { animation.onfinish?.() },
        pause() {},
        play() {},
        currentTime: 0,
    }
    queueMicrotask(() => animation.onfinish?.())
    return animation
}) as unknown as typeof Element.prototype.animate

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

async function mountIris(code: 'en' | 'ko' | 'vi', subModel = 'supported-model'): Promise<HTMLElement> {
    DBState.db = { language: code, subModel, seperateModelsForAxModels: false, seperateModels: {} } as unknown as Database
    changeLanguage(code)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(IrisModal, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    await finishTyping()
    return target
}

async function finishTyping(): Promise<void> {
    await vi.advanceTimersByTimeAsync(5000)
    flushSync()
}

function normalized(target: HTMLElement): string {
    return (target.textContent ?? '').replace(/\s+/g, ' ')
}

beforeEach(() => {
    vi.useFakeTimers()
    forage.saved = null
    forage.fail = false
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    vi.useRealTimers()
    changeLanguage('en')
})

describe('IrisModal intro dialogue', () => {
    test('regression reproducer: a fresh Vietnamese dialogue shows the Vietnamese intro line and tip', async () => {
        const target = await mountIris('vi')
        const text = normalized(target)
        expect(languageVietnamese.iris.introText).not.toBe(languageEnglish.iris.introText)
        expect(text).toContain(languageVietnamese.iris.introText)
        expect(text).toContain(languageVietnamese.iris.introTip)
        expect(text).not.toContain("Hello there. I've been waiting for you.")
    })

    test('regression reproducer: a Vietnamese dialogue falls back to the Vietnamese intro when storage fails', async () => {
        forage.fail = true
        const target = await mountIris('vi')
        expect(normalized(target)).toContain(languageVietnamese.iris.introText)
    })

    test('regression reproducer: resetting a Vietnamese dialogue rebuilds the Vietnamese intro', async () => {
        forage.saved = [
            { speaker: 'Iris', text: 'Saved line.' },
            { speaker: 'You', text: 'Saved answer' },
        ]
        const target = await mountIris('vi')
        expect(normalized(target)).not.toContain(languageVietnamese.iris.introText)

        // The controls are found by their translated text, else by the English literal.
        const control = (attr: string, translated: string, english: string) =>
            target.querySelector(`button[${attr}="${translated}"]`) ?? target.querySelector(`button[${attr}="${english}"]`)
        ;(control('title', languageVietnamese.iris.viewBacklog, 'View backlog (L)') as HTMLButtonElement).click()
        flushSync()
        ;(control('aria-label', languageVietnamese.reset, 'Reset') as HTMLButtonElement).click()
        await finishTyping()

        expect(normalized(target)).toContain(languageVietnamese.iris.introText)
        expect(forage.saved).toEqual([
            { speaker: 'Iris', text: languageVietnamese.iris.introText, tip: languageVietnamese.iris.introTip },
        ])
    })

    test('guard: a fresh Korean dialogue shows the Korean intro line and tip unchanged', async () => {
        const target = await mountIris('ko')
        const text = normalized(target)
        expect(text).toContain('안녕하세요. 아이리스라고 합니다~.')
        expect(text).toContain('아이리스는 보조 모델을 사용하며, Risuai의 전반적인 데이터에 접근할 수 있습니다.')
        expect(languageKorean.iris.introText).toBe('안녕하세요. 아이리스라고 합니다~.')
    })

    test('guard: a fresh English dialogue shows the English intro line and tip', async () => {
        const target = await mountIris('en')
        const text = normalized(target)
        expect(text).toContain("Hello there. I've been waiting for you.")
        expect(text).toContain('Iris can access various data through the Risuai system. It uses ax model defined in config.')
    })

    test('guard: a saved dialogue loads as saved in Vietnamese, with no intro line mixed in', async () => {
        forage.saved = [
            { speaker: 'Iris', text: 'Saved line.' },
            { speaker: 'You', text: 'Saved answer' },
        ]
        const target = await mountIris('vi')
        const text = normalized(target)
        expect(text).toContain('Saved answer')
        expect(text).not.toContain(languageVietnamese.iris.introText)
        expect(text).not.toContain("Hello there. I've been waiting for you.")
        expect(forage.saved).toEqual([
            { speaker: 'Iris', text: 'Saved line.' },
            { speaker: 'You', text: 'Saved answer' },
        ])
    })
})

describe('IrisModal unsupported-model notice and controls', () => {
    test('regression reproducer: Vietnamese shows the unsupported-model line in Vietnamese', async () => {
        const target = await mountIris('vi', 'plugin-model')
        const text = normalized(target)
        expect(text).toContain(languageVietnamese.iris.unsupportedModel)
        expect(text).not.toContain("It seems your current model doesn't support me responding")
    })

    test('guard: Korean shows the unsupported-model line unchanged', async () => {
        const target = await mountIris('ko', 'plugin-model')
        expect(normalized(target)).toContain('현재 모델이 제가 응답하는걸 지원하지 않는 것 같아요. 플러그인이 아닌 GPT, Claude, Gemini 모델로 전환해주세요.')
    })

    test('guard: no unsupported-model line is shown for a supported model', async () => {
        const target = await mountIris('vi', 'supported-model')
        expect(normalized(target)).not.toContain(languageVietnamese.iris.unsupportedModel)
    })

    test('regression reproducer: Vietnamese labels the backlog, close and send controls in Vietnamese', async () => {
        const target = await mountIris('vi')
        const vi_ = languageVietnamese
        expect(target.querySelector(`button[title="${vi_.iris.viewBacklog}"]`)).not.toBeNull()
        expect(target.querySelector(`button[aria-label="${vi_.uiCommon.close}"]`)).not.toBeNull()
        expect(target.querySelector('button[title="View backlog (L)"]')).toBeNull()
        expect(target.querySelector('button[aria-label="Close"]')).toBeNull()
        expect(language.uiCommon.send).toBe(vi_.uiCommon.send)
        expect(normalized(target)).toContain(vi_.uiCommon.send)
    })
})
