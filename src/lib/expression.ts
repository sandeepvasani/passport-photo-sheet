/**
 * Facial-expression scores from FER+ (MIT, ONNX Model Zoo,
 * https://github.com/onnx/models/tree/main/validated/vision/body_analysis/emotion_ferplus),
 * run in the browser. The face mesh's own expression scores can't tell a frown or a
 * raised brow from many people's resting face; FER+ was trained on labelled
 * expressions and can. Loaded in the background after a photo is analysed.
 */
import type { Point } from './geometry'
import { createCanvas, ctx2d, releaseCanvas, type LoadedImage } from './image'
import { modelLoader } from './onnx'

export const EMOTIONS = ['neutral', 'happy', 'surprise', 'sad', 'anger', 'disgust', 'fear', 'contempt'] as const
export type Emotion = (typeof EMOTIONS)[number]
/** Probability of each expression (they sum to 1). */
export type ExpressionScores = Record<Emotion, number>

const loadModel = modelLoader('emotion-ferplus-12-int8.onnx')
const SIZE = 64

/** Scores the expression of the face with these face-mesh landmarks. */
export async function scoreExpression(image: LoadedImage, landmarks: Point[]): Promise<ExpressionScores> {
  const { session, ort } = await loadModel()

  // The face, levelled and cropped square a little beyond the face mesh, in greyscale.
  const a = landmarks[468]
  const b = landmarks[473]
  const xs = landmarks.map((p) => p.x)
  const ys = landmarks.map((p) => p.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.1
  const canvas = createCanvas(SIZE, SIZE)
  const ctx = ctx2d(canvas)
  ctx.translate(SIZE / 2, SIZE / 2)
  ctx.rotate(-Math.atan2(b.y - a.y, b.x - a.x))
  ctx.scale(SIZE / size, SIZE / size)
  ctx.translate(-cx, -cy)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image.canvas, 0, 0)
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data
  releaseCanvas(canvas)
  const input = new Float32Array(SIZE * SIZE)
  for (let i = 0; i < input.length; i++) input[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]

  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 1, SIZE, SIZE]) })
  const logits = Array.from(out[session.outputNames[0]].data as Float32Array)
  const max = Math.max(...logits)
  const exp = logits.map((v) => Math.exp(v - max))
  const total = exp.reduce((t, v) => t + v, 0)
  return Object.fromEntries(EMOTIONS.map((e, i) => [e, exp[i] / total])) as ExpressionScores
}
