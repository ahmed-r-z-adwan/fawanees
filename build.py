"""Build the single self-contained page, and the installable copy under pwa/.

dist/fawanees.html  one file, opens from disk or from any web host, no manifest, no worker file.
pwa/                the same page plus a manifest and a service worker, for GitHub Pages.
"""
import hashlib
import re
from pathlib import Path

root = Path(__file__).parent

SOURCES = (
    ('/*RELAY*/', 'src/relay.js'),
    ('/*ENGINE*/', 'src/engine.js'),
    ('/*WORKER*/', 'src/worker.js'),
    ('/*LESSONS*/', 'src/lessons.js'),
    ('/*PUZZLES*/', 'src/puzzles.js'),
    ('/*PUZZLEUI*/', 'src/puzzleui.js'),
    ('/*TUTORIAL*/', 'src/tutorial.js'),
    ('/*CALIBRATION*/', 'src/calibration.js'),
    ('/*OPENING*/', 'src/opening.js'),
)

SITE = 'https://ahmed-r-z-adwan.github.io/fawanees/'

PWA_HEAD = (
    '<link rel="manifest" href="manifest.webmanifest">\n'
    # iOS ignores the web manifest when a page is added to the home screen; it reads these
    # instead. Its icon must be 180 and opaque: iOS rounds the corners itself and renders any
    # transparency as black.
    '<link rel="apple-touch-icon" sizes="180x180" href="icons/apple-touch-icon.png">\n'
    '<meta name="apple-mobile-web-app-capable" content="yes">\n'
    '<meta name="mobile-web-app-capable" content="yes">\n'
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n'
    '<meta name="apple-mobile-web-app-title" content="فوانيس">\n'
    # Without these a shared link is a bare box in a chat app rather than a card.
    '<meta property="og:type" content="website">\n'
    '<meta property="og:title" content="فوانيس · Fawanees">\n'
    '<meta property="og:description" content="لعبة ضوء وظل اخترعها ذكاء اصطناعي · A game of light and shadow, invented by an AI">\n'
    f'<meta property="og:url" content="{SITE}">\n'
    f'<meta property="og:image" content="{SITE}og.png">\n'
    '<meta property="og:image:width" content="1200">\n'
    '<meta property="og:image:height" content="630">\n'
    '<meta name="twitter:card" content="summary_large_image">'
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
