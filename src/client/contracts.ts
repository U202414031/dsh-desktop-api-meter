/** Desktop slot contributions declared by this bundle's shell seat (the seat itself lives in dsh-plugin-desktop). */
export interface DesktopTurnLocation {
  turn: number
  start?: unknown
  end?: unknown
  status: 'open' | 'closed' | 'unknown'
  steps: readonly unknown[]
  data: unknown
}
export interface DesktopTurnTailOwner {
  turn: DesktopTurnLocation
  seq: number
  openFile: (path: string) => void
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    "sidebar.api": { kind: 'single'; scope: 'root'; owner: Record<never, never> }
    "desktop.model-monitor": { kind: 'single'; scope: 'session-maybe'; owner: Record<never, never> }
    "conversation.chat.turnTail": { kind: 'chain'; scope: 'session'; owner: DesktopTurnTailOwner }
  }
}
