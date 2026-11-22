<script lang="ts">
    import { User } from '@lucide/svelte'
    import BarIcon from '../SideBars/BarIcon.svelte'
    import { useCharImageLookups } from '../../ts/media/charImageLookups'
    import { nearViewport } from '../../ts/gui/nearViewport.svelte'

    /**
     * One avatar tile of the selectChar grid. The tile owns its image hold: it asks for the thumbnail
     * only while it is near the dialog's view, gives the hold back when it leaves that band, and gives
     * it back when the windowed grid unmounts it, so a scrolled library holds only the tiles near the view.
     */
    interface Props {
        name: string
        image: string
        onPick: () => void
    }

    let { name, image, onPick }: Props = $props()

    const lookups = useCharImageLookups()
    let nearView = $state(false)
</script>

<div data-part="pattern-alert-char" use:nearViewport={{ onChange: (visible) => { nearView = visible } }}>
    {#if image}
        <BarIcon label={name} onClick={onPick} additionalStyle={lookups.getIf('char', nearView, image, 'thumbcss', '')} />
    {:else}
        <BarIcon label={name} onClick={onPick}>
            <User/>
        </BarIcon>
    {/if}
    <!-- The avatar button already carries the name; the caption is the same name for sighted users. -->
    <span data-part="pattern-alert-char-name" aria-hidden="true">{name}</span>
</div>
