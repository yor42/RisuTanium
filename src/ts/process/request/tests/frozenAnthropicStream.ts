/**
 * Frozen reference copy of the Anthropic streaming loop as it behaved before the incremental rewrite
 * (the `arg.useStreaming` branch of `requestClaudeHTTP`). It is the oracle of `anthropicStream.test.ts`
 * and is never edited to match new code.
 *
 * Not verbatim: the old overload branch read `db`, a binding still in its temporal dead zone, so any error
 * event whose message contains "overload" threw a swallowed ReferenceError inside `parseEvent` and appended
 * nothing (the designer's diagnostic D1/D2). That is modelled here as an explicit throw inside the same
 * try. Corpora compared against this copy therefore contain no "overload" text.
 */
import type { StreamResponseChunk } from '../request'

export function frozenAnthropicStream(res:Response, abortSignal?:AbortSignal):ReadableStream<StreamResponseChunk> {
    let thinking = false
    return new ReadableStream<StreamResponseChunk>({
        async start(controller){
            let text = ''
            let reader = res.body.getReader()
            let parserData = ''
            let decoder = new TextDecoder()
            const parseEvent = ((e:string) => {
                try {
                    const parsedData = JSON.parse(e)

                    if(parsedData?.type === 'content_block_delta'){
                        if(parsedData?.delta?.type === 'text' || parsedData.delta?.type === 'text_delta'){
                            if(thinking){
                                text += "</Thoughts>\n\n"
                                thinking = false
                            }
                            text += parsedData.delta?.text ?? ''
                        }

                        if(parsedData?.delta?.type === 'thinking' || parsedData.delta?.type === 'thinking_delta'){
                            if(!thinking){
                                text += "<Thoughts>\n"
                                thinking = true
                            }
                            text += parsedData.delta?.thinking ?? ''
                        }

                        if(parsedData?.delta?.type === 'redacted_thinking'){
                            if(!thinking){
                                text += "<Thoughts>\n"
                                thinking = true
                            }
                            text += '\n{{redacted_thinking}}\n'
                        }
                    }

                    if(parsedData?.type === 'error'){
                        const errormsg:string = parsedData?.error?.message
                        if(errormsg && errormsg.toLocaleLowerCase().includes('overload')){
                            throw new ReferenceError('db is not defined')
                        }
                        text += "Error:" + parsedData?.error?.message

                    }

                }
                catch (error) {
                }
            })
            let i = 0;
            let prevText = ''
            while(true){
                try {
                    if(abortSignal?.aborted){
                        break
                    }
                    const {done, value} = await reader.read()
                    if(done){
                        parserData += decoder.decode()
                        break
                    }
                    parserData += decoder.decode(value, {stream: true})
                    let parts = parserData.split('\n')
                    for(;i<parts.length-1;i++){
                        prevText = text
                        if(parts?.[i]?.startsWith('data: ')){
                            parseEvent(parts[i].slice(6))
                        }
                    }
                    i--;
                    text = prevText

                    controller.enqueue({
                        "0": text
                    })

                } catch (error) {
                    if(!abortSignal?.aborted){
                        controller.error(error)
                        return
                    }
                    await new Promise((resolve) => setTimeout(resolve, 1))
                }
            }
            if(thinking){
                text += "</Thoughts>\n\n"
                controller.enqueue({
                    "0": text
                })
            }
            controller.close()
        },
        cancel(){
        }
    })
}
