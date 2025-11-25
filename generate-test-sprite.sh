#!/bin/bash
# Generate 8-direction sprite from base image

API_KEY="9bb378e0-6b46-442d-9019-96216f8e8ba7"
SPRITES_DIR="/home/ubuntu/nara/public/sprites"
BASE_IMG="$SPRITES_DIR/test_base.png"

# Get base64 of source image
IMG_B64=$(base64 -w 0 "$BASE_IMG")

# Directions to generate
DIRECTIONS=("south" "south-east" "east" "north-east" "north" "north-west" "west" "south-west")

echo "Generating 8 directions from base image..."

for dir in "${DIRECTIONS[@]}"; do
    echo "Generating $dir..."

    RESPONSE=$(curl -s -X POST "https://api.pixellab.ai/v1/rotate" \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"from_image\": {\"type\": \"base64\", \"base64\": \"$IMG_B64\"}, \"image_size\": {\"width\": 64, \"height\": 64}, \"from_direction\": \"south\", \"to_direction\": \"$dir\"}")

    echo "$RESPONSE" | jq -r '.image.base64' 2>/dev/null | base64 -d > "$SPRITES_DIR/test_${dir}.png"

    if file "$SPRITES_DIR/test_${dir}.png" | grep -q "PNG"; then
        echo "  ✓ Saved test_${dir}.png"
    else
        echo "  ✗ Failed to generate $dir"
        echo "$RESPONSE" | head -c 200
    fi
done

echo "Done! Generated files:"
ls -la "$SPRITES_DIR"/test_*.png
