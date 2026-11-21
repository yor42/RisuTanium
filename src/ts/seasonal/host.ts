// Seasonal logo host: mounts into the top-bar wordmark element, resolves today's occasion, loads that occasion's scene
// module on its day only, and owns everything around it: stage and mark layers, layout, pausable timers, the font
// loader, skip and replay, the status-mark policy, the Santa game seam and the greeting seam.
//
// Invariants:
// - No occasion, or a scene that fails to load, leaves the everyday wordmark and no extra layers.
// - The full animation plays at most once per device-local day (prefs `playedToday`/`markPlayed`); later views, reduced
//   motion and low power go straight to the final pose through finish() without play().
// - The seasonal mark shows only while the status mark is idle; any other status hides it again.
// - destroy() removes every node, listener, observer and timer the host added and restores the plain wordmark.
import {
    anniversaryText,
    msUntilLocalMidnight,
    resolveOccasionDetail,
    type OccasionDetail,
    type OccasionKey,
} from './calendar'
import type {
    GameSpec,
    SceneContext,
    SceneDef,
    SceneFont,
    SceneInstance,
    SceneLoader,
    SceneModule,
    StageBox,
    StageOffset,
} from './sceneTypes'

export type { SceneContext, SceneDef, SceneInstance, SceneLoader } from './sceneTypes'

const sceneModules = import.meta.glob<SceneModule>('./scenes/*.ts')

/** The production loader: a scene's chunk is requested only when its key resolves. A missing module means no scene. */
export const loadSceneModule: SceneLoader = async (key) => {
    const load = sceneModules['./scenes/' + key + '.ts']
    if (!load) return null
    const mod = await load()
    return mod.default ?? null
}

/** Everyday wordmark markup, shared by the Svelte component and the host so the two never drift. */
export const PLAIN_WORDMARK_HTML =
    '<span class="rt-sw rt-sw--default"><span class="rt-sw-wrap"><span class="rt-sw-word">' +
    '<span class="rt-sw-sr">RisuTanium</span>' +
    '<span class="rt-sw-text" aria-hidden="true"><span class="rt-sw-a">Risu</span><span class="rt-sw-b">Tanium</span></span>' +
    '</span><span class="rt-sw-over"></span></span></span>'

export interface SeasonalStrings {
    replayHint: string
    skipHint: string
    santaHat: string
    gameTitle: string
    gameClose: string
    gameScore: string
    gameTime: string
    gamePlay: string
    gamePlayAgain: string
    gameTarget: string
    gameHint: string
    gameTimeUp: string
    gameClosed: string
}

export type HostPhase = 'none' | 'pending' | 'playing' | 'final'

export interface HostOptions {
    /** A DBState.db.language value. */
    language: string
    strings: SeasonalStrings
    /** The device clock; tests pass a fixed one. */
    now?: () => Date
    loadScene?: SceneLoader
    playedToday: (ymd: string) => boolean
    markPlayed: (ymd: string) => void
    /** Where the stage is positioned: the top bar. Falls back to the fit element. */
    anchorEl?: HTMLElement | null
    /** The column the stage covers, from the brand's left edge to this element's right edge. Falls back to the brand. */
    fitEl?: HTMLElement | null
    /** The brand cell holding the mark and the wordmark. Falls back to the mark's parent. */
    brandEl?: HTMLElement | null
    /** The status mark (or its wrapper) carrying data-status; null means no mark slot. */
    markEl?: HTMLElement | null
    reducedMotion?: () => boolean
    lowPower?: () => boolean
    theme?: () => 'light' | 'dark'
    onLink?: (url: string | null) => void
    anniversaryUrl?: string | null
    /** False shows the final pose even on the first view of the day (the app stayed open past midnight). */
    autoplay?: boolean
    onState?: (type: string, info: Record<string, unknown>) => void
}

export interface HostController {
    readonly occasion: OccasionKey | ''
    readonly detail: OccasionDetail | null
    readonly phase: HostPhase
    readonly hasScene: boolean
    replay(): void
    skip(): void
    /** Re-reads reduced motion and low power; a running animation ends when either became active. */
    refresh(): void
    relayout(): void
    destroy(): void
}

interface Scene {
    key: OccasionKey
    durationMs: number
    fonts: SceneFont[]
    build: SceneDef['build']
}

interface PausableTimers {
    set(fn: () => void, ms: number): number
    clear(id: number): void
    clearAll(): void
    pause(): void
    resume(): void
}

interface FontEntry {
    style: HTMLStyleElement
    promise: Promise<boolean>
}

const HOP_X = [-4.95, -4.35, -3.72, -3.05, -2.4, -1.75, -1.0, -0.62, 0]
const GAME_TIME = 20
const HOPS_TO_GAME = 5
const TICK_MS = 1000
const MAX_DURATION_MS = 10000
const STAGE_H = 96
const WAIT_CAP_MS = 600

let uidSeq = 0

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, attrs?: Record<string, string>): HTMLElementTagNameMap[K] {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (attrs) for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k])
    return n
}

function span(cls: string | null, text?: string | null, attrs?: Record<string, string>): HTMLSpanElement {
    const n = el('span', cls ?? undefined, attrs)
    if (text != null) n.textContent = text
    return n
}

function warn(...args: unknown[]): void {
    try {
        console.warn('[seasonal]', ...args)
    } catch {
        // no console
    }
}

function nowMs(): number {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}

function mql(q: string): MediaQueryList | null {
    return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null
}

function onMql(m: MediaQueryList | null, fn: () => void): void {
    if (!m) return
    if (m.addEventListener) m.addEventListener('change', fn)
    else m.addListener(fn)
}

function offMql(m: MediaQueryList | null, fn: () => void): void {
    if (!m) return
    if (m.removeEventListener) m.removeEventListener('change', fn)
    else m.removeListener(fn)
}

function isHangul(t: string): boolean {
    return /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/.test(t)
}

function bcp47(lang: string): string {
    return lang === 'cn' || lang === 'zh' ? 'zh-Hans' : lang
}

function fontFormat(url: string): string {
    if (/\.woff2(\?|#|$)/i.test(url)) return 'woff2'
    if (/\.woff(\?|#|$)/i.test(url)) return 'woff'
    if (/\.otf(\?|#|$)/i.test(url)) return 'opentype'
    return 'truetype'
}

/** Timers that stop while the page is hidden and carry on with the time they had left. */
function createTimers(): PausableTimers {
    interface Entry { fn: () => void, remaining: number, start: number, handle: ReturnType<typeof setTimeout> | 0 }
    let list = new Map<number, Entry>()
    let seq = 0
    let paused = false
    const arm = (id: number): void => {
        const t = list.get(id)
        if (!t) return
        t.start = nowMs()
        t.handle = setTimeout(() => {
            list.delete(id)
            t.fn()
        }, Math.max(0, t.remaining))
    }
    return {
        set(fn, ms) {
            const id = ++seq
            list.set(id, { fn, remaining: Math.max(0, Number(ms) || 0), start: 0, handle: 0 })
            if (!paused) arm(id)
            return id
        },
        clear(id) {
            const t = list.get(id)
            if (!t) return
            if (t.handle) clearTimeout(t.handle)
            list.delete(id)
        },
        clearAll() {
            for (const t of list.values()) if (t.handle) clearTimeout(t.handle)
            list = new Map()
        },
        pause() {
            if (paused) return
            paused = true
            for (const t of list.values()) {
                if (t.handle) clearTimeout(t.handle)
                t.handle = 0
                t.remaining -= nowMs() - t.start
            }
        },
        resume() {
            if (!paused) return
            paused = false
            for (const id of list.keys()) arm(id)
        },
    }
}

// One <style> per family, injected when a scene of that day builds. A blocked or offline CDN settles false after the
// timeout and the scene uses its fallback; nothing waits longer than the timeout.
const fontEntries = new Map<string, FontEntry>()

function ensureFont(spec: SceneFont): FontEntry | null {
    const family = spec.family.replace(/["\\]/g, '')
    const known = fontEntries.get(family)
    if (known && known.style.isConnected) return known
    if (/["'()\\\s]/.test(spec.url)) return null
    // The family is written into a CSS string too: only plain names may reach it.
    if (/[^\w -]/.test(spec.family)) return null
    const weight = spec.weight ?? 400
    const style = el('style', undefined, { 'data-rt-sw-font': family })
    style.textContent = '@font-face{font-family:"' + family + '";src:url("' + spec.url + '") format("' + fontFormat(spec.url) +
        '");font-weight:' + weight + ';font-style:normal;font-display:block;}'
    ;(document.head || document.documentElement).appendChild(style)
    const timeout = Math.max(0, Number(spec.timeoutMs) || 2500)
    const promise = new Promise<boolean>((resolve) => {
        let done = false
        const settle = (v: boolean): void => {
            if (done) return
            done = true
            resolve(v)
        }
        setTimeout(() => settle(false), timeout)
        if (!document.fonts || !document.fonts.load) {
            settle(false)
            return
        }
        try {
            document.fonts.load(weight + ' 1em "' + family + '"', spec.sample || 'A가中').then(
                (faces) => settle(faces.some((f) => f.status === 'loaded')),
                () => settle(false),
            )
        } catch {
            settle(false)
        }
    })
    const entry = { style, promise }
    fontEntries.set(family, entry)
    return entry
}

function fontReady(family: string): Promise<boolean> {
    const entry = fontEntries.get(family.replace(/["\\]/g, ''))
    if (!entry) return Promise.resolve(false)
    // A face that arrived after an earlier timeout counts on the next build (replay).
    return entry.promise.then((ok) => {
        if (ok) return true
        try {
            let ready = false
            document.fonts.forEach((f) => {
                if (f.family.replace(/["']/g, '') === family && f.status === 'loaded') ready = true
            })
            return ready
        } catch {
            return false
        }
    })
}

export function mountSeasonal(host: HTMLElement, opts: HostOptions): HostController {
    const id = 'rt-sw-' + (++uidSeq)
    const loadScene = opts.loadScene ?? loadSceneModule
    const strings = opts.strings
    const lang = opts.language
    const clock = (): Date => (opts.now ? opts.now() : new Date())

    let destroyed = false
    let resolved: OccasionKey | '' = ''
    let detail: OccasionDetail | null = null
    let root: HTMLElement | null = null
    let word: HTMLElement | null = null
    let srName: HTMLElement | null = null
    let over: HTMLElement | null = null
    let stage: HTMLElement | null = null
    let markSlot: HTMLElement | null = null
    let phase: HostPhase = 'none'
    let scene: Scene | null = null
    let inst: SceneInstance | null = null
    let ctxTimers: PausableTimers | null = null
    let playToken = 0
    let renderToken = 0
    let watchdog = 0
    let pausedAnims: Animation[] = []
    let hiddenPaused = false
    let sceneDesc = ''
    let sceneDescLang: string | null = null
    let descNode: HTMLElement | null = null
    let wordObs: MutationObserver | null = null
    let waitTok = 0
    let waitState: { cancel(): void, flush(): void } | null = null
    let pendingMode: 'play' | 'final' | null = null
    let relayoutFns: Array<(box: StageBox) => void> = []
    let sentKey: string | null = null
    let relayoutRaf = 0
    let settleRaf = 0
    let greet: HTMLButtonElement | null = null
    let greetRow: HTMLElement | null = null
    let greetUrl: string | null = null
    let gameEl: HTMLElement | null = null
    let gameSpec: GameSpec | undefined
    let hatHits = 0
    let hatGone = false
    let gameTimer: ReturnType<typeof setInterval> | 0 = 0
    let stageGeom = { width: 0, height: STAGE_H, wrapped: false, rowBottom: 0, wrapTop: null as number | null }
    const hops = new WeakMap<HTMLElement, { x: number, y: number }>()
    const restore: Array<[HTMLElement, string]> = []
    let statusObs: MutationObserver | null = null
    let slotObs: MutationObserver | null = null
    let ro: ResizeObserver | null = null
    let midnightTimer: ReturnType<typeof setTimeout> | 0 = 0
    let pendingRecompute = false
    const coreTimers = createTimers()
    const mqReduce = mql('(prefers-reduced-motion: reduce)')
    const mqPhone = mql('(max-width: 639.98px)')

    interface Game {
        panel: HTMLElement
        score: number
        time: number
        running: boolean
        x: number
        scoreEl: HTMLElement
        timeEl: HTMLElement
        target: HTMLButtonElement
        play: HTMLButtonElement
        close: HTMLButtonElement
        status: HTMLElement
        track: HTMLElement
    }
    let game: Game | null = null

    // ---------- inputs ----------
    const date = (): Date => clock()
    const lowPower = (): boolean => !!opts.lowPower?.()
    // The app's own answer wins when given: it already folds in the OS query and the device's explicit choices.
    const reduced = (): boolean => lowPower() || (opts.reducedMotion ? opts.reducedMotion() : !!(mqReduce && mqReduce.matches))
    const theme = (): 'light' | 'dark' => opts.theme?.() ?? 'dark'
    const markEl = (): HTMLElement | null => opts.markEl ?? null
    const brandSlot = (): HTMLElement => opts.brandEl ?? markEl()?.parentElement ?? host.parentElement ?? host
    const fitEl = (): HTMLElement => opts.fitEl ?? brandSlot()
    const anchorEl = (): HTMLElement => opts.anchorEl ?? fitEl()
    const emit = (type: string, info?: Record<string, unknown>): void => {
        if (!opts.onState) return
        try {
            opts.onState(type, info ?? {})
        } catch (e) {
            warn(e)
        }
    }
    function ensurePositioned(n: HTMLElement): void {
        if (getComputedStyle(n).position !== 'static') return
        restore.push([n, n.style.position])
        n.style.position = 'relative'
    }
    function resolve(): OccasionKey | '' {
        detail = resolveOccasionDetail(date(), lang)
        return detail.key
    }
    function today(): string {
        const d = date()
        const pad = (n: number): string => (n < 10 ? '0' : '') + n
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    }

    // ---------- everyday wordmark ----------
    function resetWord(): void {
        if (!root || !word || !srName || !over) return
        word.className = 'rt-sw-word'
        word.removeAttribute('style')
        word.removeAttribute('lang')
        for (let i = word.childNodes.length - 1; i >= 0; i--) {
            const c = word.childNodes[i]
            if (c !== srName) word.removeChild(c)
        }
        if (srName.parentNode !== word) word.insertBefore(srName, word.firstChild)
        srName.textContent = 'RisuTanium'
        const vis = span('rt-sw-text', null, { 'aria-hidden': 'true' })
        vis.appendChild(span('rt-sw-a', 'Risu'))
        vis.appendChild(span('rt-sw-b', 'Tanium'))
        word.appendChild(vis)
        while (over.firstChild) over.removeChild(over.firstChild)
        over.className = 'rt-sw-over'
        root.className = 'rt-sw rt-sw--' + (scene ? resolved : 'default')
    }

    function build(): void {
        host.innerHTML = PLAIN_WORDMARK_HTML
        root = host.firstElementChild as HTMLElement
        word = root.querySelector('.rt-sw-word') as HTMLElement
        srName = root.querySelector('.rt-sw-sr') as HTMLElement
        over = root.querySelector('.rt-sw-over') as HTMLElement
        word.addEventListener('click', onWordActivate)
        word.addEventListener('keydown', onWordKey)
        if (typeof MutationObserver !== 'undefined') {
            wordObs = new MutationObserver(onWordAttr)
            wordObs.observe(word, { attributes: true, attributeFilter: ['aria-description'] })
        }
    }

    // ---------- attributes per phase ----------
    function applyAttrs(): void {
        if (!root || !word) return
        const still = reduced()
        root.setAttribute('data-occasion', resolved || 'none')
        root.setAttribute('data-phase', phase)
        for (const n of [root, stage, markSlot, greetRow, game && game.panel]) {
            if (!n) continue
            n.setAttribute('data-motion', still ? 'still' : 'full')
            n.setAttribute('data-rt-sw-tone', theme())
            if (lowPower()) n.setAttribute('data-low-power', '')
            else n.removeAttribute('data-low-power')
        }
        const m = markEl()
        if (m) {
            if (still) m.setAttribute('data-rt-sw-still', '')
            else m.removeAttribute('data-rt-sw-still')
        }
        // The wordmark is a button while playing (skip) and after the end (replay), plain text otherwise.
        const interactive = !!inst && (phase === 'playing' || (phase === 'final' && !still))
        let hint = ''
        if (interactive) hint = phase === 'playing' ? strings.skipHint : strings.replayHint
        if (interactive) {
            word.setAttribute('role', 'button')
            word.setAttribute('tabindex', '0')
        } else {
            word.removeAttribute('role')
            if (document.activeElement === word) word.setAttribute('tabindex', '-1')
            else word.removeAttribute('tabindex')
        }
        writeDescription(hint)
        setGameActive(phase !== 'playing')
        updateMarkPolicy()
    }

    // The description lives in an aria-describedby node outside the word, one span per part with its own lang, so a
    // Korean greeting is read in Korean and the hint never inherits the word's lang.
    function textLang(t: string): string {
        if (isHangul(t)) return 'ko'
        if (/[\u3040-\u30ff]/.test(t)) return 'ja'
        if (/[\u3400-\u9fff]/.test(t)) return /^zh/.test(lang) ? lang : lang === 'cn' ? 'zh-Hans' : 'zh'
        return 'en'
    }
    function writeDescription(hint: string): void {
        if (!root || !word) return
        const parts: Array<[string, string]> = []
        if (sceneDesc) parts.push([sceneDesc, sceneDescLang || textLang(sceneDesc)])
        if (hint) parts.push([hint, bcp47(lang)])
        if (!descNode) {
            descNode = span('rt-sw-desc', null, { id: id + '-desc' })
            root.appendChild(descNode)
        }
        descNode.textContent = ''
        parts.forEach((p, i) => {
            let t = p[0].trim()
            // Japanese and Chinese parts end with an ideographic full stop, not ".".
            if (i < parts.length - 1) t += (/[.!?\u3002\uff01\uff1f\u2026]$/.test(t) ? '' : /^(ja|zh)/.test(p[1]) ? '\u3002' : '.') + ' '
            descNode!.appendChild(span(null, t, { lang: p[1] }))
        })
        if (parts.length) word.setAttribute('aria-describedby', descNode.id)
        else word.removeAttribute('aria-describedby')
    }
    function onWordAttr(): void {
        // A scene may set aria-description directly; fold it into the scene description and remove the attribute.
        if (!word) return
        const v = word.getAttribute('aria-description')
        if (v == null) return
        word.removeAttribute('aria-description')
        sceneDesc = v
        sceneDescLang = null
        applyAttrs()
    }

    // ---------- stage and mark slot geometry ----------
    function layout(): void {
        if (!root || !stage) return
        const a = anchorEl()
        const f = fitEl()
        const b = brandSlot()
        const ar = a.getBoundingClientRect()
        const fr = f.getBoundingClientRect()
        const br = b.getBoundingClientRect()
        const width = Math.max(0, fr.right - br.left)
        stage.style.left = (br.left - ar.left - a.clientLeft) + 'px'
        stage.style.top = (-a.clientTop) + 'px'
        stage.style.width = width + 'px'
        // A wrapped top bar (phones: the mode switcher sits on a row below the brand row) clips the stage to the brand
        // row's bottom plus 12 px and never past the top of the wrapped row. Detected by geometry, not by width.
        const top = ar.top
        const rowBottom = br.bottom
        let wrapTop = Infinity
        for (const c of Array.from(a.children)) {
            if (c === stage || c.contains(host) || c.classList.contains('rt-sw-stage')) continue
            const cr = c.getBoundingClientRect()
            if (!cr.height || !cr.width) continue
            if (cr.top >= rowBottom - 0.5) wrapTop = Math.min(wrapTop, cr.top)
        }
        const wrapped = wrapTop !== Infinity
        let h = STAGE_H
        if (wrapped) h = Math.max(0, Math.min(STAGE_H, Math.round(rowBottom - top) + 12, Math.floor(wrapTop - top)))
        stage.style.height = h + 'px'
        stage.setAttribute('data-wrapped', wrapped ? 'true' : 'false')
        stageGeom = { width, height: h, wrapped, rowBottom: rowBottom - top, wrapTop: wrapped ? wrapTop - top : null }
        if (sentKey != null && geomKey(stageGeom) !== sentKey) scheduleRelayout()
        const m = markEl()
        if (markSlot && m) {
            const mr = (m.querySelector('svg') ?? m).getBoundingClientRect()
            markSlot.style.left = (mr.left - br.left - b.clientLeft) + 'px'
            markSlot.style.top = (mr.top - br.top - b.clientTop) + 'px'
            markSlot.style.width = mr.width + 'px'
            markSlot.style.height = mr.height + 'px'
        }
    }
    const stageWidth = (): number => (stage ? stage.getBoundingClientRect().width : 0)
    function stageBox(): StageBox {
        if (!stage) return { width: 0, height: 0, wrapped: false, rowBottom: 0, wrapTop: null }
        layout()
        return boxCopy()
    }
    function stageOffset(): StageOffset {
        if (!stage || !word) return { markX: 0, markY: 0, markSize: 0, wordX: 0, wordY: 0, wordWidth: 0, wordHeight: 0 }
        const sr = stage.getBoundingClientRect()
        const wr = word.getBoundingClientRect()
        const m = markEl()
        const mr = m ? (m.querySelector('svg') ?? m).getBoundingClientRect() : null
        return {
            markX: mr ? mr.left - sr.left : 0,
            markY: mr ? mr.top - sr.top : 0,
            markSize: mr ? mr.width : 0,
            wordX: wr.left - sr.left,
            wordY: wr.top - sr.top,
            wordWidth: wr.width,
            wordHeight: wr.height,
        }
    }
    function createLayers(): void {
        const a = anchorEl()
        ensurePositioned(a)
        stage = el('div', 'rt-sw-stage', { 'aria-hidden': 'true', 'data-occasion': resolved, 'data-rt-sw': id })
        a.appendChild(stage)
        const m = markEl()
        if (m) {
            const b = brandSlot()
            ensurePositioned(b)
            markSlot = el('span', 'rt-sw-markslot', { 'aria-hidden': 'true', 'data-occasion': resolved, 'data-rt-sw': id })
            b.appendChild(markSlot)
            m.classList.add('rt-sw-status-host')
            statusObs = new MutationObserver(updateMarkPolicy)
            statusObs.observe(m, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-status'] })
            slotObs = new MutationObserver(updateMarkPolicy)
            slotObs.observe(markSlot, { childList: true })
        }
        layout()
    }
    function removeLayers(): void {
        if (stage) {
            stage.remove()
            stage = null
        }
        if (markSlot) {
            markSlot.remove()
            markSlot = null
        }
        if (statusObs) {
            statusObs.disconnect()
            statusObs = null
        }
        if (slotObs) {
            slotObs.disconnect()
            slotObs = null
        }
        const m = markEl()
        if (m) {
            m.classList.remove('rt-sw-status-host', 'rt-sw-status-under', 'rt-sw-status-raised')
            m.removeAttribute('data-rt-sw-still')
        }
    }
    function currentStatus(): string {
        const m = markEl()
        if (!m) return 'idle'
        const s = m.matches('[data-status]') ? m : m.querySelector('[data-status]')
        return s ? s.getAttribute('data-status') || 'idle' : 'idle'
    }
    // The seasonal mark shows only while the status is idle and the scene drew something into the slot.
    function updateMarkPolicy(): void {
        const m = markEl()
        if (!m || !markSlot) return
        const status = currentStatus()
        const idle = status === 'idle'
        const show = idle && markSlot.childElementCount > 0
        markSlot.classList.toggle('rt-sw-markslot-off', !show)
        m.classList.toggle('rt-sw-status-under', show)
        // A running status is never dimmed by a scene's tint.
        m.classList.toggle('rt-sw-status-raised', !idle)
        markSlot.setAttribute('data-status', status)
    }

    // ---------- context ----------
    function makeCtx(tm: PausableTimers, def: Scene): SceneContext {
        const ctx: SceneContext = {
            key: def.key,
            variant: detail?.variant ?? '',
            stage: stage!,
            word: word!,
            over: over!,
            root: root!,
            markSlot,
            uid: id + '-' + def.key + '-' + (++playToken),
            lang,
            date: date(),
            year: date().getFullYear(),
            get theme() { return theme() },
            reduced: reduced(),
            anniversaryUrl: opts.anniversaryUrl ?? null,
            stageWidth,
            stageBox,
            stageOffset,
            fitText,
            fonts: { ready: fontReady },
            onLink,
            setName,
            setDescription(t, l) {
                sceneDesc = t ? String(t) : ''
                sceneDescLang = l || null
                applyAttrs()
            },
            onRelayout(fn) {
                if (typeof fn === 'function') relayoutFns.push(fn)
            },
            setTimeout: (fn, ms) => tm.set(fn, ms),
            clearTimeout: (t) => tm.clear(t),
            attachGame,
            showGreeting,
            hideGreeting,
        }
        return ctx
    }
    function fitText(n: HTMLElement | null, maxPx?: number): number {
        if (!n) return 1
        const max = Number(maxPx) > 0 ? Number(maxPx) : Math.max(0, stageWidth() - 8)
        n.style.fontSize = ''
        const w = n.scrollWidth || n.getBoundingClientRect().width
        if (!w || w <= max) return 1
        const fs = parseFloat(getComputedStyle(n).fontSize) || 16
        const k = max / w
        n.style.fontSize = (Math.floor(fs * k * 100) / 100) + 'px'
        return k
    }
    function setName(text: string, l?: string | null): void {
        if (!srName || !word) return
        srName.textContent = text ? String(text) : 'RisuTanium'
        const nameLang = l !== undefined ? l : isHangul(srName.textContent) ? 'ko' : null
        if (nameLang) word.setAttribute('lang', nameLang)
        else word.removeAttribute('lang')
    }
    function onLink(url: string | null): void {
        if (!opts.onLink) return
        try {
            opts.onLink(url == null ? null : url)
        } catch (e) {
            warn(e)
        }
    }

    // ---------- scene lifecycle ----------
    function sceneCall(name: 'play' | 'finish' | 'destroy'): void | Promise<void> {
        if (!inst) return undefined
        try {
            return inst[name]()
        } catch (e) {
            warn(resolved, name + '() threw', e)
            return undefined
        }
    }
    // Geometry signature of everything that decides the stage box: header, its columns, the brand slot, the word.
    function geomSig(): string {
        const a = anchorEl()
        const parts: number[] = []
        const push = (n: Element | null): void => {
            if (!n) return
            const r = n.getBoundingClientRect()
            parts.push(Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height))
        }
        push(a)
        for (const c of Array.from(a.children)) if (c !== stage && !c.classList.contains('rt-sw-stage')) push(c)
        push(fitEl())
        push(brandSlot())
        push(word)
        return parts.join(',')
    }
    // Waits until the top bar has its final layout: signature unchanged for 2 frames, at least 120 ms after the first
    // check and the logo face settled; never longer than WAIT_CAP_MS.
    function waitStable(done: () => void): void {
        const tok = ++waitTok
        const t0 = nowMs()
        let last: string | null = null
        let same = 0
        let finished = false
        let fontsOk = false
        let raf = 0
        let cap: ReturnType<typeof setTimeout> | 0 = 0
        const finish = (): void => {
            if (finished || tok !== waitTok) return
            finished = true
            cancelAnimationFrame(raf)
            clearTimeout(cap)
            waitState = null
            layout()
            done()
        }
        let fl: Promise<unknown> | null = null
        try {
            if (document.fonts && document.fonts.load) fl = document.fonts.load('900 1em "NanumSquare Neo Logo"', 'RisuTanium')
        } catch {
            fl = null
        }
        if (fl && fl.then) fl.then(() => { fontsOk = true }, () => { fontsOk = true })
        else fontsOk = true
        const frame = (): void => {
            if (finished || tok !== waitTok) return
            layout()
            const sig = geomSig()
            if (sig === last) same++
            else {
                same = 0
                last = sig
            }
            if (fontsOk && same >= 2 && nowMs() - t0 >= 120) {
                finish()
                return
            }
            raf = requestAnimationFrame(frame)
        }
        raf = requestAnimationFrame(frame)
        cap = setTimeout(finish, WAIT_CAP_MS)
        waitState = {
            cancel() {
                finished = true
                cancelAnimationFrame(raf)
                clearTimeout(cap)
                waitState = null
            },
            flush: finish,
        }
    }
    function startScene(mode: 'play' | 'final'): void {
        if (!scene) return
        if (!stage) createLayers()
        for (const f of scene.fonts) if (f && f.family && f.url) ensureFont(f)
        phase = 'pending'
        applyAttrs()
        emit('pending', { key: resolved })
        waitStable(() => {
            const m = pendingMode ?? mode
            pendingMode = null
            runScene(m)
        })
    }
    function geomKey(g: { width: number, height: number, wrapped: boolean, rowBottom: number }): string {
        return [Math.round(g.width), Math.round(g.height), g.wrapped ? 1 : 0, Math.round(g.rowBottom)].join(',')
    }
    function boxCopy(): StageBox {
        return { width: stageGeom.width, height: stageGeom.height, wrapped: stageGeom.wrapped, rowBottom: stageGeom.rowBottom, wrapTop: stageGeom.wrapTop }
    }
    // onRelayout: debounced to one call per frame, only when the stage box changed since the scene last saw it.
    function scheduleRelayout(): void {
        if (!inst || !relayoutFns.length || sentKey == null || relayoutRaf) return
        relayoutRaf = requestAnimationFrame(() => {
            relayoutRaf = 0
            if (!inst || !stage) return
            layout()
            const k = geomKey(stageGeom)
            if (k === sentKey) return
            sentKey = k
            const box = boxCopy()
            for (const fn of relayoutFns.slice()) {
                try {
                    fn(box)
                } catch (e) {
                    warn(resolved, 'onRelayout callback threw', e)
                }
            }
        })
    }
    function runScene(mode: 'play' | 'final'): void {
        if (!scene || destroyed || !stage) return
        layout()
        stage.setAttribute('data-build-width', String(Math.round(stageGeom.width * 10) / 10))
        ctxTimers = createTimers()
        const ctx = makeCtx(ctxTimers, scene)
        try {
            inst = scene.build(ctx)
        } catch (e) {
            warn(resolved, 'build() threw', e)
            inst = null
        }
        if (!inst || typeof inst.finish !== 'function') {
            inst = null
            teardownScene()
            phase = 'none'
            applyAttrs()
            return
        }
        const token = playToken
        sentKey = geomKey(stageGeom)
        if (mode === 'play' && !ctx.reduced) {
            phase = 'playing'
            opts.markPlayed(today())
            applyAttrs()
            document.addEventListener('keydown', onDocKey, true)
            emit('play', { key: resolved })
            const res = sceneCall('play')
            watchdog = coreTimers.set(() => endScene(token, 'watchdog'), scene.durationMs + 500)
            if (res instanceof Promise) res.then(() => endScene(token, 'settled'), () => endScene(token, 'watchdog'))
            if (document.hidden) pauseAll()
        } else {
            sceneCall('finish')
            phase = 'final'
            applyAttrs()
            emit('final', { key: resolved, reason: ctx.reduced ? 'reduced' : 'notFirstView' })
        }
        layout()
        // Geometry that changed between the measurement at build and now is reported once, on the next frame.
        settleRaf = requestAnimationFrame(() => {
            settleRaf = 0
            if (token === playToken) {
                layout()
                scheduleRelayout()
            }
        })
    }
    function endScene(token: number, reason: string): void {
        if (token !== playToken || phase !== 'playing') return
        coreTimers.clear(watchdog)
        document.removeEventListener('keydown', onDocKey, true)
        if (reason !== 'settled') {
            if (ctxTimers) ctxTimers.clearAll()
            resumeAll()
            sceneCall('finish')
        }
        phase = 'final'
        applyAttrs()
        emit('final', { key: resolved, reason })
        fitGreeting()
    }
    function skip(): void {
        if (phase === 'pending' && waitState) {
            pendingMode = 'final'
            waitState.flush()
            return
        }
        if (phase === 'playing') endScene(playToken, 'skip')
    }
    function teardownScene(): void {
        document.removeEventListener('keydown', onDocKey, true)
        coreTimers.clear(watchdog)
        if (ctxTimers) {
            ctxTimers.clearAll()
            ctxTimers = null
        }
        resumeAll()
        if (inst) sceneCall('destroy')
        inst = null
        sceneDesc = ''
        sceneDescLang = null
        relayoutFns = []
        sentKey = null
        if (relayoutRaf) {
            cancelAnimationFrame(relayoutRaf)
            relayoutRaf = 0
        }
        if (settleRaf) {
            cancelAnimationFrame(settleRaf)
            settleRaf = 0
        }
        if (waitState) waitState.cancel()
        pendingMode = null
        gameEl = null
        hideGreeting()
        if (stage) while (stage.firstChild) stage.removeChild(stage.firstChild)
        if (markSlot) while (markSlot.firstChild) markSlot.removeChild(markSlot.firstChild)
        if (word) resetWord()
    }
    function replay(): void {
        if (destroyed || !root) return
        if (pendingRecompute) {
            pendingRecompute = false
            if (resolve() !== resolved) {
                render('play')
                return
            }
        }
        if (!scene || phase === 'pending') return
        if (reduced()) {
            if (phase === 'playing') skip()
            return
        }
        teardownScene()
        if (!stage) createLayers()
        runScene('play')
    }

    // ---------- render ----------
    function defaultMode(): 'play' | 'final' {
        return opts.autoplay === false || opts.playedToday(today()) ? 'final' : 'play'
    }
    function render(mode?: 'play' | 'final'): void {
        if (game) closeGame(false)
        teardownScene()
        removeLayers()
        removeRow()
        const token = ++renderToken
        resolved = resolve()
        scene = null
        if (!root) build()
        resetWord()
        phase = 'none'
        emit('resolve', { key: resolved, detail })
        if (!resolved) {
            applyAttrs()
            return
        }
        const key = resolved
        loadScene(key).then((def) => {
            if (destroyed || token !== renderToken) return
            if (def && typeof def.build === 'function') {
                const dur = Number(def.durationMs)
                scene = {
                    key,
                    durationMs: Number.isFinite(dur) && dur > 0 ? Math.min(dur, MAX_DURATION_MS) : MAX_DURATION_MS,
                    fonts: Array.isArray(def.fonts) ? def.fonts.slice() : [],
                    build: def.build,
                }
                startScene(mode ?? defaultMode())
            } else {
                applyAttrs()
            }
        }, (e) => {
            if (destroyed || token !== renderToken) return
            warn(key, 'scene failed to load', e)
            applyAttrs()
        })
    }

    // ---------- skip / replay input ----------
    function onWordActivate(e: Event): void {
        if (!inst) return
        if (phase === 'playing') {
            e.preventDefault()
            skip()
            return
        }
        if (phase === 'final' && !reduced()) {
            e.preventDefault()
            replay()
        }
    }
    function onWordKey(e: KeyboardEvent): void {
        if (!inst || !word || !word.hasAttribute('role')) return
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault()
            onWordActivate(e)
        }
    }
    function onDocKey(e: KeyboardEvent): void {
        if (e.key === 'Escape' && phase === 'playing') skip()
    }

    // ---------- pause while hidden ----------
    function animLayers(): HTMLElement[] {
        return [stage, word, over, markSlot, greet, greetRow].filter((n): n is HTMLElement => !!n)
    }
    function pauseAll(): void {
        if (hiddenPaused) return
        hiddenPaused = true
        coreTimers.pause()
        if (ctxTimers) ctxTimers.pause()
        pausedAnims = []
        for (const n of animLayers()) {
            if (!n.getAnimations) continue
            for (const a of n.getAnimations({ subtree: true })) {
                if (a.playState === 'running') {
                    try {
                        a.pause()
                        pausedAnims.push(a)
                    } catch {
                        // ignore
                    }
                }
            }
        }
    }
    function resumeAll(): void {
        if (!hiddenPaused) return
        hiddenPaused = false
        coreTimers.resume()
        if (ctxTimers) ctxTimers.resume()
        for (const a of pausedAnims) {
            try {
                if (a.playState === 'paused') a.play()
            } catch {
                // ignore
            }
        }
        pausedAnims = []
    }
    function onVisibility(): void {
        if (document.hidden) {
            if (phase === 'playing') pauseAll()
            if (gameTimer) {
                clearInterval(gameTimer)
                gameTimer = 0
            }
        } else {
            resumeAll()
            if (game && game.running) startTicking()
            recompute()
        }
    }

    // ---------- date recompute (midnight, visibility) ----------
    function recompute(): void {
        if (destroyed) return
        const before = resolved
        const next = resolveOccasionDetail(date(), lang).key
        if (next === before) return
        if (phase === 'playing') {
            pendingRecompute = true
            return
        }
        // A new day while the app stays open: final pose, no auto-play.
        render('final')
    }
    function scheduleMidnight(): void {
        clearTimeout(midnightTimer || undefined)
        midnightTimer = setTimeout(() => {
            recompute()
            scheduleMidnight()
        }, Math.min(msUntilLocalMidnight(date()) + 1000, 2147483000))
    }

    // ---------- Santa game seam ----------
    function santaLabel(): string {
        return strings.santaHat + ': ' + hatHits + ' / ' + HOPS_TO_GAME
    }
    function setHop(n: HTMLElement, x: number, y: number): void {
        hops.set(n, { x, y })
        n.style.setProperty('--rt-sw-hop-x', x + 'em')
        n.style.setProperty('--rt-sw-hop-y', y + 'em')
    }
    function attachGame(n: HTMLElement, spec?: GameSpec): HTMLElement {
        if (!n || n.nodeType !== 1 || !over) return n
        if (gameEl && gameEl !== n) detachGame(gameEl)
        gameEl = n
        gameSpec = spec
        if (n.parentNode !== over) over.appendChild(n)
        n.setAttribute('data-rt-sw-game', 'inactive')
        if (n.tagName !== 'BUTTON') n.setAttribute('role', 'button')
        else n.setAttribute('type', 'button')
        n.setAttribute('aria-label', santaLabel())
        n.classList.add('rt-sw-game-hat')
        const hop = hops.get(n)
        setHop(n, hop ? hop.x : 0, hop ? hop.y : 0)
        if (!hop) {
            n.addEventListener('click', (e) => {
                e.stopPropagation()
                hitSanta(n)
            })
            n.addEventListener('keydown', (e) => {
                if (n.tagName === 'BUTTON') return
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                    e.preventDefault()
                    hitSanta(n)
                }
            })
        }
        if (hatGone) n.hidden = true
        setGameActive(phase !== 'playing')
        return n
    }
    function detachGame(n: HTMLElement): void {
        n.removeAttribute('data-rt-sw-game')
        n.removeAttribute('role')
        n.removeAttribute('tabindex')
    }
    function setGameActive(on: boolean): void {
        if (!gameEl) return
        gameEl.setAttribute('data-rt-sw-game', on ? 'active' : 'inactive')
        gameEl.setAttribute('tabindex', on ? '0' : '-1')
        if (hatGone) gameEl.hidden = true
    }
    function hitSanta(b: HTMLElement): void {
        if (phase === 'playing' || b.getAttribute('data-rt-sw-game') !== 'active') return
        hatHits++
        if (hatHits >= HOPS_TO_GAME) {
            hatGone = true
            setHop(b, 0, 0)
            b.hidden = true
            openGame()
            return
        }
        const current = hops.get(b)?.x
        const choices = HOP_X.filter((x) => x !== current)
        const x = choices[Math.floor(Math.random() * choices.length)]
        const y = Math.round((Math.random() * 0.4 - 0.25) * 100) / 100
        setHop(b, x, y)
        b.setAttribute('aria-label', santaLabel())
    }
    function openGame(): void {
        if (game) return
        const anchor = anchorEl()
        const titleId = id + '-game-title'
        const panel = el('section', 'rt-sw-game', { role: 'region', 'aria-labelledby': titleId })
        const head = el('div', 'rt-sw-game-head')
        const title = el('strong', 'rt-sw-game-title', { id: titleId })
        title.textContent = strings.gameTitle
        const close = el('button', 'rt-sw-game-btn', { type: 'button' })
        close.textContent = strings.gameClose
        head.append(title, close)
        const stats = el('p', 'rt-sw-game-stats')
        const scoreEl = el('b')
        scoreEl.textContent = '0'
        const timeEl = el('b')
        timeEl.textContent = String(GAME_TIME)
        const scoreLine = span(null, strings.gameScore + ': ')
        scoreLine.appendChild(scoreEl)
        const timeLine = span(null, strings.gameTime + ': ')
        timeLine.appendChild(timeEl)
        stats.append(scoreLine, timeLine)
        const track = el('div', 'rt-sw-game-track')
        const target = el('button', 'rt-sw-game-target', { type: 'button', 'data-idle': '', 'aria-label': strings.gameTarget })
        if (gameSpec?.targetSvg) target.innerHTML = gameSpec.targetSvg.split('__UID__').join(id + '-target')
        track.appendChild(target)
        const actions = el('div', 'rt-sw-game-actions')
        const play = el('button', 'rt-sw-game-btn', { type: 'button' })
        play.textContent = strings.gamePlay
        actions.appendChild(play)
        const hint = el('p', 'rt-sw-game-hint')
        hint.textContent = strings.gameHint
        const status = el('p', 'rt-sw-sr', { role: 'status', 'aria-live': 'polite' })
        panel.append(head, stats, track, actions, hint, status)
        anchor.insertAdjacentElement('afterend', panel)
        const g: Game = { panel, score: 0, time: GAME_TIME, running: false, x: 0, scoreEl, timeEl, target, play, close, status, track }
        game = g
        applyAttrs()
        target.addEventListener('click', onTarget)
        play.addEventListener('click', () => {
            startRound(0)
            target.focus()
        })
        close.addEventListener('click', () => closeGame(true))
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                closeGame(true)
            }
        })
        target.focus()
        emit('game', { open: true })
    }
    function drawGame(): void {
        if (!game) return
        game.scoreEl.textContent = String(game.score)
        game.timeEl.textContent = String(game.time)
        game.target.toggleAttribute('data-idle', !game.running)
        game.target.style.setProperty('--rt-sw-target-x', game.x + 'px')
    }
    function moveTarget(g: Game): void {
        g.x = Math.round(Math.random() * Math.max(0, g.track.clientWidth - 80))
    }
    function startRound(firstScore: number): void {
        if (!game) return
        if (gameTimer) clearInterval(gameTimer)
        game.time = GAME_TIME
        game.score = firstScore
        game.running = true
        game.status.textContent = ''
        game.play.textContent = strings.gamePlay
        game.play.disabled = true
        drawGame()
        startTicking()
    }
    function startTicking(): void {
        if (gameTimer) clearInterval(gameTimer)
        gameTimer = 0
        if (document.hidden) return
        gameTimer = setInterval(tick, TICK_MS)
    }
    function tick(): void {
        if (!game || !game.running) return
        game.time -= 1
        if (game.time <= 0) {
            game.time = 0
            game.running = false
            if (gameTimer) clearInterval(gameTimer)
            gameTimer = 0
            game.play.disabled = false
            game.play.textContent = strings.gamePlayAgain
            game.status.textContent = strings.gameTimeUp + ': ' + game.score
        }
        drawGame()
    }
    function onTarget(): void {
        if (!game) return
        moveTarget(game)
        if (!game.running) {
            if (game.time === 0) {
                game.time = GAME_TIME
                game.x = 0
                game.play.textContent = strings.gamePlay
                drawGame()
                return
            }
            startRound(1)
            return
        }
        game.score++
        drawGame()
    }
    function closeGame(restoreFocus: boolean): void {
        if (!game) return
        if (gameTimer) clearInterval(gameTimer)
        gameTimer = 0
        const hadFocus = game.panel.contains(document.activeElement)
        game.panel.remove()
        game = null
        emit('game', { open: false })
        if (restoreFocus && hadFocus && root && srName) {
            const r0 = root
            r0.setAttribute('tabindex', '-1')
            r0.setAttribute('role', 'group')
            r0.setAttribute('aria-label', srName.textContent + ', ' + strings.gameClosed)
            const onBlur = (): void => {
                r0.removeAttribute('tabindex')
                r0.removeAttribute('role')
                r0.removeAttribute('aria-label')
                r0.removeEventListener('blur', onBlur)
            }
            r0.addEventListener('blur', onBlur)
            r0.focus()
        }
    }

    // ---------- anniversary greeting seam ----------
    function showGreeting(spec?: { text?: string, shortText?: string, url?: string | null }): HTMLElement {
        if (!root) throw new Error('seasonal host is not built')
        const s = spec ?? {}
        const text = s.text ? String(s.text) : anniversaryText(date().getFullYear())
        const short = s.shortText ? String(s.shortText) : (text.match(/\b\d+(st|nd|rd|th)\b/) ?? [text])[0]
        const url = s.url !== undefined ? s.url : opts.anniversaryUrl ?? null
        greetUrl = url
        if (!greet) {
            const g = el('button', 'rt-sw-greet', { type: 'button' })
            g.appendChild(span('rt-sw-greet-long'))
            g.appendChild(span('rt-sw-greet-short'))
            g.addEventListener('click', () => onLink(greetUrl))
            root.appendChild(g)
            greet = g
        }
        greet.setAttribute('aria-label', text)
        greet.children[0].textContent = text
        greet.children[1].textContent = short
        fitGreeting()
        return greet
    }
    function hideGreeting(): void {
        if (greet) {
            if (greet.getAnimations) for (const a of greet.getAnimations()) {
                try {
                    a.cancel()
                } catch {
                    // ignore
                }
            }
            greet.remove()
        }
        greet = null
        greetUrl = null
        removeRow()
    }
    function removeRow(): void {
        if (greetRow) {
            greetRow.remove()
            greetRow = null
        }
    }
    function fitGreeting(): void {
        if (!root || !greet) return
        const hadFocus = document.activeElement === greet
        if (greet.parentNode !== root) root.appendChild(greet)
        removeRow()
        root.classList.remove('rt-sw-compact')
        const t = fitEl()
        const phone = !!(mqPhone && mqPhone.matches)
        const overflow = (): boolean => t.scrollWidth > t.clientWidth + 1
        if (phone || overflow()) {
            if (!phone) root.classList.add('rt-sw-compact')
            if (phone || overflow()) {
                root.classList.remove('rt-sw-compact')
                greetRow = el('div', 'rt-sw-greet-row')
                greetRow.appendChild(greet)
                anchorEl().insertAdjacentElement('afterend', greetRow)
                applyAttrs()
            }
        }
        if (hadFocus) greet.focus()
    }

    // ---------- listeners ----------
    function onResize(): void {
        layout()
        fitGreeting()
    }
    function onMotionPref(): void {
        if (reduced() && phase === 'playing') skip()
        applyAttrs()
    }
    if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(onResize)
        const seen = new Set<Element>()
        for (const n of [fitEl(), anchorEl(), brandSlot(), ...Array.from(anchorEl().children)]) {
            if (!seen.has(n)) {
                seen.add(n)
                ro.observe(n)
            }
        }
    }
    window.addEventListener('resize', onResize)
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', onResize)
    onMql(mqPhone, onResize)
    onMql(mqReduce, onMotionPref)
    document.addEventListener('visibilitychange', onVisibility)

    render()
    scheduleMidnight()

    return {
        get occasion() { return resolved },
        get detail() { return detail },
        get phase() { return phase },
        get hasScene() { return !!scene },
        replay,
        skip() { if (!destroyed) skip() },
        refresh() { if (!destroyed) onMotionPref() },
        relayout() { if (!destroyed) onResize() },
        destroy() {
            if (destroyed) return
            destroyed = true
            closeGame(false)
            teardownScene()
            removeLayers()
            removeRow()
            clearTimeout(midnightTimer || undefined)
            if (gameTimer) clearInterval(gameTimer)
            coreTimers.clearAll()
            document.removeEventListener('visibilitychange', onVisibility)
            document.removeEventListener('keydown', onDocKey, true)
            if (ro) ro.disconnect()
            if (wordObs) wordObs.disconnect()
            window.removeEventListener('resize', onResize)
            if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', onResize)
            offMql(mqPhone, onResize)
            offMql(mqReduce, onMotionPref)
            for (const [n, position] of restore.reverse()) n.style.position = position
            restore.length = 0
            host.innerHTML = PLAIN_WORDMARK_HTML
            root = null
        },
    }
}
