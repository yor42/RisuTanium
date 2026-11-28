// @vitest-environment jsdom
/**
 * The Import and Export buttons of the lorebook list. Pane tests run the real history service and the real
 * `runLoreImport` over files made by the real producer (`lorebookExportBytes`); list-only tests mount the list with a
 * `runOwn` spy to prove what a pick that outlives its surface may write. MOCKED: the picker, the file reader (it reads
 * the producer's envelope as the classic reader does), the save call, the page store, the save-mark counter and the alert layer.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    pick: vi.fn(),
    save: vi.fn(),
}))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0 }))
vi.mock('src/ts/alert', () => ({ alertMd: vi.fn() }))
vi.mock('src/ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('src/ts/characters', () => ({ updateLorebooks: (book: unknown) => book }))
vi.mock('src/ts/util', () => ({ selectMultipleFile: h.pick }))
vi.mock('src/ts/downloadFile', () => ({ downloadFile: h.save }))
vi.mock('src/ts/process/lorebook.svelte', async () => {
    const { NoLorebookInPng } = await import('src/ts/process/lorebookFile')
    return {
        parseLorebookImport: (data: Uint8Array): unknown[] => {
            if (data.length === 0) throw new NoLorebookInPng()
            return (JSON.parse(Buffer.from(data).toString('utf-8')) as { data: unknown[] }).data
        },
    }
})
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: { characters: [] } as unknown })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        ReloadGUIPointer: writable(0),
    }
})

import { language } from 'src/lang'
import { lorebookExportBytes } from 'src/ts/process/lorebookFile'
import { toastHost } from 'src/ts/toast/toastHost.svelte'
import type { LoreOp } from 'src/ts/studio/edit/loreListOps'
import type { LoreSurface } from 'src/ts/studio/edit/loreListModel'
import { clone, golden } from '../../ts/studio/history/tests/objService.test-helpers'
import StudioLoreList from './StudioLoreList.svelte'
import { click, doneCount, lore, mountInto, mountPane, part, row, service, setupRig, settle, startCharacter, teardownRig, unmountLast } from './StudioLorePane.rig.test-helpers'

beforeEach(() => {
    h.pick.mockReset()
    h.save.mockReset()
    setupRig()
})
afterEach(async () => {
    await teardownRig()
})

type Picked = { name: string, data: Uint8Array }
const fileOf = (name: string, list: unknown): Picked => ({ name, data: lorebookExportBytes(list) })
const toasts = () => toastHost.visible.map((toast) => ({ kind: toast.kind, text: toast.text, sub: toast.sub }))

async function until(condition: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 100 && !condition(); attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 30))
        flushSync()
    }
    expect(condition()).toBe(true)
}

function deferredPick(): { release: (files: Picked[] | null) => void } {
    let release!: (files: Picked[] | null) => void
    h.pick.mockReturnValueOnce(new Promise<Picked[] | null>((resolve) => { release = resolve }))
    return { release }
}

describe('T-UI1: the buttons and the flow through the pane', () => {
    test('Import appends both files as one step and the toast names the renamed and skipped counts, joined by one space', async () => {
        await startCharacter([{ ...row(0), id: 'id-x' }])
        await mountPane()
        h.pick.mockResolvedValueOnce([fileOf('a.json', [{ ...row(10), id: 'id-x' }, null]), fileOf('b.json', [row(11)])])
        await click(part('studio-lore-import'))
        await until(() => toasts().length === 1)
        expect(lore()).toHaveLength(3)
        expect(doneCount()).toBe(1)
        expect(lore()[1].id).not.toBe('id-x')
        expect(toasts()).toEqual([{ kind: 'info', text: 'Imported 2 entries', sub: `${language.studioLoreImportRenamed(1, 0)} ${language.studioLoreImportSkipped(1)}` }])
    })

    test('a cancelled pick writes and shows nothing', async () => {
        await startCharacter([row(0)])
        await mountPane()
        h.pick.mockResolvedValueOnce(null)
        await click(part('studio-lore-import'))
        await until(() => h.pick.mock.calls.length === 1)
        await settle()
        expect(lore()).toHaveLength(1)
        expect(toasts()).toEqual([])
    })

    test('a PNG without a lorebook shows errors.noData and writes nothing', async () => {
        await startCharacter([row(0)])
        await mountPane()
        h.pick.mockResolvedValueOnce([{ name: 'a.png', data: new Uint8Array() }])
        await click(part('studio-lore-import'))
        await until(() => toasts().length === 1)
        expect(toasts()[0]).toMatchObject({ kind: 'error', text: language.errors.noData })
        expect(lore()).toHaveLength(1)
        expect(doneCount()).toBe(0)
    })

    test('a failure in file 2 of 2 writes nothing for file 1 either', async () => {
        await startCharacter([row(0)])
        await mountPane()
        h.pick.mockResolvedValueOnce([fileOf('a.json', [row(10)]), { name: 'b.json', data: new TextEncoder().encode('not json') }])
        await click(part('studio-lore-import'))
        await until(() => toasts().length === 1)
        expect(toasts()[0].kind).toBe('error')
        expect(toasts()[0].text.startsWith('SyntaxError')).toBe(true)
        expect(lore()).toHaveLength(1)
        expect(doneCount()).toBe(0)
    })

    test('a file with no entries shows studioLoreImportNone and writes nothing', async () => {
        await startCharacter([row(0)])
        await mountPane()
        h.pick.mockResolvedValueOnce([fileOf('a.json', [])])
        await click(part('studio-lore-import'))
        await until(() => toasts().length === 1)
        expect(toasts()[0]).toMatchObject({ kind: 'info', text: language.studioLoreImportNone })
        expect(lore()).toHaveLength(1)
        expect(doneCount()).toBe(0)
    })

    test('Export is disabled on an empty list and saves the classic bytes from a list with rows', async () => {
        await startCharacter([])
        await mountPane()
        expect(part('studio-lore-export')!.hasAttribute('disabled')).toBe(true)
        await teardownRig()
        setupRig()
        const rows = clone(golden.mixedRows.globalLore)
        await startCharacter(rows)
        await mountPane()
        h.save.mockResolvedValueOnce(true)
        expect(part('studio-lore-export')!.hasAttribute('disabled')).toBe(false)
        await click(part('studio-lore-export'))
        await until(() => h.save.mock.calls.length === 1)
        const [name, bytes] = h.save.mock.calls[0] as [string, Uint8Array]
        expect(name).toBe('lorebook_export.json')
        expect(Buffer.from(bytes).equals(Buffer.from(lorebookExportBytes(rows)))).toBe(true)
        expect(service).toBeDefined()
    })
})

describe('T-UI1/T-UI2: the list alone', () => {
    function mountList(overrides: { editable?: boolean, rows?: unknown[] } = {}) {
        const current = { n: 1 }
        const runOwn = vi.fn((_op: LoreOp, _effect: string, _surface: LoreSurface) => ({ ok: true as const }))
        const rows = overrides.rows ?? [row(0)]
        const props: Record<string, unknown> = {
            ownerKey: 'character:A',
            ownerId: 'A',
            host: 'character',
            readLive: () => rows,
            editable: overrides.editable ?? true,
            bulkEnabling: false,
            expanded: new Set<string>(),
            focusRequest: null,
            surfaceIsLive: (surface: LoreSurface) => surface.token.from === 'list' && surface.token.n === current.n,
            runOwn,
            requestDelete: () => {},
            onexpand: () => {},
            ontoggle: () => {},
            onfocused: () => {},
        }
        Object.defineProperty(props, 'listToken', { enumerable: true, get: () => current.n })
        mountInto(StudioLoreList, props)
        return { current, runOwn }
    }

    test('a read-only list disables Import and keeps Export enabled while it has rows', () => {
        mountList({ editable: false })
        expect(part('studio-lore-import')!.hasAttribute('disabled')).toBe(true)
        expect(part('studio-lore-export')!.hasAttribute('disabled')).toBe(false)
    })

    test('a token change while the pick is pending calls runOwn never', async () => {
        const { current, runOwn } = mountList()
        const pick = deferredPick()
        part('studio-lore-import')!.click()
        await until(() => h.pick.mock.calls.length === 1)
        current.n = 2
        pick.release([fileOf('a.json', [row(10)])])
        await settle()
        expect(runOwn).not.toHaveBeenCalled()
        expect(toasts()).toEqual([])
    })

    test('a list destroyed while the pick is pending calls runOwn never', async () => {
        const { runOwn } = mountList()
        const pick = deferredPick()
        part('studio-lore-import')!.click()
        await until(() => h.pick.mock.calls.length === 1)
        await unmountLast()
        pick.release([fileOf('a.json', [row(10)])])
        await settle()
        expect(runOwn).not.toHaveBeenCalled()
        expect(toasts()).toEqual([])
    })

    test('a live surface after the pick calls runOwn once with the same-row effect', async () => {
        const { runOwn } = mountList()
        const pick = deferredPick()
        part('studio-lore-import')!.click()
        await until(() => h.pick.mock.calls.length === 1)
        pick.release([fileOf('a.json', [row(10)])])
        await until(() => runOwn.mock.calls.length === 1)
        expect(runOwn.mock.calls[0][1]).toBe('same')
    })
})
