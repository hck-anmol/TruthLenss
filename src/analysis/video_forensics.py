"""
video_forensics.py — Adaptive frame-sampling deepfake detector for video.

This module delegates deepfake detection of video frames to `DeepfakeImageAnalyzer`
from `image_forensics.py`, avoiding duplicate model loading and issues with
missing modules.
"""

import logging
import os
import tempfile
import math
import shutil
from typing import List, Set, Optional

import cv2

from src.schemas.article_schema import VideoAnalysisResult, VideoFrameResult
from src.analysis.image_forensics import DeepfakeImageAnalyzer

logger = logging.getLogger(__name__)


NORMAL_FPS      = 3      
BURST_FPS       = 5      
ANOMALY_THRESH  = 0.70   
BURST_RADIUS    = 2      
MAX_DURATION_S  = 600    


def _sample_frame_indices(second: int, video_fps: float, samples: int,
                           total_frames: int) -> List[int]:
    """Return up to `samples` evenly-spaced frame indices within `second`."""
    start = int(second * video_fps)
    end   = min(int((second + 1) * video_fps), total_frames - 1)
    if start >= end:
        return [start]
    step = max(1, (end - start) // samples)
    indices = list(range(start, end, step))[:samples]
    return indices




def _download_video(url: str) -> Optional[str]:
    """
    Download a direct video URL to a temp file.
    Returns the temp file path, or None on failure.
    YouTube/Vimeo: uses yt-dlp if available, otherwise skips gracefully.
    """
    if any(host in url for host in ("youtube.com", "youtu.be", "vimeo.com")):
        try:
            import yt_dlp  
            tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
            tmp.close()
            ydl_opts = {
                "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4",
                "outtmpl": tmp.name,
                "quiet": True,
                "no_warnings": True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])
            if os.path.exists(tmp.name) and os.path.getsize(tmp.name) > 0:
                return tmp.name
        except Exception as exc:
            logger.warning(f"Video forensics: yt-dlp failed for {url} — {exc}")
        return None

    try:
        import requests
        headers = {"User-Agent": "Mozilla/5.0"}
        resp = requests.get(url, headers=headers, stream=True, timeout=30)
        resp.raise_for_status()

        suffix = ".mp4"
        for ext in (".mp4", ".webm", ".mov", ".avi"):
            if ext in url.lower():
                suffix = ext
                break

        tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        for chunk in resp.iter_content(chunk_size=1 << 20):
            tmp.write(chunk)
        tmp.close()
        return tmp.name
    except Exception as exc:
        logger.warning(f"Video forensics: download failed for {url} — {exc}")
        return None




class VideoForensicsAnalyzer:
    def analyze_url(self, url: str) -> Optional[VideoAnalysisResult]:
        logger.info(f"Video forensics: downloading {url[:80]}...")
        path = _download_video(url)
        if path is None:
            logger.warning("Video forensics: could not download video — skipping")
            return None
        try:
            result = self.analyze_file(path, source=url)
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass
        return result

    def analyze_file(self, path: str, source: str = "uploaded") -> VideoAnalysisResult:
        logger.info(f"Analyzing video file: {path}")
        cap = cv2.VideoCapture(path)
        if not cap.isOpened():
            logger.error(f"Cannot open video: {path}")
            return VideoAnalysisResult(source=source)

        video_fps    = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration_s   = total_frames / video_fps
        total_secs   = min(int(math.ceil(duration_s)), MAX_DURATION_S)

        logger.info(
            f"Video forensics: {duration_s:.1f}s @ {video_fps:.1f}fps "
            f"({total_frames} frames) — analyzing up to {total_secs}s"
        )

        image_analyzer = DeepfakeImageAnalyzer()
        
        old_max = image_analyzer.max_images
        image_analyzer.max_images = 9999

        temp_dir = tempfile.mkdtemp()
        try:
            second_probs: dict = {}
            anomaly_seconds: Set[int] = set()
            burst_seconds: Set[int]   = set()
            frame_results: List[VideoFrameResult] = []
            
            
            
            frame_paths: dict = {}
            all_probs: List[float] = []

            
            def _extract_and_analyze(s: int, indices: List[int], is_burst: bool) -> List[float]:
                paths_to_analyze = []
                idx_mapping = [] 
                for i, fi in enumerate(indices):
                    cap.set(cv2.CAP_PROP_POS_FRAMES, float(fi))
                    ret, frame = cap.read()
                    if not ret or frame is None: continue
                    if frame.shape[0] < 50 or frame.shape[1] < 50: continue
                    
                    jpg_path = os.path.join(temp_dir, f"frame_{s}_{i}.jpg")
                    cv2.imwrite(jpg_path, frame)
                    paths_to_analyze.append(jpg_path)
                    idx_mapping.append(i)
                
                if not paths_to_analyze:
                    return []
                    
                
                img_res = image_analyzer.analyze(paths_to_analyze)
                
                probs = []
                
                for i, path_analyzed in enumerate(paths_to_analyze):
                    frame_idx = idx_mapping[i]
                    prob = 0.0
                    heatmap = ""
                    
                    for r in img_res.results:
                        if r.url == path_analyzed:
                            prob = r.fake_probability
                            heatmap = r.gradcam_base64
                            break
                            
                    probs.append(prob)
                    all_probs.append(prob)
                    
                    frame_results.append(VideoFrameResult(
                        second=s,
                        frame_index=frame_idx,
                        fake_probability=round(prob, 4),
                        is_anomaly_burst=is_burst,
                        gradcam_base64=heatmap
                    ))
                return probs

            
            for s in range(total_secs):
                indices = _sample_frame_indices(s, video_fps, NORMAL_FPS, total_frames)
                probs = _extract_and_analyze(s, indices, is_burst=False)
                
                if any(p > ANOMALY_THRESH for p in probs):
                    anomaly_seconds.add(s)
                    
                    for r in range(max(0, s - BURST_RADIUS),
                                   min(total_secs, s + BURST_RADIUS + 1)):
                        if r != s:  
                            burst_seconds.add(r)
                            
            
            if burst_seconds:
                logger.info(f"Video forensics: anomaly burst on seconds {sorted(burst_seconds)[:20]}")
            
            for s in sorted(burst_seconds):
                if s < total_secs:
                    indices = _sample_frame_indices(s, video_fps, BURST_FPS, total_frames)
                    _extract_and_analyze(s, indices, is_burst=True)

        finally:
            cap.release()
            shutil.rmtree(temp_dir, ignore_errors=True)
            image_analyzer.max_images = old_max

        if not all_probs:
            return VideoAnalysisResult(
                source=source,
                duration_seconds=round(duration_s, 2),
                total_frames_analyzed=0,
            )

        
        fake_count = sum(1 for p in all_probs if p > ANOMALY_THRESH)
        max_prob   = max(all_probs)
        fake_ratio = fake_count / len(all_probs)
        raw_score  = (1.0 - max_prob) * 70 + (1.0 - fake_ratio) * 30
        auth_score = round(max(0.0, min(100.0, raw_score)), 1)

        if max_prob >= 0.85:
            verdict = "FAKE"
        elif max_prob >= 0.70 or fake_ratio >= 0.30:
            verdict = "LIKELY FAKE"
        else:
            verdict = "REAL"

        
        frame_results.sort(key=lambda x: (x.second, x.frame_index))

        
        
        frame_results.sort(key=lambda x: x.fake_probability, reverse=True)
        for i, fr in enumerate(frame_results):
            if i >= 10:
                fr.gradcam_base64 = ""
        
        frame_results.sort(key=lambda x: (x.second, x.frame_index))

        logger.info(
            f"Video forensics: {len(all_probs)} frames | "
            f"max_fake={max_prob:.3f} | fake_frames={fake_count} | "
            f"score={auth_score} | verdict={verdict}"
        )

        return VideoAnalysisResult(
            source=source,
            duration_seconds=round(duration_s, 2),
            total_frames_analyzed=len(all_probs),
            anomaly_seconds=sorted(anomaly_seconds),
            fake_frame_count=fake_count,
            max_fake_probability=round(max_prob, 4),
            video_authenticity_score=auth_score,
            verdict=verdict,
            frame_results=frame_results,
        )
