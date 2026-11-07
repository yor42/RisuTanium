// @vitest-environment jsdom
/**
 * How the shell presents a chat or character switch: the header's chat line and pending target, the document title, the polite
 * announcement, the fade, and the SwitchFrame that holds a pending or failed switch.
 *
 * TE1-TE3 are regression reproducers (the base shell has none of these); TE4, TE5 and TE7 cover new code and are proved by
 * the scratch mutants listed in the stage report.
 *
 * REAL: ChatShell.svelte, SwitchFrame.svelte. MOCKED: the stores and database, the header (it records its props), the
 * composer and every sheet, and the switch state (a plain rune object the test drives the way switchCharacter does).
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const captured = vi.hoisted(() => ({
    header: null as null | { name: string, chatName?: string },
    retry: null as null | (() => void),
    back: null as null | (() => void),
}))

type Pending = { target: { name: string } | null, phase: 'idle' | 'loading' | 'failed', reason: unknown }
const state = $state<{ db: { characters: Record<string, unknown>[] } }>({ db: { characters: [] } })
const selection = $state({ selId: 0 })
const pending = $state<Pending>({ target: null, phase: 'idle', reason: null })
const retrySwitch = vi.fn(() => undefined)
const backToPrevious = vi.fn(() => { pending.phase = 'idle'; pending.target = null })

vi.mock('../../ts/stores.svelte', () => ({ DBState: state, selIdState: selection }))
vi.mock('../../ts/chatShell/switchTarget.svelte', () => ({ switchTarget: pending, retrySwitch: () => retrySwitch(), backToPrevious: () => backToPrevious() }))
vi.mock('../../ts/process/index.svelte', () => ({ doingChat: writable(false), chatProcessStage: writable(0) }))
vi.mock('../ChatScreens/chatSurface.svelte', () => ({ chatSurface: { hidden: false, closeEpoch: 0 } }))
vi.mock('../../ts/process/chatTreeView', () => ({ treeView: () => null }))
vi.mock('../../ts/parser/parser.svelte', () => ({ hasher: (value: string) => value, risuChatParser: (value: string) => value, assetRegex: /{{asset:[^}]+}}/g }))
vi.mock('../../ts/parser/chatML', () => ({ parseChatML: () => [] }))
vi.mock('../../lang', () => ({ language: {
    chatShellMessages: 'Messages',
    chatShellLoadingChat: 'Loading chat',
    chatShellLoadFailed: 'This chat could not be loaded.',
    chatShellRetry: 'Try again',
    chatShellBackToPrevious: 'Back to previous chat',
    chatShellChatOpened: (chat: string) => `Opened ${chat}`,
} }))
vi.mock('./ShellHeader.svelte', () => ({ default: (_anchor: unknown, props: { name: string, chatName?: string }) => { captured.header = props; return {} } }))
vi.mock('./ShellComposer.svelte', () => ({ default: () => ({}) }))
vi.mock('./PersonaSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PlusSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellNotices.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellFloatingButtons.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellMessageList.svelte', () => ({ default: () => ({}) }))
vi.mock('./ActionSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./CustomizeButtonsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ThisChatSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ChatDeleteConfirm.svelte', () => ({ default: () => ({}) }))
vi.mock('./TogglesPanel.svelte', () => ({ default: () => ({}), toggleSummary: () => ({ n: 0, on: 0 }) }))
vi.mock('./SendFailureCard.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/chatShell/sendFailure.svelte', () => ({ failureOf: () => null, retrySendFailure: vi.fn() }))
vi.mock('../Setting/settingsRoute', () => ({ openSettingsForFix: vi.fn() }))
vi.mock('../../ts/process/composerActions.svelte', () => ({ isComposerBusy: () => false, branchAt: vi.fn() }))

const ONE = { id: 'chat-1', name: 'First', message: [] as unknown[] }
const TWO = { id: 'chat-2', name: 'Second', message: [] as unknown[] }

function character(chatPage: number) {
    return { chaId: 'a', type: 'character', name: 'Seraphina', chatPage, chats: [{ ...ONE }, { ...TWO }] }
}

async function settle(): Promise<void> {
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
}

async function mountShell() {
    const { default: ChatShell } = await import('./ChatShell.svelte')
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ChatShell, { target })
    await settle()
    return { target, app }
}

// Svelte assigns inert as a DOM property, which jsdom does not reflect to an attribute; a browser does either way.
function isInert(element: Element | null): boolean {
    return !!element && ((element as HTMLElement & { inert?: boolean }).inert === true || element.hasAttribute('inert'))
}

function show(index: number): void {
    state.db.characters[0].chatPage = index
    flushSync()
}

beforeEach(() => {
    document.title = 'RisuAI'
    captured.header = null
    state.db = { characters: [character(1)] }
    selection.selId = 0
    pending.phase = 'idle'
    pending.target = null
    pending.reason = null
    retrySwitch.mockClear()
    backToPrevious.mockClear()
})

afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
})

describe('shell title, header line and announcement', () => {
    // TE1: the header receives the chat shown as its second line.
    test('the header gets the shown chat name and follows a chat switch', async () => {
        const { app } = await mountShell()
        expect(captured.header?.name).toBe('Seraphina')
        expect(captured.header?.chatName).toBe('Second')
        show(0)
        expect(captured.header?.chatName).toBe('First')
        await unmount(app)
    })

    // TE2: the document title carries the chat name and the base title returns when the shell goes.
    test('the document title is the chat name before the base title, restored at destroy', async () => {
        const { app } = await mountShell()
        expect(document.title).toBe('Second · RisuAI')
        show(0)
        expect(document.title).toBe('First · RisuAI')
        await unmount(app)
        expect(document.title).toBe('RisuAI')
    })

    // TE3: a polite announcement on a shown-chat change after mount, never on mount.
    test('the announcement is polite, empty on mount and set when the shown chat changes', async () => {
        const { target, app } = await mountShell()
        const region = target.querySelector('[data-part="chat-announcer"]')
        expect(region).not.toBeNull()
        expect(region?.getAttribute('aria-live')).toBe('polite')
        expect(region?.textContent).toBe('')
        show(0)
        expect(region?.textContent).toBe('Opened First')
        await unmount(app)
    })

    test('deleting another chat keeps the header line, title and announcement as they were', async () => {
        const { target, app } = await mountShell()
        const region = target.querySelector('[data-part="chat-announcer"]')
        const characters = state.db.characters
        characters[0].chats = [(characters[0].chats as Record<string, unknown>[])[1]]
        characters[0].chatPage = 0
        flushSync()
        expect(captured.header?.chatName).toBe('Second')
        expect(document.title).toBe('Second · RisuAI')
        expect(region?.textContent).toBe('')
        expect(target.querySelector('[data-part="chat-transcript"]')?.hasAttribute('data-fade')).toBe(false)
        await unmount(app)
    })

    test('a shown-chat change starts the fade on the transcript, and the first mount does not', async () => {
        const { target, app } = await mountShell()
        const main = target.querySelector('[data-part="chat-transcript"]')!
        expect(main.hasAttribute('data-fade')).toBe(false)
        show(0)
        const first = main.getAttribute('data-fade')
        expect(first).not.toBeNull()
        show(1)
        expect(main.getAttribute('data-fade')).not.toBe(first)
        await unmount(app)
    })
})

describe('SwitchFrame', () => {
    // TE4: a pending switch names its target, parks the transcript and composer, and shows no skeleton before 300 ms.
    test('a pending switch shows the target name, the named frame and inert hosts; the skeleton waits 300 ms', async () => {
        const { target, app } = await mountShell()
        expect(target.querySelector('[data-part="chat-switch-frame"]')).toBeNull()
        vi.useFakeTimers()
        pending.target = { name: 'Mira' }
        pending.phase = 'loading'
        flushSync()
        const frame = target.querySelector<HTMLElement>('[data-part="chat-switch-frame"]')
        expect(frame).not.toBeNull()
        expect(frame?.getAttribute('tabindex')).toBe('-1')
        expect(frame?.getAttribute('aria-label')).toBe('Loading chat')
        expect(captured.header?.name).toBe('Mira')
        expect(captured.header?.chatName).toBeFalsy()
        expect(isInert(target.querySelector('[data-part="chat-transcript"]'))).toBe(true)
        expect(isInert(target.querySelector('[data-part="chat-composer-host"]'))).toBe(true)
        expect(isInert(target.querySelector('[data-part="chat-header-host"]'))).toBe(false)
        vi.advanceTimersByTime(299)
        flushSync()
        expect(target.querySelector('[data-part="chat-switch-skeleton"]')).toBeNull()
        vi.advanceTimersByTime(1)
        flushSync()
        expect(target.querySelector('[data-part="chat-switch-skeleton"]')).not.toBeNull()
        expect(target.querySelector('[data-part="chat-switch-text"]')?.textContent).toBe('Loading chat')
        pending.phase = 'idle'
        pending.target = null
        flushSync()
        expect(target.querySelector('[data-part="chat-switch-frame"]')).toBeNull()
        expect(isInert(target.querySelector('[data-part="chat-transcript"]'))).toBe(false)
        expect(isInert(target.querySelector('[data-part="chat-composer-host"]'))).toBe(false)
        expect(captured.header?.name).toBe('Seraphina')
        await unmount(app)
    })

    test('a failed switch shows the failure in the frame with Try again and Back, and raises no alert', async () => {
        const { target, app } = await mountShell()
        pending.target = { name: 'Mira' }
        pending.phase = 'failed'
        flushSync()
        const frame = target.querySelector('[data-part="chat-switch-frame"]')!
        expect(frame.querySelector('[data-part="chat-switch-text"]')?.textContent).toBe('This chat could not be loaded.')
        expect(frame.querySelector('[role="alert"], [role="alertdialog"]')).toBeNull()
        expect(isInert(target.querySelector('[data-part="chat-transcript"]'))).toBe(true)
        frame.querySelector<HTMLElement>('[data-part="chat-switch-retry"]')!.click()
        expect(retrySwitch).toHaveBeenCalledTimes(1)
        // The Retry control leaves the page while the retry runs, so the frame itself takes the focus.
        expect(document.activeElement).toBe(frame)
        expect(frame.querySelector('[data-part="chat-switch-retry"]')?.textContent?.trim()).toBe('Try again')
        const backButton = frame.querySelector<HTMLElement>('[data-part="chat-switch-back"]')!
        expect(backButton.textContent?.trim()).toBe('Back to previous chat')
        backButton.click()
        expect(backToPrevious).toHaveBeenCalledTimes(1)
        flushSync()
        expect(target.querySelector('[data-part="chat-switch-frame"]')).toBeNull()
        await unmount(app)
    })

    // TE7: focus follows frame -> Retry -> transcript and never ends on the body.
    test('focus on the frame, then Retry, returns to the transcript when the frame goes', async () => {
        const { target, app } = await mountShell()
        pending.target = { name: 'Mira' }
        pending.phase = 'loading'
        flushSync()
        const frame = target.querySelector<HTMLElement>('[data-part="chat-switch-frame"]')!
        frame.focus()
        expect(document.activeElement).toBe(frame)
        pending.phase = 'failed'
        flushSync()
        const retry = target.querySelector<HTMLElement>('[data-part="chat-switch-retry"]')!
        retry.focus()
        expect(document.activeElement).toBe(retry)
        pending.phase = 'idle'
        pending.target = null
        flushSync()
        await tick()
        await tick()
        expect(document.activeElement).toBe(target.querySelector('[data-part="chat-transcript"]'))
        await unmount(app)
    })

    test('a frame that did not hold focus leaves the focus where it is', async () => {
        const { target, app } = await mountShell()
        const outside = document.createElement('button')
        document.body.appendChild(outside)
        pending.target = { name: 'Mira' }
        pending.phase = 'loading'
        flushSync()
        outside.focus()
        pending.phase = 'idle'
        pending.target = null
        flushSync()
        await tick()
        await tick()
        expect(document.activeElement).toBe(outside)
        await unmount(app)
        target.remove()
    })
})

describe('fade under reduced motion', () => {
    // TE5: the shell starts the fade only when motion is allowed, so a reduced-motion or low-power switch never sets the attribute.
    type Setting = { name: string, on: () => void, off: () => void }
    const mediaReduced = (matches: boolean) => vi.stubGlobal('matchMedia', (query: string) => ({ matches: matches && query.includes('prefers-reduced-motion'), media: query }))
    const settings: Setting[] = [
        { name: 'prefers-reduced-motion', on: () => mediaReduced(true), off: () => mediaReduced(false) },
        { name: 'html.rm', on: () => document.documentElement.classList.add('rm'), off: () => document.documentElement.classList.remove('rm') },
        { name: 'html[data-low-power]', on: () => document.documentElement.setAttribute('data-low-power', ''), off: () => document.documentElement.removeAttribute('data-low-power') },
        { name: 'html.nexus-low-power', on: () => document.documentElement.classList.add('nexus-low-power'), off: () => document.documentElement.classList.remove('nexus-low-power') },
    ]

    test.each(settings)('a shown-chat change under $name does not start the fade, and does once it is off', async ({ on, off }) => {
        const { target, app } = await mountShell()
        const main = target.querySelector('[data-part="chat-transcript"]')!
        on()
        try {
            show(0)
            expect(main.hasAttribute('data-fade')).toBe(false)
            show(1)
            expect(main.hasAttribute('data-fade')).toBe(false)
        } finally {
            off()
            vi.unstubAllGlobals()
        }
        show(0)
        expect(main.hasAttribute('data-fade')).toBe(true)
        await unmount(app)
    })
})
