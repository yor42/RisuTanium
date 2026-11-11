/**
 * The block-teardown focus scenarios, registered by both `focusSettle.blockTeardown.svelte.test.ts` (the shipped
 * scheduler) and `focusSettle.blockTeardown.asyncOrder.svelte.test.ts` (the async scheduler), so each scenario runs
 * under both schedulers with no copy.
 *
 * Focus listeners write `$state` while a Svelte block removes the focused field. Chromium fires focusout
 * synchronously during that removal, on the stack of the block effect, where a state write throws. Two listener kinds
 * exist: a raw `addEventListener` listener runs on that stack and must defer its write (`createFocusSettle`); a
 * template handler (`onfocusout`, `onblur`) is run by Svelte outside the reactive context and may write at once.
 *
 * Two triggers remove the field. The effect trigger (`hide()`) writes the block's condition inside an effect, which
 * re-runs the block eagerly in either scheduler, so the removal stays on the block effect's stack. The direct trigger
 * (`hideDirect()`) writes it from an event-handler position: the shipped scheduler removes the field on the block
 * effect's stack, the async scheduler defers the removal to the batch commit, outside every block effect.
 *
 * (D1) Positive control, a diagnostic that asserts the failure: a raw listener writing at once records
 * `state_unsafe_mutation` when the effect trigger removes the field, which proves the harness dispatches inside the
 * block and the other cases are not vacuous. Only the effect trigger asserts it.
 * (G2) A raw listener writing through the settle records nothing, and the state is the final focus.
 * (G3) Framework pin: both template handler forms write at once without error. It fails if a Svelte upgrade drops the
 * handler-context rule that the audit of the commit-on-blur handlers rests on.
 * G2 and G3 also run under the direct trigger as compatibility guards: no throw and the same final-focus values
 * under both schedulers, so a teardown defect on the event-handler path is still caught.
 * Removal is emulated as Chromium orders it: the focused node is blurred (focusout) while still attached, then removed.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import FocusSettleTeardownHarness from './tests/FocusSettleTeardownHarness.svelte'

type Trigger = 'hide' | 'hideDirect'
type Host = { hide(): void, hideDirect(): void, values(): { rawSync: string, rawSettled: string, delegated: string, direct: string } }

export function registerFocusSettleTeardownSuite(): void {
    let app: ReturnType<typeof mount> | undefined
    let target: HTMLElement
    let errors: string[]

    const record = (event: ErrorEvent) => {
        event.preventDefault()
        errors.push(String((event.error as Error | undefined)?.message ?? event.message))
    }

    beforeEach(() => {
        errors = []
        window.addEventListener('error', record)
        target = document.createElement('div')
        document.body.append(target)
        app = mount(FocusSettleTeardownHarness, { target })
        flushSync()
    })

    afterEach(() => {
        if (app) unmount(app)
        app = undefined
        window.removeEventListener('error', record)
        vi.restoreAllMocks()
        document.body.replaceChildren()
    })

    function removeWhileFocused(part: string, trigger: Trigger): void {
        const field = target.querySelector<HTMLInputElement>(`[data-part="${part}"]`)!
        field.focus()
        expect(document.activeElement).toBe(field)
        const originalRemove = Element.prototype.remove
        vi.spyOn(Element.prototype, 'remove').mockImplementation(function (this: Element) {
            const active = this.ownerDocument.activeElement
            if (active && this.contains(active)) (active as HTMLElement).blur()
            originalRemove.call(this)
        })
        ;(app as unknown as Host)[trigger]()
        flushSync()
        vi.restoreAllMocks()
        expect(target.querySelector(`[data-part="${part}"]`)).toBeNull()
    }

    const values = () => (app as unknown as Host).values()

    describe('focus listeners during block teardown', () => {
        test('(D1) a raw listener writing state at once throws state_unsafe_mutation inside the block', async () => {
            removeWhileFocused('raw-sync', 'hide')
            await tick()
            expect(errors.some((message) => message.includes('state_unsafe_mutation'))).toBe(true)
            expect(values().rawSync).toBe('none')
        })

        for (const trigger of ['hide', 'hideDirect'] as const) {
            test(`(G2, ${trigger}) a raw listener writing through the focus settle throws nothing and ends on the final focus`, async () => {
                removeWhileFocused('raw-settled', trigger)
                expect(errors).toEqual([])
                expect(values().rawSettled).toBe('none')
                await Promise.resolve()
                flushSync()
                expect(errors).toEqual([])
                expect(values().rawSettled).toBe('outside')
            })

            test(`(G3, ${trigger}) delegated onfocusout and direct onblur write at once during the same teardown without error`, async () => {
                removeWhileFocused('delegated', trigger)
                expect(errors).toEqual([])
                expect(values().delegated).toBe('outside')

                unmount(app!)
                app = mount(FocusSettleTeardownHarness, { target })
                flushSync()
                removeWhileFocused('direct', trigger)
                expect(errors).toEqual([])
                expect(values().direct).toBe('outside')
            })
        }
    })
}
