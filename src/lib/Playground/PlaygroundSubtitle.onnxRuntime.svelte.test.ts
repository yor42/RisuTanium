// @vitest-environment happy-dom
/**
 * Whisper Local creates its pipeline without `initTransformers`, so it must clear the library's jsDelivr
 * `wasmPaths` default itself before `pipeline` runs. MOCKED: the transformers module, the model request path.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const JSDELIVR = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/'

const h = vi.hoisted(() => ({
    state: { db: { modules: [] as Array<Record<string, string | number>>, enabledModules: [] as string[], characters: [], personas: [], moduleIntergration: '', language: 'en', aiModel: 'test', useStreaming: true, openAIKey: 'key' } },
    wasmPathsAtPipeline: [] as Array<string | undefined>,
    env: { backends: { onnx: { wasm: { wasmPaths: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/' as string | undefined } } } },
    pickWhisper: vi.fn(async () => [new File(['audio'], 'sound.mp3', { type: 'audio/mp3' })]),
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
    selectSingleFile: vi.fn(),
    selectFileByDom: h.pickWhisper,
    sleep: async () => {},
    asBuffer: (value: ArrayBuffer) => value,
}))
vi.mock('src/ts/alert', () => ({
    alertError: vi.fn(),
    alertSelect: vi.fn(),
}))
vi.mock('src/ts/process/subtitleRequest', () => ({
    requestSubtitleModel: vi.fn(async () => null),
}))
vi.mock('src/ts/parser/parser.svelte', () => ({
    risuChatParser: (value: string) => value,
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
vi.mock('@huggingface/transformers', () => ({
    env: h.env,
    pipeline: async () => {
        h.wasmPathsAtPipeline.push(h.env.backends.onnx.wasm.wasmPaths)
        throw new Error('stop after recording')
    },
}))
vi.mock('../UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import PlaygroundSubtitle from './PlaygroundSubtitle.svelte'

let app: ReturnType<typeof mount>
let target: HTMLElement
const originalAudioContext = globalThis.AudioContext
async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
}
async function chooseWhisperLocal(): Promise<void> {
    const select = Array.from(target.querySelectorAll('select')).find((item) => Array.from(item.options).some((option) => option.value === 'whisperLocal'))
    if(!select) throw new Error('mode select missing')
    select.selectedIndex = Array.from(select.options).findIndex((option) => option.value === 'whisperLocal')
    const query = select.querySelector.bind(select)
    select.querySelector = ((selector: string) => selector === ':checked' ? select.options[select.selectedIndex] : query(selector)) as typeof select.querySelector
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
}
beforeEach(() => {
    h.wasmPathsAtPipeline.length = 0
    h.env.backends.onnx.wasm.wasmPaths = JSDELIVR
    globalThis.AudioContext = class AudioContext {} as typeof AudioContext
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(PlaygroundSubtitle, { target, props: {} })
    flushSync()
})
afterEach(async () => {
    await unmount(app)
    target.remove()
    globalThis.AudioContext = originalAudioContext
})
describe('Whisper Local ONNX runtime source', () => {
    test('wasmPaths is cleared before the pipeline is created', async () => {
        await chooseWhisperLocal()
        Array.from(target.querySelectorAll('button')).find((item) => item.textContent?.trim() === language.run)?.click()
        await settle()

        expect(h.wasmPathsAtPipeline).toEqual([undefined])
    })
})
