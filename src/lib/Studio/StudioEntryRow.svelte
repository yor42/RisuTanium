<script lang="ts">
    import { LayoutPanelLeftIcon } from '@lucide/svelte'
    import { language } from '../../lang'
    import { openStudio, selectedStudioCharacterId } from '../../ts/studio/studioScreen.svelte'
    import { studioEligible } from '../../ts/studio/studioSwitch.svelte'

    // Opens the selected character in Studio. Back returns focus to this row while it is in the page,
    // else to the first row of this kind.
    function openSelectedCharacter(event: MouseEvent & { currentTarget: HTMLButtonElement }) {
        const chaId = selectedStudioCharacterId()
        if (chaId === null) return
        const opener = { element: event.currentTarget, selector: '[data-part="studio-entry"]' }
        openStudio({ owner: { type: 'character', id: chaId }, from: 'chat' }, opener)
    }
</script>

{#if studioEligible()}
    <button
        type="button"
        data-part="studio-entry"
        class="mb-2 flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-textcolor hover:bg-selected cursor-pointer"
        onclick={openSelectedCharacter}
    >
        <LayoutPanelLeftIcon size={18} />
        <span>{language.studioOpenIn}</span>
    </button>
{/if}
