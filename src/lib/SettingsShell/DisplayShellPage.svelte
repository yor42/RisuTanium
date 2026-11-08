<script lang="ts">
    import { tick, type Component } from 'svelte'
    import { ChevronDownIcon, ChevronRightIcon } from '@lucide/svelte'
    import { getModelInfo } from '../../ts/model/modellist'
    import {
        DISPLAY_SHELL_SECTIONS,
        displaySectionOfRow,
        type DisplaySectionId,
        type ShellRowComponent,
    } from '../../ts/setting/displayShellSettingsData'
    import type { SettingContext } from '../../ts/setting/types'
    import { settingsLabel } from '../../ts/settingsShell/settingsPages'
    import { DBState } from '../../ts/stores.svelte'
    import AssetWidthRow from './display/AssetWidthRow.svelte'
    import QuoteBoxesRow from './display/QuoteBoxesRow.svelte'
    import ThemeCards from './display/ThemeCards.svelte'
    import ShellSettingRow from './ShellSettingRow.svelte'

    interface Props {
        /** On a phone the close-button size row is a note, because the button only exists on larger screens. */
        phone: boolean
    }
    let { phone }: Props = $props()

    const shellComponents: Record<ShellRowComponent, Component<{ ctx: SettingContext }>> = {
        ThemeCards,
        AssetWidthRow,
        QuoteBoxesRow,
    }

    // One context for every row, built like the legacy renderer's.
    const ctx: SettingContext = $derived({
        db: DBState.db,
        modelInfo: getModelInfo(DBState.db.aiModel),
        subModelInfo: getModelInfo(DBState.db.subModel),
    })

    // A collapsed section starts closed on every mount; only a click or a search arrival opens it.
    let opened = $state<Partial<Record<DisplaySectionId, boolean>>>({})
    let root = $state<HTMLElement>()
    const uid = $props.id()

    /**
     * Opens whatever hides the row, waits for the render and returns the row element. Resolves null when the page
     * has no such row (an unknown id, or a row whose condition is false right now).
     */
    export async function reveal(rowId: string): Promise<HTMLElement | null> {
        const sectionId = displaySectionOfRow(rowId)
        if (sectionId === null) return null
        if (DISPLAY_SHELL_SECTIONS.some((section) => section.id === sectionId && section.collapsed)) opened[sectionId] = true
        await tick()
        const rows = root ? [...root.querySelectorAll<HTMLElement>('[data-setting-row]')] : []
        return rows.find((el) => el.dataset.settingRow === rowId) ?? null
    }
</script>

<div class="flex flex-col gap-6" bind:this={root} data-part="display-page">
    {#each DISPLAY_SHELL_SECTIONS as section (section.id)}
        {@const open = !section.collapsed || opened[section.id] === true}
        <section data-part="settings-section" data-section={section.id} aria-labelledby="{uid}-{section.id}">
            <h3 id="{uid}-{section.id}" class="text-lg font-semibold text-textcolor outline-none rounded-sm focus-visible:ring-2 focus-visible:ring-textcolor2" tabindex="-1" data-part="settings-section-heading">
                {#if section.collapsed}
                    <button
                        type="button"
                        class="flex min-h-11 w-full items-center gap-2 text-left"
                        aria-expanded={open}
                        aria-controls="{uid}-{section.id}-body"
                        onclick={() => { opened[section.id] = !open }}
                    >
                        {#if open}<ChevronDownIcon size={18} aria-hidden="true" />{:else}<ChevronRightIcon size={18} aria-hidden="true" />{/if}
                        <span>{settingsLabel(section.labelKey)}</span>
                    </button>
                {:else}
                    {settingsLabel(section.labelKey)}
                {/if}
            </h3>
            {#if open}
                <div id="{uid}-{section.id}-body" class="flex flex-col">
                    {#each section.rows as row (row.kind === 'setting' ? row.item.id : row.id)}
                        {#if row.kind === 'setting'}
                            <ShellSettingRow
                                id={row.item.id}
                                {ctx}
                                item={row.item}
                                dim={row.dim}
                                note={row.phoneNoteKey !== undefined && phone ? settingsLabel(row.phoneNoteKey) : undefined}
                                ends={row.ends}
                                hintKey={row.hintKey}
                            />
                        {:else}
                            {@const Shell = shellComponents[row.component]}
                            <ShellSettingRow id={row.id} {ctx} condition={row.condition}>
                                <Shell {ctx} />
                            </ShellSettingRow>
                        {/if}
                    {/each}
                </div>
            {/if}
        </section>
    {/each}
</div>
