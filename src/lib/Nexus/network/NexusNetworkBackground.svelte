<script lang="ts">
    import { MediaQuery } from 'svelte/reactivity'
    import { motionPrefs } from 'src/ts/chatShell/motionPrefs.svelte'
    import { createNetworkField } from './nexusNetwork'
    import { networkFrozen } from './networkMotion'

    interface Props {
        /** Coarser lattice, device-pixel ratio 1 and a 24 fps cap for mobile and constrained webviews. */
        lowPower?: boolean
        /** Lattice spacing in CSS pixels. */
        spacing?: number
        /** One still frame and no loop, whatever the preferences say. */
        still?: boolean
        /** No field runs while true; the canvas keeps its last bitmap. */
        paused?: boolean
        /** `inherit` draws in the canvas's computed `color`; `tokens` reads the --nexus-network-* tokens. */
        tint?: 'tokens' | 'inherit'
        /** Decides whether a press may raise a wave; see the renderer's `canWave`. */
        canWave?: (event: PointerEvent) => boolean
    }

    let { lowPower = false, spacing = 46, still = false, paused = false, tint = 'tokens', canWave }: Props = $props()

    let canvas = $state<HTMLCanvasElement>()
    const osReduced = new MediaQuery('(prefers-reduced-motion: reduce)')

    // The app's own Low power and Reduce motion choices count, not only the OS query.
    const frozen = $derived(networkFrozen({
        still,
        lowPower: motionPrefs.lowPower,
        reducedMotion: motionPrefs.reducedMotion,
        systemReduced: osReduced.current,
    }))
    const coarse = $derived(lowPower || motionPrefs.lowPower)

    // The wave phase carried from one field to the next, so a switch does not jump the lattice.
    let phase = 0

    // Recreated when an input changes; at most one field exists, and a paused lattice has none.
    $effect(() => {
        if (!canvas || paused) return
        const target = canvas
        const colour = tint === 'inherit' ? getComputedStyle(target).color : ''
        const field = createNetworkField(target, {
            lowPower: coarse,
            spacing,
            still: frozen,
            startTime: phase,
            colour: colour === '' ? undefined : colour,
            canWave,
        })
        return () => {
            phase = field.time()
            field.destroy()
        }
    })
</script>

<!--
    The canvas fills its positioned parent and ignores pointer events; waves listen on window. The parent
    decides the stacking: Home places it before the content, so the content paints above it.
-->
<canvas bind:this={canvas} aria-hidden="true" class="pointer-events-none absolute inset-0 h-full w-full"></canvas>
