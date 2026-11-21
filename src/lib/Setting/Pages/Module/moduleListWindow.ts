import type { RisuModule } from 'src/ts/process/modules'

/**
 * The window key of every module of `modules`, by position. A key names the module, not its row:
 * it is `['m', id, occurrence]`, where `occurrence` counts the earlier modules with the same `id`.
 * Every module counts whatever the search shows, so a query never changes a key, and two modules
 * sharing an `id` still get different keys. An `id` that is not a string counts as ''.
 */
export function moduleRowKeys(modules: readonly Pick<RisuModule, 'id'>[]): string[] {
    const seen = new Map<string, number>()
    const keys: string[] = []
    for (const module of modules) {
        const id = typeof module?.id === 'string' ? module.id : ''
        const occurrence = seen.get(id) ?? 0
        seen.set(id, occurrence + 1)
        keys.push(JSON.stringify(['m', id, occurrence]))
    }
    return keys
}

/** The positions of `modules` whose name contains `search`, ignoring case, in array order. */
export function matchingModulePositions(modules: readonly Pick<RisuModule, 'name'>[], search: string): number[] {
    const needle = search.toLowerCase()
    const positions: number[] = []
    modules.forEach((module, i) => {
        if (needle === '' || (module?.name ?? '').toLowerCase().includes(needle)) {
            positions.push(i)
        }
    })
    return positions
}

function scrolls(element: Element): boolean {
    const overflow = getComputedStyle(element).overflowY
    return overflow === 'auto' || overflow === 'scroll'
}

/**
 * The element whose scrolling moves a module list that is itself an `overflow-y: auto` flex child.
 * When the list's parent is a scroll container, the parent bounds the list's height and the list
 * scrolls on its own (the legacy settings page). Otherwise the list grows to its content and never
 * scrolls, so the scroller is the nearest scrolling ancestor above it (the settings shell page);
 * null is the window.
 */
export function moduleListScroller(list: HTMLElement): HTMLElement | null {
    const parent = list.parentElement
    if (parent && scrolls(parent)) {
        return list
    }
    for (let node = parent; node; node = node.parentElement) {
        if (scrolls(node)) {
            return node
        }
    }
    return null
}
