/**
 * Installs a global stylesheet as one `<style data-risu-sheet="name">` in the document head. A sheet is adopted
 * once per name however often the installing module runs, and a call without a document changes nothing.
 * The rules a sheet carries use `!important` or selectors more specific than the rules they override, so their
 * place in the cascade after the build's own stylesheet does not matter.
 */
export function adoptSheet(name: string, cssText: string): void {
    if (typeof document === 'undefined') {
        return
    }
    const head = document.head
    if (!head) {
        return
    }
    for (const existing of head.querySelectorAll('style[data-risu-sheet]')) {
        if (existing.getAttribute('data-risu-sheet') === name) {
            return
        }
    }
    const style = document.createElement('style')
    style.setAttribute('data-risu-sheet', name)
    style.textContent = cssText
    head.appendChild(style)
}
