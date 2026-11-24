// @vitest-environment jsdom
/**
 * The lorebook settings panel over the real history service on the memory doubles and the real English `language`.
 * MOCKED: the page store (DBState is a `$state` object so the panel re-renders from live writes), the save-mark counter,
 * and `alertMd` (the Help buttons open it). The field reveal registration is wrapped so a test can fire it.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    marks: 0,
    alertMd: vi.fn<(text: string) => void>(),
    reveal: null as null | ((path: string) => Promise<void>),
}))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/alert', () => ({ alertMd: h.alertMd }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: { characters: [] } as unknown })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
    }
})
vi.mock('src/ts/studio/historyFocus', async (importOriginal) => {
    const original = await importOriginal<typeof import('src/ts/studio/historyFocus')>()
    return {
        ...original,
        registerFieldReveal: (reveal: (path: never) => Promise<void>) => {
            h.reveal = reveal as (path: string) => Promise<void>
            return original.registerFieldReveal(reveal)
        },
    }
})

import { language } from 'src/lang'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { character } from 'src/ts/storage/database.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { FIELD_PRESENTATION } from '../../ts/studio/history/fieldRegistry'
import { createOwnerHistoryService, type OwnerHistoryService, type StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { createFakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { makeCharacter, type LiveCharacter } from '../../ts/studio/history/tests/objService.test-helpers'
import StudioLoreSettings from './StudioLoreSettings.svelte'

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const dbBag = (): Record<string, unknown> => DBState.db as unknown as Record<string, unknown>
const liveChar = (): LiveCharacter & { lorePlus?: boolean } => (DBState.db.characters as unknown as (LiveCharacter & { lorePlus?: boolean })[])[0]

let service: OwnerHistoryService
let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []
let results: StudioResult[] = []

async function start(overrides: Partial<LiveCharacter> = {}, db: Record<string, unknown> = {}): Promise<void> {
    DBState.db = { characters: [makeCharacter(overrides)], loreBookDepth: 7, loreBookToken: 1234, useExperimental: false, ...db } as unknown as typeof DBState.db
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
    })
    await service.whenReady(A)
}

interface View {
    host: HTMLElement
    part: (name: string) => HTMLElement | null
    input: (name: string) => HTMLInputElement
}

function show(props: { host?: 'character' | 'chat' | 'module'; editable?: boolean; open?: boolean; onOpenCharacter?: () => void; noService?: boolean } = {}): View {
    const target = document.createElement('div')
    document.body.append(target)
    const app = mount(StudioLoreSettings, {
        target,
        props: {
            owner: A,
            service: props.noService ? null : service,
            editable: props.editable ?? true,
            host: props.host ?? 'character',
            live: (props.host ?? 'character') === 'character' ? (DBState.db.characters[0] as unknown as character) : undefined,
            noted: (result: StudioResult) => { results.push(result); return result.ok },
            onOpenCharacter: props.onOpenCharacter,
        },
    })
    mounted.push({ app, host: target })
    flushSync()
    const view: View = {
        host: target,
        part: (name) => target.querySelector<HTMLElement>(`[data-part="${name}"]`),
        input: (name) => {
            const found = target.querySelector<HTMLInputElement>(`[data-part="${name}"] input, input[data-part="${name}"]`)
            if (!found) throw new Error(`no input ${name}`)
            return found
        },
    }
    if ((props.host ?? 'character') === 'character' && props.open !== false) {
        view.part('studio-lore-settings-toggle')?.click()
        flushSync()
    }
    return view
}

function typeNumber(input: HTMLInputElement, text: string): void {
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

function blur(input: HTMLInputElement): void {
    input.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
}

const SEEDED = { tokenBudget: 800, scanDepth: 5, recursiveScanning: false }

beforeEach(() => {
    h.marks = 0
    h.reveal = null
    h.alertMd.mockClear()
    results = []
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
})

afterEach(() => {
    for (const { app, host } of mounted) {
        unmount(app)
        host.remove()
    }
    mounted = []
    DBState.db = { characters: [] } as unknown as typeof DBState.db
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('T23i the character host controls', () => {
    test('the section starts collapsed and the toggle opens it', async () => {
        await start()
        const view = show({ open: false })
        expect(view.part('studio-lore-settings-body')).toBeNull()
        expect(view.part('studio-lore-settings-toggle')?.getAttribute('aria-expanded')).toBe('false')
        view.part('studio-lore-settings-toggle')?.click()
        flushSync()
        expect(view.part('studio-lore-settings-body')).not.toBeNull()
    })

    test('use global is on while loreSettings is absent, with the app values in a read-only line', async () => {
        await start()
        const view = show()
        expect(view.input('studio-lore-use-global').checked).toBe(true)
        expect(view.part('studio-lore-global-values')?.textContent).toBe(language.studioLoreGlobalValues(7, 1234))
        expect(view.part('studio-lore-recursive')).toBeNull()
    })

    test('turning it off seeds from the app values through the service, leaves the app values alone, and shows the controls', async () => {
        await start()
        const spy = vi.spyOn(service, 'objEdit')
        const view = show()
        view.input('studio-lore-use-global').click()
        flushSync()
        expect(spy).toHaveBeenCalledTimes(1)
        expect(liveChar().loreSettings).toEqual({ tokenBudget: 1234, scanDepth: 7, recursiveScanning: false })
        expect(dbBag().loreBookDepth).toBe(7)
        expect(dbBag().loreBookToken).toBe(1234)
        expect(h.marks).toBe(1)
        expect(service.view(A).done).toHaveLength(1)
        expect(view.part('studio-lore-global-values')).toBeNull()
        expect(view.input('studio-lore-recursive').checked).toBe(false)
    })

    test('turning it on again removes the settings, and the line shows the app values, not the character values', async () => {
        await start({ loreSettings: { tokenBudget: 99, scanDepth: 9, recursiveScanning: true } })
        const view = show()
        expect(view.input('studio-lore-use-global').checked).toBe(false)
        view.input('studio-lore-use-global').click()
        flushSync()
        expect('loreSettings' in liveChar()).toBe(false)
        expect(view.part('studio-lore-global-values')?.textContent).toBe(language.studioLoreGlobalValues(7, 1234))
    })

    test('a flag writes through the service; a boundary flag also writes the loreExt mirror in the same step', async () => {
        await start({ loreSettings: { ...SEEDED } })
        const view = show()
        view.input('studio-lore-recursive').click()
        flushSync()
        expect(liveChar().loreSettings).toMatchObject({ recursiveScanning: true })
        view.input('studio-lore-ascii-boundary').click()
        flushSync()
        expect(liveChar().loreSettings).toMatchObject({ fullWordAsciiBoundary: true })
        expect(liveChar().loreExt).toEqual({ risu_fullWordAsciiBoundary: true })
        expect(service.view(A).done).toHaveLength(2)
        expect(view.input('studio-lore-ascii-boundary').checked).toBe(true)
        view.input('studio-lore-ascii-boundary').click()
        flushSync()
        expect(liveChar().loreExt).toEqual({})
    })

    test('a number writes clamped and coalesced, and the display shows the live value after the field is left', async () => {
        await start({ loreSettings: { ...SEEDED } })
        const view = show()
        const depth = view.input('studio-lore-scan-depth')
        typeNumber(depth, '99')
        expect((liveChar().loreSettings as { scanDepth: number }).scanDepth).toBe(20)
        typeNumber(depth, '12')
        expect(service.view(A).done).toHaveLength(1)
        blur(depth)
        expect(depth.value).toBe('12')
        typeNumber(depth, '88')
        blur(depth)
        expect(depth.value).toBe('20')
    })

    test('leaving the field closes the step: two same-field edits across a blur are two steps', async () => {
        await start({ loreSettings: { ...SEEDED } })
        const view = show()
        const budget = view.input('studio-lore-token-budget')
        typeNumber(budget, '900')
        blur(budget)
        typeNumber(budget, '950')
        expect(service.view(A).done).toHaveLength(2)
    })

    test('clearing a number input writes nothing and marks nothing', async () => {
        await start({ loreSettings: { ...SEEDED } })
        const view = show()
        typeNumber(view.input('studio-lore-scan-depth'), '')
        expect(h.marks).toBe(0)
        expect(service.view(A).done).toHaveLength(0)
        expect((liveChar().loreSettings as { scanDepth: number }).scanDepth).toBe(5)
    })

    test('editable false disables every control', async () => {
        await start({ loreSettings: { ...SEEDED } }, { useExperimental: true })
        const view = show({ editable: false })
        const inputs = view.host.querySelectorAll<HTMLInputElement>('input')
        expect(inputs.length).toBe(8)
        for (const input of inputs) expect(input.disabled).toBe(true)
    })

    test('with no service a control resets and nothing is written', async () => {
        await start({ loreSettings: { ...SEEDED } })
        const view = show({ noService: true })
        view.input('studio-lore-recursive').click()
        flushSync()
        expect(view.input('studio-lore-recursive').checked).toBe(false)
        expect(h.marks).toBe(0)
    })

    test('a refused write resets the control to the live value', async () => {
        await start({ loreSettings: { ...SEEDED }, loreExt: 'broken' as unknown as object })
        const view = show()
        view.input('studio-lore-cjk-start').click()
        flushSync()
        expect(results.at(-1)).toMatchObject({ ok: false, reason: 'precondition' })
        expect(view.input('studio-lore-cjk-start').checked).toBe(false)
        expect(service.view(A).done).toHaveLength(0)
    })

    test('the panel writes only through the service: no step and no mark means nothing was written', async () => {
        await start({ loreSettings: { ...SEEDED } })
        const view = show({ noService: true })
        typeNumber(view.input('studio-lore-scan-depth'), '9')
        expect((liveChar().loreSettings as { scanDepth: number }).scanDepth).toBe(5)
        expect(h.marks).toBe(0)
    })

    test('the help buttons of the boundary flags open their help text', async () => {
        await start({ loreSettings: { ...SEEDED } })
        const view = show()
        for (const button of view.host.querySelectorAll<HTMLButtonElement>('button.help')) button.click()
        const texts = h.alertMd.mock.calls.map((call) => call[0])
        expect(texts).toContain(language.help.fullWordAsciiBoundary)
        expect(texts).toContain(language.help.cjkWordStart)
    })
})

describe('T23j LorePlus', () => {
    test.each([
        ['absent', {}],
        ['present', { loreSettings: { ...SEEDED } }],
    ] as const)('it is hidden without useExperimental and shown with it, with loreSettings %s', async (_name, overrides) => {
        await start(overrides, { useExperimental: false })
        expect(show().part('studio-lore-plus')).toBeNull()
        await start(overrides, { useExperimental: true })
        const view = show()
        expect(view.part('studio-lore-plus')).not.toBeNull()
    })

    test('the toggle writes the registry field in a step of its own and undo makes it absent again', async () => {
        await start({}, { useExperimental: true })
        const view = show()
        const box = view.input('studio-lore-plus')
        box.click()
        flushSync()
        expect(liveChar().lorePlus).toBe(true)
        expect(service.view(A).done).toHaveLength(1)
        expect(service.undo(A)).toEqual({ ok: true })
        expect(liveChar().lorePlus).toBeUndefined()
        expect('lorePlus' in liveChar()).toBe(false)
    })

    test('its two help buttons open the lorePlus and experimental help', async () => {
        await start({}, { useExperimental: true })
        const view = show()
        for (const button of view.host.querySelectorAll<HTMLButtonElement>('button.help')) button.click()
        const texts = h.alertMd.mock.calls.map((call) => call[0])
        expect(texts).toContain(language.help.lorePlus)
        expect(texts).toContain(language.help.experimental)
    })

    test('the app-wide flag is never written', async () => {
        await start({}, { useExperimental: true })
        show().input('studio-lore-plus').click()
        flushSync()
        expect(dbBag().useExperimental).toBe(true)
    })
})

describe('T23k chat and module hosts', () => {
    test('a chat host shows the note and a button to the character, and no controls or writes', async () => {
        await start()
        const open = vi.fn()
        const spy = vi.spyOn(service, 'objEdit')
        const view = show({ host: 'chat', onOpenCharacter: open })
        expect(view.part('studio-lore-settings-chat-note')?.textContent).toBe(language.studioLoreSettingsChatNote)
        expect(view.host.querySelectorAll('input').length).toBe(0)
        view.part('studio-lore-settings-open-character')?.click()
        expect(open).toHaveBeenCalledTimes(1)
        expect(spy).not.toHaveBeenCalled()
        expect(h.marks).toBe(0)
    })

    test('a module host shows only its note', async () => {
        await start()
        const view = show({ host: 'module' })
        expect(view.part('studio-lore-settings-module-note')?.textContent).toBe(language.studioLoreSettingsModuleNote)
        expect(view.host.querySelectorAll('input, button').length).toBe(0)
    })
})

describe('T23l the focus target of LorePlus', () => {
    function focusSelector(): string {
        const focus = FIELD_PRESENTATION.lorePlus.focus
        if (focus === null || typeof focus !== 'object') throw new Error('lorePlus has no focus target')
        return `[data-part="${focus.form}"] [data-part="${focus.part}"]`
    }

    test('the registry selector finds the rendered checkbox', async () => {
        await start({}, { useExperimental: true })
        const view = show()
        expect(view.host.querySelector(focusSelector())).toBe(view.input('studio-lore-plus'))
    })

    test('a reveal opens the collapsed section for the placement and the next header tap closes it', async () => {
        await start({}, { useExperimental: true })
        const view = show({ open: false })
        expect(view.host.querySelector(focusSelector())).toBeNull()
        const pending = h.reveal?.('lorePlus')
        flushSync()
        await pending
        expect(view.host.querySelector(focusSelector())).not.toBeNull()
        view.part('studio-lore-settings-toggle')?.click()
        flushSync()
        expect(view.host.querySelector(focusSelector())).toBeNull()
    })
})
