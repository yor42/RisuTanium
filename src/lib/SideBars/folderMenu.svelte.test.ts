// @vitest-environment happy-dom

/**
 * The folder menu module, driven with a spy host. The sidebar order operations, the folder colour
 * list and the language are REAL. MOCKED: `checkCharOrder` (so a repair made by the module itself
 * is visible; a host spy cannot see it), `beginBusy` (so `busy.end()` is observable), `saveAsset`,
 * `selectSingleFile`, `alertSelect`/`alertInput` (answers from a queue), `trashFolderMembers`, and
 * the character lookups (a character is visible unless it is flagged hidden).
 *
 * `DBState.db` is a plain object whose `characterOrder` setter records every assignment, so
 * "one write" means one assignment of the property, not one changed value.
 *
 * These are tests of new code, not regression reproducers: the rail suites cover the same paths
 * through the rendered rail. Their evidence is the mutation proof recorded in the lane D records, S4-5 stage 5a.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { Database, folder } from 'src/ts/storage/database.svelte'
import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { runFolderMenu, type FolderMenuHost, type FolderMenuTarget } from './folderMenu'

type TestCharacter = { chaId: string, name: string, trashTime?: number, hidden?: boolean }
type OrderEntry = string | folder
type OrderChange = Parameters<FolderMenuHost['applyOrderChange']>[0]

const { world, checkCharOrderSpy, saveAssetSpy, selectSingleFileSpy, trashSpy, busyHandles, answers, offers, inputs, onOffer } = vi.hoisted(() => ({
    world: { characters: [] as TestCharacter[] },
    checkCharOrderSpy: vi.fn(),
    saveAssetSpy: vi.fn(),
    selectSingleFileSpy: vi.fn(),
    trashSpy: vi.fn(),
    busyHandles: [] as Array<{ kind: string, end: ReturnType<typeof vi.fn> }>,
    answers: [] as string[],
    offers: [] as string[][],
    inputs: [] as string[],
    onOffer: { current: null as null | ((offered: string[]) => void) },
}))

vi.mock(import('src/ts/stores.svelte'), () => ({ DBState: { db: {} } }) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    checkCharOrder: checkCharOrderSpy,
    saveAsset: saveAssetSpy,
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/process/memory/busyActions'), () => ({
    beginBusy: vi.fn((kind: string) => {
        const handle = { kind, end: vi.fn() }
        busyHandles.push(handle)
        return handle
    }),
}) as unknown as typeof import('src/ts/process/memory/busyActions'))

vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: selectSingleFileSpy,
    getCharacterIndexObject: () => {
        const result: { [key: string]: number } = Object.create(null)
        world.characters.forEach((c, i) => { result[c.chaId] = i })
        return result
    },
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('../../ts/characters'), () => ({
    trashFolderMembers: trashSpy,
    untrashedMembersOf: (ids: readonly string[]) => {
        const wanted = new Set(ids)
        return world.characters.filter((c) => wanted.has(c.chaId) && !c.trashTime)
    },
    visibleCharacterIds: () => new Set(world.characters.filter((c) => !c.hidden).map((c) => c.chaId)),
}) as unknown as typeof import('../../ts/characters'))

vi.mock(import('src/ts/alert'), () => ({
    alertSelect: vi.fn(async (offered: string[]) => {
        offers.push([...offered])
        onOffer.current?.(offered)
        return answers.shift() ?? '99'
    }),
    alertInput: vi.fn(async () => inputs.shift() ?? ''),
}) as unknown as typeof import('src/ts/alert'))

const ch = (chaId: string, extra: Partial<TestCharacter> = {}): TestCharacter => ({ chaId, name: chaId, ...extra })
const fold = (id: string, data: string[], extra: Partial<folder> = {}): folder => ({ id, name: `name-${id}`, data, color: 'red', ...extra })
const targetOf = (id: string, occurrence = 0, name = `name-${id}`): FolderMenuTarget => ({ ref: { kind: 'folder', id, occurrence }, id, name })

function setupDb(order: OrderEntry[], characters: TestCharacter[]) {
    const writes: OrderEntry[][] = []
    let current = order
    world.characters = characters
    DBState.db = {
        characters,
        get characterOrder() {
            return current
        },
        set characterOrder(next: OrderEntry[]) {
            writes.push(next)
            current = next
        },
    } as unknown as Database
    return { writes, order: () => current }
}

// The rail's own host: assign, then repair.
function makeHost(extra: Partial<FolderMenuHost> = {}) {
    const applyOrderChange = vi.fn((change: OrderChange) => {
        const current = DBState.db.characterOrder
        const next = change(current)
        if (next === current) {
            return
        }
        DBState.db.characterOrder = next
        checkCharOrderSpy()
    })
    const closeFolder = vi.fn()
    const host: FolderMenuHost = { applyOrderChange, closeFolder, ...extra }
    return { host, applyOrderChange, closeFolder }
}

const deferred = <T>() => {
    let resolve!: (value: T) => void
    let reject!: (reason: Error) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

const flush = async () => {
    for (let i = 0; i < 20; i++) {
        await Promise.resolve()
    }
}

const picked = { name: 'a.png', data: new Uint8Array([1, 2, 3]) }
const characters = () => [ch('a'), ch('b'), ch('c')]

beforeEach(() => {
    answers.length = 0
    offers.length = 0
    inputs.length = 0
    onOffer.current = null
    busyHandles.length = 0
    for (const spy of [checkCharOrderSpy, saveAssetSpy, selectSingleFileSpy, trashSpy]) {
        spy.mockReset()
    }
    saveAssetSpy.mockResolvedValue('asset-1')
    selectSingleFileSpy.mockResolvedValue(picked)
})

const TOP = { rename: '0', colour: '1', picture: '2', ungroup: '3', del: '4', cancel: '5' }

describe('1. the offered lists', () => {
    test('the top list has the six items in order', async () => {
        setupDb([fold('f', ['a'])], characters())
        await runFolderMenu(targetOf('f'), makeHost().host)
        expect(offers[0]).toEqual([
            language.renameFolder, language.changeFolderColor, language.changeFolderImage,
            language.ungroupFolder, language.deleteFolder, language.cancel,
        ])
    })

    test('the picture list offers reset and then file; the colour list is the folder colour labels', async () => {
        setupDb([fold('f', ['a'])], characters())
        answers.push(TOP.picture, '9')
        await runFolderMenu(targetOf('f'), makeHost().host)
        expect(offers[1]).toEqual([language.alerts.resetToDefaultImage, language.alerts.selectImageFile])
        answers.push(TOP.colour)
        await runFolderMenu(targetOf('f'), makeHost().host)
        expect(offers[3]).toHaveLength(8)
        expect(offers[3][0]).toBe(language.sidebarUi.folderColorRed)
    })
})

describe('2. each field edit is one plain assignment', () => {
    // [title, setup of answers, expected edit of the folder]
    const cases: Array<[string, () => void, Record<string, unknown>]> = [
        ['rename', () => { answers.push(TOP.rename); inputs.push('New name') }, { name: 'New name' }],
        ['colour', () => { answers.push(TOP.colour, '2') }, { color: 'blue' }],
        ['picture reset', () => { answers.push(TOP.picture, '0') }, { imgFile: null, img: '' }],
        ['picture file', () => { answers.push(TOP.picture, '1') }, { imgFile: 'asset-1', img: '' }],
    ]
    test.each(cases)('%s assigns characterOrder once and neither the host repair nor checkCharOrder runs', async (_title, arrange, expected) => {
        const db = setupDb([fold('f', ['a'], { imgFile: 'old' }), fold('g', ['b'])], characters())
        const { host, applyOrderChange, closeFolder } = makeHost()
        arrange()
        await runFolderMenu(targetOf('f'), host)
        expect(db.writes).toHaveLength(1)
        expect(db.order()[0]).toMatchObject(expected)
        expect(db.order()[1]).toEqual(fold('g', ['b']))
        expect(applyOrderChange).not.toHaveBeenCalled()
        expect(closeFolder).not.toHaveBeenCalled()
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
    })
})

describe('3. Ungroup', () => {
    test('assigns through the host once, repairs once and closes the folder by id once', async () => {
        const db = setupDb(['x', fold('f', ['a', 'b']), 'y'], characters())
        const { host, applyOrderChange, closeFolder } = makeHost()
        answers.push(TOP.ungroup)
        await runFolderMenu(targetOf('f'), host)
        expect(applyOrderChange).toHaveBeenCalledTimes(1)
        expect(db.writes).toHaveLength(1)
        expect(db.order()).toEqual(['x', 'a', 'b', 'y'])
        expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        expect(closeFolder).toHaveBeenCalledTimes(1)
        expect(closeFolder).toHaveBeenCalledWith('f')
    })

    test('a folder that is gone changes nothing and closes nothing', async () => {
        const db = setupDb(['x', fold('f', ['a'])], characters())
        const { host, closeFolder } = makeHost()
        answers.push(TOP.ungroup)
        await runFolderMenu(targetOf('f', 3), host)
        expect(db.writes).toHaveLength(0)
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
        expect(closeFolder).not.toHaveBeenCalled()
    })
})

describe('4. picture from a file', () => {
    test('the folder is written only after saveAsset resolves, and busy ends after it', async () => {
        const db = setupDb([fold('f', ['a'])], characters())
        const save = deferred<string>()
        saveAssetSpy.mockReturnValue(save.promise)
        answers.push(TOP.picture, '1')
        const done = runFolderMenu(targetOf('f'), makeHost().host)
        await flush()
        expect(saveAssetSpy).toHaveBeenCalledWith(picked.data)
        expect(busyHandles).toHaveLength(1)
        expect(busyHandles[0].kind).toBe('imageAdd')
        expect(db.writes).toHaveLength(0)
        expect(busyHandles[0].end).not.toHaveBeenCalled()
        save.resolve('asset-9')
        await done
        expect(db.writes).toHaveLength(1)
        expect(db.order()[0]).toMatchObject({ imgFile: 'asset-9', img: '' })
        expect(busyHandles[0].end).toHaveBeenCalledTimes(1)
    })

    test('a saveAsset rejection writes nothing, still ends busy and rejects the menu', async () => {
        const db = setupDb([fold('f', ['a'])], characters())
        saveAssetSpy.mockRejectedValue(new Error('disk full'))
        answers.push(TOP.picture, '1')
        await expect(runFolderMenu(targetOf('f'), makeHost().host)).rejects.toThrow('disk full')
        expect(db.writes).toHaveLength(0)
        expect(busyHandles).toHaveLength(1)
        expect(busyHandles[0].end).toHaveBeenCalledTimes(1)
    })

    test('a cancelled chooser saves no asset, starts no busy and writes nothing', async () => {
        const db = setupDb([fold('f', ['a'])], characters())
        selectSingleFileSpy.mockResolvedValue(null)
        answers.push(TOP.picture, '1')
        await runFolderMenu(targetOf('f'), makeHost().host)
        expect(selectSingleFileSpy).toHaveBeenCalledWith(['png', 'jpg', 'webp'])
        expect(saveAssetSpy).not.toHaveBeenCalled()
        expect(busyHandles).toHaveLength(0)
        expect(db.writes).toHaveLength(0)
    })

    test('a folder that vanished while the chooser was open has no asset saved for it', async () => {
        const db = setupDb([fold('f', ['a'])], characters())
        const picker = deferred<typeof picked>()
        selectSingleFileSpy.mockReturnValue(picker.promise)
        answers.push(TOP.picture, '1')
        const done = runFolderMenu(targetOf('f'), makeHost().host)
        await flush()
        db.order().length = 0
        picker.resolve(picked)
        await done
        expect(saveAssetSpy).not.toHaveBeenCalled()
        expect(busyHandles).toHaveLength(0)
        expect(db.writes).toHaveLength(0)
    })

    test('the folder is looked up again after saveAsset: one removed meanwhile is not written', async () => {
        const db = setupDb([fold('f', ['a'])], characters())
        const save = deferred<string>()
        saveAssetSpy.mockReturnValue(save.promise)
        answers.push(TOP.picture, '1')
        const done = runFolderMenu(targetOf('f'), makeHost().host)
        await flush()
        db.order().length = 0
        save.resolve('asset-9')
        await done
        expect(db.writes).toHaveLength(0)
        expect(busyHandles[0].end).toHaveBeenCalledTimes(1)
    })
})

describe('5. rename input', () => {
    // A cancelled dialog and a blank one both answer an empty string.
    test('a blank or cancelled rename dialog writes nothing', async () => {
        const db = setupDb([fold('f', ['a'])], characters())
        const wrap = vi.fn()
        answers.push(TOP.rename)
        inputs.push('')
        await runFolderMenu(targetOf('f'), makeHost({ wrapFieldWrite: wrap }).host)
        expect(db.writes).toHaveLength(0)
        expect(wrap).not.toHaveBeenCalled()
    })
})

describe('6. Delete', () => {
    const members = () => [ch('a'), ch('b', { hidden: true }), ch('c', { trashTime: 5 }), ch('d')]

    test('counts only visible untrashed members and offers Keep, Trash(count), Cancel', async () => {
        setupDb([fold('f', ['a', 'b', 'c', 'd'])], members())
        answers.push(TOP.del, '2')
        await runFolderMenu(targetOf('f'), makeHost().host)
        expect(offers[1]).toEqual([language.deleteFolderKeep, language.deleteFolderTrash(2), language.cancel])
        expect(trashSpy).not.toHaveBeenCalled()
    })

    test('with no visible untrashed member only Keep and Cancel are offered', async () => {
        setupDb([fold('f', ['b', 'c'])], members())
        answers.push(TOP.del, '1')
        await runFolderMenu(targetOf('f'), makeHost().host)
        expect(offers[1]).toEqual([language.deleteFolderKeep, language.cancel])
        expect(trashSpy).not.toHaveBeenCalled()
    })

    test('Keep gives the order Ungroup gives, closes the folder and never trashes', async () => {
        const db = setupDb(['x', fold('f', ['a', 'b'])], members())
        const { host, applyOrderChange, closeFolder } = makeHost()
        answers.push(TOP.del, '0')
        await runFolderMenu(targetOf('f'), host)
        expect(db.order()).toEqual(['x', 'a', 'b'])
        expect(applyOrderChange).toHaveBeenCalledTimes(1)
        expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        expect(closeFolder).toHaveBeenCalledWith('f')
        expect(trashSpy).not.toHaveBeenCalled()
    })

    test('Trash passes the order\'s own folder object and the name, and writes nothing itself', async () => {
        const db = setupDb([fold('f', ['a', 'd'])], members())
        const { host, applyOrderChange, closeFolder } = makeHost()
        answers.push(TOP.del, '1')
        await runFolderMenu(targetOf('f', 0, 'Shown name'), host)
        expect(trashSpy).toHaveBeenCalledTimes(1)
        expect(trashSpy.mock.calls[0][0]).toBe(db.order()[0])
        expect(trashSpy.mock.calls[0][1]).toBe('Shown name')
        expect(db.writes).toHaveLength(0)
        expect(applyOrderChange).not.toHaveBeenCalled()
        expect(closeFolder).not.toHaveBeenCalled()
    })

    test('Cancel and a vanished folder do nothing', async () => {
        const db = setupDb([fold('f', ['a'])], members())
        const { host, closeFolder } = makeHost()
        answers.push(TOP.del, '2')
        await runFolderMenu(targetOf('f'), host)
        answers.push(TOP.del)
        await runFolderMenu(targetOf('f', 4), host)
        expect(offers).toHaveLength(3)
        expect(db.writes).toHaveLength(0)
        expect(trashSpy).not.toHaveBeenCalled()
        expect(closeFolder).not.toHaveBeenCalled()
    })

    test('runFolderMenu stays pending until the trash settles', async () => {
        setupDb([fold('f', ['a', 'd'])], members())
        const trash = deferred<void>()
        trashSpy.mockReturnValue(trash.promise)
        let settled = false
        answers.push(TOP.del, '1')
        const done = runFolderMenu(targetOf('f'), makeHost().host).then(() => { settled = true })
        await flush()
        expect(trashSpy).toHaveBeenCalledTimes(1)
        expect(settled).toBe(false)
        trash.resolve()
        await done
        expect(settled).toBe(true)
    })

    test('the offered choices are fixed when the prompt opens: a member that becomes visible meanwhile does not turn Cancel into Trash', async () => {
        const db = setupDb([fold('f', ['b', 'c'])], members())
        const { host, closeFolder } = makeHost()
        // Keep and Cancel are the only choices offered, so '1' is Cancel.
        onOffer.current = () => {
            if (offers.length === 2) {
                world.characters[1].hidden = false
            }
        }
        answers.push(TOP.del, '1')
        await runFolderMenu(targetOf('f'), host)
        expect(offers[1]).toEqual([language.deleteFolderKeep, language.cancel])
        expect(world.characters[1].hidden).toBe(false)
        expect(trashSpy).not.toHaveBeenCalled()
        expect(db.writes).toHaveLength(0)
        expect(closeFolder).not.toHaveBeenCalled()
    })
})

describe('7. folders sharing an id', () => {
    const twinOrder = () => [fold('t', ['a']), fold('t', ['b'], { name: 'second' })]

    const edits: Array<[string, () => void]> = [
        ['rename', () => { answers.push(TOP.rename); inputs.push('x') }],
        ['colour', () => { answers.push(TOP.colour, '2') }],
        ['picture reset', () => { answers.push(TOP.picture, '0') }],
        ['picture file', () => { answers.push(TOP.picture, '1') }],
    ]
    test.each(edits)('%s is a silent no-op, saves no asset and reaches no hook', async (_title, arrange) => {
        const db = setupDb(twinOrder(), characters())
        const wrap = vi.fn()
        const { host, applyOrderChange } = makeHost({ wrapFieldWrite: wrap })
        arrange()
        await runFolderMenu(targetOf('t'), host)
        expect(db.writes).toHaveLength(0)
        expect(saveAssetSpy).not.toHaveBeenCalled()
        expect(busyHandles).toHaveLength(0)
        expect(wrap).not.toHaveBeenCalled()
        expect(applyOrderChange).not.toHaveBeenCalled()
    })

    test('Ungroup acts on the folder the menu was opened on and closes the shared id once', async () => {
        const db = setupDb(twinOrder(), characters())
        const { host, closeFolder } = makeHost()
        answers.push(TOP.ungroup)
        await runFolderMenu(targetOf('t', 1), host)
        expect(db.order()).toEqual([fold('t', ['a']), 'b'])
        expect(closeFolder).toHaveBeenCalledTimes(1)
        expect(closeFolder).toHaveBeenCalledWith('t')
    })

    test('Delete, Keep acts on the folder by reference; Trash passes that folder object', async () => {
        const db = setupDb(twinOrder(), characters())
        const { host } = makeHost()
        answers.push(TOP.del, '0')
        await runFolderMenu(targetOf('t', 1), host)
        expect(db.order()).toEqual([fold('t', ['a']), 'b'])
        const db2 = setupDb(twinOrder(), characters())
        answers.push(TOP.del, '1')
        await runFolderMenu(targetOf('t', 1), makeHost().host)
        expect(trashSpy.mock.calls[0][0]).toBe(db2.order()[1])
    })
})

describe('8. beforeFilePicker', () => {
    test('is called once, just before the chooser opens, on the choose-file path only', async () => {
        setupDb([fold('f', ['a'])], characters())
        const log: string[] = []
        const beforeFilePicker = vi.fn(() => { log.push('before') })
        selectSingleFileSpy.mockImplementation(async () => {
            log.push('picker')
            return picked
        })
        answers.push(TOP.picture, '1')
        await runFolderMenu(targetOf('f'), makeHost({ beforeFilePicker }).host)
        expect(log).toEqual(['before', 'picker'])
        expect(beforeFilePicker).toHaveBeenCalledTimes(1)
    })

    test('is called even when the chooser is cancelled, before it opened', async () => {
        setupDb([fold('f', ['a'])], characters())
        const beforeFilePicker = vi.fn()
        selectSingleFileSpy.mockResolvedValue(null)
        answers.push(TOP.picture, '1')
        await runFolderMenu(targetOf('f'), makeHost({ beforeFilePicker }).host)
        expect(beforeFilePicker).toHaveBeenCalledTimes(1)
    })

    test('is not called for rename, colour, picture reset, Ungroup, Delete or Cancel', async () => {
        setupDb([fold('f', ['a']), fold('g', ['b'])], characters())
        const beforeFilePicker = vi.fn()
        const { host } = makeHost({ beforeFilePicker })
        answers.push(TOP.rename); inputs.push('n')
        await runFolderMenu(targetOf('f'), host)
        answers.push(TOP.colour, '1')
        await runFolderMenu(targetOf('f'), host)
        answers.push(TOP.picture, '0')
        await runFolderMenu(targetOf('f'), host)
        answers.push(TOP.picture, '5')
        await runFolderMenu(targetOf('f'), host)
        answers.push(TOP.del, '0')
        await runFolderMenu(targetOf('f'), host)
        answers.push(TOP.ungroup)
        await runFolderMenu(targetOf('g'), host)
        answers.push(TOP.cancel)
        await runFolderMenu(targetOf('g'), host)
        expect(beforeFilePicker).not.toHaveBeenCalled()
        expect(selectSingleFileSpy).not.toHaveBeenCalled()
    })

    test('an absent hook is tolerated', async () => {
        const db = setupDb([fold('f', ['a'])], characters())
        answers.push(TOP.picture, '1')
        await runFolderMenu(targetOf('f'), makeHost().host)
        expect(db.writes).toHaveLength(1)
    })
})

describe('9. wrapFieldWrite', () => {
    const fieldEdits: Array<[string, () => void, Record<string, unknown>]> = [
        ['rename', () => { answers.push(TOP.rename); inputs.push('Renamed') }, { name: 'Renamed' }],
        ['colour', () => { answers.push(TOP.colour, '6') }, { color: 'pink' }],
        ['picture reset', () => { answers.push(TOP.picture, '0') }, { img: '' }],
        ['picture file', () => { answers.push(TOP.picture, '1') }, { imgFile: 'asset-1' }],
    ]

    test.each(fieldEdits)('%s: called once; the order is untouched until write() runs, which assigns once', async (_title, arrange, expected) => {
        const db = setupDb([fold('f', ['a'], { imgFile: 'old' })], characters())
        const first = db.order()
        const seen: Array<{ writesOnEntry: number, orderOnEntry: OrderEntry[], orderAfterWrite: OrderEntry[], writesAfterWrite: number }> = []
        const wrapFieldWrite = vi.fn((write: () => void) => {
            const writesOnEntry = db.writes.length
            const orderOnEntry = db.order()
            write()
            seen.push({ writesOnEntry, orderOnEntry, orderAfterWrite: db.order(), writesAfterWrite: db.writes.length })
        })
        arrange()
        await runFolderMenu(targetOf('f'), makeHost({ wrapFieldWrite }).host)
        expect(wrapFieldWrite).toHaveBeenCalledTimes(1)
        expect(seen).toHaveLength(1)
        expect(seen[0].writesOnEntry).toBe(0)
        expect(seen[0].orderOnEntry).toBe(first)
        expect(seen[0].writesAfterWrite).toBe(1)
        expect(seen[0].orderAfterWrite).not.toBe(first)
        expect(seen[0].orderAfterWrite[0]).toMatchObject(expected)
        expect(db.writes).toHaveLength(1)
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
    })

    test.each(fieldEdits)('%s: a wrapper that never calls write() leaves the order unchanged', async (_title, arrange) => {
        const db = setupDb([fold('f', ['a'])], characters())
        const first = db.order()
        const wrapFieldWrite = vi.fn()
        arrange()
        await runFolderMenu(targetOf('f'), makeHost({ wrapFieldWrite }).host)
        expect(wrapFieldWrite).toHaveBeenCalledTimes(1)
        expect(db.writes).toHaveLength(0)
        expect(db.order()).toBe(first)
    })

    test.each(fieldEdits)('%s: no wrapper and a pass-through wrapper give the same order', async (_title, arrange) => {
        const plain = setupDb([fold('f', ['a'], { imgFile: 'old' }), 'z'], characters())
        arrange()
        await runFolderMenu(targetOf('f'), makeHost().host)
        const withoutWrapper = structuredClone(plain.order())
        expect(plain.writes).toHaveLength(1)

        const wrapped = setupDb([fold('f', ['a'], { imgFile: 'old' }), 'z'], characters())
        arrange()
        await runFolderMenu(targetOf('f'), makeHost({ wrapFieldWrite: (write) => { write() } }).host)
        expect(wrapped.writes).toHaveLength(1)
        expect(structuredClone(wrapped.order())).toEqual(withoutWrapper)
    })

    const noOps: Array<[string, () => void, OrderEntry[]]> = [
        ['rename of a vanished folder', () => { answers.push(TOP.rename); inputs.push('x') }, ['x']],
        ['blank rename', () => { answers.push(TOP.rename); inputs.push('') }, [fold('f', ['a'])]],
        ['unknown colour index', () => { answers.push(TOP.colour, '40') }, [fold('f', ['a'])]],
        ['colour of a vanished folder', () => { answers.push(TOP.colour, '1') }, ['x']],
        ['picture reset of a vanished folder', () => { answers.push(TOP.picture, '0') }, ['x']],
        ['cancelled chooser', () => { answers.push(TOP.picture, '1'); selectSingleFileSpy.mockResolvedValue(null) }, [fold('f', ['a'])]],
        ['picture file of a vanished folder', () => { answers.push(TOP.picture, '1') }, ['x']],
        ['picture sub-prompt cancelled', () => { answers.push(TOP.picture, '7') }, [fold('f', ['a'])]],
        ['duplicate id rename', () => { answers.push(TOP.rename); inputs.push('x') }, [fold('f', ['a']), fold('f', ['b'])]],
    ]
    test.each(noOps)('%s: the wrapper is never called', async (_title, arrange, order) => {
        const db = setupDb(order, characters())
        const wrapFieldWrite = vi.fn()
        arrange()
        await runFolderMenu(targetOf('f'), makeHost({ wrapFieldWrite }).host)
        expect(wrapFieldWrite).not.toHaveBeenCalled()
        expect(db.writes).toHaveLength(0)
    })

    const otherActions: Array<[string, () => void]> = [
        ['Ungroup', () => { answers.push(TOP.ungroup) }],
        ['Delete, Keep', () => { answers.push(TOP.del, '0') }],
        ['Delete, Trash', () => { answers.push(TOP.del, '1') }],
        ['Delete, Cancel', () => { answers.push(TOP.del, '2') }],
        ['Cancel', () => { answers.push(TOP.cancel) }],
    ]
    test.each(otherActions)('%s: the wrapper is never called', async (_title, arrange) => {
        setupDb([fold('f', ['a'])], characters())
        const wrapFieldWrite = vi.fn()
        arrange()
        await runFolderMenu(targetOf('f'), makeHost({ wrapFieldWrite }).host)
        expect(wrapFieldWrite).not.toHaveBeenCalled()
    })

    test('the wrapper is not called for the asset save that precedes the picture write', async () => {
        setupDb([fold('f', ['a'])], characters())
        const save = deferred<string>()
        saveAssetSpy.mockReturnValue(save.promise)
        const wrapFieldWrite = vi.fn((write: () => void) => { write() })
        answers.push(TOP.picture, '1')
        const done = runFolderMenu(targetOf('f'), makeHost({ wrapFieldWrite }).host)
        await flush()
        expect(wrapFieldWrite).not.toHaveBeenCalled()
        save.resolve('asset-2')
        await done
        expect(wrapFieldWrite).toHaveBeenCalledTimes(1)
    })
})
