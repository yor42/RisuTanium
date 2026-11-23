/**
 * What the two prompt previews (the `previewRequest` hotkey and DevTool's
 * Preview Prompt) show, and what they leave in the alert store, for each way
 * a preview ends.
 *
 * Drives the REAL document keydown listener registered by `initHotkey()`
 * (`../../hotkey`) and the REAL `runPreviewPrompt` (`../devToolActions`), with
 * the REAL `alert.ts` over a real `writable` standing in for `alertStore`, so
 * every assertion reads what the user would see: the store's current alert,
 * and every alert the store held during the run. Only `sendChat` is a stand-in
 * (`../index.svelte`): it writes its preview output the way the real body does,
 * into the per-call `previewResult` object the caller passed, and it can put its
 * own alerts into the store, as a start trigger does. That says nothing about
 * what the real `sendChat` does; `previewRealSend.svelte.test.ts` drives the
 * real one.
 *
 * Tests whose title starts with `guard:` pass with or without the fix: they
 * pin behaviour that must be preserved.
 */
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { OpenAIChat, SendChatArg } from 'src/ts/process/index.svelte'
import type { alertData } from 'src/ts/alert'
import { language } from 'src/lang'
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

import { initHotkey } from 'src/ts/hotkey'
import { runPreviewPrompt } from 'src/ts/process/devToolActions'
import { previewMayStart, renderPromptPreview, renderPromptResult, runPreview } from 'src/ts/process/previewRunner'
import { ANSWER_GUARD_MS, resetAlertPromptsForTests } from 'src/ts/alertPrompts'
import { openComposerWindow, resetComposerWindowsForTests } from 'src/ts/process/generationOwnership.svelte'
import { alertStore, DBState, selectedCharID, settingsOpen } from 'src/ts/stores.svelte'
import { doingChat as doingChatStore, sendChat } from 'src/ts/process/index.svelte'
import { alertClear, alertConfirm, alertError, alertModuleSelect, alertNormal, alertWait } from 'src/ts/alert'
import type { Writable } from 'svelte/store'
const doingChat = doingChatStore as Writable<boolean>

//#region fixtures

const NONE: alertData = { type: 'none', msg: '' }

/** The raw `toast` value AlertComp's toast branch shows: these tests pin how the alert store protocol treats a toast cover, not what `alertToast` does. */
function putToast(msg: string): void {
    alertStore.set({ type: 'toast', msg })
}
const SELECTED = 0

/** A request-shaped body: JSON, no key in it, nothing a mask would touch. */
const REQUEST_BODY = JSON.stringify({
    url: 'https://api.example.com/v1/chat',
    body: { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
    headers: { 'content-type': 'application/json' },
})

const EARLIER_BODY = JSON.stringify({
    url: 'https://api.example.com/v1/earlier',
    body: { marker: 'EARLIER-PREVIEW-BODY' },
    headers: {},
})

let keydownHandler: (ev: KeyboardEvent) => unknown
const stopRecording: Array<() => void> = []

beforeEach(() => {
    DBState.db = {} as unknown as Database
    selectedCharID.set(SELECTED)
    doingChat.set(false)
    resetComposerWindowsForTests()
    settingsOpen.set(false)
    alertStore.set(NONE)
    vi.mocked(sendChat).mockReset()
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener')
    initHotkey()
    const keydownCall = addEventListenerSpy.mock.calls.find(([type]) => type === 'keydown')
    keydownHandler = keydownCall![1] as (ev: KeyboardEvent) => unknown
    addEventListenerSpy.mockRestore()
})

afterEach(() => {
    while (stopRecording.length > 0) {
        stopRecording.pop()!()
    }
    document.body.replaceChildren()
    settingsOpen.set(false)
    resetComposerWindowsForTests()
    resetAlertPromptsForTests()
    alertStore.set(NONE)
    vi.restoreAllMocks()
})

function ctrlU(): KeyboardEvent {
    return new KeyboardEvent('keydown', { key: 'u', ctrlKey: true, bubbles: true, cancelable: true })
}

interface PreviewEntry {
    name: string
    run: () => Promise<unknown>
}

const previewEntries: PreviewEntry[] = [
    { name: 'the preview hotkey', run: async () => { await keydownHandler(ctrlU()) } },
    { name: 'DevTool Preview Prompt', run: async () => { await runPreviewPrompt('normal', 'prompt', 'chatml', '') } },
]

/** How a fake `sendChat` call goes. */
interface FakeSend {
    returns: boolean
    /** Written where the real body writes a request body: the call's own `previewResult`. */
    body?: string
    /** Written where the real body writes the formatted prompt. */
    formated?: OpenAIChat[]
    /** Written where the group walk records the member it previewed. */
    memberName?: string
    /** Written where the group walk records that nobody would speak. */
    noSpeaker?: boolean
    /** Runs first, as a start trigger or a plugin hook does. */
    during?: (arg: SendChatArg) => void | Promise<void>
    throws?: Error
}

function fakeSend(spec: FakeSend): void {
    vi.mocked(sendChat).mockImplementationOnce(async (_index?: number, arg: SendChatArg = {}) => {
        await spec.during?.(arg)
        if (spec.throws) {
            throw spec.throws
        }
        if (spec.body !== undefined) {
            if (arg.previewResult) {
                arg.previewResult.body = spec.body
            }
        }
        if (spec.formated !== undefined) {
            if (arg.previewResult) {
                arg.previewResult.formated = spec.formated
            }
        }
        if (arg.previewResult) {
            if (spec.memberName !== undefined) {
                arg.previewResult.memberName = spec.memberName
            }
            if (spec.noSpeaker) {
                arg.previewResult.noSpeaker = true
            }
        }
        return spec.returns
    })
}

/** A send that stays in flight until `finish()`. `started` resolves with the arg the send was given. */
function holdingSend(spec: FakeSend): { started: Promise<SendChatArg>, finish: () => void } {
    let finish!: () => void
    const gate = new Promise<void>((resolve) => { finish = resolve })
    let begin!: (arg: SendChatArg) => void
    const started = new Promise<SendChatArg>((resolve) => { begin = resolve })
    fakeSend({
        ...spec,
        during: async (arg) => {
            begin(arg)
            await spec.during?.(arg)
            await gate
        },
    })
    return { started, finish }
}

function escapeKey(): KeyboardEvent {
    return new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
}

/** Every alert the store holds from now on, in order. */
function recordAlerts(): { markdown: () => alertData[] } {
    const seen: alertData[] = []
    stopRecording.push(alertStore.subscribe((value) => { seen.push(value as alertData) }))
    return { markdown: () => seen.filter((value) => value.type === 'markdown') }
}

async function outcomeOf(run: Promise<unknown>): Promise<{ threw?: unknown }> {
    try {
        await run
        return {}
    } catch (error) {
        return { threw: error }
    }
}

function shown(): alertData {
    return get(alertStore) as alertData
}

function within<T>(promise: Promise<T>, ms = 1000): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`still waiting after ${ms} ms`)), ms)),
    ])
}

/** Real-timer wait until the answer guard of a prompt that has just opened has passed, so that an answer is taken. */
function pastGuard(): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ANSWER_GUARD_MS + 20))
}

//#endregion

describe.each(previewEntries)('$name: a preview that produces nothing', (entry) => {
    test('a first preview that returns false does not throw, closes its notice and shows no preview', async () => {
        fakeSend({ returns: false })
        const alerts = recordAlerts()

        const outcome = await outcomeOf(entry.run())

        expect.soft(outcome.threw, 'the run rejected').toBeUndefined()
        expect.soft(shown().type, 'the alert still showing').toBe('none')
        expect.soft(alerts.markdown(), 'previews shown').toEqual([])
    })

    test('a failed preview after a successful one shows nothing', async () => {
        fakeSend({ returns: true, body: EARLIER_BODY })
        await entry.run()
        alertStore.set(NONE)
        fakeSend({ returns: false })
        const alerts = recordAlerts()

        await outcomeOf(entry.run())

        expect.soft(alerts.markdown(), 'previews shown by the failed run').toEqual([])
        expect.soft(shown().type, 'the alert still showing').toBe('none')
    })

    test('a failed preview whose error alert is showing leaves that alert up after an earlier success', async () => {
        fakeSend({ returns: true, body: EARLIER_BODY })
        await entry.run()
        alertStore.set(NONE)
        fakeSend({ returns: false, during: () => { alertError('The request failed') } })
        const alerts = recordAlerts()

        await outcomeOf(entry.run())

        expect.soft(shown()).toMatchObject({ type: 'error', msg: 'The request failed' })
        expect.soft(alerts.markdown(), 'previews shown by the failed run').toEqual([])
    })

    test('a failed preview whose failure went into the chat closes its notice and shows no alert', async () => {
        DBState.db = { inlayErrorResponse: true } as unknown as Database
        fakeSend({ returns: true, body: EARLIER_BODY })
        await entry.run()
        alertStore.set(NONE)
        fakeSend({ returns: false })
        const alerts = recordAlerts()

        await outcomeOf(entry.run())

        expect.soft(shown().type, 'the alert still showing').toBe('none')
        expect.soft(alerts.markdown(), 'previews shown by the failed run').toEqual([])
    })

    test('a call that returns false after writing its result shows nothing', async () => {
        fakeSend({ returns: false, body: REQUEST_BODY })
        const alerts = recordAlerts()

        const outcome = await outcomeOf(entry.run())

        expect.soft(outcome.threw, 'the run rejected').toBeUndefined()
        expect.soft(alerts.markdown(), 'previews shown').toEqual([])
        expect.soft(shown().type, 'the alert still showing').toBe('none')
    })

    test('a send that throws closes the runner\'s own notice and the rejection reaches the caller', async () => {
        const failure = new Error('the send blew up')
        fakeSend({ returns: false, throws: failure })
        const alerts = recordAlerts()

        const outcome = await outcomeOf(entry.run())

        expect.soft(outcome.threw, 'the rejection').toBe(failure)
        expect.soft(shown().type, 'the alert still showing').toBe('none')
        expect.soft(alerts.markdown(), 'previews shown').toEqual([])
    })
})

describe.each(previewEntries)('$name: what a successful preview shows', (entry) => {
    test('a body that is plain text is shown as text in a plain fence, without a throw', async () => {
        fakeSend({ returns: true, body: 'Echo says hello' })

        const outcome = await outcomeOf(entry.run())

        expect.soft(outcome.threw, 'the run rejected').toBeUndefined()
        expect.soft(shown().type, 'the alert showing').toBe('markdown')
        expect.soft(shown().msg).toMatch(/```(?!json)[a-z]*\nEcho says hello\n```/)
    })

    test.each([
        ['a request-shaped object', REQUEST_BODY],
        ['an error object', JSON.stringify({ error: 'quota exceeded' })],
        ['a body containing a code fence', JSON.stringify({ url: 'u', body: { content: 'a ``` b' }, headers: {} })],
    ])('guard: %s is pretty-printed in a json fence, and the body cannot close the fence', async (_label, body) => {
        fakeSend({ returns: true, body })
        const pretty = JSON.stringify(JSON.parse(body), null, 2).replaceAll('```', '\\`\\`\\`')

        await entry.run()

        expect(shown().type).toBe('markdown')
        expect(shown().msg.startsWith('### Prompt')).toBe(true)
        expect(shown().msg).toContain('```json\n' + pretty + '\n```')
        expect(shown().msg.split('```').length - 1, 'fence markers').toBe(2)
    })
})

describe('a trigger\'s alert during a successful preview', () => {
    test.each(previewEntries)('$name: the trigger\'s alert is still showing when the run ends, and the result shows after it is closed', async (entry) => {
        fakeSend({ returns: true, body: REQUEST_BODY, during: () => { alertNormal('The start trigger says hi') } })

        await entry.run()

        expect(shown()).toMatchObject({ type: 'normal', msg: 'The start trigger says hi' })
        // The alert is dismissed with Enter, which writes 'yes'.
        alertStore.set({ type: 'none', msg: 'yes' })
        await vi.waitFor(() => expect(shown().type).toBe('markdown'))
        expect(shown().msg).toContain('test-model')
    })
})

describe('the preview hotkey while another alert is up', () => {
    test('a plugin confirm is not covered by a preview and returns the answer the user gives', async () => {
        fakeSend({ returns: true, body: REQUEST_BODY })
        const pending = alertConfirm('Allow the plugin?')
        const key = ctrlU()

        await keydownHandler(key)

        expect.soft(vi.mocked(sendChat), 'sends started').not.toHaveBeenCalled()
        expect.soft(shown()).toMatchObject({ type: 'ask', msg: 'Allow the plugin?' })
        expect.soft(key.defaultPrevented, 'the key was consumed').toBe(true)
        await pastGuard()
        alertStore.set({ type: 'none', msg: 'no' })
        expect(await within(pending)).toBe(false)
    })

    test('the module picker is not covered by a preview and returns the choice the user makes', async () => {
        fakeSend({ returns: true, body: REQUEST_BODY })
        const pending = alertModuleSelect()
        const key = ctrlU()

        await keydownHandler(key)

        expect.soft(vi.mocked(sendChat), 'sends started').not.toHaveBeenCalled()
        expect.soft(shown().type).toBe('selectModule')
        expect.soft(key.defaultPrevented, 'the key was consumed').toBe(true)
        await pastGuard()
        alertStore.set({ type: 'none', msg: '["module-a"]' })
        expect(await within(pending)).toBe('["module-a"]')
    })

    test('guard: a toast in front of the hotkey does not stop the preview', async () => {
        fakeSend({ returns: true, body: REQUEST_BODY })
        putToast('Alert Closed')

        await keydownHandler(ctrlU())

        expect(vi.mocked(sendChat)).toHaveBeenCalledTimes(1)
        expect(shown().type).toBe('markdown')
    })
})

describe('the preview hotkey, when it refuses', () => {
    test.each([
        ['a generation is running', () => { doingChat.set(true) }],
        ['no character is selected', () => { selectedCharID.set(-1) }],
        ['the composer\'s window is open', () => { openComposerWindow({ chaId: 'char-held-elsewhere', chatId: 'chat-held-elsewhere' }) }],
    ])('it consumes Ctrl+U when %s', async (_label, arrange) => {
        arrange()
        const key = ctrlU()

        await keydownHandler(key)

        expect.soft(key.defaultPrevented, 'the key was consumed').toBe(true)
        expect.soft(vi.mocked(sendChat), 'sends started').not.toHaveBeenCalled()
    })

    test('guard: it consumes Ctrl+U when it runs a preview', async () => {
        fakeSend({ returns: true, body: REQUEST_BODY })
        const key = ctrlU()

        await keydownHandler(key)

        expect(key.defaultPrevented).toBe(true)
        expect(vi.mocked(sendChat)).toHaveBeenCalledTimes(1)
    })
})

describe('DevTool formatted previews', () => {
    const formated: OpenAIChat[] = [
        { role: 'system', content: 'S1' },
        { role: 'system', content: 'S2' },
        { role: 'user', content: 'U1' },
        { role: 'assistant', content: 'A1' },
    ]
    const SYSTEM = '⚙️ System'
    const USER = '😐 User'
    const ASSISTANT = '✨ Assistant'

    function block(heading: string, content: string): string {
        return `### ${heading}\n\`\`\`\n${content}\n\`\`\`\n`
    }

    test('guard: the yes join merges neighbouring messages of one role', async () => {
        fakeSend({ returns: true, formated })

        await runPreviewPrompt('normal', 'yes', 'chatml', '')

        expect(shown().type).toBe('markdown')
        expect(shown().msg).toBe(block(SYSTEM, 'S1\nS2') + block(USER, 'U1') + block(ASSISTANT, 'A1'))
    })

    test('guard: the no join shows every message on its own', async () => {
        fakeSend({ returns: true, formated })

        await runPreviewPrompt('normal', 'no', 'chatml', '')

        expect(shown().type).toBe('markdown')
        expect(shown().msg).toBe(block(SYSTEM, 'S1') + block(SYSTEM, 'S2') + block(USER, 'U1') + block(ASSISTANT, 'A1'))
    })

    test('guard: the instruct mode shows the chat template applied to the messages', async () => {
        fakeSend({ returns: true, formated })

        await runPreviewPrompt('instruct', 'no', 'chatml', '')

        const instructed = '<|im_start|>system\nS1<|im_end|>\n<|im_start|>system\nS2<|im_end|>\n'
            + '<|im_start|>user\nU1<|im_end|>\n<|im_start|>assistant\nA1<|im_end|>\n<|im_start|>assistant\n'
        expect(shown().type).toBe('markdown')
        expect(shown().msg).toBe('### Instruction\n```\n' + instructed + '\n```\n')
    })

    test('guard: a message with attachments, thoughts and a cache point says so above its text', async () => {
        fakeSend({
            returns: true,
            formated: [
                {
                    role: 'user',
                    content: 'with extras ``` inside',
                    multimodals: [{ type: 'image', base64: 'AAAA' }],
                    thoughts: ['a thought'],
                    cachePoint: true,
                } as unknown as OpenAIChat,
            ],
        })

        await runPreviewPrompt('normal', 'no', 'chatml', '')

        expect(shown().msg).toBe(
            `### ${USER}\n> 1 non-text content(s) included\n> 1 thought(s) included\n> Cache point\n`
            + '```\nwith extras \\`\\`\\` inside\n```\n'
        )
    })
})

describe.each(previewEntries)('$name: bodies of other shapes', (entry) => {
    test.each([
        ['empty', ''],
        ['only whitespace', '  \n\t '],
    ])('a body that is %s shows the empty marker in place of a fence', async (_label, body) => {
        fakeSend({ returns: true, body })

        const outcome = await outcomeOf(entry.run())

        expect.soft(outcome.threw, 'the run rejected').toBeUndefined()
        expect.soft(shown().type, 'the alert showing').toBe('markdown')
        expect.soft(shown().msg.startsWith('### Prompt')).toBe(true)
        expect.soft(shown().msg).toMatch(/empty/i)
        expect.soft(shown().msg, 'a fence').not.toContain('```')
    })

    test.each([
        ['null', 'null'],
        ['a number', '42'],
        ['a string', '"just text"'],
        ['an array', '[1, {"a": 2}, "three"]'],
    ])('a body that is JSON %s is pretty-printed as it is, without a throw', async (_label, body) => {
        fakeSend({ returns: true, body })

        const outcome = await outcomeOf(entry.run())

        expect.soft(outcome.threw, 'the run rejected').toBeUndefined()
        expect.soft(shown().type, 'the alert showing').toBe('markdown')
        expect.soft(shown().msg).toContain('```json\n' + JSON.stringify(JSON.parse(body), null, 2) + '\n```')
    })
})

describe.each(previewEntries)('$name: what a group member\'s result shows', (entry) => {
    test('a result naming a member puts the member\'s name in the heading', async () => {
        fakeSend({ returns: true, body: REQUEST_BODY, memberName: 'Alice' })

        await entry.run()

        expect(shown().type).toBe('markdown')
        expect(shown().msg.startsWith('### Prompt — Alice\n')).toBe(true)
    })

    test.each([
        ['empty', ''],
        ['whitespace-only', '   '],
    ])('a result whose member name is %s has the plain heading', async (_label, memberName) => {
        fakeSend({ returns: true, body: REQUEST_BODY, memberName })

        await entry.run()

        expect(shown().type).toBe('markdown')
        expect(shown().msg.split('\n')[0]).toBe('### Prompt')
    })

    test('a result that says nobody would speak shows the no-speaker message', async () => {
        fakeSend({ returns: true, noSpeaker: true })

        await entry.run()

        expect(shown()).toMatchObject({ type: 'markdown', msg: language.groupPreviewNoSpeaker })
    })

    test('a no-speaker result from a call that returned false shows nothing', async () => {
        fakeSend({ returns: false, noSpeaker: true })
        const alerts = recordAlerts()

        await entry.run()

        expect.soft(alerts.markdown(), 'previews shown').toEqual([])
        expect.soft(shown().type, 'the alert still showing').toBe('none')
    })
})

describe('Cancel and Escape on the preview\'s notice', () => {
    describe.each(previewEntries)('$name', (entry) => {
        test('the notice carries a cancel action', async () => {
            const held = holdingSend({ returns: true, body: REQUEST_BODY })
            const run = entry.run()
            await held.started

            expect(shown().type).toBe('wait')
            expect(typeof shown().onCancel).toBe('function')

            held.finish()
            await run
        })

        test('the cancel action closes the notice at once, aborts the send\'s signal, and the run shows nothing when the send ends', async () => {
            const held = holdingSend({ returns: true, body: REQUEST_BODY })
            const alerts = recordAlerts()
            const run = entry.run()
            const arg = await held.started
            expect(arg.signal?.aborted, 'aborted before the cancel').toBe(false)

            shown().onCancel!()

            expect.soft(shown().type, 'the alert right after the cancel').toBe('none')
            expect.soft(arg.signal?.aborted, 'the send\'s signal').toBe(true)
            held.finish()
            await run
            expect.soft(shown().type, 'the alert when the run ended').toBe('none')
            expect.soft(alerts.markdown(), 'previews shown').toEqual([])
        })

        test('a cancelled send that then throws still rejects the caller with that error, and shows nothing', async () => {
            const failure = new Error('stopped mid-stage')
            const held = holdingSend({ returns: false, throws: failure })
            const alerts = recordAlerts()
            const run = outcomeOf(entry.run())
            await held.started

            shown().onCancel!()
            held.finish()
            const outcome = await run

            expect.soft(outcome.threw, 'the rejection').toBe(failure)
            expect.soft(shown().type, 'the alert when the run ended').toBe('none')
            expect.soft(alerts.markdown(), 'previews shown').toEqual([])
        })

        test.each([
            ['a text box has focus', () => {
                const box = document.createElement('textarea')
                document.body.append(box)
                box.focus()
                return box as HTMLElement
            }],
            ['a text input has focus', () => {
                const box = document.createElement('input')
                box.type = 'text'
                document.body.append(box)
                box.focus()
                return box as HTMLElement
            }],
            ['nothing has focus', () => document.body as HTMLElement],
        ])('Escape cancels the same way when %s, is consumed, and leaves an open settings panel open', async (_label, arrange) => {
            const held = holdingSend({ returns: true, body: REQUEST_BODY })
            const alerts = recordAlerts()
            const run = entry.run()
            const arg = await held.started
            const focused = arrange()
            expect(document.activeElement).toBe(focused)
            settingsOpen.set(true)
            const key = escapeKey()
            const stop = vi.spyOn(key, 'stopPropagation')

            await keydownHandler(key)

            expect.soft(shown().type, 'the alert right after Escape').toBe('none')
            expect.soft(arg.signal?.aborted, 'the send\'s signal').toBe(true)
            expect.soft(key.defaultPrevented, 'the key was consumed').toBe(true)
            expect.soft(stop, 'propagation stopped').toHaveBeenCalled()
            expect.soft(get(settingsOpen), 'the settings panel').toBe(true)
            held.finish()
            await run
            expect.soft(shown().type, 'the alert when the run ended').toBe('none')
            expect.soft(alerts.markdown(), 'previews shown').toEqual([])
        })

        test('Escape does not touch another wait notice that replaced the preview\'s notice, and does not abort the send', async () => {
            const held = holdingSend({ returns: true, body: REQUEST_BODY })
            const run = entry.run()
            const arg = await held.started
            const foreign = alertWait('Updating...')

            await keydownHandler(escapeKey())

            expect.soft(get(alertStore), 'the store').toBe(foreign)
            expect.soft(arg.signal?.aborted, 'the send\'s signal').toBe(false)
            held.finish()
            await run
        })

        test.each([
            ['returns true with a result', { returns: true, body: REQUEST_BODY }],
            ['returns false', { returns: false }],
        ])('when a foreign alert replaces the notice and then a different wait notice with the same text is set, a send that %s leaves that notice in place', async (_label, spec) => {
            const held = holdingSend(spec)
            const run = entry.run()
            await held.started
            alertNormal('A start trigger says hi')
            const other = alertWait('Loading...')

            held.finish()
            await run

            expect.soft(get(alertStore), 'the store').toBe(other)
        })
    })

    test('with a wait notice that has no cancel action up and nothing running, Escape leaves the notice in place', async () => {
        const notice = alertWait('Updating...')

        await keydownHandler(escapeKey())

        expect(get(alertStore)).toBe(notice)
    })
})

describe.each(previewEntries)('$name: a result that finishes while another alert is up', (entry) => {
    test('a toast at the end is replaced by the result at once', async () => {
        fakeSend({ returns: true, body: REQUEST_BODY, during: () => { putToast('Alert Closed') } })

        await entry.run()

        expect(shown().type).toBe('markdown')
    })

    test('nothing at the end shows the result at once', async () => {
        fakeSend({ returns: true, body: REQUEST_BODY, during: () => { alertStore.set(NONE) } })

        await entry.run()

        expect(shown().type).toBe('markdown')
    })

    test.each([
        ['no', false],
        ['yes', true],
    ])('a confirm that was up at the end and is answered %s returns that answer, and the result shows after', async (answerText, expected) => {
        let pending!: Promise<boolean>
        fakeSend({ returns: true, body: REQUEST_BODY, during: () => { pending = alertConfirm('Proceed?') } })
        await entry.run()
        expect(shown().type, 'the alert at the end of the run').toBe('ask')

        await pastGuard()
        alertStore.set({ type: 'none', msg: answerText })

        expect(await within(pending)).toBe(expected)
        expect(shown().type).toBe('markdown')
        expect(shown().msg).toContain('test-model')
    })

    test.each([
        ['no', false],
        ['yes', true],
    ])('a confirm that was put up after the result began to wait and is answered %s returns that answer, and the result shows after', async (answerText, expected) => {
        fakeSend({ returns: true, body: REQUEST_BODY, during: () => { alertNormal('The start trigger says hi') } })
        await entry.run()
        const pending = alertConfirm('Proceed?')

        await pastGuard()
        alertStore.set({ type: 'none', msg: answerText })

        expect(await within(pending)).toBe(expected)
        expect(shown().type).toBe('markdown')
    })

    test('the module picker that was up at the end returns the choice made, and the result shows after', async () => {
        let pending!: Promise<string>
        fakeSend({ returns: true, body: REQUEST_BODY, during: () => { pending = alertModuleSelect() } })
        await entry.run()
        expect(shown().type, 'the alert at the end of the run').toBe('selectModule')

        await pastGuard()
        alertStore.set({ type: 'none', msg: '["module-a"]' })

        expect(await within(pending)).toBe('["module-a"]')
        expect(shown().type).toBe('markdown')
        expect(shown().msg).toContain('test-model')
    })

    test('Escape on the alert the result waits behind closes that alert, and the result shows at once', async () => {
        fakeSend({ returns: true, body: REQUEST_BODY, during: () => { alertNormal('The start trigger says hi') } })
        await entry.run()
        expect(shown().type, 'the alert at the end of the run').toBe('normal')

        await keydownHandler(escapeKey())

        expect(shown().type, 'the alert right after Escape').toBe('markdown')
        expect(shown().msg).toContain('test-model')
    })

    test('the result is shown once, and a later alert that closes does not show it again', async () => {
        fakeSend({ returns: true, body: REQUEST_BODY, during: () => { alertNormal('The start trigger says hi') } })
        await entry.run()
        const alerts = recordAlerts()

        alertClear()
        expect(shown().type).toBe('markdown')
        alertClear()
        alertNormal('a later notice')
        alertClear()

        expect(alerts.markdown().length).toBe(1)
    })
})

describe('a newer preview run, and a refused attempt, while a result is pending', () => {
    /** Runs a preview whose result waits behind a start trigger's alert, then covers that alert with a toast. */
    async function pendingBehindToast(): Promise<void> {
        fakeSend({ returns: true, body: EARLIER_BODY, during: () => { alertNormal('The start trigger says hi') } })
        await keydownHandler(ctrlU())
        expect(shown().type, 'the alert the result waits behind').toBe('normal')
        putToast('Alert Closed')
        expect(shown()).toMatchObject({ type: 'toast', msg: 'Alert Closed' })
    }

    test('a newer run that ends with its own result drops the pending one, which never shows', async () => {
        await pendingBehindToast()
        const alerts = recordAlerts()
        fakeSend({ returns: true, body: REQUEST_BODY })

        await keydownHandler(ctrlU())
        alertClear()

        expect.soft(alerts.markdown().length, 'previews shown').toBe(1)
        expect.soft(alerts.markdown()[0]?.msg).toContain('test-model')
        expect.soft(alerts.markdown().some((value) => value.msg.includes('EARLIER-PREVIEW-BODY')), 'the dropped result shown').toBe(false)
    })

    test('a newer run that fails drops the pending result, which never shows', async () => {
        await pendingBehindToast()
        const alerts = recordAlerts()
        fakeSend({ returns: false })

        await keydownHandler(ctrlU())
        alertClear()

        expect(alerts.markdown(), 'previews shown').toEqual([])
    })

    test('a newer run that is cancelled drops the pending result too', async () => {
        await pendingBehindToast()
        const alerts = recordAlerts()
        const held = holdingSend({ returns: true, body: REQUEST_BODY })
        const run = keydownHandler(ctrlU())
        await held.started

        await keydownHandler(escapeKey())
        held.finish()
        await run
        alertClear()

        expect(alerts.markdown(), 'previews shown').toEqual([])
    })

    describe.each([
        ['a generation is running', () => { doingChat.set(true) }],
        ['the composer\'s window is open', () => { openComposerWindow({ chaId: 'char-held-elsewhere', chatId: 'chat-held-elsewhere' }) }],
    ])('an attempt refused because %s', (_label, arrangeRefusal) => {
        test.each(previewEntries)('by $name leaves the pending result to show when the toast ends', async (entry) => {
            await pendingBehindToast()
            arrangeRefusal()
            vi.mocked(sendChat).mockClear()

            await entry.run()

            expect.soft(vi.mocked(sendChat), 'sends started').not.toHaveBeenCalled()
            doingChat.set(false)
            resetComposerWindowsForTests()
            alertClear()
            expect.soft(shown().type, 'the alert showing').toBe('markdown')
            expect.soft(shown().msg).toContain('EARLIER-PREVIEW-BODY')
        })
    })

    test('an attempt refused because an alert is up leaves the pending result to show when that alert closes', async () => {
        fakeSend({ returns: true, body: EARLIER_BODY, during: () => { alertNormal('The start trigger says hi') } })
        await keydownHandler(ctrlU())
        vi.mocked(sendChat).mockClear()

        await keydownHandler(ctrlU())
        await runPreviewPrompt('normal', 'prompt', 'chatml', '')

        expect.soft(vi.mocked(sendChat), 'sends started').not.toHaveBeenCalled()
        expect.soft(shown().type, 'the alert still showing').toBe('normal')
        alertClear()
        expect.soft(shown().type, 'the alert showing').toBe('markdown')
        expect.soft(shown().msg).toContain('EARLIER-PREVIEW-BODY')
    })
})

describe('the selected character changing while a result is pending', () => {
    async function pendingBehindAlert(): Promise<void> {
        fakeSend({ returns: true, body: REQUEST_BODY, during: () => { alertNormal('The start trigger says hi') } })
        await keydownHandler(ctrlU())
        expect(shown().type, 'the alert the result waits behind').toBe('normal')
    }

    test('a switch to another character drops the result', async () => {
        await pendingBehindAlert()
        const alerts = recordAlerts()

        selectedCharID.set(1)
        alertClear()

        expect(alerts.markdown(), 'previews shown').toEqual([])
    })

    test('a switch to another character and back before the alert closes drops the result', async () => {
        await pendingBehindAlert()
        const alerts = recordAlerts()

        selectedCharID.set(1)
        selectedCharID.set(SELECTED)
        alertClear()

        expect(alerts.markdown(), 'previews shown').toEqual([])
    })

    test('selecting the character that is already selected does not drop the result', async () => {
        await pendingBehindAlert()

        selectedCharID.set(SELECTED)
        alertClear()

        expect(shown().type).toBe('markdown')
    })

    test('a switch after the result was shown changes nothing', async () => {
        await pendingBehindAlert()
        alertClear()
        expect(shown().type).toBe('markdown')

        selectedCharID.set(1)

        expect(shown().type).toBe('markdown')
    })
})

describe('what the displayed request masks', () => {
    interface ShownRequest {
        url?: string
        headers?: Record<string, unknown>
        body?: unknown
    }

    function maskOf(length: number): string {
        return `•••• (${length} chars)`
    }

    /** The request as the preview displays it: the parsed content of the json fence. */
    function displayed(request: unknown): ShownRequest {
        const md = renderPromptPreview(JSON.stringify(request))
        const fence = /```json\n([\s\S]*)\n```/.exec(md)
        expect(fence, 'a json fence in the preview').not.toBeNull()
        return JSON.parse(fence![1]) as ShownRequest
    }

    function displayedHeaders(headers: Record<string, unknown>): Record<string, unknown> {
        return displayed({ url: 'https://api.example.com/v1', headers }).headers!
    }

    test.each([
        ['Authorization', 'Bearer sk-live-1234567890'],
        ['authorization', 'Bearer sk-live-1234567890'],
        ['x-api-key', 'abcdefghij'],
        ['X-API-KEY', 'ABCDEFGHIJ'],
        ['api-key', 'abcdefghij'],
        ['x-goog-api-key', 'abcdefghij'],
        ['Cookie', 'session=abcdefghij'],
        ['Proxy-Authorization', 'Basic dXNlcjpwYXNz'],
        ['x-amz-security-token', 'FQoGZXIvYXdzEXAMPLE'],
        ['X-Amz-Signature', 'deadbeefdeadbeef'],
        ['x-client-secret', 'shhh-its-a-secret'],
        ['x-custom-auth-header', 'some-value'],
    ])('the header %s has its value hidden, whatever its case', (name, value) => {
        const shownValue = displayedHeaders({ [name]: value })[name]

        expect.soft(shownValue, 'the shown value').not.toBe(value)
        expect.soft(String(shownValue), 'the shown value').toContain('••••')
        expect.soft(String(shownValue), 'the shown value').toMatch(/\(\d+ chars\)$/)
    })

    test.each([
        ['content-type', 'application/json'],
        ['Content-Type', 'application/json'],
        ['anthropic-version', '2023-06-01'],
        ['x-amz-date', '20260929T000000Z'],
        ['accept', 'text/event-stream'],
    ])('the header %s is shown as it is', (name, value) => {
        expect(displayedHeaders({ [name]: value })[name]).toBe(value)
    })

    test('an Authorization value keeps its scheme word and hides the rest with its length', () => {
        const headers = displayedHeaders({ Authorization: 'Bearer sk-abc' })

        expect(headers.Authorization).toBe('Bearer ' + maskOf('sk-abc'.length))
    })

    test('a lower-case authorization header keeps only the scheme word and hides the credential parts', () => {
        const credential = 'Credential=AKIAEXAMPLE/20260929/us-east-1/bedrock/aws4_request, SignedHeaders=host, Signature=abc123'
        const headers = displayedHeaders({ authorization: 'AWS4-HMAC-SHA256 ' + credential })

        expect(headers.authorization).toBe('AWS4-HMAC-SHA256 ' + maskOf(credential.length))
    })

    test('an Authorization value with no scheme word is hidden whole, with its length', () => {
        const headers = displayedHeaders({ Authorization: 'sk-abcdef' })

        expect(headers.Authorization).toBe(maskOf('sk-abcdef'.length))
    })

    test.each([
        ['Bearer undefined'],
        ['Bearer null'],
    ])('an Authorization value of "%s" is shown as it is', (value) => {
        expect(displayedHeaders({ Authorization: value }).Authorization).toBe(value)
    })

    test.each([
        ['an empty value', ''],
        ['the text undefined', 'undefined'],
        ['the text null', 'null'],
        ['a null value', null],
    ])('a secret header with %s is shown as it is', (_label, value) => {
        expect(displayedHeaders({ 'x-api-key': value })['x-api-key']).toBe(value)
    })

    test('a secret header value of another kind shows the length of what it hides', () => {
        expect(displayedHeaders({ 'x-api-key': 'k'.repeat(51) })['x-api-key']).toBe(maskOf(51))
    })

    test('the secret text is nowhere in what is displayed', () => {
        const md = renderPromptPreview(JSON.stringify({
            url: 'https://api.example.com/v1?key=URL-SECRET-VALUE',
            headers: { Authorization: 'Bearer HEADER-SECRET-VALUE', 'x-api-key': 'ANOTHER-SECRET-VALUE' },
            body: { model: 'test-model' },
        }))

        expect.soft(md).not.toContain('URL-SECRET-VALUE')
        expect.soft(md).not.toContain('HEADER-SECRET-VALUE')
        expect.soft(md).not.toContain('ANOTHER-SECRET-VALUE')
        expect.soft(md).toContain('test-model')
    })

    test.each([
        ['key', 'https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent?key=AIzaSy1234&alt=sse', 'https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent?key=' + maskOf(10) + '&alt=sse'],
        ['api_key', 'https://api.example.com/v1?model=m&api_key=abcdef', 'https://api.example.com/v1?model=m&api_key=' + maskOf(6)],
        ['access_token', 'https://api.example.com/v1?access_token=abcdef', 'https://api.example.com/v1?access_token=' + maskOf(6)],
        ['client_secret', 'https://api.example.com/v1?client_secret=abcdef', 'https://api.example.com/v1?client_secret=' + maskOf(6)],
        ['X-Amz-Signature', 'https://api.example.com/v1?X-Amz-Signature=abcdef', 'https://api.example.com/v1?X-Amz-Signature=' + maskOf(6)],
        ['KEY in capitals', 'https://api.example.com/v1?KEY=abcdef', 'https://api.example.com/v1?KEY=' + maskOf(6)],
        ['a key before a fragment', 'https://api.example.com/v1?key=abcdef#top', 'https://api.example.com/v1?key=' + maskOf(6) + '#top'],
    ])('the URL parameter %s is masked and the other parameters are kept', (_label, url, expected) => {
        expect(displayed({ url }).url).toBe(expected)
    })

    test.each([
        ['an address with no host, as Ollama gives with an empty address', '/api/chat?key=abcdef&stream=1', '/api/chat?key=' + maskOf(6) + '&stream=1'],
        ['text that is not a URL at all', 'not a url?token=abcdef', 'not a url?token=' + maskOf(6)],
        ['a URL with a broken scheme', 'ht!tp://bad host/x?secret=abcdef', 'ht!tp://bad host/x?secret=' + maskOf(6)],
    ])('a url that does not parse is masked by its query string and does not throw: %s', (_label, url, expected) => {
        expect(displayed({ url }).url).toBe(expected)
    })

    test.each([
        ['an empty value', 'https://api.example.com/v1?key=&model=m'],
        ['the text undefined', 'https://api.example.com/v1?key=undefined&model=m'],
        ['the text null', 'https://api.example.com/v1?key=null&model=m'],
    ])('a URL key parameter with %s is shown as it is', (_label, url) => {
        expect(displayed({ url }).url).toBe(url)
    })

    test('a URL with no credential parameter is shown as it is', () => {
        const url = 'https://api.example.com/v1/chat?model=m&stream=true'

        expect(displayed({ url }).url).toBe(url)
    })

    test('the body is not scanned: fields in it are shown as they are', () => {
        const shownBody = displayed({ url: 'https://api.example.com/v1', headers: {}, body: { key: 'plain-key-field', token: 'plain-token-field' } }).body

        expect(shownBody).toEqual({ key: 'plain-key-field', token: 'plain-token-field' })
    })

    test.each([
        ['a url that is not a string', { url: 42, headers: { 'x-api-key': 'abcdef' } }],
        ['headers that are an array', { url: 'https://a.example/v1', headers: ['x-api-key: abcdef'] }],
        ['headers that are null', { url: 'https://a.example/v1', headers: null }],
        ['headers that are a string', { url: 'https://a.example/v1', headers: 'x-api-key: abcdef' }],
        ['a request with neither', { body: { model: 'm' } }],
    ])('%s do not make the renderer throw', (_label, request) => {
        expect(() => renderPromptPreview(JSON.stringify(request))).not.toThrow()
    })

    test('masking a result leaves the result\'s own body untouched', () => {
        const body = JSON.stringify({ url: 'https://a.example/v1?key=abcdef', headers: { Authorization: 'Bearer sk-abc' }, body: {} })
        const result = { body }

        const md = renderPromptResult(result)

        expect(md).toContain('••••')
        expect(result.body).toBe(body)
    })
})

describe('DevTool formatted previews of a group member', () => {
    const formated: OpenAIChat[] = [
        { role: 'system', content: 'S1' },
        { role: 'user', content: 'U1' },
    ]

    test('a formatted preview of a named member puts a Previewing line above the messages, and the messages are unchanged', async () => {
        fakeSend({ returns: true, formated, memberName: 'Alice' })

        await runPreviewPrompt('normal', 'no', 'chatml', '')

        expect(shown().msg).toBe(
            '> Previewing Alice\n'
            + '### ⚙️ System\n```\nS1\n```\n'
            + '### 😐 User\n```\nU1\n```\n'
        )
    })

    test('the instruct mode puts the Previewing line above the instruction', async () => {
        fakeSend({ returns: true, formated, memberName: 'Alice' })

        await runPreviewPrompt('instruct', 'no', 'chatml', '')

        expect(shown().msg.startsWith('> Previewing Alice\n### Instruction\n```\n')).toBe(true)
    })

    test('a member name with Markdown and HTML in it is shown as text', async () => {
        fakeSend({ returns: true, formated, memberName: '<img src=x onerror=alert(1)> *bold*' })

        await runPreviewPrompt('normal', 'no', 'chatml', '')

        const firstLine = shown().msg.split('\n')[0]
        expect.soft(firstLine, 'a raw tag').not.toContain('<img')
        expect.soft(firstLine, 'raw emphasis').not.toMatch(/(?<!\\)\*bold\*/)
        expect.soft(firstLine, 'the name is shown').toContain('bold')
    })

    test.each([
        ['empty', ''],
        ['whitespace-only', '   '],
    ])('a formatted preview whose member name is %s has no Previewing line', async (_label, memberName) => {
        fakeSend({ returns: true, formated, memberName })

        await runPreviewPrompt('normal', 'no', 'chatml', '')

        expect(shown().msg).toBe(
            '### ⚙️ System\n```\nS1\n```\n'
            + '### 😐 User\n```\nU1\n```\n'
        )
    })

    test('a formatted preview that names no member has no Previewing line', async () => {
        fakeSend({ returns: true, formated })

        await runPreviewPrompt('normal', 'no', 'chatml', '')

        expect(shown().msg).not.toContain('Previewing')
    })

    test('a formatted preview of a group where nobody would speak shows the no-speaker message', async () => {
        fakeSend({ returns: true, noSpeaker: true })

        await runPreviewPrompt('normal', 'no', 'chatml', '')

        expect(shown()).toMatchObject({ type: 'markdown', msg: language.groupPreviewNoSpeaker })
    })
})

describe('a preview and a prompt that is waiting', () => {
    /** Just past the 400 ms during which an answer to a returning prompt is discarded. */
    const GUARD_MS = 401

    /** What a caller has received so far from a prompt. */
    interface PromptOutcome {
        settled: boolean
        value?: boolean
    }

    function trackConfirm(promise: Promise<boolean>): PromptOutcome {
        const outcome: PromptOutcome = { settled: false }
        void promise.then((value) => { outcome.settled = true; outcome.value = value })
        return outcome
    }

    async function settle(): Promise<void> {
        await vi.advanceTimersByTimeAsync(0)
    }

    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    describe.each(previewEntries)('$name: a result that finishes while a prompt is covered', (entry) => {
        test('closing the notice that covers the prompt shows the prompt and not the result, and answering the prompt then shows the result', async () => {
            let prompt!: PromptOutcome
            let asked!: alertData
            fakeSend({
                returns: true,
                body: REQUEST_BODY,
                during: () => {
                    prompt = trackConfirm(alertConfirm('Proceed?'))
                    asked = shown()
                    alertNormal('The start trigger says hi')
                },
            })
            const alerts = recordAlerts()
            await entry.run()
            expect(shown().type, 'the alert at the end of the run').toBe('normal')

            alertStore.set({ type: 'none', msg: 'yes' })
            await settle()

            expect.soft(shown(), 'the alert once the notice closed').toEqual(asked)
            expect.soft(alerts.markdown(), 'previews shown while the prompt waits').toEqual([])
            expect.soft(prompt.settled, 'the prompt settled with the notice\'s answer').toBe(false)
            await vi.advanceTimersByTimeAsync(GUARD_MS)
            alertStore.set({ type: 'none', msg: 'no' })
            await settle()
            expect.soft(prompt, 'the prompt after its own answer').toEqual({ settled: true, value: false })
            expect.soft(shown().type, 'the alert once the prompt was answered').toBe('markdown')
            expect.soft(shown().msg).toContain('test-model')
        })

        test('a result that finishes while a toast covers the prompt does not replace the toast, and shows after the prompt is answered', async () => {
            let prompt!: PromptOutcome
            let asked!: alertData
            fakeSend({
                returns: true,
                body: REQUEST_BODY,
                during: () => {
                    prompt = trackConfirm(alertConfirm('Proceed?'))
                    asked = shown()
                    putToast('Alert Closed')
                },
            })
            const alerts = recordAlerts()

            await entry.run()

            expect.soft(shown().type, 'the alert at the end of the run').toBe('toast')
            expect.soft(alerts.markdown(), 'previews shown at the end of the run').toEqual([])
            alertStore.set(NONE)
            await settle()
            expect.soft(shown(), 'the alert once the toast ended').toEqual(asked)
            await vi.advanceTimersByTimeAsync(GUARD_MS)
            alertStore.set({ type: 'none', msg: 'yes' })
            await settle()
            expect.soft(prompt, 'the prompt after its own answer').toEqual({ settled: true, value: true })
            expect.soft(shown().type, 'the alert once the prompt was answered').toBe('markdown')
        })
    })

    describe('whether a preview may start', () => {
        test('it may not while a prompt is waiting under a toast', () => {
            trackConfirm(alertConfirm('Proceed?'))
            putToast('Alert Closed')

            expect(previewMayStart()).toBe(false)
        })

        test('guard: it may start under a toast when no prompt is waiting', () => {
            putToast('Alert Closed')

            expect(previewMayStart()).toBe(true)
        })

        test('guard: it may not start while a prompt is showing', () => {
            trackConfirm(alertConfirm('Proceed?'))

            expect(previewMayStart()).toBe(false)
        })
    })

    describe('a preview run started while a prompt is waiting', () => {
        test('a finished result closes the runner\'s notice over the prompt, the prompt returns, and the result shows once the prompt is answered', async () => {
            const prompt = trackConfirm(alertConfirm('Proceed?'))
            const asked = shown()
            fakeSend({ returns: true, body: REQUEST_BODY })
            const alerts = recordAlerts()

            await runPreview({ previewPrompt: true }, renderPromptResult)
            await settle()

            expect.soft(shown(), 'the alert once the run ended').toEqual(asked)
            expect.soft(alerts.markdown(), 'previews shown while the prompt waits').toEqual([])
            expect.soft(prompt.settled, 'the prompt settled').toBe(false)
            await vi.advanceTimersByTimeAsync(GUARD_MS)
            alertStore.set({ type: 'none', msg: 'yes' })
            await settle()
            expect.soft(prompt, 'the prompt after its own answer').toEqual({ settled: true, value: true })
            expect.soft(shown().type, 'the alert once the prompt was answered').toBe('markdown')
            expect.soft(shown().msg).toContain('test-model')
        })
    })

    describe('Escape on the preview\'s cancellable notice over a waiting prompt', () => {
        /** Puts a prompt up, then runs a preview that holds its send; the runner's notice covers the prompt. */
        async function previewOverPrompt(): Promise<{ prompt: PromptOutcome, asked: alertData, signal: () => AbortSignal | undefined, finish: () => Promise<void> }> {
            const prompt = trackConfirm(alertConfirm('Proceed?'))
            const asked = shown()
            const held = holdingSend({ returns: true, body: REQUEST_BODY })
            const run = runPreview({ previewPrompt: true }, renderPromptResult)
            const arg = await held.started
            expect(shown().type, 'the alert while the preview runs').toBe('wait')
            return {
                prompt,
                asked,
                signal: () => arg.signal,
                finish: async () => {
                    held.finish()
                    await run
                },
            }
        }

        test('guard: Escape cancels the preview and closes its notice', async () => {
            const preview = await previewOverPrompt()

            await keydownHandler(escapeKey())

            expect.soft(preview.signal()?.aborted, 'the send\'s signal').toBe(true)
            expect.soft(shown().type, 'the notice after Escape').not.toBe('wait')
            await preview.finish()
        })

        test('the prompt is shown again and still waits after Escape cancels the preview', async () => {
            const preview = await previewOverPrompt()

            await keydownHandler(escapeKey())
            await settle()

            expect.soft(shown(), 'the alert after Escape').toEqual(preview.asked)
            expect.soft(preview.prompt.settled, 'the prompt settled').toBe(false)
            await preview.finish()
            expect.soft(shown(), 'the alert once the cancelled send ended').toEqual(preview.asked)
        })
    })
})
