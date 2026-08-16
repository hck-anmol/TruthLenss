"""
Unified schemas for the Article Credibility Detection Pipeline.

Flow:
  URL  ->  ArticleExtraction
       ->  OllamaAnalysis
       ->  CorroborationResult
       ->  CredibilityScorecard  (final output)
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field




class ArticleInput(BaseModel):
    """Input provided by the user to analyze."""
    url: Optional[str] = None
    raw_text: Optional[str] = None
    title: Optional[str] = None
    publisher: Optional[str] = None

class AdProfile(BaseModel):
    """Profile of the ads detected on the webpage."""
    total_ad_slots: int = 0
    has_clickbait_ads: bool = False
    clickbait_networks_found: List[str] = Field(default_factory=list)
    ad_density: float = 0.0  




class ArticleExtraction(BaseModel):
    url: Optional[str] = None
    title: str
    text: str
    authors: List[str] = Field(default_factory=list)
    publish_date: Optional[datetime] = None
    domain: Optional[str] = None
    publisher: Optional[str] = None
    uses_https: bool = False
    word_count: int = 0
    ad_profile: AdProfile = Field(default_factory=AdProfile)
    
    image_urls: List[str] = Field(default_factory=list)
    
    video_urls: List[str] = Field(default_factory=list)
    
    meta_keywords: List[str] = Field(default_factory=list)
    meta_description: Optional[str] = None
    outbound_links: List[str] = Field(default_factory=list)
    
    top_image: Optional[str] = None
    num_ads_estimated: int = 0
    ad_ratio: float = 0.0
    ad_details: List[Dict[str, Any]] = Field(default_factory=list)



ExtractedArticle = ArticleExtraction




class OllamaAnalysis(BaseModel):
    """Structured output from Ollama (qwen3:8b) after reading the article."""

    
    article_context: str = Field(default="",
        description="1-2 sentence summary of the core topic of the article")

    
    relevant_facts: List[str] = Field(default_factory=list,
        description="Verifiable facts that are directly related to the core context")
    irrelevant_facts: List[str] = Field(default_factory=list,
        description="Facts/statements that are unrelated to the core context of the article")

    
    main_claims: List[str] = Field(default_factory=list,
        description="Major assertions or conclusions the article makes")

    
    search_queries: List[str] = Field(default_factory=list,
        description="3-5 focused search queries derived from the article for Tavily")

    
    emotional_phrases: List[str] = Field(default_factory=list,
        description="Emotionally charged, sensational, or fear-inducing phrases")
    clickbait_elements: List[str] = Field(default_factory=list,
        description="Clickbait techniques: curiosity gaps, exaggeration, ALL CAPS misuse, etc.")

    
    bias_indicators: List[str] = Field(default_factory=list,
        description="One-sided language, absolutist statements, propaganda phrases")
    misleading_patterns: List[str] = Field(default_factory=list,
        description="Patterns that suggest misinformation: miracle cures, hidden secrets, etc.")

    
    has_named_sources: bool = False
    has_statistics: bool = False
    has_expert_quotes: bool = False
    content_tone: str = "neutral"    
    language_quality: str = "normal" 




class CorroboratingSource(BaseModel):
    url: str
    title: str
    domain: str
    snippet: str = ""
    trusted: bool = False
    tier: int = 0          
    search_query: str = "" 
    relevance_score: float = 0.0




class CorroborationResult(BaseModel):
    total_sources_found: int = 0
    trusted_sources_count: int = 0
    tier1_count: int = 0
    tier2_count: int = 0
    corroboration_score: float = Field(default=0.15, ge=0.0, le=1.0)
    verdict_label: str = "Not checked"
    top_sources: List[CorroboratingSource] = Field(default_factory=list)
    search_queries_used: List[str] = Field(default_factory=list)




class ImageResult(BaseModel):
    """Result for a single analyzed image."""
    url: str
    fake_probability: float       
    verdict: str                  
    gradcam_base64: str = ""      

class ImageAnalysisResult(BaseModel):
    """Aggregated results from deepfake detection across all article images."""
    total_images_analyzed: int = 0
    fake_images_detected: int = 0
    image_authenticity_score: float = 100.0   
    flagged_images: List[str] = Field(default_factory=list)
    results: List[ImageResult] = Field(default_factory=list)





class VideoFrameResult(BaseModel):
    """Prediction for a single sampled frame."""
    second: int                    
    frame_index: int               
    fake_probability: float        
    is_anomaly_burst: bool = False 
    gradcam_base64: str = ""       


class VideoAnalysisResult(BaseModel):
    """Aggregated deepfake analysis for a single video."""
    source: str                              
    duration_seconds: float = 0.0
    total_frames_analyzed: int = 0
    anomaly_seconds: List[int] = Field(default_factory=list)  
    fake_frame_count: int = 0
    max_fake_probability: float = 0.0
    video_authenticity_score: float = 100.0  
    verdict: str = "REAL"                    
    frame_results: List[VideoFrameResult] = Field(default_factory=list)




class TitleAnalysis(BaseModel):
    """Structured output from clickbait/title analysis."""
    clickbait_score: float = 0.0
    emoji_count: int = 0
    emotional_word_count: int = 0
    emotional_words_found: List[str] = Field(default_factory=list)
    clickbait_reasons: List[str] = Field(default_factory=list)




class DimensionScore(BaseModel):
    name: str
    score: float           
    weight: float          
    contribution: float    
    summary: str = ""


class CredibilityScorecard(BaseModel):
    
    url: Optional[str] = None
    title: str
    domain: Optional[str] = None
    publisher: Optional[str] = None
    authors: List[str] = Field(default_factory=list)
    publish_date: Optional[datetime] = None

    
    overall_score: float = Field(..., ge=0.0, le=100.0)
    credibility_rating: str    
    verdict: str               
    verdict_summary: str

    
    dimensions: List[DimensionScore] = Field(default_factory=list)

    
    ad_profile: AdProfile = Field(default_factory=AdProfile)

    
    article_context: str = ""
    relevant_facts: List[str] = Field(default_factory=list)
    irrelevant_facts: List[str] = Field(default_factory=list)
    main_claims: List[str] = Field(default_factory=list)
    emotional_phrases: List[str] = Field(default_factory=list)
    clickbait_elements: List[str] = Field(default_factory=list)
    bias_indicators: List[str] = Field(default_factory=list)
    misleading_patterns: List[str] = Field(default_factory=list)
    content_tone: str = "neutral"

    
    corroboration: CorroborationResult

    
    image_analysis: Optional["ImageAnalysisResult"] = None

    
    video_analysis: Optional["VideoAnalysisResult"] = None

    
    red_flags: List[str] = Field(default_factory=list)
    positive_signals: List[str] = Field(default_factory=list)
