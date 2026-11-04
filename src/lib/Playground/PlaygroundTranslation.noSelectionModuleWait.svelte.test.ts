// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MODULE_STUB_KEY } from 'src/ts/storage/moduleStub'
import type { RisuModule } from 'src/ts/process/modules'

const h = vi.hoisted(() => ({
    state: { db: { modules: [] as Array<Record<string, string | number>>, enabledModules: ['m1'], characters: [], personas: [], moduleIntergration: '', translatorType: 'llm' } },
    alerts: [] as string[],
    run: vi.fn(async (text: string) => text),
}))
vi.mock('src/ts/stores.svelte', () => ({
    DBState: h.state,
    selectedCharID: writable(-1),
    ReloadGUIPointer: writable(0),
}))
vi.mock('src/ts/storage/database.svelte', () => ({
    getDatabase: () => h.state.db,
    getCurrentCharacter: () => null,
    getCurrentChat: () => null,
}))
vi.mock('src/ts/util', () => ({
    checkPersonaBinded: () => false,
}))
vi.mock('src/ts/alert', () => ({
    alertError: (value: string) => { h.alerts.push(value) },
}))
vi.mock('src/ts/translator/translator', () => ({
    runTranslator: h.run,
    LLMCacheStorage: { clear: vi.fn() },
}))
vi.mock('src/ts/globalApi.svelte', () => ({
    getLanguageCodes: () => [{ code: 'en', name: 'English' }],
}))
vi.mock('src/ts/tokenizer', () => ({
    tokenize: async () => 0,
}))
vi.mock('../UI/GUI/TextAreaInput.svelte', () => ({
    default: (anchor: Comment, props: { value: string }) => {
        const area = document.createElement('textarea')
        anchor.before(area)
        $effect(() => { area.value = props.value })
        area.addEventListener('input', () => { props.value = area.value })
    },
}))

import { language } from 'src/lang'
import { moduleLoadFailedText } from 'src/ts/process/moduleRefList'
import { registerModuleLoader, unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'
import PlaygroundTranslation from './PlaygroundTranslation.svelte'

let target: HTMLElement
let app: ReturnType<typeof mount>
let calls: string[]
let release: () => void
let failing: boolean
function stub(): Record<string, string | number> {
    return { id: 'm1', name: 'Alpha', [MODULE_STUB_KEY]: 1 }
}
async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
}
function button(): HTMLButtonElement {
    return target.querySelector('button') as HTMLButtonElement
}
async function input(text: string): Promise<void> {
    const area = target.querySelector('textarea') as HTMLTextAreaElement
    area.value = text
    area.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
}
async function bulk(): Promise<void> {
    ;(target.querySelector('input[type="checkbox"]') as HTMLInputElement).click()
    await settle()
}
beforeEach(() => {
    calls = []
    release = () => {}
    failing = false
    h.alerts.length = 0
    h.run.mockClear()
    h.state.db.modules = [stub()]
    h.state.db.translatorType = 'llm'
    registerModuleLoader(async (handle) => {
        const id = handle.slice(0, handle.lastIndexOf('#'))
        calls.push(id)
        await new Promise<void>((resolve) => { release = resolve })
        if(failing) throw new Error('load failed')
        const loaded = { id, name: 'Alpha' }
        h.state.db.modules[0] = loaded
        return loaded as RisuModule
    })
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(PlaygroundTranslation, { target, props: {} })
    flushSync()
})
afterEach(async () => {
    await unmount(app)
    target.remove()
    unregisterModuleLoader()
})
describe('no-selection Playground translation module wait', () => {
    test('T1 single run waits and shows loading', async () => {
        await input('hello')
        button().click()
        await settle()
        expect(calls).toEqual(['m1'])
        expect(h.run).not.toHaveBeenCalled()
        expect(button().textContent).toContain(language.loadingEllipsis)
        release()
        await settle()
        expect(h.run).toHaveBeenCalledTimes(1)
    })
    test('T2 failed single run raises one alert and restores Translate', async () => {
        h.state.db.modules = [{ id: 'm1', name: 'Alpha' }]
        await input('prev')
        button().click()
        await settle()
        const result = target.querySelectorAll('textarea')[1]
        expect(result.value).toBe('prev')
        h.state.db.modules = [stub()]
        failing = true
        await input('next')
        button().click()
        await settle()
        release()
        await settle()
        expect(h.alerts).toEqual([moduleLoadFailedText(['Alpha'])])
        expect(h.run).toHaveBeenCalledTimes(1)
        expect(result.value).toBe('prev')
        expect(button().textContent?.trim()).toBe(language.translate)
    })
    test('T3 failed bulk run has no progress and no translator call', async () => {
        failing = true
        await input('one\n\ntwo\n\nthree')
        await bulk()
        button().click()
        await settle()
        release()
        await settle()
        expect(h.alerts).toEqual([moduleLoadFailedText(['Alpha'])])
        expect(h.run).not.toHaveBeenCalled()
        expect(button().textContent?.trim()).toBe(language.translate)
    })
    test('T4 bulk run waits once before three chunks', async () => {
        await input('one\n\ntwo\n\nthree')
        await bulk()
        button().click()
        await settle()
        expect(calls).toEqual(['m1'])
        expect(h.run).not.toHaveBeenCalled()
        release()
        await settle()
        expect(h.run).toHaveBeenCalledTimes(3)
    })
    test('T5 double click during wait starts one run', async () => {
        await input('hello')
        button().click()
        button().click()
        await settle()
        expect(calls).toEqual(['m1'])
        expect(h.run).not.toHaveBeenCalled()
        release()
        await settle()
        expect(h.run).toHaveBeenCalledTimes(1)
    })
    test('T6 guard passes before and after with a non LLM translator', async () => {
        h.state.db.translatorType = 'deepl'
        await input('hello')
        button().click()
        await settle()
        expect(calls).toEqual([])
        expect(h.alerts).toEqual([])
        expect(h.run).toHaveBeenCalledTimes(1)
    })
    test('T7 guard passes before and after without stubs', async () => {
        h.state.db.modules = [{ id: 'm1', name: 'Alpha' }]
        await input('hello')
        button().click()
        await settle()
        expect(calls).toEqual([])
        expect(h.run).toHaveBeenCalledTimes(1)
    })
})
