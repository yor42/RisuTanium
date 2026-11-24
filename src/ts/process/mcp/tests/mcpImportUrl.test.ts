// @vitest-environment happy-dom
/**
 * The Import MCP prompt admits a URL only by what a URL parse reads: plain `http://` is for `localhost`, the
 * `127.0.0.0/8` literals and `[::1]`; `https:` and the in-app schemes pass; a `stdio:` value that carries an inner `url`
 * is judged by the same rule as a top-level URL. The check gates this prompt only, not modules that arrive in a file, a
 * plugin write or a restore.
 *
 * Drives the REAL `importMCPModule` (T9-MCP-URL) and the pure `admitMcpImportUrl` over the same table. MOCKED: the alert
 * (the prompt answers each case), the database, the module store and the MCP client, whose constructor counts calls.
 * `getMCPMeta` itself cannot be mocked: `importMCPModule` calls it through a binding inside `mcp.ts`.
 *
 * Labels: R = regression reproducer (fails on the pre-change prefix check); C = compatibility guard (passes before and
 * after). `http://xlocalhost/` is C because the old prefix check refuses it too.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    alertInput: vi.fn(),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    clientBuilt: vi.fn(),
}))

vi.mock('src/ts/alert', () => ({
    alertInput: h.alertInput,
    alertError: h.alertError,
    alertNormal: h.alertNormal,
}))
vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: vi.fn(() => ({ modules: [] })) }))
vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: {} } }))
vi.mock('src/ts/process/modules', () => ({ getModuleMcpEntries: vi.fn(() => []), getModuleMcps: vi.fn(() => []) }))
vi.mock('src/ts/process/mcp/stdioApproval', () => ({ admitStdio: vi.fn() }))
vi.mock('src/ts/process/mcp/pluginmcp', () => ({ registeredCustomPluginMCPs: [] }))
vi.mock('src/ts/util', () => ({ sleep: vi.fn(async () => {}) }))
vi.mock('src/ts/process/mcp/mcplib', () => ({
    MCPClient: class {
        constructor() {
            h.clientBuilt()
        }
    },
}))

import { language } from 'src/lang'
import { admitMcpImportUrl, importMCPModule } from 'src/ts/process/mcp/mcp'

type Row = { url: string, label: 'R' | 'C' }

/** Refused: the old prefix check lets every R row through except `xlocalhost`, which it refuses as well. */
const REFUSED: Row[] = [
    { url: 'http://localhost.invalid/', label: 'R' },
    { url: 'http://127.invalid/', label: 'R' },
    { url: 'http://localhostx.invalid:1/', label: 'R' },
    { url: 'http://localhost@evil.invalid/', label: 'R' },
    { url: 'http://127.0.0.1@evil.invalid/', label: 'R' },
    { url: 'stdio:{"url":"http://evil.invalid/"}', label: 'R' },
    { url: 'stdio:{"url":"http://localhost@evil.invalid/"}', label: 'R' },
    { url: 'stdio:{"url":5}', label: 'R' },
    { url: 'http://127.0.0.invalid/', label: 'R' },
    { url: 'http://xlocalhost/', label: 'C' },
]

/** Admitted: all C but `[::1]`, which no old prefix matches. */
const ADMITTED: Row[] = [
    { url: 'http://localhost:8080/mcp', label: 'C' },
    { url: 'http://127.0.0.1:3000/', label: 'C' },
    { url: 'http://127.0.0.2/', label: 'C' },
    { url: 'http://[::1]:9/', label: 'R' },
    { url: 'https://a.invalid/', label: 'C' },
    { url: 'internal:dice', label: 'C' },
    { url: 'plugin:x', label: 'C' },
    { url: 'stdio:{"url":"http://127.0.0.1:1/"}', label: 'C' },
    { url: 'stdio:{"url":"https://a.invalid/"}', label: 'C' },
    { url: 'stdio:{"command":"node","args":["x.js"]}', label: 'C' },
]

beforeEach(() => {
    h.alertInput.mockReset()
    h.alertError.mockReset()
    h.alertNormal.mockReset()
    h.clientBuilt.mockReset()
})

describe('T9-MCP-URL: the real importMCPModule', () => {
    test.each(REFUSED)('refuses $url ($label): invalidUrl and no client', async ({ url }) => {
        h.alertInput.mockResolvedValue(url)

        await importMCPModule()

        expect(h.alertError).toHaveBeenCalledWith(language.errors.invalidUrl)
        expect(h.clientBuilt).not.toHaveBeenCalled()
    })

    test.each(ADMITTED)('admits $url ($label): never says invalidUrl', async ({ url }) => {
        h.alertInput.mockResolvedValue(url)

        await importMCPModule()

        expect(h.alertError).not.toHaveBeenCalledWith(language.errors.invalidUrl)
    })

    test.each(ADMITTED.filter((row) => row.url.startsWith('http')))('an admitted http(s) URL reaches the client layer: $url', async ({ url }) => {
        h.alertInput.mockResolvedValue(url)

        await importMCPModule()

        expect(h.clientBuilt).toHaveBeenCalled()
    })
})

describe('T9-MCP-URL (unit): admitMcpImportUrl', () => {
    test.each(REFUSED)('refuses $url ($label)', ({ url }) => {
        expect(admitMcpImportUrl(url)).toBe(false)
    })

    test.each(ADMITTED)('admits $url ($label)', ({ url }) => {
        expect(admitMcpImportUrl(url)).toBe(true)
    })

    test('a text that is not a URL, and a scheme that is neither http nor https, is refused', () => {
        expect(admitMcpImportUrl('not-a-url')).toBe(false)
        expect(admitMcpImportUrl('ftp://localhost/')).toBe(false)
        expect(admitMcpImportUrl('')).toBe(false)
    })

    test('an invalid stdio body is admitted as before: it fails later with its own reason', () => {
        expect(admitMcpImportUrl('stdio:{not json')).toBe(true)
    })
})
