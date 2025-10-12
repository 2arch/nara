# stage.py - Random .nara Template Generator

Python script that procedurally generates `.nara` template files with randomized layouts, content, and compositions.

## Quick Start

```bash
# Generate 5 random templates
python3 stage.py --count 5

# Generate single template with specific name
python3 stage.py --name "my-template" --layout poster --sidebar

# Preview template to stdout (no file)
python3 stage.py --stdout

# Generate 10 templates to custom directory
python3 stage.py --count 10 --output ./my-templates
```

## Usage

```
python3 stage.py [options]

Options:
  --count COUNT            Number of templates to generate (default: 1)
  --name NAME             Template name (default: random)
  --output OUTPUT         Output directory (default: ./generated-templates)
  --layout PRESET         Layout preset: poster, card, banner, postcard
  --sidebar               Force include sidebar
  --no-sidebar            Force exclude sidebar
  --footer                Force include footer
  --no-footer             Force exclude footer
  --labels                Force include floating labels
  --stdout                Print to stdout instead of saving file
```

## What Gets Randomized

**Layout:**
- Preset type (poster/card/banner/postcard)
- Image width (30-80 chars)
- Spacing values (1-4 chars)

**Content:**
- Title text (1-3 random words from tech vocabulary)
- Caption word count (8-20 words)
- Dictionary size (15-25 words)
- Sidebar word count (15-40 words)
- Footer word count (1-3 words)

**Structure:**
- Sidebar presence (60% chance)
- Footer presence (50% chance)
- Floating labels (0-3 labels)
- Text alignment (center/left)
- Text transforms (uppercase)

**Data:**
- Image URL (random from preset pool)
- Storage location (worldData/lightModeData)
- Ephemeral mode (true/false)

## Word Banks

The generator uses curated word banks for coherent output:

- **Adjectives:** quantum, neural, cosmic, synthetic, ethereal, digital...
- **Nouns:** matrix, topology, manifold, field, lattice, network...
- **Verbs:** transform, synthesize, modulate, cascade, oscillate...
- **Tech:** algorithm, protocol, bandwidth, latency, entropy...

## Examples

```bash
# Minimal card layout without sidebar
python3 stage.py --name minimal --layout card --no-sidebar --no-footer

# Large banner with all features
python3 stage.py --name maximal --layout banner --sidebar --footer --labels

# Batch generate 20 varied templates
python3 stage.py --count 20

# Generate and pipe to jq for inspection
python3 stage.py --stdout | jq '.regions[] | .id'
```

## Generated File Structure

```json
{
  "version": "1.0.0",
  "type": "stage",
  "name": "radiant-network",
  "description": "Procedurally generated poster template",
  "parameters": { "imageUrl": {...} },
  "layout": { "imageWidth": 40, "spacing": {...} },
  "regions": [
    { "id": "title", "type": "text", ... },
    { "id": "main-image", "type": "image", ... },
    { "id": "caption", "type": "text", ... },
    { "id": "sidebar", "type": "composite", ... }
  ],
  "textGenerator": { "dictionary": [...] },
  "storage": { "text": "worldData", ... }
}
```

## Use in Nara

```bash
# Generate templates
python3 stage.py --count 10

# In Nara app, load template:
/stage --up

# Pick any .nara file from generated-templates/
```

## Integration Ideas

**Batch testing:**
```bash
# Generate 100 templates to stress-test parser
python3 stage.py --count 100 --output test-templates
```

**Preset collections:**
```bash
# Generate themed sets
for layout in poster card banner postcard; do
  python3 stage.py --count 5 --layout $layout --output "templates-${layout}"
done
```

**Pipeline processing:**
```bash
# Generate → validate → filter
python3 stage.py --stdout | jq '.regions | length' # Count regions
```

## Architecture

- **Procedural generation** - every run creates unique layouts
- **Constraint-based** - follows `.nara` format spec exactly
- **Composable** - regions can be mixed and matched
- **Safe by design** - only generates valid expressions (`startX + N`)
- **No dependencies** - pure Python 3 stdlib

## Extension

To add new generators, edit these functions in `stage.py`:

```python
def generate_custom_region(layout):
    """Your custom region generator"""
    return {
        "id": "custom",
        "type": "text",
        "position": {"x": "startX", "y": "startY"},
        "content": {"static": "CUSTOM"}
    }

# Then add to generate_nara_template():
regions.append(generate_custom_region(layout))
```
