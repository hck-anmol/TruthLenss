import pytest
from unittest.mock import patch, MagicMock
from src.analysis.image_forensics import DeepfakeImageAnalyzer
from src.schemas.article_schema import ImageAnalysisResult

@pytest.fixture
def analyzer():
    
    with patch("src.analysis.image_forensics.os.path.exists", return_value=False):
        yield DeepfakeImageAnalyzer(model_path="dummy.pth", max_images=2)

def test_analyze_no_images(analyzer):
    result = analyzer.analyze([])
    assert isinstance(result, ImageAnalysisResult)
    assert result.total_images_analyzed == 0
    assert result.fake_images_detected == 0
    assert result.image_authenticity_score == 70.0
    assert len(result.results) == 0

@patch("src.analysis.image_forensics.requests.get")
def test_analyze_download_failure(mock_get, analyzer):
    
    mock_get.side_effect = Exception("Download failed")
    
    
    DeepfakeImageAnalyzer._model_loaded = True
    DeepfakeImageAnalyzer._model = MagicMock()
    
    result = analyzer.analyze(["http://example.com/fake.jpg"])
    
    assert result.total_images_analyzed == 0
    assert result.fake_images_detected == 0
    assert result.image_authenticity_score == 70.0

@patch("src.analysis.image_forensics.GradCAM")
@patch("src.analysis.image_forensics.DeepfakeImageAnalyzer.download_image")
def test_analyze_mocked_model(mock_download, mock_gradcam, analyzer):
    DeepfakeImageAnalyzer._model_loaded = True
    DeepfakeImageAnalyzer._model = MagicMock()
    
    
    import numpy as np
    mock_download.return_value = np.zeros((100, 100, 3), dtype=np.uint8)
    
    
    mock_cam_instance = MagicMock()
    
    mock_cam_instance.generate.return_value = (np.zeros((100,100)), 0.95)
    mock_gradcam.return_value = mock_cam_instance
    
    result = analyzer.analyze(["http://example.com/test.jpg"])
    
    assert result.total_images_analyzed == 1
    assert result.fake_images_detected == 1
    assert result.image_authenticity_score == 5.0 
    assert len(result.results) == 1
    assert result.results[0].verdict == "FAKE"
    assert result.results[0].fake_probability == 0.95
    assert "http://example.com/test.jpg" in result.flagged_images
