<script lang="ts">
    import Counting from './App.keepChatCountingStub.svelte'
    import { declareSurface } from './ts/themePack/surfaceGate.svelte'

    // Stands in for StudioScreen: it declares the studio surface the way a mounted StudioScreen does, and counts its mounts.
    $effect(() => declareSurface('studio'))
</script>

<Counting kind="studio" />