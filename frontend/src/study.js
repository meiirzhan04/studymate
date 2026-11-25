/* ─── Personal study tools (US-27 … US-32) ─────────────────────────────
 * Everything here is pure logic with no React and no globals, so it can be tested with
 * `node --test`. Anything that is stored lives in the current browser and is keyed by the
 * student account (and by course where the story asks for it).
 */

/* ── Browser storage, scoped per student ───────────────────────────── */

const STORE_PREFIX = 'sm_study'

export function storageKey(kind, userId, scope = '') {
  const who = encodeURIComponent(String(userId ?? 'anonymous'))
  const tail = scope === '' ? '' : `:${encodeURIComponent(String(scope))}`
  return `${STORE_PREFIX}:${kind}:${who}${tail}`
}

function readJson(storage, key, fallback) {
  try {
    const raw = storage?.getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

function writeJson(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false   // private mode / full quota: the app keeps working, just without saving
  }
}

/* ── US-27 Personal study checklist ────────────────────────────────── */

export const TASK_TITLE_LIMIT = 120

/** Add a task. Titles are trimmed; one that is empty after trimming leaves the list unchanged. */
export function addTask(tasks, title, id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`) {
  const clean = String(title ?? '').trim()
  if (!clean) return { tasks, error: 'Enter a task title.' }
  if (clean.length > TASK_TITLE_LIMIT) return { tasks, error: `Keep the title under ${TASK_TITLE_LIMIT} characters.` }
  return { tasks: [...tasks, { id, title: clean, done: false }], error: null }
}

/** Mark a task complete, or reopen it. */
export function toggleTask(tasks, id) {
  return tasks.map(t => (t.id === id ? { ...t, done: !t.done } : t))
}

/** Edit an existing task without changing its completion status. */
export function editTask(tasks, id, title) {
  const clean = String(title ?? '').trim()

  if (!clean) {
    return { tasks, error: 'Enter a task title.' }
  }

  if (clean.length > TASK_TITLE_LIMIT) {
    return {
      tasks,
      error: `Keep the title under ${TASK_TITLE_LIMIT} characters.`
    }
  }

  return {
    tasks: tasks.map(t =>
      t.id === id ? { ...t, title: clean } : t
    ),
    error: null
  }
}

/** Remove a task from the checklist. */
export function deleteTask(tasks, id) {
  return tasks.filter(t => t.id !== id)
}

export function taskSummary(tasks) {
  const done = tasks.filter(t => t.done).length
  return { done, total: tasks.length }
}

function cleanTasks(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter(t => t && typeof t.id === 'string' && typeof t.title === 'string' && t.title.trim())
    .map(t => ({ id: t.id, title: t.title.trim(), done: t.done === true }))
}

export const loadTasks = (storage, userId) => cleanTasks(readJson(storage, storageKey('tasks', userId), []))
export const saveTasks = (storage, userId, tasks) => writeJson(storage, storageKey('tasks', userId), tasks)

/* ── US-28 Personal course notes ───────────────────────────────────── */

export const NOTE_LIMIT = 500

/** Stable key for a course: its code, or its name when the code is missing. */
export function courseKey(course) {
  return String(course?.course_code || course?.course_name || '').trim()
}

export function clampNote(text) {
  return String(text ?? '').slice(0, NOTE_LIMIT)
}

export function loadNote(storage, userId, course) {
  const key = courseKey(course)
  if (!key) return ''
  const value = readJson(storage, storageKey('note', userId, key), '')
  return typeof value === 'string' ? clampNote(value) : ''
}

/** Save the note for one course. An empty note removes the stored entry. */
export function saveNote(storage, userId, course, text) {
  const key = courseKey(course)
  if (!key) return false
  const note = clampNote(text)
  if (!note.trim()) {
    try { storage?.removeItem(storageKey('note', userId, key)); return true } catch { return false }
  }
  return writeJson(storage, storageKey('note', userId, key), note)
}

/* ── US-29 Study focus timer ───────────────────────────────────────── */

export const FOCUS_MS = 25 * 60 * 1000

/**
 * State is { status: 'idle' | 'running' | 'paused' | 'done', remainingMs, endsAt }.
 * While running, `endsAt` is the wall-clock end, so the countdown stays right even if the
 * browser throttles timers in a background tab.
 */
export const idleTimer = (total = FOCUS_MS) => ({ status: 'idle', remainingMs: total, endsAt: null })

export function startTimer(state, now) {
  if (state.status === 'running' || state.status === 'done') return state
  return { status: 'running', remainingMs: state.remainingMs, endsAt: now + state.remainingMs }
}

export function pauseTimer(state, now) {
  if (state.status !== 'running') return state
  return { status: 'paused', remainingMs: Math.max(0, state.endsAt - now), endsAt: null }
}

export function resetTimer(total = FOCUS_MS) {
  return idleTimer(total)
}

/** Advance a running timer to `now`; stops at 00:00 and reports the session as done. */
export function tickTimer(state, now) {
  if (state.status !== 'running') return state
  const remainingMs = Math.max(0, state.endsAt - now)
  if (remainingMs === 0) return { status: 'done', remainingMs: 0, endsAt: null }
  return { ...state, remainingMs }
}

/** mm:ss, rounding up so a fresh session shows 25:00 and never reads 00:00 before it ends. */
export function formatTimer(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

/* ── US-30 Pin priority courses ────────────────────────────────────── */

/** Pinned courses first; the original order is kept inside each group. */
export function orderByPins(courses, pinned) {
  const set = pinned instanceof Set ? pinned : new Set(pinned)
  const isPinned = c => set.has(courseKey(c))
  return [...courses.filter(isPinned), ...courses.filter(c => !isPinned(c))]
}

export function togglePin(pinned, key) {
  return pinned.includes(key) ? pinned.filter(k => k !== key) : [...pinned, key]
}

export const loadPins = (storage, userId) => {
  const value = readJson(storage, storageKey('pins', userId), [])
  return Array.isArray(value) ? value.filter(k => typeof k === 'string' && k) : []
}
export const savePins = (storage, userId, pinned) => writeJson(storage, storageKey('pins', userId), pinned)

/* ── US-31 Deadlines as CSV ────────────────────────────────────────── */

const pad2 = n => String(n).padStart(2, '0')

/** Local date and time, "2026-11-25 09:30", readable in a spreadsheet. */
export function formatDueForCsv(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/**
 * One CSV cell. Values with commas, quotes or line breaks are quoted (quotes doubled), so a
 * title such as "Review joins, views and indexes" stays in a single cell. A leading = + - @
 * would make a spreadsheet run the cell as a formula, so those get a leading apostrophe.
 */
export function csvCell(value) {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const DEADLINE_CSV_HEADERS = ['Assignment', 'Course', 'Due date']
const UTF8_BOM = '﻿'   // lets Excel read non-ASCII titles as UTF-8

/** CSV text for upcoming deadlines: a header row plus one row per deadline. */
export function deadlinesToCsv(deadlines, courseLabel = d => d.course || '') {
  const rows = deadlines.map(d => [d.title, courseLabel(d), formatDueForCsv(d.due_at)])
  return UTF8_BOM + [DEADLINE_CSV_HEADERS, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/* ── US-32 Filter deadlines by course ──────────────────────────────── */

export const ALL_COURSES = 'all'

const normalizeCourseName = name =>
  String(name ?? '')
    .trim()
    .replace(/^[a-z]{2,6}\s*\d{3,5}\s*[-–:]?\s+/i, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Choices for the course filter: the student's own courses plus any course that appears on a
 * deadline, each once, in the order they were first seen. `label` turns a raw name into the
 * text shown on screen.
 */
export function courseOptions(studentCourses, deadlines, label = n => n) {
  const seen = new Map()
  const add = raw => {
    const text = label(String(raw ?? '')).trim()
    const key = normalizeCourseName(text)
    if (key && !seen.has(key)) seen.set(key, { value: key, label: text })
  }
  studentCourses.forEach(add)
  deadlines.forEach(d => add(d.course))
  return [...seen.values()]
}

/** Deadlines for one course, in their existing order. ALL_COURSES (or nothing) shows them all. */
export function filterDeadlines(deadlines, selected, label = n => n) {
  if (!selected || selected === ALL_COURSES) return deadlines
  return deadlines.filter(d => normalizeCourseName(label(String(d.course ?? ''))) === selected)
}
