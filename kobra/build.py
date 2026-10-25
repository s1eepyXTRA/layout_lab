"""Сборка Кобры в один HTML-файл.
  python3 build.py           → build/index.html   (библиотеки с CDN jsdelivr, нужен интернет)
  python3 build.py offline   → build/kobra.html   (все библиотеки внутри файла, работает без интернета)
"""
import os, sys
ROOT = os.path.dirname(os.path.abspath(__file__))
SRC, VENDOR = os.path.join(ROOT, 'src'), os.path.join(ROOT, 'vendor')
ORDER = ['data.js', 'engine.js', 'ui.js', 'auth.js', 'store.js', 'viz.js', 'app.js', 'dashboard.js', 'explore.js', 'datasets.js', 'schema.js', 'autodash.js', 'templates.js', 'guided.js', 'assistant.js', 'share.js', 'spec.js']
CDN = {
    'echarts.min.js': 'https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js',
    'marked.min.js': 'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js',
    'purify.min.js': 'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js',
}
LAZY = ['xlsx.full.min.js', 'papaparse.min.js']  # Excel и CSV: в онлайн-версии грузятся по требованию

offline = len(sys.argv) > 1 and sys.argv[1] == 'offline'
read = lambda p: open(p, encoding='utf-8').read()
css = read(os.path.join(SRC, 'styles.css'))
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

html = f'''<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Кобра — прототипы дашбордов</title>
{fonts}
<style>{css}</style>
{libs}</head>
<body>
<div class="loading" role="status"><div><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5c-3.3 0-6 2.6-6 6.3 0 2.4 1.2 4 2.6 5.2.8.7 1.1 1.4 1.1 2.4V21h4.6v-4.6c0-1 .3-1.7 1.1-2.4 1.4-1.2 2.6-2.8 2.6-5.2 0-3.7-2.7-6.3-6-6.3z"/></svg><span>Готовлю демо-данные…</span></div></div>
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
