// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import * as drafts from '../../ts/process/composerDrafts.svelte'
import { setProcessStage } from '../../ts/process/generationOwnership.svelte'
import { hasLocalDrafts, resetLocalDraftsForTest } from '../../ts/localDrafts'
import { pendingChatFileUploads, trackChatFileAttachment } from '../../ts/process/composerSurface.svelte'
import type { InlayWriteProgress } from '../../ts/process/files/inlays'
import { addActiveStream, noteStreamText, resetActiveStreamsForTest } from '../../ts/process/activeStreams'
import { glyphsIn, iconsIn, lucideNames } from './tests/glyphFree'

const state = $state({ db: {
    characters: [{ chaId: 'c', name: 'Character', chatPage: 0, chats: [{ id: 'chat', message: [] }] }],
    sendWithEnter: true, useAutoTranslateInput: false, translator: '', username: 'User', longPressToPopupEditor: false,
} })
const selection = $state({ selId: 0 })
const popup = $state({ value: '', mode: '', language: '', open: false })
const busy = writable(false)
const sendMain = vi.fn(async () => {})
const abortChat = vi.fn()
const stopComposerWorkIn = vi.fn()
// Whether work is registered in the shown chat, and whether the global send flag is held by another chat.
const work = $state({ shown: false, window: false })
const postChatFile = vi.fn(async (..._args: unknown[]) => [{ type: 'asset' as const, data: 'asset-id' }])

vi.mock('../../ts/stores.svelte', () => ({ DBState: state, selIdState: selection, popUpEditorStore: popup }))
vi.mock('../../ts/process/index.svelte', () => ({ doingChat: busy }))
vi.mock('../../ts/process/composerActions.svelte', () => ({ sendMain, abortChat, stopComposerWorkIn, isComposerBusy: () => work.window, isComposerBusyIn: () => work.shown, isComposerLocked: () => false, reroll: vi.fn(), updateInputTransateMessage: vi.fn() }))
const pendingDelete = $state({ chatId: null as string | null })
vi.mock('../../ts/process/chatOrigin', () => ({ beginWork: vi.fn(), originOf: (owner: { chaId: string }, chat: { id: string }) => ({ chaId: owner.chaId, chatId: chat.id }) }))
vi.mock('../../ts/chatShell/stopDelete.svelte', () => ({
    isStopDeletePending: (origin?: { chaId: string, chatId: string } | null) => origin ? origin.chatId === pendingDelete.chatId : pendingDelete.chatId !== null,
}))
vi.mock('../../ts/process/files/multisend', () => ({ postChatFile }))
vi.mock('../../ts/parser/parser.svelte', () => ({ hasher: (value: string) => value, risuChatParser: (value: string) => value, assetRegex: /{{asset:[^}]+}}/g }))
vi.mock('../../ts/parser/chatML', () => ({ parseChatML: () => [] }))
vi.mock('../ChatScreens/Suggestion.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/AssetInput.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lang', () => ({ language: {
    chatShellMessage: 'Message', chatShellMoreActions: 'More actions', tools: 'Tools', chatShellChoosePersona: 'Choose persona',
    asPersona: (name: string) => `as ${name}`, chatShellStop: 'Stop', chatShellSend: 'Send', chatShellSendWaitsForDelete: 'Waiting for the reply to be deleted…',
    chatShellSendBlockedWriting: 'Another chat is writing a reply. Send when it finishes.',
    chatShellRemoveAttachment: 'Remove attachment', enterKey: 'Enter key',
    chatShellStickers: 'Stickers', chatShellOnThisDevice: 'On this device', chatShellOnThisDeviceHelp: 'Other devices keep their own setting.',
    chatShellAttachingFile: (name: string, written: string, total: string) => `Attaching ${name}: ${written} / ${total} MiB`,
    chatShellEnterAutomatic: 'Automatic', chatShellEnterSend: 'Send', chatShellEnterNewline: 'New line', postFile: 'Post File',
} }))

let app: ReturnType<typeof mount> | null = null
let target: HTMLElement | null = null
afterEach(async () => {
    if (app) await unmount(app)
    target?.remove()
    app = null; target = null
    resetLocalDraftsForTest()
    drafts.resetComposerDraftsForTests()
    pendingDelete.chatId = null
    sendMain.mockClear(); abortChat.mockClear(); stopComposerWorkIn.mockClear(); postChatFile.mockClear()
    work.shown = false
    work.window = false
    busy.set(false)
    vi.unstubAllGlobals()
})

async function show() {
    const { default: ShellComposer } = await import('./ShellComposer.svelte')
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ShellComposer, { target, props: { onplus: vi.fn(), onpersona: vi.fn() } })
    flushSync()
    return target
}

describe('ShellComposer draft and actions', () => {
    test('surface write registers the draft, Send uses the old source/false arguments, destroy unregisters', async () => {
        const node = await show()
        const input = node.querySelector<HTMLTextAreaElement>('[data-part="chat-composer-input"]')
        expect(input).not.toBeNull()
        if (!input) return
        input.value = 'hello'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        expect(drafts.peek({ chaId: 'c', chatId: 'chat' }).messageInput).toBe('hello')
        expect(hasLocalDrafts()).toBe(true)
        node.querySelector<HTMLButtonElement>('[data-part="chat-send"]')?.click()
        expect(sendMain).toHaveBeenCalledWith(expect.objectContaining({ closeMenu: expect.any(Function) }), false)
        if (app) await unmount(app)
        app = null
        expect(hasLocalDrafts()).toBe(false)
    })

    // G12 (post-fix guard): the progress ring shows the shown chat's own stage, not another chat's.
    test('the Stop button shows the stage of the shown chat', async () => {
        setProcessStage({ chaId: 'c', chatId: 'chat' }, 3)
        setProcessStage({ chaId: 'other', chatId: 'other-chat' }, 1)
        work.shown = true
        const node = await show()
        expect(node.querySelector('[data-part="chat-composer-progress"]')?.getAttribute('data-stage')).toBe('3')
    })

    test('the plus button is named Tools, the name of the sheet it opens, and not the message action name', async () => {
        const node = await show()
        const plus = node.querySelector<HTMLButtonElement>('[data-part="chat-composer-plus"]')!
        expect(plus.getAttribute('aria-label')).toBe('Tools')
    })

    test('Send is disabled with the reason while a stop-and-delete is pending for this chat, enabled for another chat and after it clears', async () => {
        const node = await show()
        const send = () => node.querySelector<HTMLButtonElement>('[data-part="chat-send"]')!
        expect(send().disabled).toBe(false)
        pendingDelete.chatId = 'other-chat'
        flushSync()
        expect(send().disabled).toBe(false)
        send().click()
        expect(sendMain).toHaveBeenCalledTimes(1)
        sendMain.mockClear()
        pendingDelete.chatId = 'chat'
        flushSync()
        expect(send().disabled).toBe(true)
        expect(send().title).toBe('Waiting for the reply to be deleted…')
        send().click()
        expect(sendMain).not.toHaveBeenCalled()
        pendingDelete.chatId = null
        flushSync()
        expect(send().disabled).toBe(false)
        expect(send().hasAttribute('title')).toBe(false)
        send().click()
        expect(sendMain).toHaveBeenCalledTimes(1)
    })

    test('Enter does not send while a stop-and-delete is pending for this chat, and sends once it clears', async () => {
        const node = await show()
        const input = node.querySelector<HTMLTextAreaElement>('[data-part="chat-composer-input"]')!
        const mode = node.querySelector<HTMLSelectElement>('[data-part="chat-composer-tools"] select')!
        mode.value = 'send'
        mode.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        const enterKey = () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
        pendingDelete.chatId = 'chat'
        flushSync()
        enterKey()
        expect(sendMain).not.toHaveBeenCalled()
        pendingDelete.chatId = null
        flushSync()
        enterKey()
        expect(sendMain).toHaveBeenCalledTimes(1)
        localStorage.clear()
    })

    describe('Enter right after IME composition end', () => {
        let clock = 1000
        async function composed(mode: 'send' | 'newline' | 'auto') {
            localStorage.clear()
            vi.spyOn(performance, 'now').mockImplementation(() => clock)
            const node = await show()
            const input = node.querySelector<HTMLTextAreaElement>('[data-part="chat-composer-input"]')!
            const select = node.querySelector<HTMLSelectElement>('[data-part="chat-composer-tools"] select')!
            select.value = mode
            select.dispatchEvent(new Event('change', { bubbles: true }))
            flushSync()
            clock = 1000
            input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
            input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
            return input
        }
        const enter = (input: HTMLTextAreaElement, init: KeyboardEventInit = {}) => {
            const event = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true, ...init })
            input.dispatchEvent(event)
            return event
        }
        afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

        for (const gap of [2, 200]) {
            test(`send mode: the Enter ${gap} ms after compositionend sends once and is prevented`, async () => {
                const input = await composed('send')
                clock = 1000 + gap
                const event = enter(input)
                expect(event.defaultPrevented).toBe(true)
                expect(sendMain).toHaveBeenCalledTimes(1)
            })

            for (const mode of ['newline', 'auto'] as const) {
                test(`${mode} mode: the Enter ${gap} ms after compositionend is not prevented and does not send`, async () => {
                    const input = await composed(mode)
                    clock = 1000 + gap
                    const event = enter(input)
                    expect(event.defaultPrevented).toBe(false)
                    expect(sendMain).not.toHaveBeenCalled()
                })
            }
        }

        test('Shift+Enter after compositionend and a composing Enter are left alone', async () => {
            const input = await composed('send')
            clock = 1002
            expect(enter(input, { shiftKey: true }).defaultPrevented).toBe(false)
            input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
            expect(enter(input, { isComposing: true }).defaultPrevented).toBe(false)
            expect(enter(input, { isComposing: false, keyCode: 229 }).defaultPrevented).toBe(false)
            expect(enter(input, { isComposing: true, keyCode: 229 }).defaultPrevented).toBe(false)
            expect(sendMain).not.toHaveBeenCalled()
        })

        test('send mode: after compositionstart with no compositionend, a plain Enter sends once', async () => {
            const input = await composed('send')
            input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
            const event = enter(input)
            expect(event.defaultPrevented).toBe(true)
            expect(sendMain).toHaveBeenCalledTimes(1)
        })
    })

    test('the Enter key selector says it is a setting of this device', async () => {
        const node = await show()
        const tools = node.querySelector('[data-part="chat-composer-tools"]')!
        expect(tools.querySelector('select')).not.toBeNull()
        expect(tools.querySelector('[data-part="chat-composer-enter-scope"]')?.textContent).toBe('On this device')
    })

    test('TC3-5: the Enter key select is described by its label text, the device chip and the help, in that order', async () => {
        const node = await show()
        const tools = node.querySelector('[data-part="chat-composer-tools"]')!
        const select = tools.querySelector('select')!
        const ids = (select.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
        expect(ids).toHaveLength(3)
        const texts = ids.map((id) => node.ownerDocument.getElementById(id)?.textContent?.trim())
        expect(texts).toEqual(['Enter key', 'On this device', 'Other devices keep their own setting.'])
        expect(ids[1]).toBe(tools.querySelector('[data-part="chat-composer-enter-scope"]')!.id)
        expect(tools.querySelector('[data-part="chat-composer-enter-scope"]')?.textContent).toBe('On this device')
    })

    test('T11: work in the shown chat shows Stop, and Stop stops that chat only', async () => {
        const node = await show()
        busy.set(true)
        work.shown = true
        flushSync()
        node.querySelector<HTMLButtonElement>('[data-part="chat-composer-stop"]')?.click()
        expect(stopComposerWorkIn).toHaveBeenCalledTimes(1)
        expect(stopComposerWorkIn).toHaveBeenCalledWith({ chaId: 'c', chatId: 'chat' })
        expect(abortChat).not.toHaveBeenCalled()
    })

    // TC2-2 (regression reproducer): plus, send and stop were the text glyphs + ➤ ■; their names are unchanged.
    test('plus, send and stop are aria-hidden icons with no glyph text', async () => {
        await import('@lucide/svelte')
        const node = await show()
        const plus = node.querySelector<HTMLElement>('[data-part="chat-composer-plus"]')!
        const send = node.querySelector<HTMLElement>('[data-part="chat-send"]')!
        expect(lucideNames(plus)).toEqual(['lucide-plus'])
        expect(lucideNames(send)).toEqual(['lucide-send-horizontal'])
        expect(send.getAttribute('aria-label')).toBe('Send')
        expect(iconsIn(node.querySelector('[data-part="chat-composer-row"]')!).every((svg) => svg.getAttribute('aria-hidden') === 'true')).toBe(true)
        busy.set(true)
        work.shown = true
        flushSync()
        const stop = node.querySelector<HTMLElement>('[data-part="chat-composer-stop"]')!
        expect(lucideNames(stop)).toEqual(['lucide-square'])
        expect(stop.getAttribute('aria-label')).toBe('Stop')
        expect(iconsIn(node.querySelector('[data-part="chat-composer-row"]')!).every((svg) => svg.getAttribute('aria-hidden') === 'true')).toBe(true)
        expect(glyphsIn(node)).toEqual([])
    }, 120_000)

    describe('the progress ring holds still once the shown chat has streamed text', () => {
        const fixtureChaId = state.db.characters[0].chaId
        const fixtureChatId = state.db.characters[0].chats[0].id

        /** The selector list of the adopted hold rule, so a renamed class or data part turns a ring assertion red. */
        function holdSelectors(): string {
            const sheet = document.head.querySelector('style[data-risu-sheet="stream-text-hold"]')
            const css = (sheet?.textContent ?? '').replace(/\/\*[\s\S]*?\*\//g, '')
            const rule = /([^{}]+)\{[^}]*paused/.exec(css)
            expect(rule).not.toBeNull()
            return rule![1].trim()
        }

        async function showBusy() {
            const node = await show()
            busy.set(true)
            work.shown = true
            flushSync()
            return node.querySelector<HTMLElement>('[data-part="chat-composer-progress"]')!
        }

        afterEach(() => {
            resetActiveStreamsForTest()
        })

        test('a stream of the shown chat with written text latches the ring', async () => {
            const ring = await showBusy()
            expect(ring.hasAttribute('data-still')).toBe(false)
            addActiveStream({ chaId: fixtureChaId, chatId: fixtureChatId, replyChatId: 'reply-1' })
            noteStreamText('reply-1', '')
            expect(ring.hasAttribute('data-still')).toBe(false)
            noteStreamText('reply-1', 'Hi')
            expect(ring.hasAttribute('data-still')).toBe(true)
            expect(ring.matches(holdSelectors())).toBe(true)
        })

        test('the latch survives the stream ending, and a new ring after the busy period ticks again', async () => {
            const ring = await showBusy()
            const removeStream = addActiveStream({ chaId: fixtureChaId, chatId: fixtureChatId, replyChatId: 'reply-1' })
            noteStreamText('reply-1', 'Hi')
            expect(ring.hasAttribute('data-still')).toBe(true)
            removeStream()
            flushSync()
            expect(ring.hasAttribute('data-still')).toBe(true)

            work.shown = false
            busy.set(false)
            flushSync()
            expect(target!.querySelector('[data-part="chat-composer-progress"]')).toBeNull()
            work.shown = true
            busy.set(true)
            flushSync()
            expect(target!.querySelector('[data-part="chat-composer-progress"]')!.hasAttribute('data-still')).toBe(false)
        })

        test('a stream of another chat of the same owner does not latch the ring', async () => {
            const ring = await showBusy()
            addActiveStream({ chaId: fixtureChaId, chatId: 'other-chat', replyChatId: 'reply-b' })
            noteStreamText('reply-b', 'Hi')
            expect(ring.hasAttribute('data-still')).toBe(false)
        })
    })

    test('T10: a reply written in another chat shows no Stop, disables Send with the reason, and leaves typing alone', async () => {
        const node = await show()
        busy.set(true)
        flushSync()
        expect(node.querySelector('[data-part="chat-composer-stop"]')).toBeNull()
        const send = node.querySelector<HTMLButtonElement>('[data-part="chat-send"]')!
        expect(send.disabled).toBe(true)
        expect(send.title).toBe('Another chat is writing a reply. Send when it finishes.')
        const reasonId = send.getAttribute('aria-describedby')!
        expect(node.querySelector(`#${reasonId}`)?.textContent).toBe('Another chat is writing a reply. Send when it finishes.')
        send.click()
        expect(sendMain).not.toHaveBeenCalled()
        const input = node.querySelector<HTMLTextAreaElement>('[data-part="chat-composer-input"]')!
        expect(input.readOnly).toBe(false)
        input.value = 'typed meanwhile'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        expect(drafts.peek({ chaId: 'c', chatId: 'chat' }).messageInput).toBe('typed meanwhile')

        busy.set(false)
        flushSync()
        expect(node.querySelector<HTMLButtonElement>('[data-part="chat-send"]')!.disabled).toBe(false)
        expect(node.querySelector<HTMLButtonElement>('[data-part="chat-send"]')!.hasAttribute('aria-describedby')).toBe(false)
    })

    test('T10: another chat\'s open take window (the send flag not yet held) disables Send with the reason, and it re-enables when the window closes', async () => {
        const node = await show()
        work.window = true
        flushSync()
        const send = node.querySelector<HTMLButtonElement>('[data-part="chat-send"]')!
        expect(get(busy)).toBe(false)
        expect(send.disabled).toBe(true)
        expect(send.title).toBe('Another chat is writing a reply. Send when it finishes.')
        send.click()
        expect(sendMain).not.toHaveBeenCalled()
        work.window = false
        flushSync()
        expect(node.querySelector<HTMLButtonElement>('[data-part="chat-send"]')!.disabled).toBe(false)
    })

    test('paste counts the FileReader until load, error, or abort settles', async () => {
        const readers: FakeReader[] = []
        class FakeReader {
            result: ArrayBuffer | null = null
            onload: (() => void) | null = null
            onerror: (() => void) | null = null
            onabort: (() => void) | null = null
            constructor() { readers.push(this) }
            readAsArrayBuffer(): void {}
        }
        vi.stubGlobal('FileReader', FakeReader)
        const node = await show()
        const input = node.querySelector<HTMLTextAreaElement>('[data-part="chat-composer-input"]')
        expect(input).not.toBeNull()
        if (!input) return
        const paste = () => {
            const event = new Event('paste', { bubbles: true, cancelable: true })
            Object.defineProperty(event, 'clipboardData', { value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => new File(['a'], 'a.png', { type: 'image/png' }) }] } })
            input.dispatchEvent(event)
        }
        paste()
        expect(pendingChatFileUploads()).toBe(1)
        readers[0].result = new ArrayBuffer(1)
        readers[0].onload?.()
        await Promise.resolve(); await Promise.resolve()
        expect(pendingChatFileUploads()).toBe(0)
        expect(drafts.peek({ chaId: 'c', chatId: 'chat' }).fileInput).toContain('asset-id')
        paste(); expect(pendingChatFileUploads()).toBe(1)
        readers[1].onerror?.(); expect(pendingChatFileUploads()).toBe(0)
        paste(); expect(pendingChatFileUploads()).toBe(1)
        readers[2].onabort?.(); expect(pendingChatFileUploads()).toBe(0)
        expect(typeof postChatFile.mock.calls[0][3]).toBe('function')
    })

    describe('the attach chip', () => {
        const pending: Array<() => void> = []
        afterEach(() => { for (const release of pending.splice(0)) release() })

        test('a file button pick shows the chip with its progress while the write runs and removes it when it resolves', async () => {
            let report: ((progress: InlayWriteProgress | null) => void) | null = null
            let release!: () => void
            const released = new Promise<void>((resolve) => { release = resolve })
            pending.push(release)
            postChatFile.mockImplementationOnce(async (...args: unknown[]) => {
                report = args[3] as (progress: InlayWriteProgress | null) => void
                report({ name: 'clip.mp4', written: 0, total: 195 * 1024 * 1024 })
                await released
                return [{ type: 'asset' as const, data: 'asset-id' }]
            })
            const node = await show()
            const chip = () => node.querySelector<HTMLElement>('[data-part="chat-attaching-chip"]')
            expect(chip()).toBeNull()
            const post = node.querySelector<HTMLButtonElement>('[data-part="chat-composer-tools"] button')!
            post.click()
            await Promise.resolve()
            flushSync()
            expect(chip()?.textContent).toBe('Attaching clip.mp4: 0.0 / 195.0 MiB')
            expect(chip()?.getAttribute('role')).toBe('progressbar')
            expect(chip()?.getAttribute('aria-valuenow')).toBe('0')
            report!({ name: 'clip.mp4', written: 8 * 1024 * 1024, total: 195 * 1024 * 1024 })
            flushSync()
            expect(chip()?.textContent).toBe('Attaching clip.mp4: 8.0 / 195.0 MiB')
            release()
            await released
            await new Promise((resolve) => setTimeout(resolve, 0))
            flushSync()
            expect(chip()).toBeNull()
            expect(drafts.peek({ chaId: 'c', chatId: 'chat' }).fileInput).toContain('asset-id')
        })

        test('an attachment bound for another chat shows no chip in the shown chat', async () => {
            let release!: () => void
            const call = trackChatFileAttachment({ chaId: 'c', chatId: 'other-chat' }, async (report) => {
                report({ name: 'other.mp4', written: 1, total: 2 })
                await new Promise<void>((resolve) => { release = resolve })
            })
            pending.push(() => release())
            const node = await show()
            expect(node.querySelector('[data-part="chat-attaching-chip"]')).toBeNull()
            release()
            await call
        })
    })
})
