// @vitest-environment node
// Classifier and reporter-summary tests over fixtures captured from real vitest runs
// (capture-fixtures.mjs). Derived inputs are labelled and guard only the fail-closed defaults.
// Run: node node_modules/vitest/vitest.mjs run Agents/Tools/full-run/classify.test.mjs
import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    classifyFirstRun, classifyRerun, fileVerdict, isTimeoutMessage, loadFlakeList, overallVerdict,
} from './classify.mjs'
import FullRunReporter, { MAX_MESSAGE_CHARS, summarize } from './fullrun-reporter.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')
const FIXTURES = path.join(HERE, 'fixtures')
const ROOT = '<ROOT>'
const TARGET = 'target.spec.mjs'

const load = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.summary.json`), 'utf8'))
const first = (name, exitCode = 1) => classifyFirstRun({ exitCode, timedOut: false, summary: load(name), repo: ROOT })
const rerun = (summary, target = TARGET, exitCode = 0) => classifyRerun({ exitCode, timedOut: false, summary, target, repo: ROOT })
const renamed = (summary, file) => ({ ...summary, modules: summary.modules.map((module) => ({ ...module, file })) })
const listed = new Set([TARGET])
const verdictFor = (firstName, rerunSummary, flake) => {
    const classified = first(firstName)
    expect(classified.kind).toBe('FAILED')
    return fileVerdict(classified.files[0], rerun(rerunSummary), flake)
}

describe('timeout message matching', () => {
    it('accepts the two vitest timeout messages and tolerates the trailing hint lines', () => {
        expect(isTimeoutMessage('Test timed out in 50ms.')).toBe(true)
        expect(isTimeoutMessage('Hook timed out in 50ms.\nIf this is a long-running hook, pass a timeout.')).toBe(true)
        expect(isTimeoutMessage('')).toBe(false)
        expect(isTimeoutMessage("expected 'x' to be 'Test timed out in 5ms.'")).toBe(false)
    })
})

describe('first run and rerun classification (captured fixtures)', () => {
    it('C1 a timeout-only failure in a listed file that passes alone is RECOVERED-ALONE', () => {
        expect(verdictFor('test-timeout', load('rerun-pass'), listed)).toBe('RECOVERED-ALONE')
        const classified = first('test-timeout')
        expect(classified.files[0]).toMatchObject({ path: TARGET, category: 'TIMEOUT-ONLY' })
        expect(overallVerdict(classified, ['RECOVERED-ALONE'])).toBe('PASS-RECOVERED')
    })

    it('C2 the same failure in an unlisted file is not recovered', () => {
        const verdict = verdictFor('test-timeout', load('rerun-pass'), new Set())
        expect(verdict).toBe('PASSED-ALONE-NOT-LISTED')
        expect(overallVerdict(first('test-timeout'), [verdict])).toBe('FAIL')
    })

    it('C3 an assertion failure that passes alone is not recovered even when listed', () => {
        expect(first('assertion').files[0].category).toBe('NON-TIMEOUT')
        expect(verdictFor('assertion', load('rerun-pass'), listed)).toBe('PASSED-ALONE-NOT-TIMEOUT')
    })

    it('C4 a timeout next to an assertion failure in one file is not eligible', () => {
        expect(first('mixed-timeout-assertion').files[0].category).toBe('NON-TIMEOUT')
        expect(verdictFor('mixed-timeout-assertion', load('rerun-pass'), listed)).toBe('PASSED-ALONE-NOT-TIMEOUT')
    })

    it('C5 a collect error is FAIL-ERROR with no reruns', () => {
        expect(first('collect-error')).toMatchObject({ kind: 'FAIL-ERROR' })
        expect(first('collect-error').reason).toMatch(/collect error/)
    })

    it('C6 an unhandled error is FAIL-ERROR under any exit code', () => {
        for (const exitCode of [1, 0]) {
            const classified = first('unhandled-after-pass', exitCode)
            expect(classified.kind).toBe('FAIL-ERROR')
            expect(classified.reason).toMatch(/unhandled/)
        }
    })

    it('C7 a missing summary, an own-timeout kill, an interrupted run and a mass failure are FAIL-ERROR', () => {
        for (const exitCode of [0, 1]) {
            const missing = classifyFirstRun({ exitCode, timedOut: false, summary: null, repo: ROOT })
            expect(missing.kind).toBe('FAIL-ERROR')
            expect(missing.reason).toMatch(/summary/)
        }
        const wrongSchema = classifyFirstRun({ exitCode: 0, timedOut: false, summary: { ...load('all-pass'), schema: 2 }, repo: ROOT })
        expect(wrongSchema.kind).toBe('FAIL-ERROR')
        const killed = classifyFirstRun({ exitCode: 0, timedOut: true, summary: load('all-pass'), repo: ROOT })
        expect(killed.reason).toMatch(/own timeout/)
        // Derived: the interrupted state is not captured by the real producer in this run.
        const interrupted = classifyFirstRun({ exitCode: 1, timedOut: false, summary: { ...load('test-timeout'), reason: 'interrupted' }, repo: ROOT })
        expect(interrupted.kind).toBe('FAIL-ERROR')
        expect(interrupted.reason).toMatch(/interrupted/)
        expect(first('mass-11-timeouts').kind).toBe('FAIL-ERROR')
        expect(first('mass-11-timeouts').reason).toMatch(/11 failed modules/)
        expect(first('all-pass', 0)).toEqual({ kind: 'PASS' })
    })

    it('C8 an assertion message that quotes the timeout text is not a timeout', () => {
        expect(first('assert-quotes-timeout').files[0].category).toBe('NON-TIMEOUT')
    })

    it('C9 a rerun that matches zero tests or two modules is a rerun error', () => {
        expect(rerun(load('rerun-zero-tests')).kind).toBe('RERUN-ERROR')
        const two = load('rerun-two-files')
        expect(two.modules).toHaveLength(2)
        expect(rerun(two, 'x1.spec.mjs')).toMatchObject({ kind: 'RERUN-ERROR', reason: expect.stringMatching(/2 modules/) })
        // Derived: a passed module whose test list is emptied, to isolate the passed-test requirement.
        const emptied = load('rerun-pass')
        emptied.modules[0].tests = []
        expect(rerun(emptied)).toMatchObject({ kind: 'RERUN-ERROR', reason: expect.stringMatching(/zero tests/) })
        expect(rerun(load('rerun-pass'))).toEqual({ kind: 'PASS' })
    })

    it('C9 a rerun that fails again is REPEAT-FAIL and an unreadable rerun is a rerun error', () => {
        expect(rerun(load('test-timeout'), TARGET, 1).kind).toBe('REPEAT-FAIL')
        expect(classifyRerun({ exitCode: 0, timedOut: false, summary: null, target: TARGET, repo: ROOT }).kind).toBe('RERUN-ERROR')
        expect(classifyRerun({ exitCode: 0, timedOut: true, summary: load('rerun-pass'), target: TARGET, repo: ROOT }).kind).toBe('RERUN-ERROR')
        expect(rerun(load('rerun-pass'), 'other.spec.mjs').kind).toBe('RERUN-ERROR')
    })

    it('C10 one recovered file next to one repeat-fail file is FAIL', () => {
        const classified = first('two-failed-files')
        expect(classified.files.map((file) => file.path)).toEqual(['a.spec.mjs', 'b.spec.mjs'])
        const flake = new Set(['a.spec.mjs', 'b.spec.mjs'])
        const verdicts = [
            fileVerdict(classified.files[0], rerun(renamed(load('rerun-pass'), `${ROOT}/a.spec.mjs`), 'a.spec.mjs'), flake),
            fileVerdict(classified.files[1], rerun(renamed(load('test-timeout'), `${ROOT}/b.spec.mjs`), 'b.spec.mjs', 1), flake),
        ]
        expect(verdicts).toEqual(['RECOVERED-ALONE', 'REPEAT-FAIL'])
        expect(overallVerdict(classified, verdicts)).toBe('FAIL')
        expect(overallVerdict(classified, ['RECOVERED-ALONE', 'RECOVERED-ALONE'])).toBe('PASS-RECOVERED')
        expect(overallVerdict(classified, ['RECOVERED-ALONE'])).toBe('FAIL')
    })

    it('C11 the flake list matches the exact repo-relative path, never the basename, and ignores drive-letter case', () => {
        const deep = (summary) => renamed(summary, 'C:/Repo/src/deep/target.spec.mjs')
        const classified = classifyFirstRun({ exitCode: 1, timedOut: false, summary: deep(load('test-timeout')), repo: 'c:\\repo' })
        expect(classified.files[0].path).toBe('src/deep/target.spec.mjs')
        const second = classifyRerun({ exitCode: 0, timedOut: false, summary: deep(load('rerun-pass')), target: 'src/deep/target.spec.mjs', repo: 'c:\\repo' })
        expect(second.kind).toBe('PASS')
        expect(fileVerdict(classified.files[0], second, new Set([TARGET]))).toBe('PASSED-ALONE-NOT-LISTED')
        expect(fileVerdict(classified.files[0], second, new Set(['src/deep/target.spec.mjs']))).toBe('RECOVERED-ALONE')
    })

    it('C12 hook timeouts at module and suite level count as timeouts', () => {
        expect(first('top-hook-timeout').files[0].category).toBe('TIMEOUT-ONLY')
        expect(first('describe-hook-timeout').files[0].category).toBe('TIMEOUT-ONLY')
        expect(verdictFor('describe-hook-timeout', load('rerun-pass'), listed)).toBe('RECOVERED-ALONE')
    })

    it('C13 the fixtures were captured with the installed vitest version', () => {
        const meta = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'meta.json'), 'utf8'))
        const installed = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'node_modules', 'vitest', 'package.json'), 'utf8')).version
        expect(meta.vitestVersion).toBe(installed)
        for (const name of Object.keys(meta.cases)) expect(load(name).vitestVersion).toBe(installed)
    })

    it('C14 a top-level afterAll error next to a test timeout is not eligible', () => {
        const classified = first('top-afterall-plus-timeout')
        expect(classified.files[0].category).toBe('NON-TIMEOUT')
        expect(classified.files[0].messages).toContain('teardown broke')
    })

    it('C15 a describe-level afterAll error next to a test timeout is not eligible', () => {
        const classified = first('describe-afterall-plus-timeout')
        expect(classified.files[0].category).toBe('NON-TIMEOUT')
        expect(classified.files[0].messages).toContain('suite teardown broke')
    })

    it('C16 an error with an empty message is not a timeout', () => {
        expect(load('throw-empty-object').modules[0].tests[0].errors).toEqual([''])
        expect(first('throw-empty-object').files[0].category).toBe('NON-TIMEOUT')
    })

    it('C17 a failed file with no messages at all is not a timeout', () => {
        // Derived: the reporter is not known to emit this shape; the row guards the fail-closed default.
        const summary = load('throw-empty-object')
        summary.modules[0].tests[0].errors = []
        const classified = classifyFirstRun({ exitCode: 1, timedOut: false, summary, repo: ROOT })
        expect(classified.files[0].category).toBe('NO-MESSAGE')
        expect(fileVerdict(classified.files[0], rerun(load('rerun-pass')), listed)).toBe('PASSED-ALONE-NOT-TIMEOUT')
    })
})

describe('flake list loading', () => {
    it('reads paths and rejects a malformed list', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-flake-test-'))
        try {
            const good = path.join(dir, 'good.json')
            fs.writeFileSync(good, JSON.stringify({ files: [{ path: 'a/b.test.ts', reason: 'r', evidence: 'e', added: 'd' }] }))
            expect([...loadFlakeList(good)]).toEqual(['a/b.test.ts'])
            const bad = path.join(dir, 'bad.json')
            fs.writeFileSync(bad, JSON.stringify({ files: [{ reason: 'no path' }] }))
            expect(() => loadFlakeList(bad)).toThrow(/without a path/)
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })
})

function fakeModule(overrides = {}) {
    const error = (message) => ({ message, stack: `Error: STACK_TRACE_ERROR\n    at ${message}` })
    return {
        moduleId: 'C:/x/target.spec.mjs',
        state: () => 'failed',
        errors: () => [error('module-level')],
        children: {
            allSuites: () => [{ fullName: 'd', state: () => 'failed', errors: () => [error('suite-level')] }],
            allTests: () => [{ fullName: 'd > t', result: () => ({ state: 'failed', errors: [error('test-level'), error('x'.repeat(MAX_MESSAGE_CHARS + 500))] }) }],
        },
        ...overrides,
    }
}

describe('fullrun reporter summary', () => {
    it('R1 every module, suite, test and unhandled message lands, using message and truncating long ones', () => {
        const summary = summarize([fakeModule()], [{ type: 'Uncaught Exception', message: 'u1' }, { name: 'Error', message: 'u2' }], 'failed', '9.9.9')
        expect(summary).toMatchObject({ schema: 1, vitestVersion: '9.9.9', reason: 'failed' })
        expect(summary.unhandled).toEqual([{ type: 'Uncaught Exception', message: 'u1' }, { type: 'Error', message: 'u2' }])
        const [module] = summary.modules
        expect(module.file).toBe('C:/x/target.spec.mjs')
        expect(module.moduleErrors).toEqual(['module-level'])
        expect(module.suites).toEqual([{ name: 'd', state: 'failed', errors: ['suite-level'] }])
        expect(module.tests[0].errors[0]).toBe('test-level')
        expect(module.tests[0].errors[1]).toHaveLength(MAX_MESSAGE_CHARS)
    })

    describe('R2 file output', () => {
        const saved = process.env.RISU_FULLRUN_SUMMARY
        afterEach(() => {
            vi.restoreAllMocks()
            if (saved === undefined) delete process.env.RISU_FULLRUN_SUMMARY
            else process.env.RISU_FULLRUN_SUMMARY = saved
        })

        it('writes nothing when the variable is unset, even if the surrounding run set it', () => {
            delete process.env.RISU_FULLRUN_SUMMARY
            const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
            const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => {})
            new FullRunReporter().onTestRunEnd([fakeModule()], [], 'failed')
            expect(write).not.toHaveBeenCalled()
            expect(rename).not.toHaveBeenCalled()
        })

        it('writes through a temporary file renamed into place and leaves no temporary file', () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-reporter-test-'))
            try {
                const target = path.join(dir, 'summary.json')
                process.env.RISU_FULLRUN_SUMMARY = target
                const rename = vi.spyOn(fs, 'renameSync')
                const reporter = new FullRunReporter()
                reporter.onInit({ version: '1.2.3' })
                reporter.onTestRunEnd([fakeModule()], [], 'failed')
                expect(rename).toHaveBeenCalledTimes(1)
                expect(rename.mock.calls[0][1]).toBe(target)
                expect(fs.readdirSync(dir)).toEqual(['summary.json'])
                expect(JSON.parse(fs.readFileSync(target, 'utf8')).vitestVersion).toBe('1.2.3')
            } finally {
                fs.rmSync(dir, { recursive: true, force: true })
            }
        })
    })
})
