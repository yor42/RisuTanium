// @vitest-environment jsdom
/**
 * The toggles panel (UI-S1b stage F2, TOGGLES_SPEC §2-§7): sections and counts, the control of each kind, Reset and
 * the shared-value revert, the inline and sheet editors, the frozen default-open set, duplicates and the polite
 * announcements. Guards by construction: the components are new. Mounts the REAL TogglesPanel, ToggleRow and ShellSheet
 * with the real scope accessors; the stores are plain objects and the save marks are a spy.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { tickFake } from '../../ts/tests/svelteTick.test-helpers'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { Chat } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    mark: vi.fn(),
    modules: [] as { id: string, name: string, customModuleToggle?: string }[],
    reload: undefined as undefined | { update: (fn: (n: number) => number) => void },
}))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    const reload = store(0)
    h.reload = reload
    return {
        DBState: { get db() { return h.db } },
        selIdState: { selId: 0 },
        selectedCharID: store(0),
        ReloadGUIPointer: reload,
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
    }
    return { language: new Proxy({} as Record<string, unknown>, { get: (target, key) => key in target ? target[key as string] : key in fns ? fns[key as string] : String(key) }) }
})
vi.mock('src/lang', () => languageMock)
vi.mock('../../lang', () => languageMock)

import { enterKeydown, imeEventSequence } from '../../ts/ime/tests/imeEventSequence'
import TogglesPanel from './TogglesPanel.svelte'
import { resetTogglePanelSession } from '../../ts/chatShell/togglePanel'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE } from '../../ts/storage/moduleStub'
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
const row = (target: ParentNode, key: string) => q(target, `[data-part="toggle-row"][data-key="${key}"]`)!
const status = (target: ParentNode) => q(target, '[data-part="toggles-announce"]')!.textContent
const menuOf = async (target: ParentNode, key: string) => {
    q(row(target, key), '[data-part="toggle-menu-button"]')!.click()
    flushSync()
    await tick()
}

beforeEach(() => {
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
})

describe('sections and counts (S6)', () => {
    test('prompt, each module with toggles and the character appear in that order with their counts; sources without toggles are hidden', async () => {
        install({
            prompt: 'a=A\nb=B',
            modules: [{ id: 'm1', name: 'Module One', customModuleToggle: 'c=C' }, { id: 'm2', name: 'No toggles' }, { id: 'm3', name: 'Caption only', customModuleToggle: 'x=Note=caption' }],
            character: 'd=D\ne=E',
            shared: { toggle_a: '1', toggle_d: '1', toggle_e: '1' },
        })
        const target = await show()
        const sections = all(target, '[data-part="toggles-section"]')
        expect(sections.map((section) => section.getAttribute('data-source'))).toEqual(['prompt', 'module:m1', 'character:char-a'])
        expect(sections.map((section) => q(section, '[data-part="toggles-section-title"]')!.textContent)).toEqual(['chatShellTogglesSourcePrompt', 'Module One', 'chatShellTogglesSourceCharacter'])
        expect(q(sections[0], '[data-part="toggles-section-detail"]')!.textContent).toBe('Preset One')
        expect(q(sections[2], '[data-part="toggles-section-detail"]')!.textContent).toBe('Ari')
        expect(sections.map((section) => q(section, '[data-part="toggles-count"]')!.textContent)).toEqual(['sum:2:1', 'sum:1:0', 'sum:2:2'])
    })

    test('a module stub contributes nothing, whatever text it carries', async () => {
        const stub = Object.assign({ id: 'stub', name: 'Not loaded', customModuleToggle: 's=Hidden' }, { [MODULE_STUB_KEY]: MODULE_STUB_VALUE })
        install({ prompt: 'a=A', modules: [stub, { id: 'm1', name: 'Loaded', customModuleToggle: 'c=C' }] })
        const target = await show()
        expect(all(target, '[data-part="toggles-section"]').map((section) => section.getAttribute('data-source'))).toEqual(['prompt', 'module:m1'])
        expect(q(target, '[data-part="toggle-row"][data-key="s"]')).toBeNull()
    })

    test('a key defined by two sources is counted once in the summary and each row names the other source', async () => {
        install({ prompt: 'k=Same\nm=Mixed', modules: [{ id: 'm1', name: 'Module One', customModuleToggle: 'k=Same too\nm=Mixed=select=a,b' }] })
        const target = await show()
        const [first, second] = all(target, '[data-part="toggle-row"][data-key="k"]')
        expect(q(first, '[data-part="toggle-badge"]')!.textContent).toBe('same:Module One')
        expect(q(second, '[data-part="toggle-badge"]')!.textContent).toBe('same:chatShellTogglesSourcePrompt')
        const mixed = all(target, '[data-part="toggle-row"][data-key="m"]')
        expect(q(mixed[0], '[data-part="toggle-badge"]')!.getAttribute('data-mismatch')).toBe('true')
        expect(q(mixed[0], '[data-part="toggle-badge"]')!.textContent).toBe('mismatch:Module One')
        expect(q(target, '[data-part="toggles-total"]')!.textContent).toBe('sum:2:0')
    })

    test('no toggles anywhere: the empty state replaces the list', async () => {
        install()
        const target = await show()
        expect(q(target, '[data-part="toggles-none"]')!.textContent).toBe('chatShellTogglesNone')
        expect(q(target, '[data-part="toggles-list"]')).toBeNull()
        expect(q(target, '[data-part="toggles-total"]')).toBeNull()
    })

    test('the author group is a folded sub-section with its own count; it opens on tap', async () => {
        install({ prompt: 'g=Style=group\nin1=Inside\ng=end=groupEnd\nout=Outside' })
        const target = await show()
        expect(q(target, '[data-part="toggle-row"][data-key="out"]')).not.toBeNull()
        expect(q(target, '[data-part="toggle-row"][data-key="in1"]')).toBeNull()
        const head = q(target, '[data-part="toggles-group-head"]')!
        expect(head.getAttribute('aria-expanded')).toBe('false')
        head.click()
        flushSync()
        expect(q(target, '[data-part="toggle-row"][data-key="in1"]')).not.toBeNull()
    })

    test('a section header folds and opens its rows and the choice is remembered for the session', async () => {
        install({ prompt: 'a=A', character: 'd=D' })
        const target = await show()
        const head = () => q(target, '[data-source="prompt"] [data-part="toggles-section-head"]')!
        expect(head().getAttribute('aria-expanded')).toBe('true')
        head().click()
        flushSync()
        expect(head().getAttribute('aria-expanded')).toBe('false')
        expect(q(target, '[data-part="toggle-row"][data-key="a"]')).toBeNull()
        view.open = false
        flushSync()
        view.open = true
        flushSync()
        expect(head().getAttribute('aria-expanded')).toBe('false')
    })
})

describe('default open set is frozen while the panel is open (DD-084)', () => {
    const lines = (prefix: string, n: number) => Array.from({ length: n }, (_, index) => `${prefix}${index}=${prefix} ${index}`).join('\n')
    const setup = () => install({
        prompt: lines('a', 12),
        modules: [{ id: 'm1', name: 'Second', customModuleToggle: lines('b', 12) }, { id: 'm2', name: 'Third', customModuleToggle: lines('c', 12) }],
        shared: { toggle_b0: '1' },
    })

    test('the first section and sections with a toggle on start open; the rest start folded', async () => {
        setup()
        const target = await show()
        const open = all(target, '[data-part="toggles-section-head"]').map((head) => head.getAttribute('aria-expanded'))
        expect(open).toEqual(['true', 'true', 'false'])
    })

    test('turning the last toggle of a section off does not fold it under the user', async () => {
        setup()
        const target = await show()
        const second = q(target, '[data-source="module:m1"]')!
        const toggle = q(row(second, 'b0'), '[data-part="toggle-switch"]') as HTMLInputElement
        toggle.click()
        flushSync()
        expect(sharedValues().toggle_b0).toBe('0')
        expect(q(target, '[data-source="module:m1"] [data-part="toggles-section-head"]')!.getAttribute('aria-expanded')).toBe('true')
        expect(q(row(second, 'b1'), '[data-part="toggle-switch"]')).not.toBeNull()
    })
})

describe('check rows (S7)', () => {
    test('the switch writes 1 and 0 to the shared value, marks the owner and announces the change politely', async () => {
        install({ prompt: 'a=Alpha' })
        const target = await show()
        const toggle = q(row(target, 'a'), '[data-part="toggle-switch"]') as HTMLInputElement
        expect(toggle.getAttribute('role')).toBe('switch')
        expect(toggle.checked).toBe(false)
        toggle.click()
        flushSync()
        expect(sharedValues().toggle_a).toBe('1')
        expect(h.mark).toHaveBeenCalledWith('char-a')
        expect(status(target)).toBe('on:Alpha')
        expect(q(target, '[data-part="toggles-announce"]')!.getAttribute('aria-live')).toBe('polite')
        expect(q(row(target, 'a'), '[data-part="toggle-dot"]')).not.toBeNull()
        toggle.click()
        flushSync()
        expect(sharedValues().toggle_a).toBe('0')
        expect(status(target)).toBe('off:Alpha')
        expect(q(row(target, 'a'), '[data-part="toggle-dot"]')).toBeNull()
    })

    test('with the chat-only scope on, the value goes to the chat and the shared value stays', async () => {
        install({ prompt: 'a=Alpha', shared: { toggle_a: '0' }, chatExtra: { useLocallySetGlobalVariables: true, GLGlobalVariables: { toggle_a: '0' } } })
        const target = await show()
        const toggle = q(row(target, 'a'), '[data-part="toggle-switch"]') as HTMLInputElement
        toggle.click()
        flushSync()
        expect(chat.GLGlobalVariables?.toggle_a).toBe('1')
        expect(sharedValues().toggle_a).toBe('0')
        expect(h.mark).toHaveBeenCalledWith('char-a')
        expect(q(row(target, 'a'), '[data-part="toggle-chat-tag"]')).not.toBeNull()
    })

    test('the scope marker names where a change applies', async () => {
        install({ prompt: 'a=Alpha' })
        let target = await show()
        expect(q(target, '[data-part="toggles-scope"]')!.textContent).toBe('chatShellScopeAll')
        await unmount(mounted!)
        mounted = undefined
        document.body.replaceChildren()
        install({ prompt: 'a=Alpha', chatExtra: { useLocallySetGlobalVariables: true, GLGlobalVariables: {} } })
        target = await show()
        expect(q(target, '[data-part="toggles-scope"]')!.textContent).toBe('chatShellThisChat')
    })
})

describe('select rows', () => {
    test('two short options are an inline radio group; picking one writes its index', async () => {
        install({ prompt: 'm=Mode=select=On,Off' })
        const target = await show()
        const group = q(row(target, 'm'), '[role="radiogroup"]')!
        expect(group.getAttribute('data-layout')).toBe('inline')
        const options = all(group, '[role="radio"]')
        // Never set: the value reads 'null' and the first option is shown, as off.
        expect(options.map((option) => option.getAttribute('aria-checked'))).toEqual(['true', 'false'])
        expect(q(row(target, 'm'), '[data-part="toggle-dot"]')).toBeNull()
        options[1].click()
        flushSync()
        expect(sharedValues().toggle_m).toBe('1')
        expect(h.mark).toHaveBeenCalledWith('char-a')
        expect(all(q(row(target, 'm'), '[role="radiogroup"]')!, '[role="radio"]').map((option) => option.getAttribute('aria-checked'))).toEqual(['false', 'true'])
        expect(q(row(target, 'm'), '[data-part="toggle-dot"]')).not.toBeNull()
        expect(status(target)).toBe('picked:Mode:Off')
    })

    test('a select with more options is a value that opens a list sheet; choosing writes and closes it', async () => {
        install({ prompt: 'm=Mode=select=One,Two,Three,Four' })
        const target = await show()
        const button = q(row(target, 'm'), '[data-part="toggle-select-list"]') as HTMLButtonElement
        expect(button.textContent).toContain('One')
        button.click()
        flushSync()
        await tick()
        const picker = q(target, '[data-part="toggles-picker"]')!
        expect(picker.closest('[data-part="chat-sheet-layer"]')).not.toBeNull()
        all(picker, '[data-part="toggles-picker-option"]')[2].click()
        flushSync()
        await tick()
        expect(sharedValues().toggle_m).toBe('2')
        expect(q(target, '[data-part="toggles-picker"]')).toBeNull()
        expect(q(row(target, 'm'), '[data-part="toggle-select-list"]')!.textContent).toContain('Three')
    })

    test('Escape or Back on the list sheet leaves the value alone', async () => {
        install({ prompt: 'm=Mode=select=One,Two,Three,Four' })
        const target = await show()
        ;(q(row(target, 'm'), '[data-part="toggle-select-list"]') as HTMLButtonElement).click()
        flushSync()
        await tick()
        expect(dispatchBack()).toBe(true)
        flushSync()
        await tick()
        expect(q(target, '[data-part="toggles-picker"]')).toBeNull()
        expect(sharedValues().toggle_m).toBeUndefined()
        expect(q(target, '[data-part="toggles-panel-body"]')).not.toBeNull()
    })
})

describe('Reset and the shared value (S7, DD-083)', () => {
    test('Reset turns a check off, a select to its first option and a text empty', async () => {
        install({ prompt: 'c=Check\ns=Pick=select=a,b\nt=Say=text', shared: { toggle_c: '1', toggle_s: '1', toggle_t: 'hello' } })
        const target = await show()
        await menuOf(target, 'c')
        const reset = q(row(target, 'c'), '[data-part="toggle-reset"]')!
        expect(reset.textContent).toBe('chatShellTogglesReset')
        reset.click()
        flushSync()
        await menuOf(target, 's')
        expect(q(row(target, 's'), '[data-part="toggle-reset"]')!.textContent).toBe('chatShellTogglesResetSelect')
        q(row(target, 's'), '[data-part="toggle-reset"]')!.click()
        flushSync()
        await menuOf(target, 't')
        expect(q(row(target, 't'), '[data-part="toggle-reset"]')!.textContent).toBe('chatShellTogglesResetText')
        q(row(target, 't'), '[data-part="toggle-reset"]')!.click()
        flushSync()
        expect(sharedValues()).toMatchObject({ toggle_c: '0', toggle_s: '0', toggle_t: '' })
        expect(status(target)).toBe('resetdone:Say')
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('Clear on a chat-only text writes an empty chat value and the row shows the shared value', async () => {
        install({
            prompt: 't=Say=text', shared: { toggle_t: 'shared' },
            chatExtra: { useLocallySetGlobalVariables: true, GLGlobalVariables: { toggle_t: 'mine' } },
        })
        const target = await show()
        expect(q(row(target, 't'), '[data-part="toggle-text-button"]')!.textContent).toContain('mine')
        await menuOf(target, 't')
        q(row(target, 't'), '[data-part="toggle-reset"]')!.click()
        flushSync()
        expect(chat.GLGlobalVariables?.toggle_t).toBe('')
        expect(sharedValues().toggle_t).toBe('shared')
        expect(q(row(target, 't'), '[data-part="toggle-text-button"]')!.textContent).toContain('shared')
        expect(q(row(target, 't'), '[data-part="toggle-chat-tag"]')).toBeNull()
    })

    test('the revert entry exists only for a chat-only value that differs, and removes it', async () => {
        install({
            prompt: 'a=Alpha\nb=Beta', shared: { toggle_a: '0', toggle_b: '1' },
            chatExtra: { useLocallySetGlobalVariables: true, GLGlobalVariables: { toggle_a: '1', toggle_b: '1' } },
        })
        const target = await show()
        await menuOf(target, 'b')
        expect(q(row(target, 'b'), '[data-part="toggle-revert"]')).toBeNull()
        await menuOf(target, 'a')
        const revert = q(row(target, 'a'), '[data-part="toggle-revert"]')!
        expect(revert.textContent).toBe('chatShellTogglesRevertShared')
        revert.click()
        flushSync()
        expect(chat.GLGlobalVariables).toEqual({ toggle_b: '1' })
        expect(sharedValues().toggle_a).toBe('0')
        expect(status(target)).toBe('revertdone:Alpha')
        expect(h.mark).toHaveBeenCalledWith('char-a')
        expect(q(row(target, 'a'), '[data-part="toggle-chat-tag"]')).toBeNull()
    })

    test('Escape closes an open row menu and not the panel', async () => {
        install({ prompt: 'a=Alpha' })
        const target = await show()
        await menuOf(target, 'a')
        expect(q(target, '[data-part="toggle-menu"]')).not.toBeNull()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        flushSync()
        await tick()
        expect(q(target, '[data-part="toggle-menu"]')).toBeNull()
        expect(onclose).not.toHaveBeenCalled()
    })
})

describe('text rows and the editor sheet', () => {
    test('a text opens an inline field; Enter saves it and announces it', async () => {
        install({ prompt: 't=Say=text' })
        const target = await show()
        ;(q(row(target, 't'), '[data-part="toggle-text-button"]') as HTMLButtonElement).click()
        flushSync()
        await tick()
        const input = q(row(target, 't'), '[data-part="toggle-text-input"]') as HTMLInputElement
        expect(document.activeElement).toBe(input)
        input.value = 'hello'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
        flushSync()
        await tick()
        expect(sharedValues().toggle_t).toBe('hello')
        expect(q(row(target, 't'), '[data-part="toggle-text-input"]')).toBeNull()
        expect(status(target)).toBe('textsaved:Say')
    })

    test.each([2, 200])('the Enter that follows compositionend at +%s ms saves the inline field once', async (gap) => {
        install({ prompt: 't=Say=text' })
        const target = await show()
        ;(q(row(target, 't'), '[data-part="toggle-text-button"]') as HTMLButtonElement).click()
        flushSync()
        await tick()
        const input = q(row(target, 't'), '[data-part="toggle-text-input"]') as HTMLInputElement
        let clock = 5000
        const spy = vi.spyOn(performance, 'now').mockImplementation(() => clock)
        try {
            imeEventSequence(input, '간')
            clock += gap
            const press = enterKeydown(input)
            flushSync()
            await tick()
            expect(press.defaultPrevented).toBe(true)
            expect(sharedValues().toggle_t).toBe('간')
            expect(q(row(target, 't'), '[data-part="toggle-text-input"]')).toBeNull()
        } finally {
            spy.mockRestore()
        }
    })

    test('an Enter that confirms an IME composition (isComposing or keyCode 229) saves nothing and is not prevented', async () => {
        install({ prompt: 't=Say=text' })
        const target = await show()
        ;(q(row(target, 't'), '[data-part="toggle-text-button"]') as HTMLButtonElement).click()
        flushSync()
        await tick()
        const input = q(row(target, 't'), '[data-part="toggle-text-input"]') as HTMLInputElement
        input.value = 'Han'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        const composing = enterKeydown(input, { isComposing: true })
        const legacy = enterKeydown(input, { keyCode: 229 })
        flushSync()
        await tick()
        expect(composing.defaultPrevented).toBe(false)
        expect(legacy.defaultPrevented).toBe(false)
        expect(sharedValues().toggle_t).toBeUndefined()
        expect(q(row(target, 't'), '[data-part="toggle-text-input"]')).not.toBeNull()
    })

    test('Escape reverts the inline field, writes nothing and keeps the panel', async () => {
        install({ prompt: 't=Say=text', shared: { toggle_t: 'kept' } })
        const target = await show()
        ;(q(row(target, 't'), '[data-part="toggle-text-button"]') as HTMLButtonElement).click()
        flushSync()
        await tick()
        const input = q(row(target, 't'), '[data-part="toggle-text-input"]') as HTMLInputElement
        input.value = 'typed'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        flushSync()
        await tick()
        expect(q(row(target, 't'), '[data-part="toggle-text-input"]')).toBeNull()
        expect(sharedValues().toggle_t).toBe('kept')
        expect(onclose).not.toHaveBeenCalled()
    })

    test('Back closes the inline field first (it saves, as blur does) and the panel stays', async () => {
        install({ prompt: 't=Say=text' })
        const target = await show()
        ;(q(row(target, 't'), '[data-part="toggle-text-button"]') as HTMLButtonElement).click()
        flushSync()
        await tick()
        const input = q(row(target, 't'), '[data-part="toggle-text-input"]') as HTMLInputElement
        input.value = 'by back'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        expect(dispatchBack()).toBe(true)
        flushSync()
        await tick()
        expect(q(row(target, 't'), '[data-part="toggle-text-input"]')).toBeNull()
        expect(onclose).not.toHaveBeenCalled()
        expect(sharedValues().toggle_t).toBe('by back')
    })

    test('a textarea opens an editor sheet: Save writes, Cancel does not', async () => {
        install({ prompt: 'n=Notes=textarea', shared: { toggle_n: 'old' } })
        const target = await show()
        const open = () => (q(row(target, 'n'), '[data-part="toggle-text-button"]') as HTMLButtonElement).click()
        open()
        flushSync()
        await tick()
        let field = q(target, '[data-part="toggles-editor-field"]') as HTMLTextAreaElement
        expect(field.value).toBe('old')
        field.value = 'drafted'
        field.dispatchEvent(new Event('input', { bubbles: true }))
        q(target, '[data-part="toggles-editor-cancel"]')!.click()
        flushSync()
        await tick()
        expect(sharedValues().toggle_n).toBe('old')
        expect(q(target, '[data-part="toggles-editor-field"]')).toBeNull()
        open()
        flushSync()
        await tick()
        field = q(target, '[data-part="toggles-editor-field"]') as HTMLTextAreaElement
        field.value = 'saved text'
        field.dispatchEvent(new Event('input', { bubbles: true }))
        q(target, '[data-part="toggles-editor-save"]')!.click()
        flushSync()
        await tick()
        expect(sharedValues().toggle_n).toBe('saved text')
        expect(h.mark).toHaveBeenCalledWith('char-a')
        expect(q(target, '[data-part="toggles-editor-field"]')).toBeNull()
    })
})

describe('feedback and re-reading', () => {
    test('the "saved to" flash shows after the first change of a session and not after the next', async () => {
        vi.useFakeTimers()
        try {
            install({ prompt: 'a=Alpha' })
            const target = await show()
            const toggle = q(row(target, 'a'), '[data-part="toggle-switch"]') as HTMLInputElement
            toggle.click()
            flushSync()
            expect(q(target, '[data-part="toggles-flash"]')!.textContent).toBe('chatShellTogglesSavedAll')
            vi.advanceTimersByTime(2000)
            flushSync()
            expect(q(target, '[data-part="toggles-flash"]')!.textContent).toBe('')
            toggle.click()
            flushSync()
            expect(q(target, '[data-part="toggles-flash"]')!.textContent).toBe('')
        } finally {
            vi.useRealTimers()
        }
    })

    test('the flash names the chat when the chat-only scope is on', async () => {
        install({ prompt: 'a=Alpha', chatExtra: { useLocallySetGlobalVariables: true, GLGlobalVariables: {} } })
        const target = await show()
        ;(q(row(target, 'a'), '[data-part="toggle-switch"]') as HTMLInputElement).click()
        flushSync()
        expect(q(target, '[data-part="toggles-flash"]')!.textContent).toBe('chatShellTogglesSavedChat')
    })

    test('a module change announced by ReloadGUIPointer is read again', async () => {
        install({ prompt: 'a=Alpha' })
        const target = await show()
        expect(all(target, '[data-part="toggles-section"]')).toHaveLength(1)
        h.modules = [{ id: 'm9', name: 'Late module', customModuleToggle: 'z=Zed' }]
        h.reload!.update((n) => n + 1)
        flushSync()
        await tick()
        expect(all(target, '[data-part="toggles-section"]').map((section) => section.getAttribute('data-source'))).toEqual(['prompt', 'module:m9'])
    })

    test('the close control closes the panel', async () => {
        install({ prompt: 'a=Alpha' })
        const target = await show()
        q(target, '[data-part="toggles-close"]')!.click()
        flushSync()
        expect(onclose).toHaveBeenCalledOnce()
    })

    test('the title takes the initial focus', async () => {
        install({ prompt: 'a=Alpha' })
        const target = await show()
        expect(document.activeElement).toBe(q(target, '[data-part="toggles-title"]'))
    })
})
