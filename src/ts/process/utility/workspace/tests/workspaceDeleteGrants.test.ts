/**
 * Deleting a workspace through the model takes its saved "always" approvals with it (MC-3409), and no other workspace's.
 * The real model and the real grants store over an in-memory byte store.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'

const h = vi.hoisted(() => ({ store: null as ByteStore | null }))

vi.mock('src/ts/storage/store/appStore', () => ({ getAppStore: async () => h.store }))
vi.mock('src/ts/alertPrompts', () => ({ queueNotice: () => { } }))
vi.mock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: {} }, selectedCharID: { subscribe: () => () => { } } }))

import { DBState } from 'src/ts/stores.svelte'
import type { Database } from 'src/ts/storage/database.svelte'
import { addToolGrant, hasToolGrant, resetToolGrantsForTests } from 'src/ts/process/mcp/toolGrants'
import { createWorkspace, deleteWorkspace } from '../workspaceModel.svelte'

beforeEach(() => {
    h.store = createMemoryByteStore()
    resetToolGrantsForTests()
    DBState.db = {} as unknown as Database
})

describe('deleteWorkspace and the saved grants', () => {
    test('removes the deleted workspace\'s grants and keeps the others', async () => {
        const env = { now: () => 1, newId: (() => { let n = 0; return () => `ws${++n}` })() }
        const a = createWorkspace('A', env)
        const b = createWorkspace('B', env)
        await addToolGrant(a, 'write_file')
        await addToolGrant(b, 'write_file')

        expect(deleteWorkspace(a)).toBe(true)
        // The removal is a step of the grants' write chain; a later grant call waits behind it.
        await addToolGrant('other', 'write_file')

        expect(await hasToolGrant(a, 'write_file')).toBe(false)
        expect(await hasToolGrant(b, 'write_file')).toBe(true)
    })
})
