import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowRight, FileAudio, Loader2, Settings as SettingsIcon, ShieldCheck, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "./Field";
import type { Translate } from "./i18n";

type SidecarEvent =
  | { type: "start"; model: string; language: string; duration: number }
  | { type: "segment"; start: number; end: number; text: string }
  | { type: "download"; percent: number }
  | { type: "done" };

type Segment = { start: number; end: number; text: string };
type Status = "idle" | "running" | "done" | "error";

const MODELS = ["tiny", "base", "small", "medium", "large-v3"];
const MEDIA_EXTENSIONS = ["mp4", "mkv", "mov", "webm", "m4a", "mp3", "wav", "flac", "ogg"];

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function fileName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function Transcribe({
  onReport,
  onSettings,
  t,
}: {
  onReport: (transcript: string) => void;
  onSettings: () => void;
  t: Translate;
}) {
  const [file, setFile] = useState<string | null>(null);
  const [model, setModel] = useState("small");
  const [language, setLanguage] = useState("cs");

  const [status, setStatus] = useState<Status>("idle");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [info, setInfo] = useState<{ language: string; duration: number } | null>(null);
  const [download, setDownload] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = listen<string>("transcribe://event", ({ payload }) => {
      const event = JSON.parse(payload) as SidecarEvent;
      if (event.type === "start") {
        setDownload(null);
        setInfo({ language: event.language, duration: event.duration });
      } else if (event.type === "segment") {
        setSegments((prev) => [...prev, { start: event.start, end: event.end, text: event.text }]);
      } else if (event.type === "download") {
        setDownload(event.percent);
      } else if (event.type === "done") {
        setStatus("done");
      }
    });
    return () => {
      unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "over") {
        setDragging(true);
      } else if (payload.type === "drop") {
        setDragging(false);
        if (payload.paths.length > 0) setFile(payload.paths[0]);
      } else {
        setDragging(false);
      }
    });
    return () => {
      unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [segments]);

  async function browse() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Recording", extensions: MEDIA_EXTENSIONS }],
    });
    if (typeof selected === "string") setFile(selected);
  }

  async function runTranscribe() {
    if (!file) return;
    setStatus("running");
    setSegments([]);
    setInfo(null);
    setDownload(null);
    setError(null);
    try {
      await invoke("transcribe", {
        input: file,
        model,
        language: language === "auto" ? null : language,
      });
    } catch (err) {
      setError(String(err));
      setStatus("error");
    }
  }

  async function cancelTranscribe() {
    try {
      await invoke("cancel_transcribe");
      setStatus("idle");
      setSegments([]);
      setInfo(null);
    } catch (err) {
      setError(String(err));
    }
  }

  function writeReport() {
    onReport(segments.map((segment) => segment.text).join("\n"));
  }

  const running = status === "running";
  const position = segments.length > 0 ? segments[segments.length - 1].end : 0;
  const progress = info ? Math.min(100, (position / info.duration) * 100) : 0;
  const languages = [
    { value: "auto", label: t("langAuto") },
    { value: "cs", label: "Čeština" },
    { value: "en", label: "English" },
  ];

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t("titleTranscribe")}</h1>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ShieldCheck className="size-4" />
            {t("audioPrivacy")}
          </span>
          {!running && (
            <Button variant="ghost" size="icon" onClick={onSettings}>
              <SettingsIcon className="size-4" />
            </Button>
          )}
        </div>
      </header>

      <button
        onClick={browse}
        className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center transition-colors ${
          dragging ? "border-primary bg-muted" : "border-border hover:bg-muted/50"
        }`}
      >
        {file ? (
          <>
            <FileAudio className="size-7 text-muted-foreground" />
            <span className="font-medium">{fileName(file)}</span>
            <span className="text-sm text-muted-foreground">{t("dropChange")}</span>
          </>
        ) : (
          <>
            <Upload className="size-7 text-muted-foreground" />
            <span className="font-medium">{t("dropPrompt")}</span>
            <span className="text-sm text-muted-foreground">{t("dropSubtitle")}</span>
          </>
        )}
      </button>

      <div className="flex flex-wrap items-end gap-4">
        <Field label={t("fieldModel")} value={model} onChange={setModel} options={MODELS.map((name) => ({ value: name, label: name }))} triggerClassName="w-36" />
        <Field label={t("fieldLanguage")} value={language} onChange={setLanguage} options={languages} triggerClassName="w-36" />
        {running ? (
          <Button size="lg" variant="outline" className="ml-auto" onClick={cancelTranscribe}>
            <X className="size-4" />
            {t("btnCancel")}
          </Button>
        ) : status === "done" ? (
          <div className="ml-auto flex gap-2">
            <Button size="lg" variant="outline" onClick={runTranscribe}>
              {t("btnRetranscribe")}
            </Button>
            <Button size="lg" onClick={writeReport}>
              {t("btnWriteReport")}
              <ArrowRight className="size-4" />
            </Button>
          </div>
        ) : (
          <Button size="lg" className="ml-auto" disabled={!file} onClick={runTranscribe}>
            {t("btnTranscribe")}
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {running && info && (
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">{Math.round(progress)}%</span>
        </div>
      )}

      {(running || segments.length > 0) && (
        <div ref={logRef} className="max-h-80 overflow-y-auto rounded-lg border bg-muted/30 p-4 text-sm">
          {info && (
            <p className="pb-2 text-xs text-muted-foreground">
              {t("detected")} {info.language} · {formatTime(info.duration)}
            </p>
          )}
          {segments.map((segment, index) => (
            <p key={index} className="py-0.5">
              <span className="mr-2 text-muted-foreground tabular-nums">{formatTime(segment.start)}</span>
              {segment.text}
            </p>
          ))}
          {running && (
            <p className="flex items-center gap-2 py-0.5 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {download !== null && download < 100
                ? `${t("downloadingModel")} ${download}%`
                : segments.length > 0
                  ? t("listening")
                  : t("loadingModel")}
            </p>
          )}
        </div>
      )}
    </main>
  );
}

export default Transcribe;

