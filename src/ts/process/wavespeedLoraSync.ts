export interface WavespeedLoraSlot {
    path: string
    scale: number
}

/**
 * The list the Other Bots page must write to `wavespeedImage.loras`, or null when the stored list already
 * equals it. Empty-path slots are dropped. Writing a fresh array notifies every deep reader of the stored
 * value, so an equal list is never written, while any difference in length, path or scale is.
 */
export function wavespeedLorasToWrite(
    slots: readonly WavespeedLoraSlot[],
    stored: readonly WavespeedLoraSlot[] | undefined,
): WavespeedLoraSlot[] | null {
    const filtered = slots
        .filter(item => item.path && item.path.trim() !== "")
        .map(item => ({ path: item.path, scale: item.scale }))
    const same = stored !== undefined
        && stored.length === filtered.length
        && stored.every((item, i) => item.path === filtered[i].path && item.scale === filtered[i].scale)
    return same ? null : filtered
}
