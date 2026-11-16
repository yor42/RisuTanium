<script lang="ts">
    import { FileIcon, FileMusicIcon } from '@lucide/svelte'
    import { language } from '../../../lang'
    import { assetSizeText, type AssetShown, type UsedInPort } from '../../../ts/studio/assets/assetPresentation'
    import StudioAssetMedia from './StudioAssetMedia.svelte'

    // One row of a character's asset list. It shows what the list hands it and reports what the person did; every
    // write, URL request and focus move belongs to the list.
    interface Props {
        // Unique among the list's rows and stable while the row's file stays: the list's focus rule and the menu find it by this.
        rowKey: string
        name: string
        ext: string
        shown: AssetShown
        // The stored size: a number, null when the store cannot say, undefined while it is not read yet.
        size: number | null | undefined
        // The thumbnail's URL: undefined while it is being made, '' when it was withheld or could not be made.
        thumbUrl: string | undefined
        // The player's URL after Preview, with the same two meanings.
        mediaUrl: string | undefined
        previewing: boolean
        // Whether the exclude item exists at all (the preview setting), and whether this row is left out.
        excludeShown: boolean
        excluded: boolean
        editable: boolean
        menuOpen: boolean
        // The name this row went by before its last rename in this list, for the used-in note.
        renamedFrom: string | null
        usedIn?: UsedInPort
        // Returns the name the field shows afterwards: the new one when it landed, the row's own otherwise.
        oncommit: (value: string) => string
        ondelete: () => void
        onpreview: () => void
        ontoggleexclude: () => void
        onmenutoggle: () => void
        onmenuclose: () => void
    }

    let { rowKey, name, ext, shown, size, thumbUrl, mediaUrl, previewing, excludeShown, excluded, editable, menuOpen, renamedFrom, usedIn, oncommit, ondelete, onpreview, ontoggleexclude, onmenutoggle, onmenuclose }: Props = $props()

    // A thumbnail the element itself could not decode counts as one whose URL was withheld.
    let failedUrl = $state<string | null>(null)
    const imageState = $derived.by((): 'ok' | 'loading' | 'failed' | 'placeholder' => {
        if (thumbUrl === undefined) return 'loading'
        if (thumbUrl === '') return 'placeholder'
        return failedUrl === thumbUrl ? 'failed' : 'ok'
    })

    const meta = $derived(typeof size === 'number' ? `${ext} · ${assetSizeText(size)}` : ext)
    const playable = $derived(shown === 'audio' || shown === 'video')

    function commit(field: HTMLInputElement): void {
        if (field.value === name) return
        field.value = oncommit(field.value)
    }

    function onNameKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
        // An IME confirms its composition with Enter: that key belongs to the IME.
        if (event.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter') {
            event.preventDefault()
            commit(event.currentTarget)
        } else if (event.key === 'Escape' && event.currentTarget.value !== name) {
            event.preventDefault()
            event.currentTarget.value = name
        }
    }

    function onMenuKeydown(event: KeyboardEvent): void {
        // The menu owns its keys; Esc closes it and hands focus back to the row's trigger.
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onmenuclose()
    }

    const itemClass = 'min-h-11 rounded px-2 text-start hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
</script>

<li data-part="studio-asset-row" data-row-key={rowKey} class="flex min-h-[var(--studio-form-row-height,var(--studio-size-touch))] flex-col gap-1 rounded-md border border-darkborderc p-2">
    <div class="flex items-center gap-2">
        {#if shown === 'thumb' && imageState === 'ok' && thumbUrl}
            <img data-part="studio-thumb" data-image="ok" src={thumbUrl} alt={name} loading="lazy" class="h-16 w-16 shrink-0 rounded-md object-cover" onerror={() => { failedUrl = thumbUrl ?? null }} />
        {:else if shown === 'thumb'}
            <div data-part="studio-thumb-placeholder" data-image={imageState} aria-hidden="true" class="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-md bg-darkbutton text-xs text-textcolor2">
                <FileIcon size={20} />
                <span class="max-w-full truncate px-1">{ext}</span>
            </div>
        {:else}
            <div data-part="studio-asset-tile" aria-hidden="true" class="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-md bg-darkbutton text-xs text-textcolor2">
                {#if shown === 'audio'}<FileMusicIcon size={20} />{:else}<FileIcon size={20} />{/if}
                <span class="max-w-full truncate px-1">{ext}</span>
            </div>
        {/if}
        <div class="flex min-w-0 flex-1 flex-col gap-1">
            <input
                type="text"
                data-part="studio-asset-name"
                class="min-h-11 w-full min-w-0 rounded-md border border-darkborderc bg-darkbg px-2 text-textcolor"
                aria-label={language.name}
                autocomplete="off"
                readonly={!editable}
                value={name}
                onblur={(event) => commit(event.currentTarget)}
                onkeydown={onNameKeydown}
            />
            <span data-part="studio-asset-meta" class="text-sm text-textcolor2">{meta}</span>
            {#if usedIn}
                {@const used = usedIn.usedText(name)}
                {#if used !== null}
                    <button type="button" data-part="studio-asset-used" class="min-h-11 self-start rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={() => usedIn.showUsed(name)}>{used}</button>
                {/if}
                {#if renamedFrom !== null}
                    {@const note = usedIn.renamedNote(renamedFrom)}
                    {#if note}
                        <p data-part="studio-asset-renamed-note" class="text-sm text-textcolor2">
                            {note.text}
                            <button type="button" data-part="studio-asset-renamed-show" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={() => usedIn.showRenamed(renamedFrom)}>{note.action}</button>
                        </p>
                    {/if}
                {/if}
            {/if}
        </div>
        <button
            type="button"
            data-part="studio-asset-row-more"
            class="flex h-11 min-w-11 shrink-0 items-center justify-center rounded-md hover:bg-selected cursor-pointer"
            aria-label={language.studioAssetRowMenu(name)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onclick={onmenutoggle}
        >⋯</button>
    </div>
    {#if previewing && playable}
        {#if mediaUrl}
            <StudioAssetMedia kind={shown === 'video' ? 'video' : 'audio'} url={mediaUrl} />
        {:else if mediaUrl === undefined}
            <p data-part="studio-asset-media-loading" class="text-sm text-textcolor2">{language.loading}</p>
        {/if}
    {/if}
    {#if menuOpen}
        <div role="menu" data-part="studio-row-menu" tabindex="-1" class="flex flex-col rounded-md border border-darkborderc bg-darkbg p-1" onkeydown={onMenuKeydown}>
            <button type="button" role="menuitem" data-part="studio-asset-menu-delete" class={itemClass} disabled={!editable} onclick={ondelete}>{language.studioAssetDelete}</button>
            {#if playable && !previewing}
                <button type="button" role="menuitem" data-part="studio-asset-menu-preview" class={itemClass} onclick={onpreview}>{language.studioAssetPreview}</button>
            {/if}
            {#if excludeShown}
                <button type="button" role="menuitem" data-part="studio-asset-menu-exclude" class={itemClass} onclick={ontoggleexclude}>{excluded ? language.studioAssetShowInPreview : language.studioAssetHideFromPreview}</button>
            {/if}
        </div>
    {/if}
</li>
