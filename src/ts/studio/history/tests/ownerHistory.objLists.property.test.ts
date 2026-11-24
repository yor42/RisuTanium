// @vitest-environment jsdom
// T50: generated lorebook histories through the real owner history service (memory store, fake clock, a character owner
// and its chat). Acceptance test for the object-list mechanism of S7-0; it passes with the test-local builders of
// `loreOps.test-helpers.ts` and must be re-run with the real builders of S7-1.
//
// Every oracle below is independent simple code in this file: none calls `planObjStep`, `completeObjOps` or
// `listingEffectOf`. Rows are compared by `canonX`, a string, so a fingerprint collision cannot hide a difference.
//   I1  a refused action leaves both lists, the props, both stacks and the listing byte-equal.
//   I2  after a Studio plan no identity (id, folder key, and content unless the plan sets a field) gains holders beyond
//       what existed before or what an applied insert recorded for it.
//   I3  every applied op found its anchor: a sequential replay of the executed ops over the pre-action list reproduces
//       the live list.
//   I4  after a move the model made as `already` (no write): the direction's inserted rows are where and as the
//       direction's later ops leave them, and no removed identity is held more often than its recorded count allows,
//       counting the direction's own later re-adds.
// The I4 oracle tracks rows and re-adds (a correct `already` move of a move or revert step breaks the plainer wording
// "a canonical-equal row at its recorded index" and "holders below the recorded count"); `RISU_T50_I4=spec` runs that
// plainer wording as a diagnostic.
import { appendFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import fc from 'fast-check'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService, type StudioResult } from '../ownerHistory.svelte'
import { entryAnchor, isObjFamilyOp, parseObjItem, type IdentityKind, type ObjEntry, type ObjFamilyOp } from '../objectListOps'
import { characterOwnerKey, chatOwnerKey, SAVE_DEBOUNCE_MS, type OwnerKey } from '../ownerPhase'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type MemoryStudioStore } from './studioStoreDoubles'
import { clone, golden, liveCharacter, makeCharacter, putCharacter, row, rows } from './objService.test-helpers'
import { addEntry, bulkSet, caseSensitive, deleteEntry, deleteSubtree, duplicateEntry, fieldEdit, giveNewId, isRow, loreSettingsSet, moveEntry, type LoreBuilder } from './loreOps.test-helpers'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
    }
})

const SEED = 20261124
const RUNS = Number(process.env.RISU_T50_RUNS ?? '1000')
const MAX_ACTIONS = 30
const SPEC_I4 = process.env.RISU_T50_I4 === 'spec'

const A = characterOwnerKey('A')
const C1 = chatOwnerKey('A', 'c1')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

// ---------------------------------------------------------------- the world

const FOLDERS = ['folder:f1', 'folder:f2', 'folder:n0', 'folder:n1']
const IDS = ['id-a', 'id-b', 'id-c']

function folderRow(key: string, parent?: string, id?: string): ObjEntry {
    return { ...clone(golden.blank.globalLore[1]), key, comment: `Folder ${key}`, ...(parent === undefined ? {} : { folder: parent }), ...(id === undefined ? {} : { id }) }
}

// Id-less rows, exact twins, shared ids, nested folders with children (child links as the folder UI writes them), a
// folder row with an id, a row of wrong-kind fields, rows that are not objects, and unknown keys.
function charWorld(): unknown[] {
    const twin = clone(golden.twins.globalLore[0])
    return [
        row(0),
        { ...row(1), id: 'id-a' },
        { ...row(2), id: 'id-a' },
        twin,
        clone(twin),
        folderRow('folder:f1'),
        { ...row(3), folder: 'folder:f1' },
        folderRow('folder:f2', 'folder:f1'),
        { ...row(4), folder: 'folder:f2', id: 'id-b' },
        clone(golden.folderWithId.globalLore[0]),
        clone(golden.wrongKinds.globalLore[0]),
        null,
        'x',
        { ...row(5), loreCache: { k: 1 }, unknownKey: 'u', extentions: { risu_case_sensitive: true, other: 1 } },
    ]
}

function chatWorld(): unknown[] {
    return [clone(golden.twins.globalLore[0]), row(0), folderRow('folder:f1'), { ...row(1), folder: 'folder:f1' }]
}

const WORLDS: { char: () => unknown[]; chat: () => unknown[] }[] = [
    { char: charWorld, chat: chatWorld },
    { char: () => [], chat: () => [] },
    { char: () => clone(golden.twins.globalLore), chat: () => rows(2) },
]

interface Ctx {
    clock: FakeClock
    store: MemoryStudioStore
    service: OwnerHistoryService
    visit: string
    // The shared store as it was before the last action's saves, and as it is after them.
    prevShared: Map<string, string>
    lastShared: Map<string, string>
    // The data before the last action.
    prevData: DataCapture
    delSeq: number
    snapshots: string[]
}

let sessions = 0

function createService(ctx: Pick<Ctx, 'clock' | 'visit'>, shared?: Map<string, string>): { service: OwnerHistoryService; store: MemoryStudioStore } {
    const store = createMemoryStudioStore({ shared })
    sessions += 1
    const service = createOwnerHistoryService({
        store,
        claim: createClaimDouble(),
        clock: ctx.clock,
        pageSession: `p${sessions}`,
        getVisitId: () => ctx.visit,
        registerLeaveFlush: () => () => {},
    })
    return { service, store }
}

const OWNERS = [
    { key: A as OwnerKey, chat: false },
    { key: C1 as OwnerKey, chat: true },
]
type Owner = (typeof OWNERS)[number]

function listOf(owner: Owner): unknown[] {
    const live = liveCharacter()
    return (owner.chat ? live.chats[0].localLore : live.globalLore) as unknown[]
}

function setList(owner: Owner, value: unknown[]): void {
    const live = liveCharacter()
    if (owner.chat) {
        live.chats[0].localLore = value
    } else {
        live.globalLore = value
    }
}

interface DataCapture {
    lists: [string, string]
    props: string
}

function captureData(): DataCapture {
    const live = liveCharacter()
    const prop = (name: 'loreSettings' | 'loreExt'): unknown => (Object.hasOwn(live, name) ? { value: live[name] } : null)
    return {
        lists: [JSON.stringify(listOf(OWNERS[0])), JSON.stringify(listOf(OWNERS[1]))],
        props: JSON.stringify([prop('loreSettings'), prop('loreExt')]),
    }
}

function restoreData(data: DataCapture): void {
    setList(OWNERS[0], JSON.parse(data.lists[0]))
    setList(OWNERS[1], JSON.parse(data.lists[1]))
    // Props are never touched by reload actions of this file's world: they keep their live value unless the data save
    // is dropped, where the whole captured state returns.
    const live = liveCharacter()
    const props = JSON.parse(data.props) as ({ value: object } | null)[]
    for (const [i, name] of (['loreSettings', 'loreExt'] as const).entries()) {
        const entry = props[i]
        if (entry === null) {
            delete live[name]
        } else {
            live[name] = entry.value
        }
    }
}

interface ViewCapture {
    done: { id: string; ops: ObjFamilyOp[] }[]
    undone: { id: string; ops: ObjFamilyOp[] }[]
    deletedJson: string
}

interface Capture {
    data: DataCapture
    views: [ViewCapture, ViewCapture]
    stacks: [string, string]
}

function objOpsOf(ops: readonly { op: string }[]): ObjFamilyOp[] {
    return ops.filter((op): op is ObjFamilyOp => isObjFamilyOp(op))
}

function capture(ctx: Ctx): Capture {
    const views = OWNERS.map((owner) => {
        const view = ctx.service.view(owner.key)
        return {
            done: view.done.map((step) => ({ id: step.id, ops: clone(objOpsOf(step.ops)) })),
            undone: view.undone.map((step) => ({ id: step.id, ops: clone(objOpsOf(step.ops)) })),
            deletedJson: JSON.stringify(view.deleted),
        }
    }) as [ViewCapture, ViewCapture]
    const stacks = OWNERS.map((owner) => {
        const view = ctx.service.view(owner.key)
        return JSON.stringify({ done: view.done, undone: view.undone, deleted: view.deleted })
    }) as [string, string]
    return { data: captureData(), views, stacks }
}

// ---------------------------------------------------------------- oracle helpers

function stable(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(stable)
    }
    if (isRow(value)) {
        const next: Record<string, unknown> = {}
        for (const key of Object.keys(value).sort()) {
            Object.defineProperty(next, key, { value: stable(value[key]), enumerable: true, writable: true, configurable: true })
        }
        return next
    }
    return value
}

// The canonical string of a row without the anchor-excluded key.
function canonX(value: unknown): string {
    if (isRow(value)) {
        const { bookVersion: _ignored, ...rest } = value
        return JSON.stringify(stable(rest))
    }
    return JSON.stringify(stable(value) ?? null)
}

type Held = Partial<Record<IdentityKind, string>>

function identitiesOf(value: unknown): Held {
    const held: Held = {}
    if (!isRow(value)) {
        return held
    }
    if (typeof value.id === 'string' && value.id !== '') {
        held.id = value.id
    }
    if (value.mode === 'folder' && typeof value.key === 'string' && value.key !== '') {
        held.folderKey = value.key
    }
    if (held.id === undefined && held.folderKey === undefined) {
        held.content = canonX(value)
    }
    return held
}

function holders(list: readonly unknown[], kind: IdentityKind, value: string): number {
    return list.filter((entry) => identitiesOf(entry)[kind] === value).length
}

function invertAll(ops: readonly ObjFamilyOp[]): ObjFamilyOp[] {
    return [...ops].reverse().map((op): ObjFamilyOp => {
        switch (op.op) {
            case 'objInsert':
                return { ...op, op: 'objRemove' }
            case 'objRemove':
                return { ...op, op: 'objInsert' }
            case 'objSet':
                return { ...op, before: op.after, after: op.before, anchorBefore: op.anchorAfter, anchorAfter: op.anchorBefore }
            case 'propSet':
                return { ...op, before: op.after, after: op.before }
        }
    })
}

function withField(entry: unknown, field: string, value: { had: false } | { had: true; value: unknown }): unknown {
    if (!isRow(entry)) {
        return entry
    }
    const next = { ...entry }
    if (value.had) {
        next[field] = value.value
    } else {
        delete next[field]
    }
    return next
}

// The run summary goes to the console and, when RISU_T50_LOG names a file, is appended there (the runner hides stdout).
function report(line: string): void {
    console.info(line)
    if (process.env.RISU_T50_LOG) {
        appendFileSync(process.env.RISU_T50_LOG, `${line}\n`)
    }
}

class Breach extends Error {}

function breach(what: string): never {
    throw new Breach(what)
}

function expectSameCapture(before: Capture, after: Capture, what: string): void {
    if (JSON.stringify(before.data) !== JSON.stringify(after.data)) {
        breach(`${what}: lists or props changed`)
    }
    if (before.stacks[0] !== after.stacks[0] || before.stacks[1] !== after.stacks[1]) {
        breach(`${what}: a stack or the listing changed`)
    }
}

function expectSameData(before: Capture, after: Capture, what: string): void {
    if (JSON.stringify(before.data) !== JSON.stringify(after.data)) {
        breach(`${what}: lists or props changed`)
    }
}

// Canonical equality, as the spec's T39 states it: the keys of a row that was removed and put back by an undo may sit in
// another order, which is not a change of the row. A mismatch names the first differing row of each list.
function expectSameBytes(expected: DataCapture, actual: DataCapture, what: string): void {
    const parts: string[] = []
    for (const [index, text] of expected.lists.entries()) {
        const want = JSON.parse(text) as unknown[]
        const got = JSON.parse(actual.lists[index]) as unknown[]
        const at = want.findIndex((entry, i) => canonX(entry) !== canonX(got[i]))
        if (want.length !== got.length || at >= 0) {
            parts.push(`list ${index}: want ${want.length} rows, got ${got.length}; first difference at ${at >= 0 ? at : want.length}: want ${JSON.stringify(want[at >= 0 ? at : want.length])?.slice(0, 160)} got ${JSON.stringify(got[at >= 0 ? at : want.length])?.slice(0, 160)}`)
        }
    }
    if (JSON.stringify(stable(JSON.parse(expected.props))) !== JSON.stringify(stable(JSON.parse(actual.props)))) {
        parts.push(`props: want ${expected.props} got ${actual.props}`)
    }
    if (parts.length > 0) {
        breach(`${what} (${parts.join('; ')})`)
    }
}

function checkI2(pre: readonly unknown[], post: readonly unknown[], executed: readonly ObjFamilyOp[]): void {
    const hasSet = executed.some((op) => op.op === 'objSet')
    const recorded = new Map<string, number>()
    for (const op of executed) {
        if (op.op !== 'objInsert') {
            continue
        }
        const held = identitiesOf(op.entry)
        for (const kind of Object.keys(held) as IdentityKind[]) {
            const key = `${kind}\u0000${held[kind]}`
            recorded.set(key, Math.max(recorded.get(key) ?? 0, op.counts[kind] ?? 0))
        }
    }
    for (const entry of post) {
        const held = identitiesOf(entry)
        for (const kind of Object.keys(held) as IdentityKind[]) {
            if (kind === 'content' && hasSet) {
                continue
            }
            const value = held[kind] as string
            const after = holders(post, kind, value)
            const allowed = Math.max(holders(pre, kind, value), recorded.get(`${kind}\u0000${value}`) ?? 0)
            if (after > allowed) {
                breach(`I2: ${kind} ${JSON.stringify(value).slice(0, 80)} has ${after} holders, at most ${allowed} allowed`)
            }
        }
    }
}

// I3: sequential replay, each op against the list as the earlier ops left it.
function checkI3(pre: readonly unknown[], post: readonly unknown[], executed: readonly ObjFamilyOp[], entryAnchor: (row: unknown) => number | null): void {
    const copy: unknown[] = clone([...pre])
    for (const op of executed) {
        if (op.op === 'objRemove') {
            if (op.index >= copy.length || canonX(copy[op.index]) !== canonX(op.entry)) {
                breach(`I3: remove at ${op.index} found no row equal to its entry`)
            }
            copy.splice(op.index, 1)
        } else if (op.op === 'objSet') {
            const target = copy[op.index]
            if (op.index >= copy.length || !isRow(target) || entryAnchor(target) !== op.anchorBefore) {
                breach(`I3: set ${op.field} at ${op.index} found no row with its anchor`)
            }
            copy[op.index] = withField(target, op.field, op.after)
        } else if (op.op === 'objInsert') {
            if (op.index > copy.length) {
                breach(`I3: insert at ${op.index} beyond the list`)
            }
            copy.splice(op.index, 0, clone(op.entry))
        }
    }
    if (copy.length !== post.length || copy.some((entry, i) => canonX(entry) !== canonX(post[i]))) {
        breach('I3: the replay of the executed ops does not reproduce the live list')
    }
}

function liveProp(name: 'loreSettings' | 'loreExt'): { had: false } | { had: true; value: unknown } {
    const live = liveCharacter()
    return Object.hasOwn(live, name) ? { had: true, value: live[name] } : { had: false }
}

function checkProps(dir: readonly ObjFamilyOp[], what: string): void {
    const last = new Map<'loreSettings' | 'loreExt', ObjFamilyOp & { op: 'propSet' }>()
    for (const op of dir) {
        if (op.op === 'propSet') {
            last.set(op.prop, op)
        }
    }
    for (const [prop, op] of last) {
        if (JSON.stringify(stable(liveProp(prop))) !== JSON.stringify(stable(op.after))) {
            breach(`${what}: ${prop} is not the last propSet's after`)
        }
    }
}

// I4, checked after a move the model made as `already`.
function checkI4(dir: readonly ObjFamilyOp[], live: readonly unknown[]): void {
    const hasSet = dir.some((op) => op.op === 'objSet')
    dir.forEach((op, k) => {
        if (op.op === 'objInsert') {
            if (SPEC_I4) {
                if (canonX(live[op.index]) !== canonX(op.entry)) {
                    breach(`I4 (spec wording): no canonical-equal row at recorded index ${op.index}`)
                }
                return
            }
            let pos = op.index
            let row: unknown = op.entry
            for (const later of dir.slice(k + 1)) {
                if (later.op === 'objInsert' && later.index <= pos) {
                    pos += 1
                } else if (later.op === 'objRemove') {
                    if (later.index < pos) {
                        pos -= 1
                    } else if (later.index === pos) {
                        return
                    }
                } else if (later.op === 'objSet' && later.index === pos) {
                    row = withField(row, later.field, later.after)
                }
            }
            if (canonX(live[pos]) !== canonX(row)) {
                breach(`I4 add half: row tracked to ${pos} is not what the list holds`)
            }
        } else if (op.op === 'objRemove') {
            const held = identitiesOf(op.entry)
            for (const kind of Object.keys(held) as IdentityKind[]) {
                if (kind === 'content' && hasSet) {
                    continue
                }
                const value = held[kind] as string
                const count = op.counts[kind] ?? 0
                const reAdds = SPEC_I4 ? 0 : dir.slice(k + 1).filter((later) => later.op === 'objInsert' && identitiesOf(later.entry)[kind] === value).length
                if (holders(live, kind, value) > count - 1 + reAdds) {
                    breach(`I4 removal half: ${kind} ${JSON.stringify(value).slice(0, 80)} held ${holders(live, kind, value)} times, bound ${count - 1 + reAdds}`)
                }
            }
        }
    })
    checkProps(dir, 'I4')
}

// ---------------------------------------------------------------- actions

const KINDS = [
    'edit', 'edit', 'edit', 'case', 'add', 'add', 'dup', 'del', 'del', 'folderDel', 'folderDel', 'move', 'move', 'newId', 'bulk', 'prop',
    'outInsert', 'outDelete', 'outReorder', 'outRewrite', 'outAppend',
    'undo', 'undo', 'undo', 'redo', 'redo', 'revert', 'restoreDel', 'restoreDel', 'line', 'reloadHistory', 'reloadData',
] as const
type Kind = (typeof KINDS)[number]
const STUDIO_ONLY: readonly Kind[] = ['edit', 'edit', 'case', 'add', 'dup', 'del', 'folderDel', 'move', 'newId', 'bulk', 'prop', 'undo', 'redo']

interface Action {
    k: Kind
    chat: boolean
    a: number
    b: number
    c: number
}

function actionArb(kinds: readonly Kind[]): fc.Arbitrary<Action> {
    return fc.record({
        k: fc.constantFrom(...kinds),
        chat: fc.integer({ min: 0, max: 4 }).map((n) => n === 0),
        a: fc.nat(60),
        b: fc.nat(60),
        c: fc.nat(9),
    })
}

const TEXTS = ['', 'alpha', 'beta gamma', 'Row 0', 'body 0']

function editBuilder(a: Action, index: number): LoreBuilder {
    switch (a.c % 6) {
        case 0:
            return fieldEdit(index, 'comment', { had: true, value: TEXTS[a.b % TEXTS.length] })
        case 1:
            return fieldEdit(index, 'content', { had: true, value: `${TEXTS[a.b % TEXTS.length]}!` })
        case 2:
            return fieldEdit(index, 'insertorder', { had: true, value: a.b })
        case 3:
            return fieldEdit(index, 'alwaysActive', { had: true, value: a.b % 2 === 0 })
        case 4:
            return fieldEdit(index, 'activationPercent', a.b % 3 === 0 ? { had: true, value: null } : { had: true, value: a.b })
        default:
            return fieldEdit(index, 'folder', a.b % 5 === 0 ? { had: false } : { had: true, value: FOLDERS[a.b % FOLDERS.length] })
    }
}

function newEntry(a: Action, list: readonly unknown[]): ObjEntry {
    switch (a.c % 5) {
        case 0:
            return row(100 + a.b)
        case 1:
            return { ...row(100 + a.b), id: IDS[a.b % IDS.length] }
        case 2: {
            const source = list.find(isRow)
            return source === undefined ? row(100 + a.b) : clone(source as ObjEntry)
        }
        case 3:
            return folderRow(FOLDERS[a.b % FOLDERS.length], a.b % 2 === 0 ? FOLDERS[(a.b + 1) % FOLDERS.length] : undefined)
        default:
            return { ...row(100 + a.b), folder: FOLDERS[a.b % FOLDERS.length] }
    }
}

interface Tally {
    [name: string]: number
}

function count(tally: Tally, name: string): void {
    tally[name] = (tally[name] ?? 0) + 1
}

async function flush(ctx: Ctx): Promise<void> {
    ctx.prevShared = ctx.lastShared
    await ctx.clock.advance(SAVE_DEBOUNCE_MS + 1)
    ctx.lastShared = new Map(ctx.store.shared)
}

async function reload(ctx: Ctx, shared: Map<string, string>): Promise<void> {
    ctx.visit = `v${sessions + 1}`
    const made = createService(ctx, new Map(shared))
    ctx.service = made.service
    ctx.store = made.store
    await ctx.service.whenReady(A)
    await ctx.service.whenReady(C1)
    ctx.lastShared = new Map(ctx.store.shared)
    ctx.prevShared = ctx.lastShared
}

async function startWorld(world: number): Promise<Ctx> {
    const w = WORLDS[world % WORLDS.length]
    putCharacter(makeCharacter({ globalLore: w.char(), chats: [{ id: 'c1', note: '', fmIndex: -1, localLore: w.chat() }] }))
    const clock = createFakeClock()
    const ctx = { clock, visit: 'v0' }
    const made = createService(ctx)
    await made.service.whenReady(A)
    await made.service.whenReady(C1)
    const full: Ctx = {
        clock,
        store: made.store,
        service: made.service,
        visit: 'v0',
        prevShared: new Map(),
        lastShared: new Map(made.store.shared),
        prevData: captureData(),
        delSeq: 0,
        snapshots: [JSON.stringify(listOf(OWNERS[0]))],
    }
    return full
}

function checkItems(ctx: Ctx): void {
    for (const owner of OWNERS) {
        for (const item of ctx.service.view(owner.key).deleted) {
            if (parseObjItem(JSON.parse(JSON.stringify(item))) === null) {
                breach(`items: a listed item does not parse back (${owner.key})`)
            }
        }
    }
}

type Mode = 'edit' | 'undo' | 'redo' | 'step'

// Runs one studio action and checks I1 to I4 on its outcome.
function studio(ctx: Ctx, owner: Owner, mode: Mode, tally: Tally, name: string, run: () => StudioResult, entryAnchor: (row: unknown) => number | null): void {
    const before = capture(ctx)
    const index = OWNERS.indexOf(owner)
    const result = run()
    const after = capture(ctx)
    if (result.ok === false) {
        expectSameCapture(before, after, 'I1 refused action')
        count(tally, `${name}:refused:${result.reason}`)
        return
    }
    if (result.unchanged === true) {
        expectSameCapture(before, after, 'unchanged action')
        count(tally, `${name}:unchanged`)
        return
    }
    if (result.dropped === true) {
        expectSameData(before, after, 'dropped step')
        count(tally, `${name}:dropped`)
        return
    }
    const mover = mode === 'undo' ? before.views[index].done.at(-1) : mode === 'redo' ? before.views[index].undone.at(-1) : undefined
    if (result.already !== undefined) {
        expectSameData(before, after, 'an already move')
        if (mover === undefined) {
            breach('an already result without a step to move')
        }
        checkI4(mode === 'undo' ? invertAll(mover.ops) : mover.ops, listOf(owner))
        count(tally, `${name}:already`)
        return
    }
    let executed: ObjFamilyOp[]
    if (mover !== undefined) {
        executed = mode === 'undo' ? invertAll(mover.ops) : mover.ops
    } else {
        const grew = after.views[index].done.length === before.views[index].done.length + 1
        if (mode === 'edit' && !grew) {
            breach('an applied edit did not record one step')
        }
        executed = grew ? (after.views[index].done.at(-1)?.ops ?? []) : []
    }
    if (executed.length === 0) {
        expectSameData(before, after, 'an action that executed nothing')
        count(tally, `${name}:nothing`)
        return
    }
    const preList = JSON.parse(before.data.lists[index]) as unknown[]
    const postList = JSON.parse(after.data.lists[index]) as unknown[]
    checkI2(preList, postList, executed)
    checkI3(preList, postList, executed, entryAnchor)
    if (executed.every((op) => op.op !== 'propSet') && before.data.props !== after.data.props) {
        breach('props changed without a propSet')
    }
    checkProps(executed, 'applied props')
    if (before.data.lists[1 - index] !== after.data.lists[1 - index]) {
        breach('the other owner\'s list changed')
    }
    count(tally, `${name}:applied`)
}

async function perform(ctx: Ctx, a: Action, tally: Tally, entryAnchor: (row: unknown) => number | null): Promise<void> {
    const owner = a.chat ? OWNERS[1] : OWNERS[0]
    const list = listOf(owner)
    const n = list.length
    const i = a.a % (n + 1)
    const edit = (builder: LoreBuilder, name: string): void => studio(ctx, owner, 'edit', tally, name, () => ctx.service.objEdit(owner.key, builder), entryAnchor)
    const delId = (): string => `D${(ctx.delSeq += 1)}`
    switch (a.k) {
        case 'edit':
            edit(editBuilder(a, i), 'edit')
            break
        case 'case':
            edit(caseSensitive(i, a.b % 2 === 0), 'case')
            break
        case 'add':
            edit(addEntry(a.b % (n + 1), newEntry(a, list)), 'add')
            break
        case 'dup':
            edit(duplicateEntry(i, `id-n${a.b}`), 'dup')
            break
        case 'del':
            edit(deleteEntry(i, delId()), 'del')
            break
        case 'folderDel':
            edit(deleteSubtree(i, delId()), 'folderDel')
            break
        case 'move':
            edit(moveEntry(i, a.c % 3 === 0 ? '' : FOLDERS[a.c % FOLDERS.length], a.b % Math.max(n, 1)), 'move')
            break
        case 'newId':
            edit(giveNewId(i, IDS[a.b % IDS.length]), 'newId')
            break
        case 'bulk':
            edit(bulkSet([i, (i + 1) % (n + 1), (i + 3) % (n + 1)], 'alwaysActive', a.b % 2 === 0), 'bulk')
            break
        case 'prop':
            edit(loreSettingsSet(a.b % 3 === 0 ? null : { tokenBudget: a.b, fullWordMatching: a.c % 2 === 0 }), 'prop')
            break
        case 'outInsert': {
            const at = a.a % (n + 1)
            list.splice(at, 0, a.b % 2 === 0 ? row(200 + a.c) : clone(list.find(isRow) ?? row(200)))
            count(tally, 'outside')
            break
        }
        case 'outDelete':
            if (n > 0) {
                list.splice(a.a % n, 1)
            }
            count(tally, 'outside')
            break
        case 'outReorder':
            if (n > 1) {
                const x = a.a % n
                const y = a.b % n
                ;[list[x], list[y]] = [list[y], list[x]]
            }
            count(tally, 'outside')
            break
        case 'outRewrite':
            if (n > 0 && isRow(list[a.a % n])) {
                list[a.a % n] = { ...(list[a.a % n] as Record<string, unknown>), comment: `outside ${a.b}` }
            }
            count(tally, 'outside')
            break
        case 'outAppend':
            list.push(...(JSON.parse(ctx.snapshots[a.b % ctx.snapshots.length]) as unknown[]))
            count(tally, 'outside')
            break
        case 'undo':
            studio(ctx, owner, 'undo', tally, 'undo', () => ctx.service.undo(owner.key), entryAnchor)
            break
        case 'redo':
            studio(ctx, owner, 'redo', tally, 'redo', () => ctx.service.redo(owner.key), entryAnchor)
            break
        case 'revert': {
            const done = ctx.service.view(owner.key).done
            if (done.length > 0) {
                const target = done[a.a % done.length].id
                studio(ctx, owner, 'step', tally, 'revert', () => ctx.service.revertTo(owner.key, target), entryAnchor)
            }
            break
        }
        case 'restoreDel': {
            const items = ctx.service.view(owner.key).deleted
            if (items.length > 0) {
                const target = items[a.a % items.length].id
                studio(ctx, owner, 'step', tally, 'restoreDel', () => ctx.service.restoreDeleted(owner.key, target), entryAnchor)
            }
            break
        }
        case 'line': {
            if (ctx.service.view(owner.key).restoreLines.some((line) => line.list === 'lore')) {
                studio(ctx, owner, 'step', tally, 'line', () => ctx.service.restore(owner.key, new Set(), { lines: ['lore'] }), entryAnchor)
            }
            break
        }
        case 'reloadHistory':
            // The data save landed, the last history save did not.
            await reload(ctx, ctx.prevShared)
            count(tally, 'reloadHistory')
            return
        case 'reloadData':
            // The history save landed, the last data save did not.
            restoreData(ctx.prevData)
            await reload(ctx, ctx.lastShared)
            count(tally, 'reloadData')
            return
    }
    checkItems(ctx)
}

async function runActions(world: number, actions: readonly Action[], tally: Tally, entryAnchor: (row: unknown) => number | null): Promise<void> {
    const ctx = await startWorld(world)
    for (const [step, a] of actions.entries()) {
        const dataBefore = captureData()
        try {
            await perform(ctx, a, tally, entryAnchor)
        } catch (error) {
            if (error instanceof Breach) {
                throw new Breach(`step ${step} ${JSON.stringify(a)}: ${error.message}`)
            }
            throw error
        }
        if (a.k !== 'reloadHistory' && a.k !== 'reloadData') {
            ctx.prevData = dataBefore
            await flush(ctx)
            if (a.k === 'outAppend' || a.k === 'outInsert') {
                ctx.snapshots.push(JSON.stringify(listOf(OWNERS[0])))
            }
        }
    }
}

// ---------------------------------------------------------------- round trip

async function runRoundTrip(world: number, actions: readonly Action[], tally: Tally, entryAnchor: (row: unknown) => number | null): Promise<void> {
    const ctx = await startWorld(world)
    const start = captureData()
    for (const a of actions) {
        await perform(ctx, a, tally, entryAnchor)
        await flush(ctx)
    }
    const replayAll = (kind: 'undo' | 'redo'): void => {
        for (const owner of OWNERS) {
            for (let guard = 0; guard < 200; guard += 1) {
                const view = ctx.service.view(owner.key)
                if ((kind === 'undo' ? view.done : view.undone).length === 0) {
                    break
                }
                const result = kind === 'undo' ? ctx.service.undo(owner.key) : ctx.service.redo(owner.key)
                if (!result.ok || result.already !== undefined || result.dropped === true) {
                    breach(`round trip: ${kind} of ${owner.key} gave ${JSON.stringify(result)}`)
                }
            }
        }
    }
    replayAll('redo')
    const final = captureData()
    replayAll('undo')
    expectSameBytes(start, captureData(), 'round trip: undoing every step did not return the initial canonical data (key order aside)')
    replayAll('redo')
    expectSameBytes(final, captureData(), 'round trip: redoing every step did not return the final canonical data (key order aside)')
    // The line returns the visit-start data; no line means the journal netted out, so the start data is already there.
    for (const [index, owner] of OWNERS.entries()) {
        if (ctx.service.view(owner.key).restoreLines.some((line) => line.list === 'lore')) {
            const result = ctx.service.restore(owner.key, new Set(), { lines: ['lore'] })
            if (!result.ok || result.linesRefused !== undefined) {
                breach(`round trip: the line of ${owner.key} gave ${JSON.stringify(result)}`)
            }
            count(tally, 'roundTripLine')
        }
        const now = captureData()
        expectSameBytes(
            start,
            { lists: index === 0 ? [now.lists[0], start.lists[1]] : [start.lists[0], now.lists[1]], props: index === 0 ? now.props : start.props },
            `round trip: the line or an empty journal left ${owner.key} away from the visit start`,
        )
    }
}

// ---------------------------------------------------------------- tests

beforeEach(() => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
})

afterEach(() => {
    DBState.db = { characters: [] } as unknown as typeof DBState.db
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

const worldArb = fc.integer({ min: 0, max: WORLDS.length - 1 })

describe('T50: generated lorebook histories', () => {
    test('I1 to I4 and the listing hold after every action of generated histories, and the classes are reached', async () => {
        const anchor = (row: unknown): number | null => entryAnchor('lore', row)
        const tally: Tally = {}
        const started = performance.now()
        await fc.assert(
            fc.asyncProperty(worldArb, fc.array(actionArb(KINDS), { minLength: 8, maxLength: MAX_ACTIONS }), async (world, actions) => {
                await runActions(world, actions, tally, anchor)
            }),
            { seed: SEED, numRuns: RUNS },
        )
        report(`T50: seed ${SEED}, ${RUNS} runs, ms${Math.round(performance.now() - started)} ${JSON.stringify(tally)}`)
        if (RUNS >= 200) {
            for (const name of ['edit:applied', 'add:applied', 'del:applied', 'folderDel:applied', 'move:applied', 'newId:applied', 'undo:applied', 'redo:applied', 'revert:applied', 'restoreDel:applied', 'line:applied', 'undo:already', 'edit:refused:precondition', 'outside', 'reloadHistory', 'reloadData']) {
                expect(tally[name] ?? 0, `class ${name}`).toBeGreaterThan(0)
            }
        }
    }, 600_000)

    test('with no outside change and no lost save, undoing every step returns the start canonical data (key order aside), redoing the end data, and the line the visit start', async () => {
        const anchor = (row: unknown): number | null => entryAnchor('lore', row)
        const tally: Tally = {}
        await fc.assert(
            fc.asyncProperty(worldArb, fc.array(actionArb(STUDIO_ONLY), { minLength: 8, maxLength: MAX_ACTIONS }), async (world, actions) => {
                await runRoundTrip(world, actions, tally, anchor)
            }),
            { seed: SEED, numRuns: Math.max(20, Math.floor(RUNS / 2)) },
        )
        report(`T50 round trip: ${JSON.stringify(tally)}`)
    }, 600_000)
})

