import { LLMFlags } from "../../model/types";
import { ANDROID_WHOLE_READ_URL_LIMIT_BYTES } from "../../storage/assetUrlGate";
import type { InlaySummary } from "./inlayStore";

/** The largest video or audio attachment, in bytes, that a send reads and puts in a request. */
export const INLAY_SEND_LIMIT_BYTES = 20 * 1024 * 1024

export type InlaySendVerdict = 'read' | 'not-sent' | 'too-large'

/**
 * Whether a send reads an inlay's body, from its summary alone. Only a video or an audio is ever held
 * back: an image or a signature is always read. The model flag is checked before the size, so a model
 * that cannot take the attachment leaves it out without a report; a message that already holds a modal
 * part takes no further video or audio.
 */
export function inlaySendVerdict(summary: InlaySummary, flags: readonly LLMFlags[], slotTaken: boolean): InlaySendVerdict {
    if(summary.type !== 'video' && summary.type !== 'audio'){
        return 'read'
    }
    const flag = summary.type === 'video' ? LLMFlags.hasVideoInput : LLMFlags.hasAudioInput
    if(!flags.includes(flag)){
        return 'not-sent'
    }
    if(slotTaken){
        return 'not-sent'
    }
    if(summary.size !== null && summary.size > INLAY_SEND_LIMIT_BYTES){
        return 'too-large'
    }
    return 'read'
}

/**
 * Whether an image is one this platform does not load: on Android an image above the whole-read limit is
 * neither shown nor sent, and its body is never read. Decided from the type and size alone, so the render
 * and the send agree. An unknown size is not withheld; no other type is withheld at this limit.
 */
export function inlayImageWithheld(type: unknown, size: number | null, android: boolean): boolean {
    return android && type === 'image' && size !== null && size > ANDROID_WHOLE_READ_URL_LIMIT_BYTES
}

/** The decoded size above which Android does not decode a string-stored video or audio for display. */
export const ANDROID_STRING_MEDIA_DISPLAY_LIMIT_BYTES = ANDROID_WHOLE_READ_URL_LIMIT_BYTES

/**
 * The kind of a string-stored video or audio that this platform does not decode for display, or `null`.
 * A string body is a base64 data URI that is read whole and decoded into copies of its size, so on Android
 * one whose estimated decoded size is above the limit is neither shown nor read. Decided from the type and
 * the estimate alone. An unknown size is not withheld; an image has its own rule, `inlayImageWithheld`.
 */
export function withheldStringMediaKind(type: unknown, size: number | null, android: boolean): 'audio' | 'video' | null {
    if(android && (type === 'audio' || type === 'video') && size !== null && size > ANDROID_STRING_MEDIA_DISPLAY_LIMIT_BYTES){
        return type
    }
    return null
}

export type InlayReadVerdict = 'read' | 'too-large'

/**
 * Whether a plugin or script read of an inlay loads its body, from its summary alone. It is the size rule
 * of `inlaySendVerdict` without the model flag and the modal slot, which a read has none of: only a video
 * or an audio over the limit is held back, and an unknown size is read.
 */
export function inlayReadVerdict(summary: InlaySummary): InlayReadVerdict {
    if(summary.type !== 'video' && summary.type !== 'audio'){
        return 'read'
    }
    if(summary.size !== null && summary.size > INLAY_SEND_LIMIT_BYTES){
        return 'too-large'
    }
    return 'read'
}
