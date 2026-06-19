import { Link } from "wouter";
import { FileAudio, ArrowRight, Loader2, AlertCircle, Clock, BarChart2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useListAnalyses } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

function classificationColor(cls: string) {
  if (cls === "High") return "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400";
  if (cls === "Moderate") return "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400";
  return "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400";
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export function History() {
  const { data: analyses, isLoading, error } = useListAnalyses();

  return (
    <div className="container mx-auto max-w-4xl px-4 py-12 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analysis History</h1>
          <p className="mt-1 text-muted-foreground">
            All past conversation analyses and their engagement reports.
          </p>
        </div>
        <Link href="/analyze">
          <Button className="gap-2">
            <BarChart2 className="w-4 h-4" />
            New Analysis
          </Button>
        </Link>
      </div>

      {isLoading && (
        <div className="flex flex-col items-center gap-3 py-24">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading analyses...</p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 p-4 bg-destructive/5 border border-destructive/20 rounded-xl text-destructive">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p>Failed to load analyses. Make sure the API server is running.</p>
        </div>
      )}

      {!isLoading && !error && analyses?.length === 0 && (
        <div className="flex flex-col items-center gap-4 py-24 text-center">
          <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center">
            <FileAudio className="w-10 h-10 text-muted-foreground" />
          </div>
          <div>
            <p className="text-lg font-semibold">No analyses yet</p>
            <p className="text-muted-foreground mt-1 text-sm max-w-xs">
              Upload or record an audio file to run your first engagement analysis.
            </p>
          </div>
          <Link href="/analyze">
            <Button className="gap-2 mt-2">
              Start Analysis
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      )}

      {!isLoading && analyses && analyses.length > 0 && (
        <div className="space-y-3">
          {analyses.map((analysis) => (
            <div
              key={analysis.id}
              className="bg-card border border-border rounded-2xl p-5 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <FileAudio className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{analysis.filename}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(analysis.date).toLocaleString()} · ID:{" "}
                      <code className="font-mono">{analysis.id.slice(0, 8)}...</code>
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {formatDuration(analysis.durationSeconds)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        Engagement:
                        <Badge className={cn("text-xs", classificationColor(analysis.overallEngagement))}>
                          {analysis.overallEngagement}
                        </Badge>
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {analysis.pdfAvailable && (
                    <button
                      onClick={() => window.open(`/api/download-pdf/${analysis.id}`, "_blank")}
                      className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                      title="Download PDF"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  )}
                  <Link href={`/results/${analysis.id}`}>
                    <Button variant="outline" size="sm" className="gap-1.5">
                      View Report
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
