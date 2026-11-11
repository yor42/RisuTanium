/**
 * What the Android notifications show of a character: who speaks in a chat, and the avatar that becomes
 * the large icon. Stateless on purpose: the only avatar value is the thumbnail module's own memo, so no
 * notification code owns a cache with a lifetime of its own, and what a chat's begin warmed is still
 * there when its reply notice is posted.
 *
 * Nothing here persists anything. A lookup that misses may write a thumbnail record through the thumbnail
 * module's existing write path, as any list avatar does.
 */
import { language } from 'src/lang'
import { getAvatarThumbSrc, isThumbEligible, peekAvatarThumb } from '../media/avatarThumb'
import { activeStreams, replySpeakerOf } from '../process/activeStreams'
import { readAt } from '../process/chatOrigin'
import type { InFlightTarget } from '../process/inFlightWork'
import { DBState } from '../stores.svelte'
import type { KeepAliveSubject } from './keepAliveService'

/** The longest name a notification carries, counted in code points so a surrogate pair is never split. */
const MAX_NAME_CODE_POINTS = 100

/** The longest avatar data URL sent to native, in characters. Mirrors the native decoder's cap (AVATAR_MAX_DATA_CHARS). */
export const NOTIFICATION_AVATAR_MAX_DATA_CHARS = 400_000

/** True when an avatar image may become a large icon: a local asset, with images not hidden. */
function mayShowAvatar(image: string): boolean {
    return image !== '' && isThumbEligible(image) && !DBState.db?.hideAllImages
}

/**
 * The thumbnail for `image` that is known right now: a data URL, `null` for none (an empty, remote or
 * animated image, a failed lookup, or `hideAllImages`), and `undefined` while an eligible image has not
 * been looked up yet. Only `undefined` is worth a `warmNotificationAvatar`.
 */
export function notificationAvatarOf(image: string): string | null | undefined {
    if (!mayShowAvatar(image)) {
        return null
    }
    const known = peekAvatarThumb(image)
    // The avatar travels in the service start Intent, so a thumbnail native would refuse is not sent at all.
    return typeof known === 'string' && known.length > NOTIFICATION_AVATAR_MAX_DATA_CHARS ? null : known
}

/** Looks an eligible image up so a later `notificationAvatarOf` finds it. Never rejects and starts nothing for an ineligible one. */
export async function warmNotificationAvatar(image: string): Promise<void> {
    if (!mayShowAvatar(image)) {
        return
    }
    try {
        await getAvatarThumbSrc(image)
    } catch (error) {
        console.error('notification avatar lookup failed', error)
    }
}

function capName(name: string): string {
    const points = Array.from(name)
    return points.length > MAX_NAME_CODE_POINTS ? points.slice(0, MAX_NAME_CODE_POINTS).join('') : name
}

/**
 * The speaker of the chat at `target`, with the images of the speaker and of the owner. In a group the
 * speaker is the member the latest active stream of that group names, else the member of the latest live
 * turn registered for the chat, which names its speaker whether or not the reply streams (MC-1502, D-1);
 * with neither, or one that no longer resolves, the group itself speaks. Null when the chat is gone.
 */
export function notificationSubjectOf(target: InFlightTarget): KeepAliveSubject | null {
    const streams = activeStreams()
    let memberChaId: string | undefined
    for (const stream of streams) {
        if (stream.chaId === target.chaId && stream.memberChaId !== undefined) {
            memberChaId = stream.memberChaId
        }
    }
    memberChaId ??= replySpeakerOf(target.chaId, target.chatId)
    const found: { subject: KeepAliveSubject | null } = { subject: null }
    readAt({ chaId: target.chaId, chatId: target.chatId, memberChaId }, (ctx) => {
        const speaker = ctx.member ?? ctx.owner
        found.subject = {
            identity: { key: speaker.chaId, name: capName(speaker.name || language.settingsPage.unnamed) },
            image: speaker.image ?? '',
            ownerImage: ctx.owner.image ?? '',
        }
    })
    return found.subject
}
