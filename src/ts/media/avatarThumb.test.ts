// @vitest-environment happy-dom

/**
 * Tests for AV-4 (`avatarThumb.ts`), covering T1-T8, T11, T13, plus T3b,
 * T5d, T5e, T7b and T14 for the store-read/write race and cancellation
 * behaviour. T5e and T14 are regression guards: they hold regardless of that
 * race/cancellation hardening (timer-driven cleanup, and the
 * `isThumbEligible` body, respectively).
 *
 * The canvas is unavailable under vitest (confirmed directly:
 * `document.createElement('canvas').getContext('2d')` returns `null` under
 * happy-dom), so generation is injected through
 * `__avatarThumbTestHooks.setGenerator` for every test that does not
 * specifically target the real generator's pre-decode checks (T6's
 * `readImage` cases use `setReadImage` with the real generator instead,
 * since those checks run before any canvas call).
 *
 * MOCKED: `localforage` (inert; every test that cares about store behaviour
 * uses `setStore` to inject its own fake instead of relying on the
 * localforage-backed default), `src/ts/globalApi.svelte` (`readImage`), and
 * `src/ts/stores.svelte` (`DBState`, imported by `avatarThumb.ts` for
 * `startAvatarThumbSweep`, which none of these tests call, but the import
 * itself still runs the mocked module's top-level code at load time).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
            iterate: vi.fn(async () => {}),
        }),
    },
}))

const { readImageMock } = vi.hoisted(() => ({
    readImageMock: vi.fn(async (_loc: string) => undefined as Uint8Array | null | undefined),
}))

// A full stand-in, not a partial one: `avatarThumb.ts` only directly needs
// `readImage`, but it also imports `asBuffer` from `../util`, whose own
// module drags in `storage/database.svelte.ts`'s whole top-level surface
// (e.g. `saveImage`/`saveAsset`), so every export that module reads eagerly
// at load time must resolve here too.
vi.mock(
    import('../globalApi.svelte'),
    () =>
        ({
            readImage: readImageMock,
            getFileSrc: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
            checkCharOrder: vi.fn(),
            requiresFullEncoderReload: { state: false },
            AppendableBuffer: class {},
            VirtualWriter: class {},
            LocalWriter: class {},
            BlankWriter: class {},
            downloadFile: vi.fn(),
            openURL: vi.fn(),
            loadAsset: vi.fn(),
            saveAsset: vi.fn(),
            globalFetch: vi.fn(),
            aiWatermarkingLawApplies: vi.fn(() => false),
            changeChatTo: vi.fn(),
            hubURL: '',
            usingSw: false,
            getFetchLogs: vi.fn(() => []),
            getFetchData: vi.fn(() => ({})),
            aiLawApplies: vi.fn(() => false),
        }) as unknown as typeof import('../globalApi.svelte'),
)

// Likewise a full stand-in: `avatarThumb.ts` only reads `DBState.db` (inside
// `startAvatarThumbSweep`, which none of these tests call), but importing
// `../stores.svelte` still runs a background `$effect` in
// `parser.svelte.ts` (pulled in transitively through `../util`) that reads
// `selIdState` unconditionally.
vi.mock(
    import('../stores.svelte'),
    () =>
        ({
            DBState: { db: { characters: [], characterOrder: [] } },
            selIdState: { state: -1 },
        }) as unknown as typeof import('../stores.svelte'),
)

import {
    __avatarThumbTestHooks,
    THUMB_VERSION,
    buildThumbKeepSet,
    classifyImage,
    getAvatarThumbSrc,
    isAnimatedImage,
    isThumbEligible,
    sweepAvatarThumbs,
    thumbDimensions,
} from './avatarThumb'
import type { Database, folder } from '../storage/database.svelte'
import { getImageType } from './imageType'

//#region test store helpers

interface FakeStore {
    getItem: ReturnType<typeof vi.fn>
    setItem: ReturnType<typeof vi.fn>
    removeItem: ReturnType<typeof vi.fn>
    iterate: ReturnType<typeof vi.fn>
}

/** Every `getItem` resolves `null` (a permanent miss); `setItem`/`removeItem`
 *  are no-op spies. Used by tests that only care about generation dynamics,
 *  not store persistence. */
function makeMissStore(): FakeStore {
    return {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
        removeItem: vi.fn(async () => {}),
        iterate: vi.fn(async () => {}),
    }
}

/** A real in-memory backing map, so a value persisted by `setItem` is later
 *  visible to `getItem`/`iterate` -- needed for T7, T8 and T11, which all
 *  assert on round-tripped state, not just call counts. */
function makeMemoryStore(initial: Record<string, unknown> = {}): FakeStore {
    const map = new Map<string, unknown>(Object.entries(initial))
    return {
        getItem: vi.fn(async (key: string) => map.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: unknown) => {
            map.set(key, value)
        }),
        removeItem: vi.fn(async (key: string) => {
            map.delete(key)
        }),
        iterate: vi.fn(async (cb: (value: unknown, key: string) => void) => {
            for (const [key, value] of map.entries()) {
                cb(value, key)
            }
        }),
    }
}

//#endregion

beforeEach(() => {
    __avatarThumbTestHooks.reset()
    readImageMock.mockReset()
    readImageMock.mockResolvedValue(undefined)
    // happy-dom's canvas.getContext('2d') returns null (confirmed directly),
    // so the real readback check would always fail here and every miss would
    // short-circuit to null before ever reaching a test's own generator.
    // Tests that specifically target the guard itself (T13) override this.
    __avatarThumbTestHooks.setReadbackCheck(() => true)
})

afterEach(() => {
    __avatarThumbTestHooks.reset()
    vi.useRealTimers()
})

describe('T1: isAnimatedImage', () => {
    function u8(bytes: number[]): Uint8Array {
        return new Uint8Array(bytes)
    }

    function ascii(s: string): number[] {
        return Array.from(s).map((c) => c.charCodeAt(0))
    }

    function u32be(n: number): number[] {
        return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
    }

    function pngChunk(type: string, dataLen: number): number[] {
        return [...u32be(dataLen), ...ascii(type), ...new Array(dataLen).fill(0), 0, 0, 0, 0]
    }

    const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

    test('GIF87a and GIF89a are animated', () => {
        expect(isAnimatedImage(u8([...ascii('GIF87a'), 0, 0]))).toBe(true)
        expect(isAnimatedImage(u8([...ascii('GIF89a'), 0, 0]))).toBe(true)
    })

    test('a static PNG (IHDR, IDAT, IEND, no acTL) is not animated', () => {
        const bytes = u8([...PNG_SIG, ...pngChunk('IHDR', 13), ...pngChunk('IDAT', 4), ...pngChunk('IEND', 0)])
        expect(isAnimatedImage(bytes)).toBe(false)
    })

    test('APNG with acTL before the first IDAT is animated', () => {
        const bytes = u8([...PNG_SIG, ...pngChunk('IHDR', 13), ...pngChunk('acTL', 8), ...pngChunk('IDAT', 4), ...pngChunk('IEND', 0)])
        expect(isAnimatedImage(bytes)).toBe(true)
    })

    test('acTL occurring after the first IDAT does not count as animated', () => {
        const bytes = u8([...PNG_SIG, ...pngChunk('IHDR', 13), ...pngChunk('IDAT', 4), ...pngChunk('acTL', 8), ...pngChunk('IEND', 0)])
        expect(isAnimatedImage(bytes)).toBe(false)
    })

    test('a truncated/overrunning PNG chunk length is treated as not animated, without throwing', () => {
        // IHDR declares a data length far larger than the bytes actually
        // present after it.
        const bytes = u8([...PNG_SIG, ...u32be(9000), ...ascii('IHDR'), 1, 2, 3, 4])
        expect(() => isAnimatedImage(bytes)).not.toThrow()
        expect(isAnimatedImage(bytes)).toBe(false)
    })

    function riffWebp(fourCcAtOffset12: string, rest: number[]): number[] {
        const body = [...ascii(fourCcAtOffset12), ...rest]
        return [...ascii('RIFF'), ...u32be(4 + body.length), ...ascii('WEBP'), ...body]
    }

    test('simple lossy (VP8 ) and lossless (VP8L) WebP are not animated', () => {
        expect(isAnimatedImage(u8(riffWebp('VP8 ', [0, 0, 0, 0, 0, 0, 0, 0])))).toBe(false)
        expect(isAnimatedImage(u8(riffWebp('VP8L', [0, 0, 0, 0, 0, 0, 0, 0])))).toBe(false)
    })

    test('VP8X with the animation flag (bit 0x02) set is animated', () => {
        // VP8X body: chunk size (4 bytes) then a flags byte with 0x02 set.
        const bytes = u8(riffWebp('VP8X', [...u32be(10), 0x02, 0, 0, 0, 0, 0, 0, 0, 0]))
        expect(isAnimatedImage(bytes)).toBe(true)
    })

    test('VP8X without the animation flag is not animated', () => {
        const bytes = u8(riffWebp('VP8X', [...u32be(10), 0x00, 0, 0, 0, 0, 0, 0, 0, 0]))
        expect(isAnimatedImage(bytes)).toBe(false)
    })

    function isobmff(majorBrand: string, compatibleBrands: string[]): number[] {
        const body = [...ascii(majorBrand), ...u32be(0), ...compatibleBrands.flatMap(ascii)]
        const box = [...ascii('ftyp'), ...body]
        return [...u32be(8 + box.length), ...box]
    }

    test("AVIF with major brand 'avif' (no avis anywhere) is not animated", () => {
        expect(isAnimatedImage(u8(isobmff('avif', ['mif1', 'miaf'])))).toBe(false)
    })

    test("'avis' as the major brand is animated", () => {
        expect(isAnimatedImage(u8(isobmff('avis', [])))).toBe(true)
    })

    test("'avis' as a compatible brand (major brand is something else) is animated", () => {
        expect(isAnimatedImage(u8(isobmff('avif', ['isom', 'avis'])))).toBe(true)
    })

    test('JPEG is not animated', () => {
        const bytes = u8([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])
        expect(isAnimatedImage(bytes)).toBe(false)
    })
})

describe('T2: thumbDimensions', () => {
    test('832x1216 (baseline NovelAI portrait) -> 168x246', () => {
        expect(thumbDimensions(832, 1216, 168)).toEqual({ w: 168, h: 246 })
    })

    test('1216x832 (rotated baseline) -> 246x168', () => {
        expect(thumbDimensions(1216, 832, 168)).toEqual({ w: 246, h: 168 })
    })

    test('168x300: short side already at the threshold -> null', () => {
        expect(thumbDimensions(168, 300, 168)).toBeNull()
    })

    test('100x100: short side under the threshold -> null', () => {
        expect(thumbDimensions(100, 100, 168)).toBeNull()
    })

    test('1x5000: short side (1) under the threshold -> null', () => {
        expect(thumbDimensions(1, 5000, 168)).toBeNull()
    })

    test('5000x200 -> 4200x168', () => {
        expect(thumbDimensions(5000, 200, 168)).toEqual({ w: 4200, h: 168 })
    })
})

describe('T3: store lookup semantics', () => {
    test('a store hit returns src without calling the generator', async () => {
        const generator = vi.fn(async () => ({ src: 'should-not-be-used' }))
        __avatarThumbTestHooks.setGenerator(generator)
        __avatarThumbTestHooks.setStore(makeMemoryStore({ 'assets/a.png': { v: THUMB_VERSION, src: 'stored-src' } }) as never)

        const result = await getAvatarThumbSrc('assets/a.png')
        expect(result).toBe('stored-src')
        expect(generator).not.toHaveBeenCalled()
    })

    test('a skip record returns null without calling the generator', async () => {
        const generator = vi.fn(async () => ({ src: 'should-not-be-used' }))
        __avatarThumbTestHooks.setGenerator(generator)
        __avatarThumbTestHooks.setStore(makeMemoryStore({ 'assets/a.png': { v: THUMB_VERSION, skip: true } }) as never)

        const result = await getAvatarThumbSrc('assets/a.png')
        expect(result).toBeNull()
        expect(generator).not.toHaveBeenCalled()
    })

    test('a record with a stale v counts as absent and regenerates', async () => {
        const generator = vi.fn(async () => ({ src: 'freshly-generated' }))
        __avatarThumbTestHooks.setGenerator(generator)
        const store = makeMemoryStore({ 'assets/a.png': { v: THUMB_VERSION - 1, src: 'stale-src' } })
        __avatarThumbTestHooks.setStore(store as never)

        const result = await getAvatarThumbSrc('assets/a.png')
        expect(result).toBe('freshly-generated')
        expect(generator).toHaveBeenCalledTimes(1)
        expect(store.setItem).toHaveBeenCalledWith('assets/a.png', { v: THUMB_VERSION, src: 'freshly-generated' })
    })

    test('a store getItem that throws resolves null, not a rejection, and does not attempt generation this call', async () => {
        const generator = vi.fn(async () => ({ src: 'should-not-be-used' }))
        __avatarThumbTestHooks.setGenerator(generator)
        __avatarThumbTestHooks.setStore({
            getItem: vi.fn(async () => {
                throw new Error('broken store')
            }),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
            iterate: vi.fn(async () => {}),
        } as never)

        await expect(getAvatarThumbSrc('assets/a.png')).resolves.toBeNull()
        expect(generator).not.toHaveBeenCalled()
    })
})

describe('T4: in-flight dedupe', () => {
    test('two concurrent calls for the same loc share one generation; a different loc gets its own', async () => {
        __avatarThumbTestHooks.setStore(makeMissStore() as never)
        const calls: string[] = []
        __avatarThumbTestHooks.setGenerator(async (loc) => {
            calls.push(loc)
            return { src: `src-for-${loc}` }
        })

        const [a1, a2, b1] = await Promise.all([
            getAvatarThumbSrc('assets/a.png'),
            getAvatarThumbSrc('assets/a.png'),
            getAvatarThumbSrc('assets/b.png'),
        ])

        expect(a1).toBe('src-for-assets/a.png')
        expect(a2).toBe('src-for-assets/a.png')
        expect(b1).toBe('src-for-assets/b.png')
        expect(calls.filter((l) => l === 'assets/a.png').length).toBe(1)
        expect(calls.filter((l) => l === 'assets/b.png').length).toBe(1)
    })
})

/** Flushes several microtask turns: releasing a task's generator promise
 *  resumes `runTask` only after its own `await persistRecord(...)` (itself
 *  an `await store.setItem(...)`, now raced through `withStoreTimeout`, which
 *  wraps it in another promise) also resolves -- more than one microtask hop
 *  deep, and the store-read race on the way in adds a further hop before
 *  generation even starts. A fixed, generous count is simpler and just as
 *  fast as counting hops exactly. */
async function flushMicrotasks(turns = 10): Promise<void> {
    for (let i = 0; i < turns; i++) {
        await Promise.resolve()
    }
}

describe('T5: concurrency is capped at 2', () => {
    test('five distinct locs never run more than 2 generators at once', async () => {
        __avatarThumbTestHooks.setStore(makeMissStore() as never)
        let running = 0
        let maxRunning = 0
        const releases = new Map<string, () => void>()
        __avatarThumbTestHooks.setGenerator(
            (loc) =>
                new Promise((resolve) => {
                    running++
                    maxRunning = Math.max(maxRunning, running)
                    releases.set(loc, () => {
                        running--
                        resolve({ src: `src-for-${loc}` })
                    })
                }),
        )

        const locs = ['a', 'b', 'c', 'd', 'e'].map((l) => `assets/${l}.png`)
        const promises = locs.map((loc) => getAvatarThumbSrc(loc))

        // Let every microtask that can run without a release actually run,
        // including the store-read race each call goes through before it
        // ever reaches the generator.
        await flushMicrotasks()
        expect(__avatarThumbTestHooks.stats().running).toBe(2)
        expect(maxRunning).toBe(2)

        // Drain the queue, releasing one at a time; running must never exceed 2.
        for (let i = 0; i < locs.length; i++) {
            const anyRelease = Array.from(releases.values())[0]
            releases.delete(Array.from(releases.keys())[0])
            anyRelease()
            await flushMicrotasks()
            expect(__avatarThumbTestHooks.stats().running).toBeLessThanOrEqual(2)
        }

        const results = await Promise.all(promises)
        expect(new Set(results)).toEqual(new Set(locs.map((l) => `src-for-${l}`)))
        expect(maxRunning).toBe(2)
    })
})

describe('T5b: per-task timeout frees the slot; a late result is discarded (fake timers)', () => {
    test('two hung generators time out and unblock a third; the late resolution is neither stored nor memoized', async () => {
        vi.useFakeTimers()
        // A real backing store (not just a miss stub) so a wrongly-persisted
        // late write would actually be observable via `setItem`'s call log.
        const store = makeMemoryStore()
        __avatarThumbTestHooks.setStore(store as never)
        __avatarThumbTestHooks.setLimits({ timeoutMs: 1000 })

        const genCallCounts = new Map<string, number>()
        let releaseLateA: ((v: { src: string }) => void) | null = null
        __avatarThumbTestHooks.setGenerator(
            (loc) =>
                new Promise((resolve) => {
                    genCallCounts.set(loc, (genCallCounts.get(loc) ?? 0) + 1)
                    if (loc === 'assets/a.png' && !releaseLateA) {
                        // First call for A: never resolves until the test does
                        // it explicitly, after the timeout has already fired.
                        releaseLateA = resolve
                        return
                    }
                    if (loc === 'assets/b.png') {
                        // B never resolves at all in this test.
                        return
                    }
                    resolve({ src: `src-for-${loc}` })
                }),
        )

        const pA = getAvatarThumbSrc('assets/a.png')
        const pB = getAvatarThumbSrc('assets/b.png')
        const pC = getAvatarThumbSrc('assets/c.png')

        // Each call first races a store read (`withStoreTimeout`) before it
        // can even reach the generator, so wait out that whole chain rather
        // than a fixed, easy-to-outdate number of raw microtask hops.
        await flushMicrotasks()
        // A and B occupy both slots; C is queued behind them.
        expect(__avatarThumbTestHooks.stats().running).toBe(2)
        expect(__avatarThumbTestHooks.stats().queued).toBe(1)

        await vi.advanceTimersByTimeAsync(1000)

        expect(await pA).toBeNull()
        expect(await pB).toBeNull()
        expect(await pC).toBe('src-for-assets/c.png')

        // The late resolution for A arrives after its own timeout already
        // freed the slot and resolved the caller with null.
        expect(releaseLateA).not.toBeNull()
        releaseLateA!({ src: 'late-should-be-discarded' })
        await flushMicrotasks()

        // Discarded: neither stored nor memoized, so a fresh request for A
        // retries (a second generator call), not served the late value.
        expect(__avatarThumbTestHooks.stats().memoEntries).toBe(1) // only C
        // The late, discarded result must never reach `setItem`, under any
        // key -- not just "not stored under its own loc".
        expect(store.setItem).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ src: 'late-should-be-discarded' }),
        )

        const secondA = await getAvatarThumbSrc('assets/a.png')
        expect(secondA).not.toBe('late-should-be-discarded')
        // Exactly two calls for A: the first (timed out, still pending when
        // released above) and this retry's fresh one. `runTask` never calls
        // the generator a third time for the same in-flight task.
        expect(genCallCounts.get('assets/a.png')).toBe(2)
    })
})

describe('T5c: the queue serves the most recently queued loc first (LIFO)', () => {
    test('with both slots busy, a later-queued loc starts before an earlier-queued one once a slot frees', async () => {
        __avatarThumbTestHooks.setStore(makeMissStore() as never)
        const startOrder: string[] = []
        const releases = new Map<string, () => void>()
        __avatarThumbTestHooks.setGenerator(
            (loc) =>
                new Promise((resolve) => {
                    startOrder.push(loc)
                    releases.set(loc, () => resolve({ src: `src-for-${loc}` }))
                }),
        )

        // A and B start immediately (concurrency 2, queue was empty when
        // pushed).
        const pA = getAvatarThumbSrc('assets/A.png')
        const pB = getAvatarThumbSrc('assets/B.png')
        await flushMicrotasks()
        expect(startOrder).toEqual(['assets/A.png', 'assets/B.png'])

        // C then D are queued while both slots are busy.
        const pC = getAvatarThumbSrc('assets/C.png')
        const pD = getAvatarThumbSrc('assets/D.png')
        await flushMicrotasks()
        expect(startOrder).toEqual(['assets/A.png', 'assets/B.png']) // neither started yet

        // Freeing A's slot must start D (the most recently queued), not C.
        releases.get('assets/A.png')!()
        await flushMicrotasks()
        expect(startOrder).toEqual(['assets/A.png', 'assets/B.png', 'assets/D.png'])

        // Freeing B's slot starts the only one left, C.
        releases.get('assets/B.png')!()
        await flushMicrotasks()
        expect(startOrder).toEqual(['assets/A.png', 'assets/B.png', 'assets/D.png', 'assets/C.png'])

        releases.get('assets/D.png')!()
        releases.get('assets/C.png')!()
        await Promise.all([pA, pB, pC, pD])
    })
})

describe('T6: generator and readImage failures are neither stored nor memoized', () => {
    test('a generator failure resolves null; a second call retries', async () => {
        __avatarThumbTestHooks.setStore(makeMissStore() as never)
        let calls = 0
        __avatarThumbTestHooks.setGenerator(async () => {
            calls++
            if (calls === 1) {
                throw new Error('boom')
            }
            return { src: 'ok-on-retry' }
        })

        const first = await getAvatarThumbSrc('assets/a.png')
        expect(first).toBeNull()
        expect(__avatarThumbTestHooks.stats().memoEntries).toBe(0)

        const second = await getAvatarThumbSrc('assets/a.png')
        expect(second).toBe('ok-on-retry')
        expect(calls).toBe(2)
    })

    test.each([
        ['null', null],
        ['empty', new Uint8Array(0)],
        ['11 bytes (under the 12-byte floor)', new Uint8Array(11)],
    ])('readImage returning %s -> null, with no skip record persisted', async (_label, bytes) => {
        const store = makeMemoryStore()
        __avatarThumbTestHooks.setStore(store as never)
        // The pre-decode checks run before any canvas call, so the real
        // generator is safe to exercise here.
        __avatarThumbTestHooks.setReadbackCheck(() => true)
        __avatarThumbTestHooks.setReadImage(async () => bytes as never)

        const result = await getAvatarThumbSrc('assets/a.png')
        expect(result).toBeNull()
        expect(store.setItem).not.toHaveBeenCalled()
        expect(__avatarThumbTestHooks.stats().memoEntries).toBe(0)
    })
})

describe('T7: a store setItem failure still returns the generated src', () => {
    test('setItem rejects; getAvatarThumbSrc still resolves the freshly generated value', async () => {
        __avatarThumbTestHooks.setGenerator(async () => ({ src: 'generated-despite-store-failure' }))
        __avatarThumbTestHooks.setStore({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {
                throw new Error('quota exceeded')
            }),
            removeItem: vi.fn(async () => {}),
            iterate: vi.fn(async () => {}),
        } as never)

        const result = await getAvatarThumbSrc('assets/a.png')
        expect(result).toBe('generated-despite-store-failure')
        // Still memoized even though persistence failed.
        expect(__avatarThumbTestHooks.stats().memoEntries).toBe(1)
    })
})

describe('T8: memo LRU eviction', () => {
    test('the count cap evicts the oldest entry, which is then re-read from the store, not regenerated', async () => {
        const store = makeMemoryStore()
        __avatarThumbTestHooks.setStore(store as never)
        __avatarThumbTestHooks.setLimits({ memoMaxEntries: 2 })
        const calls: string[] = []
        __avatarThumbTestHooks.setGenerator(async (loc) => {
            calls.push(loc)
            return { src: `src-for-${loc}` }
        })

        await getAvatarThumbSrc('assets/a.png')
        await getAvatarThumbSrc('assets/b.png')
        await getAvatarThumbSrc('assets/c.png') // evicts 'a' (oldest) from the memo

        expect(__avatarThumbTestHooks.stats().memoEntries).toBe(2)

        const again = await getAvatarThumbSrc('assets/a.png')
        expect(again).toBe('src-for-assets/a.png')
        // Re-read from the store's persisted record, not regenerated.
        expect(calls.filter((l) => l === 'assets/a.png').length).toBe(1)
    })

    test('the byte cap evicts the oldest entry once the total string length is exceeded', async () => {
        const store = makeMemoryStore()
        __avatarThumbTestHooks.setStore(store as never)
        // Small enough that two 5-character srcs exceed it, but one does not.
        __avatarThumbTestHooks.setLimits({ memoMaxEntries: 1000, memoMaxBytes: 8 })
        const calls: string[] = []
        __avatarThumbTestHooks.setGenerator(async (loc) => {
            calls.push(loc)
            return { src: 'ABCDE' } // length 5
        })

        await getAvatarThumbSrc('assets/a.png')
        expect(__avatarThumbTestHooks.stats().memoBytes).toBe(5)
        await getAvatarThumbSrc('assets/b.png') // 5 + 5 = 10 > 8: evicts 'a'
        expect(__avatarThumbTestHooks.stats().memoEntries).toBe(1)
        expect(__avatarThumbTestHooks.stats().memoBytes).toBe(5)

        const again = await getAvatarThumbSrc('assets/a.png')
        expect(again).toBe('ABCDE')
        expect(calls.filter((l) => l === 'assets/a.png').length).toBe(1)
    })
})

describe('T11: sweepAvatarThumbs and buildThumbKeepSet', () => {
    test('keeps full-loc keys in `keep`; deletes unreferenced and stale-v records; a basename match under a different path is deleted', async () => {
        const keep = new Set(['assets/kept1.png', 'assets/kept2.png'])
        const store = makeMemoryStore({
            'assets/kept1.png': { v: THUMB_VERSION, src: 'x' },
            // In `keep`, but a stale version: deleted regardless of membership.
            'assets/kept2.png': { v: THUMB_VERSION - 1, src: 'y' },
            // Same basename as a kept asset, but a different full path: the
            // sweep matches on the full loc, not the basename, so this is
            // deleted -- stricter than cleanChunks's basename-based keep-set.
            'other/assets/kept2.png': { v: THUMB_VERSION, src: 'z' },
            // Not referenced anywhere in `keep`.
            'assets/orphan.png': { v: THUMB_VERSION, src: 'w' },
        })
        __avatarThumbTestHooks.setStore(store as never)

        await sweepAvatarThumbs(keep)

        expect(store.removeItem).toHaveBeenCalledWith('assets/kept2.png')
        expect(store.removeItem).toHaveBeenCalledWith('other/assets/kept2.png')
        expect(store.removeItem).toHaveBeenCalledWith('assets/orphan.png')
        expect(store.removeItem).not.toHaveBeenCalledWith('assets/kept1.png')
    })

    test('a throwing store does not throw out of the sweep', async () => {
        __avatarThumbTestHooks.setStore({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
            iterate: vi.fn(async () => {
                throw new Error('iterate broke')
            }),
        } as never)

        await expect(sweepAvatarThumbs(new Set())).resolves.toBeUndefined()
    })

    function makeCharacter(image: string | undefined, trashTime?: number) {
        return { image, trashTime } as unknown as Database['characters'][number]
    }

    test('buildThumbKeepSet includes character images (including trashed), and folder images from characterOrder', () => {
        const db = {
            characters: [
                makeCharacter('assets/a.png'),
                makeCharacter('assets/trashed.png', 1_700_000_000_000),
                makeCharacter(undefined),
            ],
            characterOrder: [
                'not-a-folder-id',
                { id: 'folder1', name: 'F', color: '', data: [], imgFile: 'assets/folder.png' } as folder,
                { id: 'folder2', name: 'F2', color: '', data: [] } as folder, // no imgFile
            ],
        } as unknown as Database

        const keep = buildThumbKeepSet(db)
        expect(keep.has('assets/a.png')).toBe(true)
        expect(keep.has('assets/trashed.png')).toBe(true)
        expect(keep.has('assets/folder.png')).toBe(true)
        expect(keep.size).toBe(3)
    })

    test('buildThumbKeepSet on an empty/missing db returns an empty set without throwing', () => {
        expect(() => buildThumbKeepSet({} as unknown as Database)).not.toThrow()
        expect(buildThumbKeepSet({} as unknown as Database).size).toBe(0)
    })
})

describe('T13: the canvas readback guard', () => {
    test('a mismatching check turns generation off for the session; stored hits are still served', async () => {
        __avatarThumbTestHooks.setReadbackCheck(() => false)
        const generator = vi.fn(async () => ({ src: 'should-not-be-generated' }))
        __avatarThumbTestHooks.setGenerator(generator)
        __avatarThumbTestHooks.setStore(
            makeMemoryStore({ 'assets/stored.png': { v: THUMB_VERSION, src: 'already-stored' } }) as never,
        )

        // A store hit is served regardless of the readback guard: the guard
        // is only consulted on a miss, before generation.
        expect(await getAvatarThumbSrc('assets/stored.png')).toBe('already-stored')
        expect(generator).not.toHaveBeenCalled()

        // A miss with generation turned off resolves null without ever
        // calling the generator.
        expect(await getAvatarThumbSrc('assets/miss.png')).toBeNull()
        expect(generator).not.toHaveBeenCalled()
    })

    test('a matching check leaves generation on', async () => {
        __avatarThumbTestHooks.setReadbackCheck(() => true)
        __avatarThumbTestHooks.setStore(makeMissStore() as never)
        const generator = vi.fn(async () => ({ src: 'generated-normally' }))
        __avatarThumbTestHooks.setGenerator(generator)

        expect(await getAvatarThumbSrc('assets/miss.png')).toBe('generated-normally')
        expect(generator).toHaveBeenCalledTimes(1)
    })
})

//#region store-read/write race and cancellation (T3b, T5d, T5e, T7b, T14)
// Everything below targets the store-read/write race and cancellation
// plumbing (`isCancelled`/`setCleanup`/`withStoreTimeout`) in
// `avatarThumb.ts`: a store read/write with a timeout, and a `realGenerate`
// with a post-read cancellation check. T5e and T14 are regression guards
// instead: the timer-driven cleanup they exercise and the `isThumbEligible`
// body are unrelated to that hardening.

describe('T3b: a store read that never settles is treated as a miss once storeTimeoutMs elapses (fake timers)', () => {
    test('generation still runs and resolves, instead of hanging on a dead getItem', async () => {
        vi.useFakeTimers()
        __avatarThumbTestHooks.setLimits({ storeTimeoutMs: 100 })
        __avatarThumbTestHooks.setStore({
            getItem: vi.fn(() => new Promise(() => {})), // never settles
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
            iterate: vi.fn(async () => {}),
        } as never)
        const generator = vi.fn(async () => ({ src: 'generated-after-store-read-timeout' }))
        __avatarThumbTestHooks.setGenerator(generator)

        const promise = getAvatarThumbSrc('assets/a.png')
        await flushMicrotasks()
        expect(generator).not.toHaveBeenCalled() // still waiting on the read race

        await vi.advanceTimersByTimeAsync(100)
        expect(await promise).toBe('generated-after-store-read-timeout')
        expect(generator).toHaveBeenCalledTimes(1)
    })

    test('with generation off (readback guard failed), the same hung read resolves null instead of hanging', async () => {
        vi.useFakeTimers()
        __avatarThumbTestHooks.setLimits({ storeTimeoutMs: 100 })
        __avatarThumbTestHooks.setReadbackCheck(() => false)
        __avatarThumbTestHooks.setStore({
            getItem: vi.fn(() => new Promise(() => {})), // never settles
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
            iterate: vi.fn(async () => {}),
        } as never)
        const generator = vi.fn(async () => ({ src: 'should-not-be-called' }))
        __avatarThumbTestHooks.setGenerator(generator)

        const promise = getAvatarThumbSrc('assets/a.png')
        await vi.advanceTimersByTimeAsync(100)
        expect(await promise).toBeNull()
        expect(generator).not.toHaveBeenCalled()
    })
})

describe('T5d: a cancelled real-generator task never reaches the canvas/createObjectURL, even once its read resolves later (fake timers)', () => {
    test('the caller gets null at timeout; a later-resolving valid PNG read is then dropped without creating a blob URL or persisting anything', async () => {
        vi.useFakeTimers()
        __avatarThumbTestHooks.setReadbackCheck(() => true)
        __avatarThumbTestHooks.setLimits({ timeoutMs: 50 })
        const store = makeMemoryStore()
        __avatarThumbTestHooks.setStore(store as never)

        let resolveRead: ((bytes: Uint8Array) => void) | null = null
        __avatarThumbTestHooks.setReadImage(() => new Promise((resolve) => {
            resolveRead = resolve
        }))

        // Manual monkey-patch rather than `vi.spyOn`: happy-dom defines
        // `createObjectURL` several prototypes up from the `URL` constructor
        // itself, not as `URL`'s own property, which `vi.spyOn` requires.
        const originalCreateObjectURL = URL.createObjectURL
        const createObjectURLSpy = vi.fn(originalCreateObjectURL)
        URL.createObjectURL = createObjectURLSpy as typeof URL.createObjectURL

        try {
            const promise = getAvatarThumbSrc('assets/a.png')
            await flushMicrotasks()

            await vi.advanceTimersByTimeAsync(50)
            expect(await promise).toBeNull()
            expect(resolveRead).not.toBeNull()

            // PNG signature (8 bytes) + 4 more: >= the 12-byte floor, and
            // `classifyImage` calls this a still (`isApng` finds no room left
            // for any chunk after the signature, so it bails out without ever
            // finding an `acTL`).
            const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
            resolveRead!(pngBytes)
            await flushMicrotasks()

            expect(createObjectURLSpy).not.toHaveBeenCalled()
            expect(store.setItem).not.toHaveBeenCalled()
        } finally {
            URL.createObjectURL = originalCreateObjectURL
        }
    })
})

describe("T5e: a per-task timeout runs the real generator's cleanup immediately, without waiting for a hung decode (fake timers)", () => {
    // `GenContext.setCleanup` can run a registered cleanup two ways: (1) the
    // timer's own handler calls the already-registered `cleanupFn` directly
    // when it fires, or (2) if `setCleanup` itself is called after the timer
    // already fired, it invokes `fn` immediately instead of storing it.
    // `realGenerate` registers its single cleanup before its first `await`,
    // so only (1) is reachable through it; (2) is the late registration that
    // a generator which awaits first would hit. This test exercises (1): a
    // decode left hanging past `timeoutMs` has its blob URL revoked and its
    // `<img>` unloaded right away, from the timer's own handler, not only
    // if/when the hung `decode()` eventually settles on its own.
    test('a hung decode has its blob URL revoked exactly at timeout, before decode ever settles', async () => {
        vi.useFakeTimers()
        __avatarThumbTestHooks.setReadbackCheck(() => true)
        __avatarThumbTestHooks.setLimits({ timeoutMs: 50 })
        __avatarThumbTestHooks.setStore(makeMissStore() as never)
        __avatarThumbTestHooks.setReadImage(
            async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
        )

        const originalRevokeObjectURL = URL.revokeObjectURL
        const revokeObjectURLSpy = vi.fn(originalRevokeObjectURL)
        URL.revokeObjectURL = revokeObjectURLSpy as typeof URL.revokeObjectURL
        // A real `HTMLImageElement.decode()` resolves immediately under
        // happy-dom regardless of `src` (confirmed directly), so it must be
        // stubbed to hang here -- otherwise the timeout would never have
        // anything left to cancel.
        const decodeSpy = vi.spyOn(HTMLImageElement.prototype, 'decode').mockReturnValue(new Promise(() => {}))

        try {
            const promise = getAvatarThumbSrc('assets/a.png')
            await flushMicrotasks()
            expect(revokeObjectURLSpy).not.toHaveBeenCalled()

            await vi.advanceTimersByTimeAsync(50)
            expect(await promise).toBeNull()
            expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1)
        } finally {
            decodeSpy.mockRestore()
            URL.revokeObjectURL = originalRevokeObjectURL
        }
    })
})

describe('T7b: a store write that never settles still frees the task slot once storeTimeoutMs elapses (fake timers)', () => {
    test('the generated src is returned, and a queued second loc starts once the slot frees', async () => {
        vi.useFakeTimers()
        __avatarThumbTestHooks.setLimits({ concurrency: 1, storeTimeoutMs: 100 })
        __avatarThumbTestHooks.setStore({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(() => new Promise(() => {})), // never settles
            removeItem: vi.fn(async () => {}),
            iterate: vi.fn(async () => {}),
        } as never)

        const generatorCalls: string[] = []
        __avatarThumbTestHooks.setGenerator(async (loc) => {
            generatorCalls.push(loc)
            return { src: `src-for-${loc}` }
        })

        const pA = getAvatarThumbSrc('assets/a.png')
        const pB = getAvatarThumbSrc('assets/b.png')
        await flushMicrotasks()

        // concurrency 1: only A has started; B is queued behind it.
        expect(generatorCalls).toEqual(['assets/a.png'])

        // A's generation finished; its write to the store hangs. The
        // concurrency slot must still free once storeTimeoutMs elapses,
        // rather than staying held for a write that never settles.
        await vi.advanceTimersByTimeAsync(100)
        expect(await pA).toBe('src-for-assets/a.png')
        expect(generatorCalls).toEqual(['assets/a.png', 'assets/b.png'])

        // B's own write also hangs; let it time out too so no promise is
        // left pending when the test ends.
        await vi.advanceTimersByTimeAsync(100)
        expect(await pB).toBe('src-for-assets/b.png')
    })
})

describe('T14: isThumbEligible (real predicate)', () => {
    test('an assets/ loc is eligible', () => {
        expect(isThumbEligible('assets/x.png')).toBe(true)
    })

    test.each([
        ['a remote http(s) URL', 'http://example.com/x.png'],
        ['a data: URL', 'data:image/png;base64,AAAA'],
        ['an empty string', ''],
        ["a loc that only starts with the bare word 'assets' (no '/')", 'assetsX/x.png'],
    ])('%s -> not eligible', (_label, loc) => {
        expect(isThumbEligible(loc)).toBe(false)
    })
})

//#endregion

//#region classifyImage (a specification of new code; the equivalence guard compares it with the legacy decision)

describe('classifyImage', () => {
    function ascii(s: string): Uint8Array {
        return Uint8Array.from(Array.from(s).map((c) => c.charCodeAt(0)))
    }

    function u32be(n: number): Uint8Array {
        return Uint8Array.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])
    }

    function cat(...parts: Uint8Array[]): Uint8Array {
        const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
        let at = 0
        for (const p of parts) {
            out.set(p, at)
            at += p.length
        }
        return out
    }

    const PNG_SIG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const PREFIX = 65536

    function chunk(type: string, dataLen: number): Uint8Array {
        return cat(u32be(dataLen), ascii(type), new Uint8Array(dataLen), new Uint8Array(4))
    }

    function riffWebp(fourCc: string, flags = 0): Uint8Array {
        const body = cat(ascii(fourCc), u32be(10), Uint8Array.from([flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]), new Uint8Array(20))
        return cat(ascii('RIFF'), u32be(4 + body.length), ascii('WEBP'), body)
    }

    /** An `ftyp` box whose declared size equals its real length, followed by
     *  `after` bytes of other data. */
    function ftyp(major: string, compatible: string[], after = 0, declaredSize?: number): Uint8Array {
        const box = cat(ascii('ftyp'), ascii(major), u32be(0), ...compatible.map(ascii))
        return cat(u32be(declaredSize ?? 4 + box.length), box, new Uint8Array(after))
    }

    function jpeg(trailing = 0): Uint8Array {
        return cat(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), ascii('JFIF'), new Uint8Array(40), Uint8Array.from([0xff, 0xd9]), new Uint8Array(trailing))
    }

    const kindOf = (bytes: Uint8Array, whole: boolean) => classifyImage(bytes, whole).kind

    describe('a whole file', () => {
        test.each([
            ['an empty file', new Uint8Array(0)],
            ['11 bytes', new Uint8Array(11)],
        ])('%s is null', (_label, bytes) => {
            expect(kindOf(bytes, true)).toBe('null')
        })

        test('a GIF and an animated WebP are animated; an APNG with an early acTL is animated', () => {
            expect(kindOf(cat(ascii('GIF89a'), new Uint8Array(20)), true)).toBe('animated')
            expect(kindOf(riffWebp('VP8X', 0x02), true)).toBe('animated')
            expect(kindOf(cat(PNG_SIG, chunk('IHDR', 13), chunk('acTL', 8), chunk('IDAT', 4), chunk('IEND', 0)), true)).toBe('animated')
        })

        test('stills carry the MIME type of their format', () => {
            expect(classifyImage(cat(PNG_SIG, chunk('IHDR', 13), chunk('IDAT', 4), chunk('IEND', 0)), true)).toEqual({ kind: 'still', mime: 'image/png' })
            expect(classifyImage(riffWebp('VP8 '), true)).toEqual({ kind: 'still', mime: 'image/webp' })
            expect(classifyImage(cat(ascii('BM'), new Uint8Array(20)), true)).toEqual({ kind: 'still', mime: 'image/bmp' })
            expect(classifyImage(ftyp('avif', ['mif1']), true)).toEqual({ kind: 'still', mime: 'image/avif' })
            expect(classifyImage(jpeg(), true)).toEqual({ kind: 'still', mime: 'image/jpeg' })
        })

        test('an AVIF sequence is animated and an unrelated ftyp brand is unknown', () => {
            expect(kindOf(ftyp('avif', ['avis']), true)).toBe('animated')
            expect(kindOf(ftyp('isom', ['mp41']), true)).toBe('unknown')
        })

        test('bytes of no known format are unknown', () => {
            expect(kindOf(new Uint8Array(64), true)).toBe('unknown')
        })

        test('a JPEG with bytes after its end marker is a still JPEG', () => {
            expect(classifyImage(jpeg(16), true)).toEqual({ kind: 'still', mime: 'image/jpeg' })
        })

        test('a malformed JPEG that starts FF D8, has a byte other than FF third and ends FF D9 stays a still JPEG', () => {
            const bytes = cat(Uint8Array.from([0xff, 0xd8, 0x00]), new Uint8Array(20), Uint8Array.from([0xff, 0xd9]))
            expect(classifyImage(bytes, true)).toEqual({ kind: 'still', mime: 'image/jpeg' })
        })

        test('FF D8, a byte other than FF third and no end marker is unknown', () => {
            expect(kindOf(cat(Uint8Array.from([0xff, 0xd8, 0x00]), new Uint8Array(20)), true)).toBe('unknown')
        })
    })

    describe('a prefix', () => {
        const stillHead = () => cat(PNG_SIG, chunk('IHDR', 13), chunk('IDAT', 4), chunk('IEND', 0))

        test('a PNG with IDAT before any acTL is a still, and one with an early acTL is animated', () => {
            expect(kindOf(cat(stillHead(), new Uint8Array(PREFIX)).subarray(0, PREFIX), false)).toBe('still')
            expect(kindOf(cat(PNG_SIG, chunk('IHDR', 13), chunk('acTL', 8), new Uint8Array(PREFIX)).subarray(0, PREFIX), false)).toBe('animated')
        })

        test('a PNG prefix that ends cleanly at a chunk boundary before IDAT is undecided, and a still when whole', () => {
            const bytes = cat(PNG_SIG, chunk('IHDR', 13), chunk('tEXt', 8))
            expect(kindOf(bytes, false)).toBe('undecided')
            expect(kindOf(bytes, true)).toBe('still')
        })

        test('an APNG with its acTL after 100 KiB of tEXt is undecided from the first 64 KiB and animated whole', () => {
            const whole = cat(PNG_SIG, chunk('IHDR', 13), chunk('tEXt', 100 * 1024), chunk('acTL', 8), chunk('IDAT', 4), chunk('IEND', 0))
            expect(kindOf(whole.subarray(0, PREFIX), false)).toBe('undecided')
            expect(kindOf(whole, true)).toBe('animated')
        })

        test('an ISO-BMFF box that ends inside the prefix without avis is a still', () => {
            expect(classifyImage(ftyp('avif', ['mif1', 'miaf'], PREFIX), false)).toEqual({ kind: 'still', mime: 'image/avif' })
        })

        test('an ftyp box with an avis brand is animated', () => {
            expect(kindOf(ftyp('avif', ['isom', 'avis'], PREFIX), false)).toBe('animated')
        })

        test.each([
            ['size 0 ("to end of file")', 0],
            ['a size larger than the prefix', PREFIX + 1024],
        ])('an ftyp box of %s with no avis in view is undecided, and a still when whole', (_label, declaredSize) => {
            const bytes = ftyp('avif', ['mif1'], 64, declaredSize)
            expect(kindOf(bytes, false)).toBe('undecided')
            expect(kindOf(bytes, true)).toBe('still')
        })

        test('an ftyp box of size 0 with avis in view is animated', () => {
            expect(kindOf(ftyp('avif', ['avis'], 64, 0), false)).toBe('animated')
        })

        test('WebP and GIF prefixes decide from their headers', () => {
            expect(kindOf(cat(riffWebp('VP8X', 0x02), new Uint8Array(PREFIX)).subarray(0, PREFIX), false)).toBe('animated')
            expect(classifyImage(cat(riffWebp('VP8L'), new Uint8Array(PREFIX)).subarray(0, PREFIX), false)).toEqual({ kind: 'still', mime: 'image/webp' })
            expect(kindOf(cat(ascii('GIF87a'), new Uint8Array(PREFIX)).subarray(0, PREFIX), false)).toBe('animated')
        })

        test('a prefix starting FF D8 FF is a still JPEG whether or not it ends in FF D9', () => {
            const bytes = cat(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), new Uint8Array(PREFIX))
            expect(classifyImage(bytes.subarray(0, PREFIX), false)).toEqual({ kind: 'still', mime: 'image/jpeg' })
        })

        test('a prefix starting FF D8 and then a byte other than FF is undecided', () => {
            const bytes = cat(Uint8Array.from([0xff, 0xd8, 0x00]), new Uint8Array(PREFIX))
            expect(kindOf(bytes.subarray(0, PREFIX), false)).toBe('undecided')
        })

        test('a prefix shorter than the bytes a rule reads is undecided', () => {
            expect(kindOf(riffWebp('VP8X', 0x02).subarray(0, 18), false)).toBe('undecided')
            expect(kindOf(PNG_SIG.subarray(0, 6), false)).toBe('undecided')
        })

        test('a prefix of no known format is unknown', () => {
            expect(kindOf(new Uint8Array(PREFIX), false)).toBe('unknown')
        })
    })

    describe('equivalence with the legacy decision on whole files', () => {
        function legacy(bytes: Uint8Array): 'null' | 'animated' | 'unknown' | 'still' {
            if (bytes.length < 12) {
                return 'null'
            }
            if (isAnimatedImage(bytes)) {
                return 'animated'
            }
            return getImageType(bytes) === 'Unknown' ? 'unknown' : 'still'
        }

        const fixtures: Array<[string, Uint8Array]> = [
            ['empty', new Uint8Array(0)],
            ['11 zero bytes', new Uint8Array(11)],
            ['a GIF', cat(ascii('GIF89a'), new Uint8Array(20))],
            ['a still PNG', cat(PNG_SIG, chunk('IHDR', 13), chunk('IDAT', 4), chunk('IEND', 0))],
            ['an APNG', cat(PNG_SIG, chunk('IHDR', 13), chunk('acTL', 8), chunk('IDAT', 4))],
            ['a PNG with acTL after IDAT', cat(PNG_SIG, chunk('IHDR', 13), chunk('IDAT', 4), chunk('acTL', 8))],
            ['a PNG with an overrunning chunk', cat(PNG_SIG, u32be(9000), ascii('IHDR'), new Uint8Array(4))],
            ['a bare PNG signature plus 4 bytes', cat(PNG_SIG, new Uint8Array(4))],
            ['a VP8 WebP', riffWebp('VP8 ')],
            ['a VP8X still WebP', riffWebp('VP8X', 0)],
            ['a VP8X animated WebP', riffWebp('VP8X', 0x02)],
            ['a 12-byte RIFF WEBP header', cat(ascii('RIFF'), u32be(4), ascii('WEBP'))],
            ['an AVIF', ftyp('avif', ['mif1'])],
            ['an AVIF sequence', ftyp('avif', ['avis'])],
            ['an ftyp of size 0', ftyp('avif', ['mif1'], 32, 0)],
            ['an mp4', ftyp('isom', ['mp41'])],
            ['a BMP', cat(ascii('BM'), new Uint8Array(20))],
            ['zeros', new Uint8Array(64)],
            ['a malformed FF D8 xx ... FF D9', cat(Uint8Array.from([0xff, 0xd8, 0x00]), new Uint8Array(20), Uint8Array.from([0xff, 0xd9]))],
            ['FF D8 xx without an end marker', cat(Uint8Array.from([0xff, 0xd8, 0x00]), new Uint8Array(20))],
            ['a JPEG ending in FF D9', jpeg()],
        ]

        /** The decode MIME type the legacy path took from `getImageType`. */
        function legacyMime(bytes: Uint8Array): string {
            switch (getImageType(bytes)) {
                case 'JPEG': return 'image/jpeg'
                case 'PNG': return 'image/png'
                case 'WEBP': return 'image/webp'
                case 'BMP': return 'image/bmp'
                case 'AVIF': return 'image/avif'
                default: return 'application/octet-stream'
            }
        }

        test.each(fixtures)('%s gets the legacy outcome and decode MIME type', (_label, bytes) => {
            expect(kindOf(bytes, true)).toBe(legacy(bytes))
            const cls = classifyImage(bytes, true)
            if (cls.kind === 'still') {
                expect(cls.mime).toBe(legacyMime(bytes))
            }
        })

        test('a buffer starting FF D8 FF without an end marker is the one deliberate difference: still with image/jpeg, not unknown', () => {
            const bytes = jpeg(16)
            expect(legacy(bytes)).toBe('unknown')
            expect(legacyMime(bytes)).toBe('application/octet-stream')
            expect(classifyImage(bytes, true)).toEqual({ kind: 'still', mime: 'image/jpeg' })
        })
    })
})

//#endregion
