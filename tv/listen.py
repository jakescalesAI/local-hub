"""LocalHub listening: "Hey LocalHub" from this computer's microphone, for the TV.

tv.mjs starts this when "Hey LocalHub" is on (the TV's Settings) and stops it when it's off. It listens all the time,
on this computer only, for the phrase; nothing is kept or sent anywhere until it hears it. Then it records what's said
next, until a pause, turns it into words with Whisper, and answers one JSON line on stdout for each step:

    {"ready": true, "mic": "Microphone Array (…)"}
    {"wake": true}                    heard "Hey LocalHub": the TV shows that it's listening
    {"working": true}                 the request has ended: turning it into words
    {"heard": "open netflix"}         what was asked ("" when nothing was)

The phrase is spotted by Vosk, a small speech model that only listens for it (cheap enough to run all the time); the
request, and a second look at the phrase, are Whisper's. Models: data/listen/vosk-model-small-en-us-0.15 (from
https://alphacephei.com/vosk/models) and Whisper's base.en (downloaded by faster-whisper on first use).

    pip install sounddevice vosk faster-whisper

    python listen.py <vosk model dir> [whisper model] [mic name or number]
"""
import json
import queue
import re
import sys
import time
from collections import deque

RATE = 16000
BLOCK = 1600  # 0.1 s
PRE = 40  # blocks of audio kept from before the phrase was spotted (4 s): it may have been said in one breath
SILENCE_END = 9  # 0.9 s of quiet ends the request
WAIT_START = 60  # 6 s for a request to start after "Hey LocalHub" on its own
LONGEST = 150  # 15 s at most

# "Hey LocalHub" as Whisper writes it: "Hey, Local Hub.", "hey localhub", "Hi local hub", "Okay, LocalHub"…
WAKE = re.compile(r"^.*?\b(?:(?:hey|hi|hay|okay|ok|a)\W*)?local\W*hubs?\b\W*", re.I | re.S)
SAID = re.compile(r"\blocal\W*hubs?\b", re.I)


def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def level(block):
    import numpy as np
    return float(np.sqrt(np.mean(block.astype(np.float32) ** 2)))


def main():
    if len(sys.argv) < 2:
        out({"fatal": "usage: listen.py <vosk model dir> [whisper model] [mic]"})
        return
    try:
        import numpy as np
        import sounddevice as sd
        import vosk
        from faster_whisper import WhisperModel
    except Exception as e:
        out({"fatal": f"Listening needs: pip install sounddevice vosk faster-whisper ({e})"})
        return
    vosk.SetLogLevel(-1)
    try:
        spotter = vosk.Model(sys.argv[1])
    except Exception as e:
        out({"fatal": f"The phrase model couldn't load from {sys.argv[1]}: {e}"})
        return
    mic = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
    if mic is not None and mic.isdigit():
        mic = int(mic)
    test = mic[5:] if isinstance(mic, str) and mic.startswith("file:") else None  # a recording instead of the mic, for tests
    try:
        name = test or sd.query_devices(mic, kind="input")["name"]
    except Exception as e:
        out({"fatal": f"No microphone here ({e})"})
        return
    whisper_name = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else "base.en"
    whisper = WhisperModel(whisper_name, device="cpu", compute_type="int8", cpu_threads=2)
    # A quick second opinion on the phrase (a few hundred ms): Vosk, made to choose between the phrase and
    # nothing else, takes all sorts of sounds for it. Nothing reaches the TV until Whisper hears it too.
    checker = WhisperModel("tiny.en", device="cpu", compute_type="int8", cpu_threads=2)

    grammar = json.dumps(["hey local hub", "hi local hub", "okay local hub", "local hub", "[unk]"])
    rec = vosk.KaldiRecognizer(spotter, RATE, grammar)

    blocks = queue.Queue()

    def got(indata, frames, t, status):
        blocks.put(bytes(indata))

    def take():
        return np.frombuffer(blocks.get(), dtype=np.int16)

    def words(audio, model=None):
        segs, _ = (model or whisper).transcribe(audio.astype(np.float32) / 32768.0, language="en", beam_size=1, vad_filter=False,
                                     condition_on_previous_text=False)
        return " ".join(s.text.strip() for s in segs).strip()

    # The room's own sound (a fan, the TV): speech is well above it.
    floor = deque([200.0] * 50, maxlen=50)

    def loud(b):
        return level(b) > max(260.0, sorted(floor)[len(floor) // 2] * 2.6)

    def record(pre, wait_start):
        """Audio until a pause after speech, starting with `pre`. Empty when nobody spoke within wait_start blocks."""
        got_ = list(pre)
        spoke = False
        quiet = 0
        n = 0
        while n < LONGEST:
            b = take()
            n += 1
            got_.append(b)
            if loud(b):
                spoke, quiet = True, 0
            else:
                quiet += 1
                if spoke and quiet >= SILENCE_END:
                    break
                if not spoke and n >= wait_start:
                    break
        return np.concatenate(got_), spoke

    if test:
        import threading
        import soundfile as sf

        def play():
            a, r = sf.read(test, dtype="int16")
            if a.ndim > 1:
                a = a[:, 0]
            if r != RATE:
                a = np.interp(np.arange(0, len(a), r / RATE), np.arange(len(a)), a).astype(np.int16)
            a = np.concatenate([np.zeros(RATE, np.int16), a, np.zeros(RATE * 8, np.int16)])
            for i in range(0, len(a) - BLOCK, BLOCK):
                blocks.put(a[i:i + BLOCK].tobytes())
                time.sleep(0.02)
        threading.Thread(target=play, daemon=True).start()
        stream = None
    else:
        stream = sd.RawInputStream(samplerate=RATE, blocksize=BLOCK, dtype="int16", channels=1, device=mic, callback=got)
    with stream or open(__file__):
        out({"ready": True, "mic": name})
        # "now" on stdin: the remote's mic button was pressed. Listen for a request at once, no phrase needed.
        import threading
        now = threading.Event()

        def commands():
            for line in sys.stdin:
                if line.strip() == "now":
                    now.set()
        threading.Thread(target=commands, daemon=True).start()
        before = deque(maxlen=PRE)
        while True:
            b = take()
            before.append(b)
            if now.is_set():
                now.clear()
                t0 = time.time()
                out({"wake": True})
                audio, spoke = record([], wait_start=WAIT_START)
                ask = ""
                if spoke:
                    out({"working": True})
                    said = words(audio)
                    ask = (WAKE.sub("", said, count=1) if SAID.search(said) else said).strip(" ,.!?")
                out({"heard": ask, "ms": round((time.time() - t0) * 1000)})
                while not blocks.empty():
                    blocks.get_nowait()
                before.clear()
                rec.Reset()
                continue
            if not loud(b):
                floor.append(level(b))
            heard = ""
            if rec.AcceptWaveform(b.tobytes()):
                heard = json.loads(rec.Result()).get("text", "")
            else:
                heard = json.loads(rec.PartialResult()).get("partial", "")
            if not re.search(r"\b(hey|hi|okay) local hub", heard):
                continue
            rec.Reset()
            t0 = time.time()
            if not SAID.search(words(np.concatenate(list(before)[-30:]), checker)):
                sys.stderr.write("not the phrase\n")
                sys.stderr.flush()
                continue
            out({"wake": True})
            # The rest of the sentence ("…open Netflix"), or, after a pause, the request that follows.
            audio, _ = record(before, wait_start=8)
            before.clear()
            out({"working": True})
            text = words(audio)
            if not SAID.search(text):
                # Whisper didn't hear the phrase in it: something else that sounded like it.
                out({"heard": "", "false": True, "text": text[:200]})
                continue
            ask = WAKE.sub("", text, count=1).strip(" ,.!?")
            if not ask:
                out({"wake": True, "again": True})
                audio, spoke = record([], wait_start=WAIT_START)
                if spoke:
                    out({"working": True})
                    ask = words(audio).strip(" ,.!?")
            out({"heard": ask, "ms": round((time.time() - t0) * 1000)})
            # Anything said while it was working isn't the phrase again.
            while not blocks.empty():
                blocks.get_nowait()
            rec.Reset()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as e:  # the mic went away, and the like
        out({"fatal": str(e)})
