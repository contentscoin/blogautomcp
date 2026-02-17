#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import List, Tuple

from PIL import Image, ImageDraw, ImageFont, ImageOps

CANVAS_SIZE = (1080, 1080)
LEFT_MARGIN = 88
RIGHT_MARGIN = 72
TEXT_MAX_WIDTH = CANVAS_SIZE[0] - LEFT_MARGIN - RIGHT_MARGIN
TEXT_DOWN_PX = int(os.getenv("THUMBNAIL_TEXT_DOWN_PX", "24"))


def sanitize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def load_font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
        "/System/Library/Fonts/Supplemental/NotoSansGothic-Regular.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    ]
    for font_path in candidates:
        if os.path.exists(font_path):
            return ImageFont.truetype(font_path, size)
    return ImageFont.load_default()


def fit_cover(path: Path, target_size: Tuple[int, int]) -> Image.Image:
    base = Image.open(path).convert("RGB")
    return ImageOps.fit(
        base,
        target_size,
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    ).convert("RGBA")


def add_bottom_gradient(image: Image.Image) -> Image.Image:
    width, height = image.size
    alpha = Image.new("L", (1, height), 0)

    start = int(height * 0.56)
    for y in range(height):
        if y < start:
            value = 0
        else:
            value = int(min(228, (y - start) * 1.08))
        alpha.putpixel((0, y), value)

    alpha = alpha.resize((width, height))
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    overlay.putalpha(alpha)
    return Image.alpha_composite(image, overlay)


def wrap_text_by_char(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    max_width: int,
) -> List[str]:
    text = sanitize_text(text)
    if not text:
        return []

    lines: List[str] = []
    current = ""
    for ch in text:
        test = f"{current}{ch}"
        if current and draw.textlength(test, font=font) > max_width:
            lines.append(current)
            current = ch
        else:
            current = test

    if current:
        lines.append(current)

    return lines


def wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    max_width: int,
) -> List[str]:
    text = sanitize_text(text)
    if not text:
        return []

    words = text.split(" ")
    if len(words) <= 1:
        return wrap_text_by_char(draw, text, font, max_width)

    lines: List[str] = []
    current = ""

    for word in words:
        test = word if not current else f"{current} {word}"
        if current and draw.textlength(test, font=font) > max_width:
            lines.append(current)
            if draw.textlength(word, font=font) > max_width:
                split_lines = wrap_text_by_char(draw, word, font, max_width)
                if split_lines:
                    lines.extend(split_lines[:-1])
                    current = split_lines[-1]
                else:
                    current = word
            else:
                current = word
        else:
            current = test

    if current:
        lines.append(current)

    return lines


def fit_headline(
    draw: ImageDraw.ImageDraw,
    headline: str,
    max_width: int,
) -> Tuple[ImageFont.FreeTypeFont, List[str]]:
    size = 88
    while size >= 62:
        font = load_font(size)
        lines = wrap_text(draw, headline, font, max_width)
        if not lines:
            return font, ["추천 제품 리뷰"]

        if len(lines) <= 2 and max(draw.textlength(line, font=font) for line in lines) <= max_width:
            return font, lines

        if len(lines) > 2:
            lines = lines[:2]
            if max(draw.textlength(line, font=font) for line in lines) <= max_width:
                return font, lines

        size -= 2

    font = load_font(62)
    lines = wrap_text(draw, headline, font, max_width)
    return font, (lines[:2] if lines else ["추천 제품 리뷰"])


def fit_subline(
    draw: ImageDraw.ImageDraw,
    subline: str,
    max_width: int,
) -> ImageFont.FreeTypeFont:
    size = 66
    while size >= 42:
        font = load_font(size)
        if draw.textlength(subline, font=font) <= max_width:
            return font
        size -= 1
    return load_font(42)


def render_bottom_text(canvas: Image.Image, headline: str, subline: str) -> None:
    draw = ImageDraw.Draw(canvas)

    clean_headline = sanitize_text(headline) or "추천 제품 리뷰"
    clean_subline = sanitize_text(subline)

    headline_font, headline_lines = fit_headline(draw, clean_headline, TEXT_MAX_WIDTH)
    subline_font = fit_subline(draw, clean_subline, TEXT_MAX_WIDTH) if clean_subline else load_font(52)

    line_heights: List[int] = []
    for line in headline_lines:
        bbox = draw.textbbox((LEFT_MARGIN, 0), line, font=headline_font, stroke_width=2)
        line_heights.append(bbox[3] - bbox[1])

    headline_block_h = sum(line_heights) + max(0, (len(headline_lines) - 1) * 8)
    subline_h = 0
    if clean_subline:
        sb = draw.textbbox((LEFT_MARGIN, 0), clean_subline, font=subline_font, stroke_width=2)
        subline_h = sb[3] - sb[1]

    block_h = headline_block_h + (16 if clean_subline else 0) + subline_h
    start_y = int(canvas.height * 0.70) + TEXT_DOWN_PX

    max_y = canvas.height - block_h - 64
    start_y = min(start_y, max_y)
    start_y = max(int(canvas.height * 0.60), start_y)

    y = start_y
    for idx, line in enumerate(headline_lines):
        draw.text(
            (LEFT_MARGIN, y),
            line,
            font=headline_font,
            fill=(250, 250, 250, 250),
            stroke_width=2,
            stroke_fill=(0, 0, 0, 195),
        )
        y += line_heights[idx] + 8

    if clean_subline:
        y += 8
        draw.text(
            (LEFT_MARGIN, y),
            clean_subline,
            font=subline_font,
            fill=(236, 236, 236, 245),
            stroke_width=2,
            stroke_fill=(0, 0, 0, 170),
        )
        sub_bbox = draw.textbbox((LEFT_MARGIN, y), clean_subline, font=subline_font, stroke_width=2)
        block_bottom = sub_bbox[3]
    else:
        block_bottom = y

    bar_x = 56
    bar_w = 12
    bar_top = start_y + 6
    bar_bottom = block_bottom - 4
    draw.rounded_rectangle(
        (bar_x, bar_top, bar_x + bar_w, bar_bottom),
        radius=7,
        fill=(58, 160, 255, 255),
    )


def compose_thumbnail(background_path: Path, headline: str, subline: str, output_path: Path) -> None:
    canvas = fit_cover(background_path, CANVAS_SIZE)
    canvas = add_bottom_gradient(canvas)
    render_bottom_text(canvas, headline=headline, subline=subline)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output_path, quality=95)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate bottom-text thumbnail")
    parser.add_argument("--background", required=True, help="Background image path")
    parser.add_argument("--image", action="append", default=[], help="Unused (compat)")
    parser.add_argument("--headline", required=True, help="Headline text")
    parser.add_argument("--subline", default="", help="Subline text")
    parser.add_argument("--output", required=True, help="Output image path")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    bg_path = Path(args.background)
    output_path = Path(args.output)

    if not bg_path.exists():
        print(json.dumps({"ok": False, "error": f"background not found: {bg_path}"}))
        return 1

    try:
        compose_thumbnail(
            background_path=bg_path,
            headline=sanitize_text(args.headline),
            subline=sanitize_text(args.subline),
            output_path=output_path,
        )
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1

    print(
        json.dumps(
            {
                "ok": True,
                "output": str(output_path),
                "used_cutout": False,
                "cutout_source": None,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
