# Готовит страницу для публикации артефактом claude.ai: без doctype/html/head/body
# (обёртку добавляет хостинг), всё остальное как в index.html.
#   python3 tools/artifact-page.py > dist/peers-journey-21.html
import re, sys, pathlib

src = pathlib.Path(__file__).resolve().parent.parent / 'index.html'
s = src.read_text(encoding='utf-8')
s = re.sub(r'(?i)<!doctype html>\s*', '', s)
s = re.sub(r'(?i)<html[^>]*>\s*', '', s)
s = re.sub(r'(?i)</?head>\s*', '', s)
s = re.sub(r'(?i)<body[^>]*>\s*', '', s)
s = re.sub(r'(?i)</body>\s*</html>\s*$', '', s)
sys.stdout.write(s)
