// @vitest-environment jsdom
// The Studio lore import and export flows with every outside dependency passed in: the pick, the read, the save and the
// notices. The service-backed flow (a deferred pick against the real history service) is in loreImport.service.svelte.test.ts.
import { describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/util', () => ({ selectMultipleFile: vi.fn() }))
vi.mock('src/ts/process/lorebook.svelte', () => ({ parseLorebookImport: vi.fn() }))
vi.mock('src/ts/downloadFile', () => ({ downloadFile: vi.fn() }))

import { language } from 'src/lang'
import { downloadNotice } from 'src/ts/exportNotice'
import { NoLorebookInPng, lorebookExportBytes } from 'src/ts/process/lorebookFile'
import type { BusyHandle } from 'src/ts/process/memory/busyActions'
import type { PlainToastInit } from 'src/ts/toast/toastHost.svelte'
import type { LiveReader } from 'src/ts/studio/history/historyModel'
import type { StudioResult } from 'src/ts/studio/history/ownerHistory.svelte'
import { runLoreExport, runLoreImport, type LoreExportDeps, type LoreImportDeps } from '../loreFileActions'
import type { LoreImportOp } from '../loreImport'

const file = (name: string) => ({ name, data: new Uint8Array([1]) })

function exportRig(save: LoreExportDeps['save']) {
    const toasts: PlainToastInit[] = []
    const saved: { name: string, bytes: Uint8Array }[] = []
    let ended = 0
    const busy = { end: () => { ended += 1 } } as unknown as BusyHandle
    const deps: LoreExportDeps = {
        beginBusy: () => busy,
        save: (name, bytes, handle) => {
            saved.push({ name, bytes })
            return save(name, bytes, handle)
        },
        toast: (init) => { toasts.push(init) },
    }
    return { deps, toasts, saved, ended: () => ended }
}

describe('T-UI3: runLoreExport', () => {
    const list = [{ id: 'a', comment: 'one', extra: 1 }, null, 'text']

    test('saves the classic export bytes under the classic name and posts the saved notice', async () => {
        const rig = exportRig(async () => true)
        await runLoreExport(list, rig.deps)
        expect(rig.saved).toHaveLength(1)
        expect(rig.saved[0].name).toBe('lorebook_export.json')
        expect(Buffer.from(rig.saved[0].bytes).equals(Buffer.from(lorebookExportBytes(list)))).toBe(true)
        expect(rig.toasts).toEqual([{ kind: 'info', text: downloadNotice(language.successExport) }])
        expect(rig.ended()).toBe(1)
    })

    test('a cancelled dialog posts nothing and still ends the busy mark', async () => {
        const rig = exportRig(async () => false)
        await runLoreExport(list, rig.deps)
        expect(rig.toasts).toEqual([])
        expect(rig.ended()).toBe(1)
    })

    test('a throwing save posts an error and still ends the busy mark', async () => {
        const rig = exportRig(async () => { throw new Error('disk full') })
        await runLoreExport(list, rig.deps)
        expect(rig.toasts).toEqual([{ kind: 'error', text: 'Error: disk full' }])
        expect(rig.ended()).toBe(1)
    })
})

describe('runLoreImport: pick, parse and notices', () => {
    function importRig(pick: LoreImportDeps['pick'], parse: LoreImportDeps['parse']) {
        const toasts: PlainToastInit[] = []
        const runs: LoreImportOp[] = []
        const deps: LoreImportDeps = { pick, parse, toast: (init) => { toasts.push(init) } }
        const run = (op: LoreImportOp): StudioResult => {
            runs.push(op)
            return { ok: true }
        }
        return { deps, toasts, runs, run }
    }

    test('a cancelled pick does nothing', async () => {
        const rig = importRig(async () => null, () => [])
        await runLoreImport('character', () => true, rig.run, rig.deps)
        expect(rig.runs).toEqual([])
        expect(rig.toasts).toEqual([])
    })

    test('a failure in file 2 of 2 writes nothing for either file and shows the error', async () => {
        const picked = [file('a'), file('b')]
        const second = importRig(async () => picked, (data) => {
            if (data === picked[1].data) throw new SyntaxError('bad json')
            return [{ comment: 'x' }]
        })
        await runLoreImport('character', () => true, second.run, second.deps)
        expect(second.runs).toEqual([])
        expect(second.toasts).toEqual([{ kind: 'error', text: 'SyntaxError: bad json' }])
    })

    test('a PNG without a lorebook shows errors.noData and writes nothing', async () => {
        const rig = importRig(async () => [file('a')], () => { throw new NoLorebookInPng() })
        await runLoreImport('character', () => true, rig.run, rig.deps)
        expect(rig.runs).toEqual([])
        expect(rig.toasts).toEqual([{ kind: 'error', text: language.errors.noData }])
    })

    test('a pick that no longer has a live surface is not parsed and writes nothing', async () => {
        const parse = vi.fn(() => [])
        const rig = importRig(async () => [file('a')], parse)
        await runLoreImport('character', () => false, rig.run, rig.deps)
        expect(parse).not.toHaveBeenCalled()
        expect(rig.runs).toEqual([])
        expect(rig.toasts).toEqual([])
    })

    test('files with no entries show studioLoreImportNone, with the skipped sentence when items were skipped', async () => {
        // The service builds the op and reports `unchanged` when it drafts nothing; the stub reader stands in for the live list.
        const empty = { objList: () => [] } as unknown as LiveReader
        const runUnchanged = (op: LoreImportOp): StudioResult => {
            op.build('A', empty)
            return { ok: true, unchanged: true }
        }
        const rig = importRig(async () => [file('a')], () => [])
        await runLoreImport('character', () => true, runUnchanged, rig.deps)
        expect(rig.toasts).toEqual([{ kind: 'info', text: language.studioLoreImportNone, sub: undefined }])

        const skipping = importRig(async () => [file('a')], () => [null, 7])
        await runLoreImport('character', () => true, runUnchanged, skipping.deps)
        expect(skipping.toasts).toEqual([{ kind: 'info', text: language.studioLoreImportNone, sub: language.studioLoreImportSkipped(2) }])
    })
})
