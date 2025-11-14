// locale.ts
// Locale system - Creates circular regions of influence on the substrate
// Each locale is a semi-permanent bubble that can host interactions

import { useState, useCallback, useRef, useEffect } from 'react';
import glowShader from './shd/glow.wgsl';

export interface Locale {
    id: string;
    center: { x: number; y: number };  // World coordinates (pixel-resolution)
    radius: number;                     // Sphere of influence (pixels)
    createdAt: number;                  // Timestamp
    active: boolean;                    // Is this locale active?
}

export interface LocaleOptions {
    defaultRadius: number;              // Default radius for new locales
    maxLocales: number;                 // Maximum number of simultaneous locales
}

class LocaleSystem {
    private locales: Map<string, Locale> = new Map();
    private device: GPUDevice | null = null;
    private pipeline: GPUComputePipeline | null = null;
    private localeBuffer: GPUBuffer | null = null;
    private paramsBuffer: GPUBuffer | null = null;
    private isInitialized = false;

    private options: LocaleOptions;
    private readonly CHUNK_SIZE = 32;
    private readonly MAX_CHUNKS = 200;
    private chunkCache: Map<string, Float32Array> = new Map();
    private chunkAccessTime: Map<string, number> = new Map();
    private time = 0;

    constructor(options: LocaleOptions) {
        this.options = options;
    }

    async initialize(): Promise<boolean> {
        if (this.isInitialized) return true;

        try {
            if (!navigator.gpu) {
                console.warn('[Locale] WebGPU not supported');
                return false;
            }

            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) return false;

            this.device = await adapter.requestDevice();

            // Create glow compute pipeline
            const shaderModule = this.device.createShaderModule({
                code: glowShader
            });

            this.pipeline = this.device.createComputePipeline({
                layout: 'auto',
                compute: {
                    module: shaderModule,
                    entryPoint: 'main'
                }
            });

            // Create params buffer
            this.paramsBuffer = this.device.createBuffer({
                size: 5 * 4, // 5 floats: chunkWorldX, chunkWorldY, chunkSize, time, localeCount
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });

            // Create locale buffer (stores all locale data for GPU)
            // Each locale: vec4<f32> = (centerX, centerY, radius, active)
            this.localeBuffer = this.device.createBuffer({
                size: this.options.maxLocales * 4 * 4, // maxLocales * 4 floats * 4 bytes
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
            });

            this.isInitialized = true;
            console.log('[Locale] WebGPU initialized');
            return true;
        } catch (error) {
            console.error('[Locale] Failed to initialize WebGPU:', error);
            return false;
        }
    }

    createLocale(worldX: number, worldY: number, radius?: number): Locale {
        const id = `locale_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const locale: Locale = {
            id,
            center: { x: worldX, y: worldY },
            radius: radius || this.options.defaultRadius,
            createdAt: Date.now(),
            active: true
        };

        // Remove oldest locale if at max capacity
        if (this.locales.size >= this.options.maxLocales) {
            const oldestId = Array.from(this.locales.keys())[0];
            this.locales.delete(oldestId);
            console.log('[Locale] Removed oldest locale (at max capacity)');
        }

        this.locales.set(id, locale);
        this.updateGPUBuffer();

        console.log(`[Locale] Created at (${worldX}, ${worldY}) with radius ${locale.radius}`);
        return locale;
    }

    removeLocale(id: string): void {
        if (this.locales.delete(id)) {
            this.updateGPUBuffer();
            console.log(`[Locale] Removed ${id}`);
        }
    }

    clearAllLocales(): void {
        this.locales.clear();
        this.updateGPUBuffer();
        console.log('[Locale] Cleared all locales');
    }

    getLocaleAt(worldX: number, worldY: number): Locale | null {
        // Find locale that contains this point (within its radius)
        for (const locale of this.locales.values()) {
            if (this.isPointInLocale(worldX, worldY, locale)) {
                return locale;
            }
        }
        return null;
    }

    isPointInLocale(worldX: number, worldY: number, locale: Locale): boolean {
        const dx = worldX - locale.center.x;
        const dy = worldY - locale.center.y;
        const distanceSq = dx * dx + dy * dy;
        return distanceSq <= locale.radius * locale.radius;
    }

    getAllLocales(): Locale[] {
        return Array.from(this.locales.values());
    }

    getActiveLocales(): Locale[] {
        return Array.from(this.locales.values()).filter(l => l.active);
    }

    private updateGPUBuffer(): void {
        if (!this.device || !this.localeBuffer) return;

        // Pack locale data into Float32Array for GPU
        // Format: [centerX, centerY, radius, active] per locale
        const data = new Float32Array(this.options.maxLocales * 4);

        const locales = Array.from(this.locales.values());
        for (let i = 0; i < locales.length && i < this.options.maxLocales; i++) {
            const locale = locales[i];
            data[i * 4] = locale.center.x;
            data[i * 4 + 1] = locale.center.y;
            data[i * 4 + 2] = locale.radius;
            data[i * 4 + 3] = locale.active ? 1.0 : 0.0;
        }

        this.device.queue.writeBuffer(this.localeBuffer, 0, data);
    }

    // Sample glow intensity at a world position
    // Returns 0.0-1.0 based on distance to nearest locale
    sampleAt(worldX: number, worldY: number): number {
        let maxIntensity = 0.0;

        for (const locale of this.locales.values()) {
            if (!locale.active) continue;

            const dx = worldX - locale.center.x;
            const dy = worldY - locale.center.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance <= locale.radius) {
                // Smooth falloff (inverse square with smoothing)
                const normalizedDist = distance / locale.radius;
                const fade = 1.0 - normalizedDist;
                const smoothFade = fade * fade * (3.0 - 2.0 * fade); // Smoothstep

                maxIntensity = Math.max(maxIntensity, smoothFade);
            }
        }

        return maxIntensity;
    }

    // Compute glow intensity for a chunk using GPU
    private async computeChunk(chunkWorldX: number, chunkWorldY: number): Promise<Float32Array> {
        if (!this.device || !this.pipeline || !this.paramsBuffer || !this.localeBuffer) {
            return new Float32Array(this.CHUNK_SIZE * this.CHUNK_SIZE);
        }

        const device = this.device;
        const outputBuffer = device.createBuffer({
            size: this.CHUNK_SIZE * this.CHUNK_SIZE * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        const stagingBuffer = device.createBuffer({
            size: this.CHUNK_SIZE * this.CHUNK_SIZE * 4,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
        });

        // Update params
        const paramsData = new Float32Array([
            chunkWorldX,
            chunkWorldY,
            this.CHUNK_SIZE,
            this.time,
            this.locales.size
        ]);
        device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

        const bindGroup = device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: outputBuffer } },
                { binding: 1, resource: { buffer: this.paramsBuffer } },
                { binding: 2, resource: { buffer: this.localeBuffer } }
            ]
        });

        const encoder = device.createCommandEncoder();
        const computePass = encoder.beginComputePass();
        computePass.setPipeline(this.pipeline);
        computePass.setBindGroup(0, bindGroup);
        computePass.dispatchWorkgroups(
            Math.ceil(this.CHUNK_SIZE / 8),
            Math.ceil(this.CHUNK_SIZE / 8)
        );
        computePass.end();

        encoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, this.CHUNK_SIZE * this.CHUNK_SIZE * 4);
        device.queue.submit([encoder.finish()]);

        await stagingBuffer.mapAsync(GPUMapMode.READ);
        const result = new Float32Array(stagingBuffer.getMappedRange()).slice();
        stagingBuffer.unmap();

        outputBuffer.destroy();
        stagingBuffer.destroy();

        return result;
    }

    // Get or compute chunk
    async getChunk(chunkWorldX: number, chunkWorldY: number): Promise<Float32Array> {
        const key = `${chunkWorldX},${chunkWorldY}`;

        // Return cached chunk
        if (this.chunkCache.has(key)) {
            this.chunkAccessTime.set(key, Date.now());
            return this.chunkCache.get(key)!;
        }

        // Compute new chunk
        const chunk = await this.computeChunk(chunkWorldX * this.CHUNK_SIZE, chunkWorldY * this.CHUNK_SIZE);

        // Cache management
        if (this.chunkCache.size >= this.MAX_CHUNKS) {
            let oldestKey: string | null = null;
            let oldestTime = Infinity;
            for (const [k, time] of this.chunkAccessTime) {
                if (time < oldestTime) {
                    oldestTime = time;
                    oldestKey = k;
                }
            }
            if (oldestKey) {
                this.chunkCache.delete(oldestKey);
                this.chunkAccessTime.delete(oldestKey);
            }
        }

        this.chunkCache.set(key, chunk);
        this.chunkAccessTime.set(key, Date.now());

        return chunk;
    }

    // Preload viewport chunks
    async preloadViewport(startWorldX: number, startWorldY: number, endWorldX: number, endWorldY: number): Promise<void> {
        if (!this.isInitialized) return;

        const startChunkX = Math.floor(startWorldX / this.CHUNK_SIZE);
        const endChunkX = Math.floor(endWorldX / this.CHUNK_SIZE);
        const startChunkY = Math.floor(startWorldY / this.CHUNK_SIZE);
        const endChunkY = Math.floor(endWorldY / this.CHUNK_SIZE);

        const promises: Promise<void>[] = [];
        for (let cy = startChunkY; cy <= endChunkY; cy++) {
            for (let cx = startChunkX; cx <= endChunkX; cx++) {
                promises.push(this.getChunk(cx, cy).then(() => {}));
            }
        }

        await Promise.all(promises);
    }

    // Update animation time
    update(deltaTime: number): void {
        this.time += deltaTime;
        // Invalidate chunks when time changes (for pulse animation)
        // In practice, may want to throttle this
        this.chunkCache.clear();
    }

    destroy(): void {
        this.locales.clear();
        this.chunkCache.clear();
        this.chunkAccessTime.clear();
        this.localeBuffer?.destroy();
        this.paramsBuffer?.destroy();
        this.device?.destroy();
        this.isInitialized = false;
    }
}

// React hook for locale system
export function useLocale(initialOptions?: Partial<LocaleOptions>) {
    const defaultOptions: LocaleOptions = {
        defaultRadius: 64,
        maxLocales: 10
    };

    const options = { ...defaultOptions, ...initialOptions };
    const systemRef = useRef<LocaleSystem | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const [locales, setLocales] = useState<Locale[]>([]);

    // Initialize system
    useEffect(() => {
        if (!systemRef.current) {
            systemRef.current = new LocaleSystem(options);
            systemRef.current.initialize().then(success => {
                setIsInitialized(success);
            });
        }

        return () => {
            systemRef.current?.destroy();
            systemRef.current = null;
        };
    }, []);

    const createLocale = useCallback((worldX: number, worldY: number, radius?: number) => {
        if (!systemRef.current) return null;
        const locale = systemRef.current.createLocale(worldX, worldY, radius);
        setLocales(systemRef.current.getAllLocales());
        return locale;
    }, []);

    const removeLocale = useCallback((id: string) => {
        systemRef.current?.removeLocale(id);
        setLocales(systemRef.current?.getAllLocales() || []);
    }, []);

    const clearAll = useCallback(() => {
        systemRef.current?.clearAllLocales();
        setLocales([]);
    }, []);

    const getLocaleAt = useCallback((worldX: number, worldY: number): Locale | null => {
        return systemRef.current?.getLocaleAt(worldX, worldY) || null;
    }, []);

    const sampleAt = useCallback((worldX: number, worldY: number): number => {
        return systemRef.current?.sampleAt(worldX, worldY) || 0.0;
    }, []);

    const preloadViewport = useCallback(async (startX: number, startY: number, endX: number, endY: number) => {
        await systemRef.current?.preloadViewport(startX, startY, endX, endY);
    }, []);

    const update = useCallback((deltaTime: number) => {
        systemRef.current?.update(deltaTime);
    }, []);

    return {
        locales,
        createLocale,
        removeLocale,
        clearAll,
        getLocaleAt,
        sampleAt,
        preloadViewport,
        update,
        isInitialized
    };
}
