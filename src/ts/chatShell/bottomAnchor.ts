export interface BottomAnchorDecision {
    wasAtBottom: boolean
    surfaceHidden: boolean
    previousHeight: number
    nextHeight: number
}

// A keyboard resize anchors only a reader who was already following the newest message.
export function shouldAnchorBottom(input: BottomAnchorDecision): boolean {
    return input.wasAtBottom && !input.surfaceHidden && Number.isFinite(input.previousHeight)
        && Number.isFinite(input.nextHeight) && input.nextHeight < input.previousHeight
}