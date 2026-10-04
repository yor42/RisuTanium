/**
 * The `${NAME}` reference syntax, with no imports, so UI components can recognise a reference
 * without loading the resolver and its platform dependencies. `src/ts/secretRef.ts` re-exports these.
 */

const SECRET_REF_PATTERN = /^\$\{([A-Z_][A-Z0-9_]*)\}$/

/** True when the whole trimmed value is one `${NAME}` reference. */
export function isSecretRef(value: unknown): value is string {
    return typeof value === 'string' && SECRET_REF_PATTERN.test(value.trim())
}

/** The variable name of a reference, or null when the value is not one. */
export function secretRefName(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null
    }
    const match = SECRET_REF_PATTERN.exec(value.trim())
    return match ? match[1] : null
}
