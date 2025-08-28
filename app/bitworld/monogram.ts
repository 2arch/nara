import { useState, useCallback, useRef, useEffect } from 'react';
import type { Point } from './world.engine';

// --- Monogram Pattern Types ---
export type MonogramMode = 'plasma' | 'perlin' | 'nara' | 'geometry3d';

// 3D Geometry System - Extensible foundation for any 3D format
export interface Vertex3D {
    x: number;
    y: number;
    z: number;
}

export interface Edge3D {
    start: number; // vertex index
    end: number;   // vertex index
}

export interface Geometry3D {
    name: string;
    vertices: Vertex3D[];
    edges: Edge3D[];
    // Future extensions:
    // faces?: Face3D[];
    // materials?: Material[];
    // animations?: Animation[];
    // metadata?: Record<string, any>;
}

export type GeometryType = 'cube' | 'tetrahedron' | 'octahedron' | 'sphere' | 'torus' | 'custom';

export interface MonogramCell {
    char: string;
    color: string;
    intensity: number; // 0-1 for effects
}

export interface MonogramPattern {
    [key: string]: MonogramCell; // key format: "x,y"
}

export interface MonogramOptions {
    mode: MonogramMode;
    speed: number; // Animation speed multiplier (0.1 - 3.0)
    complexity: number; // Pattern complexity (0.1 - 2.0)
    colorShift: number; // Color phase shift (0 - 6.28)
    enabled: boolean;
    // 3D geometry options
    geometryType: GeometryType;
    customGeometry?: Geometry3D; // For loading custom 3D files
}

// --- Mathematical Pattern Generators ---
const useMonogramSystem = (
    initialOptions?: MonogramOptions,
    onOptionsChange?: (options: MonogramOptions) => void
) => {
    const [options, setOptions] = useState<MonogramOptions>(
        initialOptions || {
            mode: 'plasma',
            speed: 0.5, // Slower default speed
            complexity: 1.0,
            colorShift: 0,
            enabled: false,
            geometryType: 'octahedron'
        }
    );

    const timeRef = useRef<number>(0);
    const animationFrameRef = useRef<number>(0);
    
    // Update time for animations
    useEffect(() => {
        const updateTime = () => {
            timeRef.current += 0.02 * options.speed;
            animationFrameRef.current = requestAnimationFrame(updateTime);
        };
        
        if (options.enabled) {
            animationFrameRef.current = requestAnimationFrame(updateTime);
        }

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [options.enabled, options.speed]);

    // Sync with external options changes only on mount
    useEffect(() => {
        if (initialOptions) {
            setOptions(initialOptions);
        }
    }, []); // Empty dependency array - only run on mount

    // Call onChange when options change, but avoid calling it on initial mount
    const isInitialMount = useRef(true);
    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }
        if (onOptionsChange) {
            onOptionsChange(options);
        }
    }, [options]); // Remove onOptionsChange from deps to avoid infinite loop

    // Character sets for different intensities
    const getCharForIntensity = useCallback((intensity: number, mode: MonogramMode): string => {
        const chars = {
            plasma: [' ', '░', '▒', '▓', '█'],
            perlin: [' ', '-', '─', '═', '╫'],
            nara: ['░', '▒', '▓', '█'], // Back to varied blocks for texture
            geometry3d: [' ', '░', '▒', '▓', '█'], // Standard block progression for 3D
        };
        
        const charSet = chars[mode] || chars.plasma;
        const index = Math.floor(intensity * (charSet.length - 1));
        return charSet[Math.min(index, charSet.length - 1)];
    }, []);

    // Get color from palette based on value
    const getColorFromPalette = useCallback((value: number, mode: MonogramMode): string => {
        if (mode === 'nara') {
            // Pure black for NARA mode
            return 'black';
        }
        // Monochromatic scheme for other modes
        const lightness = 50 + (value % 1) * 50;
        return `hsl(0, 0%, ${lightness}%)`;
    }, []);

    // Plasma effect
    const calculatePlasma = useCallback((x: number, y: number, time: number): number => {
        const complexity = options.complexity;
        const plasma1 = Math.sin(x * 0.1 * complexity + time);
        const plasma2 = Math.sin(y * 0.1 * complexity + time * 1.3);
        const plasma3 = Math.sin((x + y) * 0.07 * complexity + time * 0.7);
        const plasma4 = Math.sin(Math.sqrt(x * x + y * y) * 0.08 * complexity + time * 1.1);
        
        return (plasma1 + plasma2 + plasma3 + plasma4) / 4;
    }, [options.complexity]);


    // Simplified Perlin noise implementation
    const perlinNoise = useCallback((x: number, y: number): number => {
        // Gradient vectors for 2D
        const grad = (hash: number, x: number, y: number) => {
            const h = hash & 3;
            const u = h < 2 ? x : y;
            const v = h < 2 ? y : x;
            return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
        };
        
        // Fade function
        const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
        const lerp = (t: number, a: number, b: number) => a + t * (b - a);
        
        // Integer and fractional parts
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const fx = x - Math.floor(x);
        const fy = y - Math.floor(y);
        
        // Simplified permutation table (using sin for pseudo-randomness)
        const perm = (i: number) => Math.floor(Math.abs(Math.sin(i * 12.9898) * 43758.5453) * 256) & 255;
        
        const u = fade(fx);
        const v = fade(fy);
        
        const a = perm(X) + Y;
        const b = perm(X + 1) + Y;
        
        const x1 = lerp(u, grad(perm(a), fx, fy), grad(perm(b), fx - 1, fy));
        const x2 = lerp(u, grad(perm(a + 1), fx, fy - 1), grad(perm(b + 1), fx - 1, fy - 1));
        
        return lerp(v, x1, x2);
    }, []);

    // Pure Perlin noise flow (no text, just beautiful flowing patterns)
    const calculatePerlin = useCallback((x: number, y: number, time: number): number => {
        const complexity = options.complexity;
        const scale = 1.2 * complexity;
        
        // Normalized coordinates
        const nx = x * 0.02;
        const ny = y * 0.02;
        
        // Create flowing distortion using layered noise
        const flow1 = perlinNoise(nx * scale + time * 2, ny * scale + time);
        const flow2 = perlinNoise(nx * scale * 2 - time, ny * scale * 2);
        
        // Combine flows for complex movement
        const dx = nx + flow1 * 0.3 + flow2 * 0.1;
        const dy = ny + flow2 * 0.3 - flow1 * 0.1;
        
        // Sample noise at distorted position for intensity
        const intensity1 = perlinNoise(dx * 5, dy * 5);
        const intensity2 = perlinNoise(dx * 8 + time, dy * 8);
        
        // Combine intensities and normalize
        const rawIntensity = (intensity1 + intensity2 + 2) / 4;
        
        // Add some temporal variation for more organic movement
        const temporalWave = Math.sin(time * 0.5 + nx * 3 + ny * 2) * 0.1 + 0.9;
        
        return Math.max(0, Math.min(1, rawIntensity * temporalWave));
    }, [options.complexity, perlinNoise]);

    // === 3D GEOMETRY PIPELINE === //
    
    // Procedural geometry generators - extensible for any 3D format
    const generateGeometry = useCallback((type: GeometryType, customGeometry?: Geometry3D): Geometry3D => {
        if (type === 'custom' && customGeometry) {
            return customGeometry;
        }
        
        switch (type) {
            case 'cube':
                return {
                    name: 'cube',
                    vertices: [
                        {x: -1, y: -1, z: -1}, {x: 1, y: -1, z: -1}, {x: 1, y: 1, z: -1}, {x: -1, y: 1, z: -1},
                        {x: -1, y: -1, z: 1}, {x: 1, y: -1, z: 1}, {x: 1, y: 1, z: 1}, {x: -1, y: 1, z: 1}
                    ],
                    edges: [
                        {start: 0, end: 1}, {start: 1, end: 2}, {start: 2, end: 3}, {start: 3, end: 0}, // Back face
                        {start: 4, end: 5}, {start: 5, end: 6}, {start: 6, end: 7}, {start: 7, end: 4}, // Front face
                        {start: 0, end: 4}, {start: 1, end: 5}, {start: 2, end: 6}, {start: 3, end: 7}  // Connecting
                    ]
                };
                
            case 'tetrahedron':
                return {
                    name: 'tetrahedron',
                    vertices: [
                        {x: 1, y: 1, z: 1}, {x: 1, y: -1, z: -1}, {x: -1, y: 1, z: -1}, {x: -1, y: -1, z: 1}
                    ],
                    edges: [
                        {start: 0, end: 1}, {start: 0, end: 2}, {start: 0, end: 3},
                        {start: 1, end: 2}, {start: 1, end: 3}, {start: 2, end: 3}
                    ]
                };
                
            case 'octahedron':
                return {
                    name: 'octahedron',
                    vertices: [
                        {x: 1, y: 0, z: 0}, {x: -1, y: 0, z: 0}, {x: 0, y: 1, z: 0},
                        {x: 0, y: -1, z: 0}, {x: 0, y: 0, z: 1}, {x: 0, y: 0, z: -1}
                    ],
                    edges: [
                        {start: 0, end: 2}, {start: 0, end: 3}, {start: 0, end: 4}, {start: 0, end: 5},
                        {start: 1, end: 2}, {start: 1, end: 3}, {start: 1, end: 4}, {start: 1, end: 5},
                        {start: 2, end: 4}, {start: 2, end: 5}, {start: 3, end: 4}, {start: 3, end: 5}
                    ]
                };
                
            case 'sphere':
                // Procedural sphere with latitude/longitude lines
                const sphereVertices: Vertex3D[] = [];
                const sphereEdges: Edge3D[] = [];
                const rings = 8;
                const segments = 12;
                
                for (let ring = 0; ring <= rings; ring++) {
                    const phi = (ring / rings) * Math.PI;
                    for (let segment = 0; segment < segments; segment++) {
                        const theta = (segment / segments) * 2 * Math.PI;
                        sphereVertices.push({
                            x: Math.sin(phi) * Math.cos(theta),
                            y: Math.sin(phi) * Math.sin(theta),
                            z: Math.cos(phi)
                        });
                        
                        const current = ring * segments + segment;
                        
                        // Longitude edges
                        if (ring < rings) {
                            sphereEdges.push({start: current, end: current + segments});
                        }
                        
                        // Latitude edges
                        if (segment < segments - 1) {
                            sphereEdges.push({start: current, end: current + 1});
                        } else {
                            sphereEdges.push({start: current, end: ring * segments});
                        }
                    }
                }
                
                return {name: 'sphere', vertices: sphereVertices, edges: sphereEdges};
                
            case 'torus':
                // Procedural torus
                const torusVertices: Vertex3D[] = [];
                const torusEdges: Edge3D[] = [];
                const majorSegments = 16;
                const minorSegments = 8;
                const majorRadius = 1;
                const minorRadius = 0.3;
                
                for (let major = 0; major < majorSegments; major++) {
                    for (let minor = 0; minor < minorSegments; minor++) {
                        const u = (major / majorSegments) * 2 * Math.PI;
                        const v = (minor / minorSegments) * 2 * Math.PI;
                        
                        torusVertices.push({
                            x: (majorRadius + minorRadius * Math.cos(v)) * Math.cos(u),
                            y: (majorRadius + minorRadius * Math.cos(v)) * Math.sin(u),
                            z: minorRadius * Math.sin(v)
                        });
                        
                        const current = major * minorSegments + minor;
                        
                        // Major ring edges
                        const nextMajor = ((major + 1) % majorSegments) * minorSegments + minor;
                        torusEdges.push({start: current, end: nextMajor});
                        
                        // Minor ring edges
                        const nextMinor = major * minorSegments + ((minor + 1) % minorSegments);
                        torusEdges.push({start: current, end: nextMinor});
                    }
                }
                
                return {name: 'torus', vertices: torusVertices, edges: torusEdges};
                
            default:
                return generateGeometry('cube'); // Fallback
        }
    }, []);
    
    // Universal 3D geometry renderer - works with ANY geometry data structure
    const calculate3DGeometry = useCallback((x: number, y: number, time: number, viewportBounds?: {
        startX: number,
        startY: number,
        endX: number,
        endY: number
    }): number => {
        if (!viewportBounds) return 0;
        
        const complexity = options.complexity;
        const geometry = generateGeometry(options.geometryType, options.customGeometry);
        
        // Calculate viewport dimensions and center
        const viewportWidth = viewportBounds.endX - viewportBounds.startX;
        const viewportHeight = viewportBounds.endY - viewportBounds.startY;
        const centerX = (viewportBounds.startX + viewportBounds.endX) / 2;
        const centerY = (viewportBounds.startY + viewportBounds.endY) / 2;
        
        // Geometry size based on viewport
        const geometrySize = viewportWidth * 0.25 * complexity;
        
        // Rotation angles
        const rotX = time * options.speed;
        const rotY = time * options.speed;
        const rotZ = time * options.speed;
        
        // Rotation matrices
        const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
        const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
        const cosZ = Math.cos(rotZ), sinZ = Math.sin(rotZ);
        
        // Project all vertices to 2D
        const projectedVertices = geometry.vertices.map(vertex => {
            // Scale by geometry size
            let x3d = vertex.x * geometrySize;
            let y3d = vertex.y * geometrySize;
            let z3d = vertex.z * geometrySize;
            
            // Apply rotations
            // Rotate around X axis
            let temp = y3d;
            y3d = temp * cosX - z3d * sinX;
            z3d = temp * sinX + z3d * cosX;
            
            // Rotate around Y axis
            temp = x3d;
            x3d = temp * cosY + z3d * sinY;
            z3d = -temp * sinY + z3d * cosY;
            
            // Rotate around Z axis
            temp = x3d;
            x3d = temp * cosZ - y3d * sinZ;
            y3d = temp * sinZ + y3d * cosZ;
            
            // Simple perspective projection with aspect ratio correction
            const distance = 500;
            const projX = centerX + (x3d * distance * 0.5) / (distance + z3d);
            const projY = centerY + (y3d * distance * 0.25) / (distance + z3d);
            
            return [projX, projY, z3d];
        });
        
        // Check if current point is near any edge
        let minDistance = Infinity;
        let closestEdgeDepth = 0;
        
        for (const edge of geometry.edges) {
            const [x1, y1, z1] = projectedVertices[edge.start];
            const [x2, y2, z2] = projectedVertices[edge.end];
            
            // Calculate distance from point to line segment
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.sqrt(dx * dx + dy * dy);
            
            if (len > 0) {
                const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (len * len)));
                const projX = x1 + t * dx;
                const projY = y1 + t * dy;
                const distance = Math.sqrt((x - projX) ** 2 + (y - projY) ** 2);
                
                if (distance < minDistance) {
                    minDistance = distance;
                    closestEdgeDepth = z1 + t * (z2 - z1); // Interpolate depth
                }
            }
        }
        
        // Line thickness based on complexity
        const lineThickness = 2 + complexity * 2;
        
        if (minDistance <= lineThickness) {
            // Intensity based on distance to edge and depth
            let intensity = 1 - (minDistance / lineThickness);
            
            // Depth-based intensity (closer edges are brighter)
            const depthFactor = Math.max(0.3, 1 - (closestEdgeDepth + geometrySize) / (geometrySize * 2));
            intensity *= depthFactor;
            
            return Math.max(0, Math.min(1, intensity));
        }
        
        return 0;
    }, [options.complexity, options.speed, options.geometryType, options.customGeometry, generateGeometry]);

    // Curated font list for randomization
    const curatedFonts = [
        'Arial, sans-serif',
        '"Courier New", Courier, monospace',
        '"Times New Roman", Times, serif',
        '"IBM Plex Mono", monospace'
    ];
    
    // Vibrant color palette for NARA mode
    const vibrantColors = [
        '#00FF41', // Neon green
        '#FF1B8D', // Hot pink
        '#00D9FF', // Hyper blue
        '#FF00FF', // Mega magenta
        '#000000', // Black (for contrast)
        '#FFFF00', // Electric yellow
        '#FF4500', // Orange red
        '#00FFFF'  // Cyan
    ];

    // Cached text bitmap to avoid repeated Canvas API calls
    const textBitmapCache = useRef<{ [key: string]: ImageData | ExtendedBitmapData }>({});
    
    // Text-to-bitmap renderer using Canvas API (with caching)
    const textToBitmap = useCallback((text: string, fontSize: number = 48): ImageData | null => {
        if (typeof window === 'undefined') return null;
        
        const cacheKey = `${text}-${fontSize}`;
        if (textBitmapCache.current[cacheKey]) {
            const cached = textBitmapCache.current[cacheKey];
            return 'imageData' in cached ? cached.imageData : cached;
        }
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        
        // Set up canvas for text measurement
        ctx.font = `${fontSize}px "Courier New", Courier, monospace`;
        ctx.textBaseline = 'top';
        const textMetrics = ctx.measureText(text);
        const textWidth = Math.ceil(textMetrics.width);
        const textHeight = fontSize * 1.2; // Account for descenders
        
        // Resize canvas to fit text with some padding
        canvas.width = textWidth + 4;
        canvas.height = textHeight + 4;
        
        // Clear and redraw with correct settings
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `${fontSize}px "Courier New", Courier, monospace`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'white';
        ctx.fillText(text, 2, 2);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        textBitmapCache.current[cacheKey] = imageData;
        
        return imageData;
    }, []);
    
    // Extended bitmap data that includes color information
    interface ExtendedBitmapData {
        imageData: ImageData;
        colorMap: string[]; // Color for each character
    }
    
    // Multi-font text bitmap renderer for NARA mode
    const textToBitmapMultiFont = useCallback((text: string, fontSize: number = 48, time: number): ExtendedBitmapData | null => {
        if (typeof window === 'undefined') return null;
        
        // Create a unique cache key that includes time (rounded to reduce cache size)
        const timeKey = Math.floor(time * 10) / 10; // Round to 0.1 seconds
        const cacheKey = `${text}-${fontSize}-multifont-${timeKey}`;
        
        if (textBitmapCache.current[cacheKey]) {
            const cached = textBitmapCache.current[cacheKey];
            return 'imageData' in cached ? cached : null;
        }
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        
        // Measure total width needed by measuring each character with its font
        let totalWidth = 0;
        const charMetrics: Array<{char: string, font: string, width: number, color: string}> = [];
        const colorMap: string[] = [];
        
        for (let i = 0; i < text.length; i++) {
            // Use Perlin noise to select font for this character
            // Add time to make it animate, multiply by character index for variation
            const noiseValue = perlinNoise(
                i * 2.5 + time * 0.8, // x: character position + time for animation
                time * 0.6 // y: just time for smooth variation
            );
            
            // Use different noise coordinates for color selection
            const colorNoiseValue = perlinNoise(
                i * 3.0 + time * 0.6, // Different scale for more variety
                time * 0.8 + 10 // Offset to decorrelate from font selection
            );
            
            // Map noise value (-1 to 1) to font index (0 to 3)
            const fontIndex = Math.floor(((noiseValue + 1) / 2) * curatedFonts.length);
            const font = curatedFonts[Math.abs(fontIndex) % curatedFonts.length];
            
            // Map color noise to color index
            const colorIndex = Math.floor(((colorNoiseValue + 1) / 2) * vibrantColors.length);
            const color = vibrantColors[Math.abs(colorIndex) % vibrantColors.length];
            colorMap.push(color);
            
            ctx.font = `${fontSize}px ${font}`;
            const metrics = ctx.measureText(text[i]);
            
            charMetrics.push({
                char: text[i],
                font: font,
                width: Math.ceil(metrics.width),
                color: color
            });
            
            totalWidth += Math.ceil(metrics.width);
        }
        
        const textHeight = fontSize * 1.2;
        
        // Resize canvas to fit all characters
        canvas.width = totalWidth + 8; // Extra padding
        canvas.height = textHeight + 4;
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.textBaseline = 'top';
        
        // Draw each character with its selected font
        let xOffset = 4;
        for (const {char, font, width} of charMetrics) {
            ctx.font = `${fontSize}px ${font}`;
            ctx.fillText(char, xOffset, 2);
            xOffset += width;
        }
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        // Only cache a limited number of frames to avoid memory issues
        const cacheKeys = Object.keys(textBitmapCache.current);
        if (cacheKeys.length > 20) {
            // Remove oldest entries
            const multifonts = cacheKeys.filter(k => k.includes('multifont'));
            if (multifonts.length > 10) {
                delete textBitmapCache.current[multifonts[0]];
            }
        }
        
        const result: ExtendedBitmapData = {
            imageData,
            colorMap
        };
        
        textBitmapCache.current[cacheKey] = result;
        
        return result;
    }, [perlinNoise, vibrantColors]);

    // NARA text stretch distortion effect
    const calculateNara = useCallback((x: number, y: number, time: number, viewportBounds?: {
        startX: number,
        startY: number,
        endX: number,
        endY: number
    }): number => {
        if (!viewportBounds) return 0;
        
        const complexity = options.complexity;
        
        // Use multi-font bitmap for dynamic font swapping
        const textBitmapData = textToBitmapMultiFont("NARA", 120, time);
        if (!textBitmapData) return 0;
        
        const textBitmap = textBitmapData.imageData;
        
        // Calculate viewport dimensions and center
        const viewportWidth = viewportBounds.endX - viewportBounds.startX;
        const viewportHeight = viewportBounds.endY - viewportBounds.startY;
        const centerX = (viewportBounds.startX + viewportBounds.endX) / 2;
        const centerY = (viewportBounds.startY + viewportBounds.endY) / 2;
        
        // Scale text to fit viewport nicely (adjusted for larger font and movement bounds)
        // Using 0.6 to ensure text + movement stays within comfortable bounds
        const scale = (viewportWidth * 0.6) / textBitmap.width;
        
        // Continuous transformation parameters
        const translationSpeed = 0.3; // Speed of text movement
        const morphSpeed = 0.5; // Speed of morphing effects
        
        // Calculate continuous translation offset within 80% viewport bounds
        // This keeps the text from getting too close to edges (10% margin on each side)
        const maxTranslateX = viewportWidth * 0.1; // 10% margin = 80% movement area
        const maxTranslateY = viewportHeight * 0.1; // 10% margin = 80% movement area
        const translateX = Math.sin(time * translationSpeed) * maxTranslateX;
        const translateY = Math.cos(time * translationSpeed * 0.7) * maxTranslateY;
        
        // Optimized bitmap sampling function with continuous transformations
        const sampleTextBitmap = (screenX: number, screenY: number): number => {
            // Transform screen coordinates relative to center
            const relX = screenX - centerX;
            const relY = screenY - centerY;
            
            // Apply continuous translation
            const transX = relX - translateX;
            const transY = relY - translateY;
            
            // Multi-layered noise for smooth morphing
            const noiseScale1 = 0.01 * complexity;
            const noiseScale2 = 0.005 * complexity;
            
            // Use time for continuous noise evolution
            const noiseX1 = perlinNoise(
                transX * noiseScale1 + Math.cos(time * morphSpeed) * 5,
                transY * noiseScale1 + Math.sin(time * morphSpeed) * 5
            );
            const noiseY1 = perlinNoise(
                transX * noiseScale1 + Math.sin(time * morphSpeed * 1.3) * 5,
                transY * noiseScale1 + Math.cos(time * morphSpeed * 1.3) * 5
            );
            
            // Second layer for more complex morphing
            const noiseX2 = perlinNoise(
                transX * noiseScale2 + time * morphSpeed * 0.5,
                transY * noiseScale2 - time * morphSpeed * 0.3
            );
            const noiseY2 = perlinNoise(
                transX * noiseScale2 - time * morphSpeed * 0.3,
                transY * noiseScale2 + time * morphSpeed * 0.5
            );
            
            // Combine noise layers for smooth morphing
            const morphAmount = Math.min(viewportWidth, viewportHeight) * 0.15 * complexity;
            const distortX = (noiseX1 * 0.7 + noiseX2 * 0.3) * morphAmount;
            const distortY = (noiseY1 * 0.7 + noiseY2 * 0.3) * morphAmount;
            
            // Wave distortion that flows continuously
            const waveFreq = 0.02;
            const waveAmp = viewportHeight * 0.05 * complexity;
            const wavePhase = time * 0.8;
            const waveX = Math.sin(transY * waveFreq + wavePhase) * waveAmp;
            const waveY = Math.cos(transX * waveFreq * 0.7 + wavePhase * 1.3) * waveAmp * 0.5;
            
            // Apply all transformations
            const finalX = transX - distortX - waveX;
            const finalY = transY - distortY - waveY;
            
            // Transform to bitmap coordinates
            const bitmapX = Math.floor(finalX / scale + textBitmap.width / 2);
            const bitmapY = Math.floor(finalY / scale + textBitmap.height / 2);
            
            // Hard boundary check - no edge fading
            if (bitmapX < 0 || bitmapX >= textBitmap.width || 
                bitmapY < 0 || bitmapY >= textBitmap.height) {
                return 0; // Clean cutoff, no artifacts
            }
            
            // Sample bitmap directly
            const pixelIndex = (bitmapY * textBitmap.width + bitmapX) * 4;
            let brightness = textBitmap.data[pixelIndex] / 255;
            
            // Safe glow effect - enhance bright pixels without sampling outside bounds
            if (brightness > 0.7) {
                // Boost brightness for strong pixels to create glow effect
                brightness = Math.min(1, brightness * 1.3);
            } else if (brightness > 0.4) {
                // Moderate boost for medium pixels
                brightness = Math.min(1, brightness * 1.1);
            }
            
            return brightness;
        };
        
        // Sample at current position
        let brightness = sampleTextBitmap(x, y);
        
        // Clean trailing effect - only in movement direction and within bounds
        if (brightness < 0.3) {
            const trailDirection = Math.atan2(translateY, translateX);
            const trailLength = 3; // Shorter trail to avoid artifacts
            
            for (let i = 1; i <= trailLength; i++) {
                const trailX = x - Math.cos(trailDirection) * i * 1.5;
                const trailY = y - Math.sin(trailDirection) * i * 1.5;
                
                // Ensure trail positions are within viewport bounds
                if (trailX >= viewportBounds.startX && trailX <= viewportBounds.endX &&
                    trailY >= viewportBounds.startY && trailY <= viewportBounds.endY) {
                    const trailBrightness = sampleTextBitmap(trailX, trailY);
                    if (trailBrightness > 0.2) { // Higher threshold to avoid artifacts
                        brightness = Math.max(brightness, trailBrightness * (0.6 - i * 0.15));
                        break; // Only take the first valid trail pixel
                    }
                }
            }
        }
        
        // More subtle scanline effect to avoid horizontal splits
        const scanlineIntensity = 0.95 + Math.sin(time * 2.5 + y * 0.02) * 0.05;
        brightness *= scanlineIntensity;
        
        // Add subtle flicker for organic feel
        const flicker = 0.95 + Math.sin(time * 15 + x * 0.01) * 0.05;
        brightness *= flicker;
        
        // Add gentle breathing/pulse effect
        const pulse = 0.9 + Math.sin(time * 1.5) * 0.1;
        brightness *= pulse;
        
        return Math.max(0, Math.min(1, brightness));
    }, [options.complexity, perlinNoise, textToBitmapMultiFont]);


    // Main pattern calculation function
    const calculatePattern = useCallback((x: number, y: number, time: number, mode: MonogramMode, viewportBounds?: {
        startX: number,
        startY: number,
        endX: number,
        endY: number
    }): number => {
        switch (mode) {
            case 'plasma': return calculatePlasma(x, y, time);
            case 'perlin': return calculatePerlin(x, y, time);
            case 'nara': return calculateNara(x, y, time, viewportBounds);
            case 'geometry3d': return calculate3DGeometry(x, y, time, viewportBounds);
            default: return calculatePlasma(x, y, time);
        }
    }, [calculatePlasma, calculatePerlin, calculateNara, calculate3DGeometry]);

    // Generate monogram pattern for given viewport bounds
    const generateMonogramPattern = useCallback((
        startWorldX: number,
        startWorldY: number,
        endWorldX: number,
        endWorldY: number
    ): MonogramPattern => {
        if (!options.enabled) return {};

        const pattern: MonogramPattern = {};
        const time = timeRef.current;
        
        // For NARA and 3D geometry modes, use finer sampling for better quality
        const step = (options.mode === 'nara' || options.mode === 'geometry3d') ? 1 : Math.max(1, Math.floor(3 - options.complexity * 2));
        
        for (let worldY = Math.floor(startWorldY); worldY <= Math.ceil(endWorldY); worldY += step) {
            for (let worldX = Math.floor(startWorldX); worldX <= Math.ceil(endWorldX); worldX += step) {
                
                let rawValue: number;
                let intensity: number;
                
                // Special handling for nara and geometry3d modes that need viewport bounds
                if (options.mode === 'nara' || options.mode === 'geometry3d') {
                    const viewportBounds = {
                        startX: startWorldX,
                        startY: startWorldY,
                        endX: endWorldX,
                        endY: endWorldY
                    };
                    rawValue = calculatePattern(worldX, worldY, time, options.mode, viewportBounds);
                    intensity = rawValue;
                } else {
                    rawValue = calculatePattern(worldX, worldY, time, options.mode);
                    intensity = Math.abs(rawValue);
                }
                
                // Skip very low intensity cells for performance
                if ((options.mode === 'nara' || options.mode === 'geometry3d') && intensity < 0.15) continue; // Higher threshold to avoid artifacts
                if (options.mode !== 'nara' && options.mode !== 'geometry3d' && intensity < 0.1) continue;
                
                const char = getCharForIntensity(intensity, options.mode);
                
                let color: string;
                if (options.mode === 'nara') {
                    // Pure black for NARA mode for maximum visibility
                    color = 'black';
                } else if (options.mode === 'geometry3d') {
                    // Monochromatic like NARA mode
                    color = 'black';
                } else {
                    const colorValue = rawValue * Math.PI + time * 0.5;
                    color = getColorFromPalette(colorValue, options.mode);
                }
                
                // For NARA and geometry3d modes, only set the exact position to avoid grid artifacts
                if (options.mode === 'nara' || options.mode === 'geometry3d') {
                    const key = `${worldX},${worldY}`;
                    pattern[key] = {
                        char,
                        color,
                        intensity
                    };
                } else {
                    // Fill in pattern around the calculated point if step > 1
                    for (let dy = 0; dy < step && worldY + dy <= Math.ceil(endWorldY); dy++) {
                        for (let dx = 0; dx < step && worldX + dx <= Math.ceil(endWorldX); dx++) {
                            const key = `${worldX + dx},${worldY + dy}`;
                            pattern[key] = {
                                char,
                                color,
                                intensity: Math.min(1, intensity + Math.random() * 0.1)
                            };
                        }
                    }
                }
            }
        }
        
        return pattern;
    }, [options, calculatePattern, getCharForIntensity, getColorFromPalette]);

    // Cycle to next mode
    const cycleMode = useCallback(() => {
        const modes: MonogramMode[] = ['plasma', 'perlin', 'nara', 'geometry3d'];
        setOptions(prev => {
            const currentIndex = modes.indexOf(prev.mode);
            const nextIndex = (currentIndex + 1) % modes.length;
            return { ...prev, mode: modes[nextIndex] };
        });
    }, []);

    // Toggle enabled state
    const toggleEnabled = useCallback(() => {
        setOptions(prev => ({ ...prev, enabled: !prev.enabled }));
    }, []);

    // Update specific option
    const updateOption = useCallback(<K extends keyof MonogramOptions>(
        key: K, 
        value: MonogramOptions[K] | ((prevValue: MonogramOptions[K]) => MonogramOptions[K])
    ) => {
        setOptions(prev => {
            const newValue = typeof value === 'function' 
                ? (value as (prevValue: MonogramOptions[K]) => MonogramOptions[K])(prev[key])
                : value;
            return { ...prev, [key]: newValue };
        });
    }, []);

    return {
        options,
        generateMonogramPattern,
        cycleMode,
        toggleEnabled,
        updateOption,
        setOptions
    };
};

export { useMonogramSystem };