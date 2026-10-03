// Filled in at build time from package.json and git (see vite.config.ts).
declare const __APP_VERSION__: string
declare const __APP_COMMIT__: string

/** Shown in the footer and on the error screen, so a bug report can say which build it came from. */
export const VERSION_LABEL = `Version ${__APP_VERSION__} · build ${__APP_COMMIT__}`
