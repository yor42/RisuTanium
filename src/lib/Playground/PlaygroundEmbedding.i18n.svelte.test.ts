// @vitest-environment happy-dom

/**
 * `PlaygroundEmbedding.svelte` labels and its missing-field alerts follow the active UI
 * language, read at render and click time. The language module is switched per test and
 * restored to English afterwards. `HypaProcesser` and the alert are stubs.
 */
import { flushSync, mount, unmount } from 'svelte'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

const spies = vi.hoisted(() => ({ alertError: vi.fn() }))

vi.mock(import('src/ts/process/memory/hypamemory'), () => ({
    HypaProcesser: class {
        vectors = []
        oaikey: string | undefined
        addText() { return Promise.resolve() }
        similaritySearchScored() { return Promise.resolve([]) }
    },
}) as unknown as typeof import('src/ts/process/memory/hypamemory'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: spies.alertError,
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})

import { DBState } from 'src/ts/stores.svelte'
import { changeLanguage } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import PlaygroundEmbedding from './PlaygroundEmbedding.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountPage(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PlaygroundEmbedding, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

async function chooseModel(target: HTMLElement, model: string): Promise<void> {
    const select = target.querySelector('select') as HTMLSelectElement
    const option = Array.from(select.options).find((o) => o.value === model)
    if (!option) throw new Error('model not offered: ' + model)
    option.selected = true
    // happy-dom does not match `:checked` on an option, which Svelte's select binding
    // queries to read the choice; answer that one query from the selected index.
    const query = select.querySelector.bind(select)
    select.querySelector = ((selector: string) =>
        selector === ':checked' ? select.options[select.selectedIndex] : query(selector)) as typeof select.querySelector
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
}

const labels = (target: HTMLElement) =>
    Array.from(target.querySelectorAll('span')).map((s) => s.textContent?.trim())

async function runBlank(target: HTMLElement): Promise<void> {
    const buttons = Array.from(target.querySelectorAll('button'))
    ;(buttons[buttons.length - 1] as HTMLButtonElement).click()
    await settle()
}

beforeEach(() => {
    DBState.db = { supaMemoryKey: '', hypaCustomSettings: { url: '', key: '', model: '' } } as unknown as Database
    spies.alertError.mockReset()
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    changeLanguage('en')
})

describe('the embedding page follows the UI language', () => {
    test('guard: English shows the exact English labels and alerts', async () => {
        const target = mountPage()
        const shown = labels(target)
        for (const label of ['Model', 'Query', 'Data', 'Result', 'No result']) {
            expect(shown).toContain(label)
        }
        await chooseModel(target, 'custom')
        expect(labels(target)).toContain('Request Model')
        await runBlank(target)
        expect(spies.alertError).toHaveBeenLastCalledWith('Enter a URL for the custom embedding server.')
        await chooseModel(target, 'ada')
        await runBlank(target)
        expect(spies.alertError).toHaveBeenLastCalledWith('Enter an OpenAI API key.')
    })

    test('regression reproducer: Korean shows the Korean labels', () => {
        changeLanguage('ko')
        const shown = labels(mountPage())
        const p = languageKorean.playground
        for (const label of [languageKorean.model, p.query, p.data, p.result, p.noResult]) {
            expect(shown).toContain(label)
        }
        for (const english of ['Query', 'Data', 'Result', 'No result']) {
            expect(shown).not.toContain(english)
        }
        expect(p.query).not.toBe(languageEnglish.playground.query)
    })

    test('regression reproducer: Korean shows the Korean missing-field alerts', async () => {
        changeLanguage('ko')
        const target = mountPage()
        await chooseModel(target, 'custom')
        expect(labels(target)).toContain(languageKorean.playground.requestModel)
        await runBlank(target)
        expect(spies.alertError).toHaveBeenLastCalledWith(languageKorean.playground.embeddingUrlMissing)
        await chooseModel(target, 'ada')
        await runBlank(target)
        expect(spies.alertError).toHaveBeenLastCalledWith(languageKorean.playground.embeddingOpenAIKeyMissing)
    })
})
