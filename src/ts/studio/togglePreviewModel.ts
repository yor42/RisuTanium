// The read model of the toggle preview sheet. Pure: it walks the lines of one toggle text exactly as the chat panel's
// `itemsOf` does, so the preview shows what the chat shows, and it records which text line produced each item so a
// preview selection can land on its row. Nothing here reads the database or writes.
import type { PanelGroup, PanelItem, PanelSource, SourceInput, ToggleKind } from '../chatShell/togglePanel'
import type { ToggleTarget } from './toggleBuilder.svelte'
import { parseDefinition } from './toggleDef'

export type PreviewSource = PanelSource & {
    /** Panel uid (group, caption, divider or row) to the index in `parseDefinition(text).lines` of the producing line. */
    readonly lineOf: ReadonlyMap<string, number>
    /** Lines that no reading accepts (form `dropped`); blank lines are not counted. */
    readonly unreadable: number
}

function kindOf(valueKind: ToggleKind): ToggleKind {
    return valueKind === 'select' || valueKind === 'text' || valueKind === 'textarea' ? valueKind : 'check'
}

function previewSourceOf(input: SourceInput): PreviewSource {
    const sourceId = input.id
    const def = parseDefinition(input.text ?? '')
    const items: PanelItem[] = []
    const lineOf = new Map<string, number>()
    let open: PanelGroup | null = null
    let counter = 0
    let unreadable = 0
    // A uid is consumed only by a pushed item, so a skipped repeated divider leaves the counter alone.
    const next = (index: number) => {
        const uid = `${sourceId}#${counter++}`
        lineOf.set(uid, index)
        return uid
    }
    def.lines.forEach((line, index) => {
        const form = line.form
        const [key, value] = line.parts
        if (form.kind === 'dropped') {
            unreadable++
        } else if (form.kind === 'group') {
            open = { type: 'group', uid: next(index), label: value ?? key ?? '', children: [] }
            items.push(open)
        } else if (form.kind === 'groupEnd') {
            open = null
        } else if (form.kind === 'caption') {
            const target: PanelItem[] = open ? open.children : items
            target.push({ type: 'caption', uid: next(index), label: value ?? '' })
        } else if (form.kind === 'divider') {
            const target: PanelItem[] = open ? open.children : items
            const before = target.at(-1)
            if (!(before?.type === 'divider' && before.label === (value ?? ''))) {
                target.push({ type: 'divider', uid: next(index), label: value ?? '' })
            }
        } else if (form.kind === 'value') {
            const options = form.valueKind === 'select' ? line.parts[3]?.split(',') ?? [] : []
            const target: PanelItem[] = open ? open.children : items
            target.push({ type: 'row', uid: next(index), key, label: value, kind: kindOf(form.valueKind), options })
        }
    })
    // A group without a value row is not shown, and a same-label divider it separated then sits next to its twin.
    const shown: PanelItem[] = []
    for (const item of items) {
        if (item.type === 'group' && !item.children.some((child) => child.type === 'row')) {
            continue
        }
        const before = shown.at(-1)
        if (item.type === 'divider' && before?.type === 'divider' && before.label === item.label) {
            continue
        }
        shown.push(item)
    }
    const kept = new Set<string>()
    for (const item of shown) {
        kept.add(item.uid)
        if (item.type === 'group') {
            for (const child of item.children) {
                kept.add(child.uid)
            }
        }
    }
    for (const uid of [...lineOf.keys()]) {
        if (!kept.has(uid)) {
            lineOf.delete(uid)
        }
    }
    return { id: input.id, kind: input.kind, name: input.name, detail: input.detail ?? '', items: shown, lineOf, unreadable }
}

/** Each source parsed on its own, as `buildPanelModel` does, with the producing line of every item. */
export function previewSourcesOf(inputs: readonly SourceInput[]): PreviewSource[] {
    return inputs.map(previewSourceOf)
}

/** The panel id `toggleSourcesOf` gives the source of a builder's owner. */
export function panelIdOf(target: ToggleTarget): string {
    return target.kind === 'character' ? `character:${target.chaId}` : `module:${target.moduleId}`
}

/** Replaces only the text of the input named `panelId`; no match returns an equal list. */
export function withCurrentText(inputs: readonly SourceInput[], current: { readonly panelId: string, readonly text: string } | null): SourceInput[] {
    if (current === null) {
        return [...inputs]
    }
    return inputs.map((input) => input.id === current.panelId ? { ...input, text: current.text } : input)
}

/**
 * The inputs of the joined preview: the panel's sources with the open owner's current text, and without the bound
 * character's source when that character is private. The removal runs last, so no current text brings it back.
 */
export function joinedPreviewInputs(
    sources: readonly SourceInput[],
    character: { readonly chaId: string, readonly license?: string },
    current: { readonly panelId: string, readonly text: string } | null,
): SourceInput[] {
    const joined = withCurrentText(sources, current)
    if (character.license !== 'private') {
        return joined
    }
    const privateId = `character:${character.chaId}`
    return joined.filter((input) => input.id !== privateId)
}
