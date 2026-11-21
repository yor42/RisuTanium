// @vitest-environment jsdom

/**
 * The Data page at Settings index 0, with the real SettingsShellPage, DataShellPage, rows, sheet host, chooser,
 * PatternDialog, controller and backup flow: the three sections and their rows; the chooser (format, scope, the
 * partial hint, Cancel, Escape and Back); what each choice calls; the single-flight rule of the action rows; and a
 * chooser that is open when the page goes away resolving to nothing; and the `.bin` leave-out sheet (what it shows
 * without a tap, its three answers, an unanswered question and the line that repeats what the last `.bin` left out).
 * Regression reproducers against the unchanged shell, where index 0 renders the legacy screen.
 *
 * MOCKED: `stores.svelte` (a `$state` DBState and plain writable stores), `alertBack`, the legacy Settings pages
 * (empty stubs), and the engines the rows load on demand: backup, `.rtb` entry, restore and dataset export.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

const engines = vi.hoisted(() => ({
    saveBin: vi.fn(),
    savePartial: vi.fn(),
    startRtb: vi.fn(),
    startSettingsRtb: vi.fn(),
    liveConfirm: vi.fn(),
    restoreFile: vi.fn(),
    restoreInternal: vi.fn(),
    dataset: vi.fn(),
    cleanUp: vi.fn(),
}))
const offer = vi.hoisted(() => ({ cleanUp: true }))

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const menu = $state([] as unknown[])
    return {
        DBState: state,
        additionalSettingsMenu: menu,
        easyPanelStore: { open: false },
        SettingsMenuIndex: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../Setting/Pages/UserSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/BotSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/OtherBotSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PluginSettings.svelte', () => ({ default: () => {} }))
vi.mock('./PluginsShellPage.svelte', () => ({ default: () => {} }))
vi.mock('./PersonasShellPage.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PromptSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/Module/ModuleSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/HotkeySettings.svelte', () => ({ default: () => {} }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

vi.mock('src/ts/drive/backuplocal', () => ({
    SaveLocalBackup: engines.saveBin,
    SavePartialLocalBackup: engines.savePartial,
}))
vi.mock('src/ts/drive/rtbExportEntry', () => ({
    startRtbExport: engines.startRtb,
    startSettingsRtbExport: engines.startSettingsRtb,
    liveRtbEntryDeps: () => ({ confirm: engines.liveConfirm }),
}))
vi.mock('src/ts/drive/settingsRestore', () => ({
    restoreFromBinFile: engines.restoreFile,
    restoreFromInternalBackup: engines.restoreInternal,
}))
vi.mock('src/ts/storage/exportAsDataset', () => ({ exportAsDataset: engines.dataset }))
vi.mock('src/ts/storage/cleanUpUnusedFiles', () => ({
    cleanUpOfferedFor: () => offer.cleanUp,
    startCleanUpUnusedFiles: engines.cleanUp,
}))

import { language } from '../../lang'
import type { BackupExportOptions } from '../../ts/drive/backuplocal'
import type { BinLeaveOutEntry } from '../../ts/drive/binLeaveOut'
import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'
import { dataSheetState } from '../../ts/setting/dataSheets.svelte'
import { DBState } from '../../ts/stores.svelte'
import SettingsShellPage from './SettingsShellPage.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

async function settle(): Promise<void> {
    for (let round = 0; round < 4; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
    }
}

function show(index = 0): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(SettingsShellPage, { target, props: { index, phone: false, scrollMemory: new Map<number, number>() } }))
    flushSync()
    return target
}

const rowButton = (id: string) => document.querySelector<HTMLButtonElement>(`[data-setting-row="${id}"] button`)
const dialog = () => document.querySelector<HTMLElement>('[data-part="pattern-dialog"]')
const radio = (name: string, value: string) => document.querySelector<HTMLInputElement>(`input[type="radio"][name$="-${name}"][value="${value}"]`)!
const start = () => document.querySelector<HTMLButtonElement>('[data-part="data-chooser-start"]')!

async function openChooser(): Promise<void> {
    rowButton('data.backup')!.click()
    await settle()
    expect(dialog()).not.toBeNull()
}

async function pick(name: string, value: string): Promise<void> {
    radio(name, value).click()
    await settle()
}

beforeEach(() => {
    resetBackHandlersForTests()
    DBState.db = {} as unknown as Database
    dataSheetState.lastBinLeftOut = null
    for (const spy of Object.values(engines)) spy.mockReset()
    engines.saveBin.mockResolvedValue({ status: 'saved', notices: [] })
    engines.savePartial.mockResolvedValue({ status: 'saved', notices: [] })
    engines.startRtb.mockResolvedValue(null)
    engines.startSettingsRtb.mockResolvedValue(null)
    engines.liveConfirm.mockResolvedValue(false)
    engines.restoreFile.mockResolvedValue(undefined)
    engines.restoreInternal.mockResolvedValue(undefined)
    engines.dataset.mockResolvedValue(undefined)
    engines.cleanUp.mockResolvedValue(undefined)
    offer.cleanUp = true
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
    resetBackHandlersForTests()
})

describe('the page', () => {
    test('S1-R6: three sections in order and the four action rows', () => {
        const target = show()
        expect(target.querySelector('[data-part="data-page"]')).not.toBeNull()
        const headings = [...target.querySelectorAll('[data-part="settings-section-heading"]')].map((el) => el.textContent?.trim())
        expect(headings).toEqual([language.settingsShellDataBackup, language.settingsShellDataTransfer, language.settingsShellDataStorage])
        expect(target.querySelectorAll('[data-part="data-action"]')).toHaveLength(5)
        for (const id of ['data.backup', 'data.restoreFile', 'data.restoreSnapshot', 'data.dataset', 'data.cleanUp', 'acc.goCharacterOnImport', 'adv.coldstorage']) {
            expect(target.querySelector(`[data-setting-row="${id}"]`), id).not.toBeNull()
        }
    })

    test('the clean-up row is absent where the clean-up is not offered', () => {
        offer.cleanUp = false
        const target = show()
        expect(target.querySelector('[data-setting-row="data.cleanUp"]')).toBeNull()
        expect(target.querySelectorAll('[data-part="data-action"]')).toHaveLength(4)
    })
})

describe('the backup chooser', () => {
    test('R1: .rtb is preselected with {Everything, Settings only}; .bin offers {Everything, Without character assets}', async () => {
        show()
        await openChooser()
        expect(dialog()?.getAttribute('role')).toBe('alertdialog')
        expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(4)
        expect(radio('format', 'rtb').checked).toBe(true)
        expect(radio('scope', 'full').checked).toBe(true)
        expect(radio('scope', 'full').disabled).toBe(false)
        expect(radio('scope', 'settings').disabled).toBe(false)
        expect(document.querySelector('input[type="radio"][name$="-scope"][value="partial"]')).toBeNull()
        expect(dialog()?.textContent).not.toContain(language.settingsShellDataScopeSettingsHint)
        await pick('scope', 'settings')
        expect(dialog()?.textContent).toContain(language.settingsShellDataScopeSettingsHint)
        await pick('format', 'bin')
        expect(radio('scope', 'full').checked).toBe(true)
        expect(radio('scope', 'partial').disabled).toBe(false)
        expect(document.querySelector('input[type="radio"][name$="-scope"][value="settings"]')).toBeNull()
        expect(dialog()?.textContent).not.toContain(language.settingsShellDataScopeSettingsHint)
        expect(dialog()?.textContent).toContain(language.settingsShellDataScopeRtbOnly)
    })

    test('R1: a settings-only pick made under .rtb is not carried into a .bin answer', async () => {
        show()
        await openChooser()
        await pick('scope', 'settings')
        await pick('format', 'bin')
        start().click()
        await settle()
        expect(engines.saveBin).toHaveBeenCalledTimes(1)
        expect(engines.savePartial).not.toHaveBeenCalled()
        expect(engines.startSettingsRtb).not.toHaveBeenCalled()
    })

    test('R1: Settings only starts the settings export, never the full one', async () => {
        show()
        await openChooser()
        await pick('scope', 'settings')
        start().click()
        await settle()
        expect(engines.startSettingsRtb).toHaveBeenCalledTimes(1)
        expect(engines.startSettingsRtb.mock.calls[0][1]).toEqual({ password: undefined })
        expect(engines.startRtb).not.toHaveBeenCalled()
        expect(engines.saveBin).not.toHaveBeenCalled()
        expect(dialog()).toBeNull()
    })

    test('S1-R7: .bin with the partial scope shows the hint and calls the partial save once, as explained', async () => {
        show()
        await openChooser()
        await pick('format', 'bin')
        await pick('scope', 'partial')
        expect(dialog()?.textContent).toContain(language.settingsShellDataScopePartialHint)
        start().click()
        await settle()
        expect(engines.savePartial).toHaveBeenCalledTimes(1)
        expect(engines.savePartial.mock.calls[0]).toEqual([{ askLeaveOut: expect.any(Function) }, { assetsExplained: true }])
        expect(engines.saveBin).not.toHaveBeenCalled()
        expect(engines.startRtb).not.toHaveBeenCalled()
        expect(dialog()).toBeNull()
    })

    test('S1-R7: .bin with the full scope calls the full save once with only the leave-out question', async () => {
        show()
        await openChooser()
        await pick('format', 'bin')
        start().click()
        await settle()
        expect(engines.saveBin).toHaveBeenCalledTimes(1)
        expect(engines.saveBin.mock.calls[0]).toEqual([{ askLeaveOut: expect.any(Function) }])
        expect(engines.savePartial).not.toHaveBeenCalled()
        expect(engines.startRtb).not.toHaveBeenCalled()
    })

    test('S1-R7: a partial pick left behind while .rtb is chosen starts the .rtb export, not the partial save', async () => {
        show()
        await openChooser()
        await pick('format', 'bin')
        await pick('scope', 'partial')
        await pick('format', 'rtb')
        start().click()
        await settle()
        expect(engines.startRtb).toHaveBeenCalledTimes(1)
        expect(engines.savePartial).not.toHaveBeenCalled()
        expect(engines.saveBin).not.toHaveBeenCalled()
    })

    test('S1-R8: .rtb starts the export with a confirm that answers yes and is not the live one', async () => {
        show()
        await openChooser()
        start().click()
        await settle()
        expect(engines.startRtb).toHaveBeenCalledTimes(1)
        const deps = engines.startRtb.mock.calls[0][0] as { confirm: (message: string) => Promise<boolean> }
        expect(deps.confirm).not.toBe(engines.liveConfirm)
        expect(await deps.confirm('anything')).toBe(true)
        expect(engines.liveConfirm).not.toHaveBeenCalled()
        expect(engines.saveBin).not.toHaveBeenCalled()
        expect(engines.savePartial).not.toHaveBeenCalled()
        // A plain .rtb carries no password.
        expect((engines.startRtb.mock.calls[0][1] as { password?: string }).password).toBeUndefined()
    })

    const tickBox = () => document.querySelector<HTMLInputElement>('[data-part="data-chooser-encrypt-toggle"]')!
    const password1 = () => document.querySelector<HTMLInputElement>('[data-part="data-chooser-password"]')!
    const password2 = () => document.querySelector<HTMLInputElement>('[data-part="data-chooser-password-again"]')!

    async function typePassword(text: string): Promise<void> {
        for (const field of [password1(), password2()]) {
            field.value = text
            field.dispatchEvent(new Event('input', { bubbles: true }))
        }
        await settle()
    }

    async function openAndTick(): Promise<void> {
        await openChooser()
        tickBox().click()
        await settle()
    }

    test('T-S2-11: ticked with the same password twice, Start hands the .rtb export that password, with the yes-confirm', async () => {
        show()
        await openAndTick()
        await typePassword('page-pass 한')
        start().click()
        await settle()
        expect(engines.startRtb).toHaveBeenCalledTimes(1)
        expect(engines.startRtb.mock.calls[0][1]).toEqual({ password: 'page-pass 한' })
        const deps = engines.startRtb.mock.calls[0][0] as { confirm: (message: string) => Promise<boolean> }
        expect(await deps.confirm('anything')).toBe(true)
        expect(dialog()).toBeNull()
    })

    test('T-S2-12: the password is in no sheet state, storage or console output, while the chooser is open or after the run', async () => {
        const TOKEN = 'c128-T0k3n-한'
        const logged: unknown[][] = []
        for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
            vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(args) })
        }
        const everything = (): string => JSON.stringify([
            dataSheetState,
            Object.keys(localStorage).map((key) => localStorage.getItem(key)),
            logged.map((args) => args.map(serialize)),
        ])
        // Control 1: the serialiser finds the token in a logged choice object.
        expect(serialize({ choice: { password: TOKEN } })).toContain(TOKEN)
        show()
        await openAndTick()
        await typePassword(TOKEN)
        expect(password1().value).toBe(TOKEN)
        expect(everything()).not.toContain(TOKEN)
        start().click()
        await settle()
        // Control 2: the token reached the run.
        expect((engines.startRtb.mock.calls[0][1] as { password: string }).password).toBe(TOKEN)
        expect(everything()).not.toContain(TOKEN)
    })

    function serialize(value: unknown): string {
        if (typeof value === 'string') return value
        if (value instanceof Error) return `${value.message}\n${value.stack ?? ''}`
        try {
            return JSON.stringify(value) ?? String(value)
        } catch {
            return String(value)
        }
    }

    test('T-S2-13: Cancel, Escape and Back with a password typed start nothing; Start then runs the export once', async () => {
        const TOKEN = 'c128-T0k3n-한'
        show()
        await openAndTick()
        await typePassword(TOKEN)
        document.querySelector<HTMLButtonElement>('[data-part="data-chooser-cancel"]')!.click()
        await settle()
        expect(dialog()).toBeNull()
        expect(engines.startRtb).not.toHaveBeenCalled()

        await openAndTick()
        await typePassword(TOKEN)
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        await settle()
        expect(dialog()).toBeNull()
        expect(engines.startRtb).not.toHaveBeenCalled()

        await openAndTick()
        await typePassword(TOKEN)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(dialog()).toBeNull()
        expect(engines.startRtb).not.toHaveBeenCalled()

        // Control in the same page fixture: the same typing and Start run the export once.
        await openAndTick()
        await typePassword(TOKEN)
        start().click()
        await settle()
        expect(engines.startRtb).toHaveBeenCalledTimes(1)
        expect(engines.startRtb.mock.calls[0][1]).toEqual({ password: TOKEN })
    })

    function expectNothingStarted(): void {
        expect(engines.startRtb).not.toHaveBeenCalled()
        expect(engines.saveBin).not.toHaveBeenCalled()
        expect(engines.savePartial).not.toHaveBeenCalled()
        expect(dialog()).toBeNull()
    }

    test('S1-R9: Cancel starts nothing and removes the dialog', async () => {
        show()
        await openChooser()
        document.querySelector<HTMLButtonElement>('[data-part="data-chooser-cancel"]')!.click()
        await settle()
        expectNothingStarted()
    })

    test('S1-R9: Escape starts nothing and removes the dialog', async () => {
        show()
        await openChooser()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        await settle()
        expectNothingStarted()
    })

    test('S1-R9: Back starts nothing, removes the dialog and is handled', async () => {
        show()
        await openChooser()
        expect(dispatchBack()).toBe(true)
        await settle()
        expectNothingStarted()
    })

    test('S1-R11: leaving the page with the chooser open starts nothing and releases the action rows; a remount opens it again', async () => {
        show()
        await openChooser()
        unmount(mounted.pop()!)
        document.body.replaceChildren()
        await settle()
        expect(dataSheetState.pending).toBeNull()
        expect(dataSheetState.running).toBe(false)
        expect(engines.startRtb).not.toHaveBeenCalled()
        expect(engines.saveBin).not.toHaveBeenCalled()
        expect(engines.savePartial).not.toHaveBeenCalled()
        show()
        await openChooser()
    })
})

describe('the action rows', () => {
    test('S1-R10: each row calls its function once', async () => {
        show()
        for (const [id, spy] of [['data.restoreFile', engines.restoreFile], ['data.restoreSnapshot', engines.restoreInternal], ['data.dataset', engines.dataset], ['data.cleanUp', engines.cleanUp]] as const) {
            rowButton(id)!.click()
            await settle()
            expect(spy, id).toHaveBeenCalledTimes(1)
        }
    })

    test('S1-R10: while one action runs a tap on any row adds no call, and the rows say they are disabled', async () => {
        let release: () => void = () => {}
        engines.restoreFile.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve }))
        show()
        rowButton('data.restoreFile')!.click()
        await settle()
        expect(dataSheetState.running).toBe(true)
        for (const id of ['data.backup', 'data.restoreFile', 'data.restoreSnapshot', 'data.dataset', 'data.cleanUp']) {
            expect(rowButton(id)!.getAttribute('aria-disabled'), id).toBe('true')
        }
        rowButton('data.restoreFile')!.click()
        rowButton('data.restoreSnapshot')!.click()
        rowButton('data.dataset')!.click()
        rowButton('data.cleanUp')!.click()
        rowButton('data.backup')!.click()
        await settle()
        expect(engines.restoreFile).toHaveBeenCalledTimes(1)
        expect(engines.restoreInternal).not.toHaveBeenCalled()
        expect(engines.dataset).not.toHaveBeenCalled()
        expect(engines.cleanUp).not.toHaveBeenCalled()
        expect(dialog()).toBeNull()
        release()
        await settle()
        expect(dataSheetState.running).toBe(false)
        rowButton('data.restoreSnapshot')!.click()
        await settle()
        expect(engines.restoreInternal).toHaveBeenCalledTimes(1)
    })
})

describe('the leave-out sheet', () => {
    const FIVE_KINDS: BinLeaveOutEntry[] = [
        { kind: 'alternatives', count: 3, branchChats: 2, labels: [{ key: 'a', text: 'Alice / One', kinds: ['alternatives'], branches: { chats: 2, omitted: 0, bytes: 10 } }] },
        { kind: 'forkChatData', count: 4, kinds: ['interruptedNote'], labels: [{ key: 'b', text: 'Bob / Two', kinds: ['interruptedNote'] }] },
        { kind: 'taskPresets', count: 5, names: ['Summarize'] },
        { kind: 'themePacks', count: 6, names: ['Navy'] },
        { kind: 'usageStats', count: 1 },
    ]
    const KIND_LABELS = [
        language.settingsShellDataKindAlternatives,
        language.settingsShellDataKindForkChat,
        language.settingsShellDataKindTaskPresets,
        language.settingsShellDataKindThemePacks,
        language.settingsShellDataKindUsage,
    ].join(', ')

    type Answer = boolean | null | undefined
    const SAVED = { status: 'saved', notices: [] }
    const DECLINED = { status: 'declined', cause: 'incomplete-data-declined' }

    /** The full save asks the leave-out question with `summary`, then reports what `outcome` makes of the answer. */
    function binAsks(summary: readonly BinLeaveOutEntry[], outcome: (answer: Answer) => unknown): { answer: Answer } {
        const seen: { answer: Answer } = { answer: undefined }
        engines.saveBin.mockImplementation(async (options: BackupExportOptions) => {
            seen.answer = await options.askLeaveOut?.(summary)
            return outcome(seen.answer)
        })
        return seen
    }

    const sheet = () => document.querySelector<HTMLElement>('[data-pattern-severity="caution"]')
    const press = (part: string) => document.querySelector<HTMLButtonElement>(`[data-part="${part}"]`)!.click()
    const resultLine = () => document.querySelector<HTMLElement>('[data-part="data-backup-result"]')

    async function reachSheet(): Promise<void> {
        show()
        await openChooser()
        await pick('format', 'bin')
        start().click()
        await settle()
        expect(sheet()).not.toBeNull()
    }

    test('S2-R6: a caution sheet names every kind with its count on a line that is on screen, and Cancel takes first focus', async () => {
        const seen = binAsks(FIVE_KINDS, () => SAVED)
        await reachSheet()
        expect(sheet()?.querySelector('[data-part="pattern-warn-headline"]')?.textContent).toBe(language.settingsShellDataLeaveOutTitle)
        const shown = [...document.querySelectorAll<HTMLElement>('[data-part="pattern-warn-consequence"]')]
        expect(shown.length).toBeGreaterThan(0)
        for (const line of shown) {
            expect(line.closest('[hidden]'), line.textContent ?? '').toBeNull()
        }
        const text = shown.map((line) => line.textContent).join('\n')
        for (const expected of [
            language.settingsShellDataLeaveOutAlternatives(3, 2),
            language.settingsShellDataLeaveOutForkChat(4, language.backupForkChatDataKind('interruptedNote')),
            language.settingsShellDataLeaveOutTaskPresets(5),
            language.settingsShellDataLeaveOutThemePacks(6),
            language.settingsShellDataLeaveOutUsage,
        ]) {
            expect(text).toContain(expected)
        }
        expect(document.querySelector('[data-part="pattern-warn-cancel"]')?.hasAttribute('data-pattern-initial')).toBe(true)
        press('pattern-warn-primary')
        await settle()
        expect(seen.answer).toBe(true)
        expect(sheet()).toBeNull()
    })

    test('S2-R7: "Make .rtb instead" answers no to the .bin and then starts the .rtb export, after the declined export, with the confirm-skipping deps', async () => {
        const order: string[] = []
        const seen = binAsks(FIVE_KINDS, (answer) => {
            order.push('bin')
            return answer === false ? DECLINED : SAVED
        })
        engines.startRtb.mockImplementation(async () => {
            order.push('rtb')
            return null
        })
        await reachSheet()
        press('pattern-warn-secondary')
        await settle()
        expect(seen.answer).toBe(false)
        expect(order).toEqual(['bin', 'rtb'])
        expect(engines.startRtb).toHaveBeenCalledTimes(1)
        const deps = engines.startRtb.mock.calls[0][0] as { confirm: (message: string) => Promise<boolean> }
        expect(deps.confirm).not.toBe(engines.liveConfirm)
        expect(await deps.confirm('anything')).toBe(true)
    })

    test('S2-R8: the .rtb never starts after a secondary answer when the export was cancelled, or after a saved file', async () => {
        binAsks(FIVE_KINDS, () => ({ status: 'declined', cause: 'export-cancelled', file: 'untouched' }))
        await reachSheet()
        press('pattern-warn-secondary')
        await settle()
        expect(engines.startRtb).not.toHaveBeenCalled()
        unmount(mounted.pop()!)
        document.body.replaceChildren()

        binAsks(FIVE_KINDS, () => SAVED)
        await reachSheet()
        press('pattern-warn-secondary')
        await settle()
        expect(engines.startRtb).not.toHaveBeenCalled()
    })

    test('S2-R8: Continue and Cancel never start the .rtb export', async () => {
        binAsks(FIVE_KINDS, (answer) => answer === true ? SAVED : DECLINED)
        await reachSheet()
        press('pattern-warn-cancel')
        await settle()
        expect(engines.startRtb).not.toHaveBeenCalled()
        unmount(mounted.pop()!)
        document.body.replaceChildren()

        await reachSheet()
        press('pattern-warn-primary')
        await settle()
        expect(engines.startRtb).not.toHaveBeenCalled()
    })

    test('S2-R9: leaving the page with the sheet open answers the export null, not false', async () => {
        const seen = binAsks(FIVE_KINDS, () => DECLINED)
        await reachSheet()
        unmount(mounted.pop()!)
        document.body.replaceChildren()
        await settle()
        expect(seen.answer).toBeNull()
        expect(dataSheetState.pendingLeaveOut).toBeNull()
        expect(engines.startRtb).not.toHaveBeenCalled()
    })

    test('S2-R9: a question asked after the page is gone is answered null at once', async () => {
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        let answer: Answer = undefined
        engines.saveBin.mockImplementation(async (options: BackupExportOptions) => {
            await gate
            answer = await options.askLeaveOut?.(FIVE_KINDS)
            return DECLINED
        })
        show()
        await openChooser()
        await pick('format', 'bin')
        start().click()
        await settle()
        unmount(mounted.pop()!)
        document.body.replaceChildren()
        await settle()
        release()
        await settle()
        expect(answer).toBeNull()
        expect(dataSheetState.pendingLeaveOut).toBeNull()
    })

    test('S2-R10: the polite line exists and is empty before a run, repeats the kinds after a saved .bin, survives a remount, and a new run clears it', async () => {
        binAsks(FIVE_KINDS, (answer) => answer === true ? SAVED : DECLINED)
        show()
        expect(resultLine()).not.toBeNull()
        expect(resultLine()?.getAttribute('aria-live')).toBe('polite')
        expect(resultLine()?.textContent).toBe('')
        await openChooser()
        await pick('format', 'bin')
        start().click()
        await settle()
        press('pattern-warn-primary')
        await settle()
        expect(resultLine()?.textContent).toBe(language.settingsShellDataLeftOutRepeat(KIND_LABELS))

        unmount(mounted.pop()!)
        document.body.replaceChildren()
        show()
        expect(resultLine()?.textContent).toBe(language.settingsShellDataLeftOutRepeat(KIND_LABELS))

        await openChooser()
        await pick('format', 'bin')
        start().click()
        await settle()
        expect(resultLine()?.textContent).toBe('')
        press('pattern-warn-cancel')
        await settle()
        expect(resultLine()?.textContent).toBe('')
    })

    test('S2-R10: the line stays empty after the secondary answer, a question the page left unanswered, and an export with nothing to ask', async () => {
        binAsks(FIVE_KINDS, (answer) => answer === false ? DECLINED : SAVED)
        await reachSheet()
        press('pattern-warn-secondary')
        await settle()
        expect(resultLine()?.textContent).toBe('')
        unmount(mounted.pop()!)
        document.body.replaceChildren()

        // The page goes away with the sheet open: the export saves after its per-kind prompts, and no line is set.
        binAsks(FIVE_KINDS, () => SAVED)
        await reachSheet()
        unmount(mounted.pop()!)
        document.body.replaceChildren()
        await settle()
        expect(dataSheetState.lastBinLeftOut).toBeNull()

        engines.saveBin.mockImplementation(async () => SAVED)
        show()
        await openChooser()
        await pick('format', 'bin')
        start().click()
        await settle()
        expect(sheet()).toBeNull()
        expect(resultLine()?.textContent).toBe('')
    })

    test('S2-G7: an export that asks nothing shows no sheet', async () => {
        engines.saveBin.mockImplementation(async () => SAVED)
        show()
        await openChooser()
        await pick('format', 'bin')
        start().click()
        await settle()
        expect(engines.saveBin).toHaveBeenCalledTimes(1)
        expect(sheet()).toBeNull()
        expect(dialog()).toBeNull()
    })

    test('the sheet with Back: Back answers Cancel, nothing starts', async () => {
        const seen = binAsks(FIVE_KINDS, (answer) => answer === true ? SAVED : DECLINED)
        await reachSheet()
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(seen.answer).toBe(false)
        expect(sheet()).toBeNull()
        expect(engines.startRtb).not.toHaveBeenCalled()
    })
})
