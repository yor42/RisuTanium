// @vitest-environment jsdom
/**
 * The regex pane and its item editor over the real history service on the memory doubles and the real English `language`.
 * MOCKED: the page store (DBState is a `$state` object, so the pane re-renders from live writes), the save-mark counter and
 * the alert layer (the Help button opens it). Entries are built like the producers write them: the classic add shape, the
 * shape `RegexData` writes and an upstream entry with an unknown stage and key; every write is made by the pane itself.
 */
import { flushSync } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0, saveAsset: vi.fn() }))
vi.mock('src/ts/alert', () => ({ alertMd: vi.fn() }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: { characters: [], modules: [] } as unknown })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        ReloadGUIPointer: writable(0),
        selectedCharID: writable(0),
    }
})

import { language } from 'src/lang'
import { DBState, ReloadGUIPointer } from 'src/ts/stores.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey } from '../../ts/studio/history/ownerPhase'
import { setStudioHistoryServiceForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { makeCharacter } from '../../ts/studio/history/tests/objService.test-helpers'
import { studioScreen } from '../../ts/studio/studioScreen.svelte'
import { changeTo, click, mountInto, part, parts, settle, setupRig, teardownRig, typeInto } from './StudioLorePane.rig.test-helpers'
import StudioRegexPane from './StudioRegexPane.svelte'

type Entry = Record<string, unknown>

const A = characterOwnerKey('A')
const M1 = moduleOwnerKey('M1')

// The classic add shape, the shape `RegexData` writes, and an upstream entry whose stage and key this app does not know.
const addShape = (comment: string): Entry => ({ comment, in: 'find-' + comment, out: 'out-' + comment, type: 'editinput' })
const classicShape = (comment: string, flag: string, ableFlag: boolean): Entry => ({ comment, in: 'find-' + comment, out: 'out-' + comment, type: 'editoutput', flag, ableFlag })
const upstreamShape = (): Entry => ({ comment: 'up', in: 'a', out: 'b', type: 'edit_future', x_future: { a: 1 } })

let service: OwnerHistoryService

async function start(host: 'character' | 'module', list: unknown): Promise<void> {
    DBState.db = (host === 'character'
        ? { characters: [makeCharacter({ customscript: list } as never)], modules: [] }
        : { characters: [makeCharacter()], modules: [{ id: 'M1', name: 'M1', assets: [], regex: list }] }) as unknown as typeof DBState.db
    service = createOwnerHistoryService({
        store: createMemoryStudioStore({}),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        openModuleId: () => 'M1',
    })
    service.setModuleAck('M1', { noteEdit: () => {} })
    setStudioHistoryServiceForTests(service)
    await service.whenReady(A)
    await service.whenReady(M1)
}

async function mountRegex(host: 'character' | 'module'): Promise<HTMLElement> {
    const props: Record<string, unknown> = host === 'character'
        ? { ownerType: 'character', ownerId: 'A', chaId: 'A', moduleId: null, moduleSlotIndex: null }
        : { ownerType: 'module', ownerId: 'M1', chaId: 'A', moduleId: 'M1', moduleSlotIndex: 0 }
    Object.defineProperty(props, 'itemId', { enumerable: true, get: () => studioScreen.selectedItemId })
    studioScreen.selectedOwnerKey = host === 'character' ? 'character:A' : 'module:M1'
    studioScreen.selectedKind = 'regex'
    const mounted = mountInto(StudioRegexPane, props)
    await settle()
    return mounted
}

const liveList = (host: 'character' | 'module'): Entry[] => host === 'character'
    ? (DBState.db.characters as unknown as { customscript: Entry[] }[])[0].customscript
    : (DBState.db.modules as unknown as { regex: Entry[] }[])[0].regex
const ownerOf = (host: 'character' | 'module') => host === 'character' ? A : M1
const doneOf = (host: 'character' | 'module') => service.view(ownerOf(host)).done

async function openRow(index: number): Promise<void> {
    const button = document.querySelector<HTMLElement>(`[data-part="studio-regex-row"][data-index="${index}"]`)
    await click(button)
}

const byTestId = <T extends HTMLElement>(id: string): T => {
    const found = document.querySelector<T>(`[data-testid="${id}"]`)
    if (found === null) throw new Error(`no element with data-testid ${id}`)
    return found
}
const area = (name: string): HTMLTextAreaElement => {
    const found = part(name)
    if (!(found instanceof HTMLTextAreaElement)) throw new Error(`no textarea ${name}`)
    return found
}

beforeEach(() => {
    setupRig()
    ReloadGUIPointer.set(0)
})
afterEach(async () => {
    await teardownRig()
})

const HOSTS = ['character', 'module'] as const

describe('T1: the editable form', () => {
    test.each(HOSTS)('a live %s regex item opens the form with its find and replace text', async (host) => {
        await start(host, [addShape('one'), classicShape('two', 'g', false)])
        await mountRegex(host)
        expect(parts('studio-regex-row')).toHaveLength(2)
        await openRow(1)
        expect(part('studio-regex-form')).not.toBeNull()
        expect(document.querySelector('[data-testid="studio-regex-find"] textarea')).not.toBeNull()
        expect(area('studio-regex-find').value).toBe('find-two')
        expect(area('studio-regex-replace').value).toBe('out-two')
        expect(byTestId<HTMLInputElement>('studio-regex-name').value).toBe('two')
        expect(byTestId<HTMLSelectElement>('studio-regex-stage').value).toBe('editoutput')
        expect(byTestId<HTMLInputElement>('studio-regex-able-flag').checked).toBe(false)
    })

    test('an empty list shows No Scripts, and the heading carries the help', async () => {
        await start('character', [])
        await mountRegex('character')
        expect(part('studio-regex-empty')?.textContent).toBe(language.sidebarUi.noScripts)
        expect(part('studio-regex-heading')?.textContent).toContain(language.regexScript)
    })

    test('an absent list reads as empty', async () => {
        await start('character', undefined)
        await mountRegex('character')
        expect(part('studio-regex-empty')).not.toBeNull()
    })
})

describe('T3: looking writes nothing', () => {
    test.each(HOSTS)('opening, focusing and blurring every control of a %s regex leaves the data and the history as they were', async (host) => {
        await start(host, [classicShape('flagged', 'g<foo>', true)])
        await mountRegex(host)
        const before = JSON.stringify(liveList(host))
        await openRow(0)
        const controls = [
            byTestId('studio-regex-name'),
            byTestId('studio-regex-stage'),
            area('studio-regex-find'),
            area('studio-regex-replace'),
            byTestId('studio-regex-able-flag'),
            byTestId('studio-regex-order'),
            byTestId('studio-regex-chip-g'),
            byTestId('studio-regex-chip-move_top'),
        ]
        for (const control of controls) {
            control.focus()
            control.dispatchEvent(new FocusEvent('focus'))
            control.dispatchEvent(new FocusEvent('blur'))
            control.blur()
            flushSync()
        }
        await settle()
        expect(JSON.stringify(liveList(host))).toBe(before)
        expect(doneOf(host)).toHaveLength(0)
        expect(get(ReloadGUIPointer)).toBe(0)
    })
})

describe('T5: an unknown stage', () => {
    test('shows Other: <value> and writes nothing until a pick; Disabled writes only the stage', async () => {
        await start('character', [upstreamShape()])
        await mountRegex('character')
        const before = JSON.stringify(liveList('character'))
        await openRow(0)
        const select = byTestId<HTMLSelectElement>('studio-regex-stage')
        expect(select.value).toBe('edit_future')
        expect(select.selectedOptions[0].textContent).toBe(language.studioRegexStageOther('edit_future'))
        select.focus()
        select.blur()
        await settle()
        expect(JSON.stringify(liveList('character'))).toBe(before)
        expect(doneOf('character')).toHaveLength(0)

        changeTo(select, 'disabled')
        await settle()
        expect(liveList('character')[0]).toEqual({ ...upstreamShape(), type: 'disabled' })
        expect(doneOf('character')).toHaveLength(1)
    })
})

describe('T6 through the UI: flag chips and the order input', () => {
    test('each control writes the whole flag text, one step per chip', async () => {
        await start('character', [classicShape('f', 'g', true)])
        await mountRegex('character')
        await openRow(0)
        const flag = (): unknown => liveList('character')[0].flag

        await click(byTestId('studio-regex-chip-i'))
        expect(flag()).toBe('gi')
        await click(byTestId('studio-regex-chip-move_top'))
        expect(flag()).toBe('gi<move_top>')
        expect(doneOf('character')).toHaveLength(2)

        const order = byTestId<HTMLInputElement>('studio-regex-order')
        typeInto(order, '5')
        await settle()
        expect(flag()).toBe('<order 5>gi<move_top>')
        typeInto(order, '-2')
        await settle()
        expect(flag()).toBe('<order -2>gi<move_top>')
        changeTo(order, '')
        await settle()
        expect(flag()).toBe('gi<move_top>')

        await click(byTestId('studio-regex-chip-g'))
        expect(flag()).toBe('i<move_top>')
        await click(byTestId('studio-regex-chip-move_top'))
        expect(flag()).toBe('i')
    })

    test('unknown flag tokens are kept and named', async () => {
        await start('character', [classicShape('f', 'g<foo>', true)])
        await mountRegex('character')
        await openRow(0)
        expect(part('studio-regex-flags-kept')?.textContent).toBe(language.studioRegexFlagsKept('foo'))
        await click(byTestId('studio-regex-chip-i'))
        expect(liveList('character')[0].flag).toBe('g<foo>i')
    })

    test('the custom-flags switch on gives an empty flag the default g, off keeps the text, and the chips show only while on', async () => {
        await start('character', [classicShape('f', '', false)])
        await mountRegex('character')
        await openRow(0)
        expect(part('studio-regex-flags')).toBeNull()
        await click(byTestId('studio-regex-able-flag'))
        expect(liveList('character')[0]).toMatchObject({ ableFlag: true, flag: 'g' })
        expect(part('studio-regex-flags')).not.toBeNull()
        await click(byTestId('studio-regex-able-flag'))
        expect(liveList('character')[0]).toMatchObject({ ableFlag: false, flag: 'g' })
        expect(part('studio-regex-flags')).toBeNull()
    })
})

describe('T35 (UI): unreadable and inert rows', () => {
    test('show their reason and no control, while the readable rows still edit', async () => {
        const list: unknown[] = [{ comment: 'x', in: 123, out: '', type: 'editinput' }, { foo: 1 }, null, 'text', addShape('good')]
        await start('character', list)
        await mountRegex('character')
        const unreadable = parts('studio-regex-unreadable')
        expect(unreadable).toHaveLength(4)
        for (const entry of unreadable) {
            expect(entry.textContent).toContain('Unreadable entry')
            expect(entry.querySelector('input, select, textarea, button')).toBeNull()
        }
        // The row menu sits beside the entry, not inside it: every unreadable and inert row has one.
        expect(parts('studio-regex-row-menu')).toHaveLength(5)
        expect(unreadable[0].textContent).toContain('x')
        expect(unreadable[0].textContent).toContain(language.studioRegexWhyField('in'))
        expect(unreadable[2].textContent).toContain(language.studioRegexWhyNotObject)
        expect(parts('studio-regex-row')).toHaveLength(1)

        await openRow(4)
        typeInto(byTestId<HTMLInputElement>('studio-regex-name'), 'renamed')
        await settle()
        expect(liveList('character')[4].comment).toBe('renamed')
        expect(liveList('character').slice(0, 4)).toEqual(list.slice(0, 4))
    })

    test('Remove on an inert row writes one step and the list shrinks; undo restores it', async () => {
        const list: unknown[] = [addShape('a'), null, 'text', addShape('b')]
        await start('character', list)
        await mountRegex('character')
        await click(parts('studio-regex-row-menu')[1])
        await click(part('studio-regex-delete'))
        expect(liveList('character')).toEqual([list[0], 'text', list[3]])
        expect(parts('studio-regex-unreadable')).toHaveLength(1)
        expect(doneOf('character')).toHaveLength(1)
        expect(service.undo(ownerOf('character'))).toEqual({ ok: true })
        expect(liveList('character')).toEqual(list)
    })
})

describe('T36 (UI): a list that is not JSON-safe', () => {
    test('shows the notice and the classic link and no control', async () => {
        await start('character', [{ ...addShape('nan'), x_future: Number.NaN }])
        await mountRegex('character')
        expect(part('studio-regex-not-editable')?.textContent).toBe(language.studioRegexListNotEditable)
        expect(part('studio-regex-classic')).not.toBeNull()
        expect(part('studio-regex-row')).toBeNull()
        expect(document.querySelector('input, select, textarea')).toBeNull()
        expect(document.querySelectorAll('button[data-part]:not([data-part="studio-regex-classic"])')).toHaveLength(0)
    })

    test('a stored value that is not a list shows the same notice', async () => {
        await start('character', 'not a list')
        await mountRegex('character')
        expect(part('studio-regex-not-editable')).not.toBeNull()
        expect(part('studio-regex-classic')).not.toBeNull()
    })
})

describe('D5: the order chip and the order note', () => {
    test('show only for a row with custom flags on and an order meta', async () => {
        await start('character', [classicShape('on', '<order 3>g', true), classicShape('off', '<order 4>g', false)])
        await mountRegex('character')
        expect(parts('studio-regex-order-chip')).toHaveLength(1)
        expect(parts('studio-regex-order-chip')[0].textContent).toContain('3')
        expect(part('studio-regex-order-note')?.textContent).toBe(language.studioRegexOrderNote)
    })

    test('no row with an order shows neither', async () => {
        await start('character', [classicShape('plain', 'g', true)])
        await mountRegex('character')
        expect(part('studio-regex-order-chip')).toBeNull()
        expect(part('studio-regex-order-note')).toBeNull()
    })
})

describe('T-D4: the chat refresh after a closed step', () => {
    test('a landed name edit bumps the pointer once when the field closes, and typing alone bumps none', async () => {
        await start('character', [addShape('one')])
        await mountRegex('character')
        await openRow(0)
        const name = byTestId<HTMLInputElement>('studio-regex-name')
        typeInto(name, 'o')
        typeInto(name, 'on')
        typeInto(name, 'ona')
        await settle()
        expect(liveList('character')[0].comment).toBe('ona')
        expect(get(ReloadGUIPointer)).toBe(0)
        name.dispatchEvent(new FocusEvent('blur'))
        flushSync()
        expect(get(ReloadGUIPointer)).toBe(1)
        name.dispatchEvent(new FocusEvent('blur'))
        flushSync()
        expect(get(ReloadGUIPointer)).toBe(1)
    })

    test('a stage pick bumps once, a find edit never', async () => {
        await start('character', [addShape('one')])
        await mountRegex('character')
        await openRow(0)
        changeTo(byTestId<HTMLSelectElement>('studio-regex-stage'), 'editdisplay')
        await settle()
        expect(get(ReloadGUIPointer)).toBe(1)
        const find = area('studio-regex-find')
        find.value = 'changed find'
        find.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'x', inputType: 'insertText' }))
        find.dispatchEvent(new FocusEvent('blur'))
        await settle()
        expect(liveList('character')[0].in).toBe('changed find')
        expect(get(ReloadGUIPointer)).toBe(1)
    })

    test('a replace edit bumps once when the field closes', async () => {
        await start('character', [addShape('one')])
        await mountRegex('character')
        await openRow(0)
        const out = area('studio-regex-replace')
        out.value = 'new out'
        out.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'x', inputType: 'insertText' }))
        await settle()
        expect(liveList('character')[0].out).toBe('new out')
        expect(get(ReloadGUIPointer)).toBe(0)
        out.dispatchEvent(new FocusEvent('blur'))
        await settle()
        expect(get(ReloadGUIPointer)).toBe(1)
    })

    test('a refused name edit bumps none', async () => {
        await start('character', [addShape('one')])
        await mountRegex('character')
        await openRow(0)
        const name = byTestId<HTMLInputElement>('studio-regex-name')
        // The row's name moves under the editor before the form has seen it: the build refuses to rename the wrong value.
        liveList('character')[0].comment = 'moved'
        typeInto(name, 'typed')
        await settle()
        expect(liveList('character')[0].comment).toBe('moved')
        expect(doneOf('character')).toHaveLength(0)
        name.dispatchEvent(new FocusEvent('blur'))
        await settle()
        expect(get(ReloadGUIPointer)).toBe(0)
    })
})
