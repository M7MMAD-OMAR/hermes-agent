/**
 * The sentence inside an error, without the plumbing around it.
 *
 * An error crossing the Electron IPC boundary arrives wrapped: `Error invoking
 * remote method 'hermes:officeConvert': Error: Install LibreOffice to open this
 * document format here`. Only the last clause was written for a person to read,
 * and it is the clause every surface that shows an error to the user wants.
 */
export function inlineErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback

  return (raw.match(/Error invoking remote method '[^']+': Error: (.+)$/)?.[1] ?? raw).replace(/^Error:\s*/, '').trim()
}
