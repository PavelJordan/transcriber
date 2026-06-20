import { useState } from "react";
import Transcribe from "./Transcribe";
import Report from "./Report";

function App() {
  const [transcript, setTranscript] = useState<string | null>(null);

  if (transcript === null) {
    return <Transcribe onReport={setTranscript} />;
  }
  return <Report transcript={transcript} onBack={() => setTranscript(null)} />;
}

export default App;
