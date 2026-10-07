// Text that is placed into generated HTML markup must pass through here: it is
// displayed as written and never parsed as an element or an attribute.
export function escapeHtmlText(value: unknown): string {
    return String(value).replace(/[&<>"']/g, (char) => {
        switch(char){
            case '&': return '&amp;'
            case '<': return '&lt;'
            case '>': return '&gt;'
            case '"': return '&quot;'
            default: return '&#39;'
        }
    })
}
