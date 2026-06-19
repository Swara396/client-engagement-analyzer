#!/usr/bin/env python3
"""
Speaker diarization using pyannote.audio.
Merges speaker assignments into the existing Whisper transcript segments.
Usage: python diarize.py <audio_path> <transcript_json_path> <output_diarization_path>

Requires:
  - HUGGINGFACE_TOKEN env var with access to pyannote/speaker-diarization-3.1
  - User must accept model terms at:
    https://hf.co/pyannote/speaker-diarization-3.1
    https://hf.co/pyannote/segmentation-3.0
"""
import sys
import json
import os

# Limit how long huggingface_hub waits when checking cached-file freshness.
# Without this, the ETag request can hang indefinitely on restricted networks.
# We still allow model *downloads* via HF_HUB_DOWNLOAD_TIMEOUT.
os.environ.setdefault("HF_HUB_ETAG_TIMEOUT", "10")
os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "300")


def overlap(s1, e1, s2, e2):
    return max(0.0, min(e1, e2) - max(s1, s2))


def assign_speakers(transcript_segments, dia_segments):
    """
    For each transcript segment find the diarization segment with the
    greatest time overlap and assign its speaker label.
    Falls back to "SPEAKER_00" for segments with no overlap.
    """
    for seg in transcript_segments:
        best_speaker = None
        best_overlap = 0.0
        for d in dia_segments:
            ov = overlap(seg["start"], seg["end"], d["start"], d["end"])
            if ov > best_overlap:
                best_overlap = ov
                best_speaker = d["speaker"]
        seg["speaker"] = best_speaker if best_speaker else "SPEAKER_00"
    return transcript_segments


def diarize(audio_path: str, transcript_path: str, output_path: str):
    hf_token = os.environ.get("HUGGINGFACE_TOKEN", "").strip()
    if not hf_token:
        print(json.dumps({"error": "HUGGINGFACE_TOKEN is not set. Add it in Replit Secrets."}))
        sys.exit(1)

    try:
        from pyannote.audio import Pipeline
        import torch
    except ImportError:
        print(json.dumps({"error": "pyannote.audio not installed. Run: pip install pyannote.audio torch"}))
        sys.exit(1)

    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"Audio file not found: {audio_path}"}))
        sys.exit(1)

    if not os.path.exists(transcript_path):
        print(json.dumps({"error": f"Transcript not found: {transcript_path}"}))
        sys.exit(1)

    with open(transcript_path) as f:
        transcript = json.load(f)

    try:
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=hf_token,
        )
        # Force CPU — no CUDA expected in Replit
        pipeline.to(torch.device("cpu"))
        diarization = pipeline(audio_path)
    except Exception as e:
        err_str = str(e)
        if "401" in err_str or "Unauthorized" in err_str or "gated" in err_str.lower():
            print(json.dumps({
                "error": (
                    "Hugging Face authentication failed. "
                    "Make sure you accepted the model terms at "
                    "https://hf.co/pyannote/speaker-diarization-3.1 "
                    "and https://hf.co/pyannote/segmentation-3.0"
                )
            }))
        else:
            print(json.dumps({"error": f"Diarization pipeline error: {err_str}"}))
        sys.exit(1)

    # Collect raw diarization segments
    dia_segments = []
    speakers_seen = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        dia_segments.append({
            "start": round(float(turn.start), 3),
            "end": round(float(turn.end), 3),
            "speaker": speaker,
        })
        if speaker not in speakers_seen:
            speakers_seen.append(speaker)

    speakers_sorted = sorted(speakers_seen)

    # Merge speakers into transcript segments (mutates in place)
    transcript["segments"] = assign_speakers(transcript.get("segments", []), dia_segments)

    # Write updated transcript back with speaker labels
    with open(transcript_path, "w") as f:
        json.dump(transcript, f, indent=2)

    # Write diarization output
    result = {
        "speakerCount": len(speakers_sorted),
        "speakers": speakers_sorted,
        "segments": dia_segments,
    }
    with open(output_path, "w") as f:
        json.dump(result, f, indent=2)

    print(json.dumps({"success": True, "speakerCount": len(speakers_sorted), "speakers": speakers_sorted}))


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(json.dumps({"error": "Usage: python diarize.py <audio_path> <transcript_json> <output_diarization_json>"}))
        sys.exit(1)

    diarize(sys.argv[1], sys.argv[2], sys.argv[3])
