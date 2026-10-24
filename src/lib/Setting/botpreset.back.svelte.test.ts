// @vitest-environment happy-dom

/**
 * Android Back on the preset list does what the header X does, and with the prompt diff modal
 * open on top it first does what the diff modal's own X does (including saving its preferences).
 * (R) = regression reproducer: fails on a base without the Back handlers (the surface stays open
 * and the quit warning shows); (G) = guard that may pass before and after. The reproducers import
 * only modules that exist on the pre-fix base.
 *
 * Mounts the REAL preset list and the REAL diff modal over a `$state` database. MOCKED: the
 * database module (its functions are spies and `getDatabase` returns the test database), `alert`,
 * `characterCards`, the prebuilt templates, `stores.svelte` and `alertBack`. The quit warning is
 * a spy.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import 'src/ts/polyfill'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        openPresetList: writable(true),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/ts/storage/database.svelte', async () => {
    const { DBState } = await import('src/ts/stores.svelte')
    return {
        getDatabase: vi.fn(() => DBState.db),
        changeToPreset: vi.fn(),
        copyPreset: vi.fn(),
        downloadPreset: vi.fn(),
        importPreset: vi.fn(),
    }
})

vi.mock('src/ts/alert', () => ({
    alertCardExport: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
}))
vi.mock('src/ts/characterCards', () => ({ openRealmUpload: vi.fn() }))
vi.mock('src/ts/process/templates/templates', () => ({ prebuiltPresets: {} }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))

//#endregion

import { DBState, openPresetList } from 'src/ts/stores.svelte'
import { installBackGuard, resetBackHandlersForTests } from 'src/ts/backHandlers'
import BotPreset from './botpreset.svelte'

const showToast = vi.fn()
const mounted: Array<ReturnType<typeof mount>> = []

const bodyLines = (changed: string) =>
    Array.from({ length: 30 }, (_, i) => (i === 15 ? changed : `line ${i}`)).join('\n')

function plain(name: string, text: string) {
    return { type: 'plain', type2: 'normal', role: 'system', text, name }
}

function mountList(): { target: HTMLElement; destroy: () => void } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(BotPreset, { target, props: { close: () => openPresetList.set(false) } })
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

function pressBack(): boolean {
    const result = window.__risuTaniumBack?.()
    flushSync()
    return result === true
}

function headerClose(target: HTMLElement): HTMLButtonElement {
    return target.querySelector('div.grow.flex.justify-end > button') as HTMLButtonElement
}

/** Picks two presets for comparison, which mounts the diff modal. */
function openDiff(target: HTMLElement): void {
    const compare = Array.from(target.querySelectorAll('div[role="button"]'))
        .filter((el) => el.className.includes('cursor-pointer') && el.querySelector('svg'))
        .filter((_el, index) => index % 4 === 0)
    ;(compare[0] as HTMLElement).click()
    flushSync()
    ;(compare[1] as HTMLElement).click()
    flushSync()
}

function diffRoot(target: HTMLElement): HTMLElement | null {
    return (target.children[1] as HTMLElement | undefined) ?? null
}

function diffClose(target: HTMLElement): HTMLButtonElement {
    const root = diffRoot(target)
    const buttons = Array.from(root?.querySelectorAll('button.text-textcolor2') ?? [])
    return buttons[buttons.length - 1] as HTMLButtonElement
}

async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(20)
        flushSync()
    }
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    showToast.mockReset()
    resetBackHandlersForTests()
    installBackGuard({ showToast })
    openPresetList.set(true)
    DBState.db = {
        botPresets: [
            { name: 'Alpha', promptTemplate: [plain('Main', bodyLines('old'))] },
            { name: 'Beta', promptTemplate: [plain('Main', bodyLines('new'))] },
        ],
        botPresetsId: 0,
        showPromptComparison: true,
    } as unknown as Database
})

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    document.body.replaceChildren()
    resetBackHandlersForTests()
    vi.useRealTimers()
})

describe('preset list Back', () => {
    test('(R) Back closes the list, then the root warns', () => {
        mountList()
        expect(pressBack()).toBe(true)
        expect(get(openPresetList)).toBe(false)
        expect(showToast).not.toHaveBeenCalled()
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('(G) Back leaves the store as the header X does', () => {
        const first = mountList()
        headerClose(first.target).click()
        flushSync()
        expect(get(openPresetList)).toBe(false)
        first.destroy()
        openPresetList.set(true)
        mountList()
        pressBack()
        expect(get(openPresetList)).toBe(false)
    })

    test('(G) an unmounted list stops answering Back', () => {
        const { destroy } = mountList()
        destroy()
        expect(pressBack()).toBe(true)
        expect(get(openPresetList)).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('(R) with the diff modal open Back closes only the diff and saves its preferences, then the list', async () => {
        const { target } = mountList()
        openDiff(target)
        await settle()
        expect(diffRoot(target)).not.toBeNull()
        expect(DBState.db.promptDiffPrefs).toBeUndefined()
        expect(pressBack()).toBe(true)
        await settle()
        expect(DBState.db.promptDiffPrefs).toBeDefined()
        expect(get(openPresetList)).toBe(true)
        expect(diffRoot(target)).toBeNull()
        expect(showToast).not.toHaveBeenCalled()
        expect(pressBack()).toBe(true)
        expect(get(openPresetList)).toBe(false)
        expect(showToast).not.toHaveBeenCalled()
    })

    test('(G) Back from the diff modal leaves the same state as the diff modal X', async () => {
        const first = mountList()
        openDiff(first.target)
        await settle()
        diffClose(first.target).click()
        await settle()
        const afterX = JSON.stringify([DBState.db.promptDiffPrefs, get(openPresetList), diffRoot(first.target) === null])
        expect(diffRoot(first.target)).toBeNull()
        first.destroy()
        DBState.db.promptDiffPrefs = undefined as never
        const second = mountList()
        openDiff(second.target)
        await settle()
        pressBack()
        await settle()
        expect(JSON.stringify([DBState.db.promptDiffPrefs, get(openPresetList), diffRoot(second.target) === null])).toBe(afterX)
    })

    test('(G) after the diff modal closes only the list answers Back', async () => {
        const { target } = mountList()
        openDiff(target)
        await settle()
        pressBack()
        await settle()
        expect(pressBack()).toBe(true)
        expect(get(openPresetList)).toBe(false)
    })
})
