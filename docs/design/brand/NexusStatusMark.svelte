<script lang="ts">
    import './nexus-mark.css'
    import { brandStatusLabels, type BrandStatus } from './brandStatus'
    import { MARK_VIEWBOX, PROGRESS_MIN_SIZE, markInner, progressPercent, progressStyle } from './nexusMark'

    interface Props {
        status: BrandStatus
        /** Text alternative; defaults to the English label for the status. */
        label?: string
        /** Rendered width and height in CSS pixels. */
        size?: number
        /** Shows the label beside the mark; otherwise it is available only to assistive technology. */
        showLabel?: boolean
        /** Drops the blurred glow and repeated layers for mobile and constrained webviews. */
        lowPower?: boolean
        /** Stops loops, for lists that show many marks at once. Poses still tell the statuses apart. */
        still?: boolean
        /**
         * Determinate progress from 0 to 1 for counted work (import, backup load, bulk memory, archive). Omit when
         * indeterminate. From PROGRESS_MIN_SIZE (40 px) up it draws a ring; smaller marks show the percentage beside them.
         */
        progress?: number
        /** `light` recolours the mark for light colour schemes; bind it to ColorSchemeTypeStore at integration. */
        tone?: 'dark' | 'light'
    }

    let { status, label, size = 32, showLabel = false, lowPower = false, still = false, progress, tone = 'dark' }: Props = $props()

    // The parts are rendered once per instance and never re-rendered: a status change only flips
    // data-status, so the CSS transitions morph the shape instead of swapping it.
    const uid = $props.id()
    const inner = markInner(uid)
    const text = $derived(label ?? brandStatusLabels[status])
    const percent = $derived(progress === undefined ? undefined : progressPercent(progress))
    const ring = $derived(percent !== undefined && size >= PROGRESS_MIN_SIZE)
    // The status region would announce every percent; assistive technology hears tens, the visible label is exact.
    const spoken = $derived(percent === undefined ? text : `${text}, ${Math.floor(percent / 10) * 10}%`)
</script>

<span role="status" class="inline-flex items-center gap-2 {tone === 'light' ? 'text-textcolor' : 'text-nexus-text'}">
    <svg
        class="nexus-mark shrink-0"
        viewBox={MARK_VIEWBOX}
        width={size}
        height={size}
        aria-hidden="true"
        focusable="false"
        data-status={status}
        data-low-power={lowPower ? '' : undefined}
        data-still={still ? '' : undefined}
        data-progress={ring ? '' : undefined}
        data-tone={tone === 'light' ? 'light' : undefined}
        style={ring && progress !== undefined ? progressStyle(progress) : undefined}
    >
        {@html inner}
    </svg>
    {#if showLabel}
        <span class="text-sm" aria-hidden="true">{text}{percent === undefined ? '' : ` ${percent}%`}</span>
    {:else if percent !== undefined && !ring}
        <!-- Too small for the ring: the percentage stands in for it. -->
        <span class="text-xs tabular-nums" aria-hidden="true">{percent}%</span>
    {/if}
    <span class="sr-only">{spoken}</span>
</span>
