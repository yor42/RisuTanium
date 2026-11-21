import { writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { risuChatParser } from '../../parser.svelte'
import { cbs } from './lib'

//#region module mocks

// The database is a plain object here, fixed for the file: the selection deriveds read it once and keep their answer, so
// every definition below is in place before the first read. Edits and freshness are covered with a `$state` database in
// chatVar.toggleDefaults.svelte.test.ts.
const world = vi.hoisted(() => ({
  db: {
    customPromptTemplateToggle: 'nsfw=NSFW===1\nmood=Mood=select=calm,angry=angry\nplain=Plain\ncalmer=Calmer=select=a,b=a',
    modules: [],
    enabledModules: [],
    moduleIntergration: '',
    personas: [],
    globalChatVariables: {} as Record<string, string>,
    templateDefaultVariables: '',
    characters: [
      {
        type: 'character',
        chaId: 'cha-a',
        chatPage: 0,
        modules: [],
        customModuleToggle: '',
        defaultVariables: '',
        chats: [{ modules: [], message: [], scriptstate: {}, GLGlobalVariables: {} as Record<string, string> }],
      },
    ],
  },
}))

vi.mock(
  import('../../../storage/database.svelte'),
  () =>
    ({
      appVer: '1234.5.67',
      getCurrentCharacter: () => world.db.characters[0],
      getCurrentChat: () => world.db.characters[0].chats[0],
      getDatabase: () => world.db,
    }) as unknown as typeof import('../../../storage/database.svelte'),
)

vi.mock(import('../../../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: () => Promise.resolve(''),
  readImage: () => Promise.resolve(undefined),
}))

vi.mock(import('../../../stores.svelte'), () => {
  return {
    DBState: { db: world.db },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
  } as unknown as typeof import('../../../stores.svelte')
})

//#endregion

const parse = (text: string) => risuChatParser(text)

beforeEach(() => {
  world.db.globalChatVariables = {}
  world.db.characters[0].chats[0].GLGlobalVariables = {}
})

describe('author defaults reach the CBS toggle reads', () => {
  // regression reproducer: on the base an unset toggle reads 'null'
  test('getglobalvar gives the default of an unset check and select', () => {
    expect(parse(cbs('getglobalvar', 'toggle_nsfw'))).toBe('1')
    expect(parse(cbs('getglobalvar', 'toggle_mood'))).toBe('1')
  })

  // regression reproducer: on the base the block is hidden
  test('#when::toggle shows its body for an unset default-on check', () => {
    expect(parse('{{#when::toggle::nsfw}}Y{{/when}}')).toBe('Y')
  })

  // compatibility guard: a toggle without a default stays off, before and after
  test('#when::toggle hides its body for an unset check without a default', () => {
    expect(parse('{{#when::toggle::plain}}Y{{/when}}')).toBe('')
  })

  // regression reproducer: on the base `tis` compares with 'null'
  test('tis and tisnot compare the default select index', () => {
    expect(parse('{{#when::mood::tis::1}}A{{/when}}')).toBe('A')
    expect(parse('{{#when::mood::tisnot::1}}B{{/when}}')).toBe('')
    expect(parse('{{#when::mood::tis::0}}C{{/when}}')).toBe('')
    expect(parse('{{#when::mood::tisnot::0}}D{{/when}}')).toBe('D')
  })

  // regression reproducer: on the base `@toggle_nsfw` is 0
  test('an RPN expression reads the default', () => {
    expect(parse('{{? @toggle_nsfw + 1}}')).toBe('2')
  })

  // compatibility guard: passes before and after
  test('a stored 0 and a chat-local value still win', () => {
    world.db.globalChatVariables.toggle_nsfw = '0'
    world.db.globalChatVariables.toggle_mood = '0'
    expect(parse(cbs('getglobalvar', 'toggle_nsfw'))).toBe('0')
    expect(parse('{{#when::toggle::nsfw}}Y{{/when}}')).toBe('')
    expect(parse('{{#when::mood::tis::0}}C{{/when}}')).toBe('C')

    world.db.characters[0].chats[0].GLGlobalVariables = { toggle_nsfw: '1', toggle_calmer: '1' }
    expect(parse(cbs('getglobalvar', 'toggle_nsfw'))).toBe('1')
    expect(parse(cbs('getglobalvar', 'toggle_calmer'))).toBe('1')
  })

  // compatibility guard: passes before and after
  test('keys that are not toggles are unaffected', () => {
    expect(parse(cbs('getglobalvar', 'nsfw'))).toBe('null')
    world.db.globalChatVariables.nsfw = 'v'
    expect(parse(cbs('getglobalvar', 'nsfw'))).toBe('v')
  })
})
