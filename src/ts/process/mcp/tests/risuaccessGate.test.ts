/**
 * The 13 mutating `internal:risuai` tools are approved once, at the gate (`authorizeToolCall`, run by
 * `callMCPTool` before any client): a handler prompts nothing itself, so a call never asks twice. Drives the
 * real `RisuAccessClient` with its real handlers and the real gate; the confirm dialog is a double.
 *
 * - One prompt per mutating call through the gate, none when the client is called directly.
 * - A denied call leaves the data untouched.
 * - The classification matches the client's real tool list: the 13 setters and deleters are mutating, every
 *   get, list and chat-history tool is read, so no handler needs an inline prompt to stay safe.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock(import('katex'), () => ({}))
vi.mock(import('src/ts/lite'), () => ({}))

const alertConfirmMock = vi.hoisted(() => vi.fn(async (_text: string, _options?: unknown) => true))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: alertConfirmMock,
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    return {
        DBState: {
            db: {
                characters: [],
                modules: [],
                enabledModules: [],
            },
        },
        selIdState: {
            selId: 0,
        },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

import { DBState } from 'src/ts/stores.svelte'
import type { Database } from 'src/ts/storage/database.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { RisuAccessClient } from '../risuaccess'
import { authorizeToolCall } from '../toolAuthorize'
import { classifyTool } from '../toolPermission'

const URL = 'internal:risuai'

type Case = { name: string, args: Record<string, unknown> }

const mutatingCases: Case[] = [
    { name: 'risu-set-character-info', args: { id: 'char-1', data: { name: 'Renamed by tool' } } },
    { name: 'risu-set-character-lorebook', args: { id: 'char-1', name: 'entry1', content: 'lore content', keys: ['k'] } },
    { name: 'risu-delete-character-lorebook', args: { id: 'char-1', name: 'entry1' } },
    { name: 'risu-set-character-regex-scripts', args: { id: 'char-1', name: 'script1', in: 'foo', out: 'bar' } },
    { name: 'risu-delete-character-regex-scripts', args: { id: 'char-1', name: 'script1' } },
    { name: 'risu-delete-character-additional-assets', args: { id: 'char-1', assetName: 'asset1' } },
    { name: 'risu-set-character-lua-script', args: { id: 'char-1', code: 'print("new")' } },
    { name: 'risu-set-module-info', args: { id: 'mod-1', data: { description: 'edited' } } },
    { name: 'risu-set-module-lorebook', args: { id: 'mod-1', name: 'entry1', content: 'lore content' } },
    { name: 'risu-delete-module-lorebook', args: { id: 'mod-1', name: 'entry1' } },
    { name: 'risu-set-module-regex-script', args: { id: 'mod-1', name: 'script1', in: 'foo', out: 'bar' } },
    { name: 'risu-delete-module-regex-script', args: { id: 'mod-1', name: 'script1' } },
    { name: 'risu-set-module-lua-script', args: { id: 'mod-1', code: 'print("new")' } },
]

function installDb(): void {
    const lore = { comment: 'entry1', content: 'x', key: '', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal' }
    const regex = { comment: 'script1', in: 'x', out: 'y', type: 'editdisplay', flag: '', ableFlag: true }
    const character = (chaId: string) => ({
        chaId,
        name: chaId,
        type: 'character',
        chatPage: 0,
        chats: [{ id: `${chaId}-chat-0`, message: [], note: '', name: '', localLore: [] }],
        globalLore: [{ ...lore }],
        customscript: [{ ...regex }],
        additionalAssets: [['asset1', 'path', 'ext']],
        triggerscript: [{ comment: '', type: 'manual', conditions: [], effect: [{ type: 'triggerlua', code: '' }] }],
    })
    DBState.db = {
        characters: [character('char-0'), character('char-1')],
        enabledModules: [],
        modules: [{
            id: 'mod-1',
            name: 'Module One',
            description: 'd',
            lorebook: [{ ...lore }],
            regex: [{ ...regex }],
            trigger: [{ comment: '', type: 'manual', conditions: [], effect: [{ type: 'triggerlua', code: 'print("old")' }] }],
        }],
    } as unknown as Database
}

/** Runs a tool call the way `callMCPTool` does: the gate decides first, then the client runs the tool. */
async function callGated(client: RisuAccessClient, name: string, args: Record<string, unknown>) {
    const refusal = await authorizeToolCall(name, args, { mcpURL: URL })
    return refusal ?? await client.callTool(name, args)
}

function textOf(result: { type: string, text?: string }[]): string {
    return result.map((part) => part.text ?? '').join('\n')
}

beforeEach(() => {
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker: { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }, schedule: () => {} })
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    installDb()
})

describe('mutating risuaccess tools are approved once, at the gate', () => {
    test.each(mutatingCases)('$name: one prompt through the gate, and the tool runs', async ({ name, args }) => {
        const result = textOf(await callGated(new RisuAccessClient(), name, args))

        expect(alertConfirmMock).toHaveBeenCalledTimes(1)
        expect(String(alertConfirmMock.mock.calls[0][0])).toContain(name)
        expect(result).not.toMatch(/^Error|denied/i)
    })

    test.each(mutatingCases)('$name: the client alone asks nothing', async ({ name, args }) => {
        const result = textOf(await new RisuAccessClient().callTool(name, args))

        expect(alertConfirmMock).not.toHaveBeenCalled()
        expect(result).not.toMatch(/^Error|denied/i)
    })

    test.each(mutatingCases)('$name: a denial runs nothing and leaves the data untouched', async ({ name, args }) => {
        alertConfirmMock.mockImplementation(async () => false)
        const before = JSON.stringify(DBState.db)

        const result = textOf(await callGated(new RisuAccessClient(), name, args))

        expect(result).toBe(`Denied by the user: ${name}`)
        expect(alertConfirmMock).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(DBState.db)).toBe(before)
    })
})

describe('the risuaccess classification matches the real tool list', () => {
    test('exactly the 13 setters and deleters are mutating; every other tool is read and asks nothing', async () => {
        const names = (await new RisuAccessClient().getToolList()).map((tool) => tool.name)
        const mutating = names.filter((name) => classifyTool(URL, name) === 'mutating')

        expect(mutating.sort()).toEqual(mutatingCases.map((c) => c.name).sort())
        const others = names.filter((name) => !mutating.includes(name))
        expect(others.length).toBeGreaterThan(0)
        for (const name of others) {
            expect(name).toMatch(/^risu-(get|list)-/)
            expect(classifyTool(URL, name)).toBe('read')
            expect(await authorizeToolCall(name, {}, { mcpURL: URL })).toBeNull()
        }
        expect(alertConfirmMock).not.toHaveBeenCalled()
    })

    test('every tool named like a setter or deleter is mutating, whatever the table says about reads', async () => {
        const names = (await new RisuAccessClient().getToolList()).map((tool) => tool.name)
        for (const name of names.filter((n) => /^risu-(set|delete)-/.test(n))) {
            expect(classifyTool(URL, name)).toBe('mutating')
        }
    })
})
