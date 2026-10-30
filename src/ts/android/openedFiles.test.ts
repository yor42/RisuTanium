// @vitest-environment happy-dom

/**
 * Files other Android apps open or share with the app. The host queues them natively; the page takes them with `take()`
 * once first setup is done and imports each batch through `importOpenedSources`, one batch after another.
 *
 * These are feature tests: the module they exercise is new, so they have no pre-fix defect to reproduce.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { createHostChannelFake, type HostChannelFake } from './hostChannelFake'

const h = vi.hoisted(() => ({
    didFirstSetup: false,
}))
const importOpenedSourcesMock = vi.hoisted(() => vi.fn())

const alertNormalWaitMock = vi.hoisted(() => vi.fn())
const restoreOpenedBackupMock = vi.hoisted(() => vi.fn())

vi.mock(import('../stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('../stores.svelte'))
vi.mock('../characterCards', () => ({
    importOpenedSources: importOpenedSourcesMock,
    // Stand-in for the shared allow-list; the real list is pinned in characterCards.picker.test.ts.
    isOpenedSourceImportable: (name: string) => /\.(charx|risum|risup|risupreset|preset)$/i.test(name),
}))
vi.mock('../alert', () => ({
    alertNormalWait: alertNormalWaitMock,
    waitUnreadNotice: async () => { },
}))
vi.mock('../drive/backuplocal', () => ({
    restoreOpenedBackup: restoreOpenedBackupMock,
}))
vi.mock('../storage/database.svelte', () => ({
    getDatabase: () => ({ didFirstSetup: h.didFirstSetup }),
}))

const { androidOpenedFilesImport, resetOpenedFilesForTests } = await import('./openedFiles')

interface HostEntry {
    uri: string
    name: unknown
}

/** What the native queue holds; `take` hands it over and clears it, like the host does. */
let queued: HostEntry[][] = []
let rawOverride: string | null = null
const takeMock = vi.fn((): string => {
    if (rawOverride !== null) {
        return rawOverride
    }
    const out = JSON.stringify(queued)
    queued = []
    return out
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const entry = (name: unknown, uri = `content://provider/${String(name)}`): HostEntry => ({ uri, name })

beforeEach(() => {
    h.didFirstSetup = true
    queued = []
    rawOverride = null
    takeMock.mockClear()
    importOpenedSourcesMock.mockReset().mockResolvedValue(undefined)
    alertNormalWaitMock.mockReset().mockResolvedValue(undefined)
    restoreOpenedBackupMock.mockReset().mockResolvedValue('pageLive')
    resetOpenedFilesForTests()
    delete window.__risuTaniumOpenedFiles
    window.__risuTaniumOpenedFilesHost = { take: takeMock }
    vi.spyOn(console, 'warn').mockImplementation(() => { })
})

afterEach(() => {
    delete window.__risuTaniumOpenedFilesHost
    delete window.__risuTaniumOpenedFiles
    vi.restoreAllMocks()
})

describe('androidOpenedFilesImport', () => {
    test('without the host bridge no hook is installed and nothing is imported', async () => {
        delete window.__risuTaniumOpenedFilesHost
        androidOpenedFilesImport()
        await settle()
        expect(window.__risuTaniumOpenedFiles).toBeUndefined()
        expect(takeMock).not.toHaveBeenCalled()
        expect(importOpenedSourcesMock).not.toHaveBeenCalled()
    })

    test('the first drain imports what the host already holds, with the display name and the URI', async () => {
        queued = [[entry('a.charx', 'content://p/1')]]
        androidOpenedFilesImport()
        await settle()
        expect(importOpenedSourcesMock).toHaveBeenCalledTimes(1)
        expect(importOpenedSourcesMock).toHaveBeenCalledWith([{ name: 'a.charx', path: 'content://p/1' }])
    })

    test('the hook the host calls drains what arrived later', async () => {
        androidOpenedFilesImport()
        await settle()
        expect(importOpenedSourcesMock).not.toHaveBeenCalled()
        queued = [[entry('later.risum')]]
        window.__risuTaniumOpenedFiles?.()
        await settle()
        expect(importOpenedSourcesMock).toHaveBeenCalledWith([{ name: 'later.risum', path: 'content://provider/later.risum' }])
    })

    test('before first setup take() is never called and the entries stay with the host; after setup the trigger imports them', async () => {
        h.didFirstSetup = false
        queued = [[entry('held.charx')]]
        androidOpenedFilesImport()
        window.__risuTaniumOpenedFiles?.()
        await settle()
        expect(takeMock).not.toHaveBeenCalled()
        expect(importOpenedSourcesMock).not.toHaveBeenCalled()
        expect(queued).toHaveLength(1)

        h.didFirstSetup = true
        window.__risuTaniumOpenedFiles?.()
        await settle()
        expect(takeMock).toHaveBeenCalledTimes(1)
        expect(importOpenedSourcesMock).toHaveBeenCalledTimes(1)
        expect(importOpenedSourcesMock).toHaveBeenCalledWith([{ name: 'held.charx', path: 'content://provider/held.charx' }])
    })

    test('names are reduced to the part after the last slash or colon', async () => {
        queued = [[entry('Download/sub\\x.charx', 'content://p/1'), entry('primary:Download/y.risum', 'content://p/2')]]
        androidOpenedFilesImport()
        await settle()
        expect(importOpenedSourcesMock).toHaveBeenCalledWith([
            { name: 'x.charx', path: 'content://p/1' },
            { name: 'y.risum', path: 'content://p/2' },
        ])
    })

    test('a batch goes to one import call in order; a .bin among its entries is held back and does not block the others', async () => {
        queued = [[entry('1.charx'), entry('backup.bin'), entry('3.risup')]]
        androidOpenedFilesImport()
        await settle()
        expect(importOpenedSourcesMock).toHaveBeenCalledTimes(1)
        const names = (importOpenedSourcesMock.mock.calls[0][0] as { name: string }[]).map((item) => item.name)
        expect(names).toEqual(['1.charx', '3.risup'])
    })

    test('batches import one after another in the order they arrived', async () => {
        queued = [[entry('first.charx')], [entry('second.charx')]]
        androidOpenedFilesImport()
        await settle()
        expect(importOpenedSourcesMock.mock.calls.map((call) => (call[0] as { name: string }[])[0].name)).toEqual(['first.charx', 'second.charx'])
    })

    test('a trigger during a drain that is mid-import runs after it finishes', async () => {
        let release: () => void = () => { }
        const order: string[] = []
        importOpenedSourcesMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
            order.push('first-start')
            release = () => { order.push('first-end'); resolve() }
        }))
        importOpenedSourcesMock.mockImplementationOnce(async () => { order.push('second-start') })
        queued = [[entry('one.charx')]]
        androidOpenedFilesImport()
        await settle()
        queued = [[entry('two.charx')]]
        window.__risuTaniumOpenedFiles?.()
        await settle()
        expect(order).toEqual(['first-start'])
        expect(importOpenedSourcesMock).toHaveBeenCalledTimes(1)
        release()
        await settle()
        expect(order).toEqual(['first-start', 'first-end', 'second-start'])
    })

    test('a failing import does not stop the next batch', async () => {
        importOpenedSourcesMock.mockRejectedValueOnce(new Error('boom'))
        queued = [[entry('bad.charx')], [entry('good.charx')]]
        androidOpenedFilesImport()
        await settle()
        expect(importOpenedSourcesMock).toHaveBeenCalledTimes(2)
        expect(importOpenedSourcesMock.mock.calls[1][0]).toEqual([{ name: 'good.charx', path: 'content://provider/good.charx' }])
    })

    test('an empty, missing or non-string name is passed on as an empty name, not thrown on', async () => {
        queued = [[entry(''), entry(undefined, 'content://p/2'), entry(42, 'content://p/3'), entry(null, 'content://p/4')]]
        androidOpenedFilesImport()
        await settle()
        expect(importOpenedSourcesMock).toHaveBeenCalledWith([
            { name: '', path: 'content://provider/' },
            { name: '', path: 'content://p/2' },
            { name: '', path: 'content://p/3' },
            { name: '', path: 'content://p/4' },
        ])
    })

    test('malformed or wrongly shaped output imports nothing and does not throw', async () => {
        for (const raw of ['not json', '{}', '[1,2]', '[[{"name":"a.charx"}]]', '[[null]]', '']) {
            rawOverride = raw
            importOpenedSourcesMock.mockClear()
            androidOpenedFilesImport()
            await settle()
            expect(importOpenedSourcesMock).not.toHaveBeenCalled()
        }
    })

    test('a take() that throws is logged and the next trigger still works', async () => {
        takeMock.mockImplementationOnce(() => { throw new Error('bridge gone') })
        androidOpenedFilesImport()
        await settle()
        expect(importOpenedSourcesMock).not.toHaveBeenCalled()
        queued = [[entry('ok.charx')]]
        window.__risuTaniumOpenedFiles?.()
        await settle()
        expect(importOpenedSourcesMock).toHaveBeenCalledTimes(1)
    })

    test('calling it twice installs one hook and imports the held entries once', async () => {
        queued = [[entry('once.charx')]]
        androidOpenedFilesImport()
        const hook = window.__risuTaniumOpenedFiles
        androidOpenedFilesImport()
        await settle()
        expect(window.__risuTaniumOpenedFiles).toBe(hook)
        expect(importOpenedSourcesMock).toHaveBeenCalledTimes(1)
    })
})

describe('androidOpenedFilesImport over the host channel', () => {
    let fake: HostChannelFake
    const order: string[] = []

    /** The host answers the nth take it received. */
    const answer = async (n: number, result: unknown, through: number) => {
        expect(fake.postedTo('openedFiles', 'take').length, 'the take the host answers was sent').toBeGreaterThan(n)
        const id = fake.postedTo('openedFiles', 'take')[n].id
        fake.deliver(JSON.stringify({ id, result, through }))
        await settle()
    }

    beforeEach(() => {
        order.length = 0
        delete window.__risuTaniumOpenedFilesHost
        fake = createHostChannelFake()
        fake.channel.postMessage.mockImplementation((message: string) => {
            const parsed = JSON.parse(message) as { method: string }
            order.push(parsed.method)
        })
        window.__risuTaniumHost = fake.channel
        importOpenedSourcesMock.mockImplementation(async () => { order.push('import') })
    })

    afterEach(() => {
        delete window.__risuTaniumHost
    })

    test('(R) the first drain asks for a take with an id, imports what the reply holds, and confirms the batch it was given', async () => {
        androidOpenedFilesImport()
        await settle()
        const takes = fake.postedTo('openedFiles', 'take')
        expect(takes).toHaveLength(1)
        expect(takes[0]).toEqual({ bridge: 'openedFiles', method: 'take', args: [], id: expect.any(Number) })
        expect(importOpenedSourcesMock).not.toHaveBeenCalled()

        await answer(0, [[{ uri: 'content://x/1', name: 'a.charx' }]], 4)
        expect(importOpenedSourcesMock).toHaveBeenCalledTimes(1)
        expect(importOpenedSourcesMock).toHaveBeenCalledWith([{ name: 'a.charx', path: 'content://x/1' }])
        expect(fake.postedTo('openedFiles', 'confirm')).toEqual([{ bridge: 'openedFiles', method: 'confirm', args: [4] }])
    })

    test('the confirm is sent before the import starts', async () => {
        androidOpenedFilesImport()
        await settle()
        await answer(0, [[{ uri: 'content://x/1', name: 'a.charx' }]], 1)
        expect(order.filter((step) => step !== 'subscribe')).toEqual(['take', 'confirm', 'import'])
    })

    test('an empty reply imports nothing and confirms nothing', async () => {
        androidOpenedFilesImport()
        await settle()
        await answer(0, [], 0)
        expect(importOpenedSourcesMock).not.toHaveBeenCalled()
        expect(fake.postedTo('openedFiles', 'confirm')).toEqual([])
    })

    test('the hook the host calls takes again; each take has its own id', async () => {
        androidOpenedFilesImport()
        await settle()
        await answer(0, [], 0)
        window.__risuTaniumOpenedFiles?.()
        await settle()
        const takes = fake.postedTo('openedFiles', 'take')
        expect(takes).toHaveLength(2)
        expect(takes[1].id).not.toBe(takes[0].id)
        await answer(1, [[{ uri: 'content://x/2', name: 'later.risum' }]], 2)
        expect(importOpenedSourcesMock).toHaveBeenCalledWith([{ name: 'later.risum', path: 'content://x/2' }])
    })

    test('before first setup nothing is taken', async () => {
        h.didFirstSetup = false
        androidOpenedFilesImport()
        window.__risuTaniumOpenedFiles?.()
        await settle()
        expect(fake.postedTo('openedFiles', 'take')).toEqual([])
    })

    test('the channel wins over the separate host object, which is never taken from', async () => {
        window.__risuTaniumOpenedFilesHost = { take: takeMock }
        queued = [[entry('legacy.charx')]]
        androidOpenedFilesImport()
        await settle()
        await answer(0, [], 0)
        expect(takeMock).not.toHaveBeenCalled()
        expect(importOpenedSourcesMock).not.toHaveBeenCalled()
    })

    test('a channel that throws on a take is logged and the next trigger still works', async () => {
        let failed = false
        fake.channel.postMessage.mockImplementation((message: string) => {
            const parsed = JSON.parse(message) as { method: string }
            if (parsed.method === 'take' && !failed) {
                failed = true
                throw new Error('host failed')
            }
        })
        androidOpenedFilesImport()
        await settle()
        expect(importOpenedSourcesMock).not.toHaveBeenCalled()
        window.__risuTaniumOpenedFiles?.()
        await settle()
        expect(fake.postedTo('openedFiles', 'take'), 'the failed take and the retry were both sent').toHaveLength(2)
        await answer(1, [[{ uri: 'content://x/3', name: 'ok.charx' }]], 1)
        expect(importOpenedSourcesMock).toHaveBeenCalledTimes(1)
    })
})
