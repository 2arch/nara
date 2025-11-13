import { useState, useCallback, useRef, useEffect } from 'react';

// --- WebGPU Infinite Procedural Terrain Generator ---
// Like Minecraft world generation - infinite, deterministic, GPU-accelerated
// Given any (x,y) coordinate, computes Perlin noise value
// Canvas samples this at grid cells and renders as ASCII blocks

export interface MonogramOptions {
    enabled: boolean;
    speed: number;
    complexity: number;
}

// WebGPU Compute Shader - Infinite Procedural Perlin Noise Field
const INFINITE_PERLIN_SHADER = `
@group(0) @binding(0) var<storage, read_write> output: array<f32>;
@group(0) @binding(1) var<uniform> params: SamplingParams;

struct SamplingParams {
    gridWidth: u32,
    gridHeight: u32,
    worldStartX: f32,
    worldStartY: f32,
    time: f32,
    complexity: f32,
}

// Infinite procedural noise - works for ANY coordinate
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

// Hash function for infinite terrain - same input always gives same output
fn hash(i: i32) -> u32 {
    var x = u32(i);
    x = ((x >> 16u) ^ x) * 0x45d9f3bu;
    x = ((x >> 16u) ^ x) * 0x45d9f3bu;
    x = (x >> 16u) ^ x;
    return x & 255u;
}

// Infinite Perlin noise - works for any world coordinate
fn infinitePerlinNoise(worldX: f32, worldY: f32) -> f32 {
    let X = i32(floor(worldX));
    let Y = i32(floor(worldY));
    let fx = fract(worldX);
    let fy = fract(worldY);

    let u = fade(fx);
    let v = fade(fy);

    // Hash world coordinates for deterministic randomness
    let a = hash(X) + u32(Y);
    let b = hash(X + 1) + u32(Y);

    let x1 = lerp(u, grad(hash(i32(a)), fx, fy), grad(hash(i32(b)), fx - 1.0, fy));
    let x2 = lerp(u, grad(hash(i32(a + 1u)), fx, fy - 1.0), grad(hash(i32(b + 1u)), fx - 1.0, fy - 1.0));

    return lerp(v, x1, x2);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let gridX = global_id.x;
    let gridY = global_id.y;

    if (gridX >= params.gridWidth || gridY >= params.gridHeight) {
        return;
    }

    // Sample the infinite terrain at this grid cell's world coordinate
    let worldX = params.worldStartX + f32(gridX);
    let worldY = params.worldStartY + f32(gridY);

    let complexity = params.complexity;
    let scale = 1.2 * complexity;
    let time = params.time;

    // Normalized coordinates - scale Y by 0.5 to stretch vertically
    let nx = worldX * 0.02;
    let ny = (worldY * 0.5) * 0.02;

    // Multi-layer infinite Perlin - creates flowing organic patterns
    let flow1 = infinitePerlinNoise(nx * scale + time * 2.0, ny * scale + time);
    let flow2 = infinitePerlinNoise(nx * scale * 2.0 - time, ny * scale * 2.0);

    let dx = nx + flow1 * 0.3 + flow2 * 0.1;
    let dy = ny + flow2 * 0.3 - flow1 * 0.1;

    let intensity1 = infinitePerlinNoise(dx * 2.0, dy * 2.0);
    let intensity2 = infinitePerlinNoise(dx * 3.0 + time, dy * 3.0);

    let rawIntensity = (intensity1 + intensity2 + 2.0) / 4.0;
    let temporalWave = sin(time * 0.5 + nx * 2.0 + ny * 1.5) * 0.05 + 0.95;
    let finalIntensity = clamp(rawIntensity * temporalWave, 0.0, 1.0);

    // Store sampled value
    let index = gridY * params.gridWidth + gridX;
    output[index] = finalIntensity;
}
`;

const useMonogramWebGPU = (initialOptions?: MonogramOptions) => {
    const [options, setOptions] = useState<MonogramOptions>(
        initialOptions || {
            enabled: false,
            speed: 0.5,
            complexity: 1.0
        }
    );

    const deviceRef = useRef<GPUDevice | null>(null);
    const computePipelineRef = useRef<GPUComputePipeline | null>(null);
    const outputBufferRef = useRef<GPUBuffer | null>(null);
    const stagingBufferRef = useRef<GPUBuffer | null>(null);
    const paramsBufferRef = useRef<GPUBuffer | null>(null);

    const timeRef = useRef<number>(0);
    const isInitializedRef = useRef(false);

    // Initialize WebGPU
    useEffect(() => {
        const initWebGPU = async () => {
            if (isInitializedRef.current || !navigator.gpu) return;

            try {
                const adapter = await navigator.gpu.requestAdapter();
                if (!adapter) return;

                const device = await adapter.requestDevice();
                deviceRef.current = device;

                const shaderModule = device.createShaderModule({
                    code: INFINITE_PERLIN_SHADER
                });

                computePipelineRef.current = device.createComputePipeline({
                    layout: 'auto',
                    compute: {
                        module: shaderModule,
                        entryPoint: 'main'
                    }
                });

                isInitializedRef.current = true;
                console.log('WebGPU infinite terrain generator initialized');
            } catch (error) {
                console.error('WebGPU init failed:', error);
            }
        };

        initWebGPU();

        return () => {
            if (outputBufferRef.current) outputBufferRef.current.destroy();
            if (stagingBufferRef.current) stagingBufferRef.current.destroy();
            if (paramsBufferRef.current) paramsBufferRef.current.destroy();
            if (deviceRef.current) deviceRef.current.destroy();
        };
    }, []);

    // Animation loop
    useEffect(() => {
        let animationFrame: number;
        const animate = () => {
            timeRef.current += 0.02 * options.speed;
            animationFrame = requestAnimationFrame(animate);
        };

        if (options.enabled) {
            animationFrame = requestAnimationFrame(animate);
        }

        return () => cancelAnimationFrame(animationFrame);
    }, [options.enabled, options.speed]);

    // Sample the infinite terrain at viewport grid cells
    const sampleTerrain = useCallback(async (
        startWorldX: number,
        startWorldY: number,
        endWorldX: number,
        endWorldY: number
    ): Promise<Float32Array | null> => {
        if (!options.enabled || !isInitializedRef.current || !deviceRef.current || !computePipelineRef.current) {
            return null;
        }

        const device = deviceRef.current;
        const pipeline = computePipelineRef.current;

        const gridWidth = Math.ceil(endWorldX - startWorldX) + 1;
        const gridHeight = Math.ceil(endWorldY - startWorldY) + 1;
        const bufferSize = gridWidth * gridHeight * 4;

        // Create/resize buffers
        if (!outputBufferRef.current || outputBufferRef.current.size !== bufferSize) {
            outputBufferRef.current?.destroy();
            stagingBufferRef.current?.destroy();

            outputBufferRef.current = device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
            });

            stagingBufferRef.current = device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
            });
        }

        // Update sampling parameters
        const paramsData = new Float32Array([
            gridWidth,
            gridHeight,
            Math.floor(startWorldX),
            Math.floor(startWorldY),
            timeRef.current,
            options.complexity
        ]);

        if (!paramsBufferRef.current) {
            paramsBufferRef.current = device.createBuffer({
                size: paramsData.byteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });
        }

        device.queue.writeBuffer(paramsBufferRef.current, 0, paramsData);

        // Execute compute shader
        const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: outputBufferRef.current } },
                { binding: 1, resource: { buffer: paramsBufferRef.current } }
            ]
        });

        const commandEncoder = device.createCommandEncoder();
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(pipeline);
        computePass.setBindGroup(0, bindGroup);
        computePass.dispatchWorkgroups(
            Math.ceil(gridWidth / 8),
            Math.ceil(gridHeight / 8)
        );
        computePass.end();

        commandEncoder.copyBufferToBuffer(
            outputBufferRef.current,
            0,
            stagingBufferRef.current!,
            0,
            bufferSize
        );

        device.queue.submit([commandEncoder.finish()]);

        // Read sampled terrain values
        await stagingBufferRef.current!.mapAsync(GPUMapMode.READ);
        const result = new Float32Array(stagingBufferRef.current!.getMappedRange());
        const intensities = new Float32Array(result); // Copy before unmap
        stagingBufferRef.current!.unmap();

        return intensities;
    }, [options.enabled, options.complexity]);

    const toggleEnabled = useCallback(() => {
        setOptions(prev => ({ ...prev, enabled: !prev.enabled }));
    }, []);

    return {
        options,
        setOptions,
        toggleEnabled,
        sampleTerrain,
        isInitialized: isInitializedRef.current
    };
};

export { useMonogramWebGPU };
