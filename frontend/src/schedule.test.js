import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UNKNOWN_DAY, classTimes, findNextClass, getDayOrder, mergeBlocks, normalizeSchedule, sortSchedule } from './schedule.js'

test('day is read from weekday names, numbers and other field names', () => {
  assert.equal(getDayOrder({ weekday: 'Monday' }), 1)
  assert.equal(getDayOrder({ weekday: 'wed.' }), 3)
  assert.equal(getDayOrder({ weekday: 'Пятница' }), 5)
  assert.equal(getDayOrder({ day_of_week: 2 }), 2)
  assert.equal(getDayOrder({ day: '6' }), 6)
  assert.equal(getDayOrder({ day_number: 7 }), 7)
  assert.equal(getDayOrder({ course_code: 'INF 381' }), UNKNOWN_DAY)
})

test('SDU "times" strings become one row per period', () => {
  const rows = normalizeSchedule([{ course_code: 'INF 381', times: '1.08:30,3.10:30' }])
  assert.deepEqual(rows.map(r => [getDayOrder(r), ...classTimes(r)]), [[1, '08:30', '09:20'], [3, '10:30', '11:20']])
})

test('rows with an unreadable day are kept, not dropped', () => {
  const rows = normalizeSchedule([{ course_code: 'INF 381' }, null, { weekday: 'Tuesday', start_time: '09:30:00' }])
  assert.equal(rows.length, 2)
  assert.equal(sortSchedule(rows).at(-1).course_code, 'INF 381')
})

test('next class skips rows without a day and wraps to next week', () => {
  const rows = [
    { course_code: 'A', weekday: 'Monday', start_time: '08:30' },
    { course_code: 'B', weekday: 'Wednesday', start_time: '10:30' },
    { course_code: 'X' },
  ]
  const wednesdayNoon = new Date(2026, 9, 21, 12, 0)
  assert.equal(findNextClass(rows, wednesdayNoon).course.course_code, 'A')
  const mondayMorning = new Date(2026, 9, 19, 8, 0)
  assert.deepEqual(findNextClass(rows, mondayMorning), { course: rows[0], isToday: true })
  assert.equal(findNextClass([{ course_code: 'X' }]), null)
})

test('back-to-back periods merge within a day, never across days', () => {
  const rows = sortSchedule(normalizeSchedule([{ course_code: 'INF 381', times: '1.08:30,1.09:30,2.10:30' }]))
  const blocks = mergeBlocks(rows)
  assert.deepEqual(blocks.map(b => [getDayOrder(b), b._start, b._end, b._parts.length]), [[1, '08:30', '10:20', 2], [2, '10:30', '11:20', 1]])
  // Monday ends 10:20, Tuesday starts 10:30: same course and room, still two days
  const edge = mergeBlocks(sortSchedule([
    { course_code: 'A', weekday: 'Monday', start_time: '09:30', end_time: '10:20' },
    { course_code: 'A', weekday: 'Tuesday', start_time: '10:30', end_time: '11:20' },
  ]))
  assert.equal(edge.length, 2)
})
