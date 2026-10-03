import type { PhotoSpec } from './config/photoSpecs'
import type { CheckResult } from './lib/checks'

export type StepId = 'upload' | 'crop' | 'background' | 'check' | 'download'

/** Which step fixes each check. */
const FIX_STEP: Record<string, StepId> = {
  head: 'crop',
  'face-width': 'crop',
  eyes: 'crop',
  top: 'crop',
  chin: 'crop',
  center: 'crop',
  level: 'crop',
  coverage: 'crop',
  // Another person in the frame: zoom in or move the photo so only the applicant shows.
  face: 'crop',
  background: 'background',
  edited: 'background',
}

/** The step where a check's problem can be fixed; anything else needs a new photo. */
export function fixStep(checkId: string): StepId {
  return FIX_STEP[checkId] ?? 'upload'
}

/** What the user ticked on the Check step. */
export interface Review {
  attest: Record<string, boolean>
  /** The warnings reviewed, as their `warningKey`. */
  ackWarnings: string | null
  /** The failures accepted anyway, as their `failureKey`. */
  ackFailures: string | null
}

/** The failures shown. Ticking covers these: a new one (after going back to edit) needs a new tick. */
export const failureKey = (results: CheckResult[]) =>
  results
    .filter((r) => r.status === 'fail')
    .map((r) => r.id)
    .join()

/** The warnings shown. Like failures, ticking covers these: a new or changed one needs a new tick. */
export const warningKey = (results: CheckResult[]) =>
  results
    .filter((r) => r.status === 'warn')
    .map((r) => `${r.id}:${r.detail}`)
    .join('|')

/** What's left to do on the Check step before the photo can be downloaded; empty once it can. */
export function checkTodo(spec: PhotoSpec, results: CheckResult[], review: Review): string[] {
  if (!results.length) return ['Wait a moment: the photo is still being checked.']
  const fails = results.filter((r) => r.status === 'fail')
  const unconfirmed = spec.attestations.filter((a) => !review.attest[a.id]).length
  const failedNames = fails.map((r) => `“${r.label}”`).join(', ')
  return [
    fails.length > 0 &&
      review.ackFailures !== failureKey(results) &&
      `Fix the failed check${fails.length === 1 ? '' : 's'} (${failedNames}), or tick the red box above to download anyway.`,
    unconfirmed > 0 &&
      `Tick ${unconfirmed === spec.attestations.length ? `all ${unconfirmed} items` : unconfirmed === 1 ? 'the last item' : `the ${unconfirmed} remaining items`} under “Please confirm”.`,
    results.some((r) => r.status === 'warn') &&
      review.ackWarnings !== warningKey(results) &&
      'Review the warnings and tick the orange box above.',
    results.some((r) => r.status === 'pending') && 'Wait a moment: the expression check is still running.',
  ].filter((t): t is string => !!t)
}
