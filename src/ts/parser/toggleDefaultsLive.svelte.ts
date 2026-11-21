import { untrack } from 'svelte'
import { DBState, selIdState } from '../stores.svelte'
import { moduleListOf } from '../process/moduleRefList'
import { referencedModuleIds } from '../process/moduleRefs'
import { isModuleStub } from '../storage/moduleStub'
import { checkPersonaBinded } from '../util'
import { getCurrentCharacter, getCurrentChat, type Chat, type character, type groupChat } from '../storage/database.svelte'
import type { RunSubject } from '../process/chatOrigin'
import { sameDefaults, toggleDefaultsOf, type ToggleDefaults } from './toggleDefaults'

// Never import process/modules here: moduleRefList is a leaf that tests of that file rely on staying mockable.

type Owner = character | groupChat | undefined

/**
 * The toggle definition texts a run of `owner`/`chat` reads, in resolution order: the prompt template, each referenced
 * module that is resident and defines toggles, then the owner's own text (characters only). Reads database signals and
 * writes nothing. It never goes through the selection store getters: they can assign to the database, which is not
 * allowed inside a derived.
 */
export function engineToggleTextsOf(owner: Owner, chat: Chat | undefined): (string | undefined)[] {
    const db = DBState.db
    const texts: (string | undefined)[] = [db?.customPromptTemplateToggle]
    if (Array.isArray(db?.modules)) {
        const ids = referencedModuleIds({
            enabledModules: db.enabledModules,
            chat,
            character: owner,
            persona: checkPersonaBinded(chat ?? null),
            moduleIntergration: db.moduleIntergration,
        })
        for (const module of moduleListOf(ids)) {
            if (!module || isModuleStub(module) || !module.customModuleToggle) {
                continue
            }
            texts.push(module.customModuleToggle)
        }
    }
    texts.push(owner?.type === 'character' ? owner.customModuleToggle : undefined)
    return texts
}

type Selection = { owner: Owner, chat: Chat | undefined, defaults: ToggleDefaults }

function selectedOwner(): Owner {
    return DBState.db?.characters?.[selIdState.selId]
}

function chatOf(owner: Owner): Chat | undefined {
    return owner?.chats?.[owner.chatPage]
}

// Two layers on the selection, both created at module evaluation so neither has a parent effect that could be destroyed
// under it. The inner derived gathers and always returns a NEW object, so it re-executes exactly once per input change
// and then stays quiet even when disconnected (a derived that returned an equal value would be re-checked and
// re-executed on every read while nothing is connected). The outer derived compares and returns its previous object when
// nothing changed, so tracked readers re-run only on a real change and a disconnected read after an equal-defaults edit
// costs a compare, never a gather. Never merge the layers.
const gathered = $derived.by((): Selection => {
    const owner = selectedOwner()
    const chat = chatOf(owner)
    return { owner, chat, defaults: toggleDefaultsOf(engineToggleTextsOf(owner, chat)) }
})

let previous: Selection | undefined

const selectionLive = $derived.by((): Selection => {
    const next = gathered
    if (previous && previous.owner === next.owner && previous.chat === next.chat && sameDefaults(previous.defaults, next.defaults)) {
        return previous
    }
    previous = { owner: next.owner, chat: next.chat, defaults: previous && sameDefaults(previous.defaults, next.defaults) ? previous.defaults : next.defaults }
    return previous
})

// Gathers for non-selected (owner, chat) pairs read outside any tracking context, valid for one synchronous stretch.
const stretchCache = new Map<Owner, Map<Chat | undefined, ToggleDefaults>>()
let stretchClearQueued = false

function stretchDefaultsOf(owner: Owner, chat: Chat | undefined): ToggleDefaults {
    let byChat = stretchCache.get(owner)
    const cached = byChat?.get(chat)
    if (cached) {
        return cached
    }
    const defaults = toggleDefaultsOf(engineToggleTextsOf(owner, chat))
    if (!byChat) {
        byChat = new Map()
        stretchCache.set(owner, byChat)
    }
    byChat.set(chat, defaults)
    if (!stretchClearQueued) {
        stretchClearQueued = true
        queueMicrotask(() => {
            stretchCache.clear()
            stretchClearQueued = false
        })
    }
    return defaults
}

/**
 * Author defaults a run of `owner`/`chat` reads, by variable name. The value depends only on (owner, chat) and the
 * definitions; the selection decides only which cache serves it, in this order:
 * 1. The identity check runs untracked first, so a non-selected reader neither gains a dependency on the selection nor
 *    touches the selection deriveds.
 * 2. The selected pair reads the outer derived (tracked when the caller is tracked, one dependency).
 * 3. Any other tracked caller gathers in full, so it registers every definition dependency.
 * 4. Any other untracked caller uses the per-stretch cache. It never serves a tracked read: a reader served from it
 *    would register no dependency on the definitions and go stale.
 */
export function toggleDefaultsFor(owner: Owner, chat: Chat | undefined): ToggleDefaults {
    const isSelected = untrack(() => {
        const selected = selectedOwner()
        return selected === owner && chatOf(selected) === chat
    })
    if (isSelected) {
        const live = selectionLive
        if (live.owner === owner && live.chat === chat) {
            return live.defaults
        }
    }
    if ($effect.tracking()) {
        return toggleDefaultsOf(engineToggleTextsOf(owner, chat))
    }
    return stretchDefaultsOf(owner, chat)
}

/** The author default of one `toggle_<key>` variable for the subject's run, or for the selection when there is none. */
export function engineToggleDefault(key: string, subject?: RunSubject): string | undefined {
    let owner: Owner
    let chat: Chat | undefined
    if (subject) {
        const ctx = subject.resolve()
        owner = ctx?.owner
        chat = ctx?.chat
    } else {
        owner = getCurrentCharacter()
        chat = getCurrentChat()
    }
    return toggleDefaultsFor(owner, chat).get(key)
}
