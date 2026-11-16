<script lang="ts">
    import type { Segment, SpanKind } from '../../ts/studio/longText/highlightSpans'

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
    }

    let { area, segments, phase, scrollTop }: Props = $props()

    let element = $state<HTMLDivElement | undefined>()
    let metrics = $state('')
    let scrollbar = $state(0)

    const KIND_CLASS: Record<SpanKind, string> = {
        brace: 'text-textcolor2',
        name: 'font-bold',
        sep: 'text-textcolor2',
        arg: '',
        block: 'font-bold italic',
        comment: 'text-textcolor2 italic',
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

    function px(value: string): number {
        const parsed = parseFloat(value)
        return Number.isFinite(parsed) ? parsed : 0
    }

    // Copies the textarea's text metrics and box, so lines wrap where the textarea wraps. The scrollbar's width is
    // taken from the right edge: the overlay has no scrollbar of its own.
    function measure(): void {
        if (!area) return
        const computed = getComputedStyle(area)
        const rules: [string, string][] = [
            ['font-family', computed.fontFamily],
            ['font-size', computed.fontSize],
            ['font-weight', computed.fontWeight],
            ['font-style', computed.fontStyle],
            ['line-height', computed.lineHeight],
            ['letter-spacing', computed.letterSpacing],
            ['word-spacing', computed.wordSpacing],
            ['tab-size', computed.tabSize],
            ['padding', computed.padding],
            ['border-width', computed.borderWidth],
        ]
        metrics = rules.filter(([, value]) => value !== '').map(([name, value]) => `${name}:${value}`).join(';')
        scrollbar = Math.max(0, area.offsetWidth - area.clientWidth - px(computed.borderLeftWidth) - px(computed.borderRightWidth))
    }

    $effect(() => {
        if (!area) return
        measure()
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(() => measure())
        observer.observe(area)
        return () => observer.disconnect()
    })

    $effect(() => {
        void segments
        if (element) element.scrollTop = scrollTop
    })
</script>

<div
    bind:this={element}
    aria-hidden="true"
    data-part="studio-lt-overlay"
    data-overlay={phase}
    dir="auto"
    class="pointer-events-none absolute left-0 top-0 bottom-0 overflow-hidden whitespace-pre-wrap break-words border-solid border-transparent text-textcolor"
    style={`${metrics};right:${scrollbar}px`}
>{#if phase === 'on'}{#each segments as segment}<span data-kind={segment.kind} data-severity={segment.severity} class={segmentClass(segment)}>{segment.text}</span>{/each}<span data-sentinel="">{'\n'}</span>{/if}</div>
