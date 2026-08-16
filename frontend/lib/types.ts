export interface DimensionScore {
  name: string;
  score: number;
  weight: number;
  contribution: number;
  summary: string;
}

export interface CorroboratingSource {
  url: string;
  title: string;
  domain: string;
  snippet?: string;
  trusted: boolean;
  tier: number;
  search_query?: string;
  relevance_score?: number;
}

export interface CorroborationResult {
  total_sources_found: number;
  trusted_sources_count: number;
  tier1_count: number;
  tier2_count: number;
  corroboration_score: number;
  verdict_label: string;
  top_sources: CorroboratingSource[];
  search_queries_used: string[];
}

export interface AdProfile {
  total_ad_slots: number;
  has_clickbait_ads: boolean;
  clickbait_networks_found: string[];
  ad_density: number;
}

export interface ImageResult {
  url: string;
  fake_probability: number;
  verdict: string;          
  gradcam_base64: string;   
}

export interface ImageAnalysisResult {
  total_images_analyzed: number;
  fake_images_detected: number;
  image_authenticity_score: number;  
  flagged_images: string[];
  results: ImageResult[];
}

export interface VideoFrameResult {
  second: number;
  frame_index: number;
  fake_probability: number;
  is_anomaly_burst: boolean;
  gradcam_base64?: string;
}

export interface VideoAnalysisResult {
  source: string;
  duration_seconds: number;
  total_frames_analyzed: number;
  anomaly_seconds: number[];
  fake_frame_count: number;
  max_fake_probability: number;
  video_authenticity_score: number;  
  verdict: string;                   
  frame_results: VideoFrameResult[];
}


export interface CredibilityScorecard {
  url: string | null;
  title: string;
  domain: string | null;
  publisher: string | null;
  authors: string[];
  publish_date: string | null;
  overall_score: number;
  credibility_rating: string;
  verdict: string;
  verdict_summary: string;
  dimensions: DimensionScore[];
  ad_profile: AdProfile;
  article_context: string;
  relevant_facts: string[];
  irrelevant_facts: string[];
  main_claims: string[];
  emotional_phrases: string[];
  clickbait_elements: string[];
  bias_indicators: string[];
  misleading_patterns: string[];
  content_tone: string;
  red_flags: string[];
  positive_signals: string[];
  corroboration?: CorroborationResult;
  image_analysis?: ImageAnalysisResult | null;
  video_analysis?: VideoAnalysisResult | null;
}

export type AnalysisMode = 'url' | 'text' | 'image' | 'video';
