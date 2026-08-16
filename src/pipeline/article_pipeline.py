"""
ArticlePipeline: Orchestrates the full multi-modal detection pipeline.

  Step 1  — ArticleExtractor      : Extract clean text + image URLs from URL
  Step 1b — DeepfakeImageAnalyzer : Analyze article images for deepfakes (no ads)
  Step 2  — OllamaExtractor       : Analyze facts, claims, clickbait (qwen3:8b)
  Step 3  — TavilyCorroborator    : Search 50 articles across trusted sources
  Step 3b — Ollama reasoning      : Reason over corroboration evidence
  Step 4  — ScorecardGenerator    : Build final credibility scorecard

  NOTE: Video analysis is NOT part of article analysis.
        Videos found embedded in articles are intentionally ignored.
        Use standalone video_path mode for deepfake video analysis.
"""

import logging
from typing import Optional

from src.schemas.article_schema import ArticleInput, CredibilityScorecard, ImageAnalysisResult, VideoAnalysisResult
from src.extraction.article_extractor import ArticleExtractor
from src.llm.ollama_extractor import OllamaExtractor
from src.verification.tavily_corroborator import TavilyCorroborator
from src.scoring.scorecard import ScorecardGenerator


try:
    from src.analysis.image_forensics import DeepfakeImageAnalyzer
    DEEPFAKE_AVAILABLE = True
except ImportError:
    DEEPFAKE_AVAILABLE = False

try:
    from src.analysis.video_forensics import VideoForensicsAnalyzer
    VIDEO_FORENSICS_AVAILABLE = True
except ImportError:
    VIDEO_FORENSICS_AVAILABLE = False

logger = logging.getLogger(__name__)


class ArticlePipeline:
    def __init__(
        self,
        extractor: Optional[ArticleExtractor] = None,
        ollama_extractor: Optional[OllamaExtractor] = None,
        corroborator: Optional[TavilyCorroborator] = None,
        scorecard_generator: Optional[ScorecardGenerator] = None,
    ):
        self.extractor      = extractor or ArticleExtractor()
        self.ollama         = ollama_extractor or OllamaExtractor()
        self.corroborator   = corroborator or TavilyCorroborator()
        self.scorer         = scorecard_generator or ScorecardGenerator()

    def run(
        self,
        article_input: ArticleInput,
        video_path: str = None,   
        image_path: str = None,   
    ) -> CredibilityScorecard:

        
        video_only_mode = bool(video_path and not article_input.url and not article_input.raw_text)
        image_only_mode = bool(image_path and not article_input.url and not article_input.raw_text)

        
        logger.info("Step 1/5 — Extracting article text and images...")

        if video_only_mode or image_only_mode:
            
            from src.schemas.article_schema import ArticleExtraction
            title = "Uploaded Video File" if video_only_mode else "Uploaded Image File"
            article = ArticleExtraction(
                title=title,
                text="",
                word_count=0,
                image_urls=[image_path] if image_only_mode else [],
                video_urls=[],
            )
            logger.info("  Bypassing article extraction (standalone media mode)")
        else:
            article = self.extractor.extract(article_input)
            logger.info(f"  Extracted: '{article.title[:60]}' ({article.word_count} words)")

        
        if not video_only_mode and not image_only_mode and (not article.text or article.word_count < 30):
            raise ValueError(
                f"Could not extract article text from the provided source.\n"
                f"Title: '{article.title}'\n"
                f"Words: {article.word_count}\n\n"
                f"Please check that the URL is valid and publicly accessible."
            )

        
        
        
        image_analysis: Optional[ImageAnalysisResult] = None

        image_targets = article.image_urls  
        if image_only_mode and image_path:
            image_targets = [image_path]

        if image_targets and DEEPFAKE_AVAILABLE:
            logger.info(f"Step 1b — Analyzing {len(image_targets)} image(s) for deepfakes...")
            try:
                analyzer = DeepfakeImageAnalyzer()
                image_analysis = analyzer.analyze(image_targets)
                logger.info(
                    f"  Images analyzed: {image_analysis.total_images_analyzed} | "
                    f"Fake detected: {image_analysis.fake_images_detected} | "
                    f"Authenticity: {image_analysis.image_authenticity_score:.1f}/100"
                )
            except Exception as e:
                logger.warning(f"  Image analysis failed (non-fatal): {e}")
                image_analysis = None
        elif image_targets and not DEEPFAKE_AVAILABLE:
            logger.warning("  Deepfake analyzer not available — skipping image analysis")
        else:
            logger.info("  No content images found — skipping image analysis")

        
        
        
        video_analysis: Optional[VideoAnalysisResult] = None

        if video_only_mode and video_path:
            if VIDEO_FORENSICS_AVAILABLE:
                logger.info(f"Step 1c — Analyzing uploaded video for deepfakes...")
                try:
                    analyzer = VideoForensicsAnalyzer()
                    video_analysis = analyzer.analyze_file(video_path, source="uploaded")
                    if video_analysis:
                        logger.info(
                            f"  Video: {video_analysis.duration_seconds:.1f}s | "
                            f"{video_analysis.total_frames_analyzed} frames | "
                            f"max_fake={video_analysis.max_fake_probability:.3f} | "
                            f"score={video_analysis.video_authenticity_score:.1f} | "
                            f"verdict={video_analysis.verdict}"
                        )
                except Exception as e:
                    logger.warning(f"  Video analysis failed (non-fatal): {e}")
                    video_analysis = None
            else:
                logger.warning("  Video forensics not available — skipping video analysis")
        else:
            logger.info("  Video analysis skipped (article mode — only standalone video is analyzed)")

        
        if video_only_mode or image_only_mode:
            logger.info("  Skipping text-based analysis (Video/Image-only mode)")
            from src.schemas.article_schema import OllamaAnalysis, CorroborationResult
            ollama_analysis = OllamaAnalysis()
            corroboration = CorroborationResult()
            llm_reasoning = {}
        else:
            
            logger.info("Step 2/5 — Analyzing with Ollama (qwen3:8b)...")
            ollama_analysis = self.ollama.analyze_article(article)
            logger.info(
                f"  Relevant facts: {len(ollama_analysis.relevant_facts)} | "
                f"Irrelevant facts: {len(ollama_analysis.irrelevant_facts)} | "
                f"Claims: {len(ollama_analysis.main_claims)} | "
                f"Queries: {len(ollama_analysis.search_queries)}"
            )

            
            logger.info("Step 3/5 — Searching internet for corroborating sources (Tavily)...")
            corroboration = self.corroborator.corroborate(
                search_queries=ollama_analysis.search_queries,
                article_title=article.title,
            )
            logger.info(
                f"  Found: {corroboration.total_sources_found} sources | "
                f"Trusted: {corroboration.trusted_sources_count} "
                f"(Tier1={corroboration.tier1_count}, Tier2={corroboration.tier2_count})"
            )

            
            logger.info("Step 3b/5 — Ollama reasoning over corroboration evidence...")
            search_results_text = self.corroborator.format_results_for_llm(corroboration)
            llm_reasoning = self.ollama.reason_about_credibility(
                article, ollama_analysis, search_results_text
            )

        
        logger.info("Step 4/5 — Generating credibility scorecard...")
        scorecard = self.scorer.generate(
            article, ollama_analysis, corroboration, llm_reasoning,
            image_analysis=image_analysis,
            video_analysis=video_analysis,
        )
        logger.info(
            f"  Verdict: {scorecard.verdict} | "
            f"Score: {scorecard.overall_score}/100 [{scorecard.credibility_rating}]"
        )

        return scorecard

