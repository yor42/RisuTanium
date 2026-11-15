import type { MultiModal } from '../../index.svelte'
import type { Contents } from './types'

const wavMimeTypes = ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave']
const mp3MimeTypes = ['audio/mpeg', 'audio/mp3', 'audio/mpeg3', 'audio/x-mpeg-3']

/** The wav or mp3 payload of a base64 audio data URL, or `null` for any other or unreadable audio. */
function parseAudioDataUrl(base64: string): { data: string, format: 'wav' | 'mp3' } | null {
    if(!base64.startsWith('data:')){
        return null
    }
    const comma = base64.indexOf(',')
    if(comma < 0){
        return null
    }
    const header = base64.slice('data:'.length, comma).toLowerCase().split(';')
    if(!header.includes('base64')){
        return null
    }
    const mime = header[0].trim()
    const data = base64.slice(comma + 1)
    if(wavMimeTypes.includes(mime)){
        return { data, format: 'wav' }
    }
    if(mp3MimeTypes.includes(mime)){
        return { data, format: 'mp3' }
    }
    return null
}

/**
 * The Chat Completions content parts of one user message. An image and a signature are sent as
 * `image_url`, a video as `video_url`, a wav or mp3 audio as `input_audio`; any other audio is left
 * out and its name listed in `leftOut`. The text part is always last.
 */
export function buildUserContents(
    multimodals: MultiModal[],
    text: string,
    detail: string,
    unnamedLabel: string
): { contents: Contents[], leftOut: string[] } {
    const contents: Contents[] = []
    const leftOut: string[] = []
    for(const modal of multimodals){
        if(modal.type === 'video'){
            contents.push({
                type: 'video_url',
                video_url: { url: modal.base64 }
            })
        }
        else if(modal.type === 'audio'){
            const audio = parseAudioDataUrl(modal.base64)
            if(audio === null){
                leftOut.push(modal.name || unnamedLabel)
            }
            else{
                contents.push({
                    type: 'input_audio',
                    input_audio: audio
                })
            }
        }
        else{
            contents.push({
                type: 'image_url',
                image_url: {
                    url: modal.base64,
                    detail
                }
            })
        }
    }
    contents.push({
        type: 'text',
        text
    })
    return { contents, leftOut }
}
