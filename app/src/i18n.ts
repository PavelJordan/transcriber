// UI strings. `en` is the canonical key set; `cs` must match it (typed `typeof en`).
// The default language is Czech (see prefs.ts). Output-type prompts are localized
// separately in reportTypes.ts.
export type Lang = "cs" | "en";

const en = {
  titleTranscribe: "transcriber",
  titleReport: "report",
  titleSettings: "settings",

  audioPrivacy: "Audio never leaves your device.",
  dropChange: "Click to choose a different recording",
  dropPrompt: "Drop a recording here, or click to browse",
  dropSubtitle: "Video or audio — it stays on this machine",
  fieldModel: "Model",
  fieldLanguage: "Language",
  langAuto: "Auto-detect",
  btnTranscribe: "Transcribe",
  btnCancel: "Cancel",
  btnRetranscribe: "Re-transcribe",
  btnWriteReport: "Write report",
  detected: "Detected",
  listening: "Listening…",
  loadingModel: "Loading model…",
  downloadingModel: "Downloading model…",

  transcriptSent: "Only the transcript text is sent to Claude.",
  noTokenPre: "No API token yet — add one in",
  settingsLink: "Settings",
  noTokenPost: "to generate, or use Copy prompt.",
  outputType: "Output type",
  instructions: "Instructions",
  transcriptSummary: "Transcript — only this is sent",
  btnCopyPrompt: "Copy prompt",
  btnCopied: "Copied",
  btnGenerate: "Generate report",
  btnGenerating: "Generating…",
  btnCopy: "Copy",
  exportMd: "Export .md",
  exportPdf: "Export PDF",
  writing: "Writing…",

  typeMeeting: "Meeting report",
  typeMeetingDesc: "Structured minutes of a meeting or consultation.",
  typeLecture: "Lecture notes",
  typeLectureDesc: "Study notes from a lecture — flags likely mis-heard facts to verify.",
  typeSummary: "Summary",
  typeSummaryDesc: "A short TL;DR with the key points.",
  typeActions: "Action items",
  typeActionsDesc: "Just the tasks, decisions, and deadlines.",

  tokenLabel: "Anthropic API token (optional)",
  btnSave: "Save",
  tokenSavedMsg: "API token saved in your keychain.",
  btnChange: "Change",
  defaultModel: "Default model",
  defaultOutputType: "Default output type",
  appLanguage: "App language",
  outputLanguage: "Output language",
};

const cs: typeof en = {
  titleTranscribe: "transcriber",
  titleReport: "report",
  titleSettings: "nastavení",

  audioPrivacy: "Záznam nikdy neopustí vaše zařízení.",
  dropChange: "Klikněte pro výběr jiného záznamu",
  dropPrompt: "Sem přetáhněte záznam, nebo klikněte pro výběr",
  dropSubtitle: "Video nebo zvuk — zůstává v tomto počítači",
  fieldModel: "Model",
  fieldLanguage: "Jazyk",
  langAuto: "Rozpoznat automaticky",
  btnTranscribe: "Přepsat",
  btnCancel: "Zrušit",
  btnRetranscribe: "Přepsat znovu",
  btnWriteReport: "Vytvořit report",
  detected: "Rozpoznáno",
  listening: "Poslouchám…",
  loadingModel: "Načítám model…",
  downloadingModel: "Stahuji model…",

  transcriptSent: "Claudovi se posílá pouze text přepisu.",
  noTokenPre: "Zatím není žádný API token — přidejte ho v",
  settingsLink: "nastavení",
  noTokenPost: "pro generování, nebo použijte Kopírovat zadání.",
  outputType: "Typ výstupu",
  instructions: "Zadání",
  transcriptSummary: "Přepis — posílá se pouze tohle",
  btnCopyPrompt: "Kopírovat zadání",
  btnCopied: "Zkopírováno",
  btnGenerate: "Vygenerovat report",
  btnGenerating: "Generuji…",
  btnCopy: "Kopírovat",
  exportMd: "Export .md",
  exportPdf: "Export PDF",
  writing: "Píšu…",

  typeMeeting: "Zápis ze schůzky",
  typeMeetingDesc: "Strukturovaný zápis ze schůzky nebo konzultace.",
  typeLecture: "Poznámky z přednášky",
  typeLectureDesc: "Studijní poznámky z přednášky — označí pravděpodobné přeslechy k ověření.",
  typeSummary: "Shrnutí",
  typeSummaryDesc: "Stručné shrnutí s hlavními body.",
  typeActions: "Úkoly",
  typeActionsDesc: "Jen úkoly, rozhodnutí a termíny.",

  tokenLabel: "Anthropic API token (volitelné)",
  btnSave: "Uložit",
  tokenSavedMsg: "API token je uložen v klíčence.",
  btnChange: "Změnit",
  defaultModel: "Výchozí model",
  defaultOutputType: "Výchozí typ výstupu",
  appLanguage: "Jazyk aplikace",
  outputLanguage: "Jazyk výstupu",
};

const STRINGS: Record<Lang, typeof en> = { en, cs };

export type StringKey = keyof typeof en;
export type Translate = (key: StringKey) => string;

export function translator(lang: Lang): Translate {
  return (key) => STRINGS[lang][key];
}
