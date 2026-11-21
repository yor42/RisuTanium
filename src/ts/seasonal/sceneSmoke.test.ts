// @vitest-environment jsdom

/**
 * Smoke suite over every ported seasonal scene, built through the real mountSeasonal host in jsdom. jsdom has no Web
 * Animations, so Element.animate is replaced by a recorder; the suite proves lifecycle and structure (build, play,
 * finish, reduced motion, destroy, tones, font failure), not pixels. Scene destroy() is observed from inside the host's
 * own teardown (before the host empties the layers), otherwise the host's cleanup would hide a scene that leaks.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mountSeasonal, type HostController, type HostOptions, type SeasonalStrings } from './host'
import type { OccasionKey } from './calendar'
import type { SceneContext, SceneDef, SceneInstance, SceneModule } from './sceneTypes'

const LINK = 'https://github.com/yor42/RisuTanium'
const LANGS = ['en', 'ko', 'ja', 'cn']

const strings: SeasonalStrings = {
    replayHint: 'Replay the animation',
    skipHint: 'Skip the animation',
    santaHat: 'Santa hat, a hidden game',
    gameTitle: 'Santa hat game',
    gameClose: 'Close',
    gameScore: 'Score',
    gameTime: 'Time',
    gamePlay: 'Play',
    gamePlayAgain: 'Play again',
    gameTarget: 'Santa hat target',
    gameHint: 'Hit the hat.',
    gameTimeUp: 'Time is up, score',
    gameClosed: 'Santa hat game closed',
}

type AprilFoolModule = SceneModule & { resetVariantPool(source?: () => number): void }

interface Case {
    key: OccasionKey
    date: Date
    /** Time after the play started by which the scene has reached its final pose. */
    playMs: number
    /** Whether the mark svg the scene put in the mark slot is in its final pose. */
    isFinal: (svg: Element) => boolean
    load: () => Promise<SceneModule>
}

const poseAttr = (svg: Element): boolean => svg.getAttribute('data-rt-pose') === 'final'
const poseClass = (cls: string) => (svg: Element): boolean => svg.classList.contains(cls)

const CASES: Case[] = [
    { key: 'christmas', date: new Date(2026, 11, 24, 12, 0, 0), playMs: 7100, isFinal: poseAttr, load: () => import('./scenes/christmas') },
    { key: 'newYear', date: new Date(2027, 0, 1, 12, 0, 0), playMs: 7100, isFinal: poseAttr, load: () => import('./scenes/newYear') },
    { key: 'anniversary', date: new Date(2027, 8, 21, 12, 0, 0), playMs: 6600, isFinal: poseAttr, load: () => import('./scenes/anniversary') },
    { key: 'halloween', date: new Date(2026, 9, 31, 12, 0, 0), playMs: 7400, isFinal: poseClass('rt-hw-final'), load: () => import('./scenes/halloween') },
    { key: 'valentine', date: new Date(2027, 1, 14, 12, 0, 0), playMs: 6600, isFinal: poseClass('rt-vl-final'), load: () => import('./scenes/valentine') },
    { key: 'aprilFool', date: new Date(2027, 3, 1, 12, 0, 0), playMs: 6400, isFinal: poseClass('rt-af-final'), load: () => import('./scenes/aprilFool') },
]
const AF_VARIANTS = ['tiramisu', 'invert', 'element', 'acorn'] as const
// Random source for the April Fools pool: every mount starts the cycle at this variant unless a test replays.
let variantPick = 0
const BY_KEY = (key: OccasionKey): Case => CASES.find((c) => c.key === key)!

class FakeAnimation {
    playState: AnimationPlayState = 'running'
    currentTime: number | null = 0
    finished: Promise<Animation>
    private timer: ReturnType<typeof setTimeout> | undefined = undefined
    // `finished` settles when the animation's delay and duration have elapsed, like a real one; cancel() stops it.
    constructor(private readonly live: Set<FakeAnimation>, totalMs: number) {
        live.add(this)
        this.finished = new Promise<Animation>((resolve) => {
            this.timer = setTimeout(() => resolve(this as unknown as Animation), totalMs)
        })
    }
    cancel(): void {
        clearTimeout(this.timer)
        this.live.delete(this)
    }
    pause(): void {
        this.playState = 'paused'
    }
    play(): void {
        this.playState = 'running'
    }
}

interface DestroyState {
    stageChildren: number
    markChildren: number
    overChildren: number
    wordClass: string | null
    wordTransformOrigin: string
    liveAnimations: number
    outstandingTimers: number
}

interface Probe {
    ctx: SceneContext | null
    plays: number
    finishes: number
    destroyed: DestroyState | null
    outstanding: Set<number>
    builtWordClass: string | null
}

let live: Set<FakeAnimation>
let animateCalls: number
let now: Date
let played: Set<string>
let mounted: HostController[] = []

function fixture(): { anchor: HTMLElement, brand: HTMLElement, mark: HTMLElement, host: HTMLElement } {
    document.body.innerHTML =
        '<header data-anchor><div data-brand><svg data-mark data-status="idle"></svg><span data-host></span></div><div data-switcher>switcher</div></header>'
    return {
        anchor: document.querySelector('[data-anchor]') as HTMLElement,
        brand: document.querySelector('[data-brand]') as HTMLElement,
        mark: document.querySelector('[data-mark]') as HTMLElement,
        host: document.querySelector('[data-host]') as HTMLElement,
    }
}

async function mountScene(c: Case, over: Partial<HostOptions> = {}): Promise<{ ctrl: HostController, fx: ReturnType<typeof fixture>, probe: Probe, onLink: ReturnType<typeof vi.fn> }> {
    const mod = await c.load()
    const real = mod.default
    if (c.key === 'aprilFool') (mod as AprilFoolModule).resetVariantPool(() => (variantPick + 0.1) / AF_VARIANTS.length)
    const probe: Probe = { ctx: null, plays: 0, finishes: 0, destroyed: null, outstanding: new Set(), builtWordClass: null }
    const wrapped: SceneDef = {
        ...real,
        build(ctx) {
            probe.ctx = ctx
            probe.builtWordClass = ctx.word.getAttribute('class')
            // Tracks the timers the scene itself leaves pending: the host clears its own list before calling destroy().
            const wctx: SceneContext = Object.create(ctx, {
                setTimeout: {
                    value: (fn: () => void, ms: number): number => {
                        const id = ctx.setTimeout(() => {
                            probe.outstanding.delete(id)
                            fn()
                        }, ms)
                        probe.outstanding.add(id)
                        return id
                    },
                },
                clearTimeout: {
                    value: (id: number): void => {
                        probe.outstanding.delete(id)
                        ctx.clearTimeout(id)
                    },
                },
            })
            const inst: SceneInstance = real.build(wctx)
            return {
                play() {
                    probe.plays++
                    return inst.play()
                },
                finish() {
                    probe.finishes++
                    inst.finish()
                },
                destroy() {
                    inst.destroy()
                    probe.destroyed = {
                        stageChildren: ctx.stage.childElementCount,
                        markChildren: ctx.markSlot ? ctx.markSlot.childElementCount : 0,
                        overChildren: ctx.over.childElementCount,
                        wordClass: ctx.word.getAttribute('class'),
                        wordTransformOrigin: ctx.word.style.transformOrigin,
                        liveAnimations: live.size,
                        outstandingTimers: probe.outstanding.size,
                    }
                },
            }
        },
    }
    const fx = fixture()
    const onLink = vi.fn()
    const ctrl = mountSeasonal(fx.host, {
        language: 'en',
        strings,
        now: () => now,
        loadScene: async () => wrapped,
        playedToday: (ymd) => played.has(ymd),
        markPlayed: (ymd) => { played.add(ymd) },
        anchorEl: fx.anchor,
        brandEl: fx.brand,
        fitEl: fx.brand,
        markEl: fx.mark,
        reducedMotion: () => false,
        lowPower: () => false,
        theme: () => 'dark',
        onLink,
        anniversaryUrl: LINK,
        ...over,
    })
    mounted.push(ctrl)
    return { ctrl, fx, probe, onLink }
}

async function settle(ms = 700): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms)
}

function ymd(d: Date): string {
    const pad = (n: number): string => (n < 10 ? '0' : '') + n
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

beforeEach(() => {
    vi.useFakeTimers()
    live = new Set()
    animateCalls = 0
    played = new Set()
    mounted = []
    variantPick = 0
    Object.defineProperty(Element.prototype, 'animate', {
        configurable: true,
        writable: true,
        value: function animate(_frames: Keyframe[], opts: KeyframeAnimationOptions): Animation {
            animateCalls++
            return new FakeAnimation(live, (Number(opts.delay) || 0) + (Number(opts.duration) || 0)) as unknown as Animation
        },
    })
})

afterEach(() => {
    for (const c of mounted) c.destroy()
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete (Element.prototype as { animate?: unknown }).animate
    document.body.innerHTML = ''
    document.head.querySelectorAll('style[data-rt-sw-font]').forEach((s) => s.remove())
    delete (document as unknown as { fonts?: unknown }).fonts
})

describe.each(CASES)('scene $key', (c) => {
    test('default-exports a SceneDef with the right key and a duration of at most 10 s', async () => {
        const def = (await c.load()).default
        expect(def.key).toBe(c.key)
        expect(def.durationMs).toBeGreaterThan(0)
        expect(def.durationMs).toBeLessThanOrEqual(10000)
        expect(typeof def.build).toBe('function')
    })

    describe.each(LANGS)('language %s', (lang) => {
        describe.each(['light', 'dark'] as const)('%s tone', (tone) => {
            // Guards: a scene that throws on build or play, or a play that never settles into the final pose.
            test('builds, plays and ends in the final pose with the mark in the mark slot', async () => {
                now = c.date
                const { ctrl, fx, probe } = await mountScene(c, { language: lang, theme: () => tone })
                await settle()
                expect(ctrl.occasion).toBe(c.key)
                expect(probe.plays).toBe(1)
                expect(ctrl.phase).toBe('playing')
                const slot = fx.brand.querySelector('.rt-sw-markslot') as HTMLElement
                expect(slot.getAttribute('data-rt-sw-tone')).toBe(tone)
                expect(fx.anchor.querySelector('.rt-sw-stage')!.getAttribute('data-rt-sw-tone')).toBe(tone)
                expect(c.isFinal(slot.querySelector('svg')!)).toBe(false)
                await settle(c.playMs)
                expect(ctrl.phase).toBe('final')
                const svg = slot.querySelector('svg')!
                expect(c.isFinal(svg)).toBe(true)
                expect(slot.childElementCount).toBe(1)
            })
        })
    })

    // Guards: finish() requiring a prior play(); a view later the same day must reach the final pose directly.
    test('finish before play reaches the final pose without any animation', async () => {
        now = c.date
        played.add(ymd(c.date))
        const { ctrl, fx, probe } = await mountScene(c)
        await settle()
        expect(probe.plays).toBe(0)
        expect(probe.finishes).toBe(1)
        expect(animateCalls).toBe(0)
        expect(ctrl.phase).toBe('final')
        expect(c.isFinal(fx.brand.querySelector('.rt-sw-markslot svg')!)).toBe(true)
    })

    // Guards: reduced motion starting the timeline (the host must call finish() only).
    test.each([
        ['reduced motion', { reducedMotion: () => true }],
        ['low power', { lowPower: () => true }],
    ])('%s calls finish() only', async (_name, over) => {
        now = c.date
        const { ctrl, probe } = await mountScene(c, over)
        await settle()
        expect(probe.plays).toBe(0)
        expect(probe.finishes).toBe(1)
        expect(animateCalls).toBe(0)
        expect(ctrl.phase).toBe('final')
        expect(played.size).toBe(0)
    })

    // Guards: a scene leaving nodes, animations, timers or word changes behind. Read inside the scene's own destroy().
    test.each([
        ['after the final pose', 7500],
        ['in the middle of the play', 2000],
    ])('destroy %s removes everything the scene added', async (_name, runMs) => {
        now = c.date
        const { ctrl, probe } = await mountScene(c)
        await settle(700 + runMs)
        expect(probe.ctx).not.toBeNull()
        const styleBefore = document.head.querySelectorAll('style').length
        ctrl.destroy()
        expect(probe.destroyed).toEqual({
            stageChildren: 0,
            markChildren: 0,
            overChildren: 0,
            wordClass: probe.builtWordClass,
            wordTransformOrigin: '',
            liveAnimations: 0,
            outstandingTimers: 0,
        })
        expect(document.head.querySelectorAll('style').length).toBe(styleBefore)
        // The host's own timers are gone too: nothing is left pending after destroy.
        expect(vi.getTimerCount()).toBe(0)
    })

    // Guards: a scene that depends on the font loading (font failure must not stall or break the scene).
    test('keeps running when the logo font fails to load', async () => {
        now = c.date
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: {
                load: vi.fn(() => Promise.reject(new Error('blocked'))),
                forEach: () => {},
                addEventListener: () => {},
                removeEventListener: () => {},
            },
        })
        const { ctrl, probe } = await mountScene(c)
        await settle()
        expect(probe.plays).toBe(1)
        await settle(7600)
        expect(ctrl.phase).toBe('final')
    })

    // Guards: the scene's own fonts promise answering true when no face was requested.
    test('reports a missing font as not ready', async () => {
        now = c.date
        const { probe } = await mountScene(c)
        await settle()
        await expect(probe.ctx!.fonts.ready('No Such Face')).resolves.toBe(false)
    })
})

describe('christmas hat', () => {
    // Guards: the hat not being the accessible 5-tap game button, or the game target art missing its placeholder swap.
    test('is a named button in the over-layer and five taps open the game panel with the hat art', async () => {
        now = BY_KEY('christmas').date
        played.add(ymd(now))
        const { fx } = await mountScene(BY_KEY('christmas'))
        await settle()
        const over = fx.host.querySelector('.rt-sw-over') as HTMLElement
        const hat = over.querySelector('.rt-xm-hat') as HTMLElement
        expect(hat.getAttribute('role')).toBe('button')
        expect(hat.getAttribute('aria-label')).toContain(strings.santaHat)
        expect(hat.getAttribute('data-rt-sw-game')).toBe('active')
        expect(document.querySelector('.rt-sw-game')).toBeNull()
        for (let i = 0; i < 5; i++) hat.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(hat.hidden).toBe(true)
        const target = document.querySelector('.rt-sw-game-target') as HTMLElement
        expect(target).not.toBeNull()
        expect(target.innerHTML).toContain('rt-xm-hat-body')
        expect(target.innerHTML).not.toContain('__UID__')
        const gradientId = target.querySelector('linearGradient')!.id
        expect(target.innerHTML).toContain('url(#' + gradientId + ')')
    })

    // Guards: node budget growth (the contract caps the snowfall).
    test('draws 24 flakes and one hat per build', async () => {
        now = BY_KEY('christmas').date
        const { fx } = await mountScene(BY_KEY('christmas'))
        await settle()
        expect(fx.anchor.querySelectorAll('.rt-xm-flake').length).toBe(24)
        expect(document.querySelectorAll('.rt-xm-hat').length).toBe(1)
    })
})

describe('newYear year and wordmark', () => {
    // Guards: the year missing from the greeting, or the cloud it rides on.
    test('the greeting carries the year on its swirl cloud', async () => {
        now = BY_KEY('newYear').date
        const { fx } = await mountScene(BY_KEY('newYear'))
        await settle()
        const stage = fx.anchor.querySelector('.rt-sw-stage') as HTMLElement
        expect(stage.querySelector('.rt-ny-year')!.textContent).toBe('2027')
        expect(stage.querySelector('.rt-ny-ride .rt-ny-ride-cloud svg')).not.toBeNull()
        expect(stage.querySelector('.rt-ny-text-a')!.textContent).toBe('Happy New Year')
    })

    // Guards: the final wordmark edge missing, or left on the word after the scene is gone.
    test('the final pose gives the word its warm edge and a replay clears it', async () => {
        now = BY_KEY('newYear').date
        played.add(ymd(now))
        const { ctrl, fx } = await mountScene(BY_KEY('newYear'))
        await settle()
        const word = fx.host.querySelector('.rt-sw-word') as HTMLElement
        expect(word.classList.contains('rt-ny-warm')).toBe(true)
        expect(word.querySelector('.rt-ny-tanium')!.textContent).toBe('Tanium')
        ctrl.destroy()
        expect(word.classList.contains('rt-ny-warm')).toBe(false)
    })
})

describe('anniversary greeting and cake', () => {
    // Guards: the greeting not calling the host's link handler, or a wrong ordinal for the year.
    test('the greeting link calls onLink with the anniversary url and names the ordinal', async () => {
        now = BY_KEY('anniversary').date
        const { fx, onLink } = await mountScene(BY_KEY('anniversary'))
        await settle()
        const greet = fx.host.querySelector('.rt-sw-greet') as HTMLButtonElement
        expect(greet.getAttribute('aria-label')).toBe('Happy 1st Anniversary!')
        greet.click()
        expect(onLink).toHaveBeenCalledWith(LINK)
    })

    // Guards: candle count not following the year (min(N, 5)).
    test.each([
        [2027, 1],
        [2029, 3],
        [2031, 5],
        [2040, 5],
    ])('year %i lights %i candle(s)', async (year, candles) => {
        now = new Date(year, 8, 21, 12, 0, 0)
        played.add(ymd(now))
        const { fx } = await mountScene(BY_KEY('anniversary'))
        await settle()
        expect(fx.brand.querySelectorAll('.rt-an-candle').length).toBe(candles)
        expect(fx.brand.querySelectorAll('.rt-an-flame').length).toBe(candles)
    })

    // Guards: confetti budget (the contract allows one burst of at most 40 pieces).
    test('one burst of 32 pieces', async () => {
        now = BY_KEY('anniversary').date
        const { fx } = await mountScene(BY_KEY('anniversary'))
        await settle()
        expect(fx.anchor.querySelectorAll('.rt-an-bit').length).toBe(32)
    })

    // Guards: the greeting staying after the scene is torn down.
    test('destroy takes the greeting with it', async () => {
        now = BY_KEY('anniversary').date
        const { ctrl, fx } = await mountScene(BY_KEY('anniversary'))
        await settle()
        expect(fx.host.querySelector('.rt-sw-greet')).not.toBeNull()
        ctrl.destroy()
        expect(document.querySelector('.rt-sw-greet')).toBeNull()
    })
})

describe('halloween bats, perch and final pose', () => {
    // Guards: node budget (four fleeing bats plus one perched bat) and the perched bat being exposed to assistive tech.
    test('four bats flee, one perched bat sits on the word and is aria-hidden', async () => {
        now = BY_KEY('halloween').date
        const { fx } = await mountScene(BY_KEY('halloween'))
        await settle()
        expect(fx.anchor.querySelectorAll('.rt-hw-sky .rt-hw-bat').length).toBe(4)
        const perch = fx.host.querySelector('.rt-sw-word .rt-hw-perch') as HTMLElement
        expect(perch.getAttribute('aria-hidden')).toBe('true')
        expect(fx.host.querySelector('.rt-sw-sr')!.textContent).toBe('RisuTanium')
    })

    // Guards: the final pose classes missing from the layers finish() must settle (sky hidden, mark pumpkin, perched bat).
    test('finish puts the sky, the mark and the word into the final pose, and a replay clears them', async () => {
        now = BY_KEY('halloween').date
        played.add(ymd(now))
        const { ctrl, fx } = await mountScene(BY_KEY('halloween'))
        await settle()
        const word = fx.host.querySelector('.rt-sw-word') as HTMLElement
        expect(fx.anchor.querySelector('.rt-hw-sky')!.classList.contains('rt-hw-final')).toBe(true)
        expect(fx.brand.querySelector('.rt-hw-mark')!.classList.contains('rt-hw-final')).toBe(true)
        expect(word.classList.contains('rt-hw-final')).toBe(true)
        ctrl.destroy()
        expect(word.classList.contains('rt-hw-word')).toBe(false)
        expect(word.classList.contains('rt-hw-final')).toBe(false)
    })
})

describe('valentine heart, trail and description', () => {
    // Guards: the heart prism losing facets (fourteen crown facets) or the constellation losing stars (nine).
    test('assembles fourteen facets and lights nine trail stars', async () => {
        now = BY_KEY('valentine').date
        const { fx } = await mountScene(BY_KEY('valentine'))
        await settle()
        expect(fx.brand.querySelectorAll('.rt-vl-facet').length).toBe(14)
        expect(fx.anchor.querySelectorAll('.rt-vl-trail .rt-vl-star').length).toBe(9)
    })

    // Guards: the greeting only being visual (the scene description must reach assistive tech) and the name changing.
    test('describes the day for assistive tech, keeps the name, and hides the dot art', async () => {
        now = BY_KEY('valentine').date
        const { fx } = await mountScene(BY_KEY('valentine'))
        await settle()
        expect(fx.host.querySelector('.rt-sw-desc')!.textContent).toContain('Happy Valentine')
        expect(fx.host.querySelector('.rt-sw-sr')!.textContent).toBe('RisuTanium')
        expect(fx.host.querySelector('.rt-sw-word .rt-vl-dot')!.getAttribute('aria-hidden')).toBe('true')
    })
})

describe('aprilFool variant pool', () => {
    function variantOf(fx: ReturnType<typeof fixture>): string | null {
        return (fx.host.querySelector('.rt-sw-word') as HTMLElement).getAttribute('data-af-variant')
    }

    describe.each(AF_VARIANTS.map((v, i) => [v, i] as const))('variant %s', (variant, index) => {
        // Guards: a variant that throws, leaves its overlay readable by assistive tech, or renames the logo.
        test.each(['light', 'dark'] as const)('plays to the final pose with an aria-hidden overlay and the name intact (%s)', async (tone) => {
            now = BY_KEY('aprilFool').date
            variantPick = index
            const { ctrl, fx } = await mountScene(BY_KEY('aprilFool'), { theme: () => tone })
            await settle()
            expect(variantOf(fx)).toBe(variant)
            expect(fx.host.querySelector('.rt-af-scr')!.getAttribute('aria-hidden')).toBe('true')
            expect(fx.host.querySelector('.rt-sw-sr')!.textContent).toBe('RisuTanium')
            expect(fx.host.querySelector('.rt-sw-word')!.getAttribute('lang')).toBeNull()
            await settle(6400)
            expect(ctrl.phase).toBe('final')
            expect(fx.host.querySelector('.rt-sw-sr')!.textContent).toBe('RisuTanium')
            expect(fx.brand.querySelector('.rt-af-mark')!.classList.contains('rt-af-final')).toBe(true)
        })

        // Guards: a variant leaving nodes, timers or word state behind when torn down mid-play.
        test('destroy in the middle of the play removes everything the variant added', async () => {
            now = BY_KEY('aprilFool').date
            variantPick = index
            const { ctrl, probe } = await mountScene(BY_KEY('aprilFool'))
            await settle(700 + 2200)
            ctrl.destroy()
            expect(probe.destroyed).toEqual({
                stageChildren: 0,
                markChildren: 0,
                overChildren: 0,
                wordClass: probe.builtWordClass,
                wordTransformOrigin: '',
                liveAnimations: 0,
                outstandingTimers: 0,
            })
            const word = probe.ctx!.word
            expect(word.hasAttribute('data-af-variant')).toBe(false)
            expect(word.querySelector('.rt-af-scr, .rt-af-tail')).toBeNull()
        })
    })

    // Guards: the pool not advancing on a replay (every replay shows the next variant, wrapping after the fourth).
    test('each replay of a played scene shows the next variant and wraps around', async () => {
        now = BY_KEY('aprilFool').date
        variantPick = 2
        const { ctrl, fx } = await mountScene(BY_KEY('aprilFool'))
        await settle()
        expect(variantOf(fx)).toBe('element')
        const seen: Array<string | null> = []
        for (let i = 0; i < 3; i++) {
            await settle(6400)
            ctrl.replay()
            await settle()
            seen.push(variantOf(fx))
        }
        expect(seen).toEqual(['acorn', 'tiramisu', 'invert'])
    })

    // Guards: a final-pose-only mount (already played today) advancing the cycle without having played anything.
    test('a build that only shows the final pose keeps the variant for the next replay', async () => {
        now = BY_KEY('aprilFool').date
        played.add(ymd(now))
        variantPick = 1
        const { ctrl, fx } = await mountScene(BY_KEY('aprilFool'))
        await settle()
        expect(variantOf(fx)).toBe('invert')
        ctrl.replay()
        await settle()
        expect(variantOf(fx)).toBe('invert')
    })
})