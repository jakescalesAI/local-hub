"""LocalHub TV: speech to text, on this computer.

A small worker that tv.mjs starts on first use and keeps warm. It loads one Whisper model
(faster-whisper) and then reads one JSON request per line on stdin:

    {"id": "j1", "path": "C:/.../clip.wav"}

and answers one JSON line on stdout:

    {"id": "j1", "text": "open netflix", "ms": 412}

Nothing leaves the computer. The model downloads once, from Hugging Face, on the first run.

    pip install faster-whisper
"""
import json
import sys
import time


def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


try:
    from faster_whisper import WhisperModel
except Exception:  # noqa: BLE001 - any import failure means the same thing to the user
    out({"fatal": "Whisper isn't installed on this computer. Run: pip install faster-whisper"})
    sys.exit(2)

model_name = sys.argv[1] if len(sys.argv) > 1 else "base.en"
device = sys.argv[2] if len(sys.argv) > 2 else "cpu"

try:
    model = WhisperModel(model_name, device=device, compute_type="int8" if device == "cpu" else "default")
except Exception as e:  # noqa: BLE001
    out({"fatal": f"Couldn't load the Whisper model {model_name}: {e}"})
    sys.exit(3)

def load_audio(path):
    """16 kHz mono float32 samples. Decoded here rather than by faster-whisper, whose own decoder
    passes an argument that newer PyAV releases no longer accept."""
    import numpy as np

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


out({"ready": True, "model": model_name, "device": device})

for line in sys.stdin:
    try:
        req = json.loads(line)
    except ValueError:
        continue
    started = time.time()
    try:
        segments, _info = model.transcribe(
            load_audio(req["path"]),
            beam_size=1,
            vad_filter=True,
            language="en" if model_name.endswith(".en") else None,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        out({"id": req.get("id"), "text": text, "ms": int((time.time() - started) * 1000)})
    except Exception as e:  # noqa: BLE001
        out({"id": req.get("id"), "error": str(e)})
