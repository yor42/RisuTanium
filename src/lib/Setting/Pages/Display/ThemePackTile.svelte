<script lang="ts">
    import type { TileSpec } from 'src/ts/themePack/tileDesign'

    /** The picker tile of one pack, drawn from its spec; null draws the None tile. Pack colours appear only as SVG paint. */
    let { spec }: { spec: TileSpec | null } = $props()

    const paint = $derived(spec === null || spec.neutral ? null : { ground: spec.ground, ink: spec.ink, glyph: spec.glyphInk })

    const geometry = $derived.by(() => {
        if (spec === null) {
            return null
        }
        const { a, b, c } = spec.params
        const lines: number[] = []
        const points: Array<[number, number]> = []
        if (spec.family === 'bands') {
            const step = 14 + 3 * b
            for (let y = -20 + 4 * a; y < 90; y += step) {
                lines.push(y)
            }
        } else if (spec.family === 'dots') {
            const step = 11 + 2 * a
            for (let row = 0, y = 6; y < 64; row++, y += step) {
                for (let x = 6 + (c === 1 && row % 2 === 1 ? step / 2 : 0); x < 64; x += step) {
                    points.push([x, y])
                }
            }
        } else if (spec.family === 'chevrons') {
            const step = 13 + 2 * b
            for (let y = -6 + 2 * a; y < 64; y += step) {
                lines.push(y)
            }
        }
        return { a, b, c, lines, points }
    })

    function stairs(a: number, c: number): string {
        const count = 3 + (a & 1)
        const width = 64 / count
        const rise = 40 / count
        let d = c === 1 ? 'M64 64' : 'M0 64'
        for (let i = 0; i < count; i++) {
            const x = c === 1 ? 64 - i * width : i * width
            const next = c === 1 ? x - width : x + width
            d += ` L${x} ${60 - i * rise} L${next} ${60 - i * rise}`
        }
        return d + (c === 1 ? ' L0 64 Z' : ' L64 64 Z')
    }
</script>

<svg viewBox="0 0 64 64" class="w-full h-full block" aria-hidden="true" style="forced-color-adjust:none" data-part="theme-pack-tile">
    {#if spec === null || geometry === null}
        <rect width="64" height="64" class="fill-bgcolor" data-part="tile-ground" />
        <line x1="10" y1="54" x2="54" y2="10" class="stroke-borderc" stroke-width="3" stroke-linecap="round" data-part="tile-none-mark" />
    {:else}
        {#if paint === null}
            <rect width="64" height="64" class="fill-darkbg" data-part="tile-ground" />
        {:else}
            <rect width="64" height="64" fill={paint.ground} data-part="tile-ground" />
        {/if}
        <g
            data-part="tile-pattern"
            data-family={spec.family}
            fill={paint === null ? undefined : paint.ink}
            stroke={paint === null ? undefined : paint.ink}
            class={paint === null ? 'fill-textcolor2 stroke-textcolor2' : undefined}
            opacity={paint === null ? 0.45 : 1}
        >
            {#if spec.family === 'bands'}
                <g transform={geometry.c === 1 ? 'rotate(-24 32 32)' : 'rotate(24 32 32)'}>
                    {#each geometry.lines as y (y)}
                        <rect x="-20" {y} width="104" height={5 + 2 * geometry.a} stroke="none" />
                    {/each}
                </g>
            {:else if spec.family === 'rings'}
                {#each [8, 16, 24, 32, 40] as radius (radius)}
                    <circle cx={16 + 10 * geometry.a} cy={16 + 10 * geometry.b} r={radius} fill="none" stroke-width="3" />
                {/each}
            {:else if spec.family === 'dots'}
                {#each geometry.points as [x, y] (`${x}:${y}`)}
                    <circle cx={x} cy={y} r={2 + geometry.b * 0.5} stroke="none" />
                {/each}
            {:else if spec.family === 'chevrons'}
                {#each geometry.lines as y (y)}
                    <polyline
                        points={geometry.c === 1 ? `0,${y + 16} 32,${y} 64,${y + 16}` : `0,${y} 32,${y + 16} 64,${y}`}
                        fill="none"
                        stroke-width="3"
                        stroke-linejoin="round"
                    />
                {/each}
            {:else if spec.family === 'bubble'}
                <rect x="8" y={8 + 4 * geometry.a} width="48" height="30" rx="8" fill="none" stroke-width="3" />
                <path d={geometry.c === 1 ? 'M44 38 L52 52 L34 38 Z' : 'M20 38 L12 52 L30 38 Z'} stroke-width="3" stroke-linejoin="round" />
            {:else}
                <path d={stairs(geometry.a, geometry.c)} stroke="none" />
            {/if}
        </g>
        {#if spec.grapheme !== ''}
            {#if paint === null}
                <rect x="18" y="18" width="28" height="28" rx="6" class="fill-bgcolor stroke-borderc" stroke-width="1.5" data-part="tile-plate" />
                <text x="32" y="32" text-anchor="middle" dominant-baseline="central" font-size="17" font-weight="600" class="fill-textcolor" data-part="tile-glyph">{spec.grapheme}</text>
            {:else}
                <rect x="18" y="18" width="28" height="28" rx="6" fill={paint.ground} stroke={paint.ink} stroke-width="1.5" data-part="tile-plate" />
                <text x="32" y="32" text-anchor="middle" dominant-baseline="central" font-size="17" font-weight="600" fill={paint.glyph} data-part="tile-glyph">{spec.grapheme}</text>
            {/if}
        {/if}
    {/if}
</svg>
