/**
 * The non-chat readers of a chat slot resolve the same stored connection as a chat request: DALL-E reads the
 * OpenAI connection, one line of a multi-line key at a time.
 *
 * Compat file: no module that is new with connections is imported, so it also runs against the tree before
 * connections existed. The database is built as a stored database looks after the migration.
 */
import { describe, expect, test, vi } from 'vitest'

vi.mock('../../alert', () => ({ alertError: vi.fn() }))
vi.mock('../../globalApi.svelte', () => ({ globalFetch: vi.fn(), readImage: vi.fn() }))
vi.mock('../../kei/kei', () => ({ keiServerURL: '' }))
vi.mock('../../storage/database.svelte', () => ({ getDatabase: vi.fn() }))
vi.mock('../../stores.svelte', () => ({ CharEmotion: { set: vi.fn() } }))
vi.mock('../processzip', () => ({ processZip: vi.fn() }))
vi.mock('../request/request', () => ({ requestChatData: vi.fn() }))

import { generateAIImage } from '../stableDiff'
import { getDatabase, type character } from '../../storage/database.svelte'
import { globalFetch } from '../../globalApi.svelte'

describe('DALL-E reads its key from the OpenAI connection', () => {
  test('T21: the request carries the current line of the stored key and never the whole value', async () => {
    vi.mocked(getDatabase).mockReturnValue({
      sdProvider: 'dalle', dallEQuality: '', openAIKey: '',
      connections: [{ id: 'conn-1', name: 'OpenAI', provider: 'openai', key: 'sk-test-A\nsk-test-B' }],
    } as unknown as ReturnType<typeof getDatabase>)
    vi.mocked(globalFetch).mockResolvedValue({ ok: true, data: { data: [{ b64_json: 'AAAA' }] } } as unknown as Awaited<ReturnType<typeof globalFetch>>)

    const image = await generateAIImage('a prompt', {} as character, '', 'inlay')

    expect(image).toBe('data:image/png;base64,AAAA')
    const [, init] = vi.mocked(globalFetch).mock.calls[0]
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer sk-test-A')
  })
})
