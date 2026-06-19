import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger";

const execFileAsync = promisify(execFile);
const router = Router();

const workspaceRoot = process.cwd().endsWith(path.join("artifacts", "api-server"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();

const UPLOADS_DIR = path.resolve(workspaceRoot, "artifacts/api-server/uploads");
const TRANSCRIPTS_DIR = path.resolve(workspaceRoot, "artifacts/api-server/transcripts");
const REPORTS_DIR = path.resolve(workspaceRoot, "artifacts/api-server/reports");
const PYTHON_DIR = path.resolve(workspaceRoot, "artifacts/api-server/python");

[UPLOADS_DIR, TRANSCRIPTS_DIR, REPORTS_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const ALLOWED_MIMES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav",
  "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac",
  "audio/ogg", "audio/webm", "video/webm",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, _file, cb) => {
    const id = randomUUID();
    const ext = path.extname(_file.originalname) || ".audio";
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype) || file.mimetype.startsWith("audio/") || file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

// --- Job status (file-backed so it survives route restarts) ---

type JobStatus = {
  status: "pending" | "processing" | "done" | "error";
  step: "transcribing" | "diarizing" | "analyzing" | "generating" | "complete" | null;
  error?: string;
  startedAt: string;
};

function statusPath(id: string) {
  return path.join(TRANSCRIPTS_DIR, `${id}_status.json`);
}

function writeStatus(id: string, s: JobStatus) {
  fs.writeFileSync(statusPath(id), JSON.stringify(s, null, 2));
}

function readStatus(id: string): JobStatus | null {
  const p = statusPath(id);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

// --- Python runner — no timeout (analysis can take many minutes) ---

async function runPython(
  script: string,
  args: string[],
  extraEnv: Record<string, string> = {}
): Promise<{ stdout: string; stderr: string }> {
  const pythonBin = process.env.PYTHON_BIN || "python3";
  const scriptPath = path.join(PYTHON_DIR, script);
  return execFileAsync(pythonBin, [scriptPath, ...args], {
    timeout: 0,
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env, ...extraEnv },
  });
}

function loadReport(id: string) {
  const reportPath = path.join(REPORTS_DIR, `${id}.json`);
  if (!fs.existsSync(reportPath)) return null;
  return JSON.parse(fs.readFileSync(reportPath, "utf8"));
}

// --- Background pipeline ---

async function runPipeline(uploadId: string, audioPath: string, filename: string) {
  const transcriptPath = path.join(TRANSCRIPTS_DIR, `${uploadId}.json`);
  const diarizationPath = path.join(TRANSCRIPTS_DIR, `${uploadId}_diarization.json`);
  const metricsPath = path.join(TRANSCRIPTS_DIR, `${uploadId}_metrics.json`);
  const indicatorsPath = path.join(TRANSCRIPTS_DIR, `${uploadId}_indicators.json`);
  const reportPath = path.join(REPORTS_DIR, `${uploadId}.json`);
  const pdfPath = path.join(REPORTS_DIR, `${uploadId}.pdf`);

  const hfToken = process.env.HUGGINGFACE_TOKEN || "";

  try {
    // Step 1: Transcribe (skip if a valid transcript already exists from a prior run)
    const transcriptExists = fs.existsSync(transcriptPath) &&
      JSON.parse(fs.readFileSync(transcriptPath, "utf8")).fullText?.length > 0;

    if (transcriptExists) {
      logger.info({ uploadId }, "Transcript already exists — skipping transcription");
      writeStatus(uploadId, { status: "processing", step: "transcribing", startedAt: new Date().toISOString() });
    } else {
      writeStatus(uploadId, { status: "processing", step: "transcribing", startedAt: new Date().toISOString() });
      logger.info({ uploadId }, "Starting transcription");
      const { stdout: transcriptOut, stderr: transcriptErr } = await runPython("transcribe.py", [
        audioPath,
        transcriptPath,
        process.env.WHISPER_MODEL || "small",
      ]);
      if (transcriptErr) logger.warn({ stderr: transcriptErr }, "Transcription stderr");
      const transcriptResult = JSON.parse(transcriptOut.trim());
      if (transcriptResult.error) throw new Error(`Transcription failed: ${transcriptResult.error}`);
    }

    // Step 2: Speaker diarization (skip if diarization output already exists)
    let hasDiarization = false;
    let diarizationData: any = null;
    const diarizationExists = fs.existsSync(diarizationPath);

    if (hfToken && diarizationExists) {
      logger.info({ uploadId }, "Diarization already exists — skipping diarization");
      diarizationData = JSON.parse(fs.readFileSync(diarizationPath, "utf8"));
      hasDiarization = true;
    } else if (hfToken) {
      writeStatus(uploadId, { status: "processing", step: "diarizing", startedAt: new Date().toISOString() });
      logger.info({ uploadId }, "Starting speaker diarization");
      try {
        const { stdout: diaOut, stderr: diaErr } = await runPython(
          "diarize.py",
          [audioPath, transcriptPath, diarizationPath],
          { HUGGINGFACE_TOKEN: hfToken }
        );
        if (diaErr) logger.warn({ stderr: diaErr }, "Diarization stderr");
        const diaResult = JSON.parse(diaOut.trim());
        if (diaResult.error) {
          logger.warn({ uploadId, error: diaResult.error }, "Diarization failed, continuing without speaker data");
        } else {
          hasDiarization = true;
          diarizationData = diaResult;
          logger.info({ uploadId, speakerCount: diaResult.speakerCount }, "Diarization complete");
        }
      } catch (diaErr: any) {
        logger.warn({ uploadId, err: diaErr.message }, "Diarization error, continuing without speaker data");
      }
    } else {
      logger.info({ uploadId }, "HUGGINGFACE_TOKEN not set — skipping diarization");
    }

    // Step 3: Audio analysis
    writeStatus(uploadId, { status: "processing", step: "analyzing", startedAt: new Date().toISOString() });
    logger.info({ uploadId }, "Starting audio analysis");
    const { stdout: metricsOut, stderr: metricsErr } = await runPython("analyze_audio.py", [
      audioPath,
      transcriptPath,
      metricsPath,
    ]);
    if (metricsErr) logger.warn({ stderr: metricsErr }, "Audio analysis stderr");
    const metricsResult = JSON.parse(metricsOut.trim());
    if (metricsResult.error) throw new Error(`Audio analysis failed: ${metricsResult.error}`);

    // Step 4: Engagement indicators
    writeStatus(uploadId, { status: "processing", step: "generating", startedAt: new Date().toISOString() });
    logger.info({ uploadId }, "Generating engagement indicators");
    const { stdout: indOut } = await runPython("generate_indicators.py", [metricsPath, indicatorsPath]);
    const indResult = JSON.parse(indOut.trim());
    if (indResult.error) throw new Error(`Indicator generation failed: ${indResult.error}`);

    // Load all computed data
    const transcript = JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
    const metrics = JSON.parse(fs.readFileSync(metricsPath, "utf8"));
    const indData = JSON.parse(fs.readFileSync(indicatorsPath, "utf8"));

    // Build per-speaker profiles by merging metrics + indicators
    let speakersProfile: Record<string, any> = {};
    if (hasDiarization && metrics.speakers && indData.speakerIndicators) {
      for (const spId of Object.keys(metrics.speakers)) {
        const spMetrics = metrics.speakers[spId];
        const spInd = indData.speakerIndicators[spId] || {};
        speakersProfile[spId] = {
          ...spMetrics,
          indicators: spInd.indicators || {},
          summary: spInd.summary || {},
        };
      }
    }

    const report: Record<string, any> = {
      id: uploadId,
      date: new Date().toISOString(),
      filename,
      hasDiarization,
      transcript: {
        id: uploadId,
        fullText: transcript.fullText,
        segments: transcript.segments,
        questions: transcript.questions,
        fillerWords: transcript.fillerWords,
      },
      metrics: {
        durationSeconds: metrics.durationSeconds,
        totalWords: metrics.totalWords,
        speakingRateWpm: metrics.speakingRateWpm,
        questionsCount: metrics.questionsCount,
        fillerWordCount: metrics.fillerWordCount,
        fillerFrequencyPerMinute: metrics.fillerFrequencyPerMinute,
        pauseCount: metrics.pauseCount,
        avgPauseDurationSeconds: metrics.avgPauseDurationSeconds,
        longestPauseDurationSeconds: metrics.longestPauseDurationSeconds,
        energyMean: metrics.energyMean,
        energyStd: metrics.energyStd,
        pitchMean: metrics.pitchMean,
        pitchStd: metrics.pitchStd,
      },
      indicators: indData.indicators,
      summary: indData.summary,
      speakers: speakersProfile,
      pdfAvailable: false,
    };

    // Step 5: PDF
    logger.info({ uploadId }, "Generating PDF report");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    const { stdout: pdfOut } = await runPython("generate_pdf.py", [reportPath, pdfPath]);
    const pdfResult = JSON.parse(pdfOut.trim());
    report.pdfAvailable = !pdfResult.error && fs.existsSync(pdfPath);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    writeStatus(uploadId, { status: "done", step: "complete", startedAt: new Date().toISOString() });
    logger.info({ uploadId }, "Analysis complete");
  } catch (err: any) {
    logger.error({ err, uploadId }, "Analysis pipeline failed");
    writeStatus(uploadId, {
      status: "error",
      step: null,
      error: err.stderr || err.message || "Unknown error",
      startedAt: new Date().toISOString(),
    });
  }
}

// POST /api/upload
router.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded. Use multipart/form-data with field name 'file'." });
    return;
  }
  const uploadId = path.basename(req.file.filename, path.extname(req.file.filename));
  req.log.info({ uploadId, filename: req.file.originalname, size: req.file.size }, "File uploaded");
  res.json({
    uploadId,
    filename: req.file.originalname,
    size: req.file.size,
    mimeType: req.file.mimetype,
  });
});

// POST /api/analyze — starts pipeline in background, returns immediately
router.post("/analyze", (req, res) => {
  const { uploadId } = req.body as { uploadId?: string };
  if (!uploadId) {
    res.status(400).json({ error: "uploadId is required" });
    return;
  }

  const uploadFiles = fs.readdirSync(UPLOADS_DIR).filter((f) => f.startsWith(uploadId));
  if (uploadFiles.length === 0) {
    res.status(400).json({ error: `No uploaded file found for uploadId: ${uploadId}` });
    return;
  }

  const existingStatus = readStatus(uploadId);
  if (existingStatus && (existingStatus.status === "processing" || existingStatus.status === "done")) {
    res.json({ uploadId, status: existingStatus.status });
    return;
  }

  const audioPath = path.join(UPLOADS_DIR, uploadFiles[0]);
  const filename = uploadFiles[0];

  writeStatus(uploadId, { status: "pending", step: null, startedAt: new Date().toISOString() });
  req.log.info({ uploadId, hasDiarization: !!process.env.HUGGINGFACE_TOKEN }, "Queuing analysis pipeline");

  runPipeline(uploadId, audioPath, filename).catch(() => {});

  res.json({ uploadId, status: "processing" });
});

// GET /api/status/:id
router.get("/status/:id", (req, res) => {
  const { id } = req.params;
  const s = readStatus(id);
  if (!s) {
    res.status(404).json({ error: "No job found for this ID" });
    return;
  }
  res.json(s);
});

// GET /api/transcript/:id
router.get("/transcript/:id", (req, res) => {
  const { id } = req.params;
  const transcriptPath = path.join(TRANSCRIPTS_DIR, `${id}.json`);
  if (!fs.existsSync(transcriptPath)) {
    res.status(404).json({ error: "Transcript not found" });
    return;
  }
  const t = JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
  res.json({
    id,
    fullText: t.fullText,
    segments: t.segments,
    questions: t.questions,
    fillerWords: t.fillerWords,
  });
});

// GET /api/report/demo — fully pre-built simulated sales call report
const DEMO_REPORT = {
  id: "demo",
  date: "2025-03-14T10:22:00.000Z",
  filename: "sales-call-acme-corp-Q1.mp3",
  hasDiarization: true,
  pdfAvailable: true,
  transcript: {
    id: "demo",
    fullText:
      "Hi Sarah, thanks for making time today. I wanted to walk you through what we've been seeing in your sector. " +
      "Um, so first of all, how has the quarter been treating you? Yeah, that's actually a great point. " +
      "We've seen similar patterns across our client base. Can you tell me more about the budget cycle for Q2? " +
      "Basically we have about three months to close this. What are the main blockers on your end right now? " +
      "That makes sense. Uh, so if we could address the integration concern, would that move things forward? " +
      "Absolutely. And you know, we have a dedicated onboarding team that handles exactly that. " +
      "What does your procurement process look like from here? " +
      "Right, so the legal review typically takes two to three weeks on our side as well. " +
      "Can we schedule a technical call with your IT team next week? " +
      "That sounds great. Um, I'll send over the security documentation today. " +
      "One more thing — what would success look like for you at the six-month mark? " +
      "Perfect. I think we're well-aligned on that. Let's lock in the next steps.",
    segments: [
      { start: 0.0,   end: 6.4,  text: "Hi Sarah, thanks for making time today. I wanted to walk you through what we've been seeing in your sector.", speaker: "SPEAKER_00", isQuestion: false, fillerWords: [] },
      { start: 6.9,   end: 10.1, text: "Um, so first of all, how has the quarter been treating you?", speaker: "SPEAKER_00", isQuestion: true,  fillerWords: ["Um"] },
      { start: 11.0,  end: 16.8, text: "Yeah, that's actually a great point. We've seen similar patterns across our client base.", speaker: "SPEAKER_01", isQuestion: false, fillerWords: ["actually"] },
      { start: 17.5,  end: 21.2, text: "Can you tell me more about the budget cycle for Q2?", speaker: "SPEAKER_00", isQuestion: true,  fillerWords: [] },
      { start: 21.9,  end: 26.3, text: "Basically we have about three months to close this.", speaker: "SPEAKER_01", isQuestion: false, fillerWords: ["Basically"] },
      { start: 27.0,  end: 31.4, text: "What are the main blockers on your end right now?", speaker: "SPEAKER_00", isQuestion: true,  fillerWords: [] },
      { start: 32.1,  end: 39.7, text: "That makes sense. Uh, so if we could address the integration concern, would that move things forward?", speaker: "SPEAKER_00", isQuestion: true,  fillerWords: ["Uh"] },
      { start: 40.5,  end: 47.2, text: "Absolutely. And you know, we have a dedicated onboarding team that handles exactly that.", speaker: "SPEAKER_01", isQuestion: false, fillerWords: ["you know"] },
      { start: 48.0,  end: 52.6, text: "What does your procurement process look like from here?", speaker: "SPEAKER_00", isQuestion: true,  fillerWords: [] },
      { start: 53.3,  end: 59.8, text: "Right, so the legal review typically takes two to three weeks on our side as well.", speaker: "SPEAKER_01", isQuestion: false, fillerWords: [] },
      { start: 60.5,  end: 65.1, text: "Can we schedule a technical call with your IT team next week?", speaker: "SPEAKER_00", isQuestion: true,  fillerWords: [] },
      { start: 65.9,  end: 71.4, text: "That sounds great. Um, I'll send over the security documentation today.", speaker: "SPEAKER_00", isQuestion: false, fillerWords: ["Um"] },
      { start: 72.2,  end: 78.9, text: "One more thing — what would success look like for you at the six-month mark?", speaker: "SPEAKER_00", isQuestion: true,  fillerWords: [] },
      { start: 79.7,  end: 85.3, text: "Perfect. I think we're well-aligned on that. Let's lock in the next steps.", speaker: "SPEAKER_01", isQuestion: false, fillerWords: [] },
    ],
    questions: [
      "Um, so first of all, how has the quarter been treating you?",
      "Can you tell me more about the budget cycle for Q2?",
      "What are the main blockers on your end right now?",
      "Uh, so if we could address the integration concern, would that move things forward?",
      "What does your procurement process look like from here?",
      "Can we schedule a technical call with your IT team next week?",
      "One more thing — what would success look like for you at the six-month mark?",
    ],
    fillerWords: ["Um", "actually", "Basically", "Uh", "you know", "Um"],
  },
  metrics: {
    durationSeconds: 514,
    totalWords: 187,
    speakingRateWpm: 131.2,
    questionsCount: 7,
    fillerWordCount: 6,
    fillerFrequencyPerMinute: 0.7,
    pauseCount: 18,
    avgPauseDurationSeconds: 0.64,
    longestPauseDurationSeconds: 2.8,
    energyMean: 0.052,
    energyStd: 0.018,
    pitchMean: 168.4,
    pitchStd: 31.2,
  },
  indicators: {
    confidence: {
      score: 74.6,
      classification: "High",
      explanation: "Strong fluency and consistent pacing with minimal pauses and few filler words.",
    },
    engagement: {
      score: 68.3,
      classification: "High",
      explanation: "Strong engagement — active questioning, sustained vocal energy, and high speaking activity.",
    },
    hesitation: {
      score: 22.1,
      classification: "Low",
      explanation: "Minimal hesitation — clear, fluent delivery with few interruptions.",
    },
    curiosity: {
      score: 81.5,
      classification: "High",
      explanation: "Strong curiosity — frequent questions and clarification requests throughout.",
    },
    attentiveness: {
      score: 71.8,
      classification: "High",
      explanation: "Consistent attention — steady pacing and sustained vocal engagement throughout.",
    },
  },
  summary: {
    overall:
      "The participant demonstrated strong overall engagement and communicative confidence throughout the conversation. Active discovery questioning and minimal hesitation markers indicate a highly effective sales interaction.",
    positiveObservations: [
      "Strong vocal confidence with minimal filler words and consistent pacing.",
      "High engagement demonstrated through active questioning and sustained speaking activity.",
      "Exceptional curiosity with frequent clarifying questions throughout the discussion.",
      "Optimal speaking rate (110–150 WPM) for clear communication.",
    ],
    areasOfAttention: [
      "No significant areas of concern were identified in this session.",
    ],
    recommendations: [
      "Maintain current communication style — metrics reflect strong performance.",
      "Consider deepening next-step commitments to accelerate deal velocity.",
    ],
  },
  speakers: {
    SPEAKER_00: {
      label: "Speaker 1 (Sales Rep)",
      speakingTimeSeconds: 312,
      participationPct: 60.7,
      wordCount: 118,
      speakingRateWpm: 136.5,
      questionsCount: 7,
      fillerWordCount: 4,
      fillerFrequencyPerMinute: 0.8,
      indicators: {
        confidence:    { score: 76.2, classification: "High",     explanation: "Confident delivery with structured questioning and minimal hesitation." },
        engagement:    { score: 72.4, classification: "High",     explanation: "Strong engagement — active questioning and sustained vocal energy." },
        hesitation:    { score: 18.3, classification: "Low",      explanation: "Very few hesitation markers — fluent and purposeful speech." },
        curiosity:     { score: 87.1, classification: "High",     explanation: "Exceptional curiosity — seven targeted discovery questions." },
        attentiveness: { score: 74.5, classification: "High",     explanation: "Steady pacing and consistent follow-up signals strong attentiveness." },
      },
      summary: {
        overall: "The sales rep demonstrated excellent discovery technique with consistent confidence and high curiosity throughout.",
        positiveObservations: ["Strong vocal confidence with minimal filler words.", "High curiosity with frequent discovery questions."],
        areasOfAttention: ["No significant areas of concern."],
        recommendations: ["Maintain current communication style — metrics reflect strong performance."],
      },
    },
    SPEAKER_01: {
      label: "Speaker 2 (Client)",
      speakingTimeSeconds: 202,
      participationPct: 39.3,
      wordCount: 69,
      speakingRateWpm: 120.8,
      questionsCount: 0,
      fillerWordCount: 2,
      fillerFrequencyPerMinute: 0.6,
      indicators: {
        confidence:    { score: 61.4, classification: "Moderate", explanation: "Reasonable fluency with some hedging language and moderate pacing." },
        engagement:    { score: 55.9, classification: "Moderate", explanation: "Moderate engagement — responsive but limited proactive contribution." },
        hesitation:    { score: 31.7, classification: "Low",      explanation: "Some hesitation detected but overall delivery remains clear." },
        curiosity:     { score: 28.4, classification: "Low",      explanation: "Few questions posed — mostly responding rather than initiating." },
        attentiveness: { score: 63.2, classification: "Moderate", explanation: "Generally engaged with noticeable but minor lapses in continuity." },
      },
      summary: {
        overall: "The client was responsive and engaged, providing clear answers with moderate vocal confidence.",
        positiveObservations: ["Clear answers with low filler frequency.", "Consistent response continuity throughout."],
        areasOfAttention: ["Low question frequency indicates a passive conversational role."],
        recommendations: ["Encourage open-ended questions to deepen engagement."],
      },
    },
  },
};

// GET /api/report/:id
router.get("/report/:id", (req, res) => {
  if (req.params.id === "demo") {
    res.json(DEMO_REPORT);
    return;
  }
  const report = loadReport(req.params.id);
  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.json(report);
});

// GET /api/download-pdf/:id
// Special case: "demo" generates the PDF on-demand from the in-memory demo
// report, caching it in REPORTS_DIR so subsequent downloads are instant.
router.get("/download-pdf/:id", async (req, res) => {
  const { id } = req.params;
  const pdfPath = path.join(REPORTS_DIR, `${id}.pdf`);

  if (id === "demo" && !fs.existsSync(pdfPath)) {
    // Write the demo report JSON so generate_pdf.py can read it
    const demoJsonPath = path.join(REPORTS_DIR, "demo.json");
    try {
      fs.writeFileSync(demoJsonPath, JSON.stringify(DEMO_REPORT, null, 2));
      const { stdout } = await runPython("generate_pdf.py", [demoJsonPath, pdfPath]);
      const result = JSON.parse(stdout.trim());
      if (result.error) {
        res.status(500).json({ error: `PDF generation failed: ${result.error}` });
        return;
      }
    } catch (err: any) {
      logger.error({ err }, "Demo PDF generation failed");
      res.status(500).json({ error: "Could not generate demo PDF. Check server logs." });
      return;
    }
  }

  if (!fs.existsSync(pdfPath)) {
    res.status(404).json({ error: "PDF not found. Run analysis first." });
    return;
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="report-${id}.pdf"`);
  fs.createReadStream(pdfPath).pipe(res as any);
});

// GET /api/analyses
router.get("/analyses", (req, res) => {
  if (!fs.existsSync(REPORTS_DIR)) {
    res.json([]);
    return;
  }
  const files = fs.readdirSync(REPORTS_DIR).filter((f) => f.endsWith(".json"));
  const summaries = files
    .map((f) => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), "utf8"));
        return {
          id: r.id,
          date: r.date,
          filename: r.filename,
          durationSeconds: r.metrics?.durationSeconds ?? 0,
          overallEngagement: r.indicators?.engagement?.classification ?? "Unknown",
          pdfAvailable: r.pdfAvailable ?? false,
          hasDiarization: r.hasDiarization ?? false,
          speakerCount: Object.keys(r.speakers || {}).length,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

  res.json(summaries);
});

export default router;
