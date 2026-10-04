// @vitest-environment happy-dom

/**
 * `PlaygroundEmbedding.svelte` (the Playground's embedding tool): the OpenAI key and the
 * custom URL are the page's own copies, seeded from the memory settings and never written
 * back; a blank copy stops the run instead of falling back to the saved value; a failing
 * embed clears the spinner and is shown as an error. The custom key and request model stay
 * bound to the memory settings.
 *
 * Mounts the REAL `PlaygroundEmbedding.svelte` over a real `$state` database. `HypaProcesser`
 * is a recording stub. Titles beginning "guard:" pin behaviour that must be preserved;
 * "regression reproducer:" titles fail against a page that binds the memory settings
 * directly or lets an embed failure escape.
 */
import { flushSync, mount, unmount } from 'svelte'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const hypa = vi.hoisted(() => ({
    created: [] as Array<{ model: string, url: string | undefined, oaikey: string | undefined }>,
    addText: vi.fn(async (_texts: string[]) => {}),
    search: vi.fn(async (_query: string): Promise<[string, number][]> => []),
    alertError: vi.fn(),
}))

vi.mock(import('src/ts/process/memory/hypamemory'), () => ({
    HypaProcesser: class {
        vectors = []
        oaikey: string | undefined
        constructor(model: string, url?: string) {
            const record = { model, url, oaikey: undefined as string | undefined }
            hypa.created.push(record)
            Object.defineProperty(this, 'oaikey', {
                get: () => record.oaikey,
                set: (value: string) => { record.oaikey = value },
            })
        }
        addText(texts: string[]) { return hypa.addText(texts) }
        similaritySearchScored(query: string) { return hypa.search(query) }
    },
}) as unknown as typeof import('src/ts/process/memory/hypamemory'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: hypa.alertError,
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import PlaygroundEmbedding from './PlaygroundEmbedding.svelte'

//#region helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function installDb(): void {
    DBState.db = {
        supaMemoryKey: 'sk-live',
        hypaCustomSettings: { url: 'http://live.example/v1', key: 'live-key', model: 'live-model' },
    } as unknown as Database
}

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

/** The text input that follows the label whose text is exactly `label`. */
function field(target: HTMLElement, label: string): HTMLInputElement {
    const span = Array.from(target.querySelectorAll('span')).find((s) => s.textContent?.trim() === label)
    if (!span) throw new Error('label not shown: ' + label)
    return span.nextElementSibling as HTMLInputElement
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
}

const runButton = (target: HTMLElement) => {
    const buttons = Array.from(target.querySelectorAll('button'))
    return buttons[buttons.length - 1] as HTMLButtonElement
}

async function run(target: HTMLElement): Promise<void> {
    runButton(target).click()
    await settle()
}

beforeEach(() => {
    installDb()
    hypa.created.length = 0
    hypa.addText.mockReset().mockResolvedValue(undefined)
    hypa.search.mockReset().mockResolvedValue([])
    hypa.alertError.mockReset()
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('the embedding page: the OpenAI key and custom URL copies', () => {
    test('guard: the fields start with the memory settings values', async () => {
        const target = mountPage()
        await chooseModel(target, 'openai3small')
        expect(field(target, 'OpenAI API Key').value).toBe('sk-live')
        await chooseModel(target, 'custom')
        expect(field(target, 'URL').value).toBe('http://live.example/v1')
    })

    test('regression reproducer: editing the key and URL leaves the memory settings unchanged', async () => {
        const target = mountPage()
        await chooseModel(target, 'openai3small')
        await type(field(target, 'OpenAI API Key'), 'sk-local')
        await chooseModel(target, 'custom')
        await type(field(target, 'URL'), 'http://local.example')
        expect(DBState.db.supaMemoryKey).toBe('sk-live')
        expect(DBState.db.hypaCustomSettings.url).toBe('http://live.example/v1')
    })

    test('regression reproducer: Run uses the edited URL for a custom model', async () => {
        const target = mountPage()
        await chooseModel(target, 'custom')
        await type(field(target, 'URL'), 'http://local.example')
        await run(target)
        expect(hypa.created).toEqual([{ model: 'custom', url: 'http://local.example', oaikey: 'sk-live' }])
    })

    test('regression reproducer: Run uses the edited key for an OpenAI model', async () => {
        const target = mountPage()
        await chooseModel(target, 'openai3small')
        await type(field(target, 'OpenAI API Key'), 'sk-local')
        await run(target)
        expect(hypa.created.length).toBe(1)
        expect(hypa.created[0].oaikey).toBe('sk-local')
    })

    test('regression reproducer: a blank or whitespace-only URL stops a custom run with an error', async () => {
        const target = mountPage()
        await chooseModel(target, 'custom')
        for (const blank of ['', '   ']) {
            await type(field(target, 'URL'), blank)
            await run(target)
        }
        expect(hypa.created).toEqual([])
        expect(hypa.addText).not.toHaveBeenCalled()
        expect(hypa.alertError).toHaveBeenCalledTimes(2)
    })

    test('regression reproducer: a blank or whitespace-only key stops an OpenAI run with an error', async () => {
        const target = mountPage()
        await chooseModel(target, 'ada')
        for (const blank of ['', '   ']) {
            await type(field(target, 'OpenAI API Key'), blank)
            await run(target)
        }
        expect(hypa.created).toEqual([])
        expect(hypa.addText).not.toHaveBeenCalled()
        expect(hypa.alertError).toHaveBeenCalledTimes(2)
    })

    test('guard: a local model runs without a key or URL', async () => {
        DBState.db.supaMemoryKey = ''
        DBState.db.hypaCustomSettings.url = ''
        const target = mountPage()
        await run(target)
        expect(hypa.created.length).toBe(1)
        expect(hypa.alertError).not.toHaveBeenCalled()
    })
})

describe('the embedding page: the shared custom key and model', () => {
    test('guard: editing the custom key and request model writes the memory settings', async () => {
        const target = mountPage()
        await chooseModel(target, 'custom')
        await type(field(target, 'Key/Password'), 'new-key')
        await type(field(target, 'Request Model'), 'new-model')
        expect(DBState.db.hypaCustomSettings.key).toBe('new-key')
        expect(DBState.db.hypaCustomSettings.model).toBe('new-model')
    })
})

describe('the embedding page: a failing run', () => {
    test('regression reproducer: a failing embed clears the spinner and shows the error', async () => {
        hypa.addText.mockRejectedValueOnce(new Error('embed failed'))
        const target = mountPage()
        await run(target)
        expect(target.querySelector('.loadmove')).toBeNull()
        expect(hypa.alertError).toHaveBeenCalledTimes(1)
        expect((hypa.alertError.mock.calls[0][0] as Error).message).toBe('embed failed')
    })

    test('regression reproducer: a thrown string is shown as an error too', async () => {
        hypa.search.mockRejectedValueOnce('plain failure')
        const target = mountPage()
        await run(target)
        expect(target.querySelector('.loadmove')).toBeNull()
        expect(hypa.alertError).toHaveBeenCalledWith('plain failure')
    })

    test('regression reproducer: after a failure the next run starts', async () => {
        hypa.addText.mockRejectedValueOnce(new Error('embed failed'))
        const target = mountPage()
        await run(target)
        await run(target)
        expect(hypa.created.length).toBe(2)
    })
})
