// Perlin Noise Compute Shader
// Generates 32x32 chunk of flowing Perlin noise

@group(0) @binding(0) var<storage, read_write> output: array<f32>;
@group(0) @binding(1) var<uniform> params: ChunkParams;

struct ChunkParams {
    chunkWorldX: f32,
    chunkWorldY: f32,
    chunkSize: f32,
    time: f32,
    complexity: f32,
    mode: f32, // 0.0 = clear, 1.0 = perlin
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

    var intensity = 0.0;

    // Only compute perlin noise if mode is 1.0 (perlin mode)
    if (params.mode > 0.5) {
        let scale = 1.0 * params.complexity;
        let time = params.time;

        let nx = worldX * scale;
        let ny = worldY * scale;

        let flow1 = perlin(nx + time * 2.0, ny + time);
        let flow2 = perlin(nx * 2.0 - time, ny * 2.0);

        let dx = nx + flow1 * 0.3 + flow2 * 0.1;
        let dy = ny + flow2 * 0.3 - flow1 * 0.1;

        let intensity1 = perlin(dx * 2.0, dy * 2.0);
        let intensity2 = perlin(dx * 3.0 + time, dy * 3.0);

        let rawIntensity = (intensity1 + intensity2 + 2.0) / 4.0;
        let temporalWave = sin(time * 0.5 + nx * 2.0 + ny * 1.5) * 0.05 + 0.95;
        intensity = rawIntensity * temporalWave;
    }

    let index = localY * chunkSize + localX;
    output[index] = intensity;
}
