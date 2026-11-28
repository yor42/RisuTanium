// @vitest-environment node
// The bundled-archive reader: bytes on an ok answer, null on a non-ok one, and a failed fetch or body read reaches the caller so
// "could not check" stays distinct from "not there". The real module is loaded with `vi.importActual` because the Vitest setup
// replaces it for every other test; fetch is a stub, so no network or file is read.
import { afterEach, describe, expect, it, vi } from 'vitest'

type Reader = typeof import('./bundledArchive')

async function realReader(): Promise<Reader['readBundledArchive']> {
    return (await vi.importActual<Reader>('./bundledArchive')).readBundledArchive
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('B-1 readBundledArchive', () => {
    it('an ok answer gives the body bytes, fetched from the given URL', async () => {
        const fetched: string[] = []
        vi.stubGlobal('fetch', async (url: string) => {
            fetched.push(url)
            return new Response(new Uint8Array([80, 75, 3, 4]))
        })
        const read = await realReader()
        expect(await read('/assets/x.risutheme')).toEqual(new Uint8Array([80, 75, 3, 4]))
        expect(fetched).toEqual(['/assets/x.risutheme'])
    })

    it('a non-ok answer gives null, whatever the body holds', async () => {
        vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1, 2, 3]), { status: 404 }))
        const read = await realReader()
        expect(await read('/assets/missing.risutheme')).toBeNull()
    })

    it('a fetch that throws propagates to the caller', async () => {
        vi.stubGlobal('fetch', async () => { throw new TypeError('network down') })
        const read = await realReader()
        await expect(read('/assets/x.risutheme')).rejects.toThrow('network down')
    })

    it('a body read that throws propagates to the caller', async () => {
        vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => { throw new Error('body failed') } }))
        const read = await realReader()
        await expect(read('/assets/x.risutheme')).rejects.toThrow('body failed')
    })

    it('reads a data: URL through the real fetch', async () => {
        const read = await realReader()
        expect(await read(`data:application/octet-stream;base64,${Buffer.from([9, 8, 7]).toString('base64')}`)).toEqual(new Uint8Array([9, 8, 7]))
    })
})
