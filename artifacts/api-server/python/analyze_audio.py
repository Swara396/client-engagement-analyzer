#!/usr/bin/env python3
"""
Audio analysis using librosa, numpy, scipy.
Optimised for long files (10-20 min):
 - Streams audio in chunks to avoid loading entire file into RAM
 - Vectorised pitch extraction (no per-frame Python loop)
 - Downsampled to 16kHz mono (3x less data than native rate)
Usage: python analyze_audio.py <audio_path> <transcript_json_path> <output_json_path>
"""
import sys
import json
import os


def analyze(audio_path: str, transcript_path: str, output_path: str):
    try:
        import librosa
        import numpy as np
    except ImportError:
        print(json.dumps({"error": "librosa/numpy not installed. Run: pip install librosa numpy scipy"}))
        sys.exit(1)

    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"Audio file not found: {audio_path}"}))
        sys.exit(1)

    if not os.path.exists(transcript_path):
        print(json.dumps({"error": f"Transcript not found: {transcript_path}"}))
        sys.exit(1)

    with open(transcript_path) as f:
        transcript = json.load(f)

    # ── Load audio in chunks to avoid OOM on long files ───────────────────────
    # We use soundfile via librosa's streaming API; falls back to full load if
    # the backend doesn't support block_size (e.g. mp3 → needs audioread).
    SR = 16000  # 16kHz mono is sufficient for speech analysis
    CHUNK = SR * 30  # 30-second chunks

    rms_frames_list = []
    pitch_values = []
    total_samples = 0

    try:
        import soundfile as sf
        with sf.SoundFile(audio_path) as f_sf:
            native_sr = f_sf.samplerate
            # Resample factor
            for block in f_sf.blocks(blocksize=int(CHUNK * native_sr / SR), dtype="float32"):
                # Mix to mono
                if block.ndim > 1:
                    block = block.mean(axis=1)
                # Resample to SR
                chunk = librosa.resample(block, orig_sr=native_sr, target_sr=SR)
                total_samples += len(chunk)

                # RMS energy
                rms = librosa.feature.rms(y=chunk, frame_length=2048, hop_length=512)[0]
                rms_frames_list.append(rms)

                # Pitch: vectorised — get index of max magnitude per frame
                pitch_hop = 2048
                pitches, magnitudes = librosa.piptrack(y=chunk, sr=SR, hop_length=pitch_hop)
                # max magnitude index per time frame (vectorised, no Python loop)
                max_mag_idx = np.argmax(magnitudes, axis=0)
                frame_pitches = pitches[max_mag_idx, np.arange(pitches.shape[1])]
                voiced = frame_pitches > 50
                pitch_values.extend(frame_pitches[voiced].tolist())
                del pitches, magnitudes

        rms_frames = np.concatenate(rms_frames_list)
        duration = total_samples / SR

    except Exception:
        # Fallback: full load (for mp3/m4a that soundfile can't stream)
        y, sr = librosa.load(audio_path, sr=SR, mono=True, res_type="kaiser_fast")
        duration = librosa.get_duration(y=y, sr=sr)

        rms_frames = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]

        pitch_hop = 2048
        pitches, magnitudes = librosa.piptrack(y=y, sr=sr, hop_length=pitch_hop)
        max_mag_idx = np.argmax(magnitudes, axis=0)
        frame_pitches = pitches[max_mag_idx, np.arange(pitches.shape[1])]
        voiced = frame_pitches > 50
        pitch_values = frame_pitches[voiced].tolist()
        del pitches, magnitudes

    # ── Energy features ───────────────────────────────────────────────────────
    energy_mean = float(np.mean(rms_frames))
    energy_std = float(np.std(rms_frames))

    # ── Pitch stats ───────────────────────────────────────────────────────────
    pv = np.array(pitch_values, dtype=np.float32)
    pitch_mean = float(np.mean(pv)) if len(pv) > 0 else 0.0
    pitch_std = float(np.std(pv)) if len(pv) > 0 else 0.0

    # ── Speaking rate ─────────────────────────────────────────────────────────
    word_count = transcript.get("wordCount", 0)
    duration_minutes = duration / 60.0
    speaking_rate = round(word_count / duration_minutes, 2) if duration_minutes > 0 else 0.0

    # ── Silence / pause detection ─────────────────────────────────────────────
    silence_threshold = np.percentile(rms_frames, 20) * 1.5
    frames_per_sec = SR / 512  # hop_length=512
    min_pause_frames = int(0.5 * frames_per_sec)

    is_silent = rms_frames < silence_threshold
    pauses = []
    in_pause = False
    pause_start = 0

    for i, silent in enumerate(is_silent):
        if silent and not in_pause:
            in_pause = True
            pause_start = i
        elif not silent and in_pause:
            in_pause = False
            pause_len = i - pause_start
            if pause_len >= min_pause_frames:
                pauses.append(round(pause_len / frames_per_sec, 2))

    if in_pause:
        pause_len = len(is_silent) - pause_start
        if pause_len >= min_pause_frames:
            pauses.append(round(pause_len / frames_per_sec, 2))

    pause_count = len(pauses)
    avg_pause = round(float(np.mean(pauses)), 2) if pauses else 0.0
    longest_pause = round(float(max(pauses)), 2) if pauses else 0.0

    # ── Filler / question info from transcript ────────────────────────────────
    filler_count = len(transcript.get("fillerWords", []))
    filler_freq_per_min = round(filler_count / duration_minutes, 2) if duration_minutes > 0 else 0.0
    questions_count = len(transcript.get("questions", []))

    metrics = {
        "durationSeconds": round(duration, 2),
        "totalWords": word_count,
        "speakingRateWpm": speaking_rate,
        "questionsCount": questions_count,
        "fillerWordCount": filler_count,
        "fillerFrequencyPerMinute": filler_freq_per_min,
        "pauseCount": pause_count,
        "avgPauseDurationSeconds": avg_pause,
        "longestPauseDurationSeconds": longest_pause,
        "energyMean": round(energy_mean, 6),
        "energyStd": round(energy_std, 6),
        "pitchMean": round(pitch_mean, 2),
        "pitchStd": round(pitch_std, 2),
    }

    # ── Per-speaker breakdown (only when diarization ran) ─────────────────────
    segments = transcript.get("segments", [])
    has_speakers = any("speaker" in seg for seg in segments)

    if has_speakers:
        raw = {}
        for seg in segments:
            sp = seg.get("speaker", "SPEAKER_00")
            if sp not in raw:
                raw[sp] = {"speakingTime": 0.0, "words": 0, "questions": 0, "fillers": 0}
            seg_dur = max(0.0, seg["end"] - seg["start"])
            raw[sp]["speakingTime"] += seg_dur
            raw[sp]["words"] += len(seg.get("text", "").split())
            if seg.get("isQuestion"):
                raw[sp]["questions"] += 1
            raw[sp]["fillers"] += len(seg.get("fillerWords", []))

        total_speaking = sum(v["speakingTime"] for v in raw.values()) or duration
        speakers_sorted = sorted(raw.keys())

        speakers_metrics = {}
        for idx, sp in enumerate(speakers_sorted):
            d = raw[sp]
            sp_mins = d["speakingTime"] / 60.0
            wpm = round(d["words"] / sp_mins, 2) if sp_mins > 0 else 0.0
            filler_freq = round(d["fillers"] / sp_mins, 2) if sp_mins > 0 else 0.0
            participation = round(d["speakingTime"] / total_speaking * 100, 1)

            speakers_metrics[sp] = {
                "label": f"Speaker {idx + 1}",
                "speakingTimeSeconds": round(d["speakingTime"], 2),
                "participationPct": participation,
                "wordCount": d["words"],
                "speakingRateWpm": wpm,
                "questionsCount": d["questions"],
                "fillerWordCount": d["fillers"],
                "fillerFrequencyPerMinute": filler_freq,
            }

        metrics["speakers"] = speakers_metrics

    with open(output_path, "w") as f:
        json.dump(metrics, f, indent=2)

    print(json.dumps({"success": True, "output": output_path}))


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(json.dumps({"error": "Usage: python analyze_audio.py <audio_path> <transcript_json> <output_json>"}))
        sys.exit(1)

    analyze(sys.argv[1], sys.argv[2], sys.argv[3])
