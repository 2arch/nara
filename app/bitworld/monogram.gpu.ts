import { useState, useCallback, useRef, useEffect } from 'react';
import type { Point } from './world.engine';

// Trail position interface for interactive monogram trails
interface MonogramTrailPosition {
    x: number;
    y: number;
    timestamp: number;
    intensity: number;
}

// --- Monogram Pattern Types ---
export type MonogramMode = 'clear' | 'perlin';

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
    // Interactive trail options
    interactiveTrails: boolean; // Enable mouse interaction trails
    trailIntensity: number; // Trail effect intensity (0.1 - 2.0)
    trailFadeMs: number; // Trail fade duration in milliseconds
}

// WebGPU Perlin Noise Compute Shader
const PERLIN_SHADER = `
@group(0) @binding(0) var<storage, read_write> output: array<f32>;
@group(0) @binding(1) var<uniform> params: PerlinParams;

struct PerlinParams {
    width: u32,
    height: u32,
    time: f32,
    complexity: f32,
    offsetX: f32,
    offsetY: f32,
}

// Perlin noise fade function
fn fade(t: f32) -> f32 {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

// Linear interpolation
fn lerp(t: f32, a: f32, b: f32) -> f32 {
    return a + t * (b - a);
}

// Gradient function using hash
fn grad(hash: u32, x: f32, y: f32) -> f32 {
    let h = hash & 3u;
    let u = select(y, x, h < 2u);
    let v = select(x, y, h < 2u);
    let sign_u = select(u, -u, (h & 1u) == 0u);
    let sign_v = select(v, -v, (h & 2u) == 0u);
    return sign_u + sign_v;
}

// Simplified permutation using sin-based hash
fn perm(i: u32) -> u32 {
    let fi = f32(i);
    return u32(floor(abs(sin(fi * 12.9898) * 43758.5453) * 256.0)) & 255u;
}

// Perlin noise implementation
fn perlinNoise(x: f32, y: f32) -> f32 {
    let X = u32(floor(x)) & 255u;
    let Y = u32(floor(y)) & 255u;
    let fx = fract(x);
    let fy = fract(y);

    let u = fade(fx);
    let v = fade(fy);

    let a = perm(X) + Y;
    let b = perm(X + 1u) + Y;

    let x1 = lerp(u, grad(perm(a), fx, fy), grad(perm(b), fx - 1.0, fy));
    let x2 = lerp(u, grad(perm(a + 1u), fx, fy - 1.0), grad(perm(b + 1u), fx - 1.0, fy - 1.0));

    return lerp(v, x1, x2);
}

// Main compute shader entry point
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;

    if (x >= params.width || y >= params.height) {
        return;
    }

    let complexity = params.complexity;
    let scale = 1.2 * complexity;
    let time = params.time;

    // World coordinates with offset
    let worldX = f32(x) + params.offsetX;
    let worldY = f32(y) + params.offsetY;

    // Normalized coordinates - scale Y by 0.5 to stretch pattern vertically
    let nx = worldX * 0.02;
    let ny = (worldY * 0.5) * 0.02;

    // Create flowing distortion using layered noise
    let flow1 = perlinNoise(nx * scale + time * 2.0, ny * scale + time);
    let flow2 = perlinNoise(nx * scale * 2.0 - time, ny * scale * 2.0);

    // Combine flows for complex movement
    let dx = nx + flow1 * 0.3 + flow2 * 0.1;
    let dy = ny + flow2 * 0.3 - flow1 * 0.1;

    // Sample noise at distorted position for intensity
    let intensity1 = perlinNoise(dx * 2.0, dy * 2.0);
    let intensity2 = perlinNoise(dx * 3.0 + time, dy * 3.0);

    // Combine intensities and normalize
    let rawIntensity = (intensity1 + intensity2 + 2.0) / 4.0;

    // Add temporal variation
    let temporalWave = sin(time * 0.5 + nx * 2.0 + ny * 1.5) * 0.05 + 0.95;

    let finalIntensity = clamp(rawIntensity * temporalWave, 0.0, 1.0);

    // Write to output buffer
    let index = y * params.width + x;
    output[index] = finalIntensity;
}
`;

// WebGPU initialization and compute system
const useMonogramGPU = (
    initialOptions?: MonogramOptions,
    onOptionsChange?: (options: MonogramOptions) => void
) => {
    const [options, setOptions] = useState<MonogramOptions>(
        initialOptions || {
            mode: 'clear',
            speed: 0.5,
            complexity: 1.0,
            colorShift: 0,
            enabled: false,
            interactiveTrails: true,
            trailIntensity: 1.0,
            trailFadeMs: 2000
        }
    );

    // Mouse trail tracking
    const [mouseTrail, setMouseTrail] = useState<MonogramTrailPosition[]>([]);
    const lastMousePosRef = useRef<Point | null>(null);

    const timeRef = useRef<number>(0);
    const animationFrameRef = useRef<number>(0);

    // WebGPU resources
    const deviceRef = useRef<GPUDevice | null>(null);
    const pipelineRef = useRef<GPUComputePipeline | null>(null);
    const bindGroupRef = useRef<GPUBindGroup | null>(null);
    const outputBufferRef = useRef<GPUBuffer | null>(null);
    const stagingBufferRef = useRef<GPUBuffer | null>(null);
    const paramsBufferRef = useRef<GPUBuffer | null>(null);
    const gpuSupportedRef = useRef<boolean | null>(null);

    // Cache for last computed pattern (for synchronous access)
    const patternCacheRef = useRef<MonogramPattern>({});
    const lastBoundsRef = useRef<{startX: number, startY: number, endX: number, endY: number} | null>(null);
    const isComputingRef = useRef(false);
    const pendingComputeRef = useRef<{bounds: {startX: number, startY: number, endX: number, endY: number}, textColor: string} | null>(null);

    // CPU fallback: Perlin noise implementation
    const perlinNoiseCPU = useCallback((x: number, y: number): number => {
        const grad = (hash: number, x: number, y: number) => {
            const h = hash & 3;
            const u = h < 2 ? x : y;
            const v = h < 2 ? y : x;
            return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
        };

        const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
        const lerp = (t: number, a: number, b: number) => a + t * (b - a);

        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const fx = x - Math.floor(x);
        const fy = y - Math.floor(y);

        const perm = (i: number) => Math.floor(Math.abs(Math.sin(i * 12.9898) * 43758.5453) * 256) & 255;

        const u = fade(fx);
        const v = fade(fy);

        const a = perm(X) + Y;
        const b = perm(X + 1) + Y;

        const x1 = lerp(u, grad(perm(a), fx, fy), grad(perm(b), fx - 1, fy));
        const x2 = lerp(u, grad(perm(a + 1), fx, fy - 1), grad(perm(b + 1), fx - 1, fy - 1));

        return lerp(v, x1, x2);
    }, []);

    const calculatePerlinCPU = useCallback((x: number, y: number, time: number): number => {
        const complexity = options.complexity;
        const scale = 1.2 * complexity;

        const nx = x * 0.02;
        const ny = (y * 0.5) * 0.02;

        const flow1 = perlinNoiseCPU(nx * scale + time * 2, ny * scale + time);
        const flow2 = perlinNoiseCPU(nx * scale * 2 - time, ny * scale * 2);

        const dx = nx + flow1 * 0.3 + flow2 * 0.1;
        const dy = ny + flow2 * 0.3 - flow1 * 0.1;

        const intensity1 = perlinNoiseCPU(dx * 2, dy * 2);
        const intensity2 = perlinNoiseCPU(dx * 3 + time, dy * 3);

        const rawIntensity = (intensity1 + intensity2 + 2) / 4;
        const temporalWave = Math.sin(time * 0.5 + nx * 2 + ny * 1.5) * 0.05 + 0.95;

        return Math.max(0, Math.min(1, rawIntensity * temporalWave));
    }, [options.complexity, perlinNoiseCPU]);

    // Initialize WebGPU
    useEffect(() => {
        const initWebGPU = async () => {
            if (!navigator.gpu) {
                console.warn('WebGPU not supported, falling back to CPU');
                gpuSupportedRef.current = false;
                return;
            }

            try {
                const adapter = await navigator.gpu.requestAdapter();
                if (!adapter) {
                    console.warn('No WebGPU adapter found, falling back to CPU');
                    gpuSupportedRef.current = false;
                    return;
                }

                const device = await adapter.requestDevice();
                deviceRef.current = device;

                // Create compute pipeline
                const shaderModule = device.createShaderModule({
                    code: PERLIN_SHADER
                });

                const pipeline = device.createComputePipeline({
                    layout: 'auto',
                    compute: {
                        module: shaderModule,
                        entryPoint: 'main'
                    }
                });

                pipelineRef.current = pipeline;
                gpuSupportedRef.current = true;

                console.log('WebGPU initialized successfully');
            } catch (error) {
                console.error('Failed to initialize WebGPU:', error);
                gpuSupportedRef.current = false;
            }
        };

        initWebGPU();

        return () => {
            // Cleanup WebGPU resources
            if (outputBufferRef.current) outputBufferRef.current.destroy();
            if (stagingBufferRef.current) stagingBufferRef.current.destroy();
            if (paramsBufferRef.current) paramsBufferRef.current.destroy();
            if (deviceRef.current) deviceRef.current.destroy();
        };
    }, []);

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

    // Sync with external options changes
    useEffect(() => {
        if (initialOptions) {
            setOptions(initialOptions);
        }
    }, []);

    const isInitialMount = useRef(true);
    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }
        if (onOptionsChange) {
            onOptionsChange(options);
        }
    }, [options]);

    // Update mouse position for interactive trails
    const updateMousePosition = useCallback((worldPos: Point) => {
        if (!options.interactiveTrails) return;

        const currentPos = worldPos;

        if (!lastMousePosRef.current ||
            Math.abs(currentPos.x - lastMousePosRef.current.x) > 0.5 ||
            Math.abs(currentPos.y - lastMousePosRef.current.y) > 0.5) {

            setMouseTrail(prev => {
                const now = Date.now();
                const intensity = options.trailIntensity * (0.8 + Math.random() * 0.4);
                const newTrail = [...prev, {
                    x: currentPos.x,
                    y: currentPos.y,
                    timestamp: now,
                    intensity
                }];

                return newTrail.filter(pos => now - pos.timestamp < options.trailFadeMs);
            });

            lastMousePosRef.current = currentPos;
        }
    }, [options.interactiveTrails, options.trailIntensity, options.trailFadeMs]);

    // Clean up old trail positions
    useEffect(() => {
        if (!options.interactiveTrails) {
            setMouseTrail([]);
            return;
        }

        const cleanup = setInterval(() => {
            const now = Date.now();
            setMouseTrail(prev => prev.filter(pos => now - pos.timestamp < options.trailFadeMs));
        }, 200);

        return () => clearInterval(cleanup);
    }, [options.interactiveTrails, options.trailFadeMs]);

    // Character sets for different intensities
    const getCharForIntensity = useCallback((intensity: number): string => {
        const chars = [' ', '░', '▒', '▓', '█'];
        const index = Math.floor(intensity * (chars.length - 1));
        return chars[Math.min(index, chars.length - 1)];
    }, []);

    // Get color from palette based on value
    const getColorFromPalette = useCallback((value: number, accentColor: string): string => {
        const opacity = 0.5 + (value % 1) * 0.5;

        const hex = accentColor.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }, []);

    // Calculate trail effect
    const calculateTrailEffect = useCallback((x: number, y: number): number => {
        if (!options.interactiveTrails || mouseTrail.length < 2) return 0;

        const now = Date.now();
        let maxTrailIntensity = 0;

        for (let i = 0; i < mouseTrail.length - 1; i++) {
            const currentPos = mouseTrail[i];
            const nextPos = mouseTrail[i + 1];

            const age = now - currentPos.timestamp;
            if (age > options.trailFadeMs) continue;

            const dx = nextPos.x - currentPos.x;
            const dy = nextPos.y - currentPos.y;
            const segmentLength = Math.sqrt(dx * dx + dy * dy);

            if (segmentLength > 0) {
                const scaledY = y * 0.5;
                const scaledCurrentPosY = currentPos.y * 0.5;
                const scaledNextPosY = nextPos.y * 0.5;
                const scaledDy = scaledNextPosY - scaledCurrentPosY;
                const scaledSegmentLength = Math.sqrt(dx * dx + scaledDy * scaledDy);

                const t = Math.max(0, Math.min(1, ((x - currentPos.x) * dx + (scaledY - scaledCurrentPosY) * scaledDy) / (scaledSegmentLength * scaledSegmentLength)));
                const projX = currentPos.x + t * dx;
                const projY = currentPos.y + t * dy;

                const distance = Math.sqrt((x - projX) ** 2 + ((y * 0.5) - (projY * 0.5)) ** 2);

                const ageFactor = 1 - (age / options.trailFadeMs);
                const trailWidth = 1.5 + options.complexity * 1.5 * ageFactor;

                if (distance <= trailWidth) {
                    const distanceFade = 1 - (distance / trailWidth);
                    const pathFade = ageFactor;
                    const positionFactor = i / Math.max(1, mouseTrail.length - 1);
                    const cometFade = 0.3 + 0.7 * positionFactor;

                    const trailIntensity = distanceFade * pathFade * cometFade * options.trailIntensity;
                    maxTrailIntensity = Math.max(maxTrailIntensity, trailIntensity);
                }
            }
        }

        return Math.min(1, maxTrailIntensity);
    }, [options.interactiveTrails, options.trailFadeMs, options.complexity, options.trailIntensity, mouseTrail]);

    // Async GPU compute function (runs in background)
    const computePatternGPU = useCallback(async (
        startWorldX: number,
        startWorldY: number,
        endWorldX: number,
        endWorldY: number,
        textColor: string
    ): Promise<void> => {
        if (isComputingRef.current || !gpuSupportedRef.current || !deviceRef.current || !pipelineRef.current) {
            return;
        }

        isComputingRef.current = true;

        try {
            const device = deviceRef.current;
            const pipeline = pipelineRef.current;
            const time = timeRef.current;
            const accentColor = textColor;

            const width = Math.ceil(endWorldX - startWorldX) + 1;
            const height = Math.ceil(endWorldY - startWorldY) + 1;
            const bufferSize = width * height * 4; // f32 = 4 bytes

            // Create or recreate buffers if size changed
            if (!outputBufferRef.current || outputBufferRef.current.size !== bufferSize) {
                if (outputBufferRef.current) outputBufferRef.current.destroy();
                if (stagingBufferRef.current) stagingBufferRef.current.destroy();

                outputBufferRef.current = device.createBuffer({
                    size: bufferSize,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
                });

                stagingBufferRef.current = device.createBuffer({
                    size: bufferSize,
                    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
                });
            }

            // Create or update params buffer
            const paramsData = new Float32Array([
                width,
                height,
                time,
                options.complexity,
                startWorldX,
                startWorldY
            ]);

            if (!paramsBufferRef.current) {
                paramsBufferRef.current = device.createBuffer({
                    size: paramsData.byteLength,
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
                });
            }

            device.queue.writeBuffer(paramsBufferRef.current, 0, paramsData);

            // Create bind group
            const bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: outputBufferRef.current } },
                    { binding: 1, resource: { buffer: paramsBufferRef.current } }
                ]
            });

            // Dispatch compute shader
            const commandEncoder = device.createCommandEncoder();
            const passEncoder = commandEncoder.beginComputePass();
            passEncoder.setPipeline(pipeline);
            passEncoder.setBindGroup(0, bindGroup);
            passEncoder.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
            passEncoder.end();

            // Copy to staging buffer
            commandEncoder.copyBufferToBuffer(
                outputBufferRef.current!,
                0,
                stagingBufferRef.current!,
                0,
                bufferSize
            );

            device.queue.submit([commandEncoder.finish()]);

            // Read results
            await stagingBufferRef.current!.mapAsync(GPUMapMode.READ);
            const resultData = new Float32Array(stagingBufferRef.current!.getMappedRange());

            // Convert GPU output to pattern
            const pattern: MonogramPattern = {};
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = y * width + x;
                    const intensity = resultData[idx];

                    // Add trail effect
                    const worldX = startWorldX + x;
                    const worldY = startWorldY + y;
                    const trailEffect = calculateTrailEffect(worldX, worldY);
                    const finalIntensity = Math.max(intensity, trailEffect);

                    if (finalIntensity < 0.05) continue;

                    const char = getCharForIntensity(finalIntensity);
                    const color = trailEffect > 0.1
                        ? `rgba(${parseInt(accentColor.substring(1, 3), 16)}, ${parseInt(accentColor.substring(3, 5), 16)}, ${parseInt(accentColor.substring(5, 7), 16)}, ${0.2 + trailEffect * 0.6})`
                        : getColorFromPalette(intensity * Math.PI + time * 0.5, accentColor);

                    const key = `${worldX},${worldY}`;
                    pattern[key] = { char, color, intensity: finalIntensity };
                }
            }

            stagingBufferRef.current!.unmap();

            // Update cache
            patternCacheRef.current = pattern;
            lastBoundsRef.current = { startX: startWorldX, startY: startWorldY, endX: endWorldX, endY: endWorldY };

        } catch (error) {
            console.error('GPU compute failed:', error);
            gpuSupportedRef.current = false;
        } finally {
            isComputingRef.current = false;
        }
    }, [options.complexity, calculateTrailEffect, getCharForIntensity, getColorFromPalette]);

    // Generate monogram pattern (synchronous with GPU background compute)
    const generateMonogramPattern = useCallback((
        startWorldX: number,
        startWorldY: number,
        endWorldX: number,
        endWorldY: number,
        textColor?: string
    ): MonogramPattern => {
        if (!options.enabled || options.mode === 'clear') return {};

        const accentColor = textColor || '#000000';
        const time = timeRef.current;

        // Check if we can use GPU
        if (gpuSupportedRef.current && options.mode === 'perlin') {
            // Schedule GPU compute in background if bounds changed
            const boundsChanged = !lastBoundsRef.current ||
                lastBoundsRef.current.startX !== startWorldX ||
                lastBoundsRef.current.startY !== startWorldY ||
                lastBoundsRef.current.endX !== endWorldX ||
                lastBoundsRef.current.endY !== endWorldY;

            if (boundsChanged && !isComputingRef.current) {
                // Trigger async GPU compute
                computePatternGPU(startWorldX, startWorldY, endWorldX, endWorldY, accentColor);
            }

            // Return cached pattern if available
            if (patternCacheRef.current && Object.keys(patternCacheRef.current).length > 0) {
                return patternCacheRef.current;
            }
        }

        // CPU fallback (or first frame before GPU completes)
        const pattern: MonogramPattern = {};
        for (let worldY = Math.floor(startWorldY); worldY <= Math.ceil(endWorldY); worldY++) {
            for (let worldX = Math.floor(startWorldX); worldX <= Math.ceil(endWorldX); worldX++) {
                const intensity = options.mode === 'perlin' ? calculatePerlinCPU(worldX, worldY, time) : 0;
                const trailEffect = calculateTrailEffect(worldX, worldY);
                const finalIntensity = Math.max(intensity, trailEffect);

                if (finalIntensity < 0.05) continue;

                const char = getCharForIntensity(finalIntensity);
                const color = trailEffect > 0.1
                    ? `rgba(${parseInt(accentColor.substring(1, 3), 16)}, ${parseInt(accentColor.substring(3, 5), 16)}, ${parseInt(accentColor.substring(5, 7), 16)}, ${0.2 + trailEffect * 0.6})`
                    : getColorFromPalette(intensity * Math.PI + time * 0.5, accentColor);

                const key = `${worldX},${worldY}`;
                pattern[key] = { char, color, intensity: finalIntensity };
            }
        }

        return pattern;
    }, [options, calculatePerlinCPU, calculateTrailEffect, getCharForIntensity, getColorFromPalette, computePatternGPU]);

    // Cycle mode
    const cycleMode = useCallback(() => {
        setOptions(prev => {
            if (!prev.enabled) {
                return { ...prev, enabled: true, mode: 'perlin' };
            }
            // Only perlin and clear modes now
            if (prev.mode === 'perlin') {
                return { ...prev, enabled: false, mode: 'clear' };
            }
            return { ...prev, enabled: true, mode: 'perlin' };
        });
    }, []);

    const toggleEnabled = useCallback(() => {
        setOptions(prev => ({ ...prev, enabled: !prev.enabled }));
    }, []);

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
        setOptions,
        updateMousePosition,
        mouseTrail,
        gpuSupported: gpuSupportedRef.current
    };
};

export { useMonogramGPU };
