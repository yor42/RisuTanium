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
const KO = ['ko']
// Languages the calendar resolves dano in (ko by dangi, the Chinese locales by the chinese calendar) and starFestival by lunar 7/7.
const DANO_LANGS = ['ko', 'cn', 'zh', 'zh-Hant']
const LUNAR_STAR_LANGS = ['ko', 'cn', 'zh', 'zh-Hant']
// springFestival resolves for the Chinese locales and Vietnamese by the chinese calendar; midAutumn for the Chinese locales only.
const ZH_LANGS = ['cn', 'zh', 'zh-Hant']
const SPRING_LANGS = ['cn', 'zh', 'zh-Hant', 'vi']
// St. Patrick's Day and Easter resolve for the Western languages; Independence Day and Thanksgiving for en only.
const WESTERN_LANGS = ['en', 'de', 'es']

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
    /** Names a second look of one occasion (krNational has two dates); defaults to the key. */
    label?: string
    /** Languages the occasion resolves in; defaults to every language of the suite. */
    langs?: string[]
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
    // The four Korean occasions resolve for ko only (the calendar gates them by language).
    { key: 'seollal', langs: KO, date: new Date(2027, 1, 6, 12, 0, 0), playMs: 7300, isFinal: poseClass('rt-sl-final'), load: () => import('./scenes/seollal') },
    { key: 'chuseok', langs: KO, date: new Date(2026, 8, 25, 12, 0, 0), playMs: 8400, isFinal: poseClass('rt-cs-final'), load: () => import('./scenes/chuseok') },
    { key: 'hangulDay', langs: KO, date: new Date(2026, 9, 9, 12, 0, 0), playMs: 5900, isFinal: poseClass('rt-hg-final'), load: () => import('./scenes/hangulDay') },
    { key: 'krNational', label: 'krNational samiljeol', langs: KO, date: new Date(2027, 2, 1, 12, 0, 0), playMs: 6600, isFinal: poseClass('rt-kn-final'), load: () => import('./scenes/krNational') },
    { key: 'krNational', label: 'krNational gwangbokjeol', langs: KO, date: new Date(2026, 7, 15, 12, 0, 0), playMs: 6600, isFinal: poseClass('rt-kn-final'), load: () => import('./scenes/krNational') },
    // Lunar days resolve on the same date in the dangi and chinese calendars (2026-06-19 is lunar 5/5, 2026-08-19 is 7/7).
    { key: 'dano', langs: DANO_LANGS, date: new Date(2026, 5, 19, 12, 0, 0), playMs: 6500, isFinal: poseClass('rt-dn-final'), load: () => import('./scenes/dano') },
    { key: 'childrenDay', langs: ['ko', 'ja'], date: new Date(2027, 4, 5, 12, 0, 0), playMs: 6700, isFinal: poseClass('rt-kid-final'), load: () => import('./scenes/childrenDay') },
    { key: 'sakura', langs: ['ko', 'ja'], date: new Date(2027, 2, 30, 12, 0, 0), playMs: 6900, isFinal: poseClass('rt-skr-final'), load: () => import('./scenes/sakura') },
    { key: 'starFestival', label: 'starFestival lunar', langs: LUNAR_STAR_LANGS, date: new Date(2026, 7, 19, 12, 0, 0), playMs: 7300, isFinal: poseClass('rt-tnb-final'), load: () => import('./scenes/starFestival') },
    { key: 'starFestival', label: 'starFestival tanabata', langs: ['ja'], date: new Date(2026, 6, 7, 12, 0, 0), playMs: 7300, isFinal: poseClass('rt-tnb-final'), load: () => import('./scenes/starFestival') },
    // Chinese new year (lunar 1/1 on 2027-02-07) for the Chinese locales and Vietnamese; mid-autumn (lunar 8/15 on 2026-09-25) for the Chinese
    // locales and tsukimi for ja (the same lunar day); Obon and Bunka no Hi are fixed ja days.
    { key: 'springFestival', langs: SPRING_LANGS, date: new Date(2027, 1, 7, 12, 0, 0), playMs: 7500, isFinal: poseClass('rt-sf-final'), load: () => import('./scenes/springFestival') },
    { key: 'midAutumn', langs: ZH_LANGS, date: new Date(2026, 8, 25, 12, 0, 0), playMs: 7700, isFinal: poseClass('rt-ma-final'), load: () => import('./scenes/midAutumn') },
    { key: 'tsukimi', langs: ['ja'], date: new Date(2026, 8, 25, 12, 0, 0), playMs: 7200, isFinal: poseClass('rt-tk-final'), load: () => import('./scenes/tsukimi') },
    { key: 'obon', langs: ['ja'], date: new Date(2026, 7, 14, 12, 0, 0), playMs: 6900, isFinal: poseClass('rt-ob-final'), load: () => import('./scenes/obon') },
    { key: 'bunkaNoHi', langs: ['ja'], date: new Date(2026, 10, 3, 12, 0, 0), playMs: 5900, isFinal: poseClass('rt-bk-final'), load: () => import('./scenes/bunkaNoHi') },
    // Western days: Mar 17, Easter Sunday (2027-03-28 by the computus), the solstice (Jun 20-21, every language), Jul 4 and the fourth Thursday of November (2026-11-26).
    { key: 'stPatricksDay', langs: WESTERN_LANGS, date: new Date(2027, 2, 17, 12, 0, 0), playMs: 6700, isFinal: poseClass('rt-sp-final'), load: () => import('./scenes/stPatricksDay') },
    { key: 'easter', langs: WESTERN_LANGS, date: new Date(2027, 2, 28, 12, 0, 0), playMs: 6500, isFinal: poseClass('rt-ea-final'), load: () => import('./scenes/easter') },
    { key: 'summerSolstice', date: new Date(2026, 5, 21, 12, 0, 0), playMs: 6900, isFinal: poseClass('rt-ss-final'), load: () => import('./scenes/summerSolstice') },
    { key: 'thanksgiving', langs: ['en'], date: new Date(2026, 10, 26, 12, 0, 0), playMs: 7300, isFinal: poseClass('rt-tg-final'), load: () => import('./scenes/thanksgiving') },
    { key: 'independenceDay', langs: ['en'], date: new Date(2026, 6, 4, 12, 0, 0), playMs: 7300, isFinal: poseClass('rt-id-final'), load: () => import('./scenes/independenceDay') },
]
const AF_VARIANTS = ['tiramisu', 'invert', 'element', 'acorn'] as const
// Random source for the April Fools pool: every mount starts the cycle at this variant unless a test replays.
let variantPick = 0
const BY_KEY = (key: OccasionKey): Case => CASES.find((c) => c.key === key)!
const BY_LABEL = (label: string): Case => CASES.find((c) => (c.label ?? c.key) === label)!

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
    /** Element children of the word when the scene was built, and when its destroy() returned. */
    builtWordChildren: number
    destroyedWordChildren: number | null
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
    const probe: Probe = { ctx: null, plays: 0, finishes: 0, destroyed: null, outstanding: new Set(), builtWordClass: null, builtWordChildren: 0, destroyedWordChildren: null }
    const wrapped: SceneDef = {
        ...real,
        build(ctx) {
            probe.ctx = ctx
            probe.builtWordClass = ctx.word.getAttribute('class')
            probe.builtWordChildren = ctx.word.childElementCount
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
                    probe.destroyedWordChildren = ctx.word.childElementCount
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
        language: c.langs?.[0] ?? 'en',
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

describe.each(CASES.map((c) => [c.label ?? c.key, c] as const))('scene %s', (_label, c) => {
    test('default-exports a SceneDef with the right key and a duration of at most 10 s', async () => {
        const def = (await c.load()).default
        expect(def.key).toBe(c.key)
        expect(def.durationMs).toBeGreaterThan(0)
        expect(def.durationMs).toBeLessThanOrEqual(10000)
        expect(typeof def.build).toBe('function')
    })

    describe.each(c.langs ?? LANGS)('language %s', (lang) => {
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
        ['after the final pose', Math.max(7500, c.playMs + 300)],
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
        // Nodes a scene put inside the word (colour copies, arcs, perched art) leave with it.
        expect(probe.destroyedWordChildren).toBe(probe.builtWordChildren)
        // The host's own timers are gone too: nothing is left pending after destroy.
        expect(vi.getTimerCount()).toBe(0)
    })

    // Guards: a scene resuming every animation when the page is shown again (play() rewinds a finished one, so ended
    // beats replay after a tab switch mid-play). Animations whose segment has ended must stay finished.
    test('a hide and show in the middle of the play leaves finished animations finished', async () => {
        now = c.date
        let hidden = false
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
        try {
            const { ctrl } = await mountScene(c)
            await settle(700 + 2000)
            expect(ctrl.phase).toBe('playing')
            const ended = [...live]
            expect(ended.length).toBeGreaterThan(0)
            for (const a of ended) a.playState = 'finished'
            hidden = true
            document.dispatchEvent(new Event('visibilitychange'))
            hidden = false
            document.dispatchEvent(new Event('visibilitychange'))
            expect(ended.filter((a) => a.playState !== 'finished')).toHaveLength(0)
        } finally {
            delete (document as unknown as { hidden?: boolean }).hidden
        }
    })

    // Guards: a scene pausing its own animations when it starts on a hidden page. The host only resumes what it paused
    // itself, so such animations would stay frozen after the page is shown.
    test('a play that starts on a hidden page runs once the page is shown', async () => {
        now = c.date
        let hidden = true
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
        try {
            const { ctrl } = await mountScene(c)
            await settle()
            expect(ctrl.phase).toBe('playing')
            const started = [...live]
            expect(started.length).toBeGreaterThan(0)
            hidden = false
            document.dispatchEvent(new Event('visibilitychange'))
            expect(started.filter((a) => a.playState !== 'running')).toHaveLength(0)
        } finally {
            delete (document as unknown as { hidden?: boolean }).hidden
        }
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
        await settle(Math.max(7600, c.playMs + 500))
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

describe('seollal greeting, pouch and word edge', () => {
    // Guards: the greeting or its description missing, or not tagged Korean for assistive tech.
    test('greets in Korean and describes the day in a ko span', async () => {
        now = BY_KEY('seollal').date
        const { fx } = await mountScene(BY_KEY('seollal'), { language: 'ko' })
        await settle()
        const greet = fx.anchor.querySelector('.rt-sl-greet') as HTMLElement
        expect(greet.textContent).toContain('복')
        expect((greet.parentElement as HTMLElement).getAttribute('lang')).toBe('ko')
        const desc = fx.host.querySelector('.rt-sw-desc')!
        expect(desc.textContent).toContain('새해 복 많이 받으세요!')
        expect(desc.querySelector('span')!.getAttribute('lang')).toBe('ko')
    })

    // Guards: the final pose missing the pouch, the warm word colour or the gold edge, or leaving them after teardown.
    test('the final pose gives the word its warm tint and gold edge, and a replay clears them', async () => {
        now = BY_KEY('seollal').date
        played.add(ymd(now))
        const { ctrl, fx } = await mountScene(BY_KEY('seollal'), { language: 'ko' })
        await settle()
        const word = fx.host.querySelector('.rt-sw-word') as HTMLElement
        expect(word.classList.contains('rt-sl-warm')).toBe(true)
        expect(word.classList.contains('rt-sl-final')).toBe(true)
        expect(word.querySelector('.rt-sl-edge')!.textContent).toBe('RisuTanium')
        expect(fx.brand.querySelector('.rt-sl-pouch .rt-sl-body')).not.toBeNull()
        ctrl.destroy()
        expect(word.classList.contains('rt-sl-warm')).toBe(false)
        expect(word.querySelector('.rt-sl-edge')).toBeNull()
    })

    // Guards: the bough and the magpie leaving early on a wide stage, or their absence on a narrow one (under 240 px).
    test.each([
        [400, 5000],
        [200, 2200],
    ])('a %i px stage sends the bough away at %i ms', async (width, leaveAt) => {
        now = BY_KEY('seollal').date
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            x: 0, y: 0, left: 0, top: 0, right: width, bottom: 96, width, height: 96, toJSON: () => ({}),
        })
        const targets: Array<{ el: Element, delay: number }> = []
        const base = Element.prototype.animate
        Object.defineProperty(Element.prototype, 'animate', {
            configurable: true,
            writable: true,
            value: function animate(this: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation {
                targets.push({ el: this, delay: Number(opts.delay) || 0 })
                return base.call(this, frames, opts)
            },
        })
        const { fx } = await mountScene(BY_KEY('seollal'), { language: 'ko' })
        await settle()
        const bough = targets.filter((t) => t.el.matches('.rt-sl-bough-svg')).map((t) => t.delay)
        expect(fx.anchor.querySelector('.rt-sl-sky')).not.toBeNull()
        expect(bough).toEqual([leaveAt])
    })
})

describe('chuseok moon, twin and colour groups', () => {
    // Guards: the five-direction groups not spelling the wordmark, or the moon twin missing from the stage.
    test('six colour groups spell RisuTanium and the stage carries a moon twin', async () => {
        now = BY_KEY('chuseok').date
        const { fx } = await mountScene(BY_KEY('chuseok'), { language: 'ko' })
        await settle()
        const groups = Array.from(fx.host.querySelectorAll('.rt-cs-g'))
        expect(groups.map((g) => g.textContent).join('')).toBe('RisuTanium')
        expect(groups.map((g) => g.className.replace('rt-cs-g rt-cs-', ''))).toEqual(['cheong', 'jeok', 'hwang', 'baek', 'heuk', 'cheong'])
        expect(fx.anchor.querySelector('.rt-sw-stage .rt-cs-stagemoon .rt-cs-twin')).not.toBeNull()
        expect(fx.host.querySelector('.rt-sw-desc')!.textContent).toContain('행복한 한가위 되세요!')
    })

    // Guards: a celebratory moon staying over a running status mark (the twin follows the slot being hidden).
    test('the moon twin hides while a status runs and returns at idle', async () => {
        now = BY_KEY('chuseok').date
        const { fx } = await mountScene(BY_KEY('chuseok'), { language: 'ko' })
        await settle()
        const twin = fx.anchor.querySelector('.rt-cs-stagemoon') as HTMLElement
        expect(twin.classList.contains('rt-cs-twin-off')).toBe(false)
        fx.mark.setAttribute('data-status', 'busy')
        await settle(0)
        expect(twin.classList.contains('rt-cs-twin-off')).toBe(true)
        fx.mark.setAttribute('data-status', 'idle')
        await settle(0)
        expect(twin.classList.contains('rt-cs-twin-off')).toBe(false)
    })

    // Guards: the final pose leaving the sky or the word's own text visible, or the word width staying after teardown.
    test('the final pose paints the groups and a replay clears the word', async () => {
        now = BY_KEY('chuseok').date
        played.add(ymd(now))
        const { ctrl, fx } = await mountScene(BY_KEY('chuseok'), { language: 'ko' })
        await settle()
        const word = fx.host.querySelector('.rt-sw-word') as HTMLElement
        expect(word.classList.contains('rt-cs-final')).toBe(true)
        expect(fx.anchor.querySelector('.rt-cs-sky')!.classList.contains('rt-cs-final')).toBe(true)
        ctrl.destroy()
        expect(word.querySelector('.rt-cs-obang')).toBeNull()
        expect(word.classList.contains('rt-cs-word')).toBe(false)
    })
})

describe('hangulDay name, date line and ink strokes', () => {
    // Guards: the accessible name or description not following the Korean wordmark, or not resetting afterwards.
    test('names the logo in Korean, describes the day, and restores the name on teardown', async () => {
        now = BY_KEY('hangulDay').date
        const { ctrl, fx } = await mountScene(BY_KEY('hangulDay'), { language: 'ko' })
        await settle()
        expect(fx.host.querySelector('.rt-sw-sr')!.textContent).toBe('리스타늄')
        expect(fx.host.querySelector('.rt-sw-word')!.getAttribute('lang')).toBe('ko')
        expect(fx.host.querySelector('.rt-sw-desc')!.textContent).toContain('10월 9일 한글날')
        expect(fx.anchor.querySelector('.rt-hg-date')!.textContent).toBe('10월 9일 한글날')
        ctrl.destroy()
        expect(fx.host.querySelector('.rt-sw-sr')!.textContent).toBe('RisuTanium')
    })

    // Guards: three strokes and one dot (writing order) and the Korean wordmark halves in the word.
    test('draws three brush strokes and one dot, and the word holds both halves', async () => {
        now = BY_KEY('hangulDay').date
        const { fx } = await mountScene(BY_KEY('hangulDay'), { language: 'ko' })
        await settle()
        expect(fx.brand.querySelectorAll('.rt-hg-brush').length).toBe(3)
        expect(fx.brand.querySelectorAll('.rt-hg-stroke').length).toBe(3)
        expect(fx.brand.querySelectorAll('.rt-hg-dot').length).toBe(1)
        const ko = fx.host.querySelector('.rt-sw-word .rt-hg-ko') as HTMLElement
        expect(ko.textContent).toBe('리스타늄')
        expect(ko.getAttribute('aria-hidden')).toBe('true')
    })
})

describe('krNational variants, trigrams and flower', () => {
    const VARIANTS = [
        ['krNational samiljeol', 'samiljeol', '3·1절', 2],
        ['krNational gwangbokjeol', 'gwangbokjeol', '광복절', 4],
    ] as const

    // Guards: the date resolving to the wrong look: the greeting text, the sky class and the ribbon count (one muted ribbon on Mar 1).
    test.each(VARIANTS)('%s: greeting, sky class and written ribbons', async (label, variant, text, ribbons) => {
        const c = BY_LABEL(label)
        now = c.date
        const written: Element[] = []
        const base = Element.prototype.animate
        Object.defineProperty(Element.prototype, 'animate', {
            configurable: true,
            writable: true,
            value: function animate(this: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation {
                written.push(this)
                return base.call(this, frames, opts)
            },
        })
        const { fx, probe } = await mountScene(c, { language: 'ko' })
        await settle()
        expect(probe.ctx!.variant).toBe(variant)
        expect(fx.anchor.querySelector('.rt-kn-greet')!.textContent).toBe(text)
        expect(fx.anchor.querySelector('.rt-kn-sky')!.classList.contains('rt-kn-' + variant)).toBe(true)
        expect(written.filter((n) => n.matches('.rt-kn-rib, .rt-kn-rib-dry')).length).toBe(ribbons)
    })

    // Guards: the trigrams drifting from the flag (bar counts per bar pattern: solid 3 pieces, water 5, fire 4, earth 6).
    test('four trigrams carry the exact bar patterns', async () => {
        const c = BY_LABEL('krNational gwangbokjeol')
        now = c.date
        const { fx } = await mountScene(c, { language: 'ko' })
        await settle()
        const pieces = (name: string): number => (fx.anchor.querySelector('.rt-kn-tg-' + name)!.getAttribute('d')!.match(/M/g) ?? []).length
        expect(fx.anchor.querySelectorAll('.rt-kn-trigram').length).toBe(4)
        expect([pieces('geon'), pieces('gam'), pieces('ri'), pieces('gon')]).toEqual([3, 5, 4, 6])
    })

    // Guards: the flower missing from the word, the final pose leaving it hidden, or a node left after teardown.
    test('a flower rides the word and the final pose shows the taegeuk', async () => {
        const c = BY_LABEL('krNational samiljeol')
        now = c.date
        played.add(ymd(now))
        const { ctrl, fx } = await mountScene(c, { language: 'ko' })
        await settle()
        const word = fx.host.querySelector('.rt-sw-word') as HTMLElement
        expect(word.classList.contains('rt-kn-final')).toBe(true)
        expect(word.querySelector('.rt-kn-flower')!.getAttribute('aria-hidden')).toBe('true')
        expect(fx.brand.querySelector('.rt-kn-red')).not.toBeNull()
        expect(fx.brand.querySelector('.rt-kn-blue')).not.toBeNull()
        ctrl.destroy()
        expect(word.querySelector('.rt-kn-flower')).toBeNull()
    })
})

describe('EBS font scenes', () => {
    const PINNED = 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_one@40fb96ceb772b1b734b9569ffbb91721309bdd2b/'
    interface FontCase {
        label: string
        family: string
        file: string
        /** Elements that must take the EBS face when the font loads and keep the fallback when it does not. */
        faced: Array<{ selector: string, ebs: string, fb: string }>
    }
    const FONT_CASES: FontCase[] = [
        { label: 'seollal', family: 'EBS Juseekyung', file: 'EBSJSKMedium.woff', faced: [{ selector: '.rt-sl-greet', ebs: 'rt-sl-ebs', fb: 'rt-sl-fb' }] },
        { label: 'chuseok', family: 'EBS Juseekyung', file: 'EBSJSKMedium.woff', faced: [{ selector: '.rt-cs-greet', ebs: 'rt-cs-ebs', fb: 'rt-cs-fb' }] },
        {
            label: 'hangulDay',
            family: 'EBS Hunminjeongeum',
            file: 'EBSHunminjeongeumSBA.woff',
            faced: [
                { selector: '.rt-hg-date', ebs: 'rt-hg-ebs', fb: 'rt-hg-fb' },
                { selector: '.rt-hg-ko', ebs: 'rt-hg-ebs', fb: 'rt-hg-fb' },
            ],
        },
        { label: 'krNational samiljeol', family: 'EBS Hunminjeongeum', file: 'EBSHunminjeongeumSBA.woff', faced: [{ selector: '.rt-kn-greet', ebs: 'rt-kn-ebs', fb: 'rt-kn-fb' }] },
    ]

    function stubFonts(loaded: boolean): void {
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: {
                load: vi.fn(() => (loaded ? Promise.resolve([{ status: 'loaded', family: '' }]) : Promise.reject(new Error('blocked')))),
                forEach: () => {},
                addEventListener: () => {},
                removeEventListener: () => {},
            },
        })
    }

    describe.each(FONT_CASES)('$label', (fc) => {
        const c = BY_LABEL(fc.label)

        // Guards: a font declared from a floating tag or another host, a wrong cut, or a missing fallback timeout.
        test('declares one commit-pinned jsDelivr face at weight 400 and the host injects its @font-face', async () => {
            const def = (await c.load()).default
            expect(def.fonts).toHaveLength(1)
            const font = def.fonts![0]
            expect(font.family).toBe(fc.family)
            expect(font.url).toBe(PINNED + fc.file)
            expect(font.weight).toBe(400)
            expect(font.timeoutMs).toBe(2500)
            now = c.date
            await mountScene(c, { language: 'ko' })
            await settle()
            const style = document.head.querySelector('style[data-rt-sw-font="' + fc.family + '"]')!
            expect(style.textContent).toContain(PINNED + fc.file)
        })

        // Guards: the scene waiting on the font or taking the face before it is ready; failure must keep the fallback and the play.
        test('a failed font keeps the fallback face and the whole timeline runs', async () => {
            now = c.date
            stubFonts(false)
            const { ctrl } = await mountScene(c, { language: 'ko' })
            await settle()
            expect(animateCalls).toBeGreaterThan(0)
            await settle(c.playMs + 500)
            expect(ctrl.phase).toBe('final')
            for (const f of fc.faced) {
                const n = document.querySelector(f.selector) as HTMLElement
                expect(n.classList.contains(f.fb)).toBe(true)
                expect(n.classList.contains(f.ebs)).toBe(false)
            }
        })

        // Guards: a loaded face never reaching the greeting (the scene must take it once ctx.fonts.ready() resolved true).
        test('a loaded font is applied to the greeting', async () => {
            now = c.date
            stubFonts(true)
            const { ctrl } = await mountScene(c, { language: 'ko' })
            await settle()
            await settle(c.playMs + 500)
            expect(ctrl.phase).toBe('final')
            for (const f of fc.faced) {
                const n = document.querySelector(f.selector) as HTMLElement
                expect(n.classList.contains(f.ebs)).toBe(true)
                expect(n.classList.contains(f.fb)).toBe(false)
            }
        })
    })
})

// Records every Element.animate call (target and delay) while still returning the suite's fake animation.
function trackAnimate(): Array<{ el: Element, delay: number }> {
    const calls: Array<{ el: Element, delay: number }> = []
    const base = Element.prototype.animate
    Object.defineProperty(Element.prototype, 'animate', {
        configurable: true,
        writable: true,
        value: function animate(this: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation {
            calls.push({ el: this, delay: Number(opts.delay) || 0 })
            return base.call(this, frames, opts)
        },
    })
    return calls
}

describe('dano fan, zongzi and crowded greeting', () => {
    // Guards: the Korean look losing the fan (seven slices) or leaking the zongzi, and the description language.
    test('ko opens a seven-slice fan with the Korean greeting', async () => {
        now = BY_KEY('dano').date
        const { fx } = await mountScene(BY_KEY('dano'), { language: 'ko' })
        await settle()
        expect(fx.brand.querySelectorAll('.rt-dn-slice').length).toBe(7)
        expect(fx.brand.querySelector('.rt-dn-zongzi')).toBeNull()
        expect(fx.brand.querySelector('.rt-dn-mark')!.classList.contains('rt-dn-mark-fan')).toBe(true)
        expect(fx.anchor.querySelector('.rt-dn-greet')!.textContent).toBe('즐거운 단오 보내세요')
        expect(fx.host.querySelector('.rt-sw-desc')!.querySelector('span')!.getAttribute('lang')).toBe('ko')
    })

    // Guards: the Chinese locales losing the zongzi and its cord, or taking the wrong script tag (zh-Hans for cn and zh).
    test.each([
        ['cn', 'zh-Hans'],
        ['zh', 'zh-Hans'],
        ['zh-Hant', 'zh-Hant'],
    ])('%s wraps a zongzi tied with two cords and greets in %s', async (lang, tag) => {
        now = BY_KEY('dano').date
        const { fx } = await mountScene(BY_KEY('dano'), { language: lang })
        await settle()
        expect(fx.brand.querySelectorAll('.rt-dn-cord').length).toBe(2)
        expect(fx.brand.querySelector('.rt-dn-fan')).toBeNull()
        expect(fx.anchor.querySelector('.rt-dn-greet')!.textContent).toBe('端午安康')
        expect(fx.anchor.querySelector('.rt-dn-greetbox')!.getAttribute('lang')).toBe(tag)
        expect(fx.host.querySelector('.rt-sw-desc')!.querySelector('span')!.getAttribute('lang')).toBe(tag)
    })

    // Guards: the crowded rule (a greeting wider than 80% of the room beside the reeds enters at 2600 ms and the reeds sink first at 2100 ms).
    test.each([
        ['room for the greeting', 10, 2100, 4800],
        ['a crowded row', 1000, 2600, 2100],
    ])('%s: greeting at %i width enters at %i ms, reeds sink at %i ms', async (_name, natural, greetAt, reedsAt) => {
        now = BY_KEY('dano').date
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 96, width: 400, height: 96, toJSON: () => ({}),
        })
        vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(natural)
        const calls = trackAnimate()
        await mountScene(BY_KEY('dano'), { language: 'ko' })
        await settle()
        expect(calls.filter((t) => t.el.matches('.rt-dn-greet')).map((t) => t.delay)).toEqual([greetAt])
        expect(calls.filter((t) => t.el.matches('.rt-dn-reeds')).map((t) => t.delay)).toEqual([reedsAt])
    })
})

describe('childrenDay variants', () => {
    // Guards: the Korean look losing its twelve ribbons or four vanes, or taking carp.
    test('ko throws twelve ribbons and turns a four-vane pinwheel', async () => {
        now = BY_KEY('childrenDay').date
        const { fx } = await mountScene(BY_KEY('childrenDay'), { language: 'ko' })
        await settle()
        expect(fx.anchor.querySelectorAll('.rt-kid-ribbon').length).toBe(12)
        expect(fx.anchor.querySelectorAll('.rt-kid-carp').length).toBe(0)
        expect(fx.brand.querySelectorAll('.rt-kid-vane').length).toBe(4)
        expect(fx.brand.querySelector('.rt-kid-kabuto')).toBeNull()
        expect(fx.host.querySelector('.rt-sw-desc')!.textContent).toContain('어린이날을 축하해요!')
    })

    // Guards: the Japanese look losing its three carp, kabuto and horns, or taking ribbons.
    test('ja swims three carp and folds a kabuto with two horns', async () => {
        now = BY_KEY('childrenDay').date
        const { fx } = await mountScene(BY_KEY('childrenDay'), { language: 'ja' })
        await settle()
        expect(fx.anchor.querySelectorAll('.rt-kid-carp').length).toBe(3)
        expect(fx.anchor.querySelectorAll('.rt-kid-ribbon').length).toBe(0)
        expect(fx.brand.querySelectorAll('.rt-kid-horn').length).toBe(2)
        expect(fx.brand.querySelector('.rt-kid-vane')).toBeNull()
        expect(fx.host.querySelector('.rt-sw-desc')!.textContent).toContain('こどもの日おめでとう！')
    })
})

describe('sakura petals and the resting petal', () => {
    // Guards: the drift budget (fourteen petals) and the description in the day's language.
    test.each([
        ['ko', '벚꽃이 피는 계절이에요.'],
        ['ja', '桜の季節です。'],
    ])('%s drifts fourteen petals and describes the season', async (lang, text) => {
        now = BY_KEY('sakura').date
        const { fx } = await mountScene(BY_KEY('sakura'), { language: lang })
        await settle()
        expect(fx.anchor.querySelectorAll('.rt-skr-sky .rt-skr-petal').length).toBe(14)
        expect(fx.host.querySelector('.rt-sw-desc')!.textContent).toContain(text)
    })

    // Guards: the resting petal exposed to assistive tech, missing from the final pose, or left on the word after teardown.
    test('one aria-hidden petal rests on the word in the final pose and a replay clears it', async () => {
        now = BY_KEY('sakura').date
        played.add(ymd(now))
        const { ctrl, fx } = await mountScene(BY_KEY('sakura'), { language: 'ko' })
        await settle()
        const word = fx.host.querySelector('.rt-sw-word') as HTMLElement
        expect(word.classList.contains('rt-skr-final')).toBe(true)
        expect(word.querySelectorAll('.rt-skr-rest').length).toBe(1)
        expect(word.querySelector('.rt-skr-rest')!.getAttribute('aria-hidden')).toBe('true')
        expect(word.querySelector('.rt-skr-rest')!.getAttribute('style')).toContain('--rt-skr-ix')
        ctrl.destroy()
        expect(word.querySelector('.rt-skr-rest')).toBeNull()
        expect(word.classList.contains('rt-skr-word')).toBe(false)
    })
})

describe('starFestival magpies, tanzaku and word colours', () => {
    // Guards: the per-language bridge (eight magpies for ko and the Chinese locales, none for ja) and the ja-only wish strip.
    test.each([
        ['starFestival lunar', 'ko', 8, 0],
        ['starFestival lunar', 'cn', 8, 0],
        ['starFestival lunar', 'zh-Hant', 8, 0],
        ['starFestival tanabata', 'ja', 0, 1],
    ])('%s %s: %i magpies and %i tanzaku', async (label, lang, birds, tanzaku) => {
        const c = BY_LABEL(label)
        now = c.date
        const { fx } = await mountScene(c, { language: lang })
        await settle()
        expect(fx.anchor.querySelectorAll('.rt-tnb-magpie').length).toBe(birds)
        expect(fx.host.querySelectorAll('.rt-tnb-tanzaku').length).toBe(tanzaku)
    })

    // Guards: the twin-star arc exposed to assistive tech, the colour copies missing their text, or word state left after teardown.
    test('the arc is aria-hidden, the halves carry their text for the colour copies, and a replay clears them', async () => {
        const c = BY_LABEL('starFestival tanabata')
        now = c.date
        played.add(ymd(now))
        const { ctrl, fx } = await mountScene(c, { language: 'ja' })
        await settle()
        const word = fx.host.querySelector('.rt-sw-word') as HTMLElement
        expect(word.classList.contains('rt-tnb-final')).toBe(true)
        expect(word.querySelector('.rt-tnb-arc')!.getAttribute('aria-hidden')).toBe('true')
        expect(word.querySelector('.rt-sw-a')!.getAttribute('data-rt-tnb-text')).toBe('Risu')
        expect(word.querySelector('.rt-sw-b')!.getAttribute('data-rt-tnb-text')).toBe('Tanium')
        ctrl.destroy()
        expect(word.querySelector('.rt-tnb-arc')).toBeNull()
        expect(word.querySelector('.rt-sw-a')!.hasAttribute('data-rt-tnb-text')).toBe(false)
        expect(word.querySelector('.rt-sw-a')!.classList.contains('rt-tnb-risu')).toBe(false)
    })
})

function rectOf(width: number, height = 96): DOMRect {
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) }
}

// Every HTML element measures 400 px wide except the word, which measures `wordWidth`, so the room beside the word is explicit.
function mockRects(wordWidth: number): void {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return rectOf(this.classList.contains('rt-sw-word') ? wordWidth : 400)
    })
}

describe('springFestival variants, crowded rule and word motif', () => {
    // Guards: the Chinese locales losing the two sky lanterns, the lattice mark, the knot on the word, or the script tag of the greeting.
    test.each([
        ['cn', 'zh-Hans', '新春快乐'],
        ['zh', 'zh-Hans', '新春快乐'],
        ['zh-Hant', 'zh-Hant', '新春快樂'],
    ])('%s: two sky lanterns, lattice mark, knot and a %s greeting', async (lang, tag, text) => {
        now = BY_KEY('springFestival').date
        const { fx } = await mountScene(BY_KEY('springFestival'), { language: lang })
        await settle()
        expect(fx.anchor.querySelectorAll('.rt-sf-rise').length).toBe(2)
        expect(fx.anchor.querySelector('.rt-sf-branch')).toBeNull()
        expect(fx.brand.querySelectorAll('.rt-sf-lattice').length).toBe(1)
        expect(fx.brand.querySelectorAll('.rt-sf-tassel').length).toBe(1)
        expect(fx.host.querySelector('.rt-sw-word .rt-sf-k-body')).not.toBeNull()
        expect(fx.anchor.querySelector('.rt-sf-greet')!.textContent).toBe(text)
        expect(fx.anchor.querySelector('.rt-sf-greetbox')!.getAttribute('lang')).toBe(tag)
        expect(fx.host.querySelector('.rt-sw-desc')!.querySelector('span')!.getAttribute('lang')).toBe(tag)
    })

    // Guards: the Vietnamese look losing the hoa mai branch, its six petals, the blossom mark or the blossom on the word, or taking lanterns.
    test('vi: a hoa mai branch with six petals, a blossom mark and a blossom on the word', async () => {
        now = BY_KEY('springFestival').date
        const { fx } = await mountScene(BY_KEY('springFestival'), { language: 'vi' })
        await settle()
        expect(fx.anchor.querySelectorAll('.rt-sf-branch').length).toBe(1)
        expect(fx.anchor.querySelectorAll('.rt-sf-fall').length).toBe(6)
        expect(fx.anchor.querySelector('.rt-sf-rise')).toBeNull()
        expect(fx.brand.querySelectorAll('.rt-sf-p').length).toBe(5)
        expect(fx.brand.querySelector('.rt-sf-lattice')).toBeNull()
        expect(fx.host.querySelector('.rt-sw-word .rt-sf-motif-vi')).not.toBeNull()
        expect(fx.anchor.querySelector('.rt-sf-greet')!.textContent).toBe('Chúc Mừng Năm Mới')
        expect(fx.host.querySelector('.rt-sw-desc')!.querySelector('span')!.getAttribute('lang')).toBe('vi')
    })

    // Guards: the crowded rule (a greeting that would shrink by more than 20% beside the props enters at 2000 ms and the props leave first).
    test.each([
        ['cn', 'room beside the props', 10, 1400, '.rt-sf-rise', [300, 900]],
        ['cn', 'a crowded row', 1000, 2000, '.rt-sf-rise', [200, 450]],
        ['vi', 'room beside the props', 10, 1400, '.rt-sf-branch-svg', [4400]],
        ['vi', 'a crowded row', 1000, 2000, '.rt-sf-branch-svg', [1500]],
    ])('%s, %s (natural width %i): greeting at %i ms, %s at %j', async (lang, _name, natural, greetAt, selector, propsAt) => {
        now = BY_KEY('springFestival').date
        mockRects(60)
        vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(natural)
        const calls = trackAnimate()
        await mountScene(BY_KEY('springFestival'), { language: lang })
        await settle()
        expect(calls.filter((t) => t.el.matches('.rt-sf-greet')).map((t) => t.delay)).toEqual([greetAt])
        expect(calls.filter((t) => t.el.matches(selector)).map((t) => t.delay)).toEqual(propsAt)
    })

    // Guards: the warm word copy missing its text in the final pose, or the motif and copy staying on the word after teardown.
    test('the final pose paints the warm copy and the motif, and a replay clears them', async () => {
        now = BY_KEY('springFestival').date
        played.add(ymd(now))
        const { ctrl, fx } = await mountScene(BY_KEY('springFestival'), { language: 'cn' })
        await settle()
        const word = fx.host.querySelector('.rt-sw-word') as HTMLElement
        expect(word.classList.contains('rt-sf-final')).toBe(true)
        expect(word.querySelector('.rt-sf-warm')!.textContent).toBe('RisuTanium')
        expect(word.querySelector('.rt-sf-motif')!.getAttribute('aria-hidden')).toBe('true')
        ctrl.destroy()
        expect(word.querySelector('.rt-sf-warm, .rt-sf-motif')).toBeNull()
        expect(word.classList.contains('rt-sf-word')).toBe(false)
    })
})

describe('midAutumn greeting, layout mode and amber word', () => {
    // Guards: the greeting taking the wrong script or text, or the stage missing the clouds, moon and lantern.
    test.each([
        ['cn', 'zh-Hans', '中秋快乐'],
        ['zh', 'zh-Hans', '中秋快乐'],
        ['zh-Hant', 'zh-Hant', '中秋快樂'],
    ])('%s greets in %s with two cloud banks, a moon and a lantern', async (lang, tag, text) => {
        now = BY_KEY('midAutumn').date
        const { fx } = await mountScene(BY_KEY('midAutumn'), { language: lang })
        await settle()
        const greet = fx.anchor.querySelector('.rt-ma-greet') as HTMLElement
        expect(greet.textContent).toBe(text)
        expect(greet.getAttribute('lang')).toBe(tag)
        expect(fx.anchor.querySelectorAll('.rt-ma-cloud').length).toBe(2)
        expect(fx.anchor.querySelectorAll('.rt-ma-moon, .rt-ma-lantern').length).toBe(2)
        expect(fx.host.querySelector('.rt-sw-word .rt-ma-motif')!.getAttribute('aria-hidden')).toBe('true')
    })

    // Guards: the layout rule (room beside the word keeps it dimmed under the greeting from 2300 ms; otherwise the greeting takes its place and the word is hidden at 0 ms).
    test.each([
        ['room for the greeting beside the word', 10, 'beside', [2300, 6100]],
        ['a greeting wider than the room', 1000, 'over', [0, 6100]],
    ])('%s: %s layout, word animations at %j', async (_name, natural, mode, wordAt) => {
        now = BY_KEY('midAutumn').date
        mockRects(60)
        vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(natural)
        const calls = trackAnimate()
        const { fx } = await mountScene(BY_KEY('midAutumn'), { language: 'cn' })
        await settle()
        expect(fx.anchor.querySelector('.rt-ma-sky')!.getAttribute('data-rt-ma-mode')).toBe(mode)
        expect(calls.filter((t) => t.el.matches('.rt-sw-text')).map((t) => t.delay)).toEqual(wordAt)
    })

    // Guards: the final pose missing the amber word, or the classes and motif staying on the word after teardown.
    test('the final pose turns the word amber and a replay clears it', async () => {
        now = BY_KEY('midAutumn').date
        played.add(ymd(now))
        const { ctrl, fx } = await mountScene(BY_KEY('midAutumn'), { language: 'cn' })
        await settle()
        const word = fx.host.querySelector('.rt-sw-word') as HTMLElement
        expect(word.classList.contains('rt-ma-final')).toBe(true)
        expect(word.classList.contains('rt-ma-amber')).toBe(true)
        expect(word.querySelector('.rt-ma-risu')!.textContent).toBe('Risu')
        expect(word.querySelector('.rt-ma-tan')!.textContent).toBe('Tanium')
        ctrl.destroy()
        expect(word.querySelector('.rt-ma-motif')).toBeNull()
        expect(word.querySelector('.rt-ma-risu, .rt-ma-tan')).toBeNull()
        expect(word.classList.contains('rt-ma-amber')).toBe(false)
    })
})

describe('tsukimi susuki, dango and plume', () => {
    // Guards: the stage losing a susuki, the offering losing a dango or the order they are set down in, or the greeting language.
    test('three susuki, six dango set down in order and a Japanese greeting', async () => {
        now = BY_KEY('tsukimi').date
        const { fx } = await mountScene(BY_KEY('tsukimi'), { language: 'ja' })
        await settle()
        expect(fx.anchor.querySelectorAll('.rt-tk-stalk').length).toBe(3)
        const order = Array.from(fx.brand.querySelectorAll('.rt-tk-d')).map((n) => Number(n.getAttribute('data-order'))).sort()
        expect(order).toEqual([0, 1, 2, 3, 4, 5])
        expect(fx.anchor.querySelector('.rt-tk-textbox')!.getAttribute('lang')).toBe('ja')
        expect(fx.host.querySelector('.rt-sw-desc')!.textContent).toContain('中秋の名月')
    })

    // Guards: the layout rule (a wide stage puts the moon right of the greeting, a narrow one fits it) and the plume omitted where the row has no room right of the word.
    test.each([
        ['wide stage, room right of the word', 10, 60, 'wide', false],
        ['narrow stage, room right of the word', 1000, 60, 'narrow', false],
        ['no room right of the word', 10, 400, 'wide', true],
    ])('%s: %s mode, plume off %s', async (_name, natural, wordWidth, mode, plumeOff) => {
        now = BY_KEY('tsukimi').date
        mockRects(wordWidth)
        vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(natural)
        const { fx } = await mountScene(BY_KEY('tsukimi'), { language: 'ja' })
        await settle()
        expect(fx.anchor.querySelector('.rt-tk-sky')!.getAttribute('data-rt-tk-mode')).toBe(mode)
        expect(fx.host.querySelector('.rt-sw-word .rt-tk-plumebox')!.classList.contains('rt-tk-plume-off')).toBe(plumeOff)
    })

    // Guards: the silver-gold copy missing its halves in the final pose, or the copy and plume staying on the word after teardown.
    test('the final pose paints the silver-gold halves and a replay clears them and the plume', async () => {
        now = BY_KEY('tsukimi').date
        played.add(ymd(now))
        const { ctrl, fx } = await mountScene(BY_KEY('tsukimi'), { language: 'ja' })
        await settle()
        const word = fx.host.querySelector('.rt-sw-word') as HTMLElement
        expect(word.classList.contains('rt-tk-final')).toBe(true)
        expect(word.querySelector('.rt-tk-a')!.textContent).toBe('Risu')
        expect(word.querySelector('.rt-tk-b')!.textContent).toBe('Tanium')
        expect(word.querySelector('.rt-tk-plumebox')!.getAttribute('aria-hidden')).toBe('true')
        ctrl.destroy()
        expect(word.querySelector('.rt-tk-gold, .rt-tk-plumebox')).toBeNull()
        expect(word.classList.contains('rt-tk-word')).toBe(false)
    })
})

describe('obon hanabi, ripples and lantern', () => {
    // Guards: the node budget (four rings, five ripples) and the lantern losing its reflection dashes or the description.
    test('four hanabi rings, five ripples, two reflection dashes and the day described in Japanese', async () => {
        now = BY_KEY('obon').date
        const { fx } = await mountScene(BY_KEY('obon'), { language: 'ja' })
        await settle()
        const bursts = Array.from(fx.anchor.querySelectorAll('.rt-ob-burst'))
        expect(bursts.length).toBe(4)
        for (const b of bursts) expect(b.querySelector('.rt-ob-ring-in')).not.toBeNull()
        expect(fx.anchor.querySelectorAll('.rt-ob-ripple').length).toBe(5)
        expect(fx.brand.querySelectorAll('.rt-ob-dash').length).toBe(2)
        expect(fx.host.querySelector('.rt-sw-desc')!.querySelector('span')!.getAttribute('lang')).toBe('ja')
    })

    // Guards: the burst layout rule (room right of the word blooms rings there; otherwise all four stay in the band above the word).
    test.each([
        ['room right of the word', 60, 'wide'],
        ['no room right of the word', 400, 'band'],
    ])('%s: %s layout', async (_name, wordWidth, mode) => {
        now = BY_KEY('obon').date
        mockRects(wordWidth)
        const { fx } = await mountScene(BY_KEY('obon'), { language: 'ja' })
        await settle()
        expect(fx.anchor.querySelector('.rt-ob-sky')!.getAttribute('data-rt-ob-mode')).toBe(mode)
    })

    // Guards: the Tanium edge copy missing its text source, or the attribute and class staying on the word after teardown.
    test('Tanium carries its edge text in the final pose and a replay clears it', async () => {
        now = BY_KEY('obon').date
        played.add(ymd(now))
        const { ctrl, fx } = await mountScene(BY_KEY('obon'), { language: 'ja' })
        await settle()
        const word = fx.host.querySelector('.rt-sw-word') as HTMLElement
        const tan = word.querySelector('.rt-ob-tan') as HTMLElement
        expect(word.classList.contains('rt-ob-final')).toBe(true)
        expect(tan.getAttribute('data-rt-ob-text')).toBe('Tanium')
        ctrl.destroy()
        expect(tan.hasAttribute('data-rt-ob-text')).toBe(false)
        expect(tan.classList.contains('rt-ob-tan')).toBe(false)
    })
})

describe('bunkaNoHi name, seigaiha and kana width', () => {
    // Guards: the accessible name or description not following the kana wordmark, or not resetting afterwards.
    test('names the logo in katakana, describes the day, shows the date line and restores the name', async () => {
        now = BY_KEY('bunkaNoHi').date
        const { ctrl, fx } = await mountScene(BY_KEY('bunkaNoHi'), { language: 'ja' })
        await settle()
        expect(fx.host.querySelector('.rt-sw-sr')!.textContent).toBe('リスタニウム')
        expect(fx.host.querySelector('.rt-sw-desc')!.textContent).toContain('11月3日 文化の日')
        expect(fx.anchor.querySelector('.rt-bk-date')!.textContent).toBe('11月3日 文化の日')
        const ja = fx.host.querySelector('.rt-sw-word .rt-bk-ja') as HTMLElement
        expect(ja.textContent).toBe('リスタニウム')
        expect(ja.getAttribute('aria-hidden')).toBe('true')
        ctrl.destroy()
        expect(fx.host.querySelector('.rt-sw-sr')!.textContent).toBe('RisuTanium')
    })

    // Guards: the wave field losing a row (six) or the seal, which holds no characters.
    test('six seigaiha rows and one character-free seal', async () => {
        now = BY_KEY('bunkaNoHi').date
        const { fx } = await mountScene(BY_KEY('bunkaNoHi'), { language: 'ja' })
        await settle()
        expect(fx.brand.querySelectorAll('.rt-bk-row').length).toBe(6)
        expect(fx.brand.querySelectorAll('.rt-bk-seal').length).toBe(1)
        expect(fx.brand.querySelector('.rt-bk-seal')!.querySelector('text')).toBeNull()
    })

    // Guards: the word box width rule (a kana run wider than the everyday box is set smaller, never wider) and the width variable.
    test('a kana run wider than the word box is set smaller and the box width is kept', async () => {
        now = BY_KEY('bunkaNoHi').date
        mockRects(100)
        vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(200)
        const { fx } = await mountScene(BY_KEY('bunkaNoHi'), { language: 'ja' })
        await settle()
        const word = fx.host.querySelector('.rt-sw-word') as HTMLElement
        expect((word.querySelector('.rt-bk-ja') as HTMLElement).style.fontSize).toBe('0.5em')
        expect(word.style.getPropertyValue('--rt-bk-w')).toBe('100px')
    })

    // Guards: a font-loading listener left on the document after the scene is gone.
    test('every loadingdone listener the scene adds is removed on destroy', async () => {
        now = BY_KEY('bunkaNoHi').date
        const add = vi.fn()
        const remove = vi.fn()
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: { load: vi.fn(() => Promise.reject(new Error('blocked'))), forEach: () => {}, addEventListener: add, removeEventListener: remove },
        })
        const { ctrl } = await mountScene(BY_KEY('bunkaNoHi'), { language: 'ja' })
        await settle()
        const added = add.mock.calls.filter((c: unknown[]) => c[0] === 'loadingdone').map((c: unknown[]) => c[1])
        expect(added.length).toBeGreaterThan(0)
        ctrl.destroy()
        const removed = remove.mock.calls.filter((c: unknown[]) => c[0] === 'loadingdone').map((c: unknown[]) => c[1])
        expect(added.every((fn: unknown) => removed.includes(fn))).toBe(true)
    })
})

describe('stPatricksDay clovers, shamrock mark and tucked shamrock', () => {
    // Guards: the node budget (eight drifting clovers, three mark leaves) and the description of the day.
    test.each(WESTERN_LANGS)('%s: eight clovers, three leaves, a tucked shamrock and the day described in English', async (lang) => {
        now = BY_KEY('stPatricksDay').date
        const { fx } = await mountScene(BY_KEY('stPatricksDay'), { language: lang })
        await settle()
        expect(fx.anchor.querySelectorAll('.rt-sp-drift').length).toBe(8)
        expect(fx.brand.querySelectorAll('.rt-sp-leaf').length).toBe(3)
        const tuck = fx.host.querySelector('.rt-sw-word .rt-sp-tuck') as HTMLElement
        expect(tuck.getAttribute('aria-hidden')).toBe('true')
        const desc = fx.host.querySelector('.rt-sw-desc')!
        expect(desc.textContent).toContain('Happy St. Patrick’s Day!')
        expect(desc.querySelector('span')!.getAttribute('lang')).toBe('en')
    })

    // Guards: the emerald-cyan copy missing its text source in the final pose, or the shamrock and copy staying on the word.
    test('the final pose paints "Risu" and a replay clears the copy and the shamrock', async () => {
        now = BY_KEY('stPatricksDay').date
        played.add(ymd(now))
        const { ctrl, fx } = await mountScene(BY_KEY('stPatricksDay'))
        await settle()
        const word = fx.host.querySelector('.rt-sw-word') as HTMLElement
        const risu = word.querySelector('.rt-sp-risu') as HTMLElement
        expect(word.classList.contains('rt-sp-final')).toBe(true)
        expect(risu.getAttribute('data-rt-sp-text')).toBe('Risu')
        ctrl.destroy()
        expect(word.querySelector('.rt-sp-tuck')).toBeNull()
        expect(risu.hasAttribute('data-rt-sp-text')).toBe(false)
        expect(risu.classList.contains('rt-sp-risu')).toBe(false)
        expect(word.classList.contains('rt-sp-word')).toBe(false)
    })
})

describe('easter greeting, egg and bunny ears', () => {
    // Guards: the greeting not following the language, or its description not tagged with that language.
    test.each([
        ['en', 'Happy Easter!'],
        ['de', 'Frohe Ostern!'],
        ['es', '¡Felices Pascuas!'],
    ])('%s greets with %s', async (lang, text) => {
        now = BY_KEY('easter').date
        const { fx } = await mountScene(BY_KEY('easter'), { language: lang })
        await settle()
        const desc = fx.host.querySelector('.rt-sw-desc')!
        expect(desc.textContent).toContain(text)
        expect(desc.querySelector('span')!.getAttribute('lang')).toBe(lang)
    })

    // Guards: the egg losing a chevron stripe (three) or the word losing an ear (two), and the ears being exposed to assistive tech.
    test('three chevron stripes, two ears and an aria-hidden ear box', async () => {
        now = BY_KEY('easter').date
        const { fx } = await mountScene(BY_KEY('easter'))
        await settle()
        expect(fx.brand.querySelectorAll('.rt-ea-chev').length).toBe(3)
        const ears = fx.host.querySelector('.rt-sw-word .rt-ea-ears') as HTMLElement
        expect(ears.getAttribute('aria-hidden')).toBe('true')
        expect(ears.querySelectorAll('.rt-ea-ear').length).toBe(2)
    })

    // Guards: the right ear flop being dropped from the timeline (it starts at 5800 ms), or the ears left on the word after teardown.
    test('the right ear flops at 5800 ms and the final pose and a replay leave no ears behind', async () => {
        now = BY_KEY('easter').date
        const calls = trackAnimate()
        const { ctrl, fx } = await mountScene(BY_KEY('easter'))
        await settle()
        expect(calls.filter((c) => c.el.matches('.rt-ea-ear-r')).map((c) => c.delay)).toEqual([5150, 5800])
        await settle(BY_KEY('easter').playMs)
        const word = fx.host.querySelector('.rt-sw-word') as HTMLElement
        expect(word.classList.contains('rt-ea-final')).toBe(true)
        ctrl.destroy()
        expect(word.querySelector('.rt-ea-ears')).toBeNull()
        expect(word.classList.contains('rt-ea-word')).toBe(false)
    })
})

describe('summerSolstice fireflies, lantern and resting firefly', () => {
    // Guards: the firefly budget rule (18 on a wide stage, 12 under 260 px) and the lantern losing a trapped spark (three).
    test.each([
        [400, 18],
        [200, 12],
    ])('a %i px stage shows %i fireflies and the lantern holds three sparks', async (width, flies) => {
        now = BY_KEY('summerSolstice').date
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rectOf(width))
        const { fx } = await mountScene(BY_KEY('summerSolstice'))
        await settle()
        const shown = Array.from(fx.anchor.querySelectorAll<HTMLElement>('.rt-ss-fly')).filter((n) => n.style.display !== 'none')
        expect(shown.length).toBe(flies)
        expect(fx.brand.querySelectorAll('.rt-ss-spark').length).toBe(3)
    })

    // Guards: the resting firefly leaving the word box's tree (it must be aria-hidden and gone after teardown), and the final pose.
    test('a firefly rests on the word, aria-hidden, in the final pose and a replay removes it', async () => {
        now = BY_KEY('summerSolstice').date
        played.add(ymd(now))
        const { ctrl, fx } = await mountScene(BY_KEY('summerSolstice'))
        await settle()
        const word = fx.host.querySelector('.rt-sw-word') as HTMLElement
        const rest = word.querySelector('.rt-ss-rest') as HTMLElement
        expect(rest.getAttribute('aria-hidden')).toBe('true')
        expect(word.classList.contains('rt-ss-final')).toBe(true)
        ctrl.destroy()
        expect(word.querySelector('.rt-ss-rest')).toBeNull()
        expect(word.classList.contains('rt-ss-word')).toBe(false)
    })
})

describe('thanksgiving greeting placement, leaves and sheaf', () => {
    // Every HTML element measures 400 x 96 except the word and the greeting, so the room beside and below the word is explicit.
    function mockGeometry(word: { top: number, width: number, height: number }): void {
        const rect = (left: number, top: number, width: number, height: number): DOMRect =>
            ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) })
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            if (this.classList.contains('rt-sw-word')) return rect(20, word.top, word.width, word.height)
            if (this.classList.contains('rt-tg-greet')) return rect(0, 0, 80, 14)
            return rect(0, 0, 400, 96)
        })
    }

    // Guards: the placement rule (beside the word with room, below it with room for 11 px text, otherwise in the word's place with
    // the word fading out for the greeting).
    test.each([
        ['room beside the word', { top: 10, width: 100, height: 29 }, 'side', 0],
        ['no room beside, room below', { top: 10, width: 330, height: 29 }, 'below', 0],
        ['no room anywhere', { top: 60, width: 330, height: 30 }, 'over', 1],
    ])('%s: %s placement and %i word fade', async (_name, word, mode, wordFades) => {
        now = BY_KEY('thanksgiving').date
        mockGeometry(word)
        const calls = trackAnimate()
        const { fx } = await mountScene(BY_KEY('thanksgiving'))
        await settle()
        expect(fx.anchor.querySelector('.rt-tg-sky')!.getAttribute('data-greet')).toBe(mode)
        expect(calls.filter((c) => c.el.matches('.rt-sw-word')).length).toBe(wordFades)
    })

    // Guards: the node budget (ten leaves, three wheat stalks, five sheaf stalks) and the greeting text and description.
    test('ten leaves, three wheat stalks, a five-stalk sheaf and the greeting described in English', async () => {
        now = BY_KEY('thanksgiving').date
        const { fx } = await mountScene(BY_KEY('thanksgiving'))
        await settle()
        expect(fx.anchor.querySelectorAll('.rt-tg-leaf').length).toBe(10)
        expect(fx.anchor.querySelectorAll('.rt-tg-wheat').length).toBe(3)
        expect(fx.brand.querySelectorAll('.rt-tg-stalk').length).toBe(5)
        expect(fx.anchor.querySelector('.rt-tg-greet')!.textContent).toBe('Happy Thanksgiving')
        expect(fx.host.querySelector('.rt-sw-desc')!.textContent).toContain('Happy Thanksgiving!')
    })

    // Guards: the perched leaf being exposed to assistive tech, the Tanium edge copy losing its text source, or either staying on the word.
    test('the final pose perches a hidden leaf on the T and edges Tanium, and a replay clears both', async () => {
        now = BY_KEY('thanksgiving').date
        played.add(ymd(now))
        const { ctrl, fx } = await mountScene(BY_KEY('thanksgiving'))
        await settle()
        const word = fx.host.querySelector('.rt-sw-word') as HTMLElement
        const tan = word.querySelector('.rt-tg-tan') as HTMLElement
        expect(word.classList.contains('rt-tg-final')).toBe(true)
        expect(word.querySelector('.rt-tg-perch')!.getAttribute('aria-hidden')).toBe('true')
        expect(tan.getAttribute('data-rt-tg-text')).toBe('Tanium')
        ctrl.destroy()
        expect(word.querySelector('.rt-tg-perch')).toBeNull()
        expect(tan.hasAttribute('data-rt-tg-text')).toBe(false)
        expect(tan.classList.contains('rt-tg-tan')).toBe(false)
    })
})

describe('independenceDay fireworks, star and sparkler', () => {
    // Guards: the node budget (three bursts, five star points, three twinkles) and the description of the day.
    test('three fireworks, a five-point star, three twinkles and the day described in English', async () => {
        now = BY_KEY('independenceDay').date
        const { fx } = await mountScene(BY_KEY('independenceDay'))
        await settle()
        expect(fx.anchor.querySelectorAll('.rt-id-fw > g').length).toBe(3)
        expect(fx.brand.querySelectorAll('.rt-id-pt').length).toBe(5)
        expect(fx.brand.querySelectorAll('.rt-id-tw').length).toBe(3)
        const desc = fx.host.querySelector('.rt-sw-desc')!
        expect(desc.textContent).toContain('Happy 4th of July!')
        expect(desc.querySelector('span')!.getAttribute('lang')).toBe('en')
    })

    // Guards: the twilight and the star being the only things shown (a final pose that leaves the fireworks stage visible).
    test('the final pose hides the stage and keeps the glass badge with a hidden sparkler, and a replay clears the word', async () => {
        now = BY_KEY('independenceDay').date
        played.add(ymd(now))
        const { ctrl, fx } = await mountScene(BY_KEY('independenceDay'))
        await settle()
        const word = fx.host.querySelector('.rt-sw-word') as HTMLElement
        expect(word.classList.contains('rt-id-final')).toBe(true)
        expect(fx.anchor.querySelector('.rt-id-sky')!.classList.contains('rt-id-final')).toBe(true)
        expect(fx.brand.querySelector('.rt-id-glass')).not.toBeNull()
        expect(word.querySelector('.rt-id-spark')!.getAttribute('aria-hidden')).toBe('true')
        ctrl.destroy()
        expect(word.querySelector('.rt-id-spark')).toBeNull()
        expect(word.classList.contains('rt-id-word')).toBe(false)
    })
})

describe('western scenes release their font-loading listeners', () => {
    // Guards: a loadingdone listener left on the document after the scene is gone.
    test.each(['stPatricksDay', 'easter', 'summerSolstice', 'thanksgiving', 'independenceDay'] as const)('%s removes every loadingdone listener it adds', async (key) => {
        const c = BY_KEY(key)
        now = c.date
        const add = vi.fn()
        const remove = vi.fn()
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: { load: vi.fn(() => Promise.reject(new Error('blocked'))), forEach: () => {}, addEventListener: add, removeEventListener: remove },
        })
        const { ctrl } = await mountScene(c)
        await settle()
        const added = add.mock.calls.filter((a: unknown[]) => a[0] === 'loadingdone').map((a: unknown[]) => a[1])
        expect(added.length).toBeGreaterThan(0)
        ctrl.destroy()
        const removed = remove.mock.calls.filter((a: unknown[]) => a[0] === 'loadingdone').map((a: unknown[]) => a[1])
        expect(added.every((fn: unknown) => removed.includes(fn))).toBe(true)
    })
})
