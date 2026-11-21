import { IdMatcher, Scanner, walkStrings, type Pacer } from 'src/ts/process/files/inlayCleanup'

/**
 * The resident walk of the inlay sweep: which of `ids` the page's database refers to, by the same string walk the dry run
 * uses (`dryRunMeasure.ts`). The walk is incomplete when a value was nested too deep to follow while an id was still
 * unmatched: a deleting pass cannot treat what it did not see as absent, so it answers null and the caller refuses.
 *
 * The inlay cleanup module imports the page's UI and storage modules, so only `maintenance.ts` loads this file, and only
 * dynamically.
 */
export async function residentInlaysOf(database: unknown, ids: readonly string[], pacer: Pacer): Promise<ReadonlySet<string> | null> {
    const matcher = new IdMatcher(ids)
    const scanner = new Scanner(matcher, null)
    const walked = await walkStrings(database, text => scanner.scan(text, pacer), pacer)
    const unmentioned = new Set(matcher.remaining())
    if (walked.tooDeep && unmentioned.size > 0) {
        return null
    }
    return new Set(ids.filter(id => !unmentioned.has(id)))
}
