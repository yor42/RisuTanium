/**
 * The set of Utility formats is the set the interceptor-skip tests drive (`interceptorSkip.test.ts`): a format added
 * to `UTILITY_FORMATS` without a first-request skip test, or one removed, fails here. Bedrock and the Responses API
 * are outside the set, so a workspace run can never reach a request path that test does not cover.
 *
 * Mocked: the request path and the collaborators of the conversation module, none of which this test sends through.
 */
import { describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock('../request', () => ({ requestChatDataMain: vi.fn() }))
vi.mock('../../../stores.svelte', () => ({ DBState: { db: {} }, selectedCharID: writable(-1), selIdState: { selId: 0 } }))
vi.mock('../../utility/workspace/workspaceModel.svelte', () => ({ hasWorkspace: vi.fn(() => true) }))
vi.mock('../../utility/workspace/instructionSources', () => ({ buildWorkspaceInstructions: vi.fn(async () => ({ text: '' })) }))

import { LLMFormat } from '../../../model/modellist'
import { UTILITY_FORMATS } from '../../utility/utilityConversation.svelte'

/** The formats `interceptorSkip.test.ts` sends a first request for. */
const TESTED_FORMATS = [
    LLMFormat.OpenAICompatible,
    LLMFormat.Anthropic,
    LLMFormat.GoogleCloud,
    LLMFormat.VertexAIGemini,
]

describe('UTILITY_FORMATS', () => {
    test('is exactly the formats the interceptor-skip tests drive', () => {
        expect([...UTILITY_FORMATS].sort()).toEqual([...TESTED_FORMATS].sort())
    })

    test('excludes Bedrock and the Responses API', () => {
        expect(UTILITY_FORMATS).not.toContain(LLMFormat.AWSBedrockClaude)
        expect(UTILITY_FORMATS).not.toContain(LLMFormat.OpenAIResponseAPI)
    })
})
