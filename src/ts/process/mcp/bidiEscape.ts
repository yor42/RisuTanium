/** Bidi embedding, override, isolate and mark controls shown as `\uXXXX`, so text in a prompt cannot reorder what follows it. */
export function escapeBidiControls(text: string): string {
    return text.replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)
}
