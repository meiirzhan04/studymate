import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer,
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

  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    if (typeof body.detail === 'string') {
      msg = body.detail
    } else if (typeof body.message === 'string') {
      msg = body.message
    } else if (typeof body.error === 'string') {
      msg = body.error
    } else if (body.detail && typeof body.detail === 'object') {
      msg = Array.isArray(body.detail)
        ? body.detail.map(d => d.msg || JSON.stringify(d)).join('; ')
        : (body.detail.message || JSON.stringify(body.detail))
    }
    throw new Error(msg)
  }
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
  Home: ({ size = 18, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </svg>
  ),
  ChevronRight: ({ size = 16, color = "currentColor", strokeWidth = 2, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <polyline points="9 18 15 12 9 6" />
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
      {theme === 'dark' ? <Icons.Sun size={18} /> : <Icons.Moon size={18} />}
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

const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DEGREE_CREDITS = 240

function classTimes(s) {
  const pick = v => (String(v || '').match(/\d{1,2}:\d{2}/) || [''])[0]
  if (s.start_time || s.end_time) return [pick(s.start_time), pick(s.end_time)]
  const parts = String(s.times || '').match(/\d{1,2}:\d{2}/g) || []
  return [parts[0] || '', parts[1] || '']
}

function formatClassTime(s) {
  const [start, end] = classTimes(s)
  if (!start) return 'Time TBD'
  return end ? `${start} – ${end}` : start
}

function classLocation(s) {
  if (s.room) return `${s.building ? `${s.building}, ` : ''}Room ${s.room}`
  return s.is_online ? 'Online' : 'SDU Campus'
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

/* ─── ACADEMIC STATUS HELPERS ────────────────────────────────────── */
const ABSENCE_WARN = 15
const ABSENCE_LIMIT = 20
const LOW_GRADE_THRESHOLD = 60

const absenceOf = a => Number(a.absence_percent ?? a.absence ?? 0) || 0
const attendanceTitle = a => a.lesson || a.course_name || a.course_title || a.course || a.subject || a.name || 'Course'
const absenceTone = abs => (abs >= ABSENCE_LIMIT ? 'danger' : abs >= ABSENCE_WARN ? 'warning' : 'success')

function latestSemester(transcript = []) {
  const sems = transcript.map(c => Number(c.semester)).filter(n => !Number.isNaN(n) && n > 0)
  return sems.length ? Math.max(...sems) : null
}

function gpaStanding(gpa) {
  if (gpa == null) return { tone: 'neutral', label: 'No grades yet' }
  if (gpa >= 3.5) return { tone: 'success', label: "Dean's list" }
  if (gpa >= 2.0) return { tone: 'success', label: 'Good standing' }
  return { tone: 'danger', label: 'Academic warning' }
}

function attendanceStanding(pct) {
  if (pct >= 90) return { tone: 'success', label: 'On track' }
  if (pct >= 75) return { tone: 'warning', label: 'Watch absences' }
  return { tone: 'danger', label: 'At risk' }
}

function gradeTone(letter) {
  const l = String(letter || '').toUpperCase().trim()
  if (l.startsWith('A')) return 'success'
  if (l.startsWith('B')) return 'accent'
  if (l.startsWith('C') || l.startsWith('D')) return 'warning'
  if (l.startsWith('F')) return 'danger'
  return 'neutral'
}

// Where a notification's action should take the student (US-05 action links)
function notifTarget(type) {
  if (type === 'low_grade' || type === 'grade_posted') return { tab: 'transcript', label: 'View grades' }
  if (type === 'low_attendance') return { tab: 'attendance', label: 'View attendance' }
  if (type === 'teacher_intervention') return { tab: 'insights', label: 'Open study plan' }
  return null
}

function notifMeta(type) {
  switch (type) {
    case 'low_grade':      return { icon: <Icons.AlertTriangle size={16} />, tone: 'warning' }
    case 'low_attendance': return { icon: <Icons.Calendar size={16} />, tone: 'danger' }
    case 'critical':
    case 'danger':         return { icon: <Icons.AlertTriangle size={16} />, tone: 'danger' }
    case 'success':        return { icon: <Icons.CheckCircle size={16} />, tone: 'success' }
    case 'grade_posted':   return { icon: <Icons.Award size={16} />, tone: 'success' }
    case 'teacher_intervention': return { icon: <Icons.Mail size={16} />, tone: 'accent' }
    default:               return { icon: <Icons.Bell size={16} />, tone: 'accent' }
  }
}

/* ─── SHARED UI PRIMITIVES ───────────────────────────────────────── */
function Status({ tone = 'neutral', children }) {
  return (
    <span className={`status status-${tone}`}>
      <span className="status-dot" />
      {children}
    </span>
  )
}

function Metric({ label, value, unit, foot }) {
  return (
    <article className="card metric">
      <span className="metric-label">{label}</span>
      <div className="metric-value">
        {value ?? '—'}
        {unit && <span className="metric-unit">{unit}</span>}
      </div>
      {foot && <div className="metric-foot">{foot}</div>}
    </article>
  )
}

function ProgressBar({ pct, tone = 'accent' }) {
  return (
    <div className="progress">
      <div className={`progress-fill fill-${tone}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  )
}

function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          className={`segmented-item ${value === o.id ? 'active' : ''}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function EmptyState({ icon, title, text, action }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  )
}

function PageLoader({ label }) {
  return (
    <div className="page-loader page-fade">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  )
}

function SkeletonDashboard() {
  return (
    <div className="page">
      <section className="metric-grid">
        {[0, 1, 2].map(i => (
          <div key={i} className="card metric">
            <div className="skeleton" style={{ width: 70, height: 12 }} />
            <div className="skeleton" style={{ width: 110, height: 34, marginTop: 16 }} />
            <div className="skeleton" style={{ width: 90, height: 12, marginTop: 16 }} />
          </div>
        ))}
      </section>
      <section className="split">
        {[0, 1].map(i => (
          <div key={i} className="card">
            <div className="skeleton" style={{ width: 120, height: 14 }} />
            <div className="skeleton" style={{ width: '70%', height: 22, marginTop: 24 }} />
            <div className="skeleton" style={{ width: '50%', height: 12, marginTop: 12 }} />
          </div>
        ))}
      </section>
    </div>
  )
}

const CustomChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tip">
      <b>{label}</b>
      {payload.map((p, i) => (
        <span key={i}>GPA {p.value}</span>
      ))}
    </div>
  )
}

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

/* ─── NOTIFICATIONS ──────────────────────────────────────────────── */
function NotifRow({ n, onOpen, children }) {
  const { icon, tone } = notifMeta(n.type)
  return (
    <li className={`notif-row ${n.read ? '' : 'unread'}`} onClick={onOpen}>
      <span className={`notif-icon tint-${tone}`}>{icon}</span>
      <div className="notif-body">
        <div className="notif-top">
          <b>{n.title}</b>
          <time>{timeAgo(n.created_at)}</time>
        </div>
        <p>{n.detail}</p>
        {children}
      </div>
      {!n.read && <span className="unread-dot" aria-label="Unread" />}
    </li>
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

  const markRead = async id => {
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

  const openAll = () => {
    setIsOpen(false)
    if (onSelectTab) onSelectTab('alerts')
  }

  return (
    <div className="popover-wrap" ref={wrapperRef}>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setIsOpen(prev => !prev)}
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <Icons.Bell size={18} />
        {unread > 0 && <span className="badge-count">{unread}</span>}
      </button>

      {isOpen && (
        <div className="popover notif-popover" role="dialog" aria-label="Notifications">
          <div className="popover-head">
            <b>Notifications</b>
            {unread > 0 && (
              <button type="button" className="link-btn" onClick={markAllRead}>Mark all read</button>
            )}
          </div>

          <div className="popover-body" aria-live="polite">
            {loading && !notifs ? (
              <PageLoader label="Loading…" />
            ) : !notifs || notifs.length === 0 ? (
              <EmptyState icon={<Icons.CheckCircle size={20} />} title="You're all caught up" />
            ) : (
              <ul className="notif-list">
                {notifs.slice(0, 5).map(n => (
                  <NotifRow
                    key={n.id}
                    n={n}
                    onOpen={() => {
                      if (!n.read) markRead(n.id)
                      const target = notifTarget(n.type)
                      setIsOpen(false)
                      if (onSelectTab) onSelectTab(target ? target.tab : 'alerts')
                    }}
                  />
                ))}
              </ul>
            )}
          </div>

          <button type="button" className="popover-foot" onClick={openAll}>
            View all notifications
          </button>
        </div>
      )}
    </div>
  )
}

/* ─── REDESIGNED SIGN IN & CREATE ACCOUNT SCREEN ─────────────────── */
function Login({ onLogin, theme, toggleTheme }) {
  const [authMode, setAuthMode]     = useState('login') // 'login' | 'register'
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword]     = useState('')
  const [showPw, setShowPw]         = useState(false)
  const [error, setError]           = useState('')
  const [fieldErr, setFieldErr]     = useState({})
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
    e.preventDefault(); setError('')
    const fe = {}
    if (!identifier.trim()) fe.identifier = 'Please enter your email or Student ID'
    if (!password) fe.password = 'Please enter your password'
    setFieldErr(fe)
    if (Object.keys(fe).length) return
    setBusy(true)
    try { onLogin(await api('/api/auth/login', null, { method: 'POST', body: JSON.stringify({ identifier, password }) })) }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  const handleRegister = async e => {
    e.preventDefault(); setError('')
    const fe = {}
    if (!regName.trim()) fe.regName = 'Please enter your full name'
    if (!regId.trim()) fe.regId = 'Please enter your Student ID'
    if (!regPw) fe.regPw = 'Please enter a password'
    else if (regPw.length < 6) fe.regPw = 'Password must be at least 6 characters'
    setFieldErr(fe)
    if (Object.keys(fe).length) return
    setBusy(true)
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
      setForgotMsg(res.message || 'Verification code sent to your email! Please check your inbox.')
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
        <Brand subtitle="SDU student" />

        <div className="login-hero">
          <h1>Your studies,<br />at a glance.</h1>
          <p>Grades, schedule and attendance from SDU — in one calm place.</p>
          <ul className="login-points">
            <li><Icons.Check size={16} /> Know your next class</li>
            <li><Icons.Check size={16} /> See absence risk early</li>
            <li><Icons.Check size={16} /> Plan the grade you need</li>
          </ul>
        </div>

        <small className="login-foot">Secure sign-in through the official SDU portal</small>
      </section>

      {/* Right Form Panel */}
      <div className="login-right">
        <div className="login-card">
          <div className="login-card-topbar">
            <div className="login-mobile-brand"><Brand /></div>
            {toggleTheme && <ThemeToggle theme={theme} toggleTheme={toggleTheme} />}
          </div>

          <div className="login-header-text">
            <h2>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
            <p>{authMode === 'login' ? 'Sign in to see your grades and schedule.' : 'It takes less than a minute.'}</p>
          </div>

          <button
            type="button"
            className="sdu-primary-hero-btn"
            disabled={sduBusy || busy}
            onClick={handleConnectSdu}
          >
            <span className="sdu-mark">SDU</span>
            <span>{sduBusy ? 'Connecting…' : 'Continue with SDU'}</span>
            <Icons.ArrowRight size={16} />
          </button>

          <div className="login-divider">
            <span>or use your password</span>
          </div>

          {/* Segmented Auth Mode Switcher */}
          <div className="segmented-control">
            <button
              type="button"
              className={`segmented-btn ${authMode === 'login' ? 'active' : ''}`}
              onClick={() => { setAuthMode('login'); setError(''); setFieldErr({}) }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`segmented-btn ${authMode === 'register' ? 'active' : ''}`}
              onClick={() => { setAuthMode('register'); setError(''); setFieldErr({}) }}
            >
              Create Account
            </button>
          </div>

          {authMode === 'login' ? (
            <form onSubmit={submit} className="login-form">
              <div className="field-group">
                <label className="field-label" htmlFor="identifier">University Email or Student ID</label>
                <div className="input-container">
                  <div className="input-icon-left"><Icons.User size={16} /></div>
                  <input
                    id="identifier"
                    className="input-field"
                    value={identifier}
                    onChange={e => { setIdentifier(e.target.value); setFieldErr(f => ({ ...f, identifier: '' })) }}
                    placeholder="e.g. 240103118 or student@univ.edu"
                    autoComplete="username"
                    style={fieldErr.identifier ? { borderColor: '#ef4444' } : undefined}
                  />
                </div>
                {fieldErr.identifier && <div style={{ color: '#ef4444', fontSize: 13, marginTop: 6 }}>{fieldErr.identifier}</div>}
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
                    onChange={e => { setPassword(e.target.value); setFieldErr(f => ({ ...f, password: '' })) }}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    style={{ paddingRight: 44, ...(fieldErr.password ? { borderColor: '#ef4444' } : {}) }}
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
                {fieldErr.password && <div style={{ color: '#ef4444', fontSize: 13, marginTop: 6 }}>{fieldErr.password}</div>}
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
              <div className="field-group">
                <label className="field-label" htmlFor="regName">Full Name</label>
                <div className="input-container">
                  <div className="input-icon-left"><Icons.User size={16} /></div>
                  <input
                    id="regName"
                    className="input-field"
                    value={regName}
                    onChange={e => { setRegName(e.target.value); setFieldErr(f => ({ ...f, regName: '' })) }}
                    placeholder="e.g. Meirzhan"
                    autoComplete="name"
                    style={fieldErr.regName ? { borderColor: '#ef4444' } : undefined}
                  />
                </div>
                {fieldErr.regName && <div style={{ color: '#ef4444', fontSize: 13, marginTop: 6 }}>{fieldErr.regName}</div>}
              </div>

              <div className="field-group">
                <label className="field-label" htmlFor="regId">Student ID</label>
                <div className="input-container">
                  <div className="input-icon-left"><Icons.Award size={16} /></div>
                  <input
                    id="regId"
                    className="input-field"
                    value={regId}
                    onChange={e => { setRegId(e.target.value); setFieldErr(f => ({ ...f, regId: '' })) }}
                    placeholder="e.g. 240103118"
                    autoComplete="username"
                    style={fieldErr.regId ? { borderColor: '#ef4444' } : undefined}
                  />
                </div>
                {fieldErr.regId && <div style={{ color: '#ef4444', fontSize: 13, marginTop: 6 }}>{fieldErr.regId}</div>}
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
                    onChange={e => { setRegPw(e.target.value); setFieldErr(f => ({ ...f, regPw: '' })) }}
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                    style={{ paddingRight: 44, ...(fieldErr.regPw ? { borderColor: '#ef4444' } : {}) }}
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
                {fieldErr.regPw && <div style={{ color: '#ef4444', fontSize: 13, marginTop: 6 }}>{fieldErr.regPw}</div>}
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
            <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowForgot(false)}>
              <div className="modal" style={{ maxWidth: 460 }}>
                <div className="modal-head">
                  <div>
                    <h2>Reset password</h2>
                    <p>We will send you a 6-digit code</p>
                  </div>
                  <button type="button" className="icon-btn" onClick={() => setShowForgot(false)}><Icons.Close size={18} /></button>
                </div>

                {forgotStep === 1 ? (
                  <form onSubmit={handleSendCode}>
                    <div className="modal-body">
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
                    <div className="modal-foot">
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
                    <div className="modal-body">
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
                    <div className="modal-foot">
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
  const [availableCourses, setAvailableCourses] = useState([])
  const [courseCode, setCourseCode]    = useState('')
  const [component, setComponent]     = useState('')
  const [target, setTarget]           = useState(85)
  const [components, setComponents]   = useState([])
  const [result, setResult]           = useState(null)
  const [loading, setLoading]         = useState(false)
  const [loadingComp, setLoadingComp] = useState(false)
  const [err, setErr]                 = useState('')

  // 1. Initialize from props and auto-fetch spring-2026 courses
  useEffect(() => {
    const list = (courses || []).map(c => ({
      code: c.code || c.course_code || '',
      course: c.course || c.course_name || c.lesson || 'Course',
      score: c.score ?? c.grade ?? c.grade_percent ?? null
    })).filter(c => c.code)

    if (list.length) {
      setAvailableCourses(list)
      setCourseCode(list[0].code)
    }

    if (token) {
      api('/api/student/grades?semester=spring-2026', token)
        .then(d => {
          if (d?.items?.length) {
            setAvailableCourses(d.items)
            // The transcript codes used for the first render may not exist in this term's grade list
            setCourseCode(prev => (d.items.some(c => c.code === prev) ? prev : d.items[0].code))
          }
        })
        .catch(() => {})
    }
  }, [courses, token])

  // 2. Load assessment breakdown components when courseCode changes
  useEffect(() => {
    if (!courseCode) return
    setLoadingComp(true); setComponents([]); setComponent(''); setResult(null); setErr('')
    api(`/api/student/grades/breakdown?course_code=${encodeURIComponent(courseCode)}`, token)
      .then(d => {
        const comps = d.components || []
        setComponents(comps)
        setComponent(comps[0]?.name ?? '')
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoadingComp(false))
  }, [courseCode, token])

  const calculate = async () => {
    if (!courseCode || !component) return
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
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <div>
            <h2>What-if planner</h2>
            <p>Find the score you need on an assessment</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icons.Close size={18} /></button>
        </div>

        <div className="modal-body">
          <label>
            Course
            <select value={courseCode} onChange={e => setCourseCode(e.target.value)}>
              {availableCourses.map(c => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.course} {c.score != null ? `(${c.score}%)` : ''}
                </option>
              ))}
            </select>
          </label>

          <label>
            Component / Assessment
            {loadingComp
              ? <div className="loading-sm" style={{ padding: '8px 0', fontSize: '.85rem', color: 'var(--text-muted)' }}>Loading components…</div>
              : <select value={component} onChange={e => setComponent(e.target.value)} disabled={!components.length}>
                  {components.map(c => <option key={c.name} value={c.name}>{c.name} (weight: {Math.round(c.weight * 100)}%)</option>)}
                </select>
            }
          </label>

          <label>
            Target final score (0–100)
            <input type="number" min={0} max={100} value={target} onChange={e => setTarget(e.target.value)} />
          </label>

          {err && <div className="alert-box alert-danger">{err}</div>}

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

        <div className="modal-foot">
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
  const valid = attendanceList.filter(a => (a.absence_percent != null || a.absence != null) && !isNaN(Number(a.absence_percent ?? a.absence)))
  if (!valid.length) return 100.0
  const avgAbsence = valid.reduce((sum, a) => sum + Number(a.absence_percent ?? a.absence), 0) / valid.length
  return Math.max(0, Math.min(100, Math.round((100 - avgAbsence) * 10) / 10))
}

function calcCompletedCredits(transcript) {
  if (!transcript || !transcript.length) return 0
  return transcript
    .filter(c => c.passed === true)
    .reduce((sum, c) => sum + Number(c.credits || c.ects || 0), 0)
}

/* ─── SDU ONBOARDING / DISCONNECTED CARD ──────────────────────────── */
function SduOnboardCard({ onConnect }) {
  return (
    <div className="page page-narrow page-fade">
      <article className="card onboard">
        <div className="onboard-icon"><Icons.GraduationCap size={28} /></div>
        <h2>Connect your SDU account</h2>
        <p>Your schedule, grades and attendance will appear here automatically.</p>
        <button type="button" className="btn-primary btn-lg" onClick={onConnect}>
          Connect SDU Platform <Icons.ArrowRight size={16} />
        </button>
        <small>Secure sign-in through the official SDU portal.</small>
      </article>
    </div>
  )
}

/* ─── OVERVIEW TAB ───────────────────────────────────────────────── */
function NextClassCard({ nextInfo, onOpenSchedule }) {
  const c = nextInfo?.course
  return (
    <article className="card">
      <header className="card-head">
        <h2>Next class</h2>
        <button type="button" className="link-btn" onClick={onOpenSchedule}>
          Schedule <Icons.ArrowRight size={14} />
        </button>
      </header>
      {c ? (
        <div className="next-class">
          <div className="next-class-when">
            <span>{nextInfo.isToday ? 'Today' : DAY_NAMES[getDayOrder(c)] || 'Upcoming'}</span>
            <b>{formatClassTime(c)}</b>
          </div>
          <h3>{c.course_name}</h3>
          <ul className="meta-list">
            <li><Icons.MapPin size={14} />{classLocation(c)}</li>
            <li><Icons.Book size={14} />{c.lesson_type || 'Lecture'}</li>
            {c.teacher && <li><Icons.User size={14} />{c.teacher}</li>}
          </ul>
        </div>
      ) : (
        <EmptyState icon={<Icons.Calendar size={20} />} title="No upcoming classes" text="Your timetable is empty for now." />
      )}
    </article>
  )
}

function AttentionCard({ items, onSelect }) {
  return (
    <article className="card">
      <header className="card-head">
        <h2>Needs attention</h2>
        {items.length > 0 && <span className="count-pill">{items.length}</span>}
      </header>
      {items.length ? (
        <ul className="attention-list">
          {items.map((item, i) => (
            <li key={i}>
              <button type="button" className="attention-item" onClick={() => onSelect(item.tab)}>
                <span className={`dot dot-${item.tone}`} />
                <span className="attention-text">
                  <b>{item.title}</b>
                  <span>{item.text}</span>
                </span>
                <Icons.ChevronRight size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Icons.CheckCircle size={20} />} title="All clear" text="No absence or grade warnings right now." />
      )}
    </article>
  )
}

function DashboardTab({ sduData, sduLoading, sduStatus, onConnect, setTab, token }) {
  const [recommendations, setRecommendations] = useState([])
  const connected = !!sduStatus?.connected

  useEffect(() => {
    if (!token || !connected) return
    api('/api/student/dashboard?semester=spring-2026', token)
      .then(d => setRecommendations(d?.recommendations || []))
      .catch(() => {})
  }, [token, connected])

  if (!connected) return <SduOnboardCard onConnect={onConnect} />
  if (sduLoading && !sduData.transcript && !sduData.schedule) return <SkeletonDashboard />

  const transcript = sduData.transcript || []
  const attendanceList = sduData.attendance || []
  const gpa = calcGPA(transcript)
  const attendance = calcOverallAttendance(attendanceList)
  const credits = calcCompletedCredits(transcript)
  const creditsPct = Math.min(100, Math.round((credits / DEGREE_CREDITS) * 100))
  const standing = gpaStanding(gpa)
  const attStanding = attendanceStanding(attendance)
  const currentSemester = latestSemester(transcript)

  const attention = [
    ...attendanceList
      .filter(a => absenceOf(a) >= ABSENCE_WARN)
      .sort((a, b) => absenceOf(b) - absenceOf(a))
      .map(a => ({
        tone: absenceTone(absenceOf(a)),
        title: attendanceTitle(a),
        text: absenceOf(a) >= ABSENCE_LIMIT
          ? `${absenceOf(a)}% absent — over the ${ABSENCE_LIMIT}% limit`
          : `${absenceOf(a)}% absent — close to the ${ABSENCE_LIMIT}% limit`,
        tab: 'attendance',
      })),
    ...transcript
      .filter(c => c.passed === false || (c.semester != null && c.semester === currentSemester && Number(c.grade_percent ?? c.grade) < LOW_GRADE_THRESHOLD))
      .map(c => ({
        tone: 'danger',
        title: c.course_name,
        text: c.passed === false
          ? `Not passed · grade ${c.letter_grade || '—'}`
          : `Low grade · ${c.grade_percent ?? c.grade}% (below ${LOW_GRADE_THRESHOLD}%)`,
        tab: 'transcript',
      })),
    ...recommendations
      .slice(0, 1)
      .map(r => ({ tone: 'accent', title: r.course, text: r.action, tab: 'transcript' })),
  ].slice(0, 4)

  return (
    <div className="page page-fade">
      <section className="metric-grid">
        <Metric
          label="GPA"
          value={gpa != null ? gpa.toFixed(2) : '—'}
          unit="/ 4.00"
          foot={<Status tone={standing.tone}>{standing.label}</Status>}
        />
        <Metric
          label="Attendance"
          value={attendanceList.length ? `${attendance}%` : '—'}
          foot={<Status tone={attendanceList.length ? attStanding.tone : 'neutral'}>{attendanceList.length ? attStanding.label : 'No data'}</Status>}
        />
        <Metric
          label="Credits earned"
          value={credits}
          unit={`/ ${DEGREE_CREDITS} ECTS`}
          foot={<ProgressBar pct={creditsPct} />}
        />
      </section>

      <section className="split">
        <NextClassCard nextInfo={findNextClass(sduData.schedule || [])} onOpenSchedule={() => setTab('schedule')} />
        <AttentionCard items={attention} onSelect={setTab} />
      </section>
    </div>
  )
}

/* ─── SCHEDULE TAB ───────────────────────────────────────────────── */
function ScheduleTab({ sduData, sduLoading, sduStatus, onConnect }) {
  const [selectedDay, setSelectedDay] = useState(null)

  if (!sduStatus?.connected) return <SduOnboardCard onConnect={onConnect} />

  const schedule = sduData.schedule || []
  if (sduLoading && !schedule.length) return <PageLoader label="Loading schedule…" />

  const sorted = sortSchedule(schedule)
  const nextInfo = findNextClass(schedule)
  const today = new Date().getDay() || 7
  const counts = {}
  sorted.forEach(s => { counts[getDayOrder(s)] = (counts[getDayOrder(s)] || 0) + 1 })

  const defaultDay = counts[today] ? today : (nextInfo?.course ? getDayOrder(nextInfo.course) : 1)
  const day = selectedDay ?? defaultDay
  const classes = sorted.filter(s => getDayOrder(s) === day)

  return (
    <div className="page page-fade">
      <div className="day-tabs" role="tablist" aria-label="Day of week">
        {[1, 2, 3, 4, 5, 6].map(d => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={day === d}
            className={`day-tab ${day === d ? 'active' : ''}`}
            onClick={() => setSelectedDay(d)}
          >
            <span>{DAY_SHORT[d]}</span>
            <small>{d === today ? 'Today' : counts[d] ? `${counts[d]} class${counts[d] > 1 ? 'es' : ''}` : 'Free'}</small>
          </button>
        ))}
      </div>

      <article className="card card-flush">
        {classes.length ? (
          <ol className="timeline">
            {classes.map((s, idx) => {
              const [start, end] = classTimes(s)
              const isNext = nextInfo?.course === s
              return (
                <li key={idx} className={`timeline-row ${isNext ? 'is-next' : ''}`}>
                  <div className="timeline-time">
                    <b>{start || 'TBD'}</b>
                    {end && <span>{end}</span>}
                  </div>
                  <div className="timeline-body">
                    <h3>
                      {s.course_name}
                      {isNext && <span className="tag tag-accent">Next</span>}
                      {s.is_online && <span className="tag">Online</span>}
                    </h3>
                    <p>
                      {classLocation(s)} · {s.lesson_type || 'Lecture'}
                      {s.teacher ? ` · ${s.teacher}` : ''}
                    </p>
                  </div>
                  <code className="course-code">{s.course_code}</code>
                </li>
              )
            })}
          </ol>
        ) : (
          <EmptyState icon={<Icons.Calendar size={20} />} title={`No classes on ${DAY_NAMES[day]}`} text="Enjoy the free time." />
        )}
      </article>
    </div>
  )
}

/* ─── GRADES TAB ─────────────────────────────────────────────────── */
// Credit categories derived only from the course-code prefix (SDU does not label major/minor)
const CREDIT_CATEGORIES = [
  { id: 'major', label: 'Major (CSS, INF)', prefixes: ['CSS', 'INF'] },
  { id: 'math', label: 'Math & science (MAT, PHY, STA)', prefixes: ['MAT', 'PHY', 'STA'] },
  { id: 'general', label: 'General education', prefixes: ['HIS', 'ENG', 'MDE', 'KAZ', 'RUS', 'TUR', 'PHL', 'SOC', 'POL', 'PE'] },
]

function creditBreakdown(transcript = []) {
  const totals = { major: 0, math: 0, general: 0, other: 0 }
  transcript.filter(c => c.passed === true).forEach(c => {
    const prefix = String(c.course_code || '').trim().split(/\s+/)[0].toUpperCase()
    const cat = CREDIT_CATEGORIES.find(k => k.prefixes.includes(prefix))
    totals[cat ? cat.id : 'other'] += Number(c.credits || c.ects || 0)
  })
  return totals
}

function GpaTrendCard({ groups }) {
  const [scale, setScale] = useState('semesters')
  const bySemester = groups.filter(g => g.key !== '—' && g.gpa != null)
  // Year GPA is credit-weighted over all of that year's courses, not the mean of semester GPAs
  const byYear = Object.values(
    groups.filter(g => g.key !== '—').reduce((acc, g) => {
      const year = Math.ceil(Number(g.key) / 2)
      acc[year] = acc[year] || { year, courses: [] }
      acc[year].courses.push(...g.courses)
      return acc
    }, {})
  )
    .map(y => ({ name: `Year ${y.year}`, gpa: calcGPA(y.courses) }))
    .filter(y => y.gpa != null)
    .map(y => ({ ...y, gpa: Math.round(y.gpa * 100) / 100 }))
  const data = scale === 'years' ? byYear : bySemester

  return (
    <article className="card">
      <header className="card-head">
        <h2>GPA trend</h2>
        <Segmented
          label="Trend scale"
          options={[{ id: 'semesters', label: 'Semesters' }, { id: 'years', label: 'Years' }]}
          value={scale}
          onChange={setScale}
        />
      </header>
      {data.length ? (
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 12, right: 16, left: -24, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 4]} ticks={[0, 1, 2, 3, 4]} stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomChartTooltip />} />
              <Line type="monotone" dataKey="gpa" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 4, fill: 'var(--accent)' }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState title="No graded semesters yet" />
      )}
    </article>
  )
}

function DegreeProgressCard({ transcript }) {
  const earned = calcCompletedCredits(transcript)
  const pct = Math.min(100, Math.round((earned / DEGREE_CREDITS) * 1000) / 10)
  const totals = creditBreakdown(transcript)
  const rows = [...CREDIT_CATEGORIES.map(c => ({ label: c.label, value: totals[c.id] })), { label: 'Other', value: totals.other }]
    .filter(r => r.value > 0)

  return (
    <article className="card">
      <header className="card-head">
        <h2>Graduation progress</h2>
        <span className="muted">{earned} / {DEGREE_CREDITS} ECTS</span>
      </header>
      <div className="metric-value">{pct}%</div>
      <div style={{ marginTop: 12 }}><ProgressBar pct={pct} /></div>
      <dl className="kv" style={{ marginTop: 18 }}>
        {rows.map(r => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.value} ECTS</dd>
          </div>
        ))}
      </dl>
      <p className="footnote">Grouped by course code. SDU does not mark courses as major or minor.</p>
    </article>
  )
}

function TranscriptTab({ sduData, sduLoading, sduStatus, onConnect }) {
  const [semester, setSemester] = useState(null)
  const [view, setView] = useState('list')
  const transcript = sduData.transcript || []

  const groups = useMemo(() => {
    const bySem = {}
    transcript.forEach(c => {
      const key = c.semester != null ? String(c.semester) : '—'
      if (!bySem[key]) bySem[key] = []
      bySem[key].push(c)
    })
    return Object.keys(bySem)
      .sort((a, b) => (a === '—') - (b === '—') || Number(a) - Number(b))
      .map(key => {
        const courses = bySem[key]
        const gpa = calcGPA(courses)
        return {
          key,
          name: key === '—' ? 'Other' : `Sem ${key}`,
          courses,
          gpa: gpa != null ? Math.round(gpa * 100) / 100 : null,
          credits: courses.reduce((sum, c) => sum + Number(c.credits || c.ects || 0), 0),
        }
      })
  }, [transcript])

  if (!sduStatus?.connected) return <SduOnboardCard onConnect={onConnect} />
  if (sduLoading && !transcript.length) return <PageLoader label="Loading grades…" />

  const gpa = calcGPA(transcript)
  const credits = calcCompletedCredits(transcript)
  const passedCount = transcript.filter(c => c.passed === true).length
  const latest = [...groups].reverse().find(g => g.key !== '—')
  const selected = semester ?? latest?.key ?? 'all'
  const visible = selected === 'all' ? groups : groups.filter(g => g.key === selected)

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
    const link = document.createElement('a')
    link.setAttribute('href', encodeURI(csvContent))
    link.setAttribute('download', `SDU_Transcript_${sduData.profile?.student_id || 'student'}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="page page-fade">
      <section className="card summary-strip">
        <div>
          <span>GPA</span>
          <b>{gpa != null ? gpa.toFixed(2) : '—'}</b>
        </div>
        <div>
          <span>Credits</span>
          <b>{credits}<small>ECTS</small></b>
        </div>
        <div>
          <span>Passed</span>
          <b>{passedCount}<small>/ {transcript.length}</small></b>
        </div>
      </section>

      <div className="toolbar">
        <Segmented
          label="View"
          options={[{ id: 'list', label: 'Courses' }, { id: 'trend', label: 'Progress' }]}
          value={view}
          onChange={setView}
        />
        <div className="toolbar-end">
          {view === 'list' && groups.length > 1 && (
            <select className="select" value={selected} onChange={e => setSemester(e.target.value)} aria-label="Semester">
              <option value="all">All semesters</option>
              {groups.map(g => <option key={g.key} value={g.key}>{g.name.replace('Sem', 'Semester')}</option>)}
            </select>
          )}
          <button type="button" className="icon-btn" onClick={exportCSV} title="Export CSV" aria-label="Export CSV">
            <Icons.Download size={16} />
          </button>
        </div>
      </div>

      {view === 'trend' ? (
        <>
          <GpaTrendCard groups={groups} />
          <DegreeProgressCard transcript={transcript} />
        </>
      ) : !visible.length ? (
        <article className="card">
          <EmptyState icon={<Icons.Book size={20} />} title="No courses yet" text="Your transcript will appear after the first sync." />
        </article>
      ) : (
        visible.map(g => (
          <article key={g.key} className="card card-flush">
            <header className="group-head">
              <h2>{g.name.replace('Sem', 'Semester')}</h2>
              <span>{g.gpa != null ? `GPA ${g.gpa.toFixed(2)} · ` : ''}{g.credits} ECTS</span>
            </header>
            <ul className="course-list">
              {g.courses.map((c, idx) => {
                const score = c.grade_percent ?? c.grade
                return (
                  <li key={idx} className="course-row">
                    <div className="course-main">
                      <b>{c.course_name}</b>
                      <span>
                        {c.course_code} · {c.credits ?? c.ects ?? '—'} ECTS
                        {c.passed === false && <span className="tone-danger"> · Not passed</span>}
                      </span>
                    </div>
                    <span className="course-score">
                      {score != null ? (typeof score === 'number' ? `${score}%` : score) : '—'}
                    </span>
                    <span className={`grade tint-${gradeTone(c.letter_grade)}`}>{c.letter_grade || '—'}</span>
                  </li>
                )
              })}
            </ul>
          </article>
        ))
      )}
    </div>
  )
}

/* ─── ATTENDANCE TAB ─────────────────────────────────────────────── */
function AttendanceTab({ sduData, sduLoading, sduStatus, onConnect }) {
  const attendanceList = sduData?.attendance || []
  if (!sduStatus?.connected && !attendanceList.length) return <SduOnboardCard onConnect={onConnect} />
  if (sduLoading && !attendanceList.length) return <PageLoader label="Loading attendance…" />

  const list = [...attendanceList].sort((a, b) => absenceOf(b) - absenceOf(a))
  const overall = calcOverallAttendance(list)
  const over = list.filter(a => absenceOf(a) >= ABSENCE_LIMIT).length
  const near = list.filter(a => absenceOf(a) >= ABSENCE_WARN && absenceOf(a) < ABSENCE_LIMIT).length
  const overallStanding = attendanceStanding(overall)
  const meterMax = 30

  return (
    <div className="page page-fade">
      <section className="card att-summary">
        <div>
          <span className="metric-label">Overall attendance</span>
          <div className={`metric-value tone-${overallStanding.tone}`}>{overall}%</div>
        </div>
        <div className="att-summary-side">
          <Status tone={over ? 'danger' : near ? 'warning' : 'success'}>
            {over
              ? `${over} course${over > 1 ? 's' : ''} over the limit`
              : near
                ? `${near} course${near > 1 ? 's' : ''} close to the limit`
                : 'All courses within the limit'}
          </Status>
          <span className="muted">{list.length} courses tracked this term</span>
        </div>
      </section>

      <article className="card card-flush">
        <header className="group-head">
          <h2>By course</h2>
          <span>Absence · limit {ABSENCE_LIMIT}%</span>
        </header>
        {list.length ? (
          <ul className="att-list">
            {list.map((a, idx) => {
              const abs = absenceOf(a)
              const tone = absenceTone(abs)
              const code = a.lesson || a.course_code || ''
              const schedMatch = sduData?.schedule?.find(s => s.course_code === code || s.course_name?.includes(code))
              const transMatch = sduData?.transcript?.find(t => t.course_code === code)
              const fullName = schedMatch?.course_name || transMatch?.course_name || attendanceTitle(a)
              return (
                <li key={idx} className="att-row">
                  <div className="course-main">
                    <b>{fullName}</b>
                    <span>{code && code !== fullName ? `${code} · ` : ''}Term {a.term ?? '1'} · {a.year ?? '2026'}</span>
                  </div>
                  <div className="meter" aria-hidden="true">
                    <div className={`meter-fill fill-${tone}`} style={{ width: `${Math.min(100, (abs / meterMax) * 100)}%` }} />
                    <span className="meter-limit" style={{ left: `${(ABSENCE_LIMIT / meterMax) * 100}%` }} />
                  </div>
                  <span className={`att-value tone-${tone}`}>{abs}%</span>
                </li>
              )
            })}
          </ul>
        ) : sduData?.error ? (
          <div style={{ padding: '32px 16px', textAlign: 'center' }}>
            <div className="onboard-icon tint-warning" style={{ margin: '0 auto 12px auto' }}>
              <Icons.AlertTriangle size={24} />
            </div>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '1rem' }}>SDU Connection Issue</h3>
            <p className="muted" style={{ margin: '0 0 16px 0', fontSize: '0.85rem' }}>{sduData.error}</p>
            <button type="button" className="btn-primary" onClick={onConnect}>
              Reconnect SDU Platform
            </button>
          </div>
        ) : (
          <EmptyState icon={<Icons.Calendar size={20} />} title="No attendance records yet" text="SDU has not published absences for this term." />
        )}
      </article>

      <p className="footnote">
        Attendance is 100% minus absence. Missing more than {ABSENCE_LIMIT}% of a course puts it at risk of an FX grade.
      </p>
    </div>
  )
}

/* ─── INSIGHTS TAB (US-06 weak subjects · US-07 study plan) ──────── */
function nextWeekdaySlots(count = 5, times = ['10:00', '13:00', '15:00']) {
  const out = []
  const d = new Date()
  while (out.length < count * times.length) {
    d.setDate(d.getDate() + 1)
    const day = d.getDay()
    if (day === 0 || day === 6) continue
    const label = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
    times.forEach(t => out.push(`${label}, ${t}`))
  }
  return out
}

function TutoringModal({ token, courses, defaultCourse, onClose, onCreated }) {
  const slots = useMemo(() => nextWeekdaySlots(), [])
  const [course, setCourse] = useState(defaultCourse || courses[0] || '')
  const [time, setTime] = useState(slots[0])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async e => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      await api('/api/student/tutoring', token, { method: 'POST', body: JSON.stringify({ course, preferred_time: time, note: note || null }) })
      onCreated()
      onClose()
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h2>Request tutoring</h2>
            <p>Your teacher sees the request and confirms a time</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icons.Close size={18} /></button>
        </div>
        <div className="modal-body">
          <label>
            Course
            <select value={course} onChange={e => setCourse(e.target.value)}>
              {courses.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>
            Preferred time
            <select value={time} onChange={e => setTime(e.target.value)}>
              {slots.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label>
            What do you need help with? (optional)
            <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={300} />
          </label>
          {err && <div className="alert-box alert-danger">{err}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy || !course}>{busy ? 'Sending…' : 'Send request'}</button>
        </div>
      </form>
    </div>
  )
}

function InsightsTab({ token, sduStatus, onConnect }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [tutoringFor, setTutoringFor] = useState(null)

  const load = useCallback(() => {
    api('/api/student/insights', token)
      .then(setData)
      .catch(e => setErr(e.message))
  }, [token])

  useEffect(() => { load() }, [load])

  if (!sduStatus?.connected) return <SduOnboardCard onConnect={onConnect} />
  if (err) return <div className="page page-narrow"><div className="alert-box alert-danger">{err}</div></div>
  if (!data) return <PageLoader label="Analysing your grades…" />

  const toggle = async task => {
    setData(prev => ({
      ...prev,
      study_plan: (() => {
        const tasks = prev.study_plan.tasks.map(t => (t.id === task.id ? { ...t, done: !t.done } : t))
        const done = tasks.filter(t => t.done).length
        return { ...prev.study_plan, tasks, done, completion_rate: tasks.length ? Math.round((done / tasks.length) * 100) : null }
      })(),
    }))
    try {
      await api(`/api/student/study-tasks/${task.id}`, token, { method: 'POST', body: JSON.stringify({ done: !task.done }) })
    } catch {
      load()
    }
  }

  const weak = data.weak_subjects
  const plan = data.study_plan
  const courseNames = data.ranked.map(r => r.course)

  return (
    <div className="page page-fade">
      <section className="split">
        <article className="card card-flush">
          <header className="group-head">
            <h2>Subjects, weakest first</h2>
            <span>Weak below {data.threshold}%</span>
          </header>
          {data.ranked.length ? (
            <ul className="course-list">
              {data.ranked.map(r => (
                <li key={r.code + r.course} className="course-row">
                  <div className="course-main">
                    <b>
                      {r.course}
                      {r.weak && weak[0]?.course === r.course && <span className="tag tag-danger" style={{ marginLeft: 8 }}>#1 priority</span>}
                    </b>
                    <span>
                      {r.topic_gap
                        ? <>Weakest part: {r.topic_gap.name} · {r.topic_gap.score}%</>
                        : 'No assessment breakdown from SDU'}
                    </span>
                  </div>
                  <span className={`course-score ${r.weak ? 'tone-danger' : ''}`}>{r.score}%</span>
                  <span className={`dot dot-${r.weak ? 'danger' : r.score < 75 ? 'warning' : 'success'}`} style={{ justifySelf: 'end' }} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Icons.Book size={20} />} title="No grades this term yet" text="Subjects appear once grades are published." />
          )}
        </article>

        <article className="card">
          <header className="card-head">
            <h2>Study plan</h2>
            {plan.total > 0 && <span className="muted">{plan.done} / {plan.total} done</span>}
          </header>
          {weak.length ? (
            <>
              <ProgressBar pct={plan.completion_rate || 0} tone="success" />
              {weak.map(w => (
                <div key={w.course} className="plan-group">
                  <div className="plan-head">
                    <b>{w.course}</b>
                    <button type="button" className="link-btn" onClick={() => setTutoringFor(w.course)}>Request tutoring</button>
                  </div>
                  <ul className="task-list">
                    {plan.tasks.filter(t => t.course === w.course).map(t => (
                      <li key={t.id}>
                        <label className={`task ${t.done ? 'done' : ''}`}>
                          <input type="checkbox" checked={t.done} onChange={() => toggle(t)} />
                          <span>{t.text}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          ) : (
            <EmptyState icon={<Icons.CheckCircle size={20} />} title="No weak subjects" text={`Every graded course is at ${data.threshold}% or above.`} />
          )}
        </article>
      </section>

      {data.tutoring_requests.length > 0 && (
        <article className="card card-flush">
          <header className="group-head">
            <h2>Tutoring requests</h2>
            <button type="button" className="link-btn" onClick={() => setTutoringFor(courseNames[0] || '')}>New request</button>
          </header>
          <ul className="course-list">
            {data.tutoring_requests.map(r => (
              <li key={r.id} className="course-row request-row">
                <div className="course-main">
                  <b>{r.course}</b>
                  <span>{r.preferred_time}{r.note ? ` · ${r.note}` : ''}</span>
                </div>
                <Status tone="warning">Requested</Status>
              </li>
            ))}
          </ul>
        </article>
      )}

      {tutoringFor !== null && (
        <TutoringModal
          token={token}
          courses={courseNames.length ? courseNames : [tutoringFor]}
          defaultCourse={tutoringFor}
          onClose={() => setTutoringFor(null)}
          onCreated={load}
        />
      )}
    </div>
  )
}

/* ─── PROFILE TAB ────────────────────────────────────────────────── */
function SetPasswordModal({ token, studentId, onClose }) {
  const [pw, setPw]           = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow]       = useState(false)
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState('')
  const [done, setDone]       = useState(false)

  const submit = async e => {
    e.preventDefault()
    if (pw.length < 6) return setErr('Password must be at least 6 characters')
    if (pw !== confirm) return setErr('Passwords do not match')
    setBusy(true); setErr('')
    try {
      await api('/api/me/password', token, { method: 'POST', body: JSON.stringify({ new_password: pw }) })
      setDone(true)
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h2>Sign-in password</h2>
            <p>Use it with your Student ID on the sign-in page</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icons.Close size={18} /></button>
        </div>
        <div className="modal-body">
          {done ? (
            <div className="alert-box alert-success">
              <Icons.CheckCircle size={16} /> Saved. Sign in with {studentId || 'your Student ID'} and this password.
            </div>
          ) : (
            <>
              <label>
                New password
                <div style={{ position: 'relative' }}>
                  <input
                    type={show ? 'text' : 'password'}
                    value={pw}
                    onChange={e => setPw(e.target.value)}
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                    style={{ paddingRight: 44 }}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="input-btn-right"
                    onClick={() => setShow(v => !v)}
                    tabIndex={-1}
                    aria-label={show ? 'Hide password' : 'Show password'}
                  >
                    {show ? <Icons.EyeOff size={16} /> : <Icons.Eye size={16} />}
                  </button>
                </div>
              </label>
              <label>
                Confirm password
                <input
                  type={show ? 'text' : 'password'}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat password"
                  autoComplete="new-password"
                />
              </label>
              {err && <div className="alert-box alert-danger">{err}</div>}
            </>
          )}
        </div>
        <div className="modal-foot">
          {done ? (
            <button type="button" className="btn-primary" onClick={onClose}>Done</button>
          ) : (
            <>
              <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={busy || !pw || !confirm}>
                {busy ? 'Saving…' : 'Save password'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  )
}

function SduProfileTab({ sduData, sduLoading, sduStatus, onConnect, onDisconnect, onRefresh, user, token }) {
  const [showPassword, setShowPassword] = useState(false)

  if (!sduStatus?.connected) return <SduOnboardCard onConnect={onConnect} />

  const p = sduData.profile || {}
  const demo = !!sduStatus?.demo_mode

  return (
    <div className="page page-narrow page-fade">
      <article className="card">
        <div className="profile-head">
          <div className="avatar avatar-lg">{initials(p.fullname || user.name)}</div>
          <div>
            <h2>{p.fullname || user.name}</h2>
            <span className="muted">Student ID {p.student_id || user.student_id || '—'}</span>
          </div>
        </div>

        <dl className="kv">
          <div>
            <dt>Email</dt>
            <dd>{p.email || `${p.student_id || 'student'}@sdu.edu.kz`}</dd>
          </div>
          <div>
            <dt>Data source</dt>
            <dd><Status tone={demo ? 'warning' : 'success'}>{demo ? 'Demo data (SDU offline)' : 'SDU Platform'}</Status></dd>
          </div>
          <div>
            <dt>Last sync</dt>
            <dd>{sduData.lastFetched ? new Date(sduData.lastFetched).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</dd>
          </div>
          <div>
            <dt>Password sign-in</dt>
            <dd>
              <button type="button" className="link-btn" onClick={() => setShowPassword(true)}>
                Set password
              </button>
            </dd>
          </div>
        </dl>

        <footer className="card-foot">
          <button type="button" className="btn-ghost" onClick={onRefresh} disabled={sduLoading}>
            <Icons.Refresh size={15} className={sduLoading ? 'spinning' : ''} />
            {sduLoading ? 'Refreshing…' : 'Refresh data'}
          </button>
          <button type="button" className="btn-danger" onClick={onDisconnect}>
            Disconnect SDU
          </button>
        </footer>
      </article>

      {showPassword && (
        <SetPasswordModal
          token={token}
          studentId={p.student_id || user.student_id}
          onClose={() => setShowPassword(false)}
        />
      )}
    </div>
  )
}

/* ─── NOTIFICATIONS TAB ──────────────────────────────────────────── */
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

  if (error) return <div className="page page-narrow"><div className="alert-box alert-danger">{error}</div></div>
  if (!notifs) return <PageLoader label="Loading notifications…" />

  const unreadCount = notifs.filter(n => !n.read).length

  return (
    <div className="page page-narrow page-fade">
      <div className="toolbar">
        <span className="muted">{unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</span>
        {unreadCount > 0 && (
          <button type="button" className="btn-ghost btn-sm" onClick={markAll} disabled={marking}>
            <Icons.Check size={14} /> {marking ? 'Marking…' : 'Mark all read'}
          </button>
        )}
      </div>

      <article className="card card-flush">
        {notifs.length === 0 ? (
          <EmptyState icon={<Icons.CheckCircle size={20} />} title="You're all caught up" text="No academic warnings on your account." />
        ) : (
          <ul className="notif-list">
            {notifs.map(n => (
              <NotifRow key={n.id} n={n} onOpen={() => !n.read && markRead(n.id)}>
                {(notifTarget(n.type) || n.course) && (
                  <div className="notif-actions" onClick={e => e.stopPropagation()}>
                    {notifTarget(n.type) && (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => {
                          if (!n.read) markRead(n.id)
                          if (onSelectTab) onSelectTab(notifTarget(n.type).tab)
                        }}
                      >
                        {notifTarget(n.type).label}
                      </button>
                    )}
                    {n.course && (
                      <a className="link-btn" href={`mailto:advisor@sdu.edu.kz?subject=Regarding ${encodeURIComponent(n.course)}`}>
                        Contact advisor
                      </a>
                    )}
                  </div>
                )}
              </NotifRow>
            ))}
          </ul>
        )}
      </article>
    </div>
  )
}

/* ─── AVATAR DROPDOWN ─────────────────────────────────────────────── */
function AvatarMenu({ user, logout, token, onUpdateUser, onOpenProfile }) {
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
    <div className="popover-wrap" ref={ref}>
      <button
        type="button"
        className="avatar"
        onClick={() => setOpen(v => !v)}
        aria-label="User menu"
        aria-expanded={open}
      >
        {initials(user?.name)}
      </button>
      {open && (
        <div className="popover menu">
          <div className="menu-head">
            <b>{user?.name ?? 'User'}</b>
            <span>{user?.student_id ? `ID ${user.student_id}` : (user?.email ?? user?.id ?? '')}</span>
          </div>

          {editing ? (
            <form onSubmit={saveName} className="menu-form">
              <label htmlFor="display-name">Display name</label>
              <input
                id="display-name"
                className="input"
                type="text"
                value={nameVal}
                onChange={e => setNameVal(e.target.value)}
                autoFocus
              />
              <div className="menu-form-actions">
                <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
                <button type="submit" className="btn-primary btn-sm" disabled={saving || !nameVal.trim()}>
                  {saving ? 'Saving…' : (msg || 'Save')}
                </button>
              </div>
            </form>
          ) : (
            <>
              {onOpenProfile && (
                <button type="button" className="menu-item" onClick={() => { setOpen(false); onOpenProfile() }}>
                  <Icons.User size={15} /> Profile
                </button>
              )}
              <button type="button" className="menu-item" onClick={() => { setEditing(true); setNameVal(user?.name || '') }}>
                <Icons.Edit size={15} /> Edit name
              </button>
            </>
          )}

          <div className="menu-sep" />
          <button type="button" className="menu-item danger" onClick={() => { setOpen(false); logout() }}>
            <Icons.SignOut size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

/* ─── STUDENT SHELL ──────────────────────────────────────────────── */
const STUDENT_NAV = [
  { id: 'dashboard',  label: 'Overview',   icon: Icons.Home },
  { id: 'schedule',   label: 'Schedule',   icon: Icons.Calendar },
  { id: 'transcript', label: 'Grades',     icon: Icons.Book },
  { id: 'attendance', label: 'Attendance', icon: Icons.CheckCircle },
  { id: 'insights',   label: 'Insights',   icon: Icons.Target },
]

function Brand({ subtitle }) {
  return (
    <div className="brand">
      <div className="brand-mark">S</div>
      <div className="brand-text">
        <b>StudyMate</b>
        {subtitle && <span>{subtitle}</span>}
      </div>
    </div>
  )
}

function Student({ token, user, logout, onUpdateUser, theme, toggleTheme }) {
  const [tab, setTab] = useState('dashboard')
  const [unread, setUnread] = useState(0)
  const [showWhatIf, setShowWhatIf] = useState(false)

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

  // Unread count for the bell badge
  const refreshUnread = useCallback(() => {
    api('/api/student/notifications', token)
      .then(d => setUnread(d.unread_count))
      .catch(() => {})
  }, [token])

  useEffect(() => { refreshUnread() }, [refreshUnread])

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
        api('/api/sdu/attendance?year=2026&term=1', token),
      ])

      const prof = profRes.status === 'fulfilled' ? profRes.value : null
      const sched = schedRes.status === 'fulfilled' ? (Array.isArray(schedRes.value) ? schedRes.value : (schedRes.value?.schedule || schedRes.value?.items || [])) : []
      const trans = transRes.status === 'fulfilled' ? (Array.isArray(transRes.value) ? transRes.value : (transRes.value?.courses || transRes.value?.transcript || [])) : []
      const att = attRes.status === 'fulfilled' ? (Array.isArray(attRes.value) ? attRes.value : (attRes.value?.attendance || attRes.value?.items || attRes.value?.data || [])) : []
      const lastF = prof?.fetched_at || schedRes.value?.fetched_at || transRes.value?.fetched_at || new Date().toISOString()

      // Check for reconnect requirement
      const anyErr = [profRes, schedRes, transRes, attRes].find(r => r.status === 'rejected')
      if (anyErr && anyErr.reason) {
        const errMsg = String(anyErr.reason.message || '').toLowerCase()
        if (errMsg.includes('expired') || errMsg.includes('reconnect') || errMsg.includes('2fa')) {
          setSduStatus({ connected: false })
        }
      }

      setSduData(prev => ({
        profile: prof || prev.profile,
        schedule: sched.length ? sched : prev.schedule,
        transcript: trans.length ? trans : prev.transcript,
        attendance: attRes.status === 'fulfilled' ? att : prev.attendance,
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
    let cancelled = false
    ;(async () => {
      const status = await checkSduStatus()
      if (cancelled || !status?.connected) return
      loadSduLiveData()
      // Background sync (server throttles to every 10 min) turns SDU changes into notifications
      try {
        const res = await api('/api/sdu/sync?auto=true', token, { method: 'POST' })
        if (!cancelled && res?.new_notifications) refreshUnread()
      } catch (e) {
        if (!cancelled && /reconnect|expired/i.test(e.message || '')) setSduStatus({ connected: false })
      }
    })()
    return () => { cancelled = true }
  }, [checkSduStatus, loadSduLiveData, refreshUnread, token])

  const showToast = (text, ms = 3500) => {
    setSduToast(text)
    setTimeout(() => setSduToast(''), ms)
  }

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
      setSduStatus(prev => ({ ...prev, connected: true, demo_mode: res.demo_mode ?? prev.demo_mode, updated_at: res.updated_at }))
      await loadSduLiveData()
      refreshUnread()
      showToast(res.new_notifications ? `Synced · ${res.new_notifications} new update${res.new_notifications > 1 ? 's' : ''}` : (res.demo_mode ? 'Demo data updated' : 'Synced with SDU'))
    } catch (e) {
      if (e.message && (e.message.includes('reconnect') || e.message.includes('expired'))) {
        setSduStatus({ connected: false })
      }
      showToast(e.message || 'Sync failed', 4000)
    } finally {
      setSduLoading(false)
    }
  }

  const handleSduDisconnect = async () => {
    if (!window.confirm('Are you sure you want to disconnect your SDU Platform account?')) return
    try {
      await api('/api/sdu/disconnect', token, { method: 'POST' })
      setSduStatus({ connected: false, demo_mode: false })
      setSduData({ profile: null, schedule: null, transcript: null, attendance: null, lastFetched: null, error: null })
      setTab('dashboard')
      showToast('SDU account disconnected')
    } catch (e) {
      alert(e.message || 'Disconnect failed')
    }
  }

  const connected = !!sduStatus?.connected
  const firstName = (sduData.profile?.fullname || user.name || '').split(' ')[0]
  const classCount = sduData.schedule?.length || 0
  const courseCount = sduData.transcript?.length || 0
  const pageTitles = {
    dashboard:  [`Good ${timeOfDay()}, ${firstName}`, fmtDate()],
    schedule:   ['Schedule', connected && classCount ? `${classCount} classes a week` : null],
    transcript: ['Grades', connected && courseCount ? `${courseCount} courses on your transcript` : null],
    attendance: ['Attendance', connected ? 'How much of each course you have attended' : null],
    insights:   ['Insights', connected ? 'What to focus on this term' : null],
    profile:    ['Profile', null],
    alerts:     ['Notifications', null],
  }
  const [title, subtitle] = pageTitles[tab] || pageTitles.dashboard

  const syncedAt = sduData.lastFetched
    ? new Date(sduData.lastFetched).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand subtitle="SDU student" />

        <nav className="side-nav" aria-label="Main">
          {STUDENT_NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`side-link ${tab === id ? 'active' : ''}`}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="side-group">
          <span className="side-label">Tools</span>
          <button type="button" className="side-link" onClick={() => setShowWhatIf(true)}>
            <Icons.Sliders size={18} />
            <span>What-if planner</span>
          </button>
          <button
            type="button"
            className={`side-link ${tab === 'profile' ? 'active' : ''}`}
            onClick={() => setTab('profile')}
          >
            <Icons.User size={18} />
            <span>Profile</span>
          </button>
        </div>

        <div className="side-foot">
          {connected ? (
            <div className="sync-row">
              <div className="sync-text">
                <Status tone={sduStatus?.demo_mode ? 'warning' : 'success'}>
                  {sduStatus?.demo_mode ? 'Demo data' : 'SDU connected'}
                </Status>
                {syncedAt && <small>Updated {syncedAt}</small>}
              </div>
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                onClick={handleSduSync}
                disabled={sduLoading}
                title="Sync with SDU"
                aria-label="Sync with SDU"
              >
                <Icons.Refresh size={15} className={sduLoading ? 'spinning' : ''} />
              </button>
            </div>
          ) : (
            <button type="button" className="btn-primary btn-block" onClick={handleSduConnect}>
              Connect SDU
            </button>
          )}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="icon-btn mobile-only"
              onClick={() => setShowWhatIf(true)}
              title="What-if planner"
              aria-label="What-if planner"
            >
              <Icons.Sliders size={18} />
            </button>
            {toggleTheme && <ThemeToggle theme={theme} toggleTheme={toggleTheme} />}
            <NotificationsDropdown
              token={token}
              unread={unread}
              onUnreadChange={setUnread}
              onSelectTab={setTab}
            />
            <AvatarMenu
              user={user}
              logout={logout}
              token={token}
              onUpdateUser={onUpdateUser}
              onOpenProfile={() => setTab('profile')}
            />
          </div>
        </header>

        <main className="content">
          {tab === 'dashboard'  && <DashboardTab sduData={sduData} sduLoading={sduLoading} sduStatus={sduStatus} onConnect={handleSduConnect} setTab={setTab} token={token} />}
          {tab === 'schedule'   && <ScheduleTab  sduData={sduData} sduLoading={sduLoading} sduStatus={sduStatus} onConnect={handleSduConnect} />}
          {tab === 'transcript' && <TranscriptTab sduData={sduData} sduLoading={sduLoading} sduStatus={sduStatus} onConnect={handleSduConnect} />}
          {tab === 'insights'   && <InsightsTab token={token} sduStatus={sduStatus} onConnect={handleSduConnect} />}
          {tab === 'attendance' && <AttendanceTab sduData={sduData} sduLoading={sduLoading} sduStatus={sduStatus} onConnect={handleSduConnect} />}
          {tab === 'profile'    && <SduProfileTab sduData={sduData} sduLoading={sduLoading} sduStatus={sduStatus} onConnect={handleSduConnect} onDisconnect={handleSduDisconnect} onRefresh={loadSduLiveData} user={user} token={token} />}
          {tab === 'alerts'     && <AlertsTab    token={token} onUnreadChange={setUnread} onSelectTab={setTab} />}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Main">
        {STUDENT_NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`bottom-link ${tab === id ? 'active' : ''}`}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {sduToast && (
        <div className="toast" role="status">
          <Icons.CheckCircle size={16} />
          {sduToast}
        </div>
      )}

      {showWhatIf && (
        <WhatIfModal
          token={token}
          courses={sduData.transcript || []}
          onClose={() => setShowWhatIf(false)}
        />
      )}
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
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-head">
          <div>
            <h2>{data?.student?.name ?? 'Student'}</h2>
            <p>{studentId}{data?.student?.cohort ? ` · ${data.student.cohort}` : ''}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icons.Close size={18} /></button>
        </div>
        <div className="modal-body modal-scroll">
          {loading ? (
            <PageLoader label="Loading student…" />
          ) : data ? (
            <>
              <div className="mini-stats">
                <div>
                  <span>Attendance</span>
                  <b className={`tone-${data.attendance < 75 ? 'danger' : 'success'}`}>{data.attendance}%</b>
                </div>
                <div>
                  <span>Risk signals</span>
                  <b className={`tone-${data.risk_factors.length ? 'danger' : 'success'}`}>{data.risk_factors.length || 'None'}</b>
                </div>
              </div>

              {data.risk_factors.length > 0 && (
                <ul className="risk-list">
                  {data.risk_factors.map((r, i) => (
                    <li key={i}>
                      <span className="dot dot-danger" />
                      {r.detail}{r.courses?.length ? ` (${r.courses.join(', ')})` : ''}
                    </li>
                  ))}
                </ul>
              )}

              {data.tutoring_requests?.length > 0 && (
                <>
                  <h3 className="section-title">Tutoring requests</h3>
                  <ul className="plain-list">
                    {data.tutoring_requests.map(r => (
                      <li key={r.id}>
                        <span><b>{r.course}</b> <span className="muted">{r.preferred_time}{r.note ? ` · ${r.note}` : ''}</span></span>
                        <Status tone="warning">Requested</Status>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <h3 className="section-title">Courses this term</h3>
              <ul className="plain-list">
                {data.courses.map((c, i) => (
                  <li key={i}>
                    <span><b>{c.course}</b> <span className="muted">{c.code}</span></span>
                    <b>{c.score !== null ? `${c.score}%` : 'In progress'}</b>
                  </li>
                ))}
              </ul>

              <h3 className="section-title">Add a note</h3>
              <form onSubmit={submitIntervention} className="form-stack">
                <label>
                  Type
                  <select value={actionType} onChange={e => setActionType(e.target.value)}>
                    <option value="Consultation Request">Academic Consultation Request</option>
                    <option value="Tutoring Referral">Tutoring Center Referral</option>
                    <option value="Attendance Warning">Formal Attendance Warning</option>
                    <option value="Commendation">Academic Commendation</option>
                  </select>
                </label>
                <label>
                  Note
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="What should the student do next?"
                  />
                </label>
                {msg && <div className="alert-box alert-success"><Icons.CheckCircle size={15} /> {msg}</div>}
                {err && <div className="alert-box alert-danger">{err}</div>}
                <button type="submit" className="btn-primary" disabled={!notes.trim() || submitting} style={{ alignSelf: 'flex-start' }}>
                  {submitting ? 'Sending…' : <><Icons.Send size={15} /> Send note</>}
                </button>
              </form>

              {interventions.length > 0 && (
                <>
                  <h3 className="section-title">History · {interventions.length}</h3>
                  {interventions.map((inv, i) => (
                    <div className="intervention-item" key={i}>
                      <div className="intervention-head">
                        <span>{inv.action_type}</span>
                        <span>{new Date(inv.created_at).toLocaleDateString()}</span>
                      </div>
                      <p className="intervention-notes">{inv.notes}</p>
                    </div>
                  ))}
                </>
              )}
            </>
          ) : err ? (
            <div className="alert-box alert-danger">{err}</div>
          ) : null}
        </div>
        <div className="modal-foot">
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

  if (!students || !analytics) return <PageLoader label="Loading your students…" />

  const atRisk = students.filter(s => s.risk_factors.length)
  const avgAtt = students.length
    ? (students.reduce((a, s) => a + s.attendance, 0) / students.length).toFixed(1)
    : '—'

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
    const link = document.createElement('a')
    link.setAttribute('href', encodeURI(csvContent))
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
    <div className="page page-fade">
      <section className="metric-grid">
        <Metric label="Students" value={students.length} foot={<span className="muted">In your scope</span>} />
        <Metric
          label="At risk"
          value={atRisk.length}
          foot={<Status tone={atRisk.length ? 'danger' : 'success'}>{atRisk.length ? 'Need follow-up' : 'Nobody at risk'}</Status>}
        />
        <Metric label="Avg. attendance" value={`${avgAtt}%`} foot={<span className="muted">Across the cohort</span>} />
      </section>

      <div className="toolbar">
        <Segmented
          label="Filter students"
          options={[
            { id: 'all', label: `All ${students.length}` },
            { id: 'risk', label: `At risk ${atRisk.length}` },
            { id: 'good', label: `Good ${students.length - atRisk.length}` },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <div className="toolbar-end">
          <div className="search">
            <Icons.Search size={15} />
            <input
              type="text"
              className="input"
              placeholder="Search name or ID"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Search students"
            />
          </div>
          <button type="button" className="icon-btn" onClick={exportClassRosterCSV} title="Export roster (CSV)" aria-label="Export roster (CSV)">
            <Icons.Download size={16} />
          </button>
        </div>
      </div>

      <section className="teacher-grid">
        <article className="card card-flush">
          <header className="group-head">
            <h2>Watchlist</h2>
            <span>Select a student to add a note</span>
          </header>
          {filteredStudents.length ? (
            <ul className="student-list">
              {filteredStudents.map(s => (
                <li key={s.id}>
                  <button type="button" className="student-row" onClick={() => setSelectedStudent(s.id)}>
                    <span className="avatar avatar-sm">{initials(s.name)}</span>
                    <span className="course-main">
                      <b>{s.name}</b>
                      <span>{s.id} · {s.cohort}</span>
                    </span>
                    <span className="student-risk">
                      {s.risk_factors.length
                        ? <Status tone="danger">{s.risk_factors[0].detail}{s.risk_factors.length > 1 ? ` +${s.risk_factors.length - 1}` : ''}</Status>
                        : <Status tone="success">No risk signals</Status>}
                    </span>
                    <span className={`att-value tone-${s.attendance < 75 ? 'danger' : 'success'}`}>{s.attendance}%</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No students match" text="Try a different search or filter." />
          )}
        </article>

        <article className="card">
          <header className="card-head">
            <h2>Attendance vs grade</h2>
            <span className="muted">r = {analytics.correlation}</span>
          </header>
          <ResponsiveContainer width="100%" height={220}>
            <ScatterChart margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" />
              <XAxis dataKey="attendance" name="Attendance" unit="%" domain={[50, 100]} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
              <YAxis dataKey="average_grade" name="Grade" unit="%" domain={[40, 100]} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} />
              <Scatter data={analytics.points} fill="var(--accent)" />
            </ScatterChart>
          </ResponsiveContainer>
          <p className="footnote">{analytics.note}</p>
        </article>
      </section>

      {selectedStudent && (
        <TeacherStudentModal
          studentId={selectedStudent}
          token={token}
          onClose={() => setSelectedStudent(null)}
        />
      )}
    </div>
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
          <div className="onboard-icon tint-danger"><Icons.AlertTriangle size={24} /></div>
          <h2>Couldn't connect to SDU</h2>
          <p>{errorMsg}</p>
          <div>
            <button
              type="button"
              className="btn-primary btn-lg"
              onClick={() => {
                window.history.replaceState({}, '', '/')
                window.location.href = '/'
              }}
            >
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="sdu-callback-container">
      <div className="sdu-callback-card">
        <div className="spinner spinner-lg" />
        <h2>Connecting to SDU…</h2>
        <p>Syncing your grades, schedule and attendance.</p>
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
      <div className="shell shell-single">
        <div className="main">
          <header className="topbar">
            <div className="topbar-lead">
              <Brand />
              <div className="topbar-title">
                <h1>Class overview</h1>
                <p>Students in your scope and their risk signals</p>
              </div>
            </div>
            <div className="topbar-actions">
              <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
              <AvatarMenu user={session.user} logout={logout} token={session.access_token} onUpdateUser={updateUser} />
            </div>
          </header>
          <main className="content">
            <Teacher token={session.access_token} user={session.user} logout={logout} />
          </main>
        </div>
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

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("StudyMate ErrorBoundary caught unhandled error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg, #0F172A)',
          color: 'var(--text, #F8FAFC)',
          padding: 24,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}>
          <div style={{
            maxWidth: 480,
            width: '100%',
            background: 'var(--surface, #1E293B)',
            border: '1px solid var(--border, #334155)',
            borderRadius: 16,
            padding: 32,
            textAlign: 'center',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
          }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#EF4444',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px auto'
            }}>
              <Icons.AlertTriangle size={28} />
            </div>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 700, margin: '0 0 10px 0' }}>Something went wrong</h2>
            <p style={{ color: 'var(--text-secondary, #94A3B8)', fontSize: '0.9rem', lineHeight: 1.5, margin: '0 0 24px 0' }}>
              StudyMate encountered an unexpected display error. Your academic data is safe on the server.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                type="button"
                onClick={this.handleReset}
                className="btn-ghost"
                style={{ padding: '10px 18px', borderRadius: 10, cursor: 'pointer' }}
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="btn-primary"
                style={{ padding: '10px 20px', borderRadius: 10, cursor: 'pointer' }}
              >
                Reload Portal
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
