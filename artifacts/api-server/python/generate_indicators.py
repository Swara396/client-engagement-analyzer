#!/usr/bin/env python3
"""
Deterministic engagement indicator calculation from metrics.
Handles both overall metrics and per-speaker metrics when available.
Usage: python generate_indicators.py <metrics_json_path> <output_json_path>
"""
import sys
import json
import math


def clamp(val, lo=0, hi=100):
    return max(lo, min(hi, val))


def classify(score: float) -> str:
    if score >= 67:
        return "High"
    elif score >= 34:
        return "Moderate"
    return "Low"


def fluency_score(metrics: dict) -> float:
    wpm = metrics["speakingRateWpm"]
    filler_freq = metrics["fillerFrequencyPerMinute"]
    wpm_score = 100 - clamp(abs(wpm - 130) * 0.8, 0, 100)
    filler_score = clamp(100 - (filler_freq * 10), 0, 100)
    return (wpm_score + filler_score) / 2


def pause_consistency_score(metrics: dict) -> float:
    pause_count = metrics.get("pauseCount", 0)
    avg_pause = metrics.get("avgPauseDurationSeconds", 0)
    duration_min = metrics["durationSeconds"] / 60
    pauses_per_min = pause_count / duration_min if duration_min > 0 else 0
    pause_rate_score = clamp(100 - max(0, pauses_per_min - 3) * 10, 0, 100)
    pause_len_score = clamp(100 - (avg_pause * 20), 0, 100)
    return (pause_rate_score + pause_len_score) / 2


def speaking_stability_score(metrics: dict) -> float:
    energy_mean = metrics.get("energyMean", 0)
    energy_std = metrics.get("energyStd", 0)
    if energy_mean == 0:
        return 50.0
    cv = energy_std / energy_mean
    return clamp(100 - (cv * 200), 0, 100)


def filler_reduction_score(metrics: dict) -> float:
    freq = metrics["fillerFrequencyPerMinute"]
    return clamp(100 - (freq * 10), 0, 100)


def confidence_indicator(metrics: dict) -> dict:
    fluency = fluency_score(metrics)
    pause_c = pause_consistency_score(metrics)
    stability = speaking_stability_score(metrics)
    filler_r = filler_reduction_score(metrics)
    score = clamp(0.30 * fluency + 0.30 * pause_c + 0.20 * stability + 0.20 * filler_r)
    cls = classify(score)
    if cls == "High":
        explanation = "Strong fluency and consistent pacing with minimal pauses and few filler words."
    elif cls == "Moderate":
        explanation = "Reasonable fluency with some hesitations and occasional long pauses affecting confidence."
    else:
        explanation = "Signs of uncertainty — frequent filler words, irregular pauses, or low vocal consistency."
    return {"score": round(score, 1), "classification": cls, "explanation": explanation}


def question_frequency_score(metrics: dict) -> float:
    duration_min = metrics["durationSeconds"] / 60
    qpm = metrics["questionsCount"] / duration_min if duration_min > 0 else 0
    return clamp(qpm * 25, 0, 100)


def speaking_activity_score(metrics: dict) -> float:
    wpm = metrics["speakingRateWpm"]
    return clamp((wpm / 150) * 100, 0, 100)


def vocal_energy_consistency_score(metrics: dict) -> float:
    return speaking_stability_score(metrics)


def engagement_indicator(metrics: dict) -> dict:
    q_freq = question_frequency_score(metrics)
    sp_activity = speaking_activity_score(metrics)
    energy_c = vocal_energy_consistency_score(metrics)
    score = clamp(0.40 * q_freq + 0.30 * sp_activity + 0.30 * energy_c)
    cls = classify(score)
    if cls == "High":
        explanation = "Strong engagement — active questioning, sustained vocal energy, and high speaking activity."
    elif cls == "Moderate":
        explanation = "Moderate engagement with some active moments and reasonable conversational contribution."
    else:
        explanation = "Low engagement — few questions, limited vocal variety, or subdued speaking activity."
    return {"score": round(score, 1), "classification": cls, "explanation": explanation}


def filler_usage_score(metrics: dict) -> float:
    freq = metrics["fillerFrequencyPerMinute"]
    return clamp(freq * 10, 0, 100)


def long_pause_score(metrics: dict) -> float:
    longest = metrics.get("longestPauseDurationSeconds", 0)
    avg = metrics.get("avgPauseDurationSeconds", 0)
    return clamp((longest * 10 + avg * 5) / 2, 0, 100)


def self_correction_score(metrics: dict) -> float:
    return filler_usage_score(metrics) * 0.5


def hesitation_indicator(metrics: dict) -> dict:
    filler = filler_usage_score(metrics)
    long_pause = long_pause_score(metrics)
    self_corr = self_correction_score(metrics)
    score = clamp(0.40 * filler + 0.40 * long_pause + 0.20 * self_corr)
    cls = classify(score)
    if cls == "High":
        explanation = "Significant hesitation — frequent filler words, extended pauses, and signs of uncertainty."
    elif cls == "Moderate":
        explanation = "Some hesitation detected, suggesting occasional uncertainty or pauses for thought."
    else:
        explanation = "Minimal hesitation — clear, fluent delivery with few interruptions."
    return {"score": round(score, 1), "classification": cls, "explanation": explanation}


def curiosity_indicator(metrics: dict) -> dict:
    q_freq = question_frequency_score(metrics)
    clarification_bonus = clamp(metrics["questionsCount"] * 3, 0, 30)
    score = clamp(0.7 * q_freq + 0.3 * clarification_bonus)
    cls = classify(score)
    if cls == "High":
        explanation = "Strong curiosity — frequent questions and clarification requests throughout."
    elif cls == "Moderate":
        explanation = "Moderate curiosity — some questions and engagement with the subject matter."
    else:
        explanation = "Few questions posed, suggesting limited curiosity or a passive conversational role."
    return {"score": round(score, 1), "classification": cls, "explanation": explanation}


def response_continuity_score(metrics: dict) -> float:
    return pause_consistency_score(metrics)


def attentiveness_indicator(metrics: dict) -> dict:
    speech_c = speaking_stability_score(metrics)
    resp_c = response_continuity_score(metrics)
    speaking_eng = speaking_activity_score(metrics)
    score = clamp((speech_c + resp_c + speaking_eng) / 3)
    cls = classify(score)
    if cls == "High":
        explanation = "Consistent attention — steady pacing and sustained vocal engagement throughout."
    elif cls == "Moderate":
        explanation = "Generally engaged but with noticeable lapses in consistency."
    else:
        explanation = "Reduced attentiveness — irregular speech patterns, long silences, or inconsistent vocal energy."
    return {"score": round(score, 1), "classification": cls, "explanation": explanation}


def compute_indicators(metrics: dict) -> dict:
    return {
        "confidence": confidence_indicator(metrics),
        "engagement": engagement_indicator(metrics),
        "hesitation": hesitation_indicator(metrics),
        "curiosity": curiosity_indicator(metrics),
        "attentiveness": attentiveness_indicator(metrics),
    }


def generate_summary(metrics: dict, indicators: dict) -> dict:
    eng = indicators["engagement"]
    hes = indicators["hesitation"]
    cur = indicators["curiosity"]
    conf = indicators["confidence"]

    avg_score = sum(i["score"] for i in indicators.values()) / len(indicators)
    if avg_score >= 67:
        overall = "The participant demonstrated strong overall engagement and communicative confidence throughout the conversation."
    elif avg_score >= 34:
        overall = "The conversation showed moderate engagement with notable strengths and some areas that could benefit from improvement."
    else:
        overall = "The conversation revealed several areas of concern, including hesitation and limited engagement signals."

    observations = []
    if conf["classification"] == "High":
        observations.append("Strong vocal confidence with minimal filler words and consistent pacing.")
    if eng["classification"] == "High":
        observations.append("High engagement demonstrated through active questioning and sustained speaking activity.")
    if cur["classification"] == "High":
        observations.append("Exceptional curiosity with frequent clarifying questions throughout the discussion.")
    if hes["classification"] == "Low":
        observations.append("Fluent delivery with minimal hesitation markers or extended pauses.")
    if metrics.get("speakingRateWpm", 0) >= 110 and metrics.get("speakingRateWpm", 0) <= 150:
        observations.append("Optimal speaking rate (110–150 WPM) for clear communication.")
    if not observations:
        observations.append("The participant maintained consistent participation throughout the session.")

    concerns = []
    if hes["classification"] == "High":
        concerns.append("Frequent hesitation markers — address key points more clearly.")
    if conf["classification"] == "Low":
        concerns.append("Low confidence indicators — consider structured preparation before future conversations.")
    filler_freq = metrics.get("fillerFrequencyPerMinute", 0)
    if filler_freq > 5:
        concerns.append(f"High filler word frequency ({filler_freq:.1f}/min) may reduce perceived authority.")
    longest_pause = metrics.get("longestPauseDurationSeconds", 0)
    if longest_pause > 5:
        concerns.append(f"Extended pauses (up to {longest_pause:.1f}s) noted during the session.")
    if cur["classification"] == "Low":
        concerns.append("Low question frequency may indicate limited curiosity or a passive conversational role.")
    if not concerns:
        concerns.append("No significant areas of concern were identified in this session.")

    recommendations = []
    if filler_freq > 3:
        recommendations.append("Practice replacing filler words with deliberate pauses to improve perceived confidence.")
    if metrics.get("questionsCount", 0) < 3:
        recommendations.append("Encourage open-ended questions to deepen engagement and demonstrate curiosity.")
    if longest_pause > 3:
        recommendations.append("Address complex topics earlier in the conversation to reduce moments of uncertainty.")
    if conf["classification"] != "High":
        recommendations.append("Reinforce trust-building through structured, confident communication patterns.")
    if eng["classification"] != "High":
        recommendations.append("Increase vocal variety and active participation to signal higher engagement.")
    if not recommendations:
        recommendations.append("Maintain current communication style — metrics reflect strong performance.")

    return {
        "overall": overall,
        "positiveObservations": observations,
        "areasOfAttention": concerns,
        "recommendations": recommendations,
    }


def speaker_metrics_stub(sp_data: dict, overall_metrics: dict) -> dict:
    """
    Build a metrics dict for per-speaker indicator calculation.
    Text-derived metrics come from diarization; audio metrics fall back to overall values.
    """
    sp_dur = sp_data["speakingTimeSeconds"]
    participation = sp_data["participationPct"] / 100.0

    return {
        "durationSeconds": sp_dur,
        "totalWords": sp_data["wordCount"],
        "speakingRateWpm": sp_data["speakingRateWpm"],
        "questionsCount": sp_data["questionsCount"],
        "fillerWordCount": sp_data["fillerWordCount"],
        "fillerFrequencyPerMinute": sp_data["fillerFrequencyPerMinute"],
        # Audio metrics: scale overall by participation fraction as proxy
        "pauseCount": max(0, round(overall_metrics.get("pauseCount", 0) * participation)),
        "avgPauseDurationSeconds": overall_metrics.get("avgPauseDurationSeconds", 0.0),
        "longestPauseDurationSeconds": overall_metrics.get("longestPauseDurationSeconds", 0.0),
        "energyMean": overall_metrics.get("energyMean", 0.05),
        "energyStd": overall_metrics.get("energyStd", 0.02),
        "pitchMean": overall_metrics.get("pitchMean", 150.0),
        "pitchStd": overall_metrics.get("pitchStd", 30.0),
    }


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python generate_indicators.py <metrics_json> <output_json>"}))
        sys.exit(1)

    with open(sys.argv[1]) as f:
        metrics = json.load(f)

    # Overall indicators
    indicators = compute_indicators(metrics)
    summary = generate_summary(metrics, indicators)

    result = {
        "indicators": indicators,
        "summary": summary,
    }

    # Per-speaker indicators (only when diarization ran)
    speaker_data = metrics.get("speakers", {})
    if speaker_data:
        speaker_indicators = {}
        for sp_id, sp_data in speaker_data.items():
            stub = speaker_metrics_stub(sp_data, metrics)
            sp_inds = compute_indicators(stub)
            sp_summary = generate_summary(stub, sp_inds)
            speaker_indicators[sp_id] = {
                "indicators": sp_inds,
                "summary": sp_summary,
            }
        result["speakerIndicators"] = speaker_indicators

    with open(sys.argv[2], "w") as f:
        json.dump(result, f, indent=2)

    print(json.dumps({"success": True}))


if __name__ == "__main__":
    main()
