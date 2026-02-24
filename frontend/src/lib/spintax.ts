/** Returns the first branch of each spintax group — for UI preview */
export function previewSpintax(text: string): string {
  const regex = /\{([^{}]*)\}/
  let result = text
  let guard = 100
  while (regex.test(result) && guard-- > 0) {
    result = result.replace(regex, (_m, opts) => opts.split('|')[0])
  }
  return result
}
