// @vitest-environment jsdom
// Class G (new-behaviour guard): the uses list of the toggle builder over a real `$state` database, the real save
// marks and the real owner history service on the memory doubles. Only text and events are asserted, so no sanitizer
// is involved. The uses list is new behaviour: no row is a regression reproducer.
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { RisuModule } from 'src/ts/process/modules'

const h = vi.hoisted(() => ({ marks: 0, scans: 0 }))

const FUNCTION_KEYS = new Set([
    'studioTgUsesRename', 'studioTgUsesWillChange', 'studioTgUsesSkipped', 'studioTgUsesAlsoUpdate', 'studioTgUsesKeyBlocked',
    'studioTgUsesNotLoaded', 'studioTgUsesSharedId', 'studioTgUsesMore', 'studioTgUpdated', 'studioTgUpdateUndoChanged',
])
vi.mock('src/lang', () => ({
    language: new Proxy({} as Record<string, unknown>, {
        get: (_target, key) => {
            if (typeof key !== 'string') {
                return undefined
            }
            return FUNCTION_KEYS.has(key) || key.startsWith('studioAssetPlace') ? (...args: (string | number)[]) => `${key}(${args.join(',')})` : key
        },
    }),
}))
vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks, readImage: async () => null }))
vi.mock('src/ts/process/modules', () => ({ refreshModules: () => {} }))
vi.mock('src/ts/process/moduleGuiBump', () => ({ bumpModuleGui: () => {} }))
// Counts every scan of the reach, by the component and by the run alike; the scan itself is the real one.
vi.mock('src/ts/studio/toggleUpdateAll', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/studio/toggleUpdateAll')>()
    return {
        ...actual,
        scanReach: (...args: Parameters<typeof actual.scanReach>) => {
            h.scans += 1
            return actual.scanReach(...args)
        },
    }
})
vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        selectedCharID: writable(0),
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock('src/ts/process/moduleRefList', async () => {
    const { DBState } = await import('src/ts/stores.svelte')
    const { matchesModuleRef } = await import('src/ts/process/moduleRefs')
    return {
        moduleListOf: (ids: string[]) => {
            const wanted = new Set(ids)
            return ((DBState.db as unknown as Database).modules ?? []).filter((row) => matchesModuleRef(row, wanted))
        },
    }
})

import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { createStudioToasts } from 'src/ts/studio/edit/studioToasts'
import { createOwnerHistoryService, type OwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import {
    getStudioHistoryService, resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests,
} from 'src/ts/studio/history/studioHistoryService.svelte'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { stubModule } from 'src/ts/studio/studioFixtures.test-helpers'
import type { ToggleTarget } from 'src/ts/studio/toggleBuilder.svelte'
import type { Rename } from 'src/ts/studio/toggleUpdateAll'
import { currentUpdate, resetUpdateRunForTests } from 'src/ts/studio/toggleUpdateAllRun.svelte'
import { createToastHost, type ToastClock, type ToastHost } from 'src/ts/toast/toastHost.svelte'
import StudioToggleUses from './StudioToggleUses.svelte'

const READ = '{{getglobalvar::toggle_a}}'
const B = '{{getglobalvar::toggle_b}}'
const DYNAMIC = '{{getglobalvar::toggle_{{getvar::x}}}}'
const A_TO_B: Rename[] = [{ from: 'a', to: 'b' }]
const CHARACTER: ToggleTarget = { kind: 'character', chaId: 'c1' }
const MODULE: ToggleTarget = { kind: 'module', moduleId: 'M1' }
const C1 = characterOwnerKey('c1')

function characterRow(desc: string, extra: Record<string, unknown> = {}) {
    return {
        chaId: 'c1', name: 'Alice', type: 'character', desc, firstMessage: '', alternateGreetings: [], globalLore: [], customscript: [], triggerscript: [],
        customModuleToggle: '', chats: [{ id: 'chat1', note: '', name: 'chat', message: [], localLore: [] }], chatPage: 0, ...extra,
    }
}

function moduleRow(id: string, content: string, extra: Record<string, unknown> = {}): RisuModule {
    return {
        id, name: `Module ${id}`, description: '',
        lorebook: [{ key: 'k', comment: 'c', content, mode: 'normal', insertorder: 1, alwaysActive: false, secondkey: '', selective: false }],
        regex: [{ comment: 'pattern', in: READ, out: 'x', type: 'editdisplay', flag: '<cbs>', ableFlag: true }],
        trigger: [], customModuleToggle: '', ...extra,
    } as unknown as RisuModule
}

function seed(desc: string, modules: RisuModule[] = [], extra: Record<string, unknown> = {}): void {
    DBState.db = {
        characters: [characterRow(desc, extra)], modules, enabledModules: modules.map((row) => row.id),
        botPresets: [], botPresetsId: 0, personas: [], plugins: [], loadouts: [], moduleIntergration: '',
    } as unknown as Database
}

const live = () => DBState.db.characters[0] as unknown as ReturnType<typeof characterRow>
const lore = () => (DBState.db.modules[0] as RisuModule).lorebook?.[0].content

// The parts of a builder the list reads; the renames are state, so a change re-renders as the real builder's do.
// keepOnUpdate leaves the renames in place after an update, as the real builder does while a question is open.
const fake = $state({ renames: [] as Rename[], kept: false, dismissed: 0, updated: 0, keepOnUpdate: false })
const builder = {
    get usesRenames(): readonly Rename[] { return fake.renames },
    get usesKept(): boolean { return fake.kept },
    dismissUses(): void { fake.dismissed += 1; fake.renames = [] },
    noteUpdated(): void {
        fake.updated += 1
        if (!fake.keepOnUpdate) {
            fake.renames = []
        }
    },
    owner: C1,
}

let tracker: toSaveType
let service: OwnerHistoryService
let mounted: { app: ReturnType<typeof mount>, host: HTMLElement }[] = []
let announced: string[] = []
let editable = true

function makeToastHost(): ToastHost {
    const clock: ToastClock = { now: () => 0, after: () => () => {} }
    return createToastHost({ clock })
}

function mountList(target: ToggleTarget = CHARACTER, host: ToastHost = makeToastHost()): ToastHost {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const toasts = createStudioToasts({ service: getStudioHistoryService, host })
    mounted.push({
        app: mount(StudioToggleUses, { target: element, props: { builder, target, chaId: 'c1', editable, announce: (text: string) => { announced.push(text) }, toasts, host } }),
        host: element,
    })
    flushSync()
    return host
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const texts = (name: string) => parts(name).map((element) => element.textContent?.trim())
const update = () => part('studio-toggle-uses-update') as HTMLButtonElement | null
const click = (element: Element | null) => { (element as HTMLElement).click(); flushSync() }
// One macrotask: the refresh scheduled by a click lands here.
const drain = async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); flushSync() }

beforeEach(() => {
    h.marks = 0
    h.scans = 0
    fake.keepOnUpdate = false
    fake.renames = A_TO_B
    fake.kept = false
    fake.dismissed = 0
    fake.updated = 0
    announced = []
    editable = true
    resetStudioScreenForTests()
    resetStudioHistoryAccessorForTests()
    resetUpdateRunForTests()
    tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    seed(`start ${READ}`, [moduleRow('M1', `lore ${READ} ${DYNAMIC}`)])
    selIdState.selId = 0
    studioScreen.chaId = 'c1'
    studioScreen.open = true
    studioScreen.visitId = 'v1'
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        getMarkCount: () => h.marks,
        registerLeaveFlush: () => () => {},
        openModuleId: () => 'M1',
    })
    setStudioHistoryServiceForTests(service)
})

afterEach(async () => {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
    vi.restoreAllMocks()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetStudioHistoryAccessorForTests()
    resetUpdateRunForTests()
})

describe('T11 Update all from a preset builder', () => {
    const PRESET: ToggleTarget = { kind: 'preset', presetId: 'P-1' }

    test('reaches the character and the active modules, and says that prompts in presets are not covered', async () => {
        await service.whenReady(C1)
        mountList(PRESET)
        expect(texts('studio-toggle-uses-count')).toEqual(['studioTgUsesWillChange(Alice,1)', 'studioTgUsesWillChange(Module M1,1)'])
        expect(part('studio-toggle-uses-preset-note')?.textContent).toBe('studioTgUpdateAllPresetNote')
    })

    test('a private bound character is not reached and the modules are', async () => {
        seed(`start ${READ}`, [moduleRow('M1', `lore ${READ}`)], { license: 'private' })
        await service.whenReady(C1)
        mountList(PRESET)
        expect(texts('studio-toggle-uses-count')).toEqual(['studioTgUsesWillChange(Module M1,1)'])
        expect(texts('studio-toggle-uses-unreached')).toEqual(['studioTgUsesRestricted'])
    })

    test('a character or module builder shows no preset note', async () => {
        await service.whenReady(C1)
        mountList(CHARACTER)
        expect(part('studio-toggle-uses-preset-note')).toBeNull()
    })
})

describe('what the list shows (B3)', () => {
    test('the rename, the per-owner counts, the listed rows with their reasons, the not-checked note and no None text', async () => {
        await service.whenReady(C1)
        mountList()
        expect(texts('studio-toggle-uses-rename')).toEqual(['studioTgUsesRename(a,b)'])
        expect(texts('studio-toggle-uses-count')).toEqual(['studioTgUsesWillChange(Alice,1)', 'studioTgUsesWillChange(Module M1,1)'])
        const reasons = parts('studio-toggle-uses-listed').map((row) => [row.dataset.reason, row.querySelector('[data-part="studio-toggle-uses-reason"]')?.textContent])
        expect(reasons).toContainEqual(['dynamicName', 'studioTgUsesWhyDynamic'])
        expect(reasons).toContainEqual(['regexPattern', 'studioTgUsesWhyRegexIn'])
        expect(part('studio-toggle-uses-outside')?.textContent).toBe('studioTgUsesOutside')
        expect(part('studio-toggle-uses-none')).toBeNull()
    })

    test('a regex pattern row is labelled and opened by its regex script, not its raw path', async () => {
        await service.whenReady(C1)
        mountList()
        const row = parts('studio-toggle-uses-listed').find((entry) => entry.dataset.reason === 'regexPattern') as HTMLElement
        expect(row.textContent).toContain('Module M1')
        expect(row.textContent).not.toContain('regex/0/in')
        click(row.querySelector('[data-part="studio-toggle-uses-open"]'))
        expect(studioScreen.selectedOwnerKey).toBe('module:M1')
        expect(studioScreen.selectedKind).toBe('regex')
        expect(studioScreen.selectedItemId).toBe('M1/regex:0')
    })

    test('the unreached owners are named and a stub is not read', async () => {
        seed(`start ${READ}`, [moduleRow('M1', READ), stubModule('S1')])
        await service.whenReady(C1)
        mountList()
        expect(texts('studio-toggle-uses-unreached')).toEqual(['studioTgUsesNotLoaded(Module S1)'])
    })

    test('more than 50 listed rows show 50 and the rest as a count', async () => {
        seed(DYNAMIC.repeat(60))
        await service.whenReady(C1)
        mountList()
        expect(parts('studio-toggle-uses-listed')).toHaveLength(50)
        expect(part('studio-toggle-uses-more')?.textContent).toBe('studioTgUsesMore(10)')
    })

    test('the display plan is built from the reach its scan read: an edit after display makes no mismatch row, only the click notices', async () => {
        await service.whenReady(C1)
        mountList()
        live().desc = `inserted ${live().desc}`
        fake.renames = [{ from: 'a', to: 'c' }]
        flushSync()
        expect(parts('studio-toggle-uses-listed').filter((row) => row.dataset.reason === 'mismatch')).toEqual([])
        expect(texts('studio-toggle-uses-count')).toEqual(['studioTgUsesWillChange(Alice,1)', 'studioTgUsesWillChange(Module M1,1)'])
    })

    test('a source that still defines the old key is skipped until "Also update" is ticked, then it is counted', async () => {
        seed(`start ${READ}`, [moduleRow('M1', READ, { customModuleToggle: 'a=A' })])
        await service.whenReady(C1)
        mountList()
        expect(texts('studio-toggle-uses-skipped')).toHaveLength(1)
        expect(part('studio-toggle-uses-skipped')?.textContent).toContain('studioTgUsesSkipped(Module M1,a,1)')
        expect(texts('studio-toggle-uses-count')).toEqual(['studioTgUsesWillChange(Alice,1)'])
        click(part('studio-toggle-uses-optin'))
        expect(texts('studio-toggle-uses-count')).toEqual(['studioTgUsesWillChange(Alice,1)', 'studioTgUsesWillChange(Module M1,1)'])
        click(update())
        expect(lore()).toBe(B)
    })
})

describe('Update all and Undo all (B4 to B7)', () => {
    test('B4 Update all writes, posts the toast and the result line, and both Undo all and the toast Undo restore', async () => {
        await service.whenReady(C1)
        const host = mountList(MODULE)
        click(update())
        expect(live().desc).toBe(`start ${B}`)
        expect(lore()).toBe(`lore ${B} ${DYNAMIC}`)
        expect(host.visible.at(-1)?.text).toBe('studioTgUpdated(2)')
        expect(fake.updated).toBe(1)
        expect(announced).toContain('studioTgUpdated(2)')
        expect(part('studio-toggle-uses-result')?.textContent).toContain('studioTgUpdated(2)')
        click(part('studio-toggle-uses-undo'))
        expect(live().desc).toBe(`start ${READ}`)
        expect(lore()).toBe(`lore ${READ} ${DYNAMIC}`)
        expect(part('studio-toggle-uses-result')).toBeNull()

        fake.renames = A_TO_B
        flushSync()
        click(update())
        expect(live().desc).toBe(`start ${B}`)
        await host.activate(host.visible.at(-1)?.id as never)
        flushSync()
        expect(live().desc).toBe(`start ${READ}`)
    })

    test('B5 an Undo after an edit of a rewritten field names the owner and writes nothing', async () => {
        await service.whenReady(C1)
        mountList()
        click(update())
        live().desc += ' edited'
        click(part('studio-toggle-uses-undo'))
        expect(part('studio-toggle-uses-error')?.textContent).toBe('studioTgUpdateUndoChanged(Alice)')
        expect(lore()).toBe(`lore ${B} ${DYNAMIC}`)
    })

    test('B6 an edit that moves a use between display and click writes nothing, refreshes the list and announces the recheck', async () => {
        await service.whenReady(C1)
        mountList()
        live().desc = `inserted ${live().desc}`
        click(update())
        expect(live().desc).toBe(`inserted start ${READ}`)
        expect(lore()).toBe(`lore ${READ} ${DYNAMIC}`)
        expect(announced).toEqual(['studioTgUpdateRecheck'])
        expect(currentUpdate()).toBeNull()
        await drain()
        click(update())
        expect(live().desc).toBe(`inserted start ${B}`)
    })

    test('B7 the result line survives a remount of the list in the same visit and still undoes', async () => {
        await service.whenReady(C1)
        mountList()
        click(update())
        for (const entry of mounted.splice(0)) {
            await unmount(entry.app)
            entry.host.remove()
        }
        mountList()
        expect(part('studio-toggle-uses-result')).not.toBeNull()
        click(part('studio-toggle-uses-undo'))
        expect(live().desc).toBe(`start ${READ}`)
    })
})

// The click task scans once (the run); the display refresh follows in the next task, and Update all stays disabled
// until a scan taken after the click has landed. The old list stays visible in the gap.
describe('the display scan after a click runs in the next task (D1)', () => {
    // Regression reproducer: before the change the click task also re-derived the list, a second scan.
    test('T6 the Update all click task scans once; the next task refreshes the list', async () => {
        fake.keepOnUpdate = true
        await service.whenReady(C1)
        mountList()
        h.scans = 0
        click(update())
        expect(h.scans).toBe(1)
        expect(texts('studio-toggle-uses-count')).not.toEqual([])
        await drain()
        expect(h.scans).toBe(2)
        expect(texts('studio-toggle-uses-count')).toEqual([])
    })

    // Compatibility guard (passes before and after): one scan per mount and one per Undo all click.
    test('T7 the mount scans once and an Undo all click scans once in its own task', async () => {
        fake.keepOnUpdate = true
        await service.whenReady(C1)
        mountList()
        expect(h.scans).toBe(1)
        click(update())
        await drain()
        h.scans = 0
        click(part('studio-toggle-uses-undo'))
        expect(h.scans).toBe(1)
        expect(live().desc).toBe(`start ${READ}`)
    })

    test('T8 after a stale click Update all is disabled until the refresh lands, and then a second click writes', async () => {
        fake.keepOnUpdate = true
        await service.whenReady(C1)
        mountList()
        live().desc = `inserted ${live().desc}`
        click(update())
        expect(announced).toEqual(['studioTgUpdateRecheck'])
        expect(update()?.disabled).toBe(true)
        expect(live().desc).toBe(`inserted start ${READ}`)
        expect(lore()).toBe(`lore ${READ} ${DYNAMIC}`)
        await drain()
        expect(update()?.disabled).toBe(false)
        click(update())
        expect(live().desc).toBe(`inserted start ${B}`)
    })

    // A refused Undo in the gap leaves the pending refresh alone, so the button is not stranded disabled. The fresh plan
    // counts one use: the appended READ in the character; the module's READ was rewritten and its regex pattern is only listed.
    test('T10 a refused Undo all in the gap writes nothing and the refresh still lands and re-enables Update all', async () => {
        fake.keepOnUpdate = true
        await service.whenReady(C1)
        mountList()
        click(update())
        live().desc += ` ${READ}`
        click(part('studio-toggle-uses-undo'))
        expect(part('studio-toggle-uses-error')?.textContent).toBe('studioTgUpdateUndoChanged(Alice)')
        expect(live().desc).toBe(`start ${B} ${READ}`)
        expect(update()?.disabled).toBe(true)
        await drain()
        expect(texts('studio-toggle-uses-count')).toEqual(['studioTgUsesWillChange(Alice,1)'])
        expect(update()?.disabled).toBe(false)
    })

    test('T11 an Undo all that lands in the gap refreshes the list itself: no extra scan from the pending refresh', async () => {
        fake.keepOnUpdate = true
        await service.whenReady(C1)
        mountList()
        h.scans = 0
        click(update())
        click(part('studio-toggle-uses-undo'))
        expect(live().desc).toBe(`start ${READ}`)
        await drain()
        expect(h.scans).toBe(2)
    })
})

describe('review rows for the list controls', () => {
    test('an owner whose only use sits in a source that defines the old key shows the skipped row and its tick, not None', async () => {
        seed('plain', [moduleRow('M1', READ, { customModuleToggle: 'a=A', regex: [] })])
        await service.whenReady(C1)
        mountList()
        expect(parts('studio-toggle-uses-listed')).toEqual([])
        expect(part('studio-toggle-uses-none')).toBeNull()
        expect(texts('studio-toggle-uses-skipped')).toHaveLength(1)
        expect(part('studio-toggle-uses-optin')).not.toBeNull()
        expect(update()).not.toBeNull()
        expect(update()?.disabled).toBe(true)
    })

    test('a read-only page disables the tick and, after an update, the result line Undo', async () => {
        seed(`start ${READ}`, [moduleRow('M1', READ, { customModuleToggle: 'a=A' })])
        await service.whenReady(C1)
        editable = false
        mountList()
        expect((part('studio-toggle-uses-optin') as HTMLInputElement).disabled).toBe(true)
        await unmountAllLists()

        editable = true
        mountList()
        click(update())
        await unmountAllLists()
        editable = false
        mountList()
        expect((part('studio-toggle-uses-undo') as HTMLButtonElement).disabled).toBe(true)
    })

    test('Undo all dismisses the update toast', async () => {
        await service.whenReady(C1)
        const host = mountList()
        click(update())
        expect(host.visible.length).toBe(1)
        click(part('studio-toggle-uses-undo'))
        expect(host.visible).toEqual([])
    })
})

describe('when Update all is off (B8)', () => {
    test('a page that is not editable disables it', async () => {
        await service.whenReady(C1)
        editable = false
        mountList()
        expect(update()?.disabled).toBe(true)
    })

    test('without a history service the button is disabled', async () => {
        await service.whenReady(C1)
        setStudioHistoryServiceForTests(null)
        mountList()
        expect(update()?.disabled).toBe(true)
    })

    test('a renamed key outside the allow-list blocks the plan: the note names it, every use keeps Open, nothing changes', async () => {
        await service.whenReady(C1)
        fake.renames = [{ from: 'a', to: 'mood:' }]
        mountList()
        expect(part('studio-toggle-uses-blocked')?.textContent).toBe('studioTgUsesKeyBlocked(mood:)')
        expect(update()?.disabled).toBe(true)
        expect(parts('studio-toggle-uses-open').length).toBeGreaterThan(0)
        expect(parts('studio-toggle-uses-count')).toEqual([])
        expect(parts('studio-toggle-uses-listed').every((row) => row.dataset.reason === 'blocked' || row.dataset.reason === 'regexPattern' || row.dataset.reason === 'dynamicName')).toBe(true)
        expect(live().desc).toBe(`start ${READ}`)
    })

    test('no uses at all shows the None text and no button; a regex pattern alone is a listed row, not None', async () => {
        seed('plain', [])
        await service.whenReady(C1)
        mountList()
        expect(part('studio-toggle-uses-none')?.textContent).toBe('studioTgUsesNone')
        expect(update()).toBeNull()

        const only = moduleRow('M1', 'plain')
        seed('plain', [only])
        fake.renames = [{ from: 'a', to: 'b' }]
        await unmountAllLists()
        mountList()
        expect(part('studio-toggle-uses-none')).toBeNull()
        expect(update()).not.toBeNull()
        expect(update()?.disabled).toBe(true)
    })

    test('Close shows for kept renames only and calls the builder', async () => {
        await service.whenReady(C1)
        mountList()
        expect(part('studio-toggle-uses-close')).toBeNull()
        await unmountAllLists()
        fake.kept = true
        mountList()
        click(part('studio-toggle-uses-close'))
        expect(fake.dismissed).toBe(1)
        expect(part('studio-toggle-uses')).toBeNull()
    })
})

async function unmountAllLists(): Promise<void> {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
}
