import { PHOTO_SPECS } from './config/photoSpecs'
import { PRINT_SIZES } from './config/printSizes'
import type { LayoutMode } from './lib/layout'

/** What's remembered between visits, in localStorage (never the photo). */
export interface Settings {
  specId: string
  /** The print size, once one has been picked (until then, each photo type's own default). */
  printId: string | null
  layoutMode: LayoutMode
  cutGuides: boolean
}

export const SETTINGS_KEY = 'passport-photo-settings'

/**
 * The settings to start with: the photo type from a `?type=` link first, then what was
 * remembered, then the defaults. Anything unknown (say, a photo type since removed) is ignored.
 */
export function startingSettings(stored: string | null, search: string): Settings {
  let saved: Partial<Record<keyof Settings, unknown>> = {}
  try {
    saved = JSON.parse(stored ?? '{}') ?? {}
  } catch {
    // Not valid JSON: start afresh.
  }
  const isSpec = (id: unknown): id is string => PHOTO_SPECS.some((s) => s.id === id)
  const linked = new URLSearchParams(search).get('type')
  return {
    specId: isSpec(linked) ? linked : isSpec(saved.specId) ? saved.specId : PHOTO_SPECS[0].id,
    printId: PRINT_SIZES.some((p) => p.id === saved.printId) ? (saved.printId as string) : null,
    layoutMode: saved.layoutMode === 'max' || saved.layoutMode === 'safe' ? saved.layoutMode : 'auto',
    cutGuides: typeof saved.cutGuides === 'boolean' ? saved.cutGuides : true,
  }
}
