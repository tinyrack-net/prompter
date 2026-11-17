import { expect, type Page, test } from '@playwright/test';
import { FAKE_OUTLINE } from '../playwright.config.ts';

interface FakeDoc {
  id: string;
  urlId: string;
  title: string;
  url: string;
  revision: number;
}

async function outline<T = FakeDoc>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${FAKE_OUTLINE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

const createDoc = (title: string, text: string) => outline('/__test/documents', { title, text });
const editDoc = (id: string, text: string, opts: { title?: string; webhook?: boolean } = {}) =>
  outline<FakeDoc & { webhookStatus: number }>('/__test/edit', { id, text, ...opts });

/** Replaces the Web Speech API with a fake that tests can drive via `say()`. */
async function installFakeSpeech(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    class FakeRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onaudiostart: (() => void) | null = null;
      constructor() {
        w.__recognition = this;
      }
      start() {}
      stop() {}
      abort() {}
    }
    w.SpeechRecognition = FakeRecognition;
    w.__say = (text: string) => w.__recognition?.onresult?.({ results: [[{ transcript: text }]] });
  });
}

const say = (page: Page, text: string) => page.evaluate((t) => (window as any).__say(t), text);
const current = (page: Page) => page.locator('[data-current]');
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Playback controls' });

const SCRIPT_MD = [
  '# Opening',
  '',
  'Hello everyone and **welcome** to the show.',
  '',
  'Today we talk about [teleprompters](https://example.com).',
  '',
  '- first point',
  '- second point',
  '',
  'Thanks for watching.',
].join('\n');

test.beforeEach(async ({ page }) => {
  await outline('/__test/reset');
  await installFakeSpeech(page);
});

test.describe('launcher', () => {
  test('lists recently updated documents and searches', async ({ page }) => {
    await createDoc('Weekly update', 'Numbers went up.');
    await createDoc('Product demo', 'Click the big button.');
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Open an Outline document' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Weekly update/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Product demo/ })).toBeVisible();

    await page.getByRole('searchbox', { name: 'Search or paste a link' }).fill('demo');
    await expect(page.getByRole('link', { name: /Product demo/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Weekly update/ })).toHaveCount(0);

    await page.getByRole('searchbox', { name: 'Search or paste a link' }).fill('nothing matches');
    await expect(page.getByText('No documents found.')).toBeVisible();
  });

  test('pasting an Outline link opens the document directly', async ({ page }) => {
    const doc = await createDoc('Pasted script', 'Read me aloud.');
    await page.goto('/');
    await page
      .getByRole('searchbox', { name: 'Search or paste a link' })
      .fill(`https://notes.example.com${doc.url}`);
    await expect(page).toHaveURL(new RegExp(`/d/${doc.id}$`));
    await expect(current(page)).toHaveText('Read');
  });

  test('remembers recently opened documents', async ({ page }) => {
    const doc = await createDoc('Remember me', 'Some words.');
    await page.goto(`/d/${doc.id}`);
    await expect(current(page)).toHaveText('Some');
    await page.getByRole('link', { name: 'Choose another document' }).click();

    const recent = page.getByRole('region', { name: 'Recently opened' });
    await expect(recent.getByRole('link', { name: 'Remember me' })).toBeVisible();
    await recent.getByRole('button', { name: 'Remove from recent: Remember me' }).click();
    await expect(page.getByRole('region', { name: 'Recently opened' })).toHaveCount(0);
  });

  test('offers a bookmarklet that opens the current Outline document', async ({ page }) => {
    await page.goto('/');
    const link = page.getByRole('link', { name: 'Open in Prompter' });
    // The javascript: href is applied after hydration.
    await expect(link).toHaveAttribute('href', /^javascript:/);
    const href = (await link.getAttribute('href')) ?? '';
    const code = decodeURIComponent(href.slice('javascript:'.length));
    expect(code).toContain('http://localhost:4319/d/');

    // Run it on a page that looks like an Outline document.
    const popup = page.waitForEvent('popup');
    await page.evaluate((source) => {
      history.replaceState(null, '', '/doc/some-script-AbCdEfGhIj');
      new Function(source)();
    }, code);
    expect((await popup).url()).toBe('http://localhost:4319/d/AbCdEfGhIj');
  });
});

test.describe('prompter', () => {
  test('renders Markdown as plain paragraphs and links back to Outline', async ({ page }) => {
    const doc = await createDoc('Demo script', SCRIPT_MD);
    await page.goto(`/d/${doc.urlId}`);

    await expect(page).toHaveTitle('Demo script · Prompter');
    await expect(current(page)).toHaveText('Opening');
    const text = page.locator('.prompter-text');
    await expect(text).toContainText('Hello everyone and welcome to the show.');
    await expect(text).toContainText('Today we talk about teleprompters.');
    await expect(text).not.toContainText('**');
    await expect(text).not.toContainText('](');
    await expect(page.locator('.prompter-paragraph')).toHaveCount(5);

    const outlineLink = page.getByRole('link', { name: 'Open in Outline' });
    await expect(outlineLink).toHaveAttribute('href', `${FAKE_OUTLINE}${doc.url}`);
  });

  test('highlight follows speech', async ({ page }) => {
    const doc = await createDoc('Demo script', SCRIPT_MD);
    await page.goto(`/d/${doc.id}`);
    await toolbar(page).getByRole('button', { name: 'Start listening' }).click();
    await say(page, 'opening hello everyone and welcome');
    await expect(current(page)).toHaveText('to');
  });

  test('scrolls back to the current word from the toolbar', async ({ page }) => {
    const long = Array.from({ length: 80 }, (_, i) => `Paragraph number ${i + 1}.`).join('\n\n');
    const doc = await createDoc('Long script', long);
    await page.goto(`/d/${doc.id}`);
    await expect(current(page)).toHaveText('Paragraph');

    const scroller = page.locator('.prompter-scroller');
    await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(500);

    await toolbar(page).getByRole('button', { name: 'Scroll to current word' }).click();
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeLessThan(50);
  });

  test('keeps the current word on the configured reading line', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('prompter:settings:v1', JSON.stringify({ readingLine: 60 }));
    });
    const doc = await createDoc('Demo script', SCRIPT_MD);
    await page.goto(`/d/${doc.id}`);
    await expect(current(page)).toHaveText('Opening');

    const offset = () =>
      page.evaluate(() => {
        const scroller = document.querySelector('.prompter-scroller') as HTMLElement;
        const line = document.querySelector('.prompter-reading-line') as HTMLElement;
        const word = document.querySelector('[data-current]') as HTMLElement;
        const top = scroller.getBoundingClientRect().top;
        return {
          line: (line.getBoundingClientRect().top - top) / scroller.clientHeight,
          word: (word.getBoundingClientRect().top - top) / scroller.clientHeight,
        };
      });
    await expect.poll(async () => (await offset()).line).toBeCloseTo(0.6, 1);
    await expect.poll(async () => (await offset()).word).toBeCloseTo(0.6, 1);
  });

  test('has no editing controls', async ({ page }) => {
    const doc = await createDoc('Demo script', SCRIPT_MD);
    await page.goto(`/d/${doc.id}`);
    await toolbar(page).getByRole('button', { name: 'Settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings).toBeVisible();
    await expect(settings.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('textbox')).toHaveCount(0);
  });

  test('shows a clear error for a document that cannot be opened', async ({ page }) => {
    await page.goto('/d/NoSuchDoc0');
    await expect(
      page.getByRole('heading', { name: 'This document could not be opened.' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Choose another document' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('live updates from Outline', () => {
  test('a webhook updates the open document without losing the reading position', async ({
    page,
  }) => {
    const doc = await createDoc('Demo script', SCRIPT_MD);
    await page.goto(`/d/${doc.id}`);
    await toolbar(page).getByRole('button', { name: 'Start listening' }).click();
    await say(page, 'opening hello everyone and welcome to the show today we');
    await expect(current(page)).toHaveText('talk');

    // Edits above and below the reader, made in Outline.
    const edited = SCRIPT_MD.replace('# Opening', '# Opening\n\nA brand new intro line.').replace(
      'Thanks for watching.',
      'Thanks for watching, see you next week.',
    );
    const result = await editDoc(doc.id, edited);
    expect(result.webhookStatus).toBe(204);

    await expect(page.locator('.prompter-text')).toContainText('A brand new intro line.');
    await expect(page.locator('.prompter-text')).toContainText('see you next week.');
    await expect(current(page)).toHaveText('talk');
    await expect(page.locator('.prompter-status')).toHaveAttribute('data-state', 'updated');

    // Tracking continues from the same place on the new text.
    await say(page, 'talk about');
    await expect(current(page)).toHaveText('teleprompters');
  });

  test('a renamed document updates its title', async ({ page }) => {
    const doc = await createDoc('Old title', 'Some words here.');
    await page.goto(`/d/${doc.id}`);
    await editDoc(doc.id, 'Some words here.', { title: 'New title' });
    await expect(page.getByRole('navigation', { name: 'New title' })).toBeVisible();
    await expect(page).toHaveTitle('New title · Prompter');
  });

  test('every open viewer receives the update', async ({ page, browser }) => {
    const doc = await createDoc('Shared', 'First version.');
    const other = await browser.newPage();
    await page.goto(`/d/${doc.id}`);
    await other.goto(`/d/${doc.id}`);
    await expect(other.locator('.prompter-text')).toContainText('First version.');

    await editDoc(doc.id, 'Second version.');
    await expect(page.locator('.prompter-text')).toContainText('Second version.');
    await expect(other.locator('.prompter-text')).toContainText('Second version.');
    await other.close();
  });

  test('deleting the document in Outline tells the viewer', async ({ page }) => {
    const doc = await createDoc('Doomed', 'Going away soon.');
    await page.goto(`/d/${doc.id}`);
    await expect(current(page)).toHaveText('Going');
    await outline('/__test/delete', { id: doc.id });
    await expect(page.getByText('This document was deleted or archived in Outline.')).toBeVisible();
    await expect(toolbar(page).getByRole('button', { name: 'Start listening' })).toBeDisabled();
  });

  test('unsigned or forged webhooks are rejected', async ({ page, request }) => {
    const doc = await createDoc('Protected', 'Original text.');
    await page.goto(`/d/${doc.id}`);
    const body = JSON.stringify({
      event: 'documents.update',
      payload: {
        id: doc.id,
        model: {
          ...doc,
          text: 'Injected text.',
          revision: 99,
          updatedAt: new Date().toISOString(),
        },
      },
    });
    const unsigned = await request.post('/api/webhooks/outline', { data: body });
    expect(unsigned.status()).toBe(401);
    const forged = await request.post('/api/webhooks/outline', {
      data: body,
      headers: { 'Outline-Signature': `t=${Date.now()},s=${'0'.repeat(64)}` },
    });
    expect(forged.status()).toBe(401);
    await page.waitForTimeout(300);
    await expect(page.locator('.prompter-text')).toContainText('Original text.');
  });
});
