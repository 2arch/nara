#!/usr/bin/env python3
"""
Composite individual direction sprites into a sprite sheet compatible with bit.canvas.tsx

Sprite format (consistent sizing):
- Walk: 32×40 frames, 6 columns × 8 rows = 192×320
- Idle: 32×40 frames, 7 columns × 8 rows = 224×320

Direction mapping (row index):
0 = south (down)
1 = south-west
2 = west (left)
3 = north-west
4 = north (up)
5 = north-east
6 = east (right)
7 = south-east
"""

from PIL import Image
import os
import sys

# Configuration
SPRITES_DIR = "public/sprites"
OUTPUT_DIR = "public/sprites"

# Target frame sizes (consistent 32×40 for both walk and idle)
WALK_FRAME_SIZE = (32, 40)
IDLE_FRAME_SIZE = (32, 40)
WALK_FRAMES_PER_DIR = 8
IDLE_FRAMES_PER_DIR = 8

# Direction order (matches row index in sprite sheet)
DIRECTIONS = [
    "south",
    "south-west",
    "west",
    "north-west",
    "north",
    "north-east",
    "east",
    "south-east"
]

def load_and_resize(path, target_size):
    """Load image and resize to fit within target dimensions, preserving aspect ratio."""
    img = Image.open(path).convert("RGBA")

    # Create a transparent canvas of target size
    canvas = Image.new("RGBA", target_size, (0, 0, 0, 0))

    # Calculate scale to fit within target
    scale = min(target_size[0] / img.width, target_size[1] / img.height)
    new_size = (int(img.width * scale), int(img.height * scale))

    # Resize with high quality
    resized = img.resize(new_size, Image.Resampling.LANCZOS)

    # Center on canvas
    x = (target_size[0] - new_size[0]) // 2
    y = (target_size[1] - new_size[1]) // 2
    canvas.paste(resized, (x, y), resized)

    return canvas

def create_spritesheet(sprite_prefix, output_name, frame_size, frames_per_dir):
    """Create a sprite sheet from individual direction sprites."""

    width = frame_size[0] * frames_per_dir
    height = frame_size[1] * 8  # 8 directions

    sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    for row, direction in enumerate(DIRECTIONS):
        sprite_path = f"{SPRITES_DIR}/{sprite_prefix}_{direction}.png"

        if not os.path.exists(sprite_path):
            print(f"Warning: Missing {sprite_path}, using empty frame")
            frame = Image.new("RGBA", frame_size, (0, 0, 0, 0))
        else:
            frame = load_and_resize(sprite_path, frame_size)
            print(f"Loaded {direction} -> row {row}")

        # Repeat the same frame across all columns (static sprite)
        for col in range(frames_per_dir):
            x = col * frame_size[0]
            y = row * frame_size[1]
            sheet.paste(frame, (x, y))

    output_path = f"{OUTPUT_DIR}/{output_name}"
    sheet.save(output_path, "PNG")
    print(f"\nCreated {output_path} ({width}×{height})")
    return output_path

if __name__ == "__main__":
    prefix = sys.argv[1] if len(sys.argv) > 1 else "test"

    print(f"Creating sprite sheets for '{prefix}'...\n")

    # Create walk sheet (static - same frame repeated)
    walk_path = create_spritesheet(prefix, f"{prefix}_walk.png", WALK_FRAME_SIZE, WALK_FRAMES_PER_DIR)

    # Create idle sheet (static - same frame repeated)
    idle_path = create_spritesheet(prefix, f"{prefix}_idle.png", IDLE_FRAME_SIZE, IDLE_FRAMES_PER_DIR)

    print(f"\nDone! Sprite sheets created:")
    print(f"  Walk: {walk_path}")
    print(f"  Idle: {idle_path}")
