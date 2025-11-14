// Circular Glow Compute Shader
// Samples locale bubbles and renders smooth circular glows

@group(0) @binding(0) var<storage, read_write> output: array<f32>;
@group(0) @binding(1) var<uniform> params: ChunkParams;
@group(0) @binding(2) var<storage, read> locales: array<vec4<f32>>;

struct ChunkParams {
    chunkWorldX: f32,
    chunkWorldY: f32,
    chunkSize: f32,
    time: f32,
    localeCount: f32,
}

// Smooth falloff function (smoothstep)
fn smoothFalloff(distance: f32, radius: f32) -> f32 {
    if (distance >= radius) {
        return 0.0;
    }

    let normalizedDist = distance / radius;
    let fade = 1.0 - normalizedDist;

    // Smoothstep for smooth gradient
    return fade * fade * (3.0 - 2.0 * fade);
}

// Sample all locales and return maximum intensity at this point
fn sampleLocales(worldX: f32, worldY: f32) -> f32 {
    let count = u32(params.localeCount);
    var maxIntensity = 0.0;

    for (var i = 0u; i < count; i++) {
        let locale = locales[i];
        let centerX = locale.x;
        let centerY = locale.y;
        let radius = locale.z;
        let active = locale.w;

        // Skip inactive locales
        if (active < 0.5) {
            continue;
        }

        // Calculate distance to locale center
        let dx = worldX - centerX;
        let dy = worldY - centerY;
        let distance = sqrt(dx * dx + dy * dy);

        // Calculate intensity with smooth falloff
        let intensity = smoothFalloff(distance, radius);

        // Take maximum intensity (if multiple locales overlap)
        maxIntensity = max(maxIntensity, intensity);
    }

    return maxIntensity;
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

    // Sample all locales
    let intensity = sampleLocales(worldX, worldY);

    // Optional: Add subtle pulse animation
    let time = params.time;
    let pulse = sin(time * 2.0) * 0.05 + 0.95;
    let finalIntensity = intensity * pulse;

    let index = localY * chunkSize + localX;
    output[index] = finalIntensity;
}
