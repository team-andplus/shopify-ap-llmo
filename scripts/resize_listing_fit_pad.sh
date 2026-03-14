#!/bin/bash
# Resize listing images to 1300×900: scale to fit (keep aspect), pad with #333333. No stretch.
# Uses ImageMagick (convert).
set -e
ASSETS="$(dirname "$0")/../public/assets"
TMP="/tmp/ap-llmo-resized.png"
for name in ap-llmo-listing-1-llms-txt ap-llmo-listing-2-ai-generation ap-llmo-listing-3-ai-visibility ap-llmo-listing-4-bot-detection ap-llmo-listing-5-theme-integration; do
  F="$ASSETS/${name}.png"
  [ -f "$F" ] || continue
  convert "$F" -resize 1300x900\> "$TMP"
  convert -size 1300x900 xc:'#333333' "$TMP" -gravity center -composite "$F"
  echo "  $name.png -> 1300×900 (fit+pad)"
done
rm -f "$TMP"
