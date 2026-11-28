// The real judge session over a channel that answers with the real handler: real verdicts, no real Worker. `posts` records every
// request so a test can read the jobs the apply core asked for; a silent channel never answers and the session times out.
import { openJudgeSession, type JudgeRequest, type JudgeSession, type JudgeWorkerLike } from '../judgeClient'
import type { PackJudge } from '../intake'
import { handleJudgeRequest, type JudgeResponse } from '../worker/judgeHandler'

class AnsweringWorker implements JudgeWorkerLike {
    private readonly listeners: Record<string, Array<(event: Event) => void>> = {}

    constructor(private readonly posts: JudgeRequest[], private readonly silent: boolean, private readonly rewrite: (response: JudgeResponse) => JudgeResponse) {}

    postMessage(message: JudgeRequest): void {
        this.posts.push(message)
        if (!this.silent) {
            const answer = this.rewrite(handleJudgeRequest(message))
            setTimeout(() => {
                for (const listener of this.listeners.message ?? []) listener(new MessageEvent('message', { data: answer }))
            }, 0)
        }
    }

    terminate(): void {}

    addEventListener(type: 'message' | 'messageerror' | 'error', listener: (event: Event) => void): void {
        (this.listeners[type] ??= []).push(listener)
    }
}

export interface JudgeRig { session: JudgeSession; judge: PackJudge; posts: JudgeRequest[]; spawns: () => number }

export function judgeRig(options: { silent?: boolean; timeoutMs?: number; rewrite?: (response: JudgeResponse) => JudgeResponse } = {}): JudgeRig {
    const posts: JudgeRequest[] = []
    let spawned = 0
    const session = openJudgeSession({
        spawn: () => {
            spawned += 1
            return new AnsweringWorker(posts, options.silent === true, options.rewrite ?? ((response) => response))
        },
        timeoutMs: options.timeoutMs,
    })
    return { session, judge: session.judge, posts, spawns: () => spawned }
}
