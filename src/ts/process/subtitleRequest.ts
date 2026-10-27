import { ensureCurrentModulesOrAlert } from './moduleEnsure'
import { hasModuleStubs } from './moduleRefList'
import type { OpenAIChat } from './index.svelte'
import { requestChatData, type requestDataResponse } from './request/request'

/**
 * The subtitle model request (the audio request and the transcript translation). When the current chat references module
 * stubs, the request waits for their bodies first; a failed load has already shown its alert and the result is null, so
 * the caller stops without a request. A profile without stubs calls the request in the same turn, with no await added.
 */
export function requestSubtitleModel(formated: OpenAIChat[]): Promise<requestDataResponse | null> {
    const request = () => requestChatData({
        formated,
        bias: {},
        useStreaming: true,
    }, 'model')
    if(!hasModuleStubs()){
        return request()
    }
    return ensureCurrentModulesOrAlert().then((ok) => ok ? request() : null)
}
