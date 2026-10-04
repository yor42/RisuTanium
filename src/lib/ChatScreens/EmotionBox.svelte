<script>
    import { warnOnReject } from "src/ts/warnOnReject";
    
    import { DBState } from 'src/ts/stores.svelte';
    import { CharEmotion } from '../../ts/stores.svelte';
    import { getEmotion } from '../../ts/util';
</script>

{#await warnOnReject('EmotionBox: emotion images rejected', getEmotion(DBState.db,$CharEmotion, 'contain')) then images}
    {#each images as image, i}
    <div style={image + `width:${(100 / images.length)}%;bottom:0;left:${100 / images.length * i}%`} class="h-full bg-center absolute"></div>

    {/each}
{:catch}
  <!-- no preview: nothing is rendered for a rejected promise -->
{/await}

<style>
    .h-full {
        height: 100%;
    }
    .bg-center {
        background-position: center;
    }
</style>