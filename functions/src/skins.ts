import sharp from "sharp";

/**
 * Skin effects for post-processing sprite sheets
 * Each effect takes a PNG buffer and returns a processed PNG buffer
 */

export type SkinEffect = (imageBuffer: Buffer) => Promise<Buffer>;

/**
 * Converts sprite sheet to monochrome (grayscale)
 */
export const monochromeEffect: SkinEffect = async (imageBuffer: Buffer): Promise<Buffer> => {
    return sharp(imageBuffer)
        .grayscale()
        .png()
        .toBuffer();
};

/**
 * Apply multiple effects in sequence
 */
export const compositeEffects = async (
    imageBuffer: Buffer,
    effects: SkinEffect[]
): Promise<Buffer> => {
    let result = imageBuffer;
    for (const effect of effects) {
        result = await effect(result);
    }
    return result;
};

/**
 * Named skin presets
 */
export const skins: Record<string, SkinEffect[]> = {
    monochrome: [monochromeEffect],
    // Future skins can be added here:
    // sepia: [sepiaEffect],
    // inverted: [invertEffect],
    // pixelated: [pixelateEffect],
};

/**
 * Get a skin by name
 */
export function getSkin(skinName: string): SkinEffect[] | undefined {
    return skins[skinName.toLowerCase()];
}

/**
 * Apply a named skin to an image buffer
 */
export async function applySkin(
    imageBuffer: Buffer,
    skinName: string
): Promise<Buffer> {
    const skinEffects = getSkin(skinName);
    if (!skinEffects) {
        throw new Error(`Unknown skin: ${skinName}`);
    }
    return compositeEffects(imageBuffer, skinEffects);
}
