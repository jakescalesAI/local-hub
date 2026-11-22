"""LocalHub voice: speech to text, on this computer.

A small worker that tv.mjs starts when someone is about to talk (the mic button, a TV page) and
keeps warm. It reads one JSON request per line on stdin:

    {"id": "j1", "path": "C:/.../clip.wav"}

and answers one JSON line on stdout:

    {"id": "j1", "text": "open netflix", "ms": 212, "model": "tiny.en"}

Two models, both warm: a small fast one for short clips (most of what's said to a TV is a few
words: "open Netflix", "what's on tonight") and a bigger one for anything longer. The audio is
decoded here, silence is already trimmed by the recorder, and the decoder skips timestamps.

Nothing leaves the computer. The models download once, from Hugging Face, on the first run.

    pip install faster-whisper

    python whisper.py <model> <device> <fast model or "-">
"""
import json
import os
import sys
import time


def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


try:
    from faster_whisper import WhisperModel
    import numpy as np
except Exception:  # noqa: BLE001 - any import failure means the same thing to the user
    out({"fatal": "Whisper isn't installed on this computer. Run: pip install faster-whisper"})
    sys.exit(2)

model_name = sys.argv[1] if len(sys.argv) > 1 else "base.en"
device = sys.argv[2] if len(sys.argv) > 2 else "cpu"
fast_name = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] not in ("", "-") else None
FAST_SECONDS = 4.0
THREADS = max(1, min(8, os.cpu_count() or 4))


def load(name):
    return WhisperModel(name, device=device, compute_type="int8" if device == "cpu" else "default", cpu_threads=THREADS)


try:
    model = load(model_name)
    fast = load(fast_name) if fast_name and fast_name != model_name else None
except Exception as e:  # noqa: BLE001
    out({"fatal": f"Couldn't load the Whisper model: {e}"})
    sys.exit(3)


def load_audio(path):
    """16 kHz mono float32 samples. Decoded here rather than by faster-whisper, whose own decoder
    passes an argument that newer PyAV releases no longer accept."""
    if path.endswith(".wav"):
        import wave

        with wave.open(path, "rb") as w:
            if w.getframerate() == 16000 and w.getnchannels() == 1 and w.getsampwidth() == 2:
                return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0

    import av  # webm/ogg from a browser, or a WAV in another format

    chunks = []
    with av.open(path) as container:
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        for frame in container.decode(audio=0):
            for f in resampler.resample(frame):
                chunks.append(f.to_ndarray().reshape(-1))
        for f in resampler.resample(None):
            chunks.append(f.to_ndarray().reshape(-1))
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks).astype(np.float32) / 32768.0


def run(m, audio, english):
    segments, _info = m.transcribe(
        audio,
        beam_size=1,
        vad_filter=False,  # the recorder already ends the clip when you stop talking
        without_timestamps=True,
        condition_on_previous_text=False,
        language="en" if english else None,
    )
    return " ".join(s.text.strip() for s in segments).strip()


# The first pass through a model is slow; do it now, not while someone waits.
silence = np.zeros(16000, dtype=np.float32)
for m, name in ((model, model_name), (fast, fast_name)):
    if m is not None:
        try:
            run(m, silence, name.endswith(".en"))
        except Exception:  # noqa: BLE001
            pass

out({"ready": True, "model": model_name, "fast": fast_name if fast else None, "device": device, "threads": THREADS})

for line in sys.stdin:
    try:
        req = json.loads(line)
    except ValueError:
        continue
    started = time.time()
    try:
        audio = load_audio(req["path"])
        short = fast is not None and len(audio) / 16000 < FAST_SECONDS
        m, name = (fast, fast_name) if short else (model, model_name)
        text = run(m, audio, name.endswith(".en"))
        out({"id": req.get("id"), "text": text, "ms": int((time.time() - started) * 1000), "model": name})
    except Exception as e:  # noqa: BLE001
        out({"id": req.get("id"), "error": str(e)})
