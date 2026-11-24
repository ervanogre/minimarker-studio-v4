import os
from PIL import Image
sizes = {"mipmap-mdpi": 48, "mipmap-hdpi": 72, "mipmap-xhdpi": 96, "mipmap-xxhdpi": 144, "mipmap-xxxhdpi": 192}
fg_sizes = {"mipmap-mdpi": 108, "mipmap-hdpi": 162, "mipmap-xhdpi": 216, "mipmap-xxhdpi": 324, "mipmap-xxxhdpi": 432}
base = Image.open("assets/icon-only.png").convert("RGBA")
fg = Image.open("assets/icon-foreground.png").convert("RGBA")
res_dir = "android/app/src/main/res"
if os.path.isdir(res_dir):
    for folder, px in sizes.items():
        d = os.path.join(res_dir, folder)
        os.makedirs(d, exist_ok=True)
        base.resize((px, px), Image.LANCZOS).save(os.path.join(d, "ic_launcher.png"))
        base.resize((px, px), Image.LANCZOS).save(os.path.join(d, "ic_launcher_round.png"))
    for folder, px in fg_sizes.items():
        d = os.path.join(res_dir, folder)
        os.makedirs(d, exist_ok=True)
        fg.resize((px, px), Image.LANCZOS).save(os.path.join(d, "ic_launcher_foreground.png"))
    print("ANDROID MIPMAP ICONS UPDATED!")
