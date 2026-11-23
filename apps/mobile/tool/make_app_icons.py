"""Builds the Chicman app icons (Android, iOS, Flutter web) from the brand
wordmark, the only brand master. Run from apps/mobile after changing it:

    python3 tool/make_app_icons.py .

Needs Pillow (pip install pillow)."""
import json, os, sys
from PIL import Image

root = sys.argv[1]  # apps/mobile
src = Image.open(os.path.join(root, '../../packages/design-tokens/brand/chicman-wordmark.png')).convert('RGBA')
mark = src.crop(src.getchannel('A').getbbox())

def icon(size, width_ratio, background=(255, 255, 255, 255), color=None):
    big = size * 4
    canvas = Image.new('RGBA', (big, big), background)
    w = round(big * width_ratio)
    h = round(w * mark.height / mark.width)
    m = mark.resize((w, h), Image.LANCZOS)
    if color is not None:
        solid = Image.new('RGBA', m.size, color)
        solid.putalpha(m.getchannel('A'))
        m = solid
    canvas.alpha_composite(m, ((big - w) // 2, (big - h) // 2))
    return canvas.resize((size, size), Image.LANCZOS)

res = os.path.join(root, 'android/app/src/main/res')
densities = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for name, scale in densities.items():
    d = os.path.join(res, f'mipmap-{name}')
    # Legacy square icon (before Android 8): white, wordmark across the middle.
    icon(round(48 * scale), 0.78).convert('RGB').save(os.path.join(d, 'ic_launcher.png'), optimize=True)
    # Adaptive layers (108 dp): the wordmark stays inside the 66 dp safe zone.
    fg = icon(round(108 * scale), 0.58, background=(0, 0, 0, 0))
    fg.save(os.path.join(d, 'ic_launcher_foreground.png'), optimize=True)
    # Android 13 themed icons use only this layer's alpha.
    fg.save(os.path.join(d, 'ic_launcher_monochrome.png'), optimize=True)

os.makedirs(os.path.join(res, 'mipmap-anydpi-v26'), exist_ok=True)
open(os.path.join(res, 'mipmap-anydpi-v26/ic_launcher.xml'), 'w').write('''<?xml version="1.0" encoding="utf-8"?>
<!-- Chicman launcher icon (Android 8+): white background, wordmark foreground.
     Generated from packages/design-tokens/brand/chicman-wordmark.png. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
''')
open(os.path.join(res, 'values/ic_launcher_background.xml'), 'w').write('''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#FFFFFF</color>
</resources>
''')

# iOS: opaque squares (iOS rounds the corners itself).
ios = os.path.join(root, 'ios/Runner/Assets.xcassets/AppIcon.appiconset')
for image in json.load(open(os.path.join(ios, 'Contents.json')))['images']:
    base = float(image['size'].split('x')[0])
    scale = float(image['scale'].rstrip('x'))
    icon(round(base * scale), 0.78).convert('RGB').save(os.path.join(ios, image['filename']), optimize=True)

# Flutter web build (apps/mobile/web): regular and maskable icons.
web = os.path.join(root, 'web')
for n in (192, 512):
    icon(n, 0.78).convert('RGB').save(os.path.join(web, f'icons/Icon-{n}.png'), optimize=True)
    icon(n, 0.62).convert('RGB').save(os.path.join(web, f'icons/Icon-maskable-{n}.png'), optimize=True)
icon(32, 0.86).convert('RGB').save(os.path.join(web, 'favicon.png'), optimize=True)
print('done')
