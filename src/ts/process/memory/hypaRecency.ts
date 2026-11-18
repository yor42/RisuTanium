/**
 * Summary recency for HypaV3. A summary's weight is 2^-(age / half-life). Summaries without a
 * recorded time count as older than every timed one, earliest position oldest, and the whole
 * untimed block spans exactly one half-life beyond the oldest timed summary. Everything here is
 * pure: no database, store or network access.
 */

export const DAY_MS = 86_400_000
export const DEFAULT_RECENCY_HALF_LIFE_DAYS = 30
/** One minute: keeps every age in half-lives finite, even for a denormal value read from a preset file. */
export const MIN_RECENCY_HALF_LIFE_DAYS = 1 / 1440

/** A summary's creation time, or undefined when the stored value is not a finite positive number. */
export function summaryCreatedAt(summary: { createdAt?: number }): number | undefined {
    const value: unknown = summary.createdAt
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * The creation time a re-summary of `sources` keeps: the earliest time when every source is timed,
 * otherwise none, so merged material is never dated newer than any source.
 */
export function mergedCreatedAt(sources: readonly { createdAt?: number }[]): number | undefined {
    if (sources.length === 0) {
        return undefined
    }

    let earliest = Infinity
    for (const source of sources) {
        const time = summaryCreatedAt(source)
        if (time === undefined) {
            return undefined
        }
        earliest = Math.min(earliest, time)
    }
    return earliest
}

/** The configured half-life when it is finite and at least one minute, otherwise the default. */
export function effectiveHalfLifeDays(value: number | null | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= MIN_RECENCY_HALF_LIFE_DAYS
        ? value
        : DEFAULT_RECENCY_HALF_LIFE_DAYS
}

/**
 * Age in half-lives for each summary, aligned with `summaries`. A time in the future counts as age 0.
 * The j-th untimed summary (position order) gets `A + (U - j) / U`, where A is the largest timed
 * value (0 when none is timed) and U the number of untimed summaries.
 */
export function recencyHalfLives(
    summaries: readonly { createdAt?: number }[],
    nowMs: number,
    halfLifeDays: number | null | undefined
): number[] {
    const halfLifeMs = effectiveHalfLifeDays(halfLifeDays) * DAY_MS
    const times = summaries.map(summaryCreatedAt)

    let oldestTimed = 0
    let untimed = 0
    const ages = times.map((time) => {
        if (time === undefined) {
            untimed++
            return undefined
        }
        const age = Math.max(0, nowMs - time) / halfLifeMs
        oldestTimed = Math.max(oldestTimed, age)
        return age
    })

    let untimedIndex = 0
    return ages.map((age) => {
        if (age !== undefined) {
            return age
        }
        return oldestTimed + (untimed - untimedIndex++) / untimed
    })
}

/** `recencyHalfLives` as a lookup by object identity; an unknown item gets 0. */
export function recencyLookup<T extends { createdAt?: number }>(
    summaries: readonly T[],
    nowMs: number,
    halfLifeDays: number | null | undefined
): (item: T) => number {
    const ages = recencyHalfLives(summaries, nowMs, halfLifeDays)
    const byItem = new Map<T, number>()
    summaries.forEach((summary, i) => byItem.set(summary, ages[i]))
    return (item) => byItem.get(item) ?? 0
}

const LN2 = Math.LN2

/**
 * Orders by descending score x 2^-halfLives, computed in log space so a very old item never
 * underflows to weight 0. Ties, including two -Infinity keys, keep input order.
 */
export function rankByRecency<T>(
    scored: readonly [T, number][],
    halfLivesOf: (item: T) => number
): T[] {
    const keyed = scored.map(([item, score], index) => ({
        item,
        index,
        key: Math.log(score) - halfLivesOf(item) * LN2,
    }))
    keyed.sort((a, b) => (a.key > b.key ? -1 : a.key < b.key ? 1 : a.index - b.index))
    return keyed.map((entry) => entry.item)
}

/**
 * A weighted random permutation (exponential race): each item draws one `Math.random` value and
 * items are ordered by ln(-ln(1 - r)) + halfLives * ln 2, so the first pick is proportional to
 * 2^-halfLives. Equal half-lives give a uniform permutation. Ties keep input order.
 */
export function weightedShuffle<T>(
    items: readonly T[],
    halfLivesOf: (item: T) => number
): T[] {
    const keyed = items.map((item, index) => ({
        item,
        index,
        key: Math.log(-Math.log(1 - Math.random())) + halfLivesOf(item) * LN2,
    }))
    keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index))
    return keyed.map((entry) => entry.item)
}
