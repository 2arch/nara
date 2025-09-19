import * as THREE from 'three';

// Shader uniform types for better type safety
interface ShaderUniforms {
  [key: string]: { value: any };
}

interface Shader {
  uniforms: ShaderUniforms;
  vertexShader: string;
  fragmentShader: string;
}

export const SepiaShader: Shader = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 1.0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec3 c = color.rgb;
      color.r = dot(c, vec3(0.393, 0.769, 0.189));
      color.g = dot(c, vec3(0.349, 0.686, 0.168));
      color.b = dot(c, vec3(0.272, 0.534, 0.131));
      gl_FragColor = vec4(mix(c, color.rgb, amount), color.a);
    }
  `
};

export const CoronaShader: Shader = {
  uniforms: {
    iTime: { value: 0.0 },
    iResolution: { value: new THREE.Vector2(512, 512) },
    brightness: { value: 0.5 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float iTime;
    uniform vec2 iResolution;
    uniform float brightness;
    varying vec2 vUv;

    // Better noise function
    vec2 hash2(vec2 p) {
      p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)));
      return -1.0 + 2.0*fract(sin(p)*43758.5453123);
    }

    float noise(vec2 p) {
      const float K1 = 0.366025404; // (sqrt(3)-1)/2;
      const float K2 = 0.211324865; // (3-sqrt(3))/6;
      vec2 i = floor(p + (p.x+p.y)*K1);
      vec2 a = p - i + (i.x+i.y)*K2;
      vec2 o = (a.x>a.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
      vec2 b = a - o + K2;
      vec2 c = a - 1.0 + 2.0*K2;
      vec3 h = max(0.5-vec3(dot(a,a), dot(b,b), dot(c,c) ), 0.0 );
      vec3 n = h*h*h*h*vec3( dot(a,hash2(i+0.0)), dot(b,hash2(i+o)), dot(c,hash2(i+1.0)));
      return dot(n, vec3(70.0));
    }

    float fbm(vec2 p) {
      float f = 0.0;
      mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
      f += 0.5000*noise(p); p = m*p;
      f += 0.2500*noise(p); p = m*p;
      f += 0.1250*noise(p); p = m*p;
      f += 0.0625*noise(p);
      return f;
    }

    void main() {
      vec2 uv = vUv;
      vec2 p = (uv - 0.5) * 2.0; // Scale to -1 to 1
      
      float time = iTime * 0.3;
      float dist = length(p);
      float angle = atan(p.y, p.x);
      
      // Create solar corona layers
      float corona1 = fbm(p * 3.0 + time * 0.5) * 0.5 + 0.5;
      float corona2 = fbm(p * 6.0 + time * 0.3) * 0.5 + 0.5;
      float corona3 = fbm(p * 12.0 + time * 0.7) * 0.5 + 0.5;
      
      // Create solar flares radiating outward
      float flares = 0.0;
      for(float i = 0.0; i < 8.0; i++) {
        float a = (i / 8.0) * 6.283185 + time * 0.2;
        float flareAngle = sin(angle * 8.0 + a) * 0.1;
        float flareNoise = noise(vec2(angle * 10.0 + time, dist * 5.0)) * 0.5 + 0.5;
        flares += flareNoise * exp(-abs(angle - a - flareAngle) * 20.0);
      }
      
      // Central bright core
      float core = 1.0 - smoothstep(0.0, 0.3, dist);
      core = pow(core, 0.5) * 2.0;
      
      // Extended corona
      float corona = (corona1 * 0.4 + corona2 * 0.3 + corona3 * 0.3);
      corona *= 1.0 - smoothstep(0.0, 1.5, dist);
      corona = pow(corona, 1.5) * brightness * 3.0;
      
      // Add flares to corona
      corona += flares * (1.0 - smoothstep(0.2, 1.0, dist)) * brightness * 2.0;
      
      // Solar colors - white hot center to orange/red edges
      vec3 white = vec3(1.0, 1.0, 0.9);
      vec3 yellow = vec3(1.0, 0.9, 0.4);
      vec3 orange = vec3(1.0, 0.6, 0.2);
      vec3 red = vec3(1.0, 0.3, 0.1);
      
      vec3 color = white * core;
      color += mix(yellow, orange, dist) * corona;
      color += red * flares * 0.5;
      
      // Increase overall intensity
      color *= (brightness + 0.5) * 2.0;
      
      // Create alpha with proper falloff
      float alpha = core + corona * 0.8 + flares * 0.3;
      alpha = clamp(alpha, 0.0, 1.0);
      
      gl_FragColor = vec4(color, alpha);
    }
  `
};