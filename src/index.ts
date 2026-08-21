import type { Context } from '@deepseek-ai/cordis'

/**
 * Host-side placeholder: this bundle is renderer-only, but the Cordis Loader
 * resolves the patch `insert` row through the package root, so the root must
 * still expose a plugin object. The client half is picked up separately via the
 * `dsh.client` declaration + `exports["./client"]`.
 */
export const name = 'desktop-api-meter'

export function apply(_ctx: Context): void {
  // Renderer-only bundle — nothing to do on the Host side.
}
