"""LocalHub voice: text to speech, on this computer, with Kokoro (an open voice model, the one Quartzi speaks with).

A small worker that tv.mjs starts the first time something is to be said and keeps warm. It reads one JSON
request per line on stdin:

    {"id": "s1", "text": "It's clear and cold.", "voice": "af_heart", "speed": 1.0, "path": "C:/.../s1.wav"}

writes the speech to `path` (a WAV) and answers one JSON line on stdout:

    {"id": "s1", "ms": 412, "seconds": 2.1}

Nothing leaves the computer. The model is data/tts/kokoro-v1.0.int8.onnx and data/tts/voices-v1.0.bin
(from https://github.com/thewh1teagle/kokoro-onnx/releases, model-files-v1.0).

    pip install kokoro-onnx soundfile

    python tts.py <model.onnx> <voices.bin>
"""
import json
import sys
import time


def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main():
    if len(sys.argv) < 3:
        out({"fatal": "usage: tts.py <model.onnx> <voices.bin>"})
        return
    try:
        from kokoro_onnx import Kokoro
        import soundfile as sf
    except Exception as e:  # not installed
        out({"fatal": f"Kokoro isn't installed here: pip install kokoro-onnx soundfile ({e})"})
        return
    try:
        k = Kokoro(sys.argv[1], sys.argv[2])
    except Exception as e:
        out({"fatal": f"The voice model couldn't load: {e}"})
        return
    voices = set(k.get_voices())
    out({"ready": True, "voices": sorted(v for v in voices if v[:3] in ("af_", "am_", "bf_", "bm_"))})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        rid = req.get("id")
        try:
            text = str(req.get("text") or "").strip()[:2000]
            voice = req.get("voice") if req.get("voice") in voices else "af_heart"
            speed = min(1.4, max(0.7, float(req.get("speed") or 1.0)))
            lang = "en-gb" if voice.startswith("b") else "en-us"
            t = time.time()
            samples, rate = k.create(text, voice=voice, speed=speed, lang=lang)
            sf.write(req["path"], samples, rate, subtype="PCM_16")
            out({"id": rid, "ms": round((time.time() - t) * 1000), "seconds": round(len(samples) / rate, 2)})
        except Exception as e:
            out({"id": rid, "error": str(e)})


if __name__ == "__main__":
    main()
