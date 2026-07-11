#!/usr/bin/env python3
"""
Transcription service using faster-whisper (local, offline).
Automatically uses CUDA (GPU) when available, falls back to CPU gracefully.
- GPU: uses the caller-supplied model size (default "small") with float16
- CPU: downgrades to "base" model + int8 quantisation for acceptable speed
Usage: python transcribe.py <audio_file_path> <output_json_path> [model_size]
"""
import sys
import json
import os
import re


def detect_questions(text: str) -> bool:
    if text.strip().endswith("?"):
        return True
    interrogative = r"\b(what|why|when|where|who|how|can you|could you|would you|is there|are there|do you|did you|have you|will you|shall we|should we)\b"
    return bool(re.search(interrogative, text.lower()))


FILLER_WORDS = ["um", "uh", "hmm", "like", "you know", "actually", "basically"]


def detect_fillers(text: str) -> list:
    found = []
    lower = text.lower()
    for filler in FILLER_WORDS:
        pattern = r"\b" + re.escape(filler) + r"\b"
        matches = re.findall(pattern, lower)
        found.extend(matches)
    return found


def resolve_device_and_model(requested_model: str):
    """
    Dynamically pick the best device and model size for this machine.

    GPU (CUDA available):
      - device      = "cuda"
      - compute_type = "float16"  — full precision on the GPU tensor cores
      - model_size  = caller-supplied (e.g. "small", "medium", "large-v3")

    CPU (no CUDA / no GPU):
      - device      = "cpu"
      - compute_type = "int8"     — fastest CPU inference with negligible accuracy loss
      - model_size  = "base"      — lightweight enough to finish in reasonable time
        (overrides anything larger; "tiny" is also accepted if caller set it explicitly)
    """
    try:
        import torch
        cuda_available = torch.cuda.is_available()
    except ImportError:
        cuda_available = False

    if cuda_available:
        device = "cuda"
        compute_type = "float16"
        model_size = requested_model  # honour caller's choice on GPU
        print(
            json.dumps({
                "info": f"CUDA GPU detected — using device=cuda, model={model_size}, compute=float16"
            }),
            file=sys.stderr,
        )
    else:
        device = "cpu"
        compute_type = "int8"
        # On CPU, cap at "base" unless the caller explicitly asked for "tiny"
        model_size = requested_model if requested_model == "tiny" else "base"
        print(
            json.dumps({
                "info": (
                    f"No CUDA GPU found — using device=cpu, model={model_size}, compute=int8. "
                    f"(Requested model '{requested_model}' downgraded for CPU speed.)"
                )
            }),
            file=sys.stderr,
        )

    return device, compute_type, model_size


def transcribe(audio_path: str, output_path: str, model_size: str = "small"):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({"error": "faster_whisper not installed. Run: pip install faster-whisper"}))
        sys.exit(1)

    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"Audio file not found: {audio_path}"}))
        sys.exit(1)

    model_size = "tiny"
    device, compute_type, effective_model = resolve_device_and_model(model_size)

    model = WhisperModel(effective_model, device=device, compute_type=compute_type)

    # vad_filter=True skips silent segments — huge win for long files.
    # beam_size=1 gives ~2-3x speedup with minimal accuracy loss.
    # condition_on_previous_text=False avoids hallucination drift on long audio.
    segments_gen, info = model.transcribe(
        audio_path,
        beam_size=1,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        condition_on_previous_text=False,
        language=None,  # auto-detect
    )

    segments = []
    full_words = []

    for segment in segments_gen:
        text = segment.text.strip()
        if not text:
            continue
        words = text.split()
        full_words.extend(words)
        is_q = detect_questions(text)
        fillers = detect_fillers(text)
        segments.append({
            "start": round(segment.start, 2),
            "end": round(segment.end, 2),
            "text": text,
            "isQuestion": is_q,
            "fillerWords": fillers
        })

    full_text = " ".join(seg["text"] for seg in segments)
    all_questions = [seg["text"] for seg in segments if seg["isQuestion"]]
    all_fillers = []
    for seg in segments:
        all_fillers.extend(seg["fillerWords"])

    result = {
        "fullText": full_text,
        "segments": segments,
        "questions": all_questions,
        "fillerWords": all_fillers,
        "wordCount": len(full_words),
        "detectedLanguage": info.language,
        "audioDurationSeconds": round(info.duration, 2)
    }

    with open(output_path, "w") as f:
        json.dump(result, f, indent=2)

    print(json.dumps({"success": True, "output": output_path}))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python transcribe.py <audio_path> <output_path> [model_size]"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    output_path = sys.argv[2]
    model_size = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("WHISPER_MODEL", "small")
    transcribe(audio_path, output_path, model_size)
