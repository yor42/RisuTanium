import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../stores.svelte', () => ({
    DBState: { db: {} as Record<string, unknown> },
}))
vi.mock('../tokenizer', () => ({
    ChatTokenizer: class {
        constructor(_a: number, _b: string) {}
        async tokenizeChat() { return 7 }
    },
    tokenize: vi.fn(async (text: string) => text?.length ?? 0),
}))

import { DBState } from '../stores.svelte'
import { settleRecoveredUsage } from './usageCapture'
import { createUsageMeter } from './usageMeter'
import type { ReplyUsageContext } from '../nativeReply/blob'

/**
 * `settleRecoveredUsage`: the usage of a reply recovered from a native record, settled once from the record's blob. The
 * model and the input estimate are the blob's, never the settings'; the purpose is the main send's. The rules are the live
 * ones: reported usage if the replay found any, else an estimate unless the settlement is `failed`. Mutant M19 (model read
 * from the current settings).
 *
 * MOCKED: `stores.svelte` (a plain `DBState`) and the tokenizer. The capture, the ledger and the retention gate are real.
 */

const context: ReplyUsageContext = { modelKey: 'gpt-4o', inputEstimate: 120 }

let statics: Record<string, unknown>

beforeEach(() => {
    statics = { messages: 0 }
    ;(DBState as unknown as { db: Record<string, unknown> }).db = { statics, aiModel: 'another-model' }
})

const entries = (): Record<string, unknown> => Object.fromEntries(
    Object.entries(statics).filter(([key]) => key.startsWith('u1|')).map(([key, value]) => [key.split('|').slice(2).join('|'), value]),
)

describe('settleRecoveredUsage', () => {
    test('reported usage is one entry under the blob\'s model and the chat purpose', () => {
        const meter = createUsageMeter()
        meter.report({ input: 10, output: 5, cacheRead: 2, cacheWrite: 1 })
        settleRecoveredUsage(context, meter, 'finished', 'a reply')
        expect(entries()).toEqual({ 'chat|n|gpt-4o': 1, 'chat|i|gpt-4o': 10, 'chat|o|gpt-4o': 5, 'chat|cr|gpt-4o': 2, 'chat|cw|gpt-4o': 1 })
    })

    test('without reported usage it records one estimate: the blob\'s input and the text\'s output', async () => {
        settleRecoveredUsage(context, createUsageMeter(), 'finished', 'a reply')
        await vi.waitFor(() => expect(entries()).toEqual({ 'chat|n|gpt-4o': 1, 'chat|ei|gpt-4o': 120, 'chat|eo|gpt-4o': 7 }))
    })

    test('a failed settlement counts reported usage only', async () => {
        settleRecoveredUsage(context, createUsageMeter(), 'failed', 'a reply')
        await new Promise((resolve) => setTimeout(resolve, 5))
        expect(entries()).toEqual({})
        const meter = createUsageMeter()
        meter.report({ input: 3, output: 4, cacheRead: 0, cacheWrite: 0 })
        settleRecoveredUsage(context, meter, 'failed', 'a reply')
        expect(entries()).toEqual({ 'chat|n|gpt-4o': 1, 'chat|i|gpt-4o': 3, 'chat|o|gpt-4o': 4 })
    })

    test('a meter marked failed counts no estimate', async () => {
        const meter = createUsageMeter()
        meter.markFailed()
        settleRecoveredUsage(context, meter, 'finished', 'a reply')
        await new Promise((resolve) => setTimeout(resolve, 5))
        expect(entries()).toEqual({})
    })

    test('it never throws, even with no database', () => {
        ;(DBState as unknown as { db: unknown }).db = undefined
        expect(() => settleRecoveredUsage(context, createUsageMeter(), 'finished', 'x')).not.toThrow()
    })
})
