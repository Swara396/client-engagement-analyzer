import { useState } from "react";
import { useRoute, Link } from "wouter";
import {
  Download, ChevronDown, ChevronUp, Search, ArrowLeft,
  Activity, MessageSquare, Zap, Eye, HelpCircle, AlertTriangle,
  TrendingUp, Clock, BarChart2, Loader2, AlertCircle, Users, User
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useGetReport } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell
} from "recharts";

// ── Types ────────────────────────────────────────────────────────────────────

type Indicator = { score: number; classification: string; explanation: string };
type Indicators = Record<string, Indicator>;
type SpeakerProfile = {
  label: string;
  speakingTimeSeconds: number;
  participationPct: number;
  wordCount: number;
  speakingRateWpm: number;
  questionsCount: number;
  fillerWordCount: number;
  fillerFrequencyPerMinute: number;
  indicators?: Indicators;
  summary?: {
    overall: string;
    positiveObservations: string[];
    areasOfAttention: string[];
    recommendations: string[];
  };
};

// ── Constants ────────────────────────────────────────────────────────────────

const INDICATOR_META = {
  confidence:    { icon: Activity,      label: "Confidence",    color: "hsl(180, 70%, 35%)" },
  engagement:    { icon: Zap,           label: "Engagement",    color: "hsl(210, 70%, 50%)" },
  hesitation:    { icon: AlertTriangle, label: "Hesitation",    color: "hsl(30, 90%, 55%)"  },
  curiosity:     { icon: HelpCircle,    label: "Curiosity",     color: "hsl(270, 60%, 55%)" },
  attentiveness: { icon: Eye,           label: "Attentiveness", color: "hsl(150, 60%, 40%)" },
};

const SPEAKER_COLORS = [
  { bg: "bg-teal-100 dark:bg-teal-900/30",   text: "text-teal-700 dark:text-teal-300",   border: "border-teal-200 dark:border-teal-800",   bar: "hsl(180,70%,35%)"  },
  { bg: "bg-blue-100 dark:bg-blue-900/30",   text: "text-blue-700 dark:text-blue-300",   border: "border-blue-200 dark:border-blue-800",   bar: "hsl(210,70%,50%)"  },
  { bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-700 dark:text-purple-300", border: "border-purple-200 dark:border-purple-800", bar: "hsl(270,60%,55%)"  },
  { bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-300", border: "border-amber-200 dark:border-amber-800", bar: "hsl(30,90%,55%)"   },
  { bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-200 dark:border-emerald-800", bar: "hsl(150,60%,40%)" },
  { bg: "bg-pink-100 dark:bg-pink-900/30",   text: "text-pink-700 dark:text-pink-300",   border: "border-pink-200 dark:border-pink-800",   bar: "hsl(340,70%,50%)"  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function classificationBadge(cls: string) {
  if (cls === "High")     return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400">High</Badge>;
  if (cls === "Moderate") return <Badge className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400">Moderate</Badge>;
  return <Badge className="bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400">Low</Badge>;
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function formatTimestamp(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

function speakerColorIdx(speakerId: string, sortedIds: string[]) {
  return sortedIds.indexOf(speakerId) % SPEAKER_COLORS.length;
}

function highlightText(text: string, search: string, fillerWords: string[]) {
  const allPatterns: RegExp[] = [];
  if (fillerWords.length) allPatterns.push(new RegExp(`\\b(${fillerWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi"));
  if (search)             allPatterns.push(new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  if (!allPatterns.length) return text;

  const fillerRe = fillerWords.length ? allPatterns[0] : null;
  const searchRe = search ? allPatterns[allPatterns.length - 1] : null;
  const combined = new RegExp(allPatterns.map(p => p.source).join("|"), "gi");

  const parts: React.ReactNode[] = [];
  let lastIdx = 0, key = 0, match: RegExpExecArray | null;
  combined.lastIndex = 0;
  while ((match = combined.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    const word = match[0];
    const isFiller = fillerRe && (fillerRe.lastIndex = 0, fillerRe.test(word));
    const isSearch = searchRe && (searchRe.lastIndex = 0, searchRe.test(word));
    parts.push(
      <mark key={key++} className={cn("rounded px-0.5",
        isFiller ? "bg-amber-200 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200" : "",
        isSearch  ? "bg-primary/20 text-primary" : ""
      )}>{word}</mark>
    );
    lastIdx = match.index + word.length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return <>{parts}</>;
}

// ── Speaker indicator mini-bar ───────────────────────────────────────────────

function SpeakerIndicatorRow({ label, ind }: { label: string; ind: Indicator }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-semibold">{ind.score}/100</span>
          {classificationBadge(ind.classification)}
        </div>
      </div>
      <Progress value={ind.score} className="h-1" />
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function Results() {
  const [, params] = useRoute("/results/:id");
  const id = params?.id ?? "";
  const { data: report, isLoading, error } = useGetReport(id, {
    query: { enabled: !!id, queryKey: ["report", id] },
  });

  const [searchQuery, setSearchQuery]           = useState("");
  const [transcriptExpanded, setTranscriptExpanded] = useState(true);
  const [activeSpeakerFilter, setActiveSpeakerFilter] = useState<string | null>(null);
  const [expandedSpeakers, setExpandedSpeakers] = useState<Record<string, boolean>>({});

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-24 flex flex-col items-center gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading analysis report...</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-24 flex flex-col items-center gap-4">
        <AlertCircle className="w-10 h-10 text-destructive" />
        <p className="text-lg font-medium">Report not found</p>
        <p className="text-muted-foreground text-sm">The analysis may still be processing or the ID is invalid.</p>
        <Link href="/analyze">
          <Button variant="outline" className="gap-2 mt-2"><ArrowLeft className="w-4 h-4" />Back to Analyze</Button>
        </Link>
      </div>
    );
  }

  const indicators  = report.indicators as unknown as Indicators;
  const metrics     = report.metrics;
  const summary     = report.summary as any;
  const transcript  = report.transcript;
  const speakers    = (report as any).speakers as Record<string, SpeakerProfile> | undefined;
  const hasDia      = !!(report as any).hasDiarization && speakers && Object.keys(speakers).length > 0;
  const speakerIds  = hasDia ? Object.keys(speakers!).sort() : [];

  const radarData = Object.entries(INDICATOR_META).map(([key, meta]) => ({
    subject: meta.label,
    score: indicators[key]?.score ?? 0,
  }));

  const filteredSegments = (transcript.segments as any[]).filter(seg => {
    const matchSearch  = !searchQuery || seg.text.toLowerCase().includes(searchQuery.toLowerCase());
    const matchSpeaker = !activeSpeakerFilter || seg.speaker === activeSpeakerFilter;
    return matchSearch && matchSpeaker;
  });

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 space-y-8">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Link href="/history">
            <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2">
              <ArrowLeft className="w-4 h-4" />All Analyses
            </button>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight truncate max-w-lg">{report.filename}</h1>
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-sm text-muted-foreground">
              {new Date(report.date).toLocaleString()}
            </p>
            {hasDia && (
              <Badge className="gap-1.5 bg-primary/10 text-primary border-primary/20">
                <Users className="w-3 h-3" />{speakerIds.length} Speakers Detected
              </Badge>
            )}
          </div>
        </div>
        {report.pdfAvailable && (
          <Button onClick={() => window.open(`/api/download-pdf/${report.id}`, "_blank")} className="gap-2 shrink-0">
            <Download className="w-4 h-4" />Download PDF
          </Button>
        )}
      </div>

      {/* ── Key stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { icon: Clock,      label: "Duration",      value: formatDuration(metrics.durationSeconds) },
          { icon: MessageSquare, label: "Words",       value: metrics.totalWords.toLocaleString() },
          { icon: BarChart2,  label: "Speaking Rate",  value: `${Math.round(metrics.speakingRateWpm)} WPM` },
          { icon: TrendingUp, label: "Questions",      value: metrics.questionsCount },
        ].map(stat => (
          <div key={stat.label} className="bg-card border border-border rounded-xl p-4 space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground">
              <stat.icon className="w-4 h-4" /><span className="text-xs font-medium">{stat.label}</span>
            </div>
            <p className="text-2xl font-bold">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* ── Overall radar + indicators ── */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            {hasDia ? "Overall Engagement Profile" : "Engagement Profile"}
          </h2>
          {hasDia && <p className="text-xs text-muted-foreground mb-3">Whole conversation · all speakers combined</p>}
          <ResponsiveContainer width="100%" height={250}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="hsl(var(--border))" />
              <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <Radar name="Score" dataKey="score" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div className="space-y-3">
          {Object.entries(INDICATOR_META).map(([key, meta]) => {
            const ind = indicators[key];
            if (!ind) return null;
            const Icon = meta.icon;
            return (
              <div key={key} className="bg-card border border-border rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4" style={{ color: meta.color }} />
                    <span className="font-medium text-sm">{meta.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-semibold">{ind.score}/100</span>
                    {classificationBadge(ind.classification)}
                  </div>
                </div>
                <Progress value={ind.score} className="h-1.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">{ind.explanation}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Speaker Breakdown (only when diarization ran) ── */}
      {hasDia && speakers && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold">Speaker Breakdown</h2>
          </div>

          {/* Participation bar */}
          <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Speaking Time Distribution</h3>
            <div className="flex rounded-lg overflow-hidden h-6">
              {speakerIds.map((spId, idx) => {
                const sp = speakers[spId];
                const c  = SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
                return (
                  <div
                    key={spId}
                    style={{ width: `${sp.participationPct}%`, backgroundColor: c.bar }}
                    className="relative group cursor-default"
                    title={`${sp.label}: ${sp.participationPct}%`}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap gap-4">
              {speakerIds.map((spId, idx) => {
                const sp = speakers[spId];
                const c  = SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
                return (
                  <div key={spId} className="flex items-center gap-2 text-sm">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: c.bar }} />
                    <span className="font-medium">{sp.label}</span>
                    <span className="text-muted-foreground">{sp.participationPct}% · {formatDuration(sp.speakingTimeSeconds)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Per-speaker cards */}
          {speakerIds.map((spId, idx) => {
            const sp  = speakers[spId];
            const c   = SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
            const expanded = expandedSpeakers[spId] ?? false;
            return (
              <div key={spId} className={cn("bg-card border rounded-2xl overflow-hidden", c.border)}>
                {/* Card header */}
                <div className={cn("flex items-center justify-between p-5", c.bg)}>
                  <div className="flex items-center gap-3">
                    <div className={cn("w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm", c.bg, c.text, "border", c.border)}>
                      {idx + 1}
                    </div>
                    <div>
                      <p className={cn("font-bold text-base", c.text)}>{sp.label}</p>
                      <p className="text-xs text-muted-foreground">{sp.participationPct}% participation · {formatDuration(sp.speakingTimeSeconds)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setExpandedSpeakers(prev => ({ ...prev, [spId]: !expanded }))}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </button>
                </div>

                {/* Compact stats row (always visible) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 divide-x divide-y sm:divide-y-0 divide-border border-t border-border">
                  {[
                    { label: "Words",        value: sp.wordCount.toLocaleString() },
                    { label: "Rate",         value: `${Math.round(sp.speakingRateWpm)} WPM` },
                    { label: "Questions",    value: sp.questionsCount },
                    { label: "Filler Words", value: sp.fillerWordCount },
                  ].map(m => (
                    <div key={m.label} className="p-4 text-center">
                      <p className="text-xs text-muted-foreground">{m.label}</p>
                      <p className="text-xl font-bold mt-0.5">{m.value}</p>
                    </div>
                  ))}
                </div>

                {/* Expandable: indicators + summary */}
                {expanded && (
                  <div className="p-5 space-y-5 border-t border-border">
                    {sp.indicators && (
                      <div className="space-y-3">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Engagement Indicators</h4>
                        <div className="grid sm:grid-cols-2 gap-3">
                          {Object.entries(INDICATOR_META).map(([key, meta]) => {
                            const ind = sp.indicators![key];
                            if (!ind) return null;
                            return (
                              <div key={key} className="space-y-1 p-3 rounded-lg bg-muted/30">
                                <div className="flex items-center gap-1.5 mb-1">
                                  <meta.icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
                                  <span className="text-xs font-medium">{meta.label}</span>
                                </div>
                                <SpeakerIndicatorRow label="" ind={ind} />
                                <p className="text-xs text-muted-foreground leading-relaxed mt-1">{ind.explanation}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {sp.summary && (
                      <div className="space-y-3">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Assessment</h4>
                        <p className="text-sm leading-relaxed">{sp.summary.overall}</p>
                        <div className="grid sm:grid-cols-2 gap-3">
                          {sp.summary.positiveObservations.length > 0 && (
                            <div className="space-y-1.5">
                              <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Strengths</p>
                              {sp.summary.positiveObservations.map((obs, i) => (
                                <p key={i} className="flex gap-1.5 text-xs"><span className="text-emerald-500 shrink-0">·</span>{obs}</p>
                              ))}
                            </div>
                          )}
                          {sp.summary.areasOfAttention.length > 0 && (
                            <div className="space-y-1.5">
                              <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Areas of Attention</p>
                              {sp.summary.areasOfAttention.map((area, i) => (
                                <p key={i} className="flex gap-1.5 text-xs"><span className="text-amber-500 shrink-0">·</span>{area}</p>
                              ))}
                            </div>
                          )}
                        </div>
                        {sp.summary.recommendations.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-xs font-semibold text-primary uppercase tracking-wider">Recommendations</p>
                            {sp.summary.recommendations.map((rec, i) => (
                              <p key={i} className="flex gap-1.5 text-xs"><span className="text-primary shrink-0">→</span>{rec}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Speaking Metrics ── */}
      <div className="bg-card border border-border rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          {hasDia ? "Overall Speaking Metrics" : "Speaking Metrics"}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            { label: "Filler Words",    value: metrics.fillerWordCount },
            { label: "Filler Frequency", value: `${metrics.fillerFrequencyPerMinute.toFixed(1)}/min` },
            { label: "Total Pauses",    value: metrics.pauseCount },
            { label: "Avg Pause",       value: `${metrics.avgPauseDurationSeconds.toFixed(2)}s` },
            { label: "Longest Pause",   value: `${metrics.longestPauseDurationSeconds.toFixed(2)}s` },
            { label: "Vocal Energy",    value: metrics.energyMean.toFixed(4) },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-lg bg-muted/40">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="text-lg font-semibold mt-0.5">{m.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Executive Summary ── */}
      <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Executive Summary</h2>
        <p className="text-base leading-relaxed">{summary.overall}</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Positive Observations</p>
            <ul className="space-y-1.5">
              {summary.positiveObservations.map((obs: string, i: number) => (
                <li key={i} className="flex gap-2 text-sm"><span className="text-emerald-500 shrink-0 mt-0.5">·</span>{obs}</li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Areas of Attention</p>
            <ul className="space-y-1.5">
              {summary.areasOfAttention.map((area: string, i: number) => (
                <li key={i} className="flex gap-2 text-sm"><span className="text-amber-500 shrink-0 mt-0.5">·</span>{area}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* ── Recommendations ── */}
      <div className="bg-card border border-border rounded-2xl p-6 space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Recommendations</h2>
        <div className="space-y-2">
          {summary.recommendations.map((rec: string, i: number) => (
            <div key={i} className="flex gap-3 items-start p-3 rounded-lg bg-primary/5 border border-primary/10">
              <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-semibold shrink-0 mt-0.5">{i + 1}</span>
              <p className="text-sm leading-relaxed">{rec}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Questions detected ── */}
      {(transcript.questions as any[]).length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-6 space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Questions Detected ({(transcript.questions as any[]).length})
          </h2>
          <div className="space-y-2">
            {(transcript.questions as any[]).map((q: string, i: number) => (
              <div key={i} className="flex gap-3 p-3 rounded-lg bg-muted/40 text-sm">
                <span className="text-primary font-semibold shrink-0">{i + 1}.</span>{q}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Transcript Viewer ── */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Transcript ({(transcript.segments as any[]).length} segments)
          </h2>
          <button
            onClick={() => setTranscriptExpanded(v => !v)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {transcriptExpanded ? <><ChevronUp className="w-4 h-4" />Collapse</> : <><ChevronDown className="w-4 h-4" />Expand</>}
          </button>
        </div>

        {transcriptExpanded && (
          <>
            <div className="p-4 border-b border-border space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="search"
                  placeholder="Search transcript..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm bg-muted rounded-lg border border-transparent focus:border-primary focus:outline-none transition-colors"
                />
              </div>

              {hasDia && speakerIds.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setActiveSpeakerFilter(null)}
                    className={cn("px-3 py-1 rounded-full text-xs font-medium transition-colors border",
                      !activeSpeakerFilter
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground border-transparent hover:border-border"
                    )}
                  >
                    All Speakers
                  </button>
                  {speakerIds.map((spId, idx) => {
                    const sp = speakers![spId];
                    const c  = SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
                    return (
                      <button
                        key={spId}
                        onClick={() => setActiveSpeakerFilter(activeSpeakerFilter === spId ? null : spId)}
                        className={cn("px-3 py-1 rounded-full text-xs font-medium transition-colors border",
                          activeSpeakerFilter === spId ? `${c.bg} ${c.text} ${c.border}` : "bg-muted text-muted-foreground border-transparent hover:border-border"
                        )}
                      >
                        {sp.label}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-200 dark:bg-amber-900/50" />Filler words</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-primary/20" />Search match</span>
                {hasDia && <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-100 dark:bg-blue-900/30" />Question</span>}
              </div>
            </div>

            <div className="max-h-[500px] overflow-y-auto divide-y divide-border">
              {filteredSegments.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">No segments match your filters.</p>
              ) : (
                filteredSegments.map((seg: any, i: number) => {
                  const spIdx  = hasDia && seg.speaker ? speakerColorIdx(seg.speaker, speakerIds) : -1;
                  const spColor = spIdx >= 0 ? SPEAKER_COLORS[spIdx % SPEAKER_COLORS.length] : null;
                  const spLabel = hasDia && seg.speaker && speakers ? speakers[seg.speaker]?.label : null;
                  return (
                    <div
                      key={i}
                      className={cn(
                        "flex gap-3 p-4 text-sm hover:bg-muted/30 transition-colors",
                        seg.isQuestion ? "bg-blue-50/50 dark:bg-blue-950/20" : ""
                      )}
                    >
                      <span className="text-xs font-mono text-muted-foreground shrink-0 pt-0.5 w-[4.5rem]">
                        {formatTimestamp(seg.start)}
                      </span>
                      {spLabel && spColor && (
                        <span className={cn("shrink-0 self-start px-2 py-0.5 rounded-full text-xs font-semibold border", spColor.bg, spColor.text, spColor.border)}>
                          {spLabel}
                        </span>
                      )}
                      <p className="leading-relaxed flex-1">
                        {highlightText(seg.text, searchQuery, seg.fillerWords || [])}
                      </p>
                      {seg.isQuestion && <HelpCircle className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />}
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-4 border-t border-border">
              <a href={`/api/transcript/${report.id}`} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
                Download transcript JSON
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
