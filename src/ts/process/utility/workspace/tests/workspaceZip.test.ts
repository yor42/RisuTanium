import { unzipSync, zipSync } from 'fflate'
import { writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, UtilityWorkspace } from '../../../../storage/database.svelte'

vi.mock(import('../../../../stores.svelte'), () => {
    const state = { db: {} as unknown as Database }
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as typeof import('../../../../stores.svelte')
})

import { DBState } from '../../../../stores.svelte'
import { listFiles, readText, WORKSPACE_LIMITS, type WorkspaceEnv } from '../workspaceModel.svelte'
import {
    ZIP_ENTRY_LIMIT, ZIP_UNPACKED_LIMIT, exportWorkspaceZip, importZipIntoWorkspace, planZipImport, type CollisionChoice,
} from '../workspaceZip'

// T11: the zip import engine. The archive is untrusted: every case below builds the archive like the real producer (fflate
// zipSync) and patches bytes only for shapes zipSync refuses to write (flags, lying sizes, repeated or non-UTF-8 names).

const MIB = 1024 * 1024
const encoder = new TextEncoder()
const text = (value: string): Uint8Array => encoder.encode(value)

interface PatchTarget {
    flagsAt: number
    methodAt: number
    declaredSizeAt: number
    madeByAt: number
    externalAt: number
    nameAt: number
    localNameAt: number
    name: string
}

/** Applies `patch` to the central record (and, for names, the local header) of every entry in a zipSync archive. */
function patchEntries(zip: Uint8Array, patch: (entry: PatchTarget, view: DataView, bytes: Uint8Array) => void): Uint8Array {
    const bytes = zip.slice()
    const view = new DataView(bytes.buffer)
    let end = bytes.length - 22
    while (view.getUint32(end, true) !== 0x06054b50) {
        end--
    }
    let at = view.getUint32(end + 16, true)
    const count = view.getUint16(end + 10, true)
    for (let index = 0; index < count; index++) {
        const nameLength = view.getUint16(at + 28, true)
        const localAt = view.getUint32(at + 42, true)
        patch({
            flagsAt: at + 8,
            methodAt: at + 10,
            declaredSizeAt: at + 24,
            madeByAt: at + 4,
            externalAt: at + 38,
            nameAt: at + 46,
            localNameAt: localAt + 30,
            name: new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)),
        }, view, bytes)
        at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
    }
    return bytes
}

function names(plan: ReturnType<typeof planZipImport>): { accepted: string[], refused: Array<[string, string]> } {
    if (plan.ok === false) {
        throw new Error(`archive refused: ${plan.reason}`)
    }
    return { accepted: plan.accepted.map(file => file.path), refused: plan.refused.map(entry => [entry.name, entry.reason]) }
}

describe('planZipImport accepts text', () => {
    test('nested paths, a byte order mark and CRLF survive; directories are skipped silently', () => {
        const zip = zipSync({
            'docs/': new Uint8Array(0),
            'docs/a.md': new Uint8Array([0xef, 0xbb, 0xbf, ...text('hello\r\nworld')]),
            'b.txt': text('한글 ok'),
        })
        const plan = planZipImport(zip, [])
        expect(plan.ok).toBe(true)
        if (plan.ok === false) { return }
        expect(plan.accepted).toEqual([
            { path: 'docs/a.md', text: 'hello\r\nworld', size: 12 },
            { path: 'b.txt', text: '한글 ok', size: text('한글 ok').length },
        ])
        expect(plan.refused).toEqual([])
        expect(plan.collisions).toEqual([])
    })

    test('stored entries (method 0) are read too', () => {
        const zip = zipSync({ 'a.txt': [text('stored'), { level: 0 }] })
        expect(planZipImport(zip, [])).toMatchObject({ ok: true, accepted: [{ path: 'a.txt', text: 'stored' }] })
    })
})

describe('planZipImport refuses bad entries by name and keeps the rest', () => {
    const badNames: Array<[string, string]> = [
        ['dotdot', '../evil.txt'],
        ['nested dotdot', 'a/../../b.txt'],
        ['absolute', '/etc/passwd'],
        ['drive', 'C:/x.txt'],
        ['backslash', 'a\\b.txt'],
        ['dotdot backslash', '..\\evil.txt'],
        ['NUL', 'a\u0000b.txt'],
        ['control char', 'a\u0001b.txt'],
        ['reserved', 'nul.txt'],
        ['reserved dir', 'con/a.txt'],
        ['trailing dot', 'a.'],
        ['dot segment', 'a/./b.txt'],
        ['empty segment', 'a//b.txt'],
    ]
    test.each(badNames)('%s is refused as bad-name', (_label, name) => {
        const zip = zipSync({ [name]: text('x'), 'good.txt': text('ok') })
        expect(names(planZipImport(zip, []))).toEqual({ accepted: ['good.txt'], refused: [[name, 'bad-name']] })
    })

    test('a name that is not UTF-8 is refused', () => {
        const zip = patchEntries(zipSync({ 'abc.txt': text('x'), 'good.txt': text('ok') }), (entry, _view, bytes) => {
            if (entry.name === 'abc.txt') {
                bytes[entry.nameAt] = 0xff
                bytes[entry.localNameAt] = 0xff
            }
        })
        const result = names(planZipImport(zip, []))
        expect(result.accepted).toEqual(['good.txt'])
        expect(result.refused).toHaveLength(1)
        expect(result.refused[0][1]).toBe('bad-name')
    })

    test('an encrypted entry is refused', () => {
        const zip = patchEntries(zipSync({ 'secret.txt': text('x'), 'good.txt': text('ok') }), (entry, view) => {
            if (entry.name === 'secret.txt') {
                view.setUint16(entry.flagsAt, view.getUint16(entry.flagsAt, true) | 1, true)
            }
        })
        expect(names(planZipImport(zip, []))).toEqual({ accepted: ['good.txt'], refused: [['secret.txt', 'encrypted']] })
    })

    test('a symbolic link entry is refused', () => {
        const zip = patchEntries(zipSync({ 'link.txt': text('target'), 'good.txt': text('ok') }), (entry, view) => {
            if (entry.name === 'link.txt') {
                view.setUint16(entry.madeByAt, 3 << 8, true)
                view.setUint32(entry.externalAt, (0xa000 | 0o777) << 16 >>> 0, true)
            }
        })
        expect(names(planZipImport(zip, []))).toEqual({ accepted: ['good.txt'], refused: [['link.txt', 'symlink']] })
    })

    test('an unsupported compression method is refused', () => {
        const zip = patchEntries(zipSync({ 'a.txt': text('x'), 'good.txt': text('ok') }), (entry, view) => {
            if (entry.name === 'a.txt') {
                view.setUint16(entry.methodAt, 12, true)
            }
        })
        expect(names(planZipImport(zip, []))).toEqual({ accepted: ['good.txt'], refused: [['a.txt', 'unsupported-method']] })
    })

    test('binary entries are refused: NUL and invalid UTF-8', () => {
        const zip = zipSync({
            'zero.bin': new Uint8Array([0x61, 0, 0x62]),
            'latin1.txt': new Uint8Array([0x63, 0xe9, 0x64]),
            'good.txt': text('ok'),
        })
        expect(names(planZipImport(zip, []))).toEqual({
            accepted: ['good.txt'],
            refused: [['zero.bin', 'binary'], ['latin1.txt', 'binary']],
        })
    })

    test('a path repeated in the archive keeps the first and refuses the later entry', () => {
        const zip = patchEntries(zipSync({ 'a.txt': text('first'), 'b.txt': text('second') }), (entry, _view, bytes) => {
            if (entry.name === 'b.txt') {
                bytes[entry.nameAt] = 0x61
                bytes[entry.localNameAt] = 0x61
            }
        })
        const plan = planZipImport(zip, [])
        expect(names(plan)).toEqual({ accepted: ['a.txt'], refused: [['a.txt', 'duplicate']] })
        expect(plan.ok && plan.accepted[0].text).toBe('first')
    })

    test('paths that differ only by case or normalization collide: the later entry is refused', () => {
        const zip = zipSync({ 'a.txt': text('1'), 'A.TXT': text('2'), 'e\u0301.txt': text('3'), '\u00e9.txt': text('4') })
        expect(names(planZipImport(zip, []))).toEqual({
            accepted: ['a.txt', 'e\u0301.txt'.normalize('NFC')],
            refused: [['A.TXT', 'case-collision'], ['\u00e9.txt', 'duplicate']],
        })
    })
})

describe('planZipImport limits (zip bombs)', () => {
    test('an entry declaring more than a file holds is refused without inflating it', () => {
        const zip = zipSync({ 'big.txt': new Uint8Array(MIB + 1).fill(0x61), 'good.txt': text('ok') })
        const plan = planZipImport(zip, [])
        expect(names(plan)).toEqual({ accepted: ['good.txt'], refused: [['big.txt', 'too-large']] })
        expect(plan.ok && plan.unpackedBytes).toBe(2)
    })

    test('an entry whose declared size lies is stopped by the bytes it actually produces', () => {
        const zip = patchEntries(zipSync({ 'bomb.txt': new Uint8Array(50 * MIB).fill(0x61), 'good.txt': text('ok') }), (entry, view) => {
            if (entry.name === 'bomb.txt') {
                view.setUint32(entry.declaredSizeAt, 10, true)
            }
        })
        const plan = planZipImport(zip, [])
        expect(names(plan)).toEqual({ accepted: ['good.txt'], refused: [['bomb.txt', 'too-large']] })
        // Inflating stops within one compressed slice of the cap instead of producing 50 MiB.
        expect(plan.ok && plan.unpackedBytes).toBeLessThan(3 * MIB)
    })

    test('an archive that unpacks past 100 MiB is refused whole while unpacking', () => {
        const file = new Uint8Array(MIB).fill(0x61)
        const entries: Record<string, Uint8Array> = {}
        for (let index = 0; index <= ZIP_UNPACKED_LIMIT / MIB; index++) {
            entries[`f${index}.txt`] = file
        }
        const plan = planZipImport(zipSync(entries), [])
        expect(plan).toMatchObject({ ok: false, reason: 'unpacked-too-large' })
    })

    test('exactly the limit is not refused by the unpacked counter', () => {
        const file = new Uint8Array(MIB).fill(0x61)
        const entries: Record<string, Uint8Array> = {}
        for (let index = 0; index < ZIP_UNPACKED_LIMIT / MIB; index++) {
            entries[`f${index}.txt`] = file
        }
        const plan = planZipImport(zipSync(entries), [])
        expect(plan).toMatchObject({ ok: true })
        expect(plan.ok && plan.unpackedBytes).toBe(ZIP_UNPACKED_LIMIT)
    })

    test('more entries than the entry limit is refused whole', () => {
        const entries: Record<string, Uint8Array> = {}
        for (let index = 0; index <= ZIP_ENTRY_LIMIT; index++) {
            entries[`d${index}.txt`] = new Uint8Array(0)
        }
        expect(planZipImport(zipSync(entries), [])).toMatchObject({ ok: false, reason: 'too-many-entries' })
    })

    test('not a zip, truncated, and zip64 archives are refused whole', () => {
        expect(planZipImport(text('plain text'), [])).toMatchObject({ ok: false, reason: 'not-a-zip' })
        expect(planZipImport(new Uint8Array(0), [])).toMatchObject({ ok: false, reason: 'not-a-zip' })
        const zip = zipSync({ 'a.txt': text('x') })
        expect(planZipImport(zip.subarray(0, zip.length - 5), [])).toMatchObject({ ok: false })
        const zip64 = zip.slice()
        new DataView(zip64.buffer).setUint16(zip64.length - 22 + 10, 0xffff, true)
        expect(planZipImport(zip64, [])).toMatchObject({ ok: false, reason: 'zip64' })
    })

    test('an entry whose data lies outside the archive is refused, not read', () => {
        const zip = zipSync({ 'a.txt': text('hello'), 'good.txt': text('ok') })
        const cut = patchEntries(zip, (entry, view) => {
            if (entry.name === 'a.txt') {
                view.setUint32(entry.declaredSizeAt - 4, 0x7fffffff, true)
            }
        })
        expect(names(planZipImport(cut, []))).toEqual({ accepted: ['good.txt'], refused: [['a.txt', 'damaged']] })
    })
})

describe('planZipImport against existing files', () => {
    test('an equal path is a collision to ask about; a case-only difference is refused', () => {
        const zip = zipSync({ 'a.txt': text('new'), 'B.txt': text('new'), 'c.txt': text('new') })
        const plan = planZipImport(zip, ['a.txt', 'b.txt'])
        expect(plan.ok).toBe(true)
        if (plan.ok === false) { return }
        expect(plan.collisions).toEqual(['a.txt'])
        expect(plan.accepted.map(file => file.path)).toEqual(['a.txt', 'c.txt'])
        expect(plan.refused.map(entry => [entry.name, entry.reason])).toEqual([['B.txt', 'collides-with-existing']])
    })
})

let counter = 0
const env: WorkspaceEnv = { now: () => 1000, newId: () => `id${++counter}` }

function seed(files: Record<string, string | undefined>, size?: Record<string, number>): void {
    const workspace: UtilityWorkspace = {
        id: 'w',
        name: 'W',
        createdAt: 1,
        files: Object.entries(files).map(([path, body]) => ({
            id: `s-${path}`,
            path,
            text: body,
            size: body === undefined ? (size?.[path] ?? 10) : encoder.encode(body).length,
            mtime: 1,
        })),
    }
    DBState.db = { utilityWorkspaces: [workspace] } as unknown as Database
}

function filePaths(): string[] {
    return listFiles('w').map(file => file.path)
}

function asker(choice: CollisionChoice): { ask: (collisions: readonly string[]) => Promise<CollisionChoice>, calls: Array<readonly string[]> } {
    const calls: Array<readonly string[]> = []
    return { calls, ask: async (collisions) => { calls.push(collisions); return choice } }
}

describe('importZipIntoWorkspace', () => {
    beforeEach(() => {
        counter = 0
        seed({})
    })

    test('without collisions nothing is asked and every accepted file is written; refused ones are listed', async () => {
        const zip = zipSync({ 'a.txt': text('A'), '../x.txt': text('no'), 'sub/b.txt': text('B') })
        const { ask, calls } = asker('cancel')
        const result = await importZipIntoWorkspace('w', zip, ask, env)
        expect(calls).toEqual([])
        expect(result).toMatchObject({ ok: true, written: ['a.txt', 'sub/b.txt'], keptExisting: [] })
        expect(result.ok && result.refused.map(entry => entry.name)).toEqual(['../x.txt'])
        expect(filePaths()).toEqual(['a.txt', 'sub/b.txt'])
    })

    test('collisions ask once for all of them: replace overwrites', async () => {
        seed({ 'a.txt': 'old', 'b.txt': 'old', 'keep.txt': 'mine' })
        const zip = zipSync({ 'a.txt': text('new'), 'b.txt': text('new'), 'c.txt': text('new') })
        const { ask, calls } = asker('replace')
        const result = await importZipIntoWorkspace('w', zip, ask, env)
        expect(calls).toEqual([['a.txt', 'b.txt']])
        expect(result).toMatchObject({ ok: true, written: ['a.txt', 'b.txt', 'c.txt'] })
        expect(readText('w', 'a.txt')).toEqual({ state: 'ok', text: 'new' })
        expect(readText('w', 'keep.txt')).toEqual({ state: 'ok', text: 'mine' })
    })

    test('keep leaves existing files and still writes the new ones', async () => {
        seed({ 'a.txt': 'old' })
        const zip = zipSync({ 'a.txt': text('new'), 'c.txt': text('new') })
        const result = await importZipIntoWorkspace('w', zip, asker('keep').ask, env)
        expect(result).toMatchObject({ ok: true, written: ['c.txt'], keptExisting: ['a.txt'] })
        expect(readText('w', 'a.txt')).toEqual({ state: 'ok', text: 'old' })
        expect(readText('w', 'c.txt')).toEqual({ state: 'ok', text: 'new' })
    })

    test('cancel writes nothing', async () => {
        seed({ 'a.txt': 'old' })
        const zip = zipSync({ 'a.txt': text('new'), 'c.txt': text('new') })
        const result = await importZipIntoWorkspace('w', zip, asker('cancel').ask, env)
        expect(result).toEqual({ ok: false, reason: 'cancelled' })
        expect(filePaths()).toEqual(['a.txt'])
        expect(readText('w', 'a.txt')).toEqual({ state: 'ok', text: 'old' })
    })

    test('a workspace cap overrun refuses the whole import, including the acceptable files', async () => {
        seed({ 'keep.txt': 'x' })
        const entries: Record<string, Uint8Array> = {}
        for (let index = 0; index <= WORKSPACE_LIMITS.workspaceBytes / MIB; index++) {
            const body = new Uint8Array(MIB).fill(0x61)
            body[0] = 0x30 + (index % 10)
            entries[`f${index}.txt`] = body
        }
        const { ask, calls } = asker('replace')
        const result = await importZipIntoWorkspace('w', zipSync(entries), ask, env)
        expect(result).toMatchObject({ ok: false, reason: 'caps', error: { code: 'workspace-too-large' } })
        expect(calls).toEqual([])
        expect(filePaths()).toEqual(['keep.txt'])
    })

    test('a file-count overrun refuses the whole import', async () => {
        const entries: Record<string, Uint8Array> = {}
        for (let index = 0; index <= WORKSPACE_LIMITS.workspaceFiles; index++) {
            entries[`f${index}.txt`] = text('x')
        }
        const result = await importZipIntoWorkspace('w', zipSync(entries), asker('replace').ask, env)
        expect(result).toMatchObject({ ok: false, reason: 'caps', error: { code: 'too-many-files' } })
        expect(filePaths()).toEqual([])
    })

    test('a refused archive and a missing workspace change nothing', async () => {
        const { ask, calls } = asker('replace')
        expect(await importZipIntoWorkspace('w', text('not a zip'), ask, env)).toMatchObject({ ok: false, reason: 'archive', archive: 'not-a-zip' })
        expect(await importZipIntoWorkspace('missing', zipSync({ 'a.txt': text('x') }), ask, env)).toMatchObject({ ok: false, reason: 'no-workspace' })
        expect(calls).toEqual([])
        expect(filePaths()).toEqual([])
    })
})

describe('a workspace that changes while the collision question is open', () => {
    beforeEach(() => {
        counter = 0
        seed({ 'a.txt': 'old' })
    })

    function addDuringQuestion(path: string, body: string): (collisions: readonly string[]) => Promise<CollisionChoice> {
        return async () => {
            DBState.db.utilityWorkspaces![0].files.push({ id: `late-${path}`, path, text: body, size: encoder.encode(body).length, mtime: 1 })
            return 'replace'
        }
    }

    test('(R) T11: a path created during the question is not replaced unasked', async () => {
        const zip = zipSync({ 'a.txt': text('new'), 'b.txt': text('new') })
        const result = await importZipIntoWorkspace('w', zip, addDuringQuestion('b.txt', 'mine'), env)
        expect(result).toMatchObject({ ok: false, reason: 'changed' })
        expect(readText('w', 'b.txt')).toEqual({ state: 'ok', text: 'mine' })
        expect(readText('w', 'a.txt')).toEqual({ state: 'ok', text: 'old' })
    })

    test('(R) T11: a case variant created during the question is refused by name, not reported as a cap overrun', async () => {
        const zip = zipSync({ 'a.txt': text('new'), 'b.txt': text('new') })
        const result = await importZipIntoWorkspace('w', zip, addDuringQuestion('B.txt', 'mine'), env)
        expect(result).toMatchObject({ ok: true, written: ['a.txt'] })
        expect(result.ok && result.refused.map(entry => [entry.name, entry.reason])).toEqual([['b.txt', 'collides-with-existing']])
        expect(readText('w', 'B.txt')).toEqual({ state: 'ok', text: 'mine' })
        expect(readText('w', 'b.txt')).toEqual({ state: 'missing' })
    })

    test('(G) a collision path removed during the question is simply written', async () => {
        const zip = zipSync({ 'a.txt': text('new') })
        const result = await importZipIntoWorkspace('w', zip, async () => {
            DBState.db.utilityWorkspaces![0].files.splice(0, 1)
            return 'replace'
        }, env)
        expect(result).toMatchObject({ ok: true, written: ['a.txt'] })
        expect(readText('w', 'a.txt')).toEqual({ state: 'ok', text: 'new' })
    })

    test('(R) T11: a workspace deleted during the question reports no-workspace', async () => {
        const zip = zipSync({ 'a.txt': text('new') })
        const result = await importZipIntoWorkspace('w', zip, async () => {
            DBState.db.utilityWorkspaces = []
            return 'replace'
        }, env)
        expect(result).toMatchObject({ ok: false, reason: 'no-workspace' })
    })
})

describe('entry checksum', () => {
    test('(R) T11: a stored entry whose bytes no longer match its CRC-32 is refused as damaged and the others stay', () => {
        const zip = zipSync({ 'a.txt': [text('hello'), { level: 0 }], 'b.txt': text('fine') })
        const at = zip.findIndex((_byte, index) => String.fromCharCode(...zip.subarray(index, index + 5)) === 'hello')
        const altered = zip.slice()
        altered[at + 4] = 'p'.charCodeAt(0)
        const plan = planZipImport(altered, [])
        expect(names(plan)).toEqual({ accepted: ['b.txt'], refused: [['a.txt', 'damaged']] })
    })

    test('(R) T11: a deflated entry that inflates to other bytes than its CRC-32 is refused', () => {
        const zip = patchEntries(zipSync({ 'a.txt': text('hello world'), 'b.txt': text('fine') }), (entry, view) => {
            if (entry.name === 'a.txt') {
                view.setUint32(entry.declaredSizeAt - 8, 0x12345678, true)
            }
        })
        expect(names(planZipImport(zip, []))).toEqual({ accepted: ['b.txt'], refused: [['a.txt', 'damaged']] })
    })

    test('(G) the checksum of an archive the real producer wrote matches, including empty and non-ASCII entries', () => {
        const zip = zipSync({ 'e.txt': new Uint8Array(0), 'k.txt': text('한글 ok'), 'c.txt': [text('stored'), { level: 0 }] })
        expect(names(planZipImport(zip, []))).toEqual({ accepted: ['e.txt', 'k.txt', 'c.txt'], refused: [] })
    })
})

describe('exportWorkspaceZip', () => {
    test('exports every text file and round-trips through the import', async () => {
        seed({ 'a.txt': 'one', 'dir/b.md': '둘 two' })
        const exported = exportWorkspaceZip('w')
        expect(exported).toMatchObject({ ok: true, files: 2, omitted: [] })
        if (exported.ok === false) { return }
        expect(Object.keys(unzipSync(exported.bytes)).sort()).toEqual(['a.txt', 'dir/b.md'])
        seed({})
        const result = await importZipIntoWorkspace('w', exported.bytes, asker('cancel').ask, env)
        expect(result).toMatchObject({ ok: true, written: ['a.txt', 'dir/b.md'] })
        expect(readText('w', 'dir/b.md')).toEqual({ state: 'ok', text: '둘 two' })
    })

    test('a damaged placeholder refuses the export naming it, unless omission is asked for', () => {
        seed({ 'a.txt': 'one', 'lost.txt': undefined })
        expect(exportWorkspaceZip('w')).toEqual({ ok: false, reason: 'damaged', paths: ['lost.txt'] })
        const partial = exportWorkspaceZip('w', { omitDamaged: true })
        expect(partial).toMatchObject({ ok: true, files: 1, omitted: ['lost.txt'] })
        expect(exportWorkspaceZip('nope')).toMatchObject({ ok: false, reason: 'no-workspace' })
    })
})
