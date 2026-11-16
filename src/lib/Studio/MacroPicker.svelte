<script lang="ts">
    import { language } from '../../lang'
    import { registerStudioBackLayer } from '../../ts/studio/studioBack.svelte'
    import { stripBottom, type PickItem } from '../../ts/studio/longText/macroPick'

    // The macro picker of one long-text field: a listbox the field fills and drives. It is mounted only while
    // open and writes nothing; a tap asks the field to pick. A press inside it is prevented so focus stays in
    // the field, and where a platform moves focus anyway it lands on the root, which still counts as inside.
    interface Props {
        area: HTMLTextAreaElement | undefined
        items: readonly PickItem[]
        active: number
        // The caret's offset in the field's text; the wide layout opens under it.
        offset: number
        stack: boolean
        listId: string
        optionId: (index: number) => string
        isOpen: () => boolean
        onpick: (item: PickItem) => void
        onclose: () => void
        root?: HTMLElement | undefined
    }

    let { area, items, active, offset, stack, listId, optionId, isOpen, onpick, onclose, root = $bindable() }: Props = $props()

    // Back closes the picker before anything below it; the Back handler blurs the focused field first, which
    // closes the picker through the field's blur rule.
    registerStudioBackLayer({ isOpen: () => isOpen(), close: () => onclose() })

    let left = $state(0)
    let top = $state(0)
    let bottom = $state(0)

    const MIRRORED = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'tabSize',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing'] as const

    // The caret's place in the textarea, measured on a hidden copy of its text up to the caret. The copy exists
    // only for the measurement.
    function caretPoint(field: HTMLTextAreaElement, at: number): { left: number; top: number } {
        const style = getComputedStyle(field)
        const mirror = document.createElement('div')
        for (const property of MIRRORED) mirror.style[property] = style[property]
        mirror.style.position = 'absolute'
        mirror.style.visibility = 'hidden'
        mirror.style.top = '0'
        mirror.style.left = '0'
        mirror.style.whiteSpace = 'pre-wrap'
        mirror.style.overflowWrap = 'break-word'
        mirror.style.width = `${field.offsetWidth}px`
        mirror.textContent = field.value.slice(0, at)
        const marker = document.createElement('span')
        marker.textContent = '​'
        mirror.appendChild(marker)
        document.body.appendChild(mirror)
        const point = { left: marker.offsetLeft - field.scrollLeft, top: marker.offsetTop - field.scrollTop }
        mirror.remove()
        return point
    }

    $effect(() => {
        void items
        if (stack || !area) return
        const point = caretPoint(area, offset)
        const lineHeight = parseFloat(getComputedStyle(area).lineHeight)
        const width = 288
        left = Math.max(0, Math.min(point.left, area.clientWidth - width))
        top = point.top + (Number.isFinite(lineHeight) ? lineHeight : 20)
    })

    // The strip rides above the on-screen keyboard: its bottom follows the visual viewport.
    $effect(() => {
        if (!stack) return
        const update = (): void => {
            const vv = window.visualViewport
            bottom = stripBottom(window.innerHeight, vv ?? { height: window.innerHeight, offsetTop: 0 })
        }
        update()
        window.addEventListener('resize', update)
        window.visualViewport?.addEventListener('resize', update)
        window.visualViewport?.addEventListener('scroll', update)
        return () => {
            window.removeEventListener('resize', update)
            window.visualViewport?.removeEventListener('resize', update)
            window.visualViewport?.removeEventListener('scroll', update)
        }
    })

    $effect(() => {
        if (active < 0) return
        document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' })
    })

    function keepFocus(event: Event): void {
        event.preventDefault()
    }

    function leave(event: FocusEvent): void {
        const to = event.relatedTarget
        if (to instanceof Node && (root?.contains(to) || to === area)) return
        onclose()
    }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions -->
<div
    bind:this={root}
    tabindex="-1"
    data-part="studio-lt-picker"
    data-layout={stack ? 'stack' : 'wide'}
    class="rounded border border-darkborderc bg-bgcolor text-sm shadow-lg {stack ? 'fixed inset-x-0 z-50' : 'absolute z-20 w-72 max-w-full'}"
    style={stack ? `bottom: ${bottom}px` : `left: ${left}px; top: ${top}px`}
    onpointerdown={keepFocus}
    onmousedown={keepFocus}
    onfocusout={leave}
>
    <ul id={listId} role="listbox" aria-label={language.ltInsertMacro} class="max-h-56 overflow-y-auto">
        {#each items as item, at (item.key)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <li
                id={optionId(at)}
                role="option"
                aria-selected={at === active}
                data-part="studio-lt-picker-option"
                class="cursor-pointer px-2 py-1 hover:bg-selected {at === active ? 'bg-selected' : ''}"
                onclick={() => onpick(item)}
            >
                <span data-part="studio-lt-picker-name" class="font-bold">{item.name}</span>
                <span data-part="studio-lt-picker-label" class="text-textcolor2">{item.label}</span>
                {#if item.usage}
                    <span data-part="studio-lt-picker-usage" class="block truncate text-xs text-textcolor2">{item.usage}</span>
                {/if}
            </li>
        {/each}
    </ul>
    <div data-part="studio-lt-picker-count" aria-live="polite" class="sr-only">{language.ltMacroMatches(items.length)}</div>
</div>
