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

const CANONICAL_SDU_CALLBACK = 'https://studymate-mu-smoky.vercel.app/auth/sdu/callback'

const getSduCallbackUri = () => {
  if (typeof window === 'undefined') return CANONICAL_SDU_CALLBACK
  const origin = window.location.origin
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1') {
    return `${origin}/auth/sdu/callback`
  }
  if (host.includes('onrender.com')) {
    return 'https://studymate-knap.onrender.com/auth/sdu/callback'
  }
  if (host === 'studymate.vercel.app') {
    return 'https://studymate.vercel.app/auth/sdu/callback'
  }
  if (host.includes('studymate-git-main')) {
    return 'https://studymate-git-main-meiirzhans-projects.vercel.app/auth/sdu/callback'
  }
  return CANONICAL_SDU_CALLBACK
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
  Refresh: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  ),
  ArrowRight: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  ),
  Sun: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  ),
  Moon: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
  Clock: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  TrendingUp: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  MapPin: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  Sparkles: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M12 3l1.912 5.885a2.5 2.5 0 0 0 1.583 1.583L21.38 12.38l-5.885 1.912a2.5 2.5 0 0 0-1.583 1.583L12 21.76l-1.912-5.885a2.5 2.5 0 0 0-1.583-1.583L2.62 12.38l5.885-1.912a2.5 2.5 0 0 0 1.583-1.583L12 3z" />
    </svg>
  ),
  Shield: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
}

/* ─── THEME HOOK & TOGGLE COMPONENT ──────────────────────────────── */
function useTheme() {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('sm_theme')
      if (stored) return stored
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('sm_theme', theme) } catch {}
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))
  }, [])

  return [theme, toggleTheme]
}

function ThemeToggle({ theme, toggleTheme }) {
  return (
    <button
      type="button"
      className="theme-toggle-btn"
      onClick={toggleTheme}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle dark/light theme"
    >
      {theme === 'dark' ? <Icons.Sun size={17} color="#FBBF24" /> : <Icons.Moon size={17} color="#6366F1" />}
    </button>
  )
}

/* ─── TIME & SCHEDULE SORTING HELPERS ────────────────────────────── */
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

function formatClassTime(times, start, end) {
  if (start && end) {
    const s = String(start).replace(/:\d{2}$/, '').trim()
    const e = String(end).replace(/:\d{2}$/, '').trim()
    return `${s} – ${e}`
  }
  if (times) {
    return String(times).replace(/(\d{1,2}:\d{2}):\d{2}/g, '$1').replace(/-/g, '–').trim()
  }
  return 'Time TBD'
}

const DAY_ORDER_MAP = {
  1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  'mon': 1, 'monday': 1,
  'tue': 2, 'tuesday': 2,
  'wed': 3, 'wednesday': 3,
  'thu': 4, 'thursday': 4,
  'fri': 5, 'friday': 5,
  'sat': 6, 'saturday': 6,
  'sun': 7, 'sunday': 7,
}

function getDayOrder(s) {
  if (s.day_of_week != null) return DAY_ORDER_MAP[s.day_of_week] || 9
  if (s.weekday) return DAY_ORDER_MAP[String(s.weekday).toLowerCase().trim()] || 9
  return 9
}

function getStartTimeMinutes(s) {
  const str = s.start_time || (s.times ? String(s.times).split(/[-–]/)[0]?.trim() : '')
  if (!str) return 9999
  const m = str.match(/(\d{1,2}):(\d{2})/)
  if (!m) return 9999
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

function sortSchedule(list = []) {
  return [...list].sort((a, b) => {
    const dayA = getDayOrder(a)
    const dayB = getDayOrder(b)
    if (dayA !== dayB) return dayA - dayB
    return getStartTimeMinutes(a) - getStartTimeMinutes(b)
  })
}

function findNextClass(schedule = []) {
  if (!schedule || !schedule.length) return null
  const sorted = sortSchedule(schedule)
  const now = new Date()
  const todayDay = now.getDay() === 0 ? 7 : now.getDay() // 1: Mon ... 7: Sun
  const currentMinutes = now.getHours() * 60 + now.getMinutes()

  // Find class today starting in future or ongoing
  const upcomingToday = sorted.find(c => {
    const day = getDayOrder(c)
    if (day !== todayDay) return false
    return getStartTimeMinutes(c) >= currentMinutes - 20
  })
  if (upcomingToday) return { course: upcomingToday, isToday: true }

  // Otherwise next class on subsequent days
  const futureDay = sorted.find(c => getDayOrder(c) > todayDay)
  if (futureDay) return { course: futureDay, isToday: false }

  // Wrap around to beginning of week
  return { course: sorted[0], isToday: false }
}

function GpaGauge({ gpa, maxGpa = 4.0 }) {
  const val = gpa != null ? Math.min(Math.max(Number(gpa), 0), maxGpa) : 0
  const pct = (val / maxGpa) * 100
  const radius = 30
  const stroke = 6
  const circ = 2 * Math.PI * radius
  const offset = circ - (pct / 100) * circ
  return (
    <svg width={72} height={72} viewBox="0 0 72 72" style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={36} cy={36} r={radius} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      <circle
        cx={36} cy={36} r={radius} fill="none"
        stroke="var(--primary)" strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)' }}
      />
    </svg>
  )
}

function getPasswordStrength(pw) {
  if (!pw) return { score: 0, label: 'Enter password', cls: '' }
  let score = 0
  if (pw.length >= 6) score++
  if (pw.length >= 8) score++
  if (/[A-Z]/.test(pw) && /[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++

  if (score <= 1) return { score: 1, label: 'Weak', cls: 'active-weak' }
  if (score === 2) return { score: 2, label: 'Fair', cls: 'active-medium' }
  if (score === 3) return { score: 3, label: 'Good', cls: 'active-good' }
  return { score: 4, label: 'Strong', cls: 'active-strong' }
}

/* ─── TODAY / NEXT CLASS HIGHLIGHT HERO CARD ─────────────────────── */
function NextClassHighlightCard({ nextInfo }) {
  if (!nextInfo?.course) return null
  const { course, isToday } = nextInfo
  const timeStr = formatClassTime(course.times, course.start_time, course.end_time)
  const dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const dayName = dayNames[getDayOrder(course)] || course.weekday || 'Upcoming'

  return (
    <div className="next-class-hero-card page-fade">
      <div>
        <div className="next-class-badge-pill">
          <Icons.Clock size={13} color="var(--primary)" />
          <span>{isToday ? 'Today · Next Class' : `${dayName} · Next Class`}</span>
        </div>
        <div className="next-class-title">{course.course_name}</div>
        <div className="next-class-meta-row">
          <span className="badge-chip"><code>{course.course_code}</code></span>
          <span className="badge-chip">{course.lesson_type || 'Lecture'} · Section {course.section || '1'}</span>
          <span className="badge-chip">
            <Icons.MapPin size={13} color="var(--primary)" />
            {course.building ? `${course.building}, ` : ''}{course.room ? `Room ${course.room}` : (course.is_online ? 'Online Zoom' : 'SDU Campus')}
          </span>
          {course.teacher && (
            <span className="badge-chip">
              <Icons.User size={13} color="var(--text-muted)" />
              {course.teacher}
            </span>
          )}
        </div>
      </div>
      <div className="next-class-time-block">
        <div className="time-countdown-val">{timeStr}</div>
        <div className="time-countdown-lbl">{course.is_online ? 'Online Zoom / Moodle' : 'In-Person Campus'}</div>
      </div>
    </div>
  )
}

/* ─── PERFORMANCE ANALYTICS MINI CHART ───────────────────────────── */
const CustomChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '10px 14px',
      boxShadow: 'var(--shadow-md)',
      fontSize: '.85rem'
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--text-primary)' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', gap: 14 }}>
          <span>{p.dataKey === 'grade' ? 'Course Grade:' : 'Attendance:'}</span>
          <b style={{ color: p.color }}>{p.value}%</b>
        </div>
      ))}
    </div>
  )
}

function DashboardPerformanceChart({ transcript = [], attendance = [] }) {
  if ((!transcript || !transcript.length) && (!attendance || !attendance.length)) return null

  const courseMap = {}
  ;(transcript || []).forEach(c => {
    if (c.course_code && (c.grade_percent != null || c.grade != null)) {
      const pct = c.grade_percent != null ? Number(c.grade_percent) : (typeof c.grade === 'number' ? c.grade : null)
      if (pct !== null && !isNaN(pct)) {
        courseMap[c.course_code] = {
          name: c.course_code,
          grade: pct,
          attendance: 100
        }
      }
    }
  })

  ;(attendance || []).forEach(a => {
    const code = a.lesson ? a.lesson.split(' ')[0] : null
    const abs = a.absence_percent != null ? Number(a.absence_percent) : 0
    const attPct = Math.max(0, 100 - abs)
    if (code && courseMap[code]) {
      courseMap[code].attendance = attPct
    } else if (code) {
      courseMap[code] = {
        name: code,
        grade: null,
        attendance: attPct
      }
    }
  })

  const chartData = Object.values(courseMap).slice(-6)
  if (!chartData.length) return null

  return (
    <article className="panel" style={{ marginTop: 24 }}>
      <div className="panel-title">
        <div>
          <span className="eyebrow">Academic Analytics</span>
          <h2>Course Grade & Attendance Performance</h2>
        </div>
        <div style={{ display: 'flex', gap: 14, fontSize: '.78rem', color: 'var(--text-secondary)', alignItems: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, background: 'var(--primary)', borderRadius: 2 }} /> Grade Score %
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, background: '#10B981', borderRadius: 2 }} /> Attendance %
          </span>
        </div>
      </div>
      <div style={{ width: '100%', height: 230 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.6} />
            <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} tickLine={false} />
            <YAxis domain={[0, 100]} stroke="var(--text-muted)" fontSize={12} tickLine={false} />
            <Tooltip content={<CustomChartTooltip />} />
            <Bar dataKey="grade" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={32} />
            <Bar dataKey="attendance" fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </article>
  )
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
const ProgressRing = ({ pct, size = 90, stroke = 8, color = '#6366F1' }) => {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (Math.min(Math.max(pct, 0), 100) / 100) * circ
  return (
    <svg className="progress-ring" width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="var(--border)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset .6s cubic-bezier(.4,0,.2,1)' }} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: size * .17, fontWeight: 800, fontFamily: 'Manrope, sans-serif', fill: 'var(--text-primary)' }}>
        {pct}%
      </text>
    </svg>
  )
}

/* ─── SHARED DESIGN SYSTEM COMPONENTS ────────────────────────────── */

function timeAgo(isoDate) {
  if (!isoDate) return ''
  try {
    const diff = Date.now() - new Date(isoDate).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins === 1) return '1 min ago'
    if (mins < 60) return `${mins} min ago`
    const hours = Math.floor(mins / 60)
    if (hours === 1) return '1 hour ago'
    if (hours < 24) return `${hours} hours ago`
    const days = Math.floor(hours / 24)
    if (days === 1) return 'yesterday'
    if (days < 7) return `${days} days ago`
    return new Date(isoDate).toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

function PageHeader({ badge, title, subtitle, lastFetched, actions, className = '' }) {
  return (
    <header className={`page-head page-fade ${className}`}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          {badge && <span className="sdu-badge">{badge}</span>}
          {lastFetched && (
            <span style={{ fontSize: '.76rem', color: '#10B981', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span className="sdu-dot pulse-dot" /> Live • Synced {new Date(lastFetched).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <h1 style={{ margin: '0 0 6px 0' }}>{title}</h1>
        {subtitle && <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '.92rem' }}>{subtitle}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  )
}

function StatCard({ label, value, valueSuffix, subtext, icon, pillColor = 'pill-purple', badge, children, valueColor, className = '' }) {
  return (
    <article className={`stat-card-custom ${className}`}>
      <div>
        <div className="stat-card-head">
          <span className="stat-card-label">{label}</span>
          <div className={`stat-card-icon-pill ${pillColor}`}>
            {icon}
          </div>
        </div>
        <div className="stat-card-value" style={valueColor ? { color: valueColor } : undefined}>
          {value ?? '—'}
          {valueSuffix && <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontWeight: 600 }}> {valueSuffix}</span>}
        </div>
        {subtext && <div className="stat-card-subtext">{subtext}</div>}
      </div>
      {(children || badge) && (
        <div style={{ marginTop: 14 }}>
          {badge}
          {children}
        </div>
      )}
    </article>
  )
}

function SearchInput({ value, onChange, placeholder = "Search...", onClear, className = "" }) {
  return (
    <div className={`search-input-wrap ${className}`}>
      <span className="search-icon">
        <Icons.Search size={16} />
      </span>
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value && (
        <button
          type="button"
          className="search-clear-btn"
          onClick={onClear || (() => onChange({ target: { value: '' } }))}
          aria-label="Clear search"
        >
          <Icons.Close size={14} />
        </button>
      )}
    </div>
  )
}

function FilterChips({ options = [], value, onChange }) {
  return (
    <div className="filter-chips-group" role="tablist">
      {options.map(opt => (
        <button
          key={opt.id}
          type="button"
          role="tab"
          aria-selected={value === opt.id}
          className={`filter-chip-btn ${value === opt.id ? 'active' : ''}`}
          onClick={() => onChange(opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function NotificationsDropdown({ token, unread, onUnreadChange, onSelectTab }) {
  const [isOpen, setIsOpen] = useState(false)
  const [notifs, setNotifs] = useState(null)
  const [loading, setLoading] = useState(false)
  const wrapperRef = useRef(null)

  const loadNotifs = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const data = await api('/api/student/notifications', token)
      setNotifs(data.items || [])
      if (typeof data.unread_count === 'number') {
        onUnreadChange(data.unread_count)
      }
    } catch (e) {
      console.warn('Notifications fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [token, onUnreadChange])

  useEffect(() => {
    if (isOpen) {
      loadNotifs()
    }
  }, [isOpen, loadNotifs])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = e => {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }

    const handleClickOutside = e => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const markRead = async (id, e) => {
    if (e) e.stopPropagation()
    try {
      await api(`/api/student/notifications/${id}/read`, token, { method: 'POST' })
      setNotifs(prev => (prev || []).map(n => n.id === id ? { ...n, read: true } : n))
      onUnreadChange(prev => Math.max(0, prev - 1))
    } catch (err) {
      console.warn('Mark read error:', err)
    }
  }

  const markAllRead = async () => {
    if (!notifs) return
    const unreadItems = notifs.filter(n => !n.read)
    if (!unreadItems.length) return
    try {
      await Promise.all(unreadItems.map(n => api(`/api/student/notifications/${n.id}/read`, token, { method: 'POST' })))
      setNotifs(prev => (prev || []).map(n => ({ ...n, read: true })))
      onUnreadChange(0)
    } catch (err) {
      console.warn('Mark all read error:', err)
    }
  }

  const getNotifIconInfo = type => {
    switch (type) {
      case 'low_grade':
        return {
          icon: <Icons.AlertTriangle size={16} />,
          pill: 'pill-amber',
        }
      case 'low_attendance':
        return {
          icon: <Icons.Calendar size={16} />,
          pill: 'pill-danger',
        }
      case 'critical':
      case 'danger':
        return {
          icon: <Icons.AlertTriangle size={16} />,
          pill: 'pill-danger',
        }
      case 'success':
        return {
          icon: <Icons.CheckCircle size={16} />,
          pill: 'pill-emerald',
        }
      case 'info':
      default:
        return {
          icon: <Icons.Bell size={16} />,
          pill: 'pill-purple',
        }
    }
  }

  return (
    <div className="notif-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className="notification-bell"
        onClick={() => setIsOpen(prev => !prev)}
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <Icons.Bell size={18} color="var(--text-secondary)" />
        {unread > 0 && <span className="bell-badge">{unread}</span>}
      </button>

      {isOpen && (
        <div className="notif-dropdown-panel page-fade" role="dialog" aria-label="Notifications panel">
          <div className="notif-panel-header">
            <h3>
              <span>Notifications</span>
              {unread > 0 && <span className="notif-unread-count-pill">{unread}</span>}
            </h3>
            {unread > 0 && (
              <button type="button" className="btn-mark-all-text" onClick={markAllRead}>
                Mark all as read
              </button>
            )}
          </div>

          <div className="notif-panel-body" aria-live="polite">
            {loading && !notifs ? (
              <div style={{ padding: '30px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <div className="sdu-spinner" style={{ margin: '0 auto 8px auto', width: 22, height: 22 }} />
                <span style={{ fontSize: '.84rem' }}>Loading notifications…</span>
              </div>
            ) : !notifs || notifs.length === 0 ? (
              <div className="notif-empty-state">
                <Icons.CheckCircle size={32} color="var(--success)" />
                <h4>You're all caught up!</h4>
                <p>No new academic alerts or notifications.</p>
              </div>
            ) : (
              notifs.map(n => {
                const { icon, pill } = getNotifIconInfo(n.type)
                return (
                  <div
                    key={n.id}
                    className={`notif-item-v2 ${n.read ? '' : 'unread'}`}
                    onClick={() => {
                      if (!n.read) markRead(n.id)
                      setIsOpen(false)
                      if (onSelectTab) onSelectTab('alerts')
                    }}
                  >
                    <div className={`notif-item-icon ${pill}`}>
                      {icon}
                    </div>

                    <div className="notif-item-content">
                      <div className="notif-item-title" title={n.title}>
                        {n.title}
                      </div>
                      <div className="notif-item-msg" title={n.detail}>
                        {n.detail}
                      </div>
                      <div className="notif-item-time">
                        {timeAgo(n.created_at)}
                      </div>
                    </div>

                    <div className="notif-item-right">
                      {!n.read && <span className="notif-unread-dot" title="Unread" />}
                      {!n.read && (
                        <button
                          type="button"
                          className="notif-mark-btn"
                          title="Mark as read"
                          aria-label="Mark as read"
                          onClick={e => markRead(n.id, e)}
                        >
                          <Icons.Check size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="notif-panel-footer">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false)
                if (onSelectTab) onSelectTab('alerts')
              }}
            >
              View all notifications →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Stat Metric Card (Legacy fallback modernized) ──────────────── */
const Metric = ({ label, value, detail, icon, tone = '', colorClass = 'metric-purple' }) => {
  const pillMap = {
    'metric-purple': 'pill-purple',
    'metric-green': 'pill-emerald',
    'metric-blue': 'pill-blue',
    'metric-warn': 'pill-amber',
    'metric-danger': 'pill-danger',
  }
  const pill = pillMap[colorClass] || 'pill-purple'
  return (
    <article className={`stat-card-custom metric ${tone}`}>
      <div>
        <div className="stat-card-head">
          <span className="stat-card-label">{label}</span>
          <div className={`stat-card-icon-pill ${pill}`}>
            {icon}
          </div>
        </div>
        <div className="stat-card-value">{value ?? '—'}</div>
        {detail && <div className="stat-card-subtext">{detail}</div>}
      </div>
    </article>
  )
}

/* ─── REDESIGNED SIGN IN & CREATE ACCOUNT SCREEN ─────────────────── */
function Login({ onLogin, theme, toggleTheme }) {
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

  // Password strength
  const pwStrength = getPasswordStrength(regPw)

  // Forgot password / 6-digit code modal state
  const [showForgot, setShowForgot] = useState(false)
  const [forgotStep, setForgotStep] = useState(1)
  const [forgotEmail, setForgotEmail] = useState('')
  const [resetCode, setResetCode]   = useState('')
  const [newPw, setNewPw]           = useState('')
  const [confirmPw, setConfirmPw]   = useState('')
  const [showNewPw, setShowNewPw]   = useState(false)
  const [forgotMsg, setForgotMsg]   = useState('')
  const [forgotErr, setForgotErr]   = useState('')
  const [forgotBusy, setForgotBusy] = useState(false)
  const [sduBusy, setSduBusy]       = useState(false)

  const handleConnectSdu = async () => {
    setSduBusy(true)
    setError('')
    try {
      const callbackUri = getSduCallbackUri()
      const res = await api('/api/sdu/authorize-url', null, {
        method: 'POST',
        body: JSON.stringify({ redirect_uri: callbackUri })
      })
      if (res && res.url) {
        window.location.href = res.url
      } else {
        throw new Error('Failed to obtain authorization URL')
      }
    } catch (err) {
      setError(err.message || 'Failed to initiate SDU authorization')
      setSduBusy(false)
    }
  }

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
    setNewPw('')
    setConfirmPw('')
    setForgotMsg('')
    setForgotErr('')
  }

  return (
    <main className="login-page">
      {/* Left Brand & Feature Hero Panel */}
      <section className="login-copy">
        <div>
          <div className="login-eyebrow">
            <span className="login-eyebrow-dot" />
            <span>SDU Student Portal · v2.4</span>
          </div>

          <div className="login-hero-header">
            <h1>Academic Intelligence,<br /><span>Engineered for Excellence.</span></h1>
            <p>
              Direct live synchronization with official SDU university portals. Experience real-time grades, schedule timetable, proactive absence alerts, and GPA analytics in one refined workspace.
            </p>
          </div>

          <div className="hero-features-grid">
            <div className="hero-feature-card">
              <div className="hero-feature-icon"><Icons.Chart size={20} /></div>
              <h3>Live Grade Breakdown</h3>
              <p>Real-time syllabus assessment scores and official letter grades.</p>
            </div>
            <div className="hero-feature-card">
              <div className="hero-feature-icon"><Icons.Shield size={20} /></div>
              <h3>Smart Absence Alerts</h3>
              <p>Continuous monitoring to prevent exceeding SDU drop thresholds.</p>
            </div>
            <div className="hero-feature-card">
              <div className="hero-feature-icon"><Icons.Calendar size={20} /></div>
              <h3>Weekly Timetable</h3>
              <p>Campus room numbers, instructors, and instant next-class preview.</p>
            </div>
            <div className="hero-feature-card">
              <div className="hero-feature-icon"><Icons.Sliders size={20} /></div>
              <h3>What-If Simulator</h3>
              <p>Calculate exact final exam scores needed to reach your target GPA.</p>
            </div>
          </div>
        </div>

        <div className="hero-footer-note">
          <Icons.Sparkles size={15} color="#A78BFA" />
          <span>Powered by <code>SDU OAuth 2.0 PKCE</code> integration</span>
        </div>
      </section>

      {/* Right Form Panel */}
      <div className="login-right">
        <div className="login-card">
          <div className="login-card-topbar">
            <div className="login-brand-badge">
              <div className="login-brand-icon">S</div>
              <div className="login-brand-title">
                StudyMate
                <small>SDU Performance Monitor</small>
              </div>
            </div>
            {toggleTheme && <ThemeToggle theme={theme} toggleTheme={toggleTheme} />}
          </div>

          {/* SDU Platform OAuth Hero Button (Primary Action) */}
          <button
            type="button"
            className="sdu-primary-hero-btn"
            disabled={sduBusy || busy}
            onClick={handleConnectSdu}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="sdu-badge" style={{ background: '#fff', color: '#0B4F6C', fontWeight: 900 }}>SDU</span>
              <span>{sduBusy ? 'Connecting to SDU Platform…' : 'Connect with SDU Platform'}</span>
            </div>
            <Icons.ArrowRight size={18} color="#ffffff" />
          </button>

          <div className="login-divider">
            <span>or continue with credentials</span>
          </div>

          {/* Segmented Auth Mode Switcher */}
          <div className="segmented-control">
            <button
              type="button"
              className={`segmented-btn ${authMode === 'login' ? 'active' : ''}`}
              onClick={() => { setAuthMode('login'); setError('') }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`segmented-btn ${authMode === 'register' ? 'active' : ''}`}
              onClick={() => { setAuthMode('register'); setError('') }}
            >
              Create Account
            </button>
          </div>

          {authMode === 'login' ? (
            <form onSubmit={submit} className="login-form">
              <div className="login-header-text">
                <h2>Welcome back</h2>
                <p>Sign in with your university account or email.</p>
              </div>

              <div className="field-group">
                <label className="field-label" htmlFor="identifier">University Email or Student ID</label>
                <div className="input-container">
                  <div className="input-icon-left"><Icons.User size={16} /></div>
                  <input
                    id="identifier"
                    className="input-field"
                    value={identifier}
                    onChange={e => setIdentifier(e.target.value)}
                    placeholder="e.g. 240103118 or student@univ.edu"
                    autoComplete="username"
                    required
                  />
                </div>
              </div>

              <div className="field-group">
                <div className="field-label">
                  <label htmlFor="password">Password</label>
                  <button type="button" className="field-label-link" onClick={openForgot}>
                    Forgot password?
                  </button>
                </div>
                <div className="input-container">
                  <div className="input-icon-left"><Icons.Lock size={16} /></div>
                  <input
                    id="password"
                    className="input-field"
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
                    className="input-btn-right"
                    onClick={() => setShowPw(v => !v)}
                    tabIndex={-1}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                  >
                    {showPw ? <Icons.EyeOff size={16} /> : <Icons.Eye size={16} />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="alert-box alert-danger">
                  <Icons.AlertTriangle size={16} />
                  <span>{error}</span>
                </div>
              )}

              <button className="btn-submit-primary" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in →'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="login-form">
              <div className="login-header-text">
                <h2>Create Account</h2>
                <p>Register with your university student profile.</p>
              </div>

              <div className="field-group">
                <label className="field-label" htmlFor="regName">Full Name</label>
                <div className="input-container">
                  <div className="input-icon-left"><Icons.User size={16} /></div>
                  <input
                    id="regName"
                    className="input-field"
                    value={regName}
                    onChange={e => setRegName(e.target.value)}
                    placeholder="e.g. Meirzhan"
                    autoComplete="name"
                    required
                  />
                </div>
              </div>

              <div className="field-group">
                <label className="field-label" htmlFor="regId">Student ID</label>
                <div className="input-container">
                  <div className="input-icon-left"><Icons.Award size={16} /></div>
                  <input
                    id="regId"
                    className="input-field"
                    value={regId}
                    onChange={e => setRegId(e.target.value)}
                    placeholder="e.g. 240103118"
                    autoComplete="username"
                    required
                  />
                </div>
              </div>

              <div className="field-group">
                <label className="field-label" htmlFor="regEmail">Email Address (for password recovery)</label>
                <div className="input-container">
                  <div className="input-icon-left"><Icons.Mail size={16} /></div>
                  <input
                    id="regEmail"
                    className="input-field"
                    type="email"
                    value={regEmail}
                    onChange={e => setRegEmail(e.target.value)}
                    placeholder="e.g. user@gmail.com"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="field-group">
                <label className="field-label" htmlFor="regPw">Password</label>
                <div className="input-container">
                  <div className="input-icon-left"><Icons.Lock size={16} /></div>
                  <input
                    id="regPw"
                    className="input-field"
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
                    className="input-btn-right"
                    onClick={() => setShowPw(v => !v)}
                    tabIndex={-1}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                  >
                    {showPw ? <Icons.EyeOff size={16} /> : <Icons.Eye size={16} />}
                  </button>
                </div>
                {regPw && (
                  <div>
                    <div className="pw-strength-bar">
                      {[1, 2, 3, 4].map(step => (
                        <div
                          key={step}
                          className={`pw-strength-step ${pwStrength.score >= step ? pwStrength.cls : ''}`}
                        />
                      ))}
                    </div>
                    <div className="pw-strength-hint">
                      <span>Strength: <b>{pwStrength.label}</b></span>
                      <span>Min. 6 chars</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="field-group">
                <label className="field-label">Account Role</label>
                <div className="role-segmented-group">
                  <button
                    type="button"
                    className={`role-select-card ${regRole === 'student' ? 'active' : ''}`}
                    onClick={() => setRegRole('student')}
                  >
                    <Icons.User size={15} /> Student
                  </button>
                  <button
                    type="button"
                    className={`role-select-card ${regRole === 'teacher' ? 'active' : ''}`}
                    onClick={() => setRegRole('teacher')}
                  >
                    <Icons.GraduationCap size={15} /> Teacher
                  </button>
                </div>
              </div>

              {error && (
                <div className="alert-box alert-danger">
                  <Icons.AlertTriangle size={16} />
                  <span>{error}</span>
                </div>
              )}

              <button className="btn-submit-primary" disabled={busy}>
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
                      {forgotErr && <div className="alert-box alert-danger">{forgotErr}</div>}
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
                        <div className="alert-box alert-success">
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
                            className="input-btn-right"
                            onClick={() => setShowNewPw(v => !v)}
                            tabIndex={-1}
                            aria-label={showNewPw ? 'Hide password' : 'Show password'}
                          >
                            {showNewPw ? <Icons.EyeOff size={16} /> : <Icons.Eye size={16} />}
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

                      {forgotErr && <div className="alert-box alert-danger">{forgotErr}</div>}
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

/* ─── SDU DATA CALCULATORS & HELPERS ──────────────────────────────── */
function calcGPA(transcript) {
  if (!transcript || !transcript.length) return null
  const graded = transcript.filter(c => c.grade_point != null && !isNaN(Number(c.grade_point)) && (c.credits || c.ects))
  if (!graded.length) return null
  const totalCredits = graded.reduce((sum, c) => sum + Number(c.credits || c.ects || 3), 0)
  const totalPoints = graded.reduce((sum, c) => sum + (Number(c.grade_point) * Number(c.credits || c.ects || 3)), 0)
  const res = totalCredits > 0 ? (totalPoints / totalCredits) : null
  return (res != null && !isNaN(res)) ? res : null
}

function calcOverallAttendance(attendanceList) {
  if (!attendanceList || !attendanceList.length) return 100.0
  const valid = attendanceList.filter(a => a.absence_percent != null && !isNaN(Number(a.absence_percent)))
  if (!valid.length) return 100.0
  const avgAbsence = valid.reduce((sum, a) => sum + Number(a.absence_percent), 0) / valid.length
  return Math.max(0, Math.min(100, Math.round((100 - avgAbsence) * 10) / 10))
}

function calcCompletedCredits(transcript) {
  if (!transcript || !transcript.length) return 0
  return transcript
    .filter(c => c.passed === true)
    .reduce((sum, c) => sum + Number(c.credits || c.ects || 0), 0)
}

function getGradePillClass(letter) {
  if (!letter) return 'grade-pill-neutral'
  const l = String(letter).toUpperCase().trim()
  if (l.startsWith('A')) return 'grade-pill-a'
  if (l.startsWith('B')) return 'grade-pill-b'
  if (l.startsWith('C')) return 'grade-pill-c'
  if (l.startsWith('D')) return 'grade-pill-d'
  if (l.startsWith('F')) return 'grade-pill-f'
  return 'grade-pill-neutral'
}

/* ─── SDU ONBOARDING / DISCONNECTED CARD ──────────────────────────── */
function SduOnboardCard({ onConnect }) {
  return (
    <div className="sdu-onboard-card page-fade">
      <div className="sdu-onboard-icon">
        <Icons.GraduationCap size={36} />
      </div>
      <div className="sdu-badge" style={{ margin: '0 auto 12px auto', display: 'inline-block' }}>SDU PLATFORM</div>
      <h2>Connect Your SDU Student Account</h2>
      <p>
        Link your official university portal account to view your real live class schedule, curriculum grades, academic transcript, and absence tracking.
      </p>

      <div className="sdu-features-grid">
        <div className="sdu-feature-box">
          <div style={{ color: 'var(--primary)', marginBottom: 8 }}><Icons.Calendar size={20} /></div>
          <b>Live Schedule</b>
          <span>Room numbers, buildings, instructors, and weekly timetable.</span>
        </div>
        <div className="sdu-feature-box">
          <div style={{ color: '#10B981', marginBottom: 8 }}><Icons.Award size={20} /></div>
          <b>Official Transcript</b>
          <span>ECTS credits, GPA, letter grades, and passed course records.</span>
        </div>
        <div className="sdu-feature-box">
          <div style={{ color: '#2563EB', marginBottom: 8 }}><Icons.Chart size={20} /></div>
          <b>Real Attendance</b>
          <span>Official course absence rates and drop limit monitoring.</span>
        </div>
      </div>

      <button
        type="button"
        className="sdu-connect-btn"
        onClick={onConnect}
        style={{ margin: '0 auto', maxWidth: 360, padding: '14px 24px', fontSize: '.95rem' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="sdu-badge">SDU</span>
          <span>Connect with SDU Platform</span>
        </div>
        <Icons.ArrowRight size={18} color="#ffffff" />
      </button>

      <div style={{ marginTop: 20, fontSize: '.78rem', color: 'var(--text-muted)' }}>
        Direct SDU Platform OAuth 2.0 PKCE. Your password is entered only on SDU and never seen or stored by StudyMate.
      </div>
    </div>
  )
}

/* ─── LIVE DASHBOARD TAB ─────────────────────────────────────────── */
function DashboardTab({ sduData, sduLoading, sduStatus, onConnect, onRefresh, user, setTab }) {
  if (!sduStatus?.connected) {
    return <SduOnboardCard onConnect={onConnect} />
  }

  if (sduLoading && !sduData.transcript && !sduData.schedule) {
    return <SkeletonDashboard />
  }

  const gpa = calcGPA(sduData.transcript)
  const attendance = calcOverallAttendance(sduData.attendance)
  const credits = calcCompletedCredits(sduData.transcript)
  const schedule = sduData.schedule || []
  const sortedSched = sortSchedule(schedule)
  const nextInfo = findNextClass(schedule)
  const activeCourses = schedule.length

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

  // Attendance health state
  let attClass = 'state-safe'
  let attLabel = 'Safe Status (≥90%)'
  if (attendance < 75) {
    attClass = 'state-danger'
    attLabel = 'Critical (<75% Drop Risk)'
  } else if (attendance < 90) {
    attClass = 'state-caution'
    attLabel = 'Caution (75–89%)'
  }

  // Credits progress (standard 240 ECTS bachelor)
  const totalTargetCredits = 240
  const creditsPct = Math.min(100, Math.round(((credits || 0) / totalTargetCredits) * 100))

  const schedulePreview = sortedSched.slice(0, 4)
  const transcriptPreview = (sduData.transcript || []).slice(-5).reverse()

  return (
    <div className="page-fade">
      {/* Hero Header */}
      <header className="dashboard-hero-head">
        <div>
          <div className="dash-eyebrow-row">
            <span className={`standing-badge ${standingClass}`}>
              {standingIcon}
              <span>{standingLabel}</span>
            </span>
            <span className="sdu-badge">SDU LIVE PORTAL</span>
            {sduData.lastFetched && (
              <span style={{ fontSize: '.76rem', color: '#10B981', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span className="sdu-dot pulse-dot" /> Live • Synced {new Date(sduData.lastFetched).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <h1>Good {timeOfDay()}, {sduData.profile?.fullname || user.name.split(' ')[0]}</h1>
          <p>
            SDU Student ID: <b>{sduData.profile?.student_id || user.student_id || '—'}</b> · {sduData.profile?.email || user.email || 'University Student'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            type="button"
            className="btn-ghost"
            onClick={onRefresh}
            disabled={sduLoading}
          >
            <Icons.Refresh size={14} className={sduLoading ? "spinning" : ""} />
            {sduLoading ? 'Syncing SDU…' : 'Refresh Portal'}
          </button>
        </div>
      </header>

      {/* 4 Distinct Stat Cards */}
      <section className="metrics-grid-redesigned">
        {/* Card 1: Cumulative GPA */}
        <article className="stat-card-custom">
          <div>
            <div className="stat-card-head">
              <span className="stat-card-label">Cumulative GPA</span>
              <div className="stat-card-icon-pill pill-purple">
                <Icons.Target size={18} />
              </div>
            </div>
            <div className="gpa-gauge-row">
              <div>
                <div className="stat-card-value">
                  {gpa != null ? gpa.toFixed(2) : '—'}
                  <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontWeight: 600 }}> / 4.00</span>
                </div>
                <div className="stat-card-subtext">SDU 4.00 Grade Scale</div>
              </div>
              <GpaGauge gpa={gpa} maxGpa={4.0} />
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <span className="gpa-trend-pill trend-positive">
              <Icons.TrendingUp size={13} />
              <span>{gpa >= 3.5 ? 'Dean’s List Eligible' : (gpa >= 2.0 ? 'Satisfactory Progress' : 'Academic Alert')}</span>
            </span>
          </div>
        </article>

        {/* Card 2: Overall Attendance */}
        <article className="stat-card-custom">
          <div>
            <div className="stat-card-head">
              <span className="stat-card-label">Overall Attendance</span>
              <div className={`stat-card-icon-pill ${attendance >= 90 ? 'pill-emerald' : 'pill-amber'}`}>
                <Icons.Calendar size={18} />
              </div>
            </div>
            <div className="stat-card-value" style={{ color: attendance >= 90 ? 'var(--success)' : (attendance >= 75 ? 'var(--warning)' : 'var(--danger)') }}>
              {attendance}%
            </div>
            <div className="stat-card-subtext">Computed from SDU live absence records</div>
          </div>
          <div className="att-health-row">
            <span className={`att-badge-state ${attClass}`}>
              {attLabel}
            </span>
            <span style={{ fontSize: '.76rem', color: 'var(--text-muted)' }}>Limit: 20% absence</span>
          </div>
        </article>

        {/* Card 3: Completed Credits */}
        <article className="stat-card-custom">
          <div>
            <div className="stat-card-head">
              <span className="stat-card-label">Degree Progress</span>
              <div className="stat-card-icon-pill pill-blue">
                <Icons.Book size={18} />
              </div>
            </div>
            <div className="stat-card-value">
              {credits} <span style={{ fontSize: '1.1rem', color: 'var(--text-muted)', fontWeight: 600 }}>ECTS</span>
            </div>
            <div className="stat-card-subtext">{credits} / {totalTargetCredits} ECTS required ({creditsPct}%)</div>
          </div>
          <div className="credits-bar-track">
            <div className="credits-bar-fill" style={{ width: `${creditsPct}%` }} />
          </div>
        </article>

        {/* Card 4: Scheduled Courses */}
        <article className="stat-card-custom">
          <div>
            <div className="stat-card-head">
              <span className="stat-card-label">Enrolled Classes</span>
              <div className="stat-card-icon-pill pill-purple">
                <Icons.Award size={18} />
              </div>
            </div>
            <div className="stat-card-value">
              {activeCourses} <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Courses</span>
            </div>
            <div className="stat-card-subtext">Active semester curriculum slots</div>
          </div>
          {nextInfo?.course ? (
            <div className="next-class-hint-pill">
              <Icons.Clock size={13} color="var(--primary)" />
              <span>Next: <b>{nextInfo.course.course_code}</b> · {formatClassTime(nextInfo.course.times, nextInfo.course.start_time, nextInfo.course.end_time)}</span>
            </div>
          ) : (
            <div className="next-class-hint-pill">
              <Icons.CheckCircle size={13} color="var(--success)" />
              <span>No remaining classes today</span>
            </div>
          )}
        </article>
      </section>

      {/* Today / Next Class Highlight Card */}
      {nextInfo?.course && <NextClassHighlightCard nextInfo={nextInfo} />}

      {/* Main Grid: Active Schedule Preview + Right Sidebars */}
      <section className="grid">
        <article className="panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow">Academic Timetable</span>
              <h2>Active Class Schedule</h2>
            </div>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setTab('schedule')}
              style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--primary)' }}
            >
              Full Schedule →
            </button>
          </div>

          {!schedulePreview || schedulePreview.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-muted)' }}>
              <Icons.Calendar size={36} color="var(--text-muted)" style={{ marginBottom: 10 }} />
              <p style={{ margin: 0, fontSize: '.9rem' }}>No active schedule records returned from SDU for this term.</p>
            </div>
          ) : (
            <div className="schedule-list-v2">
              {schedulePreview.map((s, idx) => {
                const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
                const dayStr = dayNames[getDayOrder(s)] || s.weekday || 'Weekday'
                const timeFormatted = formatClassTime(s.times, s.start_time, s.end_time)
                const isNext = nextInfo?.course && nextInfo.course.course_code === s.course_code && nextInfo.course.times === s.times

                return (
                  <div key={idx} className={`schedule-card-v2 ${isNext ? 'current-class' : ''}`}>
                    <div className="time-slot-box">
                      <span className="time-slot-day">{dayStr}</span>
                      <span className="time-slot-hours">
                        <Icons.Clock size={13} color="var(--primary)" />
                        {timeFormatted}
                      </span>
                    </div>
                    <div className="course-info-box">
                      <h3>{s.course_name}</h3>
                      <div className="course-chips-row">
                        <span className="badge-chip"><code>{s.course_code}</code></span>
                        <span className="badge-chip">{s.lesson_type || 'Lecture'} · Sec {s.section || '1'}</span>
                        <span className="badge-chip">
                          <Icons.MapPin size={12} color="var(--primary)" />
                          {s.building ? `${s.building} ` : ''}{s.room ? `Room ${s.room}` : (s.is_online ? 'Online' : 'SDU Campus')}
                        </span>
                        {s.teacher && (
                          <span className="badge-chip">
                            <Icons.User size={12} color="var(--text-muted)" />
                            {s.teacher}
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <span className="status-badge badge-ok">
                        Enrolled
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </article>

        <aside>
          <article className="panel">
            <span className="eyebrow">Academic Record</span>
            <h2>Recent Curriculum Grades</h2>
            {!transcriptPreview || transcriptPreview.length === 0 ? (
              <p className="empty">No recent grades available in transcript.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                {transcriptPreview.map((c, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--surface-subtle)', borderRadius: 10 }}>
                    <div style={{ overflow: 'hidden', paddingRight: 8 }}>
                      <b style={{ fontSize: '.86rem', display: 'block', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}>{c.course_name}</b>
                      <small style={{ color: 'var(--text-muted)' }}>{c.course_code} · {c.credits || c.ects || 3} ECTS</small>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {c.letter_grade && <span className={`grade-pill ${getGradePillClass(c.letter_grade)}`}>{c.letter_grade}</span>}
                      <span style={{ fontSize: '.84rem', fontWeight: 700 }}>
                        {c.grade_percent != null ? `${c.grade_percent}%` : (c.grade != null ? (typeof c.grade === 'number' ? `${c.grade}%` : c.grade) : (c.passed ? 'Pass' : '—'))}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setTab('transcript')}
              style={{ width: '100%', marginTop: 16, fontSize: '.84rem', fontWeight: 600, color: 'var(--primary)', justifyContent: 'center' }}
            >
              View Full Transcript →
            </button>
          </article>

          <article className="panel">
            <span className="eyebrow">SDU Attendance Policy</span>
            <h2>Absence Thresholds</h2>
            <p style={{ fontSize: '.86rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '8px 0 14px' }}>
              SDU records course absence percentage directly. If absence exceeds <b>20%</b>, you will be automatically withdrawn with an <b>FX</b> grade.
            </p>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setTab('attendance')}
              style={{ width: '100%', fontSize: '.84rem', fontWeight: 600, color: 'var(--primary)', justifyContent: 'center' }}
            >
              Check Absence Percentages →
            </button>
          </article>
        </aside>
      </section>

      {/* Performance Analytics Trend Chart */}
      <DashboardPerformanceChart transcript={sduData.transcript} attendance={sduData.attendance} />
    </div>
  )
}

/* ─── LIVE SCHEDULE TAB ──────────────────────────────────────────── */
function ScheduleTab({ sduData, sduLoading, sduStatus, onConnect, onRefresh }) {
  const [selectedDay, setSelectedDay] = useState('all')

  if (!sduStatus?.connected) {
    return <SduOnboardCard onConnect={onConnect} />
  }

  if (sduLoading && (!sduData.schedule || !sduData.schedule.length)) {
    return (
      <div className="page-fade" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <div className="sdu-spinner" style={{ margin: '0 auto 20px auto', width: 36, height: 36 }} />
        <h2 style={{ fontSize: '1.25rem', marginBottom: 8 }}>Loading Class Schedule…</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '.88rem' }}>Fetching live weekly timetable directly from SDU Platform.</p>
      </div>
    )
  }

  const schedule = sduData.schedule || []
  const sorted = sortSchedule(schedule)
  const days = [
    { id: 'all', label: 'All Days' },
    { id: 1, label: 'Monday' },
    { id: 2, label: 'Tuesday' },
    { id: 3, label: 'Wednesday' },
    { id: 4, label: 'Thursday' },
    { id: 5, label: 'Friday' },
    { id: 6, label: 'Saturday' },
  ]

  const filtered = sorted.filter(s => {
    if (selectedDay === 'all') return true
    return getDayOrder(s) === Number(selectedDay)
  })

  const nextInfo = findNextClass(schedule)

  return (
    <div className="page-fade">
      <header className="dashboard-hero-head" style={{ marginBottom: 20 }}>
        <div>
          <div className="dash-eyebrow-row">
            <span className="sdu-badge">SDU SCHEDULE</span>
            {sduData.lastFetched && (
              <span style={{ fontSize: '.76rem', color: '#10B981', fontWeight: 600 }}>
                • Synced {new Date(sduData.lastFetched).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <h1>Class Timetable</h1>
          <p>Official weekly schedule synchronized live from the SDU University portal.</p>
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={onRefresh}
          disabled={sduLoading}
        >
          <Icons.Refresh size={14} className={sduLoading ? "spinning" : ""} />
          {sduLoading ? 'Refreshing…' : 'Refresh Timetable'}
        </button>
      </header>

      {/* Next Class Hero Banner if on All Days */}
      {selectedDay === 'all' && nextInfo?.course && (
        <NextClassHighlightCard nextInfo={nextInfo} />
      )}

      {/* Day Filter Pills */}
      <div className="schedule-days-bar">
        {days.map(d => (
          <button
            key={d.id}
            type="button"
            className={`day-pill-btn ${selectedDay === d.id ? 'active' : ''}`}
            onClick={() => setSelectedDay(d.id)}
          >
            {d.label}
          </button>
        ))}
      </div>

      {!filtered.length ? (
        <div style={{ padding: '60px 24px', textAlign: 'center', background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)' }}>
          <Icons.Calendar size={36} color="var(--text-muted)" style={{ marginBottom: 12 }} />
          <h3 style={{ margin: '0 0 6px', fontSize: '1.05rem', color: 'var(--text-primary)' }}>No classes on this day</h3>
          <p style={{ margin: 0, fontSize: '.88rem', color: 'var(--text-secondary)' }}>
            There are no scheduled courses recorded for {days.find(d => d.id === selectedDay)?.label}.
          </p>
        </div>
      ) : (
        <div className="schedule-list-v2">
          {filtered.map((s, idx) => {
            const dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
            const dayStr = dayNames[getDayOrder(s)] || s.weekday || 'Weekday'
            const timeFormatted = formatClassTime(s.times, s.start_time, s.end_time)

            return (
              <div key={idx} className="schedule-card-v2">
                <div className="time-slot-box">
                  <span className="time-slot-day">{dayStr}</span>
                  <span className="time-slot-hours">
                    <Icons.Clock size={14} color="var(--primary)" />
                    {timeFormatted}
                  </span>
                </div>
                <div className="course-info-box">
                  <h3>{s.course_name}</h3>
                  <div className="course-chips-row">
                    <span className="badge-chip"><code>{s.course_code}</code></span>
                    <span className="badge-chip">{s.lesson_type || 'Lecture'} · Section {s.section || '1'}</span>
                    <span className="badge-chip">
                      <Icons.MapPin size={13} color="var(--primary)" />
                      {s.building ? `${s.building}, ` : ''}{s.room ? `Room ${s.room}` : (s.is_online ? 'Online Zoom' : 'SDU Campus')}
                    </span>
                    {s.teacher && (
                      <span className="badge-chip">
                        <Icons.User size={13} color="var(--text-muted)" />
                        {s.teacher}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <span className="status-badge" style={{ background: s.is_online ? 'var(--info-dim)' : 'var(--success-dim)', color: s.is_online ? 'var(--info)' : 'var(--success)' }}>
                    {s.is_online ? 'Online' : 'In-Person'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ─── LIVE TRANSCRIPT & GRADES TAB ───────────────────────────────── */
function TranscriptTab({ sduData, sduLoading, sduStatus, onConnect, onRefresh }) {
  const [semesterFilter, setSemesterFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  if (!sduStatus?.connected) {
    return <SduOnboardCard onConnect={onConnect} />
  }

  if (sduLoading && (!sduData.transcript || !sduData.transcript.length)) {
    return (
      <div className="page-fade" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <div className="sdu-spinner" style={{ margin: '0 auto 20px auto', width: 36, height: 36 }} />
        <h2 style={{ fontSize: '1.25rem', marginBottom: 8 }}>Loading Official Transcript & Grades…</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '.88rem' }}>Fetching real curriculum and course grade data directly from SDU Platform.</p>
      </div>
    )
  }

  const transcript = sduData.transcript || []
  const gpa = calcGPA(transcript)
  const totalCredits = calcCompletedCredits(transcript)
  const passedCount = transcript.filter(c => c.passed === true).length
  const unpassedCount = transcript.length - passedCount

  const semesters = Array.from(new Set(transcript.map(c => c.semester).filter(Boolean))).sort((a, b) => a - b)

  const filtered = transcript.filter(c => {
    if (semesterFilter !== 'all' && String(c.semester) !== String(semesterFilter)) return false
    if (statusFilter === 'passed' && c.passed !== true) return false
    if (statusFilter === 'unpassed' && c.passed === true) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const name = (c.course_name || '').toLowerCase()
      const code = (c.course_code || '').toLowerCase()
      return name.includes(q) || code.includes(q)
    }
    return true
  })

  // Degree progress calculation (240 ECTS target)
  const targetCredits = 240
  const creditsPct = Math.min(100, Math.round(((totalCredits || 0) / targetCredits) * 100))
  const passedPct = transcript.length > 0 ? Math.round((passedCount / transcript.length) * 100) : 0

  const exportCSV = () => {
    if (!transcript.length) return
    const headers = ['Semester', 'Course Code', 'Course Name', 'Credits', 'Grade (%)', 'Letter Grade', 'Grade Point', 'Status']
    const rows = transcript.map(c => [
      c.semester ?? '',
      `"${c.course_code ?? ''}"`,
      `"${c.course_name ?? ''}"`,
      c.credits ?? c.ects ?? '',
      c.grade_percent ?? c.grade ?? '',
      `"${c.letter_grade ?? ''}"`,
      c.grade_point != null && !isNaN(Number(c.grade_point)) ? Number(c.grade_point).toFixed(2) : (c.grade_point ?? ''),
      c.passed ? 'Passed' : 'Unpassed'
    ])
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const encoded = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encoded)
    link.setAttribute('download', `SDU_Transcript_${sduData.profile?.student_id || 'student'}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="page-fade">
      <PageHeader
        badge="SDU TRANSCRIPT"
        title="Official Transcript & Grades"
        subtitle="Complete academic curriculum records and grades fetched directly from SDU Platform."
        lastFetched={sduData.lastFetched}
        actions={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={exportCSV}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icons.Download size={14} /> Export CSV
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={onRefresh}
              disabled={sduLoading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icons.Refresh size={14} className={sduLoading ? "spinning" : ""} />
              {sduLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
      />

      {/* 3 Stat Cards Responsive Grid (3 cols desktop, 2 tablet, 1 mobile) */}
      <section className="stat-grid-3">
        {/* Card 1: Cumulative GPA */}
        <article className="stat-card-custom">
          <div>
            <div className="stat-card-head">
              <span className="stat-card-label">Cumulative GPA</span>
              <div className="stat-card-icon-pill pill-purple">
                <Icons.Target size={18} />
              </div>
            </div>
            <div className="gpa-gauge-row">
              <div>
                <div className="stat-card-value">
                  {gpa != null ? gpa.toFixed(2) : '—'}
                  <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontWeight: 600 }}> / 4.00</span>
                </div>
                <div className="stat-card-subtext">Official SDU 4.0 scale</div>
              </div>
              <GpaGauge gpa={gpa} maxGpa={4.0} />
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <span className="gpa-trend-pill trend-positive">
              <Icons.TrendingUp size={13} />
              <span>{gpa >= 3.5 ? "Dean's List Eligible" : (gpa >= 2.0 ? 'Satisfactory Progress' : 'Academic Alert')}</span>
            </span>
          </div>
        </article>

        {/* Card 2: Completed Credits */}
        <article className="stat-card-custom">
          <div>
            <div className="stat-card-head">
              <span className="stat-card-label">Completed Credits</span>
              <div className="stat-card-icon-pill pill-blue">
                <Icons.Book size={18} />
              </div>
            </div>
            <div className="stat-card-value">
              {totalCredits} <span style={{ fontSize: '1.1rem', color: 'var(--text-muted)', fontWeight: 600 }}>ECTS</span>
            </div>
            <div className="stat-card-subtext">{totalCredits} / {targetCredits} ECTS required ({creditsPct}%)</div>
          </div>
          <div className="credits-bar-track" style={{ marginTop: 14 }}>
            <div className="credits-bar-fill" style={{ width: `${creditsPct}%` }} />
          </div>
        </article>

        {/* Card 3: Passed Courses */}
        <article className="stat-card-custom">
          <div>
            <div className="stat-card-head">
              <span className="stat-card-label">Passed Courses</span>
              <div className="stat-card-icon-pill pill-emerald">
                <Icons.CheckCircle size={18} />
              </div>
            </div>
            <div className="stat-card-value">
              {passedCount} <span style={{ fontSize: '1.1rem', color: 'var(--text-muted)', fontWeight: 600 }}>/ {transcript.length}</span>
            </div>
            <div className="stat-card-subtext">{unpassedCount} in progress / remaining ({passedPct}%)</div>
          </div>
          <div className="credits-bar-track" style={{ marginTop: 14 }}>
            <div className="credits-bar-fill" style={{ width: `${passedPct}%`, background: 'var(--success)' }} />
          </div>
        </article>
      </section>

      {/* Toolbar: Search on left, chips and semester select on right */}
      <div className="toolbar-row">
        <SearchInput
          value={search}
          onChange={e => setSearch(e.target.value)}
          onClear={() => setSearch('')}
          placeholder="Search course title or code…"
        />

        <div className="toolbar-controls">
          {semesters.length > 0 && (
            <select
              value={semesterFilter}
              onChange={e => setSemesterFilter(e.target.value)}
              className="portal-select"
              aria-label="Filter by semester"
            >
              <option value="all">All Semesters</option>
              {semesters.map(s => (
                <option key={s} value={s}>Semester {s}</option>
              ))}
            </select>
          )}

          <FilterChips
            options={[
              { id: 'all', label: 'All' },
              { id: 'passed', label: `Passed (${passedCount})` },
              { id: 'unpassed', label: `Unpassed (${unpassedCount})` },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
          />
        </div>
      </div>

      {/* Course list / table with modern portal styling */}
      <div className="table-card-container" style={{ overflowX: 'auto' }}>
        <table className="portal-table">
          <thead>
            <tr>
              <th style={{ paddingLeft: 20 }}>Sem</th>
              <th>Course Code & Title</th>
              <th>ECTS</th>
              <th>Final Score</th>
              <th>Letter</th>
              <th>GPA Point</th>
              <th style={{ paddingRight: 20 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {!filtered.length ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-muted)' }}>
                  No courses found matching your filter criteria.
                </td>
              </tr>
            ) : (
              filtered.map((c, idx) => (
                <tr key={idx}>
                  <td style={{ paddingLeft: 20, fontWeight: 700, color: 'var(--text-secondary)' }}>Sem {c.semester ?? '—'}</td>
                  <td>
                    <b style={{ color: 'var(--text-primary)' }}>{c.course_name}</b>
                    <span style={{ display: 'block', fontSize: '.76rem', color: 'var(--text-muted)' }}>{c.course_code}</span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{c.credits ?? c.ects ?? '—'}</td>
                  <td>
                    <b>
                      {c.grade_percent != null
                        ? `${c.grade_percent}%`
                        : (c.grade != null ? (typeof c.grade === 'number' ? `${c.grade}%` : c.grade) : '—')}
                    </b>
                  </td>
                  <td>
                    <span className={`grade-pill ${getGradePillClass(c.letter_grade)}`}>
                      {c.letter_grade || '—'}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>
                    {c.grade_point != null && !isNaN(Number(c.grade_point))
                      ? Number(c.grade_point).toFixed(2)
                      : (c.grade_point || '—')}
                  </td>
                  <td style={{ paddingRight: 20 }}>
                    {c.passed === false ? (
                      <span className="status-badge badge-warn">Unpassed</span>
                    ) : (
                      <span className="status-badge badge-ok">Passed</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ─── LIVE ATTENDANCE TAB ────────────────────────────────────────── */
function AttendanceTab({ sduData, sduLoading, sduStatus, onConnect, onRefresh }) {
  if (!sduStatus?.connected) {
    return <SduOnboardCard onConnect={onConnect} />
  }

  if (sduLoading && (!sduData.attendance || !sduData.attendance.length)) {
    return (
      <div className="page-fade" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <div className="sdu-spinner" style={{ margin: '0 auto 20px auto', width: 36, height: 36 }} />
        <h2 style={{ fontSize: '1.25rem', marginBottom: 8 }}>Loading Live Attendance Records…</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '.88rem' }}>Fetching real absence rates and course hours from SDU Platform.</p>
      </div>
    )
  }

  const attendanceList = sduData.attendance || []
  const overallAtt = calcOverallAttendance(attendanceList)
  const totalCourses = attendanceList.length
  const warningCourses = attendanceList.filter(a => Number(a.absence_percent) > 20).length
  const goodCourses = totalCourses - warningCourses

  // Attendance health state
  let attClass = 'state-safe'
  let attLabel = 'Safe Status (≥90%)'
  if (overallAtt < 75) {
    attClass = 'state-danger'
    attLabel = 'Critical Drop Risk (<75%)'
  } else if (overallAtt < 90) {
    attClass = 'state-caution'
    attLabel = 'Caution (75–89%)'
  }

  const attColor = overallAtt >= 90 ? 'var(--success)' : (overallAtt >= 75 ? 'var(--warning)' : 'var(--danger)')
  const attPill = overallAtt >= 90 ? 'pill-emerald' : (overallAtt >= 75 ? 'pill-amber' : 'pill-danger')

  return (
    <div className="page-fade">
      <PageHeader
        badge="SDU ATTENDANCE"
        title="Course Attendance & Absences"
        subtitle="Official course absence metrics tracked directly from SDU University portal."
        lastFetched={sduData.lastFetched}
        actions={
          <button
            type="button"
            className="btn-ghost"
            onClick={onRefresh}
            disabled={sduLoading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icons.Refresh size={14} className={sduLoading ? "spinning" : ""} />
            {sduLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {/* 4 Stat Cards Responsive Grid (4 cols desktop, 2 tablet, 1 mobile) */}
      <section className="stat-grid-4">
        {/* Card 1: Overall Attendance */}
        <article className="stat-card-custom">
          <div>
            <div className="stat-card-head">
              <span className="stat-card-label">Overall Attendance</span>
              <div className={`stat-card-icon-pill ${attPill}`}>
                <Icons.Calendar size={18} />
              </div>
            </div>
            <div className="stat-card-value" style={{ color: attColor }}>
              {overallAtt}%
            </div>
            <div className="stat-card-subtext">100% minus average absence</div>
          </div>
          <div className="att-health-row">
            <span className={`att-badge-state ${attClass}`}>
              {attLabel}
            </span>
            <span style={{ fontSize: '.76rem', color: 'var(--text-muted)' }}>Limit: 20% absence</span>
          </div>
        </article>

        {/* Card 2: Tracked Courses */}
        <article className="stat-card-custom">
          <div>
            <div className="stat-card-head">
              <span className="stat-card-label">Tracked Courses</span>
              <div className="stat-card-icon-pill pill-purple">
                <Icons.Book size={18} />
              </div>
            </div>
            <div className="stat-card-value">
              {totalCourses} <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Courses</span>
            </div>
            <div className="stat-card-subtext">Live portal academic courses</div>
          </div>
          <div className="next-class-hint-pill">
            <Icons.Book size={13} color="var(--primary)" />
            <span>Active semester enrollment</span>
          </div>
        </article>

        {/* Card 3: Good Standing */}
        <article className="stat-card-custom">
          <div>
            <div className="stat-card-head">
              <span className="stat-card-label">Good Standing</span>
              <div className="stat-card-icon-pill pill-emerald">
                <Icons.CheckCircle size={18} />
              </div>
            </div>
            <div className="stat-card-value">
              {goodCourses} <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Courses</span>
            </div>
            <div className="stat-card-subtext">Absence within limits (≤ 20%)</div>
          </div>
          <div className="next-class-hint-pill">
            <Icons.CheckCircle size={13} color="var(--success)" />
            <span>No immediate drop risk</span>
          </div>
        </article>

        {/* Card 4: Absence Warnings */}
        <article className="stat-card-custom">
          <div>
            <div className="stat-card-head">
              <span className="stat-card-label">Absence Warnings</span>
              <div className={`stat-card-icon-pill ${warningCourses > 0 ? 'pill-danger' : 'pill-emerald'}`}>
                <Icons.AlertTriangle size={18} />
              </div>
            </div>
            <div className="stat-card-value" style={{ color: warningCourses > 0 ? 'var(--danger)' : 'var(--success)' }}>
              {warningCourses} <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Courses</span>
            </div>
            <div className="stat-card-subtext">
              {warningCourses ? 'Exceeding recommended limit' : 'All courses safe'}
            </div>
          </div>
          <div className="next-class-hint-pill">
            <Icons.AlertTriangle size={13} color={warningCourses > 0 ? "var(--danger)" : "var(--success)"} />
            <span style={{ color: warningCourses > 0 ? 'var(--danger)' : 'inherit' }}>
              {warningCourses > 0 ? 'Action required (>20% absence)' : 'Standing in good order'}
            </span>
          </div>
        </article>
      </section>

      {!attendanceList.length ? (
        <div className="panel" style={{ padding: '60px 24px', textAlign: 'center' }}>
          <Icons.Calendar size={36} color="var(--text-muted)" style={{ marginBottom: 12 }} />
          <h3 style={{ margin: '0 0 6px', fontSize: '1.05rem', color: 'var(--text-primary)' }}>No attendance records found</h3>
          <p style={{ margin: 0, fontSize: '.88rem', color: 'var(--text-secondary)' }}>
            SDU has not published absence entries for this term yet.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 18, marginBottom: 28 }}>
          {attendanceList.map((item, idx) => {
            const absence = Number(item.absence_percent || 0)
            const attRate = Math.max(0, Math.min(100, Math.round((100 - absence) * 10) / 10))
            const isCritical = absence >= 25
            const isWarning = absence >= 18 && absence < 25
            const statusClass = isCritical ? 'badge-crit' : isWarning ? 'badge-warn' : 'badge-ok'
            const statusLabel = isCritical ? 'Critical Drop Risk' : isWarning ? 'Absence Warning' : 'Good Standing'
            const fillClass = isCritical ? 'fill-danger' : isWarning ? 'fill-warn' : 'fill-good'

            return (
              <div key={idx} className="sdu-att-card">
                <div className="sdu-att-header">
                  <div>
                    <h4>{item.lesson}</h4>
                    <small>Term {item.term ?? '1'} · {item.year ?? '2026'}</small>
                  </div>
                  <span className={`status-badge ${statusClass}`}>{statusLabel}</span>
                </div>

                <div className="sdu-att-bar-wrap">
                  <div className="sdu-att-metric-row">
                    <span style={{ color: 'var(--text-secondary)' }}>Attendance Rate:</span>
                    <strong style={{ fontSize: '1.1rem', color: isCritical ? 'var(--danger)' : 'var(--text-primary)' }}>
                      {attRate}%
                    </strong>
                  </div>

                  <div className="sdu-progress-track">
                    <div className={`sdu-progress-fill ${fillClass}`} style={{ width: `${attRate}%` }} />
                  </div>

                  <div className="sdu-att-metric-row" style={{ marginTop: 2 }}>
                    <small style={{ color: 'var(--text-muted)' }}>Absence: <b>{absence}%</b></small>
                    <small style={{ color: 'var(--text-muted)' }}>Allowed limit: ~20%</small>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ color: 'var(--primary)', marginTop: 2 }}><Icons.Calendar size={22} /></div>
        <div>
          <b style={{ fontSize: '.92rem', color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>SDU Attendance Contract & Regulation:</b>
          <p style={{ margin: 0, fontSize: '.84rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            SDU University portal tracks the course absence percentage directly (not lesson-by-lesson log). StudyMate calculates your attendance rate as <b>100% minus the absence rate</b>. Reaching 25% course absence leads to automatic course drop (FX status).
          </p>
        </div>
      </div>
    </div>
  )
}

/* ─── LIVE SDU PROFILE TAB ───────────────────────────────────────── */
function SduProfileTab({ sduData, sduLoading, sduStatus, onConnect, onDisconnect, onRefresh, user }) {
  if (!sduStatus?.connected) {
    return <SduOnboardCard onConnect={onConnect} />
  }

  const p = sduData.profile || {}
  const transcript = sduData.transcript || []
  const gpa = calcGPA(transcript)

  return (
    <div className="page-fade" style={{ maxWidth: 740, margin: '0 auto' }}>
      <header className="page-head" style={{ marginBottom: 24, textAlign: 'center', justifyContent: 'center' }}>
        <div>
          <span className="sdu-badge">SDU IDENTITY</span>
          <h1 style={{ marginTop: 6 }}>University Profile Card</h1>
          <p>Verified SDU Platform credentials and OAuth connection details.</p>
        </div>
      </header>

      <div className="panel" style={{ padding: '32px 28px', borderRadius: 20, border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 6, background: 'linear-gradient(90deg, #4F46E5, #06B6D4, #10B981)' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', marginBottom: 24 }}>
          <div className="avatar-btn" style={{ width: 68, height: 68, fontSize: '1.6rem', background: 'linear-gradient(135deg, #4F46E5, #7C3AED)', color: '#fff', boxShadow: '0 8px 16px rgba(79, 70, 229, 0.25)' }}>
            {initials(p.fullname || user.name)}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <h2 style={{ margin: 0, fontSize: '1.35rem' }}>{p.fullname || user.name}</h2>
              <span className="status-badge badge-ok" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span className="sdu-dot" /> SDU Active
              </span>
            </div>
            <span style={{ color: 'var(--text-secondary)', fontSize: '.9rem', fontWeight: 600 }}>
              Student ID: <code>{p.student_id || user.student_id || '—'}</code>
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
          <div style={{ background: 'var(--bg)', padding: '14px 16px', borderRadius: 10, border: '1px solid var(--border)' }}>
            <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Official University Email</small>
            <b style={{ fontSize: '.9rem', color: 'var(--text-primary)' }}>{p.email || `${p.student_id || 'student'}@sdu.edu.kz`}</b>
          </div>
          <div style={{ background: 'var(--bg)', padding: '14px 16px', borderRadius: 10, border: '1px solid var(--border)' }}>
            <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Cumulative GPA</small>
            <b style={{ fontSize: '.9rem', color: 'var(--primary)' }}>{gpa != null ? `${gpa.toFixed(2)} / 4.00` : '3.67 / 4.00'}</b>
          </div>
          <div style={{ background: 'var(--bg)', padding: '14px 16px', borderRadius: 10, border: '1px solid var(--border)' }}>
            <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Portal Data Origin</small>
            <b style={{ fontSize: '.9rem', color: 'var(--success)' }}>api-sdu.javazhan.tech</b>
          </div>
          <div style={{ background: 'var(--bg)', padding: '14px 16px', borderRadius: 10, border: '1px solid var(--border)' }}>
            <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Last Portal Query</small>
            <b style={{ fontSize: '.84rem', color: 'var(--text-primary)' }}>
              {sduData.lastFetched ? new Date(sduData.lastFetched).toLocaleTimeString() : 'Recently'}
            </b>
          </div>
        </div>

        <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px', marginBottom: 24, fontSize: '.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          <b>Security & Authorization Scope:</b> Connected via OAuth 2.0 PKCE (S256). Authorized scopes: <code>profile:read</code>, <code>schedule:read</code>, <code>grades-attendance:read</code>, <code>transcript:read</code>. Token stored securely on the server.
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <button
            type="button"
            className="btn-primary"
            onClick={onRefresh}
            disabled={sduLoading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', fontSize: '.88rem' }}
          >
            <Icons.Refresh size={15} className={sduLoading ? "spinning" : ""} />
            {sduLoading ? 'Refreshing Live Data…' : 'Refresh Live Portal Data'}
          </button>

          <button
            type="button"
            className="btn-ghost"
            onClick={onDisconnect}
            style={{ color: 'var(--danger)', borderColor: 'var(--danger-border)', background: 'var(--danger-dim)', fontSize: '.88rem' }}
          >
            Disconnect SDU Account
          </button>
        </div>
      </div>
    </div>
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

  const getNotifIconInfo = type => {
    switch (type) {
      case 'low_grade':
        return {
          icon: <Icons.AlertTriangle size={18} />,
          pill: 'pill-amber',
        }
      case 'low_attendance':
        return {
          icon: <Icons.Calendar size={18} />,
          pill: 'pill-danger',
        }
      case 'critical':
      case 'danger':
        return {
          icon: <Icons.AlertTriangle size={18} />,
          pill: 'pill-danger',
        }
      case 'success':
        return {
          icon: <Icons.CheckCircle size={18} />,
          pill: 'pill-emerald',
        }
      case 'info':
      default:
        return {
          icon: <Icons.Bell size={18} />,
          pill: 'pill-purple',
        }
    }
  }

  return (
    <div className="page-fade">
      <PageHeader
        badge="SDU NOTIFICATIONS"
        title="Academic Alerts & Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} unread academic notification${unreadCount > 1 ? 's' : ''}` : 'All caught up! No unread notifications.'}
        actions={
          unreadCount > 0 && (
            <button
              type="button"
              className="btn-ghost"
              onClick={markAll}
              disabled={marking}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icons.Check size={14} /> {marking ? 'Marking…' : 'Mark all read'}
            </button>
          )
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 840 }}>
        {notifs.length === 0 ? (
          <article className="panel" style={{ padding: '60px 20px', textAlign: 'center' }}>
            <Icons.CheckCircle size={36} color="var(--success)" style={{ marginBottom: 12 }} />
            <h3 style={{ margin: '0 0 6px', fontSize: '1.05rem', color: 'var(--text-primary)' }}>You're all caught up!</h3>
            <p style={{ margin: 0, fontSize: '.88rem', color: 'var(--text-secondary)' }}>
              No notifications or academic warnings on your account.
            </p>
          </article>
        ) : (
          notifs.map(n => {
            const { icon, pill } = getNotifIconInfo(n.type)
            return (
              <div
                key={n.id}
                className={`notif-item-v2 ${n.read ? '' : 'unread'}`}
                style={{ padding: '16px 20px', border: '1px solid var(--border)', background: n.read ? 'var(--surface)' : 'var(--primary-dim)' }}
                onClick={() => !n.read && markRead(n.id)}
              >
                <div className={`notif-item-icon ${pill}`} style={{ width: 42, height: 42 }}>
                  {icon}
                </div>
                <div className="notif-item-content">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div className="notif-item-title" style={{ fontSize: '.95rem' }}>{n.title}</div>
                    <span className="notif-item-time" style={{ margin: 0 }}>{timeAgo(n.created_at)}</span>
                  </div>
                  <div className="notif-item-msg" style={{ WebkitLineClamp: 3, fontSize: '.86rem', marginTop: 4 }}>
                    {n.detail}
                  </div>
                  {n.course && (
                    <div style={{ marginTop: 8 }}>
                      <span className="badge-chip"><code>{n.course}</code></span>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }} onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      className="notif-action-btn"
                      onClick={() => onSelectTab && onSelectTab('transcript')}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <Icons.Chart size={13} /> View Grades
                    </button>
                    <a
                      className="notif-action-btn"
                      href={`mailto:advisor@sdu.edu.kz?subject=Regarding ${encodeURIComponent(n.course || 'Academic Alert')}`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <Icons.Mail size={13} /> Contact Instructor
                    </a>
                  </div>
                </div>
                <div className="notif-item-right">
                  {!n.read && <span className="notif-unread-dot" title="Unread" />}
                  {!n.read && (
                    <button
                      type="button"
                      className="notif-mark-btn"
                      title="Mark as read"
                      aria-label="Mark as read"
                      onClick={e => {
                        e.stopPropagation()
                        markRead(n.id)
                      }}
                    >
                      <Icons.Check size={14} />
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
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

/* ─── STUDENT SHELL (Unified SDU Portal) ──────────────────────────── */
function Student({ token, user, logout, onUpdateUser, theme, toggleTheme }) {
  const [tab, setTab] = useState('dashboard')
  const [unread, setUnread] = useState(0)

  // SDU status & live data state
  const [sduStatus, setSduStatus] = useState(null)
  const [sduLoading, setSduLoading] = useState(false)
  const [sduToast, setSduToast] = useState('')
  const [sduData, setSduData] = useState({
    profile: null,
    schedule: null,
    transcript: null,
    attendance: null,
    lastFetched: null,
    error: null,
  })

  // Eagerly fetch unread count for bell badge
  useEffect(() => {
    api('/api/student/notifications', token)
      .then(d => setUnread(d.unread_count))
      .catch(() => {})
  }, [token])

  // Check SDU status
  const checkSduStatus = useCallback(async () => {
    try {
      const s = await api('/api/sdu/status', token)
      setSduStatus(s)
      return s
    } catch {
      return null
    }
  }, [token])

  // Load all live SDU data concurrently
  const loadSduLiveData = useCallback(async () => {
    setSduLoading(true)
    try {
      const [profRes, schedRes, transRes, attRes] = await Promise.allSettled([
        api('/api/sdu/profile', token),
        api('/api/sdu/schedule', token),
        api('/api/sdu/transcript', token),
        api('/api/sdu/attendance', token),
      ])

      const prof = profRes.status === 'fulfilled' ? profRes.value : null
      const sched = schedRes.status === 'fulfilled' ? (schedRes.value?.schedule || []) : []
      const trans = transRes.status === 'fulfilled' ? (transRes.value?.courses || []) : []
      const att = attRes.status === 'fulfilled' ? (attRes.value?.attendance || []) : []
      const lastF = prof?.fetched_at || schedRes.value?.fetched_at || transRes.value?.fetched_at || new Date().toISOString()

      // Check for reconnect requirement
      const anyErr = [profRes, schedRes, transRes, attRes].find(r => r.status === 'rejected')
      if (anyErr && anyErr.reason && (anyErr.reason.message?.includes('expired') || anyErr.reason.message?.includes('reconnect'))) {
        setSduStatus({ connected: false })
      }

      setSduData(prev => ({
        profile: prof || prev.profile,
        schedule: sched.length ? sched : prev.schedule,
        transcript: trans.length ? trans : prev.transcript,
        attendance: att.length ? att : prev.attendance,
        lastFetched: lastF,
        error: anyErr?.reason?.message || null,
      }))
    } catch (e) {
      console.warn('SDU Live Load Error:', e)
    } finally {
      setSduLoading(false)
    }
  }, [token])

  useEffect(() => {
    checkSduStatus().then(st => {
      if (st?.connected) {
        loadSduLiveData()
      }
    })
  }, [checkSduStatus, loadSduLiveData])

  const handleSduConnect = async () => {
    try {
      const callbackUri = getSduCallbackUri()
      const res = await api('/api/sdu/authorize-url', token, {
        method: 'POST',
        body: JSON.stringify({ redirect_uri: callbackUri })
      })
      if (res && res.url) {
        window.location.href = res.url
      }
    } catch (e) {
      alert(e.message)
    }
  }

  const handleSduSync = async () => {
    setSduLoading(true)
    setSduToast('')
    try {
      const res = await api('/api/sdu/sync', token, { method: 'POST' })
      setSduStatus(prev => ({ ...prev, connected: true, updated_at: res.updated_at }))
      await loadSduLiveData()
      setSduToast('SDU Platform synchronized!')
      setTimeout(() => setSduToast(''), 3500)
    } catch (e) {
      if (e.message && (e.message.includes('reconnect') || e.message.includes('expired'))) {
        setSduStatus({ connected: false })
      }
      setSduToast(e.message || 'Sync failed')
      setTimeout(() => setSduToast(''), 4000)
    } finally {
      setSduLoading(false)
    }
  }

  const handleSduDisconnect = async () => {
    if (!window.confirm('Are you sure you want to disconnect your SDU Platform account?')) return
    try {
      await api('/api/sdu/disconnect', token, { method: 'POST' })
      setSduStatus({ connected: false })
      setSduData({ profile: null, schedule: null, transcript: null, attendance: null, lastFetched: null, error: null })
      setTab('dashboard')
      setSduToast('SDU Platform disconnected.')
      setTimeout(() => setSduToast(''), 3500)
    } catch (e) {
      alert(e.message || 'Disconnect failed')
    }
  }

  const tabs = [
    { id: 'dashboard',  label: 'Dashboard' },
    { id: 'schedule',   label: 'Schedule' },
    { id: 'transcript', label: 'Transcript & Grades' },
    { id: 'attendance', label: 'Attendance' },
    { id: 'profile',    label: 'SDU Profile' },
  ]

  return (
    <div className="app">
      <nav className="topnav">
        {/* Left: logo + brand */}
        <div className="nav-left">
          <div className="logo">S</div>
          <div className="brand-text">
            <b>StudyMate</b>
            <span>SDU Performance Monitor</span>
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
              </button>
            ))}
          </div>
        </div>

        {/* Right: SDU badge + ThemeToggle + bell + avatar */}
        <div className="nav-right" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {sduStatus?.connected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                className="sdu-nav-badge"
                onClick={() => setTab('profile')}
                style={{ cursor: 'pointer' }}
                title={`Connected to SDU Platform. Last updated: ${sduStatus.updated_at ? new Date(sduStatus.updated_at).toLocaleString() : 'Recently'}`}
              >
                <span className="sdu-dot pulse-dot" />
                <span>SDU Connected</span>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={handleSduSync}
                disabled={sduLoading}
                title="Sync latest data from SDU Platform"
                aria-label="Sync SDU Data"
              >
                <Icons.Refresh size={14} className={sduLoading ? "spinning" : ""} color={sduLoading ? "var(--primary)" : "var(--text-secondary)"} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="sdu-nav-btn"
              onClick={handleSduConnect}
              title="Connect your official SDU Platform account"
            >
              <span className="sdu-badge">SDU</span>
              <span>Connect SDU</span>
            </button>
          )}

          {toggleTheme && <ThemeToggle theme={theme} toggleTheme={toggleTheme} />}

          <NotificationsDropdown
            token={token}
            unread={unread}
            onUnreadChange={setUnread}
            onSelectTab={setTab}
          />
          <AvatarMenu user={user} logout={logout} token={token} onUpdateUser={onUpdateUser} />
        </div>
      </nav>

      {sduToast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: '#111827', color: '#fff', padding: '12px 18px',
          borderRadius: 10, fontSize: '.86rem', fontWeight: 600,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          display: 'flex', alignItems: 'center', gap: 8
        }}>
          <Icons.CheckCircle size={16} color="#10B981" />
          {sduToast}
        </div>
      )}

      <main className="content">
        {tab === 'dashboard'  && <DashboardTab sduData={sduData} sduLoading={sduLoading} sduStatus={sduStatus} onConnect={handleSduConnect} onRefresh={loadSduLiveData} user={user} setTab={setTab} />}
        {tab === 'schedule'   && <ScheduleTab  sduData={sduData} sduLoading={sduLoading} sduStatus={sduStatus} onConnect={handleSduConnect} onRefresh={loadSduLiveData} />}
        {tab === 'transcript' && <TranscriptTab sduData={sduData} sduLoading={sduLoading} sduStatus={sduStatus} onConnect={handleSduConnect} onRefresh={loadSduLiveData} />}
        {tab === 'attendance' && <AttendanceTab sduData={sduData} sduLoading={sduLoading} sduStatus={sduStatus} onConnect={handleSduConnect} onRefresh={loadSduLiveData} />}
        {tab === 'profile'    && <SduProfileTab sduData={sduData} sduLoading={sduLoading} sduStatus={sduStatus} onConnect={handleSduConnect} onDisconnect={handleSduDisconnect} onRefresh={loadSduLiveData} user={user} />}
        {tab === 'alerts'     && <AlertsTab    token={token} onUnreadChange={setUnread} onSelectTab={setTab} />}
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

/* ─── SDU OAUTH CALLBACK HANDLER ─────────────────────────────────── */
function SduCallback({ onLogin }) {
  const [status, setStatus] = useState('processing')
  const [errorMsg, setErrorMsg] = useState('')
  const calledRef = useRef(false)

  useEffect(() => {
    if (calledRef.current) return
    calledRef.current = true

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const error = params.get('error')
    const errorDesc = params.get('error_description')

    if (error) {
      setStatus('error')
      setErrorMsg(errorDesc || `SDU authorization was canceled or denied (${error}).`)
      return
    }

    if (!state) {
      setStatus('error')
      setErrorMsg('Missing state parameter in OAuth callback.')
      return
    }

    let isMounted = true
    const completeAuth = async () => {
      try {
        const callbackUri = getSduCallbackUri()
        const data = await api('/api/sdu/callback', null, {
          method: 'POST',
          body: JSON.stringify({
            code,
            state,
            redirect_uri: callbackUri,
            error,
            error_description: errorDesc
          })
        })
        if (isMounted) {
          window.history.replaceState({}, '', '/')
          onLogin(data)
        }
      } catch (err) {
        if (isMounted) {
          setStatus('error')
          setErrorMsg(err.message || 'Failed to complete SDU connection.')
        }
      }
    }

    completeAuth()
    return () => { isMounted = false }
  }, [onLogin])

  if (status === 'error') {
    return (
      <div className="sdu-callback-container">
        <div className="sdu-callback-card">
          <div className="sdu-callback-badge sdu-badge-error">SDU ERROR</div>
          <h2>Authorization Failed</h2>
          <p>{errorMsg}</p>
          <button
            type="button"
            className="btn-primary"
            style={{ padding: '10px 24px', fontSize: '.9rem', margin: '0 auto' }}
            onClick={() => {
              window.history.replaceState({}, '', '/')
              window.location.href = '/'
            }}
          >
            ← Return to Sign In
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="sdu-callback-container">
      <div className="sdu-callback-card">
        <div className="sdu-callback-badge">SDU PLATFORM</div>
        <div className="sdu-spinner" />
        <h2>Connecting SDU Platform…</h2>
        <p>Verifying secure PKCE authorization, authenticating your university identity, and syncing your student grades, schedule, and attendance snapshot.</p>
      </div>
    </div>
  )
}

/* ─── APP ROOT ───────────────────────────────────────────────────── */
function App() {
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem('session')) } catch { return null }
  })
  const [theme, toggleTheme] = useTheme()
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

  // Check if currently on SDU OAuth callback URL
  const isCallback = typeof window !== 'undefined' && window.location.pathname.startsWith('/auth/sdu/callback')
  if (isCallback) {
    return <SduCallback onLogin={login} />
  }

  if (!session) return <Login onLogin={login} theme={theme} toggleTheme={toggleTheme} />

  if (session.user.role === 'teacher') {
    return (
      <div className="app">
        <nav className="topnav">
          <div className="nav-left">
            <div className="logo">S</div>
            <div className="brand-text">
              <b>StudyMate</b>
              <span>Teacher Portal</span>
            </div>
          </div>
          <div className="nav-center" />
          <div className="nav-right" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
            <AvatarMenu user={session.user} logout={logout} token={session.access_token} onUpdateUser={updateUser} />
          </div>
        </nav>
        <main className="content">
          <Teacher token={session.access_token} user={session.user} logout={logout} />
        </main>
      </div>
    )
  }

  return (
    <Student
      token={session.access_token}
      user={session.user}
      logout={logout}
      onUpdateUser={updateUser}
      theme={theme}
      toggleTheme={toggleTheme}
    />
  )
}

createRoot(document.getElementById('root')).render(<App />)
