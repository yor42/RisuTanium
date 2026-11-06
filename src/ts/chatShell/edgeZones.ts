// SLICE1_SPEC §1: edge ownership is decided at pointer-down; no hit-area overlay is needed.
export const EDGE_ZONE_DP = 24

export interface EdgeZoneInput {
    xPx: number
    viewportWidthPx: number
    dpPerPx: number
    hostInsetDp?: number
    rightHostInsetDp?: number
    rtl?: boolean
}

export function classifyEdge(input: EdgeZoneInput): 'edge' | 'content' {
    const scale = input.dpPerPx > 0 ? input.dpPerPx : 1
    const widthDp = input.viewportWidthPx * scale
    const xDp = input.xPx * scale
    const inset = Math.max(0, input.hostInsetDp ?? 0)
    const rightInset = Math.max(0, input.rightHostInsetDp ?? inset)
    const left = input.rtl ? rightInset : inset
    const right = input.rtl ? inset : rightInset
    return xDp <= left + EDGE_ZONE_DP || xDp >= widthDp - right - EDGE_ZONE_DP ? 'edge' : 'content'
}
