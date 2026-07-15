import io
import hmac
import logging
import os
import threading
import time
from collections import deque
from pathlib import Path
from typing import Iterable

import numpy as np
import soundfile as sf
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

KOKORO_IMPORT_ERROR = ""

if os.environ.get("SAYIT_SKIP_MODEL_LOAD") == "1":
    KModel = None  # type: ignore[assignment]
    KPipeline = None  # type: ignore[assignment]
    KOKORO_IMPORT_ERROR = "Kokoro import skipped because SAYIT_SKIP_MODEL_LOAD=1."
else:
    try:
        from kokoro import KModel, KPipeline
    except Exception as import_error:  # pragma: no cover - surfaced by load_pipeline at runtime.
        KModel = None  # type: ignore[assignment]
        KPipeline = None  # type: ignore[assignment]
        KOKORO_IMPORT_ERROR = str(import_error)


LOGGER = logging.getLogger("sayit.tts")
MAX_TEXT_CHARS = 4_000
MAX_JOB_ID_CHARS = 80
CANCELED_JOB_HISTORY_LIMIT = 128
SAMPLE_RATE = 24_000
INFERENCE_DEADLINE_SECONDS = float(os.environ.get("SAYIT_INFERENCE_DEADLINE_SECONDS", "45"))
AUTH_TOKEN = os.environ.get("SAYIT_BACKEND_TOKEN", "")
MODEL_DIR = Path(__file__).resolve().parent / "models" / "kokoro"
MODEL_FILE = "kokoro-v1_0.pth"
ALLOWED_VOICES = {
    "af_heart",
    "af_bella",
    "af_nicole",
    "af_sky",
    "af_alloy",
    "af_jessica",
    "am_adam",
    "am_michael",
    "am_onyx",
    "am_echo",
    "am_fenrir",
}
ALLOWED_ORIGINS = [
    "http://localhost:1425",
    "http://127.0.0.1:1425",
    "http://tauri.localhost",
    "https://tauri.localhost",
]


class SynthesizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    voice: str = "af_heart"
    job_id: str = Field(min_length=1, max_length=MAX_JOB_ID_CHARS)


class CancelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_id: str = Field(min_length=1, max_length=MAX_JOB_ID_CHARS)


inference_lock = threading.Lock()
job_state_lock = threading.Lock()
latest_job_id = ""
canceled_job_ids: set[str] = set()
canceled_job_order: deque[str] = deque()


def create_app() -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["content-type", "x-sayit-token"],
    )
    return app


def configure_logging() -> None:
    logging.basicConfig(
        level=os.environ.get("SAYIT_LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    log_file = os.environ.get("SAYIT_BACKEND_LOG")
    if log_file:
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
        )
        logging.getLogger().addHandler(file_handler)


def require_auth(x_sayit_token: str = Header(default="")) -> None:
    if not AUTH_TOKEN:
        LOGGER.error("SAYIT_BACKEND_TOKEN is not configured.")
        raise HTTPException(status_code=503, detail="TTS service is unavailable.")
    if not x_sayit_token or not hmac.compare_digest(x_sayit_token, AUTH_TOKEN):
        raise HTTPException(status_code=401, detail="Unauthorized.")


def validate_request(request: SynthesizeRequest) -> tuple[str, str]:
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    if len(text) > MAX_TEXT_CHARS:
        raise HTTPException(
            status_code=413,
            detail=f"Text chunk cannot exceed {MAX_TEXT_CHARS} characters.",
        )

    if request.voice not in ALLOWED_VOICES:
        raise HTTPException(status_code=400, detail="Voice is not supported.")

    return text, request.voice


def load_pipeline():
    if os.environ.get("SAYIT_SKIP_MODEL_LOAD") == "1":
        LOGGER.info("Skipping Kokoro model load because SAYIT_SKIP_MODEL_LOAD=1.")
        return None

    if KPipeline is None or KModel is None:
        LOGGER.error("Kokoro is unavailable: %s", KOKORO_IMPORT_ERROR)
        return None

    try:
        model_dir = Path(os.environ.get("SAYIT_MODEL_DIR", MODEL_DIR)).resolve()
        config_path = model_dir / "config.json"
        model_path = model_dir / MODEL_FILE
        voices_dir = model_dir / "voices"
        missing_paths = [
            path
            for path in [config_path, model_path, *[voices_dir / f"{voice}.pt" for voice in sorted(ALLOWED_VOICES)]]
            if not path.is_file()
        ]
        if missing_paths:
            LOGGER.error(
                "Offline Kokoro assets are incomplete. Missing: %s",
                ", ".join(str(path) for path in missing_paths),
            )
            return None

        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
        LOGGER.info("Loading Kokoro TTS model from %s.", model_dir)
        model = KModel(config=str(config_path), model=str(model_path)).to("cpu").eval()
        pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", model=model, device="cpu")
        for voice in ALLOWED_VOICES:
            pipeline.voices[voice] = pipeline.load_single_voice(str(voices_dir / f"{voice}.pt"))
        LOGGER.info("Kokoro TTS model loaded.")
        return pipeline
    except Exception:
        LOGGER.exception("Failed to load Kokoro TTS model.")
        return None


def audio_to_numpy(audio: object) -> np.ndarray:
    if hasattr(audio, "detach"):
        audio = audio.detach().cpu().numpy()
    return np.asarray(audio, dtype=np.float32)


def remember_latest_job(job_id: str) -> None:
    with job_state_lock:
        global latest_job_id
        latest_job_id = job_id


def cancel_job(job_id: str) -> None:
    with job_state_lock:
        if job_id not in canceled_job_ids:
            canceled_job_order.append(job_id)
        canceled_job_ids.add(job_id)
        while len(canceled_job_order) > CANCELED_JOB_HISTORY_LIMIT:
            canceled_job_ids.discard(canceled_job_order.popleft())


def job_is_stale_or_canceled(job_id: str) -> bool:
    with job_state_lock:
        return job_id != latest_job_id or job_id in canceled_job_ids


def render_audio(generator: Iterable[tuple[object, object, object]], job_id: str):
    audio_segments: list[np.ndarray] = []
    deadline = time.monotonic() + INFERENCE_DEADLINE_SECONDS
    for _graphemes, _phonemes, audio in generator:
        if job_is_stale_or_canceled(job_id):
            raise HTTPException(status_code=409, detail="Synthesis job was superseded.")
        if time.monotonic() > deadline:
            raise HTTPException(status_code=504, detail="Speech synthesis timed out.")
        if audio is not None:
            segment = audio_to_numpy(audio)
            if segment.size:
                audio_segments.append(segment)

    if audio_segments:
        if job_is_stale_or_canceled(job_id):
            raise HTTPException(status_code=409, detail="Synthesis job was superseded.")
        audio = (
            audio_segments[0]
            if len(audio_segments) == 1
            else np.concatenate(audio_segments)
        )
        buffer = io.BytesIO()
        sf.write(buffer, audio, SAMPLE_RATE, format="WAV")
        buffer.seek(0)
        return buffer

    raise HTTPException(status_code=500, detail="No audio generated.")


def render_speech_with_deadline(text: str, voice: str, job_id: str) -> io.BytesIO:
    completed = threading.Event()
    result: dict[str, object] = {}

    def worker() -> None:
        try:
            if job_is_stale_or_canceled(job_id):
                raise HTTPException(status_code=409, detail="Synthesis job was superseded.")
            result["audio_buffer"] = render_audio(
                pipeline(text, voice=voice, speed=1.0),
                job_id,
            )
        except BaseException as error:
            result["error"] = error
        finally:
            inference_lock.release()
            completed.set()

    worker_thread = threading.Thread(target=worker, name=f"sayit-synthesis-{job_id[:8]}", daemon=True)
    try:
        worker_thread.start()
    except Exception:
        inference_lock.release()
        raise

    if not completed.wait(INFERENCE_DEADLINE_SECONDS):
        cancel_job(job_id)
        raise HTTPException(status_code=504, detail="Speech synthesis timed out.")

    error = result.get("error")
    if error:
        raise error

    audio_buffer = result.get("audio_buffer")
    if not isinstance(audio_buffer, io.BytesIO):
        raise HTTPException(status_code=500, detail="No audio generated.")
    return audio_buffer


configure_logging()
app = create_app()
pipeline = load_pipeline()


@app.middleware("http")
async def log_errors(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception:
        LOGGER.exception("Unhandled backend request failure: %s %s", request.method, request.url.path)
        raise


@app.get("/health")
def health(_auth: None = Depends(require_auth)):
    if pipeline is None:
        raise HTTPException(status_code=503, detail="TTS service is unavailable.")
    return {"status": "ok"}


@app.post("/cancel")
def cancel(request: CancelRequest, _auth: None = Depends(require_auth)):
    cancel_job(request.job_id)
    return {"status": "cancelled", "job_id": request.job_id}


@app.post("/synthesize")
def synthesize(request: SynthesizeRequest, _auth: None = Depends(require_auth)):
    text, voice = validate_request(request)

    if pipeline is None:
        raise HTTPException(status_code=503, detail="TTS service is unavailable.")

    remember_latest_job(request.job_id)

    if not inference_lock.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="Speech synthesis is already running.")

    try:
        audio_buffer = render_speech_with_deadline(text, voice, request.job_id)
        LOGGER.info(
            "Speech synthesis completed: job_id=%s voice=%s chars=%s",
            request.job_id,
            voice,
            len(text),
        )
    except HTTPException:
        raise
    except Exception:
        LOGGER.exception("Speech synthesis failed.")
        raise HTTPException(status_code=500, detail="Speech synthesis failed.")

    return StreamingResponse(audio_buffer, media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("SAYIT_BACKEND_PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port)
