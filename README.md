# Codez Swarm

A Chrome extension that redesigns any website live. Click once and the page turns into a red blueprint. Claude agents read it and stream restyling edits while a swarm of cursors flies out, applies each edit, and rebuilds the page in front of you.

Nothing is faked: every box a cursor draws is a real edit landing on the real page.

## Install

```bash
git clone https://github.com/0xCodez/codez-swarm.git
cd codez-swarm
npm install
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `dist` folder.

Open the extension's **Options** and paste an [Anthropic API key](https://console.anthropic.com/settings/keys). Usage is billed to your account, and the bar on the page shows tokens as they are used. To see the swarm without a key, press **Demo**: it restyles by tag from a preset, with no API calls.

## Use it

1. Open a site and click the extension icon.
2. Pick a preset (Editorial, Terminal, Soft glass, Brutalist, AI slop) or describe the look you want.
3. Press **Redesign page**.

When it finishes you can **Undo** everything or **Copy CSS** to keep the result. Changes live in your browser tab only: a reload brings the original back.

## How it works

```
 tab                               service worker                 Claude API
 ───                               ──────────────                 ──────────
 snapshot.js  reads the page ───►  pipeline.js
                                   director agent  ─────────────►  design system
 content.js   plays ops   ◄──────  section agents (parallel) ────►  NDJSON ops
 swarm.js     draws cursors        protocol.js validates every op
```

- **Director.** One agent reads a page outline and writes the design system: a brief, fonts, and global CSS rules with `--nx-*` tokens.
- **Section agents.** One agent per page section, running in parallel, each streaming edits as one JSON object per line. An edit takes effect as soon as its line arrives.
- **Stage.** Agents answer in bursts, so `content.js` holds their ops per section and plays them top to bottom. Each op becomes a job for one cursor, which flies to the element, draws its box and applies the change. The camera follows.
- **Blueprint.** A canvas veil covers the page. While Claude thinks, the swarm surveys the page and draws its wireframe on the veil. Finished areas are punched through, so the new design appears from under the blueprint.

`src/swarm.js` is a standalone engine with no knowledge of Claude, so you can drive it with your own jobs.

## Privacy and safety

- The extension runs only on the tab where you click it (`activeTab`). It has no access to your other pages.
- Redesign sends the page's visible text, structure and computed styles to the Claude API. Don't run it on pages you wouldn't paste into a chat.
- Form values are never read, password fields are skipped, and emails, long numbers and token-like strings are masked before anything leaves the page.
- Your API key stays in `chrome.storage.local` and is used only by the service worker.
- Page text is untrusted, so a page could try to steer the model. Ops are limited to restyling. `src/protocol.js` drops anything that could load a resource or run code, including `url()`, `@import`, `javascript:` and raw HTML. Rewriting text is off unless you tick the box.

Requests use `claude-opus-5-5` by default with adaptive thinking. Options also offer Sonnet 5.5 and Haiku 5.5. Opus and Sonnet requests turn on the API's server-side fallback, which retries a declined request on another model.

## Limits

- Restyling only: agents change CSS and, if you allow it, text. They don't restructure the HTML.
- Sites that re-render aggressively can overwrite inline edits.
- Cross-origin iframes are left alone, and browser pages such as `chrome://` and the Chrome Web Store can't be redesigned.
- Google Fonts may be blocked by a site's CSP; the design then falls back to the next font in its stack.

## Develop

```bash
npm test                                   # unit tests for the protocol and the agent pipeline
CHROME=/path/to/Chromium npm run e2e       # the real extension in Chromium against a mock Claude API
```

The e2e test costs nothing. It uses the real service worker and the real SDK against a local server that speaks the streaming format, on a page with a strict CSP. Chrome stable no longer loads extensions from the command line, so point `CHROME` at Chromium or Chrome for Testing.

## License

MIT
