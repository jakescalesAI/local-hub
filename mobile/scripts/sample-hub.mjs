// A throwaway Hub with made-up data, for store pictures: a copy of this repo's Hub in a temp folder, its own
// config/ and data/, and a pretend home folder. Nothing in it is anyone's: the user is "Sam", the clients and
// shops are invented, links point at example.com. It never touches the Hub you run.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
// Hub files only: no app, no tests, no site, and never a real config/ or data/.
const SKIP = new Set(['.git', '.github', 'mobile', 'config', 'data', 'node_modules', 'site', 'site-review', 'test'])

// A time zone where it is about 9 in the morning now, so today's sample events are still ahead: the Hub hides
// events that have passed by its own clock. Etc/GMT names count the other way round: Etc/GMT-5 is UTC+5.
export function morningZone(now = new Date()) {
  const offset = ((9 - now.getUTCHours() + 36) % 24) - 12
  return { offset, zone: offset >= 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}` }
}

const pad = n => String(n).padStart(2, '0')

export function makeSampleHub({ source = REPO, now = new Date() } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-hub-'))
  const hub = path.join(root, 'hub')
  const home = path.join(root, 'home')
  fs.mkdirSync(hub)
  for (const name of fs.readdirSync(source)) if (!SKIP.has(name)) fs.cpSync(path.join(source, name), path.join(hub, name), { recursive: true })
  fs.cpSync(path.join(source, 'config.example'), path.join(hub, 'config'), { recursive: true })
  const json = (rel, value) => {
    fs.mkdirSync(path.dirname(path.join(hub, rel)), { recursive: true })
    fs.writeFileSync(path.join(hub, rel), JSON.stringify(value, null, 2))
  }
  const hubConfig = JSON.parse(fs.readFileSync(path.join(hub, 'config', 'hub.json'), 'utf8'))
  // Only the local calendar: the example's file source points nowhere and would show an error. With no source
  // the Calendar add-on wouldn't turn itself on, so it is on outright.
  json('config/hub.json', { ...hubConfig, name: 'Sam\'s Hub', owner: '', access: 'localhost', addons: { ...hubConfig.addons, calendar: true }, calendar: { ...hubConfig.calendar, sources: [] } })

  // The sample day, in the morning zone.
  const { offset, zone } = morningZone(now)
  const local = new Date(now.getTime() + offset * 3600e3)
  const day = d => {
    const t = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + d))
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
  }
  const zoneOffset = `${offset < 0 ? '-' : '+'}${pad(Math.abs(offset))}:00`
  const at = (d, time) => `${day(d)}T${time}:00${zoneOffset}`
  const clock = Date.parse(at(0, '09:41'))
  const lastMonth = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })

  // Padded to a believable size: a list of 6-byte files looks made up.
  const file = (rel, text = '', size = 0) => {
    fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true })
    fs.writeFileSync(path.join(home, rel), text.padEnd(size, ' '))
  }
  const inv = 'Documents/Invoices/'
  for (const n of ['0141', '0142', '0143']) file(`${inv}invoice-${n}.pdf`, `%PDF-1.4\n% sample invoice ${n}\n`, 46_000 + Number(n) * 310)
  file(`${inv}Invoice template.docx`, 'sample', 18_400)
  file(`${inv}tracker.csv`, 'number,client,amount,paid\n0141,Maple Street Bakery,480.00,yes\n0142,Harbor Yoga,1250.00,no\n0143,Juniper Print Co.,640.00,no\n', 2_100)
  file(`${inv}reminder-0142.md`, 'A quick reminder that invoice 0142 ($1,250.00) is now past due.\n')
  file('Documents/Receipts/receipts.csv', 'shop,amount\nPaper & Ink,23.40\nCorner Hardware,58.10\n')
  file('Documents/Taxes/checklist.md', '# Taxes\n- [x] Receipts in one folder\n- [ ] Quarterly estimate\n')
  file('Documents/Recipes/Lemon bars.md', '# Lemon bars\n')
  file('Documents/Work/Design review notes.md', '# Design review\n')
  file('Desktop/To do.txt', `Send ${lastMonth} invoices\nCall Harbor Yoga\n`)
  for (const dir of ['Downloads', 'Music', 'Pictures', 'Videos']) fs.mkdirSync(path.join(home, dir), { recursive: true })

  json('data/launcher.json', {
    links: [
      { id: 'l1', name: 'Invoice template', kind: 'web', url: 'https://docs.example.com/invoice-template' },
      { id: 'l2', name: 'Team wiki', kind: 'web', url: 'https://wiki.example.com' },
      { id: 'l3', name: 'Tracker', kind: 'web', url: 'https://tracker.example.org' },
    ],
    snippets: [
      { id: 's1', name: 'Invoice reply', text: 'Thanks! Invoice attached, due in 14 days.', keyword: 'invr' },
      { id: 's2', name: 'Out of office', text: 'I\'m away until Monday and will reply then.', keyword: 'ooo' },
    ],
    usage: {},
  })
  const event = (n, title, d, start, end, location = '') => ({ id: `l${String(n).padStart(12, '0')}`, title, allDay: false, start: at(d, start), end: at(d, end), location, notes: '' })
  json('data/calendar.json', {
    label: 'Local',
    color: '#0a84ff',
    events: [
      event(1, `Send ${lastMonth} invoices`, 0, '16:00', '16:30'),
      event(2, 'Yoga class', 0, '18:30', '19:30', 'Harbor Yoga'),
      event(3, 'Dentist', 1, '14:30', '15:30'),
      event(4, 'Call Harbor Yoga about invoice', 2, '11:00', '11:30'),
      event(5, 'Design review', 3, '15:00', '16:00'),
      event(6, 'Farmers market', 4, '09:00', '10:30'),
    ],
  })
  const t = clock - 10 * 60e3
  json('data/chat/csample01.json', {
    id: 'csample01', title: 'Unpaid invoices', created: t, updated: t + 60e3, cli: null,
    items: [
      { kind: 'user', text: 'Which invoices are still unpaid?', at: t },
      { kind: 'tool', id: 'toolu_sample1', name: 'Read', label: 'Read tracker.csv', detail: 'Documents/Invoices/tracker.csv', result: 'number,client,amount,paid …', ok: true },
      { kind: 'assistant', text: 'Two are still open in **tracker.csv**:\n\n- **0142** Harbor Yoga, $1,250.00\n- **0143** Juniper Print Co., $640.00\n\n0141 from Maple Street Bakery is paid. Want me to draft a friendly reminder for Harbor Yoga before your call?', at: t + 20e3 },
      { kind: 'user', text: 'Yes, keep it short.', at: t + 40e3 },
      { kind: 'assistant', text: 'Here it is:\n\n> Hi! A quick reminder that invoice 0142 ($1,250.00) is now past due. The PDF is attached again. Thanks so much!\n\nI saved it as **reminder-0142.md** in your Invoices folder.', at: t + 60e3 },
    ],
  })
  // Home: widgets that need no outside account, and no app row, so a phone's first page shows the day.
  const layout = (prefix, items) => items.map(([id, size], i) => ({ key: `${prefix}${i + 1}-${id}`, id, size }))
  json('data/hub-settings.json', {
    version: 1,
    apps: [],
    wallpaper: { current: 'aurora' },
    widgets: {
      mobile: layout('m', [['clock', 's'], ['next-event', 's'], ['today', 'm'], ['week', 'm'], ['quick-links', 'm']]),
      ipad: layout('i', [['clock', 's'], ['next-event', 's'], ['date', 's'], ['world-clock', 's'], ['week', 'm'], ['quick-links', 'm'], ['month', 'm']]),
      desktop: layout('d', [['clock', 's'], ['next-event', 's'], ['week', 'm'], ['quick-links', 'm'], ['month', 'm']]),
    },
  })
  return { root, hub, home, zone, clock, remove: () => fs.rmSync(root, { recursive: true, force: true }) }
}
