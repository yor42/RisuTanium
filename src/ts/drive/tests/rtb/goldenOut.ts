/**
 * Output location and exclusive-create rules for the generators of the checked-in
 * `.rtb` goldens.
 *
 * A golden is frozen: no code path may write one into a repository. The output
 * directory is `RTB_GOLDENS_OUT` when set, else a fresh directory under the OS temp
 * folder. It is refused, before anything is created, when its real path (or that of
 * its nearest existing ancestor) has a `.git` entry in it or in any ancestor, whether
 * a directory or the file of a linked worktree, and when it lies inside the checkout
 * this module belongs to, which covers a checkout whose `.git` is not visible. Files
 * are created with `wx`, so an existing file is never overwritten.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface GoldenOutOptions {
    /** Module location the checkout is derived from; defaults to this module. Exists so the rule can be tested on a scratch tree. */
    moduleUrl?: string
}

/** Levels from this module's folder (`src/ts/drive/tests/rtb`) up to the checkout root. */
const CHECKOUT_LEVELS_UP = 5

function realOfNearestExisting(target: string): string {
    const resolved = path.resolve(target)
    const missing: string[] = []
    let probe = resolved
    while (!fs.existsSync(probe)) {
        const parent = path.dirname(probe)
        if (parent === probe) {
            break
        }
        missing.unshift(path.basename(probe))
        probe = parent
    }
    return path.join(fs.realpathSync.native(probe), ...missing)
}

function sameOrInside(child: string, parent: string): boolean {
    const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p)
    const relative = path.relative(fold(parent), fold(child))
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/** Throws when `dir` may not receive goldens; creates nothing. */
export function assertGoldenOutAllowed(dir: string, options: GoldenOutOptions = {}): void {
    const real = realOfNearestExisting(dir)
    for (let at = real; ; at = path.dirname(at)) {
        if (fs.existsSync(path.join(at, '.git'))) {
            throw new Error(`golden output ${real} is under a repository (${at} holds .git); set RTB_GOLDENS_OUT to a directory outside every repository`)
        }
        if (path.dirname(at) === at) {
            break
        }
    }
    const moduleFile = fileURLToPath(options.moduleUrl ?? import.meta.url)
    const checkoutRoot = path.resolve(path.dirname(moduleFile), ...Array<string>(CHECKOUT_LEVELS_UP).fill('..'))
    const realRoot = realOfNearestExisting(checkoutRoot)
    if (sameOrInside(real, realRoot)) {
        throw new Error(`golden output ${real} is inside the checkout ${realRoot}; set RTB_GOLDENS_OUT to a directory outside it`)
    }
}

/** The directory generators write into; created here, printed so the run can be found. */
export function goldenOutDir(options: GoldenOutOptions = {}): string {
    const requested = process.env.RTB_GOLDENS_OUT
    if (requested) {
        assertGoldenOutAllowed(requested, options)
        fs.mkdirSync(requested, { recursive: true })
        console.log(`golden output directory: ${requested}`)
        return requested
    }
    // The fresh name is checked as a not-yet-existing child of the temp folder.
    const candidate = path.join(os.tmpdir(), 'rtb-golden-out')
    assertGoldenOutAllowed(candidate, options)
    const dir = fs.mkdtempSync(`${candidate}-`)
    console.log(`golden output directory: ${dir}`)
    return dir
}

/** Creates `name` in `dir` exclusively; an existing file is an error. Returns the path. */
export function writeGoldenFile(dir: string, name: string, bytes: Uint8Array, options: GoldenOutOptions = {}): string {
    if (name === '' || name !== path.basename(name) || name === '.' || name === '..') {
        throw new Error(`golden file name ${JSON.stringify(name)} must be a plain file name`)
    }
    assertGoldenOutAllowed(dir, options)
    const file = path.join(dir, name)
    fs.writeFileSync(file, bytes, { flag: 'wx' })
    return file
}
