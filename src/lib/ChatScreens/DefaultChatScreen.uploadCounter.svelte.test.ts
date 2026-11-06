// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { pendingChatFileUploads } from 'src/ts/process/composerSurface.svelte'
import { shellFlipBlocker } from 'src/ts/chatShell/flipBlocker'
import DefaultChatScreen from './DefaultChatScreen.svelte'
import { postChatFile } from 'src/ts/process/files/multisend'

vi.mock('src/ts/process/files/multisend', async (importOriginal) => ({
    ...await importOriginal<typeof import('src/ts/process/files/multisend')>(),
    postChatFile: vi.fn(async () => []),
}))
vi.mock('src/ts/process/index.svelte', () => ({
    doingChat: writable(false), chatProcessStage: writable(0), sendChat: vi.fn(async () => true),
}))
vi.mock('src/ts/process/composerActions.svelte', () => ({
    isComposerBusy: () => false,
    isComposerLocked: () => false,
    isAutoModeActive: () => false,
}))
vi.mock('src/ts/process/coldstorage.svelte', async (importOriginal) => ({
    ...await importOriginal<typeof import('src/ts/process/coldstorage.svelte')>(),
    preLoadChat: vi.fn(async () => 'ok'),
}))
vi.mock('src/ts/globalApi.svelte', () => {
    const chatFoldedState = $state({ data: null })
    const chatFoldedStateMessageIndex = $state({ index: -1 })
    return {
    aiLawApplies: () => false,
    chatFoldedState,
    chatFoldedStateMessageIndex,
    downloadFile: vi.fn(),
    getFileSrc: vi.fn(async () => ''),
    saveAsset: vi.fn(async () => ''),
    readImage: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
    }
})
vi.mock('src/ts/characters', () => ({ getCharImage: () => '' }))
vi.mock('src/ts/parser/parser.svelte', () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}))
vi.mock('src/ts/parser/chatML', () => ({ parseChatML: vi.fn(() => []) }))
vi.mock('./Chats.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('./Chat.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('./Suggestion.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('../UI/MainMenu.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('./CreatorQuote.svelte', () => ({ default: () => ({ destroy: () => {} }) }))

class DeferredFileReader {
    static instances: DeferredFileReader[] = []
    static throwOnRead = false
    onload: ((event: { target: { result: ArrayBuffer } }) => void) | null = null
    onerror: (() => void) | null = null
    onabort: (() => void) | null = null
    constructor() { DeferredFileReader.instances.push(this) }
    readAsArrayBuffer(_file: File): void {
        if (DeferredFileReader.throwOnRead) throw new Error('read failed')
    }
}

function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((yes) => { resolve = yes })
    return { promise, resolve }
}

function installChat(): void {
    DBState.db = {
        characters: [{
            chaId: 'upload-owner', type: 'character', chatPage: 0, name: 'Upload', image: '',
            chats: [{ id: 'upload-chat', message: [], note: '', localLore: [], scriptstate: {} }],
            firstMessage: 'Hello', alternateGreetings: [], additionalAssets: [], ttsMode: 'none',
            triggerscript: [], customscript: [], globalLore: [], desc: 'Upload',
            largePortrait: false, removedQuotes: true, creatorNotes: '',
        }],
        theme: '', modules: [], templateDefaultVariables: '', presetRegex: [],
        personas: [{ name: 'User', icon: '', largePortrait: false }],
        selectedPersona: 0, username: 'User', useAutoSuggestions: false, useChatSticker: false,
        fixedChatTextarea: false, useAutoTranslateInput: false, newMessageButtonStyle: 'bottom-center',
        showMenuChatList: false, showMenuHypaMemoryModal: false, enableRisuaiProTools: false,
        useSayNothing: false, playMessage: false, translatorType: '', translator: '',
        hypaV3: false, hypav2: false, sideMenuRerollButton: false, sendWithEnter: true,
        subModel: '', supaModelType: 'none', autoSuggestClean: false, personaPrompt: '',
    } as never
    selectedCharID.set(0)
}

function paste(target: HTMLElement): DeferredFileReader {
    const textarea = target.querySelector<HTMLTextAreaElement>('textarea.text-input-area')!
    const event = new Event('paste', { bubbles: true, cancelable: true })
    const file = new File([new Uint8Array([1])], 'image.png', { type: 'image/png' })
    Object.defineProperty(event, 'clipboardData', { value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] } })
    textarea.dispatchEvent(event)
    return DeferredFileReader.instances.at(-1)!
}

let target: HTMLElement
let instance: ReturnType<typeof mount>

beforeEach(() => {
    installChat()
    vi.stubGlobal('FileReader', DeferredFileReader)
    DeferredFileReader.instances = []
    DeferredFileReader.throwOnRead = false
    vi.mocked(postChatFile).mockReset()
    vi.mocked(postChatFile).mockResolvedValue([])
    target = document.createElement('div')
    document.body.appendChild(target)
    instance = mount(DefaultChatScreen, { target, props: {} })
    flushSync()
})

afterEach(async () => {
    await unmount(instance)
    target.remove()
    vi.unstubAllGlobals()
})

describe('T20 paste upload counter at the real call site', () => {
    it('blocks from reader start through the onload upload and settles in finally', async () => {
        const gate = deferred<[]>()
        vi.mocked(postChatFile).mockReturnValueOnce(gate.promise)
        const reader = paste(target)
        expect(pendingChatFileUploads()).toBeGreaterThan(0)
        expect(shellFlipBlocker()?.reasonKey).toBe('chatShellFlipRefusedUploading')
        reader.onload?.({ target: { result: new ArrayBuffer(1) } })
        await tick()
        expect(pendingChatFileUploads()).toBeGreaterThan(0)
        gate.resolve([])
        await tick()
        await tick()
        expect(pendingChatFileUploads()).toBe(0)
        expect(shellFlipBlocker()).toBeNull()
    })

    it.each(['onerror', 'onabort'] as const)('%s settles the reader count', (terminal) => {
        const reader = paste(target)
        expect(shellFlipBlocker()?.reasonKey).toBe('chatShellFlipRefusedUploading')
        reader[terminal]?.()
        expect(pendingChatFileUploads()).toBe(0)
    })

    it('settles the count when readAsArrayBuffer throws synchronously', () => {
        DeferredFileReader.throwOnRead = true
        const preventUncaught = (event: ErrorEvent) => event.preventDefault()
        window.addEventListener('error', preventUncaught)
        try {
            paste(target)
        } finally {
            window.removeEventListener('error', preventUncaught)
        }
        expect(pendingChatFileUploads()).toBe(0)
    })
})
