// @vitest-environment jsdom
/**
 * The toggles panel with author defaults (#467, MC-3012, MC-3013): an unset check or select reads as its default in the
 * rows, counts and badge; the panel follows a definition edit and a module change while it is open; Reset removes the
 * stored value (shared mode and chat-only scope) and marks the owner. Mounts the REAL TogglesPanel, ToggleRow and
 * ShellSheet with the real scope accessors over a `$state` database like production; the save marks are a spy.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { tickFake } from '../../ts/tests/svelteTick.test-helpers'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({
    mark: vi.fn(),
}))

vi.mock('src/ts/stores.svelte', () => {
    const state = $state({ db: {} })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
    }
})
vi.mock('src/ts/storage/database.svelte', () => ({ appVer: '1', getCurrentCharacter: () => undefined, getCurrentChat: () => undefined, getDatabase: () => ({}) }))
vi.mock('src/ts/globalApi.svelte', () => ({ aiWatermarkingLawApplies: () => false, getFileSrc: () => Promise.resolve(''), readImage: () => Promise.resolve(undefined) }))
vi.mock('src/ts/storage/characterSaveMarks', () => ({ markCharacterForSave: (chaId: string) => h.mark(chaId) }))
vi.mock('../../ts/storage/characterSaveMarks', () => ({ markCharacterForSave: (chaId: string) => h.mark(chaId) }))
// The enabled modules are read through the `$state` database, so enabling one reaches the panel like the real getModules does.
vi.mock('src/ts/process/modules', async () => {
    const { DBState: state } = await import('src/ts/stores.svelte')
    const enabled = () => (state.db.modules as { id: string }[]).filter((module) => (state.db.enabledModules as string[]).includes(module.id))
    return { getModuleToggles: () => '', getModules: enabled, getModuleAssets: () => [] }
})
vi.mock('../../ts/process/modules', async () => {
    const { DBState: state } = await import('src/ts/stores.svelte')
    const enabled = () => (state.db.modules as { id: string }[]).filter((module) => (state.db.enabledModules as string[]).includes(module.id))
    return { getModuleToggles: () => '', getModules: enabled, getModuleAssets: () => [] }
})
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

import { DBState } from '../../ts/stores.svelte'
import TogglesPanel, { toggleSummary } from './TogglesPanel.svelte'
import { resetTogglePanelSession } from '../../ts/chatShell/togglePanel'

type Owner = { chaId: string, name: string, type: 'character', chatPage: number, chats: Chat[], customModuleToggle?: string }
type Fixture = { db: Record<string, unknown> }

const view = $state({ open: true })
let mounted: ReturnType<typeof mount> | undefined
let owner: Owner
let chat: Chat
let opener: HTMLButtonElement

const makeChat = (extra: Partial<Chat> = {}): Chat => ({ message: [], note: '', name: 'Harbour night', localLore: [], id: 'chat-1', ...extra }) as Chat
const db = () => (DBState as unknown as Fixture).db
const sharedValues = () => db().globalChatVariables as Record<string, string>

function install(options: { prompt?: string, modules?: { id: string, name: string, customModuleToggle?: string }[], enabled?: string[], shared?: Record<string, string>, chatExtra?: Partial<Chat> } = {}): void {
    const raw: Owner = { chaId: 'char-a', name: 'Ari', type: 'character', chatPage: 0, chats: [makeChat(options.chatExtra)] }
    ;(DBState as unknown as Fixture).db = {
        characters: [raw], customPromptTemplateToggle: options.prompt ?? '', globalChatVariables: { ...(options.shared ?? {}) },
        modules: options.modules ?? [], enabledModules: options.enabled ?? [],
        botPresets: [{ name: 'Preset One' }], botPresetsId: 0, jailbreakToggle: false,
    }
    // The panel works on the live (proxied) owner and chat, like the shell does.
    owner = (db().characters as Owner[])[0]
    chat = owner.chats[0]
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
            onclose: () => { view.open = false },
        },
    })
    flushSync()
    await tickFake()
    return target
}

const q = (target: ParentNode, selector: string) => target.querySelector<HTMLElement>(selector)
const row = (target: ParentNode, key: string) => q(target, `[data-part="toggle-row"][data-key="${key}"]`)!
const isOnRow = (target: ParentNode, key: string) => row(target, key).hasAttribute('data-on')
const chosen = (target: ParentNode, key: string) => Array.from(row(target, key).querySelectorAll<HTMLElement>('[data-part="toggle-select-option"]')).map((option) => option.getAttribute('aria-checked'))
const total = (target: ParentNode) => q(target, '[data-part="toggles-total"]')!.textContent
const menuOf = async (target: ParentNode, key: string) => {
    q(row(target, key), '[data-part="toggle-menu-button"]')!.click()
    flushSync()
    await tick()
}
const resetRow = async (target: ParentNode, key: string) => {
    await menuOf(target, key)
    q(row(target, key), '[data-part="toggle-reset"]')!.click()
    flushSync()
    await tick()
}

beforeEach(() => {
    resetTogglePanelSession()
    h.mark.mockClear()
    opener = document.createElement('button')
    document.body.appendChild(opener)
})

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.replaceChildren()
})

describe('author defaults in the panel (T3.3)', () => {
    test('with nothing stored a default-on check is on, a select shows its default option, and the counts include them', async () => {
        install({ prompt: 'n=NSFW===1\nm=Mood=select=calm,angry=angry\nc=Plain' })
        const target = await show()
        expect(isOnRow(target, 'n')).toBe(true)
        expect(isOnRow(target, 'c')).toBe(false)
        expect(chosen(target, 'm')).toEqual(['false', 'true'])
        expect(total(target)).toBe('sum:3:2')
        expect(q(target, '[data-part="toggles-count"]')!.textContent).toBe('sum:3:2')
    })

    test('a stored value wins over the default, a stored 0 included', async () => {
        install({ prompt: 'n=NSFW===1\nm=Mood=select=calm,angry=angry', shared: { toggle_n: '0', toggle_m: '0' } })
        const target = await show()
        expect(isOnRow(target, 'n')).toBe(false)
        expect(chosen(target, 'm')).toEqual(['true', 'false'])
        expect(total(target)).toBe('sum:2:0')
    })

    test('editing the prompt toggle text while the panel is open follows the new default', async () => {
        install({ prompt: 'c=Plain' })
        const target = await show()
        expect(isOnRow(target, 'c')).toBe(false)
        DBState.db.customPromptTemplateToggle = 'c=Plain===1'
        flushSync()
        await tick()
        expect(isOnRow(target, 'c')).toBe(true)
        expect(total(target)).toBe('sum:1:1')
    })

    test('enabling a module that defines a default-on toggle adds it as on', async () => {
        install({ prompt: 'c=Plain', modules: [{ id: 'm1', name: 'Module One', customModuleToggle: 'z=Zed===1' }] })
        const target = await show()
        expect(q(target, '[data-part="toggle-row"][data-key="z"]')).toBeNull()
        DBState.db.enabledModules.push('m1')
        flushSync()
        await tick()
        // The new section starts folded (the open set is frozen at opening), so the count is what shows it.
        expect(total(target)).toBe('sum:2:1')
    })
})

describe('Reset removes the stored value (T3.4, T3.5)', () => {
    test('shared mode: after 0 is stored, Reset removes the shared key and a stale chat key and the row is on again', async () => {
        install({ prompt: 'n=NSFW===1', shared: { toggle_n: '0' }, chatExtra: { GLGlobalVariables: { toggle_n: '0' } } })
        const target = await show()
        expect(isOnRow(target, 'n')).toBe(false)
        await resetRow(target, 'n')
        expect('toggle_n' in sharedValues()).toBe(false)
        expect(chat.GLGlobalVariables?.toggle_n).toBeUndefined()
        expect(isOnRow(target, 'n')).toBe(true)
        expect(q(target, '[data-part="toggles-announce"]')!.textContent).toBe('resetdone:NSFW')
        // The saved flash is the same confirmation a write gives.
        expect(q(target, '[data-part="toggles-flash"]')?.textContent).toBe('chatShellTogglesSavedAll')
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('shared mode: a select Reset removes the key and the default option shows', async () => {
        install({ prompt: 'm=Mood=select=calm,angry=angry', shared: { toggle_m: '0' } })
        const target = await show()
        expect(chosen(target, 'm')).toEqual(['true', 'false'])
        await resetRow(target, 'm')
        expect('toggle_m' in sharedValues()).toBe(false)
        expect(chosen(target, 'm')).toEqual(['false', 'true'])
    })

    test('without a default Reset still removes the key; the row is off and the engine value is unset', async () => {
        install({ prompt: 'p=Plain', shared: { toggle_p: '1' } })
        const target = await show()
        expect(isOnRow(target, 'p')).toBe(true)
        await resetRow(target, 'p')
        expect('toggle_p' in sharedValues()).toBe(false)
        expect(isOnRow(target, 'p')).toBe(false)
        expect(total(target)).toBe('sum:1:0')
    })

    test('chat-only scope: Reset removes only the chat value, leaves the shared map, shows the shared value and marks the owner', async () => {
        install({
            prompt: 'n=NSFW===1', shared: { toggle_n: '1' },
            chatExtra: { useLocallySetGlobalVariables: true, GLGlobalVariables: { toggle_n: '0' } },
        })
        const target = await show()
        expect(isOnRow(target, 'n')).toBe(false)
        expect(q(row(target, 'n'), '[data-part="toggle-chat-tag"]')).not.toBeNull()
        await resetRow(target, 'n')
        expect(chat.GLGlobalVariables?.toggle_n).toBeUndefined()
        expect(sharedValues()).toEqual({ toggle_n: '1' })
        expect(isOnRow(target, 'n')).toBe(true)
        expect(q(row(target, 'n'), '[data-part="toggle-chat-tag"]')).toBeNull()
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('chat-only scope with no chat value: Reset leaves the shared map alone and marks nothing', async () => {
        install({ prompt: 'n=NSFW===1', shared: { toggle_n: '0' }, chatExtra: { useLocallySetGlobalVariables: true } })
        const target = await show()
        await resetRow(target, 'n')
        expect(sharedValues()).toEqual({ toggle_n: '0' })
        expect(h.mark).not.toHaveBeenCalled()
    })

    test('text Reset still writes an empty string', async () => {
        install({ prompt: 't=Say=text', shared: { toggle_t: 'hello' } })
        const target = await show()
        await resetRow(target, 't')
        expect(sharedValues().toggle_t).toBe('')
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })
})

describe('the summary rows and the opening sections count a default-on toggle as on (A1)', () => {
    const lines = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i}=${prefix.toUpperCase()}${i}`).join('\n')

    test('toggleSummary counts an unset default-on check as on', () => {
        install({ prompt: 'n=NSFW===1\nc=Plain' })
        expect(toggleSummary(owner as never, chat)).toEqual({ n: 2, on: 1 })
        // A stored value still wins over the default.
        sharedValues().toggle_n = '0'
        expect(toggleSummary(owner as never, chat)).toEqual({ n: 2, on: 0 })
    })

    test('a section holding only a default-on toggle starts open; a section without one starts folded', async () => {
        install({
            prompt: lines('a', 12),
            modules: [
                { id: 'm1', name: 'Second', customModuleToggle: `z=Zed===1\n${lines('b', 11)}` },
                { id: 'm2', name: 'Third', customModuleToggle: lines('c', 12) },
            ],
            enabled: ['m1', 'm2'],
        })
        const target = await show()
        const open = Array.from(target.querySelectorAll<HTMLElement>('[data-part="toggles-section-head"]')).map((head) => head.getAttribute('aria-expanded'))
        expect(open).toEqual(['true', 'true', 'false'])
    })
})

describe('the chat-only tag compares against what the other chats read (T3.6)', () => {
    test('default on and nothing shared: a chat value of 1 shows no tag, a chat value of 0 shows it', async () => {
        install({
            prompt: 'a=Alpha===1\nb=Beta===1',
            chatExtra: { useLocallySetGlobalVariables: true, GLGlobalVariables: { toggle_a: '1', toggle_b: '0' } },
        })
        const target = await show()
        expect(q(row(target, 'a'), '[data-part="toggle-chat-tag"]')).toBeNull()
        expect(q(row(target, 'b'), '[data-part="toggle-chat-tag"]')).not.toBeNull()
    })
})
