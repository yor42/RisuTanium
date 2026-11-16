import type { MultiModal } from '../../index.svelte'
import type { Contents } from './types'

const wavMimeTypes = ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave']
const mp3MimeTypes = ['audio/mpeg', 'audio/mp3', 'audio/mpeg3', 'audio/x-mpeg-3']

/** Base64 characters that decode to the 12 header bytes the sniffing reads; the payload is never decoded further. */
const sniffBase64Length = 16
const sniffByteLength = 12

/**
 * The format named by the file header of an untyped audio payload, or `null` when the header is
 * not wav or mp3 (MPEG layer III; AAC ADTS and layer I/II are not), the payload is shorter than
 * 12 bytes or the base64 is malformed.
 */
function sniffAudioFormat(data: string): 'wav' | 'mp3' | null {
    let head: string
    try{
        head = atob(data.slice(0, sniffBase64Length))
    }
    catch{
        return null
    }
    if(head.length < sniffByteLength){
        return null
    }
    if(head.startsWith('RIFF') && head.slice(8, 12) === 'WAVE'){
        return 'wav'
    }
    if(head.startsWith('ID3')){
        return 'mp3'
    }
    const second = head.charCodeAt(1)
    const isFrameHeader = head.charCodeAt(0) === 0xFF
        && (second & 0xE0) === 0xE0
        && (second & 0x18) !== 0x08
        && (second & 0x06) === 0x02
    return isFrameHeader ? 'mp3' : null
}

/**
 * The wav or mp3 payload of a base64 audio data URL, or `null` for any other or unreadable audio.
 * A declared MIME type decides the format. Only an `application/octet-stream` or empty MIME type
 * (audio stored without a type) is sniffed from the file header; the payload is passed on unchanged.
 */
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
    if(mime === '' || mime === 'application/octet-stream'){
        const format = sniffAudioFormat(data)
        return format === null ? null : { data, format }
    }
    return null
}

/**
 * The Chat Completions content parts of one user message. An image and a signature are sent as
 * `image_url`, a video as `video_url`, a wav or mp3 audio as `input_audio` (untyped audio is
 * recognised by its file header, see `parseAudioDataUrl`); any other audio is left out and its name
 * listed in `leftOut`. The text part is always last.
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
