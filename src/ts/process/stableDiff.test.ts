import { describe, expect, test, vi } from 'vitest'

vi.mock('../alert', () => ({ alertError: vi.fn() }))
vi.mock('../globalApi.svelte', () => ({ globalFetch: vi.fn(), readImage: vi.fn() }))
vi.mock('../kei/kei', () => ({ keiServerURL: '' }))
vi.mock('../storage/database.svelte', () => ({ getDatabase: vi.fn() }))
vi.mock('../stores.svelte', () => ({ CharEmotion: { set: vi.fn() } }))
vi.mock('./processzip', () => ({ processZip: vi.fn() }))
vi.mock('./request/request', () => ({ requestChatData: vi.fn() }))

import { applyImageOrientation, generateAIImage } from './stableDiff'
import { getDatabase, type character } from '../storage/database.svelte'
import { globalFetch } from '../globalApi.svelte'
import { absorbLegacyForTest } from '../connections/tests/legacyFixture'

describe('DALL-E reads one line of a multi-line OpenAI key', () => {
  test('the request carries the current line and never the whole value', async () => {
    vi.mocked(getDatabase).mockReturnValue(absorbLegacyForTest({ sdProvider: 'dalle', openAIKey: 'sk-test-A\nsk-test-B', dallEQuality: '' }) as unknown as ReturnType<typeof getDatabase>)
    vi.mocked(globalFetch).mockResolvedValue({ ok: true, data: { data: [{ b64_json: 'AAAA' }] } } as unknown as Awaited<ReturnType<typeof globalFetch>>)

    const image = await generateAIImage('a prompt', {} as character, '', 'inlay')

    expect(image).toBe('data:image/png;base64,AAAA')
    const [, init] = vi.mocked(globalFetch).mock.calls[0]
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer sk-test-A')
  })
})

describe('applyImageOrientation', () => {
  test('keeps configured dimensions without an orientation', () => {
    expect(applyImageOrientation(1024, 640)).toEqual({ height: 640, width: 1024 })
  })

  test('places the longer edge on the width for landscape', () => {
    expect(applyImageOrientation(640, 1024, 'landscape')).toEqual({ height: 640, width: 1024 })
  })

  test('places the longer edge on the height for portrait', () => {
    expect(applyImageOrientation(1024, 640, 'portrait')).toEqual({ height: 1024, width: 640 })
  })
})
