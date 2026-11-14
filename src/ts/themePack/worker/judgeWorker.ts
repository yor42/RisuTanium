// The entry of the pack judge's module worker. The handler is attached synchronously at the top level, so a request posted
// before the worker started reaches it.
import { handleJudgeRequest } from './judgeHandler'

self.addEventListener('message', (event: MessageEvent<unknown>) => {
    self.postMessage(handleJudgeRequest(event.data))
})
