import type { UsageMode, UsagePurpose } from './usageTypes'

/** An explicit purpose wins; otherwise the main send is `chat`; otherwise the request mode code. */
export function usagePurposeOf(arg: { usagePurpose?: UsagePurpose, mainSend?: boolean }, mode: UsageMode): UsagePurpose {
    if (arg.usagePurpose !== undefined) {
        return arg.usagePurpose
    }
    return arg.mainSend ? 'chat' : mode
}
