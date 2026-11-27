// @vitest-environment jsdom
/**
 * A group visit in the Studio tree and detail, entered from each of the three entries (the entry row, the More menu
 * and the This-chat sheet): the visit lands on the group's form with no read-only fallback and no save chip, the tree
 * holds the group alone, and the two selections that bypass the model (the module list, a combined view) mount
 * nothing. The group fixture sits in a database with modules, presets and a plugin, so the group-only assertions are
 * not vacuous; the character control keeps the module list row, the combined group and both views. The stores and the
 * locale are replaced; the screen store, the owner source and model, the tree and the detail are real.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    listerOver,
    loreEntries,
    makeCharacter,
    makeChat,
    makeInput,
    makePlugin,
    makePreset,
    regexEntries,
    residentModule,
    studioDbOf,
} from '../../ts/studio/studioFixtures.test-helpers'

const db = $state({ db: {} as Record<string, unknown> & { characters: Record<string, unknown>[], modules: never[] } })
const selection = $state({ selId: 0 })
const ReloadGUIPointer = writable(0)
const MobileGUI = writable(false)
const settingsOpen = writable(false)
const QuickSettings = $state({ open: true })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('../../ts/stores.svelte', () => ({
    get DBState() { return db },
    get selIdState() { return selection },
    get ReloadGUIPointer() { return ReloadGUIPointer },
    get MobileGUI() { return MobileGUI },
    get settingsOpen() { return settingsOpen },
    get QuickSettings() { return QuickSettings },
    CharConfigSubMenu: writable(0),
    SettingsMenuIndex: writable(-1),
    botMakerMode: writable(false),
    sideBarStore: writable(false),
    selectedCharID: writable(0),
    PlaygroundStore: writable(0),
    additionalHamburgerMenu: [],
    additionalChatMenu: [],
    alertStore: writable({ type: 'none', msg: '' }),
    bookmarkListOpen: writable(false),
    hypaV3ModalOpen: writable(false),
}))
vi.mock('../../ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('../../ts/process/moduleRefList', () => ({
    moduleListOf: (ids: string[]) => listerOver(db.db.modules as never)(ids),
    moduleRefIdsOf: () => (db.db.modules as { id: string }[]).map((row) => row.id),
}))
vi.mock('../../ts/process/moduleLoader', () => ({ loadModuleStubsOf: async () => ({ kind: 'refused' }), loadModule: async () => null }))
vi.mock('../../ts/process/moduleLorebookRepair', () => ({ lorebookRepairNeed: () => 'none' }))
// The list page reaches the import, export and MCP code, which this suite does not exercise.
const moduleListMounts = vi.hoisted(() => ({ count: 0 }))
vi.mock('./StudioModuleList.svelte', () => ({ default: () => { moduleListMounts.count += 1 } }))
vi.mock('../../ts/alert', () => ({ alertMd: vi.fn(), alertError: vi.fn(), showHypaV2Alert: vi.fn() }))
vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../ts/characters', () => ({ removeChatConfirmed: vi.fn(), exportChat: vi.fn() }))
vi.mock('../../ts/process/modules', () => ({ getModuleToggles: () => '' }))
vi.mock('../../ts/storage/database.svelte', () => ({ appVer: '1', getCurrentCharacter: () => undefined, getCurrentChat: () => undefined, getDatabase: () => db.db }))
vi.mock('../../ts/storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../../ts/globalApi.svelte', () => ({ aiWatermarkingLawApplies: () => false, getFileSrc: () => Promise.resolve(''), readImage: () => Promise.resolve(undefined), getSaveMarkCount: () => 0 }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => ({}) }))
vi.mock('../SideBars/CharConfig.svelte', () => ({ default: () => ({}) }))
vi.mock('../SideBars/DevTool.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})
vi.mock('src/lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import type { SaveAck } from '../../ts/studio/edit/saveAck.svelte'
import type { OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { readOwnerModel } from '../../ts/studio/ownerSource.svelte'
import { planSearch } from '../../ts/studio/studioSearch'
import { MODULE_LIST_KEY, openStudio, resetStudioScreenForTests, selectedHistoryOwner, studioScreen } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import { studioOpen } from '../../ts/studio/studioOpen'
import SidebarMoreMenu from '../ChatShell/sidebar/SidebarMoreMenu.svelte'
import ThisChatSheet from '../ChatShell/ThisChatSheet.svelte'
import { combinedKeyOf } from './StudioCombined.svelte'
import StudioDetail from './StudioDetail.svelte'
import StudioEntryRow from './StudioEntryRow.svelte'
import StudioTree from './StudioTree.svelte'

const GROUP = 'grp-1'
const CHARACTER = 'cha-1'

const mounted: ReturnType<typeof mount>[] = []
const hosts: HTMLElement[] = []

function host(): HTMLElement {
    const element = document.createElement('div')
    document.body.appendChild(element)
    hosts.push(element)
    return element
}

function put<T extends Record<string, unknown>>(component: Parameters<typeof mount>[0], props: T): void {
    mounted.push(mount(component, { target: host(), props } as never))
    flushSync()
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const rowOf = (id: string) => document.querySelector<HTMLElement>(`[data-row-id="${id}"]`)
const topRows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-part="studio-row"][aria-level="1"]'))

// The history service and the visit's ack are stand-ins: this suite is about what the detail mounts.
const stubAck = { display: 'saved', canRetry: () => false, retry: () => false, noteEdit: () => {}, dispose: () => {} } as unknown as SaveAck
function installHistoryStub(): void {
    setStudioHistoryServiceForTests({
        useOwner: () => {},
        setAck: () => {},
        closeOpenStep: () => {},
        view: (owner: string) => ({
            ownerKey: owner, phase: 'ready', banner: null, restricted: false, editable: true, persisted: true,
            done: [], undone: [], deleted: [], restore: null,
        }),
    } as unknown as OwnerHistoryService)
    setStudioVisitAckForTests(stubAck)
}

// The character has lore and regex, two modules, two presets and a plugin; the group is the second row.
function setDb(): void {
    const input = makeInput({
        character: makeCharacter({
            chaId: CHARACTER,
            globalLore: loreEntries(3),
            customscript: regexEntries(2),
            modules: ['res'],
            chats: [makeChat({ id: 'chat-1', name: 'First chat' })],
        }),
        modules: [residentModule('res'), residentModule('other')],
        presets: [makePreset('P0'), makePreset('P1')],
        activePreset: 0,
        plugins: [makePlugin('legacy', 1)],
    })
    const base = studioDbOf(input)
    db.db = {
        ...base,
        enableDevTools: false,
        username: 'User', personas: [], selectedPersona: 0, jailbreak: '', jailbreakToggle: false,
        promptTemplate: undefined, supaModelType: 'none', hanuraiEnable: false, hypav2: false, hypaV3: false, hypaMemory: false,
        showMenuHypaMemoryModal: false, globalChatVariables: {},
        characters: [base.characters[0], {
            chaId: GROUP, type: 'group', name: 'The group', chatPage: 0,
            chats: [{ id: 'g-chat', name: 'g', note: '', localLore: [], message: [{ role: 'user', data: 'hi', chatId: 'm1', time: 1000 }] }],
            characters: [CHARACTER], characterTalks: [4 / 6], characterActive: [true],
        }],
    } as never
    selection.selId = 1
}

beforeEach(() => {
    localStorage.clear()
    resetStudioScreenForTests()
    settingsOpen.set(false)
    MobileGUI.set(false)
    setStudioEnabled(true)
    setDb()
    installHistoryStub()
})

afterEach(async () => {
    while (mounted.length > 0) await unmount(mounted.pop() as ReturnType<typeof mount>)
    for (const element of hosts.splice(0)) element.remove()
    resetStudioHistoryAccessorForTests()
    resetStudioScreenForTests()
    setStudioEnabled(false)
    localStorage.clear()
})

// Mounts the detail and the tree over the visit an entry opened, after a flush.
async function mountVisit(): Promise<void> {
    await tick()
    put(StudioTree, {})
    put(StudioDetail, {})
    await tick()
    flushSync()
}

function expectGroupFormLanded(): void {
    expect(studioScreen.open).toBe(true)
    expect(get(studioOpen)).toBe(true)
    expect(studioScreen.chaId).toBe(GROUP)
    expect(part('studio-group-form')).not.toBeNull()
    expect(part('studio-detail-readonly')).toBeNull()
    expect(part('studio-chip')).toBeNull()
}

describe('T31 the three entries open the group on its form', () => {
    test('the entry row', async () => {
        put(StudioEntryRow, {})
        const button = part('studio-entry')
        expect(button).not.toBeNull()
        button?.click()
        await mountVisit()
        expectGroupFormLanded()
    })

    test('the More menu', async () => {
        const closed: string[] = []
        put(SidebarMoreMenu, { reseter: vi.fn(), onclose: () => { closed.push('closed') }, afterAction: vi.fn() })
        const button = part('more-studio')
        expect(button).not.toBeNull()
        button?.click()
        await mountVisit()
        expect(closed).toEqual(['closed'])
        expectGroupFormLanded()
    })

    test('the This-chat sheet', async () => {
        const group = db.db.characters[1] as { chats: unknown[] }
        const opener = document.createElement('button')
        document.body.appendChild(opener)
        hosts.push(opener)
        put(ThisChatSheet, {
            open: true,
            opener,
            background: [],
            target: { owner: group, chat: group.chats[0] },
            confirmDelete: async () => true,
            onpersona: vi.fn(),
            onmodules: vi.fn(),
            onremoved: vi.fn(),
            onclose: vi.fn(),
        })
        await tick()
        const button = part('this-chat-studio')
        expect(button).not.toBeNull()
        button?.click()
        await tick()
        await mountVisit()
        expectGroupFormLanded()
    })

    test('the visit lands on the group form with the group as the only top-level row', async () => {
        openStudio({ owner: { type: 'character', id: GROUP }, from: 'chat' }, null)
        await mountVisit()
        expectGroupFormLanded()
        const rows = topRows()
        expect(rows).toHaveLength(1)
        expect(rows[0].getAttribute('aria-setsize')).toBe('1')
        expect(rowOf(`o:group:${GROUP}`)).not.toBeNull()
        expect(rowOf('l:modules')).toBeNull()
        expect(rowOf('g:combined')).toBeNull()
        expect(rowOf('g:modules')).toBeNull()
        expect(rowOf('g:presets')).toBeNull()
        expect(rowOf('g:plugins')).toBeNull()
        expect(document.querySelectorAll('[data-row-kind="group"]')).toHaveLength(0)
    })

    test('a combined key or the module list key selected in a group visit mounts nothing', async () => {
        openStudio({ owner: { type: 'character', id: GROUP }, from: 'chat' }, null)
        await mountVisit()
        studioScreen.selectedOwnerKey = combinedKeyOf('lore')
        studioScreen.selectedKind = null
        flushSync()
        expect(part('studio-combined')).toBeNull()
        expect(part('studio-detail-readonly')).toBeNull()
        studioScreen.selectedOwnerKey = MODULE_LIST_KEY
        flushSync()
        await import('./StudioModuleList.svelte')
        await new Promise(resolve => setTimeout(resolve, 0))
        flushSync()
        expect(part('studio-module-list-load-failed')).toBeNull()
        expect(moduleListMounts.count).toBe(0)
        expect(part('studio-combined')).toBeNull()
    })

    test('the character control keeps the module list row, the combined group and the combined view', async () => {
        selection.selId = 0
        openStudio({ owner: { type: 'character', id: CHARACTER }, from: 'chat' }, null)
        await mountVisit()
        expect(rowOf('l:modules')).not.toBeNull()
        expect(rowOf('g:combined')).not.toBeNull()
        expect(rowOf('g:modules')).not.toBeNull()
        expect(topRows().length).toBeGreaterThan(1)
        expect(part('studio-group-form')).toBeNull()
        studioScreen.selectedOwnerKey = combinedKeyOf('lore')
        studioScreen.selectedKind = null
        flushSync()
        expect(part('studio-combined')).not.toBeNull()
    })
})

describe('T32 history owner and search in a group visit', () => {
    test('the selected group maps to its session owner key', async () => {
        openStudio({ owner: { type: 'character', id: GROUP }, from: 'chat' }, null)
        await mountVisit()
        expect(studioScreen.selectedOwnerKey).toBe(`group:${GROUP}`)
        expect(selectedHistoryOwner()).toBe(`group:${GROUP}`)
    })

    test('a character visit still maps to the character key', async () => {
        selection.selId = 0
        openStudio({ owner: { type: 'character', id: CHARACTER }, from: 'chat' }, null)
        await mountVisit()
        expect(selectedHistoryOwner()).toBe(`character:${CHARACTER}`)
    })

    test('search plans nothing from a module, preset or plugin in a group visit and does not throw', () => {
        const model = readOwnerModel(GROUP)
        expect(model).not.toBeNull()
        const plan = planSearch(model!)
        expect(plan.units.every((unit) => unit.owner.type === 'group')).toBe(true)
        expect(plan.unloaded).toBe(0)
    })
})
