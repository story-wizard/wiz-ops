"""Validate the loaded SDK settings before preparation and every ingest job."""
import sys
from wiz_ingest import settings as sdk

settings = sdk.load_settings(sys.argv[1])
speech = sys.argv[2] == "true"
assert settings.asr_enabled is speech, "Unexpected speech-analysis setting"
for name in (
    "embeddings_enabled", "llm_enrich_enabled", "visual_enrichment_enabled",
    "project_context_enabled", "speaker_face_enabled", "audio_analysis_enabled",
    "camera_motion_enabled", "multicam_enabled",
):
    assert getattr(settings, name) is False, "Local ingest must disable " + name

# Unified ingest retired global prefetch; model resources belong to selected jobs.
if hasattr(settings, "model_prefetch_enabled"):
    assert settings.model_prefetch_enabled is False, "Model prefetch must be disabled"
else:
    assert "model_prefetch_enabled" in getattr(sdk, "RETIRED_SETTINGS_FIELDS", ()), "Unknown model-prefetch contract"
if hasattr(settings, "cloud_media_egress"):
    assert settings.cloud_media_egress is False, "Cloud media egress must be disabled"
assert settings.diarization_backend == "none" and settings.wizserver_backend == "http", "Local ingest must use the owned HTTP engine"
if speech:
    assert settings.asr_backend == "coreml_asr" and settings.model_cache_dir == sys.argv[3], "Speech requires the pinned local CoreML model"
print("Local ingest profile valid")
