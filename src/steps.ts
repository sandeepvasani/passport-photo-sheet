export type StepId = 'upload' | 'crop' | 'background' | 'layout' | 'check'

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
