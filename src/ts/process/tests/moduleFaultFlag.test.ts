// @vitest-environment node
/**
 * The module fault switch (`process/moduleFaultFlag.ts`): the run-time reader and the built-output
 * check that keeps the switch out of a normal build (`util/checkReleaseDist.mjs`). Every row guards a new rule; each is
 * falsified by a named mutant of the flag module or the checker, run in a scratch copy.
 */
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { MODULE_FAULT_KEY, MODULE_FAULT_TEXT, moduleFaultActive, moduleFaultError } from 'src/ts/process/moduleFaultFlag'

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
})

describe('the reader answers true only for the exact id held by the key, at every call', () => {
    function storageWith(value: string | null) {
        const items = new Map<string, string>()
        if (value !== null) {
            items.set(MODULE_FAULT_KEY, value)
        }
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => items.get(key) ?? null,
            removeItem: (key: string) => { items.delete(key) },
        })
        return items
    }

    test('the exact id is active; another id, a prefix, a name and a missing key are not', () => {
        storageWith('id-b')
        expect(moduleFaultActive('id-b')).toBe(true)
        expect(moduleFaultActive('id-a')).toBe(false)
        expect(moduleFaultActive('id-')).toBe(false)
        expect(moduleFaultActive('b')).toBe(false)
        storageWith(null)
        expect(moduleFaultActive('id-b')).toBe(false)
    })

    test('a changed key takes effect at the next call, with no cache', () => {
        const items = storageWith('id-b')
        expect(moduleFaultActive('id-b')).toBe(true)
        items.delete(MODULE_FAULT_KEY)
        expect(moduleFaultActive('id-b')).toBe(false)
        items.set(MODULE_FAULT_KEY, 'id-b')
        expect(moduleFaultActive('id-b')).toBe(true)
        expect(moduleFaultActive('id-b')).toBe(true)
    })

    test('a throwing or missing localStorage reads as off', () => {
        vi.stubGlobal('localStorage', { getItem: () => { throw new Error('storage blocked') } })
        expect(moduleFaultActive('id-b')).toBe(false)
        vi.unstubAllGlobals()
        vi.stubGlobal('localStorage', undefined)
        expect(moduleFaultActive('id-b')).toBe(false)
    })

    test('the fault error carries the fault text and the module id', () => {
        const error = moduleFaultError('id-b')
        expect(error).toBeInstanceOf(Error)
        expect(error.message).toContain(MODULE_FAULT_TEXT)
        expect(error.message).toContain('id-b')
    })
})

describe('the build output check keeps the switch out of a normal build', () => {
    const script = fileURLToPath(new URL('../../../../util/checkReleaseDist.mjs', import.meta.url))

    /** Each fixture runs in a directory of its own, so one file's markers never decide another file's exit. */
    async function run(files: Record<string, string>, args: string[]): Promise<{ status: number | null, stdout: string, stderr: string }> {
        const dir = await mkdtemp(join(tmpdir(), 'risu-fault-dist-'))
        try {
            for (const [name, text] of Object.entries(files)) {
                await writeFile(join(dir, name), text)
            }
            const out = spawnSync(process.execPath, [script, ...args, dir], { encoding: 'utf8' })
            return { status: out.status, stdout: out.stdout, stderr: out.stderr }
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    }

    const keyInMap = { 'a.js.map': `{"sourcesContent":["localStorage.getItem('${MODULE_FAULT_KEY}')"]}` }
    const textInScript = { 'b.js': `throw new Error(${JSON.stringify(moduleFaultError('x').message)})` }
    const measureInScript = { 'c.js': 'globalThis.__risuGcNow = {}' }
    const measureInMap = { 'd.js.map': '{"sourcesContent":["globalThis.__risuGcNow = {}"]}' }

    test('a fault key found only in a source map fails both modes', async () => {
        for (const args of [[], ['--fault-only']]) {
            const found = await run(keyInMap, args)
            expect(found.status).toBe(1)
            expect(found.stdout).toContain(MODULE_FAULT_KEY)
            expect(found.stderr).toContain('1 forbidden marker hit(s)')
        }
    })

    test('the fault text found in a script fails both modes', async () => {
        for (const args of [[], ['--fault-only']]) {
            expect((await run(textInScript, args)).status).toBe(1)
        }
    })

    test('the flag module path found in a script fails both modes', async () => {
        for (const args of [[], ['--fault-only']]) {
            expect((await run({ 'e.js': '//#region src/ts/process/moduleFaultFlag.ts' }, args)).status).toBe(1)
        }
    })

    test('a measurement marker in a script fails the default mode and is ignored by --fault-only', async () => {
        expect((await run(measureInScript, [])).status).toBe(1)
        expect((await run(measureInScript, ['--fault-only'])).status).toBe(0)
    })

    test('a measurement marker found only in a source map is ignored in both modes', async () => {
        expect((await run(measureInMap, [])).status).toBe(0)
        expect((await run(measureInMap, ['--fault-only'])).status).toBe(0)
    })

    test('a directory with no marker passes both modes, and an unknown option is refused', async () => {
        const clean = { 'x.js': 'console.log("clean")' }
        expect((await run(clean, [])).status).toBe(0)
        expect((await run(clean, ['--fault-only'])).status).toBe(0)
        expect((await run(clean, ['--fault-onyl'])).status).toBe(2)
    })

    test('a missing directory still exits 2', async () => {
        const out = spawnSync(process.execPath, [script, '--fault-only', join(tmpdir(), 'risu-fault-dist-missing-dir')], { encoding: 'utf8' })
        expect(out.status).toBe(2)
    })
})
