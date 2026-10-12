/**
 * Pure layer of the LiteLLM dataset: what is kept from the download, how it is
 * stored and read back, and how a catalog model finds its row. The fixture is a
 * trimmed subset of the real dataset in its raw shape (see README.md next to it).
 *
 * Labels: (F) feature test that fails against a missing or wrong implementation
 * on its own assertion; (G) guard that passes with any implementation of the
 * same contract.
 */
import { describe, test, expect, vi, afterEach } from 'vitest'
import { LLMProvider } from '../../types'
import {
    LITELLM_MAX_BODY_BYTES,
    LITELLM_MAX_FILE_BYTES,
    LITELLM_MAX_ROWS,
    buildLiteLLMIndex,
    decodeLiteLLMData,
    encodeLiteLLMData,
    isRowKey,
    mergeLiteLLMRows,
    parseLiteLLMDataset,
    parseLiteLLMText,
    resolveLiteLLMRow,
    type LiteLLMData,
    type LiteLLMRow,
} from '../litellmData'
import type { ModelDataLookupModel } from '../openrouterData'
import fixture from './litellm.fixture.json'

const NOW = 1_800_000_000_000

afterEach(() => {
    vi.restoreAllMocks()
})

function parsedFixture(): LiteLLMData {
    const data = parseLiteLLMDataset(fixture, NOW)
    if (data === null) {
        throw new Error('the fixture must parse')
    }
    return data
}

function bytesOf(value: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(value))
}

function chatRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { litellm_provider: 'openai', mode: 'chat', max_input_tokens: 1000, ...extra }
}

function model(provider: LLMProvider, id: string, internalID?: string): ModelDataLookupModel {
    return internalID === undefined ? { id, provider } : { id, provider, internalID }
}

describe('parseLiteLLMDataset: what is kept', () => {
    test('(F) keeps chat and responses rows of the allowed providers with limits, prices and flags', () => {
        const rows = parsedFixture().rows
        expect(rows['gpt-4o']).toEqual({
            p: 'openai',
            m: 'chat',
            ctx: 128000,
            out: 16384,
            price: { input: '0.0000025', output: '0.00001', cacheRead: '0.00000125' },
            vis: true,
        })
        expect(rows['gpt-4'].dep).toBe('2026-10-23')
        expect(rows['gpt-5-pro'].m).toBe('responses')
        expect(rows['gpt-5-pro'].ep).toEqual(['responses'])
        expect(rows['gpt-4.1-2025-04-14'].ep).toEqual(['chat', 'responses'])
        expect(rows['gpt-4o'].ep).toBeUndefined()
        expect(rows['claude-sonnet-4-5'].price?.cacheWrite).toBe('0.00000375')
        expect(rows['gemini/gemini-2.5-flash'].p).toBe('gemini')
        expect(rows['gemini-2.5-flash'].p).toBe('vertex_ai-language-models')
        expect(rows['gemini/gemini-pro-latest'].om).toEqual(['text'])
    })

    test('(G) drops modes other than chat and responses', () => {
        const rows = parsedFixture().rows
        expect(rows['text-embedding-3-small']).toBeUndefined()
        expect(rows['ft:babbage-002']).toBeUndefined()
        expect(rows['gemini/gemini-live-2.5-flash-preview-native-audio-09-2025']).toBeUndefined()
    })

    test('(F) drops providers outside the allowlist and the sample_spec row', () => {
        const rows = parsedFixture().rows
        expect(rows['azure/gpt-4o']).toBeUndefined()
        expect(rows['sample_spec']).toBeUndefined()
        const data = parseLiteLLMDataset({
            keep: chatRow(),
            other: chatRow({ litellm_provider: 'openrouter' }),
            junk: chatRow({ litellm_provider: 5 }),
        })
        expect(Object.keys(data?.rows ?? {})).toEqual(['keep'])
    })

    test('(F) writes a number price as a decimal string and rejects negative, non-finite and string prices', () => {
        const data = parseLiteLLMDataset({
            a: chatRow({ input_cost_per_token: 1.5e-7, output_cost_per_token: 0 }),
            b: chatRow({ input_cost_per_token: -1, output_cost_per_token: '0.1', cache_read_input_token_cost: null }),
            c: chatRow({ input_cost_per_token: Number.POSITIVE_INFINITY, output_cost_per_token: 2 }),
        })
        expect(data?.rows['a'].price).toEqual({ input: '1.5e-7', output: '0' })
        expect(data?.rows['b'].price).toBeUndefined()
        expect(data?.rows['c'].price).toEqual({ output: '2' })
    })

    test('(F) a row needs a usable context or a price', () => {
        const data = parseLiteLLMDataset({
            none: { litellm_provider: 'openai', mode: 'chat' },
            zero: chatRow({ max_input_tokens: 0 }),
            fraction: chatRow({ max_input_tokens: 1.5 }),
            text: chatRow({ max_input_tokens: '1000' }),
            ctxOnly: chatRow(),
            priceOnly: { litellm_provider: 'openai', mode: 'chat', input_cost_per_token: 0.5 },
        })
        expect(Object.keys(data?.rows ?? {}).sort()).toEqual(['ctxOnly', 'priceOnly'])
    })

    test('(F) keeps only a well-formed deprecation date, known endpoints and plain modality words', () => {
        const data = parseLiteLLMDataset({
            a: chatRow({ deprecation_date: '2026-10-23', supported_endpoints: ['/v1/chat/completions', '/v1/batch', 7], supported_output_modalities: ['text', 'Audio', '<img>'] }),
            b: chatRow({ deprecation_date: 'date when the model becomes deprecated in the format YYYY-MM-DD', supported_endpoints: ['/v1/batch'] }),
            c: chatRow({ supported_output_modalities: 'text' }),
        })
        expect(data?.rows['a'].dep).toBe('2026-10-23')
        expect(data?.rows['a'].ep).toEqual(['chat'])
        expect(data?.rows['a'].om).toEqual(['text'])
        expect(data?.rows['b'].dep).toBeUndefined()
        expect(data?.rows['b'].ep).toBeUndefined()
        expect(data?.rows['c'].om).toBeUndefined()
    })

    test('(F) anything that is not a usable dataset is null', () => {
        expect(parseLiteLLMDataset(null)).toBeNull()
        expect(parseLiteLLMDataset([])).toBeNull()
        expect(parseLiteLLMDataset('rows')).toBeNull()
        expect(parseLiteLLMDataset({})).toBeNull()
        expect(parseLiteLLMDataset({ sample_spec: {} })).toBeNull()
        expect(parseLiteLLMDataset({ a: chatRow({ mode: 'embedding' }) })).toBeNull()
    })

    test('(G) stamps fetchedAt, defaulting to 0', () => {
        expect(parsedFixture().fetchedAt).toBe(NOW)
        expect(parseLiteLLMDataset({ a: chatRow() })?.fetchedAt).toBe(0)
    })

    test('(F) more than the row cap is null', () => {
        const rows: Record<string, unknown> = {}
        for (let i = 0; i <= LITELLM_MAX_ROWS; i++) {
            rows['m' + i] = chatRow()
        }
        expect(parseLiteLLMDataset(rows)).toBeNull()
        delete rows['m0']
        expect(Object.keys(parseLiteLLMDataset(rows)?.rows ?? {})).toHaveLength(LITELLM_MAX_ROWS)
    })

    test('(F) a snapshot that would encode above the file cap is null', () => {
        const rows: Record<string, unknown> = {}
        for (let i = 0; i < 4600; i++) {
            rows['m' + String(i).padStart(4, '0') + 'x'.repeat(195)] = chatRow()
        }
        expect(parseLiteLLMDataset(rows)).toBeNull()
    })
})

describe('row-key rule and hostile keys', () => {
    test('(F) the row-key rule keeps : and / and drops @, *, a leading symbol and long keys', () => {
        expect(isRowKey('gpt-4o')).toBe(true)
        expect(isRowKey('gemini/gemini-2.5-flash')).toBe(true)
        expect(isRowKey('anthropic.claude-opus-4-5-20251101-v1:0')).toBe(true)
        expect(isRowKey('anthropic.claude-haiku-4-5@20251001')).toBe(false)
        expect(isRowKey('bedrock/*/1-month-commitment/cohere.command-text-v14')).toBe(false)
        expect(isRowKey('__proto__')).toBe(false)
        expect(isRowKey('<img onerror=alert(1)>')).toBe(false)
        expect(isRowKey('')).toBe(false)
        expect(isRowKey('a'.repeat(200))).toBe(true)
        expect(isRowKey('a'.repeat(201))).toBe(false)
        expect(isRowKey(5)).toBe(false)
    })

    test('(F) rows with hostile keys are dropped and the rest survive', () => {
        const hostile = ['__proto__', '<img onerror=alert(1)>', ' gpt-x', 'a'.repeat(10 * 1024), 'x\u0000y', '../x', 'a|b']
        const json = JSON.parse('{"ok":' + JSON.stringify(chatRow()) + ',"__proto__":' + JSON.stringify(chatRow()) + '}') as Record<string, unknown>
        for (const key of hostile) {
            json[key] = chatRow()
        }
        const data = parseLiteLLMDataset(json)
        expect(Object.keys(data?.rows ?? {}).sort()).toEqual(['ok'])
    })

    test('(F) rows are a null-prototype dictionary, so inherited names are not rows', () => {
        const data = parseLiteLLMDataset({ a: chatRow() })
        expect(Object.getPrototypeOf(data?.rows)).toBeNull()
        expect(data?.rows['constructor']).toBeUndefined()
        const named = parseLiteLLMDataset({ constructor: chatRow({ max_input_tokens: 7 }) })
        expect(named?.rows['constructor']?.ctx).toBe(7)
        const decoded = decodeLiteLLMData(encodeLiteLLMData({ v: 1, fetchedAt: NOW, rows: { a: { p: 'openai', m: 'chat', ctx: 1 } } }) ?? new Uint8Array())
        expect(Object.getPrototypeOf(decoded?.rows)).toBeNull()
        expect(decoded?.rows['toString']).toBeUndefined()
    })
})

describe('parseLiteLLMText: the download body', () => {
    test('(F) parses a body inside the cap', () => {
        const data = parseLiteLLMText(JSON.stringify({ a: chatRow() }), NOW)
        expect(Object.keys(data?.rows ?? {})).toEqual(['a'])
        expect(data?.fetchedAt).toBe(NOW)
    })

    test('(F) a body inside the cap parses whatever its length times three: ASCII padding and 2-byte characters', () => {
        const padded = JSON.stringify({ a: chatRow() }) + ' '.repeat(3_000_000)
        expect(Object.keys(parseLiteLLMText(padded)?.rows ?? {})).toEqual(['a'])
        // 3.5 million 2-byte characters are 7 MB: under the cap in bytes, over it at three bytes per character.
        const wide = JSON.stringify({ a: chatRow(), note: '\u00e9'.repeat(3_500_000) })
        expect(Object.keys(parseLiteLLMText(wide)?.rows ?? {})).toEqual(['a'])
    })

    test('(G) a body above 8 MB is rejected before JSON.parse, counted in bytes', () => {
        const spy = vi.spyOn(JSON, 'parse')
        expect(parseLiteLLMText('x'.repeat(LITELLM_MAX_BODY_BYTES + 1))).toBeNull()
        // 3 bytes per character: fewer characters than the cap, more bytes than the cap.
        expect(parseLiteLLMText('€'.repeat(Math.floor(LITELLM_MAX_BODY_BYTES / 3) + 1))).toBeNull()
        expect(spy).not.toHaveBeenCalled()
    })

    test('(G) text that is not JSON is null', () => {
        expect(parseLiteLLMText('<html>not json')).toBeNull()
        expect(parseLiteLLMText('')).toBeNull()
    })
})

describe('encode and decode the stored file', () => {
    test('(F) round trips the fixture', () => {
        const data = parsedFixture()
        const bytes = encodeLiteLLMData(data)
        expect(bytes).not.toBeNull()
        expect(decodeLiteLLMData(bytes ?? new Uint8Array())).toEqual(data)
    })

    test('(G) encode returns null above the file cap', () => {
        const rows: Record<string, LiteLLMRow> = {}
        for (let i = 0; i < 4600; i++) {
            rows['m' + i + 'x'.repeat(195)] = { p: 'openai', m: 'chat', ctx: 1 }
        }
        expect(encodeLiteLLMData({ v: 1, fetchedAt: NOW, rows })).toBeNull()
    })

    test('(G) the stored length is checked before JSON.parse', () => {
        const spy = vi.spyOn(JSON, 'parse')
        expect(decodeLiteLLMData(new Uint8Array(LITELLM_MAX_FILE_BYTES + 1).fill(0x20))).toBeNull()
        expect(spy).not.toHaveBeenCalled()
    })

    test('(G) corrupt, foreign and old-version files are null', () => {
        expect(decodeLiteLLMData(new TextEncoder().encode('not json'))).toBeNull()
        expect(decodeLiteLLMData(new Uint8Array([0xff, 0xfe, 0x00]))).toBeNull()
        expect(decodeLiteLLMData(bytesOf([]))).toBeNull()
        expect(decodeLiteLLMData(bytesOf({ v: 2, fetchedAt: NOW, rows: {} }))).toBeNull()
        expect(decodeLiteLLMData(bytesOf({ v: 1, fetchedAt: 'now', rows: {} }))).toBeNull()
        expect(decodeLiteLLMData(bytesOf({ v: 1, fetchedAt: NOW, rows: [] }))).toBeNull()
    })

    test('(F) a bad row is dropped alone and unknown fields are ignored', () => {
        const data = decodeLiteLLMData(bytesOf({
            v: 1,
            fetchedAt: NOW,
            future: { x: 1 },
            rows: {
                good: { p: 'openai', m: 'chat', ctx: 5, extra: 'ignored' },
                badProvider: { p: 'azure', m: 'chat', ctx: 5 },
                badMode: { p: 'openai', m: 'embedding', ctx: 5 },
                alsoGood: { p: 'openai', m: 'chat', ctx: 5 },
                empty: { p: 'openai', m: 'chat' },
                badPrice: { p: 'openai', m: 'chat', price: { input: 'abc', output: '-1' } },
                text: 'row',
                mixed: { p: 'anthropic', m: 'responses', ctx: 9, dep: 'tomorrow', ep: ['chat', 'batch', 3], om: ['text', '<b>'], vis: 'yes' },
                '<img onerror=alert(1)>': { p: 'openai', m: 'chat', ctx: 5 },
            },
        }))
        expect(Object.keys(data?.rows ?? {}).sort()).toEqual(['alsoGood', 'good', 'mixed'])
        expect(data?.rows['good']).toEqual({ p: 'openai', m: 'chat', ctx: 5 })
        expect(data?.rows['mixed']).toEqual({ p: 'anthropic', m: 'responses', ctx: 9, ep: ['chat'], om: ['text'] })
    })

    test('(G) more than the row cap in a stored file is null', () => {
        const rows: Record<string, unknown> = {}
        for (let i = 0; i <= LITELLM_MAX_ROWS; i++) {
            rows['m' + i] = { p: 'openai', m: 'chat', ctx: 1 }
        }
        expect(decodeLiteLLMData(bytesOf({ v: 1, fetchedAt: NOW, rows }))).toBeNull()
    })
})

describe('mergeLiteLLMRows', () => {
    test('(F) a field is kept only when every row has it and all agree', () => {
        const merged = mergeLiteLLMRows([
            { p: 'anthropic', m: 'chat', ctx: 100, out: 10, price: { input: '1', output: '2' }, vis: true },
            { p: 'anthropic', m: 'chat', ctx: 200, out: 10, price: { input: '1', output: '3' } },
        ])
        expect(merged.ctx).toBeUndefined()
        expect(merged.out).toBe(10)
        expect(merged.price).toEqual({ input: '1' })
        expect(merged.vis).toBeUndefined()
    })

    test('(G) a single row is returned as is', () => {
        const row: LiteLLMRow = { p: 'openai', m: 'chat', ctx: 1 }
        expect(mergeLiteLLMRows([row])).toEqual(row)
    })
})

describe('resolveLiteLLMRow: a catalog model finds its row', () => {
    const index = () => buildLiteLLMIndex(parsedFixture())

    test('(F) an OpenAI model matches its internalID exactly and a generated twin matches its base', () => {
        expect(resolveLiteLLMRow(index(), model(LLMProvider.OpenAI, 'gpt4o', 'gpt-4o'))?.ctx).toBe(128000)
        expect(resolveLiteLLMRow(index(), model(LLMProvider.OpenAI, 'gpt-5-pro-response-api'))?.ctx).toBe(400000)
    })

    test('(F) a Google model reads the gemini rows, a Vertex model the vertex rows', () => {
        expect(resolveLiteLLMRow(index(), model(LLMProvider.GoogleCloud, 'x', 'models/gemini-2.5-flash'))?.p).toBe('gemini')
        expect(resolveLiteLLMRow(index(), model(LLMProvider.VertexAI, 'gemini-2.5-pro-vertex'))?.p).toBe('vertex_ai-language-models')
    })

    test('(F) an alias spelling falls back to the one canonical form', () => {
        expect(resolveLiteLLMRow(index(), model(LLMProvider.Anthropic, 'x', 'claude-sonnet-4-5-20251231'))?.ctx).toBe(200000)
        expect(resolveLiteLLMRow(index(), model(LLMProvider.Anthropic, 'x', 'claude-sonnet-4-5-20250929'))?.ctx).toBe(200000)
    })

    test('(F) canonical rows that disagree leave that field unknown', () => {
        const data: LiteLLMData = {
            v: 1,
            fetchedAt: NOW,
            rows: Object.assign(Object.create(null) as Record<string, LiteLLMRow>, {
                'claude-z-1-20250101': { p: 'anthropic', m: 'chat', ctx: 100, price: { input: '1' } },
                'claude-z-1-20250202': { p: 'anthropic', m: 'chat', ctx: 200, price: { input: '1' } },
            }),
        }
        const row = resolveLiteLLMRow(buildLiteLLMIndex(data), model(LLMProvider.Anthropic, 'x', 'claude-z-1-20250303'))
        expect(row?.ctx).toBeUndefined()
        expect(row?.price?.input).toBe('1')
    })

    test('(G) a model of another family or without a row has none, and a lookup never throws', () => {
        expect(resolveLiteLLMRow(index(), model(LLMProvider.OpenAI, 'x', 'gemini-2.5-flash'))).toBeUndefined()
        expect(resolveLiteLLMRow(index(), model(LLMProvider.OpenAI, 'x', 'gpt-nothing'))).toBeUndefined()
        expect(resolveLiteLLMRow(index(), model(LLMProvider.AsIs, 'gpt-4o'))).toBeUndefined()
        expect(resolveLiteLLMRow(index(), model(LLMProvider.OpenAI, ''))).toBeUndefined()
        expect(() => resolveLiteLLMRow(index(), { id: undefined as unknown as string, provider: LLMProvider.OpenAI })).not.toThrow()
    })

    // (G) passes before and after the row-key rule: the rows it drops never held a limit
    // that a catalog model reads, so dropping them changes no lookup.
    test('(G) the limits of every AWS Bedrock Claude id and built-in are the same with and without the dropped rows', () => {
        const aws = [
            'anthropic.claude-opus-4-6-v1',
            'anthropic.claude-opus-4-5-20251101-v1:0',
            'anthropic.claude-sonnet-4-5-20250929-v1:0',
            'anthropic.claude-opus-4-1-20250805-v1:0',
            'anthropic.claude-opus-4-20250514-v1:0',
            'anthropic.claude-sonnet-4-20250514-v1:0',
            'anthropic.claude-3-7-sonnet-20250219-v1:0',
            'anthropic.claude-3-5-sonnet-20241022-v2:0',
            'anthropic.claude-3-5-sonnet-20240620-v1:0',
            'anthropic.claude-3-opus-20240229-v1:0',
            'anthropic.claude-3-sonnet-20240229-v1:0',
        ]
        const models = [
            ...aws.map(id => model(LLMProvider.AWS, id)),
            model(LLMProvider.OpenAI, 'gpt4o', 'gpt-4o'),
            model(LLMProvider.OpenAI, 'gpt-4.1', 'gpt-4.1'),
            model(LLMProvider.Anthropic, 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-5-20250929'),
            model(LLMProvider.GoogleCloud, 'gemini-2.5-pro', 'models/gemini-2.5-pro'),
            model(LLMProvider.DeepSeek, 'deepseek-chat'),
            model(LLMProvider.Mistral, 'mistral-large-latest'),
            model(LLMProvider.Cohere, 'command-r-08-2024'),
        ]
        const dropped = new Set(['anthropic.claude-haiku-4-5@20251001', 'bedrock/*/1-month-commitment/cohere.command-light-text-v14', 'bedrock/*/1-month-commitment/cohere.command-text-v14'])
        const without = Object.fromEntries(Object.entries(fixture).filter(([key]) => !dropped.has(key)))
        const full = buildLiteLLMIndex(parsedFixture())
        const trimmed = buildLiteLLMIndex(parseLiteLLMDataset(without, NOW) ?? { v: 1, fetchedAt: NOW, rows: {} })
        for (const m of models) {
            expect(resolveLiteLLMRow(full, m)).toEqual(resolveLiteLLMRow(trimmed, m))
        }
        expect(aws.filter(id => resolveLiteLLMRow(full, model(LLMProvider.AWS, id)) !== undefined)).toHaveLength(10)
        expect(resolveLiteLLMRow(full, model(LLMProvider.AWS, 'anthropic.claude-opus-4-6-v1'))?.ctx).toBe(1000000)
        expect(resolveLiteLLMRow(full, model(LLMProvider.DeepSeek, 'deepseek-chat'))?.ctx).toBe(131072)
        expect(resolveLiteLLMRow(full, model(LLMProvider.Mistral, 'mistral-large-latest'))?.ctx).toBe(262144)
        expect(resolveLiteLLMRow(full, model(LLMProvider.Cohere, 'command-r-08-2024'))?.ctx).toBe(128000)
    })
})
