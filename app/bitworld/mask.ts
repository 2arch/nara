/**
 * mask.ts - Face mask definitions and utilities
 *
 * This module handles the robust calculations and mappings of different face styles
 * for the face3d monogram system. Each mask defines a collection of features that
 * can be rendered with dynamic properties (eye blinks, mouth movement, etc.)
 */

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * A single feature (eye, nose, mouth, etc.) in face coordinate space
 */
export interface FaceFeature {
    cx: number;      // center x position
    cy: number;      // center y position (base position, may be modulated)
    cz: number;      // center z position (for 3D depth)
    width: number;   // feature width
    height: number;  // feature height (base, may be modulated)
    type: string;    // feature identifier (e.g., 'leftEye', 'mouth')
}

/**
 * Dynamic properties that can affect feature rendering
 */
export interface FaceDynamics {
    leftEyeBlink?: number;   // 0=open, 1=closed
    rightEyeBlink?: number;  // 0=open, 1=closed
    mouthOpen?: number;      // 0=closed, 1=fully open
    eyebrowRaise?: number;   // 0=neutral, 1=raised
}

/**
 * Bounding box in face coordinate space
 */
export interface FaceBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    width: number;
    height: number;
}

/**
 * A complete face mask definition
 */
export interface Mask {
    name: string;
    description: string;
    baseFeatures: FaceFeature[];

    // Function to get features with dynamic properties applied
    getFeaturesWithDynamics: (dynamics: FaceDynamics) => FaceFeature[];

    // Calculate bounding box accounting for maximum dynamic range
    getBounds: (dynamics?: FaceDynamics) => FaceBounds;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate bounding box from a set of features
 */
export function calculateBounds(features: FaceFeature[]): FaceBounds {
    const bounds = features.reduce(
        (acc, feature) => {
            const minX = feature.cx - feature.width / 2;
            const maxX = feature.cx + feature.width / 2;
            const minY = feature.cy - feature.height / 2;
            const maxY = feature.cy + feature.height / 2;

            return {
                minX: Math.min(acc.minX, minX),
                maxX: Math.max(acc.maxX, maxX),
                minY: Math.min(acc.minY, minY),
                maxY: Math.max(acc.maxY, maxY),
            };
        },
        { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    );

    return {
        ...bounds,
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
    };
}

/**
 * Calculate scale factor to fit face in viewport (cat-in-container scaling)
 */
export function calculateFaceScale(
    faceBounds: FaceBounds,
    viewportWidth: number,
    viewportHeight: number,
    fillPercentage: number = 0.7,
    complexityMultiplier: number = 1.0
): number {
    const scaleX = (viewportWidth * fillPercentage) / faceBounds.width;
    const scaleY = (viewportHeight * fillPercentage) / faceBounds.height;

    // Scale to fit the smaller dimension (guarantees fit in both dimensions)
    return Math.min(scaleX, scaleY) * complexityMultiplier;
}

// ============================================================================
// MASK DEFINITIONS
// ============================================================================

/**
 * The classic Macintosh-style face (default)
 */
export const MacintoshMask: Mask = {
    name: 'macintosh',
    description: 'Classic Macintosh-style minimalist face with rectangular features',

    baseFeatures: [
        { cx: -14.3, cy: -9.1, cz: 0, width: 5.8, height: 14.6, type: 'leftEye' },
        { cx: 14.3, cy: -9.1, cz: 0, width: 5.8, height: 14.6, type: 'rightEye' },
        { cx: 0, cy: 3.9, cz: 0, width: 4.4, height: 10.4, type: 'noseVert' },
        { cx: 5.2, cy: 9.1, cz: 0, width: 10.4, height: 4.4, type: 'noseHoriz' },
        { cx: 2.6, cy: 18.2, cz: 0, width: 23.4, height: 4.4, type: 'mouth' },
        { cx: -11, cy: 16.2, cz: 0, width: 4.4, height: 4.4, type: 'leftCorner' },
        { cx: 16.2, cy: 16.2, cz: 0, width: 4.4, height: 4.4, type: 'rightCorner' },
    ],

    getFeaturesWithDynamics(dynamics: FaceDynamics): FaceFeature[] {
        const { leftEyeBlink = 0, rightEyeBlink = 0, mouthOpen = 0 } = dynamics;

        return this.baseFeatures.map(feature => {
            const modulated = { ...feature };

            // Modulate eye height based on blink
            if (feature.type === 'leftEye') {
                const eyeOpenness = 1 - leftEyeBlink;
                modulated.height = feature.height * eyeOpenness;
            } else if (feature.type === 'rightEye') {
                const eyeOpenness = 1 - rightEyeBlink;
                modulated.height = feature.height * eyeOpenness;
            }

            // Modulate mouth position and height based on opening
            else if (feature.type === 'mouth') {
                const mouthScale = 1 + mouthOpen * 3; // Up to 4x height
                modulated.cy = feature.cy + mouthOpen * 4; // Shift down
                modulated.height = feature.height * mouthScale;
            }

            // Modulate mouth corner positions
            else if (feature.type === 'leftCorner' || feature.type === 'rightCorner') {
                modulated.cy = feature.cy + mouthOpen * 3; // Shift down
            }

            return modulated;
        });
    },

    getBounds(dynamics?: FaceDynamics): FaceBounds {
        // Calculate bounds with maximum dynamic range
        const maxDynamics: FaceDynamics = {
            leftEyeBlink: 0,  // Fully open (doesn't increase bounds)
            rightEyeBlink: 0,
            mouthOpen: 1.0,   // Fully open (maximum bounds)
        };

        const featuresWithMax = this.getFeaturesWithDynamics(
            dynamics || maxDynamics
        );

        return calculateBounds(featuresWithMax);
    },
};

/**
 * A simple robot face with square features
 */
export const RobotMask: Mask = {
    name: 'robot',
    description: 'Geometric robot face with square eyes and grid mouth',

    baseFeatures: [
        // Square eyes
        { cx: -12, cy: -8, cz: 0, width: 8, height: 8, type: 'leftEye' },
        { cx: 12, cy: -8, cz: 0, width: 8, height: 8, type: 'rightEye' },
        // Antenna
        { cx: 0, cy: -20, cz: 0, width: 3, height: 6, type: 'antenna' },
        { cx: 0, cy: -25, cz: 0, width: 5, height: 3, type: 'antennaTop' },
        // Rectangular mouth
        { cx: 0, cy: 12, cz: 0, width: 20, height: 8, type: 'mouth' },
    ],

    getFeaturesWithDynamics(dynamics: FaceDynamics): FaceFeature[] {
        const { leftEyeBlink = 0, rightEyeBlink = 0, mouthOpen = 0 } = dynamics;

        return this.baseFeatures.map(feature => {
            const modulated = { ...feature };

            // Eyes blink by reducing height
            if (feature.type === 'leftEye') {
                modulated.height = feature.height * (1 - leftEyeBlink);
            } else if (feature.type === 'rightEye') {
                modulated.height = feature.height * (1 - rightEyeBlink);
            }

            // Mouth expands vertically
            else if (feature.type === 'mouth') {
                modulated.height = feature.height * (1 + mouthOpen * 2);
                modulated.cy = feature.cy + mouthOpen * 3;
            }

            return modulated;
        });
    },

    getBounds(dynamics?: FaceDynamics): FaceBounds {
        const maxDynamics: FaceDynamics = {
            leftEyeBlink: 0,
            rightEyeBlink: 0,
            mouthOpen: 1.0,
        };

        const featuresWithMax = this.getFeaturesWithDynamics(
            dynamics || maxDynamics
        );

        return calculateBounds(featuresWithMax);
    },
};

/**
 * A cute kawaii-style face
 */
export const KawaiiMask: Mask = {
    name: 'kawaii',
    description: 'Cute kawaii-style face with round features',

    baseFeatures: [
        // Round eyes (represented as small squares)
        { cx: -10, cy: -6, cz: 0, width: 4, height: 8, type: 'leftEye' },
        { cx: 10, cy: -6, cz: 0, width: 4, height: 8, type: 'rightEye' },
        // Small dot nose
        { cx: 0, cy: 2, cz: 0, width: 3, height: 3, type: 'nose' },
        // Curved smile (represented as horizontal bar)
        { cx: 0, cy: 10, cz: 0, width: 16, height: 3, type: 'mouth' },
        // Blush marks
        { cx: -16, cy: 4, cz: 0, width: 4, height: 3, type: 'leftBlush' },
        { cx: 16, cy: 4, cz: 0, width: 4, height: 3, type: 'rightBlush' },
    ],

    getFeaturesWithDynamics(dynamics: FaceDynamics): FaceFeature[] {
        const { leftEyeBlink = 0, rightEyeBlink = 0, mouthOpen = 0 } = dynamics;

        return this.baseFeatures.map(feature => {
            const modulated = { ...feature };

            if (feature.type === 'leftEye') {
                modulated.height = feature.height * (1 - leftEyeBlink);
            } else if (feature.type === 'rightEye') {
                modulated.height = feature.height * (1 - rightEyeBlink);
            } else if (feature.type === 'mouth') {
                modulated.height = feature.height * (1 + mouthOpen * 2);
                modulated.cy = feature.cy + mouthOpen * 2;
            }

            return modulated;
        });
    },

    getBounds(dynamics?: FaceDynamics): FaceBounds {
        const maxDynamics: FaceDynamics = {
            leftEyeBlink: 0,
            rightEyeBlink: 0,
            mouthOpen: 1.0,
        };

        const featuresWithMax = this.getFeaturesWithDynamics(
            dynamics || maxDynamics
        );

        return calculateBounds(featuresWithMax);
    },
};

// ============================================================================
// MASK REGISTRY
// ============================================================================

/**
 * Collection of all available masks
 */
export const MaskRegistry: Record<string, Mask> = {
    macintosh: MacintoshMask,
    robot: RobotMask,
    kawaii: KawaiiMask,
};

/**
 * Get a mask by name, defaults to Macintosh
 */
export function getMask(name: string): Mask {
    return MaskRegistry[name] || MacintoshMask;
}

/**
 * Get list of all available mask names
 */
export function getAvailableMasks(): string[] {
    return Object.keys(MaskRegistry);
}

/**
 * Default mask to use
 */
export const DefaultMask = MacintoshMask;
