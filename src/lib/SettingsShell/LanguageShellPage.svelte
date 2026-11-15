<script lang="ts">
    import type { Component } from 'svelte'
    import { LANGUAGE_SHELL_SECTIONS } from '../../ts/setting/languageShellSettingsData'
    import type { SettingContext } from '../../ts/setting/types'
    import LanguagePendingRow from './language/LanguagePendingRow.svelte'
    import ShellSectionsPage from './ShellSectionsPage.svelte'

    const components: Record<string, Component<{ ctx: SettingContext }>> = { LanguagePendingRow }

    let sectionsPage = $state<ReturnType<typeof ShellSectionsPage>>()

    /** Opens whatever hides the row and returns its element; null when the page has no such row. */
    export async function reveal(rowId: string): Promise<HTMLElement | null> {
        return sectionsPage ? sectionsPage.reveal(rowId) : null
    }
</script>

<div data-part="language-page">
    <ShellSectionsPage bind:this={sectionsPage} sections={LANGUAGE_SHELL_SECTIONS} {components} />
</div>
