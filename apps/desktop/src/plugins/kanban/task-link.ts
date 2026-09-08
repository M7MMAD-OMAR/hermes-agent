/** Parse a native task link without changing the server's active board. */
export function parseTaskLink(hash: string): { board: string; task: string } | null {
  const url = new URL(hash.replace(/^#/, ''), 'https://hermes.invalid')
  const task = url.searchParams.get('task')
  const board = url.searchParams.get('board') || 'default'

  if (url.pathname !== '/kanban' || !task || !/^t_[a-zA-Z0-9_-]+$/.test(task) || !/^[a-zA-Z0-9_-]+$/.test(board)) {
    return null
  }

  return { board, task }
}
