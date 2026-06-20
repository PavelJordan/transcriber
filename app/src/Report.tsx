import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Check, ClipboardCopy, Copy, Download, FileText, KeyRound, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_REPORT_PROMPT } from "./defaultPrompt";

type Status = "idle" | "running" | "done" | "error";

// Forward-dated model ids — verify against Anthropic's published model list.
const MODELS = [
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5" },
  { value: "claude-opus-4-8", label: "Opus 4.8" },
];

function Report({ transcript: initialTranscript, onBack }: { transcript: string; onBack: () => void }) {
  const [tokenSaved, setTokenSaved] = useState(false);
  const [editingToken, setEditingToken] = useState(false);
  const [tokenInput, setTokenInput] = useState("");

  const [model, setModel] = useState(MODELS[0].value);
  const [prompt, setPrompt] = useState(DEFAULT_REPORT_PROMPT);
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

  async function saveToken() {
    try {
      await invoke("save_token", { token: tokenInput });
      setTokenSaved(true);
      setEditingToken(false);
      setTokenInput("");
    } catch (err) {
      setError(String(err));
    }
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

  return (
    <>
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">report</h1>
        </div>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ShieldCheck className="size-4" />
          Only the transcript text is sent to Claude.
        </span>
      </header>

      {!tokenSaved || editingToken ? (
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">Anthropic API token (optional)</span>
            <Input
              type="password"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="sk-ant-…"
            />
          </div>
          <Button onClick={saveToken} disabled={!tokenInput}>
            Save
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <KeyRound className="size-4" />
          API token saved in your keychain.
          <button className="underline underline-offset-4" onClick={() => setEditingToken(true)}>
            Change
          </button>
        </div>
      )}

      <details className="rounded-lg border bg-muted/30 px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">Report instructions</summary>
        <Textarea
          className="mt-3 min-h-48"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </details>

      <details className="rounded-lg border bg-muted/30 px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">Transcript — only this is sent</summary>
        <Textarea
          className="mt-3 min-h-48 font-mono text-xs"
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
        />
      </details>

      <div className="flex items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-muted-foreground">Model</span>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="lg"
          className="ml-auto"
          disabled={!transcript.trim()}
          onClick={copyPrompt}
        >
          {promptCopied ? <Check className="size-4" /> : <ClipboardCopy className="size-4" />}
          {promptCopied ? "Copied" : "Copy prompt"}
        </Button>
        <Button
          size="lg"
          disabled={!tokenSaved || running || !transcript.trim()}
          onClick={runReport}
        >
          {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {running ? "Generating…" : "Generate report"}
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
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button variant="outline" size="sm" onClick={exportMarkdown} disabled={!report || running}>
              <Download className="size-3.5" />
              Export .md
            </Button>
            <Button variant="outline" size="sm" onClick={printReport} disabled={!report || running}>
              <FileText className="size-3.5" />
              Export PDF
            </Button>
          </div>
          <div ref={outputRef} className="prose prose-sm dark:prose-invert max-h-[28rem] max-w-none overflow-y-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
            {running && (
              <p className="flex items-center gap-2 text-muted-foreground not-prose">
                <Loader2 className="size-3.5 animate-spin" />
                Writing…
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
