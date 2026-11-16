<script lang="ts">
    // The player of one audio or video row, mounted only after Preview. It has its own controls, never starts by
    // itself and never repeats.
    interface Props {
        kind: 'audio' | 'video'
        url: string
    }

    let { kind, url }: Props = $props()
</script>

{#if kind === 'video'}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video data-part="studio-asset-media" data-media="video" controls preload="metadata" src={url} class="w-full max-w-xs rounded-md"></video>
{:else}
    <audio data-part="studio-asset-media" data-media="audio" controls preload="metadata" src={url} class="w-full max-w-xs"></audio>
{/if}
