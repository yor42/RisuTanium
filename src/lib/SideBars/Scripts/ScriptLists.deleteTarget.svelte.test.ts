// @vitest-environment happy-dom

/**
 * A regex script's or a V1 trigger's delete button removes the script the user
 * aimed at, and only that script, however the list changes while its confirmation
 * is open, and never touches another character's list when the selection moves.
 *
 * Mounts the REAL `RegexList.svelte` / `RegexData.svelte` and `TriggerV1List.svelte` /
 * `TriggerV1Data.svelte`. The list is bound the way `CharConfig.svelte` binds it: a
 * getter and setter that resolve the selected character's list at every use. The alert
 * confirm is a mock the test holds open and answers. Titles beginning "guard:" pin
 * behaviour that must be preserved before and after the change; every other test is
 * a regression reproducer for the behaviour it names.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Component } from 'svelte'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const confirms = vi.hoisted(() => {
    const pending: Array<{ message: string, settle: (answer: boolean) => void }> = []
    return {
        pending,
        ask: (message: string) => new Promise<boolean>((settle) => { pending.push({ message, settle }) }),
    }
})

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: confirms.ask,
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => {}),
    sortableOptions: { delay: 300, delayOnTouchOnly: true, filter: '.no-sort', onMove: () => true },
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/scripts'), () => ({
    exportRegex: vi.fn(),
    importRegex: vi.fn(),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock('sortablejs', () => ({
    default: { create: () => ({ destroy() {} }) },
}))

// The detail editors' text area pulls in the highlighter and the hotkey table, which a
// row's delete button never touches.
vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', () => ({
    default: () => {},
}))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import { allRowsGeometry, setWindowGeometryForTests } from 'src/ts/windowing/windowHost.svelte'
import RegexList from './RegexList.svelte'
import TriggerV1List from './TriggerV1List.svelte'

//#region helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

type ListKey = 'customscript' | 'triggerscript'
type Script = { comment: string }

interface Kind {
    name: string
    component: Component<{ value?: Script[] }>
    key: ListKey
    make: (comment: string) => Script
}

const kinds: Kind[] = [
    {
        name: 'regex script',
        component: RegexList as unknown as Kind['component'],
        key: 'customscript',
        make: (comment) => ({ comment, in: '', out: '', type: 'editinput' }),
    },
    {
        name: 'V1 trigger',
        component: TriggerV1List as unknown as Kind['component'],
        key: 'triggerscript',
        make: (comment) => ({ comment, type: 'start', conditions: [], effect: [] }),
    },
]

/** The selected character's index, reactive, as `$selectedCharID` is for `CharConfig.svelte`. */
const selection = $state({ index: 0 })

function installDb(kind: Kind, lists: string[][]): void {
    selection.index = 0
    DBState.db = {
        characters: lists.map((names, i) => ({
            chaId: 'c' + i, name: 'c' + i, type: 'character', chatPage: 0, chats: [],
            [kind.key]: names.map(kind.make),
        })),
    } as unknown as Database
}

const names = (kind: Kind, c = 0) => (DBState.db.characters[c] as unknown as Record<ListKey, Script[]>)[kind.key].map((s) => s.comment)

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

async function mountList(kind: Kind): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const props = {
        get value() {
            return (DBState.db.characters[selection.index] as unknown as Record<ListKey, Script[]> | undefined)?.[kind.key]
        },
        set value(next: Script[]) {
            const owner = DBState.db.characters[selection.index] as unknown as Record<ListKey, Script[]> | undefined
            if (owner) owner[kind.key] = next
        },
    }
    const app = mount(kind.component, { target, props }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    // The windowed rows mount once the host has read the band.
    await settle()
    return target
}

function deleteButton(target: HTMLElement, title: string): HTMLButtonElement {
    const span = Array.from(target.querySelectorAll('span')).find((s) => s.textContent?.trim() === title)
    if (!span) throw new Error('row not found: ' + title)
    const buttons = Array.from(span.closest('div')!.querySelectorAll('button')) as HTMLButtonElement[]
    return buttons[buttons.length - 1]
}

async function clickDelete(target: HTMLElement, title: string): Promise<void> {
    deleteButton(target, title).click()
    await settle()
}

async function answer(value: boolean): Promise<void> {
    const next = confirms.pending.shift()
    if (!next) throw new Error('no confirmation is open')
    next.settle(value)
    await settle()
}

beforeEach(() => {
    confirms.pending.length = 0
    // Every row falls in the window: these tests are about which script a delete aims at, not about which rows are in the page.
    setWindowGeometryForTests(allRowsGeometry())
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    setWindowGeometryForTests(undefined)
})

//#endregion

describe.each(kinds.map((k) => [k.name, k] as const))('a %s delete', (_name, kind) => {
    const four = () => [['s0', 's1', 's2', 's3']]

    test('guard: with nothing else changing, the confirmed script is removed and no other', async () => {
        installDb(kind, four())
        const target = await mountList(kind)
        await clickDelete(target, 's1')
        await answer(true)
        expect(names(kind)).toEqual(['s0', 's2', 's3'])
    })

    test('guard: refusing the confirmation removes nothing', async () => {
        installDb(kind, four())
        const target = await mountList(kind)
        await clickDelete(target, 's1')
        await answer(false)
        expect(names(kind)).toEqual(['s0', 's1', 's2', 's3'])
    })

    test('a script inserted above it while the confirmation is open does not change which script is removed', async () => {
        installDb(kind, four())
        const target = await mountList(kind)
        await clickDelete(target, 's2')
        DBState.db.characters[0][kind.key]!.unshift(kind.make('new') as never)
        flushSync()
        await answer(true)
        expect(names(kind)).toEqual(['new', 's0', 's1', 's3'])
    })

    test('a script removed above it while the confirmation is open does not change which script is removed', async () => {
        installDb(kind, four())
        const target = await mountList(kind)
        await clickDelete(target, 's2')
        DBState.db.characters[0][kind.key]!.splice(0, 1)
        flushSync()
        await answer(true)
        expect(names(kind)).toEqual(['s1', 's3'])
    })

    test('two pending deletes of the same script remove it once', async () => {
        installDb(kind, four())
        const target = await mountList(kind)
        await clickDelete(target, 's1')
        await clickDelete(target, 's1')
        expect(confirms.pending.length).toBe(2)
        await answer(true)
        await answer(true)
        expect(names(kind)).toEqual(['s0', 's2', 's3'])
    })

    test('a script removed by something else while its confirmation is open leaves every other script in place', async () => {
        installDb(kind, four())
        const target = await mountList(kind)
        await clickDelete(target, 's1')
        DBState.db.characters[0][kind.key]!.splice(1, 1)
        flushSync()
        await answer(true)
        expect(names(kind)).toEqual(['s0', 's2', 's3'])
    })

    test('a selection that moves to another character during the confirmation leaves that character\'s list untouched', async () => {
        installDb(kind, [['s0', 's1', 's2'], ['t0', 't1', 't2']])
        const target = await mountList(kind)
        await clickDelete(target, 's1')
        selection.index = 1
        flushSync()
        await answer(true)
        expect(names(kind, 1)).toEqual(['t0', 't1', 't2'])
        expect(names(kind, 0)).toEqual(['s0', 's1', 's2'])
    })
})
