// @vitest-environment jsdom

/**
 * The revoke list of "always allow" workspace tool grants. (R) = regression reproducer; (G) = guard.
 *
 * REAL: the component and the language table. MOCKED: `DBState` (a `$state` object) and the grant store, which is a
 * small in-memory list so a revoke is seen to change what is listed next.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

type Grant = { workspaceId: string, tool: string, at: number }
const h = vi.hoisted(() => ({ grants: [] as Array<{ workspaceId: string, tool: string, at: number }>, revokeResult: true }))

vi.mock('src/ts/process/mcp/toolGrants', () => ({
    listToolGrants: vi.fn(async () => h.grants.map((grant) => ({ ...grant }))),
    revokeToolGrant: vi.fn(async (workspaceId: string, tool: string) => {
        if (h.revokeResult) {
            h.grants = h.grants.filter((grant) => !(grant.workspaceId === workspaceId && grant.tool === tool))
        }
        return h.revokeResult
    }),
}))
vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state, selIdState: { selId: -1 } } as unknown as typeof import('src/ts/stores.svelte')
})

import { language } from 'src/lang'
import { revokeToolGrant } from 'src/ts/process/mcp/toolGrants'
import { DBState } from 'src/ts/stores.svelte'
import WorkspaceToolGrants from './WorkspaceToolGrants.svelte'

const mounted: Array<{ instance: object, target: HTMLElement }> = []
const DAY = Date.UTC(2026, 10, 20, 12)

async function settle() {
    for (let i = 0; i < 5; i++) {
        await Promise.resolve()
        flushSync()
    }
}

async function open(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(WorkspaceToolGrants, { target })
    mounted.push({ instance, target })
    await settle()
    return target
}

const all = (root: HTMLElement, id: string) => [...root.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)]

beforeEach(() => {
    h.grants = []
    h.revokeResult = true
    DBState.db = { utilityWorkspaces: [{ id: 'ws1', name: 'Notes', createdAt: 0, files: [] }] } as unknown as Database
    vi.mocked(revokeToolGrant).mockClear()
})

afterEach(() => {
    for (const { instance, target } of mounted.splice(0)) {
        void unmount(instance)
        target.remove()
    }
})

describe('WorkspaceToolGrants', () => {
    test('(G) no grants shows the empty text and no rows', async () => {
        const root = await open()
        expect(all(root, 'tool-grants-empty')[0].textContent).toBe(language.utility.toolGrants.empty)
        expect(all(root, 'tool-grants-row')).toHaveLength(0)
    })

    test('(G) rows are grouped by workspace name with the tool and the grant date; a deleted workspace is labelled with its id', async () => {
        h.grants = [
            { workspaceId: 'ws1', tool: 'write_file', at: DAY },
            { workspaceId: 'ws1', tool: 'edit_file', at: DAY },
            { workspaceId: 'gone-id', tool: 'delete_file', at: DAY },
        ] satisfies Grant[]
        const root = await open()

        const groups = all(root, 'tool-grants-workspace')
        expect(groups).toHaveLength(2)
        expect(all(groups[0], 'tool-grants-workspace-name')[0].textContent).toContain('Notes')
        expect(all(groups[0], 'tool-grants-tool').map((node) => node.textContent)).toEqual(['write_file', 'edit_file'])
        expect(all(groups[1], 'tool-grants-workspace-name')[0].textContent).toContain(language.utility.toolGrants.deletedWorkspace)
        expect(all(groups[1], 'tool-grants-workspace-id')[0].textContent).toBe('gone-id')
        expect(all(root, 'tool-grants-date')[0].textContent).toBe(language.utility.toolGrants.grantedOn(new Date(DAY).toLocaleDateString()))
    })

    test('(R) revoke calls the store with the workspace and tool, and the row disappears', async () => {
        h.grants = [
            { workspaceId: 'ws1', tool: 'write_file', at: DAY },
            { workspaceId: 'ws1', tool: 'edit_file', at: DAY },
        ]
        const root = await open()
        root.querySelectorAll('button')[0].click()
        await settle()

        expect(revokeToolGrant).toHaveBeenCalledWith('ws1', 'write_file')
        expect(all(root, 'tool-grants-tool').map((node) => node.textContent)).toEqual(['edit_file'])

        root.querySelectorAll('button')[0].click()
        await settle()
        expect(all(root, 'tool-grants-row')).toHaveLength(0)
        expect(all(root, 'tool-grants-empty')).toHaveLength(1)
    })

    test('(G) a revoke that fails says so and keeps the row', async () => {
        h.grants = [{ workspaceId: 'ws1', tool: 'write_file', at: DAY }]
        h.revokeResult = false
        const root = await open()
        root.querySelectorAll('button')[0].click()
        await settle()

        expect(all(root, 'tool-grants-failed')).toHaveLength(1)
        expect(all(root, 'tool-grants-row')).toHaveLength(1)
    })

    test('(G) the revoke button is at least 44px tall by class', async () => {
        h.grants = [{ workspaceId: 'ws1', tool: 'write_file', at: DAY }]
        const root = await open()
        expect(root.querySelector('button')!.className).toContain('min-h-11')
    })
})
