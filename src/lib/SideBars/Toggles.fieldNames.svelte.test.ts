// @vitest-environment jsdom

/**
 * `Toggles.svelte`: the custom text and textarea toggles, at the top level and inside a group, are named by
 * their visible toggle name (the unpin button of a locally handled toggle stays outside the name) with the
 * label first in `aria-describedby`, and the ids of all fields are distinct. Mounts the REAL component with
 * the real `chatVar`, `chatToggleScope`, shared inputs and accordion; the stores are plain objects and the
 * database module, module toggle source, highlighter and custom sidebar are stubs.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { character } from 'src/ts/storage/database.svelte'

const state = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    selected: undefined as undefined | import('svelte/store').Writable<number>,
}))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable: make } = await import('svelte/store')
    state.selected = make(0)
    return {
        DBState: {
            get db() { return state.db },
        },
        selIdState: { selId: -1 },
        MobileGUI: { subscribe: (run: (value: boolean) => void) => { run(false); return () => {} } },
        selectedCharID: state.selected,
        ReloadGUIPointer: make(0),
        disableHighlight: make(false),
        popUpEditorStore: { open: false, value: '', mode: 'default', language: 'markdown' },
    }
})
vi.mock('src/ts/storage/database.svelte', async () => {
    const { get } = await import('svelte/store')
    const current = () => (state.db.characters as { chats: unknown[], chatPage: number }[])[get(state.selected!)]
    return {
        appVer: '1234.5.67',
        getCurrentCharacter: () => current(),
        getCurrentChat: () => current()?.chats[current().chatPage],
        getDatabase: () => state.db,
    }
})
vi.mock('src/ts/globalApi.svelte', () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
}))
vi.mock('src/ts/storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('src/ts/process/modules', () => ({ getModuleToggles: () => '' }))
vi.mock('src/ts/gui/guisize', () => ({
    textAreaSize: writable(0),
    textAreaTextSize: writable(1),
}))
vi.mock('src/ts/gui/highlight', () => ({
    highlighter: vi.fn(),
    getNewHighlightId: vi.fn(() => 1),
    removeHighlight: vi.fn(),
    AllCBS: ['random', 'randint'],
}))
vi.mock('./CustomSidebar.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { controlDescription, controlName, exposedIcons, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import Toggles from './Toggles.svelte'

let mounted: ReturnType<typeof mount> | undefined
let target: HTMLElement

const template = [
    'a=Alpha=text',
    'b=Beta=textarea',
    'grp=Group=group',
    'c=Inner=text',
    'd=Deep=textarea',
    'grpEnd=x=groupEnd',
    'on=Switch',
].join('\n')

async function mountToggles(): Promise<void> {
    state.db = {
        characters: [{
            chaId: 'char-a', name: 'a', chatPage: 0, hotkeys: [],
            chats: [{ id: 'chat-a', message: [] }],
        }],
        globalChatVariables: {},
        customPromptTemplateToggle: template,
        hotkeys: [],
        longPressToPopupEditor: false,
        supaModelType: 'none', hypaV3: false, hanuraiEnable: false, hypaMemory: false, hypav2: false,
    }
    state.selected!.set(0)
    target = document.createElement('div')
    document.body.appendChild(target)
    const chara = (state.db.characters as unknown[])[0] as unknown as character
    mounted = mount(Toggles, { target, props: { chara } })
    flushSync()
    await tick()
    flushSync()
}

async function openGroup(): Promise<void> {
    const header = Array.from(target.querySelectorAll<HTMLElement>('button')).find((b) => b.textContent?.includes('Group'))
    header?.click()
    flushSync()
    await tick()
    flushSync()
}

function fields(): HTMLElement[] {
    return Array.from(target.querySelectorAll<HTMLElement>('input[type="text"], textarea, [role="textbox"]'))
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    if (mounted) unmount(mounted)
    mounted = undefined
    document.body.innerHTML = ''
    vi.restoreAllMocks()
})

describe('Toggles field names', () => {
    test('regression reproducer: the top-level text and textarea toggles are named by their toggle names', async () => {
        await mountToggles()
        const named = fields().map(controlName)
        expect(named).toContain('Alpha')
        expect(named).toContain('Beta')
        for (const el of fields()) {
            expect(controlDescription(el).startsWith(controlName(el))).toBe(true)
        }
    })

    test('regression reproducer: the toggles inside a group are named and every id is distinct (AS1)', async () => {
        await mountToggles()
        await openGroup()
        const named = fields().map(controlName)
        expect(named).toEqual(expect.arrayContaining(['Alpha', 'Beta', 'Inner', 'Deep']))
        expect(unnamedControls(target, { fields: true })).toEqual([])
        const ids = fields().map((el) => el.getAttribute('aria-labelledby'))
        expect(ids.every((id) => id !== null && id !== '')).toBe(true)
        expect(new Set(ids).size).toBe(ids.length)
        expect(exposedIcons(target)).toEqual([])
    })

    test('guard: the checkbox toggles and the local-toggles switch keep their names (passes before and after)', async () => {
        await mountToggles()
        const boxes = Array.from(target.querySelectorAll('input[type="checkbox"]')).map(controlName)
        expect(boxes).toContain('Switch')
        expect(boxes).toContain(language.localToggles)
    })
})
