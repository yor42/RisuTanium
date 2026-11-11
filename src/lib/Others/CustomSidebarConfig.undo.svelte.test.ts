// @vitest-environment jsdom

/**
 * Deleting a row in the custom sidebar dialog offers Undo on the app-wide toast stack. The toast outlives
 * the dialog, Undo restores the row at its index with the same fields, and a row whose id is back makes Undo
 * refuse. The legacy Settings opener reaches the same dialog.
 *
 * Mounts the REAL dialog, the REAL toast stack and the REAL singleton host (fake timers, reset after each
 * test) over a `$state` stand-in for `DBState`. The rows are created through the dialog's own Add Item
 * buttons, as the producer does. MOCKED: `getFullSettingsData` (empty) and the settings data files
 * `utils` imports to build the full list (emptied).
 */
import { flushSync, mount, unmount } from 'svelte'
import { tickFake } from '../../ts/tests/svelteTick.test-helpers'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { SettingItem } from 'src/ts/setting/types'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const dialog = $state({ open: true })
    return {
        DBState: state,
        customSideBarConfigDialogStore: dialog,
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/setting/accessibilitySettingsData'), () => ({
    accessibilitySettingsItems: [],
}) as unknown as typeof import('src/ts/setting/accessibilitySettingsData'))
vi.mock(import('src/ts/setting/advancedSettingsData'), () => ({
    advancedSettingsItems: [],
}) as unknown as typeof import('src/ts/setting/advancedSettingsData'))
vi.mock(import('src/ts/setting/botSettingsParamsData'), () => ({
    basicParameterItems: [],
    modelSpecificParameterItems: [],
    penaltyParameterItems: [],
    samplingParameterItems: [],
    seedSetting: [],
}) as unknown as typeof import('src/ts/setting/botSettingsParamsData'))
vi.mock(import('src/ts/setting/chatFormatSettingsData'), () => ({
    chatFormatSettingsItems: [],
}) as unknown as typeof import('src/ts/setting/chatFormatSettingsData'))
vi.mock(import('src/ts/setting/displaySettingsData.svelte'), () => ({
    displaySettingsItems: [],
}) as unknown as typeof import('src/ts/setting/displaySettingsData.svelte'))
vi.mock(import('src/ts/setting/utils'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getFullSettingsData: () => [] as SettingItem[],
    }
})

import { customSideBarConfigDialogStore, DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import { resetToastHostForTests, toastHost } from 'src/ts/toast/toastHost.svelte'
import ToastHostView from 'src/lib/Nexus/pattern/ToastHost.svelte'
import CustomSidebarConfigButton from 'src/lib/Setting/Pages/Advanced/CustomSidebarConfigButton.svelte'
import CustomSidebarConfig from './CustomSidebarConfig.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []
let dialogApp: Record<string, unknown> | null = null

function mountInto(component: Parameters<typeof mount>[0], props: Record<string, unknown> = {}): { target: HTMLElement, app: Record<string, unknown> } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(component, { target, props }) as unknown as Record<string, unknown>
    const entry = { target, app }
    mounted.push(entry)
    flushSync()
    return entry
}

function buttonWithText(root: ParentNode, text: string): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)
    if (!found) throw new Error('no button with text: ' + text)
    return found
}

function click(button: HTMLElement): void {
    button.click()
    flushSync()
}

async function settle(): Promise<void> {
    await tickFake()
    await Promise.resolve()
    flushSync()
}

function addThroughDialog(dialog: HTMLElement, kindText: string): void {
    click(buttonWithText(dialog, language.othersUi.addItem))
    click(buttonWithText(dialog, kindText))
}

function deleteButtons(root: ParentNode): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll('button')).filter((b) => b.textContent?.trim() === language.uiCommon.delete)
}

function toastAction(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>('[data-part="toast-action"]')
}

function toastTexts(): string[] {
    return Array.from(document.querySelectorAll('[data-part="toast-text"]')).map((n) => n.textContent ?? '')
}

function ids(): string[] {
    return DBState.db.customSidebarItems.map((item) => item.id)
}

beforeEach(() => {
    vi.useFakeTimers()
    resetToastHostForTests()
    DBState.db = { customSidebarItems: [] } as unknown as Database
    customSideBarConfigDialogStore.open = true
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    dialogApp = null
    resetToastHostForTests()
    vi.useRealTimers()
})

function mountDialogAndStack(): HTMLElement {
    mountInto(ToastHostView)
    const dialog = mountInto(CustomSidebarConfig)
    dialogApp = dialog.app
    return dialog.target
}

describe('deleting a custom sidebar row', () => {
    test('regression reproducer: Delete offers Undo and Undo restores the row at its index with its fields', async () => {
        const dialog = mountDialogAndStack()
        addThroughDialog(dialog, language.model)
        addThroughDialog(dialog, language.presets)
        addThroughDialog(dialog, language.loadouts)
        const before = DBState.db.customSidebarItems.map((item) => ({ ...item }))
        expect(before).toHaveLength(3)

        click(deleteButtons(dialog)[1])
        await settle()

        expect(ids()).toEqual([before[0].id, before[2].id])
        expect(toastAction()).not.toBeNull()
        expect(toastAction()?.textContent?.trim()).toBe(language.uiCommon.undo)
        expect(toastTexts()).toContain(fillLang(language.othersUi.sidebarItemRemoved, { name: before[1].label }))

        const afterRemoval = DBState.db.customSidebarItems
        click(toastAction()!)
        await vi.advanceTimersByTimeAsync(0)
        flushSync()

        expect(DBState.db.customSidebarItems.map((item) => ({ ...item }))).toEqual(before)
        expect(DBState.db.customSidebarItems).not.toBe(afterRemoval)
        expect(toastTexts()).toContain(fillLang(language.othersUi.sidebarItemRestored, { name: before[1].label }))
    })

    test('the toast and its Undo survive the dialog closing and unmounting', async () => {
        const dialog = mountDialogAndStack()
        addThroughDialog(dialog, language.model)
        addThroughDialog(dialog, language.presets)
        const second = { ...DBState.db.customSidebarItems[1] }

        click(deleteButtons(dialog)[1])
        await settle()
        customSideBarConfigDialogStore.open = false
        await unmount(dialogApp as never)
        mounted = mounted.filter((m) => m.app !== dialogApp)
        dialog.remove()
        flushSync()

        expect(toastHost.visible).toHaveLength(1)
        expect(toastAction()).not.toBeNull()

        click(toastAction()!)
        await vi.advanceTimersByTimeAsync(0)
        flushSync()

        expect(DBState.db.customSidebarItems[1]).toEqual(second)
    })

    test('Undo refuses and changes nothing when an item with the same id is back', async () => {
        const dialog = mountDialogAndStack()
        addThroughDialog(dialog, language.model)
        addThroughDialog(dialog, language.presets)
        const second = { ...DBState.db.customSidebarItems[1] }

        click(deleteButtons(dialog)[1])
        await settle()
        DBState.db.customSidebarItems.push({ id: second.id, type: second.type, subType: second.subType, label: second.label })
        const before = DBState.db.customSidebarItems

        click(toastAction()!)
        await vi.advanceTimersByTimeAsync(0)
        flushSync()

        expect(toastTexts()).toContain(fillLang(language.othersUi.sidebarItemUndoRefused, { name: second.label }))
        expect(DBState.db.customSidebarItems).toBe(before)
        expect(ids().filter((id) => id === second.id)).toHaveLength(1)
        expect(toastAction()).toBeNull()
    })
})

describe('opening the dialog from legacy Settings', () => {
    test('the shared opener button sets the one dialog store open', () => {
        customSideBarConfigDialogStore.open = false
        const opener = mountInto(CustomSidebarConfigButton)

        click(buttonWithText(opener.target, language.customSidebarConfig))

        expect(customSideBarConfigDialogStore.open).toBe(true)
    })
})
