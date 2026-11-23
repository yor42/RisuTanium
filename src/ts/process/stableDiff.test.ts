import { describe, expect, test, vi } from 'vitest'

vi.mock('../alert', () => ({ alertError: vi.fn() }))
vi.mock('../globalApi.svelte', () => ({ globalFetch: vi.fn(), readImage: vi.fn() }))
vi.mock('../storage/database.svelte', () => ({ getDatabase: vi.fn() }))
vi.mock('../stores.svelte', () => ({ CharEmotion: { set: vi.fn() } }))
vi.mock('./processzip', () => ({ processZip: vi.fn() }))
vi.mock('./request/request', () => ({ requestChatData: vi.fn() }))

import { applyImageOrientation, generateAIImage } from './stableDiff'
import { getDatabase, type character } from '../storage/database.svelte'
import { globalFetch, readImage } from '../globalApi.svelte'
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

describe('a reference image the access control list refuses (G)', () => {
  const ACL_STRINGS = [
    'Command plugin:fs|read_file not allowed by ACL',
    'fs.read_file not allowed. Permissions associated with this command: fs:allow-read-file',
  ]
  const reference = '/data/user/0/io.github.yor42.risutanium/shared_prefs/secrets.xml'

  function characterWith(image: string): character {
    return { image, chaId: 'cha' } as unknown as character
  }

  const providers: Array<[string, Record<string, unknown>]> = [
    ['wavespeed character reference', { sdProvider: 'wavespeed', wavespeedImage: { key: 'k', reference_mode: 'character' } }],
    ['novelai character reference', { sdProvider: 'novelai', NAIImgModel: 'nai-diffusion-4-5-full', NAIApiKey: 'k', NAII2I: false, NAIImgConfig: { width: 512, height: 512, reference_mode: 'character', character_image: '' } }],
    ['novelai image to image', { sdProvider: 'novelai', NAIImgModel: 'nai-diffusion-3', NAIApiKey: 'k', NAII2I: true, NAIImgConfig: { width: 512, height: 512, reference_mode: '', image: '' } }],
  ]

  test.each(providers.flatMap(([name, config]) => ACL_STRINGS.map((text) => [name, config, text] as const)))(
    '%s rejects with the refusal and makes no provider call',
    async (_name, config, text) => {
      vi.mocked(getDatabase).mockReturnValue(config as unknown as ReturnType<typeof getDatabase>)
      vi.mocked(globalFetch).mockClear()
      vi.mocked(readImage).mockRejectedValue(text)

      await expect(generateAIImage('a prompt', characterWith(reference), '', 'inlay')).rejects.toBe(text)

      expect(readImage).toHaveBeenCalledWith(reference)
      expect(globalFetch).not.toHaveBeenCalled()
    },
  )
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
