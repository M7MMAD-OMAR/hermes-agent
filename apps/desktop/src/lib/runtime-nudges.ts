/**
 * RUNTIME NUDGES — text the agent runtime injects on the `user` role that the
 * human never typed.
 *
 * Message-role alternation forbids a synthetic `system` row mid-loop, so every
 * scaffolding message the runtime needs the model to react to — "you hit the
 * iteration cap, summarise", "your last turn was cut off, continue", a
 * background process finishing — rides in as a user turn. That is a protocol
 * necessity, not a display decision, and rendering them as user bubbles tells
 * the user they said something they did not.
 *
 * The backend already keeps this list: `_is_synthetic_compression_user_turn` in
 * `agent/context_compressor.py` uses it to keep compaction from attributing
 * these to the human. The desktop had ONE of them (the background-process
 * regex, duplicated in two files) and rendered the other eleven as if you had
 * typed them.
 *
 * KEPT IN SYNC BY A TEST, NOT BY DISCIPLINE:
 * `tests/agent/test_desktop_renders_runtime_nudges.py` imports the Python
 * constants, parses this file, and fails when they diverge. Add a nudge on
 * either side and that test tells you about the other.
 */

/** Matched whole, after trimming. */
const EXACT: readonly string[] = [
  'Continue from the compressed conversation context above. This marker exists because no human user turn was available.',
  'Continue from the compressed conversation context above. This marker exists because the compacted transcript contained no preserved user turn.',
  "You've reached the maximum number of tool-calling iterations allowed. Please provide a final response summarizing what you've found and accomplished so far, without calling any more tools.",
  '[System: Your previous response contained only internal reasoning and never produced a visible answer or tool call. Do not keep thinking. Produce your final answer as plain text now (or make the tool call you were planning).]',
  '[System: Continue now. Execute the required tool calls and only send your final answer after completing the task.]',
  'Your previous turn indicated a tool call but none was included. Do not narrate a plan or restate intent — issue the actual tool call now to continue the task.',
  'You just executed tool calls but returned an empty response. Please process the tool results above and continue with the task.',
  '[System: The previous response was cut off by a network error mid-stream. Continue exactly where you left off. Do not restart or repeat prior text. Finish the answer directly.]',
  '[System: Your previous response was truncated by the output length limit. Continue exactly where you left off. Do not restart or repeat prior text. Finish the answer directly.]'
]

/** Hoisted because `isProcessNotification` needs the same text: this family has
 *  its own richer rendering, so the string is read twice, and two copies of it
 *  is the one drift the guard test below cannot see (it compares the arrays, not
 *  the predicates). */
const BACKGROUND_PROCESS_PREFIX = '[IMPORTANT: Background process '

/** Matched at the start — these carry a variable tail (a process id, a tool
 *  name, the preserved task list). */
const PREFIXES: readonly string[] = [
  BACKGROUND_PROCESS_PREFIX,
  '[Your active task list was preserved across context compression]\n',
  '[System: Your previous tool call '
]

/**
 * Did the RUNTIME write this, rather than the human?
 *
 * Callers use it for two different jobs and both matter: the transcript renders
 * a compact system notice instead of a user bubble, and the timeline rail skips
 * it entirely (it is not a prompt, so it is not a place you would navigate to).
 */
export function isRuntimeNudge(text: string): boolean {
  const trimmed = text.trim()

  if (!trimmed) {
    return false
  }

  return EXACT.includes(trimmed) || PREFIXES.some(prefix => trimmed.startsWith(prefix))
}

/**
 * The background-process family, which has its own richer rendering (a headline
 * plus collapsible output) rather than the one-line notice.
 *
 * The closing bracket is required on purpose, and callers depend on it: a
 * notification truncated mid-flight has no `]`, falls through to the plain
 * notice, and is still not drawn as something the human typed.
 */
export function isProcessNotification(text: string): boolean {
  const trimmed = text.trim()

  return trimmed.startsWith(BACKGROUND_PROCESS_PREFIX) && trimmed.endsWith(']')
}
