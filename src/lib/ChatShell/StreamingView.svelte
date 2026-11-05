<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { splitStreamingText, renderOpenParagraphSource, openThoughtsWordCount, createToSafeHtml, type StreamingParseContext } from '../../ts/chatShell/streamingSafe'
    import { createStreamCadence } from '../../ts/chatShell/streamCadence'
    import { language } from '../../lang'

    interface Props {
        text: string
        modelShortName?: string
        character?: Parameters<typeof createToSafeHtml>[1]
        parseContext?: StreamingParseContext
    }
    let { text, modelShortName = '', character = null, parseContext = {} }: Props = $props()
    const cadence = createStreamCadence()
    let finished = $state<{ source: string, html: string }[]>([])
    let openHtml = $state('')
    let thinkingWords = $state<number | null>(null)
    let pending = ''
    let timer: ReturnType<typeof setTimeout> | null = null
    let frame: number | null = null
    let disposed = false
    let safeHtml: Promise<(source: string) => Promise<string>> | null = null
    let serial = 0
    let inFlight = false
    let renderedText: string | null = null

    // Single-flight: a chunk that arrives while a render converts only updates `pending`; the render that ends
    // schedules one more pass for the latest text, so a conversion slower than the cadence still commits.
    async function render() {
        timer = null
        inFlight = true
        const started = performance.now()
        const version = serial
        const source = pending
        let committed = false
        try {
            const split = splitStreamingText(source)
            const convert = await (safeHtml ??= createToSafeHtml(modelShortName, character, untrack(() => parseContext)))
            const additions: { source: string, html: string }[] = []
            for (let i = finished.length; i < split.finished.length; i++) {
                if (disposed || version !== serial) break
                additions.push({ source: split.finished[i], html: await convert(split.finished[i]) })
            }
            const nextOpen = await convert(renderOpenParagraphSource(split.open))
            if (disposed || version !== serial) return
            if (additions.length) finished = [...finished, ...additions]
            openHtml = nextOpen
            thinkingWords = openThoughtsWordCount(split.open)
            committed = true
        } finally {
            cadence.record(performance.now() - started)
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
    onDestroy(() => {
        disposed = true
        if (timer !== null) clearTimeout(timer)
        if (frame !== null) cancelAnimationFrame(frame)
    })
</script>

<div data-part="chat-streaming-view">
    {#each finished as block, i (i)}
        <div data-part="chat-stream-finished">{@html block.html}</div>
    {/each}
    {#if thinkingWords !== null}<div data-part="chat-stream-thinking">{language.chatShellThinking(thinkingWords)}</div>{/if}
    <div data-part="chat-stream-open">{@html openHtml}</div>
</div>

<style>
    [data-part="chat-stream-thinking"] { color: var(--nexus-text-secondary); font-style: italic; font-size: var(--font-size-xs); }
</style>
