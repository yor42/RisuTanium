<script lang="ts">
    import type { Component } from 'svelte'
    import { inputOf } from '../../ts/gui/rootAttributes'
    import { INPUT_SHELL_SECTIONS } from '../../ts/setting/inputShellSettingsData'
    import type { SettingContext } from '../../ts/setting/types'
    import NewMessageButtonRow from './input/NewMessageButtonRow.svelte'
    import ShellSectionsPage from './ShellSectionsPage.svelte'

    const components: Record<string, Component<{ ctx: SettingContext }>> = { NewMessageButtonRow }

    // Read once per mount: the hover-only partial-edit row is a note on a device without a mouse.
    const touch = inputOf(window) === 'touch'

    let sectionsPage = $state<ReturnType<typeof ShellSectionsPage>>()

    /** Opens whatever hides the row and returns its element; null when the page has no such row. */
    export async function reveal(rowId: string): Promise<HTMLElement | null> {
        return sectionsPage ? sectionsPage.reveal(rowId) : null
    }
</script>

<div data-part="input-page">
    <ShellSectionsPage bind:this={sectionsPage} sections={INPUT_SHELL_SECTIONS} {components} {touch} />
</div>
