#!/usr/bin/env python3
import os
import subprocess
from PIL import Image, ImageDraw, ImageFont

def get_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        try:
            return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", size)
        except Exception:
            return ImageFont.load_default()

def create_dmg_background(output_dir):
    # 2x resolution: 1320 x 900 (scaled to 660 x 450)
    w, h = 1320, 900
    img = Image.new("RGBA", (w, h), (22, 21, 25, 255))
    draw = ImageDraw.Draw(img)

    # Vertical gradient
    for y in range(h):
        r = int(22 + (14 * y / h))
        g = int(21 + (8 * y / h))
        b = int(25 + (12 * y / h))
        draw.line([(0, y), (w, y)], fill=(r, g, b, 255))

    # Ambient subtle glow behind icons
    for radius in range(260, 0, -10):
        alpha = int(16 * (1 - radius / 260))
        draw.ellipse([(660 - radius, 300 - radius), (660 + radius, 300 + radius)], fill=(228, 79, 79, alpha))

    # Stylized arrow pointing from Framezoo (x=340, y=300) to Applications (x=980, y=300)
    arrow_color = (255, 110, 110, 220)
    draw.line([(520, 300), (760, 300)], fill=arrow_color, width=10)
    draw.polygon([(750, 272), (795, 300), (750, 328)], fill=arrow_color)

    font_badge = get_font("/System/Library/Fonts/Supplemental/Arial.ttf", 26)
    font_bold = get_font("/System/Library/Fonts/Supplemental/Arial.ttf", 26)
    font_small = get_font("/System/Library/Fonts/Supplemental/Arial.ttf", 22)

    # Label under arrow
    arrow_label = "Kéo Framezoo vào thư mục Applications / Drag to Applications"
    bbox = draw.textbbox((0, 0), arrow_label, font=font_badge)
    label_w = bbox[2] - bbox[0]
    draw.text(((w - label_w) // 2, 332), arrow_label, fill=(200, 200, 210, 255), font=font_badge)

    # Instruction container for the bottom text files (y=530 to 830)
    card_margin = 120
    card_top = 510
    card_bottom = 820
    draw.rounded_rectangle(
        [(card_margin, card_top), (w - card_margin, card_bottom)],
        radius=22,
        fill=(32, 29, 36, 210),
        outline=(228, 79, 79, 80),
        width=2
    )

    # Card title pointing to files
    title_text = "HƯỚNG DẪN MỞ APP & VƯỢT QUA CẢNH BÁO GATEKEEPER"
    bbox = draw.textbbox((0, 0), title_text, font=font_bold)
    tw = bbox[2] - bbox[0]
    draw.text(((w - tw) // 2, card_top + 26), title_text, fill=(255, 150, 150, 255), font=font_bold)

    # Subtitle pointing to the 2 icons below
    sub_text = "Nhấp đúp mở file văn bản bên dưới để đọc & copy câu lệnh mở khóa:"
    bbox = draw.textbbox((0, 0), sub_text, font=font_small)
    sw = bbox[2] - bbox[0]
    draw.text(((w - sw) // 2, card_top + 62), sub_text, fill=(185, 185, 195, 255), font=font_small)

    # Target indicator boxes for the 2 files at y=640 (1x: 320)
    # File 1: HUONG_DAN_CAI_DAT.txt at (x=500, y=640)
    # File 2: Huong-Dan-Online.webloc at (x=820, y=640)
    draw.rounded_rectangle([(410, 560), (590, 780)], radius=14, outline=(255, 255, 255, 30), width=1)
    draw.rounded_rectangle([(730, 560), (910, 780)], radius=14, outline=(255, 255, 255, 30), width=1)

    # Save 2x PNG
    img_2x_path = os.path.join(output_dir, "dmg-background@2x.png")
    img.save(img_2x_path, "PNG")
    print(f"Created {img_2x_path} (1320x900)")

    # Downscale for 1x PNG (660 x 450)
    img_1x = img.resize((660, 450), Image.Resampling.LANCZOS)
    img_1x_path = os.path.join(output_dir, "dmg-background.png")
    img_1x.save(img_1x_path, "PNG")
    print(f"Created {img_1x_path} (660x450)")

    # Create multi-resolution background.tiff via tiffutil if available
    tiff_path = os.path.join(output_dir, "background.tiff")
    try:
        subprocess.run(
            ["tiffutil", "-cathidpicheck", img_1x_path, img_2x_path, "-out", tiff_path],
            check=True,
            capture_output=True
        )
        print(f"Created {tiff_path} via tiffutil (HiDPI multi-resolution TIFF)")
    except Exception as e:
        print(f"tiffutil not run or skipped: {e}")

def create_nsis_sidebar(output_dir, icon_path):
    # NSIS Sidebar: 164 x 314 24-bit BMP
    w, h = 164, 314
    img = Image.new("RGB", (w, h), (26, 24, 30))
    draw = ImageDraw.Draw(img)

    # Vertical gradient
    for y in range(h):
        r = int(24 + 18 * (y / h))
        g = int(22 + 10 * (y / h))
        b = int(28 + 14 * (y / h))
        draw.line([(0, y), (w, y)], fill=(r, g, b))

    # Red coral accent stripe at top
    draw.rectangle([(0, 0), (w, 4)], fill=(228, 79, 79))

    # Add icon if available
    if os.path.exists(icon_path):
        icon = Image.open(icon_path).convert("RGBA")
        icon = icon.resize((56, 56), Image.Resampling.LANCZOS)
        img.paste(icon, ((w - 56) // 2, 22), icon)

    font_title = get_font("/System/Library/Fonts/Supplemental/Arial.ttf", 15)
    font_bold = get_font("/System/Library/Fonts/Supplemental/Arial.ttf", 11)
    font_small = get_font("/System/Library/Fonts/Supplemental/Arial.ttf", 10)
    font_tiny = get_font("/System/Library/Fonts/Supplemental/Arial.ttf", 9)

    # Title "Framezoo"
    draw.text(((w - 68) // 2, 86), "Framezoo", fill=(255, 255, 255), font=font_title)

    # SmartScreen Guide Box (y=120 to 260)
    draw.rounded_rectangle([(8, 118), (w - 8, 275)], radius=6, fill=(38, 34, 44), outline=(228, 79, 79))

    draw.text((14, 126), "SmartScreen Guide:", fill=(255, 140, 140), font=font_bold)
    draw.text((14, 146), "Neu gap man hinh", fill=(220, 220, 220), font=font_small)
    draw.text((14, 160), "'Windows protected PC'", fill=(255, 200, 100), font=font_small)
    draw.text((14, 180), "1. Bam 'More info'", fill=(255, 255, 255), font=font_bold)
    draw.text((14, 200), "2. Bam 'Run anyway'", fill=(255, 255, 255), font=font_bold)
    draw.text((14, 226), "App safe & verified", fill=(130, 220, 150), font=font_tiny)
    draw.text((14, 244), "An toan & sach se", fill=(180, 180, 190), font=font_tiny)

    # Footer note
    draw.text((12, 290), "framezoo.top", fill=(140, 140, 155), font=font_tiny)

    out_path = os.path.join(output_dir, "installerSidebar.bmp")
    img.save(out_path, "BMP")
    print(f"Created {out_path} (164x314 BMP)")

def create_nsis_header(output_dir, icon_path):
    # NSIS Header: 150 x 57 24-bit BMP
    w, h = 150, 57
    img = Image.new("RGB", (w, h), (32, 29, 36))
    draw = ImageDraw.Draw(img)

    for y in range(h):
        r = int(28 + 8 * (y / h))
        g = int(26 + 6 * (y / h))
        b = int(32 + 8 * (y / h))
        draw.line([(0, y), (w, y)], fill=(r, g, b))

    # Add icon on right
    if os.path.exists(icon_path):
        icon = Image.open(icon_path).convert("RGBA")
        icon = icon.resize((40, 40), Image.Resampling.LANCZOS)
        img.paste(icon, (w - 48, (h - 40) // 2), icon)

    font_title = get_font("/System/Library/Fonts/Supplemental/Arial.ttf", 13)
    font_sub = get_font("/System/Library/Fonts/Supplemental/Arial.ttf", 9)

    draw.text((10, 12), "Framezoo Setup", fill=(255, 255, 255), font=font_title)
    draw.text((10, 32), "SmartScreen: Run anyway", fill=(255, 140, 140), font=font_sub)

    out_path = os.path.join(output_dir, "installerHeader.bmp")
    img.save(out_path, "BMP")
    print(f"Created {out_path} (150x57 BMP)")

if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    build_dir = os.path.join(project_dir, "build")
    icon_path = os.path.join(build_dir, "icon.png")

    os.makedirs(build_dir, exist_ok=True)
    create_dmg_background(build_dir)
    create_nsis_sidebar(build_dir, icon_path)
    create_nsis_header(build_dir, icon_path)
