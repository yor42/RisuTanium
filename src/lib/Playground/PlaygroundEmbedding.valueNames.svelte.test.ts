// @vitest-environment jsdom

/**
 * `PlaygroundEmbedding.svelte` value controls: the model select is named by its visible "Model" label text
 * through `aria-labelledby`, with that label first in `aria-describedby`, in every embedding-model branch
 * (local, OpenAI keyed, custom URL). Mounts the REAL page over a real `$state` database with the real shared
 * inputs; the embedding processor is a stub because it is not part of the page's markup.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/process/memory/hypamemory'), () => ({
    HypaProcesser: class {},
}) as unknown as typeof import('src/ts/process/memory/hypamemory'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import { fieldNameProblems, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import PlaygroundEmbedding from './PlaygroundEmbedding.svelte'

let mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

function mountWithModel(hypaModel: string): HTMLElement {
    DBState.db = {
        hypaModel,
        supaMemoryKey: '',
        hypaCustomSettings: { url: '', key: '', model: '' },
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PlaygroundEmbedding, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('PlaygroundEmbedding value control names', () => {
    const TABLE = () => [{ name: language.model }]

    test.each(['MiniLM', 'openai3small', 'custom'])('the model select is named "Model" with the %s branch rendered', (model) => {
        const target = mountWithModel(model)
        expect(fieldNameProblems(target, TABLE())).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual([])
    })

    test('the model select does not use a screen-reader-only name span (the visible label names it)', () => {
        const target = mountWithModel('MiniLM')
        expect(target.querySelectorAll('span.sr-only').length).toBe(0)
    })
})
