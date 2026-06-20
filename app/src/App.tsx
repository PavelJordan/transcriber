import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">transcriber</h1>
        <p className="max-w-md text-muted-foreground">
          Turn a meeting recording into a clean, structured report — right on
          your machine.
        </p>
      </div>

      <Button size="lg">Choose a recording</Button>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="size-4" />
        <span>Audio never leaves your device.</span>
      </div>
    </main>
  );
}

export default App;
