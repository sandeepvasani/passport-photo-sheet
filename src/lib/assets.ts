/** URL of a file in public/, respecting the site's base path. */
export function assetUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path}`, document.baseURI).href
}
