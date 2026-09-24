"""Adds or removes the puzzle-mode wiring in src/template.html and build.py.

    python test/tools/puzzlewiring.py on|off

Puzzle mode is a self-contained feature: its data, its UI module and the handful of lines that
hang it off the page. Keeping the wiring reversible means the feature can be landed as one commit
instead of being smeared across the page's history.
"""
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]

PAIRS = [
    # (without puzzle mode, with puzzle mode)
    ("<script>\n/*LESSONS*/\n</script>",
     "<script>\n/*LESSONS*/\n</script>\n<script>\n/*PUZZLES*/\n</script>"),
    ("/*TUTORIAL*/\n\ndrawIcons();",
     "/*TUTORIAL*/\n\n/*PUZZLEUI*/\n\ndrawIcons();"),
    ('<button class="btn" id="btnLearn" data-i18n="learn">تعلّم</button>',
     '<button class="btn" id="btnLearn" data-i18n="learn">تعلّم</button>\n'
     '      <button class="btn" id="btnPuzzle" data-i18n="puzzles">ألغاز</button>'),
    ("learn: 'تعلّم', rules: 'القواعد',", "learn: 'تعلّم', puzzles: 'ألغاز', rules: 'القواعد',"),
    ("learn: 'Learn', rules: 'Rules',", "learn: 'Learn', puzzles: 'Puzzles', rules: 'Rules',"),
    ("canvas#learnBoard { width: 100%; aspect-ratio: 11 / 12;",
     "canvas#learnBoard, canvas#puzzleBoard { width: 100%; aspect-ratio: 11 / 12;"),
    ("document.getElementById('btnLearn').onclick = () => Tutorial.open(0);",
     "document.getElementById('btnLearn').onclick = () => Tutorial.open(0);\n"
     "document.getElementById('btnPuzzle').onclick = () => Puzzles.open();"),
    ("  if (typeof Tutorial !== 'undefined') Tutorial.relabel();",
     "  if (typeof Tutorial !== 'undefined') Tutorial.relabel();\n"
     "  if (typeof Puzzles !== 'undefined') Puzzles.relabel();"),
    ("  tutorial: () => Tutorial,", "  tutorial: () => Tutorial,\n  puzzles: () => Puzzles,"),
]

DIALOG = '''<dialog id="dlgPuzzle" class="learn">
  <div class="learn-head">
    <div>
      <div class="learn-step" id="puzzleStep"></div>
      <h2 data-i18n="puzzles">ألغاز</h2>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <span class="learn-step" id="puzzleCount"></span>
      <button class="btn" id="puzzleClose" data-close>إغلاق</button>
    </div>
  </div>
  <div class="learn-grid">
    <div class="learn-boardwrap"><canvas id="puzzleBoard"></canvas></div>
    <div class="learn-text">
      <div id="puzzleBody"></div>
      <div class="learn-note" id="puzzleNote"></div>
      <div class="dialog-actions">
        <button class="btn" id="puzzleBack">السابق</button>
        <button class="btn" id="puzzleHint">تلميح</button>
        <button class="btn primary" id="puzzleNext">اللغز التالي</button>
      </div>
    </div>
  </div>
</dialog>

'''

BUILD = ("    ('/*LESSONS*/', 'src/lessons.js'),",
         "    ('/*LESSONS*/', 'src/lessons.js'),\n"
         "    ('/*PUZZLES*/', 'src/puzzles.js'),\n"
         "    ('/*PUZZLEUI*/', 'src/puzzleui.js'),")


def apply(on):
    t = root / 'src/template.html'
    s = t.read_text(encoding='utf-8')
    for off, onv in PAIRS:
        src, dst = (off, onv) if on else (onv, off)
        assert src in s, f'not found: {src[:50]!r}'
        s = s.replace(src, dst, 1)
    if on:
        assert DIALOG not in s
        s = s.replace('<dialog id="dlgRules">', DIALOG + '<dialog id="dlgRules">', 1)
    else:
        assert DIALOG in s
        s = s.replace(DIALOG, '', 1)
    t.write_text(s, encoding='utf-8')

    b = root / 'build.py'
    bs = b.read_text(encoding='utf-8')
    src, dst = (BUILD[0], BUILD[1]) if on else (BUILD[1], BUILD[0])
    assert src in bs
    b.write_text(bs.replace(src, dst, 1), encoding='utf-8')
    print(('added' if on else 'removed') + ' the puzzle-mode wiring')


if __name__ == '__main__':
    apply(sys.argv[1] == 'on')
