// @vitest-environment happy-dom

/**
 * The cues of the chat-only scope switch's inline Undo (#246 S1b, MC-3565): a restored scope plays `undo`, a refused one
 * `warning`; flipping the switch itself stays silent. The real component and engine run against the fake Web Audio of
 * `uiSound.testKit.ts`, installed before the component is imported. Mocks as in `ToggleScopeSwitch.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat } from 'src/ts/storage/database.svelte'
import { installFakeAudio, warmUiSounds, type FakeAudio } from 'src/ts/uiSound/uiSound.testKit'

const state = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    mark: vi.fn(),
    moduleToggles: '',
}))

vi.mock('src/ts/stores.svelte', () => ({
    DBState: {
        get db() { return state.db },
    },
    selIdState: { selId: -1 },
    selectedCharID: writable(0),
}))
vi.mock('src/ts/storage/database.svelte', () => ({
    appVer: '1234.5.67',
    getCurrentCharacter: () => undefined,
    getCurrentChat: () => undefined,
    getDatabase: () => state.db,
}))
vi.mock('src/ts/globalApi.svelte', () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
}))
vi.mock('src/ts/storage/characterSaveMarks', () => ({ markCharacterForSave: state.mark }))
vi.mock('src/ts/process/modules', () => ({ getModuleToggles: () => state.moduleToggles }))
vi.mock('src/lang', () => ({ language: new Proxy({}, { get: (_target, key) => String(key) }) }))

type Owner = { chaId: string, name: string, chats: Chat[], customModuleToggle?: string, coldstorage?: string }

let ToggleScopeSwitch: typeof import('./ToggleScopeSwitch.svelte').default
let audio: FakeAudio
let mounted: ReturnType<typeof mount> | undefined
let owner: Owner
let chat: Chat

const cueOf = (url: string): string => url.match(/\/(?:scifi|studio)\/([\w-]+)\.mp3$/)?.[1] ?? url
const cues = (): string[] => audio.startedUrls().map(cueOf)

const makeChat = (extra: Partial<Chat> = {}): Chat => ({
    message: [{ role: 'user', data: 'hi', chatId: 'm1' }],
    note: '',
    name: 'chat',
    localLore: [],
    id: 'chat-1',
    ...extra,
}) as Chat

const input = () => document.querySelector('input[role="switch"]') as HTMLInputElement
const undoButton = () => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'chatShellToggleScopeUndo')
const flip = () => { input().focus(); input().click(); flushSync() }

function scopedThenDiscarded(): void {
    chat.useLocallySetGlobalVariables = true
    chat.GLGlobalVariables = { toggle_a: '0', toggle_b: 'mine' }
    mounted = mount(ToggleScopeSwitch, { target: document.body, props: { owner, chat } })
    flushSync()
    flip()
}

beforeAll(async () => {
    audio = installFakeAudio()
    vi.useFakeTimers({ toFake: ['performance'] })
    ToggleScopeSwitch = (await import('./ToggleScopeSwitch.svelte')).default
})

afterAll(() => {
    vi.useRealTimers()
    audio.uninstall()
})

beforeEach(async () => {
    localStorage.clear()
    audio.endVoices()
    audio.started.length = 0
    vi.advanceTimersByTime(10000)
    await warmUiSounds()
    state.mark.mockReset()
    state.moduleToggles = ''
    chat = makeChat()
    owner = { chaId: 'char-a', name: 'A', chats: [chat] }
    state.db = {
        characters: [owner],
        globalChatVariables: { toggle_a: '1', toggle_b: 'text' },
        customPromptTemplateToggle: 'a=Alpha\nb=Beta=text',
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    if (mounted) unmount(mounted)
    mounted = undefined
    document.body.innerHTML = ''
    vi.restoreAllMocks()
})

describe('T14 inline Undo cues', () => {
    test('reproducer (T14): a restored scope plays the undo cue', () => {
        scopedThenDiscarded()
        expect(cues()).toEqual([])

        undoButton()!.click()
        flushSync()

        expect(chat.useLocallySetGlobalVariables).toBe(true)
        expect(cues()).toEqual(['undo'])
    })

    test('reproducer (T14): a refused Undo plays the warning cue', () => {
        scopedThenDiscarded()
        owner.coldstorage = 'entry-1'

        undoButton()!.click()
        flushSync()

        expect(cues()).toEqual(['warning'])
    })

    test('guard (T17): the switch off silences the Undo cue', () => {
        localStorage.setItem('risutanium.uiSounds', '0')
        scopedThenDiscarded()

        undoButton()!.click()
        flushSync()

        expect(audio.started).toEqual([])
    })
})
