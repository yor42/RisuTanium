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
vi.mock('../../ts/process/moduleRefList', () => ({
    moduleListOf: (ids: string[]) => listerOver(db.db.modules)(ids),
}))
vi.mock('../../lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import { openStudio, resetStudioScreenForTests, studioScreen } from '../../ts/studio/studioScreen.svelte'
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

beforeEach(() => {
    localStorage.clear()
    resetStudioScreenForTests()
    settingsOpen.set(false)
    MobileGUI.set(false)
    CharConfigSubMenu.set(0)
    SettingsMenuIndex.set(-1)
    selection.selId = 0
    setStudioEnabled(true)
    ;(window as unknown as { __studioProbe?: number }).__studioProbe = undefined
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    host = undefined
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
        ['toggles', 'cha-1/toggles:0', ['TOGGLE-DEF']],
        ['html', 'cha-1/html:0', ['<div>BACKGROUND</div>']],
        ['basic', 'cha-1/basic:0', ['DESC-TEXT', 'FIRST-TEXT']],
        ['advanced', 'cha-1/advanced:0', ['SYSTEM-TEXT']],
    ]

    test.each(cases)('%s shows its text', (kind, itemId, expected) => {
        setFull(makeInput({ character: character() }))
        openStudio(ownerItem('character', 'cha-1', kind, itemId), null)
        show()
        const shown = part('studio-detail-text')?.textContent ?? ''
        for (const piece of expected) expect(shown).toContain(piece)
        expect(part('studio-detail-readonly')).not.toBeNull()
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
        ['toggles', 'res/toggles:0', 'MODULE-TOGGLE'],
        ['html', 'res/html:0', 'MODULE-HTML'],
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

    test('an unloaded module shows the not-loaded line and its body is never read', () => {
        const reads: string[] = []
        setFull(makeInput({ modules: [watchBodyKeys(stubModule('stub'), reads)] }))
        openStudio({ owner: { type: 'module', id: 'stub' }, from: 'chat' }, null)
        show()
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

    test('an unloaded module shows the stub fields only and links to Modules settings', () => {
        setDb({}, true)
        openStudio({ owner: { type: 'module', id: 'stub' }, from: 'chat' }, null)
        show()
        expect(part('studio-detail-title')?.textContent).toBe('Module stub')
        expect(part('studio-detail-text')).toBeNull()
        expect(part('studio-detail-classic')?.textContent?.trim()).toBe('studioOpenModules')
        part('studio-detail-classic')?.click()
        flushSync()
        expect(get(SettingsMenuIndex)).toBe(14)
        expect(get(settingsOpen)).toBe(true)
        expect(get(studioOpen)).toBe(false)
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
