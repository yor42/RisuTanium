// @vitest-environment jsdom

/**
 * Reply notice timer and modal-pause integration (#700): stopped off-screen reply notices keep `kind: 'warning'`
 * styling and auto-dismiss after `DEFAULT_TOAST_CONFIG.infoMs` (5 s), pausing while `modalLayerOpen()` is true.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../stores.svelte', () => ({
    DBState: { db: { characters: [], notification: false } },
    selectedCharID: { subscribe: () => () => {} },
    DynamicGUI: { subscribe: () => () => {} },
    ShowRealmFrameStore: { subscribe: () => () => {} },
    sideBarStore: { subscribe: () => () => {} },
}))

vi.mock('../../storage/tauriByteTransport', () => ({
    isAndroidTransport: () => false,
}))

vi.mock('../../alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../alertBack', () => ({ closeDialogForBack: () => {} }))
vi.mock('../../caughtErrors', () => ({ recordCaughtError: vi.fn() }))

import ToastHostView from '../../../lib/Nexus/pattern/ToastHost.svelte'
import { holdModalLayer, modalLayerCount } from '../../../lib/Nexus/pattern/modalLayers.svelte'
import type { Database } from '../../storage/database.svelte'
import { DBState } from '../../stores.svelte'
import { DEFAULT_TOAST_CONFIG, resetToastHostForTests, toastHost } from '../../toast/toastHost.svelte'
import { announceReply } from '../replyNotice'

let mounted: Array<ReturnType<typeof mount>> = []
let targets: HTMLElement[] = []

function installCharacter(): void {
    DBState.db = {
        notification: false,
        characters: [
            {
                chaId: 'char-1',
                name: 'Ada',
                image: '',
                type: 'character',
                chatPage: 0,
                chats: [{ id: 'chat-1', name: 'Evening chat', message: [], note: '', localLore: [] }],
            },
        ],
    } as unknown as Database
}

beforeEach(() => {
    vi.useFakeTimers()
    resetToastHostForTests()
    installCharacter()
})

afterEach(async () => {
    for (const app of mounted.reverse()) {
        await unmount(app)
    }
    mounted = []
    for (const target of targets.splice(0)) {
        target.remove()
    }
    resetToastHostForTests()
    vi.useRealTimers()
    expect(modalLayerCount()).toBe(0)
})

describe('stopped reply notice auto-dismiss (#700)', () => {
    test('regression reproducer: stopped reply notice posts kind warning and auto-dismisses after DEFAULT_TOAST_CONFIG.infoMs (5000 ms)', () => {
        announceReply({ origin: { chaId: 'char-1', chatId: 'chat-1' }, outcome: 'stopped', dialogRaised: false }, undefined)

        expect(toastHost.visible).toHaveLength(1)
        expect(toastHost.visible[0]).toMatchObject({
            kind: 'warning',
            text: "Ada's reply was stopped",
            sub: 'Evening chat',
        })

        vi.advanceTimersByTime(DEFAULT_TOAST_CONFIG.infoMs - 1)
        expect(toastHost.visible).toHaveLength(1)

        vi.advanceTimersByTime(1)
        expect(toastHost.visible).toHaveLength(0)
    })

    test('regression reproducer: stopped reply notice pauses while modalLayerOpen is true and expires 5000 ms after the modal closes', () => {
        const target = document.createElement('div')
        document.body.appendChild(target)
        targets.push(target)
        mounted.push(mount(ToastHostView, { target }))
        flushSync()

        const release = holdModalLayer()
        try {
            flushSync()

            announceReply({ origin: { chaId: 'char-1', chatId: 'chat-1' }, outcome: 'stopped', dialogRaised: false }, undefined)
            flushSync()

            const root = document.querySelector<HTMLElement>('[data-part="toast-host"]')!
            expect(root.hasAttribute('data-paused')).toBe(true)
            expect((root as HTMLElement & { inert?: boolean }).inert === true || root.hasAttribute('inert')).toBe(true)
            expect(toastHost.visible).toHaveLength(1)

            vi.advanceTimersByTime(60_000)
            expect(toastHost.visible).toHaveLength(1)
        } finally {
            release()
            flushSync()
        }

        const root = document.querySelector<HTMLElement>('[data-part="toast-host"]')!
        expect(root.hasAttribute('data-paused')).toBe(false)
        expect((root as HTMLElement & { inert?: boolean }).inert === true || root.hasAttribute('inert')).toBe(false)

        vi.advanceTimersByTime(DEFAULT_TOAST_CONFIG.infoMs - 1)
        expect(toastHost.visible).toHaveLength(1)

        vi.advanceTimersByTime(1)
        expect(toastHost.visible).toHaveLength(0)
    })

    test('guard: failed reply notice without dialog stays sticky kind error and finished reply notice auto-dismisses as kind info after 5000 ms', () => {
        announceReply({ origin: { chaId: 'char-1', chatId: 'chat-1' }, outcome: 'failed', dialogRaised: false }, undefined)
        announceReply({ origin: { chaId: 'char-1', chatId: 'chat-1' }, outcome: 'reply', dialogRaised: false }, undefined)

        expect(toastHost.visible.map((t) => [t.kind, t.text])).toEqual([
            ['error', "Ada's reply failed"],
            ['info', 'Ada replied'],
        ])

        vi.advanceTimersByTime(DEFAULT_TOAST_CONFIG.infoMs)
        expect(toastHost.visible.map((t) => [t.kind, t.text])).toEqual([
            ['error', "Ada's reply failed"],
        ])

        vi.advanceTimersByTime(60_000)
        expect(toastHost.visible).toHaveLength(1)
    })
})
