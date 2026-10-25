/**
 * The mapping of a boot import result and of an export outcome to an `OperationEnd` outcome (`drive/operationEnd.ts`).
 * Pure functions: no store, no alert, no page. The shells that set `canceled` and `nothing-replaced` from their own
 * "write may have begun" flag are covered in `operationEndShells.svelte.test.ts`.
 *
 * Labels: new behaviour pinned by a mutant (a recorded in-memory edit of the module that turns the named test red).
 *  - boot rows: mutant "an unlisted blocked reason maps to nothing-replaced" fails the unlisted-reason test.
 *  - export rows: mutant "the partial export counts its inlays" fails the partial-export test; mutant "oldStoreUnlisted
 *    is not an omission" fails its row; mutant "repaired counts as an omission" fails the repaired row.
 */
import { describe, expect, test } from 'vitest'
import { BLOCKED_REASONS, type BlockedReason } from 'src/ts/storage/store2/bootActive'
import type { BootImportFinish } from 'src/ts/storage/store2/legacy/bootImport'
import { endOfExport, exportOmitsData, numberedBackupTarget, outcomeOfBootFinish, type ExportOmitted, type ExportOutcome } from 'src/ts/drive/operationEnd'

const blocked = (reason: BlockedReason): BootImportFinish => ({ status: 'blocked', reason, detail: 'recorded' })

/** Only the status of an `exit` result is read; the rest of its payload is not part of the mapping. */
const exitWith = (status: string): BootImportFinish => ({ status: 'exit', exit: { status } }) as unknown as BootImportFinish

describe('boot import result mapping', () => {
    test('new behaviour: an installed profile is committed', () => {
        expect(outcomeOfBootFinish({ status: 'installed', manifestKey: 'm', flushed: true, repair: { dropped: 0, changed: 0, recovered: 0 } }))
            .toEqual({ outcome: 'committed', cause: null })
    })

    test.each(['install-failed', 'install-upload-failed', 'install-invalid', 'marker-failed', 'presence-unknown'] as const)(
        'new behaviour: blocked %s is nothing-replaced and names its reason', (reason) => {
            expect(outcomeOfBootFinish(blocked(reason))).toEqual({ outcome: 'nothing-replaced', cause: reason })
        })

    test('new behaviour: blocked install-unknown is unknown', () => {
        expect(outcomeOfBootFinish(blocked('install-unknown'))).toEqual({ outcome: 'unknown', cause: 'install-unknown' })
    })

    test('new behaviour: reclassify is unknown', () => {
        expect(outcomeOfBootFinish({ status: 'reclassify' })).toEqual({ outcome: 'unknown', cause: null })
    })

    test.each(['unknown', 'conflict', 'abandoned', 'failed', 'refused', 'foreign-marker', 'fence'])('new behaviour: an exit that is %s is unknown', (status) => {
        expect(outcomeOfBootFinish(exitWith(status))).toEqual({ outcome: 'unknown', cause: null })
    })

    // Mutant: an unlisted reason mapped to nothing-replaced. Every reason the table does not name must claim nothing.
    test('new behaviour: every blocked reason the table does not list is unknown', () => {
        const listed: readonly BlockedReason[] = ['install-failed', 'install-upload-failed', 'install-invalid', 'marker-failed', 'presence-unknown']
        const unlisted = BLOCKED_REASONS.filter((reason) => !listed.includes(reason))
        expect(unlisted.length).toBeGreaterThan(10)
        for (const reason of unlisted) {
            expect(outcomeOfBootFinish(blocked(reason)).outcome, reason).toBe('unknown')
        }
    })
})

const none: ExportOmitted = { assets: [], oversize: [], units: [], inlays: [], oldStoreUnlisted: false, repaired: null }
const saved = (omitted: Partial<ExportOmitted>): ExportOutcome => ({ status: 'saved', notices: [], omitted: { ...none, ...omitted }, inlays: null })

describe('export outcome mapping', () => {
    test('new behaviour: nothing omitted is committed', () => {
        expect(endOfExport('export', saved({}), 'a.bin')).toMatchObject({ operation: 'export', target: 'a.bin', outcome: 'committed', cause: null })
    })

    test.each([
        ['assets', { assets: ['assets/a'] }],
        ['oversize', { oversize: ['big (4.00 GiB)'] }],
        ['units', { units: ['unit-1'] }],
        ['inlays', { inlays: [{ id: 'i', reason: 'unreadable' as const }] }],
        ['oldStoreUnlisted', { oldStoreUnlisted: true }],
    ])('new behaviour: a full export that omitted %s is permitted-partial', (_name, omitted) => {
        expect(endOfExport('export', saved(omitted)).outcome).toBe('permitted-partial')
    })

    // Mutant: the partial export counts its inlays. It writes none, so a listed inlay alone must not make it partial.
    test('new behaviour: the partial export\'s inlays alone do not make it permitted-partial', () => {
        const outcome = saved({ inlays: [{ id: 'i', reason: 'unsupported' }] })
        expect(endOfExport('export-partial', outcome).outcome).toBe('committed')
        expect(exportOmitsData('export-partial', { ...none, inlays: [{ id: 'i', reason: 'unsupported' }] })).toBe(false)
    })

    test.each([
        ['assets', { assets: ['assets/a'] }],
        ['oversize', { oversize: ['big'] }],
        ['units', { units: ['u'] }],
        ['oldStoreUnlisted', { oldStoreUnlisted: true }],
    ])('new behaviour: a partial export that omitted %s is permitted-partial', (_name, omitted) => {
        expect(endOfExport('export-partial', saved(omitted)).outcome).toBe('permitted-partial')
    })

    // Mutant: repaired counts as an omission.
    test('new behaviour: a repaired character list is not an omission', () => {
        expect(endOfExport('export', saved({ repaired: 'ids were repaired' })).outcome).toBe('committed')
    })

    test('new behaviour: a failed export carries what became of its file', () => {
        for (const file of ['kept', 'deleted', 'untouched'] as const) {
            const end = endOfExport('export', { status: 'failed', cause: new Error('x'), file })
            expect(end).toMatchObject({ outcome: 'failed', cause: null, detail: { omitted: null, inlays: null, file } })
        }
    })

    test.each(['incomplete-data-declined', 'save-dialog-cancelled', 'partial-explanation-declined', 'oversize-declined'] as const)(
        'new behaviour: a declined export (%s) is canceled and names its cause', (cause) => {
            expect(endOfExport('export-partial', { status: 'declined', cause })).toMatchObject({ outcome: 'canceled', cause, detail: { file: null } })
        })

    // Mutant: the file state of a cancelled export is dropped, so a kept partial download reads as no file.
    test.each(['kept', 'untouched'] as const)(
        'new behaviour: a cancelled export (file %s) is canceled, names its cause and carries what became of its file', (file) => {
            expect(endOfExport('export', { status: 'declined', cause: 'export-cancelled', file })).toMatchObject({
                outcome: 'canceled',
                cause: 'export-cancelled',
                detail: { omitted: null, inlays: null, file },
            })
        })
})

describe('numbered backup target', () => {
    test('new behaviour: an ISO 8601 time, independent of the locale', () => {
        expect(numberedBackupTarget(17_000_000_000)).toBe('2023-11-14T22:13:20.000Z')
    })
})
