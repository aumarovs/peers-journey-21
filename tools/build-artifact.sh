#!/bin/sh
# Сборка для публикации артефактом claude.ai: страница без обёртки, модули, люди base64-текстом
# (артефакты не отдают .glb). Использование: sh tools/build-artifact.sh /путь/к/dist
set -e
D=${1:-dist}; R=$(cd "$(dirname "$0")/.." && pwd)
rm -rf "$D"; mkdir -p "$D/assets/people"
python3 "$R/tools/artifact-page.py" | sed 's|<meta charset="utf-8">|<meta charset="utf-8">\n<meta name="glb-packed" content="1">|' > "$D/index.html"
cp -r "$R/src" "$D/src"
for f in "$R"/assets/people/*.glb; do base64 -w0 "$f" > "$D/assets/people/$(basename "$f").txt"; done
echo "$D: $(find "$D" -type f | wc -l) файлов, $(du -sh "$D" | cut -f1)"
