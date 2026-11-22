// @vitest-environment jsdom

/**
 * The tool approval dialog: every string from a tool call renders as text in its own place, never as markup; the three
 * answers write `once`, `always` and `deny`; Back writes deny through the real alert pipeline; a press inside the
 * 400 ms guard is discarded. The long parts show 400 code points until expanded, and the buttons stay outside the
 * scrolling body. Layout rules (50vh, 44 px) are class names jsdom cannot measure, so they are asserted as classes.
 */
import { get, writable } from 'svelte/store'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { alertData, ToolApprovalView } from 'src/ts/alert'

vi.mock(import('src/ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

import { alertToolApproval } from 'src/ts/alert'
import { ANSWER_GUARD_MS, resetAlertPromptsForTests } from 'src/ts/alertPrompts'
import { dispatchBack, resetBackHandlersForTests } from 'src/ts/backHandlers'
import { alertStore } from 'src/ts/stores.svelte'
import ToolApprovalPrompt from '../ToolApprovalPrompt.svelte'

const HOSTILE = '<img src=x onerror="window.__toolXss = true"><script>window.__toolXss = true</script>'

const VIEW: ToolApprovalView = {
    server: 'internal:workspace',
    action: [{ text: 'delete workspace file (' }, { text: 'a.txt', path: true }, { text: '), which cannot be undone' }],
    summary: 'delete_file({"path":"a.txt"})',
    instructionTarget: false,
    offerAlways: true,
    replacement: null,
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountPrompt(view: ToolApprovalView, onanswer: (message: 'once' | 'always' | 'deny') => void = () => { }): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(ToolApprovalPrompt, { target, props: { view, messageId: 'tool-message', onanswer } }))
    flushSync()
    return target
}

function button(target: HTMLElement, label: string): HTMLButtonElement | undefined {
    return [...target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label)
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    resetBackHandlersForTests()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' })
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => { })
    }
    mountedTargets.splice(0).forEach(target => target.remove())
    document.body.replaceChildren()
    delete (window as unknown as Record<string, unknown>).__toolXss
    resetBackHandlersForTests()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' })
    vi.useRealTimers()
})

describe('ToolApprovalPrompt.svelte', () => {
    test('a hostile path, summary and replacement render as text, never as elements', () => {
        const target = mountPrompt({
            ...VIEW,
            server: HOSTILE,
            action: [{ text: 'write workspace file (' }, { text: HOSTILE, path: true }, { text: ')' }],
            summary: `write_file({"path":${JSON.stringify(HOSTILE)}})`,
            replacement: HOSTILE,
        })

        expect(target.querySelector('img')).toBeNull()
        expect(target.querySelector('script')).toBeNull()
        expect((window as unknown as Record<string, unknown>).__toolXss).toBeUndefined()
        expect(target.querySelector('[data-tool-approval-action] bdi')?.textContent).toBe(HOSTILE)
        expect(target.querySelector('[data-tool-approval-replacement]')?.textContent).toBe(HOSTILE)
        expect(target.querySelector('[data-tool-approval-server]')?.textContent).toBe(HOSTILE)
    })

    test('each path of the action line sits in its own isolated run', () => {
        const target = mountPrompt({ ...VIEW, action: [{ text: 'move (' }, { text: 'a‮b', path: true }, { text: ') to (' }, { text: 'c.txt', path: true }, { text: ')' }] })
        expect([...target.querySelectorAll('[data-tool-approval-action] bdi')].map(el => el.textContent)).toEqual(['a‮b', 'c.txt'])
        expect(target.querySelector('[data-tool-approval-action]')?.textContent).toBe('move (a‮b) to (c.txt)')
    })

    test('the three buttons answer once, always and deny', () => {
        const answers: string[] = []
        const target = mountPrompt(VIEW, (message) => answers.push(message))

        button(target, language.toolApprovalAllowOnce)!.click()
        button(target, language.toolApprovalAllowAlways)!.click()
        button(target, language.toolApprovalDeny)!.click()

        expect(answers).toEqual(['once', 'always', 'deny'])
    })

    test('no always button when it is not offered', () => {
        const target = mountPrompt({ ...VIEW, offerAlways: false })
        expect(button(target, language.toolApprovalAllowAlways)).toBeUndefined()
        expect(button(target, language.toolApprovalAllowOnce)).toBeDefined()
        expect(button(target, language.toolApprovalDeny)).toBeDefined()
    })

    test('the server button appears only when offered and answers server', () => {
        const answers: string[] = []
        const offered = mountPrompt({ ...VIEW, offerAlways: false, offerServer: true }, (message) => answers.push(message))
        button(offered, language.toolApprovalAllowServer)!.click()
        expect(answers).toEqual(['server'])
        expect(button(mountPrompt(VIEW), language.toolApprovalAllowServer)).toBeUndefined()
    })

    test('every button is at least 44 px tall and the body scrolls inside half the screen above them', () => {
        const target = mountPrompt(VIEW)
        for (const control of target.querySelectorAll<HTMLButtonElement>('[data-tool-approval-actions] button')) {
            expect(control.className).toContain('min-h-[44px]')
        }
        const body = target.querySelector('[data-tool-approval-body]')!
        expect(body.className).toContain('max-h-[50vh]')
        expect(body.className).toContain('overflow-y-auto')
        expect(body.querySelector('button.pattern-button')).toBeNull()
    })

    test('an instruction file target is labelled, any other is not', () => {
        const marked = mountPrompt({ ...VIEW, instructionTarget: true })
        expect(marked.querySelector('[data-tool-approval-instructions]')?.textContent).toBe(language.toolApprovalInstructionsWarning)
        const plain = mountPrompt(VIEW)
        expect(plain.querySelector('[data-tool-approval-instructions]')).toBeNull()
    })

    test('a long call shows 400 code points until expanded, then all of it, and collapses again', () => {
        const long = `${'😀'.repeat(500)}END`
        const target = mountPrompt({ ...VIEW, summary: long })
        const shown = () => target.querySelector('[data-tool-approval-summary]')!.textContent!

        expect(Array.from(shown())).toHaveLength(403)
        expect(shown().endsWith('...')).toBe(true)
        expect(shown()).not.toContain('END')

        button(target, language.toolApprovalShowMore)!.click()
        flushSync()
        expect(shown()).toBe(long)

        button(target, language.toolApprovalShowLess)!.click()
        flushSync()
        expect(Array.from(shown())).toHaveLength(403)
    })

    test('a short call has no expand control', () => {
        const target = mountPrompt(VIEW)
        expect(target.querySelector('[data-tool-approval-expand]')).toBeNull()
    })

    test('an edit that empties text shows an empty replacement, labelled, and a non-empty one shows its text', () => {
        const empty = mountPrompt({ ...VIEW, replacement: '' })
        expect(empty.querySelector('[data-tool-approval-replacement-empty]')?.textContent).toBe(language.toolApprovalReplacementEmpty)
        expect(empty.querySelector('[data-tool-approval-replacement]')).toBeNull()

        const filled = mountPrompt({ ...VIEW, replacement: 'new words' })
        expect(filled.querySelector('[data-tool-approval-replacement]')?.textContent).toBe('new words')
        expect(filled.querySelector('[data-tool-approval-replacement-empty]')).toBeNull()
    })
})

describe('the prompt through the alert pipeline', () => {
    const shown = (): alertData => get(alertStore)

    test('Back answers deny, even inside the answer guard', async () => {
        const out = alertToolApproval(VIEW)
        let value: string | undefined
        void out.then((answer) => { value = answer })
        expect(shown().type).toBe('toolApproval')

        expect(dispatchBack()).toBe(true)
        await vi.advanceTimersByTimeAsync(0)

        expect(value).toBe('deny')
        expect(shown().type).toBe('none')
    })

    test('a press inside the 400 ms guard is discarded and one after it counts', async () => {
        const out = alertToolApproval(VIEW)
        let value: string | undefined
        void out.then((answer) => { value = answer })

        alertStore.set({ type: 'none', msg: 'once' })
        await vi.advanceTimersByTimeAsync(0)
        expect(value).toBeUndefined()
        expect(shown().type).toBe('toolApproval')

        await vi.advanceTimersByTimeAsync(ANSWER_GUARD_MS + 1)
        alertStore.set({ type: 'none', msg: 'once' })
        await vi.advanceTimersByTimeAsync(0)
        expect(value).toBe('once')
    })

    test('an always answer to a prompt that did not offer it is deny', async () => {
        const out = alertToolApproval({ ...VIEW, offerAlways: false })
        let value: string | undefined
        void out.then((answer) => { value = answer })
        await vi.advanceTimersByTimeAsync(ANSWER_GUARD_MS + 1)
        alertStore.set({ type: 'none', msg: 'always' })
        await vi.advanceTimersByTimeAsync(0)
        expect(value).toBe('deny')
    })

    test('a server answer is server only when the prompt offered it, otherwise deny', async () => {
        for (const [offerServer, expected] of [[true, 'server'], [false, 'deny']] as const) {
            const out = alertToolApproval({ ...VIEW, offerAlways: false, offerServer })
            let value: string | undefined
            void out.then((answer) => { value = answer })
            await vi.advanceTimersByTimeAsync(ANSWER_GUARD_MS + 1)
            alertStore.set({ type: 'none', msg: 'server' })
            await vi.advanceTimersByTimeAsync(0)
            expect(value).toBe(expected)
        }
    })

    test('a stop signal withdraws the prompt with deny', async () => {
        const controller = new AbortController()
        const out = alertToolApproval(VIEW, { signal: controller.signal })
        let value: string | undefined
        void out.then((answer) => { value = answer })
        controller.abort()
        await vi.advanceTimersByTimeAsync(0)
        expect(value).toBe('deny')
    })
})
