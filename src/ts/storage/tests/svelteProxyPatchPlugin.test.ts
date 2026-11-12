// @vitest-environment node
// LH1: the load hook of patches/svelte-5.57.3/plugin.mjs serves the patched runtime only for the exact Svelte version
// and the exact original bytes the patch was made from, and throws for anything else. Fake Svelte trees are built under
// the OS temp directory from the installed originals, so no installed file is touched.
import { afterAll, describe, expect, it } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

interface ProxyPatchPlugin {
    enforce?: string
    load(id: string): string | null
}

const PATCH_DIR = fileURLToPath(new URL('../../../../patches/svelte-5.57.3/', import.meta.url))
// Imported by a computed URL so the type checker does not pull the plugin (a plain .mjs) in as an input file.
const { svelteProxyPatch } = await import(/* @vite-ignore */ pathToFileURL(PATCH_DIR + 'plugin.mjs').href) as { svelteProxyPatch(): ProxyPatchPlugin }
const INSTALLED_CLIENT = join(dirname(createRequire(import.meta.url).resolve('svelte/package.json')), 'src', 'internal', 'client')
const root = mkdtempSync(join(tmpdir(), 'risu-svelte-patch-lh1-'))
afterAll(() => { rmSync(root, { recursive: true, force: true }) })

/** A fake `svelte` package dir holding the installed originals; returns the id of its proxy.js. */
function fakeTree(name: string, version: string, tamper?: 'proxy' | 'index'): { proxy: string, index: string } {
    const client = join(root, name, 'node_modules', 'svelte', 'src', 'internal', 'client')
    mkdirSync(client, { recursive: true })
    writeFileSync(join(root, name, 'node_modules', 'svelte', 'package.json'), JSON.stringify({ name: 'svelte', version }))
    for (const file of ['proxy.js', 'index.js']) copyFileSync(join(INSTALLED_CLIENT, file), join(client, file))
    if (tamper !== undefined) writeFileSync(join(client, tamper + '.js'), readFileSync(join(client, tamper + '.js'), 'utf8') + '\n// changed\n')
    return { proxy: join(client, 'proxy.js'), index: join(client, 'index.js') }
}

describe('LH1 svelte proxy patch plugin', () => {
    it('serves the patched proxy.js and index.js for the pinned version with the exact originals', () => {
        const ids = fakeTree('ok', '5.57.3')
        const plugin = svelteProxyPatch()
        expect(plugin.load(ids.proxy)).toBe(readFileSync(join(PATCH_DIR, 'proxy.js'), 'utf8'))
        expect(plugin.load(ids.index)).toBe(readFileSync(join(PATCH_DIR, 'index.js'), 'utf8'))
        expect(String(plugin.load(ids.proxy))).toContain('risu-proxy-patch svelte@5.57.3')
    })

    it('accepts ids with a query string and with backslashes', () => {
        const ids = fakeTree('query', '5.57.3')
        const plugin = svelteProxyPatch()
        expect(plugin.load(ids.proxy + '?v=abc123')).toBe(readFileSync(join(PATCH_DIR, 'proxy.js'), 'utf8'))
        expect(plugin.load(ids.index.replace(/\//g, '\\'))).toBe(readFileSync(join(PATCH_DIR, 'index.js'), 'utf8'))
    })

    it('throws for another installed Svelte version', () => {
        const ids = fakeTree('version', '5.58.0')
        expect(() => svelteProxyPatch().load(ids.proxy)).toThrow(/installed svelte 5\.58\.0.*made for 5\.57\.3/)
        expect(() => svelteProxyPatch().load(ids.index)).toThrow(/5\.58\.0/)
    })

    it('throws when an installed original differs from the one the patch was made from', () => {
        const proxyChanged = fakeTree('hash-proxy', '5.57.3', 'proxy')
        expect(() => svelteProxyPatch().load(proxyChanged.proxy)).toThrow(/proxy\.js differs/)
        const indexChanged = fakeTree('hash-index', '5.57.3', 'index')
        expect(() => svelteProxyPatch().load(indexChanged.index)).toThrow(/index\.js differs/)
    })

    it('leaves every other file alone', () => {
        const plugin = svelteProxyPatch()
        expect(plugin.load(join(INSTALLED_CLIENT, 'runtime.js'))).toBeNull()
        expect(plugin.load(join(root, 'ok', 'node_modules', 'other', 'src', 'internal', 'client', 'proxy.js'))).toBeNull()
    })

    it('runs before other plugins', () => {
        expect(svelteProxyPatch().enforce).toBe('pre')
    })
})
