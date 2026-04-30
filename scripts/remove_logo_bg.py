from PIL import Image
from pathlib import Path

src = Path('assets/firelands-logo.png')
out = Path('assets/firelands-logo-transparent.png')

if not src.exists():
    raise SystemExit('Missing assets/firelands-logo.png')

img = Image.open(src).convert('RGBA')
px = img.load()
for y in range(img.height):
    for x in range(img.width):
        r, g, b, a = px[x, y]
        if r > 235 and g > 235 and b > 235:
            px[x, y] = (r, g, b, 0)

img.save(out)
print(f'Wrote {out}')
