"""
ScorecardGenerator: Combines all analysis outputs into the final
CredibilityScorecard with a REAL/FAKE verdict and full dimension breakdown.

Supports dynamic weight allocation:
  - When images are analyzed: 6 dimensions (image gets 10% weight)
  - When no images: original 5 dimensions (unchanged)
"""

from typing import List, Dict, Any, Optional

from src.schemas.article_schema import (
    ArticleExtraction, OllamaAnalysis, CorroborationResult,
    CredibilityScorecard, DimensionScore, ImageAnalysisResult
)
from src.verification.tavily_corroborator import KNOWN_UNRELIABLE


class ScorecardGenerator:
    """
    Weights WITHOUT images (sum = 1.0):
      corroboration  35%
      content        25%
      source_trust   20%
      language       10%
      metadata       10%

    Weights WITH images (sum = 1.0):
      corroboration  30%  (-5%)
      content        25%
      source_trust   15%  (-5%)
      language       10%
      metadata       10%
      image          10%  (new)
    """
    WEIGHTS_NO_IMAGES = {
        "corroboration": 0.35,
        "content":       0.25,
        "source_trust":  0.20,
        "language":      0.10,
        "metadata":      0.10,
    }

    WEIGHTS_WITH_IMAGES = {
        "corroboration": 0.30,
        "content":       0.25,
        "source_trust":  0.15,
        "language":      0.10,
        "metadata":      0.10,
        "image":         0.10,
    }

    def generate(
        self,
        article: ArticleExtraction,
        ollama: OllamaAnalysis,
        corr: CorroborationResult,
        llm_reasoning: Dict[str, Any],
        image_analysis: Optional[ImageAnalysisResult] = None,
    ) -> CredibilityScorecard:

        # Decide which weight set to use based on whether images were analyzed
        has_images = (
            image_analysis is not None
            and image_analysis.total_images_analyzed > 0
        )
        weights = self.WEIGHTS_WITH_IMAGES if has_images else self.WEIGHTS_NO_IMAGES

        # ── Dimension 1: Corroboration ─────────────────────────────────────
        corr_score = round(corr.corroboration_score * 100, 1)

        # ── Dimension 2: Content quality ───────────────────────────────────────
        # Deductions for bad content signals
        bias_penalty        = min(len(ollama.bias_indicators) * 12, 40)
        misleading_penalty  = min(len(ollama.misleading_patterns) * 18, 54)
        clickbait_penalty   = min(len(ollama.clickbait_elements) * 10, 30)
        # IRRELEVANT FACTS PENALTY: each off-context fact deducts 5 points
        irrelevant_penalty  = min(len(ollama.irrelevant_facts) * 5, 30)

        # AD QUALITY PENALTY
        ad_prof = article.ad_profile
        clickbait_ad_penalty = 10 if ad_prof.has_clickbait_ads else 0
        ad_density_penalty = 0
        if ad_prof.ad_density > 1.0: # more than 1 ad per 100 words
            ad_density_penalty = min(int((ad_prof.ad_density - 1.0) * 5), 15)
        
        content_raw = 100 - bias_penalty - misleading_penalty - clickbait_penalty - irrelevant_penalty - clickbait_ad_penalty - ad_density_penalty
        # Bonuses for good signals
        if ollama.has_named_sources:  content_raw += 8
        if ollama.has_statistics:     content_raw += 5
        if ollama.has_expert_quotes:  content_raw += 8
        if ollama.language_quality == "professional": content_raw += 5
        content_score = round(max(0, min(content_raw, 100)), 1)
        content_summary = (
            f"{len(ollama.bias_indicators)} bias, "
            f"{len(ollama.misleading_patterns)} misleading, "
            f"{len(ollama.clickbait_elements)} clickbait, "
            f"{len(ollama.irrelevant_facts)} irrelevant fact(s)"
        )
        if ad_prof.total_ad_slots > 0:
            content_summary += f", {ad_prof.total_ad_slots} ads"

        # ── Dimension 3: Source trust ───────────────────────────────────────
        domain = (article.domain or "").lower().replace("www.", "")
        if any(t in domain for t in ["reuters.com", "apnews.com", "bbc.com",
                                      "bbc.co.uk", "nature.com", "nasa.gov",
                                      "cdc.gov", "nih.gov", "who.int"]):
            source_raw = 95
        elif any(t in domain for t in ["theguardian.com", "nytimes.com",
                                        "washingtonpost.com", "economist.com",
                                        "npr.org", "bloomberg.com", "wsj.com"]):
            source_raw = 82
        elif any(t in domain for t in KNOWN_UNRELIABLE):
            source_raw = 5
        elif domain.endswith(".gov") or domain.endswith(".edu"):
            source_raw = 88
        elif domain.endswith(".org"):
            source_raw = 60
        elif domain in ("raw_input", "", "unknown"):
            source_raw = 45  # neutral for unknown
        else:
            source_raw = 50
        # HTTPS bonus
        if article.uses_https:
            source_raw = min(source_raw + 5, 100)
        source_score = round(float(source_raw), 1)

        # ── Dimension 4: Language / sensationalism ─────────────────────────
        emotional_count = len(ollama.emotional_phrases)
        tone_penalty = {
            "fear": 20, "anger": 18, "sensational": 22,
            "promotional": 10, "positive": 0, "neutral": 0
        }.get(ollama.content_tone, 0)
        language_raw = 100 - min(emotional_count * 8, 40) - tone_penalty
        language_score = round(max(0, min(language_raw, 100)), 1)

        # ── Dimension 5: Metadata ──────────────────────────────────────────
        meta_raw = 50  # baseline for unknown
        if article.authors:       meta_raw += 20
        if article.publish_date:  meta_raw += 15
        if ollama.has_named_sources: meta_raw += 15
        metadata_score = round(min(meta_raw, 100), 1)

        # ── Dimension 6: Image Authenticity (only when images analyzed) ────
        image_score = 0.0
        image_summary = ""
        if has_images:
            image_score = round(image_analysis.image_authenticity_score, 1)
            image_summary = (
                f"{image_analysis.total_images_analyzed} analyzed, "
                f"{image_analysis.fake_images_detected} flagged"
            )

        # ── Weighted overall ───────────────────────────────────────────────
        overall = round(
            corr_score     * weights["corroboration"] +
            content_score  * weights["content"] +
            source_score   * weights["source_trust"] +
            language_score * weights["language"] +
            metadata_score * weights["metadata"] +
            (image_score   * weights.get("image", 0)),
            1
        )
        overall = max(0.0, min(100.0, overall))

        # Hard overrides
        if any(t in domain for t in KNOWN_UNRELIABLE):
            overall = min(overall, 18.0)
        if corr.tier1_count == 0 and corr.tier2_count == 0 and len(ollama.misleading_patterns) >= 2:
            overall = min(overall, 32.0)

        # ── Ratings and verdict ────────────────────────────────────────────
        if overall >= 75: rating = "HIGH";       verdict = "REAL"
        elif overall >= 55: rating = "MODERATE"; verdict = "LIKELY REAL"
        elif overall >= 35: rating = "LOW";      verdict = "LIKELY FAKE"
        else:               rating = "UNRELIABLE"; verdict = "FAKE"

        SUMMARIES = {
            "REAL":        "This article is credible and authentic. Multiple trusted news outlets independently corroborate the story, and the content quality is high.",
            "LIKELY REAL": "This article is mostly credible with some minor concerns — limited corroboration, slight sensationalism, or unverified secondary claims.",
            "LIKELY FAKE": "This article shows multiple credibility red flags — poor corroboration from trusted sources, biased language, or misleading patterns detected.",
            "FAKE":        "This article is highly likely to be fake or misinformation. It failed critical checks: no trusted sources cover the story, and the content shows signs of deliberate manipulation.",
        }

        # ── Build dimension list ───────────────────────────────────────────
        dims = [
            DimensionScore(name="Corroboration",  score=corr_score,     weight=weights["corroboration"], contribution=round(corr_score*weights["corroboration"],1),     summary=corr.verdict_label),
            DimensionScore(name="Content Quality", score=content_score,  weight=weights["content"],       contribution=round(content_score*weights["content"],1),        summary=content_summary),
            DimensionScore(name="Source Trust",    score=source_score,   weight=weights["source_trust"],  contribution=round(source_score*weights["source_trust"],1),    summary=f"Domain: {domain or 'unknown'}"),
            DimensionScore(name="Language",        score=language_score, weight=weights["language"],      contribution=round(language_score*weights["language"],1),      summary=f"Tone: {ollama.content_tone} | {emotional_count} emotional phrase(s)"),
            DimensionScore(name="Metadata",        score=metadata_score, weight=weights["metadata"],      contribution=round(metadata_score*weights["metadata"],1),     summary=f"Author: {'yes' if article.authors else 'no'} | Date: {'yes' if article.publish_date else 'no'}"),
        ]

        # Add image dimension only when images were analyzed
        if has_images:
            dims.append(
                DimensionScore(
                    name="Image Authenticity",
                    score=image_score,
                    weight=weights["image"],
                    contribution=round(image_score * weights["image"], 1),
                    summary=image_summary
                )
            )

        # ── Red flags and positive signals ────────────────────────────────
        red_flags    = list(llm_reasoning.get("red_flags", []))
        pos_signals  = list(llm_reasoning.get("positive_signals", []))

        # Auto red flags
        if corr.trusted_sources_count == 0:
            red_flags.insert(0, "No trusted news outlet found covering this story on the internet")
        if len(ollama.misleading_patterns) >= 2:
            red_flags.append(f"Misleading language patterns detected: {', '.join(ollama.misleading_patterns[:2])}")
        if len(ollama.clickbait_elements) >= 2:
            red_flags.append(f"Clickbait techniques found: {', '.join(ollama.clickbait_elements[:2])}")
        if len(ollama.irrelevant_facts) >= 2:
            red_flags.append(
                f"{len(ollama.irrelevant_facts)} off-context fact(s) detected — article contains "
                f"statements unrelated to its core topic (padding/filler content)"
            )
        if ad_prof.has_clickbait_ads:
            networks_str = ", ".join(ad_prof.clickbait_networks_found)
            red_flags.append(f"Low-tier 'chumbox' ad networks detected ({networks_str}) — common on clickbait sites")
        if ad_prof.ad_density > 1.5:
            red_flags.append(f"Highly aggressive ad density ({ad_prof.ad_density:.1f} ads per 100 words)")

        # Image-specific red flags
        if has_images:
            if image_analysis.fake_images_detected >= 2:
                red_flags.append(
                    f"Multiple potentially manipulated images detected "
                    f"({image_analysis.fake_images_detected} of {image_analysis.total_images_analyzed})"
                )
            elif image_analysis.fake_images_detected == 1:
                # Find the highest-probability fake image
                worst = max(
                    (r for r in image_analysis.results if r.verdict == "FAKE"),
                    key=lambda r: r.fake_probability,
                    default=None
                )
                if worst and worst.fake_probability > 0.7:
                    red_flags.append(
                        f"Potentially manipulated image detected "
                        f"({worst.fake_probability*100:.0f}% deepfake probability)"
                    )
            # Positive signal for all-real images
            if image_analysis.fake_images_detected == 0 and image_analysis.total_images_analyzed >= 2:
                pos_signals.append(
                    f"All {image_analysis.total_images_analyzed} article images passed "
                    f"deepfake detection (Xception + GradCAM)"
                )

        # Auto positive signals
        if corr.tier1_count >= 2:
            pos_signals.insert(0, f"{corr.tier1_count} top-tier outlets (Reuters/BBC-level) independently reporting the same story")
        if ollama.has_named_sources:
            pos_signals.append("Article cites named sources or institutions")
        if ollama.has_expert_quotes:
            pos_signals.append("Article includes direct quotes from named experts")

        return CredibilityScorecard(
            url=article.url,
            title=article.title,
            domain=article.domain,
            publisher=article.publisher,
            authors=article.authors,
            publish_date=article.publish_date,
            overall_score=overall,
            credibility_rating=rating,
            verdict=verdict,
            verdict_summary=SUMMARIES[verdict],
            dimensions=dims,
            ad_profile=ad_prof,
            article_context=ollama.article_context,
            relevant_facts=ollama.relevant_facts,
            irrelevant_facts=ollama.irrelevant_facts,
            main_claims=ollama.main_claims,
            emotional_phrases=ollama.emotional_phrases,
            clickbait_elements=ollama.clickbait_elements,
            bias_indicators=ollama.bias_indicators,
            misleading_patterns=ollama.misleading_patterns,
            content_tone=ollama.content_tone,
            corroboration=corr,
            image_analysis=image_analysis if has_images else None,
            red_flags=red_flags[:6],
            positive_signals=pos_signals[:6],
        )

