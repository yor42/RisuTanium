// DEEP NEXUS background: a triangular lattice of nodes riding a slow 3D wave.
// A click or tap sends a ring outward from that point: nodes lift and brighten as the wavefront passes,
// and links between neighbours light up inside the ring. A hovering mouse or pen also lights a small, faint
// spotlight around itself. With neither, no links are drawn. Decorative only.

export interface NetworkFieldOptions {
    /** Lattice spacing in CSS pixels. */
    spacing?: number
    /** Node colour as an `r g b` triplet. Defaults to --nexus-network-node on the canvas, then a built-in value. */
    nodeRgb?: string
    /** Link colour as an `r g b` triplet. Defaults to --nexus-network-link on the canvas, then a built-in value. */
    linkRgb?: string
    /** Coarser lattice, device-pixel ratio 1, a 24 fps cap and one wave at a time. */
    lowPower?: boolean
    /** Draws one still frame with no waves and no spotlight, and does not react to the pointer. */
    reducedMotion?: boolean
    /** Hover spotlight position as fractions of the canvas, active before any pointer event. For stills. */
    initialPointer?: { x: number, y: number }
    /**
     * A wave already in flight at the first frame, for stills and screenshots. `x` and `y` are fractions of the
     * canvas; `age` is seconds since it started (default 0.8). Ignored under reducedMotion.
     */
    initialWave?: { x: number, y: number, age?: number }
    /** Draws one frame at startTime, including initialWave and initialPointer, and stops. For deterministic stills. */
    still?: boolean
    /** Wave phase in seconds at the first frame. */
    startTime?: number
}

export interface NetworkField {
    destroy(): void
}

// Radial displacement per unit of wave height, and the matching upward lift in pixels.
const DEPTH = 0.04
const LIFT = 14
const NODE_LEVELS = 12
const LINK_LEVELS = 8
// Click wave: outward speed in CSS px/s, half-width of the lit ring in CSS px, lifetime in seconds.
const WAVE_SPEED = 360
const WAVE_BAND = 115
const WAVE_DURATION = 2.6
const MAX_WAVES = 3
// Hover spotlight: radius in CSS px and peak strength. Kept small and faint so it reads as a response to the
// pointer, not a glow dragged behind it; the click wave is the strong signal (maintainer decision, 2026-10-16).
const HOVER_RADIUS = 110
const HOVER_STRENGTH = 0.35

function wave(x: number, y: number, t: number): number {
    return 0.6 * Math.sin(x * 0.0045 + t * 0.32) * Math.cos(y * 0.0055 - t * 0.21)
        + 0.4 * Math.sin((x - y) * 0.0032 + t * 0.17)
}

function readRgb(element: Element, name: string, fallback: string): string {
    const value = getComputedStyle(element).getPropertyValue(name).trim()
    return value === '' ? fallback : value
}

function finitePoint<T extends { x: number, y: number }>(point: T | undefined): T | undefined {
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : undefined
}

interface Wave {
    x: number
    y: number
    bornAt: number
    strength: number
}

export function createNetworkField(canvas: HTMLCanvasElement, options: NetworkFieldOptions = {}): NetworkField {
    const context = canvas.getContext('2d')
    if (!context) {
        return { destroy() {} }
    }
    const ctx = context
    const lowPower = options.lowPower ?? false
    const reducedMotion = options.reducedMotion ?? false
    const still = options.still ?? false
    const spacing = (options.spacing ?? 46) * (lowPower ? 1.4 : 1)
    const nodeRgb = options.nodeRgb ?? readRgb(canvas, '--nexus-network-node', '190 220 255')
    const linkRgb = options.linkRgb ?? readRgb(canvas, '--nexus-network-link', '127 233 255')
    const minFrameMs = lowPower ? 1000 / 24 : 0
    const maxWaves = lowPower ? 1 : MAX_WAVES
    // A NaN position would make every height NaN and index a node bucket with NaN (review N-6), so
    // non-finite stills input is dropped rather than drawn.
    const initialPointer = finitePoint(options.initialPointer)
    const initialWave = finitePoint(options.initialWave)

    let width = 0
    let height = 0
    let dpr = 1
    let cols = 0
    let rows = 0
    let baseX = new Float32Array(0)
    let baseY = new Float32Array(0)
    let screenX = new Float32Array(0)
    let screenY = new Float32Array(0)
    let height3d = new Float32Array(0)
    let crests = new Float32Array(0)
    // 1 when a node is close enough to a ring that one of its links may be lit.
    let inBand = new Uint8Array(0)

    let radii = new Float32Array(0)
    // Nodes and links are batched into a few alpha levels so each level is one path and one fill or stroke.
    const nodeBuckets: number[][] = Array.from({ length: NODE_LEVELS }, () => [])
    const linkBuckets: number[][] = Array.from({ length: LINK_LEVELS }, () => [])

    // Waves in flight, oldest first, and their per-frame ring bounds (preallocated, at most MAX_WAVES).
    const waves: Wave[] = []
    const ringX = new Float64Array(MAX_WAVES)
    const ringY = new Float64Array(MAX_WAVES)
    const ringR = new Float64Array(MAX_WAVES)
    const ringFade = new Float64Array(MAX_WAVES)
    const ringMinSq = new Float64Array(MAX_WAVES)
    const ringMaxSq = new Float64Array(MAX_WAVES)
    const bandMinSq = new Float64Array(MAX_WAVES)
    const bandMaxSq = new Float64Array(MAX_WAVES)
    let ringCount = 0

    // Hover spotlight. Only mouse and pen hover move it; touch has no hover and leaves it off.
    let pointerX = 0
    let pointerY = 0
    let targetX = 0
    let targetY = 0
    let pointerActive = false
    // Until a real pointer event arrives, initialPointer stays pinned to its fraction across resizes.
    let pointerMoved = false
    let presence = 0
    if (initialPointer && !reducedMotion) {
        pointerActive = true
        presence = 1
    }
    const hoverSq = HOVER_RADIUS * HOVER_RADIUS
    const hoverBandSq = (HOVER_RADIUS + spacing) * (HOVER_RADIUS + spacing)

    const startTime = options.startTime ?? 0
    let elapsed = 0
    let lastDraw = 0
    let nextDue = 0
    let frameId = 0

    function now(): number {
        return startTime + elapsed
    }

    function targetDpr(): number {
        return lowPower ? 1 : Math.min(window.devicePixelRatio || 1, 1.5)
    }

    function rebuild() {
        width = canvas.clientWidth
        height = canvas.clientHeight
        dpr = targetDpr()
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)

        // Rows are offset by half a step so neighbours form triangles, echoing the mark.
        const rowStep = spacing * Math.sqrt(3) / 2
        // The wave pulls edge nodes inward by up to DEPTH * half the extent plus LIFT; the margin covers that.
        const pull = DEPTH * Math.max(width, height) / 2 + LIFT
        const marginCols = Math.ceil(pull / spacing) + 1
        const marginRows = Math.ceil(pull / rowStep) + 1
        cols = Math.ceil(width / spacing) + 1 + marginCols * 2
        rows = Math.ceil(height / rowStep) + 1 + marginRows * 2
        const count = cols * rows
        baseX = new Float32Array(count)
        baseY = new Float32Array(count)
        screenX = new Float32Array(count)
        screenY = new Float32Array(count)
        height3d = new Float32Array(count)
        crests = new Float32Array(count)
        inBand = new Uint8Array(count)
        radii = new Float32Array(count)
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const i = row * cols + col
                baseX[i] = (col - marginCols) * spacing + (row % 2 === 1 ? spacing / 2 : 0)
                baseY[i] = (row - marginRows) * rowStep
            }
        }
        if (initialPointer && !pointerMoved) {
            pointerX = targetX = initialPointer.x * width
            pointerY = targetY = initialPointer.y * height
        }
    }

    // Drops expired waves and precomputes each ring's annulus once per frame.
    function prepareRings(t: number) {
        let kept = 0
        for (const w of waves) {
            if (t - w.bornAt < WAVE_DURATION && t >= w.bornAt) waves[kept++] = w
        }
        waves.length = kept
        ringCount = waves.length
        for (let k = 0; k < ringCount; k++) {
            const w = waves[k]
            const age = t - w.bornAt
            const radius = age * WAVE_SPEED
            const minR = Math.max(0, radius - WAVE_BAND)
            const maxR = radius + WAVE_BAND
            const bandMin = Math.max(0, minR - spacing)
            const bandMax = maxR + spacing
            ringX[k] = w.x
            ringY[k] = w.y
            ringR[k] = radius
            ringFade[k] = (1 - age / WAVE_DURATION) ** 2 * w.strength
            ringMinSq[k] = minR * minR
            ringMaxSq[k] = maxR * maxR
            bandMinSq[k] = bandMin * bandMin
            bandMaxSq[k] = bandMax * bandMax
        }
    }

    // Quadratic falloff inside the spotlight, scaled by presence and HOVER_STRENGTH.
    function hoverEnvelope(x: number, y: number): number {
        if (presence <= 0.01) return 0
        const dx = x - pointerX
        const dy = y - pointerY
        const distSq = dx * dx + dy * dy
        if (distSq >= hoverSq) return 0
        const f = 1 - Math.sqrt(distSq) / HOVER_RADIUS
        return f * f * presence * HOVER_STRENGTH
    }

    // Smooth bell across the ring: 1 at the wavefront, 0 at its edges and outside. Strongest ring wins.
    function ringEnvelope(x: number, y: number): number {
        let best = 0
        for (let k = 0; k < ringCount; k++) {
            const dx = x - ringX[k]
            const dy = y - ringY[k]
            const distSq = dx * dx + dy * dy
            // Most points fall outside every annulus and never reach the square root.
            if (distSq <= ringMinSq[k] || distSq >= ringMaxSq[k]) continue
            const u = (Math.sqrt(distSq) - ringR[k]) / WAVE_BAND
            const bell = (1 - u * u) * (1 - u * u) * ringFade[k]
            if (bell > best) best = bell
        }
        return best
    }

    function draw(t: number) {
        prepareRings(t)
        const cx = width / 2
        const cy = height / 2
        const count = cols * rows
        const hovering = presence > 0.01
        const showLinks = ringCount > 0 || hovering
        for (let i = 0; i < count; i++) {
            const x = baseX[i]
            const y = baseY[i]
            let z = wave(x, y, t)
            let crest = 0
            let band = 0
            for (let k = 0; k < ringCount; k++) {
                const dx = x - ringX[k]
                const dy = y - ringY[k]
                const distSq = dx * dx + dy * dy
                if (distSq <= bandMinSq[k] || distSq >= bandMaxSq[k]) continue
                band = 1
                if (distSq <= ringMinSq[k] || distSq >= ringMaxSq[k]) continue
                const u = (Math.sqrt(distSq) - ringR[k]) / WAVE_BAND
                const bell = (1 - u * u) * (1 - u * u) * ringFade[k]
                // Rises on the crest and dips a little in the trough behind it.
                z += bell * (1 - 1.4 * u * u) * 0.65
                if (bell > crest) crest = bell
            }
            if (hovering) {
                const dx = x - pointerX
                const dy = y - pointerY
                if (dx * dx + dy * dy < hoverBandSq) {
                    band = 1
                    // The spotlight brightens without lifting, so it never reads as a wave.
                    const near = hoverEnvelope(x, y)
                    if (near > crest) crest = near
                }
            }
            height3d[i] = z
            crests[i] = crest
            inBand[i] = band
            screenX[i] = x + (x - cx) * z * DEPTH
            screenY[i] = y + (y - cy) * z * DEPTH - z * LIFT
        }

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, width, height)

        if (showLinks) {
            for (const bucket of linkBuckets) bucket.length = 0
            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    const i = row * cols + col
                    if (inBand[i] === 0) continue
                    // Right neighbour plus the two neighbours below make a triangular mesh.
                    const odd = row % 2 === 1
                    const below = row + 1 < rows
                    if (col + 1 < cols) addLink(i, i + 1)
                    if (below) addLink(i, i + cols)
                    if (below && odd && col + 1 < cols) addLink(i, i + cols + 1)
                    if (below && !odd && col > 0) addLink(i, i + cols - 1)
                }
            }
            ctx.lineWidth = 1
            for (let level = 0; level < LINK_LEVELS; level++) {
                const bucket = linkBuckets[level]
                if (bucket.length === 0) continue
                ctx.strokeStyle = `rgb(${linkRgb} / ${((level + 1) / LINK_LEVELS * 0.5).toFixed(3)})`
                ctx.beginPath()
                for (let k = 0; k < bucket.length; k += 2) {
                    ctx.moveTo(screenX[bucket[k]], screenY[bucket[k]])
                    ctx.lineTo(screenX[bucket[k + 1]], screenY[bucket[k + 1]])
                }
                ctx.stroke()
            }
        }

        for (const bucket of nodeBuckets) bucket.length = 0
        for (let i = 0; i < count; i++) {
            const lift = height3d[i] + 1
            const crest = crests[i]
            const alpha = Math.min(0.08 + lift * 0.1 + crest * 0.55, 0.75)
            radii[i] = 0.6 + lift * 0.45 + crest * 0.7
            nodeBuckets[Math.min(NODE_LEVELS - 1, Math.floor(alpha / 0.75 * NODE_LEVELS))].push(i)
        }
        ctx.fillStyle = `rgb(${nodeRgb})`
        for (let level = 0; level < NODE_LEVELS; level++) {
            const bucket = nodeBuckets[level]
            if (bucket.length === 0) continue
            ctx.globalAlpha = (level + 1) / NODE_LEVELS * 0.75
            ctx.beginPath()
            for (const i of bucket) {
                ctx.moveTo(screenX[i] + radii[i], screenY[i])
                ctx.arc(screenX[i], screenY[i], radii[i], 0, Math.PI * 2)
            }
            ctx.fill()
        }
        ctx.globalAlpha = 1
    }

    // Lights a link when its midpoint (on the undisplaced lattice) lies inside a ring or the spotlight.
    function addLink(a: number, b: number) {
        const mx = (baseX[a] + baseX[b]) / 2
        const my = (baseY[a] + baseY[b]) / 2
        const strength = Math.max(ringEnvelope(mx, my), hoverEnvelope(mx, my))
        const level = Math.floor(strength * LINK_LEVELS)
        if (level <= 0) return
        linkBuckets[Math.min(LINK_LEVELS - 1, level - 1)].push(a, b)
    }

    function frame(time: number) {
        frameId = requestAnimationFrame(frame)
        if (lastDraw === 0) {
            lastDraw = time
            nextDue = time
        }
        // A schedule rather than a minimum gap: on a 60 Hz display a 24 fps cap alternates two- and
        // three-frame gaps instead of settling on every third frame (20 fps). The 1 ms absorbs timestamp jitter.
        if (time < nextDue - 1) return
        nextDue = Math.max(nextDue + minFrameMs, time)
        const dt = Math.min((time - lastDraw) / 1000, 0.1)
        lastDraw = time
        elapsed += dt
        // Moving to a display with another pixel ratio changes no CSS size, so the ResizeObserver stays silent.
        if (targetDpr() !== dpr) rebuild()
        // Exponential easing keeps pointer tracking and fade frame-rate independent.
        const follow = 1 - Math.exp(-dt * 10)
        pointerX += (targetX - pointerX) * follow
        pointerY += (targetY - pointerY) * follow
        presence += ((pointerActive ? 1 : 0) - presence) * (1 - Math.exp(-dt * 3))
        draw(now())
    }

    function start() {
        if (frameId !== 0 || reducedMotion || still) return
        lastDraw = 0
        frameId = requestAnimationFrame(frame)
    }

    function stop() {
        cancelAnimationFrame(frameId)
        frameId = 0
    }

    function onPointerDown(event: PointerEvent) {
        // Primary button only for mice; touch and pen always count.
        if (event.pointerType === 'mouse' && event.button !== 0) return
        const rect = canvas.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top
        if (x < 0 || y < 0 || x > width || y > height) return
        if (waves.length >= maxWaves) waves.shift()
        waves.push({ x, y, bornAt: now(), strength: 1 })
    }

    function onPointerMove(event: PointerEvent) {
        if (event.pointerType === 'touch') return
        const rect = canvas.getBoundingClientRect()
        targetX = event.clientX - rect.left
        targetY = event.clientY - rect.top
        // Appear where the pointer is rather than sliding in from the last position.
        if (!pointerActive && presence < 0.01) {
            pointerX = targetX
            pointerY = targetY
        }
        pointerActive = true
        pointerMoved = true
    }

    function onPointerOut(event: PointerEvent) {
        if (event.relatedTarget === null) pointerActive = false
    }

    function onBlur() {
        pointerActive = false
    }

    function onVisibility() {
        if (document.hidden) stop()
        else start()
    }

    const resizeObserver = new ResizeObserver(() => {
        rebuild()
        if (reducedMotion || still) draw(startTime)
    })
    resizeObserver.observe(canvas)
    rebuild()

    if (initialWave && !reducedMotion) {
        const age = initialWave.age
        waves.push({
            x: initialWave.x * width,
            y: initialWave.y * height,
            bornAt: startTime - (age !== undefined && Number.isFinite(age) && age >= 0 ? age : 0.8),
            strength: 1,
        })
    }

    const interactive = !reducedMotion && !still
    if (!interactive) {
        draw(startTime)
    } else {
        window.addEventListener('pointerdown', onPointerDown, { passive: true })
        window.addEventListener('pointermove', onPointerMove, { passive: true })
        document.addEventListener('pointerout', onPointerOut, { passive: true })
        window.addEventListener('blur', onBlur)
        document.addEventListener('visibilitychange', onVisibility)
        if (!document.hidden) start()
    }

    return {
        destroy() {
            stop()
            resizeObserver.disconnect()
            if (interactive) {
                window.removeEventListener('pointerdown', onPointerDown)
                window.removeEventListener('pointermove', onPointerMove)
                document.removeEventListener('pointerout', onPointerOut)
                window.removeEventListener('blur', onBlur)
                document.removeEventListener('visibilitychange', onVisibility)
            }
        },
    }
}
