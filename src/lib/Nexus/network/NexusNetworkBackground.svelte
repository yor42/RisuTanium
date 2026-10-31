<script lang="ts">
    import { MediaQuery } from 'svelte/reactivity'
    import { createNetworkField } from './nexusNetwork'

    interface Props {
        /** Coarser lattice, device-pixel ratio 1 and a 24 fps cap for mobile and constrained webviews. */
        lowPower?: boolean
        /** Lattice spacing in CSS pixels. */
        spacing?: number
    }

    let { lowPower = false, spacing = 46 }: Props = $props()

    let canvas = $state<HTMLCanvasElement>()
    const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)')

    // Recreated when an option changes; these change rarely, and recreation keeps the renderer stateless.
    $effect(() => {
        if (!canvas) return
        const field = createNetworkField(canvas, {
            lowPower,
            spacing,
            reducedMotion: reducedMotion.current,
        })
        return () => field.destroy()
    })
</script>

<!--
    Stacking: the canvas sits at z-0 as the first child of the app root, and the interactive
    shell is a sibling `relative z-10` container. A negative z-index would put it behind <body>'s and every
    opaque view's background. Ancestors between the root and the canvas must stay transparent, and the
    root (or <body>) carries .nexus-canvas. The canvas ignores pointer events; waves listen on window.
-->
<canvas bind:this={canvas} aria-hidden="true" class="pointer-events-none fixed inset-0 z-0 h-full w-full"></canvas>
