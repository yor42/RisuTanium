// @vitest-environment jsdom

/**
 * Android Back while the chat shell shows the switch frame: Back cancels a loading or failed
 * switch and the user stays on the previous chat. (R) = regression reproducer (fails on a base
 * without the frame's Back handler: the phase stays pending and the press reaches the quit
 * warning); (G) = guard that may pass before and after. The reproducers import only modules that
 * exist on the pre-fix base.
 *
 * MOCKED: `stores.svelte` (plain writable stores), `alertBack` (the dialog close only clears the
 * alert store), `alert`, `process/index.svelte` and `characters`. The mocked `changeChar` models
 * the producer contract: each call takes the next number and parks; on release a call that is no
 * longer the latest ends `superseded` without selecting, the latest selects its index. The
 * sidebar's own Back hook is a stand-in; the real one is covered on a device. The quit warning is
 * a spy.
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
}

let latest = 0
let parked: Parked[] = []

function character(chaId: string, extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId, name: chaId, chats: [], chatPage: 0, ...extra } as unknown as Entry
}

/** Releases the parked restore the way the producer ends it: superseded when a newer call or a supersede came after it. */
function release(call: Parked, failure?: 'unreadable'): void {
    if (failure) {
        call.settle({ failed: failure })
        return
    }
    if (call.id !== latest) {
        call.settle('superseded')
        return
    }
    selectedCharID.set(call.index)
    call.settle('selected')
}

function mountFrame(): () => void {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(SwitchFrame, { target })
    mounted.push(component)
    flushSync()
    return () => {
        unmount(component)
        mounted.splice(mounted.indexOf(component), 1)
        target.remove()
        flushSync()
    }
}

function frame(): Element | null {
    return document.querySelector('[data-part="chat-switch-frame"]')
}

function startSwitch(): Promise<ChangeCharOutcome> {
    const run = switchCharacter(DBState.db.characters[1])
    flushSync()
    return run
}

function pressBack(): boolean {
    const result = window.__risuTaniumBack?.()
    flushSync()
    return result === true
}

/** Registered like the sidebar hook: closes an open sidebar and declines otherwise. */
function registerSidebarStandIn(): void {
    cleanups.push(
        registerBackHandler(() => {
            if (!get(sideBarStore)) {
                return false
            }
            sideBarStore.set(false)
            return true
        }),
    )
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    showToast.mockReset()
    supersedeMock.mockReset()
    supersedeMock.mockImplementation(() => { latest++ })
    changeCharMock.mockReset()
    latest = 0
    parked = []
    changeCharMock.mockImplementation((index: number) => new Promise<ChangeCharOutcome>((settle) => {
        parked.push({ index, id: ++latest, settle })
    }))
    resetBackHandlersForTests()
    installBackGuard({ showToast })
    DBState.db = { characters: [character('a'), character('b', { coldstorage: 'unit-b' })] } as unknown as Database
    selectedCharID.set(0)
    sideBarStore.set(false)
    clearPending()
})

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    for (const cleanup of cleanups.splice(0)) {
        cleanup()
    }
    clearPending()
    document.body.replaceChildren()
    resetBackHandlersForTests()
    vi.useRealTimers()
})

describe('switch frame Back', () => {
    test('(R) Back during a loading switch cancels it, keeps the previous chat and does not warn', async () => {
        mountFrame()
        const run = startSwitch()
        expect(switchTarget.phase).toBe('loading')
        expect(frame()).not.toBeNull()
        expect(pressBack()).toBe(true)
        expect(switchTarget.phase).toBe('idle')
        expect(frame()).toBeNull()
        expect(get(selectedCharID)).toBe(0)
        expect(showToast).not.toHaveBeenCalled()
        expect(supersedeMock).toHaveBeenCalledTimes(1)
        release(parked[0])
        expect(await run).toBe('superseded')
        expect(get(selectedCharID)).toBe(0)
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test.each(['before', 'after'])('(R) with the sidebar open, the first Back only closes it (sidebar hook registered %s the switch) and the next cancels', async (order) => {
        let run: Promise<ChangeCharOutcome>
        if (order === 'before') {
            registerSidebarStandIn()
            mountFrame()
            run = startSwitch()
        } else {
            run = startSwitch()
            mountFrame()
            registerSidebarStandIn()
        }
        sideBarStore.set(true)
        expect(pressBack()).toBe(true)
        expect(get(sideBarStore)).toBe(false)
        expect(switchTarget.phase).toBe('loading')
        expect(supersedeMock).not.toHaveBeenCalled()
        expect(showToast).not.toHaveBeenCalled()
        expect(pressBack()).toBe(true)
        expect(switchTarget.phase).toBe('idle')
        expect(frame()).toBeNull()
        expect(get(selectedCharID)).toBe(0)
        expect(showToast).not.toHaveBeenCalled()
        release(parked[0])
        expect(await run).toBe('superseded')
        expect(get(selectedCharID)).toBe(0)
    })

    test('(R) a sheet opened during loading takes the first Back; the next cancels', async () => {
        mountFrame()
        const run = startSwitch()
        const sheet = { open: true }
        cleanups.push(
            registerBackHandler(backCloseHandler({
                isOpen: () => sheet.open,
                snapshot: () => sheet.open,
                close: () => { sheet.open = false },
            })),
        )
        expect(pressBack()).toBe(true)
        expect(sheet.open).toBe(false)
        expect(switchTarget.phase).toBe('loading')
        expect(pressBack()).toBe(true)
        expect(switchTarget.phase).toBe('idle')
        expect(showToast).not.toHaveBeenCalled()
        release(parked[0])
        expect(await run).toBe('superseded')
        expect(get(selectedCharID)).toBe(0)
    })

    test('(R) an overlay registered while idle sits below the Back handler of a switch started later', async () => {
        mountFrame()
        const overlay = vi.fn(() => true)
        cleanups.push(registerBackHandler(overlay))
        const run = startSwitch()
        expect(switchTarget.phase).toBe('loading')
        expect(pressBack()).toBe(true)
        expect(switchTarget.phase).toBe('idle')
        expect(get(selectedCharID)).toBe(0)
        expect(overlay).not.toHaveBeenCalled()
        expect(supersedeMock).toHaveBeenCalledTimes(1)
        expect(pressBack()).toBe(true)
        expect(overlay).toHaveBeenCalledTimes(1)
        expect(showToast).not.toHaveBeenCalled()
        release(parked[0])
        expect(await run).toBe('superseded')
        expect(get(selectedCharID)).toBe(0)
    })

    test('(R) Back on a failed frame acts like Back to previous', async () => {
        mountFrame()
        const run = startSwitch()
        release(parked[0], 'unreadable')
        await run
        flushSync()
        expect(switchTarget.phase).toBe('failed')
        expect(pressBack()).toBe(true)
        expect(switchTarget.phase).toBe('idle')
        expect(frame()).toBeNull()
        expect(get(selectedCharID)).toBe(0)
        expect(showToast).not.toHaveBeenCalled()
    })

    test('(G) a sheet opened during loading still takes Back first after the switch fails', async () => {
        mountFrame()
        const run = startSwitch()
        const sheet = { open: true }
        cleanups.push(
            registerBackHandler(backCloseHandler({
                isOpen: () => sheet.open,
                snapshot: () => sheet.open,
                close: () => { sheet.open = false },
            })),
        )
        release(parked[0], 'unreadable')
        await run
        flushSync()
        expect(pressBack()).toBe(true)
        expect(sheet.open).toBe(false)
        expect(switchTarget.phase).toBe('failed')
    })

    test('(G) with no switch pending Back reaches the quit warning and no restore is superseded', () => {
        mountFrame()
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
        expect(supersedeMock).not.toHaveBeenCalled()
    })

    test('(G) after the frame unmounts during loading Back no longer cancels', () => {
        const unmountFrame = mountFrame()
        void startSwitch()
        unmountFrame()
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
        expect(switchTarget.phase).toBe('loading')
    })
})
