# Search bar, links and snippets

`Ctrl+K` (`Cmd+K`) on any hub page opens the search bar. It finds your links, snippets, the hub's tabs and actions, and files in your home folder, and it can hand anything else to the chat. What you use most recently and most often comes first.

| Key | What it does |
| --- | --- |
| Up, Down | Move through the results |
| Enter | Open a link, tab or file; copy a snippet |
| `Ctrl+E` | Edit the selected link or snippet |
| Esc | Clear the box, then close |

On a phone, tap a row to open or copy it, and tap the pencil to edit it.

The same search is also its own page at `/launcher`, sized for a small frameless window.

## Your data

Everything is saved in `data/launcher.json`, which git ignores. Site icons are cached in `data/launcher-icons/`. If the saved file is damaged, the hub keeps it beside the new one as `launcher.damaged-<time>.json` and shows a warning in the bar.

## Links

| Kind | Holds | Example |
| --- | --- | --- |
| `web` | `url`, `http` or `https` only | `https://example.com/docs` |
| `obsidian` | `url`, an Obsidian `open`, `search` or `vault` link | `obsidian://open?vault=Notes` |
| `folder` | `path`, the full path of a folder on this computer | `/home/you/Documents` |

Every other scheme is refused, including `javascript:`, `data:` and `file:` as a web link. Web links can't hold a user name or password. Folders that hold keys and network paths are refused. Folders open only when you're using the hub on the computer that runs it. Obsidian links open on the device you're using.

Icons come from the site's own favicon, fetched by the hub and cached for a week. The hub only fetches for saved web links, never from a private or loopback address, and takes at most 256 KB. SVG files aren't accepted, because they can carry scripts.

## Snippets

A snippet has a `name`, its `text` (up to 100 KB) and an optional `keyword` with no spaces. Enter or a tap copies the text. Where the browser's clipboard API isn't available, such as plain http from another device, the bar uses the older copy route, and if that fails too it shows the text ready to select. Snippet text is never written to a log.

## Import and export

**Import links and snippets** takes a JSON file or pasted JSON. **Export links and snippets** downloads `local-hub-links-and-snippets.json`, which holds everything except how often you used each item.

```json
{
  "format": "local-hub-launcher",
  "version": 1,
  "links": [
    { "name": "Docs", "kind": "web", "url": "https://example.com/docs" },
    { "name": "Notes", "kind": "obsidian", "url": "obsidian://open?vault=Notes" },
    { "name": "Projects", "kind": "folder", "path": "/home/you/Projects" }
  ],
  "snippets": [
    { "name": "Greeting", "text": "Hello there,\n\n", "keyword": "hi" }
  ]
}
```

Import also accepts these shapes, either as a plain list or under `links`, `quicklinks` or `snippets`:

```json
[
  { "name": "Tracker", "link": "https://tracker.example.com" },
  { "name": "Sign-off", "text": "Thanks,", "keyword": "ty" }
]
```

- An item is a snippet if it has `text`, and a link if it has `link`, `url` or `path`.
- When `kind` is missing, the address decides it: a path means `folder`, `obsidian:` means `obsidian`, and anything else means `web`.
- Folder and Obsidian links come in only if you tick **Also bring in folder and Obsidian links from this file**.
- Importing the same file twice adds nothing.
- Anything refused is listed with its reason, and the rest still comes in.
- Links with `{argument}` placeholders aren't supported. They come in as plain links with the braces percent-encoded.

## API

All of it is same-origin. Every change needs the `x-hub: 1` header, like the rest of the hub.

| Route | Does |
| --- | --- |
| `GET /launcher` | The search bar as its own page |
| `GET /api/launcher/library` | `{ links, snippets, usage, filesHome, at, warning? }` |
| `GET /api/launcher/snippets` | `{ snippets: [{ id, name, text, keyword }], at }`, for the desktop app. `at` changes whenever the library does |
| `GET`, `POST /api/launcher/links` | List, or add `{ name, kind, url \| path }` |
| `PUT`, `DELETE /api/launcher/links/<id>` | Change or remove a link |
| `GET`, `POST /api/launcher/snippets` | List, or add `{ name, text, keyword }` |
| `PUT`, `DELETE /api/launcher/snippets/<id>` | Change or remove a snippet |
| `POST /api/launcher/use` | `{ key: "link:<id>" }` counts a use. Kinds are `link`, `snippet`, `tab` and `action` |
| `POST /api/launcher/open` | `{ id }` opens a saved folder or Obsidian link |
| `GET /api/launcher/icon?id=<id>` | The saved web link's icon, or 204 if it has none |
| `GET /api/launcher/export` | The JSON file above |
| `POST /api/launcher/import` | `{ data, allowLocal }` returns `{ added, unchanged, skipped, skippedCount }` |

## For other parts of the hub

`window.LAUNCHER` is defined on the main page once `tabs/launcher.js` has loaded. It has `open()`, `close()`, `toggle()` and `isOpen`. Check it exists before you use it, because the hub runs fine without the launcher files.

```html
<button type="button" onclick="window.LAUNCHER?.open()">Search</button>
```

## The small window

Whatever hosts `/launcher` needs to handle these:

| The page does | Meaning |
| --- | --- |
| `window.close()` | Done: hide the window. Esc does this when the box is empty, and so does finishing an action |
| `window.open(url, '_blank', 'noopener,noreferrer')` | Open a web link in the browser |
| `window.open('/#launcher-run', '_blank', 'noopener')` | Bring up the hub's main page, which carries out the request |

The request behind `/#launcher-run` waits in `localStorage` under `hub-launcher-pending` for 30 seconds, and the main page removes it when it reads it. The address itself holds nothing, so a link from elsewhere can't start a chat or open a file. Asking the chat, opening a tab or file, importing and exporting all go through the main page. A file picker or download would take focus from the small window, which hides it.
