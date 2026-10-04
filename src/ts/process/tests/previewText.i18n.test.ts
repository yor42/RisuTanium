/**
 * The words the DevTool formatted preview and the prompt preview put around a
 * request, under the Korean locale.
 *
 * Invariants pinned here:
 *  - every ordinary word of the preview text is the locale value, and the
 *    Markdown markers (`> `, `### `, ` — `), the emoji and the mask glyphs are
 *    produced by the code, so they survive translation;
 *  - role headings keep their English names under every locale.
 *
 * Drives the REAL `runPreviewPrompt` and `renderPromptPreview` over the REAL
 * `alert.ts`; only `sendChat` is a stand-in that writes its preview output the
 * way the real body does. The English text is pinned by the literal assertions
 * in `previewRunner.test.ts`.
 */
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { OpenAIChat, SendChatArg } from 'src/ts/process/index.svelte'
import type { alertData } from 'src/ts/alert'
import { changeLanguage } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import { languageKorean } from 'src/lang/ko'
import { languageEnglish } from 'src/lang/en'
import 'src/ts/polyfill'

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Database },
    alertStore: writable({ type: 'none', msg: '' }),
    loadoutModalStore: { open: false },
    MobileGUIStack: writable(0),
    MobileSideBar: writable(0),
    openPersonaList: writable(false),
    openPresetList: writable(false),
    OpenRealmStore: writable(false),
    PlaygroundStore: writable(0),
    QuickSettings: { open: false, index: 0 },
    SafeModeStore: writable(false),
    selectedCharID: writable(-1),
    settingsOpen: writable(false),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('src/ts/stores.svelte')
    return {
        getDatabase: vi.fn(() => liveDBState.db),
        changeToPreset: vi.fn(),
        getCurrentCharacter: vi.fn(() => ({ name: 'Bob' })),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
    sendChat: vi.fn(),
}) as unknown as typeof import('src/ts/process/index.svelte'))

//#endregion

import { runPreviewPrompt } from 'src/ts/process/devToolActions'
import { renderPromptPreview } from 'src/ts/process/previewRunner'
import { resetAlertPromptsForTests } from 'src/ts/alertPrompts'
import { alertStore, DBState, selectedCharID } from 'src/ts/stores.svelte'
import { doingChat, sendChat } from 'src/ts/process/index.svelte'

const NONE: alertData = { type: 'none', msg: '' }

/** The Korean locale value at a dotted path, read from the locale file itself and required to differ from English. */
function ko(path: string): string {
    let node: unknown = languageKorean
    let english: unknown = languageEnglish
    for (const part of path.split('.')) {
        node = (node as Record<string, unknown> | undefined)?.[part]
        english = (english as Record<string, unknown>)[part]
    }
    expect(node, `the Korean locale value at ${path}`).toBeTypeOf('string')
    expect(node, `the Korean value at ${path} differs from English`).not.toBe(english)
    return node as string
}

interface FakeSend {
    formated?: OpenAIChat[]
    memberName?: string
}

function fakeSend(spec: FakeSend): void {
    vi.mocked(sendChat).mockImplementationOnce(async (_index?: number, arg: SendChatArg = {}) => {
        if (arg.previewResult) {
            if (spec.formated !== undefined) {
                arg.previewResult.formated = spec.formated
            }
            if (spec.memberName !== undefined) {
                arg.previewResult.memberName = spec.memberName
            }
        }
        return true
    })
}

function shown(): alertData {
    return get(alertStore) as alertData
}

beforeEach(() => {
    DBState.db = {} as unknown as Database
    selectedCharID.set(0)
    doingChat.set(false)
    alertStore.set(NONE)
    vi.mocked(sendChat).mockReset()
    changeLanguage('ko')
})

afterEach(() => {
    changeLanguage('en')
    resetAlertPromptsForTests()
    alertStore.set(NONE)
    vi.restoreAllMocks()
})

describe('the DevTool formatted preview under Korean', () => {
    const formated: OpenAIChat[] = [
        { role: 'system', content: 'S1' },
        { role: 'user', content: 'U1' },
    ]

    test('regression reproducer: the Previewing line of a named member is the locale value with its marker and name', async () => {
        fakeSend({ formated, memberName: 'Alice' })

        await runPreviewPrompt('normal', 'no', 'chatml', '')

        expect(shown().msg).toBe(
            '> ' + fillLang(ko('devTool.previewing'), { name: 'Alice' }) + '\n'
            + '### ⚙️ System\n```\nS1\n```\n'
            + '### 😐 User\n```\nU1\n```\n'
        )
    })

    test('regression reproducer: the instruct heading is the locale value above the fenced instruction', async () => {
        fakeSend({ formated })

        await runPreviewPrompt('instruct', 'no', 'chatml', '')

        expect(shown().msg.startsWith('### ' + ko('devTool.instruction') + '\n```\n')).toBe(true)
    })

    test('regression reproducer: the Previewing line stays above the translated instruct heading', async () => {
        fakeSend({ formated, memberName: 'Alice' })

        await runPreviewPrompt('instruct', 'no', 'chatml', '')

        expect(shown().msg.startsWith(
            '> ' + fillLang(ko('devTool.previewing'), { name: 'Alice' }) + '\n### ' + ko('devTool.instruction') + '\n```\n'
        )).toBe(true)
    })

    test('regression reproducer: an unknown role heading is the emoji and the locale value', async () => {
        fakeSend({ formated: [{ role: 'mystery', content: 'X' } as unknown as OpenAIChat] })

        await runPreviewPrompt('normal', 'no', 'chatml', '')

        expect(shown().msg).toBe('### 🤔 ' + ko('devTool.unknownRole') + '\n```\nX\n```\n')
    })

    test('regression reproducer: attachment, thought and cache point notes are the locale values with their markers', async () => {
        fakeSend({
            formated: [
                {
                    role: 'user',
                    content: 'body',
                    multimodals: [{ type: 'image', base64: 'AAAA' }, { type: 'image', base64: 'BBBB' }],
                    thoughts: ['a', 'b', 'c'],
                    cachePoint: true,
                } as unknown as OpenAIChat,
            ],
        })

        await runPreviewPrompt('normal', 'no', 'chatml', '')

        expect(shown().msg).toBe(
            '### 😐 User\n'
            + '> ' + fillLang(ko('devTool.nonTextIncluded'), { count: 2 }) + '\n'
            + '> ' + fillLang(ko('devTool.thoughtsIncluded'), { count: 3 }) + '\n'
            + '> ' + ko('devTool.cachePointNote') + '\n'
            + '```\nbody\n```\n'
        )
    })
})

describe('the prompt preview under Korean', () => {
    test('regression reproducer: the heading is the locale value of the Prompt word, with the member name after the dash', () => {
        const md = renderPromptPreview(JSON.stringify({ url: 'https://api.example.com/v1', body: {} }), 'Alice')

        expect(md.startsWith('### ' + ko('prompt') + ' — Alice\n')).toBe(true)
    })

    test('regression reproducer: an empty body shows the locale value under the translated heading', () => {
        expect(renderPromptPreview('')).toBe('### ' + ko('prompt') + '\n> ' + ko('devTool.requestBodyEmpty') + '\n')
    })

    test('regression reproducer: a masked secret shows the locale pattern with the mask glyphs and the hidden length', () => {
        const md = renderPromptPreview(JSON.stringify({
            url: 'https://api.example.com/v1',
            headers: { Authorization: 'Bearer sk-abc', 'x-api-key': 'abcdefghij' },
        }))

        const fence = /```json\n([\s\S]*)\n```/.exec(md)
        expect(fence, 'a json fence in the preview').not.toBeNull()
        const headers = (JSON.parse(fence![1]) as { headers: Record<string, string> }).headers
        expect(headers.Authorization).toBe('Bearer ' + fillLang(ko('devTool.maskedChars'), { mask: '••••', count: 'sk-abc'.length }))
        expect(headers['x-api-key']).toBe(fillLang(ko('devTool.maskedChars'), { mask: '••••', count: 'abcdefghij'.length }))
    })

    test('compatibility guard: the role headings keep their English names under Korean', async () => {
        fakeSend({
            formated: [
                { role: 'system', content: 'S' },
                { role: 'user', content: 'U' },
                { role: 'assistant', content: 'A' },
            ],
        })

        await runPreviewPrompt('normal', 'no', 'chatml', '')

        expect(shown().msg).toBe(
            '### ⚙️ System\n```\nS\n```\n### 😐 User\n```\nU\n```\n### ✨ Assistant\n```\nA\n```\n'
        )
    })
})
