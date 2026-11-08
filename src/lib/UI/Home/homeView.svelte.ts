/**
 * Which part of Home is showing. Home owns this state; it is not persisted and no stored field
 * depends on it. HomeShell resets it to the landing on every creation, and the Sidebar's Home
 * buttons reset it after they clear the selection, so the order of the selection writes is
 * unchanged.
 */
export type HomeViewName = 'landing' | 'library'

export const homeView: { view: HomeViewName } = $state({ view: 'landing' })

export function openHomeLibrary(): void {
    homeView.view = 'library'
}

export function showHomeLanding(): void {
    homeView.view = 'landing'
}
