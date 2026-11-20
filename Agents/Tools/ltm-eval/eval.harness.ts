// @vitest-environment node
// Guards for the ltm-eval generator and the BM25 port. They bite through scratch mutants of the module
// directory named by LTM_EVAL_DIR (default: this folder). Golden files always come from this folder.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const HERE = fileURLToPath(new URL('./', import.meta.url))
const EVAL_DIR = process.env.LTM_EVAL_DIR ? path.resolve(process.env.LTM_EVAL_DIR) : path.resolve(HERE)
const GOLDEN_DIR = path.join(HERE, 'golden')

type Agg = { n: number; r1: number; r5: number; r10: number; mrr: number }
type Bm25Module = { tok: (text: string, mode?: 'bi' | 'ws') => string[] }
type EvalModule = { evaluateBm25: (dsDir: string) => { aggregates: Record<string, Agg>; tablesLines: string[] } }

const readGolden = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')) as T
const importFromEvalDir = async <T>(rel: string): Promise<T> =>
    (await import(/* @vite-ignore */ pathToFileURL(path.join(EVAL_DIR, rel)).href)) as T

let dsDir = ''

beforeAll(() => {
    dsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltm-eval-ds-'))
    const r = spawnSync(process.execPath, [path.join(EVAL_DIR, 'gen', 'gen.mjs'), dsDir], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error('ltm-eval: gen.mjs exited with status ' + String(r.status))
}, 60000)

describe('ltm-eval dataset', () => {
    it('A1: regeneration matches the committed sha256 of every dataset file', () => {
        const golden = readGolden<Record<string, string>>('dataset-sha256.json')
        const actual: Record<string, string> = {}
        for (const f of fs.readdirSync(dsDir).filter((x) => x.endsWith('.json')).sort()) {
            actual[f] = createHash('sha256').update(fs.readFileSync(path.join(dsDir, f))).digest('hex')
        }
        expect(Object.keys(golden).length).toBe(4)
        expect(actual).toEqual(golden)
    })
})

describe('ltm-eval BM25 port', () => {
    it('A2: the 32 aggregate keys equal the M2 golden exactly', async () => {
        const golden = readGolden<Record<string, Agg>>('m2-bm25-aggregates.json')
        const { aggregates } = (await importFromEvalDir<EvalModule>('eval-bm25.mjs')).evaluateBm25(dsDir)
        expect(Object.keys(golden).length).toBe(32)
        expect(Object.keys(aggregates).sort()).toEqual(Object.keys(golden).sort())
        for (const key of Object.keys(golden)) {
            const want = golden[key]
            const got = aggregates[key]
            expect(got.n, key + ' n').toBe(want.n)
            expect(got.r1, key + ' r1').toBe(want.r1)
            expect(got.r5, key + ' r5').toBe(want.r5)
            expect(got.r10, key + ' r10').toBe(want.r10)
            expect(got.mrr, key + ' mrr').toBe(want.mrr)
        }
    }, 60000)

    it('A3: the BM25 and T9 table rows equal the M2 golden line for line', async () => {
        const golden = fs.readFileSync(path.join(GOLDEN_DIR, 'm2-bm25-rows.md'), 'utf8').split('\n').filter((l) => l !== '')
        const { tablesLines } = (await importFromEvalDir<EvalModule>('eval-bm25.mjs')).evaluateBm25(dsDir)
        const rows = tablesLines.filter((l) => /^\| (BM25 \(|EN \||KO \|)/.test(l))
        expect(golden.length).toBe(29)
        expect(rows).toEqual(golden)
    }, 60000)

    it('A4: tokeniser modes behave as specified', async () => {
        const { tok } = await importFromEvalDir<Bm25Module>('bm25.mjs')
        expect(tok('서울역에서 만났다', 'bi').join(' ')).toBe('서울 울역 역에 에서 만났 났다')
        expect(tok('서울역에서 만났다', 'ws').join(' ')).toBe('서울역에서 만났다')
        expect(tok('나', 'bi').join(' ')).toBe('나')
        expect(tok("The Rowan's swords", 'bi').join(' ')).toBe('rowan sword')
        expect(tok("The Rowan's swords", 'ws').join(' ')).toBe('rowan sword')
    })
})
