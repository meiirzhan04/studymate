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

/* ─── What-if planner for one course (Goals page) ──────────────────────
 * Same official SDU scale as the backend: (lowest percent, letter, grade point).
 */
export const SDU_SCALE = [
  [95, 'A', 4.0], [90, 'A-', 3.67], [85, 'B+', 3.33], [80, 'B', 3.0], [75, 'B-', 2.67], [70, 'C+', 2.33],
  [65, 'C', 2.0], [60, 'C-', 1.67], [55, 'D+', 1.33], [50, 'D', 1.0],
]

export function letterFor(percent) {
  const hit = SDU_SCALE.find(([min]) => percent >= min - 1e-9)
  return hit ? { letter: hit[1], gp: hit[2] } : { letter: 'F', gp: 0 }
}

/**
 * Final course result for scores the student types in (weights in %, scores 0-100 or '').
 * Returns the total when every weight is valid; with exactly one blank score it also returns
 * the score that blank needs for the target.
 */
export function simulateCourse(rows, target) {
  const parsed = rows.map(r => ({
    name: r.name,
    weight: Number(r.weight),
    score: r.score === '' || r.score == null ? null : Number(r.score),
  }))
  const totalWeight = parsed.reduce((sum, r) => sum + (Number.isFinite(r.weight) ? r.weight : 0), 0)
  if (parsed.some(r => !Number.isFinite(r.weight) || r.weight <= 0) || Math.abs(totalWeight - 100) > 0.5) {
    return { state: 'weights', totalWeight: Math.round(totalWeight * 10) / 10 }
  }
  if (parsed.some(r => r.score != null && (!Number.isFinite(r.score) || r.score < 0 || r.score > 100))) {
    return { state: 'scores' }
  }
  const earned = parsed.reduce((sum, r) => sum + (r.score ?? 0) * r.weight / 100, 0)
  const blanks = parsed.filter(r => r.score == null)
  const out = { earned: Math.round(earned * 10) / 10, blanks: blanks.length }
  if (!blanks.length) {
    const total = Math.round(earned * 10) / 10
    return { ...out, state: 'total', total, ...letterFor(earned), reaches: target == null ? null : earned >= target - 1e-9 }
  }
  out.state = 'partial'
  out.max = Math.round((earned + blanks.reduce((sum, r) => sum + r.weight, 0)) * 10) / 10
  if (target != null && blanks.length === 1) {
    const need = (target - earned) / (blanks[0].weight / 100)
    out.need = { name: blanks[0].name, score: Math.ceil(Math.max(0, need) * 10 - 1e-9) / 10, possible: need <= 100 + 1e-9 }
  }
  return out
}
