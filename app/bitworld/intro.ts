// Intro configuration system for customizable landing experiences

export type IntroBackgroundType = 'color' | 'image' | 'video' | 'time-based';
export type IntroMonogramType = 'nara' | 'perlin' | 'geometry3d' | 'macintosh' | 'loading' | 'road' | 'terrain' | 'clear' | 'off';

export interface IntroConfig {
    id: string;
    name: string;
    description: string;

    // Background configuration
    backgroundType: IntroBackgroundType;
    backgroundColor?: string; // For 'color' type
    backgroundImage?: string; // For 'image' type
    backgroundVideo?: string; // For 'video' type

    // Monogram configuration
    monogramType: IntroMonogramType;
    monogramDuration?: number; // How long to show monogram (ms), undefined = permanent

    // Text colors
    textColor?: string;
    hostTextColor?: string;

    // Banner settings (NARA banner before main intro)
    showBanner?: boolean;
    bannerDuration?: number; // Default: 1500ms
    bannerBackgroundColor?: string; // Default: #000000

    // Flow settings
    hostFlow?: string; // Which host flow to start (default: 'intro' or 'welcome')
}

// === PREDEFINED INTRO CONFIGURATIONS ===

/**
 * Time-based intro: Sulfur (day) or Chalk (night) background
 * Classic Nara experience with dynamic colors based on time of day
 */
export const TIME_BASED_INTRO: IntroConfig = {
    id: 'time-based',
    name: 'Time-Based Colors',
    description: 'Dynamic sulfur/chalk colors based on time of day',
    backgroundType: 'time-based',
    monogramType: 'perlin',
    showBanner: true,
    hostFlow: 'intro'
};

/**
 * Image-based intro: Perlin monogram over curated image
 * Premium feel with visual depth
 * Shows image background throughout (NARA banner → Perlin transition)
 */
export const IMAGE_INTRO: IntroConfig = {
    id: 'image-based',
    name: 'Image Background',
    description: 'Perlin monogram over curated image background',
    backgroundType: 'image',
    backgroundImage: 'https://d2w9rnfcy7mm78.cloudfront.net/40525619/original_8f6196d0fda2a540ef8e380980921d25.jpg?1761186290?bc=0',
    monogramType: 'perlin',
    textColor: '#FFFFFF',
    hostTextColor: '#FFA500',
    showBanner: true,
    bannerDuration: 1500,
    bannerBackgroundColor: undefined, // No solid color - show image through banner
    hostFlow: 'intro'
};

/**
 * Minimal black intro: NARA monogram on black
 * Clean, focused, professional
 */
export const MINIMAL_BLACK_INTRO: IntroConfig = {
    id: 'minimal-black',
    name: 'Minimal Black',
    description: 'NARA monogram on solid black background',
    backgroundType: 'color',
    backgroundColor: '#000000',
    monogramType: 'nara',
    textColor: '#FFFFFF',
    hostTextColor: '#F0FF6A',
    showBanner: false,
    hostFlow: 'welcome'
};

/**
 * Minimal white intro: Clean slate aesthetic
 * Simple and approachable
 */
export const MINIMAL_WHITE_INTRO: IntroConfig = {
    id: 'minimal-white',
    name: 'Minimal White',
    description: 'Clean white background with subtle monogram',
    backgroundType: 'color',
    backgroundColor: '#FFFFFF',
    monogramType: 'clear',
    textColor: '#000000',
    hostTextColor: '#0B109F',
    showBanner: false,
    hostFlow: 'welcome'
};

/**
 * 3D Geometry intro: Geometric monogram over dark background
 * Futuristic and technical feel
 */
export const GEOMETRY_3D_INTRO: IntroConfig = {
    id: 'geometry-3d',
    name: '3D Geometry',
    description: '3D geometric monogram on dark background',
    backgroundType: 'color',
    backgroundColor: '#0A0A0A',
    monogramType: 'geometry3d',
    textColor: '#FFFFFF',
    hostTextColor: '#69AED6',
    showBanner: true,
    bannerDuration: 1500,
    hostFlow: 'intro'
};

/**
 * Retro Macintosh intro: Nostalgic computing aesthetic
 * Playful and vintage
 */
export const RETRO_MAC_INTRO: IntroConfig = {
    id: 'retro-mac',
    name: 'Retro Macintosh',
    description: 'Classic Macintosh-style monogram',
    backgroundType: 'color',
    backgroundColor: '#F0F0F0',
    monogramType: 'macintosh',
    textColor: '#000000',
    hostTextColor: '#162400',
    showBanner: false,
    hostFlow: 'welcome'
};

/**
 * Sulfur-only intro: Always use sulfur yellow
 * Energetic and vibrant
 */
export const SULFUR_INTRO: IntroConfig = {
    id: 'sulfur',
    name: 'Sulfur Yellow',
    description: 'Bright sulfur yellow background',
    backgroundType: 'color',
    backgroundColor: '#F0FF6A',
    monogramType: 'perlin',
    textColor: '#000000',
    hostTextColor: '#FFA500',
    showBanner: false,
    hostFlow: 'welcome'
};

/**
 * Chalk-only intro: Always use chalk blue
 * Calm and focused
 */
export const CHALK_INTRO: IntroConfig = {
    id: 'chalk',
    name: 'Chalk Blue',
    description: 'Calm chalk blue background',
    backgroundType: 'color',
    backgroundColor: '#69AED6',
    monogramType: 'perlin',
    textColor: '#000000',
    hostTextColor: '#0B109F',
    showBanner: false,
    hostFlow: 'welcome'
};

/**
 * No monogram intro: Clean background with no graphics
 * Maximum focus on content
 */
export const NO_MONOGRAM_INTRO: IntroConfig = {
    id: 'no-monogram',
    name: 'No Monogram',
    description: 'Clean background without monogram overlay',
    backgroundType: 'color',
    backgroundColor: '#F8F8F0',
    monogramType: 'off',
    textColor: '#000000',
    hostTextColor: '#162400',
    showBanner: false,
    hostFlow: 'welcome'
};

// === INTRO REGISTRY ===

export const INTRO_CONFIGS: Record<string, IntroConfig> = {
    'time-based': TIME_BASED_INTRO,
    'image': IMAGE_INTRO,
    'minimal-black': MINIMAL_BLACK_INTRO,
    'minimal-white': MINIMAL_WHITE_INTRO,
    'geometry-3d': GEOMETRY_3D_INTRO,
    'retro-mac': RETRO_MAC_INTRO,
    'sulfur': SULFUR_INTRO,
    'chalk': CHALK_INTRO,
    'no-monogram': NO_MONOGRAM_INTRO
};

// === HELPER FUNCTIONS ===

/**
 * Get intro config by ID
 */
export function getIntroConfig(id: string): IntroConfig | undefined {
    return INTRO_CONFIGS[id];
}

/**
 * Get time-based colors (for time-based intro type)
 */
export function getTimeBasedColors(): { background: string; text: string } {
    const hour = new Date().getHours();
    const isDaytime = hour >= 6 && hour < 18;
    return isDaytime
        ? { background: '#F0FF6A', text: '#FFA500' } // sulfur bg, orange text
        : { background: '#69AED6', text: '#000000' }; // chalk bg, black text
}

/**
 * Resolve intro config to concrete values
 * Handles dynamic types like 'time-based'
 */
export function resolveIntroConfig(config: IntroConfig): {
    backgroundColor: string;
    textColor: string;
    hostTextColor: string;
    backgroundImage?: string;
    backgroundVideo?: string;
    monogramType: IntroMonogramType;
    showBanner: boolean;
    bannerDuration: number;
    bannerBackgroundColor: string;
    hostFlow: string;
} {
    let backgroundColor = config.backgroundColor || '#FFFFFF';
    let textColor = config.textColor || '#000000';
    let hostTextColor = config.hostTextColor || '#FFA500';

    // Handle time-based background
    if (config.backgroundType === 'time-based') {
        const timeColors = getTimeBasedColors();
        backgroundColor = timeColors.background;
        if (!config.textColor) {
            textColor = timeColors.text;
        }
    }

    return {
        backgroundColor,
        textColor,
        hostTextColor,
        backgroundImage: config.backgroundImage,
        backgroundVideo: config.backgroundVideo,
        monogramType: config.monogramType,
        showBanner: config.showBanner ?? true,
        bannerDuration: config.bannerDuration ?? 1500,
        bannerBackgroundColor: config.bannerBackgroundColor ?? '#000000',
        hostFlow: config.hostFlow ?? 'intro'
    };
}

/**
 * Select intro based on context
 * Can be extended for A/B testing, user segments, etc.
 */
export function selectIntro(context?: {
    referrer?: string;
    userSegment?: string;
    experimentVariant?: string;
}): IntroConfig {
    // Future: Add A/B testing logic here
    // For now, return image-based intro as default
    return IMAGE_INTRO;
}

/**
 * Default intro configuration (exported for backwards compatibility)
 */
export const DEFAULT_INTRO = IMAGE_INTRO;
