// Key helpers for the toggle list: suggested and copied keys, and the keys one text reads. Pure. A key is read by the
// engine exactly (`toggle_` + key), so uniqueness here is over exact strings. Stub characters and modules carry no
// readable toggle text, so a `taken` set can only cover readable owners.
import { parseDefinition } from './toggleDef'

const STEM_LIMIT = 16

/** Lower-case ASCII `[a-z0-9]` runs of a label, joined by `_`; `''` when the label has none. */
export function keySlug(label: string): string {
    return (label.toLowerCase().match(/[a-z0-9]+/g) ?? []).join('_')
}

function stemOf(source: string): string {
    const words = keySlug(source).split('_').filter((word) => word !== '')
    if (words.length === 0) {
        return ''
    }
    let stem = words[0].slice(0, STEM_LIMIT)
    for (const word of words.slice(1)) {
        if (stem.length + 1 + word.length > STEM_LIMIT) {
            break
        }
        stem += `_${word}`
    }
    return stem
}

/** The owner prefix for keys of rows without a usable label: whole words of the name, at most 16 characters. */
export function ownerStem(name: string, id: string): string {
    return stemOf(name) || stemOf(id) || 'owner'
}

/** The slug of `label` made unique against `taken`; an empty slug uses `<stem>_t<n>` with the smallest free n >= 1. */
export function suggestKey(label: string, taken: ReadonlySet<string>, stem: string): string {
    const slug = keySlug(label)
    if (slug === '') {
        let n = 1
        while (taken.has(`${stem}_t${n}`)) {
            n++
        }
        return `${stem}_t${n}`
    }
    if (!taken.has(slug)) {
        return slug
    }
    let n = 2
    while (taken.has(`${slug}_${n}`)) {
        n++
    }
    return `${slug}_${n}`
}

/** The key of a duplicated row: `<key>_copy`, then `<key>_copy_2`, `_3`... while taken. */
export function copyKey(key: string, taken: ReadonlySet<string>): string {
    const first = `${key}_copy`
    if (!taken.has(first)) {
        return first
    }
    let n = 2
    while (taken.has(`${first}_${n}`)) {
        n++
    }
    return `${first}_${n}`
}

/** The keys of the value rows of a toggle text. Dividers, captions, group lines and unreadable lines carry none. */
export function keysOfText(text: string): ReadonlySet<string> {
    const keys = new Set<string>()
    for (const line of parseDefinition(text).lines) {
        if (line.form.kind === 'value') {
            keys.add(line.parts[0])
        }
    }
    return keys
}
