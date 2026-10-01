import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset URLs so the static build works from any path (e.g. GitHub Pages).
  base: './',
  // Pre-bundling would break onnxruntime-web's relative URL to its wasm binary in dev.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
})
