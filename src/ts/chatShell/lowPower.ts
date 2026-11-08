// The app marks low power on the document root with the class `nexus-low-power` or the attribute `data-low-power`.
// Reduced motion (`rm`, the OS media query) is a separate setting and is not low power.
export function lowPowerMarked(root: Element | null = typeof document === 'undefined' ? null : document.documentElement): boolean {
    if (!root) return false
    return root.classList.contains('nexus-low-power') || root.hasAttribute('data-low-power')
}
