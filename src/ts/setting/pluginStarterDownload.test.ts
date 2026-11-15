import { describe, expect, test, vi } from 'vitest'
import { downloadPluginStarter } from './pluginStarterDownload'

function deps(over: Partial<Parameters<typeof downloadPluginStarter>[0]> = {}) {
    const bytes = new Uint8Array([1, 2, 3])
    return {
        bytes,
        fetcher: vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.buffer })),
        download: vi.fn(async () => true),
        fail: vi.fn(),
        ...over,
    }
}

describe('downloadPluginStarter', () => {
    test('fetches the starter and hands its bytes to the file download', async () => {
        const d = deps()
        await downloadPluginStarter(d)
        expect(d.fetcher).toHaveBeenCalledWith('/plugin_start.7z')
        expect(d.download).toHaveBeenCalledTimes(1)
        const [name, data] = vi.mocked(d.download).mock.calls[0]
        expect(name).toBe('plugin_starter.7z')
        expect(Array.from(data)).toEqual([1, 2, 3])
        expect(d.fail).not.toHaveBeenCalled()
    })

    test('a non-ok response, a throwing fetch and a rejected write each report one failure', async () => {
        const notOk = deps({ fetcher: vi.fn(async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) })) })
        await downloadPluginStarter(notOk)
        expect(notOk.fail).toHaveBeenCalledTimes(1)
        expect(notOk.download).not.toHaveBeenCalled()

        const throws = deps({ fetcher: vi.fn(async () => { throw new Error('offline') }) })
        await downloadPluginStarter(throws)
        expect(throws.fail).toHaveBeenCalledTimes(1)

        const rejected = deps({ download: vi.fn(async () => { throw new Error('disk full') }) })
        await downloadPluginStarter(rejected)
        expect(rejected.fail).toHaveBeenCalledTimes(1)
    })

    test('a dismissed save picker is silent', async () => {
        const d = deps({ download: vi.fn(async () => false) })
        await downloadPluginStarter(d)
        expect(d.download).toHaveBeenCalledTimes(1)
        expect(d.fail).not.toHaveBeenCalled()
    })
})
