#!/bin/bash
# OCR script for invoice/document processing
# Usage: ./ocr.sh <image_path> [language]
# Language: eng (default), hin, eng+hin

IMG="$1"
LANG="${2:-eng+hin}"

if [ ! -f "$IMG" ]; then
  echo '{"error": "File not found: '$IMG'"}'
  exit 1
fi

TEXT=$(tesseract "$IMG" stdout -l "$LANG" 2>/dev/null)
echo "$TEXT"
