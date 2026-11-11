import { getRealmUploadUrl } from './realmUploadUrl'

/**
 * The messages the Realm upload frame is allowed to send to the app. `filedata`
 * is only ever accepted as a success report.
 */
export type RealmFrameMessage =
    | { type: 'filedata' }
    | { type: 'pong' }
    | { type: 'close' }
    | { type: 'success', id: string }

// A Realm id is interpolated into a Markdown link and stored on the character,
// so it must be a plain URL path segment.
const SAFE_REALM_ID = /^[A-Za-z0-9_-]{1,128}$/

/** The origin the upload iframe is served from, and the only one it is addressed at. */
export function realmFrameOrigin(): string {
    return new URL(getRealmUploadUrl()).origin
}

/**
 * Returns the message only when it comes from the upload iframe's own window at
 * the Realm origin and has a well-formed shape; anything else is refused with
 * `null`. With no frame window there is nothing to match, so a message whose
 * `source` is also null is refused too.
 */
export function acceptRealmFrameMessage(
    event: Pick<MessageEvent<unknown>, 'source' | 'origin' | 'data'>,
    frameWindow: Window | null | undefined,
    realmOrigin: string,
): RealmFrameMessage | null {
    if (!frameWindow || event.source !== frameWindow) {
        return null
    }
    if (event.origin !== realmOrigin) {
        return null
    }
    const data = event.data
    if (typeof data !== 'object' || data === null) {
        return null
    }
    const { type, success, id } = data as { type?: unknown, success?: unknown, id?: unknown }
    switch (type) {
        case 'filedata':
            return success ? { type: 'filedata' } : null
        case 'pong':
            return { type: 'pong' }
        case 'close':
            return { type: 'close' }
        case 'success':
            return typeof id === 'string' && SAFE_REALM_ID.test(id) ? { type: 'success', id } : null
        default:
            return null
    }
}
