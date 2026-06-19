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

// GET /api/report/:id
router.get("/report/:id", (req, res) => {
  const report = loadReport(req.params.id);
  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.json(report);
});

// GET /api/download-pdf/:id
router.get("/download-pdf/:id", (req, res) => {
  const { id } = req.params;
  const pdfPath = path.join(REPORTS_DIR, `${id}.pdf`);
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
