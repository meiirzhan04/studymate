
import React, { useEffect, useId, useState } from 'react'
import './study.css'
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
  const [timer, setTimer] = useState(() => idleTimer())

  useEffect(() => {
    if (timer.status !== 'running') return

    const id = setInterval(() => {
      setTimer(t => tickTimer(t, Date.now()))
    }, 250)

    return () => clearInterval(id)
  }, [timer.status])

  const { status } = timer

  return (
    <article className="card card-fill study-card">
      <header className="card-head">
        <h2>Focus timer</h2>
        <span className="muted">
          25-minute session
        </span>
      </header>

      <div
        className={`timer-face timer-${status}`}
        role="timer"
        aria-label="Focus session time left"
      >
        {formatTimer(timer.remainingMs)}
      </div>

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
            onClick={() =>
              setTimer(t => startTimer(t, Date.now()))
            }
          >
            {status === 'paused' ? 'Resume' : 'Start'}
          </button>
        )}

        <button
          type="button"
          className="btn-ghost"
          onClick={() => setTimer(resetTimer())}
          disabled={status === 'idle'}
        >
          Reset
        </button>
      </div>

      <p
        className="timer-note muted"
        role="status"
      >
        {status === 'done'
          ? 'Session complete. Take a short break, then reset for another one.'
          : status === 'paused'
            ? 'Paused.'
            : status === 'running'
              ? 'Stay on one thing until it reaches 00:00.'
              : 'Start a session to focus on one thing.'}
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
        onChange={e =>
          onSelect(e.target.value)
        }
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

      <button
        type="button"
        className="btn-ghost btn-sm"
        disabled={nothing}
        aria-describedby={
          nothing ? emptyId : undefined
        }
        title={
          nothing
            ? 'There are no upcoming deadlines to download.'
            : 'Download all upcoming deadlines as a CSV file'
        }
        onClick={() =>
          downloadTextFile(
            'upcoming-deadlines.csv',
            deadlinesToCsv(
              upcoming,
              courseLabel
            )
          )
        }
      >
        Download CSV
      </button>
    </div>
  )
}
