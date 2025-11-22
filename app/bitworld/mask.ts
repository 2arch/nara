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
    leftEyeBlink?: number;    // 0=open, 1=closed (vertical collapse)
    rightEyeBlink?: number;   // 0=open, 1=closed (vertical collapse)
    leftEyeSquint?: number;   // 0=normal, 1=squinted (becomes '>')
    rightEyeSquint?: number;  // 0=normal, 1=squinted (becomes '<')
    mouthOpen?: number;       // 0=closed, 1=fully open
    smile?: number;           // 0=neutral, 1=full smile
    frown?: number;           // 0=neutral, 1=full frown
    eyebrowRaise?: number;    // 0=neutral, 1=raised
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
 * Classic Macintosh face with simple features (default)
 */
export const MacintoshMask: Mask = {
    name: 'macintosh',
    description: 'Classic Macintosh face with simple iconic features',

    baseFeatures: [
        // Face Plate (Background)
        { cx: 0, cy: 2, cz: 20, width: 45, height: 58, type: 'facePlate' },
        // Eyes - simple rectangles
        { cx: -14.3, cy: -9.1, cz: 0, width: 5.8, height: 14.6, type: 'leftEye' },
        { cx: 14.3, cy: -9.1, cz: 0, width: 5.8, height: 14.6, type: 'rightEye' },
        // Nose - vertical part
        { cx: 0, cy: 3.9, cz: -10, width: 4.4, height: 10.4, type: 'noseVert' },
        // Nose - horizontal part
        { cx: 5.2, cy: 9.1, cz: -10, width: 10.4, height: 4.4, type: 'noseHoriz' },
        // Mouth - horizontal bar
        { cx: 2.6, cy: 18.2, cz: -5, width: 23.4, height: 4.4, type: 'mouth' },
        // Mouth corners
        { cx: -11, cy: 16.2, cz: -5, width: 4.4, height: 4.4, type: 'leftCorner' },
        { cx: 16.2, cy: 16.2, cz: -5, width: 4.4, height: 4.4, type: 'rightCorner' },
    ],

    getFeaturesWithDynamics(dynamics: FaceDynamics): FaceFeature[] {
        const { leftEyeBlink = 0, rightEyeBlink = 0, mouthOpen = 0 } = dynamics;

        return this.baseFeatures.map(feature => {
            const modulated = { ...feature };

            // Eyes blink by collapsing height
            if (feature.type === 'leftEye') {
                const eyeOpenness = 1 - leftEyeBlink;
                modulated.height = feature.height * eyeOpenness;
            } else if (feature.type === 'rightEye') {
                const eyeOpenness = 1 - rightEyeBlink;
                modulated.height = feature.height * eyeOpenness;
            }
            // Mouth expands and shifts down when opening
            else if (feature.type === 'mouth') {
                const mouthScale = 1 + mouthOpen * 3; // Up to 4x height
                modulated.height = feature.height * mouthScale;
                modulated.cy = feature.cy + mouthOpen * 4;
            }
            // Corners shift down with mouth
            else if (feature.type === 'leftCorner' || feature.type === 'rightCorner') {
                modulated.cy = feature.cy + mouthOpen * 3;
            }

            return modulated;
        });
    },

    getBounds(dynamics?: FaceDynamics): FaceBounds {
        const maxDynamics: FaceDynamics = {
            leftEyeBlink: 0,      // Fully open
            rightEyeBlink: 0,
            mouthOpen: 1.0,       // Fully open mouth
        };

        const featuresWithMax = this.getFeaturesWithDynamics(
            dynamics || maxDynamics
        );

        return calculateBounds(featuresWithMax);
    },
};

/**
 * Expressive chibi-style face with smile, frown, and squint
 */
export const ChibiMask: Mask = {
    name: 'chibi',
    description: 'Chibi-style face with cute proportions and expressive features',

    baseFeatures: [
        // Bigger, more chibi-like eyes (taller and slightly wider)
        { cx: -12, cy: -8, cz: 0, width: 7, height: 18, type: 'leftEye' },
        { cx: 12, cy: -8, cz: 0, width: 7, height: 18, type: 'rightEye' },

        // Squint chevrons (left eye becomes '>')
        { cx: -12, cy: -8, cz: 0, width: 8, height: 4, type: 'leftEyeSquintTop' },
        { cx: -12, cy: -8, cz: 0, width: 8, height: 4, type: 'leftEyeSquintBottom' },

        // Squint chevrons (right eye becomes '<')
        { cx: 12, cy: -8, cz: 0, width: 8, height: 4, type: 'rightEyeSquintTop' },
        { cx: 12, cy: -8, cz: 0, width: 8, height: 4, type: 'rightEyeSquintBottom' },

        // Simple dot nose (chibi style)
        { cx: 0, cy: 6, cz: 0, width: 4, height: 4, type: 'nose' },

        // Mouth bar (will curve for smile/frown)
        { cx: 0, cy: 16, cz: 0, width: 20, height: 4, type: 'mouth' },

        // Smile curves (appear when smiling)
        { cx: -10, cy: 14, cz: 0, width: 4, height: 4, type: 'smileLeft' },
        { cx: 10, cy: 14, cz: 0, width: 4, height: 4, type: 'smileRight' },

        // Frown curves (appear when frowning)
        { cx: -10, cy: 18, cz: 0, width: 4, height: 4, type: 'frownLeft' },
        { cx: 10, cy: 18, cz: 0, width: 4, height: 4, type: 'frownRight' },
    ],

    getFeaturesWithDynamics(dynamics: FaceDynamics): FaceFeature[] {
        const {
            leftEyeBlink = 0,
            rightEyeBlink = 0,
            leftEyeSquint = 0,
            rightEyeSquint = 0,
            mouthOpen = 0,
            smile = 0,
            frown = 0
        } = dynamics;

        // Threshold for switching to squint chevrons
        const squintThreshold = 0.3;

        const features: FaceFeature[] = [];

        for (const feature of this.baseFeatures) {
            const modulated = { ...feature };

            // === LEFT EYE ===
            if (feature.type === 'leftEye') {
                if (leftEyeSquint > squintThreshold) {
                    // Hide normal eye when squinting (chevrons will show instead)
                    continue;
                } else {
                    // Normal eye - apply blink
                    const eyeOpenness = 1 - leftEyeBlink;
                    modulated.height = feature.height * eyeOpenness;
                    features.push(modulated);
                }
            }

            // === RIGHT EYE ===
            else if (feature.type === 'rightEye') {
                if (rightEyeSquint > squintThreshold) {
                    // Hide normal eye when squinting (chevrons will show instead)
                    continue;
                } else {
                    // Normal eye - apply blink
                    const eyeOpenness = 1 - rightEyeBlink;
                    modulated.height = feature.height * eyeOpenness;
                    features.push(modulated);
                }
            }

            // === LEFT EYE SQUINT CHEVRONS '>' ===
            else if (feature.type === 'leftEyeSquintTop') {
                if (leftEyeSquint > squintThreshold) {
                    // Top part of '>' chevron - shifts up and angles
                    modulated.cy = feature.cy - 4;
                    modulated.cx = feature.cx - 2;
                    modulated.width = 6;
                    modulated.height = 3;
                    features.push(modulated);
                }
            }
            else if (feature.type === 'leftEyeSquintBottom') {
                if (leftEyeSquint > squintThreshold) {
                    // Bottom part of '>' chevron - shifts down and angles
                    modulated.cy = feature.cy + 4;
                    modulated.cx = feature.cx - 2;
                    modulated.width = 6;
                    modulated.height = 3;
                    features.push(modulated);
                }
            }

            // === RIGHT EYE SQUINT CHEVRONS '<' ===
            else if (feature.type === 'rightEyeSquintTop') {
                if (rightEyeSquint > squintThreshold) {
                    // Top part of '<' chevron - shifts up and angles
                    modulated.cy = feature.cy - 4;
                    modulated.cx = feature.cx + 2;
                    modulated.width = 6;
                    modulated.height = 3;
                    features.push(modulated);
                }
            }
            else if (feature.type === 'rightEyeSquintBottom') {
                if (rightEyeSquint > squintThreshold) {
                    // Bottom part of '<' chevron - shifts down and angles
                    modulated.cy = feature.cy + 4;
                    modulated.cx = feature.cx + 2;
                    modulated.width = 6;
                    modulated.height = 3;
                    features.push(modulated);
                }
            }

            // === NOSE ===
            else if (feature.type === 'nose') {
                features.push(modulated);
            }

            // === MOUTH ===
            else if (feature.type === 'mouth') {
                // Mouth moves up when smiling, down when frowning
                const expressionShift = (smile * -3) + (frown * 3);
                modulated.cy = feature.cy + expressionShift;

                // Mouth opens vertically
                const mouthScale = 1 + mouthOpen * 2;
                modulated.height = feature.height * mouthScale;
                modulated.cy += mouthOpen * 3; // Shift down when opening

                features.push(modulated);
            }

            // === SMILE CURVES ===
            else if (feature.type === 'smileLeft' || feature.type === 'smileRight') {
                if (smile > 0.3) {
                    // Show smile curves when smiling
                    modulated.height = feature.height * smile;
                    features.push(modulated);
                }
            }

            // === FROWN CURVES ===
            else if (feature.type === 'frownLeft' || feature.type === 'frownRight') {
                if (frown > 0.3) {
                    // Show frown curves when frowning
                    modulated.height = feature.height * frown;
                    features.push(modulated);
                }
            }
        }

        return features;
    },

    getBounds(dynamics?: FaceDynamics): FaceBounds {
        // Calculate bounds with maximum dynamic range
        const maxDynamics: FaceDynamics = {
            leftEyeBlink: 0,      // Fully open (doesn't increase bounds)
            rightEyeBlink: 0,
            leftEyeSquint: 1.0,   // Fully squinted (chevrons)
            rightEyeSquint: 1.0,
            mouthOpen: 1.0,       // Fully open (maximum vertical)
            smile: 1.0,           // Full smile (moves up)
            frown: 1.0,           // Full frown (moves down)
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
    chibi: ChibiMask,
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
