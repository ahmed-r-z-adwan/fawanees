"""Build the single self-contained page, and the installable copy under pwa/.

dist/fawanees.html  one file, opens from disk or from any web host, no manifest, no worker file.
pwa/                the same page plus a manifest and a service worker, for GitHub Pages.
"""
import hashlib
import re
from pathlib import Path

root = Path(__file__).parent

SOURCES = (
    ('/*ENGINE*/', 'src/engine.js'),
    ('/*WORKER*/', 'src/worker.js'),
    ('/*LESSONS*/', 'src/lessons.js'),
    ('/*PUZZLES*/', 'src/puzzles.js'),
    ('/*PUZZLEUI*/', 'src/puzzleui.js'),
    ('/*TUTORIAL*/', 'src/tutorial.js'),
    ('/*CALIBRATION*/', 'src/calibration.js'),
    ('/*OPENING*/', 'src/opening.js'),
)

PWA_HEAD = (
    '<link rel="manifest" href="manifest.webmanifest">\n'
    '<link rel="apple-touch-icon" href="icons/icon-192.png">'
)

PWA_SCRIPT = (
    "<script>\n"
    "if ('serviceWorker' in navigator) addEventListener('load', () => "
    "navigator.serviceWorker.register('sw.js').catch(() => {}));\n"
    "</script>"
)


def read(rel):
    return (root / rel).read_text(encoding='utf-8')


def build_page():
    html = read('src/template.html')
    for marker, source in SOURCES:
        assert marker in html, f'{marker} missing from src/template.html'
        text = read(source)
        # The worker and engine sources live inside <script> elements and are also read back as
        # text to build the worker, so a literal closing tag would end the element early.
        assert '</script' not in text.lower(), f'{source} contains a literal </script'
        html = html.replace(marker, text)
    return html


def main():
    html = build_page()
    (root / 'dist').mkdir(exist_ok=True)
    (root / 'dist/fawanees.html').write_text(html, encoding='utf-8')
    print(f'built dist/fawanees.html ({len(html.encode("utf-8")) / 1024:.1f} KB)')

    pwa = root / 'pwa'
    if (pwa / 'sw.js').exists():
        # The same page, plus the two lines that make it installable.
        page = html.replace('<!--PWA-HEAD-->', PWA_HEAD).replace('<!--PWA-SCRIPT-->', PWA_SCRIPT)
        (pwa / 'index.html').write_text(page, encoding='utf-8')
        # The service worker caches by version, so bump it whenever the page changes.
        digest = hashlib.sha256(page.encode('utf-8')).hexdigest()[:12]
        sw = (pwa / 'sw.js').read_text(encoding='utf-8')
        sw = re.sub(r"const VERSION = '[^']*'", f"const VERSION = '{digest}'", sw, count=1)
        (pwa / 'sw.js').write_text(sw, encoding='utf-8')
        print(f'built pwa/index.html ({len(page.encode("utf-8")) / 1024:.1f} KB, cache version {digest})')


if __name__ == '__main__':
    main()
