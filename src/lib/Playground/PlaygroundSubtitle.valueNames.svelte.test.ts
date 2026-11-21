// @vitest-environment jsdom

/**
 * `PlaygroundSubtitle.svelte` value controls: the type select and, in the local Whisper branch, the source
 * language select are each named by their own visible label span through `aria-labelledby`. Mounts the REAL
 * page with the real shared inputs; request, util, alert, model-list and runtime modules are stubs
 * copied from the page's module-wait test.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    state: { db: { modules: [], enabledModules: [], characters: [], personas: [], moduleIntergration: '', language: 'en', aiModel: 'test', useStreaming: true, openAIKey: 'key' } },
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
    selectFileByDom: vi.fn(),
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
    getLanguageCodes: () => [{ code: 'en', name: 'English' }],
    AppendableBuffer: class AppendableBuffer {},
    downloadFile: vi.fn(),
}))
vi.mock('@huggingface/transformers', () => ({ pipeline: vi.fn() }))

// The text areas are named by their own labelId in the shared input's file; the real one pulls in the
// highlighter and the whole store graph, which this page's select names do not need.
vi.mock('../UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { fieldNameProblems, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import PlaygroundSubtitle from './PlaygroundSubtitle.svelte'

let mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

function mountPage(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PlaygroundSubtitle, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function chooseMode(target: HTMLElement, value: string): void {
    const select = Array.from(target.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === 'whisperLocal')) as HTMLSelectElement
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('PlaygroundSubtitle value control names', () => {
    test('llm mode: only the type select is a value control and it is named', () => {
        const target = mountPage()
        expect(fieldNameProblems(target, [{ name: language.type }])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual([])
    })

    test('whisper local mode: the source language select comes first and both selects are named', () => {
        const target = mountPage()
        chooseMode(target, 'whisperLocal')
        expect(fieldNameProblems(target, [{ name: language.sourceLanguage }, { name: language.type }])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual([])
    })

    test('no screen-reader-only name span is needed; both selects use their visible label', () => {
        const target = mountPage()
        chooseMode(target, 'whisperLocal')
        expect(target.querySelectorAll('span.sr-only').length).toBe(0)
    })
})
