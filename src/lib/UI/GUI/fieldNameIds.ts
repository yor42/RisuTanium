export interface FieldNameIds {
    /** Id of the element that names the field: the visible label's id, or the screen-reader-only span's id. */
    nameId: string | undefined
    /** Value for `aria-describedby`: the naming element first, then the extra description ids. */
    describedIds: string | undefined
    /** True when the component must render its own screen-reader-only name span. */
    srOnly: boolean
}

/**
 * TalkBack speaks only the description in a field's own stop, so the naming element is also the first
 * description id. `labelId` references an existing visible label; `label` is the name text for a field
 * with no visible label and is rendered as a screen-reader-only span with the id `${uid}-label`.
 */
export function fieldNameIds(uid: string, labelId: string | undefined, label: string, describedBy: string | undefined): FieldNameIds {
    const srOnly = !labelId && label.trim() !== ''
    const nameId = labelId || (srOnly ? `${uid}-label` : undefined)
    const describedIds = [nameId, describedBy].filter(Boolean).join(' ') || undefined
    return { nameId, describedIds, srOnly }
}
