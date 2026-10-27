import type { character } from '../storage/database.svelte'
import { ensureCurrentModules } from './moduleEnsure'
import { hasModuleStubs } from './moduleRefList'
import type { OpenAIChat } from './index.svelte'
import { requestChatData, type requestDataResponse } from './request/request'

/**
 * The auto-suggestion request. When the current chat references module stubs, the request waits for their bodies first;
 * a failed or aborted load stops silently (null, no alert: the suggestion bar is a background nicety). `isCurrent` is
 * checked once the wait ends, because a platform without an abort signal cannot cancel a waiting load: a request the
 * person has moved away from is never sent. A profile without stubs calls the request in the same turn, with no await
 * added.
 */
export function requestSuggestionData(
    promptbody: OpenAIChat[],
    currentChar: character,
    signal: AbortSignal | null,
    isCurrent: () => boolean,
): Promise<requestDataResponse | null> {
    const request = () => requestChatData({
        formated: promptbody,
        bias: {},
        currentChar,
    }, 'submodel', signal)
    if(!hasModuleStubs()){
        return request()
    }
    return ensureCurrentModules({ signal: signal ?? undefined, alert: false }).then((ok) => ok && isCurrent() ? request() : null)
}
