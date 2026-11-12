/**
 * The focus and alert-change scenarios of `AlertComp.svelte`, registered by both
 * `AlertComp.focusBox.svelte.test.ts`, which runs under the async scheduler the app ships.
 *
 * Drives the REAL `AlertComp.svelte` over a real `writable` standing in for `alertStore`, and the real alert
 * functions for the prompt that a notice covers. The assertions read `document.activeElement` and the nodes the
 * component adds to the document.
 *
 * Invariants pinned here:
 *  - when an alert that covers the page is shown, focus is inside it, on an element that is not a control: a
 *    button, a field, a link or an element that acts as a button would be pressed by the same Enter or Space
 *    that opened the alert;
 *  - the control that held focus before the alert opened does not keep it;
 *  - a prompt that comes back from under a notice takes focus again;
 *  - a different alert that replaces one whose control holds focus takes focus from that control, while a
 *    re-emission of the same wait alert with new text leaves focus on the control the user moved to;
 *  - a new prompt is rendered once, as the held dialog, and is never first rendered as the live alert and
 *    then moved;
 *  - what the previous alert had open (error details) does not carry into the next alert.
 *
 * The caller owns the module mocks (`localforage`, `globalApi.svelte`, `database.svelte`, `platform`,
 * `@tauri-apps/plugin-fs`, `stores.svelte`, `characters`, `avatarThumb`, `sourcemap`, `branches`): `vi.mock` is
 * file-scoped and the component graph needs them before it is imported.
 *
 * Tests whose title starts with `guard:` pass with or without the fix: they pin behaviour that must be
 * preserved. Every other test fails while the behaviour it names is missing.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { tickFake } from '../../ts/tests/svelteTick.test-helpers'
import type { Database } from '../../ts/storage/database.svelte'
import { language } from 'src/lang'
import { alertStore, DBState } from '../../ts/stores.svelte'
import { alertIdle, resetAlertPromptsForTests } from '../../ts/alertPrompts'
import { alertConfirm, alertGenerationInfoStore, alertInput, alertNormal, type alertData } from '../../ts/alert'
import { getChatBranches } from 'src/ts/gui/branches'
import AlertComp from './AlertComp.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountAlertComp(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(AlertComp, { target, props: {} }))
    return target
}

/** Lets the component react to the store and run the focus it moves after the DOM update. */
async function settle(): Promise<void> {
    flushSync()
    await tickFake()
    flushSync()
    await Promise.resolve()
}

/** Replaces the alert on screen, the way the app does, and lets the component react. */
async function show(value: alertData): Promise<void> {
    alertStore.set(value as never)
    await settle()
}

function buttonNamed(target: HTMLElement, name: string): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll('button')).find((button) => button.textContent?.trim() === name)
    if (!found) {
        throw new Error(`no button named "${name}" is mounted`)
    }
    return found
}

/** An element that a press of Enter or Space would activate, or that takes typed text. */
function isControl(el: Element | null): boolean {
    if (!el) {
        return false
    }
    if (['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY', 'A'].includes(el.tagName)) {
        return true
    }
    const role = el.getAttribute('role')
    return role === 'button' || role === 'link' || role === 'menuitem' || el.hasAttribute('contenteditable')
}

function promptField(target: HTMLElement): HTMLInputElement {
    return target.querySelector('#alert-input') as HTMLInputElement
}

function typeIntoPrompt(target: HTMLElement, text: string): void {
    const field = promptField(target)
    field.value = text
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

function describeElement(el: Element | null): string {
    if (!el) {
        return 'nothing'
    }
    const role = el.getAttribute('role')
    return `<${el.tagName.toLowerCase()}${role ? ` role=${role}` : ''}>`
}

function arrangeDatabase(): void {
    DBState.db = {
        characters: [{
            name: 'Alice',
            chats: [{ message: [], hypaV2Data: { chunks: [], mainChunks: [] } }],
            chatPage: 0,
        }],
        modules: [],
        enabledModules: [],
        botPresets: [],
        botPresetsId: 0,
    } as unknown as Database
    alertGenerationInfoStore.set({
        genInfo: { inputTokens: 1, outputTokens: 1, maxContext: 10, model: 'm', generationId: 'g' },
        idx: 0,
    } as never)
}

/** One alert of every type that covers the page, shaped the way its caller posts it. */
const COVERING_ALERTS: Array<[alertData['type'], alertData]> = [
    ['ask', { type: 'ask', msg: 'Proceed?' }],
    ['pluginconfirm', { type: 'pluginconfirm', msg: 'A plugin\nIt can read data\n\nImport it?' }],
    ['select', { type: 'select', msg: 'One||Two' }],
    ['input', { type: 'input', msg: 'Name?', datalist: [], defaultValue: '' }],
    ['selectChar', { type: 'selectChar', msg: '' }],
    ['addchar', { type: 'addchar', msg: '' }],
    ['chatOptions', { type: 'chatOptions', msg: '' }],
    ['cardexport', { type: 'cardexport', msg: '', submsg: 'module' }],
    ['selectModule', { type: 'selectModule', msg: '' }],
    ['tos', { type: 'tos', msg: 'tos' }],
    ['staleAccountNotice', { type: 'staleAccountNotice', msg: 'stale' }],
    ['progress', { type: 'progress', msg: 'Saving', submsg: '10' }],
    ['normal', { type: 'normal', msg: 'A notice' }],
    ['error', { type: 'error', msg: 'A failure' }],
    ['markdown', { type: 'markdown', msg: 'Some **text**' }],
    ['requestdata', { type: 'requestdata', msg: '' }],
    ['hypaV2', { type: 'hypaV2', msg: '' }],
    ['branches', { type: 'branches', msg: '' }],
    ['requestlogs', { type: 'requestlogs', msg: '' }],
    ['pukmakkurit', { type: 'pukmakkurit', msg: '' }],
    ['wait2', { type: 'wait2', msg: 'Stopped' }],
    ['wait', { type: 'wait', msg: 'Loading...' }],
]

/** Every element the observer saw added, with the elements inside an added subtree included. */
function addedElements(records: MutationRecord[], selector: string): Element[] {
    const found: Element[] = []
    for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
            if (!(node instanceof Element)) {
                continue
            }
            if (node.matches(selector)) {
                found.push(node)
            }
            found.push(...Array.from(node.querySelectorAll(selector)))
        }
    }
    return found
}

/** Collects every mutation under `target` until `stop` is called, whether or not the observer has delivered it yet. */
function watchMutations(target: Element, options: MutationObserverInit): { stop: () => MutationRecord[] } {
    const delivered: MutationRecord[] = []
    const observer = new MutationObserver((records) => {
        delivered.push(...records)
    })
    observer.observe(target, options)
    return {
        stop() {
            const pending = observer.takeRecords()
            observer.disconnect()
            return [...delivered, ...pending]
        },
    }
}

/** Registers the per-test teardown and every scenario; call once at the top level of a test file. */
export function registerAlertCompFocusSuite(): void {
    afterEach(async () => {
        const instances = mountedInstances.splice(0)
        for (const instance of instances) {
            await unmount(instance as never).catch(() => {})
        }
        mountedTargets.splice(0).forEach((t) => t.remove())
        document.body.replaceChildren()
        vi.useRealTimers()
        resetAlertPromptsForTests()
        alertStore.set({ type: 'none', msg: '' } as never)
        vi.clearAllMocks()
    })

    describe('AlertComp.svelte: focus when an alert that covers the page opens', () => {
        test.each(COVERING_ALERTS)('a %s alert takes focus on an element of its own that is not a control', async (_type, alert) => {
            arrangeDatabase()
            const target = mountAlertComp()
            await settle()

            await show(alert)

            const focused = document.activeElement
            expect.soft(target.childElementCount, 'the alert is rendered').toBeGreaterThan(0)
            expect.soft(focused !== document.body && target.contains(focused), `focus is inside the alert (it is on ${describeElement(focused)})`).toBe(true)
            expect.soft(isControl(focused), `focus is on a control (${describeElement(focused)})`).toBe(false)
        })

        test('the composer that held focus before the alert opened does not keep it', async () => {
            arrangeDatabase()
            const composer = document.createElement('textarea')
            document.body.append(composer)
            composer.focus()
            expect(document.activeElement, 'focus before the alert').toBe(composer)
            mountAlertComp()
            await settle()

            await show({ type: 'ask', msg: 'Proceed?' })

            expect(document.activeElement).not.toBe(composer)
        })

        test('a prompt that comes back from under a notice takes focus on an element of its own that is not a control', async () => {
            vi.useFakeTimers()
            arrangeDatabase()
            void alertConfirm('Proceed?')
            const target = mountAlertComp()
            await settle()
            alertNormal('A notice')
            await settle()

            buttonNamed(target, 'OK').click()
            await vi.advanceTimersByTimeAsync(0)
            await settle()

            const prompt = target.querySelector('[style*="display: contents"]')
            const focused = document.activeElement
            expect.soft(target.textContent, 'the notice after it was closed').not.toContain('A notice')
            expect.soft(prompt?.contains(focused) ?? false, `focus is inside the prompt that came back (it is on ${describeElement(focused)})`).toBe(true)
            expect.soft(isControl(focused), `focus is on a control (${describeElement(focused)})`).toBe(false)
        })
    })

    describe('AlertComp.svelte: focus when a prompt is covered and uncovered', () => {
        test('a notice shown over a waiting prompt takes focus on its own box, not on the covered prompt\'s box', async () => {
            vi.useFakeTimers()
            arrangeDatabase()
            void alertConfirm('Proceed?')
            const target = mountAlertComp()
            await settle()

            alertNormal('A notice')
            await settle()

            const focused = document.activeElement
            expect.soft(focused !== document.body && target.contains(focused), `focus is inside the alert (it is on ${describeElement(focused)})`).toBe(true)
            expect.soft(focused?.closest('[inert]') ?? null, 'the inert ancestor of the focused element').toBeNull()
            expect.soft(focused?.closest('[style*="display: contents"]') ?? null, 'the covered prompt\'s wrapper around the focused element').toBeNull()
            expect.soft(isControl(focused), `focus is on a control (${describeElement(focused)})`).toBe(false)
        })

        test('a prompt that comes back after a toast covered it takes focus on its box again', async () => {
            vi.useFakeTimers()
            arrangeDatabase()
            void alertConfirm('Proceed?')
            const target = mountAlertComp()
            await settle()
            alertStore.set({ type: 'toast', msg: 'A toast' } as never)
            await settle()
            // A browser drops focus from a subtree that becomes inert; happy-dom keeps it, so the test does the same.
            ;(document.activeElement as HTMLElement | null)?.blur()
            expect(document.activeElement, 'focus while the toast covers the prompt').toBe(document.body)

            alertStore.set({ type: 'none', msg: '' } as never)
            await vi.advanceTimersByTimeAsync(0)
            await settle()

            const prompt = target.querySelector('[style*="display: contents"]')
            const focused = document.activeElement
            expect.soft(target.textContent, 'the toast after it ended').not.toContain('A toast')
            expect.soft(prompt?.contains(focused) ?? false, `focus is inside the prompt that came back (it is on ${describeElement(focused)})`).toBe(true)
            expect.soft(isControl(focused), `focus is on a control (${describeElement(focused)})`).toBe(false)
        })
    })

    describe('AlertComp.svelte: what is inert inside a covering alert', () => {
        /** The covering alerts whose markup holds at least one button. */
        const WITH_BUTTONS: Array<alertData['type']> = [
            'ask', 'pluginconfirm', 'select', 'input', 'selectChar', 'addchar', 'chatOptions', 'cardexport',
            'selectModule', 'staleAccountNotice', 'normal', 'error', 'markdown', 'requestdata', 'hypaV2',
            'branches', 'requestlogs',
        ]

        test.each(COVERING_ALERTS.filter(([type]) => WITH_BUTTONS.includes(type)))('guard: no button of a %s alert sits inside an inert subtree', async (_type, alert) => {
            arrangeDatabase()
            const target = mountAlertComp()
            await settle()

            await show(alert)

            const buttons = Array.from(target.querySelectorAll('button'))
            expect.soft(buttons.length, 'the buttons the alert renders').toBeGreaterThan(0)
            expect(buttons.filter((button) => button.closest('[inert]') !== null).map((button) => button.textContent?.trim()), 'the buttons inside an inert subtree').toEqual([])
        })

        test('guard: a prompt covered by a notice is inert and the notice is not', async () => {
            vi.useFakeTimers()
            arrangeDatabase()
            void alertConfirm('Proceed?')
            const target = mountAlertComp()
            await settle()

            alertNormal('A notice')
            await settle()

            expect.soft(buttonNamed(target, 'YES').closest('[inert]'), 'the covered prompt\'s button').not.toBeNull()
            expect.soft(buttonNamed(target, 'OK').closest('[inert]'), 'the notice\'s button').toBeNull()
        })
    })

    describe('AlertComp.svelte: focus when one alert replaces another', () => {
        test('a new error replacing an error whose "Show details" button holds focus takes focus on an element that is not a control', async () => {
            arrangeDatabase()
            const target = mountAlertComp()
            await show({ type: 'error', msg: 'First failure', stackTrace: 'Error: first\n    at a' })
            const details = buttonNamed(target, language.showErrorDetails)
            details.focus()
            expect(document.activeElement, 'focus before the replacement').toBe(details)

            await show({ type: 'error', msg: 'Second failure', stackTrace: 'Error: second\n    at b' })

            const focused = document.activeElement
            expect.soft(target.textContent, 'the alert on screen').toContain('Second failure')
            expect.soft(isControl(focused), `focus is on a control (${describeElement(focused)})`).toBe(false)
            expect.soft(focused !== document.body && target.contains(focused), `focus is inside the alert (it is on ${describeElement(focused)})`).toBe(true)
        })

        test('guard: a wait alert re-emitted with new text leaves focus on its Cancel button', async () => {
            arrangeDatabase()
            const target = mountAlertComp()
            const onCancel = vi.fn()
            await show({ type: 'wait', msg: 'Loading 1', onCancel })
            const cancel = buttonNamed(target, language.cancel)
            cancel.focus()
            expect(document.activeElement, 'focus before the update').toBe(cancel)

            await show({ type: 'wait', msg: 'Loading 2', onCancel })

            expect.soft(target.textContent, 'the alert on screen').toContain('Loading 2')
            expect.soft(document.activeElement, 'focus after the update').toBe(cancel)
        })
    })

    describe('AlertComp.svelte: what a new alert renders and inherits', () => {
        test('a new prompt is rendered once, as the held dialog, never first as the live alert', async () => {
            arrangeDatabase()
            const target = mountAlertComp()
            await settle()
            const watch = watchMutations(target, { childList: true, subtree: true })

            await show({ type: 'ask', msg: 'Proceed?' })

            const boxes = addedElements(watch.stop(), '[data-alert-box]')
            expect(boxes.length, 'alert boxes added while the prompt appeared').toBe(1)
            expect(target.querySelectorAll('[data-alert-box]').length, 'alert boxes on screen').toBe(1)
        })

        test('unmounting the alert leaves no subscription on the store', async () => {
            arrangeDatabase()
            // The prompt controller watches the store for as long as the app runs; it starts before the spy so only the component's own subscriptions are counted.
            alertIdle.subscribe(() => {})()
            let active = 0
            const subscribe = alertStore.subscribe.bind(alertStore)
            const spy = vi.spyOn(alertStore, 'subscribe').mockImplementation((run, invalidate) => {
                active += 1
                const stop = subscribe(run, invalidate)
                return () => {
                    active -= 1
                    stop()
                }
            })
            const subscribeIdle = alertIdle.subscribe.bind(alertIdle)
            const idleSpy = vi.spyOn(alertIdle, 'subscribe').mockImplementation((run, invalidate) => {
                active += 1
                const stop = subscribeIdle(run, invalidate)
                return () => {
                    active -= 1
                    stop()
                }
            })
            try {
                mountAlertComp()
                await show({ type: 'ask', msg: 'Proceed?' })
                expect(active, 'subscriptions while the alert is mounted').toBeGreaterThan(0)

                await unmount(mountedInstances.pop() as never)

                expect(active, 'subscriptions left after the alert was unmounted').toBe(0)
            } finally {
                idleSpy.mockRestore()
                spy.mockRestore()
            }
        })

        test('guard: focus ends in the held dialog of a new prompt', async () => {
            arrangeDatabase()
            const target = mountAlertComp()
            await settle()

            await show({ type: 'ask', msg: 'Proceed?' })

            const held = target.querySelector('[style*="display: contents"]')
            const focused = document.activeElement
            expect(held, 'the held dialog wrapper').not.toBeNull()
            expect(held?.contains(focused) ?? false, `focus is inside the held dialog (it is on ${describeElement(focused)})`).toBe(true)
        })

        test('an input prompt keeps its typed text when a notice over it is closed, with the component mounted before the prompt was asked', async () => {
            vi.useFakeTimers()
            arrangeDatabase()
            const target = mountAlertComp()
            await settle()
            void alertInput('Name?', [], 'Default')
            await settle()
            typeIntoPrompt(target, 'typed text')
            alertNormal('A notice')
            await settle()

            buttonNamed(target, 'OK').click()
            await vi.advanceTimersByTimeAsync(0)
            await settle()

            expect(promptField(target).value, 'the field after the notice was closed').toBe('typed text')
        })

        test('an input prompt keeps its typed text when a consent posted over it is answered, with the component mounted before the prompt was asked', async () => {
            vi.useFakeTimers()
            arrangeDatabase()
            const target = mountAlertComp()
            await settle()
            void alertInput('Name?', [], 'Default')
            await settle()
            typeIntoPrompt(target, 'typed text')

            alertStore.set({ type: 'tos', msg: 'tos' } as never)
            alertStore.set({ type: 'none', msg: 'accepted' } as never)
            await vi.advanceTimersByTimeAsync(0)
            await settle()

            expect(promptField(target).value, 'the field after the consent was answered').toBe('typed text')
        })

        test('the request log list comes back collapsed after another alert replaced it', async () => {
            arrangeDatabase()
            const target = mountAlertComp()
            await show({ type: 'requestlogs', msg: '' })
            buttonNamed(target, language.expandAll).click()
            await settle()
            expect(buttonNamed(target, language.collapseAll), 'the list is expanded').toBeTruthy()

            await show({ type: 'normal', msg: 'A notice' })
            await show({ type: 'requestlogs', msg: '' })

            expect(buttonNamed(target, language.expandAll), 'the list after it came back').toBeTruthy()
        })

        test('the branch tooltip of a closed branch view is gone when the view comes back', async () => {
            arrangeDatabase()
            DBState.db.characters[0].chats[0].message = [{ role: 'user', data: 'Tooltip text' }] as never
            vi.mocked(getChatBranches).mockReturnValueOnce([{ x: 0, y: 1, chatId: 0, connectX: -1, multiChild: false }] as never)
            const target = mountAlertComp()
            await show({ type: 'branches', msg: '' })
            target.querySelector('[role="table"]')?.dispatchEvent(new MouseEvent('mouseenter'))
            await settle()
            expect(target.textContent, 'the tooltip while the view is open').toContain('Tooltip text')

            await show({ type: 'normal', msg: 'A notice' })
            await show({ type: 'branches', msg: '' })

            expect(target.textContent, 'the tooltip after the view came back').not.toContain('Tooltip text')
        })

        test('guard: a new error alert shown while the details of the previous one were open does not keep those details', async () => {
            arrangeDatabase()
            const target = mountAlertComp()
            await show({ type: 'error', msg: 'First failure', stackTrace: 'Error: first\n    at a' })
            buttonNamed(target, language.showErrorDetails).click()
            await settle()
            expect(target.querySelector('.stack-trace'), 'details of the first error are open').not.toBeNull()
            // The screen at each DOM change; a change that is not delivered before the update settles is not seen.
            const frames: Array<{ secondShown: boolean, detailsOpen: boolean }> = []
            const observer = new MutationObserver(() => {
                frames.push({
                    secondShown: (target.textContent ?? '').includes('Second failure'),
                    detailsOpen: target.querySelector('.stack-trace') !== null,
                })
            })
            observer.observe(target, { childList: true, subtree: true, characterData: true })

            await show({ type: 'error', msg: 'Second failure', stackTrace: 'Error: second\n    at b' })

            observer.disconnect()
            expect(target.querySelector('.stack-trace'), 'details after the replacement').toBeNull()
            expect(frames.some((frame) => frame.secondShown), 'the second error reached the screen').toBe(true)
            expect(frames.filter((frame) => frame.secondShown && frame.detailsOpen), 'frames of the second error with details open').toEqual([])
        })
    })
}
