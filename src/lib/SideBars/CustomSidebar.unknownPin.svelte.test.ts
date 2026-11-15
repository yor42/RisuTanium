// @vitest-environment jsdom

/**
 * The REAL `CustomSidebar.svelte` with pinned `setting` items whose id has no row in `getFullSettingsData`.
 *
 * Invariants pinned here:
 *  - a pinned setting with an unknown id, or one excluded from the picker (`display.themePack`), does not
 *    throw while rendering;
 *  - a known pinned setting next to them still renders.
 *
 * MOCKED: `stores.svelte` (a `$state` DBState and plain stores), `lite`, the model catalogue lookup and the
 * model list component. The sidebar, the setting renderer, the item registry and the settings data are real.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        MobileGUI: writable(false),
        selIdState: { selId: -1 },
        selectedCharID: writable(0),
        loadoutModalStore: { open: false },
        openPersonaList: writable(false),
        openPresetList: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock('src/ts/lite', () => ({ isLite: writable(false) }))
vi.mock('src/ts/model/modellist', () => ({ getModelInfo: () => ({}) }))
vi.mock('../UI/ModelList.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import CustomSidebar from './CustomSidebar.svelte'

let app: ReturnType<typeof mount> | null = null
let target: HTMLElement

function pin(id: string, subType: string) {
    return { id, type: 'setting' as const, subType, label: id }
}

function show(items: ReturnType<typeof pin>[]): void {
    DBState.db = {
        customSidebarItems: items,
        characters: [{ chatPage: 0, chats: [{ bindedPersona: '' }] }],
        personas: [],
        botPresets: [],
    } as unknown as Database
    target = document.createElement('div')
    document.body.append(target)
    app = mount(CustomSidebar, { target, props: {} })
    flushSync()
}

beforeEach(() => {
    localStorage.clear()
})

afterEach(async () => {
    if (app) await unmount(app).catch(() => {})
    app = null
    target?.remove()
})

describe('a pinned setting whose id has no settings row', () => {
    test('guard: a known pinned setting renders', () => {
        show([pin('p-known', 'acc.settingsShellPreview')])
        expect(target.textContent).toContain(language.settingsShellPreviewLabel)
    })

    test('regression reproducer: an unknown subType does not throw and the known pin still renders', () => {
        expect(() => show([
            pin('p-unknown', 'no.such.setting'),
            pin('p-known', 'acc.settingsShellPreview'),
        ])).not.toThrow()
        expect(target.textContent).toContain(language.settingsShellPreviewLabel)
    })

    test('regression reproducer: a display.themePack pin does not throw and the known pin still renders', () => {
        expect(() => show([
            pin('p-theme', 'display.themePack'),
            pin('p-known', 'acc.settingsShellPreview'),
        ])).not.toThrow()
        expect(target.textContent).toContain(language.settingsShellPreviewLabel)
    })

    test('a mixed pin list renders every known setting in stored order and skips the rest', () => {
        show([
            pin('p-a', 'acc.chatShellPreview'),
            pin('p-unknown', 'no.such.setting'),
            pin('p-b', 'acc.settingsShellPreview'),
            pin('p-theme', 'display.themePack'),
            pin('p-c', 'acc.studio'),
        ])
        const text = target.textContent ?? ''
        const positions = [
            language.chatShellPreviewLabel,
            language.settingsShellPreviewLabel,
            language.studioSwitchLabel,
        ].map(label => text.indexOf(label))
        expect(positions.every(p => p >= 0)).toBe(true)
        expect([...positions].sort((x, y) => x - y)).toEqual(positions)
    })

    test('unresolvable pins stay stored: the mount does not write back to customSidebarItems', () => {
        const items = [
            pin('p-a', 'acc.chatShellPreview'),
            pin('p-unknown', 'no.such.setting'),
            pin('p-theme', 'display.themePack'),
            pin('p-b', 'acc.settingsShellPreview'),
        ]
        const before = structuredClone(items)
        show(items)
        flushSync()
        expect($state.snapshot(DBState.db.customSidebarItems)).toEqual(before)
        expect(DBState.db.customSidebarItems).toHaveLength(before.length)
    })
})
