<script lang="ts">
    import { afterFlush } from '../../ts/afterFlush'
    import { language } from '../../lang'
    import { isOn, selectControl, selectedIndex, type PanelValueRow } from '../../ts/chatShell/togglePanel'

    // One value row of the preview, drawn as the chat panel draws it: the same on rule, the same choice of control. Its
    // value is the sandbox's, never the chat's: `onset` receives every change and nothing here is stored.
    interface Props {
        row: PanelValueRow
        // The sandbox value of the row's key; empty while unset.
        value: string
        // The row belongs to the owner being edited.
        current: boolean
        // Another shown row has the same label, so the key tells them apart.
        showKey: boolean
        onset: (value: string) => void
        // Focus entered the row.
        onfocus: () => void
    }

    let { row, value, current, showKey, onset, onfocus }: Props = $props()

    const on = $derived(isOn(row.kind, value))
    const control = $derived(row.kind === 'select' ? selectControl(row.label, row.options) : null)
    const chosen = $derived(row.kind === 'select' ? selectedIndex(value, row.options) : 0)
    const labelId = $derived(`studio-tg-preview-label-${row.uid}`)
    const FIELD_CLASS = 'min-h-11 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor'
    const OPTION_CLASS = 'min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer'

    // Arrow keys move the choice of a segmented control, as the chat panel's does.
    async function onRadioKey(event: KeyboardEvent): Promise<void> {
        const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
        if (step === 0) return
        event.preventDefault()
        const group = event.currentTarget as HTMLElement
        const next = (chosen + step + row.options.length) % row.options.length
        onset(String(next))
        await afterFlush()
        group.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
    }
</script>

<div
    data-part="studio-tg-preview-row"
    data-uid={row.uid}
    data-key={row.key}
    data-kind={row.kind}
    data-on={on ? '' : undefined}
    data-current={current ? '' : undefined}
    title={language.studioTgPreviewKeyTip(row.key)}
    class={`flex flex-col gap-1 rounded-md border px-2 py-1 ${current ? 'border-selected' : 'border-transparent'}`}
    onfocusin={onfocus}
>
    {#if row.kind === 'check'}
        <label class="flex min-h-11 items-center gap-2">
            {#if on}<span data-part="studio-tg-preview-dot" aria-hidden="true" class="size-2 shrink-0 rounded-full bg-selected"></span>{/if}
            <span class="min-w-0 flex-1 break-words">{row.label}</span>
            <input type="checkbox" role="switch" aria-label={row.label} data-part="studio-tg-preview-switch" checked={on} onchange={() => onset(on ? '0' : '1')} />
        </label>
    {:else}
        <div class="flex min-h-11 items-center gap-2">
            {#if on}<span data-part="studio-tg-preview-dot" aria-hidden="true" class="size-2 shrink-0 rounded-full bg-selected"></span>{/if}
            <span id={labelId} class="min-w-0 flex-1 break-words">{row.label}{#if on}<span class="sr-only">, {language.chatShellTogglesChangedA11y}</span>{/if}</span>
        </div>
        {#if row.kind === 'select' && control !== 'list'}
            <div role="radiogroup" data-part="studio-tg-preview-select" data-layout={control} aria-labelledby={labelId} tabindex="-1" class="flex flex-wrap gap-1" onkeydown={onRadioKey}>
                {#each row.options as option, index}
                    <button type="button" role="radio" data-part="studio-tg-preview-option" aria-checked={index === chosen} tabindex={index === chosen ? 0 : -1} class={`${OPTION_CLASS} ${index === chosen ? 'bg-selected' : ''}`} onclick={() => onset(String(index))}>{option}</button>
                {/each}
            </div>
        {:else if row.kind === 'select'}
            <select data-part="studio-tg-preview-select-list" aria-labelledby={labelId} aria-describedby={labelId} class={FIELD_CLASS} value={String(chosen)} onchange={(event) => onset(event.currentTarget.value)}>
                {#each row.options as option, index}
                    <option value={String(index)}>{option}</option>
                {/each}
            </select>
        {:else if row.kind === 'text'}
            <input type="text" data-part="studio-tg-preview-text" aria-labelledby={labelId} class={FIELD_CLASS} {value} oninput={(event) => onset(event.currentTarget.value)} />
        {:else}
            <textarea rows="2" data-part="studio-tg-preview-textarea" aria-labelledby={labelId} class={FIELD_CLASS} {value} oninput={(event) => onset(event.currentTarget.value)}></textarea>
        {/if}
    {/if}
    {#if showKey}
        <span data-part="studio-tg-preview-key" class="font-mono text-xs text-textcolor2">{row.key}</span>
    {/if}
</div>
