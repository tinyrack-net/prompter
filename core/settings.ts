import { isLanguagePreference, type LanguagePreference } from './language.ts';

export const SETTINGS_STORAGE_KEY = 'prompter:settings:v1';
export const RECENT_STORAGE_KEY = 'prompter:recent:v1';

/**
 * How prompter lines wrap.
 * - `words`: never split a word (Korean eojeol, English word, Japanese phrase).
 * - `anywhere`: break at any character, so every line is filled evenly.
 */
export const LINE_WRAPS = ['words', 'anywhere'] as const;
export type LineWrap = (typeof LINE_WRAPS)[number];

export function isLineWrap(value: unknown): value is LineWrap {
  return typeof value === 'string' && (LINE_WRAPS as readonly string[]).includes(value);
}

export interface Settings {
  /** Language of the app interface. */
  uiLanguage: LanguagePreference;
  /** Language the speech recognizer listens for. */
  speechLanguage: LanguagePreference;
  /** Prompter font size in px. */
  fontSize: number;
  /** Left and right margin of the prompter text, in % of the screen width. */
  marginX: number;
  /** Where the current word stays, in % of the screen height from the top. */
  readingLine: number;
  /** Mirror the prompter text horizontally for teleprompter glass. */
  mirror: boolean;
  /** Where prompter lines may wrap. */
  lineWrap: LineWrap;
}

interface NumberRange {
  min: number;
  max: number;
  step: number;
}

export const RANGES = {
  fontSize: { min: 24, max: 120, step: 2 },
  marginX: { min: 0, max: 40, step: 1 },
  readingLine: { min: 10, max: 80, step: 5 },
} as const satisfies Record<string, NumberRange>;

export const DEFAULT_SETTINGS: Settings = {
  uiLanguage: 'auto',
  speechLanguage: 'auto',
  fontSize: 48,
  marginX: 8,
  readingLine: 35,
  mirror: false,
  lineWrap: 'words',
};

function clampNumber(value: unknown, range: NumberRange, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const stepped = Math.round(value / range.step) * range.step;
  return Math.min(range.max, Math.max(range.min, stepped));
}

/** Validates untrusted (stored) data, keeping valid fields and defaulting the rest. */
export function sanitizeSettings(input: unknown): Settings {
  const data = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    uiLanguage: isLanguagePreference(data.uiLanguage) ? data.uiLanguage : d.uiLanguage,
    speechLanguage: isLanguagePreference(data.speechLanguage)
      ? data.speechLanguage
      : d.speechLanguage,
    fontSize: clampNumber(data.fontSize, RANGES.fontSize, d.fontSize),
    marginX: clampNumber(data.marginX, RANGES.marginX, d.marginX),
    readingLine: clampNumber(data.readingLine, RANGES.readingLine, d.readingLine),
    mirror: typeof data.mirror === 'boolean' ? data.mirror : d.mirror,
    lineWrap: isLineWrap(data.lineWrap) ? data.lineWrap : d.lineWrap,
  };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(): Settings {
  try {
    const raw = storage()?.getItem(SETTINGS_STORAGE_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    storage()?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be full or disabled (private mode); settings still work in memory.
  }
}

/** A document opened recently, shown on the launcher. */
export interface RecentDocument {
  id: string;
  title: string;
  openedAt: number;
}

const MAX_RECENT = 12;

function isRecentDocument(value: unknown): value is RecentDocument {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.title === 'string' && typeof v.openedAt === 'number';
}

export function loadRecent(): RecentDocument[] {
  try {
    const raw = storage()?.getItem(RECENT_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isRecentDocument).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/** Moves a document to the top of the recent list. */
export function rememberRecent(
  doc: { id: string; title: string },
  now = Date.now(),
): RecentDocument[] {
  const next = [
    { id: doc.id, title: doc.title, openedAt: now },
    ...loadRecent().filter((d) => d.id !== doc.id),
  ].slice(0, MAX_RECENT);
  try {
    storage()?.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // See saveSettings.
  }
  return next;
}

export function forgetRecent(id: string): RecentDocument[] {
  const next = loadRecent().filter((d) => d.id !== id);
  try {
    storage()?.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // See saveSettings.
  }
  return next;
}
