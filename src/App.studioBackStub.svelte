<script module lang="ts">
    export const backStubCounts = { mounts: 0, destroys: 0 }

    export function resetBackStubCounts() {
        backStubCounts.mounts = 0
        backStubCounts.destroys = 0
    }
</script>

<script lang="ts">
    import { onMount } from 'svelte'
    import { installStudioBack } from './ts/studio/studioBack.svelte'

    // Registers the real Studio Back layers from this component's lifetime, as the Studio root does.
    installStudioBack()

    onMount(() => {
        backStubCounts.mounts += 1
        return () => {
            backStubCounts.destroys += 1
        }
    })
</script>

<div data-stub="studio-back"></div>
