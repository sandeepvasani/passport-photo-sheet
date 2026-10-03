import { describe, expect, it } from 'vitest'
import { canvasToJpegSized, formatKb } from './image'

/** A canvas whose JPEG file size depends only on the quality asked for. */
function fakeCanvas(size: (quality: number) => number) {
  const asked: number[] = []
  const canvas = {
    toBlob(done: (blob: Blob | null) => void, _type: string, quality: number) {
      asked.push(quality)
      done(new Blob([new Uint8Array(Math.max(1, Math.round(size(quality))))]))
    },
  } as unknown as HTMLCanvasElement
  return { canvas, asked }
}

describe('canvasToJpegSized', () => {
  it('keeps quality 0.95 when that file already fits', async () => {
    const { canvas, asked } = fakeCanvas(() => 100_000)
    expect((await canvasToJpegSized(canvas, 300, 120_000)).size).toBe(100_000)
    expect(asked).toEqual([0.95])
  })

  it('lowers the quality to about the highest that fits under the maximum', async () => {
    // Fits up to quality 0.4.
    const { canvas } = fakeCanvas((q) => 300_000 * q)
    const blob = await canvasToJpegSized(canvas, 300, 120_000)
    expect(blob.size).toBeLessThanOrEqual(120_000)
    expect(blob.size).toBeGreaterThan(118_000)
  })

  it('raises the quality when the file would be under the minimum', async () => {
    const { canvas, asked } = fakeCanvas((q) => (q >= 0.98 ? 50_000 : 30_000))
    expect((await canvasToJpegSized(canvas, 300, 120_000, 40 * 1024)).size).toBe(50_000)
    expect(asked).toEqual([0.95, 0.98])
  })

  it('finds a quality between one that is too small and one that is too large', async () => {
    // 80 KB at 0.95 (under the minimum), 200 KB at 0.98 (over the maximum); 0.955–0.9675 fit.
    const { canvas } = fakeCanvas((q) => 4_000_000 * (q - 0.93))
    const blob = await canvasToJpegSized(canvas, 300, 150_000, 100_000)
    expect(blob.size).toBeGreaterThanOrEqual(100_000)
    expect(blob.size).toBeLessThanOrEqual(150_000)
  })

  it('says so when even the best quality is under the minimum', async () => {
    const { canvas } = fakeCanvas(() => 10_000)
    await expect(canvasToJpegSized(canvas, 300, 120_000, 40 * 1024)).rejects.toThrow('as large as 40 KB')
  })

  it('says so when even the lowest quality is over the maximum', async () => {
    const { canvas } = fakeCanvas(() => 500_000)
    await expect(canvasToJpegSized(canvas, 300, 120_000)).rejects.toThrow('smaller than 120 KB')
  })

  it('says so when no quality lands between the limits', async () => {
    const { canvas } = fakeCanvas((q) => (q < 0.5 ? 30_000 : 200_000))
    await expect(canvasToJpegSized(canvas, 300, 120_000, 40 * 1024)).rejects.toThrow('between 40 and 120 KB')
  })
})

describe('formatKb', () => {
  it('shows limits as round numbers in whichever unit they were given', () => {
    expect(formatKb(40 * 1024)).toBe(40)
    expect(formatKb(120_000)).toBe(120)
    expect(formatKb(250_000)).toBe(250)
  })
})
