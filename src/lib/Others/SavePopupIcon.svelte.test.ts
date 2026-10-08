// @vitest-environment happy-dom

/**
 * MC-078, MC-079, MC-082. `SavePopupIcon.svelte` shows a persistent
 * indicator while any chaId is frozen against a save-file rewrite, following
 * `savingStoppedReason`'s own branch order: `savingStoppedReason` wins over
 * the duplicate-id indicator, which in turn sits before the ordinary saving
 * animation so a save in progress does not make the indicator flicker off.
 * Mount pattern follows `GridCatalog.duplicateChaId.svelte.test.ts` (same
 * directory).
 *
 * It also says, in its own words for each reason the save loop can stop for,
 * why saving stopped, and says that a page which runs from OPFS this time
 * does not save at all.
 *
 * MOCKED: `src/ts/globalApi.svelte` (`saving` and the stop detail) and a
 * reactive `stores.svelte` stand-in. `src/lang` is real (a plain data module,
 * no side effects).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { FrozenSaveKeyInfo } from '../../ts/stores.svelte'
import { NODE_BODY_LIMIT_BYTES } from 'src/ts/storage/nodeBodyLimit'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { heldSaveStore } from 'src/ts/storage/saveHold'

//#region module mocks

const stopDetail = vi.hoisted(() => ({ value: '' }))

vi.mock(import('src/ts/globalApi.svelte'), () => {
    const saving = $state({ state: false })
    return { saving, getSavingStoppedDetail: () => stopDetail.value } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        savingStoppedReason: writable(''),
        frozenSaveKeysStore: writable<FrozenSaveKeyInfo[]>([]),
    } as unknown as typeof import('../../ts/stores.svelte')
})

const { alertMdSpy, alertNormalSpy } = vi.hoisted(() => ({
    alertMdSpy: vi.fn(),
    alertNormalSpy: vi.fn(),
}))

vi.mock(
    import('src/ts/alert'),
    () =>
        ({
            alertMd: alertMdSpy,
            alertNormal: alertNormalSpy,
        }) as unknown as typeof import('src/ts/alert'),
)

//#endregion

import { DBState, savingStoppedReason as savingStoppedReasonStore, frozenSaveKeysStore as frozenSaveKeysStoreMock } from '../../ts/stores.svelte'
import { saving } from 'src/ts/globalApi.svelte'
import { language } from '../../lang'
import SavePopupIcon from './SavePopupIcon.svelte'

function mountIcon(): { target: HTMLElement; app: Record<string, unknown> } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(SavePopupIcon, { target, props: {} }) as unknown as Record<string, unknown>
    return { target, app }
}

async function teardown(target: HTMLElement, app: Record<string, unknown>): Promise<void> {
    await unmount(app as never)
    target.remove()
}

beforeEach(() => {
    saving.state = false
    savingStoppedReasonStore.set('')
    frozenSaveKeysStoreMock.set([])
    heldSaveStore.set([])
    DBState.db = {} as unknown as Database
    alertMdSpy.mockReset()
    alertNormalSpy.mockReset()
    stopDetail.value = ''
    resetPageStorageModeForTests()
})

describe('SavePopupIcon shows nothing when nothing is wrong', () => {
    test('no button is rendered', async () => {
        const { target, app } = mountIcon()
        flushSync()
        expect(target.querySelector('button')).toBeNull()
        await teardown(target, app)
    })
})

describe('SavePopupIcon -- the read-only page and the stop reasons of the block store', () => {
    test('a page that runs from OPFS this time shows a button that says it does not save', async () => {
        setPageStorageMode({ kind: 'read-only' })
        const { target, app } = mountIcon()
        flushSync()

        const button = target.querySelector('button')
        expect(button).not.toBeNull()
        button!.click()
        flushSync()

        expect(alertNormalSpy).toHaveBeenCalledTimes(1)
        expect(alertNormalSpy.mock.calls[0][0]).toBe(language.opfsReadOnlyNotice)

        await teardown(target, app)
    })

    test('a page whose mode becomes read-only after the icon was created shows the button then', async () => {
        const { target, app } = mountIcon()
        flushSync()
        expect(target.querySelector('button')).toBeNull()

        setPageStorageMode({ kind: 'read-only' })
        flushSync()

        const button = target.querySelector('button')
        expect(button).not.toBeNull()
        button!.click()
        expect(alertNormalSpy.mock.calls[0][0]).toBe(language.opfsReadOnlyNotice)

        await teardown(target, app)
    })

    test.each([
        ['node-conflict', () => language.savingStoppedNodeConflictMessage],
        ['stay', () => language.savingStoppedStayMessage],
        ['replaced', () => language.savingStoppedReplacedMessage],
        ['conversion-failed', () => language.savingStoppedConversionFailedMessage],
        ['unconfirmed', () => language.savingStoppedUnconfirmedMessage],
    ])('says its own words for the stop reason %s', async (reason, expected) => {
        setPageStorageMode({ kind: 'block' })
        savingStoppedReasonStore.set(reason)
        const { target, app } = mountIcon()
        flushSync()

        target.querySelector('button')!.click()
        flushSync()

        expect(alertNormalSpy).toHaveBeenCalledTimes(1)
        expect(alertNormalSpy.mock.calls[0][0]).toBe(expected())

        await teardown(target, app)
    })

    test('names the part of the data that was too large when saving stopped for size, and does not advise archiving', async () => {
        setPageStorageMode({ kind: 'block' })
        stopDetail.value = '"Alice"'
        savingStoppedReasonStore.set('too-large')
        const { target, app } = mountIcon()
        flushSync()

        target.querySelector('button')!.click()
        flushSync()

        const message = alertNormalSpy.mock.calls[0][0] as string
        expect(message).toBe(language.savingStoppedTooLargeBlockMessage('"Alice"', NODE_BODY_LIMIT_BYTES))
        expect(message).toContain('"Alice"')
        expect(message).not.toMatch(/archiv/i)

        await teardown(target, app)
    })

    test('an internal block name is never shown: each is put into plain words', () => {
        for (const name of ['root', 'preset', 'modules', 'loadouts', 'plugins', 'pluginStorage', 'config', 'stubs']) {
            const words = language.saveBlockLabel(name)
            expect(words, name).not.toBe(name)
            expect(words, name).not.toContain(`"${name}"`)
            expect(words.startsWith('"'), name).toBe(false)
        }
    })

    test('the too-large message reads grammatically for a plural label and for a character\'s name', () => {
        const plural = language.savingStoppedTooLargeBlockMessage(language.saveBlockLabel('preset'), NODE_BODY_LIMIT_BYTES)
        expect(plural).toContain('this part of your data is over that: your bot presets.')
        expect(plural).not.toContain('presets is')
        const character = language.savingStoppedTooLargeBlockMessage('"Alice"', NODE_BODY_LIMIT_BYTES)
        expect(character).toContain('this part of your data is over that: "Alice".')
        expect(language.savingStoppedTooLargeBlockMessage('', NODE_BODY_LIMIT_BYTES)).toContain('and part of your data is over that; the server did not say which part.')
    })

    test('the snapshot-skipped notice advises exporting a .bin by the label the person sees', () => {
        expect(language.saveSnapshotSkippedTooLarge).toContain('.bin')
        expect(language.saveSnapshotSkippedTooLarge).toContain(language.saveBackupLocal)
        expect(language.saveSnapshotSkippedTooLarge).toContain(language.backupAndFiles)
    })

    test('every stop reason has words of its own', () => {
        const texts = [
            language.savingStoppedNodeConflictMessage,
            language.savingStoppedStayMessage,
            language.savingStoppedReplacedMessage,
            language.savingStoppedConversionFailedMessage,
            language.savingStoppedUnconfirmedMessage,
            language.savingStoppedTooLargeBlockMessage('x', NODE_BODY_LIMIT_BYTES),
        ]
        expect(new Set(texts).size).toBe(texts.length)
    })
})

describe('SavePopupIcon -- the duplicate-chaId indicator (MC-078, MC-079, MC-082)', () => {
    test('shows the indicator while a chaId is frozen, and clicking it reports the paused names', async () => {
        frozenSaveKeysStoreMock.set([{ chaId: 'dup-1', names: ['A', 'B'] }])
        const { target, app } = mountIcon()
        flushSync()

        const button = target.querySelector('button')
        expect(button).not.toBeNull()
        button!.click()
        flushSync()

        expect(alertNormalSpy).toHaveBeenCalledTimes(1)
        expect(alertNormalSpy.mock.calls[0][0]).toBe(language.duplicateChaIdSavePausedMessage('A and B'))

        await teardown(target, app)
    })

    test('two frozen ids are reported as separate groups, joined by "; "', async () => {
        frozenSaveKeysStoreMock.set([
            { chaId: 'dup-1', names: ['A', 'B'] },
            { chaId: 'dup-2', names: ['C', 'D'] },
        ])
        const { target, app } = mountIcon()
        flushSync()

        const button = target.querySelector('button')
        expect(button).not.toBeNull()
        button!.click()
        flushSync()

        expect(alertNormalSpy).toHaveBeenCalledTimes(1)
        expect(alertNormalSpy.mock.calls[0][0]).toBe(language.duplicateChaIdSavePausedMessage('A and B; C and D'))

        await teardown(target, app)
    })

    test('clears once no chaId is frozen', async () => {
        frozenSaveKeysStoreMock.set([{ chaId: 'dup-1', names: ['A', 'B'] }])
        const { target, app } = mountIcon()
        flushSync()
        expect(target.querySelector('button')).not.toBeNull()

        frozenSaveKeysStoreMock.set([])
        flushSync()
        expect(target.querySelector('button')).toBeNull()

        await teardown(target, app)
    })

    test('savingStoppedReason wins over the duplicate-chaId indicator', async () => {
        savingStoppedReasonStore.set('stay')
        frozenSaveKeysStoreMock.set([{ chaId: 'dup-1', names: ['A', 'B'] }])
        const { target, app } = mountIcon()
        flushSync()

        const buttons = target.querySelectorAll('button')
        expect(buttons.length).toBe(1)
        buttons[0].click()
        flushSync()

        // savingStoppedReason's own branch (alertNormal with the stay message),
        // not the duplicate-chaId message.
        expect(alertNormalSpy).toHaveBeenCalledTimes(1)
        expect(alertNormalSpy.mock.calls[0][0]).not.toBe(language.duplicateChaIdSavePausedMessage('A and B'))

        await teardown(target, app)
    })

    test('the duplicate-chaId indicator wins over the ordinary saving animation, so a save in progress does not hide it', async () => {
        DBState.db = { showSavingIcon: true } as unknown as Database
        saving.state = true
        frozenSaveKeysStoreMock.set([{ chaId: 'dup-1', names: ['A', 'B'] }])
        const { target, app } = mountIcon()
        flushSync()

        const buttons = target.querySelectorAll('button')
        expect(buttons.length).toBe(1)

        await teardown(target, app)
    })

    test('the ordinary saving animation still shows once no chaId is frozen and nothing else is wrong', async () => {
        DBState.db = { showSavingIcon: true } as unknown as Database
        saving.state = true
        const { target, app } = mountIcon()
        flushSync()

        expect(target.querySelector('button')).toBeNull()
        expect(target.textContent).toBe('')
        expect(target.querySelector('div.saving-animation')).not.toBeNull()

        await teardown(target, app)
    })
})

describe('SavePopupIcon -- saving waits on a character whose id cannot be saved', () => {
    test('shows the indicator, names the character and says how to clear it; an archived character also gets the backup route', async () => {
        heldSaveStore.set([{ name: 'Alice', kind: 'unusable-id', archived: false }])
        const { target, app } = mountIcon()
        flushSync()
        target.querySelector('button')!.click()
        flushSync()
        expect(alertNormalSpy).toHaveBeenCalledTimes(1)
        expect(alertNormalSpy.mock.calls[0][0]).toBe(language.savingHeldMessage('Alice', false))
        expect(language.savingHeldMessage('Alice', false)).toContain('delete the character permanently')
        expect(language.savingHeldMessage('Alice', false)).not.toContain('export a backup')
        expect(language.savingHeldMessage('Alice', true)).toContain('export a backup and restore it')

        await teardown(target, app)
    })

    test('a character the loop keeps discarding is shown as waiting, and the indicator clears with the store', async () => {
        heldSaveStore.set([{ name: 'Bob', kind: 'waiting', archived: false }])
        const { target, app } = mountIcon()
        flushSync()
        target.querySelector('button')!.click()
        expect(alertNormalSpy.mock.calls[0][0]).toBe(language.savingWaitingMessage('Bob'))

        heldSaveStore.set([])
        flushSync()
        expect(target.querySelector('button')).toBeNull()

        await teardown(target, app)
    })

    test('savingStoppedReason wins over the wait, and the wait wins over the ordinary saving animation', async () => {
        heldSaveStore.set([{ name: 'Alice', kind: 'unusable-id', archived: false }])
        savingStoppedReasonStore.set('invalid-data')
        stopDetail.value = 'your modules'
        const { target, app } = mountIcon()
        flushSync()
        target.querySelector('button')!.click()
        expect(alertNormalSpy.mock.calls[0][0]).toBe(language.savingStoppedInvalidDataMessage('your modules'))

        savingStoppedReasonStore.set('')
        DBState.db = { showSavingIcon: true } as unknown as Database
        saving.state = true
        flushSync()
        expect(target.querySelectorAll('button').length).toBe(1)

        await teardown(target, app)
    })
})
