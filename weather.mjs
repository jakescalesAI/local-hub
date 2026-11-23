// Weather for the hub's weather widget (Home, and the TV's screensaver): now, today's high and low, and the next days.
//
// Where: the laptop's approximate place, found once from its public IP (ipapi.co) and kept in data/weather.json,
// so it isn't asked again. The forecast comes from Open-Meteo (free, no account), kept for 15 minutes.
//   GET /api/tv/weather -> { place, unit, now: { temp, code, text, day }, high, low, days: [{ date, high, low, code, text }] }
import fs from 'node:fs'
import path from 'node:path'

const FRESH = 15 * 60_000
const FAHRENHEIT = new Set(['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW'])

// Open-Meteo's WMO weather codes, in words.
const TEXT = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog',
  51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorms', 96: 'Thunderstorms', 99: 'Thunderstorms',
}
export const weatherText = code => TEXT[code] || 'Weather'

export function create({ here, fetchImpl = fetch } = {}) {
  const file = path.join(here, 'data', 'weather.json')
  let forecast = null // { at, body }
  let pending = null

  async function place() {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (Number.isFinite(saved?.lat) && Number.isFinite(saved?.lon)) return saved
    } catch { /* not found yet */ }
    const r = await fetchImpl('https://ipapi.co/json/', { headers: { accept: 'application/json', 'user-agent': 'LocalHub' }, signal: AbortSignal.timeout(8000) })
    if (!r.ok) throw new Error(`location lookup answered ${r.status}`)
    const j = await r.json()
    if (!Number.isFinite(j.latitude) || !Number.isFinite(j.longitude)) throw new Error('location lookup gave no place')
    const p = { name: j.city || j.region || j.country_name || 'Here', country: j.country_code || '', lat: j.latitude, lon: j.longitude, at: Date.now() }
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(p, null, 2)) } catch { /* kept in memory only */ }
    return p
  }

  async function load() {
    const p = await place()
    const unit = FAHRENHEIT.has(p.country) ? 'fahrenheit' : 'celsius'
    const q = new URLSearchParams({
      latitude: String(p.lat), longitude: String(p.lon), timezone: 'auto', forecast_days: '5', temperature_unit: unit,
      current: 'temperature_2m,weather_code,is_day', daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    })
    const r = await fetchImpl(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) throw new Error(`forecast answered ${r.status}`)
    const j = await r.json()
    const d = j.daily || {}
    const days = (d.time || []).map((date, i) => ({ date, high: Math.round(d.temperature_2m_max[i]), low: Math.round(d.temperature_2m_min[i]), code: d.weather_code[i], text: weatherText(d.weather_code[i]) }))
    return {
      place: p.name, unit: unit === 'fahrenheit' ? 'F' : 'C',
      now: { temp: Math.round(j.current?.temperature_2m), code: j.current?.weather_code, text: weatherText(j.current?.weather_code), day: j.current?.is_day !== 0 },
      high: days[0]?.high, low: days[0]?.low, days, at: Date.now(),
    }
  }

  return async function weather() {
    if (forecast && Date.now() - forecast.at < FRESH) return forecast.body
    if (!pending) pending = load().then(body => { forecast = { at: Date.now(), body }; return body }).finally(() => { pending = null })
    try { return await pending } catch (e) { if (forecast) return forecast.body; throw e }
  }
}
