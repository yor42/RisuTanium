<script module lang="ts">
    export const stubCounts: Record<string, { mounts: number, destroys: number }> = {}

    export function resetStubCounts() {
        for (const key of Object.keys(stubCounts)) {
            delete stubCounts[key]
        }
    }

    export function stubCount(kind: string) {
        return stubCounts[kind] ?? { mounts: 0, destroys: 0 }
    }
</script>

<script lang="ts">
    import { onMount } from 'svelte'

    let { kind }: { kind: string } = $props()

    onMount(() => {
        const counts = (stubCounts[kind] ??= { mounts: 0, destroys: 0 })
        counts.mounts += 1
        return () => {
            counts.destroys += 1
        }
    })
</script>

<div data-stub={kind}></div>
