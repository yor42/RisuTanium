<script lang="ts">
    import type { Segment, SpanKind } from '../../ts/studio/longText/highlightSpans'
    import { heightsDiverge, LT_TEXT_LAYOUT, metricsAgree, overlayBoxStyle, supportsScrollbarGutter } from '../../ts/studio/longText/overlayMetrics'

    // The coloured copy of one long-text field's text, drawn over its textarea. It never takes input and never
    // writes: the textarea keeps the caret, the selection and every event, and this only mirrors its text and metrics.
    // The text it draws is the field's text plus one trailing newline, so a last empty line has its height.
    interface Props {
        area: HTMLTextAreaElement | undefined
        segments: readonly Segment[]
        // `typing` keeps the element but draws nothing; `off` is the same for a field that is not coloured.
    // (Not named `state`: that would read as the `$state` rune's store form.)
        phase: 'on' | 'off' | 'typing'
        scrollTop: number
        // Called when the overlay and the textarea no longer break lines the same way; the owner turns colouring off.
        onmisalign?: () => void
    }

    let { area, segments, phase, scrollTop, onmisalign }: Props = $props()

    let element = $state<HTMLDivElement | undefined>()

    // Colour and line decoration only: weight, slant and size would move glyph advances and break the overlay.
    const KIND_CLASS: Record<SpanKind, string> = {
        brace: 'text-textcolor2',
        name: '',
        sep: 'text-textcolor2',
        arg: '',
        block: '',
        comment: 'text-textcolor2',
        deprecated: 'line-through',
    }

    const SEVERITY_CLASS: Record<NonNullable<Segment['severity']>, string> = {
        error: 'underline decoration-wavy decoration-draculared',
        warning: 'underline decoration-wavy decoration-textcolor',
        info: 'underline decoration-dotted decoration-textcolor2',
    }

    function segmentClass(segment: Segment): string {
        return [segment.kind === null ? '' : KIND_CLASS[segment.kind], segment.severity === null ? '' : SEVERITY_CLASS[segment.severity]].filter(Boolean).join(' ')
    }

    // Applies the textarea's box (padding and border, which text zoom does not scale) straight to the element, so a
    // reader never sees a stale box. Font metrics are inherited, never copied: a copied px length would be
    // text-zoomed a second time. The element carries no template `style`, which would overwrite these properties.
    function applyBox(): void {
        if (!area || !element) return
        const rules = overlayBoxStyle(getComputedStyle(area), supportsScrollbarGutter(), { offsetWidth: area.offsetWidth, clientWidth: area.clientWidth })
        for (const [name, value] of rules) element.style.setProperty(name, value)
    }

    // Reports a mismatch between the textarea and this overlay. It applies the box itself before reading, so it never
    // reads an unmeasured overlay whatever order the effects ran in, and it skips a hidden field (no layout to compare).
    // A wrap drift is whole lines, so only a height gap of almost a line counts; unusable metrics never trip.
    function check(): void {
        if (phase !== 'on' || !area || !element || area.offsetParent === null) return
        applyBox()
        const areaStyle = getComputedStyle(area)
        if (!metricsAgree(areaStyle, getComputedStyle(element)) || heightsDiverge(area.scrollHeight, element.scrollHeight, parseFloat(areaStyle.lineHeight))) onmisalign?.()
    }

    $effect(() => {
        if (!area || !element) return
        applyBox()
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(() => {
            applyBox()
            check()
        })
        observer.observe(area)
        return () => observer.disconnect()
    })

    // Runs on every segments change, so the fallback right offset follows a scrollbar that appears without a resize.
    $effect(() => {
        void segments
        applyBox()
        if (element) element.scrollTop = scrollTop
        check()
    })
</script>

<div
    bind:this={element}
    aria-hidden="true"
    data-part="studio-lt-overlay"
    data-overlay={phase}
    dir="auto"
    class="pointer-events-none absolute inset-0 overflow-hidden border-solid border-transparent text-textcolor {LT_TEXT_LAYOUT}"
>{#if phase === 'on'}{#each segments as segment}<span data-kind={segment.kind} data-severity={segment.severity} class={segmentClass(segment)}>{segment.text}</span>{/each}<span data-sentinel="">{'\n'}</span>{/if}</div>
