// @vitest-environment happy-dom

/**
 * The Iris message field submits on the Enter that follows a composition end, and submits nothing from a
 * composing Enter. Every key in the field still stays out of the modal's window handler.
 *
 * Mounts the REAL `IrisModal.svelte` with fake timers so the typewriter finishes on demand. MOCKED:
 * `localforage`, the model list, `requestChatData`, `RisuAccessClient`, the Iris system prompt, the alert module
 * and the key-event filter. The Enter keydown is built like the Samsung WebView sequence (MC-329): compositionend,
 * then keydown Enter 13 with isComposing false. Only a live composition (isComposing or keyCode 229) holds an
 * Enter; there is no time window after compositionend. The gap test stubs `performance.now` to place the Enter
 * at +2 ms and +200 ms, so a guard that holds an Enter shortly after compositionend fails it.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
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
    getModelInfo: () => ({ format: 2 }),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: vi.fn(),
}) as unknown as typeof import('src/ts/process/request/request'))

vi.mock(import('src/ts/process/moduleRefList'), () => ({
    hasModuleStubs: vi.fn(() => false),
}) as unknown as typeof import('src/ts/process/moduleRefList'))

vi.mock(import('src/ts/process/moduleEnsure'), () => ({
    ensureCurrentModulesOrAlert: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/process/moduleEnsure'))

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
import { requestChatData } from 'src/ts/process/request/request'
import { enterKeydown, imeEventSequence } from 'src/ts/ime/tests/imeEventSequence'
import IrisModal from './IrisModal.svelte'

// happy-dom has no Web Animations API; Svelte transitions call `element.animate`.
Element.prototype.animate = (() => {
    const animation = {
        onfinish: null as (() => void) | null,
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

async function mountIris(): Promise<HTMLInputElement> {
    DBState.db = { language: 'en', subModel: 'supported-model', seperateModelsForAxModels: false, seperateModels: {} } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(IrisModal, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    await vi.advanceTimersByTimeAsync(5000)
    flushSync()
    return target.querySelector<HTMLInputElement>('input')!
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(requestChatData).mockReset()
    vi.mocked(requestChatData).mockResolvedValue({ type: 'success', result: 'Answer.' })
})

afterEach(async () => {
    vi.restoreAllMocks()
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    vi.useRealTimers()
})

describe('T-R-Iris the Enter that follows a composition end', () => {
    test.each([2, 200])('an Enter at +%s ms after compositionend submits once', async (gap) => {
        const field = await mountIris()
        const clock = vi.spyOn(performance, 'now')
        clock.mockReturnValue(1000)
        imeEventSequence(field, '간')
        flushSync()
        clock.mockReturnValue(1000 + gap)
        const press = enterKeydown(field)
        await vi.advanceTimersByTimeAsync(50)
        flushSync()
        expect(press.defaultPrevented).toBe(true)
        expect(requestChatData).toHaveBeenCalledTimes(1)
    })

    test.each([
        ['isComposing', { isComposing: true }],
        ['keyCode 229', { keyCode: 229 }],
    ] as const)('a composing Enter (%s) submits nothing, is not prevented and does not reach the window handler', async (_name, init) => {
        const field = await mountIris()
        imeEventSequence(field, '간')
        const onWindow = vi.fn()
        window.addEventListener('keydown', onWindow)
        const composing = enterKeydown(field, init)
        await vi.advanceTimersByTimeAsync(50)
        window.removeEventListener('keydown', onWindow)
        expect(composing.defaultPrevented).toBe(false)
        expect(requestChatData).not.toHaveBeenCalled()
        expect(onWindow).not.toHaveBeenCalled()
    })
})
