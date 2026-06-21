import { REPORT_TYPES } from "./reportTypes";
import type { Lang } from "./i18n";

// Claude models offered on the Report screen. Forward-dated ids — verify against
// Anthropic's published model list.
export const REPORT_MODELS = [
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5" },
  { value: "claude-opus-4-8", label: "Opus 4.8" },
];

// Whisper compute device. `transcribe.py` auto-detects CUDA, falls back to CPU.
export const DEVICES = [
  { value: "auto", label: "Auto" },
  { value: "cuda", label: "GPU" },
  { value: "cpu", label: "CPU" },
];

// Options for the App-language and Output-language pickers. Endonyms, shown the
// same regardless of the current UI language.
export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: "cs", label: "Čeština" },
  { value: "en", label: "English" },
];

export type Prefs = {
  model: string;
  device: string;
  reportType: string;
  appLang: Lang;
  outputLang: Lang;
};

const STORAGE_KEY = "transcriber.prefs";

const DEFAULT_PREFS: Prefs = {
  model: REPORT_MODELS[0].value,
  device: DEVICES[0].value,
  reportType: REPORT_TYPES[0].value,
  appLang: "cs",
  outputLang: "cs",
};

export function loadPrefs(): Prefs {
  const stored = localStorage.getItem(STORAGE_KEY);
  // Merge over defaults so a blob written by an older build (missing a key added
  // since) never yields an undefined pref.
  return stored === null ? DEFAULT_PREFS : { ...DEFAULT_PREFS, ...JSON.parse(stored) };
}

export function savePrefs(prefs: Prefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}
