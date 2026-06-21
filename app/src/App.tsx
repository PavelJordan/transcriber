import { useState } from "react";
import Transcribe from "./Transcribe";
import Report from "./Report";
import Settings from "./Settings";
import { loadPrefs, savePrefs, type Prefs } from "./prefs";
import { translator } from "./i18n";

function App() {
  const [transcript, setTranscript] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);

  function updatePrefs(patch: Partial<Prefs>) {
    const next = { ...prefs, ...patch };
    savePrefs(next);
    setPrefs(next);
  }

  const t = translator(prefs.appLang);

  if (showSettings) {
    return <Settings prefs={prefs} onUpdate={updatePrefs} onBack={() => setShowSettings(false)} t={t} />;
  }
  if (transcript === null) {
    return (
      <Transcribe onReport={setTranscript} onSettings={() => setShowSettings(true)} t={t} />
    );
  }
  return (
    <Report
      transcript={transcript}
      defaultModel={prefs.model}
      defaultReportType={prefs.reportType}
      outputLang={prefs.outputLang}
      onBack={() => setTranscript(null)}
      onSettings={() => setShowSettings(true)}
      t={t}
    />
  );
}

export default App;
