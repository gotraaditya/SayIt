import argparse
import os
import statistics
import time
from pathlib import Path
import sys


SENTENCES = [
    "SayIt reads selected text aloud from a compact desktop widget.",
    "This is a second sentence for a warm synthesis measurement.",
    "Short local text to speech should feel immediate during daily use.",
]


def elapsed_since(start: float) -> float:
    return time.perf_counter() - start


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--iterations", type=int, default=5)
    args = parser.parse_args()

    process_start = time.perf_counter()
    import_start = time.perf_counter()
    backend_dir = Path(__file__).resolve().parents[1] / "python-backend"
    sys.path.insert(0, str(backend_dir))
    os.environ["SAYIT_SKIP_MODEL_LOAD"] = "1"
    import app as sayit_app

    del os.environ["SAYIT_SKIP_MODEL_LOAD"]
    import_seconds = elapsed_since(import_start)

    load_start = time.perf_counter()
    pipeline = sayit_app.load_pipeline()
    if pipeline is None:
        raise SystemExit("Kokoro offline model assets are unavailable.")
    load_seconds = elapsed_since(load_start)
    selected_device = getattr(getattr(pipeline, "model", None), "device", "unknown")

    timings = []
    for index in range(args.iterations):
        text = SENTENCES[index % len(SENTENCES)]
        synth_start = time.perf_counter()
        generator = pipeline(text, voice="af_heart", speed=1.0)
        audio_samples = 0
        for _graphemes, _phonemes, audio in generator:
            if audio is not None:
                audio_samples += len(audio)
        timings.append(elapsed_since(synth_start))
        print(
            f"iteration={index + 1} synth_seconds={timings[-1]:.4f} "
            f"samples={audio_samples}"
        )

    warm_timings = timings[1:] if len(timings) > 1 else timings
    print(f"selected_device={selected_device}")
    print(f"import_seconds={import_seconds:.4f}")
    print(f"model_load_seconds={load_seconds:.4f}")
    print(f"process_to_ready_seconds={elapsed_since(process_start):.4f}")
    print(f"first_synth_seconds={timings[0]:.4f}")
    print(f"warm_synth_median_seconds={statistics.median(warm_timings):.4f}")
    print(f"warm_synth_min_seconds={min(warm_timings):.4f}")
    print(f"warm_synth_max_seconds={max(warm_timings):.4f}")


if __name__ == "__main__":
    main()
