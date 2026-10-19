/* ─── Schedule items from SDU ──────────────────────────────────────────
 * SDU accounts do not all return the same row shape: some rows carry a
 * weekday name, some a day number, and some only a "times" string such as
 * "1.08:30,3.10:30" (day.start per 50-minute period, as the SDU portal uses).
 * Everything is normalized to day_of_week 1 (Mon) … 7 (Sun); rows whose day
 * cannot be read get UNKNOWN_DAY and must still be shown, never dropped.
 */

export const UNKNOWN_DAY = 9
const PERIOD_MINUTES = 50

const DAY_NAMES = [
  ['mon', 'monday', 'пн', 'понедельник', 'дүйсенбі'],
  ['tue', 'tuesday', 'вт', 'вторник', 'сейсенбі'],
  ['wed', 'wednesday', 'ср', 'среда', 'сәрсенбі'],
  ['thu', 'thursday', 'чт', 'четверг', 'бейсенбі'],
  ['fri', 'friday', 'пт', 'пятница', 'жұма'],
  ['sat', 'saturday', 'сб', 'суббота', 'сенбі'],
  ['sun', 'sunday', 'вс', 'воскресенье', 'жексенбі'],
]
const DAY_BY_NAME = Object.fromEntries(DAY_NAMES.flatMap((names, i) => names.map(n => [n, i + 1])))

function dayFrom(value) {
  if (value == null || value === '') return null
  const text = String(value).toLowerCase().trim().replace(/\.$/, '')
  if (/^[1-7]$/.test(text)) return Number(text)
  return DAY_BY_NAME[text] || null
}

export function getDayOrder(s) {
  for (const key of ['day_of_week', 'weekday', 'day', 'day_number']) {
    const day = dayFrom(s?.[key])
    if (day) return day
  }
  return UNKNOWN_DAY
}

const pickTime = v => (String(v || '').match(/\d{1,2}:\d{2}/) || [''])[0]

export function classTimes(s) {
  if (s.start_time || s.end_time) return [pickTime(s.start_time), pickTime(s.end_time)]
  const parts = String(s.times || '').match(/\d{1,2}:\d{2}/g) || []
  return [parts[0] || '', parts[1] || '']
}

export function getStartTimeMinutes(s) {
  const m = classTimes(s)[0].match(/(\d{1,2}):(\d{2})/)
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 9999
}

function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 60 + m + minutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// "1.08:30,3.10:30" → one row per period with its own day and times
function expandTimes(s) {
  const slots = [...String(s.times || '').matchAll(/([1-7])\.(\d{1,2}):(\d{2})/g)]
  if (!slots.length) return [s]
  return slots.map(([, day, h, m]) => {
    const start = `${h.padStart(2, '0')}:${m}`
    return { ...s, day_of_week: Number(day), start_time: start, end_time: addMinutes(start, PERIOD_MINUTES) }
  })
}

export function normalizeSchedule(list) {
  if (!Array.isArray(list)) return []
  return list
    .filter(s => s && typeof s === 'object')
    .flatMap(s => (getDayOrder(s) === UNKNOWN_DAY ? expandTimes(s) : [s]))
}

export function classLocation(s) {
  if (s.room) return `${s.building ? `${s.building}, ` : ''}Room ${s.room}`
  return s.is_online ? 'Online' : 'SDU Campus'
}

export function sortSchedule(list = []) {
  return [...list].sort((a, b) => getDayOrder(a) - getDayOrder(b) || getStartTimeMinutes(a) - getStartTimeMinutes(b))
}

export function findNextClass(schedule = [], now = new Date()) {
  const sorted = sortSchedule(schedule || []).filter(c => getDayOrder(c) !== UNKNOWN_DAY)
  if (!sorted.length) return null
  const todayDay = now.getDay() || 7 // 1: Mon ... 7: Sun
  const currentMinutes = now.getHours() * 60 + now.getMinutes()

  // A class today that starts later or started less than 20 minutes ago
  const upcomingToday = sorted.find(c => getDayOrder(c) === todayDay && getStartTimeMinutes(c) >= currentMinutes - 20)
  if (upcomingToday) return { course: upcomingToday, isToday: true }

  const laterThisWeek = sorted.find(c => getDayOrder(c) > todayDay)
  // Wrap around to the beginning of the week
  return { course: laterThisWeek || sorted[0], isToday: false }
}

// Merge back-to-back periods of the same class (e.g. 14:30–15:20 and 15:30–16:20 in the same room)
export function mergeBlocks(items) {
  const out = []
  for (const s of items) {
    const prev = out[out.length - 1]
    const [start, end] = classTimes(s)
    if (prev && getDayOrder(prev) === getDayOrder(s) && prev.course_code === s.course_code &&
        prev.lesson_type === s.lesson_type && classLocation(prev) === classLocation(s)) {
      const gap = getStartTimeMinutes({ start_time: start }) - getStartTimeMinutes({ start_time: prev._end })
      if (gap >= 0 && gap <= 15) {
        prev._end = end || prev._end
        prev._parts.push(s)
        continue
      }
    }
    out.push({ ...s, _start: start, _end: end, _parts: [s] })
  }
  return out
}
