
import React, { useEffect, useId, useState } from 'react'
import './study.css'
import { downloadDeadlinesExcel } from './deadlineExport.js'
import {
  ALL_COURSES, NOTE_LIMIT,
  addTask, editTask, deleteTask, deadlinesToCsv,
  formatTimer, idleTimer, loadNote, loadPins, loadTasks,
  pauseTimer, resetTimer, saveNote, savePins, saveTasks,
  startTimer, taskSummary, tickTimer, toggleTask, togglePin,
} from './study.js'

/* Personal study tools (US-27 ... US-32).
   Business logic is kept in study.js. */

const getStorage = () => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/* US-27: Personal study checklist */

export function StudyChecklistCard({ userId }) {
  const [tasks, setTasks] = useState(() =>
    loadTasks(getStorage(), userId)
  )
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')

  const [editingId, setEditingId] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editError, setEditError] = useState('')

  const inputId = useId()

  useEffect(() => {
    setTasks(loadTasks(getStorage(), userId))
    setEditingId(null)
    setEditTitle('')
    setEditError('')
    setError('')
  }, [userId])

  const update = next => {
    setTasks(next)
    saveTasks(getStorage(), userId, next)
  }

  const submit = e => {
    e.preventDefault()

    const result = addTask(tasks, title)

    if (result.error) {
      setError(result.error)
      return
    }

    update(result.tasks)
    setTitle('')
    setError('')
  }

  const startEditing = task => {
    setEditingId(task.id)
    setEditTitle(task.title)
    setEditError('')
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditTitle('')
    setEditError('')
  }

  const saveEditing = id => {
    const result = editTask(tasks, id, editTitle)

    if (result.error) {
      setEditError(result.error)
      return
    }

    update(result.tasks)
    cancelEditing()
  }

  const removeTask = id => {
    update(deleteTask(tasks, id))

    if (editingId === id) {
      cancelEditing()
    }
  }

  const { done, total } = taskSummary(tasks)

  return (
    <article className="card card-fill study-card">
      <header className="card-head">
        <h2>Study checklist</h2>

        {total > 0 && (
          <span
            className="count-pill"
            aria-label={`${done} of ${total} done`}
          >
            {done}/{total}
          </span>
        )}
      </header>

      <form
        className="study-add"
        onSubmit={submit}
        noValidate
      >
        <label
          className="sr-only"
          htmlFor={inputId}
        >
          New study task
        </label>

        <input
          id={inputId}
          className="input"
          type="text"
          value={title}
          placeholder="Add a study task"
          maxLength={120}
          autoComplete="off"
          aria-invalid={!!error}
          aria-describedby={
            error ? `${inputId}-error` : undefined
          }
          onChange={e => {
            setTitle(e.target.value)
            if (error) setError('')
          }}
        />

        <button
          type="submit"
          className="btn-primary btn-sm"
        >
          Add
        </button>
      </form>

      {error && (
        <p
          id={`${inputId}-error`}
          className="study-error"
          role="alert"
        >
          {error}
        </p>
      )}

      {tasks.length === 0 ? (
        <p className="muted study-empty">
          No tasks yet. Add what you still need to do.
        </p>
      ) : (
        <ul className="task-list study-tasks">
          {tasks.map(t => (
            <li key={t.id}>
              {editingId === t.id ? (
                <form
                  className="study-add"
                  onSubmit={e => {
                    e.preventDefault()
                    saveEditing(t.id)
                  }}
                  noValidate
                >
                  <input
                    className="input"
                    type="text"
                    value={editTitle}
                    maxLength={120}
                    autoFocus
                    aria-label="Edit task title"
                    aria-invalid={!!editError}
                    onChange={e => {
                      setEditTitle(e.target.value)
                      setEditError('')
                    }}
                  />

                  <button
                    type="submit"
                    className="btn-primary btn-sm"
                  >
                    Save
                  </button>

                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={cancelEditing}
                  >
                    Cancel
                  </button>

                  {editError && (
                    <p
                      className="study-error"
                      role="alert"
                    >
                      {editError}
                    </p>
                  )}
                </form>
              ) : (
                <div
                  className="study-task-row"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px'
                  }}
                >
                  <label
                    className={`task ${t.done ? 'done' : ''}`}
                    style={{
                      flex: 1,
                      minWidth: 0
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={t.done}
                      onChange={() =>
                        update(toggleTask(tasks, t.id))
                      }
                    />
                    <span>{t.title}</span>
                  </label>

                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => startEditing(t)}
                    aria-label={`Edit ${t.title}`}
                    title="Edit task"
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => removeTask(t.id)}
                    aria-label={`Delete ${t.title}`}
                    title="Delete task"
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

/* US-29: Study focus timer */


export function FocusTimerCard() {
  const [minutes, setMinutes] = useState(25)
  const [customMinutes, setCustomMinutes] = useState('30')
  const [mode, setMode] = useState('focus')
  const [sessions, setSessions] = useState(0)
  const [autoBreak, setAutoBreak] = useState(true)
  const [message, setMessage] = useState('')
  const [timer, setTimer] = useState(() => idleTimer())

  const { status } = timer

  const duration =
    mode === 'short' ? 5 :
    mode === 'long' ? 15 :
    minutes

  useEffect(() => {
    if (timer.status !== 'running') return

    const id = setInterval(() => {
      setTimer(t => tickTimer(t, Date.now()))
    }, 250)

    return () => clearInterval(id)
  }, [timer.status])

  useEffect(() => {
    if (status !== 'done') return

    if (mode === 'focus') {
      const completed = sessions + 1
      setSessions(completed)
      setMessage('Great job! Focus session completed.')

      if (autoBreak) {
        const nextMode =
          completed % 4 === 0 ? 'long' : 'short'

        const breakMinutes =
          nextMode === 'long' ? 15 : 5

        setMode(nextMode)
        setTimer(idleTimer(breakMinutes * 60 * 1000))
      }
    } else {
      setMessage('Break completed. Ready to focus again!')
      setMode('focus')
      setTimer(idleTimer(minutes * 60 * 1000))
    }
  }, [status])

  const changeMode = nextMode => {
    setMode(nextMode)
    setMessage('')

    const nextDuration =
      nextMode === 'short' ? 5 :
      nextMode === 'long' ? 15 :
      minutes

    setTimer(idleTimer(nextDuration * 60 * 1000))
  }

  const changeDuration = value => {
    setMinutes(value)
    setMode('focus')
    setMessage('')
    setTimer(idleTimer(value * 60 * 1000))
  }

  const applyCustomTime = () => {
    const value = Number(customMinutes)

    if (!Number.isInteger(value) || value < 1 || value > 180) {
      setMessage('Enter a duration from 1 to 180 minutes.')
      return
    }

    changeDuration(value)
  }

  const progress = Math.min(
    100,
    Math.max(
      0,
      (1 - timer.remainingMs / (duration * 60 * 1000)) * 100
    )
  )

  const locked = status === 'running' || status === 'paused'

  return (
    <article className="card card-fill study-card focus-timer-v2">
      <header className="card-head">
        <h2>Focus timer</h2>
        <span className="muted">
          {duration}-minute session
        </span>
      </header>

      <div className="focus-mode-selector">
        {[
          ['focus', 'Focus'],
          ['short', 'Short Break'],
          ['long', 'Long Break']
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={mode === value ? 'btn-primary' : 'btn-ghost'}
            onClick={() => changeMode(value)}
            disabled={locked}
          >
            {label}
          </button>
        ))}
      </div>

<div className="focus-circle-wrapper">
  <div
    className="focus-circle"
    role="timer"
    aria-label="Session time remaining"
  >
    <svg viewBox="0 0 240 240">
      <circle
        className="focus-circle-track"
        cx="120"
        cy="120"
        r="108"
      />

      <circle
        className="focus-circle-progress"
        cx="120"
        cy="120"
        r="108"
        pathLength="100"
        strokeDasharray="100"
        strokeDashoffset={progress}
        transform="rotate(-90 120 120)"
      />
    </svg>

    <div className="focus-circle-content">
      <span className="focus-time">
        {formatTimer(timer.remainingMs)}
      </span>

      <span className="focus-circle-label">
        {status === 'paused'
          ? 'Paused'
          : status === 'done'
            ? 'Completed'
            : mode !== 'focus'
              ? 'Time to relax'
              : status === 'running'
                ? 'Stay focused'
                : 'Ready to focus'}
      </span>
    </div>
  </div>
</div>


      {mode === 'focus' && (
        <>
          <div className="focus-presets">
            {[15, 25, 45, 60].map(value => (
              <button
                key={value}
                type="button"
                className={
                  minutes === value ? 'btn-primary' : 'btn-ghost'
                }
                onClick={() => changeDuration(value)}
                disabled={locked}
              >
                {value} min
              </button>
            ))}
          </div>

          <div className="focus-custom-time">
            <input
              className="input"
              type="number"
              min="1"
              max="180"
              step="1"
              value={customMinutes}
              onChange={e => setCustomMinutes(e.target.value)}
              placeholder="Minutes"
              aria-label="Custom focus duration"
              disabled={locked}
            />

            <button
              type="button"
              className="btn-ghost"
              onClick={applyCustomTime}
              disabled={locked}
            >
              Set time
            </button>
          </div>
        </>
      )}

      <div className="timer-controls">
        {status === 'running' ? (
          <button
            type="button"
            className="btn-ghost"
            onClick={() =>
              setTimer(t => pauseTimer(t, Date.now()))
            }
          >
            Pause
          </button>
        ) : status !== 'done' && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setMessage('')
              setTimer(t => startTimer(t, Date.now()))
            }}
          >
            {status === 'paused' ? 'Resume' : 'Start'}
          </button>
        )}

        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setTimer(resetTimer(duration * 60 * 1000))
            setMessage('')
          }}
          disabled={status === 'idle'}
        >
          Reset
        </button>
      </div>

      <label className="focus-auto-break">
        <input
          type="checkbox"
          checked={autoBreak}
          onChange={e => setAutoBreak(e.target.checked)}
        />
        Automatically switch to break
      </label>

      <div className="focus-session-stats">
        <span>Completed focus sessions</span>
        <strong>{sessions}</strong>
      </div>

      <p className="timer-note muted" role="status">
        {message ||
          (status === 'paused'
            ? 'Session paused.'
            : status === 'running'
              ? mode === 'focus'
                ? 'Stay focused. You can do it!'
                : 'Relax and recharge.'
              : status === 'done'
                ? 'Session completed!'
                : mode === 'focus'
                  ? 'Choose your duration and start focusing.'
                  : 'Take a well-deserved break.')}
      </p>
    </article>
  )
}


/* US-28: Personal course notes */

export function CourseNote({ userId, course }) {
  const [saved, setSaved] = useState(() =>
    loadNote(getStorage(), userId, course)
  )
  const [text, setText] = useState(saved)
  const [failed, setFailed] = useState(false)

  const fieldId = useId()
  const dirty = text !== saved

  const save = () => {
    const ok = saveNote(
      getStorage(),
      userId,
      course,
      text
    )

    setFailed(!ok)

    if (ok) {
      setSaved(text)
    }
  }

  return (
    <section className="course-note">
      <h3 className="section-title">
        My note
      </h3>

      <label
        className="sr-only"
        htmlFor={fieldId}
      >
        Personal note for {course.course_name}
      </label>

      <textarea
        id={fieldId}
        rows={4}
        value={text}
        maxLength={NOTE_LIMIT}
        placeholder="What do you need to review for this course?"
        onChange={e => {
          setText(e.target.value)
          setFailed(false)
        }}
      />

      <div className="note-foot">
        <span
          className={`note-count ${
            text.length >= NOTE_LIMIT ? 'at-limit' : ''
          }`}
        >
          {text.length}/{NOTE_LIMIT}
        </span>

        <span
          className="note-state muted"
          role="status"
        >
          {failed
            ? "Couldn't save in this browser."
            : dirty
              ? 'Unsaved changes'
              : saved
                ? 'Saved'
                : ''}
        </span>

        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={save}
          disabled={!dirty}
        >
          Save note
        </button>
      </div>
    </section>
  )
}

/* US-30: Pin priority courses */

export function usePins(userId) {
  const [pins, setPins] = useState(() =>
    loadPins(getStorage(), userId)
  )

  useEffect(() => {
    setPins(loadPins(getStorage(), userId))
  }, [userId])

  const toggle = key => {
    const next = togglePin(pins, key)

    setPins(next)

    savePins(
      getStorage(),
      userId,
      next
    )
  }

  return [pins, toggle]
}

export function PinToggle({
  pinned,
  onToggle,
  courseName
}) {
  const label = `${
    pinned ? 'Unpin' : 'Pin'
  } ${courseName}`

  return (
    <button
      type="button"
      className={`pin-btn ${
        pinned ? 'pinned' : ''
      }`}
      aria-pressed={pinned}
      aria-label={label}
      title={label}
      onClick={e => {
        e.stopPropagation()
        onToggle()
      }}
      onKeyDown={e => e.stopPropagation()}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill={pinned ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 17v5" />
        <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" />
      </svg>
    </button>
  )
}

/* US-31 / US-32: Deadline filter and CSV */

function downloadTextFile(filename, text) {
  const url = URL.createObjectURL(
    new Blob([text], {
      type: 'text/csv;charset=utf-8'
    })
  )

  const link = document.createElement('a')

  link.href = url
  link.download = filename

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 1000)
}


export function DeadlineTools({
  options,
  selected,
  onSelect,
  upcoming,
  courseLabel,
  emptyId
}) {
  const nothing = upcoming.length === 0
  const selectId = useId()

  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const exportExcel = async () => {
    setExportOpen(false)
    setExporting(true)
    setExportError('')

    try {
      await downloadDeadlinesExcel(upcoming, courseLabel)
    } catch (error) {
      console.error('Excel export failed:', error)
      setExportError('Could not export Excel. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  const exportCsv = () => {
    setExportOpen(false)
    setExportError('')

    downloadTextFile(
      'StudyMate-Upcoming-Deadlines.csv',
      deadlinesToCsv(upcoming, courseLabel)
    )
  }

  return (
    <div className="deadline-tools">
      <label
        className="sr-only"
        htmlFor={selectId}
      >
        Filter deadlines by course
      </label>

      <select
        id={selectId}
        className="select select-sm"
        value={selected}
        onChange={e => {
          onSelect(e.target.value)
          setExportOpen(false)
          setExportError('')
        }}
      >
        <option value={ALL_COURSES}>
          All courses
        </option>

        {options.map(o => (
          <option
            key={o.value}
            value={o.value}
          >
            {o.label}
          </option>
        ))}
      </select>

      <div
        className="deadline-export"
        onBlur={e => {
          if (!e.currentTarget.contains(e.relatedTarget)) {
            setExportOpen(false)
          }
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            setExportOpen(false)
            e.currentTarget.querySelector('button')?.focus()
          }
        }}
      >
        <button
          type="button"
          className="deadline-export-btn"
          disabled={nothing || exporting}
          aria-expanded={exportOpen}
          aria-describedby={nothing ? emptyId : undefined}
          onClick={() => setExportOpen(v => !v)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 16v4h14v-4" />
          </svg>

          {exporting ? 'Exporting...' : 'Export'}

          <span className="export-chevron">
            ⌄
          </span>
        </button>

        {exportOpen && (
          <div className="deadline-export-menu">
            <button
              type="button"
              className="deadline-export-option"
              onClick={exportExcel}
            >
              <span className="export-file-icon excel-icon">
                XLSX
              </span>

              <span className="export-option-text">
                <strong>Download Excel</strong>
                <small>Styled report (.xlsx)</small>
              </span>
            </button>

            <div className="export-divider" />

            <button
              type="button"
              className="deadline-export-option"
              onClick={exportCsv}
            >
              <span className="export-file-icon csv-icon">
                CSV
              </span>

              <span className="export-option-text">
                <strong>Download CSV</strong>
                <small>Raw data (.csv)</small>
              </span>
            </button>
          </div>
        )}
      </div>

      {exportError && (
        <p className="study-error" role="alert">
          {exportError}
        </p>
      )}
    </div>
  )
}

