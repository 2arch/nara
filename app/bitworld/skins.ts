/**
 * Client-side skin effects for post-processing sprite sheets
 * All effects use Canvas API for browser-based image processing
 */

export interface SkinEffectOptions {
  color?: string; // Hex color code for effects that support it (e.g., ghost)
}

export type SkinEffect = (
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  options?: SkinEffectOptions
) => void;

/**
 * Convert hex color to RGB
 * @param hex - Hex color code (e.g., "#ff0000" or "ff0000")
 * @returns RGB object with r, g, b values (0-255)
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  // Remove # if present
  const cleanHex = hex.replace('#', '');

  // Parse hex to RGB
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);

  // Return default white if parsing failed
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return { r: 255, g: 255, b: 255 };
  }

  return { r, g, b };
}

/**
 * Converts sprite sheet to monochrome (grayscale)
 * Uses standard luminosity formula: 0.299*R + 0.587*G + 0.114*B
 */
export const monochromeEffect: SkinEffect = (canvas, ctx) => {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = gray;     // R
    data[i + 1] = gray; // G
    data[i + 2] = gray; // B
    // data[i + 3] is alpha, leave unchanged
  }

  ctx.putImageData(imageData, 0, 0);
};

/**
 * Applies sepia tone effect
 * Creates a warm, vintage photograph appearance
 */
export const sepiaEffect: SkinEffect = (canvas, ctx) => {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    data[i] = Math.min(255, (r * 0.393) + (g * 0.769) + (b * 0.189));     // R
    data[i + 1] = Math.min(255, (r * 0.349) + (g * 0.686) + (b * 0.168)); // G
    data[i + 2] = Math.min(255, (r * 0.272) + (g * 0.534) + (b * 0.131)); // B
  }

  ctx.putImageData(imageData, 0, 0);
};

/**
 * Inverts all colors
 * Each channel becomes 255 - original value
 */
export const invertEffect: SkinEffect = (canvas, ctx) => {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];         // R
    data[i + 1] = 255 - data[i + 1]; // G
    data[i + 2] = 255 - data[i + 2]; // B
    // data[i + 3] is alpha, leave unchanged
  }

  ctx.putImageData(imageData, 0, 0);
};

/**
 * Creates a ghost effect - colored silhouette with full opacity
 * Preserves the shape and flattens to a single solid color
 * @param options.color - Hex color code (default: #ffffff white)
 */
export const ghostEffect: SkinEffect = (canvas, ctx, options) => {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Parse color from hex (default to white)
  const hexColor = options?.color || '#ffffff';
  const ghostColor = hexToRgb(hexColor);

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];

    if (alpha > 0) {
      // Flatten to solid ghost color with full opacity
      data[i] = ghostColor.r;         // R
      data[i + 1] = ghostColor.g;     // G
      data[i + 2] = ghostColor.b;     // B
      data[i + 3] = 255;              // A - Force full opacity
    }
  }

  ctx.putImageData(imageData, 0, 0);
};

/**
 * Named skin presets mapping to effect functions
 */
export const skins: Record<string, SkinEffect> = {
  monochrome: monochromeEffect,
  sepia: sepiaEffect,
  invert: invertEffect,
  ghost: ghostEffect,
};

/**
 * Get a skin effect by name
 */
export function getSkin(skinName: string): SkinEffect | undefined {
  return skins[skinName.toLowerCase()];
}

/**
 * Apply a named skin to an image
 * @param imageUrl - URL or data URL of the image to process
 * @param skinName - Name of the effect to apply
 * @param options - Optional parameters for the effect (e.g., color for ghost effect)
 * @returns Promise resolving to a data URL of the processed image
 */
export async function applySkin(
  imageUrl: string,
  skinName: string,
  options?: SkinEffectOptions
): Promise<string> {
  const skinEffect = getSkin(skinName);
  if (!skinEffect) {
    throw new Error(`Unknown skin: ${skinName}`);
  }

  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Draw image
        ctx.drawImage(img, 0, 0);

        // Apply effect with options
        skinEffect(canvas, ctx, options);

        // Convert to data URL
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageUrl;
  });
}

/**
 * Get list of available effect names
 */
export function getAvailableEffects(): string[] {
  return Object.keys(skins);
}
