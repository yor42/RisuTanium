/**
 * CRC-32 speed bench for the `.rtb` writer and reader (measurement M11, PC part).
 * It times the byte-wise `crc32Update` against a slice-by-8 variant over 64 MiB, so
 * the choice of speed path rests on a measured number. Numbers from a development PC
 * are best-case hardware: the Android figure comes from the device run.
 *
 * Writes only a JSON result under a fresh directory in the OS temp folder, and only
 * when RTB_GENERATE=1.
 *
 * Run (repository root):
 *   $env:RTB_GENERATE = '1'
 *   pnpm vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/rtbCrcBench.harness.ts
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, test, expect } from 'vitest'
import { crc32Table } from 'src/ts/storage/blockFrame'
import { CRC32_INIT, crc32Final, crc32Update } from 'src/ts/drive/rtb/crc32Running'

const GENERATE = process.env.RTB_GENERATE === '1'
const MIB = 1024 * 1024

// Slice-by-8 tables, built from the shared byte table.
function sliceTables(): Uint32Array[] {
    const tables = [crc32Table]
    for (let k = 1; k < 8; k++) {
        const prev = tables[k - 1]
        const next = new Uint32Array(256)
        for (let n = 0; n < 256; n++) {
            next[n] = (prev[n] >>> 8) ^ crc32Table[prev[n] & 0xFF]
        }
        tables.push(next)
    }
    return tables
}

function sliceBy8Update(tables: Uint32Array[], state: number, data: Uint8Array): number {
    let crc = state
    let i = 0
    const end8 = data.length - (data.length % 8)
    const [t0, t1, t2, t3, t4, t5, t6, t7] = tables
    for (; i < end8; i += 8) {
        const lo = (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)) ^ crc
        crc = t7[lo & 0xFF] ^ t6[(lo >>> 8) & 0xFF] ^ t5[(lo >>> 16) & 0xFF] ^ t4[lo >>> 24]
            ^ t3[data[i + 4]] ^ t2[data[i + 5]] ^ t1[data[i + 6]] ^ t0[data[i + 7]]
    }
    for (; i < data.length; i++) {
        crc = t0[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)
    }
    return crc >>> 0
}

function medianMs(run: () => void, rounds: number): number {
    const times: number[] = []
    for (let i = 0; i < rounds; i++) {
        const start = performance.now()
        run()
        times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    return times[Math.floor(times.length / 2)]
}

describe.skipIf(!GENERATE)('CRC-32 bench (RTB_GENERATE=1)', () => {
    test('byte-wise against slice-by-8 over 64 MiB', () => {
        const data = new Uint8Array(64 * MIB)
        let state = 12345
        for (let i = 0; i < data.length; i++) {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0
            data[i] = state >>> 24
        }
        const tables = sliceTables()
        const byteWise = crc32Final(crc32Update(CRC32_INIT, data))
        const sliced = crc32Final(sliceBy8Update(tables, CRC32_INIT, data))
        expect(sliced).toBe(byteWise)

        const byteMs = medianMs(() => { crc32Update(CRC32_INIT, data) }, 5)
        const sliceMs = medianMs(() => { sliceBy8Update(tables, CRC32_INIT, data) }, 5)
        const result = {
            node: process.version,
            cpu: os.cpus()[0]?.model ?? 'unknown',
            bytes: data.length,
            byteWiseMs: Math.round(byteMs),
            byteWiseMiBps: Math.round(64000 / byteMs),
            sliceBy8Ms: Math.round(sliceMs),
            sliceBy8MiBps: Math.round(64000 / sliceMs),
        }
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtb-crc-bench-'))
        fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2))
        console.log(`CRC bench result in ${dir}: ${JSON.stringify(result)}`)
    }, 300000)
})
