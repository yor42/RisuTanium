// Path guards for the real run: the .bin and the output folder lie under ROOT, and the .bin, the output
// folder and ROOT all lie outside the repository. Problems are fixed texts, never data.
// Plain JavaScript because the launcher (run-real.mjs) loads it without a transpiler; the harness loads the same file.
import path from 'node:path'

/** @param {string} p */
const norm = (p) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p)

/**
 * @param {string} p
 * @param {string} root
 * @returns {boolean}
 */
export function isInside(p, root) {
    const a = norm(p)
    const b = norm(root)
    return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep)
}

/**
 * The list of violated rules; an empty list means the layout is acceptable.
 * @param {{ bin: string, out: string, root: string, repoRoot: string }} paths
 * @returns {string[]}
 */
export function checkRunPaths({ bin, out, root, repoRoot }) {
    /** @type {string[]} */
    const problems = []
    if (!isInside(bin, root)) problems.push('the .bin must lie under the run root')
    if (!isInside(out, root)) problems.push('the output folder must lie under the run root')
    if (isInside(bin, repoRoot)) problems.push('the .bin must not lie inside the repository')
    if (isInside(out, repoRoot)) problems.push('the output folder must not lie inside the repository')
    if (isInside(root, repoRoot)) problems.push('the run root must not lie inside the repository')
    return problems
}
