"""Сборка Кобры в один HTML-файл.
  python3 build.py           → build/index.html   (библиотеки с CDN jsdelivr, нужен интернет)
  python3 build.py offline   → build/kobra.html   (все библиотеки внутри файла, работает без интернета)
"""
import os, sys
from urllib.parse import quote
ROOT = os.path.dirname(os.path.abspath(__file__))
SRC, VENDOR = os.path.join(ROOT, 'src'), os.path.join(ROOT, 'vendor')
ORDER = ['types.js', 'data.js', 'engine.js', 'ui.js', 'storage.js', 'auth.js', 'store.js', 'router.js', 'grid.js', 'viz.js', 'app.js', 'dashboard.js', 'explore.js', 'datasets.js', 'schema.js', 'autodash.js', 'templates.js', 'guided.js', 'assistant.js', 'aidraft.js', 'share.js', 'spec.js']
CDN = {
    'echarts.min.js': 'https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js',
    'marked.min.js': 'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js',
    'purify.min.js': 'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js',
}
LAZY = ['xlsx.full.min.js', 'papaparse.min.js']  # Excel и CSV: в онлайн-версии грузятся по требованию

offline = len(sys.argv) > 1 and sys.argv[1] == 'offline'
read = lambda p: open(p, encoding='utf-8').read()
css = read(os.path.join(SRC, 'styles.css'))
# Файл в src/, забытый в ORDER, не попадёт в сборку и молча «не заработает».
# Проверяем здесь: это дешевле, чем искать потом в собранном HTML.
have = sorted(f for f in os.listdir(SRC) if f.endswith('.js'))
missing = [f for f in have if f not in ORDER]
extra = [f for f in ORDER if f not in have]
if missing:
    raise SystemExit('Не перечислены в ORDER: ' + ', '.join(missing))
if extra:
    raise SystemExit('В ORDER есть несуществующие файлы: ' + ', '.join(extra))

js = '\n'.join(read(os.path.join(SRC, f)) for f in ORDER)

if offline:
    js = js.replace("function loadScript(src) {",
                    "function loadScript(src) {\n  if ((/xlsx/.test(src) && window.XLSX) || (/papaparse/i.test(src) && window.Papa)) return Promise.resolve();")
    libs = ''.join('<script>' + read(os.path.join(VENDOR, f)).replace('</script', '<\\/script') + '</script>\n'
                   for f in list(CDN) + LAZY)
    fonts = '<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&family=Unbounded:wght@500;600;700&display=swap" rel="stylesheet">'
else:
    libs = ''.join(f'<script src="{u}"></script>\n' for u in CDN.values())
    fonts = ('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
             '<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&family=Unbounded:wght@500;600;700&display=swap" rel="stylesheet">')

# Знак логотипа: кольцо на тёмной плашке. Тот же знак рисует brandMark() в ui.js,
# но экран загрузки показывается до запуска скриптов, поэтому разметка нужна и здесь.
PLATE = '<rect width="160" height="160" rx="36" fill="#1F2430"/>'
RING = '<path fill="#5B6270" d="M122.13 115.35A55 55 0 0 1 65.97 133.18L73.54 112.36A33 33 0 0 0 105.28 101.21Z"/><path fill="#A8481A" d="M56.57 129.76A55 55 0 0 1 25.23 85L47.38 85A33 33 0 0 0 64.15 108.94Z"/><path fill="#F2A65A" d="M25.23 75A55 55 0 0 1 56.57 30.24L64.15 51.06A33 33 0 0 0 47.38 75Z"/><path fill="#E06A1B" d="M65.97 26.82A55 55 0 0 1 122.13 44.65L105.28 58.79A33 33 0 0 0 73.54 47.64Z"/>'
mark = '<svg viewBox="0 0 160 160" aria-hidden="true">' + RING + '</svg>'
favicon = 'data:image/svg+xml;charset=utf-8,' + quote('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">' + PLATE + RING + '</svg>')

html = f'''<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Кобра — прототипы дашбордов</title>
<link rel="icon" href="{favicon}">
<meta name="theme-color" content="#1F2430">
{fonts}
<style>{css}</style>
{libs}</head>
<body>
<div class="loading" role="status"><div>{mark}<span>Готовлю демо-данные…</span></div></div>
<div id="app"></div>
<script>
{js}
boot().catch(e => {{ console.error(e); const s = document.querySelector('.loading span'); if (s) s.textContent = 'Ошибка запуска: ' + e.message; }});
</script>
</body>
</html>'''
os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
out = os.path.join(ROOT, 'build', 'kobra.html' if offline else 'index.html')
open(out, 'w', encoding='utf-8').write(html)
print(out, len(html))
