// @vitest-environment jsdom
/**
 * The failed-send card (U3). The component is new, so before the fix each case fails on the missing module
 * (diagnostic, mutant-backed): a second alert node, a Fix button without a fix, a dead Try again, no focus after
 * Settings closes. MOCKED: nothing but the stores that `settingsRoute` imports.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock(import('src/ts/stores.svelte'), () => ({
    SettingsMenuIndex: writable(-1),
    settingsOpen: writable(false),
}) as unknown as typeof import('src/ts/stores.svelte'))

import SendFailureCard from './SendFailureCard.svelte'
import { fixPending, resetSettingsRouteForTests } from 'src/lib/Setting/settingsRoute'
import { language } from 'src/lang'

type Failure = { reason: 'key' | 'model', fix: 'botSettings' | null, provider?: string, action: 'send' | 'continue' | 'regenerate' }

let target: HTMLElement
let app: ReturnType<typeof mount> | null = null
let props: { failure: Failure, onfix: () => void, onretry: () => void }

function render(failure: Failure, handlers: { onfix?: () => void, onretry?: () => void } = {}): void {
    target = document.createElement('div')
    document.body.appendChild(target)
    const live = $state({ failure, onfix: handlers.onfix ?? (() => {}), onretry: handlers.onretry ?? (() => {}) })
    props = live
    app = mount(SendFailureCard, { target, props })
    flushSync()
}

beforeEach(() => {
    resetSettingsRouteForTests()
})

afterEach(async () => {
    if (app) await unmount(app)
    app = null
    target?.remove()
})

describe('U3 the failed-send card', () => {
    test('it is one critical alert with the reason, the detail and both actions in critical parts', () => {
        render({ reason: 'key', fix: 'botSettings', provider: 'Anthropic', action: 'send' })

        const card = target.querySelector('[data-part="chat-failed-card"]')!
        expect(card).not.toBeNull()
        expect(card.getAttribute('role')).toBe('alert')
        expect(target.querySelectorAll('[role="alert"]')).toHaveLength(1)
        expect(card.hasAttribute('data-part-critical')).toBe(true)
        expect(card.textContent).toContain(language.chatShellFailedReply)
        expect(card.textContent).toContain(language.chatShellFailReasonKey)
        const bodies = [...card.querySelectorAll('[data-part="chat-critical-body"]')].map((body) => body.textContent)
        expect(bodies).toHaveLength(2)
        expect(bodies[1]).toContain(language.chatShellFailDetail('Anthropic'))
        const actions = [...card.querySelectorAll('[data-part="chat-critical-action"]')]
        expect(actions.map((action) => action.textContent?.trim())).toEqual([language.chatShellFailFix, language.chatShellFailRetry])
    })

    test('a reason change updates the text in place and keeps the one alert node', () => {
        render({ reason: 'key', fix: 'botSettings', provider: 'Anthropic', action: 'send' })
        const node = target.querySelector('[data-part="chat-failed-card"]')

        props.failure = { reason: 'model', fix: 'botSettings', action: 'send' }
        flushSync()

        expect(target.querySelectorAll('[role="alert"]')).toHaveLength(1)
        expect(target.querySelector('[data-part="chat-failed-card"]')).toBe(node)
        expect(node!.textContent).toContain(language.chatShellFailReasonModel)
        expect(node!.textContent).not.toContain(language.chatShellFailReasonKey)
    })

    test('without a fix there is no Fix button and Try again remains', () => {
        render({ reason: 'key', fix: null, action: 'send' })

        const labels = [...target.querySelectorAll('[data-part="chat-critical-action"]')].map((action) => action.textContent?.trim())
        expect(labels).toEqual([language.chatShellFailRetry])
    })

    test('with no provider there is no detail line', () => {
        render({ reason: 'model', fix: 'botSettings', action: 'send' })

        expect(target.querySelectorAll('[data-part="chat-critical-body"]')).toHaveLength(1)
        expect(target.textContent).not.toContain(language.chatShellFailDetail(''))
    })

    test('Fix and Try again call their handlers once each', () => {
        const onfix = vi.fn()
        const onretry = vi.fn()
        render({ reason: 'key', fix: 'botSettings', action: 'send' }, { onfix, onretry })
        const [fix, retry] = [...target.querySelectorAll<HTMLButtonElement>('[data-part="chat-critical-action"]')]

        fix.click()
        expect(onfix).toHaveBeenCalledTimes(1)
        expect(onretry).not.toHaveBeenCalled()
        retry.click()
        expect(onretry).toHaveBeenCalledTimes(1)
    })

    test('focus lands on Try again when Settings closes while the card is shown, once', async () => {
        render({ reason: 'key', fix: 'botSettings', action: 'send' })
        const retry = target.querySelector<HTMLButtonElement>('[data-action="retry"]')!
        expect(document.activeElement).not.toBe(retry)

        fixPending.set(true)
        flushSync()
        await tick()

        expect(document.activeElement).toBe(retry)
        let pending = true
        fixPending.subscribe((value) => { pending = value })()
        expect(pending).toBe(false)
    })

    test('focus lands on Try again when the card mounts after Settings closed', async () => {
        fixPending.set(true)
        render({ reason: 'key', fix: 'botSettings', action: 'send' })
        await tick()

        expect(document.activeElement).toBe(target.querySelector('[data-action="retry"]'))
    })

    test('without a pending return the card does not take focus', async () => {
        render({ reason: 'key', fix: 'botSettings', action: 'send' })
        await tick()

        expect(document.activeElement).toBe(document.body)
    })
})
