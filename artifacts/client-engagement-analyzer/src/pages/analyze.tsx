import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import {
  UploadCloud, Mic, Square, Pause, Play, Trash2, Send,
  FileAudio, CheckCircle, AlertCircle, Loader2, StopCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type AnalysisStep = "idle" | "uploading" | "transcribing" | "analyzing" | "generating" | "done" | "error";

const STEPS: { key: AnalysisStep; label: string }[] = [
  { key: "uploading",    label: "Uploading audio file" },
  { key: "transcribing", label: "Transcribing with Whisper AI" },
  { key: "analyzing",   label: "Analyzing audio features" },
  { key: "generating",  label: "Generating insights & PDF" },
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Map server step names → UI step indices
const SERVER_STEP_TO_IDX: Record<string, number> = {
  transcribing: 1,
  analyzing:    2,
  generating:   3,
  complete:     4,
};

export function Analyze() {
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<"upload" | "record">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [step, setStep] = useState<AnalysisStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(-1);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Recording state
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "paused" | "stopped">("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (pollRef.current) clearInterval(pollRef.current);
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    };
  }, [audioUrl]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      mr.start(100);
      setRecordingState("recording");
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch {
      setError("Microphone access denied. Please allow microphone permissions.");
    }
  }, []);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      setRecordingState("paused");
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, []);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      setRecordingState("recording");
      timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      setRecordingState("stopped");
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, []);

  const deleteRecording = useCallback(() => {
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setRecordingState("idle");
    setRecordingSeconds(0);
  }, [audioUrl]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  const activeFile = mode === "record"
    ? (audioBlob ? new File([audioBlob], `recording-${Date.now()}.webm`, { type: "audio/webm" }) : null)
    : file;

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
  };

  const startPolling = (uploadId: string) => {
    setElapsedSeconds(0);
    elapsedRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${uploadId}`);
        if (!res.ok) return;
        const status = await res.json();

        if (status.status === "done") {
          stopPolling();
          setStep("done");
          setStepIndex(4);
          setTimeout(() => navigate(`/results/${uploadId}`), 800);
        } else if (status.status === "error") {
          stopPolling();
          setStep("error");
          setError(status.error || "Analysis failed. Please try again.");
        } else if (status.step) {
          const idx = SERVER_STEP_TO_IDX[status.step] ?? 1;
          setStepIndex(idx);
          setStep(status.step as AnalysisStep);
        }
      } catch {
        // network hiccup — keep polling
      }
    }, 3000);
  };

  const runAnalysis = async () => {
    if (!activeFile) return;
    setStep("uploading");
    setStepIndex(0);
    setError(null);
    setElapsedSeconds(0);

    try {
      // Step 1: Upload
      const form = new FormData();
      form.append("file", activeFile);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: form });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      const { uploadId } = await uploadRes.json();

      setStep("transcribing");
      setStepIndex(1);

      // Step 2: Kick off background analysis (returns immediately)
      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId }),
      });
      if (!analyzeRes.ok) {
        const err = await analyzeRes.json().catch(() => ({ error: "Could not start analysis" }));
        throw new Error(err.error || "Could not start analysis");
      }

      // Step 3: Poll /api/status/:id until done
      startPolling(uploadId);
    } catch (err: any) {
      stopPolling();
      setStep("error");
      setError(err.message || "An unexpected error occurred.");
    }
  };

  const progressPct = step === "idle" || step === "error"
    ? 0
    : step === "done"
    ? 100
    : Math.min(Math.round(((stepIndex + 0.5) / STEPS.length) * 100), 95);

  const isAnalyzing = ["uploading", "transcribing", "analyzing", "generating"].includes(step);

  const formatElapsed = (s: number) => {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  return (
    <div className="container mx-auto max-w-3xl px-4 py-12 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Analyze Recording</h1>
        <p className="mt-2 text-muted-foreground">
          Upload an audio file or record directly in your browser for real-time engagement analysis.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 p-1 bg-muted rounded-lg w-fit">
        <button
          onClick={() => setMode("upload")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all",
            mode === "upload" ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <UploadCloud className="w-4 h-4" />
          Upload File
        </button>
        <button
          onClick={() => setMode("record")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all",
            mode === "record" ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Mic className="w-4 h-4" />
          Record Live
        </button>
      </div>

      {mode === "upload" && (
        <div
          className={cn(
            "border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer",
            isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
          )}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mp3,audio/mpeg,audio/wav,audio/x-wav,audio/m4a,audio/x-m4a,audio/mp4,.mp3,.wav,.m4a"
            className="hidden"
            onChange={handleFileChange}
          />
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <UploadCloud className="w-8 h-8 text-primary" />
            </div>
            <div>
              <p className="text-lg font-medium">Drop audio file here or click to browse</p>
              <p className="text-sm text-muted-foreground mt-1">MP3, WAV, M4A · Max 500 MB</p>
            </div>
          </div>
        </div>
      )}

      {mode === "record" && (
        <div className="bg-card border border-border rounded-2xl p-8 space-y-6">
          <div className="flex items-center justify-center gap-4">
            <div className={cn(
              "w-24 h-24 rounded-full flex items-center justify-center transition-all",
              recordingState === "recording"
                ? "bg-destructive/10 ring-4 ring-destructive/30 animate-pulse"
                : "bg-muted"
            )}>
              <Mic className={cn("w-10 h-10", recordingState === "recording" ? "text-destructive" : "text-muted-foreground")} />
            </div>
          </div>

          {(recordingState === "recording" || recordingState === "paused") && (
            <div className="text-center">
              <p className="text-4xl font-mono font-bold tabular-nums">
                {formatDuration(recordingSeconds)}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {recordingState === "paused" ? "Paused" : "Recording..."}
              </p>
            </div>
          )}

          <div className="flex items-center justify-center gap-3">
            {recordingState === "idle" && (
              <Button onClick={startRecording} size="lg" className="gap-2">
                <Mic className="w-5 h-5" />
                Start Recording
              </Button>
            )}
            {(recordingState === "recording" || recordingState === "paused") && (
              <>
                {recordingState === "recording" ? (
                  <Button onClick={pauseRecording} variant="outline" size="lg" className="gap-2">
                    <Pause className="w-5 h-5" />
                    Pause
                  </Button>
                ) : (
                  <Button onClick={resumeRecording} variant="outline" size="lg" className="gap-2">
                    <Play className="w-5 h-5" />
                    Resume
                  </Button>
                )}
                <Button onClick={stopRecording} size="lg" className="gap-2 bg-destructive hover:bg-destructive/90">
                  <StopCircle className="w-5 h-5" />
                  Stop
                </Button>
              </>
            )}
            {recordingState === "stopped" && (
              <Button onClick={deleteRecording} variant="outline" size="lg" className="gap-2">
                <Trash2 className="w-4 h-4" />
                Delete
              </Button>
            )}
          </div>

          {audioUrl && recordingState === "stopped" && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Playback</p>
              <audio controls src={audioUrl} className="w-full" />
            </div>
          )}
        </div>
      )}

      {/* Selected file info */}
      {activeFile && (
        <div className="flex items-center gap-4 p-4 bg-card border border-border rounded-xl">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <FileAudio className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{activeFile.name}</p>
            <p className="text-sm text-muted-foreground">{formatBytes(activeFile.size)}</p>
          </div>
          {!isAnalyzing && (
            <button
              onClick={() => { setFile(null); deleteRecording(); }}
              className="text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Analysis progress */}
      {isAnalyzing && (
        <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <p className="font-medium">Running Analysis</p>
            <span className="text-sm text-muted-foreground tabular-nums">{formatElapsed(elapsedSeconds)}</span>
          </div>
          <Progress value={progressPct} className="h-2" />
          <div className="space-y-2 mt-2">
            {STEPS.map((s, i) => {
              const isDone = i < stepIndex;
              const isCurrent = i === stepIndex;
              return (
                <div key={s.key} className={cn("flex items-center gap-3 text-sm transition-colors", isDone ? "text-primary" : isCurrent ? "text-foreground" : "text-muted-foreground")}>
                  {isDone ? (
                    <CheckCircle className="w-4 h-4 shrink-0 text-primary" />
                  ) : isCurrent ? (
                    <Loader2 className="w-4 h-4 shrink-0 animate-spin text-primary" />
                  ) : (
                    <div className="w-4 h-4 shrink-0 rounded-full border border-current" />
                  )}
                  {s.label}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground pt-2 border-t border-border">
            Transcription can take several minutes for long recordings. The page will update automatically — you can leave this tab open.
          </p>
        </div>
      )}

      {step === "done" && (
        <div className="flex items-center gap-3 p-4 bg-primary/5 border border-primary/20 rounded-xl text-primary">
          <CheckCircle className="w-5 h-5 shrink-0" />
          <p className="font-medium">Analysis complete. Redirecting to results...</p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 p-4 bg-destructive/5 border border-destructive/20 rounded-xl text-destructive">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Analysis failed</p>
            <p className="text-sm mt-1 opacity-80">{error}</p>
          </div>
        </div>
      )}

      <Button
        onClick={runAnalysis}
        disabled={!activeFile || isAnalyzing}
        size="lg"
        className="w-full h-14 text-base gap-2"
      >
        {isAnalyzing ? (
          <><Loader2 className="w-5 h-5 animate-spin" />Analyzing...</>
        ) : (
          <><Send className="w-5 h-5" />Analyze Recording</>
        )}
      </Button>
    </div>
  );
}
