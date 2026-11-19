<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { language } from '../../lang'
    import { recordCaughtError } from '../../ts/caughtErrors'
    import { jumpTargetOf, placeLabelOf } from '../../ts/studio/assets/mergeCommit'
    import { refusalTextOf, type StudioToasts } from '../../ts/studio/edit/studioToasts'
    import { parseOwnerKey } from '../../ts/studio/history/ownerPhase'
    import { moduleSlotsWithId } from '../../ts/studio/edit/assetSetters'
    import { getStudioHistoryService } from '../../ts/studio/history/studioHistoryService.svelte'
    import { DBState } from '../../ts/stores.svelte'
    import { selectStudioNode } from '../../ts/studio/studioScreen.svelte'
    import type { ToggleBuilder, ToggleTarget } from '../../ts/studio/toggleBuilder.svelte'
    import { planFromScan, scanReach, type ListedReason, type ListedUse } from '../../ts/studio/toggleUpdateAll'
    import { currentUpdate, readShownReach, runUpdateAll, undoLastUpdate } from '../../ts/studio/toggleUpdateAllRun.svelte'
    import type { ToastHost, ToastId, UndoOutcome } from '../../ts/toast/toastHost.svelte'

    // The uses list of the renames the saved-values question is about: where the old keys are still read, what Update
    // all would rewrite, what it leaves and why, and the result line with Undo all for this visit. The scan runs when
    // the list opens and when its keys change; after an update or a recheck the refresh runs in the next task, so no
    // task scans twice. It is cached together with the reach it read and is for display only: the click rescans in its
    // own task and compares signatures.
    interface Props {
        builder: Pick<ToggleBuilder, 'usesRenames' | 'usesKept' | 'dismissUses' | 'noteUpdated' | 'owner'>
        target: ToggleTarget
        chaId: string
        editable: boolean
        announce: (text: string) => void
        toasts: StudioToasts
        host: ToastHost
    }

    let { builder, target, chaId, editable, announce, toasts, host }: Props = $props()

    const LISTED_CAP = 50

    let refresh = $state(0)
    // Counts Update all clicks. A scan records the count it was taken at, so Update all stays disabled until a scan
    // taken after the latest click has landed.
    let runs = $state(0)
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let optIn = $state.raw<ReadonlySet<string>>(new Set())
    let error = $state('')
    let toastId: ToastId | null = null

    const renames = $derived(builder.usesRenames)
    const fromKey = $derived(renames.map((rename) => rename.from).join('\u0000'))
    const service = $derived(getStudioHistoryService())

    // The reach and the scan of it, read together and untracked: the list lags an outside edit until the click rescans.
    const scanned = $derived.by(() => {
        void refresh
        if (fromKey === '') {
            return null
        }
        return untrack(() => {
            try {
                const reach = readShownReach(target, chaId)
                return { reach, scan: scanReach(reach, new Set(renames.map((rename) => rename.from))), runs }
            } catch (failure) {
                recordCaughtError('studio.toggleUses.scan', failure)
                return null
            }
        })
    })
    const plan = $derived(scanned === null ? null : planFromScan(scanned.reach, scanned.scan, renames, optIn))

    const counts = $derived.by(() => {
        const byOwner = new Map<string, number>()
        for (const write of plan?.writes ?? []) {
            byOwner.set(write.owner, (byOwner.get(write.owner) ?? 0) + write.count)
        }
        return [...byOwner]
    })
    const listedShown = $derived((plan?.listed ?? []).slice(0, LISTED_CAP))
    const listedMore = $derived(Math.max(0, (plan?.listed.length ?? 0) - LISTED_CAP))
    const nothingFound = $derived(plan !== null && plan.writes.length === 0 && plan.skipped.length === 0 && plan.listed.length === 0)
    const canUpdate = $derived(editable && service !== null && plan !== null && scanned?.runs === runs && plan.count > 0 && plan.blocked.length === 0)
    const result = $derived(currentUpdate())

    function ownerName(key: string): string {
        const found = scanned?.reach.owners.find((owner) => owner.key === key)
        if (found) {
            return found.name
        }
        // After an update the list holds no scan, but the result line still names owners.
        const parsed = parseOwnerKey(key)
        if (parsed?.kind === 'module') {
            const name = (moduleSlotsWithId(DBState.db.modules, parsed.moduleId)[0]?.module as { name?: unknown } | undefined)?.name
            return typeof name === 'string' && name !== '' ? name : parsed.moduleId
        }
        if (parsed?.kind === 'character') {
            return DBState.db.characters?.find((character) => character?.chaId === parsed.chaId)?.name ?? parsed.chaId
        }
        return key
    }

    // A regex pattern is listed under its replacement field, the place the registry labels and opens.
    function usePlaceOf(path: string): string {
        const pattern = /^regex\/(\d+)\/in$/.exec(path)
        return pattern ? `regex/${pattern[1]}/out` : path
    }

    function jumpOf(use: ListedUse) {
        const parsed = parseOwnerKey(use.owner)
        if (parsed === null || (parsed.kind !== 'character' && parsed.kind !== 'module')) {
            return null
        }
        return jumpTargetOf(parsed.kind, parsed.kind === 'module' ? parsed.moduleId : parsed.chaId, usePlaceOf(use.path))
    }

    function placeOf(use: ListedUse): string {
        const parsed = parseOwnerKey(use.owner)
        return placeLabelOf(parsed?.kind === 'module' ? 'module' : 'character', usePlaceOf(use.path))
    }

    function reasonText(reason: ListedReason): string {
        switch (reason) {
            case 'dynamicName': return language.studioTgUsesWhyDynamic
            case 'literalBlock': return language.studioTgUsesWhyLiteral
            case 'code': return language.studioTgUsesWhyCode
            case 'regexPattern': return language.studioTgUsesWhyRegexIn
            case 'calcKey': return language.studioTgUsesWhyCalc
            case 'mismatch': return language.studioTgUsesWhyMismatch
            case 'blocked': return ''
        }
    }

    function unreachedText(entry: { name: string, reason: 'notLoaded' | 'sharedId' | 'duplicateCharacter' | 'restricted' }): string {
        switch (entry.reason) {
            case 'notLoaded': return language.studioTgUsesNotLoaded(entry.name)
            case 'sharedId': return language.studioTgUsesSharedId(entry.name)
            case 'duplicateCharacter': return language.studioTgUsesDuplicateCharacter
            case 'restricted': return language.studioTgUsesRestricted
        }
    }

    function open(use: ListedUse): void {
        const jump = jumpOf(use)
        if (jump) {
            selectStudioNode(use.owner, jump.kind, jump.itemId)
        }
    }

    function toggleOptIn(owner: string, on: boolean): void {
        const next = new Set(optIn)
        if (on) {
            next.add(owner)
        } else {
            next.delete(owner)
        }
        optIn = next
    }

    function clearRefreshTimer(): void {
        if (refreshTimer !== null) {
            clearTimeout(refreshTimer)
            refreshTimer = null
        }
    }

    // The display scan follows a click in the next task, so the click task runs the update's own scan only.
    function scheduleRefresh(): void {
        clearRefreshTimer()
        refreshTimer = setTimeout(() => {
            refreshTimer = null
            refresh += 1
        }, 0)
    }

    function undoOutcome(token?: number): UndoOutcome {
        const undone = undoLastUpdate(token)
        if (undone.ok === true) {
            // This scan is fresh, so the pending refresh would only scan a second time.
            clearRefreshTimer()
            refresh += 1
            return { ok: true, text: language.studioTgUpdateUndone }
        }
        if (undone.reason === 'changed') {
            return { ok: false, text: language.studioTgUpdateUndoChanged(ownerName(undone.owner)) }
        }
        return { ok: false, text: undone.reason === 'gone' ? language.studioTgUpdateUndoGone : refusalTextOf({ reason: 'unknown' }, builder.owner) }
    }

    function updateAll(): void {
        if (plan === null) {
            return
        }
        error = ''
        runs += 1
        const outcome = runUpdateAll({ target, chaId, renames: () => builder.usesRenames, optIn, shownSignature: plan.signature })
        if (outcome.ok === true) {
            if (outcome.count > 0) {
                const token = outcome.token
                toastId = toasts.postUndoAction(language.studioTgUpdated(outcome.count), () => undoOutcome(token))
                announce(language.studioTgUpdated(outcome.count))
                builder.noteUpdated()
            }
        } else if (outcome.reason === 'stale') {
            announce(language.studioTgUpdateRecheck)
        } else {
            error = refusalTextOf({ reason: outcome.reason === 'unavailable' ? 'loading' : 'unknown' }, builder.owner)
        }
        scheduleRefresh()
    }

    function undoAll(): void {
        error = ''
        const outcome = undoOutcome()
        if (outcome.ok) {
            if (toastId !== null) {
                host.dismiss(toastId)
                toastId = null
            }
            announce(outcome.text)
        } else {
            error = outcome.text
        }
    }

    // The toast ends with this list only when nothing is left to undo; a kept update keeps offering its toast Undo.
    onDestroy(() => {
        clearRefreshTimer()
        if (toastId !== null && currentUpdate() === null) {
            host.dismiss(toastId)
        }
    })
</script>

{#if plan !== null && scanned !== null}
    <section data-part="studio-toggle-uses" aria-label={language.studioTgUsesTitle} class="flex flex-col gap-2 rounded-md border border-borderc bg-darkbg p-3">
        <h3 class="font-bold">{language.studioTgUsesTitle}</h3>
        {#each renames as rename (rename.from + '\u0000' + rename.to)}
            <p data-part="studio-toggle-uses-rename" class="text-sm text-textcolor">{language.studioTgUsesRename(rename.from, rename.to)}</p>
        {/each}
        {#if plan.blocked.length > 0}
            <p data-part="studio-toggle-uses-blocked" class="text-sm text-textcolor2">{language.studioTgUsesKeyBlocked(plan.blocked.join(', '))}</p>
        {/if}
        {#each counts as [owner, n] (owner)}
            <p data-part="studio-toggle-uses-count" class="text-sm text-textcolor">{language.studioTgUsesWillChange(ownerName(owner), n)}</p>
        {/each}
        {#each plan.skipped as entry (entry.owner + '\u0000' + entry.key)}
            <div data-part="studio-toggle-uses-skipped" class="flex flex-col gap-1">
                <p class="text-sm text-textcolor2">{language.studioTgUsesSkipped(ownerName(entry.owner), entry.key, entry.count)}</p>
                <label class="flex min-h-11 items-center gap-2 text-sm text-textcolor cursor-pointer">
                    <input type="checkbox" data-part="studio-toggle-uses-optin" checked={optIn.has(entry.owner)} disabled={!editable} onchange={(event) => toggleOptIn(entry.owner, event.currentTarget.checked)} />
                    <span>{language.studioTgUsesAlsoUpdate(ownerName(entry.owner))}</span>
                </label>
            </div>
        {/each}
        {#if plan.listed.length > 0}
            <h4 class="text-sm font-bold">{language.studioTgUsesListedTitle}</h4>
            <ul class="flex flex-col gap-1">
                {#each listedShown as use (use.owner + '\u0000' + use.path + '\u0000' + use.offset + '\u0000' + use.key)}
                    <li data-part="studio-toggle-uses-listed" data-reason={use.reason} class="flex flex-wrap items-center gap-2 text-sm text-textcolor">
                        <span>{ownerName(use.owner)}, {placeOf(use)}</span>
                        {#if reasonText(use.reason) !== ''}
                            <span data-part="studio-toggle-uses-reason" class="text-textcolor2">{reasonText(use.reason)}</span>
                        {/if}
                        {#if jumpOf(use)}
                            <button type="button" data-part="studio-toggle-uses-open" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={() => open(use)}>{language.studioTgUsesOpen}</button>
                        {/if}
                    </li>
                {/each}
            </ul>
            {#if listedMore > 0}
                <p data-part="studio-toggle-uses-more" class="text-sm text-textcolor2">{language.studioTgUsesMore(listedMore)}</p>
            {/if}
        {/if}
        {#each scanned.reach.unreached as entry (entry.name + entry.reason)}
            <p data-part="studio-toggle-uses-unreached" class="text-sm text-textcolor2">{unreachedText(entry)}</p>
        {/each}
        <p data-part="studio-toggle-uses-outside" class="text-sm text-textcolor2">{language.studioTgUsesOutside}</p>
        {#if nothingFound}
            <p data-part="studio-toggle-uses-none" class="text-sm text-textcolor2">{language.studioTgUsesNone}</p>
        {/if}
        {#if error !== ''}
            <p role="alert" data-part="studio-toggle-uses-error" class="text-sm text-draculared">{error}</p>
        {/if}
        <div class="flex flex-wrap gap-2">
            {#if !nothingFound}
                <button type="button" data-part="studio-toggle-uses-update" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" disabled={!canUpdate} onclick={updateAll}>{language.studioTgUsesUpdateAll}</button>
            {/if}
            {#if builder.usesKept}
                <button type="button" data-part="studio-toggle-uses-close" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={() => builder.dismissUses()}>{language.studioTgUsesClose}</button>
            {/if}
        </div>
    </section>
{/if}
{#if result !== null}
    <div data-part="studio-toggle-uses-result" class="flex flex-wrap items-center gap-2 rounded-md border border-darkborderc p-2 text-sm text-textcolor2">
        <span>{language.studioTgUpdated(result.count)}</span>
        <button type="button" data-part="studio-toggle-uses-undo" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" disabled={!editable} onclick={undoAll}>{language.studioTgUpdateUndo}</button>
    </div>
{/if}
{#if plan === null && error !== ''}
    <p role="alert" data-part="studio-toggle-uses-error" class="text-sm text-draculared">{error}</p>
{/if}
