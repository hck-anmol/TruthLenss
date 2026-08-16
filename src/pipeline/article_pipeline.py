"""
ArticlePipeline: Orchestrates the full multi-modal detection pipeline.

  Step 1  — ArticleExtractor      : Extract clean text + image URLs from URL
  Step 1b — DeepfakeImageAnalyzer : Analyze article images for deepfakes
  Step 2  — OllamaExtractor       : Analyze facts, claims, clickbait (qwen3:8b)
  Step 3  — TavilyCorroborator    : Search 50 articles across trusted sources
  Step 3b — Ollama reasoning      : Reason over corroboration evidence
  Step 4  — ScorecardGenerator    : Build final credibility scorecard
"""

import logging
from typing import Optional

from src.schemas.article_schema import ArticleInput, CredibilityScorecard, ImageAnalysisResult
from src.extraction.article_extractor import ArticleExtractor
from src.llm.ollama_extractor import OllamaExtractor
from src.verification.tavily_corroborator import TavilyCorroborator
from src.scoring.scorecard import ScorecardGenerator

# Lazy import — deepfake model is heavy (~80MB) and may not be needed
try:
    from src.analysis.image_forensics import DeepfakeImageAnalyzer
    DEEPFAKE_AVAILABLE = True
except ImportError:
    DEEPFAKE_AVAILABLE = False

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

    def run(self, article_input: ArticleInput) -> CredibilityScorecard:

        # ── Step 1: Extract article text + image URLs ──────────────────────
        logger.info("Step 1/5 — Extracting article text and images...")
        article = self.extractor.extract(article_input)
        logger.info(f"  Extracted: '{article.title[:60]}' ({article.word_count} words)")

        if not article.text or article.word_count < 30:
            raise ValueError(
                f"Could not extract article text from the provided source.\n"
                f"  Title: '{article.title}'\n"
                f"  Words: {article.word_count}\n"
                f"Please check that the URL is valid and publicly accessible."
            )

        # ── Step 1b: Image deepfake analysis (only if images found) ────────
        image_analysis: Optional[ImageAnalysisResult] = None

        if article.image_urls and DEEPFAKE_AVAILABLE:
            logger.info(f"Step 1b/5 — Analyzing {len(article.image_urls)} images for deepfakes...")
            try:
                analyzer = DeepfakeImageAnalyzer()
                image_analysis = analyzer.analyze(article.image_urls)
                logger.info(
                    f"  Images analyzed: {image_analysis.total_images_analyzed} | "
                    f"Fake detected: {image_analysis.fake_images_detected} | "
                    f"Authenticity: {image_analysis.image_authenticity_score:.1f}/100"
                )
            except Exception as e:
                logger.warning(f"  Image analysis failed (non-fatal): {e}")
                image_analysis = None
        elif article.image_urls and not DEEPFAKE_AVAILABLE:
            logger.warning("  Deepfake analyzer not available — skipping image analysis")
        else:
            logger.info("  No content images found — skipping image analysis")

        # ── Step 2: Ollama analysis ────────────────────────────────────────
        logger.info("Step 2/5 — Analyzing with Ollama (qwen3:8b)...")
        ollama_analysis = self.ollama.analyze_article(article)
        logger.info(
            f"  Relevant facts: {len(ollama_analysis.relevant_facts)} | "
            f"Irrelevant facts: {len(ollama_analysis.irrelevant_facts)} | "
            f"Claims: {len(ollama_analysis.main_claims)} | "
            f"Queries: {len(ollama_analysis.search_queries)}"
        )

        # ── Step 3: Tavily corroboration ───────────────────────────────────
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

        # ── Step 3b: Ollama reasoning pass (with Tavily evidence) ──────────
        logger.info("Step 3b/5 — Ollama reasoning over corroboration evidence...")
        search_results_text = self.corroborator.format_results_for_llm(corroboration)
        llm_reasoning = self.ollama.reason_about_credibility(
            article, ollama_analysis, search_results_text
        )

        # ── Step 4: Generate scorecard (with image analysis if available) ──
        logger.info("Step 4/5 — Generating credibility scorecard...")
        scorecard = self.scorer.generate(
            article, ollama_analysis, corroboration, llm_reasoning,
            image_analysis=image_analysis
        )
        logger.info(
            f"  Verdict: {scorecard.verdict} | "
            f"Score: {scorecard.overall_score}/100 [{scorecard.credibility_rating}]"
        )

        return scorecard

