import { describe, test, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
    order: [] as string[],
    handler: null as null | (() => void),
}))

const invokeMock = vi.hoisted(() => vi.fn())
const listenMock = vi.hoisted(() => vi.fn())
const importOpenedFilesMock = vi.hoisted(() => vi.fn())
const downloadRisuHubMock = vi.hoisted(() => vi.fn())
const onOpenUrlMock = vi.hoisted(() => vi.fn())
const getCurrentMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: onOpenUrlMock, getCurrent: getCurrentMock }))
vi.mock('./characterCards', () => ({
    importOpenedFiles: importOpenedFilesMock,
    downloadRisuHub: downloadRisuHubMock,
}))

const { desktopLaunchImport } = await import('./desktopLaunch')

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
    h.order = []
    h.handler = null
    invokeMock.mockReset().mockResolvedValue({ files: [], urls: [] })
    listenMock.mockReset().mockImplementation(async (_name: string, handler: () => void) => {
        h.order.push('listen')
        h.handler = handler
        return () => { }
    })
    importOpenedFilesMock.mockReset().mockResolvedValue(undefined)
    downloadRisuHubMock.mockReset().mockResolvedValue(undefined)
    onOpenUrlMock.mockReset()
    getCurrentMock.mockReset()
    invokeMock.mockImplementation(async () => {
        h.order.push('drain')
        return { files: [], urls: [] }
    })
})

describe('desktopLaunchImport', () => {
    test('registers the listener before the first drain', async () => {
        await desktopLaunchImport()
        expect(listenMock).toHaveBeenCalledWith('risu-launch-inputs', expect.any(Function))
        expect(h.order).toEqual(['listen', 'drain'])
        expect(invokeMock).toHaveBeenCalledWith('take_launch_inputs')
    })

    test('imports the drained files once, in one batch', async () => {
        invokeMock.mockResolvedValueOnce({ files: ['C:\\a.charx', 'C:\\b.risum'], urls: [] })
        await desktopLaunchImport()
        expect(importOpenedFilesMock).toHaveBeenCalledTimes(1)
        expect(importOpenedFilesMock).toHaveBeenCalledWith(['C:\\a.charx', 'C:\\b.risum'])
    })

    test('an empty drain imports and downloads nothing', async () => {
        await desktopLaunchImport()
        expect(importOpenedFilesMock).not.toHaveBeenCalled()
        expect(downloadRisuHubMock).not.toHaveBeenCalled()
    })

    test('a realm link opens the realm download for its id', async () => {
        invokeMock.mockResolvedValueOnce({ files: [], urls: ['risutaniumlocal://realm/abc-123'] })
        await desktopLaunchImport()
        expect(downloadRisuHubMock).toHaveBeenCalledTimes(1)
        expect(downloadRisuHubMock).toHaveBeenCalledWith('abc-123')
    })

    test('a query or fragment after the realm id is not part of the id', async () => {
        invokeMock.mockResolvedValueOnce({ files: [], urls: ['risuailocal://x/realm/abc?x=1', 'risuailocal://x/realm/def#top'] })
        await desktopLaunchImport()
        expect(downloadRisuHubMock.mock.calls.map((call) => call[0])).toEqual(['abc', 'def'])
    })

    test('a trailing slash after the realm id is not part of the id', async () => {
        invokeMock.mockResolvedValueOnce({ files: [], urls: ['risutaniumlocal://realm/abc/'] })
        await desktopLaunchImport()
        expect(downloadRisuHubMock).toHaveBeenCalledWith('abc')
    })

    test('a bad id or another link type does not open a download', async () => {
        invokeMock.mockResolvedValueOnce({
            files: [],
            urls: ['risutaniumlocal://realm/a%20b', 'risutaniumlocal://realm/', 'risutaniumlocal://other/abc', 'risutaniumlocal:abc'],
        })
        await desktopLaunchImport()
        expect(downloadRisuHubMock).not.toHaveBeenCalled()
    })

    test('a later notification drains again', async () => {
        await desktopLaunchImport()
        invokeMock.mockResolvedValueOnce({ files: ['/later.charx'], urls: [] })
        h.handler!()
        await settle()
        expect(importOpenedFilesMock).toHaveBeenCalledWith(['/later.charx'])
    })

    test('a drain that throws does not stop the next notification from importing', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })
        await desktopLaunchImport()
        invokeMock.mockResolvedValueOnce({ files: ['/first.charx'], urls: [] })
        importOpenedFilesMock.mockRejectedValueOnce(new Error('boom'))
        h.handler!()
        await settle()
        invokeMock.mockResolvedValueOnce({ files: ['/second.charx'], urls: [] })
        h.handler!()
        await settle()
        expect(importOpenedFilesMock).toHaveBeenLastCalledWith(['/second.charx'])
        warn.mockRestore()
    })

    test('notifications that overlap are drained one after another', async () => {
        await desktopLaunchImport()
        let release!: () => void
        importOpenedFilesMock.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))
        invokeMock.mockResolvedValueOnce({ files: ['/slow.charx'], urls: [] })
        invokeMock.mockResolvedValueOnce({ files: ['/next.charx'], urls: [] })
        h.handler!()
        h.handler!()
        await settle()
        expect(importOpenedFilesMock).toHaveBeenCalledTimes(1)
        release()
        await settle()
        expect(importOpenedFilesMock).toHaveBeenCalledTimes(2)
    })

    test('a rejected invoke is swallowed', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })
        invokeMock.mockRejectedValueOnce(new Error('command take_launch_inputs not found'))
        await expect(desktopLaunchImport()).resolves.toBeUndefined()
        expect(importOpenedFilesMock).not.toHaveBeenCalled()
        warn.mockRestore()
    })

    test('a listen that rejects is swallowed', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })
        listenMock.mockRejectedValueOnce(new Error('no event API'))
        await expect(desktopLaunchImport()).resolves.toBeUndefined()
        warn.mockRestore()
    })

    test('guard: the deep-link plugin is never subscribed to or queried', async () => {
        invokeMock.mockResolvedValueOnce({ files: ['/a.charx'], urls: ['risutaniumlocal://realm/abc'] })
        await desktopLaunchImport()
        h.handler!()
        await settle()
        expect(onOpenUrlMock).not.toHaveBeenCalled()
        expect(getCurrentMock).not.toHaveBeenCalled()
    })
})
