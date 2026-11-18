<script lang="ts">
    import { language } from '../../lang'
    import { openToggleDefinitionInStudio, toggleLinkTarget, type ToggleLinkOwner } from '../../ts/studio/studioToggleLinks'

    interface Props {
        owner: ToggleLinkOwner
    }

    let { owner }: Props = $props()

    // Back returns focus to this button while it is in the page, else to the first link of this kind.
    function openInStudio(event: MouseEvent & { currentTarget: HTMLButtonElement }) {
        openToggleDefinitionInStudio(owner, { element: event.currentTarget, selector: '[data-part="studio-toggle-link"]' })
    }
</script>

{#if toggleLinkTarget(owner) !== null}
    <button
        type="button"
        data-part="studio-toggle-link"
        aria-label={language.studioTgEditInStudioA11y}
        class="mt-1 min-h-11 self-start rounded-md px-3 text-start text-textcolor2 hover:bg-selected hover:text-textcolor cursor-pointer"
        onclick={openInStudio}
    >
        {language.studioTgEditInStudio}
    </button>
{/if}
