import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_COURSES, FOCUS_MS, NOTE_LIMIT,
  addTask, clampNote, courseKey, courseOptions, csvCell, deadlinesToCsv, filterDeadlines, formatTimer,
  idleTimer, loadNote, loadPins, loadTasks, orderByPins, pauseTimer, resetTimer, saveNote, savePins, saveTasks,
  startTimer, storageKey, tickTimer, toggleTask, togglePin,
} from './study.js'

// Minimal localStorage stand-in; `reload()` keeps the data like a page reload in the same browser
const fakeStorage = () => {
  const data = new Map()
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: k => void data.delete(k),
  }
}

/* ── US-27 ─────────────────────────────────────────────────────────── */

test('US-27: a task is added unchecked, with its title trimmed', () => {
  const { tasks, error } = addTask([], '  Review SQL  ', 'a')
  assert.equal(error, null)
  assert.deepEqual(tasks, [{ id: 'a', title: 'Review SQL', done: false }])
})

test('US-27: completion survives a reload and only the chosen task is checked', () => {
  const store = fakeStorage()
  let tasks = addTask([], 'Review SQL', 'a').tasks
  tasks = addTask(tasks, 'Read chapter 4', 'b').tasks
  tasks = toggleTask(tasks, 'a')
  saveTasks(store, 'u1', tasks)
  const restored = loadTasks(store, 'u1')
  assert.deepEqual(restored.map(t => [t.title, t.done]), [['Review SQL', true], ['Read chapter 4', false]])
  assert.equal(toggleTask(restored, 'a')[0].done, false)   // and it can be reopened
})

test('US-27: an empty or spaces-only title leaves the checklist unchanged', () => {
  const before = [{ id: 'a', title: 'Review SQL', done: false }]
  for (const title of ['', '   ', '\t\n', null, undefined]) {
    const out = addTask(before, title)
    assert.equal(out.tasks, before)
    assert.ok(out.error)
  }
})

test('US-27: each student account has its own checklist', () => {
  const store = fakeStorage()
  saveTasks(store, 'u1', addTask([], 'Mine', 'a').tasks)
  assert.deepEqual(loadTasks(store, 'u2'), [])
  assert.equal(loadTasks(store, 'u1').length, 1)
})

test('US-27: damaged saved data is ignored instead of breaking the page', () => {
  const store = fakeStorage()
  store.setItem(storageKey('tasks', 'u1'), '{not json')
  assert.deepEqual(loadTasks(store, 'u1'), [])
  store.setItem(storageKey('tasks', 'u1'), JSON.stringify([{ id: 'a', title: 'ok' }, { title: 5 }, null]))
  assert.deepEqual(loadTasks(store, 'u1'), [{ id: 'a', title: 'ok', done: false }])
})

/* ── US-28 ─────────────────────────────────────────────────────────── */

const databases = { course_code: 'CSS 220', course_name: 'Databases' }
const calculus = { course_code: 'MAT 101', course_name: 'Calculus' }

test('US-28: a note is saved, restored, and can be edited', () => {
  const store = fakeStorage()
  assert.equal(loadNote(store, 'u1', databases), '')
  saveNote(store, 'u1', databases, 'Review joins')
  assert.equal(loadNote(store, 'u1', databases), 'Review joins')
  saveNote(store, 'u1', databases, 'Review joins and indexes')
  assert.equal(loadNote(store, 'u1', databases), 'Review joins and indexes')
})

test('US-28: notes of different courses and students stay separate', () => {
  const store = fakeStorage()
  saveNote(store, 'u1', databases, 'Review joins')
  assert.equal(loadNote(store, 'u1', calculus), '')
  assert.equal(loadNote(store, 'u2', databases), '')
})

test('US-28: a note is limited to 500 characters', () => {
  const store = fakeStorage()
  assert.equal(clampNote('x'.repeat(900)).length, NOTE_LIMIT)
  saveNote(store, 'u1', databases, 'y'.repeat(900))
  assert.equal(loadNote(store, 'u1', databases).length, NOTE_LIMIT)
})

test('US-28: clearing a note removes it; a course falls back to its name without a code', () => {
  const store = fakeStorage()
  saveNote(store, 'u1', databases, 'x')
  saveNote(store, 'u1', databases, '   ')
  assert.equal(loadNote(store, 'u1', databases), '')
  assert.equal(courseKey({ course_name: 'Databases' }), 'Databases')
  assert.equal(saveNote(store, 'u1', {}, 'orphan'), false)
})

/* ── US-29 ─────────────────────────────────────────────────────────── */

test('US-29: a fresh timer shows 25:00 and is idle', () => {
  const t = idleTimer()
  assert.equal(t.status, 'idle')
  assert.equal(formatTimer(t.remainingMs), '25:00')
})

test('US-29: after two seconds a running timer shows 24:58', () => {
  const t0 = 1_000_000
  const running = tickTimer(startTimer(idleTimer(), t0), t0 + 2000)
  assert.equal(running.status, 'running')
  assert.equal(formatTimer(running.remainingMs), '24:58')
})

test('US-29: pausing holds the value, resuming continues from it, reset returns to 25:00', () => {
  const t0 = 5_000
  let t = startTimer(idleTimer(), t0)
  t = pauseTimer(t, t0 + 10_000)
  assert.equal(t.status, 'paused')
  assert.equal(formatTimer(t.remainingMs), '24:50')
  assert.equal(tickTimer(t, t0 + 60_000), t)               // time passing while paused changes nothing
  t = startTimer(t, t0 + 60_000)                           // resume
  t = tickTimer(t, t0 + 65_000)
  assert.equal(formatTimer(t.remainingMs), '24:45')
  assert.deepEqual(resetTimer(), idleTimer())
  assert.equal(formatTimer(resetTimer().remainingMs), '25:00')
})

test('US-29: the timer stops at 00:00 and reports the session as done', () => {
  const t0 = 0
  let t = startTimer({ status: 'idle', remainingMs: 1000, endsAt: null }, t0)
  t = tickTimer(t, t0 + 999)
  assert.equal(t.status, 'running')
  assert.equal(formatTimer(t.remainingMs), '00:01')
  t = tickTimer(t, t0 + 1000)
  assert.equal(t.status, 'done')
  assert.equal(formatTimer(t.remainingMs), '00:00')
  assert.equal(startTimer(t, t0 + 5000), t)                // a finished session does not restart until reset
  assert.equal(tickTimer(t, t0 + 9000), t)
})

test('US-29: a backgrounded tab that catches up late still lands on the right time', () => {
  const t = tickTimer(startTimer(idleTimer(), 0), FOCUS_MS + 60_000)
  assert.equal(t.status, 'done')
})

/* ── US-30 ─────────────────────────────────────────────────────────── */

const course = (name, code) => ({ course_name: name, course_code: code })
const list = [course('Calculus', 'MAT 101'), course('Databases', 'CSS 220'), course('Physics', 'PHY 110'), course('Algorithms', 'CSS 230')]
const names = cs => cs.map(c => c.course_name)

test('US-30: a pinned course moves above unpinned ones, original order kept inside each group', () => {
  assert.deepEqual(names(orderByPins(list, ['CSS 220'])), ['Databases', 'Calculus', 'Physics', 'Algorithms'])
  assert.deepEqual(names(orderByPins(list, ['CSS 230', 'CSS 220'])), ['Databases', 'Algorithms', 'Calculus', 'Physics'])
})

test('US-30: unpinning restores the original order, and the input list is never changed', () => {
  const original = names(list)
  const pins = togglePin(togglePin([], 'CSS 220'), 'CSS 220')
  assert.deepEqual(pins, [])
  assert.deepEqual(names(orderByPins(list, pins)), original)
  assert.deepEqual(names(list), original)
})

test('US-30: pins are saved per student and survive a reload', () => {
  const store = fakeStorage()
  savePins(store, 'u1', ['CSS 220'])
  assert.deepEqual(loadPins(store, 'u1'), ['CSS 220'])
  assert.deepEqual(loadPins(store, 'u2'), [])
  store.setItem(storageKey('pins', 'u3'), '"oops"')
  assert.deepEqual(loadPins(store, 'u3'), [])
})

/* ── US-31 ─────────────────────────────────────────────────────────── */

// Built from local date parts so the expected text does not depend on the machine's time zone
const due = (d, h, m) => new Date(2026, 10, d, h, m).toISOString()
const deadlines = [
  { id: 1, title: 'Lab 4', course: 'Databases', due_at: due(25, 9, 30) },
  { id: 2, title: 'Review joins, views and indexes', course: 'Databases', due_at: due(26, 18, 5) },
]
const parseRows = csv => csv.replace(/^﻿/, '').trimEnd().split('\r\n')

test('US-31: the CSV has a header row and one row per deadline', () => {
  const rows = parseRows(deadlinesToCsv(deadlines))
  assert.equal(rows[0], 'Assignment,Course,Due date')
  assert.equal(rows.length, 3)
  assert.equal(rows[1], 'Lab 4,Databases,2026-11-25 09:30')
})

test('US-31: a title with commas stays in one cell', () => {
  const rows = parseRows(deadlinesToCsv(deadlines))
  assert.equal(rows[2], '"Review joins, views and indexes",Databases,2026-11-26 18:05')
})

test('US-31: quotes, line breaks and formula characters are escaped; UTF-8 marker is present', () => {
  assert.equal(csvCell('Say "hi"'), '"Say ""hi"""')
  assert.equal(csvCell('two\nlines'), '"two\nlines"')
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)")
  assert.equal(csvCell(null), '')
  assert.ok(deadlinesToCsv(deadlines).startsWith('﻿'))
  assert.match(deadlinesToCsv([{ title: 'Эссе', course: 'Философия', due_at: due(1, 8, 0) }]), /Эссе,Философия/)
})

test('US-31: an empty list still gives a valid header-only file', () => {
  assert.deepEqual(parseRows(deadlinesToCsv([])), ['Assignment,Course,Due date'])
})

/* ── US-32 ─────────────────────────────────────────────────────────── */

const mixed = [
  { id: 1, title: 'Lab 4', course: 'Databases', due_at: due(25, 9, 0) },
  { id: 2, title: 'Quiz', course: 'Physics', due_at: due(26, 9, 0) },
  { id: 3, title: 'Project', course: 'databases ', due_at: due(27, 9, 0) },
]

test('US-32: choosing a course shows only its deadlines, in their existing order', () => {
  const options = courseOptions(['Databases', 'Calculus'], mixed)
  const databasesOption = options.find(o => o.label === 'Databases')
  assert.deepEqual(filterDeadlines(mixed, databasesOption.value).map(d => d.id), [1, 3])
})

test('US-32: All courses brings back the complete list unchanged', () => {
  assert.equal(filterDeadlines(mixed, ALL_COURSES), mixed)
  assert.equal(filterDeadlines(mixed, ''), mixed)
})

test('US-32: a course with no deadlines gives an empty list, so the page can show its message', () => {
  const calculus = courseOptions(['Databases', 'Calculus'], mixed).find(o => o.label === 'Calculus')
  assert.deepEqual(filterDeadlines(mixed, calculus.value), [])
})

test('US-32: options list each course once, student courses first, and filtering never edits the records', () => {
  const options = courseOptions(['Databases', 'Calculus', 'DATABASES'], mixed)
  assert.deepEqual(options.map(o => o.label), ['Databases', 'Calculus', 'Physics'])
  const snapshot = JSON.stringify(mixed)
  filterDeadlines(mixed, options[0].value)
  assert.equal(JSON.stringify(mixed), snapshot)
})
