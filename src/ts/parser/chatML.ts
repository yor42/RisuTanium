import { risuChatParser } from './parser.svelte'
import type { RunSubject } from '../process/chatOrigin'
import type { PromptView } from '../cbs'

/**
 * Splits ChatML text into messages and parses each message's content. With a
 * `subject` the content is parsed as the chat that subject stands for; without
 * one, as the selected chat. With a `promptView` every content is parsed as
 * part of the prompt.
 */
export function parseChatML(data: string, subject?: RunSubject, promptView?: PromptView): OpenAIChat[] | null {
  const starter = '<|im_start|>'
  const seperator = '<|im_sep|>'
  const ender = '<|im_end|>'

  const trimedData = data.trim()
  if (!trimedData.startsWith(starter)) {
    return null
  }

  return trimedData
    .split(starter)
    .filter((f) => f !== '')
    .map((v) => {
      let role: 'system' | 'user' | 'assistant' = 'user'
      //default separators
      if (v.startsWith('user' + seperator)) {
        role = 'user'
        v = v.substring(4 + seperator.length)
      } else if (v.startsWith('system' + seperator)) {
        role = 'system'
        v = v.substring(6 + seperator.length)
      } else if (v.startsWith('assistant' + seperator)) {
        role = 'assistant'
        v = v.substring(9 + seperator.length)
      }
      //space/newline separators
      else if (v.startsWith('user ') || v.startsWith('user\n')) {
        role = 'user'
        v = v.substring(5)
      } else if (v.startsWith('system ') || v.startsWith('system\n')) {
        role = 'system'
        v = v.substring(7)
      } else if (v.startsWith('assistant ') || v.startsWith('assistant\n')) {
        role = 'assistant'
        v = v.substring(10)
      }

      v = v.trim()

      if (v.endsWith(ender)) {
        v = v.substring(0, v.length - ender.length)
      }

      let thoughts: string[] = []
      v = v.replace(/<Thoughts>(.+?)<\/Thoughts>/gms, (_, p1) => {
        thoughts.push(p1)
        return ''
      })

      return {
        role: role,
        content: risuChatParser(v, promptView ? { subject, promptView } : { subject }),
        thoughts: thoughts,
      }
    })
}
