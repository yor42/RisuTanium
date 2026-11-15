import { describe, expect, it } from 'vitest'
import type { MultiModal } from '../../index.svelte'
import { buildUserContents } from './chatContents'

const UNNAMED = 'an audio attachment'
const PAYLOAD = 'QUJDRA=='

function audio(mime: string, name?: string): MultiModal {
    return { type: 'audio', base64: `data:${mime};base64,${PAYLOAD}`, name }
}

function build(multimodals: MultiModal[], text = 'hello') {
    return buildUserContents(multimodals, text, 'low', UNNAMED)
}

describe('buildUserContents: audio', () => {
    it.each(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'])('%s becomes input_audio wav with bare base64', (mime) => {
        const { contents, leftOut } = build([audio(mime)])
        expect(contents[0]).toEqual({ type: 'input_audio', input_audio: { data: PAYLOAD, format: 'wav' } })
        expect(leftOut).toEqual([])
    })

    it.each(['audio/mpeg', 'audio/mp3', 'audio/mpeg3', 'audio/x-mpeg-3'])('%s becomes input_audio mp3 with bare base64', (mime) => {
        const { contents, leftOut } = build([audio(mime)])
        expect(contents[0]).toEqual({ type: 'input_audio', input_audio: { data: PAYLOAD, format: 'mp3' } })
        expect(leftOut).toEqual([])
    })

    it('accepts an upper-case MIME type and extra parameters', () => {
        const { contents } = build([audio('Audio/WAV;codecs=1')])
        expect(contents[0]).toEqual({ type: 'input_audio', input_audio: { data: PAYLOAD, format: 'wav' } })
    })

    it.each(['audio/ogg', 'audio/m4a'])('%s is left out and named', (mime) => {
        const { contents, leftOut } = build([audio(mime, 'clip.ogg')])
        expect(contents).toEqual([{ type: 'text', text: 'hello' }])
        expect(leftOut).toEqual(['clip.ogg'])
    })

    it('names an unnamed left-out audio with the fallback label', () => {
        const { leftOut } = build([audio('audio/ogg')])
        expect(leftOut).toEqual([UNNAMED])
    })

    it('leaves out audio whose data is not a base64 data URL', () => {
        const { contents, leftOut } = build([{ type: 'audio', base64: 'blob-not-a-data-url', name: 'x' }])
        expect(contents).toEqual([{ type: 'text', text: 'hello' }])
        expect(leftOut).toEqual(['x'])
    })
})

describe('buildUserContents: video, image and order', () => {
    it('sends a video as video_url with the data URL unchanged', () => {
        const url = 'data:video/mp4;base64,AAAA'
        const { contents, leftOut } = build([{ type: 'video', base64: url }])
        expect(contents[0]).toEqual({ type: 'video_url', video_url: { url } })
        expect(leftOut).toEqual([])
    })

    it('keeps an image as image_url with detail', () => {
        const url = 'data:image/png;base64,AAAA'
        const { contents } = build([{ type: 'image', base64: url }])
        expect(contents[0]).toEqual({ type: 'image_url', image_url: { url, detail: 'low' } })
    })

    it('puts the text part last', () => {
        const { contents } = build([{ type: 'video', base64: 'data:video/mp4;base64,AAAA' }], 'the text')
        expect(contents[contents.length - 1]).toEqual({ type: 'text', text: 'the text' })
    })

    it('keeps the order of a mixed image and audio message', () => {
        const { contents } = build([
            { type: 'image', base64: 'data:image/png;base64,AAAA' },
            audio('audio/mpeg'),
            { type: 'image', base64: 'data:image/jpeg;base64,BBBB' },
        ])
        expect(contents.map(c => c.type)).toEqual(['image_url', 'input_audio', 'image_url', 'text'])
    })

    it('keeps a signature as image_url exactly as before', () => {
        const { contents } = build([{ type: 'signature', base64: 'sig' }])
        expect(contents[0]).toEqual({ type: 'image_url', image_url: { url: 'sig', detail: 'low' } })
    })
})
