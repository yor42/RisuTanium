<script module lang="ts">
    import { language } from '../../lang'
    import type { ModuleBadge } from '../../ts/studio/studioModules'
    import type { OwnerTag, StudioItem, StudioKind } from '../../ts/studio/ownerModel'
    import type { ScriptMode } from '../../ts/studio/scriptMode'
    import type { StudioNotice } from '../../ts/studio/resolveTarget'

    export type RowKind = 'group' | 'owner' | 'kind' | 'item' | 'more'

    // The words Studio uses for its parts. They live here because the tree, the detail and the screen's
    // notice line all need them and a row is the smallest piece that does.
    export function kindLabelOf(kind: StudioKind): string {
        switch (kind) {
            case 'basic': return language.studioKindBasic
            case 'display': return language.studioKindDisplay
            case 'lore': return language.studioKindLore
            case 'regex': return language.studioKindRegex
            case 'scripts': return language.studioKindScripts
            case 'toggles': return language.studioKindToggles
            case 'html': return language.studioKindHtml
            case 'advanced': return language.studioKindAdvanced
            case 'plugin': return language.studioKindPlugin
        }
    }

    export function scriptModeLabelOf(mode: ScriptMode): string {
        switch (mode) {
            case 'lua': return language.studioScriptLua
            case 'v2': return language.studioScriptV2
            case 'v1': return language.studioScriptV1
            case 'empty': return language.studioEmptyKind
        }
    }

    // The name an item is listed under: its own name, else what it is.
    export function itemLabelOf(item: StudioItem): string {
        if (item.name !== '') return item.name
        if (item.mode !== undefined) return scriptModeLabelOf(item.mode)
        return `${kindLabelOf(item.kind)} ${item.index + 1}`
    }

    export function tagLabelOf(tag: OwnerTag, retiredVersion?: string): string {
        switch (tag) {
            case 'notLoaded': return language.studioNotLoaded
            case 'notApplied': return language.studioNotApplied
            case 'off': return language.studioOff
            case 'retired': return language.studioPluginRetired(retiredVersion ?? '')
            case 'private': return language.sidebarUi.notAllowed
        }
    }

    export function badgeLabelOf(badge: ModuleBadge): string {
        switch (badge) {
            case 'allChats': return language.studioBadgeAllChats
            case 'thisChat': return language.studioBadgeThisChat
            case 'character': return language.studioBadgeCharacter
            case 'persona': return language.studioBadgePersona
            case 'integration': return language.studioBadgeIntegration
            case 'namespace': return language.studioBadgeNamespace
        }
    }

    export function noticeTextOf(notice: StudioNotice): string {
        switch (notice.key) {
            case 'studioNotFound': return language.studioNotFound
            case 'studioDeepKindFallback': return language.studioDeepKindFallback(notice.ownerName)
            case 'studioDeepItemMissing': return language.studioDeepItemMissing(notice.kind === null ? notice.ownerName : kindLabelOf(notice.kind))
        }
    }
</script>

<script lang="ts">
    import { ChevronDownIcon, ChevronRightIcon } from '@lucide/svelte'

    interface Props {
        id: string
        rowKind: RowKind
        level: number
        setSize: number
        posInSet: number
        expandable: boolean
        expanded: boolean
        selected: boolean
        // Only the focused row is a tab stop (roving tabindex).
        tabbable: boolean
        label: string
        // Secondary text, such as a count.
        detail?: string
        tags?: string[]
        onactivate: () => void
        onfocus: () => void
    }

    let { id, rowKind, level, setSize, posInSet, expandable, expanded, selected, tabbable, label, detail, tags = [], onactivate, onfocus }: Props = $props()
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- Keys are handled once for all rows by the tree element that holds them. -->
<div
    role="treeitem"
    tabindex={tabbable ? 0 : -1}
    aria-level={level}
    aria-setsize={setSize}
    aria-posinset={posInSet}
    aria-expanded={expandable ? expanded : undefined}
    aria-selected={rowKind === 'more' ? undefined : selected}
    data-part="studio-row"
    data-row-id={id}
    data-row-kind={rowKind}
    class="studio-row flex w-full cursor-pointer items-center gap-1 pe-2 text-start outline-none hover:bg-selected focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-textcolor2"
    class:bg-selected={selected}
    class:text-textcolor2={rowKind === 'more'}
    style:padding-inline-start="calc(0.5rem + {level - 1} * 1rem)"
    onclick={onactivate}
    {onfocus}
>
    <span class="flex w-4 shrink-0 justify-center text-textcolor2" aria-hidden="true">
        {#if expandable}
            {#if expanded}<ChevronDownIcon size={14} />{:else}<ChevronRightIcon size={14} />{/if}
        {/if}
    </span>
    <span class="min-w-0 flex-1 truncate">{label}</span>
    {#if detail}
        <span class="shrink-0 text-xs text-textcolor2">{detail}</span>
    {/if}
    {#each tags as tag}
        <span class="shrink-0 rounded border border-darkborderc px-1 text-xs text-textcolor2">{tag}</span>
    {/each}
</div>

<style>
    .studio-row {
        min-height: 32px;
    }

    @media (pointer: coarse) {
        .studio-row {
            min-height: 44px;
        }
    }
</style>
