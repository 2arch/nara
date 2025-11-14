// monogram.ts
// WebGPU chunk-based monogram system
// Ephemeral visual layer - never saved to worldData
// Integrates seamlessly with bit.canvas rendering loop

import { useState, useCallback, useRef, useEffect } from 'react';
import perlinShader from './shd/perlin.wgsl?raw';

export interface MonogramOptions {
    enabled: boolean;
    speed: number;
    complexity: number;
    mode: 'clear' | 'perlin';
}

class MonogramSystem {
    private chunks: Map<string, Float32Array> = new Map();
    private device: GPUDevice | null = null;
    private pipeline: GPUComputePipeline | null = null;
    private paramsBuffer: GPUBuffer | null = null;
    private isInitialized = false;

    private readonly CHUNK_SIZE = 32;
    private readonly MAX_CHUNKS = 200;
    private chunkAccessTime: Map<string, number> = new Map();

    private time = 0;
    private options: MonogramOptions;

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
                code: perlinShader
            });

            this.pipeline = this.device.createComputePipeline({
                layout: 'auto',
                compute: {
                    module: shaderModule,
                    entryPoint: 'main'
                }
            });

            this.paramsBuffer = this.device.createBuffer({
                size: 6 * 4,  // 6 floats: chunkWorldX, chunkWorldY, chunkSize, time, complexity, mode
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
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
            this.options.mode === 'perlin' ? 1.0 : 0.0  // mode (0.0 = clear, 1.0 = perlin)
        ]);
        device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

        const bindGroup = device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: outputBuffer } },
                { binding: 1, resource: { buffer: this.paramsBuffer } }
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
        this.paramsBuffer?.destroy();
        this.device?.destroy();
        this.isInitialized = false;
    }
}

// React hook
export function useMonogram(initialOptions?: Partial<MonogramOptions>) {
    const [options, setOptions] = useState<MonogramOptions>({
        enabled: initialOptions?.enabled ?? true,
        speed: initialOptions?.speed ?? 0.5,
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

            systemRef.current?.updateTime(deltaTime * 20);
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

    return {
        options,
        setOptions,
        toggleEnabled,
        preloadViewport,
        sampleAt,
        isInitialized
    };
}
