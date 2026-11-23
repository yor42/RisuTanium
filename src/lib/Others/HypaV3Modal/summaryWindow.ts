/** Stable window keys for summary cards: one id per summary object, kept while the object lives. */
export function summaryRowKeys(): { keyOf(summary: object): string } {
    const ids = new WeakMap<object, string>()
    let next = 0
    return {
        keyOf(summary) {
            let id = ids.get(summary)
            if (id === undefined) {
                id = `s${next++}`
                ids.set(summary, id)
            }
            return id
        },
    }
}
