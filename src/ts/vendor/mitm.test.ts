/**
 * The helper page `public/streamsaver/mitm.html`: which service-worker registration it hands a download to.
 *
 * The page's script is extracted and run with a fake `window`, `navigator.serviceWorker`, `location` and `document`.
 * The fake container already holds a registration for `/`, as the application's own worker gives every page of the
 * origin; no browser and no worker is involved, so this shows the page's choice of registration only.
 *
 * Labels: (R) fails against the upstream page, which adopts any registration that covers its folder; (G) is a guard.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

const PAGE = resolve(process.cwd(), 'public/streamsaver/mitm.html')
const ORIGIN = 'https://app.example'

type FakeWorker = { postMessage: ReturnType<typeof vi.fn> }
type FakeRegistration = { scope: string, active: FakeWorker, installing?: null, waiting?: null }

function worker(): FakeWorker {
    return { postMessage: vi.fn() }
}

function registration(scope: string): FakeRegistration {
    return { scope, active: worker() }
}

function runPage(options: { existing: FakeRegistration | undefined, registered: FakeRegistration }) {
    const html = readFileSync(PAGE, 'utf8')
    const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]
    const fakeWindow: { opener: null, onmessage: ((event: unknown) => unknown) | null } = { opener: null, onmessage: null }
    const register = vi.fn(async (_url: string, _options: { scope: string }) => options.registered)
    const getRegistration = vi.fn(async (_scope: string) => options.existing)
    const fakeNavigator = { serviceWorker: { getRegistration, register } }
    const fakeLocation = { href: ORIGIN + '/streamsaver/mitm.html', search: '' }
    const fakeDocument = { referrer: '' }
    new Function('window', 'navigator', 'location', 'document', 'URLSearchParams', 'Headers', 'setInterval', 'fetch', 'console', script)(
        fakeWindow, fakeNavigator, fakeLocation, fakeDocument, URLSearchParams, Headers, () => 0, vi.fn(), { warn: () => { } },
    )
    return { fakeWindow, register, getRegistration }
}

async function settle() {
    for (let i = 0; i < 5; i++) {
        await new Promise<void>((resolveTick) => setImmediate(resolveTick))
    }
}

async function sendDownloadRequest(fakeWindow: { onmessage: ((event: unknown) => unknown) | null }) {
    const channel = new MessageChannel()
    fakeWindow.onmessage!({
        data: { pathname: '000001/out.bin', headers: { 'Content-Disposition': 'attachment' }, transferringReadable: true },
        ports: [channel.port2],
        origin: ORIGIN,
    })
    await settle()
    channel.port1.close()
}

describe('mitm.html', () => {
    test('(R) registers its own worker at its own folder and never posts to the application worker at /', async () => {
        const appRegistration = registration(ORIGIN + '/')
        const ownRegistration = registration(ORIGIN + '/streamsaver/')
        const { fakeWindow, register } = runPage({ existing: appRegistration, registered: ownRegistration })
        await settle()

        expect(register).toHaveBeenCalledTimes(1)
        expect(register).toHaveBeenCalledWith('sw.js', { scope: './' })

        await sendDownloadRequest(fakeWindow)

        expect(appRegistration.active.postMessage).not.toHaveBeenCalled()
        expect(ownRegistration.active.postMessage).toHaveBeenCalledTimes(1)
        const [data] = ownRegistration.active.postMessage.mock.calls[0] as [{ url: string }]
        expect(data.url).toBe(ORIGIN + '/streamsaver/app.example/000001/out.bin')
    })

    test('(G) reuses a registration whose scope is its own folder instead of registering again', async () => {
        const ownRegistration = registration(ORIGIN + '/streamsaver/')
        const { fakeWindow, register } = runPage({ existing: ownRegistration, registered: registration(ORIGIN + '/streamsaver/') })
        await settle()

        expect(register).not.toHaveBeenCalled()

        await sendDownloadRequest(fakeWindow)

        expect(ownRegistration.active.postMessage).toHaveBeenCalledTimes(1)
    })

    test('(G) registers its own worker when the container holds no registration', async () => {
        const ownRegistration = registration(ORIGIN + '/streamsaver/')
        const { fakeWindow, register } = runPage({ existing: undefined, registered: ownRegistration })
        await settle()

        expect(register).toHaveBeenCalledWith('sw.js', { scope: './' })

        await sendDownloadRequest(fakeWindow)

        expect(ownRegistration.active.postMessage).toHaveBeenCalledTimes(1)
    })
})
