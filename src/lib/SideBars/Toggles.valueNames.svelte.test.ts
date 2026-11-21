// @vitest-environment jsdom

/**
 * `Toggles.svelte` value control: the select toggle, at the top level and inside a group, is named by its
 * visible toggle name (the unpin button of a locally handled toggle stays outside the name) with the label
 * first in `aria-describedby`; sibling select and text toggles never share a naming element. Mounts the REAL
 * component with the real `chatVar`, `chatToggleScope`, shared inputs and accordion; the stores are plain
 * objects and the database module, module toggle source, highlighter and custom sidebar are stubs, as in
 * `Toggles.fieldNames.svelte.test.ts`.
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

import { fieldNameProblems, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import Toggles from './Toggles.svelte'

let mounted: ReturnType<typeof mount> | undefined
let target: HTMLElement

const template = [
    'a=Mode=select=One,Two',
    'b=Beta=text',
    'grp=Group=group',
    'c=Inner=select=Red,Green',
    'd=Deep=text',
    'grpEnd=x=groupEnd',
    'e=Flavor=select=Sweet,Sour',
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

describe('Toggles value control names', () => {
    test('the select toggles are named by their toggle names, top level and inside a group', async () => {
        await mountToggles()
        await openGroup()
        expect(fieldNameProblems(target, [{ name: 'Mode' }, { name: 'Inner' }, { name: 'Flavor' }])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual([])
    })
})
