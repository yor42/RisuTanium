// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { doLossyCompression } from '../lossyCompression'

class FakeImage {
    static instances: FakeImage[] = []
    static fireErrorOnSrcClear = false
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    width = 0
    height = 0
    srcWrites: string[] = []
    private currentSrc = ''

    constructor() {
        FakeImage.instances.push(this)
    }

    get src() {
        return this.currentSrc
    }

    set src(value: string) {
        this.currentSrc = value
        this.srcWrites.push(value)
        if (value === '' && FakeImage.fireErrorOnSrcClear) {
            this.onerror?.()
        }
    }

    fireLoad(width: number, height: number) {
        this.width = width
        this.height = height
        this.onload?.()
    }

    fireError() {
        this.onerror?.()
    }
}

class FakeCanvas {
    widthWrites: number[] = []
    heightWrites: number[] = []
    drawArgs: number[][] = []
    toDataURLCalls: Array<[string, number]> = []
    context: { drawImage: (image: unknown, x: number, y: number, w: number, h: number) => void } | null
    webpPayload = 'data:image/webp;base64,' + Buffer.from('webp-bytes').toString('base64')
    jpegPayload = 'data:image/jpeg;base64,' + Buffer.from('jpeg-bytes').toString('base64')
    drawThrows = false
    toDataURLThrows = false

    constructor() {
        this.context = {
            drawImage: (_image, x, y, w, h) => {
                if (this.drawThrows) {
                    throw new Error('draw failed')
                }
                this.drawArgs.push([x, y, w, h])
            },
        }
    }

    set width(value: number) {
        this.widthWrites.push(value)
    }

    set height(value: number) {
        this.heightWrites.push(value)
    }

    getContext() {
        return this.context
    }

    toDataURL(type: string, quality: number) {
        if (this.toDataURLThrows) {
            throw new Error('toDataURL failed')
        }
        this.toDataURLCalls.push([type, quality])
        return type === 'image/webp' ? this.webpPayload : this.jpegPayload
    }
}

const input = new Uint8Array([1, 2, 3, 4, 5])
let canvases: FakeCanvas[] = []
let warnSpy: ReturnType<typeof vi.spyOn>

async function flushMicrotasks() {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve()
    }
}

function start() {
    const state: { settled: boolean; value: Buffer | null; rejected: boolean } = {
        settled: false,
        value: null,
        rejected: false,
    }
    doLossyCompression(input).then(
        (value) => {
            state.settled = true
            state.value = value
        },
        () => {
            state.settled = true
            state.rejected = true
        },
    )
    return state
}

function latestImage() {
    return FakeImage.instances[FakeImage.instances.length - 1]
}

beforeEach(() => {
    FakeImage.instances = []
    FakeImage.fireErrorOnSrcClear = false
    canvases = []
    vi.stubGlobal('Image', FakeImage)
    const realCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
        if (tag === 'canvas') {
            const canvas = new FakeCanvas()
            canvases.push(canvas)
            return canvas as unknown as HTMLCanvasElement
        }
        return realCreateElement(tag)
    }) as typeof document.createElement)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('doLossyCompression', () => {
    test('L1: image error resolves with the original bytes and warns', async () => {
        const state = start()
        latestImage().fireError()
        await flushMicrotasks()
        expect(state.settled).toBe(true)
        expect(state.rejected).toBe(false)
        expect(Buffer.isBuffer(state.value)).toBe(true)
        expect([...state.value!]).toEqual([...input])
        expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    test('L2: a missing 2D context resolves with the original bytes and nothing escapes', async () => {
        const state = start()
        const image = latestImage()
        const nullContextCanvas = new FakeCanvas()
        nullContextCanvas.context = null
        vi.mocked(document.createElement).mockImplementationOnce((() => {
            canvases.push(nullContextCanvas)
            return nullContextCanvas as unknown as HTMLCanvasElement
        }) as typeof document.createElement)
        expect(() => image.fireLoad(100, 100)).not.toThrow()
        await flushMicrotasks()
        expect(state.settled).toBe(true)
        expect(state.rejected).toBe(false)
        expect([...state.value!]).toEqual([...input])
        expect(warnSpy).toHaveBeenCalledTimes(1)
        expect(nullContextCanvas.widthWrites.at(-1)).toBe(0)
        expect(nullContextCanvas.heightWrites.at(-1)).toBe(0)
    })

    test('L3: after success the canvas is zeroed, handlers detached and src cleared', async () => {
        const state = start()
        const image = latestImage()
        image.fireLoad(1536, 1024)
        await flushMicrotasks()
        expect(state.settled).toBe(true)
        const canvas = canvases[0]
        expect(canvas.widthWrites).toEqual([1536, 0])
        expect(canvas.heightWrites).toEqual([1024, 0])
        expect(image.onload).toBeNull()
        expect(image.onerror).toBeNull()
        expect(image.src).toBe('')
    })

    test('L4: success bytes, jpeg fallback, resize arguments and quality 75', async () => {
        const webp = start()
        latestImage().fireLoad(4000, 2000)
        await flushMicrotasks()
        const webpCanvas = canvases[0]
        expect(webpCanvas.widthWrites[0]).toBe(3000)
        expect(webpCanvas.heightWrites[0]).toBe(1500)
        expect(webpCanvas.drawArgs).toEqual([[0, 0, 3000, 1500]])
        expect(webpCanvas.toDataURLCalls).toEqual([['image/webp', 75]])
        expect(webp.value!.toString()).toBe('webp-bytes')
        expect(warnSpy).not.toHaveBeenCalled()

        const jpeg = start()
        const jpegCanvasIndex = canvases.length
        vi.mocked(document.createElement).mockImplementationOnce((() => {
            const canvas = new FakeCanvas()
            canvas.webpPayload = 'data:image/png;base64,' + Buffer.from('png-bytes').toString('base64')
            canvases.push(canvas)
            return canvas as unknown as HTMLCanvasElement
        }) as typeof document.createElement)
        latestImage().fireLoad(1000, 4000)
        await flushMicrotasks()
        const jpegCanvas = canvases[jpegCanvasIndex]
        expect(jpegCanvas.widthWrites[0]).toBe(750)
        expect(jpegCanvas.heightWrites[0]).toBe(3000)
        expect(jpegCanvas.toDataURLCalls).toEqual([
            ['image/webp', 75],
            ['image/jpeg', 75],
        ])
        expect(jpeg.value!.toString()).toBe('jpeg-bytes')
    })

    test('L5: a throw from toDataURL or drawImage resolves with the original bytes and releases', async () => {
        for (const failing of ['toDataURLThrows', 'drawThrows'] as const) {
            canvases = []
            vi.mocked(document.createElement).mockImplementationOnce((() => {
                const canvas = new FakeCanvas()
                canvas[failing] = true
                canvases.push(canvas)
                return canvas as unknown as HTMLCanvasElement
            }) as typeof document.createElement)
            const state = start()
            const image = latestImage()
            expect(() => image.fireLoad(800, 600)).not.toThrow()
            await flushMicrotasks()
            expect(state.settled).toBe(true)
            expect(state.rejected).toBe(false)
            expect([...state.value!]).toEqual([...input])
            expect(canvases[0].widthWrites.at(-1)).toBe(0)
            expect(canvases[0].heightWrites.at(-1)).toBe(0)
            expect(image.onload).toBeNull()
            expect(image.onerror).toBeNull()
            expect(image.src).toBe('')
        }
        expect(warnSpy).toHaveBeenCalledTimes(2)
    })

    test('L6: an error fired by clearing src does not change the compressed result', async () => {
        FakeImage.fireErrorOnSrcClear = true
        const state = start()
        latestImage().fireLoad(640, 480)
        await flushMicrotasks()
        expect(state.settled).toBe(true)
        expect(state.value!.toString()).toBe('webp-bytes')
        expect(warnSpy).not.toHaveBeenCalled()
    })

    test('settles once: a late error after success is ignored', async () => {
        const state = start()
        const image = latestImage()
        const onerror = image.onerror
        image.fireLoad(640, 480)
        await flushMicrotasks()
        onerror?.()
        await flushMicrotasks()
        expect(state.value!.toString()).toBe('webp-bytes')
        expect(warnSpy).not.toHaveBeenCalled()
    })
})
