import React, { useEffect, useState, useCallback, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Scatter, ScatterChart
} from 'recharts'
import './styles.css'

/* ─── API helper ──────────────────────────────────────────────────── */
const RENDER_BACKEND_URL = 'https://studymate-knap.onrender.com'

const getApiBase = () => {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host !== 'localhost' && host !== '127.0.0.1') {
      return RENDER_BACKEND_URL
    }
  }
  if (import.meta.env.VITE_API_URL && !import.meta.env.VITE_API_URL.includes('studymate-res1')) {
    return import.meta.env.VITE_API_URL
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

/* ─── PROFESSIONAL VECTOR ICONS ───────────────────────────────────── */
const Icons = {
  Chart: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  Calendar: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  Sliders: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  ),
  Bell: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  User: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  GraduationCap: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </svg>
  ),
  Eye: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  EyeOff: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ),
  Mail: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  Lock: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  Check: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  CheckCircle: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  AlertTriangle: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  Download: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  Search: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  Close: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Target: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  ),
  Book: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
  Award: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <circle cx="12" cy="8" r="7" />
      <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
    </svg>
  ),
  SignOut: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  Edit: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  Send: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
  ChevronDown: ({ size = 16, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  ChevronUp: ({ size = 16, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <polyline points="18 15 12 9 6 15" />
    </svg>
  ),
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
  const [authMode, setAuthMode]     = useState('login') // 'login' | 'register'
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword]     = useState('')
  const [showPw, setShowPw]         = useState(false)
  const [error, setError]           = useState('')
  const [busy, setBusy]             = useState(false)

  // Registration state
  const [regName, setRegName]       = useState('')
  const [regId, setRegId]           = useState('')
  const [regEmail, setRegEmail]     = useState('')
  const [regPw, setRegPw]           = useState('')
  const [regRole, setRegRole]       = useState('student')

  // Forgot password / 6-digit code modal state
  const [showForgot, setShowForgot] = useState(false)
  const [forgotStep, setForgotStep] = useState(1) // 1: enter email, 2: enter 6-digit code & new password
  const [forgotEmail, setForgotEmail] = useState('')
  const [resetCode, setResetCode]   = useState('')
  const [demoCode, setDemoCode]     = useState('')
  const [newPw, setNewPw]           = useState('')
  const [confirmPw, setConfirmPw]   = useState('')
  const [showNewPw, setShowNewPw]   = useState(false)
  const [forgotMsg, setForgotMsg]   = useState('')
  const [forgotErr, setForgotErr]   = useState('')
  const [forgotBusy, setForgotBusy] = useState(false)

  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('')
    try { onLogin(await api('/api/auth/login', null, { method: 'POST', body: JSON.stringify({ identifier, password }) })) }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  const handleRegister = async e => {
    e.preventDefault(); setBusy(true); setError('')
    if (!regName.trim()) {
      setError('Please enter your full name')
      setBusy(false)
      return
    }
    if (!regId.trim()) {
      setError('Please enter your Student ID')
      setBusy(false)
      return
    }
    if (regPw.length < 6) {
      setError('Password must be at least 6 characters')
      setBusy(false)
      return
    }
    try {
      const authData = await api('/api/auth/register', null, {
        method: 'POST',
        body: JSON.stringify({
          name: regName.trim(),
          identifier: regId.trim(),
          password: regPw,
          role: regRole,
          email: regEmail.trim() || undefined,
        })
      })
      onLogin(authData)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleSendCode = async e => {
    e?.preventDefault()
    if (!forgotEmail.trim()) {
      setForgotErr('Please enter your registered email or Student ID')
      return
    }
    setForgotBusy(true); setForgotErr(''); setForgotMsg('')
    try {
      const res = await api('/api/auth/send-reset-code', null, {
        method: 'POST',
        body: JSON.stringify({ email: forgotEmail.trim() })
      })
      if (res.target_email) {
        setForgotEmail(res.target_email)
      }
      setResetCode('')
      setDemoCode('')
      if (!res.sent_via_email && res._demo_code) {
        try {
          await fetch('/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: res.target_email || forgotEmail.trim(),
              code: res._demo_code
            })
          })
        } catch (relayErr) {
          console.warn('Vercel mail relay client fallback:', relayErr)
        }
      }
      setForgotMsg(res.message || 'Verification code sent to your email!')
      setForgotStep(2)
    } catch (err) {
      setForgotErr(err.message)
    } finally {
      setForgotBusy(false)
    }
  }

  const handleVerifyAndReset = async e => {
    e?.preventDefault()
    if (!resetCode.trim() || resetCode.trim().length !== 6) {
      setForgotErr('Please enter the 6-digit verification code')
      return
    }
    if (newPw.length < 6) {
      setForgotErr('Password must be at least 6 characters long')
      return
    }
    if (confirmPw && newPw !== confirmPw) {
      setForgotErr('Passwords do not match')
      return
    }
    setForgotBusy(true); setForgotErr(''); setForgotMsg('')
    try {
      const res = await api('/api/auth/verify-reset-code', null, {
        method: 'POST',
        body: JSON.stringify({
          email: forgotEmail.trim(),
          code: resetCode.trim(),
          new_password: newPw
        })
      })
      setForgotMsg(res.message || 'Password updated successfully!')
      setPassword(newPw)
      setIdentifier(forgotEmail.trim())
      setTimeout(() => {
        setShowForgot(false)
        setForgotStep(1)
        setResetCode('')
        setDemoCode('')
        setNewPw('')
        setConfirmPw('')
        setForgotMsg('')
      }, 1500)
    } catch (err) {
      setForgotErr(err.message)
    } finally {
      setForgotBusy(false)
    }
  }

  const openForgot = () => {
    setShowForgot(true)
    setForgotStep(1)
    setForgotEmail(identifier || '')
    setResetCode('')
    setDemoCode('')
    setNewPw('')
    setConfirmPw('')
    setForgotMsg('')
    setForgotErr('')
  }

  return (
    <main className="login-page">
      {/* Left brand panel */}
      <section className="login-copy">
        <div className="login-eyebrow">
          <span className="login-eyebrow-dot" />
          StudyMate Portal
        </div>
        <h1>Academic Portal<br /><span>& Performance Tracker</span></h1>
        <p>Real-time university grades, attendance tracking, and academic analytics.</p>
        <div className="login-features">
          <div className="login-feature">
            <div className="login-feature-icon"><Icons.Chart size={18} color="#C4B5FD" /></div>
            <span>Live Grade Breakdown</span>
          </div>
          <div className="login-feature">
            <div className="login-feature-icon"><Icons.Calendar size={18} color="#C4B5FD" /></div>
            <span>Attendance & Sessions History</span>
          </div>
          <div className="login-feature">
            <div className="login-feature-icon"><Icons.Sliders size={18} color="#C4B5FD" /></div>
            <span>What-If Performance Calculator</span>
          </div>
          <div className="login-feature">
            <div className="login-feature-icon"><Icons.Bell size={18} color="#C4B5FD" /></div>
            <span>Smart Academic Alerts</span>
          </div>
        </div>
      </section>

      {/* Right form panel */}
      <div className="login-right">
        <div className="login-card">
          <div className="login-logo">S</div>

          {/* Mode Switcher Tabs */}
          <div style={{ display: 'flex', gap: 6, background: 'var(--paper)', padding: 4, borderRadius: 10, marginBottom: 20 }}>
            <button
              type="button"
              onClick={() => { setAuthMode('login'); setError('') }}
              style={{
                flex: 1, padding: '9px 12px', border: 'none', borderRadius: 8,
                fontWeight: 700, fontSize: '.88rem', cursor: 'pointer',
                background: authMode === 'login' ? '#fff' : 'transparent',
                color: authMode === 'login' ? '#111827' : 'var(--text-secondary)',
                boxShadow: authMode === 'login' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all .2s'
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setAuthMode('register'); setError('') }}
              style={{
                flex: 1, padding: '9px 12px', border: 'none', borderRadius: 8,
                fontWeight: 700, fontSize: '.88rem', cursor: 'pointer',
                background: authMode === 'register' ? '#fff' : 'transparent',
                color: authMode === 'register' ? '#111827' : 'var(--text-secondary)',
                boxShadow: authMode === 'register' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all .2s'
              }}
            >
              Create Account
            </button>
          </div>

          {authMode === 'login' ? (
            <form onSubmit={submit}>
              <h2>Welcome back</h2>
              <p>Sign in with your university account or email.</p>

              <div className="login-field">
                <label htmlFor="identifier">University email or Student ID</label>
                <div className="login-input-wrap">
                  <input
                    id="identifier"
                    value={identifier}
                    onChange={e => setIdentifier(e.target.value)}
                    placeholder="e.g. 240103118 or student@univ.edu"
                    autoComplete="username"
                    required
                  />
                </div>
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
                    required
                  />
                  <button
                    type="button"
                    className="pw-toggle"
                    onClick={() => setShowPw(v => !v)}
                    tabIndex={-1}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                  >
                    {showPw ? <Icons.EyeOff size={16} color="var(--text-secondary)" /> : <Icons.Eye size={16} color="var(--text-secondary)" />}
                  </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={openForgot}
                    style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: '.82rem', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Forgot password?
                  </button>
                </div>
              </div>

              {error && <div className="error">{error}</div>}

              <button className="login-submit" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in →'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister}>
              <h2>Create Account</h2>
              <p>Register with your university student profile.</p>

              <div className="login-field">
                <label htmlFor="regName">Full Name</label>
                <div className="login-input-wrap">
                  <input
                    id="regName"
                    value={regName}
                    onChange={e => setRegName(e.target.value)}
                    placeholder="e.g. Meirzhan"
                    autoComplete="name"
                    required
                  />
                </div>
              </div>

              <div className="login-field">
                <label htmlFor="regId">Student ID</label>
                <div className="login-input-wrap">
                  <input
                    id="regId"
                    value={regId}
                    onChange={e => setRegId(e.target.value)}
                    placeholder="e.g. 240103118 or 240103188"
                    autoComplete="username"
                    required
                  />
                </div>
              </div>

              <div className="login-field">
                <label htmlFor="regEmail">Email Address (for password recovery)</label>
                <div className="login-input-wrap">
                  <input
                    id="regEmail"
                    type="email"
                    value={regEmail}
                    onChange={e => setRegEmail(e.target.value)}
                    placeholder="e.g. your-email@gmail.com"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="login-field">
                <label htmlFor="regPw">Password</label>
                <div className="login-input-wrap">
                  <input
                    id="regPw"
                    type={showPw ? 'text' : 'password'}
                    value={regPw}
                    onChange={e => setRegPw(e.target.value)}
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                    style={{ paddingRight: 44 }}
                    required
                  />
                  <button
                    type="button"
                    className="pw-toggle"
                    onClick={() => setShowPw(v => !v)}
                    tabIndex={-1}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                  >
                    {showPw ? <Icons.EyeOff size={16} color="var(--text-secondary)" /> : <Icons.Eye size={16} color="var(--text-secondary)" />}
                  </button>
                </div>
              </div>

              <div className="login-field">
                <label>Account Role</label>
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => setRegRole('student')}
                    style={{
                      flex: 1, padding: '10px 12px', borderRadius: 8,
                      border: regRole === 'student' ? '2px solid var(--primary)' : '1px solid var(--border)',
                      background: regRole === 'student' ? '#EEF2FF' : '#fff',
                      fontWeight: 600, fontSize: '.84rem', cursor: 'pointer',
                      color: regRole === 'student' ? 'var(--primary)' : 'var(--text-secondary)',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6
                    }}
                  >
                    <Icons.User size={15} /> Student
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegRole('teacher')}
                    style={{
                      flex: 1, padding: '10px 12px', borderRadius: 8,
                      border: regRole === 'teacher' ? '2px solid var(--primary)' : '1px solid var(--border)',
                      background: regRole === 'teacher' ? '#EEF2FF' : '#fff',
                      fontWeight: 600, fontSize: '.84rem', cursor: 'pointer',
                      color: regRole === 'teacher' ? 'var(--primary)' : 'var(--text-secondary)',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6
                    }}
                  >
                    <Icons.GraduationCap size={15} /> Teacher
                  </button>
                </div>
              </div>

              {error && <div className="error">{error}</div>}

              <button className="login-submit" disabled={busy}>
                {busy ? 'Creating account…' : 'Create Account →'}
              </button>
            </form>
          )}

          {/* 6-Digit Code Reset Modal */}
          {showForgot && (
            <div className="whatif-overlay" onClick={e => e.target === e.currentTarget && setShowForgot(false)}>
              <div className="whatif-modal" style={{ maxWidth: 460 }}>
                <div className="whatif-header">
                  <div>
                    <span className="eyebrow">Account Recovery</span>
                    <h2>Reset Password</h2>
                  </div>
                  <button type="button" className="close-btn" onClick={() => setShowForgot(false)}><Icons.Close size={18} /></button>
                </div>

                {forgotStep === 1 ? (
                  <form onSubmit={handleSendCode}>
                    <div className="whatif-body">
                      <p style={{ color: 'var(--text-secondary)', fontSize: '.88rem', margin: 0, lineHeight: 1.5 }}>
                        Enter your registered email address (e.g. your Gmail) or Student ID. We will generate and send a <b>6-digit confirmation code</b>.
                      </p>
                      <label>
                        University Email or Student ID
                        <input
                          type="text"
                          value={forgotEmail}
                          onChange={e => setForgotEmail(e.target.value)}
                          placeholder="e.g. 240103118 or user@gmail.com"
                          autoComplete="email"
                          autoFocus
                          required
                        />
                      </label>
                      {forgotErr && <div className="error">{forgotErr}</div>}
                    </div>
                    <div className="whatif-footer">
                      <button type="button" className="btn-ghost" onClick={() => setShowForgot(false)}>Cancel</button>
                      <button
                        type="submit"
                        className="btn-primary"
                        disabled={!forgotEmail.trim() || forgotBusy}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        {forgotBusy ? 'Sending code…' : <><Icons.Send size={15} /> Send 6-Digit Code</>}
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={handleVerifyAndReset}>
                    <div className="whatif-body">
                      {forgotMsg && (
                        <div style={{ background: 'var(--success-dim)', color: '#15803D', padding: '10px 14px', borderRadius: 8, fontSize: '.84rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Icons.CheckCircle size={16} /> {forgotMsg}
                        </div>
                      )}
                      <p style={{ color: 'var(--text-secondary)', fontSize: '.84rem', margin: '4px 0 0' }}>
                        Check your inbox for <b>{forgotEmail}</b> (also check Spam/Junk folder) and enter the 6-digit code:
                      </p>

                      <label>
                        6-Digit Verification Code
                        <input
                          type="text"
                          maxLength={6}
                          value={resetCode}
                          onChange={e => setResetCode(e.target.value.replace(/\D/g, ''))}
                          placeholder="••••••"
                          style={{ textAlign: 'center', fontSize: '1.4rem', letterSpacing: 8, fontWeight: 800, fontFamily: 'monospace' }}
                          autoFocus
                          required
                        />
                      </label>

                      <label>
                        New Password
                        <div style={{ position: 'relative' }}>
                          <input
                            type={showNewPw ? 'text' : 'password'}
                            value={newPw}
                            onChange={e => setNewPw(e.target.value)}
                            placeholder="At least 6 characters"
                            autoComplete="new-password"
                            style={{ paddingRight: 44, width: '100%' }}
                            required
                          />
                          <button
                            type="button"
                            className="pw-toggle"
                            onClick={() => setShowNewPw(v => !v)}
                            tabIndex={-1}
                            aria-label={showNewPw ? 'Hide password' : 'Show password'}
                          >
                            {showNewPw ? <Icons.EyeOff size={16} color="var(--text-secondary)" /> : <Icons.Eye size={16} color="var(--text-secondary)" />}
                          </button>
                        </div>
                      </label>

                      <label>
                        Confirm New Password
                        <input
                          type={showNewPw ? 'text' : 'password'}
                          value={confirmPw}
                          onChange={e => setConfirmPw(e.target.value)}
                          placeholder="Repeat new password"
                          autoComplete="new-password"
                          required
                        />
                      </label>

                      {forgotErr && <div className="error">{forgotErr}</div>}
                    </div>
                    <div className="whatif-footer">
                      <button type="button" className="btn-ghost" onClick={() => setForgotStep(1)}>← Back</button>
                      <button
                        type="submit"
                        className="btn-primary"
                        disabled={resetCode.length !== 6 || newPw.length < 6 || forgotBusy}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        {forgotBusy ? 'Verifying…' : <><Icons.Lock size={15} /> Update Password</>}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
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
          <button className="close-btn" onClick={onClose} aria-label="Close"><Icons.Close size={18} /></button>
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
              <span className="whatif-icon">{result.feasible ? <Icons.CheckCircle size={22} color="var(--success)" /> : <Icons.AlertTriangle size={22} color="var(--danger)" />}</span>
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
          <button className="btn-primary" onClick={calculate} disabled={loading || !component} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {loading ? 'Calculating…' : <><Icons.Sliders size={15} /> Calculate</>}
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
  let standingIcon = <Icons.Check size={14} />
  let standingLabel = 'Good Standing'
  let standingClass = 'standing-good'
  if (gpa !== null) {
    if (gpa >= 3.5) {
      standingIcon = <Icons.Award size={14} />
      standingLabel = "Dean's List / Honors Standing"
      standingClass = 'standing-honors'
    } else if (gpa >= 2.0) {
      standingIcon = <Icons.Check size={14} />
      standingLabel = 'Good Standing'
      standingClass = 'standing-good'
    } else {
      standingIcon = <Icons.AlertTriangle size={14} />
      standingLabel = 'Academic Warning'
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
              <span className={`standing-badge ${standingClass}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {standingIcon}
                <span>{standingLabel}</span>
              </span>
            )}
          </div>
          <h1>Good {timeOfDay()}, {user.name.split(' ')[0]}</h1>
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
          icon={<Icons.Target size={20} color="var(--primary)" />}
          colorClass="metric-purple"
        />
        <Metric
          label="Attendance"
          value={`${data.attendance.value}%`}
          detail="Across eligible sessions"
          icon={<Icons.Calendar size={20} color="#2563EB" />}
          colorClass="metric-blue"
        />
        <Metric
          label="Completed Credits"
          value={data.credits}
          detail={`${data.courses.length} active courses`}
          icon={<Icons.Book size={20} color="var(--success)" />}
          colorClass="metric-green"
        />
        <Metric
          label="Active Alerts"
          value={data.alerts.length}
          detail={data.alerts.length ? 'Review recommended' : 'Nothing urgent'}
          icon={data.alerts.length ? <Icons.AlertTriangle size={20} color="var(--danger)" /> : <Icons.CheckCircle size={20} color="var(--success)" />}
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
              <button className="btn-whatif" onClick={() => setShowWhatIf(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icons.Sliders size={14} /> What-If</button>
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
              : <p className="empty" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icons.CheckCircle size={15} color="var(--success)" /> No active risk signals.</p>
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
              : <p className="empty" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icons.Award size={15} color="var(--primary)" /> No targeted recommendations for this period.</p>
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

  const exportGradesCSV = () => {
    if (!courses) return
    const headers = ['Course Name', 'Course Code', 'Credits', 'Weighted Score (%)', 'Status']
    const rows = courses.map(c => [
      `"${c.course}"`,
      `"${c.code}"`,
      c.credits,
      c.score !== null ? `${c.score}%` : 'N/A',
      `"${c.data_status}"`
    ])
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', 'Academic_Transcript_Spring_2026.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
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
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-ghost" onClick={exportGradesCSV} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icons.Download size={14} /> Export CSV
          </button>
          <button className="btn-whatif" onClick={() => setShowWhatIf(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icons.Sliders size={14} /> What-If Calculator
          </button>
        </div>
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
                  <td className="expand-chevron">{expanded === c.code ? <Icons.ChevronUp size={14} /> : <Icons.ChevronDown size={14} />}</td>
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
          <span className={`score-chip ${data.weighted_score >= 75 ? 'chip-good' : 'chip-warn'}`} style={{ alignSelf: 'flex-end', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {data.weighted_score >= 75 ? <><Icons.Check size={13} /> Passing</> : <><Icons.AlertTriangle size={13} /> Below threshold</>}
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
    s === 'present' ? <Icons.CheckCircle size={14} color="#22C55E" /> :
    s === 'excused' ? <Icons.Check size={14} color="#3B82F6" /> :
    <Icons.Close size={14} color="#EF4444" />

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
              <div className={`warning-strip ${item.remaining_unexcused <= 1 ? 'danger' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icons.AlertTriangle size={15} />
                <span>
                  {item.remaining_unexcused <= 0
                    ? 'Critical: Automatic course drop limit reached!'
                    : item.remaining_unexcused === 1
                      ? 'Critical: Only 1 absence remaining before automatic course drop'
                      : `Warning: ${item.remaining_unexcused} absences remaining before automatic course drop`
                  }
                </span>
              </div>
            )}

            {/* Session toggle */}
            <button className="session-toggle" onClick={() => toggleSessions(item.code)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {openSessions[item.code] ? (
                <><Icons.ChevronUp size={14} /> Hide sessions</>
              ) : (
                <><Icons.ChevronDown size={14} /> Show {item.sessions.length} sessions</>
              )}
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
    t === 'low_grade' ? <Icons.AlertTriangle size={16} /> :
    t === 'low_attendance' ? <Icons.Calendar size={16} /> :
    <Icons.Bell size={16} />

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
            : 'All caught up!'
          }</p>
        </div>
        {unreadCount > 0 && (
          <button className="btn-markall" onClick={markAll} disabled={marking} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {marking ? 'Marking…' : <><Icons.Check size={14} /> Mark all read</>}
          </button>
        )}
      </header>

      <div className="notif-list page-fade">
        {notifs.length === 0
          ? (
            <article className="panel">
              <p className="empty" style={{ padding: '40px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Icons.Bell size={18} color="var(--text-secondary)" /> No notifications yet.
              </p>
            </article>
          )
          : notifs.map(n => (
              <div
                key={n.id}
                className={`notif-item ${n.read ? 'notif-read' : 'notif-unread'}`}
                onClick={() => !n.read && markRead(n.id)}
                title={n.read ? '' : 'Click to mark as read'}
              >
                <div className={`notif-icon-circle ${typeIconClass(n.type)}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <Icons.Chart size={13} /> View Grade Breakdown
                    </button>
                    <a
                      className="notif-action-btn"
                      href={`mailto:teacher@univ.edu?subject=Regarding ${encodeURIComponent(n.course || 'Academic Alert')}`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <Icons.Mail size={13} /> Contact Instructor
                    </a>
                    <button
                      type="button"
                      className="notif-action-btn"
                      onClick={() => alert(`Academic Tutoring Center:\nDrop-in tutoring for ${n.course || 'your subjects'} is available Monday–Thursday 14:00–18:00 in Room 302.`)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <Icons.Book size={13} /> Book Tutoring
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
function AvatarMenu({ user, logout, token, onUpdateUser }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [nameVal, setNameVal] = useState(user?.name || '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setEditing(false) } }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const saveName = async e => {
    e?.preventDefault()
    if (!nameVal.trim() || !token) return
    setSaving(true)
    try {
      await api('/api/me/profile', token, {
        method: 'PUT',
        body: JSON.stringify({ name: nameVal.trim() })
      })
      if (onUpdateUser) onUpdateUser({ ...user, name: nameVal.trim() })
      setMsg('Saved!')
      setTimeout(() => {
        setEditing(false)
        setMsg('')
        setOpen(false)
      }, 800)
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

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
            <span>{user?.student_id ? `ID: ${user.student_id}` : (user?.email ?? user?.id ?? '')}</span>
          </div>

          {editing ? (
            <form onSubmit={saveName} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
              <label style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                Change Display Name:
              </label>
              <input
                type="text"
                value={nameVal}
                onChange={e => setNameVal(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', fontSize: '.84rem', borderRadius: 6, border: '1px solid var(--border)', marginBottom: 8 }}
                autoFocus
              />
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  style={{ background: 'none', border: 'none', fontSize: '.78rem', color: 'var(--text-muted)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !nameVal.trim()}
                  className="btn-primary"
                  style={{ padding: '4px 10px', fontSize: '.78rem' }}
                >
                  {saving ? 'Saving…' : (msg || 'Save')}
                </button>
              </div>
            </form>
          ) : (
            <button
              className="dropdown-item"
              onClick={() => { setEditing(true); setNameVal(user?.name || '') }}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <Icons.Edit size={14} /> Edit Name
            </button>
          )}

          <button
            className="dropdown-item danger"
            onClick={() => { setOpen(false); logout() }}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <Icons.SignOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

/* ─── STUDENT SHELL (tabs + nav) ─────────────────────────────────── */
function Student({ token, user, logout, onUpdateUser }) {
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
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Icons.Bell size={18} color="var(--text-secondary)" />
            {unread > 0 && <span className="bell-badge">{unread}</span>}
          </button>
          <AvatarMenu user={user} logout={logout} token={token} onUpdateUser={onUpdateUser} />
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

/* ─── TEACHER STUDENT DETAIL & INTERVENTION MODAL ────────────────── */
function TeacherStudentModal({ studentId, token, onClose }) {
  const [data, setData] = useState(null)
  const [interventions, setInterventions] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionType, setActionType] = useState('Consultation Request')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const loadData = useCallback(() => {
    Promise.all([
      api(`/api/teacher/students/${studentId}`, token),
      api(`/api/teacher/students/${studentId}/interventions`, token)
    ]).then(([d, inv]) => {
      setData(d)
      setInterventions(inv.items || [])
    }).catch(e => setErr(e.message))
    .finally(() => setLoading(false))
  }, [studentId, token])

  useEffect(() => { loadData() }, [loadData])

  const submitIntervention = async (e) => {
    e?.preventDefault()
    if (!notes.trim()) return
    setSubmitting(true); setErr(''); setMsg('')
    try {
      const res = await api(`/api/teacher/students/${studentId}/interventions`, token, {
        method: 'POST',
        body: JSON.stringify({ action_type: actionType, notes: notes.trim() })
      })
      setMsg(res.message || 'Advisory note recorded.')
      setNotes('')
      loadData()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="whatif-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="whatif-modal" style={{ maxWidth: 640 }}>
        <div className="whatif-header">
          <div>
            <span className="eyebrow">Academic Intervention & Profile</span>
            <h2>{data?.student?.name ?? 'Student Profile'}</h2>
            <small style={{ color: 'var(--text-secondary)' }}>ID: {studentId} · {data?.student?.cohort}</small>
          </div>
          <button type="button" className="close-btn" onClick={onClose}><Icons.Close size={18} /></button>
        </div>
        <div className="whatif-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {loading ? (
            <div className="loading" style={{ minHeight: 180 }}>
              <div className="loading-spinner" />
              Loading student details…
            </div>
          ) : data ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 16 }}>
                <div style={{ background: 'var(--paper)', padding: '12px 14px', borderRadius: 'var(--radius-sm)' }}>
                  <small style={{ color: 'var(--text-secondary)', display: 'block' }}>Attendance</small>
                  <strong style={{ fontSize: '1.25rem', color: data.attendance < 75 ? 'var(--danger)' : 'var(--success)' }}>
                    {data.attendance}%
                  </strong>
                </div>
                <div style={{ background: 'var(--paper)', padding: '12px 14px', borderRadius: 'var(--radius-sm)' }}>
                  <small style={{ color: 'var(--text-secondary)', display: 'block' }}>Risk Status</small>
                  <strong style={{ fontSize: '.9rem', color: data.risk_factors.length ? 'var(--danger)' : 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {data.risk_factors.length ? (
                      <><Icons.AlertTriangle size={15} /> {data.risk_factors.length} active risk signal(s)</>
                    ) : (
                      <><Icons.CheckCircle size={15} /> Good standing</>
                    )}
                  </strong>
                </div>
              </div>

              {data.risk_factors.length > 0 && (
                <div style={{ background: '#FFF1F2', border: '1px solid #FECDD3', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: 16 }}>
                  <b style={{ color: '#BE123C', fontSize: '.82rem', display: 'block', marginBottom: 4 }}>Active Risk Signals:</b>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: '.8rem', color: '#9F1239' }}>
                    {data.risk_factors.map((r, i) => (
                      <li key={i}>{r.detail} {r.courses?.length ? `(${r.courses.join(', ')})` : ''}</li>
                    ))}
                  </ul>
                </div>
              )}

              <h3 style={{ fontSize: '.95rem', margin: '14px 0 8px' }}>Enrolled Courses (Spring 2026)</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                {data.courses.map((c, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--paper)', padding: '8px 12px', borderRadius: 6, fontSize: '.82rem' }}>
                    <div>
                      <b>{c.course}</b> <span style={{ color: 'var(--text-muted)' }}>({c.code})</span>
                    </div>
                    <strong>{c.score !== null ? `${c.score}%` : 'In Progress'}</strong>
                  </div>
                ))}
              </div>

              <h3 style={{ fontSize: '.95rem', margin: '14px 0 8px' }}>Record Teacher Advisory / Intervention</h3>
              <form onSubmit={submitIntervention} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ fontSize: '.82rem' }}>
                  Action Type
                  <select value={actionType} onChange={e => setActionType(e.target.value)} style={{ width: '100%', marginTop: 4 }}>
                    <option value="Consultation Request">Academic Consultation Request</option>
                    <option value="Tutoring Referral">Tutoring Center Referral</option>
                    <option value="Attendance Warning">Formal Attendance Warning</option>
                    <option value="Commendation">Academic Commendation</option>
                  </select>
                </label>
                <label style={{ fontSize: '.82rem' }}>
                  Advisory Notes & Instructions
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Enter actionable guidance or notes for this student..."
                    style={{ width: '100%', padding: '8px 10px', fontSize: '.82rem', borderRadius: 6, border: '1px solid var(--border)', marginTop: 4, fontFamily: 'inherit' }}
                  />
                </label>
                {msg && <div style={{ background: 'var(--success-dim)', color: '#15803D', padding: '8px 12px', borderRadius: 6, fontSize: '.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><Icons.CheckCircle size={15} /> {msg}</div>}
                {err && <div className="error">{err}</div>}
                <button type="submit" className="btn-primary" disabled={!notes.trim() || submitting} style={{ alignSelf: 'flex-start', marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {submitting ? 'Sending…' : <><Icons.Send size={15} /> Send Advisory Note</>}
                </button>
              </form>

              {interventions.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <h4 style={{ fontSize: '.85rem', color: 'var(--text-secondary)', marginBottom: 8 }}>Past Advisory History ({interventions.length})</h4>
                  {interventions.map((inv, i) => (
                    <div className="intervention-item" key={i}>
                      <div className="intervention-head">
                        <span>{inv.action_type}</span>
                        <span>{new Date(inv.created_at).toLocaleDateString()}</span>
                      </div>
                      <p className="intervention-notes">{inv.notes}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
        <div className="whatif-footer">
          <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

/* ─── TEACHER VIEW ───────────────────────────────────────────────── */
function Teacher({ token, user, logout }) {
  const [students, setStudents]   = useState()
  const [analytics, setAnalytics] = useState()
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [filter, setFilter] = useState('all') // 'all' | 'risk' | 'good'
  const [search, setSearch] = useState('')

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

  const exportClassRosterCSV = () => {
    if (!students) return
    const headers = ['Student Name', 'Student ID', 'Cohort', 'Attendance (%)', 'Risk Count', 'Risk Signals']
    const rows = students.map(s => [
      `"${s.name}"`,
      `"${s.id}"`,
      `"${s.cohort}"`,
      `${s.attendance}%`,
      s.risk_factors.length,
      `"${s.risk_factors.map(r => r.detail).join('; ')}"`
    ])
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', 'Class_Watchlist_Roster.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const filteredStudents = students.filter(s => {
    if (filter === 'risk' && s.risk_factors.length === 0) return false
    if (filter === 'good' && s.risk_factors.length > 0) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || s.cohort.toLowerCase().includes(q)
    }
    return true
  })

  return (
    <>
      <header className="page-head page-fade">
        <div>
          <span className="eyebrow">Faculty Overview</span>
          <h1>Class Performance Monitor</h1>
          <p>Authorized cohort academic intelligence, explainable risk factors, and interventions.</p>
        </div>
        <button
          className="btn-ghost"
          onClick={exportClassRosterCSV}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Icons.Download size={14} /> Export Roster (CSV)
        </button>
      </header>

      <section className="metrics page-fade">
        <Metric
          label="Students in Scope"
          value={students.length}
          detail="Authorized cohort"
          icon={<Icons.User size={20} color="var(--primary)" />}
          colorClass="metric-purple"
        />
        <Metric
          label="At-Risk Students"
          value={atRisk.length}
          detail="Active risk signals"
          icon={<Icons.AlertTriangle size={20} color={atRisk.length ? "var(--danger)" : "var(--success)"} />}
          tone={atRisk.length ? 'warn' : ''}
          colorClass={atRisk.length ? 'metric-warn' : 'metric-green'}
        />
        <Metric
          label="Avg. Attendance"
          value={`${avgAtt}%`}
          detail="Across cohort in scope"
          icon={<Icons.Calendar size={20} color="#2563EB" />}
          colorClass="metric-blue"
        />
        <Metric
          label="Correlation"
          value={analytics.correlation}
          detail="Association, not causation"
          icon={<Icons.Chart size={20} color="var(--success)" />}
          colorClass="metric-green"
        />
      </section>

      <section className="grid page-fade">
        <article className="panel wide">
          <div className="panel-title">
            <div>
              <span className="eyebrow">Authorized Students</span>
              <h2>Risk watchlist</h2>
              <small style={{ color: 'var(--text-muted)' }}>Click any student row to view full details and record interventions.</small>
            </div>
          </div>

          <div className="teacher-toolbar">
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span style={{ position: 'absolute', left: 10, display: 'flex', alignItems: 'center', pointerEvents: 'none', color: 'var(--text-muted)' }}>
                <Icons.Search size={15} />
              </span>
              <input
                type="text"
                className="teacher-search-input"
                placeholder="Search by name or ID..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ paddingLeft: 32 }}
              />
            </div>
            <div className="teacher-filter-group">
              <button
                type="button"
                className={`teacher-filter-btn ${filter === 'all' ? 'active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All ({students.length})
              </button>
              <button
                type="button"
                className={`teacher-filter-btn ${filter === 'risk' ? 'active' : ''}`}
                onClick={() => setFilter('risk')}
              >
                At-Risk ({atRisk.length})
              </button>
              <button
                type="button"
                className={`teacher-filter-btn ${filter === 'good' ? 'active' : ''}`}
                onClick={() => setFilter('good')}
              >
                Good Standing ({students.length - atRisk.length})
              </button>
            </div>
          </div>

          <div className="student-table">
            <div className="thead">
              <span>Student</span>
              <span>Attendance</span>
              <span>Risk status</span>
            </div>
            {filteredStudents.length ? filteredStudents.map(s => (
              <div
                className="trow trow-clickable"
                key={s.id}
                onClick={() => setSelectedStudent(s.id)}
                title="Click to view details & interventions"
              >
                <div className="student-info">
                  <div className="student-avatar">{initials(s.name)}</div>
                  <div className="student-info-text">
                    <b>{s.name}</b>
                    <small>ID: {s.id} · {s.cohort}</small>
                  </div>
                </div>
                <strong style={{ color: s.attendance < 75 ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>
                  {s.attendance}%
                </strong>
                <span>
                  {s.risk_factors.length
                    ? s.risk_factors.map((r, i) => <em key={i}>{r.detail}</em>)
                    : <em className="good" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icons.Check size={13} /> No active signals</em>
                  }
                </span>
              </div>
            )) : (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                No students match your search filter.
              </div>
            )}
          </div>
        </article>

        <aside>
          <article className="panel">
            <span className="eyebrow">Attendance × Grade</span>
            <h2>Cohort relationship</h2>
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

      {selectedStudent && (
        <TeacherStudentModal
          studentId={selectedStudent}
          token={token}
          onClose={() => setSelectedStudent(null)}
        />
      )}
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

  const updateUser = updatedUser => {
    if (!session) return
    const newSession = { ...session, user: updatedUser }
    try { localStorage.setItem('session', JSON.stringify(newSession)) } catch {}
    setSession(newSession)
  }

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
            <AvatarMenu user={session.user} logout={logout} token={session.access_token} onUpdateUser={updateUser} />
          </div>
        </nav>
        <main className="content">
          <Teacher token={session.access_token} user={session.user} logout={logout} />
        </main>
      </div>
    )
  }

  return <Student token={session.access_token} user={session.user} logout={logout} onUpdateUser={updateUser} />
}

createRoot(document.getElementById('root')).render(<App />)
