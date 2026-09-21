import React, { useEffect, useState, useCallback, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Scatter, ScatterChart
} from 'recharts'
import './styles.css'

/* ─── API helper ──────────────────────────────────────────────────── */
const RENDER_BACKEND_URL = 'https://studymate-res1.onrender.com'

const getApiBase = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host !== 'localhost' && host !== '127.0.0.1') {
      return RENDER_BACKEND_URL
    }
  }
  return ''
}

const api = async (path, token, options = {}) => {
  const base = getApiBase()
  let res
  try {
    res = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    })
  } catch (err) {
    throw new Error('Unable to connect to server. Please wait a few seconds while backend wakes up.')
  }

  if (res.status === 401 && token) {
    try { localStorage.removeItem('session') } catch {}
    window.dispatchEvent(new CustomEvent('auth:expired'))
    throw new Error('Session expired. Please sign in again.')
  }

  const rawText = await res.text()
  let body = {}
  if (rawText) {
    try {
      body = JSON.parse(rawText)
    } catch {
      body = { detail: rawText.slice(0, 120) }
    }
  }

  if (!res.ok) throw new Error(body.detail || `Request failed (${res.status})`)
  return body
}

/* ─── Utility ─────────────────────────────────────────────────────── */
function timeOfDay() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 18) return 'afternoon'
  return 'evening'
}

function fmtDate() {
  return new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date())
}

function initials(name = '') {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'U'
}

/* ─── Loading Skeleton ───────────────────────────────────────────── */
function SkeletonDashboard() {
  return (
    <div className="page-fade">
      <div style={{ marginBottom: 28 }}>
        <div className="skeleton skeleton-text" style={{ width: 120, marginBottom: 14 }} />
        <div className="skeleton skeleton-title" style={{ width: '40%' }} />
        <div className="skeleton skeleton-text" style={{ width: '25%' }} />
      </div>
      <div className="skeleton-metrics">
        {[0,1,2,3].map(i => (
          <div key={i} className="skeleton-metric">
            <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 10 }} />
            <div className="skeleton skeleton-title" style={{ width: '70%' }} />
            <div className="skeleton skeleton-text" style={{ width: '55%' }} />
          </div>
        ))}
      </div>
      <div className="skeleton skeleton-chart" style={{ marginTop: 4 }} />
    </div>
  )
}

/* ─── StatusBadge ────────────────────────────────────────────────── */
const StatusBadge = ({ status }) => {
  const map = {
    satisfactory: { label: 'Satisfactory', cls: 'badge-ok'   },
    warning:      { label: 'Warning',       cls: 'badge-warn' },
    critical:     { label: 'Critical',      cls: 'badge-crit' },
  }
  const { label, cls } = map[status] ?? { label: status, cls: '' }
  return <span className={`status-badge ${cls}`}>{label}</span>
}

/* ─── SVG Progress Ring ──────────────────────────────────────────── */
const ProgressRing = ({ pct, size = 90, stroke = 8, color = '#5B4FCF' }) => {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (Math.min(Math.max(pct, 0), 100) / 100) * circ
  return (
    <svg className="progress-ring" width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="#F3F4F6" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset .6s cubic-bezier(.4,0,.2,1)' }} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: size * .17, fontWeight: 800, fontFamily: 'Manrope, sans-serif', fill: '#111827' }}>
        {pct}%
      </text>
    </svg>
  )
}

/* ─── Stat Metric Card ───────────────────────────────────────────── */
const Metric = ({ label, value, detail, icon, tone = '', colorClass = 'metric-purple' }) => (
  <article className={`metric ${colorClass} ${tone}`}>
    <div className={`metric-icon metric-icon-${colorClass.replace('metric-', '')}`}>{icon}</div>
    <span>{label}</span>
    <strong>{value ?? '—'}</strong>
    <small>{detail}</small>
  </article>
)

/* ─── Custom Recharts Tooltip ────────────────────────────────────── */
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#fff', border: '1px solid #E5E7EB',
      borderRadius: 10, padding: '10px 14px',
      boxShadow: '0 8px 24px rgba(0,0,0,.1)',
      fontSize: '.85rem'
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: '#111827' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: '#6B7280' }}>
          Score: <b style={{ color: '#5B4FCF' }}>{p.value}%</b>
        </div>
      ))}
    </div>
  )
}

/* ─── LOGIN ──────────────────────────────────────────────────────── */
function Login({ onLogin }) {
  const [identifier, setIdentifier] = useState('student@univ.edu')
  const [password, setPassword]     = useState('student123')
  const [showPw, setShowPw]         = useState(false)
  const [error, setError]           = useState('')
  const [busy, setBusy]             = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotMsg, setForgotMsg]   = useState('')

  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('')
    try { onLogin(await api('/api/auth/login', null, { method: 'POST', body: JSON.stringify({ identifier, password }) })) }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  return (
    <main className="login-page">
      {/* Left brand panel */}
      <section className="login-copy">
        <div className="login-eyebrow">
          <span className="login-eyebrow-dot" />
          StudyMate · Academic Intelligence
        </div>
        <h1>See the signal.<br /><span>Shape the outcome.</span></h1>
        <p>One clear view of grades, attendance, deadlines, and academic risk — built for students who care about their future.</p>
        <div className="login-features">
          <div className="login-feature">
            <div className="login-feature-icon">📊</div>
            <span>Live grade breakdown with weighted components</span>
          </div>
          <div className="login-feature">
            <div className="login-feature-icon">📅</div>
            <span>Per-course attendance tracking with history</span>
          </div>
          <div className="login-feature">
            <div className="login-feature-icon">⚗️</div>
            <span>What-If calculator to plan your target scores</span>
          </div>
          <div className="login-feature">
            <div className="login-feature-icon">🔔</div>
            <span>Smart alerts for risk factors before it's too late</span>
          </div>
        </div>
      </section>

      {/* Right form panel */}
      <div className="login-right">
        <form className="login-card" onSubmit={submit}>
          <div className="login-logo">S</div>
          <h2>Welcome back</h2>
          <p>Sign in with your university account.</p>

          <div className="login-field">
            <label htmlFor="identifier">University email or Student ID</label>
            <div className="login-input-wrap">
              <input
                id="identifier"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                placeholder="e.g. STU-001 or student@univ.edu"
                autoComplete="username"
              />
            </div>
            <span className="login-hint">
              Demo Student ID: <b>STU-001</b> · password: <b>student123</b>
            </span>
          </div>

          <div className="login-field">
            <label htmlFor="password">Password</label>
            <div className="login-input-wrap">
              <input
                id="password"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                style={{ paddingRight: 44 }}
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowPw(v => !v)}
                tabIndex={-1}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? '🙈' : '👁️'}
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button
                type="button"
                onClick={() => { setShowForgot(true); setForgotEmail(identifier.includes('@') ? identifier : ''); setForgotMsg('') }}
                style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: '.8rem', cursor: 'pointer', fontWeight: 600 }}
              >
                Forgot password?
              </button>
            </div>
          </div>

          {error && <div className="error">{error}</div>}

          <button className="login-submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in →'}
          </button>

          {showForgot && (
            <div className="whatif-overlay" onClick={e => e.target === e.currentTarget && setShowForgot(false)}>
              <div className="whatif-modal">
                <div className="whatif-header">
                  <div>
                    <span className="eyebrow">Account Recovery</span>
                    <h2>Password Reset</h2>
                  </div>
                  <button className="close-btn" onClick={() => setShowForgot(false)}>✕</button>
                </div>
                <div className="whatif-body">
                  <p style={{ color: 'var(--text-secondary)', fontSize: '.88rem', margin: 0 }}>
                    Enter your registered university email. We will send a time-limited (15-minute) secure password reset link.
                  </p>
                  <label>
                    University Email
                    <input
                      type="email"
                      value={forgotEmail}
                      onChange={e => setForgotEmail(e.target.value)}
                      placeholder="e.g. student@univ.edu"
                    />
                  </label>
                  {forgotMsg && (
                    <div style={{ background: 'var(--success-dim)', color: '#15803D', padding: '12px 14px', borderRadius: 10, fontSize: '.85rem', fontWeight: 600 }}>
                      ✓ {forgotMsg}
                    </div>
                  )}
                </div>
                <div className="whatif-footer">
                  <button className="btn-ghost" onClick={() => setShowForgot(false)}>Close</button>
                  <button
                    className="btn-primary"
                    disabled={!forgotEmail.includes('@')}
                    onClick={() => setForgotMsg(`A 15-minute secure reset link has been dispatched to ${forgotEmail}. Please check your inbox.`)}
                  >
                    Send Reset Link
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="demo-row">
            <button
              type="button"
              className="demo-btn"
              onClick={() => { setIdentifier('student@univ.edu'); setPassword('student123') }}
            >
              👤 Student demo
            </button>
            <button
              type="button"
              className="demo-btn"
              onClick={() => { setIdentifier('teacher@univ.edu'); setPassword('teacher123') }}
            >
              🎓 Teacher demo
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}

/* ─── WHAT-IF CALCULATOR MODAL ───────────────────────────────────── */
function WhatIfModal({ token, courses, onClose }) {
  const [courseCode, setCourseCode]    = useState(courses[0]?.code ?? '')
  const [component, setComponent]     = useState('')
  const [target, setTarget]           = useState(80)
  const [components, setComponents]   = useState([])
  const [result, setResult]           = useState(null)
  const [loading, setLoading]         = useState(false)
  const [loadingComp, setLoadingComp] = useState(false)
  const [err, setErr]                 = useState('')

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
            <span className="eyebrow">Grade Planner</span>
            <h2>What-If Calculator</h2>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
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
                <p>
                  {result.feasible
                    ? 'This is achievable (≤ 100%). Keep it up!'
                    : 'This score exceeds 100% — the target may not be reachable.'}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="whatif-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={calculate} disabled={loading || !component}>
            {loading ? 'Calculating…' : '⚗️ Calculate'}
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

  if (error) return <div className="error" style={{ margin: '40px 0' }}>{error}</div>
  if (!data) return <SkeletonDashboard />

  const gpa = data.gpa.value
  let standingLabel = '✓ Good Standing'
  let standingClass = 'standing-good'
  if (gpa !== null) {
    if (gpa >= 3.5) {
      standingLabel = "🏆 Dean's List / Honors Standing"
      standingClass = 'standing-honors'
    } else if (gpa >= 2.0) {
      standingLabel = '✓ Good Standing'
      standingClass = 'standing-good'
    } else {
      standingLabel = '⚠ Academic Warning'
      standingClass = 'standing-warn'
    }
  }

  return (
    <>
      {/* Hero greeting */}
      <header className="page-head page-fade">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            {gpa !== null && (
              <span className={`standing-badge ${standingClass}`}>
                {standingLabel}
              </span>
            )}
          </div>
          <h1>Good {timeOfDay()}, {user.name.split(' ')[0]} 👋</h1>
          <p>{fmtDate()} · Your current semester, distilled into what needs attention.</p>
        </div>
        <select value={semester} onChange={e => setSemester(e.target.value)}>
          <option value="spring-2026">Spring 2026</option>
          <option value="fall-2025">Fall 2025</option>
        </select>
      </header>

      {/* Stat cards */}
      <section className="metrics page-fade">
        <Metric
          label="Current GPA"
          value={gpa?.toFixed(2)}
          detail="Demo 4-point scale · policy pending"
          icon="🎯"
          colorClass="metric-purple"
        />
        <Metric
          label="Attendance"
          value={`${data.attendance.value}%`}
          detail="Across eligible sessions"
          icon="📅"
          colorClass="metric-blue"
        />
        <Metric
          label="Completed Credits"
          value={data.credits}
          detail={`${data.courses.length} active courses`}
          icon="📚"
          colorClass="metric-green"
        />
        <Metric
          label="Active Alerts"
          value={data.alerts.length}
          detail={data.alerts.length ? 'Review recommended' : 'Nothing urgent'}
          icon={data.alerts.length ? '⚠️' : '✅'}
          tone={data.alerts.length ? 'warn' : ''}
          colorClass={data.alerts.length ? 'metric-warn' : 'metric-green'}
        />
      </section>

      {/* Main grid */}
      <section className="grid page-fade">
        {/* Course performance panel */}
        <article className="panel wide">
          <div className="panel-title">
            <div>
              <span className="eyebrow">Course Performance</span>
              <h2>Weighted grade overview</h2>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn-whatif" onClick={() => setShowWhatIf(true)}>⚗️ What-If</button>
              <span className="muted">{semester.replace('-', ' ')}</span>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.courses} barCategoryGap="32%">
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
              <XAxis dataKey="code" tick={{ fontSize: 12, fill: '#9CA3AF', fontWeight: 600 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(91,79,207,.06)' }} />
              <Bar dataKey="score" fill="#5B4FCF" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          {/* Course rows */}
          <div className="course-list">
            {data.courses.map(c => (
              <div key={c.code} className="course-row">
                <span>
                  <b>{c.course}</b>
                  <small>{c.code} · {c.credits} cr</small>
                </span>
                <div className="course-progress-wrap">
                  <div className="progress-bar-track">
                    <div className="progress-bar-fill" style={{ width: `${c.progress ?? 0}%` }} title={`Attendance: ${c.progress ?? 0}%`} />
                  </div>
                  <span className="progress-label">Att. {c.progress ?? 0}%</span>
                </div>
                <span className={`score-chip-inline ${c.score == null ? 'chip-none' : c.score >= 75 ? 'chip-good' : 'chip-warn'}`}>
                  {c.score == null ? 'N/A' : `${c.score}%`}
                </span>
              </div>
            ))}
          </div>
        </article>

        {/* Right column */}
        <aside>
          <article className="panel">
            <span className="eyebrow">Action Center</span>
            <h2>What to focus on</h2>
            {data.alerts.length
              ? data.alerts.map((a, i) => (
                  <div className="alert" key={i}>
                    <b>{a.type.replaceAll('_', ' ')}</b>
                    <span>{a.detail}</span>
                  </div>
                ))
              : <p className="empty">🎉 No active risk signals.</p>
            }
          </article>

          <article className="panel">
            <span className="eyebrow">Study Plan</span>
            <h2>Recommendations</h2>
            {data.recommendations.length
              ? data.recommendations.map((r, i) => (
                  <div className="recommend" key={i}>
                    <b>{r.course}</b>
                    <p>{r.action}</p>
                    <small>{r.reason}</small>
                  </div>
                ))
              : <p className="empty">✨ No targeted recommendations for this period.</p>
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
  const [courses, setCourses]       = useState(null)
  const [expanded, setExpanded]     = useState(null)
  const [breakdown, setBreakdown]   = useState({})
  const [loadingBD, setLoadingBD]   = useState(null)
  const [error, setError]           = useState('')
  const [showWhatIf, setShowWhatIf] = useState(false)

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

  if (error)   return <div className="error" style={{ margin: '40px 0' }}>{error}</div>
  if (!courses) return (
    <div className="loading">
      <div className="loading-spinner" />
      Loading grades…
    </div>
  )

  return (
    <>
      <header className="page-head page-fade">
        <div>
          <span className="eyebrow">Academic Record</span>
          <h1>Grades breakdown</h1>
          <p>Click a course row to expand assessment components.</p>
        </div>
        <button className="btn-whatif" onClick={() => setShowWhatIf(true)}>⚗️ What-If Calculator</button>
      </header>

      <article className="panel page-fade" style={{ marginTop: 0 }}>
        <table className="grades-table">
          <thead>
            <tr>
              <th>Course</th>
              <th>Code</th>
              <th>Credits</th>
              <th>Score</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {courses.map(c => (
              <React.Fragment key={c.code}>
                <tr
                  className={`breakdown-row ${expanded === c.code ? 'expanded' : ''}`}
                  onClick={() => toggleRow(c.code)}
                >
                  <td><b>{c.course}</b></td>
                  <td><code>{c.code}</code></td>
                  <td style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{c.credits}</td>
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
        <div>
          <span className="eyebrow">Weighted Total</span>
          <div className="bd-score">{data.weighted_score != null ? `${data.weighted_score}%` : '—'}</div>
        </div>
        {data.weighted_score != null && (
          <span className={`score-chip ${data.weighted_score >= 75 ? 'chip-good' : 'chip-warn'}`} style={{ alignSelf: 'flex-end' }}>
            {data.weighted_score >= 75 ? '✓ Passing' : '⚠ Below threshold'}
          </span>
        )}
      </div>

      <div className="bd-components">
        {data.components.map((comp, i) => (
          <div className="bd-comp-row" key={i}>
            <div className="bd-comp-info">
              <b>{comp.name}</b>
              <span className="bd-weight">Weight: {Math.round(comp.weight * 100)}%</span>
            </div>
            <div className="bd-comp-bar-wrap">
              <div className="progress-bar-track" style={{ flex: 1 }}>
                <div className="progress-bar-fill"
                  style={{ width: `${comp.percentage ?? 0}%` }} />
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
  const [data, setData]           = useState(null)
  const [error, setError]         = useState('')
  const [openSessions, setOpenSessions] = useState({})

  useEffect(() => {
    api('/api/student/attendance', token)
      .then(d => setData(d.items))
      .catch(e => setError(e.message))
  }, [token])

  const toggleSessions = code =>
    setOpenSessions(prev => ({ ...prev, [code]: !prev[code] }))

  if (error) return <div className="error" style={{ margin: '40px 0' }}>{error}</div>
  if (!data) return (
    <div className="loading">
      <div className="loading-spinner" />
      Loading attendance…
    </div>
  )

  const ringColor = status =>
    status === 'critical' ? '#EF4444' : status === 'warning' ? '#F97316' : '#22C55E'

  const sessionIcon = s =>
    s === 'present' ? '✅' : s === 'excused' ? '🔵' : '❌'

  return (
    <>
      <header className="page-head page-fade">
        <div>
          <span className="eyebrow">Attendance Record</span>
          <h1>Course attendance</h1>
          <p>Per-course breakdown with session history. You have 4 unexcused absences allowed.</p>
        </div>
      </header>

      <div className="att-grid page-fade">
        {data.map(item => (
          <article key={item.code} className={`course-card att-card-${item.status}`}>
            {/* Card header */}
            <div className="card-top">
              <div>
                <b className="card-course-name">{item.course}</b>
                <code className="card-code">{item.code}</code>
              </div>
              <StatusBadge status={item.status} />
            </div>

            {/* Ring + counts */}
            <div className="card-ring-row">
              <ProgressRing
                pct={item.attendance_pct}
                color={ringColor(item.status)}
                size={110}
                stroke={10}
              />
              <div className="card-counts">
                <div className="count-row">
                  <span className="dot dot-present" />Present <b>{item.present}</b>
                </div>
                <div className="count-row">
                  <span className="dot dot-excused" />Excused <b>{item.excused}</b>
                </div>
                <div className="count-row">
                  <span className="dot dot-absent"  />Absent  <b>{item.absent}</b>
                </div>
                <div className="count-row unexcused-row">
                  Remaining unexcused: <b className={item.remaining_unexcused <= 1 ? 'text-danger' : ''}>{item.remaining_unexcused}</b>
                  <small> / {item.unexcused_limit}</small>
                </div>
              </div>
            </div>

            {/* Warning strip */}
            {item.remaining_unexcused <= 2 && (
              <div className={`warning-strip ${item.remaining_unexcused <= 1 ? 'danger' : ''}`}>
                {item.remaining_unexcused <= 0
                  ? '🚨 Critical: Automatic course drop limit reached!'
                  : item.remaining_unexcused === 1
                    ? '⚠️ Critical: Only 1 absence remaining before automatic course drop'
                    : `⚠️ Warning: ${item.remaining_unexcused} absences remaining before automatic course drop`
                }
              </div>
            )}

            {/* Session toggle */}
            <button className="session-toggle" onClick={() => toggleSessions(item.code)}>
              {openSessions[item.code]
                ? '▲ Hide sessions'
                : `▼ Show ${item.sessions.length} sessions`}
            </button>

            {openSessions[item.code] && (
              <ul className="session-history">
                {item.sessions.map((s, i) => (
                  <li key={i} className={`session-item session-${s.status}`}>
                    <span>{sessionIcon(s.status)}</span>
                    <span style={{ fontWeight: 500 }}>{s.date}</span>
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
function AlertsTab({ token, onUnreadChange, onSelectTab }) {
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

  if (error)  return <div className="error" style={{ margin: '40px 0' }}>{error}</div>
  if (!notifs) return (
    <div className="loading">
      <div className="loading-spinner" />
      Loading notifications…
    </div>
  )

  const unreadCount = notifs.filter(n => !n.read).length

  const typeIcon = t =>
    t === 'low_grade' ? '⚠️' : t === 'low_attendance' ? '📅' : '🔔'

  const typeIconClass = t =>
    t === 'low_grade' ? 'notif-icon-warn' : t === 'low_attendance' ? 'notif-icon-att' : 'notif-icon-bell'

  const fmt = iso => {
    try {
      return new Intl.DateTimeFormat('en', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      }).format(new Date(iso))
    } catch { return iso }
  }

  return (
    <>
      <header className="page-head page-fade">
        <div>
          <span className="eyebrow">Alerts &amp; Notifications</span>
          <h1>Notifications</h1>
          <p>{unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}`
            : 'All caught up! 🎉'
          }</p>
        </div>
        {unreadCount > 0 && (
          <button className="btn-markall" onClick={markAll} disabled={marking}>
            {marking ? 'Marking…' : '✓ Mark all read'}
          </button>
        )}
      </header>

      <div className="notif-list page-fade">
        {notifs.length === 0
          ? (
            <article className="panel">
              <p className="empty" style={{ padding: '40px 0' }}>🔕 No notifications yet.</p>
            </article>
          )
          : notifs.map(n => (
              <div
                key={n.id}
                className={`notif-item ${n.read ? 'notif-read' : 'notif-unread'}`}
                onClick={() => !n.read && markRead(n.id)}
                title={n.read ? '' : 'Click to mark as read'}
              >
                <div className={`notif-icon-circle ${typeIconClass(n.type)}`}>
                  {typeIcon(n.type)}
                </div>
                <div className="notif-body">
                  <div className="notif-title">{n.title}</div>
                  <div className="notif-detail">{n.detail}</div>
                  <div className="notif-meta">
                    {n.course && <span className="notif-course">{n.course}</span>}
                    <span className="notif-time">{fmt(n.created_at)}</span>
                  </div>
                  <div className="notif-actions" onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      className="notif-action-btn"
                      onClick={() => onSelectTab && onSelectTab('grades')}
                    >
                      📊 View Grade Breakdown
                    </button>
                    <a
                      className="notif-action-btn"
                      href={`mailto:teacher@univ.edu?subject=Regarding ${encodeURIComponent(n.course || 'Academic Alert')}`}
                    >
                      ✉️ Contact Instructor
                    </a>
                    <button
                      type="button"
                      className="notif-action-btn"
                      onClick={() => alert(`Academic Tutoring Center:\nDrop-in tutoring for ${n.course || 'your subjects'} is available Monday–Thursday 14:00–18:00 in Room 302.`)}
                    >
                      📚 Book Tutoring
                    </button>
                  </div>
                </div>
                {!n.read && <span className="unread-dot" />}
              </div>
            ))
        }
      </div>
    </>
  )
}

/* ─── AVATAR DROPDOWN ─────────────────────────────────────────────── */
function AvatarMenu({ user, logout }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        className="avatar-btn"
        onClick={() => setOpen(v => !v)}
        aria-label="User menu"
        aria-expanded={open}
      >
        {initials(user?.name)}
      </button>
      {open && (
        <div className="avatar-dropdown">
          <div className="avatar-dropdown-header">
            <b>{user?.name ?? 'User'}</b>
            <span>{user?.email ?? user?.id ?? ''}</span>
          </div>
          <button
            className="dropdown-item danger"
            onClick={() => { setOpen(false); logout() }}
          >
            🚪 Sign out
          </button>
        </div>
      )}
    </div>
  )
}

/* ─── STUDENT SHELL (tabs + nav) ─────────────────────────────────── */
function Student({ token, user, logout }) {
  const [tab, setTab]       = useState('dashboard')
  const [unread, setUnread] = useState(0)

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
        {/* Left: logo + brand */}
        <div className="nav-left">
          <div className="logo">S</div>
          <div className="brand-text">
            <b>StudyMate</b>
            <span>Performance monitor</span>
          </div>
        </div>

        {/* Center: tabs */}
        <div className="nav-center">
          <div className="tabs-nav">
            {tabs.map(t => (
              <button
                key={t.id}
                className={`tab-btn ${tab === t.id ? 'tab-active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.id === 'alerts' && unread > 0 && (
                  <span className="tab-badge">{unread}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Right: bell + avatar */}
        <div className="nav-right">
          <button
            className="notification-bell"
            onClick={() => setTab('alerts')}
            title="Notifications"
            aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}
          >
            🔔
            {unread > 0 && <span className="bell-badge">{unread}</span>}
          </button>
          <AvatarMenu user={user} logout={logout} />
        </div>
      </nav>

      <main className="content">
        {tab === 'dashboard'  && <DashboardTab  token={token} user={user} />}
        {tab === 'grades'     && <GradesTab     token={token} />}
        {tab === 'attendance' && <AttendanceTab token={token} />}
        {tab === 'alerts'     && <AlertsTab     token={token} onUnreadChange={setUnread} onSelectTab={setTab} />}
      </main>
    </div>
  )
}

/* ─── TEACHER VIEW ───────────────────────────────────────────────── */
function Teacher({ token, user, logout }) {
  const [students, setStudents]   = useState()
  const [analytics, setAnalytics] = useState()

  useEffect(() => {
    Promise.all([
      api('/api/teacher/students', token),
      api('/api/teacher/analytics/attendance-performance', token)
    ]).then(([s, a]) => { setStudents(s.items); setAnalytics(a) })
  }, [token])

  if (!students || !analytics) return (
    <div className="loading">
      <div className="loading-spinner" />
      Loading authorized class data…
    </div>
  )

  const atRisk = students.filter(s => s.risk_factors.length)

  const avgAtt = (students.reduce((a, s) => a + s.attendance, 0) / students.length).toFixed(1)

  return (
    <>
      <header className="page-head page-fade">
        <div>
          <span className="eyebrow">Teacher Overview</span>
          <h1>Your class signals.</h1>
          <p>Authorized CS-2026 student performance and explainable risk factors.</p>
        </div>
      </header>

      <section className="metrics page-fade">
        <Metric
          label="Students in Scope"
          value={students.length}
          detail="Current authorized cohort"
          icon="👥"
          colorClass="metric-purple"
        />
        <Metric
          label="At-Risk Students"
          value={atRisk.length}
          detail="Based on configured demo rules"
          icon="⚠️"
          tone={atRisk.length ? 'warn' : ''}
          colorClass={atRisk.length ? 'metric-warn' : 'metric-green'}
        />
        <Metric
          label="Avg. Attendance"
          value={`${avgAtt}%`}
          detail="Across students in scope"
          icon="📊"
          colorClass="metric-blue"
        />
        <Metric
          label="Correlation"
          value={analytics.correlation}
          detail="Association, not causation"
          icon="📈"
          colorClass="metric-green"
        />
      </section>

      <section className="grid page-fade">
        <article className="panel wide">
          <div className="panel-title">
            <div>
              <span className="eyebrow">Authorized Students</span>
              <h2>Risk watchlist</h2>
            </div>
          </div>
          <div className="student-table">
            <div className="thead">
              <span>Student</span>
              <span>Attendance</span>
              <span>Risk status</span>
            </div>
            {students.map(s => (
              <div className="trow" key={s.id}>
                <div className="student-info">
                  <div className="student-avatar">{initials(s.name)}</div>
                  <div className="student-info-text">
                    <b>{s.name}</b>
                    <small>{s.cohort}</small>
                  </div>
                </div>
                <strong style={{ color: s.attendance < 75 ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>
                  {s.attendance}%
                </strong>
                <span>
                  {s.risk_factors.length
                    ? s.risk_factors.map((r, i) => <em key={i}>{r.detail}</em>)
                    : <em className="good">✓ No active signals</em>
                  }
                </span>
              </div>
            ))}
          </div>
        </article>

        <aside>
          <article className="panel">
            <span className="eyebrow">Attendance × Grade</span>
            <h2>Class relationship</h2>
            <ResponsiveContainer width="100%" height={220}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="attendance"    name="Attendance" unit="%" domain={[50, 100]} tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <YAxis dataKey="average_grade" name="Grade"      unit="%" domain={[40, 100]} tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Scatter data={analytics.points} fill="#F97316" />
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

  useEffect(() => {
    const onAuthExpired = () => setSession(null)
    window.addEventListener('auth:expired', onAuthExpired)
    return () => window.removeEventListener('auth:expired', onAuthExpired)
  }, [])

  if (!session) return <Login onLogin={login} />

  if (session.user.role === 'teacher') {
    return (
      <div className="app">
        <nav className="topnav">
          <div className="nav-left">
            <div className="logo">S</div>
            <div className="brand-text">
              <b>StudyMate</b>
              <span>Performance monitor</span>
            </div>
          </div>
          <div className="nav-center" />
          <div className="nav-right">
            <AvatarMenu user={session.user} logout={logout} />
          </div>
        </nav>
        <main className="content">
          <Teacher token={session.access_token} user={session.user} logout={logout} />
        </main>
      </div>
    )
  }

  return <Student token={session.access_token} user={session.user} logout={logout} />
}

createRoot(document.getElementById('root')).render(<App />)
