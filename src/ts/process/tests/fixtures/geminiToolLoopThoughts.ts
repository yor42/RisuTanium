/**
 * The text the Gemini streaming tool loop hands to the chat after two iterations: a thought, `MIDDLE` and
 * one tool call, then a second thought and `END`. It is produced by the real google.ts stream
 * (geminiToolLoopThoughts.svelte.test.ts asserts equality), so it holds two `<Thoughts>` blocks with the
 * visible text and the tool call between them.
 */
export const GEMINI_TOOL_LOOP_TEXT = '<Thoughts>\n\nTHOUGHT-ONE\n\n</Thoughts>\n\nMIDDLE\n\n<tool_call>call-1lookup</tool_call>\n\n\n\n<Thoughts>\n\nTHOUGHT-TWO\n\n</Thoughts>\n\nEND'
