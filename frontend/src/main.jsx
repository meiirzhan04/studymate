import React, { useEffect, useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Scatter, ScatterChart
} from 'recharts'
import './styles.css'

/* ─── API helper ──────────────────────────────────────────────────── */
const api = async (path, token, options = {}) => {
  const base = import.meta.env.VITE_API_URL ?? ''
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.detail || 'Request failed')
  return body
}

/* ─── Shared tiny components ─────────────────────────────────────── */
const Metric = ({ label, value, detail, tone = '' }) => (
  <article className={`metric ${tone}`}>
    <span>{label}</span>
    <strong>{value ?? 'Unavailable'}</strong>
    <small>{detail}</small>
  </article>
)

const StatusBadge = ({ status }) => {
  const map = {
    satisfactory: { label: 'Satisfactory', cls: 'badge-ok' },
    warning:      { label: 'Warning',       cls: 'badge-warn' },
    critical:     { label: 'Critical',      cls: 'badge-crit' },
  }
  const { label, cls } = map[status] ?? { label: status, cls: '' }
  return <span className={`status-badge ${cls}`}>{label}</span>
}

/* ─── SVG Progress Ring ──────────────────────────────────────────── */
const ProgressRing = ({ pct, size = 90, stroke = 8, color = '#6657e8' }) => {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (Math.min(Math.max(pct, 0), 100) / 100) * circ
  return (
    <svg className="progress-ring" width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="#e7e8ee" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset .5s ease' }} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: 15, fontWeight: 700, fontFamily: 'Manrope, sans-serif', fill: '#202136' }}>
        {pct}%
      </text>
    </svg>
  )
}

/* ─── LOGIN ──────────────────────────────────────────────────────── */
function Login({ onLogin }) {
  const [identifier, setIdentifier] = useState('student@univ.edu')
  const [password, setPassword]     = useState('student123')
  const [error, setError]           = useState('')
  const [busy, setBusy]             = useState(false)

  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('')
    try { onLogin(await api('/api/auth/login', null, { method: 'POST', body: JSON.stringify({ identifier, password }) })) }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  return (
    <main className="login-page">
      <section className="login-copy">
        <span className="eyebrow">STUDYMATE</span>
        <h1>See the signal.<br />Shape the outcome.</h1>
        <p>One clear view of grades, attendance, deadlines, and academic risk.</p>
        <div className="signal">
          <i /><span>Explainable insights</span>
          <i /><span>Private by design</span>
        </div>
      </section>
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark">S</div>
        <h2>Welcome back</h2>
        <p>Sign in with your university account.</p>
        <label>
          University email or Student ID
          <input value={identifier} onChange={e => setIdentifier(e.target.value)}
            placeholder="e.g. STU-001 or student@univ.edu" />
          <small style={{ color: '#9697a5', fontWeight: 400, marginTop: 2 }}>
            Demo Student ID: <b>STU-001</b> · password: <b>student123</b>
          </small>
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        {error && <div className="error">{error}</div>}
        <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="demo">
          <button type="button" onClick={() => { setIdentifier('student@univ.edu'); setPassword('student123') }}>Student demo</button>
          <button type="button" onClick={() => { setIdentifier('teacher@univ.edu'); setPassword('teacher123') }}>Teacher demo</button>
        </div>
      </form>
    </main>
  )
}

/* ─── WHAT-IF CALCULATOR MODAL ───────────────────────────────────── */
function WhatIfModal({ token, courses, onClose }) {
  const [courseCode, setCourseCode]     = useState(courses[0]?.code ?? '')
  const [component, setComponent]      = useState('')
  const [target, setTarget]            = useState(80)
  const [components, setComponents]    = useState([])
  const [result, setResult]            = useState(null)
  const [loading, setLoading]          = useState(false)
  const [loadingComp, setLoadingComp]  = useState(false)
  const [err, setErr]                  = useState('')

  // Load components when course changes
  useEffect(() => {
    if (!courseCode) return
    setLoadingComp(true); setComponents([]); setComponent(''); setResult(null)
    api(`/api/student/grades/breakdown?course_code=${courseCode}`, token)
      .then(d => { setComponents(d.components); setComponent(d.components[0]?.name ?? '') })
      .catch(e => setErr(e.message))
      .finally(() => setLoadingComp(false))
  }, [courseCode, token])

  const calculate = async () => {
    setLoading(true); setErr(''); setResult(null)
    try {
      const r = await api('/api/student/grades/whatif', token, {
        method: 'POST',
        body: JSON.stringify({ course_code: courseCode, target_score: Number(target), component_name: component })
      })
      setResult(r)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="whatif-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="whatif-modal">
        <div className="whatif-header">
          <div>
            <span className="eyebrow">GRADE PLANNER</span>
            <h2 style={{ margin: '4px 0 0', fontFamily: 'Manrope', fontSize: '1.3rem' }}>What-If Calculator</h2>
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="whatif-body">
          <label>
            Course
            <select value={courseCode} onChange={e => setCourseCode(e.target.value)}>
              {courses.filter(c => c.score !== null).map(c =>
                <option key={c.code} value={c.code}>{c.course} ({c.code})</option>
              )}
            </select>
          </label>

          <label>
            Component / Assessment
            {loadingComp
              ? <div className="loading-sm">Loading components…</div>
              : <select value={component} onChange={e => setComponent(e.target.value)} disabled={!components.length}>
                  {components.map(c => <option key={c.name} value={c.name}>{c.name} (weight: {Math.round(c.weight * 100)}%)</option>)}
                </select>
            }
          </label>

          <label>
            Target final score (0–100)
            <input type="number" min={0} max={100} value={target} onChange={e => setTarget(e.target.value)} />
          </label>

          {err && <div className="error">{err}</div>}

          {result && (
            <div className={`whatif-result ${result.feasible ? 'feasible' : 'infeasible'}`}>
              <span className="whatif-icon">{result.feasible ? '✅' : '⚠️'}</span>
              <div>
                <b>{result.message}</b>
                <p style={{ margin: '4px 0 0', fontSize: '.85rem' }}>
                  {result.feasible
                    ? `This is achievable (≤ 100%). Keep it up!`
                    : `This score exceeds 100% — the target may not be reachable.`}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="whatif-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={calculate} disabled={loading || !component}>
            {loading ? 'Calculating…' : 'Calculate'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── DASHBOARD TAB ──────────────────────────────────────────────── */
function DashboardTab({ token, user }) {
  const [data, setData]         = useState(null)
  const [semester, setSemester] = useState('spring-2026')
  const [error, setError]       = useState('')
  const [showWhatIf, setShowWhatIf] = useState(false)

  useEffect(() => {
    setData(null)
    api(`/api/student/dashboard?semester=${semester}`, token)
      .then(setData).catch(e => setError(e.message))
  }, [semester, token])

  if (error) return <div className="error">{error}</div>
  if (!data)  return <div className="loading">Loading your academic view…</div>

  const gpa = data.gpa.value
  const standingGood = gpa !== null && gpa >= 2.0

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">STUDENT OVERVIEW</span>
          <h1>Good {timeOfDay()}, {user.name.split(' ')[0]}.</h1>
          <p>Your current semester, distilled into what needs attention.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {gpa !== null && (
            <span className={`standing-badge ${standingGood ? 'standing-good' : 'standing-warn'}`}>
              {standingGood ? '✓ Good Standing' : '⚠ Academic Warning'}
            </span>
          )}
          <select value={semester} onChange={e => setSemester(e.target.value)}>
            <option value="spring-2026">Spring 2026</option>
            <option value="fall-2025">Fall 2025</option>
          </select>
        </div>
      </header>

      <section className="metrics">
        <Metric label="Current GPA"        value={gpa?.toFixed(2)}                    detail="Demo 4-point scale · policy pending" />
        <Metric label="Attendance"          value={`${data.attendance.value}%`}         detail="Across eligible sessions" />
        <Metric label="Completed credits"   value={data.credits}                        detail={`${data.courses.length} active courses`} />
        <Metric label="Active alerts"       value={data.alerts.length}                  detail={data.alerts.length ? 'Review recommended' : 'Nothing urgent'} tone={data.alerts.length ? 'warn' : ''} />
      </section>

      <section className="grid">
        <article className="panel wide">
          <div className="panel-title">
            <div>
              <span className="eyebrow">COURSE PERFORMANCE</span>
              <h2>Weighted grade overview</h2>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn-whatif" onClick={() => setShowWhatIf(true)}>⚗ What-If</button>
              <span className="muted">{semester.replace('-', ' ')}</span>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.courses}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="code" />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Bar dataKey="score" fill="#6657E8" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          {/* Course list with progress bars */}
          <div className="course-list">
            {data.courses.map(c => (
              <div key={c.code} className="course-row">
                <span>
                  <b>{c.course}</b>
                  <small>{c.code} · {c.credits} credits</small>
                </span>
                <div className="course-progress-wrap">
                  <div className="progress-bar-track">
                    <div className="progress-bar-fill" style={{ width: `${c.progress ?? 0}%` }} title={`Attendance: ${c.progress ?? 0}%`} />
                  </div>
                  <small className="progress-label">Att. {c.progress ?? 0}%</small>
                </div>
                <strong>{c.score == null ? 'Insufficient data' : `${c.score}%`}</strong>
              </div>
            ))}
          </div>
        </article>

        <aside>
          <article className="panel">
            <span className="eyebrow">ACTION CENTER</span>
            <h2>What to focus on</h2>
            {data.alerts.length
              ? data.alerts.map((a, i) => (
                  <div className="alert" key={i}>
                    <b>{a.type.replaceAll('_', ' ')}</b>
                    <span>{a.detail}</span>
                  </div>
                ))
              : <p className="empty">No active risk signals.</p>
            }
          </article>
          <article className="panel">
            <span className="eyebrow">STUDY PLAN</span>
            <h2>Recommendations</h2>
            {data.recommendations.length
              ? data.recommendations.map((r, i) => (
                  <div className="recommend" key={i}>
                    <b>{r.course}</b>
                    <p>{r.action}</p>
                    <small>{r.reason}</small>
                  </div>
                ))
              : <p className="empty">No targeted recommendations for this period.</p>
            }
          </article>
        </aside>
      </section>

      {showWhatIf && (
        <WhatIfModal
          token={token}
          courses={data.courses}
          onClose={() => setShowWhatIf(false)}
        />
      )}
    </>
  )
}

/* ─── GRADES TAB ─────────────────────────────────────────────────── */
function GradesTab({ token }) {
  const [courses, setCourses]         = useState(null)
  const [expanded, setExpanded]       = useState(null)
  const [breakdown, setBreakdown]     = useState({})
  const [loadingBD, setLoadingBD]     = useState(null)
  const [error, setError]             = useState('')
  const [showWhatIf, setShowWhatIf]   = useState(false)

  useEffect(() => {
    api('/api/student/grades?semester=spring-2026', token)
      .then(d => setCourses(d.items))
      .catch(e => setError(e.message))
  }, [token])

  const toggleRow = async code => {
    if (expanded === code) { setExpanded(null); return }
    setExpanded(code)
    if (breakdown[code]) return
    setLoadingBD(code)
    try {
      const d = await api(`/api/student/grades/breakdown?course_code=${code}`, token)
      setBreakdown(prev => ({ ...prev, [code]: d }))
    } catch (e) { setError(e.message) }
    finally { setLoadingBD(null) }
  }

  if (error)   return <div className="error">{error}</div>
  if (!courses) return <div className="loading">Loading grades…</div>

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">ACADEMIC RECORD</span>
          <h1>Grades breakdown</h1>
          <p>Click a course row to expand assessment components.</p>
        </div>
        <button className="btn-whatif" onClick={() => setShowWhatIf(true)}>⚗ What-If Calculator</button>
      </header>

      <article className="panel" style={{ marginTop: 0 }}>
        <table className="grades-table">
          <thead>
            <tr>
              <th>Course</th>
              <th>Code</th>
              <th>Credits</th>
              <th>Score</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {courses.map(c => (
              <React.Fragment key={c.code}>
                <tr className={`breakdown-row ${expanded === c.code ? 'expanded' : ''}`}
                    onClick={() => toggleRow(c.code)}>
                  <td><b>{c.course}</b></td>
                  <td><code>{c.code}</code></td>
                  <td>{c.credits}</td>
                  <td>
                    <span className={`score-chip ${c.score == null ? '' : c.score >= 75 ? 'chip-good' : 'chip-warn'}`}>
                      {c.score == null ? '—' : `${c.score}%`}
                    </span>
                  </td>
                  <td className="expand-chevron">{expanded === c.code ? '▲' : '▼'}</td>
                </tr>

                {expanded === c.code && (
                  <tr className="breakdown-detail-row">
                    <td colSpan={5}>
                      {loadingBD === c.code
                        ? <div className="loading-sm">Loading breakdown…</div>
                        : breakdown[c.code]
                          ? <BreakdownPanel data={breakdown[c.code]} />
                          : null
                      }
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </article>

      {showWhatIf && (
        <WhatIfModal token={token} courses={courses} onClose={() => setShowWhatIf(false)} />
      )}
    </>
  )
}

function BreakdownPanel({ data }) {
  return (
    <div className="breakdown-panel">
      <div className="breakdown-summary">
        <span className="eyebrow">WEIGHTED TOTAL</span>
        <strong className="bd-score">{data.weighted_score != null ? `${data.weighted_score}%` : '—'}</strong>
      </div>
      <div className="bd-components">
        {data.components.map((comp, i) => (
          <div className="bd-comp-row" key={i}>
            <div className="bd-comp-info">
              <b>{comp.name}</b>
              <span className="bd-weight">Weight: {Math.round(comp.weight * 100)}%</span>
            </div>
            <div className="bd-comp-bar-wrap">
              <div className="progress-bar-track">
                <div className="progress-bar-fill bd-fill"
                  style={{ width: `${comp.percentage ?? 0}%`, background: '#6657e8' }} />
              </div>
              <span className="bd-pct">{comp.percentage != null ? `${comp.percentage}%` : '—'}</span>
            </div>
            <div className="bd-comp-score">
              {comp.score != null ? `${comp.score} / ${comp.max_score}` : '—'}
            </div>
            {comp.feedback && <em className="bd-feedback">"{comp.feedback}"</em>}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── ATTENDANCE TAB ─────────────────────────────────────────────── */
function AttendanceTab({ token }) {
  const [data, setData]       = useState(null)
  const [error, setError]     = useState('')
  const [openSessions, setOpenSessions] = useState({})

  useEffect(() => {
    api('/api/student/attendance', token)
      .then(d => setData(d.items))
      .catch(e => setError(e.message))
  }, [token])

  const toggleSessions = code =>
    setOpenSessions(prev => ({ ...prev, [code]: !prev[code] }))

  if (error) return <div className="error">{error}</div>
  if (!data)  return <div className="loading">Loading attendance…</div>

  const ringColor = status =>
    status === 'critical' ? '#e74c3c' : status === 'warning' ? '#f07b52' : '#22c55e'

  const sessionIcon = s =>
    s === 'present' ? '✅' : s === 'excused' ? '🔵' : '❌'

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">ATTENDANCE RECORD</span>
          <h1>Course attendance</h1>
          <p>Per-course breakdown with session history. You have 4 unexcused absences allowed.</p>
        </div>
      </header>

      <div className="att-grid">
        {data.map(item => (
          <article key={item.code} className={`course-card att-card-${item.status}`}>
            <div className="card-top">
              <div>
                <b className="card-course-name">{item.course}</b>
                <code className="card-code">{item.code}</code>
              </div>
              <StatusBadge status={item.status} />
            </div>

            <div className="card-ring-row">
              <ProgressRing
                pct={item.attendance_pct}
                color={ringColor(item.status)}
                size={100}
                stroke={9}
              />
              <div className="card-counts">
                <div className="count-row"><span className="dot dot-present" />Present <b>{item.present}</b></div>
                <div className="count-row"><span className="dot dot-excused" />Excused <b>{item.excused}</b></div>
                <div className="count-row"><span className="dot dot-absent"  />Absent  <b>{item.absent}</b></div>
                <div className="count-row unexcused-row">
                  Remaining unexcused: <b className={item.remaining_unexcused <= 1 ? 'text-danger' : ''}>{item.remaining_unexcused}</b>
                  <small> / {item.unexcused_limit}</small>
                </div>
              </div>
            </div>

            <button className="session-toggle" onClick={() => toggleSessions(item.code)}>
              {openSessions[item.code] ? '▲ Hide sessions' : `▼ Show ${item.sessions.length} sessions`}
            </button>

            {openSessions[item.code] && (
              <ul className="session-history">
                {item.sessions.map((s, i) => (
                  <li key={i} className={`session-item session-${s.status}`}>
                    <span>{sessionIcon(s.status)}</span>
                    <span>{s.date}</span>
                    <span className="session-label">{s.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </>
  )
}

/* ─── NOTIFICATIONS / ALERTS TAB ─────────────────────────────────── */
function AlertsTab({ token, onUnreadChange }) {
  const [notifs, setNotifs]   = useState(null)
  const [error, setError]     = useState('')
  const [marking, setMarking] = useState(false)

  const load = useCallback(() => {
    api('/api/student/notifications', token)
      .then(d => { setNotifs(d.items); onUnreadChange(d.unread_count) })
      .catch(e => setError(e.message))
  }, [token, onUnreadChange])

  useEffect(() => { load() }, [load])

  const markRead = async id => {
    try {
      await api(`/api/student/notifications/${id}/read`, token, { method: 'POST' })
      setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
      onUnreadChange(prev => Math.max(0, prev - 1))
    } catch (e) { setError(e.message) }
  }

  const markAll = async () => {
    setMarking(true)
    const unread = notifs.filter(n => !n.read)
    try {
      await Promise.all(unread.map(n => api(`/api/student/notifications/${n.id}/read`, token, { method: 'POST' })))
      setNotifs(prev => prev.map(n => ({ ...n, read: true })))
      onUnreadChange(0)
    } catch (e) { setError(e.message) }
    finally { setMarking(false) }
  }

  if (error)   return <div className="error">{error}</div>
  if (!notifs)  return <div className="loading">Loading notifications…</div>

  const unreadCount = notifs.filter(n => !n.read).length
  const typeIcon = t => t === 'low_grade' ? '⚠️' : t === 'low_attendance' ? '📅' : '🔔'

  const fmt = iso => {
    try { return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) }
    catch { return iso }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">ALERTS & NOTIFICATIONS</span>
          <h1>Notifications</h1>
          <p>{unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : 'All caught up!'}</p>
        </div>
        {unreadCount > 0 && (
          <button className="btn-markall" onClick={markAll} disabled={marking}>
            {marking ? 'Marking…' : '✓ Mark all read'}
          </button>
        )}
      </header>

      <article className="panel">
        {notifs.length === 0
          ? <p className="empty">No notifications yet.</p>
          : notifs.map(n => (
              <div key={n.id}
                className={`notif-item ${n.read ? 'notif-read' : 'notif-unread'}`}
                onClick={() => !n.read && markRead(n.id)}
                title={n.read ? '' : 'Click to mark as read'}
              >
                <span className="notif-icon">{typeIcon(n.type)}</span>
                <div className="notif-body">
                  <div className="notif-title">{n.title}</div>
                  <div className="notif-detail">{n.detail}</div>
                  <div className="notif-meta">
                    {n.course && <span className="notif-course">{n.course}</span>}
                    <span className="notif-time">{fmt(n.created_at)}</span>
                  </div>
                </div>
                {!n.read && <span className="unread-dot" />}
              </div>
            ))
        }
      </article>
    </>
  )
}

/* ─── STUDENT SHELL (tabs + nav) ─────────────────────────────────── */
function Student({ token, user, logout }) {
  const [tab, setTab]           = useState('dashboard')
  const [unread, setUnread]     = useState(0)

  // Eagerly fetch unread count for bell badge
  useEffect(() => {
    api('/api/student/notifications', token)
      .then(d => setUnread(d.unread_count))
      .catch(() => {})
  }, [token])

  const tabs = [
    { id: 'dashboard',  label: 'Dashboard'  },
    { id: 'grades',     label: 'Grades'     },
    { id: 'attendance', label: 'Attendance' },
    { id: 'alerts',     label: 'Alerts'     },
  ]

  return (
    <div className="app">
      <nav className="topnav">
        <div className="logo">S</div>
        <div className="brand-text"><b>StudyMate</b><span>Performance monitor</span></div>

        <div className="tabs-nav">
          {tabs.map(t => (
            <button key={t.id}
              className={`tab-btn ${tab === t.id ? 'tab-active' : ''}`}
              onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'alerts' && unread > 0 && (
                <span className="tab-badge">{unread}</span>
              )}
            </button>
          ))}
        </div>

        <button className="notification-bell" onClick={() => setTab('alerts')} title="Notifications">
          🔔
          {unread > 0 && <span className="bell-badge">{unread}</span>}
        </button>

        <button className="signout-btn" onClick={logout}>Sign out</button>
      </nav>

      <main className="content">
        {tab === 'dashboard'  && <DashboardTab  token={token} user={user} />}
        {tab === 'grades'     && <GradesTab     token={token} />}
        {tab === 'attendance' && <AttendanceTab token={token} />}
        {tab === 'alerts'     && <AlertsTab     token={token} onUnreadChange={setUnread} />}
      </main>
    </div>
  )
}

/* ─── TEACHER VIEW (unchanged) ───────────────────────────────────── */
function Teacher({ token, user }) {
  const [students, setStudents]   = useState()
  const [analytics, setAnalytics] = useState()
  useEffect(() => {
    Promise.all([
      api('/api/teacher/students', token),
      api('/api/teacher/analytics/attendance-performance', token)
    ]).then(([s, a]) => { setStudents(s.items); setAnalytics(a) })
  }, [token])

  if (!students || !analytics) return <div className="loading">Loading authorized class data…</div>
  const atRisk = students.filter(s => s.risk_factors.length)

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">TEACHER OVERVIEW</span>
          <h1>Your class signals.</h1>
          <p>Authorized CS-2026 student performance and explainable risk factors.</p>
        </div>
      </header>
      <section className="metrics">
        <Metric label="Students in scope"   value={students.length} detail="Current authorized cohort" />
        <Metric label="At-risk students"    value={atRisk.length}   detail="Based on configured demo rules" tone={atRisk.length ? 'warn' : ''} />
        <Metric label="Average attendance"  value={`${(students.reduce((a, s) => a + s.attendance, 0) / students.length).toFixed(1)}%`} detail="Across students in scope" />
        <Metric label="Correlation"         value={analytics.correlation} detail="Association, not causation" />
      </section>
      <section className="grid">
        <article className="panel wide">
          <div className="panel-title">
            <div><span className="eyebrow">AUTHORIZED STUDENTS</span><h2>Risk watchlist</h2></div>
          </div>
          <div className="student-table">
            <div className="thead"><span>Student</span><span>Attendance</span><span>Risk status</span></div>
            {students.map(s => (
              <div className="trow" key={s.id}>
                <span><b>{s.name}</b><small>{s.cohort}</small></span>
                <strong>{s.attendance}%</strong>
                <span>
                  {s.risk_factors.length
                    ? s.risk_factors.map((r, i) => <em key={i}>{r.detail}</em>)
                    : <em className="good">No active signals</em>
                  }
                </span>
              </div>
            ))}
          </div>
        </article>
        <aside>
          <article className="panel">
            <span className="eyebrow">ATTENDANCE × GRADE</span>
            <h2>Class relationship</h2>
            <ResponsiveContainer width="100%" height={220}>
              <ScatterChart>
                <CartesianGrid />
                <XAxis dataKey="attendance"    name="Attendance" unit="%" domain={[50, 100]} />
                <YAxis dataKey="average_grade" name="Grade"      unit="%" domain={[40, 100]} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Scatter data={analytics.points} fill="#F07B52" />
              </ScatterChart>
            </ResponsiveContainer>
            <p className="footnote">r = {analytics.correlation}. {analytics.note}</p>
          </article>
        </aside>
      </section>
    </>
  )
}

/* ─── APP ROOT ───────────────────────────────────────────────────── */
function App() {
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem('session')) } catch { return null }
  })
  const login  = s => { localStorage.setItem('session', JSON.stringify(s)); setSession(s) }
  const logout = ()  => { localStorage.removeItem('session'); setSession(null) }

  if (!session) return <Login onLogin={login} />

  if (session.user.role === 'teacher') {
    return (
      <div className="app">
        <nav className="topnav">
          <div className="logo">S</div>
          <div className="brand-text"><b>StudyMate</b><span>Performance monitor</span></div>
          <button className="signout-btn" onClick={logout}>Sign out</button>
        </nav>
        <main className="content">
          <Teacher token={session.access_token} user={session.user} />
        </main>
      </div>
    )
  }

  return <Student token={session.access_token} user={session.user} logout={logout} />
}

/* ─── Utility ────────────────────────────────────────────────────── */
function timeOfDay() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 18) return 'afternoon'
  return 'evening'
}

createRoot(document.getElementById('root')).render(<App />)
