// @vitest-environment jsdom

/**
 * Retry on the switch frame of the chat shell when the retried `changeChar` throws. (R) = regression
 * reproducer (fails on a base where Retry of a resident target passes through `idle`: the frame
 * unmounts, loses focus and drops its Back registration, and the throw is left unhandled); (G) = guard.
 *
 * Invariants exercised here:
 * - F1: through a Retry, the same frame element stays connected and focused while the attempt runs
 *   and after it throws; the failed text with Retry and Back is shown again, and focus never falls
 *   back to the transcript.
 * - F2: the frame's Back registration keeps its place in the order through the Retry, so a sheet
 *   registered before the Retry still takes the first Back after the throw, and the next Back
 *   abandons the switch.
 *
 * MOCKED: the module set of `SwitchFrame.back.svelte.test.ts` (same directory), with a parked
 * `changeChar` that can also reject. A refused restore (`release(call, 'unreadable')`) is the
 * producer path that reaches the failed state, and the resident slot copies the placeholder's
 * `chaId`, as `restoreColdCharacter` leaves it. The sidebar's own Back hook is not involved.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeCharOutcome } from '../../ts/characters'
import type { Database } from '../../ts/storage/database.svelte'

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selectedCharID = writable(-1)
    const selIdState = $state({ selId: -1 })
    selectedCharID.subscribe((value) => { selIdState.selId = value })
    return {
        DBState: state,
        selectedCharID,
        selIdState,
        sideBarStore: writable(false),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock('../../ts/alertBack', async () => {
    const { alertStore } = await import('../../ts/stores.svelte')
    return { closeDialogForBack: vi.fn(() => alertStore.set({ type: 'none', msg: '' })) }
})

const changeCharMock = vi.hoisted(() => vi.fn())
const supersedeMock = vi.hoisted(() => vi.fn())

vi.mock(import('../../ts/characters'), () => ({
    changeChar: changeCharMock,
    supersedeChangeChar: supersedeMock,
}) as unknown as typeof import('../../ts/characters'))

vi.mock(import('../../ts/alert'), () => ({
    alertNormal: vi.fn(),
    alertError: vi.fn(),
}) as unknown as typeof import('../../ts/alert'))

vi.mock(import('../../ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('../../ts/process/index.svelte'))

import { DBState, selectedCharID, sideBarStore } from '../../ts/stores.svelte'
import { alertError } from '../../ts/alert'
import { backCloseHandler, installBackGuard, registerBackHandler, resetBackHandlersForTests } from '../../ts/backHandlers'
import { clearPending, switchCharacter, switchTarget } from '../../ts/chatShell/switchTarget.svelte'
import SwitchFrame from './SwitchFrame.svelte'

type Entry = Database['characters'][number]

const showToast = vi.fn()
const mounted: Array<ReturnType<typeof mount>> = []
const cleanups: Array<() => void> = []

interface Parked {
    index: number
    id: number
    settle: (outcome: ChangeCharOutcome) => void
    reject: (error: Error) => void
}

let latest = 0
let parked: Parked[] = []
let transcript: HTMLElement
let unhandled: unknown[] = []
const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }

function character(chaId: string, extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId, name: chaId, chats: [], chatPage: 0, ...extra } as unknown as Entry
}

function mountFrame(): void {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(SwitchFrame, { target, props: { transcript } }))
    flushSync()
}

const frame = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-part="chat-switch-frame"]')
const retryButton = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-part="chat-switch-retry"]')
const backButton = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-part="chat-switch-back"]')

// Node reports an unhandled rejection after the microtask queue drains, so a check needs a macrotask first.
const nextMacrotask = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function flushAll(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        await Promise.resolve()
        flushSync()
    }
    await nextMacrotask()
    flushSync()
}

function pressBack(): boolean {
    const result = window.__risuTaniumBack?.()
    flushSync()
    return result === true
}

/** Starts the cold switch to slot 1, has the restore refused, and leaves the character resident. */
async function reachFailedFrame(): Promise<void> {
    const run = switchCharacter(DBState.db.characters[1])
    flushSync()
    parked[0].settle({ failed: 'unreadable' })
    await run
    flushSync()
    expect(switchTarget.phase).toBe('failed')
    DBState.db.characters[1] = character('b')
}

beforeEach(() => {
    showToast.mockReset()
    supersedeMock.mockReset()
    supersedeMock.mockImplementation(() => { latest++ })
    changeCharMock.mockReset()
    vi.mocked(alertError).mockClear()
    latest = 0
    parked = []
    changeCharMock.mockImplementation((index: number) => new Promise<ChangeCharOutcome>((settle, reject) => {
        parked.push({ index, id: ++latest, settle, reject })
    }))
    resetBackHandlersForTests()
    installBackGuard({ showToast })
    DBState.db = { characters: [character('a'), character('b', { coldstorage: 'unit-b' })] } as unknown as Database
    selectedCharID.set(0)
    sideBarStore.set(false)
    clearPending()
    transcript = document.createElement('div')
    transcript.tabIndex = -1
    document.body.appendChild(transcript)
    vi.spyOn(transcript, 'focus')
    unhandled = []
    process.on('unhandledRejection', onUnhandled)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    for (const cleanup of cleanups.splice(0)) {
        cleanup()
    }
    clearPending()
    document.body.replaceChildren()
    resetBackHandlersForTests()
    vi.restoreAllMocks()
})

describe('switch frame Retry that throws', () => {
    test('F1 (R): the same frame stays connected and focused through the Retry and after its throw', async () => {
        mountFrame()
        await reachFailedFrame()
        const root = frame()!
        expect(root).not.toBeNull()

        retryButton()!.click()
        flushSync()
        expect(frame()).toBe(root)
        expect(root.isConnected).toBe(true)
        expect(document.activeElement).toBe(root)
        expect(switchTarget.phase).toBe('loading')

        parked[1].reject(new Error('boom'))
        await flushAll()

        expect(switchTarget.phase).toBe('failed')
        expect(switchTarget.reason).toBe('unreadable')
        expect(frame()).toBe(root)
        expect(document.activeElement).toBe(root)
        expect(retryButton()).not.toBeNull()
        expect(backButton()).not.toBeNull()
        expect(transcript.focus).not.toHaveBeenCalled()
        expect(alertError).not.toHaveBeenCalled()
        expect(unhandled).toEqual([])
    })

    test('F2 (R): a sheet registered before the Retry still takes the first Back after the throw; the next abandons', async () => {
        mountFrame()
        await reachFailedFrame()
        const sheet = { open: true }
        cleanups.push(
            registerBackHandler(backCloseHandler({
                isOpen: () => sheet.open,
                snapshot: () => sheet.open,
                close: () => { sheet.open = false },
            })),
        )

        retryButton()!.click()
        flushSync()
        parked[1].reject(new Error('boom'))
        await flushAll()
        expect(switchTarget.phase).toBe('failed')

        expect(pressBack()).toBe(true)
        expect(sheet.open).toBe(false)
        expect(switchTarget.phase).toBe('failed')
        expect(supersedeMock).not.toHaveBeenCalled()

        expect(pressBack()).toBe(true)
        expect(switchTarget.phase).toBe('idle')
        expect(supersedeMock).toHaveBeenCalledTimes(1)
        expect(frame()).toBeNull()
        expect(get(selectedCharID)).toBe(0)
        expect(showToast).not.toHaveBeenCalled()
        expect(unhandled).toEqual([])
    })
})
