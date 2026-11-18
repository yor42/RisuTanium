// @vitest-environment happy-dom

/**
 * The live card env on Android: the avatar and the body images go through the real admission gate, the real
 * size registry and the real app-wide whole-read queue. Only the transport, the platform flag and the image
 * encoder are replaced, so a pass says nothing about a real WebView, native asset read or canvas.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const transport = vi.hoisted(() => ({ android: true, sizes: {} as Record<string, number> }))
const encoder = vi.hoisted(() => ({ encodeAvatar: vi.fn() }))

vi.mock('./storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./storage/tauriByteTransport')>()),
    isAndroidTransport: () => transport.android,
    statStoredSize: async (key: string) => transport.sizes[key] ?? 0,
}))

vi.mock('./chatCardImage', () => ({
    encodeAvatar: (...args: unknown[]) => encoder.encodeAvatar(...args),
}))

vi.mock('./platform', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./platform')>()),
    isTauri: true,
}))

import { androidAssetSizeVerdict, androidWholeReadQueue, rememberWholeReadUrl, resetAssetUrlGateForTest } from './storage/assetUrlGate'
import { captureCardTheme, createCardCopyController, liveCardEnv, type CardInput, type CardReport } from './chatCard'
import type { EncodeAvatar } from './chatCard'

const MIB = 1024 * 1024
const theme = captureCardTheme(() => '')
const URL_OF = (key: string) => `http://asset.localhost/${key}`
const IMG = (n: number) => `data:image/jpeg;base64,IMG${n}`

/** What `getFileSrc` does on Android for a whole read: probe the size, register the URL. */
async function register(key: string, bytes: number): Promise<string> {
    transport.sizes[key] = bytes
    await androidAssetSizeVerdict(key)
    rememberWholeReadUrl(URL_OF(key), key)
    return URL_OF(key)
}

async function flush(): Promise<void> {
    for (let i = 0; i < 60; i++) {
        await Promise.resolve()
    }
}

interface Pending {
    settle: (index: number, value: string | null) => void
    sources: () => string[]
}

/** An encoder whose calls wait for `settle` and resolve null when their signal aborts, like the real one. */
function useEncoder(mode: 'numbered' | 'pending'): Pending {
    const resolvers: ((value: string | null) => void)[] = []
    const sources: string[] = []
    let n = 0
    encoder.encodeAvatar.mockImplementation(((src, { signal }) => {
        sources.push(src)
        if (mode === 'numbered') {
            return Promise.resolve(IMG(++n))
        }
        return new Promise<string | null>((resolve) => {
            resolvers.push(resolve)
            signal.addEventListener('abort', () => resolve(null), { once: true })
        })
    }) satisfies EncodeAvatar)
    return { settle: (index, value) => resolvers[index](value), sources: () => sources }
}

const realClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
let write: ReturnType<typeof vi.fn>

beforeEach(() => {
    transport.android = true
    transport.sizes = {}
    resetAssetUrlGateForTest()
    encoder.encodeAvatar.mockReset()
    write = vi.fn(async (items: ClipboardItem[]) => {
        for (const item of items) {
            for (const type of item.types) {
                await item.getType(type)
            }
        }
    })
    Object.defineProperty(navigator, 'clipboard', { value: { write, writeText: vi.fn(async () => {}) }, configurable: true })
})

afterEach(() => {
    resetAssetUrlGateForTest()
    if (realClipboard) {
        Object.defineProperty(navigator, 'clipboard', realClipboard)
    } else {
        Reflect.deleteProperty(navigator, 'clipboard')
    }
})

function start(over: Partial<CardInput>) {
    const controller = createCardCopyController(liveCardEnv)
    const reports: CardReport[] = []
    controller.start({
        owner: {},
        captureText: () => 'hello',
        captureCard: () => ({
            copyText: 'hello',
            displayName: 'Ann',
            badge: 'AI',
            avatarPath: '',
            theme,
            parseBody: async () => '<p>hello</p>',
            resolveAvatarSrc: async (path: string) => path,
            ...over,
        }),
        report: (report) => reports.push(report),
    })
    return { controller, kinds: () => reports.map((report) => report.kind) }
}

async function writtenHtml(): Promise<string> {
    const [items] = write.mock.calls[0]
    return await (await (items as ClipboardItem[])[0].getType('text/html')).text()
}

async function probeIsPending(): Promise<boolean> {
    let granted = false
    const probe = androidWholeReadQueue().acquire(64 * MIB)
    void probe.then((grant) => {
        granted = true
        grant.release()
    })
    await flush()
    return !granted
}

describe('the card avatar on Android', () => {
    test('an avatar registered above 15 MiB is never read, and the card says simple', async () => {
        useEncoder('numbered')
        const url = await register('assets/big', 20 * MIB)

        const run = start({ avatarPath: 'assets/big', resolveAvatarSrc: async () => url })
        await flush()

        expect(encoder.encodeAvatar).not.toHaveBeenCalled()
        expect(run.kinds()).toEqual(['loading', 'simple'])
    })

    test('an asset avatar the registry does not know is never read', async () => {
        useEncoder('numbered')

        const run = start({ avatarPath: 'assets/none', resolveAvatarSrc: async () => URL_OF('assets/none') })
        await flush()

        expect(encoder.encodeAvatar).not.toHaveBeenCalled()
        expect(run.kinds()).toEqual(['loading', 'simple'])
    })

    test('a 10 MiB avatar holds a grant of the queue until its read ends by supersede', async () => {
        const pending = useEncoder('pending')
        const url = await register('assets/mid', 10 * MIB)

        const run = start({ avatarPath: 'assets/mid', resolveAvatarSrc: async () => url })
        await flush()
        expect(pending.sources()).toEqual([url])
        expect(await probeIsPending()).toBe(true)

        run.controller.noteNewerPlainCopy('newer', () => {})
        await flush()

        expect(await probeIsPending()).toBe(false)
    })

    test('a 10 MiB avatar gives its grant back when its read ends normally', async () => {
        const pending = useEncoder('pending')
        const url = await register('assets/mid', 10 * MIB)

        const run = start({ avatarPath: 'assets/mid', resolveAvatarSrc: async () => url })
        await flush()
        expect(await probeIsPending()).toBe(true)

        pending.settle(0, IMG(1))
        await flush()

        expect(await probeIsPending()).toBe(false)
        expect(run.kinds()).toEqual(['loading', 'copied'])
    })
})

describe('the card body images on Android', () => {
    test('only the image whose registered size is known and within 15 MiB is read', async () => {
        const pending = useEncoder('numbered')
        const small = await register('assets/small', 1 * MIB)
        const big = await register('assets/big', 20 * MIB)
        const unknown = URL_OF('assets/unknown')

        const run = start({ parseBody: async () => `<p><img src="${small}"><img src="${big}"><img src="${unknown}"></p>` })
        await flush()

        expect(pending.sources()).toEqual([small])
        expect(await writtenHtml()).toContain(`src="${IMG(1)}"`)
        expect(run.kinds()).toEqual(['loading', 'simple'])
    })
})
