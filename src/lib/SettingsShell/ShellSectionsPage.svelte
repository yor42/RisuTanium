<script lang="ts">
    import type { Component } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import { ChevronDownIcon, ChevronRightIcon } from '@lucide/svelte'
    import { getModelInfo } from '../../ts/model/modellist'
    import { sectionOfRow, type ShellSection } from '../../ts/setting/shellSections'
    import type { SettingContext } from '../../ts/setting/types'
    import { settingsLabel } from '../../ts/settingsShell/settingsPages'
    import { DBState, SettingsMenuIndex } from '../../ts/stores.svelte'
    import ShellSettingRow from './ShellSettingRow.svelte'

    interface Props {
        sections: readonly ShellSection[]
        /** The components a shell row can name, by the name the data gives it. */
        components?: Record<string, Component<{ ctx: SettingContext }>>
        /** A touch-only device shows a row's touch note instead of its control. */
        touch?: boolean
    }
    let { sections, components = {}, touch = false }: Props = $props()

    // One context for every row, built like the legacy renderer's.
    const ctx: SettingContext = $derived({
        db: DBState.db,
        modelInfo: getModelInfo(DBState.db.aiModel),
        subModelInfo: getModelInfo(DBState.db.subModel),
    })

    // A collapsed section starts closed on every mount; only a click or a search arrival opens it.
    let opened = $state<Record<string, boolean>>({})
    let root = $state<HTMLElement>()
    const uid = $props.id()

    function gateOpen(section: ShellSection): boolean {
        return section.when === undefined || section.when(DBState.db)
    }

    /**
     * Opens whatever hides the row, waits for the render and returns the row element. Resolves null when the page
     * has no such row (an unknown id, a section whose gate is off, or a row whose condition is false right now).
     */
    export async function reveal(rowId: string): Promise<HTMLElement | null> {
        const section = sectionOfRow(sections, rowId)
        if (section === null || !gateOpen(section)) return null
        if (section.collapsed) opened[section.id] = true
        await afterFlush()
        const rows = root ? [...root.querySelectorAll<HTMLElement>('[data-setting-row]')] : []
        return rows.find((el) => el.dataset.settingRow === rowId) ?? null
    }
</script>

<div class="flex flex-col gap-6" bind:this={root}>
    {#each sections as section (section.id)}
        {#if gateOpen(section)}
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
                                    note={row.touchNoteKey !== undefined && touch ? settingsLabel(row.touchNoteKey) : undefined}
                                    hintKey={row.hintKey}
                                />
                            {:else if row.kind === 'shell'}
                                {@const Shell = components[row.component]}
                                <ShellSettingRow id={row.id} {ctx} condition={row.condition}>
                                    {#if Shell}<Shell {ctx} />{/if}
                                </ShellSettingRow>
                            {:else}
                                {@const jump = row}
                                <div class="flex flex-col" data-setting-row={jump.id}>
                                    <button type="button" class="self-start min-h-11 pr-1 text-left text-textcolor underline hover:text-textcolor2" data-part="setting-row-jump" onclick={() => SettingsMenuIndex.set(jump.index)}>{settingsLabel(jump.labelKey)}</button>
                                    {#if jump.hintKey}
                                        <p class="text-xs text-textcolor2 mb-2" data-part="setting-row-hint">{settingsLabel(jump.hintKey)}</p>
                                    {/if}
                                </div>
                            {/if}
                        {/each}
                    </div>
                {/if}
            </section>
        {/if}
    {/each}
</div>
