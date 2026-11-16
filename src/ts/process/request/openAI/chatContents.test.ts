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

function bytesToBase64(bytes: number[]): string {
    return btoa(String.fromCharCode(...bytes))
}

function padded(head: number[], total = 32): number[] {
    return [...head, ...new Array<number>(Math.max(0, total - head.length)).fill(0x41)]
}

function audioBytes(mime: string, bytes: number[], name = 'clip'): MultiModal {
    return { type: 'audio', base64: `data:${mime};base64,${bytesToBase64(bytes)}`, name }
}

const RIFF = [0x52, 0x49, 0x46, 0x46]
const WAVE = [0x57, 0x41, 0x56, 0x45]
const wavBytes = padded([...RIFF, 0x24, 0x00, 0x00, 0x00, ...WAVE])
const id3Bytes = padded([0x49, 0x44, 0x33, 0x03, 0x00])
const frameBytes = padded([0xFF, 0xFB, 0x90, 0x00])

describe('buildUserContents: audio without a declared type', () => {
    it('sends octet-stream audio with a wav header as wav, payload unchanged', () => {
        const { contents, leftOut } = build([audioBytes('application/octet-stream', wavBytes)])
        expect(contents[0]).toEqual({ type: 'input_audio', input_audio: { data: bytesToBase64(wavBytes), format: 'wav' } })
        expect(leftOut).toEqual([])
    })

    it('sends octet-stream audio with an ID3 tag as mp3', () => {
        const { contents, leftOut } = build([audioBytes('application/octet-stream', id3Bytes)])
        expect(contents[0]).toEqual({ type: 'input_audio', input_audio: { data: bytesToBase64(id3Bytes), format: 'mp3' } })
        expect(leftOut).toEqual([])
    })

    it('sends octet-stream audio starting at an MPEG layer III frame as mp3', () => {
        const { contents, leftOut } = build([audioBytes('application/octet-stream', frameBytes)])
        expect(contents[0]).toEqual({ type: 'input_audio', input_audio: { data: bytesToBase64(frameBytes), format: 'mp3' } })
        expect(leftOut).toEqual([])
    })

    it('sends audio with an empty MIME type and a wav header as wav', () => {
        const { contents, leftOut } = build([audioBytes('', wavBytes)])
        expect(contents[0]).toEqual({ type: 'input_audio', input_audio: { data: bytesToBase64(wavBytes), format: 'wav' } })
        expect(leftOut).toEqual([])
    })

    it.each([
        ['ADTS AAC', padded([0xFF, 0xF1, 0x50, 0x80])],
        ['MPEG layer II frame', padded([0xFF, 0xFD, 0x90, 0x00])],
        ['reserved MPEG version frame', padded([0xFF, 0xEB, 0x90, 0x00])],
        ['random bytes', padded([0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0, 0x11, 0x22, 0x33, 0x44])],
        ['RIFF without WAVE', padded([...RIFF, 0x24, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20])],
        ['payload under 12 bytes', [...RIFF, 0x24, 0x00, 0x00, 0x00, ...WAVE].slice(0, 11)],
    ])('leaves out octet-stream %s and names it', (_label, bytes) => {
        const { contents, leftOut } = build([audioBytes('application/octet-stream', bytes, 'x.bin')])
        expect(contents).toEqual([{ type: 'text', text: 'hello' }])
        expect(leftOut).toEqual(['x.bin'])
    })

    it.each(['@@@@', 'A', 'QUJDRA=', '!!!!!!!!!!!!!!!!'])('leaves out malformed or short base64 %s without throwing', (payload) => {
        const modal: MultiModal = { type: 'audio', base64: `data:application/octet-stream;base64,${payload}`, name: 'x.bin' }
        const { contents, leftOut } = build([modal])
        expect(contents).toEqual([{ type: 'text', text: 'hello' }])
        expect(leftOut).toEqual(['x.bin'])
    })

    it('does not sniff a declared audio type: ogg with ID3 bytes is left out', () => {
        const { contents, leftOut } = build([audioBytes('audio/ogg', id3Bytes, 'a.ogg')])
        expect(contents).toEqual([{ type: 'text', text: 'hello' }])
        expect(leftOut).toEqual(['a.ogg'])
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
