<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { splitStreamingText, renderOpenParagraphSource, createToSafeHtml } from '../../ts/chatShell/streamingSafe'
    import { createStreamCadence } from '../../ts/chatShell/streamCadence'

    interface Props {
        text: string
        modelShortName?: string
        character?: Parameters<typeof createToSafeHtml>[1]
    }
    let { text, modelShortName = '', character = null }: Props = $props()
    const cadence = createStreamCadence()
    let finished = $state<{ source: string, html: string }[]>([])
    let openHtml = $state('')
    let pending = ''
    let timer: ReturnType<typeof setTimeout> | null = null
    let frame: number | null = null
    let disposed = false
    let safeHtml: Promise<(source: string) => Promise<string>> | null = null
    let serial = 0

    async function render() {
        timer = null
        const started = performance.now()
        const version = ++serial
        const split = splitStreamingText(pending)
        const convert = await (safeHtml ??= createToSafeHtml(modelShortName, character))
        const additions: { source: string, html: string }[] = []
        for (let i = finished.length; i < split.finished.length; i++) {
            additions.push({ source: split.finished[i], html: await convert(split.finished[i]) })
        }
        const nextOpen = await convert(renderOpenParagraphSource(split.open))
        if (disposed || version !== serial) return
        if (additions.length) finished = [...finished, ...additions]
        openHtml = nextOpen
        cadence.record(performance.now() - started)
    }

    function schedule(value: string) {
        pending = value
        if (timer !== null) return
        timer = setTimeout(() => {
            if (typeof requestAnimationFrame === 'function') {
                frame = requestAnimationFrame(() => { frame = null; void render() })
            } else void render()
        }, cadence.interval)
    }

    $effect(() => {
        // A changed prefix starts a new stream; appended suffixes never replace finished nodes.
        if (!text.startsWith(untrack(() => finished.map((block) => block.source).join('')))) finished = []
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
    <div data-part="chat-stream-open" aria-live="polite">{@html openHtml}</div>
</div>
