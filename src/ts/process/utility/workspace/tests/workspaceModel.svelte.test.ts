import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, UtilityWorkspace } from '../../../../storage/database.svelte'
import { registerDbChangeEffects } from '../../../../storage/dbChangeEffects.svelte'
import type { toSaveType } from '../../../../storage/risuSave'
import { assembleDatabase, type EncodedTree } from '../../../../storage/store2/codec'
import { asDatabase, buildSmall, encodeWith, type Obj } from '../../../../storage/tests/store2/codecFixtures'
import { resetTopLevelChangesForTests, topLevelChangeCount } from '../../../../storage/topLevelChanges'

vi.mock(import('../../../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as typeof import('../../../../stores.svelte')
})

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

import { DBState, selectedCharID } from '../../../../stores.svelte'
import {
    commitWorkspaceChange, createWorkspace, deleteWorkspace, hasWorkspace, listFiles, listWorkspaces, readText, renameWorkspace,
    statFile, WORKSPACE_LIMITS, type WorkspaceChangeError, type WorkspaceEnv,
} from '../workspaceModel.svelte'

// T10: the workspace model. Every write goes through commitWorkspaceChange; a refused change leaves nothing behind, caps are
// enforced here (MC-3373, MC-3414), deletes are final (MC-3377), and the save sees every mutation.

const MIB = 1024 * 1024

function envOf(): WorkspaceEnv {
    let n = 0
    let clock = 1000
    return { now: () => ++clock, newId: () => `id${++n}` }
}

let env = envOf()

function reset(list?: UtilityWorkspace[]): void {
    DBState.db = (list === undefined ? {} : { utilityWorkspaces: list }) as unknown as Database
    env = envOf()
}

function db(): Database {
    return DBState.db
}

function make(name = 'W'): string {
    return createWorkspace(name, env)
}

function write(id: string, path: string, text: string) {
    return commitWorkspaceChange(id, [{ kind: 'write', path, text }], env)
}

function errorOf(result: ReturnType<typeof write>): WorkspaceChangeError {
    if (result.ok === true) {
        throw new Error('expected a refusal')
    }
    return result.error
}

function snapshotOf(): unknown {
    return $state.snapshot(db().utilityWorkspaces)
}

beforeEach(() => reset())

describe('workspaces and files', () => {
    test('create, rename, list, delete', () => {
        const a = make('A')
        const b = make('B')
        expect(listWorkspaces().map(w => [w.id, w.name, w.fileCount, w.bytes])).toEqual([[a, 'A', 0, 0], [b, 'B', 0, 0]])
        expect(renameWorkspace(a, 'A2')).toBe(true)
        expect(renameWorkspace('nope', 'x')).toBe(false)
        expect(listWorkspaces()[0].name).toBe('A2')
        expect(deleteWorkspace(a)).toBe(true)
        expect(deleteWorkspace(a)).toBe(false)
        expect(hasWorkspace(a)).toBe(false)
        expect(hasWorkspace(b)).toBe(true)
    })

    test('write creates, replaces in place and keeps the file id; reads go through readText', () => {
        const id = make()
        expect(write(id, './docs/a.md', 'one').ok).toBe(true)
        const first = statFile(id, 'docs/a.md')
        expect(first).toMatchObject({ path: 'docs/a.md', size: 3, placeholder: false })
        expect(readText(id, 'docs/a.md')).toEqual({ state: 'ok', text: 'one' })
        expect(write(id, 'docs/a.md', '한글').ok).toBe(true)
        const second = statFile(id, 'docs/a.md')
        expect(second?.id).toBe(first?.id)
        expect(second?.size).toBe(6)
        expect(second!.mtime).toBeGreaterThan(first!.mtime)
        expect(listFiles(id)).toHaveLength(1)
        expect(readText(id, 'docs/missing.md')).toEqual({ state: 'missing' })
        expect(readText('nope', 'docs/a.md')).toEqual({ state: 'missing' })
    })

    test('move keeps id and text; delete is final', () => {
        const id = make()
        write(id, 'a.md', 'text')
        const before = statFile(id, 'a.md')!
        expect(commitWorkspaceChange(id, [{ kind: 'move', from: 'a.md', to: 'dir/b.md' }], env).ok).toBe(true)
        expect(statFile(id, 'a.md')).toBeUndefined()
        expect(statFile(id, 'dir/b.md')?.id).toBe(before.id)
        expect(readText(id, 'dir/b.md')).toEqual({ state: 'ok', text: 'text' })
        expect(commitWorkspaceChange(id, [{ kind: 'delete', path: 'dir/b.md' }], env).ok).toBe(true)
        expect(listFiles(id)).toEqual([])
        expect(readText(id, 'dir/b.md')).toEqual({ state: 'missing' })
    })

    test('a placeholder reads as damaged, never as empty text, counts its size and is replaced by a write', () => {
        reset([{ id: 'w', name: 'W', createdAt: 1, files: [{ id: 'f', path: 'lost.md', size: 40, mtime: 3 }] }])
        expect(readText('w', 'lost.md')).toEqual({ state: 'damaged' })
        expect(statFile('w', 'lost.md')).toMatchObject({ placeholder: true, size: 40 })
        expect(listWorkspaces()[0].bytes).toBe(40)
        expect(write('w', 'lost.md', 'new').ok).toBe(true)
        expect(readText('w', 'lost.md')).toEqual({ state: 'ok', text: 'new' })
        expect(statFile('w', 'lost.md')?.id).toBe('f')
    })

    test('unknown fields on workspaces and files survive a change', () => {
        reset([{ id: 'w', name: 'W', createdAt: 1, files: [{ id: 'f', path: 'a.md', text: 'x', size: 1, mtime: 3, future: { n: 1 } } as never] , future2: 'kept' } as never])
        write('w', 'a.md', 'y')
        const [ws] = snapshotOf() as Obj[]
        expect(ws.future2).toBe('kept')
        expect((ws.files as Obj[])[0].future).toEqual({ n: 1 })
    })
})

describe('refusals', () => {
    test('a bad path, binary text and a missing target are refused with a code and nothing changes', () => {
        const id = make()
        write(id, 'keep.md', 'keep')
        const before = snapshotOf()
        expect(errorOf(write(id, '../x', 'a')).code).toBe('bad-path')
        expect(errorOf(write(id, 'a\\b', 'a')).code).toBe('bad-path')
        expect(errorOf(write(id, 'bin.dat', 'a\u0000b')).code).toBe('bad-text')
        expect(errorOf(write(id, 'lone.txt', 'a\ud800')).code).toBe('bad-text')
        expect(errorOf(commitWorkspaceChange(id, [{ kind: 'delete', path: 'nope.md' }], env)).code).toBe('not-found')
        expect(errorOf(commitWorkspaceChange(id, [{ kind: 'move', from: 'nope.md', to: 'x.md' }], env)).code).toBe('not-found')
        expect(errorOf(commitWorkspaceChange(id, [{ kind: 'move', from: 'keep.md', to: './keep.md' }], env)).code).toBe('same-path')
        expect(errorOf(commitWorkspaceChange('nope', [{ kind: 'write', path: 'a', text: '' }], env)).code).toBe('no-workspace')
        expect(snapshotOf()).toEqual(before)
    })

    test('a path equal to another under case folding or NFC collides, on write and on move', () => {
        const id = make()
        write(id, 'Readme.md', 'x')
        write(id, 'other.md', 'y')
        const collision = errorOf(write(id, 'README.MD', 'z'))
        expect(collision).toMatchObject({ code: 'collision', existing: 'Readme.md' })
        expect(errorOf(commitWorkspaceChange(id, [{ kind: 'move', from: 'other.md', to: 'readme.md' }], env)).code).toBe('collision')
        write(id, 'café.md', 'n')
        // NFC folds the second spelling to the stored path: the same file, replaced in place.
        expect(write(id, 'café.md', 'm').ok).toBe(true)
        expect(listFiles(id).filter(file => file.path.startsWith('caf'))).toHaveLength(1)
        expect(readText(id, 'café.md')).toEqual({ state: 'ok', text: 'm' })
    })

    test('atomic: a multi-file change whose last op is refused applies none of it', () => {
        const id = make()
        write(id, 'a.md', 'a')
        const before = snapshotOf()
        const result = commitWorkspaceChange(id, [
            { kind: 'write', path: 'b.md', text: 'b' },
            { kind: 'delete', path: 'a.md' },
            { kind: 'write', path: '../evil', text: 'c' },
        ], env)
        expect(result.ok).toBe(false)
        expect(snapshotOf()).toEqual(before)
        expect(readText(id, 'a.md')).toEqual({ state: 'ok', text: 'a' })
        expect(readText(id, 'b.md')).toEqual({ state: 'missing' })
    })

    test('atomic: a change that overruns a cap applies none of its files', () => {
        const id = make()
        const before = snapshotOf()
        const ops = Array.from({ length: 26 }, (_, i) => ({ kind: 'write' as const, path: `f${i}.txt`, text: 'a'.repeat(MIB) }))
        expect(errorOf(commitWorkspaceChange(id, ops, env)).code).toBe('workspace-too-large')
        expect(snapshotOf()).toEqual(before)
    })

    test('a multi-op change sees its own earlier ops', () => {
        const id = make()
        const result = commitWorkspaceChange(id, [
            { kind: 'write', path: 'a.md', text: 'a' },
            { kind: 'move', from: 'a.md', to: 'b.md' },
            { kind: 'write', path: 'c.md', text: 'c' },
            { kind: 'delete', path: 'c.md' },
        ], env)
        expect(result.ok).toBe(true)
        expect(listFiles(id).map(file => file.path)).toEqual(['b.md'])
    })
})

describe('caps', () => {
    test('the defaults are the decided numbers', () => {
        expect(WORKSPACE_LIMITS).toEqual({ fileBytes: MIB, workspaceBytes: 25 * MIB, workspaceFiles: 500, totalBytes: 100 * MIB })
    })

    test('one file: exactly 1 MiB passes, one byte more is refused', () => {
        const id = make()
        expect(write(id, 'ok.txt', 'a'.repeat(MIB)).ok).toBe(true)
        expect(errorOf(write(id, 'big.txt', 'a'.repeat(MIB + 1))).code).toBe('file-too-large')
        expect(errorOf(write(id, 'wide.txt', '가'.repeat(Math.ceil(MIB / 3) + 1))).code).toBe('file-too-large')
        expect(statFile(id, 'big.txt')).toBeUndefined()
    })

    test('one workspace: 25 MiB passes, one more byte is refused', () => {
        const id = make()
        const full = Array.from({ length: 25 }, (_, i) => ({ kind: 'write' as const, path: `f${i}.txt`, text: 'a'.repeat(MIB) }))
        expect(commitWorkspaceChange(id, full, env).ok).toBe(true)
        expect(errorOf(write(id, 'one.txt', 'a')).code).toBe('workspace-too-large')
        // Replacing a file with a same-size one does not grow the workspace.
        expect(write(id, 'f0.txt', 'b'.repeat(MIB)).ok).toBe(true)
    })

    test('file count: 500 files pass, the 501st is refused', () => {
        const id = make()
        const five = Array.from({ length: 500 }, (_, i) => ({ kind: 'write' as const, path: `d/${i}.txt`, text: 'x' }))
        expect(commitWorkspaceChange(id, five, env).ok).toBe(true)
        expect(errorOf(write(id, 'more.txt', 'x')).code).toBe('too-many-files')
        expect(listFiles(id)).toHaveLength(500)
        expect(write(id, 'd/0.txt', 'replaced').ok).toBe(true)
    })

    test('all workspaces together: 100 MiB passes, one more byte in any workspace is refused', () => {
        const ids = [make('a'), make('b'), make('c'), make('d'), make('e')]
        const full = Array.from({ length: 25 }, (_, i) => ({ kind: 'write' as const, path: `f${i}.txt`, text: 'a'.repeat(MIB) }))
        for (const id of ids.slice(0, 4)) {
            expect(commitWorkspaceChange(id, full, env).ok).toBe(true)
        }
        expect(errorOf(write(ids[4], 'x.txt', 'a')).code).toBe('total-too-large')
        expect(listFiles(ids[4])).toEqual([])
    })

    test('a shrinking change is allowed while the profile is over a cap, and a placeholder keeps its share', () => {
        reset([
            { id: 'w', name: 'W', createdAt: 1, files: [{ id: 'p', path: 'lost.md', size: 25 * MIB, mtime: 1 }] },
            { id: 'v', name: 'V', createdAt: 1, files: [{ id: 'q', path: 'lost.md', size: 25 * MIB, mtime: 1 }, { id: 'r', path: 'a.md', text: 'ab', size: 2, mtime: 1 }] },
            { id: 'u', name: 'U', createdAt: 1, files: [{ id: 's', path: 'lost.md', size: 25 * MIB, mtime: 1 }] },
            { id: 't', name: 'T', createdAt: 1, files: [{ id: 'z', path: 'lost.md', size: 25 * MIB, mtime: 1 }] },
        ])
        expect(errorOf(write('w', 'x', 'a')).code).toBe('workspace-too-large')
        expect(errorOf(write('v', 'y', 'a')).code).toBe('workspace-too-large')
        reset([
            { id: 'w', name: 'W', createdAt: 1, files: [{ id: 'p', path: 'lost.md', size: 20 * MIB, mtime: 1 }] },
            { id: 'v', name: 'V', createdAt: 1, files: [{ id: 'q', path: 'lost.md', size: 20 * MIB, mtime: 1 }] },
            { id: 'u', name: 'U', createdAt: 1, files: [{ id: 's', path: 'lost.md', size: 20 * MIB, mtime: 1 }] },
            { id: 't', name: 'T', createdAt: 1, files: [{ id: 'z', path: 'lost.md', size: 20 * MIB, mtime: 1 }] },
            { id: 'k', name: 'K', createdAt: 1, files: [{ id: 'y', path: 'lost.md', size: 20 * MIB, mtime: 1 }] },
            { id: 'l', name: 'L', createdAt: 1, files: [{ id: 'x', path: 'a.md', text: 'ab', size: 2, mtime: 1 }] },
        ])
        // 100 MiB + 2 bytes already: growing is refused, shrinking and replacing with less is not.
        expect(errorOf(write('l', 'b.md', 'a')).code).toBe('total-too-large')
        expect(write('l', 'a.md', 'a').ok).toBe(true)
        expect(commitWorkspaceChange('w', [{ kind: 'delete', path: 'lost.md' }], env).ok).toBe(true)
    })
})

describe('the save sees every mutation', () => {
    let cleanup: (() => void) | undefined
    const markChanged = vi.fn()

    function register(): void {
        reset([])
        db().botPresets = []
        db().modules = []
        db().loadouts = []
        db().plugins = []
        db().pluginCustomStorage = {}
        db().characters = []
        selectedCharID.set(0)
        const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
        cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        resetTopLevelChangesForTests()
        markChanged.mockClear()
    }

    afterEach(() => {
        cleanup?.()
        cleanup = undefined
        selectedCharID.set(-1)
        resetTopLevelChangesForTests()
    })

    /** The settings-level changes one operation causes after registration settled. */
    function changesAfter(operation: () => void): number {
        const before = topLevelChangeCount()
        operation()
        flushSync()
        return topLevelChangeCount() - before
    }

    test('create, write, move, delete, rename and workspace delete each mark a settings-level change', () => {
        register()
        let id = ''
        expect(changesAfter(() => { id = make() })).toBeGreaterThan(0)
        expect(changesAfter(() => { write(id, 'a.md', 'one') })).toBeGreaterThan(0)
        expect(changesAfter(() => { write(id, 'a.md', 'two') })).toBeGreaterThan(0)
        expect(changesAfter(() => { commitWorkspaceChange(id, [{ kind: 'move', from: 'a.md', to: 'b.md' }], env) })).toBeGreaterThan(0)
        expect(changesAfter(() => { commitWorkspaceChange(id, [{ kind: 'delete', path: 'b.md' }], env) })).toBeGreaterThan(0)
        expect(changesAfter(() => { renameWorkspace(id, 'renamed') })).toBeGreaterThan(0)
        expect(changesAfter(() => { deleteWorkspace(id) })).toBeGreaterThan(0)
        expect(markChanged).toHaveBeenCalledWith(true)
    })

    test('a refused change marks nothing', () => {
        register()
        const id = make()
        flushSync()
        expect(changesAfter(() => { write(id, '../x', 'a') })).toBe(0)
    })
})

describe('the store2 save round trip uses the model state', () => {
    function assemble(tree: EncodedTree): Database {
        const bytes = new Map<string, Uint8Array>()
        for (const unit of tree.units) {
            if (unit.reused === false) {
                bytes.set(unit.key, unit.bytes)
            }
        }
        return assembleDatabase(tree.manifest, { get: key => bytes.get(key) })
    }

    test('workspaces built through the model encode to type 28/29 units and assemble equal', () => {
        const a = make('A')
        const b = make('B')
        commitWorkspaceChange(a, [
            { kind: 'write', path: 'AGENTS.md', text: 'rules' },
            { kind: 'write', path: 'notes/한글.md', text: '메모\nline' },
            { kind: 'write', path: 'old.md', text: 'old' },
            { kind: 'move', from: 'old.md', to: 'new.md' },
        ], env)
        commitWorkspaceChange(b, [{ kind: 'write', path: 'x.txt', text: 'x' }], env)
        const list = $state.snapshot(db().utilityWorkspaces) as unknown as Obj[]
        const tree = encodeWith(asDatabase({ ...(buildSmall(1) as unknown as Obj), utilityWorkspaces: list }))
        expect(tree.manifest.req).toEqual(['utility-workspaces'])
        const back = assemble(tree)
        expect(back.utilityWorkspaces).toEqual(list)
        expect(back.utilityWorkspaces?.[0].files.map(file => file.path)).toEqual(['AGENTS.md', 'notes/한글.md', 'new.md'])
    })
})
