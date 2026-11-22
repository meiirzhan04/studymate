import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart, Cell } from 'recharts'
import './monitoring.css'
import { LEVEL_TONE, RISK_TONE, SEVERITY_LABEL, SEVERITY_TONE, costLine, curveRows, lastSyncedLabel, riskTone, signed, simulationView, skipLine, skippedHours } from './monitoring.js'

/* Monitoring tab, "Sync with SDU" bar and the AI widgets.
   `api` is the app's fetch helper (passed in so this file does not import main.jsx). */

const Pill = ({ tone = 'neutral', children }) => <span className={`mon-pill mon-pill-${tone}`}>{children}</span>

export function SyncBar({ updatedAt, onSync, syncing, demo }) {
  const [, tick] = useState(0)
  useEffect(() => { const id = setInterval(() => tick(n => n + 1), 30000); return () => clearInterval(id) }, [])
  return (
    <div className="mon-syncbar">
      <span className="mon-sync-text">{lastSyncedLabel(updatedAt)}{demo ? ' · demo data' : ''}</span>
      <button type="button" className="btn-ghost" onClick={onSync} disabled={syncing}>
        {syncing ? 'Syncing…' : 'Sync with SDU'}
      </button>
    </div>
  )
}

function useOverview(api, token, version) {
  const [state, setState] = useState({ loading: true, data: null, error: '' })
  const load = useCallback(() => {
    api('/api/monitoring/overview', token)
      .then(data => setState({ loading: false, data, error: '' }))
      .catch(e => setState({ loading: false, data: null, error: e.message || 'Could not load monitoring data.' }))
  }, [api, token])
  useEffect(() => { load() }, [load, version])
  return [state, load]
}

/* ─── Overview widget: predicted GPA ─────────────────────────────── */
export function PredictedGpaWidget({ api, token, version, onOpen }) {
  const [{ data }] = useOverview(api, token, version)
  const risk = data?.risk
  if (!risk) return null
  return (
    <article className="card mon-widget">
      <div className="mon-widget-main">
        <span className="metric-label">Predicted GPA (AI)</span>
        <div className="metric-value">{risk.predicted_gpa.toFixed(2)}<span className="metric-unit"> / 4.00</span></div>
        <small className="muted">Your current GPA, adjusted for absences, deadlines and trend</small>
      </div>
      <div className="mon-widget-side">
        <Pill tone={RISK_TONE[risk.level]}>{risk.risk_percent}% risk</Pill>
        {risk.reasons[0] && <small className="muted">{risk.reasons[0].text}</small>}
        <button type="button" className="link-btn" onClick={onOpen}>Open Monitoring →</button>
      </div>
    </article>
  )
}

/* ─── Block 1: Safe-to-skip calculator ───────────────────────────── */
function SafeToSkip({ data }) {
  const items = data?.items || []
  if (!items.length) {
    return <p className="mon-empty">No class-hour data yet. Sync with SDU to see how many classes you can miss.</p>
  }
  return (
    <ul className="mon-skip-list">
      {items.map(c => {
        const tone = LEVEL_TONE[c.level]
        return (
          <li key={c.code || c.name} className="mon-skip-row">
            <div className="mon-skip-head">
              <b>{c.name}</b>
              <span className="muted">{c.code}</span>
              <Pill tone={tone}>
                {c.fx ? 'Over the limit (FX)' : c.remaining_skips === 0 ? 'No skips left' : `${c.remaining_skips} skip${c.remaining_skips === 1 ? '' : 's'} left`}
              </Pill>
            </div>
            <div className="mon-bar" role="progressbar" aria-valuemin={0} aria-valuemax={c.limit} aria-valuenow={Math.min(c.absent, c.limit)}
                 aria-label={`${c.name}: ${c.absent} of ${c.limit} allowed absences used`}>
              <div className={`mon-bar-fill mon-fill-${tone}`} style={{ width: `${Math.min(100, c.used_pct)}%` }} />
              {c.pending > 0 && (
                <div className="mon-bar-pending" style={{ left: `${Math.min(100, c.used_pct)}%`, width: `${Math.min(100 - Math.min(100, c.used_pct), c.limit ? (c.pending / c.limit) * 100 : 0)}%` }} />
              )}
            </div>
            <div className="mon-skip-foot">
              <span>{skipLine(c)}</span>
              {c.pending > 0 && <span className="mon-pending-note">{c.pending} “Not submitted” — not counted as absences yet</span>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/* ─── Risk card: AI risk + top-3 SHAP reasons ────────────────────── */
function RiskCard({ risk, history }) {
  if (!risk) return null
  const trend = (history || []).map((h, i) => ({ i, risk: Math.round(h.risk * 100) }))
  const max = Math.max(1, ...risk.reasons.map(r => Math.abs(r.impact)))
  return (
    <article className="card mon-card">
      <header className="group-head"><h2>AI risk assessment</h2><span>Model {risk.model_version}</span></header>
      <div className="mon-risk-top">
        <div>
          <div className={`mon-risk-value tone-${riskTone(risk.risk_percent)}`}>{risk.risk_percent}%</div>
          <small className="muted">chance you need extra academic support</small>
        </div>
        <div>
          <div className="mon-risk-value">{risk.predicted_gpa.toFixed(2)}</div>
          <small className="muted">predicted GPA</small>
        </div>
        <Pill tone={RISK_TONE[risk.level]}>{risk.level[0].toUpperCase() + risk.level.slice(1)} risk{risk.fx ? ' · FX' : ''}</Pill>
      </div>
      {risk.summary && <p className="mon-summary">{risk.summary}</p>}
      {risk.reasons.length > 0 && (
        <>
          <h3 className="mon-sub">Pushing your risk up (top {risk.reasons.length})</h3>
          <ul className="mon-reasons">
            {risk.reasons.map(r => (
              <li key={r.feature}>
                <span>{r.text}</span>
                <span className="mon-reason-bar"><i style={{ width: `${Math.max(6, (Math.abs(r.impact) / max) * 100)}%` }} /></span>
                <b>{r.impact > 0 ? `+${r.impact}` : r.impact} pts</b>
              </li>
            ))}
          </ul>
        </>
      )}
      {risk.helping?.length > 0 && (
        <>
          <h3 className="mon-sub">What is helping you</h3>
          <ul className="mon-reasons mon-helping">
            {risk.helping.map(r => (
              <li key={r.feature}>
                <span>{r.text}</span>
                <span className="mon-reason-bar"><i style={{ width: `${Math.max(6, (Math.abs(r.impact) / Math.max(1, ...risk.helping.map(h => Math.abs(h.impact)))) * 100)}%` }} /></span>
                <b>{r.impact} pts</b>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="footnote">Explained with SHAP: how many percentage points each factor adds to (red) or takes off (green) your risk.</p>
      {trend.length < 2 && <p className="mon-hist-empty">Risk over time appears here after a few syncs.</p>}
      {trend.length >= 2 && (
        <div className="mon-trend" aria-label="Risk over time">
          <h3 className="mon-sub">Risk over time</h3>
          <ResponsiveContainer width="100%" height={90}>
            <LineChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <YAxis hide domain={[0, 100]} /><XAxis hide dataKey="i" />
              <Tooltip formatter={v => [`${v}%`, 'Risk']} labelFormatter={() => ''} />
              <Line type="monotone" dataKey="risk" stroke="var(--accent)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </article>
  )
}

/* ─── Block 2: AI impact simulation ──────────────────────────────── */
function Slider({ id, label, value, onChange, max = 12 }) {
  return (
    <label className="mon-slider" htmlFor={id}>
      <span>{label}<b>{value}</b></span>
      <input id={id} type="range" min="0" max={max} step="1" value={value} onChange={e => onChange(Number(e.target.value))} />
    </label>
  )
}

const CURVE_HOURS = 30       // the server sends the whole curve once; the sliders then work on it locally

function Simulation({ api, token, courses }) {
  const [lectures, setLectures] = useState(2)
  const [practices, setPractices] = useState(1)
  const [course, setCourse] = useState(courses[0]?.code || '')   // the course closest to its limit
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  // One request per course (not per slider move): the curve for 0..30 skipped hours
  useEffect(() => {
    let alive = true
    api('/api/simulate', token, { method: 'POST', body: JSON.stringify({ lectures: 0, practices: 0, course_code: course || null, max_hours: CURVE_HOURS }) })
      .then(r => { if (alive) { setData(r); setError('') } })
      .catch(e => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [api, token, course])

  const hours = skippedHours(lectures, practices, data?.hours_per_class)
  const view = useMemo(() => (data ? simulationView(data.curve, hours) : null), [data, hours])
  const rows = useMemo(() => {
    const all = curveRows(data?.curve)
    const fxAt = all.findIndex(r => r.fx)
    const last = Math.min(all.length - 1, Math.max(10, Math.ceil(hours) + 3, fxAt >= 0 ? fxAt + 3 : 0))
    return all.slice(0, last + 1)
  }, [data, hours])
  const fxStart = rows.find(r => r.fx)?.hours
  const lastHour = rows.at(-1)?.hours ?? 10
  const here = view ? { risk: view.afterRisk, gpa: Math.round(view.afterGpa * 100) / 100 } : null

  return (
    <article className="card mon-card">
      <header className="group-head"><h2>AI impact simulation</h2><span>What if I skip…</span></header>
      <div className="mon-sim-controls">
        <Slider id="sim-lectures" label="Lectures to skip" value={lectures} onChange={setLectures} />
        <Slider id="sim-practices" label="Practices to skip" value={practices} onChange={setPractices} />
        <label className="mon-select">
          <span>Course</span>
          <select className="select" value={course} onChange={e => setCourse(e.target.value)}>
            <option value="">All courses (spread evenly)</option>
            {courses.map(c => <option key={c.code} value={c.code}>{c.name}{c.code && c.code !== c.name ? ` · ${c.code}` : ''}</option>)}
          </select>
        </label>
      </div>
      {error && <div className="alert-box alert-danger">{error}</div>}
      {data?.course_cost && <p className="mon-cost">{costLine(data.course_cost, !course)}</p>}
      {view && (
        <>
          <div className="mon-sim-result" aria-live="polite">
            <div>
              <small className="muted">Predicted GPA</small>
              <div className="mon-sim-num">{(Math.floor(view.afterGpa * 10 + 0.5) / 10).toFixed(1)} <span className={`mon-delta ${view.gpaChange <= -0.05 ? 'down' : ''}`}>{signed(view.gpaChange, 1)}</span></div>
              <small className="muted">now {(Math.floor(view.beforeGpa * 10 + 0.5) / 10).toFixed(1)}</small>
            </div>
            <div>
              <small className="muted">Dropout risk</small>
              <div className={`mon-sim-num tone-${riskTone(view.afterRisk)}`}>{view.afterRisk}% <span className={`mon-delta ${view.riskChange > 0 ? 'down' : ''}`}>{signed(view.riskChange, 0, '%')}</span></div>
              <small className="muted">now {view.beforeRisk}%</small>
            </div>
          </div>
          <p className={`mon-sim-msg ${view.fxCourses.length ? 'bad' : ''}`}>{view.message}</p>
          <div className="mon-chart" aria-label="Predicted GPA and risk by skipped hours">
            <ResponsiveContainer width="100%" height={230}>
              <ComposedChart data={rows} margin={{ top: 10, right: 12, bottom: 4, left: -8 }}>
                <defs>
                  <linearGradient id="mon-risk-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--danger)" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="var(--danger)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="hours" type="number" domain={[0, lastHour]} allowDecimals={false} tickLine={false} tick={{ fontSize: 11 }}
                       label={{ value: 'Skipped class hours', position: 'insideBottom', offset: -2, fontSize: 11 }} height={36} />
                <YAxis yAxisId="gpa" domain={[0, 4]} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={34} />
                <YAxis yAxisId="risk" orientation="right" domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={40} unit="%" />
                {fxStart != null && <ReferenceArea yAxisId="gpa" x1={fxStart} x2={lastHour} fill="var(--danger)" fillOpacity={0.07}
                                                   label={{ value: 'FX zone', position: 'insideTopRight', fontSize: 11, fill: 'var(--danger)' }} />}
                <Tooltip isAnimationActive={false} labelFormatter={h => `${h} hour(s) missed`}
                         formatter={(v, name) => (name === 'Risk' ? [`${v}%`, 'Risk'] : [Number(v).toFixed(2), 'Predicted GPA'])} />
                <ReferenceLine yAxisId="gpa" x={Math.min(hours, lastHour)} stroke="var(--text-muted)" strokeDasharray="4 4" />
                <Area yAxisId="risk" type="monotone" dataKey="risk" name="Risk" stroke="var(--danger)" strokeWidth={2.5} fill="url(#mon-risk-fill)" dot={false} isAnimationActive={false} />
                <Line yAxisId="gpa" type="monotone" dataKey="gpa" name="Predicted GPA" stroke="var(--accent)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                {here && <ReferenceDot yAxisId="risk" x={Math.min(hours, lastHour)} y={here.risk} r={5} fill="var(--danger)" stroke="var(--surface)" strokeWidth={2} ifOverflow="visible" />}
                {here && <ReferenceDot yAxisId="gpa" x={Math.min(hours, lastHour)} y={here.gpa} r={5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} ifOverflow="visible" />}
              </ComposedChart>
            </ResponsiveContainer>
            <div className="mon-legend"><span><i style={{ background: 'var(--accent)' }} />Predicted GPA</span><span><i style={{ background: 'var(--danger)' }} />Risk %</span></div>
          </div>
        </>
      )}
    </article>
  )
}

/* ─── Block 3: alerts feed ───────────────────────────────────────── */
function Alerts({ items, onEmail, emailState }) {
  return (
    <article className="card mon-card">
      <header className="group-head">
        <h2>Alerts</h2>
        <button type="button" className="link-btn" onClick={onEmail} disabled={emailState.busy}>{emailState.busy ? 'Sending…' : 'Email me this'}</button>
      </header>
      {emailState.message && <div className={`alert-box ${emailState.ok ? 'alert-success' : 'alert-warning'}`} role="status">{emailState.message}</div>}
      {items.length ? (
        <ul className="mon-alerts">
          {items.map((a, i) => (
            <li key={`${a.type}-${a.course}-${i}`} className={`mon-alert mon-alert-${SEVERITY_TONE[a.severity]}`}>
              <div><Pill tone={SEVERITY_TONE[a.severity]}>{SEVERITY_LABEL[a.severity]}</Pill> <b>{a.title}</b></div>
              <p>{a.detail}</p>
            </li>
          ))}
        </ul>
      ) : <p className="mon-empty">No warnings. Your attendance and grades look healthy.</p>}
    </article>
  )
}

function CuratorCard({ api, token }) {
  const [email, setEmail] = useState('')
  const [saved, setSaved] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => { api('/api/monitoring/curator', token).then(c => { setEmail(c.email || ''); setSaved(c.email || '') }).catch(() => {}) }, [api, token])
  const save = async e => {
    e.preventDefault()
    setMsg('')
    try {
      if (email.trim()) await api('/api/monitoring/curator', token, { method: 'PUT', body: JSON.stringify({ email: email.trim() }) })
      else await api('/api/monitoring/curator', token, { method: 'DELETE' })
      setSaved(email.trim())
      setMsg(email.trim() ? 'Curator saved.' : 'Curator removed.')
    } catch (err) { setMsg(err.message) }
  }
  return (
    <article className="card mon-card">
      <header className="group-head"><h2>E-mail alerts</h2><span>risk above 50%</span></header>
      <p className="muted mon-small">When the model predicts a risk above 50%, StudyMate e-mails you and, if you add one, your curator.</p>
      <form className="mon-curator" onSubmit={save}>
        <label htmlFor="curator-email">Curator e-mail (optional)</label>
        <div>
          <input id="curator-email" className="input" type="email" placeholder="curator@sdu.edu.kz" value={email} onChange={e => setEmail(e.target.value)} />
          <button type="submit" className="btn-primary" disabled={email.trim() === saved}>Save</button>
        </div>
        {msg && <small className="muted" role="status">{msg}</small>}
      </form>
    </article>
  )
}

/* ─── The tab ────────────────────────────────────────────────────── */
export function MonitoringTab({ api, token, sduStatus, onConnect, onSync, syncing, version }) {
  const [{ loading, data, error }, reload] = useOverview(api, token, version)
  const [emailState, setEmailState] = useState({ busy: false, message: '', ok: false })

  const sendEmail = async () => {
    setEmailState({ busy: true, message: '', ok: false })
    try {
      const r = await api('/api/monitoring/notify', token, { method: 'POST' })
      const delivered = r.sent ? `Alert sent to ${r.to.join(', ')}.` : ''
      const failed = r.errors?.length ? `Delivery failed for ${r.errors.join(', ')}.` : ''
      setEmailState({ busy: false, ok: r.sent && !failed, message: [delivered, failed].filter(Boolean).join(' ') || `Not sent: ${r.reason}` })
    } catch (e) { setEmailState({ busy: false, ok: false, message: e.message }) }
  }

  const sync = async () => { await onSync(); reload() }

  if (!sduStatus?.connected && !data?.has_data) {
    return (
      <div className="page page-fade">
        <article className="card mon-card"><p className="mon-empty">Connect your SDU account to monitor attendance and academic risk.</p>
          <button type="button" className="btn-primary" onClick={onConnect}>Connect SDU</button></article>
      </div>
    )
  }
  if (loading) return <div className="page-loader page-fade"><div className="spinner" /><span>Analysing your attendance…</span></div>
  if (error) return <div className="page"><div className="alert-box alert-danger">{error}</div></div>

  const courses = (data.safe_to_skip?.items || []).map(c => ({ code: c.code, name: c.name }))
  return (
    <div className="page page-fade mon-page">
      <SyncBar updatedAt={data.last_synced || sduStatus?.updated_at} onSync={sync} syncing={syncing} demo={sduStatus?.demo_mode} />
      <section className="mon-grid">
        <article className="card mon-card mon-span">
          <header className="group-head"><h2>Safe to skip</h2><span>{data.safe_to_skip?.rule}</span></header>
          <SafeToSkip data={data.safe_to_skip} />
        </article>
        <RiskCard risk={data.risk} history={data.history} />
        <Alerts items={data.alerts || []} onEmail={sendEmail} emailState={emailState} />
        {data.has_data && courses.length > 0 && <div className="mon-span"><Simulation api={api} token={token} courses={courses} /></div>}
        <CuratorCard api={api} token={token} />
      </section>
    </div>
  )
}

/* ─── Insights: forecast chart for difficult subjects ────────────── */
export function DifficultForecast({ api, token }) {
  const [rows, setRows] = useState(null)
  useEffect(() => { api('/api/monitoring/forecast', token).then(d => setRows(d.items)).catch(() => setRows([])) }, [api, token])
  if (!rows || !rows.length) return null
  const data = rows.map(r => ({
    name: r.course || r.code, current: r.current_score, forecast: r.predicted_score,
    low: r.low, high: r.high, level: r.attendance_level,
  }))
  const forecastable = data.filter(d => d.forecast != null).length
  return (
    <article className="card mon-card">
      <header className="group-head"><h2>Forecast for difficult subjects</h2><span>lowest scores first</span></header>
      <div className="mon-chart" aria-label="Current score and forecast final score for the hardest subjects">
        <ResponsiveContainer width="100%" height={Math.max(180, data.length * 52)}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} interval={0} />
            <ReferenceLine x={60} stroke="var(--danger)" strokeDasharray="4 4" label={{ value: 'pass 60', fontSize: 10, fill: 'var(--danger)', position: 'top' }} />
            <Tooltip formatter={(v, name, item) => name === 'Forecast final' && item.payload.low != null ? [`${v} (range ${item.payload.low}–${item.payload.high})`, name] : [v, name]} />
            <Bar dataKey="current" name="Current score" fill="var(--text-muted)" radius={[0, 4, 4, 0]} barSize={13} isAnimationActive={false} />
            <Bar dataKey="forecast" name="Forecast final" radius={[0, 4, 4, 0]} barSize={13} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.forecast != null && d.forecast < 60 ? 'var(--danger)' : 'var(--accent)'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="footnote">
        {forecastable ? 'Grey bars are your score now; coloured bars are the forecast final grade (hover for the 95% range).' : 'Grey bars are your scores now. Forecasts appear once 70% of a course is graded and its assessment breakdown is known (add it in the What-if planner).'}
      </p>
    </article>
  )
}
