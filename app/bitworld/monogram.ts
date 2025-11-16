// monogram.ts
// WebGPU chunk-based monogram system
// Ephemeral visual layer - never saved to worldData
// Integrates seamlessly with bit.canvas rendering loop

import { useState, useCallback, useRef, useEffect } from 'react';

export interface MonogramOptions {
    enabled: boolean;
    speed: number;
    complexity: number;
    mode: 'clear' | 'perlin'; // clear = only character glows, perlin = perlin noise + glows
}

export interface ArtifactGlow {
    startX: number;      // World X start coordinate
    startY: number;      // World Y start coordinate
    endX: number;        // World X end coordinate
    endY: number;        // World Y end coordinate
}

// WebGPU Compute Shader - Generates 32x32 chunk of Perlin noise
const CHUNK_PERLIN_SHADER = `
@group(0) @binding(0) var<storage, read_write> output: array<f32>;
@group(0) @binding(1) var<uniform> params: ChunkParams;
@group(0) @binding(2) var<storage, read> artifacts: array<vec4<f32>>;

struct ChunkParams {
    chunkWorldX: f32,
    chunkWorldY: f32,
    chunkSize: f32,
    time: f32,
    complexity: f32,
    glowCount: f32,
    mode: f32, // 0.0 = clear (glows only), 1.0 = perlin (noise + glows)
}

fn fade(t: f32) -> f32 {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn lerp(t: f32, a: f32, b: f32) -> f32 {
    return a + t * (b - a);
}

fn grad(hash: u32, x: f32, y: f32) -> f32 {
    let h = hash & 3u;
    let u = select(y, x, h < 2u);
    let v = select(x, y, h < 2u);
    let sign_u = select(u, -u, (h & 1u) == 0u);
    let sign_v = select(v, -v, (h & 2u) == 0u);
    return sign_u + sign_v;
}

fn hash(i: i32) -> u32 {
    var x = u32(i);
    x = ((x >> 16u) ^ x) * 0x45d9f3bu;
    x = ((x >> 16u) ^ x) * 0x45d9f3bu;
    x = (x >> 16u) ^ x;
    return x & 255u;
}

fn perlin(worldX: f32, worldY: f32) -> f32 {
    let X = i32(floor(worldX));
    let Y = i32(floor(worldY));
    let fx = fract(worldX);
    let fy = fract(worldY);

    let u = fade(fx);
    let v = fade(fy);

    let a = hash(X) + u32(Y);
    let b = hash(X + 1) + u32(Y);

    let x1 = lerp(u, grad(hash(i32(a)), fx, fy), grad(hash(i32(b)), fx - 1.0, fy));
    let x2 = lerp(u, grad(hash(i32(a + 1u)), fx, fy - 1.0), grad(hash(i32(b + 1u)), fx - 1.0, fy - 1.0));

    return lerp(v, x1, x2);
}

fn calculateArtifactGlow(worldX: f32, worldY: f32, time: f32) -> f32 {
    let glowCount = u32(params.glowCount);
    var totalGlow = 0.0;

    for (var i = 0u; i < glowCount; i++) {
        let artifact = artifacts[i];
        let startX = artifact.x;
        let startY = artifact.y;
        let endX = artifact.z;
        let endY = artifact.w;

        // Artifacts occupy their full rectangular bounds
        // For isometric rendering, characters span upward (startY-1 to endY)
        let rectLeft = startX;
        let rectRight = endX;
        let rectTop = startY - 1.0;  // Isometric: span upward
        let rectBottom = endY;

        // Clamp current position to rectangle bounds to find nearest point
        let nearestX = clamp(worldX, rectLeft, rectRight);
        let nearestY = clamp(worldY, rectTop, rectBottom);

        // Calculate distance to nearest point on rectangle
        let dx = worldX - nearestX;
        let dy = worldY - nearestY;
        let dist = sqrt(dx * dx + dy * dy);

        // Glow parameters
        let glowRadius = 8.0;  // How far the glow extends
        let strength = 1.0;    // Uniform strength for all artifacts

        // Distance-based falloff (inverse square with smoothing)
        let distFade = clamp(1.0 - (dist / glowRadius), 0.0, 1.0);
        let smoothFade = distFade * distFade * (3.0 - 2.0 * distFade); // Smoothstep

        // Combine strength and distance fade
        let glowContribution = strength * smoothFade * 0.4;
        totalGlow += glowContribution;
    }

    return clamp(totalGlow, 0.0, 1.0);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let localX = global_id.x;
    let localY = global_id.y;
    let chunkSize = u32(params.chunkSize);

    if (localX >= chunkSize || localY >= chunkSize) {
        return;
    }

    let worldX = params.chunkWorldX + f32(localX);
    let worldY = params.chunkWorldY + f32(localY);

    var baseIntensity = 0.0;

    // Only compute perlin noise if mode is 1.0 (perlin mode)
    if (params.mode > 0.5) {
        let scale = 0.03 * params.complexity;  // Smaller scale = more zoomed in, larger features
        let time = params.time;

        let nx = worldX * scale;
        let ny = (worldY * 0.5) * scale;

        let flow1 = perlin(nx + time * 2.0, ny + time);
        let flow2 = perlin(nx * 2.0 - time, ny * 2.0);

        let dx = nx + flow1 * 0.3 + flow2 * 0.1;
        let dy = ny + flow2 * 0.3 - flow1 * 0.1;

        let intensity1 = perlin(dx * 2.0, dy * 2.0);
        let intensity2 = perlin(dx * 3.0 + time, dy * 3.0);

        let rawIntensity = (intensity1 + intensity2 + 2.0) / 4.0;
        let temporalWave = sin(time * 0.5 + nx * 2.0 + ny * 1.5) * 0.05 + 0.95;
        baseIntensity = rawIntensity * temporalWave;
    }

    // Add artifact glow effect (GPU-computed, respects width x 2 cell geometry for all artifacts)
    let glowContribution = calculateArtifactGlow(worldX, worldY, params.time);
    let finalIntensity = clamp(baseIntensity + glowContribution, 0.0, 1.0);

    let index = localY * chunkSize + localX;
    output[index] = finalIntensity;
}
`;

class MonogramSystem {
    private chunks: Map<string, Float32Array> = new Map();
    private device: GPUDevice | null = null;
    private pipeline: GPUComputePipeline | null = null;
    private paramsBuffer: GPUBuffer | null = null;
    private artifactBuffer: GPUBuffer | null = null;
    private isInitialized = false;

    private readonly CHUNK_SIZE = 32;
    private readonly MAX_CHUNKS = 200;
    private readonly MAX_ARTIFACTS = 1000;  // Increased to accommodate many labels/notes
    private chunkAccessTime: Map<string, number> = new Map();

    private time = 0;
    private options: MonogramOptions;
    private artifacts: ArtifactGlow[] = [];

    // Track last viewport for auto-reload on invalidation
    private lastViewport: { startX: number, startY: number, endX: number, endY: number } | null = null;

    constructor(options: MonogramOptions) {
        this.options = options;
    }

    async initialize(): Promise<boolean> {
        if (this.isInitialized || !navigator.gpu) {
            return this.isInitialized;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) return false;

            this.device = await adapter.requestDevice();

            const shaderModule = this.device.createShaderModule({
                code: CHUNK_PERLIN_SHADER
            });

            this.pipeline = this.device.createComputePipeline({
                layout: 'auto',
                compute: {
                    module: shaderModule,
                    entryPoint: 'main'
                }
            });

            this.paramsBuffer = this.device.createBuffer({
                size: 7 * 4,  // 7 floats: chunkWorldX, chunkWorldY, chunkSize, time, complexity, glowCount, mode
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });

            // Create artifact buffer (vec4<f32> per artifact: x, y, width, timestamp)
            this.artifactBuffer = this.device.createBuffer({
                size: this.MAX_ARTIFACTS * 4 * 4,  // 200 artifacts * 4 floats * 4 bytes
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
            });

            this.isInitialized = true;
            console.log('[Monogram] WebGPU initialized');
            return true;
        } catch (error) {
            console.error('[Monogram] WebGPU init failed:', error);
            return false;
        }
    }

    private worldToChunk(worldX: number, worldY: number): string {
        const chunkX = Math.floor(worldX / this.CHUNK_SIZE);
        const chunkY = Math.floor(worldY / this.CHUNK_SIZE);
        return `${chunkX},${chunkY}`;
    }

    private chunkToWorld(chunkKey: string): { x: number, y: number } {
        const [cx, cy] = chunkKey.split(',').map(Number);
        return {
            x: cx * this.CHUNK_SIZE,
            y: cy * this.CHUNK_SIZE
        };
    }

    private async computeChunk(chunkWorldX: number, chunkWorldY: number): Promise<Float32Array> {
        if (!this.device || !this.pipeline || !this.paramsBuffer) {
            throw new Error('[Monogram] Not initialized');
        }

        console.log(`[Monogram] Computing chunk at world (${chunkWorldX}, ${chunkWorldY})`);

        const device = this.device;
        const bufferSize = this.CHUNK_SIZE * this.CHUNK_SIZE * 4;

        const outputBuffer = device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        const stagingBuffer = device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
        });

        const paramsData = new Float32Array([
            chunkWorldX,
            chunkWorldY,
            this.CHUNK_SIZE,
            this.time,
            this.options.complexity,
            this.artifacts.length,  // artifact count
            this.options.mode === 'perlin' ? 1.0 : 0.0  // mode (0.0 = clear, 1.0 = perlin)
        ]);
        device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

        const bindGroup = device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: outputBuffer } },
                { binding: 1, resource: { buffer: this.paramsBuffer } },
                { binding: 2, resource: { buffer: this.artifactBuffer! } }
            ]
        });

        const commandEncoder = device.createCommandEncoder();
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.pipeline);
        computePass.setBindGroup(0, bindGroup);
        computePass.dispatchWorkgroups(
            Math.ceil(this.CHUNK_SIZE / 8),
            Math.ceil(this.CHUNK_SIZE / 8)
        );
        computePass.end();

        commandEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, bufferSize);
        device.queue.submit([commandEncoder.finish()]);

        await stagingBuffer.mapAsync(GPUMapMode.READ);
        const result = new Float32Array(stagingBuffer.getMappedRange());
        const intensities = new Float32Array(result);
        stagingBuffer.unmap();

        outputBuffer.destroy();
        stagingBuffer.destroy();

        // Log sample of computed values
        const sample = Array.from(intensities.slice(0, 10));
        const nonZero = intensities.filter(v => v > 0).length;
        console.log(`[Monogram] Chunk computed: ${nonZero}/${intensities.length} non-zero values, sample:`, sample);

        return intensities;
    }

    private async ensureChunk(chunkKey: string): Promise<Float32Array> {
        // For smooth animation: always recompute chunks with current time
        // No caching - pattern flows continuously like water
        const { x, y } = this.chunkToWorld(chunkKey);
        const intensities = await this.computeChunk(x, y);

        // Store in cache for this frame only (avoids recomputing same chunk multiple times per frame)
        this.chunks.set(chunkKey, intensities);
        this.chunkAccessTime.set(chunkKey, Date.now());

        this.evictOldChunks();

        return intensities;
    }

    private evictOldChunks() {
        if (this.chunks.size <= this.MAX_CHUNKS) return;

        const sorted = Array.from(this.chunkAccessTime.entries())
            .sort((a, b) => a[1] - b[1]);

        const toRemove = sorted.slice(0, sorted.length - this.MAX_CHUNKS);

        for (const [chunkKey] of toRemove) {
            this.chunks.delete(chunkKey);
            this.chunkAccessTime.delete(chunkKey);
        }
    }

    async preloadViewport(startWorldX: number, startWorldY: number, endWorldX: number, endWorldY: number): Promise<void> {
        if (!this.isInitialized || !this.options.enabled) return;

        // Store viewport for auto-reload on animation invalidation
        this.lastViewport = { startX: startWorldX, startY: startWorldY, endX: endWorldX, endY: endWorldY };

        const startChunkX = Math.floor(startWorldX / this.CHUNK_SIZE);
        const endChunkX = Math.floor(endWorldX / this.CHUNK_SIZE);
        const startChunkY = Math.floor(startWorldY / this.CHUNK_SIZE);
        const endChunkY = Math.floor(endWorldY / this.CHUNK_SIZE);

        const promises: Promise<Float32Array>[] = [];

        for (let cy = startChunkY; cy <= endChunkY; cy++) {
            for (let cx = startChunkX; cx <= endChunkX; cx++) {
                const chunkKey = `${cx},${cy}`;
                promises.push(this.ensureChunk(chunkKey));
            }
        }

        await Promise.all(promises);
    }

    sampleAt(worldX: number, worldY: number): number {
        if (!this.options.enabled) return 0;

        const chunkKey = this.worldToChunk(worldX, worldY);
        const chunk = this.chunks.get(chunkKey);

        if (!chunk) return 0;

        const chunkOrigin = this.chunkToWorld(chunkKey);
        const localX = Math.floor(worldX) - chunkOrigin.x;
        const localY = Math.floor(worldY) - chunkOrigin.y;

        if (localX < 0 || localX >= this.CHUNK_SIZE || localY < 0 || localY >= this.CHUNK_SIZE) {
            return 0;
        }

        const index = localY * this.CHUNK_SIZE + localX;
        return chunk[index];
    }

    updateTime(deltaTime: number) {
        this.time += deltaTime * this.options.speed;
        // Smooth animation: time flows continuously
        // Chunks recompute on-demand with current time (no invalidation needed)
    }

    syncArtifacts(artifacts: Array<{ startX: number, startY: number, endX: number, endY: number }>) {
        if (!this.isInitialized || !this.device) return;

        // Replace all artifacts with the new set
        this.artifacts = artifacts.slice(0, this.MAX_ARTIFACTS);

        // Update GPU buffer
        this.updateArtifactBuffer();
    }

    private updateArtifactBuffer() {
        if (!this.device || !this.artifactBuffer) return;

        // Create Float32Array with artifact data (vec4 per artifact: startX, startY, endX, endY)
        const data = new Float32Array(this.MAX_ARTIFACTS * 4);

        for (let i = 0; i < this.artifacts.length; i++) {
            const artifact = this.artifacts[i];
            data[i * 4] = artifact.startX;
            data[i * 4 + 1] = artifact.startY;
            data[i * 4 + 2] = artifact.endX;
            data[i * 4 + 3] = artifact.endY;
        }

        this.device.queue.writeBuffer(this.artifactBuffer, 0, data);
    }

    clearArtifacts() {
        this.artifacts = [];
        this.updateArtifactBuffer();
    }

    setOptions(options: Partial<MonogramOptions>) {
        const complexityChanged = options.complexity !== undefined && options.complexity !== this.options.complexity;
        this.options = { ...this.options, ...options };

        if (complexityChanged) {
            this.chunks.clear();
            this.chunkAccessTime.clear();
        }
    }

    toggleEnabled() {
        this.options.enabled = !this.options.enabled;
    }

    getOptions(): MonogramOptions {
        return { ...this.options };
    }

    isReady(): boolean {
        return this.isInitialized;
    }

    destroy() {
        this.chunks.clear();
        this.chunkAccessTime.clear();
        this.artifacts = [];
        this.paramsBuffer?.destroy();
        this.artifactBuffer?.destroy();
        this.device?.destroy();
        this.isInitialized = false;
    }
}

// React hook
export function useMonogram(initialOptions?: Partial<MonogramOptions>) {
    const [options, setOptions] = useState<MonogramOptions>({
        enabled: initialOptions?.enabled ?? true,
        speed: initialOptions?.speed ?? 0.1,
        complexity: initialOptions?.complexity ?? 1.0,
        mode: initialOptions?.mode ?? 'perlin'
    });

    const systemRef = useRef<MonogramSystem | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);

    useEffect(() => {
        const system = new MonogramSystem(options);
        systemRef.current = system;

        system.initialize().then(success => {
            setIsInitialized(success);
        });

        return () => {
            system.destroy();
        };
    }, []);

    useEffect(() => {
        systemRef.current?.setOptions(options);
    }, [options]);

    useEffect(() => {
        if (!options.enabled) return;

        let lastTime = Date.now();
        let animationFrame: number;

        const animate = () => {
            const now = Date.now();
            const deltaTime = (now - lastTime) / 1000;
            lastTime = now;

            systemRef.current?.updateTime(deltaTime * 5);
            animationFrame = requestAnimationFrame(animate);
        };

        animationFrame = requestAnimationFrame(animate);

        return () => cancelAnimationFrame(animationFrame);
    }, [options.enabled]);

    const preloadViewport = useCallback(async (startX: number, startY: number, endX: number, endY: number) => {
        await systemRef.current?.preloadViewport(startX, startY, endX, endY);
    }, []);

    const sampleAt = useCallback((worldX: number, worldY: number): number => {
        return systemRef.current?.sampleAt(worldX, worldY) ?? 0;
    }, []);

    const toggleEnabled = useCallback(() => {
        setOptions(prev => ({ ...prev, enabled: !prev.enabled }));
    }, []);

    const syncArtifacts = useCallback((artifacts: Array<{ startX: number, startY: number, endX: number, endY: number }>) => {
        systemRef.current?.syncArtifacts(artifacts);
    }, []);

    const clearArtifacts = useCallback(() => {
        systemRef.current?.clearArtifacts();
    }, []);

    return {
        options,
        setOptions,
        toggleEnabled,
        preloadViewport,
        sampleAt,
        syncArtifacts,
        clearArtifacts,
        isInitialized
    };
}
