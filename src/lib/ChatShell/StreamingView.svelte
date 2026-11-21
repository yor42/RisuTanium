<script lang="ts">
    import { onDestroy, tick, untrack } from 'svelte'
    import { splitStreamingText, describeOpenTail, createSpanRules, createToSafeHtml, type OpenTailChip, type StreamingParseContext } from '../../ts/chatShell/streamingSafe'
    import { NO_SPANS, type SpanRules } from '../../ts/chatShell/streamSpans'
    import { recordCaughtError } from '../../ts/caughtErrors'
    import { createStreamCadence } from '../../ts/chatShell/streamCadence'
    import { lowPowerMarked } from '../../ts/chatShell/lowPower'
    import { yieldToEventLoop } from '../../ts/chatShell/yieldToEventLoop'
    import { language } from '../../lang'
    import '../../styles/scene-break.css'

    interface Props {
        text: string
        modelShortName?: string
        character?: Parameters<typeof createToSafeHtml>[1]
        parseContext?: StreamingParseContext
    }
    let { text, modelShortName = '', character = null, parseContext = {} }: Props = $props()
    // Read once per view: the view mounts when a stream starts, so a marker set mid-stream applies from the next stream.
    const cadence = createStreamCadence(lowPowerMarked())
    let finished = $state<{ source: string, html: string }[]>([])
    let openHtml = $state('')
    let chip = $state<OpenTailChip | null>(null)
    // The raw-code peek of the code chip. `follow` keeps the newest line in view until the user scrolls up inside the peek;
    // both reset when the code chip goes away.
    let peek = $state(false)
    let follow = true
    let root = $state<HTMLDivElement | null>(null)
    let codeButton = $state<HTMLButtonElement | null>(null)
    let peekEl = $state<HTMLPreElement | null>(null)
    let pending = ''
    let timer: ReturnType<typeof setTimeout> | null = null
    let frame: number | null = null
    let disposed = false
    let safeHtml: Promise<(source: string) => Promise<string>> | null = null
    let spanRules: Promise<SpanRules> | null = null
    let serial = 0
    let inFlight = false
    let renderedText: string | null = null

    // A failed rule load leaves the view without display-regex probes; CBS balance holds still apply.
    function loadSpanRules(): Promise<SpanRules> {
        return createSpanRules(character).catch((error: unknown) => {
            recordCaughtError('chat.parse', error)
            return NO_SPANS
        })
    }

    // Single-flight: a chunk that arrives while a render converts only updates `pending`; the render that ends
    // schedules one more pass for the latest text, so a conversion slower than the cadence still commits.
    async function render() {
        timer = null
        inFlight = true
        // The cadence measures the work of a pass; time spent waiting in yields is not conversion cost.
        let busyMs = 0
        let mark = performance.now()
        const pause = async () => {
            busyMs += performance.now() - mark
            await yieldToEventLoop()
            mark = performance.now()
        }
        const version = serial
        const source = pending
        let committed = false
        try {
            // Both per-view promises resolve before the first split: finished blocks never change, so a block split
            // without the span rules could finish text that a rule holds.
            const [rules, convert] = await Promise.all([
                spanRules ??= loadSpanRules(),
                safeHtml ??= createToSafeHtml(modelShortName, character, untrack(() => parseContext)),
            ])
            if (disposed || version !== serial) return
            // Only the not-yet-finished tail is split when the text still starts with the finished prefix.
            const prefix = finished.map((block) => block.source).join('')
            const incremental = prefix.length > 0 && source.startsWith(prefix)
            const split = splitStreamingText(source, incremental ? prefix.length : 0, rules)
            const fresh = incremental ? split.finished : split.finished.slice(finished.length)
            // Each yield is a macrotask so the work of one pass is not one long task; a stale pass stops at the next check.
            await pause()
            if (disposed || version !== serial) return
            const additions: { source: string, html: string }[] = []
            for (const blockSource of fresh) {
                if (disposed || version !== serial) return
                additions.push({ source: blockSource, html: await convert(blockSource) })
                await pause()
            }
            if (disposed || version !== serial) return
            const tail = describeOpenTail(split.open, rules)
            const nextOpen = await convert(tail.source)
            await pause()
            if (disposed || version !== serial) return
            if (additions.length) finished = [...finished, ...additions]
            openHtml = nextOpen
            // A focused code chip that unmounts hands focus to the message, so keyboard focus is not dropped to the page.
            const focusLost = tail.chip?.kind !== 'code' && codeButton !== null && document.activeElement === codeButton
            chip = tail.chip
            if (tail.chip?.kind !== 'code') {
                peek = false
                follow = true
            }
            committed = true
            if (focusLost) {
                await tick()
                if (!disposed) root?.closest<HTMLElement>('[data-part="chat-message"]')?.focus()
            }
        } finally {
            busyMs += performance.now() - mark
            cadence.record(busyMs)
            inFlight = false
            // A failed or superseded pass is not retried on its own text; only newer text schedules another pass.
            renderedText = committed || version === serial ? source : null
            if (!disposed && pending !== renderedText) schedule(pending)
        }
    }

    function schedule(value: string) {
        pending = value
        if (timer !== null || inFlight) return
        timer = setTimeout(() => {
            if (typeof requestAnimationFrame === 'function') {
                frame = requestAnimationFrame(() => { frame = null; void render() })
            } else void render()
        }, cadence.interval)
    }

    $effect(() => {
        // A changed prefix starts a new stream; appended suffixes never replace finished nodes.
        // Invalidating the serial keeps a render already in flight from appending blocks of the old text.
        if (!text.startsWith(untrack(() => finished.map((block) => block.source).join('')))) { finished = []; serial++ }
        schedule(text)
    })
    $effect(() => {
        const raw = chip?.kind === 'code' ? chip.raw : ''
        const el = peekEl
        void raw
        if (peek && follow && el) el.scrollTop = el.scrollHeight
    })
    function onPeekScroll(event: Event & { currentTarget: HTMLPreElement }) {
        const el = event.currentTarget
        follow = el.scrollHeight - el.scrollTop - el.clientHeight <= 2
    }
    onDestroy(() => {
        disposed = true
        if (timer !== null) clearTimeout(timer)
        if (frame !== null) cancelAnimationFrame(frame)
    })
</script>

<div data-part="chat-streaming-view" bind:this={root}>
    {#each finished as block, i (i)}
        <div data-part="chat-stream-finished">{@html block.html}</div>
    {/each}
    <div data-part="chat-stream-open">{@html openHtml}</div>
    {#if chip?.kind === 'thinking'}<div data-part="chat-stream-thinking">{@render chipText(language.chatShellThinking(chip.words))}</div>
    {:else if chip?.kind === 'formatting'}<div data-part="chat-stream-formatting">{@render chipText(language.chatShellFormatting)}</div>
    {:else if chip?.kind === 'code'}<button type="button" data-part="chat-stream-code" aria-expanded={peek} bind:this={codeButton} onclick={() => { peek = !peek; if (peek) follow = true }}>{@render chipText(language.chatShellWritingCode(chip.lines))}</button>
        {#if peek}<pre data-part="chat-stream-code-peek" bind:this={peekEl} onscroll={onPeekScroll}>{chip.raw}</pre>{/if}
    {:else if chip?.kind === 'styles'}<div data-part="chat-stream-styles">{@render chipText(language.chatShellWritingStyles)}</div>
    {:else if chip?.kind === 'image'}<div data-part="chat-stream-image" role="img" aria-label={language.chatShellImageLoading}></div>{/if}
</div>

{#snippet chipText(label: string)}{label}{/snippet}

<style>
    [data-part="chat-stream-code"] { background: none; border: 0; padding: 0; margin: 0; font: inherit; text-align: start; cursor: pointer; }
    [data-part="chat-stream-thinking"], [data-part="chat-stream-formatting"], [data-part="chat-stream-code"], [data-part="chat-stream-styles"] { color: var(--nexus-text-secondary); font-style: italic; font-size: var(--font-size-xs); }
    [data-part="chat-stream-code-peek"] { font-family: var(--mono); font-size: var(--font-size-xs); color: var(--nexus-text-secondary); max-block-size: 40vh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
    [data-part="chat-stream-image"] { position: relative; overflow: hidden; inline-size: 160px; aspect-ratio: 1; max-inline-size: 100%; border-radius: var(--radius-5); background-color: var(--nexus-surface-raised); }
    [data-part="chat-stream-image"]::after { content: ""; position: absolute; inset: 0; background-image: linear-gradient(90deg, transparent, var(--nexus-surface), transparent); animation: image-sweep var(--dur-shimmer) var(--ease-linear) infinite; }
    @keyframes image-sweep { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) {
        :global(html:not(.rm-off)) [data-part="chat-stream-image"]::after { animation: none; }
    }
    :global(html.rm) [data-part="chat-stream-image"]::after { animation: none; }
    :global(html[data-low-power]) [data-part="chat-stream-image"]::after, :global(html.nexus-low-power) [data-part="chat-stream-image"]::after { animation: none; }
</style>
