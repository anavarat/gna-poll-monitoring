#!/usr/bin/env python3
"""Simple pytesseract wrapper to extract text from images.

Usage:
  python ocr_tesseract.py /path/to/image.png
  python ocr_tesseract.py /path/to/image.png --lang eng
"""

import argparse
import sys

from PIL import Image
import pytesseract


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract text from images using Tesseract OCR.")
    parser.add_argument("image", help="Path to image file")
    parser.add_argument("--lang", default="eng", help="Tesseract language code (default: eng)")
    parser.add_argument("--psm", default="6", help="Tesseract page segmentation mode (default: 6)")
    args = parser.parse_args()

    try:
        img = Image.open(args.image)
    except Exception as e:
        print(f"Failed to open image: {e}", file=sys.stderr)
        return 2

    config = f"--psm {args.psm}"
    text = pytesseract.image_to_string(img, lang=args.lang, config=config)
    print(text.strip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
