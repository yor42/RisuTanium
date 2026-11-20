// @vitest-environment happy-dom

/**
 * The separate-parameters panel judges an aux mode's slot model, whatever the saved
 * `seperateModelsForAxModels` flag holds, and falls back to the sub model for an empty slot.
 *
 * Mounts the REAL `AllSeperateParameters.svelte`; `getModelInfo` is mocked so that only the model id `aux-m`
 * lists `temperature`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn((id: string) => ({ parameters: id === 'aux-m' ? ['temperature'] : [], flags: [] })),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock('src/lib/Setting/Pages/ClaudeThinkingSeparateParams.svelte', () => ({ default: () => { } }))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ characters: [], allowAllExtentionFiles: false })),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    get DBState() { return { db: h.db } },
    selectedCharID: { subscribe: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/characters'), () => ({
    createBlankChar: vi.fn(),
    getCharImage: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))

import AllSeperateParameters from './AllSeperateParameters.svelte'
import type { SeparateParameters } from 'src/ts/storage/database.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function panelText(db: Record<string, unknown>, paramKey: string): string {
    h.db = db
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(AllSeperateParameters, { target, props: { value: {} as SeparateParameters, paramKey } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target.textContent ?? ''
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('AllSeperateParameters effective model for an aux key', () => {
    test('PS1: the slot model is judged with the saved flag off', () => {
        const text = panelText({ subModel: 'sub-m', seperateModelsForAxModels: false, seperateModels: { memory: 'aux-m' } }, 'memory')

        expect(text).toContain(language.temperature)
    })

    test('guard: an empty slot, a missing key and a missing object judge the sub model', () => {
        for (const seperateModels of [{ memory: '' }, {}, undefined]) {
            const text = panelText({ subModel: 'sub-m', seperateModels }, 'memory')

            expect(text).not.toContain(language.temperature)
        }
        expect(panelText({ subModel: 'aux-m', seperateModels: { memory: '' } }, 'memory')).toContain(language.temperature)
    })

    test('guard: a model-id key is judged as itself', () => {
        expect(panelText({ subModel: 'sub-m', seperateModels: { memory: 'sub-m' } }, 'aux-m')).toContain(language.temperature)
    })
})
