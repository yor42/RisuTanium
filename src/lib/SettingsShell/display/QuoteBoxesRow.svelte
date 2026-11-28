<script lang="ts">
    import { language } from '../../../lang'
    import { quoteBoxItems } from '../../../ts/setting/displayShellSettingsData'
    import type { SettingContext } from '../../../ts/setting/types'
    import { CURLY_QUOTES } from '../../../ts/settingsShell/displayPresentation'
    import ShellSettingRow from '../ShellSettingRow.svelte'

    interface Props {
        ctx: SettingContext
    }
    let { ctx }: Props = $props()

    // A missing stored set reads as the curly default, the same fallback the boxes show.
    const quotes = $derived(ctx.db.customQuotesData ?? CURLY_QUOTES)
</script>

<div class="flex flex-col" data-part="settings-quote-boxes">
    {#each quoteBoxItems as item (item.id)}
        <ShellSettingRow id={item.id} {ctx} {item} />
    {/each}
    <p class="mt-2 text-sm text-(--settings-text-2)" data-part="settings-quote-preview">
        <span class="mr-2">{language.settingsShellQuotePreviewTitle}</span>
        <span class="text-(--settings-text)">{language.settingsShellQuotePreview(quotes[0], quotes[1], quotes[2], quotes[3])}</span>
    </p>
</div>
