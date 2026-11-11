// @vitest-environment jsdom
/**
 * Search and the on-only filter of the toggles panel (UI-S1b stage F3, TOGGLES_SPEC §6): the 120 ms debounce, the
 * one-jamo rule on Korean labels, folded sections that open for a hit and come back, the result line, the breadcrumb,
 * the no-result state, the Escape and Back layers and the reset on reopen. Mounts the REAL TogglesPanel, ToggleRow and
 * ShellSheet with the real scope accessors. Guards by construction: the controls are new.
 */
import { flushSync, mount, unmount } from 'svelte'
import { tickFake } from '../../ts/tests/svelteTick.test-helpers'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { Chat } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    mark: vi.fn(),
    modules: [] as { id: string, name: string, customModuleToggle?: string }[],
}))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    return {
        DBState: { get db() { return h.db } },
        selIdState: { selId: 0 },
        selectedCharID: store(0),
        ReloadGUIPointer: store(0),
    }
})
vi.mock('src/ts/storage/database.svelte', () => ({ appVer: '1', getCurrentCharacter: () => undefined, getCurrentChat: () => undefined, getDatabase: () => h.db }))
vi.mock('src/ts/globalApi.svelte', () => ({ aiWatermarkingLawApplies: () => false, getFileSrc: () => Promise.resolve(''), readImage: () => Promise.resolve(undefined) }))
vi.mock('src/ts/storage/characterSaveMarks', () => ({ markCharacterForSave: (chaId: string) => h.mark(chaId) }))
vi.mock('../../ts/storage/characterSaveMarks', () => ({ markCharacterForSave: (chaId: string) => h.mark(chaId) }))
vi.mock('src/ts/process/modules', () => ({
    getModuleToggles: () => h.modules.map((module) => module.customModuleToggle ?? '').join('\n'),
    getModules: () => h.modules,
}))
vi.mock('../../ts/process/modules', () => ({
    getModuleToggles: () => h.modules.map((module) => module.customModuleToggle ?? '').join('\n'),
    getModules: () => h.modules,
}))
vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
const languageMock = vi.hoisted(() => {
    const fns: Record<string, unknown> = {
        chatShellTogglesSummary: (n: number, on: number) => `sum:${n}:${on}`,
        chatShellTogglesOnA11y: (label: string) => `on:${label}`,
        chatShellTogglesOffA11y: (label: string) => `off:${label}`,
        chatShellTogglesMenu: (label: string) => `menu:${label}`,
        chatShellTogglesDupMismatch: (source: string) => `mismatch:${source}`,
        chatShellTogglesSameValue: (source: string) => `same:${source}`,
        chatShellTogglesTextSaved: (label: string) => `textsaved:${label}`,
        chatShellTogglesPicked: (label: string, value: string) => `picked:${label}:${value}`,
        chatShellTogglesResetDone: (label: string) => `resetdone:${label}`,
        chatShellTogglesRevertDone: (label: string) => `revertdone:${label}`,
        chatShellTogglesPickTitle: (label: string) => `picktitle:${label}`,
        chatShellTogglesEditTitle: (label: string) => `edittitle:${label}`,
        chatShellTogglesResults: (shown: number, total: number) => `results:${shown}:${total}`,
        chatShellTogglesCountLive: (shown: number) => `live:${shown}`,
        chatShellTogglesOption: (option: string) => `option:${option}`,
    }
    return { language: new Proxy({} as Record<string, unknown>, { get: (target, key) => key in target ? target[key as string] : key in fns ? fns[key as string] : String(key) }) }
})
vi.mock('src/lang', () => languageMock)
vi.mock('../../lang', () => languageMock)

import TogglesPanel from './TogglesPanel.svelte'
import { resetTogglePanelSession, sourceOpenChoice } from '../../ts/chatShell/togglePanel'
import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'

type Owner = { chaId: string, name: string, type: 'character', chatPage: number, chats: Chat[], customModuleToggle?: string }

const makeChat = (extra: Partial<Chat> = {}): Chat => ({ message: [], note: '', name: 'Harbour night', localLore: [], id: 'chat-1', ...extra }) as Chat

let mounted: ReturnType<typeof mount> | undefined
let owner: Owner
let chat: Chat
let opener: HTMLButtonElement
const view = $state({ open: true })
let onclose: Mock<() => void>

const sharedValues = () => h.db.globalChatVariables as Record<string, string>

function install(options: { prompt?: string, character?: string, modules?: typeof h.modules, chatExtra?: Partial<Chat>, shared?: Record<string, string> } = {}): void {
    chat = makeChat(options.chatExtra)
    owner = { chaId: 'char-a', name: 'Ari', type: 'character', chatPage: 0, chats: [chat], customModuleToggle: options.character }
    h.modules = options.modules ?? []
    h.db = {
        characters: [owner], customPromptTemplateToggle: options.prompt ?? '', globalChatVariables: { ...(options.shared ?? {}) },
        botPresets: [{ name: 'Preset One' }], botPresetsId: 0, jailbreakToggle: false,
    }
}

// More than 20 toggles in all, so only the first section starts open: 22 in the prompt, 2 + a group in a module, 1 on the character.
const filler = Array.from({ length: 20 }, (_, index) => `f${index}=Filler ${index}`).join('\n')
function installMany(shared: Record<string, string> = {}): void {
    install({
        prompt: `${filler}\ntone=서술 스타일=select=대담하게,차분하게\nscene=장면 카드`,
        modules: [{ id: 'm1', name: 'Cards', customModuleToggle: 'deck=Card deck\nextras=Extras=group\ninner=Inner switch\nend=end=groupEnd' }],
        character: 'plain=Plain',
        shared,
    })
}

async function show(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    view.open = true
    mounted = mount(TogglesPanel, {
        target,
        props: {
            get open() { return view.open },
            opener,
            target: { owner: owner as never, chat },
            onclose: () => { onclose(); view.open = false },
        },
    })
    flushSync()
    await tickFake()
    return target
}

const q = (target: ParentNode, selector: string) => target.querySelector<HTMLElement>(selector)
const all = (target: ParentNode, selector: string) => Array.from(target.querySelectorAll<HTMLElement>(selector))
const keys = (target: ParentNode) => all(target, '[data-part="toggle-row"]').map((element) => element.getAttribute('data-key'))
const sections = (target: ParentNode) => all(target, '[data-part="toggles-section"]').map((element) => element.getAttribute('data-source'))
const input = (target: ParentNode) => q(target, '[data-part="toggles-search-input"]') as HTMLInputElement
const chip = (target: ParentNode) => q(target, '[data-part="toggles-filter-chip"]') as HTMLButtonElement

function type(target: ParentNode, text: string): void {
    const field = input(target)
    field.value = text
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

async function settle(ms = 120): Promise<void> {
    vi.advanceTimersByTime(ms)
    flushSync()
    await tickFake()
}

async function escape(): Promise<void> {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    flushSync()
    await tickFake()
}

beforeEach(() => {
    vi.useFakeTimers()
    resetTogglePanelSession()
    resetBackHandlersForTests()
    h.mark.mockClear()
    onclose = vi.fn()
    opener = document.createElement('button')
    document.body.appendChild(opener)
})

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.replaceChildren()
    vi.useRealTimers()
})

describe('the search field and the debounce', () => {
    test('the list filters 120 ms after the last keystroke, not before', async () => {
        install({ prompt: 'a=Alpha\nb=Beta\nc=Gamma' })
        const target = await show()
        type(target, 'alp')
        await settle(119)
        expect(keys(target)).toEqual(['a', 'b', 'c'])
        await settle(1)
        expect(keys(target)).toEqual(['a'])
        type(target, 'alph')
        await settle(60)
        type(target, 'alpha')
        await settle(60)
        expect(keys(target)).toEqual(['a'])
        expect(h.mark).not.toHaveBeenCalled()
    })

    test('a key and an option label match, case-insensitively', async () => {
        install({ prompt: 'zz=Alpha\nb=Mode=select=Calm,Bold' })
        const target = await show()
        type(target, 'ZZ')
        await settle()
        expect(keys(target)).toEqual(['zz'])
        type(target, 'bold')
        await settle()
        expect(keys(target)).toEqual(['b'])
    })

    test('Korean labels: one jamo is the start of a word, two or more match anywhere', async () => {
        install({ prompt: 'a=서술 스타일\nb=아이템 목록\nc=대담하게' })
        const target = await show()
        type(target, 'ㅅ')
        await settle()
        expect(keys(target)).toEqual(['a'])
        type(target, 'ㅌ')
        await settle()
        expect(keys(target)).toEqual([])
        type(target, 'ㅌㅇ')
        await settle()
        expect(keys(target)).toEqual(['a'])
        type(target, 'ㅇㅌ')
        await settle()
        expect(keys(target)).toEqual(['b'])
        type(target, 'ㅇ')
        await settle()
        expect(keys(target)).toEqual(['b'])
    })

    test('searching writes no value and marks nothing', async () => {
        install({ prompt: 'a=Alpha' })
        const target = await show()
        type(target, 'alp')
        await settle()
        expect(sharedValues()).toEqual({})
        expect(h.mark).not.toHaveBeenCalled()
    })

    test('with no toggle anywhere there is no search field', async () => {
        install()
        const target = await show()
        expect(input(target)).toBeNull()
        expect(chip(target)).toBeNull()
    })
})

describe('sections while searching', () => {
    test('a folded section with a hit opens and folds back afterwards; the user choice is never rewritten', async () => {
        installMany()
        const target = await show()
        expect(sections(target)).toEqual(['prompt', 'module:m1', 'character:char-a'])
        expect(all(target, '[data-part="toggles-section-head"]').map((head) => head.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'false'])
        type(target, 'deck')
        await settle()
        expect(sections(target)).toEqual(['module:m1'])
        expect(keys(target)).toEqual(['deck'])
        expect(q(target, '[data-part="toggles-section-head"]')!.getAttribute('aria-expanded')).toBe('true')
        expect(sourceOpenChoice('module:m1')).toBeUndefined()
        type(target, '')
        await settle()
        expect(sections(target)).toEqual(['prompt', 'module:m1', 'character:char-a'])
        expect(all(target, '[data-part="toggles-section-head"]').map((head) => head.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'false'])
        expect(sourceOpenChoice('module:m1')).toBeUndefined()
    })

    test('a folded author group with a hit opens, and folds back afterwards', async () => {
        installMany()
        const target = await show()
        expect(keys(target)).not.toContain('inner')
        type(target, 'inner')
        await settle()
        expect(keys(target)).toEqual(['inner'])
        expect(q(target, '[data-part="toggles-group-head"]')!.getAttribute('aria-expanded')).toBe('true')
        // A tap on the group header while searching changes nothing, now or afterwards.
        q(target, '[data-part="toggles-group-head"]')!.click()
        flushSync()
        expect(keys(target)).toEqual(['inner'])
        type(target, '')
        await settle()
        expect(q(target, '[data-source="prompt"]')).not.toBeNull()
        expect(q(target, '[data-part="toggles-group-head"]')).toBeNull()
        q(target, '[data-source="module:m1"] [data-part="toggles-section-head"]')!.click()
        flushSync()
        expect(q(target, '[data-part="toggles-group-head"]')!.getAttribute('aria-expanded')).toBe('false')
        expect(keys(target)).not.toContain('inner')
    })

    test('headers are not collapsible while searching and their counts stay the section totals', async () => {
        installMany({ toggle_deck: '1' })
        const target = await show()
        type(target, 'deck')
        await settle()
        const head = q(target, '[data-part="toggles-section-head"]')!
        expect(head.getAttribute('aria-disabled')).toBe('true')
        expect(q(head, '[data-part="toggles-count"]')!.textContent).toBe('sum:2:1')
        head.click()
        flushSync()
        expect(keys(target)).toEqual(['deck'])
        expect(sourceOpenChoice('module:m1')).toBeUndefined()
        type(target, '')
        await settle()
        expect(q(target, '[data-source="prompt"] [data-part="toggles-section-head"]')!.getAttribute('aria-disabled')).toBeNull()
    })

    test('a group header keeps the total of its group while only matching rows show', async () => {
        install({ prompt: 'g=Style=group\nx1=First\nx2=Second\nend=end=groupEnd', shared: { toggle_x2: '1' } })
        const target = await show()
        type(target, 'second')
        await settle()
        expect(keys(target)).toEqual(['x2'])
        expect(q(target, '[data-part="toggles-group-head"] [data-part="toggles-count"]')!.textContent).toBe('sum:2:1')
    })
})

describe('result line, live count and the no-result state', () => {
    test('the result line counts unique keys and is there only while a search or the filter is active', async () => {
        install({ prompt: 'k=Shared\nonly=Only here', modules: [{ id: 'm1', name: 'M', customModuleToggle: 'k=Shared too' }] })
        const target = await show()
        expect(q(target, '[data-part="toggles-results"]')).toBeNull()
        type(target, 'shared')
        await settle()
        expect(q(target, '[data-part="toggles-results"]')!.textContent).toBe('results:1:2')
        type(target, '')
        await settle()
        expect(q(target, '[data-part="toggles-results"]')).toBeNull()
    })

    test('a polite status announces the shown count after the filter applies', async () => {
        install({ prompt: 'a=Alpha\nb=Alpine\nc=Gamma' })
        const target = await show()
        const live = q(target, '[data-part="toggles-live"]')!
        expect(live.getAttribute('aria-live')).toBe('polite')
        type(target, 'alp')
        expect(live.textContent).toBe('')
        await settle()
        expect(live.textContent).toBe('live:2')
        type(target, 'zzz')
        await settle()
        expect(live.textContent).toBe('chatShellTogglesNoMatch')
    })

    test('no result: the message offers Clear search and Turn off filter, each only while it applies', async () => {
        install({ prompt: 'a=Alpha' })
        const target = await show()
        type(target, 'zzz')
        await settle()
        expect(q(target, '[data-part="toggles-nomatch"]')!.textContent).toContain('chatShellTogglesNoMatch')
        expect(q(target, '[data-part="toggles-nomatch-clear"]')).not.toBeNull()
        expect(q(target, '[data-part="toggles-nomatch-filter-off"]')).toBeNull()
        chip(target).click()
        flushSync()
        expect(q(target, '[data-part="toggles-nomatch-filter-off"]')).not.toBeNull()
        q(target, '[data-part="toggles-nomatch-clear"]')!.click()
        flushSync()
        expect(input(target).value).toBe('')
        expect(q(target, '[data-part="toggles-nomatch"]')).not.toBeNull()
        expect(q(target, '[data-part="toggles-nomatch-clear"]')).toBeNull()
        q(target, '[data-part="toggles-nomatch-filter-off"]')!.click()
        flushSync()
        expect(q(target, '[data-part="toggles-nomatch"]')).toBeNull()
        expect(keys(target)).toEqual(['a'])
        expect(chip(target).getAttribute('aria-pressed')).toBe('false')
    })

    test('the clear button reacts at once and cancels a pending filter', async () => {
        install({ prompt: 'a=Alpha\nb=Beta' })
        const target = await show()
        expect(q(target, '[data-part="toggles-search-clear"]')!.hasAttribute('hidden')).toBe(true)
        type(target, 'alp')
        await settle()
        expect(keys(target)).toEqual(['a'])
        q(target, '[data-part="toggles-search-clear"]')!.click()
        flushSync()
        expect(keys(target)).toEqual(['a', 'b'])
        expect(input(target).value).toBe('')
        type(target, 'bet')
        q(target, '[data-part="toggles-search-clear"]')!.click()
        flushSync()
        await settle(300)
        expect(keys(target)).toEqual(['a', 'b'])
        expect(document.activeElement).toBe(input(target))
    })
})

describe('breadcrumb and option line', () => {
    test('a hit shows its section and group path; an option-only hit also names the option', async () => {
        installMany()
        const target = await show()
        type(target, 'inner')
        await settle()
        const crumb = q(target, '[data-part="toggles-crumb"]')!
        expect(crumb.textContent).toContain('Cards')
        expect(crumb.textContent).toContain('Extras')
        expect(q(target, '[data-part="toggles-crumb-option"]')).toBeNull()
        type(target, '대담')
        await settle()
        expect(keys(target)).toEqual(['tone'])
        expect(q(target, '[data-part="toggles-crumb-option"]')!.textContent).toBe('option:대담하게')
        type(target, '서술')
        await settle()
        expect(q(target, '[data-part="toggles-crumb-option"]')).toBeNull()
    })

    test('the on-only filter alone shows no breadcrumb', async () => {
        install({ prompt: 'a=Alpha', shared: { toggle_a: '1' } })
        const target = await show()
        chip(target).click()
        flushSync()
        expect(keys(target)).toEqual(['a'])
        expect(q(target, '[data-part="toggles-crumb"]')).toBeNull()
    })
})

describe('the on-only filter', () => {
    test('shows only rows that are on, keeps section headers with their totals and is a pressed toggle', async () => {
        install({
            prompt: 'a=Alpha\nb=Beta\nm=Mode=select=One,Two\nt=Say=text',
            character: 'c=Gamma',
            shared: { toggle_a: '1', toggle_m: '1', toggle_t: 'hi' },
        })
        const target = await show()
        expect(chip(target).getAttribute('aria-pressed')).toBe('false')
        chip(target).click()
        flushSync()
        expect(chip(target).getAttribute('aria-pressed')).toBe('true')
        expect(keys(target)).toEqual(['a', 'm', 't'])
        expect(sections(target)).toEqual(['prompt'])
        expect(q(target, '[data-part="toggles-count"]')!.textContent).toBe('sum:4:3')
        expect(q(target, '[data-part="toggles-results"]')!.textContent).toBe('results:3:5')
    })

    test('with the chat-only scope on, rows holding their own value show too', async () => {
        install({
            prompt: 'a=Alpha\nb=Beta\nc=Gamma',
            shared: { toggle_a: '1', toggle_c: '1' },
            chatExtra: { useLocallySetGlobalVariables: true, GLGlobalVariables: { toggle_a: '1', toggle_c: '0' } },
        })
        const target = await show()
        chip(target).click()
        flushSync()
        // a is on in the chat; c is off in the chat but holds its own value, which differs from the shared one; b holds none.
        expect(keys(target)).toEqual(['a', 'c'])
    })

    test('it combines with a search and follows a value that changes', async () => {
        install({ prompt: 'a=Alpha\nb=Alpine\nc=Gamma', shared: { toggle_a: '1' } })
        const target = await show()
        type(target, 'alp')
        await settle()
        chip(target).click()
        flushSync()
        expect(keys(target)).toEqual(['a'])
        ;(q(target, '[data-part="toggle-row"][data-key="a"] [data-part="toggle-switch"]') as HTMLInputElement).click()
        flushSync()
        expect(keys(target)).toEqual([])
    })
})

describe('Escape and Back layers (S8)', () => {
    test('Escape goes to the inline editor, then the search text, then the panel', async () => {
        install({ prompt: 'a=Say alpha\nt=Say=text', shared: { toggle_t: 'kept' } })
        const target = await show()
        type(target, 'say')
        await settle()
        expect(keys(target)).toEqual(['a', 't'])
        ;(q(target, '[data-part="toggle-row"][data-key="t"] [data-part="toggle-text-button"]') as HTMLButtonElement).click()
        flushSync()
        await tickFake()
        expect(q(target, '[data-part="toggle-text-input"]')).not.toBeNull()
        await escape()
        expect(q(target, '[data-part="toggle-text-input"]')).toBeNull()
        expect(input(target).value).toBe('say')
        expect(onclose).not.toHaveBeenCalled()
        await escape()
        expect(input(target).value).toBe('')
        expect(keys(target)).toEqual(['a', 't'])
        expect(onclose).not.toHaveBeenCalled()
        await escape()
        expect(onclose).toHaveBeenCalledOnce()
    })

    test('Escape cancels a pending filter before it applies', async () => {
        install({ prompt: 'a=Alpha\nb=Beta' })
        const target = await show()
        type(target, 'alp')
        await escape()
        await settle(300)
        expect(input(target).value).toBe('')
        expect(keys(target)).toEqual(['a', 'b'])
        expect(onclose).not.toHaveBeenCalled()
    })

    test('Escape with no search text and the filter on closes the panel: the filter is not a layer', async () => {
        install({ prompt: 'a=Alpha', shared: { toggle_a: '1' } })
        const target = await show()
        chip(target).click()
        flushSync()
        await escape()
        expect(onclose).toHaveBeenCalledOnce()
    })

    test('Back clears the search text first and closes the panel on the next press', async () => {
        install({ prompt: 'a=Alpha\nb=Beta' })
        const target = await show()
        type(target, 'alp')
        await settle()
        expect(dispatchBack()).toBe(true)
        flushSync()
        await tickFake()
        expect(input(target).value).toBe('')
        expect(keys(target)).toEqual(['a', 'b'])
        expect(onclose).not.toHaveBeenCalled()
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(onclose).toHaveBeenCalledOnce()
    })

    test('Back with an inline editor open closes only the editor, though a search is active', async () => {
        install({ prompt: 't=Say=text', shared: { toggle_t: 'kept' } })
        const target = await show()
        type(target, 'say')
        await settle()
        ;(q(target, '[data-part="toggle-text-button"]') as HTMLButtonElement).click()
        flushSync()
        await tickFake()
        expect(dispatchBack()).toBe(true)
        flushSync()
        await tickFake()
        expect(q(target, '[data-part="toggle-text-input"]')).toBeNull()
        expect(input(target).value).toBe('say')
        expect(dispatchBack()).toBe(true)
        flushSync()
        await tickFake()
        expect(input(target).value).toBe('')
        expect(onclose).not.toHaveBeenCalled()
    })
})

describe('reset on reopen', () => {
    test('search, filter and results start empty each time the panel opens', async () => {
        install({ prompt: 'a=Alpha\nb=Beta', shared: { toggle_a: '1' } })
        const target = await show()
        type(target, 'alp')
        await settle()
        chip(target).click()
        flushSync()
        view.open = false
        flushSync()
        await tickFake()
        view.open = true
        flushSync()
        await tickFake()
        expect(input(target).value).toBe('')
        expect(chip(target).getAttribute('aria-pressed')).toBe('false')
        expect(keys(target)).toEqual(['a', 'b'])
        expect(q(target, '[data-part="toggles-results"]')).toBeNull()
    })

    test('a filter still pending when the panel closes does not apply to the next opening', async () => {
        install({ prompt: 'a=Alpha\nb=Beta' })
        const target = await show()
        type(target, 'alp')
        view.open = false
        flushSync()
        await tickFake()
        view.open = true
        flushSync()
        await tickFake()
        await settle(300)
        expect(keys(target)).toEqual(['a', 'b'])
    })
})

describe('keyboard hint and the row-menu keys', () => {
    const originalMatchMedia = window.matchMedia
    afterEach(() => {
        window.matchMedia = originalMatchMedia
    })
    const stubPointer = (fine: boolean) => {
        window.matchMedia = ((query: string) => ({ matches: fine && query.includes('pointer: fine'), media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false, onchange: null })) as typeof window.matchMedia
    }

    test('the hint line shows for a fine pointer only', async () => {
        install({ prompt: 'a=Alpha' })
        stubPointer(false)
        let target = await show()
        expect(q(target, '[data-part="toggles-hint"]')).toBeNull()
        await unmount(mounted!)
        mounted = undefined
        document.body.replaceChildren()
        opener = document.createElement('button')
        document.body.appendChild(opener)
        stubPointer(true)
        target = await show()
        expect(q(target, '[data-part="toggles-hint"]')!.textContent).toBe('chatShellTogglesHint')
    })

    test('Shift+F10 on a row control opens that row menu, as the hint says', async () => {
        install({ prompt: 'a=Alpha\nb=Beta' })
        const target = await show()
        const control = q(target, '[data-part="toggle-row"][data-key="b"] [data-row-control]')!
        control.focus()
        control.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }))
        flushSync()
        await tickFake()
        expect(q(target, '[data-part="toggle-row"][data-key="b"] [data-part="toggle-menu"]')).not.toBeNull()
        expect(q(target, '[data-part="toggle-row"][data-key="a"] [data-part="toggle-menu"]')).toBeNull()
    })

    test('Right Arrow on a switch reaches the row menu button and Left Arrow comes back', async () => {
        install({ prompt: 'a=Alpha' })
        const target = await show()
        const control = q(target, '[data-part="toggle-row"][data-key="a"] [data-row-control]')!
        control.focus()
        control.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
        const button = q(target, '[data-part="toggle-row"][data-key="a"] [data-part="toggle-menu-button"]')!
        expect(document.activeElement).toBe(button)
        button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
        expect(document.activeElement).toBe(control)
    })

    test('Right Arrow inside a segmented control still moves between its options', async () => {
        install({ prompt: 'm=Mode=select=On,Off' })
        const target = await show()
        const first = q(target, '[data-part="toggle-select-option"]')!
        first.focus()
        first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
        // The list's own handler must not have moved the focus to the ⋯ button in the meantime.
        expect(document.activeElement).toBe(first)
        flushSync()
        await tickFake()
        expect(sharedValues().toggle_m).toBe('1')
        expect(document.activeElement?.getAttribute('data-part')).toBe('toggle-select-option')
    })
})
