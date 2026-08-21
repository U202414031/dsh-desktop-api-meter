/**
 * Client half of the API-meter bundle: provider/API-key settings surface,
 * per-reply token-usage footer, and the model monitor. Registered into the
 * desktop shell seats `sidebar.api` + `desktop.model-monitor` (declared by
 * dsh-plugin-desktop) and the upstream `conversation.chat.turnTail` chain slot.
 */
import type {} from './contracts.ts'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { ApiSettingsPanel } from './features/api/ApiSettingsPanel.tsx'
import { ModelMonitor } from './features/api/ModelMonitor.tsx'
import { TurnUsageFooter } from './features/api/turn-usage-footer.tsx'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  // `slots.inject` defers until the shell declares the seat, so the
  // registrations cannot race the shell's root-children declaration.
  ctx.effect(() => ctx.slots.inject('sidebar.api', () => ctx.slots.register({ name: 'sidebar.api' }, ApiSettingsPanel)), 'dsh-desktop-api-meter: api settings surface')
  ctx.effect(() => ctx.slots.inject('desktop.model-monitor', () => ctx.slots.register({ name: 'desktop.model-monitor' }, ModelMonitor)), 'dsh-desktop-api-meter: model monitor')
  // Inline per-reply usage footer: contributes into the upstream turn-tail
  // chain slot (declared by dsh-client-ui-conversation), so each finished
  // reply shows its token usage + estimated cost right below the message.
  ctx.effect(
    () => ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
      name: 'conversation.chat.turnTail',
      select: (owner) => ({ turnNumber: owner.turn.turn, seq: owner.seq }),
    }, TurnUsageFooter)),
    'dsh-desktop-api-meter: turn usage footer',
  )
}
