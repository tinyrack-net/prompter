# Prompter

A voice-following teleprompter for [Outline](https://www.getoutline.com) documents. Open any document the configured API key can read, press the microphone button and read aloud. The text scrolls with your voice, and edits made in Outline appear live without losing your place.

## Features

- **Outline is the source of truth.** The prompter never edits text; it reads documents through the Outline API.
- **Live updates.** An Outline webhook pushes every change to all open prompters within seconds over server-sent events. The reading position is kept: text is realigned around the word you are on.
- **Launcher.** Search documents, see recently updated and recently opened ones, or paste an Outline link to open it directly. A bookmarklet opens the current Outline document in one click.
- **Markdown to speech-friendly text.** Headings, paragraphs, list items, quotes and table rows become paragraphs; formatting, links, images and code are reduced to the words you read.
- **Voice tracking** with the browser's Web Speech API (Chrome, Edge, Safari), phrase-based matching, Korean particles and Japanese word segmentation.
- **Settings** saved per browser: interface and speech language (auto-detect, English, Korean, Japanese), font size, left/right margin, line wrapping and mirror mode.
- Floating playback toolbar, fullscreen (also with `F` / `F11`) and keyboard shortcuts.

## Keyboard shortcuts

| Key         | Action                       |
| ----------- | ---------------------------- |
| `Space`     | Start / stop listening       |
| `←` / `→`   | Move one word back / forward |
| `Home`      | Restart from the beginning   |
| `S` or `,`  | Open settings                |
| `F` / `F11` | Toggle fullscreen            |

## Configuration

| Variable                 | Required | Description                                                                          |
| ------------------------ | -------- | ------------------------------------------------------------------------------------ |
| `OUTLINE_URL`            | yes      | Base URL the server uses to reach Outline, e.g. `https://notes.example.com`          |
| `OUTLINE_API_KEY`        | yes      | Outline API key (Settings → API & Apps). A key with only the `read` scope is enough. |
| `OUTLINE_WEBHOOK_SECRET` | yes      | Signing secret of the Outline webhook subscription                                   |
| `OUTLINE_PUBLIC_URL`     | no       | Outline URL used for "Open in Outline" links, when it differs from `OUTLINE_URL`     |
| `PORT`                   | no       | Listen port, default `8080`                                                          |
| `LOG_LEVEL`              | no       | `trace` … `fatal`, default `info`                                                    |

There is no authentication: everyone who can reach the app can read every document the API key can read. Run it on a private network.

### Outline webhook

In Outline, go to **Settings → Webhooks → New webhook**:

- URL: `https://<prompter host>/api/webhooks/outline`
- Events: **Documents** (all document events)
- Copy the generated **signing secret** into `OUTLINE_WEBHOOK_SECRET`

Deliveries are verified with the `Outline-Signature` HMAC and rejected when older than five minutes. Outline refuses to call private IP addresses unless they are listed in its `ALLOWED_PRIVATE_IP_ADDRESSES` setting.

## Development

Requires Node.js 24 and pnpm.

```sh
pnpm install

# Run against the bundled fake Outline (no real instance needed)
node --import tsx e2e/fake-outline.ts &
OUTLINE_URL=http://localhost:4320 OUTLINE_API_KEY=test-api-key \
  OUTLINE_WEBHOOK_SECRET=test-webhook-secret PORT=4319 pnpm dev

pnpm validate   # lint, Tinyrack UI check, typecheck, unit tests and build
pnpm test:e2e   # Playwright against the production build and the fake Outline
```

The fake Outline (`e2e/fake-outline.ts`) implements the API endpoints the app uses and sends signed webhooks when a document is edited through `POST /__test/edit`.

## Architecture

```text
Browser ── SSR + SSE ──▶ Hono server ── API key ──▶ Outline API
                            ▲
                            └── signed webhook ── Outline
```

- `server/` — Hono app: Outline client, document hub (cache and fan-out), webhook verification, SSE stream, React Router SSR.
- `app/` — React Router 8 routes and UI built with [@tinyrack/ui](https://www.npmjs.com/package/@tinyrack/ui).
- `core/` — framework-free logic: Markdown conversion, script parsing, speech matching, cursor remapping, settings.

There is no database. Display settings and recently opened documents live in the browser's local storage.

## Deployment

The CI/CD workflow lints, typechecks, runs unit and E2E tests, builds and smoke-tests the container image, and pushes `ghcr.io/tinyrack-net/prompter:latest` from `main`.

## License

[MIT](LICENSE)
