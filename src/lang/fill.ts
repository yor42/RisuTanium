const hasOwn = Object.prototype.hasOwnProperty

/**
 * Fills `{name}` placeholders in a translated string in a single pass, so a value that itself
 * contains `{other}` or `$&` is inserted literally and never re-scanned.
 */
export function fillLang(template: string, values: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (match: string, key: string) =>
        hasOwn.call(values, key) ? String(values[key]) : match
    )
}
