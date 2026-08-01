import os
import threading
import time
import wave
import unittest
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ["SAYIT_SKIP_MODEL_LOAD"] = "1"
os.environ["SAYIT_BACKEND_TOKEN"] = "test-token"

import app as sayit_app


def request(text: str, voice: str = "af_heart", job_id: str = "test-job"):
    return sayit_app.SynthesizeRequest(text=text, voice=voice, job_id=job_id)


def wait_for_inference_lock_release(timeout_seconds: float = 1.0):
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if sayit_app.inference_lock.acquire(blocking=False):
            sayit_app.inference_lock.release()
            return
        time.sleep(0.01)
    raise AssertionError("inference lock was not released before the test deadline")


def reset_backend_degraded_state():
    with sayit_app.health_state_lock:
        sayit_app.backend_degraded_reason = ""


class BackendValidationTests(unittest.TestCase):
    def test_rejects_empty_text(self):
        with self.assertRaises(HTTPException) as context:
            sayit_app.validate_request(request("   "))

        self.assertEqual(context.exception.status_code, 400)

    def test_rejects_oversized_text_chunk(self):
        with self.assertRaises(HTTPException) as context:
            sayit_app.validate_request(
                request("x" * (sayit_app.MAX_TEXT_CHARS + 1))
            )

        self.assertEqual(context.exception.status_code, 413)

    def test_rejects_unknown_voice(self):
        with self.assertRaises(HTTPException) as context:
            sayit_app.validate_request(
                request("hello", voice="unknown")
            )

        self.assertEqual(context.exception.status_code, 400)

    def test_accepts_supported_voice(self):
        text, voice = sayit_app.validate_request(request(" hello ", voice="af_heart"))

        self.assertEqual(text, "hello")
        self.assertEqual(voice, "af_heart")

    def test_synthesis_failures_return_generic_error(self):
        class FailingPipeline:
            def __call__(self, *_args, **_kwargs):
                raise RuntimeError("internal diagnostic details")

        original_pipeline = sayit_app.pipeline
        sayit_app.pipeline = FailingPipeline()
        try:
            with self.assertLogs(sayit_app.LOGGER, level="ERROR"):
                with self.assertRaises(HTTPException) as context:
                    sayit_app.synthesize(
                        sayit_app.SynthesizeRequest(
                            text="hello",
                            voice="af_heart",
                            job_id="failing-job",
                        )
                    )
        finally:
            sayit_app.pipeline = original_pipeline

        self.assertEqual(context.exception.status_code, 500)
        self.assertEqual(context.exception.detail, "Speech synthesis failed.")

    def test_render_audio_concatenates_every_generated_segment(self):
        generator = iter(
            [
                ("first", "a", [0.1, 0.2, 0.3]),
                ("second", "b", [0.4, 0.5]),
            ]
        )

        sayit_app.remember_latest_job("concat-job")
        audio_buffer = sayit_app.render_audio(generator, "concat-job")

        with wave.open(audio_buffer, "rb") as wav:
            self.assertEqual(wav.getframerate(), sayit_app.SAMPLE_RATE)
            self.assertEqual(wav.getnframes(), 5)

    def test_render_audio_rejects_superseded_job(self):
        sayit_app.remember_latest_job("newer-job")

        with self.assertRaises(HTTPException) as context:
            sayit_app.render_audio(iter([("old", "a", [0.1])]), "older-job")

        self.assertEqual(context.exception.status_code, 409)

    def test_render_audio_rejects_cancel_after_final_segment(self):
        def generator():
            yield ("last", "a", [0.1])
            sayit_app.cancel_job("final-cancel-job")

        sayit_app.remember_latest_job("final-cancel-job")

        with self.assertRaises(HTTPException) as context:
            sayit_app.render_audio(generator(), "final-cancel-job")

        self.assertEqual(context.exception.status_code, 409)

    def test_render_audio_enforces_inference_deadline(self):
        original_deadline = sayit_app.INFERENCE_DEADLINE_SECONDS
        sayit_app.INFERENCE_DEADLINE_SECONDS = -1
        sayit_app.remember_latest_job("timeout-job")
        try:
            with self.assertRaises(HTTPException) as context:
                sayit_app.render_audio(iter([("late", "a", [0.1])]), "timeout-job")
        finally:
            sayit_app.INFERENCE_DEADLINE_SECONDS = original_deadline

        self.assertEqual(context.exception.status_code, 504)

    def test_requires_backend_token(self):
        self.assertIsNone(sayit_app.require_auth("test-token"))

        with self.assertRaises(HTTPException) as context:
            sayit_app.require_auth("wrong-token")

        self.assertEqual(context.exception.status_code, 401)

    def test_missing_backend_token_fails_closed(self):
        original_token = sayit_app.AUTH_TOKEN
        sayit_app.AUTH_TOKEN = ""
        try:
            with self.assertRaises(HTTPException) as context:
                sayit_app.require_auth("test-token")
        finally:
            sayit_app.AUTH_TOKEN = original_token

        self.assertEqual(context.exception.status_code, 503)

    def test_health_requires_token_and_reports_unavailable_model(self):
        client = TestClient(sayit_app.app)

        unauthorized = client.get("/health")
        self.assertEqual(unauthorized.status_code, 401)

        unavailable = client.get("/health", headers={"X-SayIt-Token": "test-token"})
        self.assertEqual(unavailable.status_code, 503)
        self.assertIn("Kokoro import failed", unavailable.json()["detail"])

    def test_synthesis_and_cancel_endpoints_require_token(self):
        client = TestClient(sayit_app.app)

        synthesize = client.post(
            "/synthesize",
            json={"text": "hello", "voice": "af_heart", "job_id": "auth-job"},
        )
        cancel = client.post("/cancel", json={"job_id": "auth-job"})

        self.assertEqual(synthesize.status_code, 401)
        self.assertEqual(cancel.status_code, 401)

    def test_rejects_oversized_job_ids(self):
        client = TestClient(sayit_app.app)
        response = client.post(
            "/cancel",
            headers={"X-SayIt-Token": "test-token"},
            json={"job_id": "x" * (sayit_app.MAX_JOB_ID_CHARS + 1)},
        )

        self.assertEqual(response.status_code, 422)

    def test_cors_preflight_allows_auth_token_header(self):
        client = TestClient(sayit_app.app)

        response = client.options(
            "/synthesize",
            headers={
                "Origin": "http://localhost:1425",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,x-sayit-token",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("x-sayit-token", response.headers["access-control-allow-headers"].lower())
        self.assertIn("POST", response.headers["access-control-allow-methods"])

    def test_cors_preflight_allows_health_get(self):
        client = TestClient(sayit_app.app)

        response = client.options(
            "/health",
            headers={
                "Origin": "http://localhost:1425",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "x-sayit-token",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("GET", response.headers["access-control-allow-methods"])

    def test_cancel_marks_job_stale(self):
        sayit_app.remember_latest_job("cancel-job")
        sayit_app.cancel(sayit_app.CancelRequest(job_id="cancel-job"))

        self.assertTrue(sayit_app.job_is_stale_or_canceled("cancel-job"))

    def test_synthesize_rejects_job_canceled_before_start(self):
        class FakePipeline:
            def __call__(self, *_args, **_kwargs):
                return iter([("text", "phonemes", [0.1])])

        original_pipeline = sayit_app.pipeline
        sayit_app.pipeline = FakePipeline()
        sayit_app.cancel_job("pre-canceled-job")
        try:
            with self.assertRaises(HTTPException) as context:
                sayit_app.synthesize(
                    sayit_app.SynthesizeRequest(
                        text="hello",
                        voice="af_heart",
                        job_id="pre-canceled-job",
                    )
                )
        finally:
            sayit_app.pipeline = original_pipeline

        self.assertEqual(context.exception.status_code, 409)

    def test_cancel_history_is_bounded(self):
        for index in range(sayit_app.CANCELED_JOB_HISTORY_LIMIT + 5):
            sayit_app.cancel_job(f"old-job-{index}")

        self.assertLessEqual(
            len(sayit_app.canceled_job_ids),
            sayit_app.CANCELED_JOB_HISTORY_LIMIT,
        )
        self.assertNotIn("old-job-0", sayit_app.canceled_job_ids)
        self.assertIn(
            f"old-job-{sayit_app.CANCELED_JOB_HISTORY_LIMIT + 4}",
            sayit_app.canceled_job_ids,
        )

    def test_synthesize_rejects_when_inference_is_busy_and_supersedes_running_job(self):
        class FakePipeline:
            def __call__(self, *_args, **_kwargs):
                return iter([])

        original_pipeline = sayit_app.pipeline
        original_queue_wait = sayit_app.INFERENCE_QUEUE_WAIT_SECONDS
        sayit_app.pipeline = FakePipeline()
        sayit_app.INFERENCE_QUEUE_WAIT_SECONDS = 0
        sayit_app.remember_latest_job("running-job")
        acquired = sayit_app.inference_lock.acquire(blocking=False)
        self.assertTrue(acquired)
        try:
            with self.assertRaises(HTTPException) as context:
                sayit_app.synthesize(
                    sayit_app.SynthesizeRequest(
                        text="hello",
                        voice="af_heart",
                        job_id="busy-job",
                    )
                )
        finally:
            sayit_app.inference_lock.release()
            sayit_app.pipeline = original_pipeline
            sayit_app.INFERENCE_QUEUE_WAIT_SECONDS = original_queue_wait

        self.assertEqual(context.exception.status_code, 429)
        self.assertTrue(sayit_app.job_is_stale_or_canceled("running-job"))
        self.assertFalse(sayit_app.job_is_stale_or_canceled("busy-job"))

    def test_synthesize_waits_briefly_for_inference_lock(self):
        class FakePipeline:
            def __call__(self, *_args, **_kwargs):
                return iter([("text", "phonemes", [0.1])])

        original_pipeline = sayit_app.pipeline
        original_queue_wait = sayit_app.INFERENCE_QUEUE_WAIT_SECONDS
        sayit_app.pipeline = FakePipeline()
        sayit_app.INFERENCE_QUEUE_WAIT_SECONDS = 0.5
        acquired = sayit_app.inference_lock.acquire(blocking=False)
        self.assertTrue(acquired)

        def release_lock():
            time.sleep(0.05)
            sayit_app.inference_lock.release()

        releaser = threading.Thread(target=release_lock)
        releaser.start()
        try:
            response = sayit_app.synthesize(
                sayit_app.SynthesizeRequest(
                    text="hello",
                    voice="af_heart",
                    job_id="queued-job",
                )
            )

            self.assertEqual(response.media_type, "audio/wav")
        finally:
            releaser.join(timeout=1)
            if sayit_app.inference_lock.acquire(blocking=False):
                sayit_app.inference_lock.release()
            sayit_app.pipeline = original_pipeline
            sayit_app.INFERENCE_QUEUE_WAIT_SECONDS = original_queue_wait

    def test_synthesize_timeout_marks_backend_unhealthy_until_restart(self):
        class SlowPipeline:
            def __call__(self, *_args, **_kwargs):
                time.sleep(0.2)
                return iter([("text", "phonemes", [0.1])])

        client = TestClient(sayit_app.app)
        original_pipeline = sayit_app.pipeline
        original_deadline = sayit_app.INFERENCE_DEADLINE_SECONDS
        original_grace = sayit_app.INFERENCE_TIMEOUT_GRACE_SECONDS
        sayit_app.pipeline = SlowPipeline()
        sayit_app.INFERENCE_DEADLINE_SECONDS = 0.01
        sayit_app.INFERENCE_TIMEOUT_GRACE_SECONDS = 0.01
        reset_backend_degraded_state()
        try:
            with self.assertRaises(HTTPException) as context:
                sayit_app.synthesize(
                    sayit_app.SynthesizeRequest(
                        text="hello",
                        voice="af_heart",
                        job_id="timeout-worker-job",
                    )
                )

            self.assertEqual(context.exception.status_code, 504)
            self.assertFalse(sayit_app.inference_lock.acquire(blocking=False))
            health = client.get("/health", headers={"X-SayIt-Token": "test-token"})
            self.assertEqual(health.status_code, 503)
        finally:
            sayit_app.pipeline = original_pipeline
            sayit_app.INFERENCE_DEADLINE_SECONDS = original_deadline
            sayit_app.INFERENCE_TIMEOUT_GRACE_SECONDS = original_grace
            wait_for_inference_lock_release()
            reset_backend_degraded_state()

    def test_synthesize_uses_result_when_generation_finishes_during_timeout_grace(self):
        class SlightlySlowPipeline:
            def __call__(self, *_args, **_kwargs):
                time.sleep(0.05)
                return iter([("text", "phonemes", [0.1])])

        original_pipeline = sayit_app.pipeline
        original_deadline = sayit_app.INFERENCE_DEADLINE_SECONDS
        original_grace = sayit_app.INFERENCE_TIMEOUT_GRACE_SECONDS
        sayit_app.pipeline = SlightlySlowPipeline()
        sayit_app.INFERENCE_DEADLINE_SECONDS = 0.01
        sayit_app.INFERENCE_TIMEOUT_GRACE_SECONDS = 0.2
        reset_backend_degraded_state()
        try:
            response = sayit_app.synthesize(
                sayit_app.SynthesizeRequest(
                    text="hello",
                    voice="af_heart",
                    job_id="grace-job",
                )
            )

            self.assertEqual(response.media_type, "audio/wav")
            self.assertEqual(sayit_app.backend_degraded(), "")
        finally:
            sayit_app.pipeline = original_pipeline
            sayit_app.INFERENCE_DEADLINE_SECONDS = original_deadline
            sayit_app.INFERENCE_TIMEOUT_GRACE_SECONDS = original_grace
            wait_for_inference_lock_release()
            reset_backend_degraded_state()


if __name__ == "__main__":
    unittest.main()
