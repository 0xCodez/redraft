# Redraft

A Chrome extension that redesigns any website live. Click once and the page turns into a blue blueprint. A swarm of Claude agents reads it, picks a theme and rebuilds the page in front of you.

Nothing is faked: every box a cursor draws is a real edit landing on the real page.

## Install

Download **Redraft.zip** from the website, or build it yourself:

```bash
npm install
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `extension` folder from the download, or `dist` if you built it.

### Connect Claude

**With Claude Code (no API key).** If Claude Code is installed and logged in, run this once:

```bash
node ~/Downloads/Redraft/bridge/connect.mjs
```

If you built from source, run `npm run connect` instead.

It registers a small local bridge with your browsers. Usage counts against your Claude plan. Reload the extension afterwards and press **Check connection** in **Options**. macOS and Linux for now.

**With an API key.** In **Options**, switch Connection to Anthropic API key and paste a key from the [Anthropic Console](https://console.anthropic.com/settings/keys). Usage is billed to your account, and the bar on the page shows tokens as they are used.

To see the swarm without either, press **Demo**: it restyles by tag from a preset, with no calls to Claude.

## Use it

1. Open a site and click the extension icon.
2. Pick a preset (Editorial, Terminal, Soft glass, Brutalist, AI slop) or describe the look you want.
3. Press **Redesign page**.

When it finishes you can **Undo** everything or **Copy CSS** to keep the result. Changes live in your browser tab only: a reload brings the original back.

### Your own styles

Redraft works from your style, not only from presets. Press **+** in the popup to add one:

- **Copy this page's style.** Saves the colors, fonts, radii and shadows a site really uses. Runs locally, with no call to Claude.
- **Describe it.** Save a written direction and reuse it anywhere.
- **Build it by hand.** Set exact brand values in the editor in settings.

With a style selected, the director is skipped and Claude works strictly inside it. Export styles as a JSON file to share them. Fonts load from Google Fonts, so a site's private font falls back to a system font.

## How it works

```
 tab                               service worker                 Claude
 ───                               ──────────────                 ──────
 snapshot.js  reads the page ───►  pipeline.js
                                   director agent  ─────────────►  design system
 content.js   plays ops   ◄──────  section agents (parallel) ────►  NDJSON ops
 swarm.js     draws cursors        protocol.js validates every op

 Claude is reached through bridge/host.mjs and `claude -p`, or the Claude API with a key.
```

- **Director.** One agent reads a page outline and picks a theme: palette, fonts, radii, borders and shadows.
- **Theme engine.** `src/theme.js` applies that theme to every element on the page by role (page ground, surface, control, heading, body, muted), including content that loads later. This is what keeps a long page consistent from top to bottom.
- **Section agents.** One agent per page section, running in parallel, refines hierarchy and spacing and streams edits as one JSON object per line.
- **Stage.** A sweep line lifts the blueprint from the top of the page down. Section edits then play in order, each flown in and applied by one cursor. The camera follows.

`src/swarm.js` is a standalone engine with no knowledge of Claude, so you can drive it with your own jobs.

## Privacy and safety

- The extension runs only on the tab where you click it (`activeTab`). It has no access to your other pages.
- Redesign sends the page's visible text, structure and computed styles to Claude. Don't run it on pages you wouldn't paste into a chat.
- Form values are never read, password fields are skipped, and emails, long numbers and token-like strings are masked before anything leaves the page.
- The Claude Code bridge uses native messaging, so no port is open and only this extension can reach it. Every `claude` run has all tools off, no MCP servers, no settings or hooks, and an empty working folder, so a poisoned page has nothing to reach.
- An API key, if you use one, stays in `chrome.storage.local` and is used only by the service worker.
- Page text is untrusted, so a page could try to steer the model. Ops are limited to restyling. `src/protocol.js` drops anything that could load a resource or run code, including `url()`, `@import`, `javascript:` and raw HTML. Rewriting text is off unless you tick the box.

With an API key, requests use `claude-opus-5-5` by default with adaptive thinking. Options also offer Sonnet 5.5 and Haiku 5.5. Opus and Sonnet requests turn on the API's server-side fallback, which retries a declined request on another model.

## Limits

- Restyling only: agents change CSS and, if you allow it, text. They don't restructure the HTML.
- Sites that re-render aggressively can overwrite inline edits.
- Cross-origin iframes are left alone, and browser pages such as `chrome://` and the Chrome Web Store can't be redesigned.
- Google Fonts may be blocked by a site's CSP; the design then falls back to the next font in its stack.

## Develop

```bash
npm run package                            # rebuilds landing/redraft.zip, the website download
npm test                                   # unit tests for the protocol and the agent pipeline
CHROME=/path/to/Chromium npm run e2e       # the real extension in Chromium against a mock Claude API
FAKE=1 CHROME=/path/to/Chromium npm run e2e:bridge   # the Claude Code route with a scripted claude
CHROME=/path/to/Chromium npm run e2e:bridge          # the same with your real Claude Code (uses your plan)
```

The e2e test costs nothing. It uses the real service worker and the real SDK against a local server that speaks the streaming format, on a page with a strict CSP. Chrome stable no longer loads extensions from the command line, so point `CHROME` at Chromium or Chrome for Testing.

## License

MIT
