import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// The checker is a plain node script; running it on a scratch dist is the only way to see its exit code.
const CHECKER = resolve(__dirname, '../../../../util/checkReleaseDist.mjs')

let dist = ''

function runChecker(): { status: number | null, out: string } {
    const run = spawnSync(process.execPath, [CHECKER, dist], { encoding: 'utf8' })
    return { status: run.status, out: `${run.stdout}${run.stderr}` }
}

beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), 'risu-dist-'))
    mkdirSync(join(dist, 'assets'))
})

afterEach(() => {
    rmSync(dist, { recursive: true, force: true })
})

describe('checkReleaseDist export phase fields', () => {
    test('guard: a dist without the export phase fields is accepted', () => {
        writeFileSync(join(dist, 'assets', 'index.js'), 'console.log("stubChars", 1)')

        expect(runChecker().status).toBe(0)
    })

    test.each(['stubColdRootsMs=', 'stubLoopMs=', 'legacyCollectMs=', 'moduleSnapshotMs=', 'moduleSnapshotCount='])('new behaviour: a dist carrying %s is refused', (field) => {
        writeFileSync(join(dist, 'assets', 'index.js'), `x = \`a ${field}\${1}\``)

        const result = runChecker()

        expect(result.status).toBe(1)
        expect(result.out).toContain(field)
    })

    test.each(['stubPackWaitMs=', 'stubPackDrainMs=', 'stubPackFallbacks=', 'stubPackHeldMax='])('new behaviour: a dist carrying the packing field %s is refused', (field) => {
        writeFileSync(join(dist, 'assets', 'index.js'), `x = \`a ${field}\${1}\``)

        const result = runChecker()

        expect(result.status).toBe(1)
        expect(result.out).toContain(field)
    })

    test('new behaviour: a dist carrying the packing knob key is refused', () => {
        writeFileSync(join(dist, 'assets', 'index.js'), 'x = localStorage.getItem("risu-measure-export-pack")')

        const result = runChecker()

        expect(result.status).toBe(1)
        expect(result.out).toContain('risu-measure-export-pack')
    })

    test('new behaviour: a dist carrying the module read knob key is refused', () => {
        writeFileSync(join(dist, 'assets', 'index.js'), 'x = localStorage.getItem("risu-measure-export-module-reads")')

        const result = runChecker()

        expect(result.status).toBe(1)
        expect(result.out).toContain('risu-measure-export-module-reads')
    })
})
