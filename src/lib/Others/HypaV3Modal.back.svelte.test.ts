// @vitest-environment happy-dom

/**
 * Android Back on the HypaV3 modal does what the modal's X does, and with the category manager or
 * the tag manager open on top it first closes that inner modal, as the inner modal's own close
 * does. (R) = regression reproducer: fails on a base without the Back handlers (the surface stays
 * open and the quit warning shows); (G) = guard that may pass before and after. The reproducers
 * import only modules that exist on the pre-fix base.
 *
 * Mounts the REAL modal with its real header, summary items and both manager modals over a
 * `$state` database. MOCKED: the alert module, the summarizer, the translator, the script engine,
 * the save marks, `stores.svelte` and `alertBack`. The quit warning is a spy.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'

//#region module mocks

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: async () => true,
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' || typeof k === 'symbol' ? undefined : vi.fn(async () => {})),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        hypaV3ModalOpen: writable(true),
        settingsOpen: writable(false),
        SettingsMenuIndex: writable(0),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    summarize: vi.fn(async () => ''),
    getCurrentHypaV3Preset: vi.fn(() => ({ settings: { processRegexScript: false } })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/translator/translator'), () => ({
    translateHTML: vi.fn(async (text: string) => text),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/scripts'), () => ({
    processScriptFull: vi.fn(),
    risuChatParser: vi.fn((text: string) => text),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))

//#endregion

import { DBState, hypaV3ModalOpen, selectedCharID } from 'src/ts/stores.svelte'
import { installBackGuard, registerBackHandler, resetBackHandlersForTests } from 'src/ts/backHandlers'
import HypaV3Modal from './HypaV3Modal.svelte'

const showToast = vi.fn()
const mounted: Array<ReturnType<typeof mount>> = []
const cleanups: Array<() => void> = []

function installDb(): void {
    DBState.db = {
        characters: [{
            chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, firstMessage: '',
            chats: [{
                id: 'chat', name: '', message: [], note: '', localLore: [],
                hypaV3Data: {
                    summaries: [{ text: 'first', chatMemos: ['m'], isImportant: false }],
                    categories: [{ id: '', name: 'none' }],
                    lastSelectedSummaries: [],
                },
            }],
        }],
    } as unknown as Database
    selectedCharID.set(0)
}

function mountModal(): { target: HTMLElement; destroy: () => void } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(HypaV3Modal, { target, props: {} })
    mounted.push(component)
    flushSync()
    return {
        target,
        destroy: () => {
            unmount(component)
            mounted.splice(mounted.indexOf(component), 1)
            target.remove()
        },
    }
}

async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(20)
    flushSync()
}

function pressBack(): boolean {
    const result = window.__risuTaniumBack?.()
    flushSync()
    return result === true
}

/** The modal header's own buttons are, in order: search, important filter, bulk edit, categories, settings, close. */
function headerButtons(target: HTMLElement): HTMLButtonElement[] {
    const bar = target.querySelector('h1')!.nextElementSibling as HTMLElement
    return Array.from(bar.querySelectorAll(':scope > button')) as HTMLButtonElement[]
}

function openCategoryManager(target: HTMLElement): void {
    headerButtons(target)[3].click()
    flushSync()
}

function openTagManager(target: HTMLElement): void {
    const button = target.querySelector(`button[title="${language.hypaV3Modal.tagManager}"]`) as HTMLButtonElement
    button.click()
    flushSync()
}

/** Each manager renders a fixed full-screen backdrop only while open. */
function openBackdrops(): number {
    return document.querySelectorAll('div.fixed.inset-0.z-50').length
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    showToast.mockReset()
    resetBackHandlersForTests()
    installBackGuard({ showToast })
    hypaV3ModalOpen.set(true)
    installDb()
})

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    for (const cleanup of cleanups.splice(0)) {
        cleanup()
    }
    document.body.replaceChildren()
    resetBackHandlersForTests()
    vi.useRealTimers()
})

describe('HypaV3 modal Back', () => {
    test('(R) Back closes the modal, then the root warns', async () => {
        mountModal()
        await settle()
        expect(pressBack()).toBe(true)
        expect(get(hypaV3ModalOpen)).toBe(false)
        expect(showToast).not.toHaveBeenCalled()
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('(G) Back leaves the store as the header X does', async () => {
        const first = mountModal()
        await settle()
        headerButtons(first.target)[5].click()
        flushSync()
        expect(get(hypaV3ModalOpen)).toBe(false)
        first.destroy()
        hypaV3ModalOpen.set(true)
        mountModal()
        await settle()
        pressBack()
        expect(get(hypaV3ModalOpen)).toBe(false)
    })

    test('(R) the category manager closes first, then the modal', async () => {
        const { target } = mountModal()
        await settle()
        openCategoryManager(target)
        expect(openBackdrops()).toBe(1)
        expect(pressBack()).toBe(true)
        expect(openBackdrops()).toBe(0)
        expect(get(hypaV3ModalOpen)).toBe(true)
        expect(showToast).not.toHaveBeenCalled()
        expect(pressBack()).toBe(true)
        expect(get(hypaV3ModalOpen)).toBe(false)
        expect(showToast).not.toHaveBeenCalled()
    })

    test('(R) the tag manager closes first, then the modal', async () => {
        const { target } = mountModal()
        await settle()
        openTagManager(target)
        expect(openBackdrops()).toBe(1)
        expect(pressBack()).toBe(true)
        expect(openBackdrops()).toBe(0)
        expect(get(hypaV3ModalOpen)).toBe(true)
        expect(showToast).not.toHaveBeenCalled()
        expect(pressBack()).toBe(true)
        expect(get(hypaV3ModalOpen)).toBe(false)
        expect(showToast).not.toHaveBeenCalled()
    })

    test.each([
        ['category manager', openCategoryManager],
        ['tag manager', openTagManager],
    ])('(R) a %s opened after another surface answers Back before that surface', async (_name, open) => {
        const { target } = mountModal()
        await settle()
        const other = { open: true }
        cleanups.push(registerBackHandler(() => {
            if (!other.open) {
                return false
            }
            other.open = false
            return true
        }))
        open(target)
        expect(openBackdrops()).toBe(1)
        expect(pressBack()).toBe(true)
        expect(openBackdrops()).toBe(0)
        expect(other.open).toBe(true)
        expect(showToast).not.toHaveBeenCalled()
    })

    test('(G) with both managers closed the first Back closes the modal and the inner modals add no press', async () => {
        const { target } = mountModal()
        await settle()
        expect(openBackdrops()).toBe(0)
        expect(pressBack()).toBe(true)
        expect(get(hypaV3ModalOpen)).toBe(false)
        expect(target.isConnected).toBe(true)
        expect(showToast).not.toHaveBeenCalled()
    })

    test('(G) an unmounted modal leaves no handler behind, closed managers included', async () => {
        const { destroy } = mountModal()
        await settle()
        destroy()
        expect(pressBack()).toBe(true)
        expect(get(hypaV3ModalOpen)).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('(G) a manager that was opened and closed stops answering Back', async () => {
        const { target } = mountModal()
        await settle()
        openCategoryManager(target)
        expect(pressBack()).toBe(true)
        expect(openBackdrops()).toBe(0)
        expect(pressBack()).toBe(true)
        expect(get(hypaV3ModalOpen)).toBe(false)
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })
})
