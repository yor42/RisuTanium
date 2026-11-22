/**
 * T17: the workspace client. It acts only on the workspace the run is bound to, reads and writes through the
 * workspace model, and answers every failure as an `{error}` result. Drives the real client and the real model
 * over a plain in-memory database.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, UtilityWorkspace } from '../../../storage/database.svelte'
import { newToolLoop, type ToolLoopState } from '../../request/toolLoop'

vi.mock('../../../stores.svelte', () => ({ DBState: { db: {} } }))

import { DBState } from '../../../stores.svelte'
import { listFiles, readText, WORKSPACE_LIMITS } from '../../utility/workspace/workspaceModel.svelte'
import { READ_FILE_MAX_BYTES, SEARCH_MATCH_MAX, WORKSPACE_TOOLS, WorkspaceClient } from '../workspaceclient'

type Result = Record<string, unknown>

function seed(workspaces: UtilityWorkspace[]): void {
    DBState.db = { utilityWorkspaces: workspaces } as unknown as Database
}

function file(id: string, path: string, text?: string, size?: number) {
    return { id, path, ...(text === undefined ? {} : { text }), size: size ?? new TextEncoder().encode(text ?? '').length, mtime: 1 }
}

function loopFor(workspaceId: string | null): ToolLoopState {
    const loop = newToolLoop(null)
    if (workspaceId !== null) {
        loop.workspace = { id: workspaceId }
    }
    return loop
}

async function call(name: string, args: unknown, workspaceId: string | null = 'ws-a'): Promise<Result> {
    const content = await new WorkspaceClient().callTool(name, args, { toolLoop: loopFor(workspaceId) })
    expect(content).toHaveLength(1)
    const first = content[0]
    return JSON.parse(first.type === 'text' ? first.text : '') as Result
}

function files(workspaceId = 'ws-a') {
    return listFiles(workspaceId).map(f => f.path).sort()
}

beforeEach(() => {
    seed([
        { id: 'ws-a', name: 'A', createdAt: 1, files: [file('f1', 'notes/a.md', 'alpha\nbeta\ngamma\n'), file('f2', 'SKILL.md', '---\nname: x\n---\nbody')] },
        { id: 'ws-b', name: 'B', createdAt: 1, files: [file('g1', 'secret.md', 'other workspace')] },
    ])
})

describe('the client as a server', () => {
    test('lists no tools itself; the run advertises the constant descriptors', async () => {
        expect(await new WorkspaceClient().getToolList()).toEqual([])
        expect(WORKSPACE_TOOLS.map(t => t.name)).toEqual(['list_files', 'read_file', 'search_files', 'write_file', 'edit_file', 'delete_file', 'move_file'])
    })

    test('without a bound workspace every tool is refused and nothing changes', async () => {
        expect(await call('write_file', { path: 'x.md', text: 'x' }, null)).toMatchObject({ error: expect.stringContaining('No workspace') })
        expect(await call('read_file', { path: 'notes/a.md' }, null)).toHaveProperty('error')
        expect(files()).toEqual(['SKILL.md', 'notes/a.md'])
    })

    test('a bound workspace that no longer exists is an error result', async () => {
        expect(await call('list_files', {}, 'ws-gone')).toMatchObject({ error: expect.stringContaining('no longer exists') })
    })

    test('a workspace_id argument is ignored: the run\'s workspace is the only one touched', async () => {
        const result = await call('write_file', { workspace_id: 'ws-b', path: 'x.md', text: 'x' })
        expect(result).toMatchObject({ path: 'x.md', created: true })
        expect(files('ws-a')).toContain('x.md')
        expect(files('ws-b')).toEqual(['secret.md'])
        expect(await call('read_file', { workspace_id: 'ws-b', path: 'secret.md' })).toHaveProperty('error')
        expect(await call('list_files', { workspaceId: 'ws-b' })).toMatchObject({ files: expect.arrayContaining([expect.objectContaining({ path: 'x.md' })]) })
    })

    test('an unknown tool, bad arguments and a throwing argument are error results, never throws', async () => {
        expect(await call('format_disk', {})).toMatchObject({ error: expect.stringContaining('Unknown workspace tool') })
        expect(await call('toString', {})).toMatchObject({ error: expect.stringContaining('Unknown workspace tool') })
        expect(await call('write_file', { path: 5, text: 'x' })).toHaveProperty('error')
        expect(await call('write_file', { path: 'x.md' })).toHaveProperty('error')
        expect(await call('write_file', undefined)).toHaveProperty('error')
        const hostile = { get path(): string { throw new Error('boom') } }
        expect(await call('read_file', hostile)).toMatchObject({ error: expect.stringContaining('boom') })
    })
})

describe('the read tools', () => {
    test('list_files lists every file or the files under a directory, sorted', async () => {
        expect(await call('list_files', {})).toEqual({ files: [
            { path: 'SKILL.md', size: 20, mtime: 1 },
            { path: 'notes/a.md', size: 17, mtime: 1 },
        ] })
        expect((await call('list_files', { dir: 'notes/' }) as { files: { path: string }[] }).files.map(f => f.path)).toEqual(['notes/a.md'])
        expect(await call('list_files', { dir: 'note' })).toEqual({ files: [] })
        expect(await call('list_files', { dir: '../x' })).toHaveProperty('error')
    })

    test('read_file returns the lines with their range and also serves SKILL.md in full', async () => {
        expect(await call('read_file', { path: 'notes/a.md' })).toEqual({
            path: 'notes/a.md', size: 17, totalLines: 3, startLine: 1, endLine: 3, text: 'alpha\nbeta\ngamma', truncated: false,
        })
        expect(await call('read_file', { path: 'notes/a.md', offset: 2, limit: 1 })).toMatchObject({ startLine: 2, endLine: 2, text: 'beta', truncated: false })
        expect(await call('read_file', { path: 'notes/a.md', offset: 9 })).toMatchObject({ startLine: 0, endLine: 0, text: '', truncated: false })
        expect(await call('read_file', { path: './SKILL.md' })).toMatchObject({ text: '---\nname: x\n---\nbody' })
        expect(await call('read_file', { path: 'missing.md' })).toMatchObject({ code: 'not-found' })
        expect(await call('read_file', { path: 'notes/a.md', offset: 0 })).toHaveProperty('error')
        expect(await call('read_file', { path: 'a\\b' })).toMatchObject({ code: 'bad-path' })
    })

    test('read_file returns at most 64 KiB per call and says so', async () => {
        const line = 'x'.repeat(99)
        const big = Array.from({ length: 2000 }, () => line).join('\n')
        seed([{ id: 'ws-a', name: 'A', createdAt: 1, files: [file('f1', 'big.txt', big)] }])

        const first = await call('read_file', { path: 'big.txt' }) as { text: string, truncated: boolean, endLine: number }
        expect(new TextEncoder().encode(first.text).length).toBeLessThanOrEqual(READ_FILE_MAX_BYTES)
        expect(first.truncated).toBe(true)
        expect(first.endLine).toBeLessThan(2000)
        const next = await call('read_file', { path: 'big.txt', offset: first.endLine + 1 }) as { startLine: number }
        expect(next.startLine).toBe(first.endLine + 1)
    })

    test('a single line longer than the cap is cut, not dropped', async () => {
        seed([{ id: 'ws-a', name: 'A', createdAt: 1, files: [file('f1', 'long.txt', 'あ'.repeat(40000))] }])
        const result = await call('read_file', { path: 'long.txt' }) as { text: string, truncated: boolean }
        expect(result.truncated).toBe(true)
        expect(new TextEncoder().encode(result.text).length).toBeLessThanOrEqual(READ_FILE_MAX_BYTES)
        expect(result.text.length).toBeGreaterThan(1000)
    })

    test('search_files finds a plain substring, case-insensitively unless asked, within a prefix', async () => {
        expect(await call('search_files', { query: 'BETA' })).toEqual({ matches: [{ path: 'notes/a.md', line: 2, text: 'beta' }], truncated: false })
        expect(await call('search_files', { query: 'BETA', case_sensitive: true })).toEqual({ matches: [], truncated: false })
        expect(await call('search_files', { query: 'a', path_prefix: 'SKILL' })).toEqual({ matches: [{ path: 'SKILL.md', line: 2, text: 'name: x' }], truncated: false })
        expect(await call('search_files', { query: 'a', path_prefix: 'notes/' })).toMatchObject({ matches: [{ path: 'notes/a.md', line: 1 }, { path: 'notes/a.md', line: 2 }, { path: 'notes/a.md', line: 3 }] })
        expect(await call('search_files', { query: '.*' })).toEqual({ matches: [], truncated: false })
        expect(await call('search_files', { query: '' })).toHaveProperty('error')
    })

    test('search_files stops at the match cap and cuts long lines', async () => {
        const body = Array.from({ length: SEARCH_MATCH_MAX + 50 }, () => `hit ${'y'.repeat(400)}`).join('\n')
        seed([{ id: 'ws-a', name: 'A', createdAt: 1, files: [file('f1', 'many.txt', body)] }])
        const result = await call('search_files', { query: 'hit' }) as { matches: { text: string }[], truncated: boolean }
        expect(result.matches).toHaveLength(SEARCH_MATCH_MAX)
        expect(result.truncated).toBe(true)
        expect(result.matches[0].text).toHaveLength(300)
    })
})

describe('a placeholder file whose text could not be read', () => {
    beforeEach(() => {
        seed([{ id: 'ws-a', name: 'A', createdAt: 1, files: [file('f1', 'lost.md', undefined, 40), file('f2', 'ok.md', 'needle here')] }])
    })

    test('read and edit answer an error, never an empty file; list marks it', async () => {
        expect(await call('read_file', { path: 'lost.md' })).toMatchObject({ code: 'damaged' })
        expect(await call('edit_file', { path: 'lost.md', old_text: 'a', new_text: 'b' })).toMatchObject({ code: 'damaged' })
        expect(readText('ws-a', 'lost.md')).toEqual({ state: 'damaged' })
        expect(await call('list_files', {})).toEqual({ files: [
            { path: 'lost.md', size: 40, mtime: 1, damaged: true },
            { path: 'ok.md', size: 11, mtime: 1 },
        ] })
    })

    test('search skips it, names it, and still searches the rest', async () => {
        expect(await call('search_files', { query: 'needle' })).toEqual({
            matches: [{ path: 'ok.md', line: 1, text: 'needle here' }], truncated: false, damaged: ['lost.md'],
        })
    })

    test('write replaces it and delete removes it', async () => {
        expect(await call('write_file', { path: 'lost.md', text: 'fresh' })).toMatchObject({ path: 'lost.md', size: 5, created: false })
        expect(readText('ws-a', 'lost.md')).toEqual({ state: 'ok', text: 'fresh' })
        seed([{ id: 'ws-a', name: 'A', createdAt: 1, files: [file('f1', 'lost.md', undefined, 40)] }])
        expect(await call('delete_file', { path: 'lost.md' })).toEqual({ path: 'lost.md', deleted: true })
        expect(files()).toEqual([])
    })
})

describe('the mutating tools', () => {
    test('write_file creates or replaces and reports the size', async () => {
        expect(await call('write_file', { path: './dir/new.md', text: 'héllo' })).toEqual({ path: 'dir/new.md', size: 6, created: true })
        expect(await call('write_file', { path: 'dir/new.md', text: 'x' })).toEqual({ path: 'dir/new.md', size: 1, created: false })
        expect(readText('ws-a', 'dir/new.md')).toEqual({ state: 'ok', text: 'x' })
    })

    test('write_file refusals come back as error results and change nothing', async () => {
        const big = 'x'.repeat(WORKSPACE_LIMITS.fileBytes + 1)
        expect(await call('write_file', { path: 'big.md', text: big })).toMatchObject({ code: 'file-too-large' })
        expect(await call('write_file', { path: '../up.md', text: 'x' })).toMatchObject({ code: 'bad-path' })
        expect(await call('write_file', { path: 'NOTES/A.md', text: 'x' })).toMatchObject({ code: 'collision' })
        expect(await call('write_file', { path: 'bin.md', text: 'a\u0000b' })).toMatchObject({ code: 'bad-text' })
        expect(files()).toEqual(['SKILL.md', 'notes/a.md'])
    })

    test('write_file past the workspace count cap is refused', async () => {
        seed([{ id: 'ws-a', name: 'A', createdAt: 1, files: Array.from({ length: WORKSPACE_LIMITS.workspaceFiles }, (_, i) => file(`f${i}`, `f${i}.md`, '')) }])
        expect(await call('write_file', { path: 'one-more.md', text: '' })).toMatchObject({ code: 'too-many-files' })
    })

    test('edit_file replaces exactly one match, refuses an ambiguous or missing one, and replace_all replaces every match', async () => {
        seed([{ id: 'ws-a', name: 'A', createdAt: 1, files: [file('f1', 'e.md', 'one two one')] }])
        expect(await call('edit_file', { path: 'e.md', old_text: 'two', new_text: '2' })).toEqual({ path: 'e.md', size: 9, replacements: 1 })
        expect(await call('edit_file', { path: 'e.md', old_text: 'one', new_text: '1' })).toMatchObject({ code: 'ambiguous-match' })
        expect(await call('edit_file', { path: 'e.md', old_text: 'zzz', new_text: '1' })).toMatchObject({ code: 'no-match' })
        expect(await call('edit_file', { path: 'e.md', old_text: '', new_text: '1' })).toHaveProperty('error')
        expect(readText('ws-a', 'e.md')).toEqual({ state: 'ok', text: 'one 2 one' })
        expect(await call('edit_file', { path: 'e.md', old_text: 'one', new_text: '1', replace_all: true })).toMatchObject({ replacements: 2 })
        expect(readText('ws-a', 'e.md')).toEqual({ state: 'ok', text: '1 2 1' })
        expect(await call('edit_file', { path: 'nope.md', old_text: 'a', new_text: 'b' })).toMatchObject({ code: 'not-found' })
    })

    test('a replacement text containing $ patterns is inserted literally', async () => {
        seed([{ id: 'ws-a', name: 'A', createdAt: 1, files: [file('f1', 'e.md', 'a')] }])
        await call('edit_file', { path: 'e.md', old_text: 'a', new_text: '$& $1 $$' })
        expect(readText('ws-a', 'e.md')).toEqual({ state: 'ok', text: '$& $1 $$' })
    })

    test('delete_file is final and an unknown file is an error', async () => {
        expect(await call('delete_file', { path: 'notes/a.md' })).toEqual({ path: 'notes/a.md', deleted: true })
        expect(files()).toEqual(['SKILL.md'])
        expect(await call('delete_file', { path: 'notes/a.md' })).toMatchObject({ code: 'not-found' })
    })

    test('move_file keeps the file and its text, refuses an existing destination unless overwrite is set', async () => {
        const idBefore = listFiles('ws-a').find(f => f.path === 'notes/a.md')?.id
        expect(await call('move_file', { from: 'notes/a.md', to: 'moved/a.md' })).toEqual({ from: 'notes/a.md', to: 'moved/a.md' })
        expect(listFiles('ws-a').find(f => f.path === 'moved/a.md')?.id).toBe(idBefore)
        expect(readText('ws-a', 'moved/a.md')).toEqual({ state: 'ok', text: 'alpha\nbeta\ngamma\n' })

        expect(await call('move_file', { from: 'moved/a.md', to: 'SKILL.md' })).toMatchObject({ code: 'collision' })
        expect(files()).toEqual(['SKILL.md', 'moved/a.md'])
        expect(await call('move_file', { from: 'moved/a.md', to: 'SKILL.md', overwrite: true })).toEqual({ from: 'moved/a.md', to: 'SKILL.md' })
        expect(files()).toEqual(['SKILL.md'])
        expect(readText('ws-a', 'SKILL.md')).toEqual({ state: 'ok', text: 'alpha\nbeta\ngamma\n' })
    })

    test('an overwrite move onto a destination that does not exist is a plain move', async () => {
        expect(await call('move_file', { from: 'notes/a.md', to: 'fresh/a.md', overwrite: true })).toEqual({ from: 'notes/a.md', to: 'fresh/a.md' })
        expect(files()).toEqual(['SKILL.md', 'fresh/a.md'])
    })

    test('only overwrite: true replaces; a truthy non-boolean overwrite is refused like no overwrite', async () => {
        // The approval prompt warns of a delete only for overwrite === true, so the tool must not delete on anything else.
        for (const overwrite of ['true', 1]) {
            expect(await call('move_file', { from: 'notes/a.md', to: 'SKILL.md', overwrite })).toMatchObject({ code: 'collision' })
        }
        expect(files()).toEqual(['SKILL.md', 'notes/a.md'])
        expect(readText('ws-a', 'SKILL.md')).not.toEqual(readText('ws-a', 'notes/a.md'))
    })

    test('a refused overwrite move leaves the destination in place', async () => {
        expect(await call('move_file', { from: 'missing.md', to: 'SKILL.md', overwrite: true })).toMatchObject({ code: 'not-found' })
        expect(readText('ws-a', 'SKILL.md')).toMatchObject({ state: 'ok' })
    })
})
