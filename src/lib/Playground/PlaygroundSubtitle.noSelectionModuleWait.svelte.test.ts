// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MODULE_STUB_KEY } from 'src/ts/storage/moduleStub'
import type { RisuModule } from 'src/ts/process/modules'

const h = vi.hoisted(() => ({
    state: { db: { modules: [] as Array<Record<string, string | number>>, enabledModules: ['m1'], characters: [], personas: [], moduleIntergration: '', language: 'en', aiModel: 'test', useStreaming: true, openAIKey: 'key' } },
    alerts: [] as string[],
    request: vi.fn(async () => null),
    parse: vi.fn((value: string) => {
        h.parseSawStub.push(h.state.db.modules[0]?.[MODULE_STUB_KEY] === 1)
        return value
    }),
    parseSawStub: [] as boolean[],
    pickLLM: vi.fn(async () => ({ name: 'sound.mp3', data: new Uint8Array([1]) })),
    pickWhisper: vi.fn(async () => [new File(['audio'], 'sound.mp3', { type: 'audio/mp3' })]),
    pipeline: vi.fn(),
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
    selectSingleFile: h.pickLLM,
    selectFileByDom: h.pickWhisper,
    sleep: async () => {},
    asBuffer: (value: ArrayBuffer) => value,
}))
vi.mock('src/ts/alert', () => ({
    alertError: (value: string) => { h.alerts.push(value) },
    alertSelect: vi.fn(),
}))
vi.mock('src/ts/process/subtitleRequest', () => ({
    requestSubtitleModel: h.request,
}))
vi.mock('src/ts/parser/parser.svelte', () => ({
    risuChatParser: (value: string) => h.parse(value),
}))
vi.mock('src/ts/model/modellist', () => ({
    getModelInfo: () => ({ flags: [] }),
    LLMFlags: { hasAudioInput: 'audio', hasVideoInput: 'video', hasStreaming: 'stream' },
}))
vi.mock('src/ts/secretRef', () => ({
    resolveSecret: async (value: string) => value,
    SecretRefError: class SecretRefError extends Error {},
}))
vi.mock('src/ts/globalApi.svelte', () => ({
    getLanguageCodes: () => [],
    AppendableBuffer: class AppendableBuffer {},
    downloadFile: vi.fn(),
}))
vi.mock('@huggingface/transformers', () => ({ pipeline: h.pipeline }))
vi.mock('../UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { moduleLoadFailedText } from 'src/ts/process/moduleRefList'
import { registerModuleLoader, unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'
import PlaygroundSubtitle from './PlaygroundSubtitle.svelte'

let app: ReturnType<typeof mount>
let target: HTMLElement
let calls: string[]
let release: () => void
let failing: boolean
let fetchCalls: number
const originalFetch = globalThis.fetch
const originalPlay = HTMLMediaElement.prototype.play
const originalAudioContext = globalThis.AudioContext
function stub(): Record<string, string | number> {
    return { id: 'm1', name: 'Alpha', [MODULE_STUB_KEY]: 1 }
}
async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
}
function runButton(): HTMLButtonElement | undefined {
    return Array.from(target.querySelectorAll('button')).find((item) => item.textContent?.trim() === language.run)
}
async function mode(value: string): Promise<void> {
    const select = Array.from(target.querySelectorAll('select')).find((item) => Array.from(item.options).some((option) => option.value === 'whisperLocal'))
    if(!select) throw new Error('mode select missing')
    const index = Array.from(select.options).findIndex((option) => option.value === value)
    select.selectedIndex = index
    const query = select.querySelector.bind(select)
    select.querySelector = ((selector: string) => selector === ':checked' ? select.options[select.selectedIndex] : query(selector)) as typeof select.querySelector
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
}
beforeEach(() => {
    calls = []
    release = () => {}
    failing = false
    fetchCalls = 0
    h.alerts.length = 0
    h.request.mockClear()
    h.parse.mockClear()
    h.parseSawStub.length = 0
    h.pipeline.mockClear()
    h.state.db.modules = [stub()]
    HTMLMediaElement.prototype.play = async () => {}
    globalThis.AudioContext = class AudioContext {} as typeof AudioContext
    globalThis.fetch = (async () => {
        fetchCalls++
        return { text: async () => 'WEBVTT\n\n' } as Response
    }) as typeof fetch
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
    app = mount(PlaygroundSubtitle, { target, props: {} })
    flushSync()
})
afterEach(async () => {
    await unmount(app)
    target.remove()
    unregisterModuleLoader()
    globalThis.fetch = originalFetch
    HTMLMediaElement.prototype.play = originalPlay
    globalThis.AudioContext = originalAudioContext
})
describe('no-selection subtitle module wait', () => {
    test('S1 LLM parsing and requesting wait for the load', async () => {
        runButton()?.click()
        await settle()
        expect(calls).toEqual(['m1'])
        expect(h.parse).not.toHaveBeenCalled()
        expect(h.request).not.toHaveBeenCalled()
        release()
        await settle()
        expect(h.parse).toHaveBeenCalledTimes(1)
        expect(h.parseSawStub).toEqual([false])
        expect(h.state.db.modules[0][MODULE_STUB_KEY]).toBeUndefined()
        expect(h.request).toHaveBeenCalledTimes(1)
    })
    test('S2 a failed LLM load leaves Run available', async () => {
        failing = true
        runButton()?.click()
        await settle()
        release()
        await settle()
        expect(h.request).not.toHaveBeenCalled()
        expect(h.parse).not.toHaveBeenCalled()
        expect(h.alerts).toEqual([moduleLoadFailedText(['Alpha'])])
        expect(runButton()).toBeDefined()
    })
    test('S3 Whisper fails before transcription', async () => {
        failing = true
        await mode('whisper')
        runButton()?.click()
        await settle()
        release()
        await settle()
        expect(fetchCalls).toBe(0)
        expect(h.parse).not.toHaveBeenCalled()
        expect(h.request).not.toHaveBeenCalled()
        expect(h.alerts).toEqual([moduleLoadFailedText(['Alpha'])])
        expect(runButton()).toBeDefined()
    })
    test('S5 Whisper transcription waits for the load', async () => {
        await mode('whisper')
        runButton()?.click()
        await settle()
        expect(calls).toEqual(['m1'])
        expect(fetchCalls).toBe(0)
        release()
        await settle()
        expect(fetchCalls).toBe(1)
        expect(h.parse).toHaveBeenCalledTimes(1)
        expect(h.parseSawStub).toEqual([false])
        expect(h.request).toHaveBeenCalledTimes(1)
    })
    test('S6 Whisper Local fails before pipeline creation', async () => {
        failing = true
        await mode('whisperLocal')
        runButton()?.click()
        await settle()
        release()
        await settle()
        expect(h.pipeline).not.toHaveBeenCalled()
        expect(h.alerts).toEqual([moduleLoadFailedText(['Alpha'])])
        expect(runButton()).toBeDefined()
    })
    test('S4 guard passes before and after with resident LLM module', async () => {
        h.state.db.modules = [{ id: 'm1', name: 'Alpha' }]
        runButton()?.click()
        await settle()
        expect(calls).toEqual([])
        expect(h.request).toHaveBeenCalledTimes(1)
    })
    test('S7 guard passes before and after with resident Whisper module', async () => {
        h.state.db.modules = [{ id: 'm1', name: 'Alpha' }]
        await mode('whisper')
        runButton()?.click()
        await settle()
        expect(calls).toEqual([])
        expect(fetchCalls).toBe(1)
        expect(h.request).toHaveBeenCalledTimes(1)
    })
})
