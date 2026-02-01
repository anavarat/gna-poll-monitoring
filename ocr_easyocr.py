#!/usr/bin/env python3
"""EasyOCR wrapper with optional ambiguity disambiguation.

Usage:
  python ocr_easyocr.py /path/to/image.png
  python ocr_easyocr.py /path/to/image.png --detail
  python ocr_easyocr.py /path/to/image.png --disambiguate
  python ocr_easyocr.py /path/to/image.png --lang en --disambiguate
"""

import argparse
import sys
from typing import List, Tuple

import easyocr
import numpy as np
from PIL import Image


AMBIGUOUS_SETS = [
    set(["O", "0"]),
    set(["I", "1", "l"]),
    set(["S", "5"]),
    set(["Z", "2"]),
    set(["B", "8"]),
]


def has_ambiguous(text: str) -> bool:
    chars = set(text)
    for group in AMBIGUOUS_SETS:
        if len(chars.intersection(group)) >= 1:
            return True
    return False


def build_allowlist(text: str) -> str:
    allow = set()
    for group in AMBIGUOUS_SETS:
        if set(text).intersection(group):
            allow.update(group)
    # Always keep original characters too
    allow.update([c for c in text if c.isalnum()])
    return "".join(sorted(allow))


def crop_from_box(img: np.ndarray, box: List[List[float]]) -> np.ndarray:
    xs = [p[0] for p in box]
    ys = [p[1] for p in box]
    x1, x2 = int(max(min(xs), 0)), int(min(max(xs), img.shape[1] - 1))
    y1, y2 = int(max(min(ys), 0)), int(min(max(ys), img.shape[0] - 1))
    if x2 <= x1 or y2 <= y1:
        return img
    return img[y1:y2, x1:x2]


def score_candidate(text: str) -> float:
    if not text:
        return 0.0
    digits = sum(c.isdigit() for c in text)
    letters = sum(c.isalpha() for c in text)
    # Prefer mixed content slightly, penalize symbols
    symbols = len(text) - digits - letters
    return digits + letters - (symbols * 0.5)


def disambiguate(reader: easyocr.Reader, image: np.ndarray, results: List[Tuple]) -> List[Tuple]:
    updated = []
    for box, text, conf in results:
        if not text or not has_ambiguous(text):
            updated.append((box, text, conf))
            continue

        allowlist = build_allowlist(text)
        crop = crop_from_box(image, box)
        # Re-OCR the crop with allowlist
        try:
            sub = reader.readtext(crop, detail=1, allowlist=allowlist)
        except Exception:
            updated.append((box, text, conf))
            continue

        if not sub:
            updated.append((box, text, conf))
            continue

        # Pick best candidate by confidence then score
        best_text, best_conf = text, conf
        for _b, t, c in sub:
            if c > best_conf + 0.1:
                best_text, best_conf = t, c
            elif abs(c - best_conf) <= 0.1:
                if score_candidate(t) > score_candidate(best_text):
                    best_text, best_conf = t, c
        updated.append((box, best_text, best_conf))
    return updated


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract text from images using EasyOCR.")
    parser.add_argument("image", help="Path to image file")
    parser.add_argument("--lang", default="en", help="Language code (default: en)")
    parser.add_argument("--detail", action="store_true", help="Show detailed output with boxes/confidence")
    parser.add_argument("--disambiguate", action="store_true", help="Second-pass OCR on ambiguous tokens")
    args = parser.parse_args()

    langs = [s.strip() for s in args.lang.split(",") if s.strip()]
    if not langs:
        print("No languages specified.", file=sys.stderr)
        return 2

    reader = easyocr.Reader(langs, gpu=False)
    results = reader.readtext(args.image, detail=1)

    if args.disambiguate:
        # Load image as numpy for cropping
        img = np.array(Image.open(args.image).convert("RGB"))
        results = disambiguate(reader, img, results)

    if args.detail:
        for box, text, conf in results:
            print(f"{text}\t(conf={conf:.3f})\t(box={box})")
    else:
        lines = [text for (_box, text, _conf) in results]
        print("\n".join(lines))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
