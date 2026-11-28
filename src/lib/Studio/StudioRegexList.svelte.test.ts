// @vitest-environment jsdom
/**
 * The regex list: the row menu by row class, the operations through the real history service, the Undo toast, focus, keys and the
 * window. MOCKED as in StudioRegexPane.svelte.test.ts; window geometry through setWindowGeometryForTests.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0, saveAsset: vi.fn() }))
vi.mock('src/ts/alert', () => ({ alertMd: vi.fn() }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: { characters: [], modules: [] } as unknown })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        ReloadGUIPointer: writable(0),
        selectedCharID: writable(0),
    }
})

import { language } from 'src/lang'
import { DBState, ReloadGUIPointer } from 'src/ts/stores.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey } from '../../ts/studio/history/ownerPhase'
import { setStudioHistoryServiceForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { makeCharacter } from '../../ts/studio/history/tests/objService.test-helpers'
import { studioScreen } from '../../ts/studio/studioScreen.svelte'
import { click, focusedPart, key, mountInto, part, parts, settle, setupRig, teardownRig } from './StudioLorePane.rig.test-helpers'
import { toastHost } from '../../ts/toast/toastHost.svelte'
import { setWindowGeometryForTests } from '../../ts/windowing/windowHost.svelte'
import StudioRegexPane from './StudioRegexPane.svelte'

type Entry = Record<string, unknown>

const A = characterOwnerKey('A')
const M1 = moduleOwnerKey('M1')

// The classic add shape, the shape `RegexData` writes, and an upstream entry whose stage and key this app does not know.
const addShape = (comment: string): Entry => ({ comment, in: 'find-' + comment, out: 'out-' + comment, type: 'editinput' })
const classicShape = (comment: string, flag: string, ableFlag: boolean): Entry => ({ comment, in: 'find-' + comment, out: 'out-' + comment, type: 'editoutput', flag, ableFlag })
const upstreamShape = (): Entry => ({ comment: 'up', in: 'a', out: 'b', type: 'edit_future', x_future: { a: 1 } })

let service: OwnerHistoryService

async function start(host: 'character' | 'module', list: unknown): Promise<void> {
    DBState.db = (host === 'character'
        ? { characters: [makeCharacter({ customscript: list } as never)], modules: [] }
        : { characters: [makeCharacter()], modules: [{ id: 'M1', name: 'M1', assets: [], regex: list }] }) as unknown as typeof DBState.db
    service = createOwnerHistoryService({
        store: createMemoryStudioStore({}),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        openModuleId: () => 'M1',
    })
    service.setModuleAck('M1', { noteEdit: () => {} })
    setStudioHistoryServiceForTests(service)
    await service.whenReady(A)
    await service.whenReady(M1)
}

async function mountRegex(host: 'character' | 'module'): Promise<HTMLElement> {
    const props: Record<string, unknown> = host === 'character'
        ? { ownerType: 'character', ownerId: 'A', chaId: 'A', moduleId: null, moduleSlotIndex: null }
        : { ownerType: 'module', ownerId: 'M1', chaId: 'A', moduleId: 'M1', moduleSlotIndex: 0 }
    Object.defineProperty(props, 'itemId', { enumerable: true, get: () => studioScreen.selectedItemId })
    studioScreen.selectedOwnerKey = host === 'character' ? 'character:A' : 'module:M1'
    studioScreen.selectedKind = 'regex'
    const mounted = mountInto(StudioRegexPane, props)
    await settle()
    return mounted
}

const liveList = (host: 'character' | 'module'): Entry[] => host === 'character'
    ? (DBState.db.characters as unknown as { customscript: Entry[] }[])[0].customscript
    : (DBState.db.modules as unknown as { regex: Entry[] }[])[0].regex
const ownerOf = (host: 'character' | 'module') => host === 'character' ? A : M1
const doneOf = (host: 'character' | 'module') => service.view(ownerOf(host)).done

async function openRow(index: number): Promise<void> {
    const button = document.querySelector<HTMLElement>(`[data-part="studio-regex-row"][data-index="${index}"]`)
    await click(button)
}

const byTestId = <T extends HTMLElement>(id: string): T => {
    const found = document.querySelector<T>(`[data-testid="${id}"]`)
    if (found === null) throw new Error(`no element with data-testid ${id}`)
    return found
}
const area = (name: string): HTMLTextAreaElement => {
    const found = part(name)
    if (!(found instanceof HTMLTextAreaElement)) throw new Error(`no textarea ${name}`)
    return found
}

beforeEach(() => {
    setupRig()
    ReloadGUIPointer.set(0)
})
afterEach(async () => {
    setWindowGeometryForTests(undefined)
    await teardownRig()
})

const HOSTS = ['character', 'module'] as const
const menuButton = (index: number): HTMLElement | null => parts('studio-regex-row-menu')[index] ?? null
const names = (host: 'character' | 'module'): unknown[] => liveList(host).map((row) => row.comment)

async function chooseItem(name: string): Promise<void> {
    await click(part(name))
}

describe('the row menu by row class', () => {
    test('a readable row offers move up, down, top, bottom, duplicate and delete', async () => {
        await start('character', [addShape('a'), addShape('b')])
        await mountRegex('character')
        await click(menuButton(0))
        expect(parts('studio-regex-menu')).toHaveLength(1)
        const items = Array.from(document.querySelectorAll('[data-part="studio-regex-menu"] [role="menuitem"]')).map((item) => item.getAttribute('data-part'))
        expect(items).toEqual(['studio-regex-move-up', 'studio-regex-move-down', 'studio-regex-move-top', 'studio-regex-move-bottom', 'studio-regex-duplicate', 'studio-regex-delete'])
    })

    test('an unreadable object offers move and delete but no duplicate; an inert element offers delete only', async () => {
        await start('character', [{ comment: 'x', in: 123, out: '', type: 'editinput' }, null, addShape('ok')])
        await mountRegex('character')
        expect(parts('studio-regex-row-menu')).toHaveLength(3)
        await click(parts('studio-regex-row-menu')[0])
        expect(part('studio-regex-duplicate')).toBeNull()
        expect(part('studio-regex-delete')).not.toBeNull()
        expect(part('studio-regex-move-down')).not.toBeNull()
        await click(parts('studio-regex-row-menu')[1])
        const items = Array.from(document.querySelectorAll('[data-part="studio-regex-menu"] [role="menuitem"]')).map((item) => item.getAttribute('data-part'))
        expect(items).toEqual(['studio-regex-delete'])
    })
})

describe('T8, T11 (UI): operations through the menu', () => {
    test.each(HOSTS)('move down from the menu reorders the %s list and keeps focus on the moved row', async (host) => {
        await start(host, [addShape('a'), addShape('b'), addShape('c')])
        await mountRegex(host)
        await click(menuButton(0))
        await chooseItem('studio-regex-move-down')
        expect(names(host)).toEqual(['b', 'a', 'c'])
        expect(doneOf(host)).toHaveLength(1)
        expect(focusedPart()).toBe('studio-regex-row-menu')
    })

    test.each(HOSTS)('duplicate from the menu inserts a copy after the row of the %s list', async (host) => {
        await start(host, [addShape('a'), addShape('b')])
        await mountRegex(host)
        await click(menuButton(0))
        await chooseItem('studio-regex-duplicate')
        expect(names(host)).toEqual(['a', 'a', 'b'])
        expect(liveList(host)[0]).not.toBe(liveList(host)[1])
    })

    test.each(HOSTS)('delete asks nothing, posts one Undo toast, and Undo puts the row back (%s)', async (host) => {
        await start(host, [addShape('a'), addShape('b'), addShape('c')])
        await mountRegex(host)
        await click(menuButton(1))
        await chooseItem('studio-regex-delete')
        expect(names(host)).toEqual(['a', 'c'])
        expect(toastHost.visible.map((toast) => toast.text)).toEqual([language.studioRegexDeleted('b')])
        await toastHost.activate(toastHost.visible[0].id)
        await settle()
        expect(names(host)).toEqual(['a', 'b', 'c'])
        expect(toastHost.visible.map((toast) => toast.text)).toEqual([language.studioRegexToastRestored])
    })

    test('after a delete focus goes to the next row, else the previous one, else the list', async () => {
        await start('character', [addShape('a'), addShape('b')])
        await mountRegex('character')
        await click(menuButton(0))
        await chooseItem('studio-regex-delete')
        await settle()
        expect(document.activeElement?.closest('[data-part="studio-regex-row"]')?.textContent).toContain('b')
        await click(menuButton(0))
        await chooseItem('studio-regex-delete')
        await settle()
        expect(document.activeElement).toBe(part('studio-regex-list-root'))
    })

    test('deleting a middle row focuses the next row, not the previous one', async () => {
        await start('character', [addShape('a'), addShape('b'), addShape('c')])
        await mountRegex('character')
        await click(menuButton(1))
        await chooseItem('studio-regex-delete')
        await settle()
        expect(document.activeElement?.closest('[data-part="studio-regex-row"]')?.textContent).toContain('c')
    })

    test('Alt+ArrowDown on a row moves it; Delete on a row deletes it', async () => {
        await start('character', [addShape('a'), addShape('b')])
        await mountRegex('character')
        key(parts('studio-regex-row')[0], { key: 'ArrowDown', altKey: true })
        await settle()
        expect(names('character')).toEqual(['b', 'a'])
        key(parts('studio-regex-row')[0], { key: 'Delete' })
        await settle()
        expect(names('character')).toEqual(['a'])
    })

    test('a row changed in place between opening the menu and choosing an item is refused, not acted on', async () => {
        await start('character', [addShape('a'), addShape('a')])
        await mountRegex('character')
        await click(menuButton(1))
        liveList('character')[1].comment = 'edited outside'
        flushSync()
        await chooseItem('studio-regex-delete')
        expect(names('character')).toEqual(['a', 'edited outside'])
        expect(doneOf('character')).toHaveLength(0)
        expect(part('studio-regex-list-refusal')).not.toBeNull()
    })
})

describe('Add', () => {
    test.each(HOSTS)('adds the classic entry, opens its editor and focuses the name field (%s)', async (host) => {
        await start(host, [addShape('a')])
        await mountRegex(host)
        await click(part('studio-regex-add'))
        await settle()
        expect(liveList(host)).toHaveLength(2)
        expect(liveList(host)[1]).toEqual({ comment: '', in: '', out: '', type: 'editinput' })
        expect(part('studio-regex-form')).not.toBeNull()
        expect(document.activeElement).toBe(document.querySelector('[data-testid="studio-regex-name"]'))
    })

    test('Add on an absent list creates the list', async () => {
        await start('character', undefined)
        await mountRegex('character')
        await click(part('studio-regex-add'))
        expect(liveList('character')).toHaveLength(1)
    })
})

describe('T23: the window', () => {
    test('300 rows mount only a band of rows', async () => {
        let frames: (() => void)[] = []
        setWindowGeometryForTests({
            rectOf: () => ({ top: 0, height: 600 }),
            viewport: () => 600,
            scrollBy: () => {},
            schedule: (callback) => {
                frames.push(callback)
                return () => { frames = frames.filter((frame) => frame !== callback) }
            },
        })
        await start('character', Array.from({ length: 300 }, (_, index) => addShape(`r${index}`)))
        await mountRegex('character')
        for (let round = 0; round < 4; round++) {
            const pending = frames
            frames = []
            for (const frame of pending) frame()
            flushSync()
            await new Promise<void>((resolve) => setTimeout(resolve, 30))
        }
        const mounted = parts('studio-regex-row').length
        expect(mounted).toBeGreaterThan(0)
        expect(mounted).toBeLessThan(150)
    })
})
