// A real server that works but answers everything slower than the app's ping check allows.
import http from 'node:http'

const DELAY_MS = 2200

http.createServer((req, res) => {
  setTimeout(() => {
    if (req.url === '/api/ping') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    } else {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><title>slow hub</title><h1>slow hub</h1>')
    }
  }, DELAY_MS)
}).listen(Number(process.env.HUB_PORT), '127.0.0.1')
