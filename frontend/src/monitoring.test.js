import test from 'node:test'
import assert from 'node:assert/strict'
import { curveRows, lastSyncedLabel, riskTone, signed, skipLine } from './monitoring.js'

test('skipLine states limit, used and remaining hours', () => {
  assert.equal(skipLine({ limit: 9, absent: 4 }), 'Absence limit: 9. You have: 4. Remaining: 5.')
  assert.equal(skipLine({ limit: 8, absent: 11 }), 'Absence limit: 8. You have: 11. Remaining: 0.')
})

test('riskTone maps a percentage to green, yellow or red', () => {
  assert.deepEqual([10, 25, 49, 50, 90].map(riskTone), ['success', 'warning', 'warning', 'danger', 'danger'])
  assert.equal(riskTone(null), 'neutral')
})

test('signed shows direction with a real minus sign', () => {
  assert.equal(signed(0.24), '+0.2')
  assert.equal(signed(-0.31), '−0.3')
  assert.equal(signed(0), '0.0')
  assert.equal(signed(-12, 0, '%'), '−12%')
})

test('curveRows converts risk to percent', () => {
  assert.deepEqual(curveRows([{ hours: 2, risk: 0.153, predicted_gpa: 3.4, fx: false }]), [{ hours: 2, risk: 15, gpa: 3.4, fx: false }])
})

test('lastSyncedLabel counts minutes, hours and days', () => {
  const now = Date.parse('2026-11-21T12:00:00Z')
  assert.equal(lastSyncedLabel('2026-11-21T11:55:00Z', now), 'Last synced: 5 mins ago')
  assert.equal(lastSyncedLabel('2026-11-21T11:59:40Z', now), 'Last synced: just now')
  assert.equal(lastSyncedLabel('2026-11-21T09:00:00Z', now), 'Last synced: 3 hours ago')
  assert.equal(lastSyncedLabel(null, now), 'Not synced yet')
})

import { costLine, pointAt, roundHalfUp, simulationView, skippedHours } from './monitoring.js'

const curve = Array.from({ length: 13 }, (_, h) => ({ hours: h, risk: Math.min(0.9, h * 0.05), predicted_gpa: 3 - h * 0.1, fx: h >= 9, fx_courses: h >= 9 ? ['INF 451'] : [] }))

test('skippedHours uses the server cost per lecture and practice', () => {
  assert.equal(skippedHours(2, 1), 3)
  assert.equal(skippedHours(2, 1, { lecture: 2, practice: 1.5 }), 5.5)
})

test('pointAt reads the curve and interpolates between whole hours', () => {
  assert.equal(pointAt(curve, 4).risk, 0.2)
  assert.ok(Math.abs(pointAt(curve, 2.5).gpa - 2.75) < 1e-9)
  assert.equal(pointAt(curve, 99).hours, 12)             // never past the end of the curve
  assert.equal(pointAt([], 3), null)
})

test('simulationView gives the numbers and the message without a server call', () => {
  const v = simulationView(curve, 6)
  assert.equal(v.afterRisk, 30); assert.equal(v.riskChange, 30)
  assert.ok(Math.abs(v.gpaChange + 0.6) < 1e-9)
  assert.equal(v.message, 'New predicted GPA: 2.4. Dropout risk: 30%.')
  const fx = simulationView(curve, 10)
  assert.deepEqual(fx.fxCourses, ['INF 451'])
  assert.match(fx.message, /^Skipping 10 hour\(s\) puts INF 451 over the 30% absence limit \(FX\)\./)
})

test('roundHalfUp matches the server rounding', () => { assert.equal(roundHalfUp(2.25), 2.3); assert.equal(roundHalfUp(2.24), 2.2) })

test('costLine explains the weight of one missed hour', () => {
  const cost = { name: 'Industrial practice 1', hours: 15, weekly_hours: 1, limit: 4, cost_per_hour_pct: 25 }
  assert.equal(costLine(cost), 'Industrial practice 1 has about 1 class hour a week (15 in the term), so one missed hour uses 25% of the 4 absences allowed before FX.')
  assert.match(costLine({ ...cost, weekly_hours: 3, hours: 45 }, true), /^Most sensitive course: Industrial practice 1 has about 3 class hours a week/)
  assert.equal(costLine(null), '')
})
