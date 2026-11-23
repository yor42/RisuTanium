<script lang="ts">
    import { onDestroy } from 'svelte'
    import { PlusIcon } from '@lucide/svelte'
    import { language } from '../../lang'
    import { fillLang } from '../../lang/fill'
    import { afterFlush } from '../../ts/afterFlush'
    import { backCloseHandler, registerBackHandler } from '../../ts/backHandlers'
    import { providerLabel, storedConnections } from '../../ts/connections/connections'
    import { addCustomModelUnder, customModelsUnder, editCustomModelUnder, ownsCustomModels, removeCustomModelUnder } from '../../ts/connections/customModelsUnder'
    import { connectionKeyHint } from '../../ts/connections/connectionHint'
    import { clearKey, deleteConnection, keyEffectsOf, needsKey, renameConnection, replaceKey, useProxyForCurrent, type KeyEffect } from '../../ts/connections/connectionEditor'
    import { connectionUndoAction } from '../../ts/connections/connectionUndo'
    import { connectionUsers, type ConnectionUser } from '../../ts/connections/connectionUsers'
    import { dismissNotice, readNoticeDismissed, renameNoticeList } from '../../ts/connections/renameNotice'
    import { setSettingsSubLevel } from '../../ts/settingsShell/settingsNavigation'
    import { DBState } from '../../ts/stores.svelte'
    import { postUndoToast } from '../../ts/toast/toastHost.svelte'
    import PatternWarning from '../Nexus/pattern/PatternWarning.svelte'
    import type { PatternAnswer, PatternWarningDef } from '../Nexus/pattern/patternWarning'
    import ConnectionAddFlow from './connections/ConnectionAddFlow.svelte'
    import ConnectionCard from './connections/ConnectionCard.svelte'
    import ConnectionDetail from './connections/ConnectionDetail.svelte'

    /** How many users the delete dialog names before it folds the rest into "and n more". */
    const LISTED_USERS = 5

    type Sub = { kind: 'add' } | { kind: 'detail', id: string }
    type Ask = { kind: 'delete' | 'clear', id: string, trigger: HTMLElement | null }

    let sub = $state<Sub | null>(null)
    let ask = $state<Ask | null>(null)
    let dismissed = $state(readNoticeDismissed())
    /** Connections whose key write is in flight. */
    let busy = $state<string[]>([])
    let keyError = $state('')
    let rootEl = $state<HTMLElement>()
    let addButton = $state<HTMLElement>()

    const rows = $derived(storedConnections(DBState.db))
    const detailConn = $derived.by(() => {
        const current = sub
        return current?.kind === 'detail' ? rows.find((conn) => conn.id === current.id) : undefined
    })
    const noticeList = $derived(renameNoticeList(DBState.db))
    const showNotice = $derived(!dismissed && noticeList.length > 0 && sub === null)
    const subKey = $derived(sub === null ? 'list' : sub.kind === 'add' ? 'add' : `detail:${sub.id}`)
    const askConn = $derived(ask ? rows.find((conn) => conn.id === ask?.id) : undefined)

    /** Focuses the card of a connection; false when it is gone, so the caller falls back to the Add button. */
    function focusCard(id: string): boolean {
        const buttons = Array.from(rootEl?.querySelectorAll<HTMLElement>('[data-connection-open]') ?? [])
        const card = buttons.find((button) => button.getAttribute('data-connection-open') === id)
        card?.focus()
        return card !== undefined
    }

    async function closeSub(): Promise<void> {
        const was = sub
        sub = null
        ask = null
        keyError = ''
        await afterFlush()
        if (was?.kind === 'detail' && focusCard(was.id)) return
        addButton?.focus()
    }

    // A dialog closes before the level under it, for Back and for the shell header alike.
    function closeOne(): void {
        if (ask !== null) {
            ask = null
            return
        }
        void closeSub()
    }

    const open = $derived(sub !== null || ask !== null)

    // The page's own Back handler is newer than the host's, so it answers first in both Settings screens.
    $effect(() => {
        if (!open) return
        return registerBackHandler(backCloseHandler({
            isOpen: () => sub !== null || ask !== null,
            snapshot: () => `${subKey}|${ask?.kind ?? ''}`,
            close: closeOne,
        }))
    })

    setSettingsSubLevel({ isOpen: () => sub !== null || ask !== null, close: closeOne })
    onDestroy(() => setSettingsSubLevel(null))

    // A connection removed elsewhere while its detail is open leaves nothing to show.
    $effect(() => {
        if (sub?.kind === 'detail' && detailConn === undefined) {
            sub = null
            ask = null
        }
    })

    function openDetail(id: string): void {
        keyError = ''
        sub = { kind: 'detail', id }
    }

    function effectLines(effects: KeyEffect[]): string[] {
        return effects.map((effect) => effect === 'nanogpt' ? language.connectionsNanoGptEffect : language.connectionsVertexEffect)
    }

    function userLines(users: ConnectionUser[]): string[] {
        const lines = users.slice(0, LISTED_USERS).map((user) => user.name)
        if (users.length > LISTED_USERS) lines.push(fillLang(language.connectionsAndMore, { n: users.length - LISTED_USERS }))
        return lines
    }

    function askDef(current: Ask): PatternWarningDef | null {
        const conn = askConn
        if (!conn) return null
        const effects = effectLines(keyEffectsOf(conn.provider))
        if (current.kind === 'clear') {
            return {
                severity: 'danger',
                headline: fillLang(language.connectionsClearKeyQ, { name: conn.name }),
                consequences: [...effects, language.connectionsKeyNoUndo],
                actions: { cancel: language.cancel, primary: language.connectionsClearKey },
            }
        }
        const users = connectionUsers(DBState.db, conn)
        const lines = [...effects]
        if (users.kind === 'presets') lines.push(...userLines(users.presets))
        else if (users.kind === 'models') lines.push(...userLines(users.models))
        else if (users.kind === 'provider') lines.push(fillLang(language.connectionsGlobalEffect, { provider: providerLabel(conn.provider) }))
        return {
            severity: 'danger',
            headline: fillLang(language.connectionsDeleteQ, { name: conn.name }),
            consequences: lines,
            actions: { cancel: language.cancel, primary: language.connectionsDelete },
        }
    }

    function trigger(): HTMLElement | null {
        return document.activeElement instanceof HTMLElement ? document.activeElement : null
    }

    function rename(id: string, name: string): { ok: boolean, duplicate: boolean } {
        return renameConnection(DBState.db, id, name)
    }

    function use(id: string): void {
        useProxyForCurrent(DBState.db, id)
    }

    // Marks the connection busy before the first await, so a second tap cannot start a second write.
    async function changeKey(id: string, run: () => Promise<{ ok: boolean }>): Promise<boolean> {
        if (busy.includes(id)) return false
        busy = [...busy, id]
        keyError = ''
        try {
            const result = await run()
            if (!result.ok) keyError = language.connectionsKeyWriteFailed
            return result.ok
        } finally {
            busy = busy.filter((entry) => entry !== id)
        }
    }

    function replace(id: string, plain: string): Promise<boolean> {
        return changeKey(id, () => replaceKey(DBState.db, id, plain))
    }

    function answerAsk(answer: PatternAnswer): void {
        const current = ask
        ask = null
        if (!current || answer !== 'confirm') return
        if (current.kind === 'clear') {
            void changeKey(current.id, () => clearKey(DBState.db, current.id))
            return
        }
        const conn = rows.find((item) => item.id === current.id)
        const removed = deleteConnection(DBState.db, current.id)
        if (removed === null) return
        void closeSub()
        postUndoToast({
            text: fillLang(language.connectionsDeleted, { name: conn?.name ?? removed.snapshot.name }),
            actionLabel: language.uiCommon.undo,
            action: connectionUndoAction(removed, {
                restored: language.connectionsRestored,
                refused: language.connectionsUndoRefused,
                failed: language.connectionsUndoFailed,
            }),
        })
    }

    function dismiss(): void {
        dismissNotice()
        dismissed = true
    }

    function background(): HTMLElement[] {
        return rootEl ? [rootEl] : []
    }
</script>

<div class="flex flex-col gap-3 min-w-0" data-part="settings-connections-root" bind:this={rootEl}>
    {#key subKey}
        <div class="connections-view flex flex-col gap-3 min-w-0" data-part="settings-connections-view">
            {#if sub === null}
                <div class="flex items-center gap-2">
                    <button
                        type="button"
                        class="inline-flex items-center gap-2 min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected risu-focus-ring"
                        data-part="settings-connection-add-open"
                        bind:this={addButton}
                        onclick={() => { sub = { kind: 'add' } }}
                    >
                        <PlusIcon size={18} aria-hidden="true" />
                        <span>{language.connectionsAdd}</span>
                    </button>
                </div>
                {#if showNotice}
                    <section class="flex flex-col gap-2 p-3 rounded-md border border-darkborderc bg-darkbg" data-part="settings-connection-notice">
                        <h2 class="font-semibold text-textcolor">{language.connectionsRenameNoticeTitle}</h2>
                        <p class="text-sm text-textcolor2">{language.connectionsRenameNoticeBody}</p>
                        <ul class="flex flex-wrap gap-2 list-none p-0 m-0">
                            {#each noticeList as conn (conn.id)}
                                <li>
                                    <button
                                        type="button"
                                        class="min-h-11 px-3 rounded-md bg-darkbutton text-textcolor hover:bg-selected risu-focus-ring"
                                        onclick={() => openDetail(conn.id)}
                                    >{conn.name}</button>
                                </li>
                            {/each}
                        </ul>
                        <button
                            type="button"
                            class="self-start min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected risu-focus-ring"
                            data-part="settings-connection-notice-dismiss"
                            onclick={dismiss}
                        >{language.connectionsRenameNoticeDismiss}</button>
                    </section>
                {/if}
                {#if rows.length === 0}
                    <p class="text-textcolor2" data-part="settings-connections-empty">{language.connectionsEmpty}</p>
                {:else}
                    <ul class="grid grid-cols-1 gap-2 list-none p-0 m-0" data-part="settings-connections-list">
                        {#each rows as conn (conn.id)}
                            <ConnectionCard
                                {conn}
                                hint={connectionKeyHint(conn)}
                                users={connectionUsers(DBState.db, conn)}
                                needsKey={needsKey.has(conn.id)}
                                onopen={() => openDetail(conn.id)}
                            />
                        {/each}
                    </ul>
                {/if}
            {:else if sub.kind === 'add'}
                <ConnectionAddFlow onclose={() => { void closeSub() }} />
            {:else if detailConn}
                <ConnectionDetail
                    conn={detailConn}
                    hint={connectionKeyHint(detailConn)}
                    users={connectionUsers(DBState.db, detailConn)}
                    needsKey={needsKey.has(detailConn.id)}
                    pending={busy.includes(detailConn.id)}
                    error={keyError}
                    onrename={(name) => rename(detailConn.id, name)}
                    onreplace={(plain) => replace(detailConn.id, plain)}
                    onclear={(el) => { ask = { kind: 'clear', id: detailConn.id, trigger: el ?? trigger() } }}
                    onuse={() => use(detailConn.id)}
                    models={ownsCustomModels(DBState.db, detailConn.id) ? customModelsUnder(DBState.db, detailConn.id) : null}
                    onaddmodel={() => { addCustomModelUnder(DBState.db, detailConn.id) }}
                    oneditmodel={(id, patch) => { editCustomModelUnder(DBState.db, detailConn.id, id, patch) }}
                    onremovemodel={(id) => { removeCustomModelUnder(DBState.db, detailConn.id, id) }}
                    ondelete={(el) => { ask = { kind: 'delete', id: detailConn.id, trigger: el ?? trigger() } }}
                />
            {/if}
        </div>
    {/key}
</div>

{#if ask}
    {@const def = askDef(ask)}
    {#if def}
        <PatternWarning {def} trigger={ask.trigger} background={background()} onanswer={answerAsk} />
    {/if}
{/if}

<style>
    /* Only opacity animates, so reduced motion needs no separate path. */
    .connections-view {
        animation: connections-fade 120ms linear;
    }
    @keyframes connections-fade {
        from { opacity: 0; }
        to { opacity: 1; }
    }
</style>
