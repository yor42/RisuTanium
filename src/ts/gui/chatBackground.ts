export interface ChatBackgroundInputs {
    customImageStyle: string
    backgroundHTML: unknown
    moduleEmbedding: unknown
    selected: boolean
}

function hasContent(value: unknown): boolean {
    return typeof value === 'string' && value.trim().length > 0
}

/**
 * Whether the new chat screen shows a background the user chose: a resolved custom image, or a card or module background for the selected chat.
 * While it does, a theme pack never paints the chat canvas over it.
 */
export function hasUserChatBackground(inputs: ChatBackgroundInputs): boolean {
    if(inputs.customImageStyle.length > 2){
        return true
    }
    return inputs.selected && (hasContent(inputs.backgroundHTML) || hasContent(inputs.moduleEmbedding))
}

// The two shapes the overlay colour takes: the user's `#rrggbb` colour with the alpha suffix appended, and the default rgba().
const OVERLAY_COLOUR = /^(#[0-9a-f]{8}|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\))$/i

/**
 * The shell's backdrop while a user background shows under a pack: the user's overlay colour, or nothing.
 * It is inline and important, so no pack declaration on the shell, important or not, can cover the user's background.
 * An overlay that is not a valid colour (a stored text-screen colour is any string) yields nothing instead of an invalid declaration,
 * which the browser would drop and leave the pack's shell paint over the user's background.
 */
export function canvasYieldDeclaration(overlayBackground: string | null): string {
    const colour = overlayBackground !== null && OVERLAY_COLOUR.test(overlayBackground.trim()) ? overlayBackground.trim() : 'none'
    return `background: ${colour} !important;`
}
