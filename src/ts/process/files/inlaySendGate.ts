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
