import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcGPA, calcCompletedCredits, ectsOf } from './gpa.js'

// Shape of SDU transcript rows: local credits AND ECTS; P/IP rows carry no grade_point
const row = (semester, credits, ects, grade_point, passed = true) => ({ semester, credits, ects, grade_point, passed })

// Semester 1 of a real SDU transcript; SDU reports SPA 2.95 for it
const SEMESTER_1 = [
  row(1, 3, 5, 3.67), row(1, 3, 5, 2.33), row(1, 4, 5, 2.33),
  row(1, 5, 6, null),            // General English: P, not in GPA
  row(1, 1, 0, null),            // Community engagement: P, 0 ECTS
  row(1, 3, 5, 3.0), row(1, 3, 4, 3.0), row(1, 1, 2, 4.0),
]

test('GPA is weighted by ECTS like the official SDU transcript', () => {
  assert.equal(calcGPA(SEMESTER_1).toFixed(2), '2.95')   // credit-weighted would give 2.90
})

test('P and in-progress courses are left out of the GPA', () => {
  const withIp = [...SEMESTER_1, row(5, 3, 5, null, false)]
  assert.equal(calcGPA(withIp).toFixed(2), '2.95')
})

test('completed credits are counted in ECTS, including passed P courses', () => {
  assert.equal(calcCompletedCredits(SEMESTER_1), 32)          // SDU: 32 ECTS for semester 1
  assert.equal(calcCompletedCredits([row(5, 3, 5, null, false)]), 0)
})

test('ectsOf keeps a real 0 ECTS and falls back to credits only when ECTS is missing', () => {
  assert.equal(ectsOf({ credits: 1, ects: 0 }), 0)
  assert.equal(ectsOf({ credits: 3 }), 3)
  assert.equal(ectsOf({}), 0)
})

test('no graded courses means no GPA', () => {
  assert.equal(calcGPA([]), null)
  assert.equal(calcGPA([row(5, 3, 5, null, false)]), null)
})
