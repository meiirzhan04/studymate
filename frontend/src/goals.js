/* ─── Goals (US-18 / US-19): instant feedback while typing ─────────────
 * The backend is the authority: it re-checks every target on save. These helpers only give
 * the same answer early, from the maximums the backend already sent with the page.
 */

const EPS = 1e-9

export const STATUS_TONE = {
  ahead: 'success',
  on_track: 'accent',
  behind: 'warning',
  achieved: 'success',
  unachievable: 'danger',
  insufficient_data: 'neutral',
}

export const STATUS_LABEL = {
  ahead: 'Ahead of target',
  on_track: 'On track',
  behind: 'Behind pace',
  achieved: 'Goal achieved',
  unachievable: 'Unachievable',
  insufficient_data: 'Insufficient data',
}

export function parseTarget(value) {
  if (value === '' || value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : NaN
}

/**
 * Feasibility of a typed target against a reach the backend computed.
 * reach: { known, max_exact, maximum, bound_only, missing }
 * Returns { state: 'empty' | 'invalid' | 'impossible' | 'unverified' | 'ok', suggested? }
 */
export function checkTarget(value, reach, { min = 0, max = 100 } = {}) {
  const target = parseTarget(value)
  if (target == null) return { state: 'empty' }
  if (Number.isNaN(target) || target < min || target > max) return { state: 'invalid' }
  if (!reach || !reach.known || reach.max_exact == null) return { state: 'unverified' }
  // Compare with the exact maximum, never the rounded one shown on screen
  if (target > reach.max_exact + EPS) return { state: 'impossible', suggested: reach.maximum }
  if (reach.bound_only) return { state: 'unverified' }
  return { state: 'ok' }
}

/** Short line under an input: what the records allow. */
export function reachLine(reach, unit = '%', decimals = 1) {
  if (!reach) return null
  if (!reach.known || reach.maximum == null) {
    const missing = (reach.missing || []).join('; ')
    return missing ? `Can't verify yet: missing ${missing}` : "Can't verify yet: not enough data"
  }
  const value = Number(reach.maximum).toFixed(decimals).replace(/\.0+$/, '')
  const label = reach.final ? 'Final result' : reach.bound_only ? 'At most' : 'Maximum achievable'
  return `${label}: ${value}${unit}`
}

/** Progress toward a target as a 0-100 bar width; null without both numbers. */
export function progressPct(current, target) {
  if (current == null || target == null || target <= 0) return null
  return Math.max(0, Math.min(100, Math.round((current / target) * 100)))
}

/** Field errors from a rejected save, keyed like the form. */
export function serverFieldErrors(detail) {
  const errors = detail?.errors || {}
  return {
    gpa: errors.target_gpa || null,
    attendance: errors.target_attendance || null,
    courses: errors.course_targets || {},
  }
}
