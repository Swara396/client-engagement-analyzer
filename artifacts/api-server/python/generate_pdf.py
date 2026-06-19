#!/usr/bin/env python3
"""
PDF report generation using ReportLab.
Fixes: safe string escaping, capped transcript length, robust error handling.
Usage: python generate_pdf.py <report_json_path> <output_pdf_path>
"""
import sys
import json
import os
import re


def safe_text(text: str, max_chars: int = 5000) -> str:
    """Escape XML special chars for ReportLab Paragraph and cap length."""
    if not isinstance(text, str):
        text = str(text)
    text = text[:max_chars]
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    # Remove non-printable characters that crash ReportLab
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)
    return text


def generate(report_path: str, output_path: str):
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.lib import colors
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
            HRFlowable, PageBreak
        )
        from reportlab.lib.enums import TA_CENTER, TA_LEFT
    except ImportError:
        print(json.dumps({"error": "reportlab not installed. Run: pip install reportlab"}))
        sys.exit(1)

    with open(report_path) as f:
        report = json.load(f)

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        rightMargin=2 * cm,
        leftMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
    )

    styles = getSampleStyleSheet()
    DARK    = colors.HexColor("#0F172A")
    ACCENT  = colors.HexColor("#0D9488")
    MUTED   = colors.HexColor("#64748B")
    LIGHT_BG = colors.HexColor("#F8FAFC")
    BORDER  = colors.HexColor("#E2E8F0")

    SPEAKER_PALETTE = [
        colors.HexColor("#0D9488"),
        colors.HexColor("#3B82F6"),
        colors.HexColor("#8B5CF6"),
        colors.HexColor("#F59E0B"),
        colors.HexColor("#10B981"),
        colors.HexColor("#EC4899"),
    ]

    def style(name, **kwargs):
        return ParagraphStyle(name, parent=styles["Normal"], **kwargs)

    title_style    = style("Title",    fontSize=28, textColor=DARK,   leading=34, spaceAfter=4,  fontName="Helvetica-Bold")
    h1_style       = style("H1",       fontSize=18, textColor=DARK,   leading=22, spaceBefore=16, spaceAfter=8, fontName="Helvetica-Bold")
    h2_style       = style("H2",       fontSize=13, textColor=ACCENT, leading=16, spaceBefore=12, spaceAfter=6, fontName="Helvetica-Bold")
    h3_style       = style("H3",       fontSize=11, textColor=DARK,   leading=14, spaceBefore=10, spaceAfter=4, fontName="Helvetica-Bold")
    body_style     = style("Body",     fontSize=10, textColor=DARK,   leading=15, spaceAfter=4)
    small_style    = style("Small",    fontSize=9,  textColor=MUTED,  leading=13)
    label_style    = style("Label",    fontSize=9,  textColor=MUTED,  fontName="Helvetica-Bold", spaceAfter=2)

    metrics    = report["metrics"]
    indicators = report["indicators"]
    summary    = report["summary"]
    transcript = report["transcript"]
    speakers   = report.get("speakers", {})
    has_dia    = report.get("hasDiarization", False) and bool(speakers)

    def indicator_color(cls):
        if cls == "High":     return colors.HexColor("#22C55E")
        if cls == "Moderate": return colors.HexColor("#F59E0B")
        return colors.HexColor("#EF4444")

    def make_indicator_table(inds):
        names = ["confidence", "engagement", "hesitation", "curiosity", "attentiveness"]
        rows = [["Indicator", "Score", "Classification", "Explanation"]]
        for name in names:
            ind = inds.get(name, {})
            rows.append([
                name.capitalize(),
                f"{ind.get('score', 0):.1f}/100",
                ind.get("classification", "—"),
                Paragraph(safe_text(ind.get("explanation", ""), 300), small_style),
            ])
        t = Table(rows, colWidths=[3*cm, 2.5*cm, 3*cm, 8.5*cm])
        cmds = [
            ("BACKGROUND",  (0,0), (-1,0), ACCENT),
            ("TEXTCOLOR",   (0,0), (-1,0), colors.white),
            ("FONTNAME",    (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTNAME",    (0,1), (0,-1), "Helvetica-Bold"),
            ("FONTSIZE",    (0,0), (-1,-1), 10),
            ("TEXTCOLOR",   (0,1), (0,-1), DARK),
            ("GRID",        (0,0), (-1,-1), 0.5, BORDER),
            ("TOPPADDING",  (0,0), (-1,-1), 8),
            ("BOTTOMPADDING",(0,0),(-1,-1), 8),
            ("LEFTPADDING", (0,0), (-1,-1), 8),
            ("VALIGN",      (0,0), (-1,-1), "TOP"),
            ("ROWBACKGROUNDS",(0,1),(-1,-1),[LIGHT_BG, colors.white]),
        ]
        for i, name in enumerate(names, start=1):
            cls = inds.get(name, {}).get("classification", "")
            cmds.append(("TEXTCOLOR", (2,i), (2,i), indicator_color(cls)))
            cmds.append(("FONTNAME",  (2,i), (2,i), "Helvetica-Bold"))
        t.setStyle(TableStyle(cmds))
        return t

    story = []

    # ── Cover ─────────────────────────────────────────────────────────────────
    story.append(Spacer(1, 2*cm))
    story.append(Paragraph("CLIENT ENGAGEMENT ANALYZER", style("CoverHead", fontSize=10, textColor=ACCENT, fontName="Helvetica-Bold", spaceAfter=12)))
    story.append(Paragraph("Analysis Report", title_style))
    story.append(Spacer(1, 0.3*cm))
    story.append(HRFlowable(width="100%", thickness=2, color=ACCENT, spaceAfter=16))

    meta_data = [
        ["Analysis ID",    safe_text(report["id"])],
        ["Date",           safe_text(report["date"])],
        ["Filename",       safe_text(report["filename"], 120)],
        ["Duration",       f"{metrics['durationSeconds']:.1f}s ({metrics['durationSeconds']/60:.1f} min)"],
        ["Total Words",    str(metrics["totalWords"])],
        ["Speaking Rate",  f"{metrics['speakingRateWpm']:.1f} WPM"],
    ]
    if has_dia:
        meta_data.append(["Speakers Detected", str(len(speakers))])

    meta_table = Table(meta_data, colWidths=[4*cm, 12*cm])
    meta_table.setStyle(TableStyle([
        ("FONTNAME",      (0,0), (-1,-1), "Helvetica"),
        ("FONTSIZE",      (0,0), (-1,-1), 10),
        ("TEXTCOLOR",     (0,0), (0,-1), MUTED),
        ("TEXTCOLOR",     (1,0), (1,-1), DARK),
        ("FONTNAME",      (0,0), (0,-1), "Helvetica-Bold"),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
        ("TOPPADDING",    (0,0), (-1,-1), 6),
    ]))
    story.append(meta_table)
    story.append(PageBreak())

    # ── Executive Summary ─────────────────────────────────────────────────────
    story.append(Paragraph("Executive Summary", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=BORDER, spaceAfter=10))
    story.append(Paragraph(safe_text(summary["overall"]), body_style))
    story.append(Spacer(1, 0.5*cm))

    story.append(Paragraph("Positive Observations", h2_style))
    for obs in summary.get("positiveObservations", []):
        story.append(Paragraph(f"&bull; {safe_text(obs)}", body_style))

    story.append(Paragraph("Areas Requiring Attention", h2_style))
    for concern in summary.get("areasOfAttention", []):
        story.append(Paragraph(f"&bull; {safe_text(concern)}", body_style))

    # ── Overall Metrics ───────────────────────────────────────────────────────
    story.append(Spacer(1, 0.5*cm))
    story.append(Paragraph("Overall Communication Metrics", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=BORDER, spaceAfter=10))

    metric_rows = [
        ["Metric",            "Value"],
        ["Duration",          f"{metrics['durationSeconds']:.1f}s"],
        ["Total Words",       str(metrics["totalWords"])],
        ["Speaking Rate",     f"{metrics['speakingRateWpm']:.1f} WPM"],
        ["Questions Asked",   str(metrics["questionsCount"])],
        ["Filler Words",      str(metrics["fillerWordCount"])],
        ["Filler Frequency",  f"{metrics['fillerFrequencyPerMinute']:.1f}/min"],
        ["Total Pauses",      str(metrics["pauseCount"])],
        ["Avg Pause",         f"{metrics['avgPauseDurationSeconds']:.2f}s"],
        ["Longest Pause",     f"{metrics['longestPauseDurationSeconds']:.2f}s"],
        ["Vocal Energy",      f"{metrics['energyMean']:.4f}"],
        ["Pitch Mean (Hz)",   f"{metrics['pitchMean']:.1f}"],
    ]
    mt = Table(metric_rows, colWidths=[8*cm, 8*cm])
    mt.setStyle(TableStyle([
        ("BACKGROUND",    (0,0), (-1,0), ACCENT),
        ("TEXTCOLOR",     (0,0), (-1,0), colors.white),
        ("FONTNAME",      (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTNAME",      (0,1), (0,-1), "Helvetica-Bold"),
        ("FONTSIZE",      (0,0), (-1,-1), 10),
        ("TEXTCOLOR",     (0,1), (0,-1), MUTED),
        ("TEXTCOLOR",     (1,1), (1,-1), DARK),
        ("ROWBACKGROUNDS",(0,1), (-1,-1), [LIGHT_BG, colors.white]),
        ("GRID",          (0,0), (-1,-1), 0.5, BORDER),
        ("TOPPADDING",    (0,0), (-1,-1), 8),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
        ("LEFTPADDING",   (0,0), (-1,-1), 10),
    ]))
    story.append(mt)

    # ── Indicators ────────────────────────────────────────────────────────────
    story.append(Spacer(1, 0.5*cm))
    story.append(Paragraph("Conversation Engagement Indicators", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=BORDER, spaceAfter=10))
    story.append(make_indicator_table(indicators))

    # ── Speaker Analysis ──────────────────────────────────────────────────────
    if has_dia:
        story.append(PageBreak())
        story.append(Paragraph("Speaker Analysis", h1_style))
        story.append(HRFlowable(width="100%", thickness=2, color=ACCENT, spaceAfter=10))
        story.append(Paragraph(
            f"This conversation involved {len(speakers)} detected speaker(s).",
            body_style,
        ))

        for sp_idx, sp_id in enumerate(sorted(speakers.keys())):
            sp       = speakers[sp_id]
            sp_color = SPEAKER_PALETTE[sp_idx % len(SPEAKER_PALETTE)]
            sp_label = safe_text(sp.get("label", f"Speaker {sp_idx+1}"))
            sp_inds  = sp.get("indicators", {})
            sp_sum   = sp.get("summary", {})

            story.append(Spacer(1, 0.6*cm))
            story.append(Paragraph(sp_label, style(
                f"SpkH{sp_idx}", fontSize=15, textColor=sp_color,
                fontName="Helvetica-Bold", spaceBefore=8, spaceAfter=4,
            )))
            story.append(HRFlowable(width="100%", thickness=1.5, color=sp_color, spaceAfter=8))

            sp_dur_s = sp.get("speakingTimeSeconds", 0)
            sp_rows = [
                ["Metric",          "Value"],
                ["Speaking Time",   f"{sp_dur_s:.1f}s ({sp_dur_s/60:.1f} min)"],
                ["Participation",   f"{sp.get('participationPct',0):.1f}%"],
                ["Words Spoken",    str(sp.get("wordCount", 0))],
                ["Speaking Rate",   f"{sp.get('speakingRateWpm',0):.1f} WPM"],
                ["Questions Asked", str(sp.get("questionsCount", 0))],
                ["Filler Words",    str(sp.get("fillerWordCount", 0))],
                ["Filler Frequency",f"{sp.get('fillerFrequencyPerMinute',0):.1f}/min"],
            ]
            smt = Table(sp_rows, colWidths=[8*cm, 8*cm])
            smt.setStyle(TableStyle([
                ("BACKGROUND",    (0,0), (-1,0), sp_color),
                ("TEXTCOLOR",     (0,0), (-1,0), colors.white),
                ("FONTNAME",      (0,0), (-1,0), "Helvetica-Bold"),
                ("FONTNAME",      (0,1), (0,-1), "Helvetica-Bold"),
                ("FONTSIZE",      (0,0), (-1,-1), 10),
                ("TEXTCOLOR",     (0,1), (0,-1), MUTED),
                ("TEXTCOLOR",     (1,1), (1,-1), DARK),
                ("ROWBACKGROUNDS",(0,1), (-1,-1), [LIGHT_BG, colors.white]),
                ("GRID",          (0,0), (-1,-1), 0.5, BORDER),
                ("TOPPADDING",    (0,0), (-1,-1), 7),
                ("BOTTOMPADDING", (0,0), (-1,-1), 7),
                ("LEFTPADDING",   (0,0), (-1,-1), 10),
            ]))
            story.append(smt)

            if sp_sum.get("overall"):
                story.append(Spacer(1, 0.3*cm))
                story.append(Paragraph("Assessment", h3_style))
                story.append(Paragraph(safe_text(sp_sum["overall"]), body_style))
                for obs in sp_sum.get("positiveObservations", []):
                    story.append(Paragraph(f"&#x2713; {safe_text(obs)}", style(
                        f"SpkObs{sp_idx}", fontSize=9, textColor=colors.HexColor("#16A34A"), leading=13, spaceAfter=2,
                    )))
                for concern in sp_sum.get("areasOfAttention", []):
                    story.append(Paragraph(f"! {safe_text(concern)}", style(
                        f"SpkCon{sp_idx}", fontSize=9, textColor=colors.HexColor("#D97706"), leading=13, spaceAfter=2,
                    )))

            if sp_inds:
                story.append(Spacer(1, 0.3*cm))
                story.append(Paragraph("Engagement Indicators", h3_style))
                names = ["confidence", "engagement", "hesitation", "curiosity", "attentiveness"]
                sp_ind_rows = [["Indicator", "Score", "Level"]]
                for name in names:
                    ind = sp_inds.get(name, {})
                    sp_ind_rows.append([name.capitalize(), f"{ind.get('score',0):.1f}/100", ind.get("classification","—")])
                sit = Table(sp_ind_rows, colWidths=[6*cm, 4*cm, 6*cm])
                sit_cmds = [
                    ("BACKGROUND",    (0,0), (-1,0), sp_color),
                    ("TEXTCOLOR",     (0,0), (-1,0), colors.white),
                    ("FONTNAME",      (0,0), (-1,0), "Helvetica-Bold"),
                    ("FONTNAME",      (0,1), (0,-1), "Helvetica-Bold"),
                    ("FONTSIZE",      (0,0), (-1,-1), 10),
                    ("TEXTCOLOR",     (0,1), (0,-1), DARK),
                    ("GRID",          (0,0), (-1,-1), 0.5, BORDER),
                    ("ROWBACKGROUNDS",(0,1), (-1,-1), [LIGHT_BG, colors.white]),
                    ("TOPPADDING",    (0,0), (-1,-1), 7),
                    ("BOTTOMPADDING", (0,0), (-1,-1), 7),
                    ("LEFTPADDING",   (0,0), (-1,-1), 8),
                ]
                for i, name in enumerate(names, start=1):
                    cls = sp_inds.get(name, {}).get("classification", "")
                    sit_cmds.append(("TEXTCOLOR", (2,i), (2,i), indicator_color(cls)))
                    sit_cmds.append(("FONTNAME",  (2,i), (2,i), "Helvetica-Bold"))
                sit.setStyle(TableStyle(sit_cmds))
                story.append(sit)

            recs = sp_sum.get("recommendations", [])
            if recs and recs != ["Maintain current communication style — metrics reflect strong performance."]:
                story.append(Spacer(1, 0.2*cm))
                story.append(Paragraph("Recommendations", h3_style))
                for rec in recs:
                    story.append(Paragraph(f"&#x2192; {safe_text(rec)}", body_style))

    # ── Questions Detected ────────────────────────────────────────────────────
    questions = transcript.get("questions", [])
    if questions:
        story.append(Spacer(1, 0.5*cm))
        story.append(Paragraph(f"Questions Detected ({len(questions)})", h1_style))
        story.append(HRFlowable(width="100%", thickness=1, color=BORDER, spaceAfter=10))
        for i, q in enumerate(questions[:20], 1):
            story.append(Paragraph(f"{i}. {safe_text(q, 400)}", body_style))

    # ── Recommendations ───────────────────────────────────────────────────────
    story.append(Spacer(1, 0.5*cm))
    story.append(Paragraph("Recommendations", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=BORDER, spaceAfter=10))
    for rec in summary.get("recommendations", []):
        story.append(Paragraph(f"&#x2192; {safe_text(rec)}", body_style))

    # ── Transcript Excerpt (capped at 3000 chars to prevent timeout) ──────────
    story.append(Spacer(1, 0.5*cm))
    story.append(Paragraph("Transcript Excerpt", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=BORDER, spaceAfter=10))
    full_text = transcript.get("fullText", "")
    excerpt = full_text[:3000]
    if len(full_text) > 3000:
        excerpt += " ... [full transcript available in the web app]"
    story.append(Paragraph(safe_text(excerpt, 3200), body_style))

    doc.build(story)
    print(json.dumps({"success": True, "output": output_path}))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python generate_pdf.py <report_json> <output_pdf>"}))
        sys.exit(1)
    generate(sys.argv[1], sys.argv[2])
