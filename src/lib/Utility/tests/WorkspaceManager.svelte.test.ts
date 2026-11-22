// @vitest-environment jsdom

/**
 * T30: the workspace manager. (R) = regression reproducer: fails when the rule it names is removed; (G) = guard.
 *
 * REAL: the manager component, the workspace model and the zip engine, fflate, the file import planner. MOCKED: `DBState`
 * (a `$state` object, as the page holds it), the confirm and select dialogs, the file chooser, `downloadFile` and the tool
 * grant store. The native chooser and the real download path are not exercised.
 */
import { zipSync } from 'fflate'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, UtilityWorkspace } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({
    confirm: vi.fn(async (_message: string) => true),
    select: vi.fn(async (_options: string[], _display?: string, _cancel?: { cancel?: string }) => '0'),
    download: vi.fn(async (_name: string, _data: unknown) => true),
    pickMany: vi.fn(async (_ext: string[]): Promise<File[] | null> => null),
    pickOne: vi.fn(async (_ext: string[]): Promise<File | null> => null),
    revoked: vi.fn(),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state, selIdState: { selId: -1 } } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock('src/ts/alert', () => ({ alertConfirm: h.confirm, alertSelect: h.select }))
vi.mock('src/ts/globalApi.svelte', () => ({ downloadFile: h.download }))
vi.mock('src/ts/util', () => ({ selectMultipleFileObjects: h.pickMany, selectSingleFileObject: h.pickOne }))
vi.mock('src/ts/process/mcp/toolGrants', () => ({ removeWorkspaceToolGrants: h.revoked }))

import { language } from 'src/lang'
import { listFiles, listWorkspaces, readText } from 'src/ts/process/utility/workspace/workspaceModel.svelte'
import { DBState } from 'src/ts/stores.svelte'
import WorkspaceManager from '../WorkspaceManager.svelte'
import { importPickedFiles } from '../workspaceFiles'

const text = language.utility.workspaces
const encoder = new TextEncoder()
const bytes = (value: string): Uint8Array => encoder.encode(value)

const mounted: Array<{ instance: object, target: HTMLElement }> = []

function open(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(WorkspaceManager, { target, props: {} })
    mounted.push({ instance, target })
    flushSync()
    return target
}

function seed(files: Record<string, string | undefined>, name = 'Notes'): void {
    const workspace: UtilityWorkspace = {
        id: 'w1',
        name,
        createdAt: 1,
        files: Object.entries(files).map(([path, body], index) => ({
            id: `f${index}`,
            path,
            text: body,
            size: body === undefined ? 7 : bytes(body).length,
            mtime: 1,
        })),
    }
    DBState.db = { utilityWorkspaces: [workspace] } as unknown as Database
}

function byId(root: HTMLElement, testId: string): HTMLElement {
    const found = root.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
    if (!found) {
        throw new Error(`no element ${testId}`)
    }
    return found
}

function all(root: HTMLElement, testId: string): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`))
}

function buttonWithText(root: HTMLElement, label: string): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll('button')).find((button) => button.textContent?.trim() === label)
    if (!found) {
        throw new Error(`no button "${label}"`)
    }
    return found
}

function selectWorkspace(root: HTMLElement): void {
    byId(root, 'workspace-row').click()
    flushSync()
}

function fileOf(name: string, content: Uint8Array): File {
    return new File([content.slice().buffer], name)
}

async function settled(root: HTMLElement): Promise<void> {
    await vi.waitFor(() => {
        flushSync()
        expect(root.querySelector('[data-testid="workspace-notice"]') ?? root.querySelector('[data-testid="workspace-refused"]')).not.toBeNull()
    })
}

beforeEach(() => {
    for (const mock of Object.values(h)) {
        mock.mockReset()
    }
    h.confirm.mockResolvedValue(true)
    h.select.mockResolvedValue('0')
    h.download.mockResolvedValue(true)
    h.pickMany.mockResolvedValue(null)
    h.pickOne.mockResolvedValue(null)
    seed({ 'a.txt': 'one', 'dir/b.md': 'two' })
})

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
})

describe('listing, creating and renaming', () => {
    test('(G) each workspace shows its name, file count and size against the caps', () => {
        const root = open()
        const row = byId(root, 'workspace-row')
        expect(row.textContent).toContain('Notes')
        expect(row.textContent).toContain(text.usage(2, 500, '6 B', '25.0 MiB'))
        expect(byId(root, 'workspace-total').textContent).toBe(text.totalUsage('6 B', '100.0 MiB'))
    })

    test('(R) creating a workspace adds it and selects it; an empty name takes the default name', () => {
        DBState.db = {} as unknown as Database
        const root = open()
        expect(byId(root, 'workspace-empty').textContent).toBe(text.empty)

        buttonWithText(root, text.create).click()
        flushSync()

        expect(listWorkspaces().map((summary) => summary.name)).toEqual([text.defaultName])
        expect(root.querySelector('[data-testid="workspace-detail"]')).not.toBeNull()
    })

    test('(R) renaming changes the stored name and never to an empty one', () => {
        const root = open()
        selectWorkspace(root)
        const input = root.querySelector<HTMLInputElement>('#workspace-name')!

        input.value = '  Plans  '
        input.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(listWorkspaces()[0].name).toBe('Plans')

        input.value = '   '
        input.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(listWorkspaces()[0].name).toBe(text.defaultName)
    })
})

describe('deleting is confirmed and final', () => {
    test('(R) deleting a workspace asks first with the final-delete wording; refusing keeps it', async () => {
        const root = open()
        selectWorkspace(root)
        h.confirm.mockResolvedValueOnce(false)

        buttonWithText(root, text.deleteWorkspace).click()
        await vi.waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1))
        expect(h.confirm).toHaveBeenCalledWith(text.deleteWorkspaceConfirm('Notes', 2))
        expect(h.confirm.mock.calls[0][0]).toContain('final')
        expect(listWorkspaces()).toHaveLength(1)
        expect(h.revoked).not.toHaveBeenCalled()

        buttonWithText(root, text.deleteWorkspace).click()
        await vi.waitFor(() => expect(listWorkspaces()).toHaveLength(0))
        expect(h.revoked).toHaveBeenCalledWith('w1')
        flushSync()
        expect(root.querySelector('[data-testid="workspace-detail"]')).toBeNull()
    })

    test('(R) deleting a file asks first; refusing keeps it', async () => {
        const root = open()
        selectWorkspace(root)
        h.confirm.mockResolvedValueOnce(false)
        const deleteButton = all(root, 'workspace-file')[0].querySelector('button')!

        deleteButton.click()
        await vi.waitFor(() => expect(h.confirm).toHaveBeenCalledWith(text.deleteFileConfirm('a.txt')))
        expect(listFiles('w1').map((file) => file.path)).toEqual(['a.txt', 'dir/b.md'])

        all(root, 'workspace-file')[0].querySelector('button')!.click()
        await vi.waitFor(() => expect(listFiles('w1').map((file) => file.path)).toEqual(['dir/b.md']))
    })
})

describe('bidi controls in a path', () => {
    // Built from its code point: a raw or escaped U+202E in a .svelte.test.ts source trips the Svelte bidi warning.
    const RLO = String.fromCharCode(0x202E)

    test('(R) a path with a bidi override is shown and confirmed escaped, while the delete uses the raw path', async () => {
        const raw = 'a' + RLO + '/x.txt'
        const escaped = 'a\\u202e/x.txt'
        seed({ [raw]: 'one' })
        const root = open()
        selectWorkspace(root)

        const row = all(root, 'workspace-file')[0]
        expect(row.textContent).toContain(escaped)
        expect(row.textContent).not.toContain(RLO)

        row.querySelector('button')!.click()
        await vi.waitFor(() => expect(h.confirm).toHaveBeenCalledWith(text.deleteFileConfirm(escaped)))
        expect(h.confirm.mock.calls[0][0]).not.toContain(RLO)
        await vi.waitFor(() => expect(listFiles('w1')).toHaveLength(0))
    })
})

describe('damaged files', () => {
    test('(R) a placeholder file is marked damaged with its note and can be deleted', async () => {
        seed({ 'ok.txt': 'fine', 'lost.txt': undefined })
        const root = open()
        selectWorkspace(root)

        const rows = all(root, 'workspace-file')
        expect(rows).toHaveLength(2)
        expect(rows[0].querySelector('[data-testid="workspace-file-damaged"]')).toBeNull()
        expect(rows[1].querySelector('[data-testid="workspace-file-damaged"]')?.textContent).toBe(text.damaged)
        expect(rows[1].textContent).toContain(text.damagedNote)

        rows[1].querySelector('button')!.click()
        await vi.waitFor(() => expect(listFiles('w1').map((file) => file.path)).toEqual(['ok.txt']))
    })
})

describe('adding text files', () => {
    test('(R) text files are written, a binary and an oversize file are listed as refused with their reasons', async () => {
        const big = new Uint8Array(1024 * 1024 + 1).fill(0x61)
        h.pickMany.mockResolvedValue([
            fileOf('new.txt', bytes('hello')),
            fileOf('image.png', new Uint8Array([0x89, 0x50, 0x00, 0xff])),
            fileOf('big.txt', big),
        ])
        const root = open()
        selectWorkspace(root)

        buttonWithText(root, text.addFiles).click()
        await settled(root)

        expect(readText('w1', 'new.txt')).toEqual({ state: 'ok', text: 'hello' })
        expect(byId(root, 'workspace-notice').textContent).toBe(text.importDone(1, 0))
        const refused = byId(root, 'workspace-refused')
        expect(refused.textContent).toContain(text.refusedHeading(2))
        expect(refused.textContent).toContain(text.refusedLine('image.png', text.reason.binary))
        expect(refused.textContent).toContain(text.refusedLine('big.txt', text.reason['too-large']))
    })

    test('(R) a pick over the file count or the byte cap is refused before any file is read', async () => {
        const watched = (name: string, size?: number): { file: File, read: ReturnType<typeof vi.fn> } => {
            const file = fileOf(name, bytes('x'))
            const read = vi.fn(async () => new ArrayBuffer(1))
            file.arrayBuffer = read
            if (size !== undefined) {
                Object.defineProperty(file, 'size', { value: size })
            }
            return { file, read }
        }
        const tooMany = Array.from({ length: 501 }, (_, index) => watched(`f${index}.txt`))
        const tooBig = Array.from({ length: 26 }, (_, index) => watched(`g${index}.txt`, 1024 * 1024))
        const root = open()
        selectWorkspace(root)

        h.pickMany.mockResolvedValue(tooMany.map((entry) => entry.file))
        buttonWithText(root, text.addFiles).click()
        await settled(root)
        expect(byId(root, 'workspace-notice').textContent).toBe(text.capsRefused(text.caps['too-many-files']))

        h.pickMany.mockResolvedValue(tooBig.map((entry) => entry.file))
        buttonWithText(root, text.addFiles).click()
        await vi.waitFor(() => {
            flushSync()
            expect(byId(root, 'workspace-notice').textContent).toBe(text.capsRefused(text.caps['workspace-too-large']))
        })

        expect([...tooMany, ...tooBig].some((entry) => entry.read.mock.calls.length > 0)).toBe(false)
        expect(listFiles('w1')).toHaveLength(2)
    })

    test('(R) a file over the per-file cap in a pick is listed too-large and never counts against the workspace cap', async () => {
        const huge = fileOf('clip.mp4', bytes('x'))
        const read = vi.fn(async () => new ArrayBuffer(1))
        huge.arrayBuffer = read
        Object.defineProperty(huge, 'size', { value: 30 * 1024 * 1024 })
        seed({})
        h.pickMany.mockResolvedValue([fileOf('new.txt', bytes('hello')), huge])
        const root = open()
        selectWorkspace(root)

        buttonWithText(root, text.addFiles).click()
        await settled(root)

        expect(readText('w1', 'new.txt')).toEqual({ state: 'ok', text: 'hello' })
        expect(byId(root, 'workspace-notice').textContent).toBe(text.importDone(1, 0))
        expect(byId(root, 'workspace-refused').textContent).toContain(text.refusedLine('clip.mp4', text.reason['too-large']))
        expect(read).not.toHaveBeenCalled()
    })

    test('(R) several colliding files raise one question, not one per file; keep leaves the existing text', async () => {
        h.select.mockResolvedValue('1')
        h.pickMany.mockResolvedValue([fileOf('a.txt', bytes('X')), fileOf('dir_b.md', bytes('Y'))])
        seed({ 'a.txt': 'one', 'dir_b.md': 'two' })
        const root = open()
        selectWorkspace(root)

        buttonWithText(root, text.addFiles).click()
        await settled(root)

        expect(h.select).toHaveBeenCalledTimes(1)
        expect(h.select.mock.calls[0][1]).toBe(text.collisionPrompt(2, 'a.txt\ndir_b.md'))
        expect(readText('w1', 'a.txt')).toEqual({ state: 'ok', text: 'one' })
        expect(byId(root, 'workspace-notice').textContent).toBe(text.importDone(0, 2))
    })

    test('(R) cancelling the question writes nothing and shows no notice', async () => {
        h.select.mockResolvedValue('2')
        h.pickMany.mockResolvedValue([fileOf('a.txt', bytes('X')), fileOf('n.txt', bytes('N'))])
        const root = open()
        selectWorkspace(root)

        buttonWithText(root, text.addFiles).click()
        await vi.waitFor(() => expect(h.select).toHaveBeenCalledTimes(1))
        await vi.waitFor(() => expect(buttonWithText(root, text.addFiles).disabled).toBe(false))

        expect(readText('w1', 'a.txt')).toEqual({ state: 'ok', text: 'one' })
        expect(readText('w1', 'n.txt')).toEqual({ state: 'missing' })
        expect(root.querySelector('[data-testid="workspace-notice"]')).toBeNull()
    })
})

describe('picked files that meet a workspace changing during the question', () => {
    function addDuringQuestion(path: string): (collisions: readonly string[]) => Promise<'replace'> {
        return async () => {
            DBState.db.utilityWorkspaces![0].files.push({ id: `late-${path}`, path, text: 'mine', size: 4, mtime: 1 })
            return 'replace'
        }
    }

    test('(R) a path created during the question is not replaced unasked', async () => {
        const picked = [{ name: 'a.txt', bytes: bytes('X') }, { name: 'n.txt', bytes: bytes('N') }]
        const result = await importPickedFiles('w1', picked, addDuringQuestion('n.txt'))
        expect(result).toEqual({ ok: false, reason: 'changed' })
        expect(readText('w1', 'n.txt')).toEqual({ state: 'ok', text: 'mine' })
        expect(readText('w1', 'a.txt')).toEqual({ state: 'ok', text: 'one' })
    })

    test('(R) a case variant created during the question is refused by name, not reported as a cap overrun', async () => {
        const picked = [{ name: 'a.txt', bytes: bytes('X') }, { name: 'n.txt', bytes: bytes('N') }]
        const result = await importPickedFiles('w1', picked, addDuringQuestion('N.txt'))
        expect(result).toMatchObject({ ok: true, written: ['a.txt'] })
        expect(result.ok && result.refused.map((entry) => [entry.name, entry.reason])).toEqual([['n.txt', 'collides-with-existing']])
        expect(readText('w1', 'N.txt')).toEqual({ state: 'ok', text: 'mine' })
    })
})

describe('importing a .zip', () => {
    test('(R) a partial import keeps the acceptable files and lists every refused entry', async () => {
        const zip = zipSync({
            'ok.txt': bytes('fine'),
            '../evil.txt': bytes('no'),
            'pic.bin': new Uint8Array([1, 2, 0, 3]),
        })
        h.pickOne.mockResolvedValue(fileOf('pack.zip', zip))
        const root = open()
        selectWorkspace(root)

        buttonWithText(root, text.importZip).click()
        await settled(root)

        expect(readText('w1', 'ok.txt')).toEqual({ state: 'ok', text: 'fine' })
        expect(byId(root, 'workspace-notice').textContent).toBe(text.importDone(1, 0))
        const refused = byId(root, 'workspace-refused')
        expect(refused.textContent).toContain(text.refusedHeading(2))
        expect(refused.textContent).toContain(text.refusedLine('../evil.txt', text.reason['bad-name']))
        expect(refused.textContent).toContain(text.refusedLine('pic.bin', text.reason.binary))
    })

    test('(R) three colliding paths raise one question for the whole import; replace overwrites them', async () => {
        seed({ 'a.txt': 'old', 'b.txt': 'old', 'c.txt': 'old' })
        h.select.mockResolvedValue('0')
        h.pickOne.mockResolvedValue(fileOf('pack.zip', zipSync({ 'a.txt': bytes('A'), 'b.txt': bytes('B'), 'c.txt': bytes('C') })))
        const root = open()
        selectWorkspace(root)

        buttonWithText(root, text.importZip).click()
        await settled(root)

        expect(h.select).toHaveBeenCalledTimes(1)
        expect(h.select.mock.calls[0][0]).toEqual([text.collisionReplace, text.collisionKeep, text.collisionCancel])
        expect(h.select.mock.calls[0][2]).toEqual({ cancel: '2' })
        expect(readText('w1', 'b.txt')).toEqual({ state: 'ok', text: 'B' })
    })

    test('(R) a refused archive shows its reason and writes nothing', async () => {
        h.pickOne.mockResolvedValue(fileOf('pack.zip', bytes('not a zip')))
        const root = open()
        selectWorkspace(root)

        buttonWithText(root, text.importZip).click()
        await settled(root)

        expect(byId(root, 'workspace-notice').textContent).toBe(text.archive['not-a-zip'])
        expect(listFiles('w1')).toHaveLength(2)
    })

    test('(R) a cap overrun refuses the whole import and says which cap', async () => {
        const entries: Record<string, Uint8Array> = {}
        for (let index = 0; index <= 500; index++) {
            entries[`f${index}.txt`] = bytes('x')
        }
        h.pickOne.mockResolvedValue(fileOf('pack.zip', zipSync(entries)))
        const root = open()
        selectWorkspace(root)

        buttonWithText(root, text.importZip).click()
        await settled(root)

        expect(byId(root, 'workspace-notice').textContent).toBe(text.capsRefused(text.caps['too-many-files']))
        expect(listFiles('w1')).toHaveLength(2)
    })
})

describe('exporting a .zip', () => {
    test('(R) the workspace is saved as a .zip named after it, holding its files', async () => {
        const root = open()
        selectWorkspace(root)

        buttonWithText(root, text.exportZip).click()
        await vi.waitFor(() => expect(h.download).toHaveBeenCalledTimes(1))

        expect(h.download.mock.calls[0][0]).toBe('Notes.zip')
        const { unzipSync } = await import('fflate')
        expect(Object.keys(unzipSync(h.download.mock.calls[0][1] as Uint8Array)).sort()).toEqual(['a.txt', 'dir/b.md'])
        await vi.waitFor(() => expect(byId(root, 'workspace-notice').textContent).toBe(text.exportDone))
    })

    test('(R) damaged files are named before the export and nothing is saved when the user declines', async () => {
        seed({ 'ok.txt': 'fine', 'lost.txt': undefined })
        const root = open()
        selectWorkspace(root)
        h.confirm.mockResolvedValueOnce(false)

        buttonWithText(root, text.exportZip).click()
        await vi.waitFor(() => expect(h.confirm).toHaveBeenCalledWith(text.exportOmitConfirm('lost.txt')))
        expect(h.download).not.toHaveBeenCalled()

        buttonWithText(root, text.exportZip).click()
        await vi.waitFor(() => expect(h.download).toHaveBeenCalledTimes(1))
    })
})
