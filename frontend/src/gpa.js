/* ─── GPA & credits, matching the official SDU transcript ─────────────
 * SDU transcripts list both local credits and ECTS. The published GPA/SPA
 * numbers are ECTS-weighted, and every "ECTS" label in the app means ECTS,
 * so ECTS wins and local credits are only a fallback when ECTS is missing.
 */

// `??` keeps a real 0 ECTS (e.g. Community engagement) instead of falling back
export const ectsOf = c => Number(c?.ects ?? c?.credits ?? 0) || 0

export function calcGPA(transcript) {
  if (!transcript || !transcript.length) return null
  const graded = transcript.filter(c =>
    c.grade_point != null && c.grade_point !== '' && !isNaN(Number(c.grade_point)) && ectsOf(c) > 0)
  if (!graded.length) return null
  const totalEcts = graded.reduce((sum, c) => sum + ectsOf(c), 0)
  const totalPoints = graded.reduce((sum, c) => sum + Number(c.grade_point) * ectsOf(c), 0)
  return totalEcts > 0 ? totalPoints / totalEcts : null
}

export function calcCompletedCredits(transcript) {
  if (!transcript || !transcript.length) return 0
  return transcript.filter(c => c.passed === true).reduce((sum, c) => sum + ectsOf(c), 0)
}
