import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkTarget, parseTarget, progressPct, reachLine, serverFieldErrors } from './goals.js'

const reach = { known: true, max_exact: 89.56, maximum: 89.5, bound_only: false }

test('an impossible target is caught against the exact maximum, not the rounded one', () => {
  assert.deepEqual(checkTarget('98', reach), { state: 'impossible', suggested: 89.5 })
  assert.equal(checkTarget('89.56', reach).state, 'ok')
  assert.equal(checkTarget('89.57', reach).state, 'impossible')   // rounding never lets it through
})

test('missing data is reported as unverifiable, never as possible or impossible', () => {
  assert.equal(checkTarget('95', { known: false, missing: ['class-hour counts'] }).state, 'unverified')
  assert.equal(checkTarget('95', null).state, 'unverified')
  // A range from courses without a breakdown: above the top is impossible, below cannot be confirmed
  const bound = { known: true, max_exact: 3.8, maximum: 3.8, bound_only: true }
  assert.equal(checkTarget('3.9', bound, { min: 1, max: 4 }).state, 'impossible')
  assert.equal(checkTarget('3.5', bound, { min: 1, max: 4 }).state, 'unverified')
})

test('empty and out-of-range inputs', () => {
  assert.equal(checkTarget('', reach).state, 'empty')
  assert.equal(checkTarget('abc', reach).state, 'invalid')
  assert.equal(checkTarget('120', reach).state, 'invalid')
  assert.equal(parseTarget(''), null)
})

test('reach line explains the maximum or what is missing', () => {
  assert.equal(reachLine(reach), 'Maximum achievable: 89.5%')
  assert.equal(reachLine({ ...reach, final: true }), 'Final result: 89.5%')
  assert.equal(reachLine({ known: true, maximum: 3.5, bound_only: true }, '', 2), 'At most: 3.50')
  assert.equal(reachLine({ known: false, missing: ['assessment weights and grades'] }),
    "Can't verify yet: missing assessment weights and grades")
})

test('progress is capped and needs both numbers', () => {
  assert.equal(progressPct(3.5, 3.8), 92)
  assert.equal(progressPct(95, 90), 100)
  assert.equal(progressPct(null, 90), null)
})

test('server errors map onto form fields', () => {
  const detail = { errors: { target_attendance: { message: 'no', suggested: 89.6 }, course_targets: { 'INF 101': { message: 'x' } } } }
  const mapped = serverFieldErrors(detail)
  assert.equal(mapped.gpa, null)
  assert.equal(mapped.attendance.suggested, 89.6)
  assert.deepEqual(Object.keys(mapped.courses), ['INF 101'])
})

import { letterFor, simulateCourse } from './goals.js'

const rows = (...r) => r.map(([name, weight, score]) => ({ name, weight, score }))

test('what-if total and letter from the scores typed in', () => {
  const out = simulateCourse(rows(['Quizzes', 20, '90'], ['MT', 30, '86.7'], ['FIN', 50, '92']), 90)
  assert.equal(out.state, 'total')
  assert.equal(out.total, 90.0)
  assert.equal(out.letter, 'A-')
  assert.equal(out.reaches, true)
})

test('one blank score: what it needs for the target', () => {
  const out = simulateCourse(rows(['Coursework', 60, '94'], ['Final Exam', 40, '']), 90)
  assert.equal(out.state, 'partial')
  assert.deepEqual(out.need, { name: 'Final Exam', score: 84, possible: true })
  assert.equal(simulateCourse(rows(['MT', 60, '50'], ['FIN', 40, '']), 95).need.possible, false)
})

test('weights must add up to 100 and scores stay in range', () => {
  assert.equal(simulateCourse(rows(['MT', 30, '80'], ['FIN', 40, '']), 90).state, 'weights')
  assert.equal(simulateCourse(rows(['MT', 50, '120'], ['FIN', 50, '']), 90).state, 'scores')
  assert.deepEqual(letterFor(94.99), { letter: 'A-', gp: 3.67 })
  assert.deepEqual(letterFor(49), { letter: 'F', gp: 0 })
})
