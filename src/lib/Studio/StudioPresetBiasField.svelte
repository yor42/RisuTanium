<script lang="ts">
    import { onDestroy } from 'svelte'
    import { language } from '../../lang'
    import { downloadFile } from '../../ts/globalApi.svelte'
    import { selectSingleFile } from '../../ts/util'
    import { addRow, deleteRow, duplicateIndexes, editToken, editValue } from '../../ts/studio/edit/biasRows'
    import { PRESET_FIELDS, presetValueAllowed } from '../../ts/studio/edit/presetFields'
    import { clampPresetBias, parseBiasFile } from '../../ts/studio/edit/presetLists'
    import { presetStoredValue, readPresetField } from '../../ts/studio/edit/presetTarget'
    import { refusalTextOf } from '../../ts/studio/edit/studioToasts'
    import { isBiasList } from '../../ts/studio/history/fieldAccess'
    import type { BiasRow } from '../../ts/studio/history/fieldRegistry'
    import type { OwnerHistoryService, StudioRefusal, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import type { OwnerKey } from '../../ts/studio/history/ownerPhase'
    import { studioScreen } from '../../ts/studio/studioScreen.svelte'
    import { createCompositionGate } from '../../ts/studio/toggleBuilderModel'

    // The logit bias list of one preset, as whole-list steps of the preset owner: a row per token with its value, add,
    // remove, and import and export of the list as JSON (as classic). An import replaces the whole list in one step; a file
    // that is not a list of `[text, number]` entries is refused whole with a note and writes nothing.
    interface Props {
        presetId: string
        owner: OwnerKey
        service: OwnerHistoryService | null
        editable: boolean
        // The preset is the active one: a "not set" note describes a switch, which the active preset has none of.
        active: boolean
    }

    let { presetId, owner, service, editable, active }: Props = $props()

    const PATH = 'presetBias'
    const BUTTON_CLASS = 'min-h-11 min-w-11 rounded-md border border-darkborderc bg-darkbg px-3 text-textcolor hover:bg-selected disabled:opacity-50 cursor-pointer'
    const INPUT_CLASS = 'min-h-11 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor disabled:opacity-50'

    const read = $derived(readPresetField(presetId, PATH))
    // The rows as the strict reader reads them (a fresh copy); empty while the preset holds none.
    const rows = $derived<BiasRow[]>(read.had === true && isBiasList(read.value) ? read.value : [])
    // A stored array that is not a bias list (one malformed row) is shown read-only and exported as stored; nothing
    // here writes while it holds, so the valid rows around the bad one are never replaced.
    const stored = $derived(presetStoredValue(presetId, PATH))
    const unreadable = $derived(Array.isArray(stored) && !isBiasList(stored))
    function cellText(cell: unknown): string {
        return typeof cell === 'string' ? cell : typeof cell === 'number' && Number.isFinite(cell) ? String(cell) : ''
    }
    const shownRows = $derived.by((): { token: string; value: string }[] => {
        if (!unreadable) return rows.map((row) => ({ token: row[0], value: String(row[1]) }))
        return (stored as unknown[]).map((row) => (Array.isArray(row) ? { token: cellText(row[0]), value: cellText(row[1]) } : { token: '', value: '' }))
    })
    const locked = $derived(!service || !editable || unreadable)
    const duplicates = $derived(duplicateIndexes(rows))
    const notSetNote = $derived(!active && PRESET_FIELDS[PATH].absent === 'keeps' && !read.had)
    const layout = $derived(studioScreen.layout === 'stack' ? 'card' : 'row')
    const idBase = $props.id()

    let refusal = $state<StudioRefusal | null>(null)
    let importInvalid = $state(false)
    // The note a value commit produced, per row index. A row removal clears them (the indexes shift).
    let valueNotes = $state<Record<number, 'clamp' | 'zeroed' | null>>({})

    function noted(result: StudioResult): boolean {
        refusal = result.ok === false ? result.reason : null
        return result.ok
    }

    function write(next: BiasRow[], coalesceKey: string | null): boolean {
        // Only rows the form changed are range-checked: a stored value outside the range (classic and an import keep
        // one) never blocks an edit of another row.
        const changed = next.filter((row) => !rows.some((kept) => kept[0] === row[0] && kept[1] === row[1]))
        if (!service || !editable || unreadable || !presetValueAllowed(PATH, changed)) return false
        const done = noted(service.editField(owner, PATH, next, { coalesceKey }))
        if (done && coalesceKey === null) service.closeOpenStep(owner)
        return done
    }

    const elements = new Map<number, HTMLInputElement>()
    function commitToken(index: number, value: string): void {
        if (!write(editToken(rows, index, value), `${PATH}:${index}:token`)) {
            const element = elements.get(index)
            if (element) element.value = rows[index]?.[0] ?? ''
        }
    }
    const gates = new Map<number, ReturnType<typeof createCompositionGate>>()
    function gateOf(index: number): ReturnType<typeof createCompositionGate> {
        let gate = gates.get(index)
        if (!gate) {
            gate = createCompositionGate((value) => commitToken(index, value))
            gates.set(index, gate)
        }
        return gate
    }
    function onTokenInput(index: number, event: Event & { currentTarget: HTMLInputElement }): void {
        elements.set(index, event.currentTarget)
        gateOf(index).input(event.currentTarget.value, event instanceof InputEvent && event.isComposing)
    }
    function onTokenBlur(index: number): void {
        gateOf(index).flush()
        service?.closeOpenStep(owner)
    }
    onDestroy(() => {
        for (const gate of gates.values()) gate.flush()
        service?.closeOpenStep(owner)
    })

    function onValueChange(index: number, event: Event & { currentTarget: HTMLInputElement }): void {
        const element = event.currentTarget
        const { value, note } = clampPresetBias(element.value)
        if (write(editValue(rows, index, value), null)) valueNotes[index] = note
        element.value = String(rows[index]?.[1] ?? value)
    }

    function remove(index: number): void {
        if (write(deleteRow(rows, index), null)) valueNotes = {}
    }

    function exportList(): void {
        void downloadFile('bias.json', JSON.stringify(unreadable ? stored : rows, null, 2))
    }

    async function importList(): Promise<void> {
        if (locked) return
        const picked = await selectSingleFile(['json'])
        if (!picked) return
        const parsed = parseBiasFile(new TextDecoder().decode(picked.data))
        if (parsed === null) {
            importInvalid = true
            return
        }
        importInvalid = false
        // A file's own values are kept as classic keeps them: the list replaces the stored one whole.
        if (service && editable) {
            if (noted(service.editField(owner, PATH, parsed, { coalesceKey: null }))) {
                valueNotes = {}
                service.closeOpenStep(owner)
            }
        }
    }

    function noteLine(index: number): string {
        const parts: string[] = []
        const note = valueNotes[index]
        if (note === 'clamp') parts.push(language.studioBiasClamp)
        if (note === 'zeroed') parts.push(language.studioBiasZeroed)
        if (duplicates.has(index)) parts.push(language.studioPresetBiasDuplicate)
        return parts.join(' · ')
    }
</script>

<div data-path={PATH} aria-busy={locked ? 'true' : undefined} class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
        <div class="flex gap-1">
            <button type="button" data-part="studio-preset-bias-export" class={BUTTON_CLASS} aria-label={language.export} onclick={exportList}>{language.export}</button>
            <button type="button" data-part="studio-preset-bias-import" class={BUTTON_CLASS} disabled={locked} aria-label={language.import} onclick={() => void importList()}>{language.import}</button>
        </div>
        <button type="button" data-part="studio-preset-bias-add" class={BUTTON_CLASS} disabled={locked} aria-label={language.add} onclick={() => write(addRow(rows), null)}>+</button>
    </div>
    {#if importInvalid}
        <p role="alert" data-part="studio-preset-bias-import-invalid" class="text-sm text-draculared">{language.studioPresetBiasImportInvalid}</p>
    {/if}
    {#if unreadable}
        <p role="note" data-part="studio-preset-bias-unreadable" class="text-sm text-textcolor2">{language.studioBiasUnreadable}</p>
    {/if}
    {#if shownRows.length === 0}
        <p class="text-sm text-textcolor2">{language.noBias}</p>
    {/if}
    {#each shownRows as row, i (i)}
        <div data-part="studio-preset-bias-row" data-layout={layout} class="flex flex-col gap-1 rounded-md border border-darkborderc p-2">
            <div class="flex gap-2 {layout === 'card' ? 'flex-col' : 'flex-row items-end'}">
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <label for="{idBase}-token-{i}" class="text-sm">{language.studioBiasToken}</label>
                    <input
                        id="{idBase}-token-{i}"
                        type="text"
                        data-part="studio-preset-bias-token"
                        class={INPUT_CLASS}
                        placeholder={language.sidebarUi.biasTokenPlaceholder}
                        disabled={locked}
                        value={row.token}
                        oninput={(event) => onTokenInput(i, event)}
                        oncompositionstart={() => gateOf(i).start()}
                        oncompositionend={(event) => { elements.set(i, event.currentTarget); gateOf(i).end(event.currentTarget.value) }}
                        onblur={() => onTokenBlur(i)}
                    />
                </div>
                <div class="flex flex-col gap-1 {layout === 'card' ? '' : 'w-40'}">
                    <label for="{idBase}-value-{i}" class="text-sm">{language.value}</label>
                    <input
                        id="{idBase}-value-{i}"
                        type="number"
                        inputmode="decimal"
                        step="any"
                        min="-101"
                        max="100"
                        data-part="studio-preset-bias-value"
                        class={INPUT_CLASS}
                        disabled={locked}
                        value={row.value}
                        onchange={(event) => onValueChange(i, event)}
                    />
                </div>
                <button type="button" data-part="studio-preset-bias-remove" class={BUTTON_CLASS} disabled={locked} onclick={() => remove(i)}>{language.remove}</button>
            </div>
            {#if noteLine(i) !== ''}
                <p role="note" class="text-sm text-textcolor2">{noteLine(i)}</p>
            {/if}
        </div>
    {/each}
    {#if notSetNote}
        <p data-part="studio-preset-not-set" class="text-sm text-textcolor2">{language.studioPresetNotSet}</p>
    {/if}
    {#if refusal}
        <p role="alert" data-part="studio-form-refusal" class="text-sm text-draculared">{refusalTextOf({ reason: refusal }, owner)}</p>
    {/if}
</div>
