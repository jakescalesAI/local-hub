// weather.mjs: the place is looked up once and kept; the forecast is kept 15 minutes; °F in the US.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { create, weatherText } from '../../weather.mjs'

function fakeFetch(calls, { country = 'US' } = {}) {
  return async (url) => {
    calls.push(String(url))
    if (String(url).startsWith('https://ipapi.co/')) return { ok: true, json: async () => ({ city: 'Plainfield', country_code: country, latitude: 41.6, longitude: -88.2 }) }
    return {
      ok: true,
      json: async () => ({
        current: { temperature_2m: 39.6, weather_code: 3, is_day: 1 },
        daily: { time: ['2026-11-23', '2026-11-24'], weather_code: [3, 61], temperature_2m_max: [41.2, 38], temperature_2m_min: [30.1, 29.6] },
      }),
    }
  }
}

test('weather finds the place once, then keeps the forecast for 15 minutes', async () => {
  const here = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-wx-'))
  const calls = []
  const w = create({ here, fetchImpl: fakeFetch(calls) })
  const a = await w()
  assert.equal(a.place, 'Plainfield')
  assert.equal(a.unit, 'F')
  assert.deepEqual(a.now, { temp: 40, code: 3, text: 'Cloudy', day: true })
  assert.equal(a.high, 41)
  assert.equal(a.low, 30)
  assert.equal(a.days[1].text, 'Light rain')
  assert.match(calls[1], /temperature_unit=fahrenheit/)
  await w()
  assert.equal(calls.length, 2, 'the second call is served from memory')
  const saved = JSON.parse(fs.readFileSync(path.join(here, 'data', 'weather.json'), 'utf8'))
  assert.equal(saved.name, 'Plainfield')
  // A new hub (restart) keeps the place and only asks for the forecast.
  const calls2 = []
  await create({ here, fetchImpl: fakeFetch(calls2) })()
  assert.equal(calls2.length, 1)
  assert.ok(calls2[0].startsWith('https://api.open-meteo.com/'))
})

test('weather is in °C outside the US, and codes read as words', async () => {
  const here = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-wx-'))
  const calls = []
  const a = await create({ here, fetchImpl: fakeFetch(calls, { country: 'GB' }) })()
  assert.equal(a.unit, 'C')
  assert.match(calls[1], /temperature_unit=celsius/)
  assert.equal(weatherText(95), 'Thunderstorms')
  assert.equal(weatherText(1234), 'Weather')
})
