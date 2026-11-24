// @vitest-environment jsdom
/**
 * The read-only Studio detail mounted over a synthetic owner model. jsdom is used because the point is what the
 * DOM does with item text: it must arrive as text, never as markup. The stores, the module lister and the
 * locale are replaced; the owner source, the owner model and the screen store are real.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    listerOver,
    loreBody,
    makeCharacter,
    makeChat,
    makeInput,
    makePreset,
    makeTextCharacter,
    regexBody,
    residentModule,
    stubModule,
    studioDbOf,
    v2Scripts,
    watchBodyKeys,
} from '../../ts/studio/studioFixtures.test-helpers'

const db = $state({ db: {} as ReturnType<typeof studioDbOf> })
const selection = $state({ selId: 0 })
const ReloadGUIPointer = writable(0)
const MobileGUI = writable(false)
const settingsOpen = writable(false)
const CharConfigSubMenu = writable(0)
const SettingsMenuIndex = writable(-1)
const botMakerMode = writable(false)
const sideBarStore = writable(false)
const QuickSettings = $state({ open: true })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('../../ts/stores.svelte', () => ({
    get DBState() { return db },
    get selIdState() { return selection },
    get ReloadGUIPointer() { return ReloadGUIPointer },
    get MobileGUI() { return MobileGUI },
    get settingsOpen() { return settingsOpen },
    get CharConfigSubMenu() { return CharConfigSubMenu },
    get SettingsMenuIndex() { return SettingsMenuIndex },
    get botMakerMode() { return botMakerMode },
    get sideBarStore() { return sideBarStore },
    get QuickSettings() { return QuickSettings },
}))
vi.mock('../../ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
// The list page reaches the import, export and MCP code, which this suite does not exercise; it has its own suite.
vi.mock('./StudioModuleList.svelte', () => ({ default: () => {} }))
vi.mock('../../ts/process/moduleRefList', () => ({
    moduleListOf: (ids: string[]) => listerOver(db.db.modules)(ids),
    moduleRefIdsOf: () => db.db.modules.map((row) => row.id),
}))
vi.mock('../../ts/process/moduleLoader', () => ({ loadModuleStubsOf: async () => ({ kind: 'refused' }), loadModule: async () => null }))
vi.mock('../../lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    // The toggle builder's keys that take arguments answer with the key and its arguments.
    const withArguments = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const own: Record<string, unknown> = {}
    for (const key of ['studioTgDeleted', 'studioTgMoved', 'studioTgOptionN', 'studioTgSummarySelect', 'studioTgSummaryGroup', 'studioTgUnreadableCount', 'studioTgLineN']) own[key] = withArguments(key)
    return { language: new Proxy(base, { get: (target, key) => typeof key === 'string' && key in own ? own[key] : Reflect.get(target, key) }) }
})

import type { loreBook } from '../../ts/storage/database.svelte'
import type { SaveAck } from '../../ts/studio/edit/saveAck.svelte'
import type { OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import {
    resetStudioHistoryAccessorForTests,
    setStudioHistoryServiceForTests,
    setStudioVisitAckForTests,
} from '../../ts/studio/history/studioHistoryService.svelte'
import { closeStudio, openStudio, resetStudioScreenForTests, studioScreen } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import { studioOpen } from '../../ts/studio/studioOpen'
import StudioDetail from './StudioDetail.svelte'

const MARKUP = '<img src=x onerror="window.__studioProbe = 1"> <b>bold</b>'

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined

function setDb(overrides: Parameters<typeof makeCharacter>[0] = {}, withModules = false): void {
    db.db = studioDbOf(makeInput({
        character: makeCharacter({
            chats: [makeChat({ id: 'chat-1', name: 'First chat' })],
            ...overrides,
        }),
        modules: withModules ? [residentModule('res'), stubModule('stub')] : [],
    }))
}

function show(): void {
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(StudioDetail, { target: host })
    flushSync()
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const loreItem = (index: number) => `cha-1/lore:${index}`
const loreTarget = (index: number) => ({ owner: { type: 'character', id: 'cha-1' }, kind: 'lore', item: loreItem(index), from: 'chat' }) as const

// The history service and the visit's ack are stand-ins here: this suite is about what the detail mounts, and the
// forms have their own suite over the real service.
const history = {
    useOwner: [] as string[],
    setAck: [] as [string, unknown][],
    closeOpenStep: [] as string[],
}
const stubAck = { display: 'saved', canRetry: () => false, retry: () => false, noteEdit: () => {}, dispose: () => {} } as unknown as SaveAck

function installHistoryStub(): void {
    history.useOwner = []
    history.setAck = []
    history.closeOpenStep = []
    setStudioHistoryServiceForTests({
        useOwner: (owner: string) => { history.useOwner.push(owner) },
        setAck: (chaId: string, ack: unknown) => { history.setAck.push([chaId, ack]) },
        closeOpenStep: (owner: string) => { history.closeOpenStep.push(owner) },
        view: (owner: string) => ({
            ownerKey: owner, phase: 'ready', banner: null, restricted: false, editable: true, persisted: true,
            done: [], undone: [], deleted: [], restore: null,
        }),
    } as unknown as OwnerHistoryService)
    setStudioVisitAckForTests(stubAck)
}

beforeEach(() => {
    localStorage.clear()
    resetStudioScreenForTests()
    settingsOpen.set(false)
    MobileGUI.set(false)
    CharConfigSubMenu.set(0)
    SettingsMenuIndex.set(-1)
    selection.selId = 0
    setStudioEnabled(true)
    installHistoryStub()
    ;(window as unknown as { __studioProbe?: number }).__studioProbe = undefined
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    host = undefined
    resetStudioHistoryAccessorForTests()
    resetStudioScreenForTests()
    setStudioEnabled(false)
    localStorage.clear()
})

describe('4d item text is plain text', () => {
    test('markup in an item name renders as characters, never as elements', () => {
        setDb({ globalLore: [loreBody('Castle', MARKUP)] })
        openStudio(loreTarget(0), null)
        show()
        const text = part('studio-detail-text')
        expect(text?.textContent).toBe(MARKUP)
        expect(document.querySelector('img')).toBeNull()
        expect(text?.querySelector('b')).toBeNull()
        expect((window as unknown as { __studioProbe?: number }).__studioProbe).toBeUndefined()
        expect(part('studio-detail-truncated')).toBeNull()
    })

    test('text longer than 2000 characters is cut with a notice', () => {
        setDb({ globalLore: [loreBody('Castle', 'x'.repeat(2500))] })
        openStudio(loreTarget(0), null)
        show()
        expect(part('studio-detail-text')?.textContent?.length).toBe(2000)
        expect(part('studio-detail-truncated')?.textContent).toBe('studioTruncated(2000)')
    })

    test('text of exactly 2000 characters is shown whole', () => {
        setDb({ globalLore: [loreBody('Castle', 'y'.repeat(2000))] })
        openStudio(loreTarget(0), null)
        show()
        expect(part('studio-detail-text')?.textContent?.length).toBe(2000)
        expect(part('studio-detail-truncated')).toBeNull()
    })

    test('the cut does not split a surrogate pair', () => {
        setDb({ globalLore: [loreBody('Castle', `${'a'.repeat(1999)}\u{1F600}${'b'.repeat(10)}`)] })
        openStudio(loreTarget(0), null)
        show()
        const shown = part('studio-detail-text')?.textContent ?? ''
        expect(shown).toBe('a'.repeat(1999))
    })
})

function setFull(input: ReturnType<typeof makeInput>): void {
    db.db = studioDbOf(input)
}

const ownerItem = (type: 'character' | 'chat' | 'module' | 'preset', id: string, kind: string, itemId: string) =>
    ({ owner: { type, id }, kind, item: itemId, from: 'chat' }) as const

const luaScripts = [{ effect: [{ type: 'triggerlua', code: 'print("lua-body")' }] }]

// A chat's lore entry as the app stores it; the owner model's own type only names the fields it lists.
function chatLore(content: string) {
    return { comment: 'chat entry', key: 'k', content }
}

describe('4d text of each kind of the bound character', () => {
    const character = () => makeTextCharacter({
        chats: [makeChat({ id: 'chat-1', name: 'First chat' })],
        globalLore: [loreBody('Castle', 'LORE-BODY')],
        customscript: [regexBody('Fix', 'IN-PATTERN', 'OUT-TEXT')],
        triggerscript: luaScripts,
        customModuleToggle: 'TOGGLE-DEF',
        backgroundHTML: '<div>BACKGROUND</div>',
        desc: 'DESC-TEXT',
        firstMessage: 'FIRST-TEXT',
        systemPrompt: 'SYSTEM-TEXT',
    })

    const cases: [string, string, string[]][] = [
        ['lore', 'cha-1/lore:0', ['LORE-BODY']],
        ['regex', 'cha-1/regex:0', ['IN-PATTERN', 'OUT-TEXT']],
        ['scripts', 'cha-1/scripts:0', ['print("lua-body")']],
        ['html', 'cha-1/html:0', ['<div>BACKGROUND</div>']],
        ['basic', 'cha-1/basic:0', ['DESC-TEXT', 'FIRST-TEXT']],
        ['advanced', 'cha-1/advanced:0', ['SYSTEM-TEXT']],
    ]

    test.each(cases)('%s shows its text', (kind, itemId, expected) => {
        setFull(makeInput({ character: character() }))
        openStudio(ownerItem('character', 'cha-1', kind, itemId), null)
        show()
        if (kind === 'html') {
            // The 배경 HTML kind has its own form: no read-only view of the text and no classic link.
            expect(part('studio-char-html-form')).not.toBeNull()
            expect(part('studio-detail-text')).toBeNull()
            expect(part('studio-detail-readonly')).toBeNull()
            expect(part('studio-detail-classic')).toBeNull()
            return
        }
        const shown = part('studio-detail-text')?.textContent ?? ''
        for (const piece of expected) expect(shown).toContain(piece)
        // The basic info and the advanced kind of the character have a live form, so the read-only note does not apply to them.
        expect(part('studio-detail-readonly') !== null).toBe(kind !== 'basic' && kind !== 'advanced')
        expect(part('studio-detail-classic')).not.toBeNull()
    })

    test('a trigger list that is not Lua shows its definition as text', () => {
        setFull(makeInput({ character: makeCharacter({ triggerscript: v2Scripts, chats: [makeChat({ id: 'chat-1', name: 'First chat' })] }) }))
        openStudio(ownerItem('character', 'cha-1', 'scripts', 'cha-1/scripts:0'), null)
        show()
        expect(part('studio-detail-text')?.textContent).toContain('v2Header')
    })

    test('regex text with markup stays text', () => {
        setFull(makeInput({ character: makeCharacter({ customscript: [regexBody('Fix', MARKUP, MARKUP)], chats: [makeChat({ id: 'chat-1', name: 'First chat' })] }) }))
        openStudio(ownerItem('character', 'cha-1', 'regex', 'cha-1/regex:0'), null)
        show()
        expect(document.querySelector('img')).toBeNull()
        expect(part('studio-detail-text')?.querySelector('b')).toBeNull()
        expect((window as unknown as { __studioProbe?: number }).__studioProbe).toBeUndefined()
        expect(part('studio-detail-text')?.textContent).toContain(MARKUP)
    })

    test('reading the text writes nothing', () => {
        setFull(makeInput({ character: character() }))
        const before = JSON.stringify(db.db)
        openStudio(ownerItem('character', 'cha-1', 'lore', 'cha-1/lore:0'), null)
        show()
        expect(JSON.stringify(db.db)).toBe(before)
    })
})

describe('4d text of the chat, a resident module and a preset', () => {
    test('the chat lore shows its content', () => {
        setFull(makeInput({
            character: makeCharacter({ chats: [makeChat({ id: 'chat-1', name: 'First chat', localLore: [chatLore('CHAT-LORE-BODY')] })] }),
        }))
        openStudio(ownerItem('chat', 'chat-1', 'lore', 'chat-1/lore:0'), null)
        show()
        expect(part('studio-detail-text')?.textContent).toContain('CHAT-LORE-BODY')
    })

    const moduleCases: [string, string, string][] = [
        ['lore', 'res/lore:0', 'MODULE-LORE'],
        ['regex', 'res/regex:0', 'MODULE-IN'],
        ['scripts', 'res/scripts:0', 'module-lua'],
    ]

    test.each(moduleCases)('a resident module %s shows its text', (kind, itemId, expected) => {
        setFull(makeInput({
            character: makeCharacter({ modules: ['res'], chats: [makeChat({ id: 'chat-1', name: 'First chat' })] }),
            modules: [residentModule('res', {
                lorebook: [{ key: 'k', secondkey: '', insertorder: 1, comment: 'c', content: 'MODULE-LORE', mode: 'normal', alwaysActive: false, selective: false }],
                regex: [{ comment: 'r', in: 'MODULE-IN', out: 'MODULE-OUT', type: 'editdisplay' }],
                trigger: [{ comment: 't', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: 'module-lua' }] }],
                customModuleToggle: 'MODULE-TOGGLE',
                backgroundEmbedding: 'MODULE-HTML',
            })],
        }))
        openStudio(ownerItem('module', 'res', kind, itemId), null)
        show()
        expect(part('studio-detail-text')?.textContent).toContain(expected)
    })

    test('the active preset shows its working regex and toggles', () => {
        setFull(makeInput({
            presets: [makePreset('P0', { regex: [regexBody('pr', 'PRESET-IN', 'PRESET-OUT')], toggles: 'PRESET-TOGGLE' })],
            activePreset: 0,
        }))
        openStudio(ownerItem('preset', '0', 'regex', '0/regex:0'), null)
        show()
        expect(part('studio-detail-text')?.textContent).toContain('PRESET-IN')
    })

    test('an unloaded module shows the not-loaded line and its body is never read', async () => {
        const reads: string[] = []
        setFull(makeInput({ modules: [watchBodyKeys(stubModule('stub'), reads)] }))
        openStudio({ owner: { type: 'module', id: 'stub' }, from: 'chat' }, null)
        show()
        await vi.dynamicImportSettled()
        await Promise.resolve()
        flushSync()
        expect(part('studio-detail-notloaded')?.textContent).toBe('studioNotLoaded')
        expect(part('studio-detail-text')).toBeNull()
        expect(reads).toEqual([])
    })
})

describe('4d the private licence', () => {
    test('a private character shows no content of the character or its chat', async () => {
        setFull(makeInput({
            character: makeTextCharacter({
                license: 'private',
                globalLore: [loreBody('Castle', 'SECRET-LORE')],
                desc: 'SECRET-DESC',
                chats: [makeChat({ id: 'chat-1', name: 'First chat', localLore: [chatLore('SECRET-CHAT-LORE')] })],
            }),
        }))
        for (const target of [
            ownerItem('character', 'cha-1', 'lore', 'cha-1/lore:0'),
            ownerItem('chat', 'chat-1', 'lore', 'chat-1/lore:0'),
            { owner: { type: 'character', id: 'cha-1' }, from: 'chat' } as const,
        ]) {
            openStudio(target, null)
            show()
            expect(part('studio-detail-text')).toBeNull()
            expect(document.body.textContent).not.toContain('SECRET')
            expect(part('studio-detail-classic')).toBeNull()
            await unmount(app!)
            app = undefined
            host?.remove()
            host = undefined
        }
    })
})

describe('4d the combined view in the detail', () => {
    test('a combined selection shows the list read-only, and opening a row shows that item', () => {
        setFull(makeInput({
            character: makeCharacter({
                chats: [makeChat({ id: 'chat-1', name: 'First chat' })],
                customscript: [regexBody('Fix', 'COMBINED-IN', 'COMBINED-OUT')],
            }),
        }))
        openStudio({ from: 'chat' }, null)
        studioScreen.targetPending = false
        studioScreen.selectedOwnerKey = 'combined:regex'
        studioScreen.selectedKind = 'regex'
        show()
        expect(part('studio-combined')?.getAttribute('data-kind')).toBe('regex')
        expect(part('studio-detail-readonly')).not.toBeNull()
        expect(part('studio-detail-classic')).toBeNull()
        document.querySelector<HTMLElement>('[data-part="studio-combined-row"]')?.click()
        flushSync()
        expect(part('studio-combined')).toBeNull()
        expect(part('studio-detail-text')?.textContent).toContain('COMBINED-IN')
    })
})

describe('4d what the detail shows', () => {
    test('an owner with nothing chosen shows its name and the read-only note', () => {
        setDb()
        openStudio({ owner: { type: 'character', id: 'cha-1' }, from: 'chat' }, null)
        show()
        expect(part('studio-detail-title')?.textContent).toBe('Alice')
        expect(part('studio-detail-readonly')).not.toBeNull()
        expect(part('studio-detail-text')).toBeNull()
    })

    test('a private character shows only the not-allowed line', () => {
        setDb({ license: 'private' })
        openStudio({ owner: { type: 'character', id: 'cha-1' }, from: 'chat' }, null)
        show()
        expect(part('studio-detail-private')).not.toBeNull()
        expect(part('studio-detail-classic')).toBeNull()
        expect(part('studio-detail-text')).toBeNull()
    })

    test('before the model has a selection the pane is empty', () => {
        setDb()
        openStudio({ from: 'chat' }, null)
        show()
        expect(part('studio-detail-title')).toBeNull()
    })
})

describe('4e notices for a target that cannot be honoured', () => {
    test('an unknown owner leaves a not-found notice', () => {
        setDb()
        openStudio({ owner: { type: 'module', id: 'missing' }, from: 'chat' }, null)
        show()
        expect(studioScreen.notice).toBe('studioNotFound')
        expect(studioScreen.targetPending).toBe(false)
    })

    test('an unsupported kind opens the owner root with its notice', () => {
        setDb()
        openStudio({ owner: { type: 'chat', id: 'chat-1' }, kind: 'regex', from: 'chat' }, null)
        show()
        expect(studioScreen.notice).toBe('studioDeepKindFallback(First chat)')
        expect(studioScreen.selectedOwnerKey).toBe('chat:chat-1')
        expect(studioScreen.selectedKind).toBeNull()
    })

    test('a missing item opens its kind with its notice', () => {
        setDb()
        openStudio(loreTarget(9), null)
        show()
        expect(studioScreen.notice).toBe('studioDeepItemMissing(studioKindLore)')
        expect(studioScreen.selectedKind).toBe('lore')
        expect(studioScreen.selectedItemId).toBeNull()
    })

    const entryTarget = (owner: { type: 'character' | 'module', id: string }, entry: string) => ({ owner, kind: 'lore', entry, from: 'chat' }) as const
    const idEntry = (id: string, comment: string): loreBook => ({ id, comment, key: `${comment}-key`, secondkey: '', insertorder: 100, content: `${comment} body`, mode: 'normal', alwaysActive: false, selective: false })

    test('regression reproducer: an entry named by id opens at its present place, with no notice', () => {
        setDb({ globalLore: [idEntry('new', 'Newer'), idEntry('shared', 'Twin A'), idEntry('wanted', 'Renamed')] })
        openStudio(entryTarget({ type: 'character', id: 'cha-1' }, 'wanted'), null)
        show()
        expect(studioScreen.notice).toBeNull()
        expect(studioScreen.selectedKind).toBe('lore')
        expect(studioScreen.selectedItemId).toBe(loreItem(2))
    })

    test('regression reproducer: a module entry named by id opens in its module', () => {
        const lorebook = [idEntry('m-a', 'Mod A'), idEntry('m-b', 'Mod B')]
        db.db = studioDbOf(makeInput({
            character: makeCharacter({ chats: [makeChat({ id: 'chat-1', name: 'First chat' })] }),
            modules: [residentModule('mod-1', { lorebook })],
            enabledModules: ['mod-1'],
        }))
        openStudio(entryTarget({ type: 'module', id: 'mod-1' }, 'm-b'), null)
        show()
        expect(studioScreen.notice).toBeNull()
        expect(studioScreen.selectedItemId).toBe('mod-1/lore:1')
    })

    for (const entry of ['vanished', 'shared']) {
        test(`regression reproducer: a ${entry} entry id opens the list with the entry-gone notice`, () => {
            setDb({ globalLore: [idEntry('shared', 'Twin A'), idEntry('shared', 'Twin B')] })
            openStudio(entryTarget({ type: 'character', id: 'cha-1' }, entry), null)
            show()
            expect(studioScreen.notice).toBe('studioLoreEntryGone')
            expect(studioScreen.selectedKind).toBe('lore')
            expect(studioScreen.selectedItemId).toBeNull()
        })
    }
})

describe('4e link-outs from the detail', () => {
    test('the classic button closes Studio and opens the lorebook tab', () => {
        setDb({ globalLore: [{ comment: 'Castle', key: 'k', mode: 'normal' }] })
        openStudio(loreTarget(0), null)
        show()
        part('studio-detail-classic')?.click()
        flushSync()
        expect(get(studioOpen)).toBe(false)
        expect(get(CharConfigSubMenu)).toBe(3)
        expect(get(botMakerMode)).toBe(true)
    })

    // T9-STUB-LINK
    test('an unloaded module shows the stub fields only and links to the module list, not to Modules settings', async () => {
        setDb({}, true)
        openStudio({ owner: { type: 'module', id: 'stub' }, from: 'chat' }, null)
        show()
        await vi.dynamicImportSettled()
        await Promise.resolve()
        flushSync()
        expect(part('studio-detail-title')?.textContent).toBe('Module stub')
        expect(part('studio-detail-text')).toBeNull()
        expect(part('studio-detail-classic')).toBeNull()
        expect(part('studio-module-show-in-list')?.textContent?.trim()).toBe('studioShowInModuleList')
        part('studio-module-show-in-list')?.click()
        flushSync()
        expect(studioScreen.selectedOwnerKey).toBe('list:modules')
        expect(studioScreen.revealListRow).toBe(JSON.stringify(['m', 'stub', 0]))
        expect(get(settingsOpen)).toBe(false)
        expect(get(SettingsMenuIndex)).toBe(-1)
        expect(get(studioOpen)).toBe(true)
    })

    // T9-CLASSIC-KEEP: compatibility guard, passes before and after.
    test('a loaded module keeps the classic link as the interim route', async () => {
        setDb({}, true)
        openStudio({ owner: { type: 'module', id: 'res' }, from: 'chat' }, null)
        show()
        await vi.dynamicImportSettled()
        await Promise.resolve()
        flushSync()
        expect(part('studio-detail-classic')?.textContent?.trim()).toBe('studioOpenClassic')
    })
})

describe('the live forms and the save chip in the detail', () => {
    const basicTarget = ownerItem('character', 'cha-1', 'basic', 'cha-1/basic:0')

    test('the basic info of the character mounts its form and the chip, and drops the read-only note', () => {
        setDb()
        openStudio(basicTarget, null)
        show()
        flushSync()
        expect(part('studio-character-form')).not.toBeNull()
        expect(part('studio-chat-note-form')).toBeNull()
        expect(part('studio-chip-text')?.textContent).toBe('studioChipSaved')
        expect(part('studio-detail-readonly')).toBeNull()
        expect(part('studio-detail-classic')).not.toBeNull()
        expect(history.useOwner).toEqual(['character:cha-1'])
        expect(history.setAck).toEqual([['cha-1', stubAck]])
    })

    test('other kinds of the character and the bare character keep the read-only note and have no form', () => {
        setDb({ globalLore: [loreBody('Castle', 'LORE-BODY')] })
        openStudio(loreTarget(0), null)
        show()
        flushSync()
        expect(part('studio-character-form')).toBeNull()
        expect(part('studio-chat-note-form')).toBeNull()
        expect(part('studio-chip')).toBeNull()
        expect(part('studio-detail-readonly')).not.toBeNull()
        expect(history.useOwner).toEqual([])
    })

    test('the chat owner mounts the note form and the chip; a kind of the chat does not', async () => {
        setDb({ chats: [makeChat({ id: 'chat-1', name: 'First chat', localLore: [chatLore('CHAT-LORE-BODY')] })] })
        openStudio({ owner: { type: 'chat', id: 'chat-1' }, from: 'chat' }, null)
        show()
        flushSync()
        expect(part('studio-chat-note-form')).not.toBeNull()
        expect(part('studio-character-form')).toBeNull()
        expect(part('studio-chip')).not.toBeNull()
        expect(part('studio-detail-readonly')).toBeNull()
        expect(history.useOwner).toEqual(['chat:cha-1/chat-1'])
        await unmount(app!)
        app = undefined
        host?.remove()
        openStudio(ownerItem('chat', 'chat-1', 'lore', 'chat-1/lore:0'), null)
        show()
        flushSync()
        expect(part('studio-chat-note-form')).toBeNull()
        expect(part('studio-chip')).toBeNull()
        expect(part('studio-detail-readonly')).not.toBeNull()
    })

    test('a private character gets no form, no chip and no history owner', () => {
        setDb({ license: 'private' })
        openStudio(basicTarget, null)
        show()
        flushSync()
        expect(part('studio-character-form')).toBeNull()
        expect(part('studio-chat-note-form')).toBeNull()
        expect(part('studio-chip')).toBeNull()
        expect(history.useOwner).toEqual([])
    })

    test('X-14 the advanced kind of the character mounts the example form and the chip, no chat-note form and no read-only note', () => {
        setFull(makeInput({ character: makeTextCharacter({ chats: [makeChat({ id: 'chat-1', name: 'First chat' })], exampleMessage: '<START>\nA' }) }))
        openStudio(ownerItem('character', 'cha-1', 'advanced', 'cha-1/advanced:0'), null)
        show()
        flushSync()
        expect(part('studio-example-form')).not.toBeNull()
        expect(part('studio-chat-note-form')).toBeNull()
        expect(part('studio-character-form')).toBeNull()
        expect(part('studio-chip-text')?.textContent).toBe('studioChipSaved')
        expect(part('studio-detail-readonly')).toBeNull()
        expect(part('studio-detail-classic')).not.toBeNull()
        // The example form and the two advanced sections each begin the visit; beginning it is idempotent in the service.
        expect(history.useOwner).toEqual(['character:cha-1', 'character:cha-1', 'character:cha-1'])
    })

    test('X-14 a private character gets no example form', () => {
        setDb({ license: 'private' })
        openStudio(ownerItem('character', 'cha-1', 'advanced', 'cha-1/advanced:0'), null)
        show()
        flushSync()
        expect(part('studio-example-form')).toBeNull()
        expect(history.useOwner).toEqual([])
    })

    test('X-14 the advanced kind of a module mounts the module form, no example form and no read-only note', () => {
        setFull(makeInput({
            character: makeCharacter({ modules: ['res'], chats: [makeChat({ id: 'chat-1', name: 'First chat' })] }),
            modules: [residentModule('res')],
            presets: [makePreset('P0')],
            activePreset: 0,
        }))
        openStudio(ownerItem('module', 'res', 'advanced', 'res/advanced:0'), null)
        show()
        flushSync()
        expect(part('studio-example-form')).toBeNull()
        expect(part('studio-detail-readonly')).toBeNull()
        expect(part('studio-module-advanced-form')).not.toBeNull()
        expect(part('studio-chat-note-form')).toBeNull()
        expect(history.useOwner).toEqual(['module:res'])
    })

    test('X-14 the advanced kind of a preset keeps the read-only note and mounts no example form', () => {
        setFull(makeInput({ presets: [makePreset('P0')], activePreset: 0 }))
        openStudio(ownerItem('preset', '0', 'advanced', '0/advanced:0'), null)
        show()
        flushSync()
        expect(part('studio-example-form')).toBeNull()
        expect(part('studio-detail-readonly')).not.toBeNull()
        expect(history.useOwner).toEqual([])
    })

    test('a module owner gets no form even on its basic-looking kinds', () => {
        setDb({}, true)
        openStudio({ owner: { type: 'module', id: 'res' }, from: 'chat' }, null)
        show()
        flushSync()
        expect(part('studio-character-form')).toBeNull()
        expect(part('studio-chat-note-form')).toBeNull()
        expect(part('studio-chip')).toBeNull()
    })

    test('a second open while Studio is open starts a new visit: the form is built again and the ack is handed over again', () => {
        setDb()
        openStudio(basicTarget, null)
        show()
        flushSync()
        const first = part('studio-character-form')
        const firstVisit = studioScreen.visitId
        expect(first).not.toBeNull()

        expect(openStudio(basicTarget, null)).toBe(true)
        flushSync()
        expect(studioScreen.visitId).not.toBe(firstVisit)
        const second = part('studio-character-form')
        expect(second).not.toBeNull()
        expect(second).not.toBe(first)
        expect(history.closeOpenStep).toContain('character:cha-1')
        expect(history.setAck.map(([, ack]) => ack)).toEqual([stubAck, null, stubAck])
    })

    test('closing the visit closes the open step and releases the ack', () => {
        setDb()
        openStudio(basicTarget, null)
        show()
        flushSync()
        expect(history.closeOpenStep).toEqual([])
        closeStudio()
        flushSync()
        expect(history.closeOpenStep).toContain('character:cha-1')
        expect(history.setAck.at(-1)).toEqual(['cha-1', null])
    })
})

describe('a selected owner that leaves the model', () => {
    test('a peer chat-page change drops the dangling selection and shows the not-found notice', () => {
        setDb({ chats: [makeChat({ id: 'chat-1', name: 'First chat' }), makeChat({ id: 'chat-2', name: 'Second chat' })] })
        openStudio({ owner: { type: 'chat', id: 'chat-1' }, from: 'chat' }, null)
        show()
        expect(studioScreen.selectedOwnerKey).not.toBeNull()
        expect(part('studio-detail-title')?.textContent).toBe('First chat')
        db.db.characters[0].chatPage = 1
        flushSync()
        expect(studioScreen.selectedOwnerKey).toBeNull()
        expect(studioScreen.notice).toBe('studioNotFound')
        expect(part('studio-detail-title')).toBeNull()
    })

    // Compatibility guard (T9-GONE-NOTFOUND): only a module owner gets the module-gone notice.
    test('T9-GONE-NOTFOUND: a chat owner that vanishes still clears with studioNotFound, never the module notice', () => {
        setDb({ chats: [makeChat({ id: 'chat-1', name: 'First chat' }), makeChat({ id: 'chat-2', name: 'Second chat' })] })
        openStudio({ owner: { type: 'chat', id: 'chat-1' }, from: 'chat' }, null)
        show()
        db.db.characters[0].chatPage = 1
        flushSync()
        expect(studioScreen.selectedOwnerKey).toBeNull()
        expect(studioScreen.notice).toBe('studioNotFound')
        expect(studioScreen.notice).not.toBe('studioRefusalModuleGone')
    })
    test('a selection that is still in the model is kept and raises no notice', () => {
        setDb({ chats: [makeChat({ id: 'chat-1', name: 'First chat' }), makeChat({ id: 'chat-2', name: 'Second chat' })] })
        openStudio({ owner: { type: 'character', id: 'cha-1' }, from: 'chat' }, null)
        show()
        db.db.characters[0].chatPage = 1
        flushSync()
        expect(studioScreen.selectedOwnerKey).not.toBeNull()
        expect(studioScreen.notice).toBeNull()
    })
})

describe('S3d1 the toggle builder in the detail', () => {
    const togglesTarget = ownerItem('character', 'cha-1', 'toggles', 'cha-1/toggles:0')

    test('the toggles of the character mount the list builder and the chip in place of the text dump and the read-only note', () => {
        setFull(makeInput({ character: makeTextCharacter({ chats: [makeChat({ id: 'chat-1', name: 'First chat' })], customModuleToggle: 'a=On\nb=Off\n' }) }))
        openStudio(togglesTarget, null)
        show()
        flushSync()
        expect(part('studio-toggle-builder')).not.toBeNull()
        expect(document.querySelectorAll('[data-part="studio-toggle-row"]')).toHaveLength(2)
        expect(part('studio-detail-text')).toBeNull()
        expect(part('studio-detail-readonly')).toBeNull()
        expect(part('studio-chip')).not.toBeNull()
        expect(part('studio-detail-classic')).not.toBeNull()
        expect(history.useOwner).toEqual(['character:cha-1'])
    })

    test('an empty definition shows the builder with its empty state, not the empty-kind line', () => {
        setFull(makeInput({ character: makeTextCharacter({ chats: [makeChat({ id: 'chat-1', name: 'First chat' })], customModuleToggle: '' }) }))
        openStudio(togglesTarget, null)
        show()
        flushSync()
        expect(part('studio-toggle-empty')).not.toBeNull()
        expect(document.body.textContent).not.toContain('studioEmptyKind')
    })

    test('opening the builder writes nothing', () => {
        setFull(makeInput({ character: makeTextCharacter({ chats: [makeChat({ id: 'chat-1', name: 'First chat' })], customModuleToggle: 'a=On\r\n' }) }))
        const before = JSON.stringify(db.db)
        openStudio(togglesTarget, null)
        show()
        flushSync()
        expect(JSON.stringify(db.db)).toBe(before)
    })

    test('the toggles of a resident module open the builder', () => {
        setFull(makeInput({
            character: makeCharacter({ modules: ['res'], chats: [makeChat({ id: 'chat-1', name: 'First chat' })] }),
            modules: [residentModule('res', { customModuleToggle: 'MODULE-TOGGLE' })],
            presets: [makePreset('P0', { toggles: 'PRESET-TOGGLE' })],
            activePreset: 0,
        }))
        openStudio(ownerItem('module', 'res', 'toggles', 'res/toggles:0'), null)
        show()
        expect(part('studio-toggle-builder')).not.toBeNull()
    })

    test('a private character shows no builder and none of its toggle text', () => {
        setFull(makeInput({ character: makeTextCharacter({ license: 'private', chats: [makeChat({ id: 'chat-1', name: 'First chat' })], customModuleToggle: 'SECRET-TOGGLE' }) }))
        openStudio(togglesTarget, null)
        show()
        flushSync()
        expect(part('studio-toggle-builder')).toBeNull()
        expect(document.body.textContent).not.toContain('SECRET')
    })
})

describe('CU-4 the combined branch of the detail by kind', () => {
    function showCombined(kind: 'toggles' | 'regex'): void {
        setFull(makeInput({
            character: makeCharacter({
                chats: [makeChat({ id: 'chat-1', name: 'First chat' })],
                customscript: [regexBody('Fix', 'COMBINED-IN', 'COMBINED-OUT')],
            }),
        }))
        openStudio({ from: 'chat' }, null)
        studioScreen.targetPending = false
        studioScreen.selectedOwnerKey = `combined:${kind}`
        studioScreen.selectedKind = kind
        show()
    }

    test('the combined toggles show the hint to open a source, not the read-only note, and the combined view itself', async () => {
        showCombined('toggles')
        await vi.waitFor(() => expect(part('studio-tg-combined')).not.toBeNull())
        expect(part('studio-combined')?.getAttribute('data-kind')).toBe('toggles')
        expect(part('studio-detail-readonly')?.textContent).toBe('studioTgCombinedHint')
        expect(document.body.textContent).not.toContain('studioReadOnlyNote')
    })

    test('the combined regex keeps the read-only note (compatibility guard; passes before and after)', () => {
        showCombined('regex')
        expect(part('studio-detail-readonly')?.textContent).toBe('studioReadOnlyNote')
        expect(document.body.textContent).not.toContain('studioTgCombinedHint')
    })
})

describe('T1-DT the advanced kind mounts the prompt, example and detail sections in that order', () => {
    const advancedTarget = ownerItem('character', 'cha-1', 'advanced', 'cha-1/advanced:0')

    test('the prompts section, the example form and the details section appear in that DOM order', () => {
        setFull(makeInput({ character: makeTextCharacter({ chats: [makeChat({ id: 'chat-1', name: 'First chat' })], exampleMessage: '<START>\nA' }) }))
        openStudio(advancedTarget, null)
        show()
        flushSync()
        const order = Array.from(document.querySelectorAll('[data-part="studio-advanced-form"], [data-part="studio-example-form"]')).map((element) => element.getAttribute('data-part') === 'studio-advanced-form' ? element.getAttribute('data-section') : 'example')
        expect(order).toEqual(['prompts', 'example', 'details'])
        expect(document.querySelectorAll('[data-part="studio-advanced-form"] [data-part="studio-form-banner"]')).toHaveLength(0)
    })

    test('the basic, display and chat kinds show no advanced form', () => {
        setFull(makeInput({ character: makeTextCharacter({ chats: [makeChat({ id: 'chat-1', name: 'First chat' })] }) }))
        for (const kind of ['basic', 'display']) {
            openStudio(ownerItem('character', 'cha-1', kind, `cha-1/${kind}:0`), null)
            show()
            flushSync()
            expect(part('studio-advanced-form'), kind).toBeNull()
        }
        openStudio({ owner: { type: 'chat', id: 'chat-1' }, from: 'chat' }, null)
        show()
        flushSync()
        expect(part('studio-advanced-form')).toBeNull()
    })
})