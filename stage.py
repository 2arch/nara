#!/usr/bin/env python3
"""
stage.py - Random .nara template generator

Generates procedural .nara files with randomized layouts, content, and compositions.
"""

import json
import random
import sys
from datetime import datetime

# Word banks for different content types
ADJECTIVES = [
    "quantum", "neural", "cosmic", "synthetic", "ethereal", "digital",
    "organic", "crystalline", "ambient", "fractal", "temporal", "spatial",
    "kinetic", "radiant", "sublime", "arcane", "prismatic", "infinite"
]

NOUNS = [
    "matrix", "topology", "manifold", "field", "lattice", "network",
    "system", "architecture", "framework", "structure", "membrane", "grid",
    "interface", "protocol", "substrate", "apparatus", "mechanism", "circuit"
]

VERBS = [
    "transform", "synthesize", "modulate", "cascade", "oscillate", "resonate",
    "propagate", "converge", "emerge", "iterate", "evolve", "compose",
    "distribute", "aggregate", "encode", "decode", "transmit", "reflect"
]

TECH_WORDS = [
    "algorithm", "protocol", "bandwidth", "latency", "throughput", "entropy",
    "coherence", "interference", "resonance", "coupling", "gradient", "flux",
    "tensor", "vector", "scalar", "eigen", "fourier", "laplace", "kernel"
]

# Layout presets
LAYOUT_PRESETS = [
    {"name": "poster", "imageWidth": 40, "spacing": {"titleAboveImage": 2, "captionBelowImage": 2, "sidebarFromImage": 4, "footerBelowCaption": 3}},
    {"name": "card", "imageWidth": 30, "spacing": {"titleAboveImage": 1, "captionBelowImage": 1, "sidebarFromImage": 2, "footerBelowCaption": 2}},
    {"name": "banner", "imageWidth": 80, "spacing": {"titleAboveImage": 1, "captionBelowImage": 1, "sidebarFromImage": 3, "footerBelowCaption": 2}},
    {"name": "postcard", "imageWidth": 35, "spacing": {"titleAboveImage": 2, "captionBelowImage": 2, "sidebarFromImage": 3, "footerBelowCaption": 2}},
]

# Image URLs pool
IMAGE_URLS = [
    "https://picsum.photos/400/300",
    "https://picsum.photos/500/400",
    "https://picsum.photos/600/400",
    "https://source.unsplash.com/random/400x300",
    "https://source.unsplash.com/random/500x400",
]


def random_title(word_count=2):
    """Generate a random title"""
    words = []
    for _ in range(word_count):
        if random.choice([True, False]):
            words.append(random.choice(ADJECTIVES))
        else:
            words.append(random.choice(NOUNS))
    return " ".join(words).upper()


def random_dictionary(size=20):
    """Generate random word dictionary"""
    all_words = ADJECTIVES + NOUNS + VERBS + TECH_WORDS
    return random.sample(all_words, min(size, len(all_words)))


def generate_title_region(layout):
    """Generate a title region"""
    return {
        "id": "title",
        "type": "text",
        "position": {
            "x": "startX",
            "y": f"startY - {layout['spacing']['titleAboveImage']}"
        },
        "content": {
            "static": random_title(random.randint(1, 3)),
            "transform": "uppercase" if random.random() > 0.3 else None
        },
        "layout": {
            "alignment": random.choice(["center", "left"]),
            "width": layout["imageWidth"]
        }
    }


def generate_image_region():
    """Generate main image region"""
    return {
        "id": "main-image",
        "type": "image",
        "position": {
            "x": "startX",
            "y": "startY"
        },
        "source": "imageUrl"
    }


def generate_caption_region(layout):
    """Generate caption region"""
    return {
        "id": "caption",
        "type": "text",
        "position": {
            "x": "startX",
            "y": f"startY + imageHeight + {layout['spacing']['captionBelowImage']}"
        },
        "content": {
            "generator": "bogus",
            "wordCount": random.randint(8, 20)
        },
        "layout": {
            "wrap": True,
            "width": layout["imageWidth"]
        }
    }


def generate_sidebar_region(layout):
    """Generate sidebar region"""
    sidebar_width = random.randint(25, 35)

    return {
        "id": "sidebar",
        "type": "composite",
        "position": {
            "x": f"startX + imageWidth + {layout['spacing']['sidebarFromImage']}",
            "y": "startY"
        },
        "components": [
            {
                "id": "sidebar-header",
                "type": "text",
                "position": {"x": "sidebarX", "y": "sidebarStartY"},
                "content": {"static": random.choice(["NOTES", "META", "INFO", "DATA", "CONTEXT"])}
            },
            {
                "id": "sidebar-divider",
                "type": "text",
                "position": {"x": "sidebarX", "y": "sidebarStartY + 1"},
                "content": {"repeat": "─", "count": sidebar_width}
            },
            {
                "id": "sidebar-body",
                "type": "text",
                "position": {"x": "sidebarX", "y": "sidebarStartY + 2"},
                "content": {"generator": "bogus", "wordCount": random.randint(15, 40)},
                "layout": {"wrap": True, "width": sidebar_width}
            }
        ]
    }


def generate_footer_region(layout):
    """Generate footer region"""
    return {
        "id": "footer",
        "type": "text",
        "position": {
            "x": "startX",
            "y": f"startY + imageHeight + {layout['spacing']['captionBelowImage'] + layout['spacing']['footerBelowCaption'] + 2}"
        },
        "content": {
            "generator": "bogus",
            "wordCount": random.randint(1, 3),
            "prefix": "— ",
            "suffix": " —"
        },
        "layout": {
            "alignment": "center",
            "width": layout["imageWidth"]
        }
    }


def generate_label_region():
    """Generate a floating label"""
    offset_x = random.randint(0, 20)
    offset_y = random.randint(-10, 30)

    return {
        "id": f"label-{random.randint(1000, 9999)}",
        "type": "text",
        "position": {
            "x": f"startX + {offset_x}",
            "y": f"startY + {offset_y}"
        },
        "content": {
            "static": random_title(1)
        }
    }


def generate_nara_template(
    name=None,
    include_sidebar=None,
    include_footer=None,
    include_labels=None,
    layout_preset=None
):
    """Generate a complete .nara template"""

    # Random defaults
    if name is None:
        name = f"{random.choice(ADJECTIVES)}-{random.choice(NOUNS)}"

    if include_sidebar is None:
        include_sidebar = random.random() > 0.4

    if include_footer is None:
        include_footer = random.random() > 0.5

    if include_labels is None:
        num_labels = random.randint(0, 3)
        include_labels = num_labels > 0
    else:
        num_labels = random.randint(1, 3) if include_labels else 0

    if layout_preset is None:
        layout = random.choice(LAYOUT_PRESETS)
    else:
        layout = next((l for l in LAYOUT_PRESETS if l["name"] == layout_preset), LAYOUT_PRESETS[0])

    # Build regions
    regions = []

    # Always include title and image
    regions.append(generate_title_region(layout))
    regions.append(generate_image_region())

    # Caption is common
    if random.random() > 0.2:
        regions.append(generate_caption_region(layout))

    # Optional sidebar
    if include_sidebar:
        regions.append(generate_sidebar_region(layout))

    # Optional footer
    if include_footer:
        regions.append(generate_footer_region(layout))

    # Optional floating labels
    for _ in range(num_labels):
        regions.append(generate_label_region())

    # Build template
    template = {
        "version": "1.0.0",
        "type": "stage",
        "name": name,
        "description": f"Procedurally generated {layout['name']} template",
        "parameters": {
            "imageUrl": {
                "type": "string",
                "default": random.choice(IMAGE_URLS),
                "description": "URL of the image to display"
            },
            "cursorPos": {
                "type": "point",
                "description": "Position where the stage will be rendered"
            }
        },
        "layout": {
            "imageWidth": layout["imageWidth"],
            "spacing": layout["spacing"]
        },
        "regions": regions,
        "textGenerator": {
            "name": "bogus",
            "dictionary": random_dictionary(random.randint(15, 25))
        },
        "storage": {
            "text": random.choice(["worldData", "lightModeData"]),
            "images": "stagedImageData",
            "ephemeral": random.choice([True, False]),
            "clearKey": "Escape"
        }
    }

    return template


def generate_batch(count=5, output_dir="./generated-templates"):
    """Generate multiple random templates"""
    import os

    os.makedirs(output_dir, exist_ok=True)

    generated = []
    for i in range(count):
        template = generate_nara_template()
        filename = f"{template['name']}-{i+1}.nara"
        filepath = os.path.join(output_dir, filename)

        with open(filepath, 'w') as f:
            json.dump(template, f, indent=2)

        generated.append(filepath)
        print(f"Generated: {filepath}")

    return generated


def main():
    """CLI interface"""
    import argparse

    parser = argparse.ArgumentParser(description="Generate random .nara template files")
    parser.add_argument('--count', type=int, default=1, help='Number of templates to generate')
    parser.add_argument('--name', type=str, help='Template name (default: random)')
    parser.add_argument('--output', type=str, default='./generated-templates', help='Output directory')
    parser.add_argument('--layout', choices=['poster', 'card', 'banner', 'postcard'], help='Layout preset')
    parser.add_argument('--sidebar', action='store_true', help='Force include sidebar')
    parser.add_argument('--no-sidebar', action='store_true', help='Force exclude sidebar')
    parser.add_argument('--footer', action='store_true', help='Force include footer')
    parser.add_argument('--no-footer', action='store_true', help='Force exclude footer')
    parser.add_argument('--labels', action='store_true', help='Force include floating labels')
    parser.add_argument('--stdout', action='store_true', help='Print to stdout instead of file')

    args = parser.parse_args()

    # Handle sidebar/footer flags
    sidebar = True if args.sidebar else (False if args.no_sidebar else None)
    footer = True if args.footer else (False if args.no_footer else None)
    labels = args.labels if args.labels else None

    if args.stdout:
        # Single template to stdout
        template = generate_nara_template(
            name=args.name,
            include_sidebar=sidebar,
            include_footer=footer,
            include_labels=labels,
            layout_preset=args.layout
        )
        print(json.dumps(template, indent=2))
    else:
        # Batch generation to files
        if args.count == 1 and args.name:
            # Single named template
            template = generate_nara_template(
                name=args.name,
                include_sidebar=sidebar,
                include_footer=footer,
                include_labels=labels,
                layout_preset=args.layout
            )

            import os
            os.makedirs(args.output, exist_ok=True)
            filepath = os.path.join(args.output, f"{args.name}.nara")

            with open(filepath, 'w') as f:
                json.dump(template, f, indent=2)

            print(f"Generated: {filepath}")
        else:
            # Batch generation
            generate_batch(args.count, args.output)


if __name__ == "__main__":
    main()
