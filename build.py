"""Build the single self-contained page, and the installable copy under pwa/.

dist/fawanees.html  one file, opens from disk or from any web host.
pwa/                the same page plus a manifest and a service worker, for GitHub Pages.
"""
import hashlib
import re
import shutil
from pathlib import Path

root = Path(__file__).parent


def read(rel):
    return (root / rel).read_text(encoding='utf-8')


def build_page():
    html = read('src/template.html')
    for marker, source in (('/*ENGINE*/', 'src/engine.js'),
                           ('/*WORKER*/', 'src/worker.js'),
                           ('/*CALIBRATION*/', 'src/calibration.js'),
                           ('/*OPENING*/', 'src/opening.js')):
        assert marker in html, f'{marker} missing from src/template.html'
        text = read(source)
        # The worker and tutorial sources live inside <script> elements and are also read back as
        # text, so a literal closing tag inside them would end the element early.
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
        (pwa / 'index.html').write_text(html, encoding='utf-8')
        # The service worker caches by version, so bump it whenever the page changes.
        digest = hashlib.sha256(html.encode('utf-8')).hexdigest()[:12]
        sw = (pwa / 'sw.js').read_text(encoding='utf-8')
        sw = re.sub(r"const VERSION = '[^']*'", f"const VERSION = '{digest}'", sw, count=1)
        (pwa / 'sw.js').write_text(sw, encoding='utf-8')
        print(f'built pwa/index.html (cache version {digest})')


if __name__ == '__main__':
    main()
