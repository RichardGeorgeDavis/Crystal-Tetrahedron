(function () {
  const canvas = document.getElementById("scene");
  const status = document.getElementById("status");
  const panel = {
    togglePlayback: document.getElementById("toggle-playback"),
    inputs: {
      disperseCount: document.getElementById("disperse-count"),
      bounceCount: document.getElementById("bounce-count"),
      focusPoint: document.getElementById("focus-point"),
      focusScale: document.getElementById("focus-scale"),
      exposure: document.getElementById("exposure"),
      timeScale: document.getElementById("time-scale"),
    },
    outputs: {
      disperseCount: document.getElementById("disperse-count-value"),
      bounceCount: document.getElementById("bounce-count-value"),
      focusPoint: document.getElementById("focus-point-value"),
      focusScale: document.getElementById("focus-scale-value"),
      exposure: document.getElementById("exposure-value"),
      timeScale: document.getElementById("time-scale-value"),
    },
  };
  const settings = {
    disperseCount: 5,
    bounceCount: 10,
    focusPoint: 0.65,
    focusScale: 1,
    exposure: 16,
    timeScale: 1,
  };
  const playback = {
    elapsed: 0,
    lastFrameAt: performance.now(),
    paused: false,
  };
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
  });

  if (!gl) {
    setStatus("WebGL2 is unavailable in this browser.", true);
    return;
  }

  let bufferProgram;
  let postProgram;
  let bufferUniforms;
  let postUniforms;
  let noiseTexture;
  let sceneTarget;
  let pointer;
  let frame = 0;
  let runtimeMessage = "Initializing WebGL2...";

  try {
    const vertexSource = `#version 300 es
precision highp float;

const vec2 POSITIONS[3] = vec2[](
    vec2(-1.0, -1.0),
    vec2(3.0, -1.0),
    vec2(-1.0, 3.0)
);

void main() {
    gl_Position = vec4(POSITIONS[gl_VertexID], 0.0, 1.0);
}
`;

  const bufferFragmentSource = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform int uFrame;
uniform vec4 uMouse;
uniform sampler2D uNoiseTexture;
uniform vec2 uNoiseResolution;
uniform int uDisperseCount;
uniform int uBounceCount;

out vec4 fragColor;

const int MAX_DISPERSE = 8;
const int MAX_BOUNCE = 16;

mat4 cameraMatrix = mat4(
    0.9780874848365784, -0.07870610803365707, -0.19274398684501648, 0.0,
    0.20812205970287323, 0.3452317416667938, 0.9151507019996643, 0.0,
    -0.005486522801220417, -0.935211718082428, 0.35404732823371887, 0.0,
    -0.0000004901630745735019, 0.00000874467059475137, -9.502106666564941, 1.0
);

#define PI 3.14159265359
#define TAU 6.28318530718
#define saturate(x) clamp(x, 0.0, 1.0)

void pR(inout vec2 p, float a) {
    p = cos(a) * p + sin(a) * vec2(p.y, -p.x);
}

float smax(float a, float b, float r) {
    vec2 u = max(vec2(r + a, r + b), vec2(0.0));
    return min(-r, max(a, b)) + length(u);
}

float vmax(vec2 v) {
    return max(v.x, v.y);
}

float fBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, vec2(0.0))) + vmax(min(d, vec2(0.0)));
}

float range(float vmin, float vmaxValue, float value) {
    return clamp((value - vmin) / (vmaxValue - vmin), 0.0, 1.0);
}

mat4 rotX(float a) {
    return mat4(
        1.0, 0.0, 0.0, 0.0,
        0.0, cos(a), -sin(a), 0.0,
        0.0, sin(a), cos(a), 0.0,
        0.0, 0.0, 0.0, 1.0
    );
}

mat4 rotZ(float a) {
    return mat4(
        cos(a), -sin(a), 0.0, 0.0,
        sin(a), cos(a), 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        0.0, 0.0, 0.0, 1.0
    );
}

vec3 pal(in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d) {
    return a + b * cos(6.28318 * (c * t + d));
}

vec3 spectrum(float n) {
    return pal(
        n,
        vec3(0.5, 0.5, 0.5),
        vec3(0.5, 0.5, 0.5),
        vec3(1.0, 1.0, 1.0),
        vec3(0.0, 0.33, 0.67)
    );
}

const int TYPE = 3;

vec3 nc;
vec3 pab;
vec3 pbc;
vec3 pca;

void initPoly() {
    float cospin = cos(PI / float(TYPE));
    float scospin = sqrt(0.75 - cospin * cospin);
    nc = vec3(-0.5, -cospin, scospin);
    pab = vec3(0.0, 0.0, 1.0);
    pbc = vec3(scospin, 0.0, 0.5);
    pca = vec3(0.0, scospin, cospin);
    pbc = normalize(pbc);
    pca = normalize(pca);
}

vec3 fold(vec3 pos) {
    for (int i = 0; i < TYPE; ++i) {
        pos.xy = abs(pos.xy);
        pos -= 2.0 * min(0.0, dot(pos, nc)) * nc;
    }
    return pos;
}

float time;

float tweenOffset(float t, float start, float duration) {
    t = range(start, start + duration, t);
    t = pow(t, 2.0);
    return t;
}

float tweenBlend(float t, float start, float duration) {
    t = range(start, start + duration, t);
    t = pow(t, 0.5);
    t = smoothstep(0.0, 1.0, t);
    return t;
}

const float STEP_SCALE = 1.0 / 3.0;

float tetAnim(vec3 p, float tInput) {
    p = fold(p);

    float sz = 0.3;
    float rBase = 0.04;
    float rInner = rBase * STEP_SCALE;
    float blendDuration = 0.75;
    float offsetDuration = 0.75;
    float t = tInput * (blendDuration + offsetDuration);
    offsetDuration *= 2.0;
    float offsetDistance = 0.6;

    float blend = tweenBlend(t, 0.0, blendDuration);
    float offsetT = tweenOffset(t, blendDuration, offsetDuration);
    float offset = offsetT * offsetDistance;

    if (t < 0.0 || offsetT >= 1.0) {
        return 1e12;
    }

    vec3 n1 = pca;
    vec3 n2 = normalize(pca * vec3(-1.0, -1.0, 1.0));
    vec3 n3 = normalize(pbc * vec3(1.0, -1.0, -1.0));
    vec3 n4 = normalize(pbc * vec3(-1.0, -1.0, -1.0));

    float sep = 0.001 * (1.0 - offsetT);
    float scale = 1.0 - offsetT;

    float bound = (dot((p + (n4 + n3) * offset) / scale, n1) - sz) * scale;
    if (bound > 0.004) {
        return bound;
    }

    vec3 pp = p;

    p = pp + n4 * offset;
    p /= scale;
    float oct = dot(p, n1) - sz;
    oct = smax(oct, dot(p, n2) - sz, rBase);
    oct = smax(oct, -(dot(p, n4) + 0.5 - sep), rInner);
    oct = smax(oct, -(dot(p, n3) + 0.1 - sep), rInner);
    oct = smax(oct, dot(p, n4) + 0.1 + sep, rInner);
    oct *= scale;

    p = pp + (n4 + n3) * offset;
    p /= scale;
    float edge = dot(p, n1) - sz;
    edge = smax(edge, dot(p, n2) - sz, rBase);

    p = pp + (n4 + n3) * offset;
    p /= scale;
    float side = edge;
    side = smax(side, dot(p, n3) + 0.1 + sep, rInner);
    side = smax(side, dot(p, n4) + 0.1 + sep, rInner);
    side *= scale;

    p = pp + n4 * (offset + offset);
    p /= scale;
    float vert = edge;
    vert = smax(vert, dot(p, n3) - sz, rBase);
    vert = smax(vert, dot(p, n4) + 0.5 + sep, rInner);
    vert *= scale;

    float sliced = 1e12;
    sliced = min(sliced, oct);
    sliced = min(sliced, vert);
    sliced = min(sliced, side);

    if (tInput < 1.0) {
        p = pp;
        float inner = -(dot(p, n4) + 0.1 - sep);
        inner = smax(inner, -(dot(p, n3) + 0.1 - sep), rInner);
        inner = smax(inner, -(dot(p, n2) + 0.1 - sep), rInner);
        sliced = min(sliced, inner);
    }

    if (blend >= 1.0) {
        return sliced;
    }

    float base = dot(p, n1) - sz;
    base = smax(base, dot(p, n2) - sz, rBase);
    base = smax(base, dot(p, n3) - sz, rBase);

    float surface = 1.0 - saturate(-base / sz);
    float surfaceBlend = saturate(blend * 0.66 * range(0.9, 1.0, surface));
    base = mix(base, sliced, surfaceBlend);

    float slicedS = min(sliced, -base - (0.3 - 0.3 * blend));
    float d = max(base, slicedS);
    d = mix(d, sliced, smoothstep(0.9, 1.0, blend));

    return d;
}

float tetLoop(vec3 p) {
    pR(p.xy, PI / 2.0 * -time + PI / 2.0);

    float t = time;
    float scale = pow(STEP_SCALE, t);
    float d = tetAnim(p * scale, time) / scale;

    scale *= STEP_SCALE;
    pR(p.xy, PI / 2.0 * -1.0);
    d = min(d, tetAnim(p * scale, time + 1.0) / scale);

    return d;
}

vec2 map(vec3 p) {
    float d = tetLoop(p);
    return vec2(d, 1.0);
}

float intersectPlane(vec3 rOrigin, vec3 rayDir, vec3 origin, vec3 normal, vec3 up, out vec2 uv) {
    float d = dot(normal, origin - rOrigin) / dot(rayDir, normal);
    vec3 point = rOrigin + d * rayDir;
    vec3 tangent = cross(normal, up);
    vec3 bitangent = cross(normal, tangent);
    point -= origin;
    uv = vec2(dot(tangent, point), dot(bitangent, point));
    return max(sign(d), 0.0);
}

mat3 envOrientation;

vec3 light(vec3 origin, vec3 rayDir) {
    origin = -(cameraMatrix * vec4(origin, 1.0)).xyz;
    rayDir = -(cameraMatrix * vec4(rayDir, 0.0)).xyz;

    origin = origin * envOrientation;
    rayDir = rayDir * envOrientation;

    vec2 uv;
    float hit = intersectPlane(
        origin,
        rayDir,
        vec3(5.0, -2.0, -8.0),
        normalize(vec3(1.0, -0.5, -0.1)),
        normalize(vec3(0.0, 1.0, 0.0)),
        uv
    );
    float l = smoothstep(0.75, 0.0, fBox(uv, vec2(0.4, 1.2) * 6.0));
    return vec3(l) * hit;
}

vec3 env(vec3 origin, vec3 rayDir) {
    origin = -(cameraMatrix * vec4(origin, 1.0)).xyz;
    rayDir = -(cameraMatrix * vec4(rayDir, 0.0)).xyz;

    origin = origin * envOrientation;
    rayDir = rayDir * envOrientation;

    float l = smoothstep(0.0, 1.7, dot(rayDir, vec3(0.5, -0.3, 1.0))) * 0.4;
    return vec3(l);
}

vec3 normal(vec3 pos) {
    vec3 n = vec3(0.0);
    for (int i = 0; i < 4; ++i) {
        vec3 e = 0.5773 * (2.0 * vec3(float(((i + 3) >> 1) & 1), float((i >> 1) & 1), float(i & 1)) - 1.0);
        n += e * map(pos + 0.001 * e).x;
    }
    return normalize(n);
}

struct Hit {
    vec2 res;
    vec3 p;
    float len;
    float steps;
};

Hit march(vec3 origin, vec3 rayDir, float invert, float maxDist, float understep) {
    vec3 p = origin;
    float len = 0.0;
    float dist = 0.0;
    vec2 res = vec2(0.0);
    vec2 candidate = vec2(0.0);
    float steps = 0.0;

    for (int i = 0; i < 100; ++i) {
        len += dist * understep;
        p = origin + len * rayDir;
        candidate = map(p);
        dist = candidate.x * invert;
        steps += 1.0;
        if (dist < 0.001) {
            res = candidate;
            break;
        }
        if (len >= maxDist) {
            len = maxDist;
            break;
        }
    }

    return Hit(res, p, len, steps);
}

mat3 sphericalMatrix(vec2 tp) {
    float theta = tp.x;
    float phi = tp.y;
    float cx = cos(theta);
    float cy = cos(phi);
    float sx = sin(theta);
    float sy = sin(phi);
    return mat3(
        cy, sy * sx, -sy * cx,
        0.0, cx, sx,
        sy, -cy * sx, cy * cx
    );
}

void main() {
    initPoly();

    time = fract(uTime / 2.0 + 0.4);
    envOrientation = sphericalMatrix(((vec2(81.5, 119.0) / vec2(187.0)) * 2.0 - 1.0) * 2.0);

    vec2 fragCoord = gl_FragCoord.xy;
    vec2 uv = (2.0 * fragCoord - uResolution.xy) / uResolution.y;

    float invert = 1.0;
    float maxDist = 15.0;

    if (uMouse.z > 0.0) {
        cameraMatrix = cameraMatrix * rotX(((uMouse.y / uResolution.y) * 2.0 - 1.0) * 2.0);
        cameraMatrix = cameraMatrix * rotZ(((uMouse.x / uResolution.x) * 2.0 - 1.0) * 2.0);
    }

    vec3 camOrigin = -(cameraMatrix[3].xyz) * mat3(cameraMatrix);
    vec3 camDir = normalize(vec3(uv * 0.168, -1.0) * mat3(cameraMatrix));

    Hit firstHit = march(camOrigin, camDir, invert, maxDist, 0.9);
    float firstLen = firstHit.len;

    float steps = 0.0;
    float maxDisperse = max(float(uDisperseCount), 1.0);
    vec3 col = vec3(0.0);
    vec3 bgCol = vec3(0.22);

    for (int disperse = 0; disperse < MAX_DISPERSE; ++disperse) {
        if (disperse >= uDisperseCount) {
            break;
        }

        invert = 1.0;
        vec3 sam = vec3(0.0);
        vec3 origin = camOrigin;
        vec3 rayDir = camDir;
        vec3 p = vec3(0.0);
        vec2 res = vec2(0.0);
        float extinctionDist = 0.0;
        float wavelength = float(disperse) / maxDisperse;
        float rand = texture(uNoiseTexture, fragCoord.xy / uNoiseResolution).r;
        rand = fract(rand + float(uFrame) * 1.61803398875);
        wavelength += (rand * 2.0 - 1.0) * (0.5 / maxDisperse);

        float bounceCount = 0.0;

        for (int bounce = 0; bounce < MAX_BOUNCE; ++bounce) {
            if (bounce >= uBounceCount) {
                break;
            }

            Hit hit;
            if (bounce == 0) {
                hit = firstHit;
            } else {
                hit = march(origin, rayDir, invert, maxDist / 2.0, 1.0);
            }
            steps += hit.steps;

            res = hit.res;
            p = hit.p;

            if (invert < 0.0) {
                extinctionDist += hit.len;
            }

            if (res.y == 0.0) {
                break;
            }

            vec3 nor = normal(p) * invert;
            vec3 ref = reflect(rayDir, nor);

            sam += light(p, ref) * 0.5;
            sam += pow(1.0 - abs(dot(rayDir, nor)), 5.0) * 0.1;
            sam *= vec3(0.85, 0.85, 0.98);

            float ior = mix(1.3, 1.6, wavelength);
            ior = invert < 0.0 ? ior : 1.0 / ior;
            vec3 raf = refract(rayDir, nor, ior);
            bool tif = all(equal(raf, vec3(0.0)));
            rayDir = tif ? ref : raf;
            float offset = 0.01 / abs(dot(rayDir, nor));
            origin = p + offset * rayDir;
            invert *= -1.0;

            bounceCount = float(bounce);
        }

        sam += bounceCount == 0.0 ? bgCol : env(p, rayDir);

        if (bounceCount == 0.0) {
            col += sam * maxDisperse / 2.0;
            break;
        }

        vec3 extinction = vec3(0.3, 0.3, 1.0) * 0.5;
        extinction = 1.0 / (1.0 + (extinction * extinctionDist));
        col += sam * extinction * spectrum(-wavelength + 0.2);
    }

    col /= maxDisperse;
    fragColor = vec4(col, range(4.0, 12.0, firstLen));
}
`;

  const postFragmentSource = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform sampler2D uSceneTexture;
uniform float uFocusPoint;
uniform float uFocusScale;
uniform float uExposure;

out vec4 fragColor;

const float GOLDEN_ANGLE = 2.39996323;
const float MAX_BLUR_SIZE = 10.0;
const float RAD_SCALE = 1.0;
const int MAX_DOF_SAMPLES = 64;

float getBlurSize(float depth, float focusPoint, float focusScale) {
    float safeDepth = max(depth, 0.0001);
    float coc = clamp((1.0 / focusPoint - 1.0 / safeDepth) * focusScale, -1.0, 1.0);
    return abs(coc) * MAX_BLUR_SIZE;
}

vec3 depthOfField(vec2 texCoord, vec2 pixelSize, float focusPoint, float focusScale) {
    vec4 centerTex = texture(uSceneTexture, texCoord);
    float centerDepth = centerTex.a;
    float centerSize = getBlurSize(centerDepth, focusPoint, focusScale);
    vec3 color = centerTex.rgb;
    float total = 1.0;
    float radius = RAD_SCALE;

    for (int i = 0; i < MAX_DOF_SAMPLES; ++i) {
        if (radius >= MAX_BLUR_SIZE) {
            break;
        }

        float ang = float(i) * GOLDEN_ANGLE;
        vec2 tc = texCoord + vec2(cos(ang), sin(ang)) * pixelSize * radius;
        vec4 sampleTex = texture(uSceneTexture, tc);
        vec3 sampleColor = sampleTex.rgb;
        float sampleDepth = sampleTex.a;
        float sampleSize = getBlurSize(sampleDepth, focusPoint, focusScale);

        if (sampleDepth > centerDepth) {
            sampleSize = clamp(sampleSize, 0.0, centerSize * 2.0);
        }

        float m = smoothstep(radius - 0.5, radius + 0.5, sampleSize);
        color += mix(color / total, sampleColor, m);
        total += 1.0;
        radius += RAD_SCALE / radius;
    }

    return color / total;
}

vec3 tonemap2(vec3 texColor) {
    texColor /= 2.0;
    texColor *= 16.0;
    vec3 x = max(vec3(0.0), texColor - 0.004);
    return (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06);
}

void main() {
    vec2 fragCoord = gl_FragCoord.xy;
    vec2 uv = fragCoord / uResolution.xy;
    vec2 pixelSize = vec2(0.002) / (uResolution.xy / uResolution.y);

    vec3 col = depthOfField(uv, pixelSize, uFocusPoint, uFocusScale);
    col = pow(col, vec3(1.25)) * 2.5;
    col *= uExposure / 16.0;
    col = tonemap2(col);

    fragColor = vec4(col, 1.0);
}
`;

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  bufferProgram = createProgram(gl, vertexSource, bufferFragmentSource);
  postProgram = createProgram(gl, vertexSource, postFragmentSource);

  bufferUniforms = {
    resolution: gl.getUniformLocation(bufferProgram, "uResolution"),
    time: gl.getUniformLocation(bufferProgram, "uTime"),
    frame: gl.getUniformLocation(bufferProgram, "uFrame"),
    mouse: gl.getUniformLocation(bufferProgram, "uMouse"),
    noiseTexture: gl.getUniformLocation(bufferProgram, "uNoiseTexture"),
    noiseResolution: gl.getUniformLocation(bufferProgram, "uNoiseResolution"),
    disperseCount: gl.getUniformLocation(bufferProgram, "uDisperseCount"),
    bounceCount: gl.getUniformLocation(bufferProgram, "uBounceCount"),
  };

  postUniforms = {
    resolution: gl.getUniformLocation(postProgram, "uResolution"),
    sceneTexture: gl.getUniformLocation(postProgram, "uSceneTexture"),
    focusPoint: gl.getUniformLocation(postProgram, "uFocusPoint"),
    focusScale: gl.getUniformLocation(postProgram, "uFocusScale"),
    exposure: gl.getUniformLocation(postProgram, "uExposure"),
  };

  noiseTexture = createNoiseTexture(gl, 256);
  const supportsFloatColor = Boolean(gl.getExtension("EXT_color_buffer_float"));
  const supportsFloatLinear = Boolean(gl.getExtension("OES_texture_float_linear"));

  sceneTarget = createSceneTarget(gl, {
    width: 1,
    height: 1,
    useHdr: supportsFloatColor,
    filter: supportsFloatColor && supportsFloatLinear ? gl.LINEAR : gl.NEAREST,
  });

  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  pointer = {
    x: 0,
    y: 0,
    down: false,
  };

  bindAdminPanel();
  syncAdminPanel();
  updatePlaybackButton();
  resize();
  bindPointer();
  runtimeMessage = sceneTarget.useHdr ? "HDR framebuffer active." : "Using 8-bit framebuffer fallback.";
  refreshStatus();
  requestAnimationFrame(render);
  } catch (error) {
    console.error(error);
    setStatus(error && error.message ? error.message : "WebGL initialization failed.", true);
  }

  function render(now) {
    resize();

    const deltaSeconds = Math.min(Math.max((now - playback.lastFrameAt) * 0.001, 0), 0.1);
    playback.lastFrameAt = now;

    if (!playback.paused) {
      playback.elapsed += deltaSeconds * settings.timeScale;
    }

    const elapsed = playback.elapsed;

    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTarget.framebuffer);
    gl.viewport(0, 0, sceneTarget.width, sceneTarget.height);
    gl.useProgram(bufferProgram);
    gl.uniform2f(bufferUniforms.resolution, sceneTarget.width, sceneTarget.height);
    gl.uniform1f(bufferUniforms.time, elapsed);
    gl.uniform1i(bufferUniforms.frame, frame);
    gl.uniform4f(bufferUniforms.mouse, pointer.x, pointer.y, pointer.down ? 1 : 0, 0);
    gl.uniform2f(bufferUniforms.noiseResolution, noiseTexture.size, noiseTexture.size);
    gl.uniform1i(bufferUniforms.disperseCount, settings.disperseCount);
    gl.uniform1i(bufferUniforms.bounceCount, settings.bounceCount);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, noiseTexture.texture);
    gl.uniform1i(bufferUniforms.noiseTexture, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(postProgram);
    gl.uniform2f(postUniforms.resolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(postUniforms.focusPoint, settings.focusPoint);
    gl.uniform1f(postUniforms.focusScale, settings.focusScale);
    gl.uniform1f(postUniforms.exposure, settings.exposure);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTarget.texture);
    gl.uniform1i(postUniforms.sceneTexture, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!playback.paused) {
      frame += 1;
    }
    requestAnimationFrame(render);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(window.innerWidth * dpr));
    const height = Math.max(1, Math.round(window.innerHeight * dpr));

    if (canvas.width === width && canvas.height === height) {
      return;
    }

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;

    resizeSceneTarget(gl, sceneTarget, width, height);
  }

  function bindPointer() {
    canvas.addEventListener("pointerdown", (event) => {
      updatePointer(event);
      pointer.down = true;
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener("pointermove", (event) => {
      updatePointer(event);
    });

    canvas.addEventListener("pointerup", (event) => {
      updatePointer(event);
      pointer.down = false;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    });

    canvas.addEventListener("pointercancel", (event) => {
      updatePointer(event);
      pointer.down = false;
    });

    window.addEventListener("pointerup", () => {
      pointer.down = false;
    });

    window.addEventListener("resize", resize);
  }

  function bindAdminPanel() {
    panel.togglePlayback.addEventListener("click", () => {
      togglePause();
    });

    bindRange("disperseCount", parseInteger);
    bindRange("bounceCount", parseInteger);
    bindRange("focusPoint", parseFloatValue);
    bindRange("focusScale", parseFloatValue);
    bindRange("exposure", parseFloatValue);
    bindRange("timeScale", parseFloatValue);

    window.addEventListener("keydown", (event) => {
      if (event.code !== "Space" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      event.preventDefault();
      togglePause();
    });
  }

  function bindRange(key, parseValue) {
    panel.inputs[key].addEventListener("input", (event) => {
      settings[key] = parseValue(event.currentTarget.value);
      updateControlOutput(key);
      refreshStatus();
    });
  }

  function syncAdminPanel() {
    Object.keys(settings).forEach((key) => {
      panel.inputs[key].value = String(settings[key]);
      updateControlOutput(key);
    });
  }

  function updateControlOutput(key) {
    panel.outputs[key].textContent = formatSettingValue(key, settings[key]);
  }

  function formatSettingValue(key, value) {
    if (key === "disperseCount" || key === "bounceCount") {
      return String(value);
    }

    if (key === "focusPoint" || key === "focusScale") {
      return value.toFixed(2);
    }

    if (key === "exposure") {
      return value.toFixed(1);
    }

    if (key === "timeScale") {
      return `${value.toFixed(2)}x`;
    }

    return String(value);
  }

  function togglePause(nextState) {
    playback.paused = typeof nextState === "boolean" ? nextState : !playback.paused;
    playback.lastFrameAt = performance.now();
    updatePlaybackButton();
    refreshStatus();
  }

  function updatePlaybackButton() {
    panel.togglePlayback.textContent = playback.paused ? "Resume" : "Pause";
    panel.togglePlayback.setAttribute("aria-pressed", playback.paused ? "true" : "false");
  }

  function refreshStatus() {
    const stateLabel = playback.paused ? "Paused." : `Running at ${settings.timeScale.toFixed(2)}x speed.`;
    setStatus(`${runtimeMessage} ${stateLabel} Space toggles pause.`, false);
  }

  function updatePointer(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    pointer.x = (event.clientX - rect.left) * scaleX;
    pointer.y = canvas.height - (event.clientY - rect.top) * scaleY;
  }

  function setStatus(message, isError) {
    status.textContent = message;
    status.dataset.state = isError ? "error" : "ok";
  }
})();

function parseInteger(value) {
  return Number.parseInt(value, 10);
}

function parseFloatValue(value) {
  return Number.parseFloat(value);
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || "Unknown program link error.";
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error(log);
  }

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  return program;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "Unknown shader compile error.";
    gl.deleteShader(shader);
    throw new Error(log);
  }

  return shader;
}

function createNoiseTexture(gl, size) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    const value = Math.floor(Math.random() * 256);
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);

  return { texture, size };
}

function createSceneTarget(gl, options) {
  const framebuffer = gl.createFramebuffer();
  const texture = gl.createTexture();
  const target = {
    framebuffer,
    texture,
    width: options.width,
    height: options.height,
    useHdr: options.useHdr,
    filter: options.filter,
  };

  configureSceneTarget(gl, target);
  return target;
}

function resizeSceneTarget(gl, target, width, height) {
  target.width = width;
  target.height = height;
  configureSceneTarget(gl, target);
}

function configureSceneTarget(gl, target) {
  gl.bindTexture(gl.TEXTURE_2D, target.texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, target.filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, target.filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  if (target.useHdr) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, target.width, target.height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, target.width, target.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && target.useHdr) {
    target.useHdr = false;
    target.filter = gl.LINEAR;
    configureSceneTarget(gl, target);
    return;
  }

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("Unable to create the render target framebuffer.");
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
