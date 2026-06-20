#!/usr/bin/env python3
"""Transcribe a video/audio file to text using faster-whisper.

Usage:
    .venv/bin/python transcribe.py "video.mp4"
    .venv/bin/python transcribe.py "video.mp4" --model large-v3 --language cs

Outputs three files next to the input:
    <name>.txt   plain text transcript
    <name>.srt   subtitles with timestamps
    <name>.vtt   WebVTT subtitles
"""
import argparse
import os
import sys
from pathlib import Path

# Make the pip-installed CUDA libraries (cuBLAS / cuDNN) discoverable so the
# GPU path works without a system-wide CUDA install. LD_LIBRARY_PATH must be set
# before the dynamic linker starts, so we re-exec ourselves once with it set.
if not os.environ.get("_TRANSCRIBE_REEXEC"):
    try:
        import nvidia.cublas as _cublas
        import nvidia.cudnn as _cudnn
        _lib_dirs = [os.path.join(_cublas.__path__[0], "lib"),
                     os.path.join(_cudnn.__path__[0], "lib")]
        _cur = os.environ.get("LD_LIBRARY_PATH", "")
        if not all(d in _cur for d in _lib_dirs):
            os.environ["LD_LIBRARY_PATH"] = os.pathsep.join(_lib_dirs + ([_cur] if _cur else []))
            os.environ["_TRANSCRIBE_REEXEC"] = "1"
            os.execv(sys.executable, [sys.executable] + sys.argv)
    except ImportError:
        pass

from faster_whisper import WhisperModel


def fmt_ts(seconds: float, sep: str = ",") -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds - int(seconds)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def main() -> int:
    p = argparse.ArgumentParser(description="Transcribe media to text with Whisper.")
    p.add_argument("input", help="Path to the video/audio file")
    p.add_argument("--model", default="large-v3",
                   help="Whisper model: tiny, base, small, medium, large-v3 (default: large-v3)")
    p.add_argument("--language", default=None,
                   help="Language code e.g. 'cs', 'en'. Default: auto-detect")
    p.add_argument("--device", default="cuda", help="cuda or cpu (default: cuda)")
    p.add_argument("--compute-type", default="int8_float16",
                   help="e.g. int8_float16 (GPU, low VRAM), float16, int8 (CPU)")
    args = p.parse_args()

    src = Path(args.input)
    if not src.exists():
        print(f"File not found: {src}", file=sys.stderr)
        return 1

    print(f"Loading model '{args.model}' on {args.device} ({args.compute_type}) ...",
          file=sys.stderr)
    try:
        model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    except Exception as e:
        print(f"GPU load failed ({e}); falling back to CPU/int8.", file=sys.stderr)
        model = WhisperModel(args.model, device="cpu", compute_type="int8")

    print("Transcribing (this can take a while) ...", file=sys.stderr)
    segments, info = model.transcribe(
        str(src),
        language=args.language,
        vad_filter=True,            # skip long silences
        beam_size=5,
    )
    print(f"Detected language: {info.language} (p={info.language_probability:.2f}), "
          f"duration: {info.duration:.0f}s", file=sys.stderr)

    txt = src.with_suffix(".txt")
    srt = src.with_suffix(".srt")
    vtt = src.with_suffix(".vtt")

    with txt.open("w", encoding="utf-8") as ftxt, \
         srt.open("w", encoding="utf-8") as fsrt, \
         vtt.open("w", encoding="utf-8") as fvtt:
        fvtt.write("WEBVTT\n\n")
        for i, seg in enumerate(segments, 1):
            text = seg.text.strip()
            ftxt.write(text + "\n")
            fsrt.write(f"{i}\n{fmt_ts(seg.start)} --> {fmt_ts(seg.end)}\n{text}\n\n")
            fvtt.write(f"{fmt_ts(seg.start, '.')} --> {fmt_ts(seg.end, '.')}\n{text}\n\n")
            # live progress to stderr
            print(f"[{fmt_ts(seg.start)}] {text}", file=sys.stderr, flush=True)

    print(f"\nDone.\n  {txt}\n  {srt}\n  {vtt}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
