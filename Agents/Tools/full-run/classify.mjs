/**
 * Pure classification of full-run results from the fullrun-reporter summary.
 *
 * A failed file is RECOVERED-ALONE only when every error message in it is a vitest
 * timeout, the file is on the flake list and its single rerun alone passes cleanly.
 * Everything uncertain fails closed: a missing or malformed summary, an interrupted
 * run, any unhandled error, a collect error or an empty message never recover.
 */
import fs from 'node:fs'
import path from 'node:path'

export const SUMMARY_SCHEMA = 1
export const MAX_FAILED_MODULES = 10
const TIMEOUT_PATTERN = /^(Test|Hook) timed out in \d+ms\.$/

export function isTimeoutMessage(message) {
    if (typeof message !== 'string') return false
    return TIMEOUT_PATTERN.test(message.split('\n')[0].replace(/\r$/, ''))
}

// Repo-relative POSIX path of a summary `file`. win32 path semantics make the drive letter and path case irrelevant.
export function toRepoRelative(repo, file) {
    return path.win32.relative(repo, file).replace(/\\/g, '/')
}

function validSummary(summary) {
    return Boolean(summary) && typeof summary === 'object' && summary.schema === SUMMARY_SCHEMA
        && Array.isArray(summary.modules) && Array.isArray(summary.unhandled)
        && typeof summary.reason === 'string'
}

function invalidReason(summary) {
    if (!validSummary(summary)) return 'summary missing, unparseable or not schema 1'
    return null
}

function errorCollection(module) {
    return [
        ...module.moduleErrors,
        ...module.suites.flatMap((suite) => suite.errors),
        ...module.tests.filter((test) => test.state === 'failed').flatMap((test) => test.errors),
    ]
}

function categorize(module) {
    const collection = errorCollection(module)
    if (collection.length === 0) return 'NO-MESSAGE'
    if (module.moduleErrors.length > 0 && module.suites.length === 0 && module.tests.length === 0) return 'COLLECT-ERROR'
    return collection.every(isTimeoutMessage) ? 'TIMEOUT-ONLY' : 'NON-TIMEOUT'
}

/**
 * Returns {kind:'PASS'} | {kind:'FAIL-ERROR', reason} |
 * {kind:'FAILED', files:[{path, category, messages}]}.
 */
export function classifyFirstRun({ exitCode, timedOut, summary, repo }) {
    if (timedOut) return { kind: 'FAIL-ERROR', reason: 'the run hit its own timeout and was killed' }
    const invalid = invalidReason(summary)
    if (invalid) return { kind: 'FAIL-ERROR', reason: invalid }
    if (summary.reason === 'interrupted') return { kind: 'FAIL-ERROR', reason: 'the run was interrupted' }
    if (summary.unhandled.length > 0) return { kind: 'FAIL-ERROR', reason: `${summary.unhandled.length} unhandled error(s)` }
    const failed = summary.modules.filter((module) => module.state === 'failed')
    if (exitCode === 0) {
        if (failed.length > 0) return { kind: 'FAIL-ERROR', reason: 'exit 0 with failed modules' }
        if (summary.reason !== 'passed') return { kind: 'FAIL-ERROR', reason: `exit 0 with run state ${summary.reason}` }
        return { kind: 'PASS' }
    }
    if (failed.length === 0) return { kind: 'FAIL-ERROR', reason: 'nonzero exit with zero failed modules' }
    if (failed.length > MAX_FAILED_MODULES) {
        return { kind: 'FAIL-ERROR', reason: `${failed.length} failed modules (limit ${MAX_FAILED_MODULES})` }
    }
    const files = failed.map((module) => ({
        path: toRepoRelative(repo, module.file),
        category: categorize(module),
        messages: errorCollection(module),
    }))
    const collect = files.find((file) => file.category === 'COLLECT-ERROR')
    if (collect) return { kind: 'FAIL-ERROR', reason: `collect error in ${collect.path}` }
    return { kind: 'FAILED', files }
}

/** Returns {kind:'PASS'} | {kind:'REPEAT-FAIL'} | {kind:'RERUN-ERROR', reason}. */
export function classifyRerun({ exitCode, timedOut, summary, target, repo }) {
    if (timedOut) return { kind: 'RERUN-ERROR', reason: 'the rerun hit its own timeout and was killed' }
    const invalid = invalidReason(summary)
    if (invalid) return { kind: 'RERUN-ERROR', reason: invalid }
    if (summary.reason === 'interrupted') return { kind: 'RERUN-ERROR', reason: 'the rerun was interrupted' }
    if (summary.unhandled.length > 0) return { kind: 'RERUN-ERROR', reason: 'unhandled error in the rerun' }
    if (summary.modules.length !== 1) return { kind: 'RERUN-ERROR', reason: `rerun matched ${summary.modules.length} modules` }
    const [module] = summary.modules
    if (toRepoRelative(repo, module.file) !== target) return { kind: 'RERUN-ERROR', reason: 'rerun module is not the target' }
    if (module.state === 'failed') return { kind: 'REPEAT-FAIL' }
    if (exitCode !== 0 || summary.reason !== 'passed') return { kind: 'RERUN-ERROR', reason: 'nonzero exit without a failed module' }
    if (module.state !== 'passed') return { kind: 'RERUN-ERROR', reason: `rerun module state ${module.state}` }
    if (!module.tests.some((test) => test.state === 'passed')) return { kind: 'RERUN-ERROR', reason: 'rerun passed zero tests' }
    return { kind: 'PASS' }
}

/** One failed file's verdict from its first-run entry, its rerun classification and the flake set. */
export function fileVerdict(first, rerun, flakeSet) {
    if (rerun.kind === 'REPEAT-FAIL') return 'REPEAT-FAIL'
    if (rerun.kind !== 'PASS') return 'RERUN-ERROR'
    if (first.category !== 'TIMEOUT-ONLY') return 'PASSED-ALONE-NOT-TIMEOUT'
    if (!flakeSet.has(first.path)) return 'PASSED-ALONE-NOT-LISTED'
    return 'RECOVERED-ALONE'
}

/** PASS, PASS-RECOVERED, FAIL or FAIL-ERROR. BLOCKED is decided by the lock, never here. */
export function overallVerdict(first, fileVerdicts) {
    if (first.kind === 'PASS') return 'PASS'
    if (first.kind === 'FAIL-ERROR') return 'FAIL-ERROR'
    if (fileVerdicts.length > 0 && fileVerdicts.length === first.files.length
        && fileVerdicts.every((verdict) => verdict === 'RECOVERED-ALONE')) return 'PASS-RECOVERED'
    return 'FAIL'
}

/** Reads {files:[{path, reason, evidence, added}]} into a Set of repo-relative POSIX paths. */
export function loadFlakeList(file) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!parsed || !Array.isArray(parsed.files)) throw new Error(`flake list ${file} needs a files array`)
    const paths = new Set()
    for (const entry of parsed.files) {
        if (!entry || typeof entry.path !== 'string' || entry.path === '') throw new Error(`flake list ${file} has an entry without a path`)
        paths.add(entry.path)
    }
    return paths
}
