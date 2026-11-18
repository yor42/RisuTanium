import { afterEach, describe, expect, test, vi } from 'vitest'
import type { PreviewEngine } from './previewEngineService'

const h = vi.hoisted(() => ({
    imported: 0,
    engineModule: () => {
        h.imported += 1
        return { runPreview: () => ({ ok: false }), previewHtml: () => ({ html: '', mediaRemoved: 0 }) }
    },
}))

// The real engine drags the parser and its DOMPurify hooks in; its module is replaced by one that records imports.
vi.mock('./previewEngine', () => h.engineModule())

import { loadPreviewEngine, setPreviewEngineForTests } from './previewEngineService'

afterEach(() => {
    setPreviewEngineForTests(null)
    h.imported = 0
})

const stub = { marker: 'stub' } as unknown as PreviewEngine

describe('E2-N1 the preview engine service', () => {
    test('the engine module is imported once for any number of loads', async () => {
        const first = await loadPreviewEngine()
        const second = await loadPreviewEngine()
        expect(first).toBe(second)
        expect(h.imported).toBe(1)
    })

    test('concurrent loads and a later load all return the one cached promise', async () => {
        const a = loadPreviewEngine()
        const b = loadPreviewEngine()
        expect(a).toBe(b)
        await a
        expect(loadPreviewEngine()).toBe(a)
    })

    test('a failed import rejects and the next load imports again', async () => {
        vi.resetModules()
        vi.doMock('./previewEngine', () => { throw new Error('import failed') })
        const fresh = await import('./previewEngineService')
        await expect(fresh.loadPreviewEngine()).rejects.toThrow()
        vi.doMock('./previewEngine', () => h.engineModule())
        const engine = await fresh.loadPreviewEngine()
        expect(typeof engine.previewHtml).toBe('function')
    })

    test('the test seam replaces the engine and null restores the real import', async () => {
        setPreviewEngineForTests(stub)
        expect(await loadPreviewEngine()).toBe(stub)
        expect(h.imported).toBe(0)
        setPreviewEngineForTests(null)
        const real = await loadPreviewEngine()
        expect(real).not.toBe(stub)
        expect(typeof real.previewHtml).toBe('function')
    })

    test('a rejecting loader rejects each load until it is replaced', async () => {
        setPreviewEngineForTests(() => Promise.reject(new Error('no engine')))
        await expect(loadPreviewEngine()).rejects.toThrow('no engine')
        await expect(loadPreviewEngine()).rejects.toThrow('no engine')
        setPreviewEngineForTests(stub)
        expect(await loadPreviewEngine()).toBe(stub)
    })
})
