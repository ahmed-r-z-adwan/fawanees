"""Inline src/engine.js into src/template.html -> dist/fawanees.html (one self-contained file)."""
from pathlib import Path
root = Path(__file__).parent
html = (root / 'src/template.html').read_text(encoding='utf-8')
engine = (root / 'src/engine.js').read_text(encoding='utf-8')
assert '/*ENGINE*/' in html
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist/fawanees.html').write_text(html.replace('/*ENGINE*/', engine), encoding='utf-8')
print('built dist/fawanees.html')
