import logging
import requests
import cv2
import numpy as np
import torch
import warnings
from typing import List
import base64
import os

from src.schemas.article_schema import ImageAnalysisResult, ImageResult

# Ignore warnings from timm/torch
warnings.filterwarnings("ignore")

# Import deepfake model
try:
    # We must ensure deepfake_detector is accessible
    from deepfake_detector.src.model import XceptionDetector
    from deepfake_detector.src.dataset import eval_transform
    DEEPFAKE_AVAILABLE = True
except ImportError as e:
    logging.warning(f"Failed to import deepfake detector modules: {e}")
    DEEPFAKE_AVAILABLE = False

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

class GradCAM:
    def __init__(self, model, target_layer):
        self.model = model
        self.target_layer = target_layer
        self.gradients = None
        self.activations = None
        
        self.target_layer.register_forward_hook(self.save_activation)
        self.target_layer.register_full_backward_hook(self.save_gradient)
        
    def save_activation(self, module, input, output):
        self.activations = output

    def save_gradient(self, module, grad_input, grad_output):
        self.gradients = grad_output[0]

    def generate(self, x):
        self.model.eval()
        x.requires_grad_(True)
        self.model.zero_grad()
        out = self.model(x)
        
        out.backward()
        
        gradients = self.gradients.cpu().data.numpy()[0]
        activations = self.activations.cpu().data.numpy()[0]
        
        weights = np.mean(gradients, axis=(1, 2))
        cam = np.zeros(activations.shape[1:], dtype=np.float32)
        
        for i, w in enumerate(weights):
            cam += w * activations[i, :, :]
            
        cam = np.maximum(cam, 0) # ReLU
        if np.max(cam) != 0:
            cam = cam / np.max(cam) # Normalize
            
        return cam, torch.sigmoid(out).item()

class DeepfakeImageAnalyzer:
    """
    Lazy-loads the best_model.pth once as a singleton.
    """
    _instance = None
    _model = None
    _model_loaded = False
    
    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(DeepfakeImageAnalyzer, cls).__new__(cls)
        return cls._instance

    def __init__(self, model_path: str = None, max_images: int = 8):
        if hasattr(self, '_initialized') and self._initialized:
            return

        # Try multiple known model locations
        if model_path is None:
            for candidate in [
                "deepfake_detector/models/best_model.pth",
                "deepfake_detector/best_model.pth",
                "best_model.pth",
            ]:
                if os.path.exists(candidate):
                    model_path = candidate
                    break
            if model_path is None:
                model_path = "deepfake_detector/models/best_model.pth"
            
        self.max_images = max_images
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        
        if not DEEPFAKE_AVAILABLE:
            logger.warning("Deepfake analyzer not available due to missing dependencies.")
            self._initialized = True
            return

        if not DeepfakeImageAnalyzer._model_loaded:
            try:
                if os.path.exists(model_path):
                    model = XceptionDetector(pretrained=False)
                    model.load_state_dict(torch.load(model_path, map_location=self.device))
                    model.to(self.device)
                    model.eval()
                    DeepfakeImageAnalyzer._model = model
                    DeepfakeImageAnalyzer._model_loaded = True
                    logger.info(f"Loaded deepfake detector from {model_path} on {self.device}")
                else:
                    logger.warning(f"Deepfake model not found at {model_path}")
            except Exception as e:
                logger.error(f"Error loading deepfake model: {e}")
                
        self._initialized = True

    def download_image(self, url: str) -> np.ndarray:
        try:
            if os.path.exists(url):
                # It's a local file path
                img = cv2.imread(url)
                if img is not None:
                    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                return img
                
            resp = requests.get(url, headers=HEADERS, timeout=10)
            resp.raise_for_status()
            image_array = np.asarray(bytearray(resp.content), dtype=np.uint8)
            img = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
            if img is not None:
                img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            return img
        except Exception as e:
            logger.debug(f"Failed to load image {url}: {e}")
            return None

    def analyze(self, image_urls: List[str]) -> ImageAnalysisResult:
        """
        Input: list of extracted image URLs.
        Output: ImageAnalysisResult.
        """
        result = ImageAnalysisResult(
            total_images_analyzed=0,
            fake_images_detected=0,
            image_authenticity_score=70.0,
            flagged_images=[],
            results=[]
        )
        
        if not DeepfakeImageAnalyzer._model_loaded or not image_urls:
            return result
            
        urls_to_check = image_urls[:self.max_images]
        logger.info(f"Analyzing up to {len(urls_to_check)} images for deepfakes...")
        
        cam_extractor = GradCAM(DeepfakeImageAnalyzer._model, DeepfakeImageAnalyzer._model.backbone.conv4)
        
        all_probs = []
        
        for url in urls_to_check:
            img = self.download_image(url)
            if img is None:
                continue
                
            # Skip tiny images
            if img.shape[0] < 50 or img.shape[1] < 50:
                continue
                
            try:
                augmented = eval_transform(image=img)
                img_tensor = augmented['image'].unsqueeze(0).to(self.device)
                
                # Use GradCAM which also gives probability
                cam, prob = cam_extractor.generate(img_tensor)
                
                # Resize cam and apply color map
                cam_resized = cv2.resize(cam, (img.shape[1], img.shape[0]))
                heatmap = cv2.applyColorMap(np.uint8(255 * cam_resized), cv2.COLORMAP_JET)
                
                # Overlay
                overlay = cv2.addWeighted(img, 0.5, heatmap, 0.5, 0)
                
                # Encode to base64
                _, buffer = cv2.imencode('.jpg', cv2.cvtColor(overlay, cv2.COLOR_RGB2BGR))
                b64 = base64.b64encode(buffer).decode('utf-8')
                gradcam_b64 = f"data:image/jpeg;base64,{b64}"
                    
                result.total_images_analyzed += 1
                all_probs.append(prob)
                
                verdict = "FAKE" if prob > 0.5 else "REAL"
                if prob > 0.5:
                    result.fake_images_detected += 1
                if prob > 0.6:
                    result.flagged_images.append(url)
                    
                result.results.append(ImageResult(
                    url=url,
                    fake_probability=prob,
                    verdict=verdict,
                    gradcam_base64=gradcam_b64
                ))
                
            except Exception as e:
                logger.error(f"Error analyzing image {url}: {e}")
                
        # Aggregate score logic (inverse of max fake prob)
        if all_probs:
            max_fake_prob = max(all_probs)
            # 0% fake prob -> 100 score, 100% fake prob -> 0 score
            result.image_authenticity_score = round((1.0 - max_fake_prob) * 100, 1)
        
        return result
