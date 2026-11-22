/**
 * "Always for this workspace" at the tool gate (MC-3371, MC-3409, MC-3614): the real `authorizeToolCall` and the real grants
 * store (over an in-memory byte store) with a stub approver. A grant skips the prompt for one mutating workspace tool in the
 * bound workspace; a move that overwrites is never covered and never offered "always"; nothing is offered or matched
 * outside a workspace or while a restore holds the seal.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createMemoryByteStore, type MemoryByteStore } from '../../files/tests/memoryByteStore'
import { newToolLoop, advertisedToolKey } from '../../request/toolLoop'
import type { ToolApprovalRequest, ToolDecision } from '../toolApproval'

const h = vi.hoisted(() => ({
    store: null as ByteStore | null,
    asked: [] as Array<{ tool: string, url: string, kind: string, summary: string, view?: { action: Array<{ text: string, path?: boolean }>, instructionTarget: boolean, replacement: string | null, offerAlways: boolean } }>,
    answer: 'once' as 'once' | 'always' | 'deny',
}))

vi.mock('src/ts/storage/store/appStore', () => ({ getAppStore: async () => h.store }))
vi.mock('src/ts/alertPrompts', () => ({ queueNotice: () => { } }))
vi.mock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: {} } }))
vi.mock('../toolApproval', () => ({
    TOOL_SUMMARY_LIMIT: 800,
    askToolApproval: vi.fn(async (request: ToolApprovalRequest): Promise<ToolDecision> => {
        h.asked.push(request)
        return h.answer
    }),
}))

import { authorizeToolCall, describeToolCall, describeWorkspaceAction, workspaceActionParts } from '../toolAuthorize'
import { clearToolGrantsForRestore, hasToolGrant, resetToolGrantsForTests } from '../toolGrants'

const WS = 'internal:workspace'
let store: MemoryByteStore

function loopFor(workspaceId: string | null, signal?: AbortSignal) {
    const loop = newToolLoop(signal ?? null)
    if (workspaceId !== null) {
        loop.workspace = { id: workspaceId }
    }
    loop.advertised = new Set(['write_file', 'edit_file', 'delete_file', 'move_file', 'fs_write_file'].flatMap(name => [advertisedToolKey(name, WS), advertisedToolKey(name, 'internal:fs')]))
    return loop
}

const call = (name: string, args: unknown, workspaceId: string | null = 'ws1', url = WS) =>
    authorizeToolCall(name, args, { mcpURL: url, toolLoop: loopFor(workspaceId) })

beforeEach(() => {
    store = createMemoryByteStore()
    h.store = store
    h.asked.length = 0
    h.answer = 'once'
    resetToolGrantsForTests()
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

describe('allow always for this workspace', () => {
    test('the first call asks and offers always; after always the same tool in the same workspace runs without a question', async () => {
        h.answer = 'always'
        expect(await call('write_file', { path: 'a.txt', text: 'x' })).toBeNull()
        expect(h.asked).toHaveLength(1)
        expect(h.asked[0].view?.offerAlways).toBe(true)

        h.answer = 'deny'
        expect(await call('write_file', { path: 'b.txt', text: 'y' })).toBeNull()
        expect(h.asked).toHaveLength(1)
    })

    test('a once answer saves nothing', async () => {
        expect(await call('write_file', { path: 'a.txt', text: 'x' })).toBeNull()
        expect(await call('write_file', { path: 'a.txt', text: 'x' })).toBeNull()
        expect(h.asked).toHaveLength(2)
        expect(store.writes).toEqual([])
    })

    test('another workspace asks again (MC-3409)', async () => {
        h.answer = 'always'
        await call('write_file', { path: 'a.txt', text: 'x' }, 'ws1')
        await call('write_file', { path: 'a.txt', text: 'x' }, 'ws2')
        expect(h.asked).toHaveLength(2)
    })

    test('another tool in the same workspace asks again (MC-3409)', async () => {
        h.answer = 'always'
        await call('write_file', { path: 'a.txt', text: 'x' })
        await call('delete_file', { path: 'a.txt' })
        expect(h.asked.map(request => request.tool)).toEqual(['write_file', 'delete_file'])
    })

    test('a deny after always still denies and the denial is not saved', async () => {
        h.answer = 'deny'
        const result = await call('delete_file', { path: 'a.txt' })
        expect(result?.[0]).toMatchObject({ type: 'text', text: 'Denied by the user: delete_file' })
        expect(await hasToolGrant('ws1', 'delete_file')).toBe(false)
    })

    test('a run stopped after the answer saves no grant and runs nothing', async () => {
        const controller = new AbortController()
        h.answer = 'always'
        const loop = loopFor('ws1', controller.signal)
        const { askToolApproval } = await import('../toolApproval')
        vi.mocked(askToolApproval).mockImplementationOnce(async () => { controller.abort(); return 'always' })

        const result = await authorizeToolCall('write_file', { path: 'a.txt', text: 'x' }, { mcpURL: WS, toolLoop: loop })

        expect(result?.[0]).toMatchObject({ text: 'Stopped before write_file ran.' })
        expect(await hasToolGrant('ws1', 'write_file')).toBe(false)
    })
})

describe('a move that overwrites is never covered (MC-3614)', () => {
    test('with a move_file grant a plain move runs unasked and an overwrite move still asks, without offering always', async () => {
        h.answer = 'always'
        await call('move_file', { from: 'a.txt', to: 'b.txt' })
        expect(h.asked).toHaveLength(1)
        expect(h.asked[0].view?.offerAlways).toBe(true)

        expect(await call('move_file', { from: 'a.txt', to: 'c.txt' })).toBeNull()
        expect(h.asked).toHaveLength(1)

        expect(await call('move_file', { from: 'a.txt', to: 'b.txt', overwrite: true })).toBeNull()
        expect(h.asked).toHaveLength(2)
        expect(h.asked[1].view?.offerAlways).toBe(false)
        expect(h.asked[1].summary).toContain('DELETE')
    })

    test('an always answer to an overwrite move saves nothing', async () => {
        h.answer = 'always'
        await call('move_file', { from: 'a.txt', to: 'b.txt', overwrite: true })
        expect(await hasToolGrant('ws1', 'move_file')).toBe(false)
        expect(store.writes).toEqual([])
    })

    test('overwrite false is an ordinary move', async () => {
        h.answer = 'always'
        await call('move_file', { from: 'a.txt', to: 'b.txt', overwrite: false })
        expect(await hasToolGrant('ws1', 'move_file')).toBe(true)
    })
})

describe('where always is not offered', () => {
    test('a mutating tool of another client has no workspace: no view, no always, nothing saved', async () => {
        h.answer = 'always'
        expect(await call('fs_write_file', { path: 'a', content: 'x' }, null, 'internal:fs')).toBeNull()
        expect(h.asked[0].view).toBeUndefined()
        expect(store.writes).toEqual([])

        await call('fs_write_file', { path: 'a', content: 'x' }, null, 'internal:fs')
        expect(h.asked).toHaveLength(2)
    })

    test('a workspace tool without a bound workspace is refused before any question', async () => {
        const result = await call('write_file', { path: 'a.txt', text: 'x' }, null)
        expect(result).not.toBeNull()
        expect(h.asked).toEqual([])
    })

    test('while a restore holds the seal an existing grant does not match and always is not offered', async () => {
        h.answer = 'always'
        await call('write_file', { path: 'a.txt', text: 'x' })
        expect(h.asked).toHaveLength(1)
        const cleared = await clearToolGrantsForRestore()
        expect(cleared.ok).toBe(true)

        h.answer = 'once'
        await call('write_file', { path: 'a.txt', text: 'x' })

        expect(h.asked).toHaveLength(2)
        expect(h.asked[1].view?.offerAlways).toBe(false)
    })

    test('an always answer given while sealed saves nothing', async () => {
        await clearToolGrantsForRestore()
        h.answer = 'always'
        await call('write_file', { path: 'a.txt', text: 'x' })
        expect(await hasToolGrant('ws1', 'write_file')).toBe(false)
    })
})

describe('what the dialog is told', () => {
    test('paths are separate pieces, and the string action line is unchanged', () => {
        const parts = workspaceActionParts('move_file', { from: 'a.txt', to: 'b.txt' })
        expect(parts?.filter(part => part.path).map(part => part.text)).toEqual(['a.txt', 'b.txt'])
        expect(describeWorkspaceAction('move_file', { from: 'a.txt', to: 'b.txt' })).toBe('move workspace file (a.txt) to (b.txt)')
    })

    test('an overwrite move leads with the file that will be deleted', async () => {
        await call('move_file', { from: 'a.txt', to: 'b.txt', overwrite: true })
        expect(h.asked[0].view?.action.map(part => part.text).join('')).toMatch(/^DELETE and replace workspace file \(b\.txt\)/)
    })

    test.each([
        ['write_file', { path: 'AGENTS.md', text: 'x' }],
        ['write_file', { path: 'docs/skills/a/SKILL.md', text: 'x' }],
        ['delete_file', { path: 'sub\\agents.md' }],
        ['move_file', { from: 'notes.txt', to: 'AGENTS.md' }],
        ['edit_file', { path: 'SKILL.md', old_text: 'a', new_text: 'b' }],
    ])('%s of an instruction file is marked', async (name, args) => {
        await call(name, args)
        expect(h.asked[0].view?.instructionTarget).toBe(true)
    })

    test('an ordinary file is not marked', async () => {
        await call('write_file', { path: 'notes/AGENTS.md.bak', text: 'x' })
        expect(h.asked[0].view?.instructionTarget).toBe(false)
    })

    test('an edit shows its replacement text, an empty one as empty, and other tools show none', async () => {
        await call('edit_file', { path: 'a.txt', old_text: 'everything', new_text: '' })
        await call('edit_file', { path: 'a.txt', old_text: 'a', new_text: 'brand new' })
        await call('write_file', { path: 'a.txt', text: 'x' })
        expect(h.asked.map(request => request.view?.replacement)).toEqual(['', 'brand new', null])
    })

    test('a long path is clipped on code points: no half of a surrogate pair survives', () => {
        const path = `${'a'.repeat(97)}${'😀'.repeat(60)}${'b'.repeat(97)}`
        const text = describeWorkspaceAction('write_file', { path }) ?? ''
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)).toBe(false)
    })

    test.each([0, 1])('a long summary is clipped on code points too (pad %i)', async (pad) => {
        await call('write_file', { path: 'a.txt', text: `${'x'.repeat(pad)}${'😀'.repeat(900)}` })
        const summary = h.asked[0].summary
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(summary)).toBe(false)
        expect(summary.endsWith('...')).toBe(true)
    })
})

describe('describeToolCall and bidi controls', () => {
    test('embedding, override, isolate and mark controls show as escapes, so they cannot reorder the summary', () => {
        const summary = describeToolCall('write_file', { path: 'a\u202Eb\u202A\u202B\u202C\u202D\u2066\u2067\u2068\u2069\u200E\u200F.md' })

        expect(summary).toContain('a\\u202eb\\u202a\\u202b\\u202c\\u202d\\u2066\\u2067\\u2068\\u2069\\u200e\\u200f.md')
        expect(summary).not.toMatch(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/)
    })

    test('ordinary non-Latin text is left as it is', () => {
        const summary = describeToolCall('write_file', { path: '한글/日本語/עברית/مرحبا.md' }, 'write')

        expect(summary).toBe('write: write_file({"path":"한글/日本語/עברית/مرحبا.md"})')
    })
})
