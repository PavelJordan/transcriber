import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, FileAudio, Loader2, ShieldCheck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SidecarEvent =
  | { type: "start"; device: string; model: string; language: string; duration: number }
  | { type: "segment"; start: number; end: number; text: string }
  | { type: "done"; txt: string; srt: string; vtt: string };

type Segment = { start: number; text: string };
type Status = "idle" | "running" | "done" | "error";

const MODELS = ["tiny", "base", "small", "medium", "large-v3"];
const DEVICES = [
  { value: "auto", label: "Auto" },
  { value: "cuda", label: "GPU" },
  { value: "cpu", label: "CPU" },
];
const LANGUAGES = [
  { value: "auto", label: "Auto-detect" },
  { value: "cs", label: "Čeština" },
  { value: "en", label: "English" },
];
const MEDIA_EXTENSIONS = ["mp4", "mkv", "mov", "webm", "m4a", "mp3", "wav", "flac", "ogg"];

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function fileName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function Transcribe() {
  const [file, setFile] = useState<string | null>(null);
  const [model, setModel] = useState("large-v3");
  const [device, setDevice] = useState("auto");
  const [language, setLanguage] = useState("cs");

  const [status, setStatus] = useState<Status>("idle");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [info, setInfo] = useState<{ language: string; duration: number } | null>(null);
  const [savedTxt, setSavedTxt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = listen<string>("transcribe://event", ({ payload }) => {
      const event = JSON.parse(payload) as SidecarEvent;
      if (event.type === "start") {
        setInfo({ language: event.language, duration: event.duration });
      } else if (event.type === "segment") {
        setSegments((prev) => [...prev, { start: event.start, text: event.text }]);
      } else if (event.type === "done") {
        setSavedTxt(event.txt);
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
    setSavedTxt(null);
    setError(null);
    try {
      await invoke("transcribe", {
        input: file,
        model,
        device,
        language: language === "auto" ? null : language,
      });
    } catch (err) {
      setError(String(err));
      setStatus("error");
    }
  }

  const running = status === "running";

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">transcriber</h1>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ShieldCheck className="size-4" />
          Audio never leaves your device.
        </span>
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
            <span className="text-sm text-muted-foreground">Click to choose a different recording</span>
          </>
        ) : (
          <>
            <Upload className="size-7 text-muted-foreground" />
            <span className="font-medium">Drop a recording here, or click to browse</span>
            <span className="text-sm text-muted-foreground">Video or audio — it stays on this machine</span>
          </>
        )}
      </button>

      <div className="flex flex-wrap items-end gap-4">
        <Field label="Model" value={model} onChange={setModel} options={MODELS.map((name) => ({ value: name, label: name }))} />
        <Field label="Device" value={device} onChange={setDevice} options={DEVICES} />
        <Field label="Language" value={language} onChange={setLanguage} options={LANGUAGES} />
        <Button size="lg" className="ml-auto" disabled={!file || running} onClick={runTranscribe}>
          {running && <Loader2 className="size-4 animate-spin" />}
          {running ? "Transcribing…" : "Transcribe"}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {(running || segments.length > 0) && (
        <div ref={logRef} className="max-h-80 overflow-y-auto rounded-lg border bg-muted/30 p-4 text-sm">
          {info && (
            <p className="pb-2 text-xs text-muted-foreground">
              Detected {info.language} · {formatTime(info.duration)}
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
              {segments.length > 0 ? "Listening…" : "Loading model…"}
            </p>
          )}
        </div>
      )}

      {savedTxt && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-foreground" />
          Saved next to your recording: {fileName(savedTxt)}, .srt, .vtt
        </div>
      )}
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default Transcribe;
