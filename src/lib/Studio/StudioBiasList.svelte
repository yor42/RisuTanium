<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { language } from '../../lang'
    import { afterFlush } from '../../ts/afterFlush'
    import { addRow, clampBias, deleteRow, duplicateIndexes, editToken, editValue, focusAfterDelete, type BiasNote } from '../../ts/studio/edit/biasRows'
    import { createStudioToasts, refusalText } from '../../ts/studio/edit/studioToasts'
    import { isBiasList } from '../../ts/studio/history/fieldAccess'
    import type { BiasRow } from '../../ts/studio/history/fieldRegistry'
    import type { OwnerHistoryService, StudioRefusal, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { getStudioHistoryService } from '../../ts/studio/history/studioHistoryService.svelte'
    import type { OwnerKey } from '../../ts/studio/history/ownerPhase'
    import { studioScreen } from '../../ts/studio/studioScreen.svelte'
    import { createCompositionGate } from '../../ts/studio/toggleBuilderModel'
    import { DBState } from '../../ts/stores.svelte'
    import type { ToastHost } from '../../ts/toast/toastHost.svelte'

    // The token bias list of the character: one row per token with its value and a delete. Every change is one history
    // step; typing a token coalesces per row and a blur closes the step. A value is clamped to -100..100 and an emptied
    // one is stored as 0, each with a note. A list the strict reader cannot read (a `null` cell, a 3-tuple, a non-array)
    // is shown read-only, as stored, and nothing is written for it: mounting writes nothing either.
    interface Props {
        chaId: string
        owner: OwnerKey
        service: OwnerHistoryService | null
        editable: boolean
        // The toast host of the delete toast; the app's own host when absent (tests pass one on a fake clock).
        host?: ToastHost
    }

    let { chaId, owner, service, editable, host }: Props = $props()

    const toasts = createStudioToasts({ service: getStudioHistoryService, host: untrack(() => host) })

    const stored = $derived.by((): unknown => {
        const found = DBState.db.characters?.find((candidate) => candidate?.chaId === chaId)
        return found && found.type !== 'group' ? (found as unknown as { bias?: unknown }).bias : undefined
    })
    // The rows as the strict reader reads them (a fresh copy), or null when the list is not readable.
    const rows = $derived<BiasRow[] | null>(isBiasList(stored) ? stored.map((row) => [row[0], row[1]]) : null)

    // What an unreadable list shows: the cells as text where they are a string or a finite number, empty otherwise. This
    // is only for display; it is never written back.
    function cellText(cell: unknown): string {
        return typeof cell === 'string' ? cell : typeof cell === 'number' && Number.isFinite(cell) ? String(cell) : ''
    }
    const shownRows = $derived.by((): { token: string; value: string }[] => {
        if (rows) return rows.map((row) => ({ token: row[0], value: String(row[1]) }))
        if (!Array.isArray(stored)) return []
        return stored.map((row) => (Array.isArray(row) ? { token: cellText(row[0]), value: cellText(row[1]) } : { token: '', value: '' }))
    })

    const locked = $derived(rows === null || !editable || !service)
    const duplicates = $derived(rows ? duplicateIndexes(rows) : new Set<number>())

    // The note a value commit produced, per row index, for this visit. A row removal clears them (the indexes shift).
    let valueNotes = $state<Record<number, BiasNote>>({})
    let refusal = $state<StudioRefusal | null>(null)

    function noteLine(index: number): string {
        const parts: string[] = []
        const note = valueNotes[index]
        if (note === 'clamp') parts.push(language.studioBiasClamp)
        if (note === 'zeroed') parts.push(language.studioBiasZeroed)
        if (duplicates.has(index)) parts.push(language.studioBiasDup)
        return parts.join(' · ')
    }

    function noted(result: StudioResult): boolean {
        refusal = result.ok === false ? result.reason : null
        return result.ok
    }

    const idBase = $props.id()
    let root = $state<HTMLElement>()

    // Token typing goes through a composition gate per row: nothing is written while an IME composes.
    function commitToken(index: number, value: string, element: HTMLInputElement | null): void {
        const current = rows
        const result = service && editable && current ? service.editField(owner, 'bias', editToken(current, index, value), { coalesceKey: `bias:${index}:token` }) : null
        if ((result === null || !noted(result)) && element) element.value = rows?.[index]?.[0] ?? ''
    }
    const gates = new Map<number, ReturnType<typeof createCompositionGate>>()
    const gateElements = new Map<number, HTMLInputElement>()
    function gateOf(index: number): ReturnType<typeof createCompositionGate> {
        let gate = gates.get(index)
        if (!gate) {
            gate = createCompositionGate((value) => commitToken(index, value, gateElements.get(index) ?? null))
            gates.set(index, gate)
        }
        return gate
    }
    function onTokenInput(index: number, event: Event & { currentTarget: HTMLInputElement }): void {
        gateElements.set(index, event.currentTarget)
        gateOf(index).input(event.currentTarget.value, event instanceof InputEvent && event.isComposing)
    }
    function onTokenBlur(index: number): void {
        gateOf(index).flush()
        service?.closeOpenStep(owner)
    }

    function onValueChange(index: number, event: Event & { currentTarget: HTMLInputElement }): void {
        const element = event.currentTarget
        const current = rows
        if (!service || !editable || !current) return
        const { value, note } = clampBias(element.value)
        const result = service.editField(owner, 'bias', editValue(current, index, value), { coalesceKey: null })
        if (noted(result)) valueNotes[index] = note
        element.value = String(rows?.[index]?.[1] ?? value)
    }

    function add(): void {
        const current = rows
        if (!service || !editable || !current) return
        noted(service.editField(owner, 'bias', addRow(current), { coalesceKey: null }))
    }

    async function remove(index: number): Promise<void> {
        const current = rows
        if (!service || !editable || !current) return
        const result = service.editField(owner, 'bias', deleteRow(current, index), { coalesceKey: null, reportStep: true })
        noted(result)
        if (result.ok === false) return
        valueNotes = {}
        if (result.stepId !== undefined) toasts.postAssetAction(owner, result.stepId, language.studioBiasDeleted)
        const target = focusAfterDelete(index, (rows ?? []).length)
        await afterFlush()
        const element = target === null ? root?.querySelector<HTMLElement>('[data-bias-add]') : root?.querySelectorAll<HTMLElement>('[data-bias-token]')[target]
        element?.focus()
    }

    onDestroy(() => {
        for (const gate of gates.values()) gate.flush()
        service?.closeOpenStep(owner)
    })

    const layout = $derived(studioScreen.layout === 'stack' ? 'card' : 'row')
</script>

<section bind:this={root} data-part="studio-form-bias" tabindex="-1" aria-label={language.studioFieldBias} aria-busy={locked ? 'true' : undefined} class="flex flex-col gap-2 outline-none">
    <div class="flex items-center justify-between gap-2">
        <h3 class="font-bold">{language.studioFieldBias}</h3>
        <button
            type="button"
            data-bias-add
            aria-label={language.add}
            class="min-h-11 min-w-11 rounded-md border border-darkborderc bg-darkbg px-3 text-textcolor disabled:opacity-50"
            disabled={locked}
            onclick={add}
        >+</button>
    </div>
    {#if rows === null}
        <p role="note" class="text-sm text-textcolor2">{language.studioBiasUnreadable}</p>
    {/if}
    {#if shownRows.length === 0}
        <p class="text-sm text-textcolor2">{language.noBias}</p>
    {/if}
    {#each shownRows as row, i (i)}
        <div data-part="studio-bias-row" data-layout={layout} class="flex flex-col gap-1 rounded-md border border-darkborderc p-2">
          <div class="flex gap-2 {layout === 'card' ? 'flex-col' : 'flex-row items-end'}">
            <div class="flex min-w-0 flex-1 flex-col gap-1">
                <label for="{idBase}-token-{i}" class="text-sm">{language.studioBiasToken}</label>
                <input
                    id="{idBase}-token-{i}"
                    type="text"
                    data-bias-token
                    class="min-h-11 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor disabled:opacity-50"
                    placeholder={language.sidebarUi.biasTokenPlaceholder}
                    disabled={locked}
                    value={row.token}
                    oninput={(event) => onTokenInput(i, event)}
                    oncompositionstart={() => gateOf(i).start()}
                    oncompositionend={(event) => { gateElements.set(i, event.currentTarget); gateOf(i).end(event.currentTarget.value) }}
                    onblur={() => onTokenBlur(i)}
                />
            </div>
            <div class="flex flex-col gap-1 {layout === 'card' ? '' : 'w-40'}">
                <label for="{idBase}-value-{i}" class="text-sm">{language.studioBiasValue}</label>
                <input
                    id="{idBase}-value-{i}"
                    type="number"
                    inputmode="decimal"
                    step="any"
                    data-bias-value
                    class="min-h-11 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor disabled:opacity-50"
                    disabled={locked}
                    value={row.value}
                    onchange={(event) => onValueChange(i, event)}
                />
            </div>
            <button
                type="button"
                data-bias-delete
                class="min-h-11 min-w-11 rounded-md border border-darkborderc bg-darkbg px-3 text-textcolor disabled:opacity-50"
                disabled={locked}
                onclick={() => void remove(i)}
            >{language.remove}</button>
          </div>
            {#if noteLine(i) !== ''}
                <p role="note" class="text-sm text-textcolor2">{noteLine(i)}</p>
            {/if}
        </div>
    {/each}
    {#if refusal}
        <p role="alert" class="text-sm text-draculared">{refusalText(refusal)}</p>
    {/if}
</section>
