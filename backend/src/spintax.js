/**
 * Spintax parser — resolves {option1|option2|option3} syntax recursively.
 * Supports nesting: {Hello {friend|pal}|Hi {there|world}}.
 */

export function parseSpintax(text) {
  // Resolve from innermost to outermost
  const regex = /\{([^{}]*)\}/
  let result = text
  let maxIterations = 100

  while (regex.test(result) && maxIterations-- > 0) {
    result = result.replace(regex, (_match, options) => {
      const choices = options.split('|')
      return choices[Math.floor(Math.random() * choices.length)]
    })
  }

  return result
}

/**
 * Preview all possible values (for UI spintax preview).
 * Returns the first combination (no randomness).
 */
export function previewSpintax(text) {
  const regex = /\{([^{}]*)\}/
  let result = text
  let maxIterations = 100

  while (regex.test(result) && maxIterations-- > 0) {
    result = result.replace(regex, (_match, options) => {
      return options.split('|')[0]
    })
  }

  return result
}
