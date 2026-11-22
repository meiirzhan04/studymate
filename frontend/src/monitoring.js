// Pure helpers for the Monitoring tab (kept free of React so they can be unit-tested with `node --test`).

export const LEVEL_TONE = { safe: 'success', warning: 'warning', danger: 'danger', unknown: 'neutral' }
export const RISK_TONE = { low: 'success', medium: 'warning', high: 'danger' }
export const SEVERITY_TONE = { critical: 'danger', high: 'danger', medium: 'warning', info: 'neutral' }
export const SEVERITY_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', info: 'Info' }

/** "Absence limit: 9. You have: 4. Remaining: 5." */
export function skipLine(course) {
  return `Absence limit: ${course.limit}. You have: ${course.absent}. Remaining: ${Math.max(0, course.limit - course.absent)}.`
}

/** Colour of a risk percentage: green below 25, yellow below 50, red from 50. */
export function riskTone(percent) {
  if (percent == null) return 'neutral'
  return percent >= 50 ? 'danger' : percent >= 25 ? 'warning' : 'success'
}

/** Shape the simulation curve for the chart: risk in %, GPA as is. */
export function curveRows(curve = []) {
  return curve.map(p => ({ hours: p.hours, risk: Math.round(p.risk * 100), gpa: p.predicted_gpa, fx: !!p.fx }))
}

/** "+0.2" / "-0.3" / "0.0" for GPA and risk changes. */
export function signed(value, digits = 1, unit = '') {
  if (value == null || Number.isNaN(value)) return '—'
  const n = Number(value)
  if (Math.abs(n) < 10 ** -digits / 2) return `${(0).toFixed(digits)}${unit}`
  return `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}${unit}`
}

/** Plain-language "Last synced: 5 mins ago" from an ISO time. */
export function lastSyncedLabel(iso, now = Date.now()) {
  if (!iso) return 'Not synced yet'
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000))
  if (Number.isNaN(mins)) return 'Not synced yet'
  if (mins < 1) return 'Last synced: just now'
  if (mins < 60) return `Last synced: ${mins} ${mins === 1 ? 'min' : 'mins'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Last synced: ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  return `Last synced: ${days} ${days === 1 ? 'day' : 'days'} ago`
}

/** Round half up, so the screen and the server message agree (2.25 -> 2.3). */
export const roundHalfUp = (x, digits = 1) => Math.floor(x * 10 ** digits + 0.5) / 10 ** digits

/** Class hours skipped: lectures and practices times what one of each costs (server setting, 1 hour by default). */
export function skippedHours(lectures, practices, perClass = {}) {
  return lectures * (perClass.lecture ?? 1) + practices * (perClass.practice ?? 1)
}

/** Risk (0-1), GPA and FX state after `hours` skipped hours, read from the server curve (linear between whole hours). */
export function pointAt(curve = [], hours = 0) {
  if (!curve.length) return null
  const h = Math.max(0, Math.min(hours, curve.length - 1))
  const lo = Math.floor(h), hi = Math.ceil(h), t = h - lo
  const a = curve[lo], b = curve[hi]
  return {
    hours: h, risk: a.risk + (b.risk - a.risk) * t, gpa: a.predicted_gpa + (b.predicted_gpa - a.predicted_gpa) * t,
    fx: t > 0 ? b.fx : a.fx, fxCourses: (t > 0 ? b.fx_courses : a.fx_courses) || [],
  }
}

/** Everything the simulation card shows, computed locally from the curve so sliders react instantly. */
export function simulationView(curve = [], hours = 0) {
  const before = pointAt(curve, 0), after = pointAt(curve, hours)
  if (!before || !after) return null
  const shown = Number.isInteger(hours) ? hours : roundHalfUp(hours, 1)
  const base = `New predicted GPA: ${roundHalfUp(after.gpa, 1).toFixed(1)}. Dropout risk: ${Math.round(after.risk * 100)}%.`
  return {
    beforeRisk: Math.round(before.risk * 100), afterRisk: Math.round(after.risk * 100),
    beforeGpa: before.gpa, afterGpa: after.gpa,
    gpaChange: after.gpa - before.gpa, riskChange: Math.round(after.risk * 100) - Math.round(before.risk * 100),
    fxCourses: after.fxCourses,
    message: after.fxCourses.length
      ? `Skipping ${shown} hour(s) puts ${after.fxCourses.join(', ')} over the 30% absence limit (FX). ${base}` : base,
  }
}

/** Why one missed hour weighs differently per course: few weekly lessons = a small allowance. */
export function costLine(cost, allCourses = false) {
  if (!cost) return ''
  const w = Number.isInteger(cost.weekly_hours) ? String(cost.weekly_hours) : cost.weekly_hours.toFixed(1)
  const lead = allCourses ? `Most sensitive course: ${cost.name} has` : `${cost.name} has`
  return `${lead} about ${w} class hour${cost.weekly_hours === 1 ? '' : 's'} a week (${cost.hours} in the term), so one missed hour uses ${cost.cost_per_hour_pct}% of the ${cost.limit} absences allowed before FX.`
}
