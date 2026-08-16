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
    CredibilityScorecard, DimensionScore, ImageAnalysisResult, VideoAnalysisResult
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

    
    WEIGHTS_WITH_VIDEO = {
        "corroboration": 0.28,
        "content":       0.23,
        "source_trust":  0.14,
        "language":      0.10,
        "metadata":      0.08,
        "video":         0.12,
        "image":         0.05,   
    }

    WEIGHTS_VIDEO_ONLY = {
        "corroboration": 0.00,
        "content":       0.00,
        "source_trust":  0.00,
        "language":      0.00,
        "metadata":      0.00,
        "video":         1.00,
    }

    WEIGHTS_IMAGE_ONLY = {
        "corroboration": 0.00,
        "content":       0.00,
        "source_trust":  0.00,
        "language":      0.00,
        "metadata":      0.00,
        "image":         1.00,
    }

    def generate(
        self,
        article: ArticleExtraction,
        ollama: OllamaAnalysis,
        corr: CorroborationResult,
        llm_reasoning: Dict[str, Any],
        image_analysis: Optional[ImageAnalysisResult] = None,
        video_analysis: Optional[VideoAnalysisResult] = None,
    ) -> CredibilityScorecard:

        
        has_images = (
            image_analysis is not None
            and image_analysis.total_images_analyzed > 0
        )
        has_video = (
            video_analysis is not None
            and video_analysis.total_frames_analyzed > 0
        )
        
        video_only_mode = article.word_count == 0 and article.title == "Uploaded Video File"
        
        image_only_mode = article.word_count == 0 and article.title == "Uploaded Image File"

        if video_only_mode:
            weights = self.WEIGHTS_VIDEO_ONLY
        elif image_only_mode:
            weights = self.WEIGHTS_IMAGE_ONLY
        elif has_video:
            weights = self.WEIGHTS_WITH_VIDEO
        elif has_images:
            weights = self.WEIGHTS_WITH_IMAGES
        else:
            weights = self.WEIGHTS_NO_IMAGES

        
        corr_score = round(corr.corroboration_score * 100, 1)

        
        
        bias_penalty        = min(len(ollama.bias_indicators) * 12, 40)
        misleading_penalty  = min(len(ollama.misleading_patterns) * 18, 54)
        clickbait_penalty   = min(len(ollama.clickbait_elements) * 10, 30)
        
        irrelevant_penalty  = min(len(ollama.irrelevant_facts) * 5, 30)

        
        ad_prof = article.ad_profile
        clickbait_ad_penalty = 10 if ad_prof.has_clickbait_ads else 0
        ad_density_penalty = 0
        if ad_prof.ad_density > 1.0: 
            ad_density_penalty = min(int((ad_prof.ad_density - 1.0) * 5), 15)
        
        content_raw = 100 - bias_penalty - misleading_penalty - clickbait_penalty - irrelevant_penalty - clickbait_ad_penalty - ad_density_penalty
        
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
            source_raw = 45  
        else:
            source_raw = 50
        
        if article.uses_https:
            source_raw = min(source_raw + 5, 100)
        source_score = round(float(source_raw), 1)

        
        emotional_count = len(ollama.emotional_phrases)
        tone_penalty = {
            "fear": 20, "anger": 18, "sensational": 22,
            "promotional": 10, "positive": 0, "neutral": 0
        }.get(ollama.content_tone, 0)
        language_raw = 100 - min(emotional_count * 8, 40) - tone_penalty
        language_score = round(max(0, min(language_raw, 100)), 1)

        
        meta_raw = 50  
        if article.authors:       meta_raw += 20
        if article.publish_date:  meta_raw += 15
        if ollama.has_named_sources: meta_raw += 15
        metadata_score = round(min(meta_raw, 100), 1)

        
        image_score = 0.0
        image_summary = ""
        if has_images:
            image_score = round(image_analysis.image_authenticity_score, 1)
            image_summary = (
                f"{image_analysis.total_images_analyzed} analyzed, "
                f"{image_analysis.fake_images_detected} flagged"
            )

        
        video_score = 0.0
        video_summary = ""
        if has_video:
            video_score = round(video_analysis.video_authenticity_score, 1)
            video_summary = (
                f"{video_analysis.total_frames_analyzed} frames | "
                f"{len(video_analysis.anomaly_seconds)} anomaly second(s) | "
                f"max fake {video_analysis.max_fake_probability*100:.0f}%"
            )

        
        if video_only_mode:
            overall = round(video_score, 1)
        elif image_only_mode:
            overall = round(image_score, 1)
        else:
            overall = round(
                corr_score     * weights["corroboration"] +
                content_score  * weights["content"] +
                source_score   * weights["source_trust"] +
                language_score * weights["language"] +
                metadata_score * weights["metadata"] +
                (image_score   * weights.get("image", 0)) +
                (video_score   * weights.get("video", 0)),
                1
            )
        overall = max(0.0, min(100.0, overall))

        
        if any(t in domain for t in KNOWN_UNRELIABLE):
            overall = min(overall, 18.0)
        if corr.tier1_count == 0 and corr.tier2_count == 0 and len(ollama.misleading_patterns) >= 2:
            overall = min(overall, 32.0)

        
        if overall >= 75: rating = "HIGH";       verdict = "REAL"
        elif overall >= 55: rating = "MODERATE"; verdict = "LIKELY REAL"
        elif overall >= 35: rating = "LOW";      verdict = "LIKELY FAKE"
        else:               rating = "UNRELIABLE"; verdict = "FAKE"

        content_type = "video" if video_only_mode else "image" if image_only_mode else "article"
        SUMMARIES = {
            "REAL":        f"This {content_type} is credible and authentic." + 
                           (" The video shows no signs of deepfake manipulation." if video_only_mode else 
                            " Multiple trusted news outlets independently corroborate the story, and the content quality is high."),
            "LIKELY REAL": f"This {content_type} is mostly credible with some minor concerns — " + 
                           ("some frames show low-confidence AI anomalies." if video_only_mode else 
                            "limited corroboration, slight sensationalism, or unverified secondary claims."),
            "LIKELY FAKE": f"This {content_type} shows multiple credibility red flags — " + 
                           ("suspicious frame manipulation detected." if video_only_mode else 
                            "poor corroboration from trusted sources, biased language, or misleading patterns detected."),
            "FAKE":        f"This {content_type} is highly likely to be fake or misinformation." + 
                           (" It failed the deepfake detection model." if video_only_mode else 
                            " It failed critical checks: no trusted sources cover the story, and the content shows signs of deliberate manipulation."),
        }

        
        dims = []
        if not video_only_mode:
            dims.extend([
                DimensionScore(name="Corroboration",  score=corr_score,     weight=weights["corroboration"], contribution=round(corr_score*weights["corroboration"],1),     summary=corr.verdict_label),
                DimensionScore(name="Content Quality", score=content_score,  weight=weights["content"],       contribution=round(content_score*weights["content"],1),        summary=content_summary),
                DimensionScore(name="Source Trust",    score=source_score,   weight=weights["source_trust"],  contribution=round(source_score*weights["source_trust"],1),    summary=f"Domain: {domain or 'unknown'}"),
                DimensionScore(name="Language",        score=language_score, weight=weights["language"],      contribution=round(language_score*weights["language"],1),      summary=f"Tone: {ollama.content_tone} | {emotional_count} emotional phrase(s)"),
                DimensionScore(name="Metadata",        score=metadata_score, weight=weights["metadata"],      contribution=round(metadata_score*weights["metadata"],1),     summary=f"Author: {'yes' if article.authors else 'no'} | Date: {'yes' if article.publish_date else 'no'}"),
            ])

        
        if has_images:
            dims.append(
                DimensionScore(
                    name="Image Authenticity",
                    score=image_score,
                    weight=weights.get("image", 0),
                    contribution=round(image_score * weights.get("image", 0), 1),
                    summary=image_summary
                )
            )

        
        if has_video:
            dims.append(
                DimensionScore(
                    name="Video Authenticity",
                    score=video_score,
                    weight=weights.get("video", 0),
                    contribution=round(video_score * weights.get("video", 0), 1),
                    summary=video_summary
                )
            )

        
        red_flags    = list(llm_reasoning.get("red_flags", []))
        pos_signals  = list(llm_reasoning.get("positive_signals", []))

        
        if not video_only_mode and not image_only_mode:
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
        elif video_only_mode:
            if not has_video:
                red_flags.append("Video deepfake analysis failed or was unavailable. Unable to determine video authenticity.")
        elif image_only_mode:
            if not has_images:
                red_flags.append("Image deepfake analysis failed or was unavailable. Unable to determine image authenticity.")

        
        if has_images:
            if image_analysis.fake_images_detected >= 2:
                red_flags.append(
                    f"Multiple potentially manipulated images detected "
                    f"({image_analysis.fake_images_detected} of {image_analysis.total_images_analyzed})"
                )
            elif image_analysis.fake_images_detected == 1:
                
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
            
            if image_analysis.fake_images_detected == 0 and image_analysis.total_images_analyzed >= 2:
                pos_signals.append(
                    f"All {image_analysis.total_images_analyzed} article images passed "
                    f"deepfake detection (Xception + GradCAM)"
                )

        
        if has_video:
            if video_analysis.verdict == "FAKE":
                red_flags.append(
                    f"Video deepfake detected: "
                    f"{video_analysis.max_fake_probability*100:.0f}% confidence | "
                    f"{video_analysis.fake_frame_count} fake frame(s) across "
                    f"{len(video_analysis.anomaly_seconds)} anomaly second(s)"
                )
            elif video_analysis.verdict == "LIKELY FAKE":
                red_flags.append(
                    f"Suspicious video frames detected: max fake probability "
                    f"{video_analysis.max_fake_probability*100:.0f}% "
                    f"({video_analysis.fake_frame_count} frame(s) flagged)"
                )
            else:
                pos_signals.append(
                    f"Video passed deepfake analysis: "
                    f"{video_analysis.total_frames_analyzed} frames analyzed, "
                    f"authenticity score {video_analysis.video_authenticity_score:.0f}/100"
                )

        
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
            video_analysis=video_analysis if has_video else None,
            red_flags=red_flags[:8],
            positive_signals=pos_signals[:6],
        )

