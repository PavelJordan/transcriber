import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "./Field";
import { LANGUAGES, REPORT_MODELS, type Prefs } from "./prefs";
import { REPORT_TYPES } from "./reportTypes";
import { type Lang, type Translate } from "./i18n";

function Settings({
  prefs,
  onUpdate,
  onBack,
  t,
}: {
  prefs: Prefs;
  onUpdate: (patch: Partial<Prefs>) => void;
  onBack: () => void;
  t: Translate;
}) {
  const [tokenSaved, setTokenSaved] = useState(false);
  const [editingToken, setEditingToken] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<boolean>("has_token").then(setTokenSaved).catch((err) => setError(String(err)));
  }, []);

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

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{t("titleSettings")}</h1>
      </header>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!tokenSaved || editingToken ? (
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">{t("tokenLabel")}</span>
            <Input
              type="password"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="sk-ant-…"
            />
          </div>
          <Button onClick={saveToken} disabled={!tokenInput}>
            {t("btnSave")}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <KeyRound className="size-4" />
          {t("tokenSavedMsg")}
          <button className="underline underline-offset-4" onClick={() => setEditingToken(true)}>
            {t("btnChange")}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <Field
          label={t("defaultModel")}
          value={prefs.model}
          onChange={(model) => onUpdate({ model })}
          options={REPORT_MODELS}
        />
        <Field
          label={t("defaultOutputType")}
          value={prefs.reportType}
          onChange={(reportType) => onUpdate({ reportType })}
          options={REPORT_TYPES.map((type) => ({ value: type.value, label: t(type.labelKey) }))}
        />
        <Field
          label={t("appLanguage")}
          value={prefs.appLang}
          onChange={(value) => onUpdate({ appLang: value as Lang })}
          options={LANGUAGES}
        />
        <Field
          label={t("outputLanguage")}
          value={prefs.outputLang}
          onChange={(value) => onUpdate({ outputLang: value as Lang })}
          options={LANGUAGES}
        />
      </div>
    </main>
  );
}

export default Settings;
