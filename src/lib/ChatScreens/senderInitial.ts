/** The first letter of a sender name, upper-cased, counting an emoji or other surrogate pair as one character; '' for a blank name. */
export function senderInitial(name: string): string {
    return Array.from(name.trim())[0]?.toUpperCase() ?? ''
}
