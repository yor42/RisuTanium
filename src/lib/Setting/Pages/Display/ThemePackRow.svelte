<script lang="ts">
    import { tick } from 'svelte'
    import { CheckIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import { DBState } from 'src/ts/stores.svelte'
    import { themePackApplyState } from 'src/ts/themePack/activePack.svelte'
    import { BUILTIN_PACKS, builtinPackById } from 'src/ts/themePack/builtins'
    import { listThemePacks, type PackMode } from 'src/ts/themePack/packRecord'
    import { tileSpec } from 'src/ts/themePack/tileDesign'
    import {
        attachRow, formatPackSize, installFlowState, refusalText, removeThemePack, runThemePackInstall, selectThemePack,
    } from './themePackInstallFlow.svelte'
    import ThemePackTile from './ThemePackTile.svelte'
    import BuiltinPackThumb, { hasBuiltinThumb } from './BuiltinPackThumb.svelte'

    const uid = $props.id()
    const groupName = `theme-pack-${uid}`
    const BUTTON_CLASS = 'px-3 py-1 text-sm rounded-md border border-darkborderc bg-darkbutton text-textcolor hover:bg-selected transition-colors disabled:opacity-50'
    // The frame, badge and name are siblings of the radio inside one label, so the peer variants follow its state. The
    // focus ring is a box shadow, which forced colours remove, so an outline stands in for it there.
    const FRAME_CLASS = 'block aspect-square w-full overflow-hidden rounded-md border border-darkborderc transition-colors duration-150 motion-reduce:transition-none group-hover:border-borderc peer-checked:outline-2 peer-checked:outline-textcolor peer-checked:outline-offset-2 peer-focus-visible:ring-2 peer-focus-visible:ring-borderc peer-focus-visible:ring-offset-4 peer-focus-visible:ring-offset-bgcolor peer-focus-visible:forced-colors:outline-2 peer-focus-visible:forced-colors:outline-offset-4'
    const BADGE_CLASS = 'absolute top-1 right-1 hidden peer-checked:flex items-center justify-center w-4 h-4 rounded-full bg-textcolor text-bgcolor pointer-events-none'
    const NAME_CLASS = 'text-sm text-textcolor line-clamp-2 break-words peer-checked:font-semibold'
    const CARD_CLASS = 'group relative flex flex-col gap-1 min-w-0 cursor-pointer'
    const DETAILS_CLASS = 'min-w-0 break-words [overflow-wrap:anywhere] text-sm text-textcolor2 mt-1'

    let root: HTMLElement | null = null
    let installButton: HTMLButtonElement | null = null

    // Counts this row as mounted, so an outcome that arrives after it closed is alerted instead of lost.
    $effect(() => attachRow())

    const entries = $derived(listThemePacks(DBState.db.themePacks))
    const readable = $derived(entries.flatMap((item) => item.read.ok ? [{ entry: item.entry, record: item.read.record }] : []))
    const unreadable = $derived(entries.filter((item) => !item.read.ok))
    // None is checked only when no pack is chosen; the stored id decides, whatever the apply status says (Safe Mode reads "none").
    const activeId = $derived(typeof DBState.db.activeThemePack === 'string' ? DBState.db.activeThemePack : '')

    const broken = $derived.by(() => {
        const status = themePackApplyState()
        if (status.phase !== 'broken' || status.activeId === undefined || status.activeId !== DBState.db.activeThemePack) {
            return null
        }
        const id = status.activeId
        const builtin = builtinPackById(id)
        const found = entries.find((item) => typeof item.entry === 'object' && item.entry !== null && (item.entry as { id?: unknown }).id === id)
        const name = builtin !== null
            ? builtin.name
            : found !== undefined && found.read.ok ? found.read.record.name : language.themePackUnreadableName
        const reason = status.reason ?? 'couldNotCheck'
        const reasonText = reason === 'files'
            ? language.themePackBrokenFiles
            : reason === 'refused'
                ? language.themePackBrokenRefused
                : reason === 'unreadable'
                    ? language.themePackBrokenUnreadable
                    : language.themePackBrokenCouldNotCheck
        return {
            name,
            reasonText,
            refusalLines: reason === 'refused' ? (status.refusals ?? []).map(refusalText) : [],
            removable: builtin === null && found !== undefined ? found.entry : null,
        }
    })

    const help = $derived(language.themePackRowHelp(
        language.chatShellPreviewLabel, language.accessibility, language.settingsShellPageInput, language.settingsShellInputPreview,
    ))

    function modesLabel(modes: readonly PackMode[]): string {
        const light = modes.includes('light')
        const dark = modes.includes('dark')
        if (light && dark) {
            return language.themePackModesBoth
        }
        if (light) {
            return language.themePackModesLight
        }
        return dark ? language.themePackModesDark : ''
    }

    // The dialogs close without restoring focus, so the row puts it back: only when it is on nowhere, on the page body or
    // inside the row. A person who moved focus elsewhere meanwhile keeps it.
    async function refocus(target: () => HTMLElement | null): Promise<void> {
        await tick()
        const element = target()
        if (element === null || !element.isConnected || (element as HTMLButtonElement).disabled) {
            return
        }
        const active = document.activeElement
        if (active === null || active === document.body || (root !== null && root.contains(active))) {
            element.focus()
        }
    }

    async function install(): Promise<void> {
        await runThemePackInstall()
        await refocus(() => installButton)
    }

    async function remove(entry: unknown, name: string, button: HTMLButtonElement): Promise<void> {
        const result = await removeThemePack(entry, name)
        if (result === 'busy') {
            return
        }
        // Decided after the render, so a button the changed list removed is seen as gone.
        await refocus(() => result === 'declined' || (result === 'changed' && button.isConnected) ? button : installButton)
    }

    // A refused select leaves the stored id unchanged, so the radios are put back to it.
    async function select(id: string | undefined): Promise<void> {
        if (selectThemePack(id) === 'busy') {
            await tick()
            for (const radio of root?.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${groupName}"]`) ?? []) {
                radio.checked = radio.value === activeId
            }
        }
    }
</script>

<div class="flex flex-col" bind:this={root} data-part="theme-pack-row">
    <span class="text-textcolor mt-4">{language.themePackRowTitle}</span>
    <p class="text-sm text-textcolor2 mt-1" data-part="theme-pack-help">{help}</p>

    <fieldset class="grid grid-cols-[repeat(auto-fill,minmax(7.25rem,1fr))] gap-3 mt-2 border-0 p-0 m-0 min-w-0">
        <legend class="text-sm text-textcolor2 mb-1">{language.themePackActiveLegend}</legend>
        <div class="min-w-0" data-part="theme-pack-none">
            <label class={CARD_CLASS}>
                <input class="sr-only peer" type="radio" name={groupName} value="" checked={activeId === ''} aria-label={language.themePackNone} onchange={() => select(undefined)} />
                <span class={FRAME_CLASS}><ThemePackTile spec={null} /></span>
                <span class={BADGE_CLASS}><CheckIcon size={12} /></span>
                <span id="{groupName}-none" class={NAME_CLASS}>{language.themePackNone}</span>
            </label>
        </div>
        {#each BUILTIN_PACKS as pack, index (pack.id)}
            <div class="min-w-0" data-part="theme-pack-entry" data-pack-id={pack.id}>
                <label class={CARD_CLASS}>
                    <input class="sr-only peer" type="radio" name={groupName} value={pack.id} checked={activeId === pack.id} aria-label={pack.name} onchange={() => select(pack.id)} />
                    <span class={FRAME_CLASS}>
                        {#if hasBuiltinThumb(pack.slug)}
                            <BuiltinPackThumb slug={pack.slug} />
                        {:else}
                            <ThemePackTile spec={tileSpec({ seedKey: pack.id, name: pack.name, main: pack.mainColor, secondary: pack.secondaryColor })} />
                        {/if}
                    </span>
                    <span class={BADGE_CLASS}><CheckIcon size={12} /></span>
                    <span id="{groupName}-b{index}" class={NAME_CLASS}>{pack.name}</span>
                    <span class="text-xs text-textcolor2">{language.themePackBuiltIn}</span>
                </label>
                <details class={DETAILS_CLASS} data-part="theme-pack-details">
                    <summary class="cursor-pointer" aria-label={language.themePackDetailsFor(pack.name)}>{language.themePackDetails}</summary>
                    <div class="flex flex-col">
                        <span>{language.themePackVersion(pack.version)}</span>
                        {#if modesLabel(pack.modes)}<span>{modesLabel(pack.modes)}</span>{/if}
                        <span>{language.themePackLicense(pack.license)}</span>
                        <span>{language.themePackAttribution(pack.attribution)}</span>
                    </div>
                </details>
            </div>
        {/each}
        {#each readable as item, index (item.record.id)}
            <div class="min-w-0" data-part="theme-pack-entry" data-pack-id={item.record.id}>
                <label class={CARD_CLASS}>
                    <input class="sr-only peer" type="radio" name={groupName} value={item.record.id} checked={activeId === item.record.id} aria-label={item.record.name} onchange={() => select(item.record.id)} />
                    <span class={FRAME_CLASS}><ThemePackTile spec={tileSpec({ seedKey: item.record.packId ?? item.record.name, name: item.record.name, main: item.record.mainColor, secondary: item.record.secondaryColor })} icon={item.record.icon} name={item.record.name} /></span>
                    <span class={BADGE_CLASS}><CheckIcon size={12} /></span>
                    <span id="{groupName}-p{index}" class={NAME_CLASS}>{item.record.name}</span>
                    {#if modesLabel(item.record.modes)}<span class="text-xs text-textcolor2">{modesLabel(item.record.modes)}</span>{/if}
                </label>
                <details class={DETAILS_CLASS} data-part="theme-pack-details">
                    <summary class="cursor-pointer" aria-label={language.themePackDetailsFor(item.record.name)}>{language.themePackDetails}</summary>
                    <div class="flex flex-col">
                        <span>{language.themePackVersion(item.record.version)}</span>
                        {#if modesLabel(item.record.modes)}<span>{modesLabel(item.record.modes)}</span>{/if}
                        <span>{language.themePackSize(formatPackSize(item.record.bytes))}</span>
                        <span>{language.themePackLicense(item.record.license)}</span>
                        {#if item.record.attribution}<span>{language.themePackAttribution(item.record.attribution)}</span>{/if}
                        {#if item.record.fonts.length > 0}
                            <span class="mt-1">{language.themePackFonts}</span>
                            <ul class="ml-4 list-disc">
                                {#each item.record.fonts as font (font.file)}
                                    <li>
                                        {language.themePackFontLicense(font.file, font.license)}
                                        {#if font.attribution}<span class="block">{language.themePackAttribution(font.attribution)}</span>{/if}
                                    </li>
                                {/each}
                            </ul>
                        {/if}
                        <button
                            type="button"
                            class="{BUTTON_CLASS} self-start mt-2"
                            data-part="theme-pack-remove"
                            onclick={(event) => remove(item.entry, item.record.name, event.currentTarget)}
                        >{language.themePackRemove}</button>
                    </div>
                </details>
            </div>
        {/each}
        {#each unreadable as item (item.index)}
            <div class="min-w-0 flex flex-col gap-1" data-part="theme-pack-unreadable">
                <!-- The seed is the entry's index, so this tile's pattern can change after an earlier entry is removed. -->
                <span class={FRAME_CLASS}><ThemePackTile spec={tileSpec({ seedKey: `unreadable:${item.index}`, name: language.themePackUnreadableName })} /></span>
                <span class="text-sm text-textcolor line-clamp-2 break-words">{language.themePackUnreadableName}</span>
                <span class="text-xs text-textcolor2 break-words">{language.themePackUnreadableDetail}</span>
                <button
                    type="button"
                    class="{BUTTON_CLASS} self-start"
                    data-part="theme-pack-remove"
                    onclick={(event) => remove(item.entry, language.themePackUnreadableName, event.currentTarget)}
                >{language.themePackRemove}</button>
            </div>
        {/each}
    </fieldset>

    {#if broken !== null}
        <div class="flex flex-col gap-1 mt-2" data-part="theme-pack-broken">
            <p class="text-sm text-draculared">{language.themePackBroken(broken.name, broken.reasonText)}</p>
            {#each broken.refusalLines as line}
                <p class="text-sm text-draculared whitespace-pre-line">{line}</p>
            {/each}
            {#if broken.removable !== null}
                {@const removable = broken.removable}
                <button
                    type="button"
                    class="{BUTTON_CLASS} self-start"
                    data-part="theme-pack-remove"
                    onclick={(event) => remove(removable, broken.name, event.currentTarget)}
                >{language.themePackRemove}</button>
            {/if}
        </div>
    {/if}

    <div class="flex flex-col gap-1 mt-2">
        <button
            type="button"
            bind:this={installButton}
            class="{BUTTON_CLASS} self-start"
            data-part="theme-pack-install"
            disabled={installFlowState.pending}
            onclick={install}
        >{language.themePackInstall}</button>
        {#if installFlowState.pending}
            <p class="text-sm text-textcolor2" role="status" aria-live="polite" data-part="theme-pack-checking">{language.themePackChecking}</p>
        {/if}
        <div role="status" data-part="theme-pack-outcome">
            {#if installFlowState.outcome !== null}
                {@const outcome = installFlowState.outcome}
                {#each outcome.lines as line}
                    <p class="text-sm whitespace-pre-line {outcome.tone === 'error' ? 'text-draculared' : 'text-textcolor2'}">{line}</p>
                {/each}
            {/if}
        </div>
    </div>
</div>
