import { resolveSecret } from 'src/ts/secretRef'

/**
 * The credential to put in a request. A request preview keeps the value as typed, so a
 * `${NAME}` reference is shown as the reference and never resolved; a real request resolves
 * it, throwing `SecretRefError` when the variable cannot be read. A value that is not a
 * reference comes back unchanged either way.
 */
export async function resolveRequestKey(arg: { previewBody?: boolean }, value: string): Promise<string> {
    if (arg.previewBody) {
        return value
    }
    return await resolveSecret(value)
}
