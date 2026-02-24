/**
 * Human-like delay module — replaces uniform randomBetween() with
 * Gaussian distribution, fatigue, bursts, and distraction pauses.
 */

function gaussianRandom(mean, stdDev) {
  const u1 = Math.random()
  const u2 = Math.random()
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
  return mean + z * stdDev
}

/**
 * Human-like delay (seconds) for message #index in a series.
 *
 * Behavior:
 * - First 5 messages: faster (warmup phase)
 * - Middle: stable rhythm with Gaussian variation
 * - ~8% chance of a "distraction pause" (3x longer)
 * - After 30 messages: gradual slowdown (fatigue)
 *
 * @param {number} minSec - Campaign minimum delay setting
 * @param {number} maxSec - Campaign maximum delay setting
 * @param {number} index  - Message index (0-based)
 * @param {number} total  - Total messages in queue
 * @returns {number} Delay in seconds
 */
export function humanDelay(minSec, maxSec, index = 0, total = 100) {
  const baseMean = (minSec + maxSec) / 2
  const baseStd = (maxSec - minSec) / 4

  let mean = baseMean
  let std = baseStd

  // Warmup phase (first 5): slightly faster
  if (index < 5) {
    mean *= 0.7
    std *= 0.5
  }

  // Fatigue phase (after 30): gradually slower
  if (index > 30) {
    const fatigueFactor = 1 + (index - 30) * 0.02
    mean *= Math.min(fatigueFactor, 2.0)
  }

  // Random distraction pause (~8% chance after message 5)
  if (index > 5 && Math.random() < 0.08) {
    return Math.max(minSec, Math.floor(gaussianRandom(mean * 3, mean * 0.5)))
  }

  // Normal Gaussian delay
  let delay = gaussianRandom(mean, std)
  delay = Math.max(minSec * 0.5, Math.min(delay, maxSec * 2.5))
  return Math.max(1, Math.floor(delay))
}

/**
 * Human-like typing duration proportional to text length.
 * ~50-80 chars/sec typing speed with variation.
 *
 * @param {number} textLength - Number of characters in the message
 * @returns {number} Duration in milliseconds
 */
export function humanTypingDuration(textLength) {
  const charsPerSec = gaussianRandom(65, 15)
  const base = (textLength / Math.max(charsPerSec, 20)) * 1000
  return Math.max(2000, Math.min(Math.floor(base * (0.8 + Math.random() * 0.4)), 15000))
}
