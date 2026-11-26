<script lang="ts">
    import { onDestroy } from 'svelte'
    import { TriangleAlert } from '@lucide/svelte'
    import { language } from '../../lang'
    import { askRiskyTurnOn, type RiskyAsk } from '../../ts/studio/edit/riskyConfirm.svelte'
    import { CHARACTER_RISKY_FIX_PATHS, CHARACTER_RISKY_FLAG_PATHS, type CharacterRiskyFlagPath, type RiskyFlagPath } from '../../ts/studio/edit/riskyFlags'
    import { riskyExplainOf, riskyNameOf } from '../../ts/studio/edit/riskyText'
    import { refusalText } from '../../ts/studio/edit/studioToasts'
    import type { OwnerHistoryService, StudioRefusal, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import type { OwnerKey } from '../../ts/studio/history/ownerPhase'
    import { DBState } from '../../ts/stores.svelte'

    // The risky flags of the character. The section is never folded and always shows its warning. Pressing an off switch
    // opens the question sheet and writes nothing; only the sheet's confirmation writes, as a step of its own. Turning a
    // flag off never asks. A flag stored as something other than a boolean shows the value the engine reads from it (on
    // when truthy). Pressing its switch replaces it with a real boolean as a history step, flipping what the engine reads,
    // and an undo puts the stored value back.
    interface Props {
        chaId: string
        owner: OwnerKey
        service: OwnerHistoryService | null
        editable: boolean
    }

    let { chaId, owner, service, editable }: Props = $props()

    // The stored value as it is, without the history reader's boolean-only view.
    function rawOf(path: CharacterRiskyFlagPath): unknown {
        const found = DBState.db.characters?.find((candidate) => candidate?.chaId === chaId)
        return found && found.type !== 'group' ? (found as unknown as Record<string, unknown>)[path] : undefined
    }

    // Present and not a boolean: the engine reads its truthiness; pressing replaces it with a real boolean.
    function unreadable(path: CharacterRiskyFlagPath): boolean {
        const raw = rawOf(path)
        return raw !== undefined && typeof raw !== 'boolean'
    }

    // `escapeOutput` is read as truthy on one path and as strictly `true` on another, so a stored non-boolean is neither
    // plainly on nor off: it is `mixed`.
    function checkedOf(path: CharacterRiskyFlagPath): boolean | 'mixed' {
        if (path === 'escapeOutput' && unreadable(path)) return 'mixed'
        return Boolean(rawOf(path))
    }

    let refusal = $state<StudioRefusal | null>(null)
    let announcement = $state('')
    let destroyed = false
    const asks = new Set<RiskyAsk>()
    const switches: Partial<Record<CharacterRiskyFlagPath, HTMLButtonElement>> = {}

    onDestroy(() => {
        destroyed = true
        for (const ask of [...asks]) ask.cancel()
    })

    function noted(result: StudioResult): boolean {
        refusal = result.ok === false ? result.reason : null
        return result.ok
    }

    async function press(path: CharacterRiskyFlagPath): Promise<void> {
        if (!service || !editable) return
        announcement = ''
        // A flag stored as a non-boolean is replaced by a real boolean through its fix path, whose undo puts the stored
        // value back: it flips what the engine reads (truthy is on). Once fixed in this visit, keep using the fix path
        // so the restore point tracks one entry for the property rather than both the fix path and the base path.
        const fixPath = CHARACTER_RISKY_FIX_PATHS[path]
        const target: RiskyFlagPath = unreadable(path) || service.view(owner).restore?.fields[fixPath] !== undefined ? fixPath : path
        if (unreadable(path) ? Boolean(rawOf(path)) : rawOf(path) === true) {
            noted(service.editField(owner, target, false, { coalesceKey: null }))
            return
        }
        const ask = askRiskyTurnOn(owner, [target])
        asks.add(ask)
        const answer = await ask.answer
        asks.delete(ask)
        if (destroyed) return
        refusal = null
        if (answer === 'yes') {
            if (service && noted(service.editField(owner, target, true, { confirmed: [target], coalesceKey: null }))) {
                announcement = language.studioRiskyAnnounce(riskyNameOf(path))
            }
        } else if (answer === 'blocked') {
            refusal = 'riskyConfirm'
        }
        switches[path]?.focus()
    }

    function track(element: HTMLButtonElement, path: CharacterRiskyFlagPath): { destroy(): void } {
        switches[path] = element
        return { destroy: () => { if (switches[path] === element) delete switches[path] } }
    }

    const idBase = $props.id()
</script>

<section data-part="studio-risky" data-part-critical class="flex flex-col gap-3 rounded-md border-2 border-draculared bg-draculared/5 p-3">
    <div data-part="studio-risky-header" class="flex items-center gap-2 font-bold">
        <TriangleAlert size={18} aria-hidden="true" />
        <h3>{language.studioRiskyTitle}</h3>
    </div>
    <p data-part="studio-risky-warning" id="{idBase}-warning" class="text-sm">{language.studioRiskyWarn}</p>
    {#each CHARACTER_RISKY_FLAG_PATHS as path (path)}
        <div data-part="studio-risky-flag" class="flex flex-col gap-1">
            <button
                type="button"
                role="switch"
                aria-checked={checkedOf(path)}
                aria-describedby="{idBase}-{path}-explain{unreadable(path) ? ` ${idBase}-${path}-unreadable` : ''} {idBase}-warning"
                data-part="studio-risky-switch"
                data-path={path}
                data-fix-path={CHARACTER_RISKY_FIX_PATHS[path]}
                class="flex min-h-11 items-center gap-2 rounded-md border border-darkborderc bg-darkbg px-3 text-start text-textcolor disabled:cursor-default disabled:opacity-50 {checkedOf(path) === true ? 'border-draculared' : ''}"
                disabled={!editable || !service}
                use:track={path}
                onclick={() => void press(path)}
            >
                <span class="font-bold">{riskyNameOf(path)}</span>
                <span aria-hidden="true" class="ms-auto flex h-5 w-9 shrink-0 items-center rounded-full border border-darkborderc p-0.5 {checkedOf(path) === true ? 'justify-end bg-draculared' : checkedOf(path) === 'mixed' ? 'justify-center bg-darkborderc' : 'justify-start bg-darkbutton'}">
                    <span class="h-3.5 w-3.5 rounded-full bg-textcolor"></span>
                </span>
            </button>
            <p data-part="studio-risky-explain" id="{idBase}-{path}-explain" class="text-sm text-textcolor2">{riskyExplainOf(path)}</p>
            {#if unreadable(path)}
                <p role="note" id="{idBase}-{path}-unreadable" class="text-sm text-textcolor2">{language.studioRiskyUnreadable}</p>
            {/if}
        </div>
    {/each}
    {#if refusal}
        <p role="alert" class="text-sm text-draculared">{refusalText(refusal)}</p>
    {/if}
    <p role="status" aria-live="polite" class="sr-only">{announcement}</p>
</section>
