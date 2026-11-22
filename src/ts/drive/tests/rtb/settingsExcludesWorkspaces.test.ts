/**
 * #202 S6a guard (passes before and after S6a): a settings-only `.rtb` never carries utility workspaces. The allowlist
 * does not name the key, and the records built over a database that holds a workspace hold neither the key nor its text.
 */
import { describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { SETTINGS_FIELDS } from 'src/ts/drive/rtb/settingsFields'
import { buildSettingsRecords } from 'src/ts/drive/rtb/settingsPayload'
import type { Database } from 'src/ts/storage/database.svelte'
import { realisticDb, sourceOf } from './settingsTestKit'

// The real setDatabase runs; only the modules whose import graph would start effects are replaced by plain stand-ins.
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

describe('a settings-only .rtb and utility workspaces', () => {
    test('guard: the allowlist does not name the workspaces key', () => {
        expect((SETTINGS_FIELDS as readonly string[]).includes('utilityWorkspaces')).toBe(false)
    })

    test('guard: the records built over a database with a workspace carry neither the key nor the workspace, and the key is never read', () => {
        const db = realisticDb()
        ;(db as unknown as { utilityWorkspaces: unknown[] }).utilityWorkspaces = [
            { id: 'ws-0', name: 'WORKSPACEMARK folder', description: 'WORKSPACEMARK text' },
        ]
        const reads: string[] = []
        const { records } = buildSettingsRecords(sourceOf(db as Database, reads))

        expect(records.length).toBeGreaterThan(0)
        expect(records.map((record) => record.key)).not.toContain('utilityWorkspaces')
        expect(JSON.stringify(records)).not.toContain('WORKSPACEMARK')
        expect(reads).not.toContain('utilityWorkspaces')
    })
})
