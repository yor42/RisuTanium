// @vitest-environment jsdom
// Sanitizer assertions need a DOM in which DOMPurify removes every offending
// node; see sanitizerMultiRemoval.test.ts for why happy-dom is not one.
import { describe, it, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import { trimMarkdown } from '../parser.svelte'

//#region module mocks

vi.mock(
  import('../../storage/database.svelte'),
  () =>
    ({
      appVer: '1234.5.67',
      getCurrentCharacter: () => ({}),
      getDatabase: () => ({}),
    } as typeof import('../../storage/database.svelte'))
)

vi.mock(import('../../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: () => Promise.resolve(''),
  readImage: () => Promise.resolve(undefined),
}))

vi.mock(import('../../stores.svelte'), () => {
  return {
    DBState: {
      db: {
        characters: [
          {
            chatPage: 0,
            chats: [{}],
            defaultVariables: '',
          },
        ],
        globalChatVariables: {},
        templateDefaultVariables: '',
      },
    },
    selIdState: {
      selId: 0,
    },
    selectedCharID: writable(0),
  } as typeof import('../../stores.svelte')
})

//#endregion

const parse = (html: string) => new DOMParser().parseFromString('<body>' + html, 'text/html').body

describe('trimMarkdown form trigger markup', () => {
    it('keeps risu-form and the controls a form trigger reads', () => {
        const body = parse(trimMarkdown('<form risu-form="send"><input name="a" value="1"><select name="b"><option value="x">x</option></select><textarea name="c"></textarea><button type="submit" name="go" value="y">go</button></form>'))
        const form = body.querySelector('form')
        expect(form?.getAttribute('risu-form')).toBe('send')
        expect(form?.querySelectorAll('input, select, textarea, button').length).toBe(4)
    })

    it('keeps risu-form when the message also carries a risu-style block', () => {
        const body = parse(trimMarkdown('<risu-style>.a{color:red}</risu-style><form risu-form="send"><button>go</button></form>'))
        expect(body.querySelector('form')?.getAttribute('risu-form')).toBe('send')
    })

    it('drops inline event handlers from the form and its controls', () => {
        const body = parse(trimMarkdown('<form risu-form="send" onsubmit="alert(1)"><input name="a" onfocus="alert(2)"><button onclick="alert(3)">go</button></form>'))
        expect(body.querySelector('form')?.getAttribute('risu-form')).toBe('send')
        expect(body.querySelector('[onsubmit], [onfocus], [onclick]')).toBeNull()
    })

    it('drops javascript: targets from action and formaction', () => {
        const body = parse(trimMarkdown('<form risu-form="send" action="javascript:alert(1)"><button formaction="javascript:alert(2)">go</button></form>'))
        expect(body.querySelector('form')?.getAttribute('risu-form')).toBe('send')
        expect(body.querySelector('[action], [formaction]')).toBeNull()
    })

    it('drops the same attributes on the risu-style path', () => {
        const body = parse(trimMarkdown('<risu-style>.a{color:red}</risu-style><form risu-form="send" onsubmit="alert(1)" action="javascript:alert(1)"><button>go</button></form>'))
        expect(body.querySelector('form')?.getAttribute('risu-form')).toBe('send')
        expect(body.querySelector('[onsubmit], [action]')).toBeNull()
    })
})
