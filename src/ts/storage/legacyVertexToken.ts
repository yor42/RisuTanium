/**
 * A Vertex access token an older build stored in plain text (`vertexAccessToken`) is never read and is
 * cleared when the database loads. The clear exists only in memory until a save writes it, so the load
 * records it here and the boot marks its write, which takes the plaintext off the disk.
 */
let cleared = false

/** Clears a stored Vertex token in place and records that a non-empty one was dropped. */
export function dropStoredVertexToken(fields: { vertexAccessToken?: string, vertexAccessTokenExpires?: number }): void {
    if (fields.vertexAccessToken || fields.vertexAccessTokenExpires) {
        cleared = true
    }
    fields.vertexAccessToken = ''
    fields.vertexAccessTokenExpires = 0
}

/** Whether `dropStoredVertexToken` dropped a stored token since the last take, then resets the flag. */
export function takeStoredVertexTokenDropped(): boolean {
    const was = cleared
    cleared = false
    return was
}
