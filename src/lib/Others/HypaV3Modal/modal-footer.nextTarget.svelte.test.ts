// @vitest-environment happy-dom

/**
 * `modal-footer.svelte` previews the message HypaV3 will summarize next. The
 * preview must mirror the summariser (MC-437): the prompt-order list of example
 * turns, the greeting (when sent) and the sent messages, the orphaned-summary
 * filter, the resume point of `findResumeIndex`, and the batch loop's skips.
 *
 * Mounts the real `modal-footer.svelte` against a real `$state` database.
 */
import { describe, test, expect, vi, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'
import type { SerializableHypaV3Data } from 'src/ts/process/memory/hypav3'

//#region module mocks

const settings = vi.hoisted(() => ({
    processRegexScript: false,
    preserveOrphanedMemory: false,
    doNotSummarizeUserMessage: false,
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: 0 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    getCurrentHypaV3Preset: vi.fn(() => ({ settings })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/process/scripts'), () => ({
    processScriptFull: vi.fn(),
    risuChatParser: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/alert'))

//#endregion

import { flushSync, mount, unmount } from 'svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import ModalFooter from 'src/lib/Others/HypaV3Modal/modal-footer.svelte'
import { language } from 'src/lang'

const IDS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']

type Spec = string | { id?: string, disabled?: true | 'allBefore', role?: 'user' | 'char' }

interface World {
    firstMessage?: string
    exampleMessage?: string
    group?: boolean
    messages?: Spec[]
}

function installWorld(w: World): void {
    const message = (w.messages ?? IDS).map((spec) => {
        const o = typeof spec === 'string' ? { id: spec } : spec
        return {
            role: o.role ?? 'char',
            chatId: o.id,
            data: `body-${o.id}`,
            ...(o.disabled ? { disabled: o.disabled } : {}),
        }
    })
    const chat = { fmIndex: -1, message }
    DBState.db = {
        characters: [w.group
            ? { type: 'group', firstMessage: w.firstMessage ?? 'greeting text', chatPage: 0, chats: [chat] }
            : {
                type: 'character',
                name: 'Bot',
                firstMessage: w.firstMessage ?? 'greeting text',
                exampleMessage: w.exampleMessage ?? '',
                alternateGreetings: [],
                chatPage: 0,
                chats: [chat],
            }],
    } as unknown as Database
    selectedCharID.set(0)
}

function dataOf(...memoSets: (string | null)[][]): SerializableHypaV3Data {
    return {
        summaries: memoSets.map((chatMemos) => ({ text: 's', chatMemos, isImportant: false })),
    } as unknown as SerializableHypaV3Data
}

let mounted: { instance: Record<string, unknown>, target: HTMLElement } | undefined

async function render(data: SerializableHypaV3Data, w: World): Promise<HTMLElement> {
    installWorld(w)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(ModalFooter, { target, props: { hypaV3Data: data } }) as unknown as Record<string, unknown>
    mounted = { instance, target }
    for (let i = 0; i < 4; i++) {
        flushSync()
        await new Promise<void>((res) => setTimeout(res, 0))
    }
    return target
}

async function preview(data: SerializableHypaV3Data, w: World = {}): Promise<{ label: string, body: string }> {
    const target = await render(data, w)
    const textarea = target.querySelector('textarea')
    if (!textarea) {
        throw new Error('next summarization target not rendered: ' + target.textContent)
    }
    return {
        label: textarea.previousElementSibling?.textContent?.trim() ?? '',
        body: textarea.value,
    }
}

async function previewsNone(data: SerializableHypaV3Data, w: World = {}): Promise<boolean> {
    const target = await render(data, w)
    return !target.querySelector('textarea')
        && (target.textContent ?? '').includes(language.hypaV3Modal.nextSummarizationNoMessagesFoundLabel)
}

function labelFor(id: string): string {
    return language.hypaV3Modal.nextSummarizationLabel.replace('{0}', id)
}

const GREETING_LABEL = labelFor(language.hypaV3Modal.nextSummarizationFirstMessageLabel)

afterEach(async () => {
    if (mounted) {
        await unmount(mounted.instance as never).catch(() => {})
        mounted.target.remove()
        mounted = undefined
    }
    document.body.replaceChildren()
    selectedCharID.set(-1)
    settings.processRegexScript = false
    settings.preserveOrphanedMemory = false
    settings.doNotSummarizeUserMessage = false
})

const EXAMPLES = '<START>\n{{user}}: hi\n{{char}}: hello'

describe('HypaV3 next summarization target preview', () => {
    test('regression reproducer: an older summary covering a later message moves the preview past it', async () => {
        const r = await preview(dataOf(['m3', 'm4'], ['m1', 'm2']))
        expect(r.label).toBe(labelFor('m5'))
        expect(r.body).toBe('body-m5')
    })

    test('regression reproducer: memo order within the last summary does not matter', async () => {
        const r = await preview(dataOf(['m1', 'm2'], ['m4', 'm3']))
        expect(r.label).toBe(labelFor('m5'))
    })

    test('regression reproducer: a summary holding an orphaned memo is dropped whole (R3 changed: the highest known memo no longer counts)', async () => {
        const r = await preview(dataOf(['m1', 'm2'], ['m3', 'gone']))
        expect(r.label).toBe(labelFor('m3'))
    })

    test('guard (passes on v1 and after; fails on HEAD): preserveOrphanedMemory keeps the summary and its highest known memo', async () => {
        settings.preserveOrphanedMemory = true
        const r = await preview(dataOf(['m1', 'm2'], ['m3', 'gone']))
        expect(r.label).toBe(labelFor('m4'))
    })

    test('guard (passes before and after): ordered summaries preview the message after the last memo', async () => {
        const r = await preview(dataOf(['m1', 'm2'], ['m3', 'm4']))
        expect(r.label).toBe(labelFor('m5'))
        expect(r.body).toBe('body-m5')
    })

    test('guard (passes before and after): without summaries the greeting is previewed', async () => {
        const r = await preview(dataOf())
        expect(r.label).toBe(GREETING_LABEL)
        expect(r.body).toBe('greeting text')
    })

    test('guard (passes before and after): everything summarised previews no message', async () => {
        expect(await previewsNone(dataOf(IDS))).toBe(true)
    })

    test('regression reproducer: a greeting-only summary ([[null]], no examples) moves the preview to the first message', async () => {
        const r = await preview(dataOf([null]))
        expect(r.label).toBe(labelFor('m1'))
        expect(r.body).toBe('body-m1')
    })

    test('guard (passes before and after): with example turns the memo-less memo is ignored and the greeting stays the target', async () => {
        const r = await preview(dataOf([null]), { exampleMessage: EXAMPLES })
        expect(r.label).toBe(GREETING_LABEL)
    })

    test('regression reproducer: an allBefore reset with only earlier memos previews the first sent message after the reset', async () => {
        const messages: Spec[] = ['m1', 'm2', { id: 'm3', disabled: 'allBefore' }, 'm4', 'm5']
        const r = await preview(dataOf(['m1', 'm2']), { messages })
        expect(r.label).toBe(labelFor('m4'))
    })

    test('regression reproducer: an allBefore reset with no summaries previews the first sent message, not the greeting', async () => {
        const messages: Spec[] = ['m1', { id: 'm2', disabled: 'allBefore' }, 'm3']
        const r = await preview(dataOf(), { messages })
        expect(r.label).toBe(labelFor('m3'))
    })

    test('regression reproducer: a hidden next message is skipped', async () => {
        const messages: Spec[] = ['m1', 'm2', { id: 'm3', disabled: true }, 'm4']
        const r = await preview(dataOf(['m1', 'm2']), { messages })
        expect(r.label).toBe(labelFor('m4'))
    })

    test('regression reproducer: a group has no greeting and none of the example handling throws on its missing exampleMessage', async () => {
        const r = await preview(dataOf(), { group: true })
        expect(r.label).toBe(labelFor('m1'))
    })

    test('regression reproducer: a sent but blank greeting is skipped', async () => {
        const r = await preview(dataOf(), { firstMessage: '  ' })
        expect(r.label).toBe(labelFor('m1'))
        const again = await preview(dataOf([null]), { firstMessage: '  ' })
        expect(again.label).toBe(labelFor('m1'))
    })

    test('regression reproducer: doNotSummarizeUserMessage skips user messages', async () => {
        settings.doNotSummarizeUserMessage = true
        const messages: Spec[] = ['m1', { id: 'm2', role: 'user' }, { id: 'm3', role: 'user' }, 'm4']
        const r = await preview(dataOf(['m1']), { messages })
        expect(r.label).toBe(labelFor('m4'))
    })

    test('guard (passes before and after): user messages are previewed when they are summarised', async () => {
        const messages: Spec[] = ['m1', { id: 'm2', role: 'user' }, 'm3']
        const r = await preview(dataOf(['m1']), { messages })
        expect(r.label).toBe(labelFor('m2'))
    })
})
