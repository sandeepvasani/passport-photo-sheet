/** Runs the edge refinement off the main thread; see refine() in render.ts. */
import { refineMatte, type RefineInput } from './matting'

self.onmessage = (e: MessageEvent<{ id: number; input: RefineInput }>) => {
  const { id, input } = e.data
  try {
    const alpha = refineMatte(input)
    self.postMessage({ id, rgba: input.rgba, alpha }, { transfer: [input.rgba.buffer, alpha.buffer] })
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
