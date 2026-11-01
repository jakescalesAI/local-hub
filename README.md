# Quartzi Hub

Your own private dashboard and AI assistant, running on your own computer.

## Start

Needs [Node.js](https://nodejs.org) 20 or newer. Windows only for now.

```
npm start
```

Open http://localhost:3100. The first run asks for a hub name, who can reach it, your Claude
connection and any optional keys. Your settings and keys stay in `config/` and `data/`, which git
ignores.

A new hub starts with Home, Files, Chat and Browser. Cloud, Stripe, Calendar and the other services
turn on when you configure them.

## License

MIT
