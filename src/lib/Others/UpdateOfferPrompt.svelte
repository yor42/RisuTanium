<script lang="ts">
    import { language } from 'src/lang'
    import { fillLang } from 'src/lang/fill'
    import type { UpdateOffer } from 'src/ts/alert'
    import { formatDownloadSize } from 'src/ts/android/appUpdateRelease'

    /**
     * The dialog of an available desktop update. The installed version, the offered version and the release notes come from
     * a remote file and render as text only, never as markup. Install answers `install`; Not now answers `later`. The id of
     * the version list is the dialog's description, and the notes region is named by its own label, whose id derives from it.
     */
    interface Props {
        offer: UpdateOffer
        messageId: string
        onanswer: (message: 'install' | 'later') => void
    }

    let { offer, messageId, onanswer }: Props = $props()

    const notesLabelId = $derived(`${messageId}-notes`)
    // A leading blank line (an empty first line of the notes) would show as a gap at the top of the well.
    const notes = $derived(offer.notes.trim())
</script>

<div class="flex flex-col gap-3 text-left" data-update-offer>
    <dl id={messageId} class="flex flex-wrap gap-x-8 gap-y-2 m-0">
        <div class="flex flex-col">
            <dt class="text-sm text-textcolor2">{language.updateInstalledVersion}</dt>
            <dd class="m-0 text-base text-textcolor2 tabular-nums break-all" data-update-current>{offer.currentVersion}</dd>
        </div>
        <div class="flex flex-col">
            <dt class="text-sm text-textcolor2">{language.updateNewVersion}</dt>
            <dd class="m-0 text-2xl font-semibold text-textcolor tabular-nums break-all" data-update-new>{offer.version}</dd>
        </div>
    </dl>
    <div class="flex flex-col gap-1">
        <div id={notesLabelId} class="text-sm text-textcolor2">{language.updateReleaseNotes}</div>
        {#if notes === ''}
            <div class="text-sm text-textcolor2" data-update-notes-empty>{language.updateNoReleaseNotes}</div>
        {:else}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <div class="whitespace-pre-wrap break-words max-h-[40vh] overflow-y-auto border border-darkborderc rounded-md bg-darkbg text-textcolor text-sm leading-relaxed p-2 risu-focus-ring" role="region" tabindex="0" aria-labelledby={notesLabelId} data-update-notes>{notes}</div>
        {/if}
    </div>
    {#if offer.download}
        <div class="flex flex-col gap-1">
            <div class="text-sm text-textcolor" data-update-size>{fillLang(language.updateDownloadSize, { size: formatDownloadSize(offer.download.sizeBytes) })}</div>
            {#if offer.download.metered}
                <div class="text-sm text-textcolor2" data-update-metered>{language.updateMeteredNotice}</div>
            {/if}
        </div>
    {/if}
    <div data-part="pattern-warn-actions" data-count="2">
        <button type="button" class="pattern-button" onclick={() => onanswer('later')}>{language.updateNotNow}</button>
        <button type="button" class="pattern-button" data-variant="confirm" onclick={() => onanswer('install')}>{offer.download ? language.updateDownloadAndInstall : language.updateInstall}</button>
    </div>
</div>
