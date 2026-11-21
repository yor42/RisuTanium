// @vitest-environment jsdom

/**
 * Seasonal logo host. A fake scene module drives it (no real scene exists under ./scenes), the clock and the
 * once-a-day record are injected, timers are fake. Each test names the defect it guards; all are regression
 * reproducers for the host's rules unless a comment says compatibility guard.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PLAIN_WORDMARK_HTML, mountSeasonal, type HostController, type HostOptions, type SeasonalStrings } from './host'
import type { SceneContext, SceneDef, SceneFont } from './sceneTypes'

const CHRISTMAS = new Date(2026, 11, 25, 12, 0, 0)
const CHRISTMAS_NEXT_YEAR = new Date(2027, 11, 25, 12, 0, 0)
const ORDINARY_DAY = new Date(2026, 10, 21, 12, 0, 0)
const LINK = 'https://github.com/yor42/RisuTanium'

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

interface FakeScene {
    def: SceneDef
    calls: { builds: number, play: number, finish: number, destroy: number }
    ctx: () => SceneContext
}

function fakeScene(over: { durationMs?: number, play?: () => void | Promise<void>, fonts?: SceneFont[], onBuild?: (ctx: SceneContext) => void } = {}): FakeScene {
    const calls = { builds: 0, play: 0, finish: 0, destroy: 0 }
    let last: SceneContext | null = null
    const def: SceneDef = {
        key: 'christmas',
        durationMs: over.durationMs ?? 4000,
        fonts: over.fonts,
        build(ctx) {
            calls.builds++
            last = ctx
            over.onBuild?.(ctx)
            return {
                play() {
                    calls.play++
                    return over.play?.()
                },
                finish() { calls.finish++ },
                destroy() { calls.destroy++ },
            }
        },
    }
    return { def, calls, ctx: () => last! }
}

let hidden = false
let now = CHRISTMAS
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

function mountHost(scene: FakeScene | null, over: Partial<HostOptions> = {}, fx = fixture()): { ctrl: HostController, fx: ReturnType<typeof fixture>, load: ReturnType<typeof vi.fn> } {
    const load = vi.fn(async () => (scene ? scene.def : null))
    const ctrl = mountSeasonal(fx.host, {
        language: 'en',
        strings,
        now: () => now,
        loadScene: load,
        playedToday: (ymd) => played.has(ymd),
        markPlayed: (ymd) => { played.add(ymd) },
        anchorEl: fx.anchor,
        brandEl: fx.brand,
        fitEl: fx.brand,
        markEl: fx.mark,
        reducedMotion: () => false,
        lowPower: () => false,
        anniversaryUrl: LINK,
        ...over,
    })
    mounted.push(ctrl)
    return { ctrl, fx, load }
}

// Lets the scene load, the top-bar stability wait (capped at 600 ms) and the build run.
async function settle(ms = 700): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms)
}

// Advances in 1 ms steps until the scene has been built, so later timings are measured from the build.
async function untilBuilt(scene: FakeScene): Promise<void> {
    for (let i = 0; i < 1000 && scene.calls.builds === 0; i++) await vi.advanceTimersByTimeAsync(1)
    expect(scene.calls.builds).toBe(1)
}

beforeEach(() => {
    vi.useFakeTimers()
    hidden = false
    now = CHRISTMAS
    played = new Set()
    mounted = []
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
})

afterEach(() => {
    for (const c of mounted) c.destroy()
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete (document as unknown as { hidden?: boolean }).hidden
    document.body.innerHTML = ''
    document.head.querySelectorAll('style[data-rt-sw-font]').forEach((s) => s.remove())
    delete (document as unknown as { fonts?: unknown }).fonts
})

describe('once a day', () => {
    // Guards: the first view of the day not playing, or the day not being recorded (it would replay on every view).
    test('the first view plays the scene, records the day and ends in the final pose when play settles', async () => {
        let done: () => void = () => {}
        const scene = fakeScene({ play: () => new Promise<void>((r) => { done = r }) })
        const { ctrl, fx } = mountHost(scene)
        await settle()
        expect(scene.calls.play).toBe(1)
        expect(ctrl.phase).toBe('playing')
        // The brand cell reserves room for the final pose's right overflow while an occasion shows.
        expect(fx.brand.hasAttribute('data-seasonal-active')).toBe(true)
        expect(played.has('2026-12-25')).toBe(true)
        done()
        await settle(1)
        expect(ctrl.phase).toBe('final')
    })

    // Guards: a second view the same day replaying (or finishing before building), instead of jumping to the final pose.
    test('a later view the same day shows the final pose without play()', async () => {
        played.add('2026-12-25')
        const scene = fakeScene()
        const { ctrl } = mountHost(scene)
        await settle()
        expect(scene.calls.play).toBe(0)
        expect(scene.calls.finish).toBe(1)
        expect(ctrl.phase).toBe('final')
    })

    // Guards: "played ever" stored as a flag, so the next occasion year never animated.
    test('the same date a year later plays again', async () => {
        const first = fakeScene({ play: () => new Promise<void>(() => {}) })
        const a = mountHost(first)
        await settle()
        expect(first.calls.play).toBe(1)
        a.ctrl.destroy()
        now = CHRISTMAS_NEXT_YEAR
        const second = fakeScene({ play: () => new Promise<void>(() => {}) })
        mountHost(second)
        await settle()
        expect(second.calls.play).toBe(1)
        expect(played.has('2027-12-25')).toBe(true)
    })

    // Guards: reduced motion or low power starting play(); the day must not be burned by a view that showed no animation.
    test.each([
        ['reduced motion', { reducedMotion: () => true }],
        ['low power', { lowPower: () => true }],
    ])('%s calls finish() without play() and does not record the day', async (_name, over) => {
        const scene = fakeScene()
        const { ctrl, fx } = mountHost(scene, over)
        await settle()
        expect(scene.calls.play).toBe(0)
        expect(scene.calls.finish).toBe(1)
        expect(ctrl.phase).toBe('final')
        expect(played.size).toBe(0)
        // Not interactive: the word is plain text, there is nothing to replay.
        expect(fx.host.querySelector('.rt-sw-word')!.hasAttribute('role')).toBe(false)
    })

    // Guards: the app staying open past midnight into an occasion playing the animation under the user's eyes.
    test('a new day while the host is open shows the final pose, not the animation', async () => {
        now = ORDINARY_DAY
        const scene = fakeScene()
        const { ctrl, load } = mountHost(scene)
        await settle()
        expect(load).not.toHaveBeenCalled()
        now = CHRISTMAS
        document.dispatchEvent(new Event('visibilitychange'))
        await settle()
        expect(ctrl.occasion).toBe('christmas')
        expect(scene.calls.play).toBe(0)
        expect(scene.calls.finish).toBe(1)
        expect(ctrl.phase).toBe('final')
    })
})

describe('skip, replay and watchdog', () => {
    // Guards: skip not ending the scene (finish() never called) or ending it twice.
    test.each([
        ['Escape', (fx: ReturnType<typeof fixture>) => { void fx; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) }],
        ['click on the word', (fx: ReturnType<typeof fixture>) => { fx.host.querySelector('.rt-sw-word')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) }],
        ['Enter on the word', (fx: ReturnType<typeof fixture>) => { fx.host.querySelector('.rt-sw-word')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) }],
        ['Space on the word', (fx: ReturnType<typeof fixture>) => { fx.host.querySelector('.rt-sw-word')!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })) }],
    ])('%s skips a running scene to the final pose once', async (_name, act) => {
        const scene = fakeScene({ play: () => new Promise<void>(() => {}) })
        const { ctrl, fx } = mountHost(scene)
        await settle()
        expect(ctrl.phase).toBe('playing')
        expect(fx.host.querySelector('.rt-sw-word')!.getAttribute('role')).toBe('button')
        act(fx)
        expect(ctrl.phase).toBe('final')
        expect(scene.calls.finish).toBe(1)
        act(fx)
        expect(scene.calls.finish).toBe(1)
    })

    // Guards: no replay after the end, or replay not rebuilding the scene from a clean state.
    test('after the end the word is a replay button and activating it rebuilds and plays again', async () => {
        const scene = fakeScene({ play: () => Promise.resolve() })
        const { ctrl, fx } = mountHost(scene)
        await settle()
        await settle(1)
        expect(ctrl.phase).toBe('final')
        const word = fx.host.querySelector('.rt-sw-word') as HTMLElement
        expect(word.getAttribute('role')).toBe('button')
        const desc = document.getElementById(word.getAttribute('aria-describedby')!)!
        expect(desc.textContent).toContain('Replay the animation')
        word.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(scene.calls.destroy).toBe(1)
        expect(scene.calls.builds).toBe(2)
        expect(scene.calls.play).toBe(2)
    })

    // Guards: a scene whose play() never settles holding the logo in the playing state forever.
    test('the watchdog calls finish() at durationMs + 500 and not before', async () => {
        const scene = fakeScene({ durationMs: 3000, play: () => new Promise<void>(() => {}) })
        const { ctrl } = mountHost(scene)
        await untilBuilt(scene)
        expect(ctrl.phase).toBe('playing')
        await vi.advanceTimersByTimeAsync(3499)
        expect(ctrl.phase).toBe('playing')
        expect(scene.calls.finish).toBe(0)
        await vi.advanceTimersByTimeAsync(2)
        expect(ctrl.phase).toBe('final')
        expect(scene.calls.finish).toBe(1)
    })

    // Guards: a scene declaring a longer duration than the 10 s contract cap delaying the watchdog.
    test('the watchdog caps a declared duration at 10 s', async () => {
        const scene = fakeScene({ durationMs: 60000, play: () => new Promise<void>(() => {}) })
        const { ctrl } = mountHost(scene)
        await settle()
        await vi.advanceTimersByTimeAsync(10501)
        expect(ctrl.phase).toBe('final')
    })

    // Guards: scene timers and the watchdog ticking while the page is hidden (the animation would end unseen).
    test('timers pause while the page is hidden and resume with the time they had left', async () => {
        let fired = false
        const scene = fakeScene({
            durationMs: 9000,
            play: () => new Promise<void>(() => {}),
            onBuild: (ctx) => { ctx.setTimeout(() => { fired = true }, 1000) },
        })
        const { ctrl } = mountHost(scene)
        await untilBuilt(scene)
        await vi.advanceTimersByTimeAsync(400)
        hidden = true
        document.dispatchEvent(new Event('visibilitychange'))
        await vi.advanceTimersByTimeAsync(20000)
        expect(fired).toBe(false)
        expect(ctrl.phase).toBe('playing')
        hidden = false
        document.dispatchEvent(new Event('visibilitychange'))
        await vi.advanceTimersByTimeAsync(599)
        expect(fired).toBe(false)
        await vi.advanceTimersByTimeAsync(2)
        expect(fired).toBe(true)
    })

    // Guards: the app's reduced-motion choice switching on mid-play leaving the animation running.
    test('refresh() ends a running animation when reduced motion became active', async () => {
        let reduce = false
        const scene = fakeScene({ play: () => new Promise<void>(() => {}) })
        const { ctrl } = mountHost(scene, { reducedMotion: () => reduce })
        await settle()
        expect(ctrl.phase).toBe('playing')
        reduce = true
        ctrl.refresh()
        expect(ctrl.phase).toBe('final')
        expect(scene.calls.finish).toBe(1)
    })
})

describe('status mark policy', () => {
    // Guards: a running status staying hidden behind the seasonal mark (a celebratory mark while something runs).
    test('a non-idle status hides the seasonal mark and idle shows it again without replaying', async () => {
        const scene = fakeScene({
            onBuild: (ctx) => { ctx.markSlot!.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg')) },
        })
        const { fx } = mountHost(scene)
        await settle()
        const slot = fx.brand.querySelector('.rt-sw-markslot') as HTMLElement
        expect(slot).not.toBeNull()
        expect(slot.classList.contains('rt-sw-markslot-off')).toBe(false)
        expect(fx.mark.classList.contains('rt-sw-status-under')).toBe(true)

        fx.mark.setAttribute('data-status', 'running')
        await vi.advanceTimersByTimeAsync(0)
        expect(slot.classList.contains('rt-sw-markslot-off')).toBe(true)
        expect(fx.mark.classList.contains('rt-sw-status-under')).toBe(false)
        expect(fx.mark.classList.contains('rt-sw-status-raised')).toBe(true)

        fx.mark.setAttribute('data-status', 'idle')
        await vi.advanceTimersByTimeAsync(0)
        expect(slot.classList.contains('rt-sw-markslot-off')).toBe(false)
        expect(fx.mark.classList.contains('rt-sw-status-under')).toBe(true)
        expect(scene.calls.builds).toBe(1)
        expect(scene.calls.play).toBe(1)
    })

    // Guards: a scene that draws nothing in the mark slot hiding the real status mark.
    test('an empty mark slot leaves the status mark visible', async () => {
        const { fx } = mountHost(fakeScene())
        await settle()
        expect(fx.mark.classList.contains('rt-sw-status-under')).toBe(false)
        expect((fx.brand.querySelector('.rt-sw-markslot') as HTMLElement).classList.contains('rt-sw-markslot-off')).toBe(true)
    })
})

describe('no scene', () => {
    // Guards: an ordinary day loading a scene chunk, creating layers or touching the wordmark.
    test('a day without an occasion loads nothing and leaves the plain wordmark', async () => {
        now = ORDINARY_DAY
        const { ctrl, fx, load } = mountHost(fakeScene())
        await settle()
        expect(load).not.toHaveBeenCalled()
        expect(ctrl.occasion).toBe('')
        expect(document.querySelector('.rt-sw-stage')).toBeNull()
        expect(document.querySelector('.rt-sw-markslot')).toBeNull()
        expect(fx.host.querySelector('.rt-sw-word')!.hasAttribute('role')).toBe(false)
        expect(fx.host.querySelector('.rt-sw-sr')!.textContent).toBe('RisuTanium')
        expect(fx.brand.hasAttribute('data-seasonal-active')).toBe(false)
    })

    // Guards: a missing scene module or a failed chunk load leaving a stage, a pending phase or an unhandled rejection.
    test.each([
        ['missing module', async () => null],
        ['failed load', async () => { throw new Error('chunk') }],
    ])('%s shows the everyday wordmark', async (_name, loader) => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const fx = fixture()
        const ctrl = mountSeasonal(fx.host, {
            language: 'en', strings, now: () => now, loadScene: loader, playedToday: () => false, markPlayed: () => {},
            anchorEl: fx.anchor, brandEl: fx.brand, fitEl: fx.brand, markEl: fx.mark,
        })
        mounted.push(ctrl)
        await settle()
        expect(ctrl.hasScene).toBe(false)
        expect(ctrl.phase).toBe('none')
        expect(document.querySelector('.rt-sw-stage')).toBeNull()
    })

    // Guards: a scene that throws in build() leaving a half-built stage over the top bar.
    test('a scene whose build() throws is torn down to the plain wordmark', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const scene = fakeScene({ onBuild: () => { throw new Error('boom') } })
        const { ctrl } = mountHost(scene)
        await settle()
        expect(ctrl.phase).toBe('none')
        expect(scene.calls.play).toBe(0)
    })
})

describe('fonts', () => {
    // Guards: a blocked or offline CDN font holding the scene (the font promise must settle false at its timeout, and the
    // build must not wait past the stability cap).
    test('a font that never loads resolves false at its timeout and does not block the build', async () => {
        const never = vi.fn(() => new Promise<FontFace[]>(() => {}))
        Object.defineProperty(document, 'fonts', { configurable: true, value: { load: never, forEach: () => {}, addEventListener: () => {}, removeEventListener: () => {} } })
        let ready: boolean | null = null
        const scene = fakeScene({
            fonts: [{ family: 'Test Face', url: 'https://cdn.invalid/test.woff2', timeoutMs: 1500 }],
            play: () => new Promise<void>(() => {}),
            onBuild: (ctx) => { void ctx.fonts.ready('Test Face').then((v) => { ready = v }) },
        })
        mountHost(scene)
        await settle(650)
        expect(scene.calls.builds).toBe(1)
        expect(scene.calls.play).toBe(1)
        expect(ready).toBeNull()
        await vi.advanceTimersByTimeAsync(1000)
        expect(ready).toBe(false)
        const style = document.head.querySelector('style[data-rt-sw-font="Test Face"]')!
        expect(style.textContent).toContain('https://cdn.invalid/test.woff2')
        expect(style.textContent).toContain('font-display:block')
    })

    // Guards: a font URL carrying quotes or parentheses breaking out of the injected @font-face rule.
    test('a font url that could escape the rule is not injected', async () => {
        const scene = fakeScene({ fonts: [{ family: 'Bad Face', url: 'https://cdn.invalid/x.woff2");body{display:none}/*' }] })
        mountHost(scene)
        await settle()
        expect(document.head.querySelector('style[data-rt-sw-font="Bad Face"]')).toBeNull()
    })

    // Guards: a font family carrying a newline or CSS punctuation ending the injected string and adding rules.
    test('a font family that could escape the rule is not injected', async () => {
        const family = 'Bad\n}body{display:none}'
        const scene = fakeScene({ fonts: [{ family, url: 'https://cdn.invalid/x.woff2' }] })
        mountHost(scene)
        await settle()
        expect([...document.head.querySelectorAll('style[data-rt-sw-font]')].some((s) => (s.textContent ?? '').includes('display:none'))).toBe(false)
    })
})

describe('seams', () => {
    // Guards: the anniversary link not reaching the app's opener, or opening a URL other than the configured one.
    test('the greeting button calls onLink with the configured anniversary url', async () => {
        const onLink = vi.fn()
        const scene = fakeScene({ onBuild: (ctx) => { ctx.showGreeting({ text: 'Happy 1st Anniversary!' }) } })
        const { fx } = mountHost(scene, { onLink })
        await settle()
        const greet = fx.host.querySelector('.rt-sw-greet') as HTMLButtonElement
        expect(greet.getAttribute('aria-label')).toBe('Happy 1st Anniversary!')
        greet.click()
        expect(onLink).toHaveBeenCalledWith(LINK)
    })

    // Guards: the hidden game opening early, never opening, or the panel surviving its close button.
    test('five hat hits open the game panel and Close removes it', async () => {
        const hat = document.createElement('span')
        const scene = fakeScene({ onBuild: (ctx) => { ctx.attachGame(hat) } })
        const { fx } = mountHost(scene, { reducedMotion: () => true })
        await settle()
        expect(hat.getAttribute('data-rt-sw-game')).toBe('active')
        for (let i = 0; i < 4; i++) hat.click()
        expect(document.querySelector('.rt-sw-game')).toBeNull()
        hat.click()
        const panel = document.querySelector('.rt-sw-game') as HTMLElement
        expect(panel).not.toBeNull()
        expect(fx.anchor.nextElementSibling).toBe(panel)
        expect(hat.hidden).toBe(true)
        ;(panel.querySelector('.rt-sw-game-btn') as HTMLButtonElement).click()
        expect(document.querySelector('.rt-sw-game')).toBeNull()
    })
})

describe('destroy', () => {
    // Guards: any layer, panel, observer effect, style, listener or timer outliving the host (the top bar would keep
    // stale stage nodes, a dimmed status mark or a running timer after the toggle is switched off).
    test('destroy removes every node, class, style, listener and timer the host added', async () => {
        const hat = document.createElement('span')
        const scene = fakeScene({
            play: () => new Promise<void>(() => {}),
            onBuild: (ctx) => {
                ctx.markSlot!.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
                ctx.attachGame(hat)
                ctx.showGreeting({ text: 'Happy 1st Anniversary!' })
            },
        })
        // jsdom schedules its own timer for each focus(); it would hide a host timer leak in the count below.
        vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => {})
        const { ctrl, fx } = mountHost(scene)
        const positionBefore = fx.anchor.style.position
        await settle()
        hat.dispatchEvent(new Event('click'))
        ctrl.skip()
        for (let i = 0; i < 5; i++) hat.click()
        expect(document.querySelector('.rt-sw-game')).not.toBeNull()

        ctrl.destroy()
        expect(scene.calls.destroy).toBe(1)
        expect(document.querySelector('.rt-sw-stage, .rt-sw-markslot, .rt-sw-game, .rt-sw-greet-row, .rt-sw-greet')).toBeNull()
        expect(fx.host.innerHTML).toBe(PLAIN_WORDMARK_HTML)
        expect(fx.anchor.style.position).toBe(positionBefore)
        expect(fx.mark.getAttribute('class') ?? '').toBe('')
        expect(fx.mark.hasAttribute('data-rt-sw-still')).toBe(false)
        expect(fx.brand.hasAttribute('data-seasonal-active')).toBe(false)
        expect(vi.getTimerCount()).toBe(0)

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        document.dispatchEvent(new Event('visibilitychange'))
        await settle()
        expect(scene.calls.finish).toBe(1)
        expect(scene.calls.builds).toBe(1)
    })

    // Guards: destroy while the scene is still loading letting the late module build a stage on a removed host.
    test('destroy before the scene finishes loading builds nothing', async () => {
        const scene = fakeScene()
        const { ctrl } = mountHost(scene)
        ctrl.destroy()
        await settle()
        expect(scene.calls.builds).toBe(0)
        expect(document.querySelector('.rt-sw-stage')).toBeNull()
    })
})
