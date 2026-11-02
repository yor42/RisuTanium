// @vitest-environment node
/**
 * The save-request probe module (`../saveRequestProbe`): the three notes record only while `MEASURE` is true, the ring keeps
 * the newest `SAVE_REQUEST_PROBE_LIMIT` entries with a continuous `seq`, `all()` is a copy, and a failing note never reaches
 * the caller. Spec tests of the new module. The build-level proof that a normal bundle carries no trace is
 * `util/checkReleaseDist.mjs`, which the last block drives on a synthetic output.
 */
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const flag = vi.hoisted(() => ({ measure: true }))

vi.mock('src/ts/process/memory/measureFlag', () => ({
    get MEASURE() {
        return flag.measure
    },
}))

import { noteReplyArrived, noteReplyEnd, noteRequestNow, SAVE_REQUEST_PROBE_LIMIT, saveRequestProbeHandle } from 'src/ts/storage/saveRequestProbe'

beforeEach(() => {
    flag.measure = true
    saveRequestProbeHandle.reset()
})

afterEach(() => {
    saveRequestProbeHandle.reset()
    vi.restoreAllMocks()
    delete (globalThis as { __risuSaveRequestProbe?: unknown }).__risuSaveRequestProbe
})

describe('save request probe ring', () => {
    test('keeps only the newest entries once past the cap, with a continuous seq', () => {
        for (let index = 0; index < SAVE_REQUEST_PROBE_LIMIT + 5; index++) {
            noteReplyEnd(true, {})
        }
        const all = saveRequestProbeHandle.all()
        expect(all).toHaveLength(SAVE_REQUEST_PROBE_LIMIT)
        for (let index = 1; index < all.length; index++) {
            expect(all[index].seq).toBe(all[index - 1].seq + 1)
        }
        expect(saveRequestProbeHandle.last()?.seq).toBe(all[all.length - 1].seq)
    })

    test('all() returns copies, reset() empties the ring and seq keeps running', () => {
        noteRequestNow(true, false, {})
        const first = saveRequestProbeHandle.all()
        expect(first).toHaveLength(1)
        if (first[0].kind === 'requestNow') {
            first[0].armed = false
        }
        const again = saveRequestProbeHandle.all()[0]
        expect(again.kind === 'requestNow' && again.armed).toBe(true)
        saveRequestProbeHandle.reset()
        expect(saveRequestProbeHandle.all()).toEqual([])
        expect(saveRequestProbeHandle.last()).toBeNull()
        noteRequestNow(false, false, {})
        expect(saveRequestProbeHandle.all()[0].seq).toBe(first[0].seq + 1)
    })

    test('an arrival without a response discriminant records null', () => {
        noteReplyArrived(undefined, {})
        const record = saveRequestProbeHandle.all()[0]
        expect(record.kind === 'replyArrived' && record.response).toBeNull()
    })

    test('a note that throws never reaches the caller', () => {
        const hostile = new Proxy({}, { set() { throw new Error('refused') } })
        expect(() => noteReplyArrived('success', hostile)).not.toThrow()
        expect(() => noteReplyEnd(true, hostile)).not.toThrow()
        expect(() => noteRequestNow(true, true, hostile)).not.toThrow()
    })

    test('a throwing clock never reaches the caller', () => {
        vi.spyOn(performance, 'now').mockImplementation(() => { throw new Error('clock') })
        expect(() => noteReplyArrived('success', {})).not.toThrow()
        expect(() => noteReplyEnd(true, {})).not.toThrow()
        expect(() => noteRequestNow(true, true, {})).not.toThrow()
        expect(saveRequestProbeHandle.all()).toEqual([])
    })

    test('with the measurement flag off nothing is recorded and nothing is installed', () => {
        flag.measure = false
        const target = {}
        noteReplyArrived('success', target)
        noteReplyEnd(true, target)
        noteRequestNow(true, true, target)
        expect(saveRequestProbeHandle.all()).toEqual([])
        expect(Object.keys(target)).toEqual([])
    })
})

describe('the build output check names the global', () => {
    const script = fileURLToPath(new URL('../../../../util/checkReleaseDist.mjs', import.meta.url))

    async function runCheck(source: string): Promise<{ status: number | null, stderr: string }> {
        const dir = await mkdtemp(join(tmpdir(), 'risu-dist-check-'))
        try {
            await writeFile(join(dir, 'index.js'), source)
            const run = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' })
            return { status: run.status, stderr: run.stderr }
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    }

    test('an output that carries the installed global name fails the check', async () => {
        const target = {}
        noteRequestNow(false, false, target)
        const installed = Object.keys(target)
        expect(installed).toHaveLength(1)

        const found = await runCheck(`globalThis.${installed[0]} = {}`)

        expect(found.status).toBe(1)
        expect(found.stderr).toContain('1 forbidden marker hit(s)')
    })

    test('guard: an output without any marker passes the check', async () => {
        expect((await runCheck('console.log("clean")')).status).toBe(0)
    })
})
