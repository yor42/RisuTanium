// @vitest-environment happy-dom

/**
 * IrisModal judges the other-auxiliary slot model for its unsupported-model notice, whatever the saved
 * `seperateModelsForAxModels` flag holds, and falls back to the sub model when the slot is empty.
 *
 * Mounts the REAL `IrisModal.svelte`. MOCKED: `localforage`, the model list (the format follows the model id),
 * `requestChatData`, `RisuAccessClient`, the Iris system prompt, the alert module and the key-event filter.
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
    getModelInfo: (id: string) => ({ format: id === 'supported' ? 1 : 99 }),
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

async function noticeShown(db: Record<string, unknown>): Promise<boolean> {
    DBState.db = { language: 'en', ...db } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(IrisModal, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    await vi.advanceTimersByTimeAsync(5000)
    flushSync()
    return target.querySelector('[class*="bg-red-600"]') !== null
}

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    vi.useRealTimers()
})

describe('IrisModal unsupported-model notice follows the other-auxiliary slot', () => {
    test('IR1: a supported slot clears the notice for an unsupported sub model with the saved flag off', async () => {
        expect(await noticeShown({ subModel: 'unsupported', seperateModelsForAxModels: false, seperateModels: { otherAx: 'supported' } })).toBe(false)
    })

    test('guard: an empty slot judges the sub model', async () => {
        expect(await noticeShown({ subModel: 'unsupported', seperateModelsForAxModels: false, seperateModels: { otherAx: '' } })).toBe(true)
        expect(await noticeShown({ subModel: 'supported', seperateModelsForAxModels: false, seperateModels: { otherAx: '' } })).toBe(false)
    })

    test('guard: a profile without a slot object judges the sub model without throwing', async () => {
        expect(await noticeShown({ subModel: 'unsupported' })).toBe(true)
    })
})
