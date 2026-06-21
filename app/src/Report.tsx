import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Check, ClipboardCopy, Copy, Download, FileText, KeyRound, Loader2, Settings as SettingsIcon, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "./Field";
import { REPORT_MODELS } from "./prefs";
import { REPORT_TYPES, typeFor, type ReportType } from "./reportTypes";
import type { Lang, Translate } from "./i18n";

type Status = "idle" | "running" | "done" | "error";

function Report({
  transcript: initialTranscript,
  defaultModel,
  defaultReportType,
  outputLang,
  onBack,
  onSettings,
  t,
}: {
  transcript: string;
  defaultModel: string;
  defaultReportType: string;
  outputLang: Lang;
  onBack: () => void;
  onSettings: () => void;
  t: Translate;
}) {
  const [tokenSaved, setTokenSaved] = useState(false);

  const [model, setModel] = useState(defaultModel);
  const [reportType, setReportType] = useState(() => typeFor(defaultReportType).value);
  const [prompt, setPrompt] = useState(() => typeFor(defaultReportType).prompt[outputLang]);
  const [transcript, setTranscript] = useState(initialTranscript);

  const [status, setStatus] = useState<Status>("idle");
  const [report, setReport] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<boolean>("has_token").then(setTokenSaved).catch((err) => setError(String(err)));
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("report://delta", ({ payload }) => {
      setReport((prev) => prev + payload);
    });
    return () => {
      unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    outputRef.current?.scrollTo(0, outputRef.current.scrollHeight);
  }, [report]);

  // Switching type loads that type's default prompt (dropping manual edits) and
  // clears any report generated for the previous type.
  function selectType(type: ReportType) {
    setReportType(type.value);
    setPrompt(type.prompt[outputLang]);
    setReport("");
    setStatus("idle");
    setError(null);
  }

  async function runReport() {
    setStatus("running");
    setReport("");
    setError(null);
    try {
      await invoke("generate_report", { transcript, prompt, model });
      setStatus("done");
    } catch (err) {
      setError(String(err));
      setStatus("error");
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(`${prompt}\n\n---\n\n${transcript}`);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1500);
    } catch (err) {
      setError(String(err));
    }
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      setError(String(err));
    }
  }

  async function exportMarkdown() {
    const path = await save({
      defaultPath: "report.md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return;
    try {
      await invoke("export_report", { path, contents: report });
    } catch (err) {
      setError(String(err));
    }
  }

  function printReport() {
    window.print();
  }

  const running = status === "running";
  const activeType = typeFor(reportType);

  return (
    <>
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{t("titleReport")}</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ShieldCheck className="size-4" />
            {t("transcriptSent")}
          </span>
          {!running && (
            <Button variant="ghost" size="icon" onClick={onSettings}>
              <SettingsIcon className="size-4" />
            </Button>
          )}
        </div>
      </header>

      {!tokenSaved && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <KeyRound className="size-4" />
          {t("noTokenPre")}
          <button className="underline underline-offset-4" onClick={onSettings}>
            {t("settingsLink")}
          </button>
          {t("noTokenPost")}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm text-muted-foreground">{t("outputType")}</span>
        <div className="flex flex-wrap gap-2">
          {REPORT_TYPES.map((type) => (
            <Button
              key={type.value}
              variant={type.value === reportType ? "default" : "outline"}
              size="sm"
              disabled={running}
              onClick={() => selectType(type)}
            >
              {t(type.labelKey)}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t(activeType.descriptionKey)}</p>
      </div>

      <details className="rounded-lg border bg-muted/30 px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">{t("instructions")}</summary>
        <Textarea
          className="mt-3 min-h-48"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </details>

      <details className="rounded-lg border bg-muted/30 px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">{t("transcriptSummary")}</summary>
        <Textarea
          className="mt-3 min-h-48 font-mono text-xs"
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
        />
      </details>

      <div className="flex items-end gap-4">
        <Field label={t("fieldModel")} value={model} onChange={setModel} options={REPORT_MODELS} />
        <Button
          variant="outline"
          size="lg"
          className="ml-auto"
          disabled={!transcript.trim()}
          onClick={copyPrompt}
        >
          {promptCopied ? <Check className="size-4" /> : <ClipboardCopy className="size-4" />}
          {promptCopied ? t("btnCopied") : t("btnCopyPrompt")}
        </Button>
        <Button
          size="lg"
          disabled={!tokenSaved || running || !transcript.trim()}
          onClick={runReport}
        >
          {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {running ? t("btnGenerating") : t("btnGenerate")}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {(running || report) && (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-5">
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={copyReport} disabled={!report || running}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? t("btnCopied") : t("btnCopy")}
            </Button>
            <Button variant="outline" size="sm" onClick={exportMarkdown} disabled={!report || running}>
              <Download className="size-3.5" />
              {t("exportMd")}
            </Button>
            <Button variant="outline" size="sm" onClick={printReport} disabled={!report || running}>
              <FileText className="size-3.5" />
              {t("exportPdf")}
            </Button>
          </div>
          <div ref={outputRef} className="prose prose-sm dark:prose-invert max-h-[28rem] max-w-none overflow-y-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
            {running && (
              <p className="flex items-center gap-2 text-muted-foreground not-prose">
                <Loader2 className="size-3.5 animate-spin" />
                {t("writing")}
              </p>
            )}
          </div>
        </div>
      )}
    </main>
    {report && !running &&
      createPortal(
        <div className="print-only prose max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
        </div>,
        document.body,
      )}
    </>
  );
}

export default Report;
