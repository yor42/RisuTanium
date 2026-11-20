// @vitest-environment happy-dom

/**
 * The Claude thinking parameters judge an aux mode's slot model for the XHigh effort option, whatever the saved
 * `seperateModelsForAxModels` flag holds, and fall back to the sub model for an empty slot.
 *
 * Mounts the REAL `ClaudeThinkingSeparateParams.svelte`; `getModelInfo` is mocked so that only the model id
 * `aux-m` carries `claudeXHighEffort`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { LLMFlags } from 'src/ts/model/types'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
}))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn((id: string) => ({ parameters: [], flags: id === 'aux-m' ? [LLMFlags.claudeXHighEffort] : [] })),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    get DBState() { return { db: h.db } },
}) as unknown as typeof import('src/ts/stores.svelte'))

import ClaudeThinkingSeparateParams from './ClaudeThinkingSeparateParams.svelte'
import type { SeparateParameters } from 'src/ts/storage/database.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function panelText(db: Record<string, unknown>, paramKey: string): string {
    h.db = db
    const target = document.createElement('div')
    document.body.appendChild(target)
    const value = { thinking_type: 'adaptive' } as unknown as SeparateParameters
    const app = mount(ClaudeThinkingSeparateParams, { target, props: { value, paramKey } }) as unknown as Record<string, unknown>
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

describe('ClaudeThinkingSeparateParams effective model for an aux key', () => {
    test('PS2: the slot model is judged with the saved flag off', () => {
        const text = panelText({ subModel: 'sub-m', seperateModelsForAxModels: false, seperateModels: { memory: 'aux-m' } }, 'memory')

        expect(text).toContain('XHigh')
    })

    test('guard: an empty slot, a missing key and a missing object judge the sub model', () => {
        for (const seperateModels of [{ memory: '' }, {}, undefined]) {
            expect(panelText({ subModel: 'sub-m', seperateModels }, 'memory')).not.toContain('XHigh')
        }
        expect(panelText({ subModel: 'aux-m', seperateModels: { memory: '' } }, 'memory')).toContain('XHigh')
    })
})
