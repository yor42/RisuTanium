<script lang="ts">
    import { language } from '../../lang'
    import { MACRO_GROUPS, type MacroGroupId } from '../../ts/studio/longText/macroGroups'
    import { filterPicks, type PickItem } from '../../ts/studio/longText/macroPick'
    import { registerStudioBackLayer } from '../../ts/studio/studioBack.svelte'

    // The macro sheet of one long-text field: every macro by group with a search. It is mounted only while open
    // and writes nothing; choosing hands the item to the field, which inserts it at the selection saved when
    // the sheet opened.
    interface Props {
        items: readonly PickItem[]
        isOpen: () => boolean
        onchoose: (item: PickItem) => void
        // `refocus` is false for Back, which must not bring the keyboard up.
        onclose: (refocus: boolean) => void
    }

    let { items, isOpen, onchoose, onclose }: Props = $props()

    registerStudioBackLayer({ isOpen: () => isOpen(), close: () => onclose(false) })

    const GROUP_TEXT: Record<MacroGroupId, () => string> = {
        char: () => language.ltMacroGroupChar,
        var: () => language.ltMacroGroupVar,
        time: () => language.ltMacroGroupTime,
        text: () => language.ltMacroGroupText,
        logic: () => language.ltMacroGroupLogic,
        display: () => language.ltMacroGroupDisplay,
        block: () => language.ltMacroGroupBlock,
    }

    const titleId = $props.id()
    let query = $state('')
    let dialog = $state<HTMLDivElement | undefined>()
    let search = $state<HTMLInputElement | undefined>()

    const shown = $derived(filterPicks(items, query))
    // The seven registry groups in order, then the entries no group covers.
    const groups = $derived([
        ...MACRO_GROUPS.map((id) => ({ id: id as MacroGroupId | null, text: GROUP_TEXT[id](), items: shown.filter((item) => item.group === id) })),
        { id: null, text: language.ltMacroOther, items: shown.filter((item) => item.group === null) },
    ].filter((group) => group.items.length > 0))

    $effect(() => {
        search?.focus()
    })

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onclose(true)
            return
        }
        if (event.key !== 'Tab' || !dialog) return
        // The sheet is modal: Tab cycles inside it.
        const focusable = [...dialog.querySelectorAll<HTMLElement>('input, button')].filter((element) => !element.hasAttribute('disabled'))
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
        }
    }
</script>

<div class="fixed inset-0 z-50 flex items-end justify-center bg-bgcolor/60 sm:items-center" data-part="studio-lt-sheet-backdrop">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
        bind:this={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabindex="-1"
        data-part="studio-lt-sheet"
        class="flex max-h-[80vh] w-full max-w-md flex-col gap-2 rounded-t border border-darkborderc bg-bgcolor p-3 sm:rounded"
        onkeydown={onKeydown}
    >
        <div class="flex items-center justify-between gap-2">
            <h2 id={titleId} class="font-bold">{language.ltInsertMacro}</h2>
            <button type="button" data-part="studio-lt-sheet-cancel" class="rounded bg-darkbutton px-2 py-1 hover:bg-selected" onclick={() => onclose(true)}>{language.cancel}</button>
        </div>
        <input
            bind:this={search}
            bind:value={query}
            type="search"
            data-part="studio-lt-sheet-search"
            aria-label={language.ltMacroSearch}
            placeholder={language.ltMacroSearch}
            class="rounded border border-darkborderc bg-darkbg p-1 text-textcolor"
        />
        <div aria-live="polite" class="sr-only" data-part="studio-lt-sheet-count">{language.ltMacroMatches(shown.length)}</div>
        <div class="flex min-h-0 flex-col gap-2 overflow-y-auto">
            {#each groups as group (group.id ?? 'other')}
                <section data-part="studio-lt-sheet-group" data-group={group.id ?? 'other'} aria-label={group.text} class="flex flex-col gap-1">
                    <h3 class="text-xs font-bold text-textcolor2">{group.text}</h3>
                    {#each group.items as item (item.key)}
                        <button type="button" data-part="studio-lt-sheet-option" class="flex flex-col items-start rounded bg-darkbg px-2 py-1 text-left hover:bg-selected" onclick={() => onchoose(item)}>
                            <span><span class="font-bold">{item.name}</span> <span class="text-textcolor2">{item.label}</span></span>
                            {#if item.usage}
                                <span class="max-w-full truncate text-xs text-textcolor2">{item.usage}</span>
                            {/if}
                        </button>
                    {/each}
                </section>
            {/each}
        </div>
    </div>
</div>
