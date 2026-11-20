<script module lang="ts">
    const DRAWN = ['origin-navy', 'banana-cocoa', 'scratch-white', 'office-sheet'] as const

    /** True when a built-in has its own drawn thumbnail; any other slug keeps the generated tile. */
    export function hasBuiltinThumb(slug: string): boolean {
        return (DRAWN as readonly string[]).includes(slug)
    }
</script>

<script lang="ts">
    /**
     * The picker tile of a built-in pack: a miniature of the chat screen in that pack's own palette and shapes. The colours
     * are the pack's, not the app's, so the tile looks the same under either app scheme. The ground rect is the pack's
     * secondary colour, as on the generated tile.
     */
    let { slug }: { slug: string } = $props()

    // Gradient ids are document-global, so each instance gets its own.
    const uid = $props.id()
    const bloomId = `thumb-bloom-${uid}`
    const sendId = `thumb-send-${uid}`
    // Handwriting: one wave per 8 units, a line of n waves drawn from x 20 at height y.
    function scribble(y: number, waves: number): string {
        return `M20 ${y}q4-1.6 8 0` + 't8 0'.repeat(waves - 1)
    }
    const RULER = Array.from({ length: 19 }, (_, i) => ({ x: 12 + 4 * i, top: i % 6 === 0 ? 14 : i % 3 === 0 ? 16 : 16.5 }))
</script>

<svg viewBox="0 0 96 96" class="w-full h-full block" aria-hidden="true" style="forced-color-adjust:none" data-part="theme-pack-tile" data-thumb={slug}>
    {#if slug === 'origin-navy'}
        <defs>
            <radialGradient id={bloomId} cx="0.3" cy="0.15" r="0.9"><stop offset="0" stop-color="#282a36" /><stop offset="1" stop-color="#282a36" stop-opacity="0" /></radialGradient>
            <linearGradient id={sendId} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6272a4" /><stop offset="1" stop-color="#44475a" /></linearGradient>
        </defs>
        <rect width="96" height="96" fill="#21222c" data-part="tile-ground" />
        <rect width="96" height="96" fill="url(#{bloomId})" />
        <rect width="96" height="16" fill="#2f3140" />
        <circle cx="9" cy="8" r="4" fill="#44475a" stroke="#8be9fd" stroke-width="1" />
        <rect x="17" y="6.5" width="26" height="3" rx="1.5" fill="#f8f8f2" />
        <circle cx="81" cy="8" r="1.6" fill="#9aa5c8" />
        <circle cx="87" cy="8" r="1.6" fill="#9aa5c8" />
        <circle cx="9" cy="27" r="4" fill="#6272a4" />
        <rect x="17" y="21" width="16" height="2.5" rx="1.25" fill="#ffb86c" />
        <rect x="17" y="26" width="62" height="21" rx="4" fill="rgb(98 114 164 / 0.22)" stroke="rgb(98 114 164 / 0.45)" stroke-width="0.8" />
        <rect x="21" y="30" width="50" height="2.4" rx="1.2" fill="#c3c9de" />
        <rect x="21" y="35" width="42" height="2.4" rx="1.2" fill="#c3c9de" />
        <rect x="21" y="40" width="10" height="2.4" rx="1.2" fill="#bd93f9" />
        <rect x="33" y="40" width="24" height="2.4" rx="1.2" fill="#9aa5c8" />
        <rect x="38" y="53" width="52" height="14" rx="4" fill="rgb(139 233 253 / 0.12)" stroke="#8be9fd" stroke-width="0.9" />
        <rect x="43" y="58.8" width="36" height="2.4" rx="1.2" fill="#f8f8f2" />
        <rect y="76" width="96" height="20" fill="#2f3140" />
        <rect x="6" y="81" width="64" height="10" rx="4" fill="#1e1f29" stroke="#6272a4" stroke-width="0.9" />
        <rect x="10" y="84.8" width="22" height="2.4" rx="1.2" fill="#9aa5c8" />
        <rect x="74" y="80" width="16" height="12" rx="4" fill="url(#{sendId})" />
        <path d="M78.5 86h7m-3-3 3 3-3 3" fill="none" stroke="#8be9fd" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    {:else if slug === 'banana-cocoa'}
        <rect width="96" height="96" fill="#b2c7da" data-part="tile-ground" />
        <path d="M7 8.5l3.5-3.5M7 8.5l3.5 3.5" fill="none" stroke="#191919" stroke-width="1.4" stroke-linecap="round" />
        <rect x="15" y="7" width="26" height="3" rx="1.5" fill="#191919" />
        <circle cx="82" cy="8.5" r="2.6" fill="none" stroke="#191919" stroke-width="1.2" />
        <path d="M84 10.5l2 2" stroke="#191919" stroke-width="1.2" stroke-linecap="round" />
        <rect x="5" y="20" width="12" height="12" rx="4.5" fill="#fff0a0" />
        <circle cx="9.3" cy="25" r="0.9" fill="#3a2f1a" />
        <circle cx="12.7" cy="25" r="0.9" fill="#3a2f1a" />
        <path d="M9 28q2 1.4 4 0" fill="none" stroke="#3a2f1a" stroke-width="0.9" stroke-linecap="round" />
        <rect x="20" y="19" width="14" height="2.4" rx="1.2" fill="#3c4650" />
        <!-- The first bubble of a run has one small corner as its tail: top left for the character, top right for the user. -->
        <path d="M22 24h40a7 7 0 0 1 7 7v1a7 7 0 0 1-7 7h-41a1 1 0 0 1-1-1v-12a2 2 0 0 1 2-2z" fill="#ffffff" />
        <rect x="25" y="29.8" width="38" height="2.4" rx="1.2" fill="#191919" />
        <rect x="20" y="42" width="34" height="11" rx="5.5" fill="#ffffff" />
        <rect x="25" y="46.3" width="22" height="2.4" rx="1.2" fill="#191919" />
        <path d="M51 57h37a2 2 0 0 1 2 2v9a1 1 0 0 1-1 1h-38a6 6 0 0 1-6-6v0a6 6 0 0 1 6-6z" fill="#fee500" />
        <rect x="51" y="61.8" width="32" height="2.4" rx="1.2" fill="#191919" />
        <rect y="76" width="96" height="20" fill="#ffffff" />
        <rect x="6" y="80" width="64" height="12" rx="6" fill="#f6f7f9" stroke="rgb(0 0 0 / 0.12)" stroke-width="0.8" />
        <rect x="74" y="80" width="16" height="12" rx="6" fill="#fee500" />
        <path d="M78.5 86h7m-3-3 3 3-3 3" fill="none" stroke="#191919" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    {:else if slug === 'scratch-white'}
        <rect width="96" height="96" fill="#fdfdfa" data-part="tile-ground" />
        <rect width="96" height="15" fill="#f6f6f1" />
        <path d="M17 6.5q5-2 10 0t10 0t8 0" fill="none" stroke="#2b2e34" stroke-width="1.6" stroke-linecap="round" />
        <line x1="0" y1="15.5" x2="96" y2="15.5" stroke="rgb(43 46 52 / 0.55)" stroke-width="1.2" stroke-dasharray="3 2" />
        <line x1="15" y1="16" x2="15" y2="77" stroke="#f0a8a6" stroke-width="1.3" />
        <circle cx="7" cy="31" r="2.6" fill="#e4e4de" />
        <circle cx="7" cy="61" r="2.6" fill="#e4e4de" />
        <g fill="none" stroke-linecap="round">
            <path d={scribble(24, 6)} stroke="#2b2e34" stroke-width="1.3" />
            <path d={scribble(30, 5)} stroke="#2b2e34" stroke-width="1.3" />
            <path d={scribble(43, 5)} stroke="#1f4aa8" stroke-width="1.4" />
            <path d={scribble(49, 3)} stroke="#1f4aa8" stroke-width="1.4" />
            <path d={scribble(62, 7)} stroke="#2b2e34" stroke-width="1.3" />
            <path d={scribble(68, 3)} stroke="#2b2e34" stroke-width="1.3" />
        </g>
        <g stroke="#b9cfe9" stroke-width="0.9">
            <line x1="0" y1="36" x2="96" y2="36" />
            <line x1="0" y1="55" x2="96" y2="55" />
            <line x1="0" y1="72" x2="96" y2="72" />
        </g>
        <line x1="0" y1="78" x2="96" y2="78" stroke="rgb(43 46 52 / 0.55)" stroke-width="1.2" stroke-dasharray="3 2" />
        <rect x="6" y="83" width="64" height="9" rx="3" fill="#ffffff" stroke="rgb(43 46 52 / 0.55)" stroke-width="0.9" />
        <rect x="75" y="82" width="15" height="11" rx="3" fill="#1f4aa8" />
        <path d="M79 87.5h7m-3-3 3 3-3 3" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    {:else if slug === 'office-sheet'}
        <rect width="96" height="96" fill="#f3f4f6" data-part="tile-ground" />
        <rect y="19" width="96" height="59" fill="#e3e5e8" />
        <text x="7" y="10" font-family="ui-serif, serif" font-size="7.5" font-weight="700" fill="#1f2328">B</text>
        <text x="15" y="10" font-family="ui-serif, serif" font-size="7.5" font-style="italic" fill="#1f2328">I</text>
        <text x="21" y="10" font-family="ui-serif, serif" font-size="7.5" text-decoration="underline" fill="#1f2328">U</text>
        <rect x="31" y="5" width="0.8" height="6" fill="#c4c8ce" />
        <rect x="36" y="6.5" width="10" height="1.4" fill="#50565f" />
        <rect x="36" y="9" width="7" height="1.4" fill="#50565f" />
        <rect x="80" y="4.5" width="10" height="7" rx="1.5" fill="#1a55ba" />
        <line x1="0" y1="18.5" x2="96" y2="18.5" stroke="#c4c8ce" stroke-width="1" />
        <g stroke="#8c939c" stroke-width="0.7">
            {#each RULER as tick (tick.x)}
                <line x1={tick.x} y1="18" x2={tick.x} y2={tick.top} />
            {/each}
        </g>
        <rect x="13" y="25" width="72" height="51" fill="rgb(0 0 0 / 0.18)" />
        <rect x="12" y="24" width="72" height="52" fill="#ffffff" stroke="#c4c8ce" stroke-width="0.8" />
        <text x="18" y="35" font-family="ui-serif, serif" font-size="9" fill="#1f2328">Aa</text>
        <rect x="18" y="39" width="58" height="1.8" fill="#1f2328" />
        <rect x="18" y="43.5" width="60" height="1.8" fill="#1f2328" />
        <rect x="18" y="48" width="44" height="1.8" fill="#1f2328" />
        <rect x="24" y="55" width="50" height="1.8" fill="#1a55ba" />
        <rect x="24" y="59.5" width="32" height="1.8" fill="#1a55ba" />
        <rect x="18" y="66" width="56" height="1.8" fill="#474d55" />
        <rect y="78" width="96" height="18" fill="#f3f4f6" />
        <line x1="0" y1="78.5" x2="96" y2="78.5" stroke="#c4c8ce" stroke-width="1" />
        <rect x="5" y="82" width="10" height="10" rx="2" fill="#ffffff" stroke="#c4c8ce" stroke-width="0.8" />
        <path d="M10 84.5v5m-2.5-2.5h5" stroke="#474d55" stroke-width="1.1" stroke-linecap="round" />
        <rect x="18" y="82" width="54" height="10" rx="2" fill="#ffffff" stroke="#c4c8ce" stroke-width="0.8" />
        <rect x="76" y="82" width="14" height="10" rx="2" fill="#1a55ba" />
        <path d="M79.5 87h7m-3-3 3 3-3 3" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    {/if}
</svg>
