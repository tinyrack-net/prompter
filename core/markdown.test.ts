import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { markdownToScript } from './markdown.ts';
import { parseScript } from './script.ts';

describe('markdownToScript', () => {
  it('turns blocks into paragraphs and drops formatting', () => {
    const md = [
      '# Opening',
      '',
      'Hello **everyone**, welcome to _the_ [show](https://example.com).',
      '',
      '## Part one',
      '',
      '- first point',
      '- second point',
      '  - nested point',
      '',
      '1. step one',
      '2. step two',
    ].join('\n');
    expect(markdownToScript(md)).toBe(
      [
        'Opening',
        'Hello everyone, welcome to the show.',
        'Part one',
        'first point',
        'second point',
        'nested point',
        'step one',
        'step two',
      ].join('\n\n'),
    );
  });

  it('keeps hard line breaks inside a paragraph', () => {
    expect(markdownToScript('line one\\\nline two')).toBe('line one\nline two');
    expect(markdownToScript('line one  \nline two')).toBe('line one\nline two');
  });

  it('removes code, images, rules and html tags', () => {
    const md = [
      'Before',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '![diagram](https://example.com/a.png)',
      '',
      '---',
      '',
      'Use the `npm` command <b>now</b>.',
    ].join('\n');
    expect(markdownToScript(md)).toBe('Before\n\nUse the npm command now.');
  });

  it('flattens tables row by row and quotes into paragraphs', () => {
    const md = ['| A | B |', '| - | - |', '| one | two |', '', '> quoted text'].join('\n');
    expect(markdownToScript(md)).toBe('A B\n\none two\n\nquoted text');
  });

  it('handles Outline-specific constructs', () => {
    const md = ['First', '', '\\', '', ':::info', 'A notice', ':::', '', 'Last'].join('\n');
    expect(markdownToScript(md)).toBe('First\n\nA notice\n\nLast');
  });

  it('keeps bracket notes for the prompter and works with CJK text', () => {
    const md = '안녕하세요. [잠시 멈춤]\n\n今日は**新しい**話です。';
    expect(markdownToScript(md)).toBe('안녕하세요. [잠시 멈춤]\n\n今日は新しい話です。');
  });

  it('produces line and paragraph breaks the prompter understands', () => {
    const tokens = parseScript(markdownToScript('# Title\n\nline one\\\nline two'));
    const breaks = tokens.filter((t) => t.kind === 'break').map((t) => t.paragraph);
    expect(breaks).toEqual([true, false]);
  });

  it('returns an empty script for an empty document', () => {
    expect(markdownToScript('')).toBe('');
    expect(markdownToScript('\\\n\n---\n')).toBe('');
  });
});

describe('markdownToScript with a real Outline document', () => {
  const md = readFileSync(new URL('./__fixtures__/outline-sample.md', import.meta.url), 'utf8');
  const script = markdownToScript(md);

  it('drops front matter code blocks and keeps headings as paragraphs', () => {
    expect(script.startsWith('하드웨어\n\n오늘 가져온 것은')).toBe(true);
    expect(script).not.toContain('```');
    expect(script).not.toContain('updated:');
    expect(script).not.toMatch(/^#/m);
  });

  it('leaves only readable text', () => {
    expect(script).not.toMatch(/\]\(|!\[|\*\*|__/);
    const tokens = parseScript(script, 'ko');
    expect(tokens.filter((t) => !t.skip).length).toBeGreaterThan(500);
  });
});
