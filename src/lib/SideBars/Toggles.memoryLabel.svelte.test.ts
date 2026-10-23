// @vitest-environment happy-dom

/**
 * The chat sidebar's memory toggle label for each active memory system.
 *
 * Mounts the REAL `Toggles.svelte` with its real `CheckInput`/`Accordion`; the stores, the module
 * toggle source, chat-variable access, the pin icon and the custom sidebar are stubbed because none of
 * them take part in the memory toggle. The label is written at two sites: the plain layout and the
 * container layout used when more than four toggles are listed; both are pinned. The settings
 * page's Type dropdown precedence (UI-1) lives in the large `OtherBotSettings.svelte` and is not
 * covered here.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { character } from 'src/ts/storage/database.svelte'

const state = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    toggleCount: 0,
}))

vi.mock('src/ts/stores.svelte', () => ({
    DBState: {
        get db() { return state.db },
    },
    selIdState: { selId: -1 },
    MobileGUI: { subscribe: (run: (value: boolean) => void) => { run(false); return () => {} } },
    selectedCharID: writable(0),
}))
vi.mock('src/ts/storage/database.svelte', () => ({
    getCurrentCharacter: () => undefined,
    getCurrentChat: () => undefined,
}))
vi.mock('src/ts/process/modules', () => ({ getModuleToggles: () => '' }))
vi.mock('src/ts/parser/chatVar.svelte', () => ({
    getGlobalChatVar: () => 'null',
    isLocallyHandledGlobalChatVar: () => false,
    removeLocallyHandledGlobalChatVar: vi.fn(),
    setGlobalChatVar: vi.fn(),
}))
vi.mock('src/ts/util', () => ({
    parseToggleSyntax: () => Array.from({ length: state.toggleCount }, (_, i) => ({ value: `caption${i}`, type: 'caption' })),
}))
vi.mock('@lucide/svelte', () => ({ PinIcon: () => {} }))
// Each label key renders as its own name, so the assertions compare keys rather than English text.
vi.mock('src/lang', () => ({ language: new Proxy({}, { get: (_target, key) => String(key) }) }))
vi.mock('./CustomSidebar.svelte', () => ({ default: () => {} }))

import Toggles from './Toggles.svelte'

let mounted: ReturnType<typeof mount> | undefined

/** More than four listed toggles select the container layout. */
const CONTAINER_TOGGLES = 5

function labelFor(flags: Record<string, unknown>, toggleCount = 0): string {
    state.toggleCount = toggleCount
    state.db = { supaModelType: 'none', hypaV3: false, hanuraiEnable: false, hypaMemory: false, hypav2: false, ...flags }
    const chara = { supaMemory: false } as character
    mounted = mount(Toggles, { target: document.body, props: { chara } })
    flushSync()
    return document.body.textContent?.trim() ?? ''
}

afterEach(() => {
    if (mounted) unmount(mounted)
    mounted = undefined
    document.body.innerHTML = ''
})

describe.each([
    { layout: 'plain layout', toggleCount: 0 },
    { layout: 'container layout', toggleCount: CONTAINER_TOGGLES },
])('Toggles memory toggle label, $layout', ({ toggleCount }) => {
    test('guard: HypaMemory V3 shows the Hypa label', () => {
        expect(labelFor({ hypaV3: true }, toggleCount)).toContain('ToggleHypaMemory')
    })

    test('guard: SupaMemory shows the Supa label', () => {
        expect(labelFor({ supaModelType: 'distilbart' }, toggleCount)).toContain('ToggleSuperMemory')
    })

    // regression reproducer: CHORE-10 UI-1 (label part), MC-712 8
    test.fails('HypaMemory V2 shows the Hypa label', () => {
        // V2 is selected with supaModelType 'distilbart' and the hypav2 flag; hypaMemory stays false.
        expect(labelFor({ hypav2: true, supaModelType: 'distilbart' }, toggleCount)).toContain('ToggleHypaMemory')
    })
})

test('guard: more than four toggles render the scrolling container, four or fewer do not', () => {
    labelFor({ hypaV3: true }, CONTAINER_TOGGLES)
    expect(document.querySelector('.overflow-y-auto')).not.toBeNull()
    unmount(mounted!)
    mounted = undefined
    document.body.innerHTML = ''
    labelFor({ hypaV3: true }, CONTAINER_TOGGLES - 1)
    expect(document.querySelector('.overflow-y-auto')).toBeNull()
})
