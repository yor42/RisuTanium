// A test-only layout model of the message list's skipped rows. A row whose container has the `older` class is laid out by an estimate until
// something resolves it; a resolved row keeps its real height for good (the engine remembers the size). A test opts in by asking the model for
// every height, scroll position and rect, so a test that does not use it keeps its own geometry.
//
// Rows resolve in three ways: a layout read while the row is forced (inline `content-visibility: visible`), focus on the row's article, and a
// rendering frame for a row within half a viewport of the visible area. Every resolve keeps the anchor row still: the scroll position moves by
// the change in the anchor's layout top. The anchor is the highest-index row that intersects the viewport, the first one in newest-first DOM order.
// The anchor rule is a model of the browser's scroll anchoring, not a measurement of it.
export const ESTIMATE_PX = 240

const CONTAINER_SELECTOR = '[data-part="chat-message-container"], [data-part="chat-first-message"]'
const ARTICLE_SELECTOR = 'article[data-chat-index]'

export interface CvLayoutModelOptions {
    // The element that holds the row containers in newest-first DOM order.
    list: HTMLElement
    hostHeight: () => number
    // The height a row has once it is laid out.
    realHeight: (index: number) => number
}

export interface ModelRect {
    top: number
    bottom: number
    height: number
}

// The mounted rows as the DOM shows them at one moment: the indexes in ascending order, the rows that carry `older` and the rows that are forced.
interface Snapshot {
    indexes: number[]
    older: Set<number>
    forced: Set<number>
}

export class CvLayoutModel {
    // The stored scroll position; reads go through `scrollTop`, which lays out first and clamps.
    private position = 0
    private readonly resolved = new Set<number>()

    constructor(private readonly options: CvLayoutModelOptions) {}

    // Forgets every resolved row, as a fresh mount does.
    reset(): void {
        this.resolved.clear()
        this.position = 0
    }

    private snapshot(): Snapshot {
        const indexes: number[] = []
        const older = new Set<number>()
        const forced = new Set<number>()
        for (const article of this.options.list.querySelectorAll<HTMLElement>(ARTICLE_SELECTOR)) {
            const index = Number(article.dataset.chatIndex)
            indexes.push(index)
            const container = article.closest<HTMLElement>(CONTAINER_SELECTOR)
            if (container?.classList.contains('older')) older.add(index)
            if (container?.style.getPropertyValue('content-visibility') === 'visible') forced.add(index)
        }
        indexes.sort((a, b) => a - b)
        return { indexes, older, forced }
    }

    mountedIndexes(): number[] {
        return this.snapshot().indexes
    }

    containerOf(index: number): HTMLElement | null {
        return this.options.list.querySelector<HTMLElement>(`article[data-chat-index="${index}"]`)?.closest<HTMLElement>(CONTAINER_SELECTOR) ?? null
    }

    // The message index of a container or its article, or null for any other element.
    indexOf(element: Element): number | null {
        const article = element.matches(ARTICLE_SELECTOR) ? element : element.matches(CONTAINER_SELECTOR) ? element.querySelector<HTMLElement>(ARTICLE_SELECTOR) : null
        return article instanceof HTMLElement ? Number(article.dataset.chatIndex) : null
    }

    isResolved(index: number): boolean {
        return this.resolved.has(index)
    }

    // Whether the row is laid out at the estimate right now.
    isEstimated(index: number): boolean {
        return this.estimated(this.snapshot(), index)
    }

    private estimated(snap: Snapshot, index: number): boolean {
        return snap.older.has(index) && !this.resolved.has(index)
    }

    private height(snap: Snapshot, index: number): number {
        return this.estimated(snap, index) ? ESTIMATE_PX : this.options.realHeight(index)
    }

    private layoutTop(snap: Snapshot, index: number): number {
        let sum = 0
        for (const mounted of snap.indexes) {
            if (mounted >= index) break
            sum += this.height(snap, mounted)
        }
        return sum
    }

    private contentHeight(snap: Snapshot): number {
        return snap.indexes.reduce((sum, index) => sum + this.height(snap, index), 0)
    }

    private clampedPosition(snap: Snapshot): number {
        this.position = Math.max(0, Math.min(this.position, Math.max(0, this.contentHeight(snap) - this.options.hostHeight())))
        return this.position
    }

    // The highest-index row that intersects the viewport, or null when none does.
    private anchorIndex(snap: Snapshot): number | null {
        const viewport = this.options.hostHeight()
        const position = this.clampedPosition(snap)
        for (let at = snap.indexes.length - 1; at >= 0; at--) {
            const top = this.layoutTop(snap, snap.indexes[at]) - position
            if (top < viewport && top + this.height(snap, snap.indexes[at]) > 0) return snap.indexes[at]
        }
        return null
    }

    // Resolves the rows together and keeps the anchor where it was.
    private resolve(snap: Snapshot, indexes: number[]): void {
        const pending = indexes.filter((index) => this.estimated(snap, index))
        if (pending.length === 0) return
        const anchor = this.anchorIndex(snap)
        const before = anchor === null ? 0 : this.layoutTop(snap, anchor)
        for (const index of pending) this.resolved.add(index)
        const after = anchor === null ? 0 : this.layoutTop(snap, anchor)
        this.position = Math.max(0, this.position + after - before)
    }

    // A layout read: forced rows take their real size first.
    private layout(): Snapshot {
        const snap = this.snapshot()
        this.resolve(snap, snap.indexes.filter((index) => snap.forced.has(index)))
        return snap
    }

    get scrollTop(): number {
        return this.clampedPosition(this.layout())
    }

    get scrollHeight(): number {
        return this.contentHeight(this.layout())
    }

    // A scroll write: clamps to the current end and returns what was stored.
    write(value: number): number {
        const snap = this.layout()
        this.position = value
        return this.clampedPosition(snap)
    }

    rectOf(index: number): ModelRect {
        const snap = this.layout()
        const top = this.layoutTop(snap, index) - this.clampedPosition(snap)
        const height = this.height(snap, index)
        return { top, bottom: top + height, height }
    }

    // Focus on a row's article lays that row out, and only that row.
    focus(index: number): void {
        this.resolve(this.snapshot(), [index])
    }

    // A rendering frame: rows within half a viewport of the visible area resolve.
    runFrame(): void {
        const snap = this.layout()
        const viewport = this.options.hostHeight()
        const position = this.clampedPosition(snap)
        const near = snap.indexes.filter((index) => {
            const top = this.layoutTop(snap, index) - position
            return top < 1.5 * viewport && top + this.height(snap, index) > -0.5 * viewport
        })
        this.resolve(snap, near)
    }
}
