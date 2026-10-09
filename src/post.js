// Render pipeline: HDR scene target -> (optional progressive accumulation) -> bloom -> tone map + studio backdrop composite.
//
// The scene renders with a transparent clear, so alpha is "coverage". The final pass tone-maps the 3D layer and
// composites it over a procedural cream backdrop in sRGB, which keeps the brand cream exact and avoids banding.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const ACCUM_FRAG = /* glsl */ `
  uniform sampler2D tOld;
  uniform sampler2D tNew;
  uniform float weight;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(tOld, vUv) + texture2D(tNew, vUv) * weight;
  }`;

const PASS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

const FINAL_VERT = /* glsl */ `
  precision highp float;
  attribute vec3 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

const FINAL_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tScene;
  uniform vec2 uRes;
  uniform float uSeed;
  uniform vec3 uBgCenter;
  uniform vec3 uBgEdge;
  uniform vec2 uBgFocus;
  uniform vec2 uBgScale;
  uniform vec2 uBgFalloff;
  uniform float uVignette;
  uniform float uGrain;
  uniform mat4 uInvPV;
  uniform vec3 uCamPos;
  uniform vec4 uFloorBox;
  uniform vec4 uFloorShape; // corner radius, falloff distance, reach (exactly zero beyond it), fraction of the frame height over which it fades out at the bottom edge
  uniform vec3 uFloorGlow;
  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>
  varying vec2 vUv;

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // studio sweep: a pool of light under the keyboard, falling off towards the corners
  vec3 backdrop(vec2 uv) {
    float aspect = uRes.x / uRes.y;
    vec2 p = (uv - uBgFocus) * vec2(aspect, 1.0);
    float d = length(p * uBgScale);
    float t = smoothstep(uBgFalloff.x, uBgFalloff.y, d);
    vec3 col = mix(uBgCenter, uBgEdge, t);
    col *= mix(0.985, 1.015, uv.y);
    return col;
  }

  // Glow on the desk around the case (the night theme's underglow): intersect the pixel's view ray with the floor plane
  // and fall off exponentially from the edge of a rounded rectangle, so it follows the perspective of whichever camera is used.
  float floorGlow(vec2 uv) {
    vec4 far = uInvPV * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    vec3 dir = normalize(far.xyz / far.w - uCamPos);
    if (dir.y > -1e-4) return 0.0;
    vec2 q = (uCamPos + dir * (-uCamPos.y / dir.y)).xz - uFloorBox.xy;
    vec2 d = abs(q) - uFloorBox.zw + uFloorShape.x;
    float sdf = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - uFloorShape.x;
    float dist = max(sdf, 0.0);
    return exp(-dist / uFloorShape.y) * (1.0 - smoothstep(0.35 * uFloorShape.z, uFloorShape.z, dist)) * smoothstep(0.0, uFloorShape.w, uv.y);
  }

  void main() {
    vec4 s = texture2D(tScene, vUv);
    float a = clamp(s.a, 0.0, 1.0);
    // rgb is premultiplied by coverage: un-premultiply before tone mapping, otherwise partially covered edge pixels glow
    vec3 straight = max(s.rgb, vec3(0.0)) / max(a, 1e-4);
    vec3 lit = NeutralToneMapping(straight);
    lit = sRGBTransferOETF(vec4(lit, 1.0)).rgb;
    vec3 col = mix(backdrop(vUv) + uFloorGlow * floorGlow(vUv), lit, a);

    vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y * 0.5, 1.0);
    col *= 1.0 - uVignette * smoothstep(0.3, 0.95, length(q) * 1.15);

    float n = hash(gl_FragCoord.xy + uSeed) + hash(gl_FragCoord.yx * 1.37 + uSeed + 11.0) - 1.0;
    col += n * uGrain;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`;

export class Pipeline {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {{width:number,height:number,msaa?:number}} o drawing-buffer size in device pixels
   */
  constructor(renderer, { width, height, msaa = 4, backdrop }) {
    this.renderer = renderer;
    this.msaa = msaa;
    this.floatOk = renderer.extensions.has('EXT_color_buffer_float');
    this.accumType = this.floatOk ? THREE.FloatType : THREE.HalfFloatType;

    this.sceneRT = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: msaa });
    this.accA = new THREE.WebGLRenderTarget(width, height, { type: this.accumType, depthBuffer: false });
    this.accB = new THREE.WebGLRenderTarget(width, height, { type: this.accumType, depthBuffer: false });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.3, 0.45, 1.35);

    this.accumQuad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: { tOld: { value: null }, tNew: { value: null }, weight: { value: 1 } },
        vertexShader: PASS_VERT,
        fragmentShader: ACCUM_FRAG,
        depthTest: false,
        depthWrite: false,
      }),
    );

    const rgb = (hex) => new THREE.Color(hex).getRGB(new THREE.Color(), THREE.SRGBColorSpace);
    const center = rgb(backdrop.center);
    const edge = rgb(backdrop.edge);
    this.finalMat = new THREE.RawShaderMaterial({
      uniforms: {
        tScene: { value: null },
        uRes: { value: new THREE.Vector2(width, height) },
        uSeed: { value: 0 },
        uBgCenter: { value: new THREE.Vector3(center.r, center.g, center.b) },
        uBgEdge: { value: new THREE.Vector3(edge.r, edge.g, edge.b) },
        uBgFocus: { value: new THREE.Vector2(...backdrop.focus) },
        uBgScale: { value: new THREE.Vector2(...backdrop.scale) },
        uBgFalloff: { value: new THREE.Vector2(...backdrop.falloff) },
        uVignette: { value: backdrop.vignette },
        uGrain: { value: backdrop.grain },
        uInvPV: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uFloorBox: { value: new THREE.Vector4() },
        uFloorShape: { value: new THREE.Vector4(0.7, 1, 3, 0.2) },
        uFloorGlow: { value: new THREE.Vector3() },
        toneMappingExposure: { value: 1 },
      },
      vertexShader: FINAL_VERT,
      fragmentShader: FINAL_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.finalQuad = new FullScreenQuad(this.finalMat);
    this.read = this.accA;
    this.write = this.accB;
  }

  setSize(width, height) {
    this.sceneRT.setSize(width, height);
    this.accA.setSize(width, height);
    this.accB.setSize(width, height);
    this.bloom.setSize(width, height);
    this.finalMat.uniforms.uRes.value.set(width, height);
  }

  set exposure(v) {
    this.finalMat.uniforms.toneMappingExposure.value = v;
  }

  /** Camera for the final pass's desk-plane maths; call after the camera moved, or after restoring it from jitter. */
  setCamera(camera) {
    const u = this.finalMat.uniforms;
    u.uInvPV.value.copy(camera.matrixWorld).multiply(camera.projectionMatrixInverse);
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
  }

  /** Glow on the desk around the footprint of `box`: sRGB `color` x `strength` at its edge, fading over `falloff` world units gone beyond `reach`, and faded out over the bottom `fade` of the frame so the image edge keeps the page colour. */
  setFloorGlow({ box, radius, falloff, reach, fade, color, strength }) {
    const u = this.finalMat.uniforms;
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    u.uFloorBox.value.set(c.x, c.z, s.x / 2, s.z / 2);
    u.uFloorShape.value.set(radius, falloff, reach, fade);
    const rgb = new THREE.Color(color).getRGB(new THREE.Color(), THREE.SRGBColorSpace);
    u.uFloorGlow.value.set(rgb.r * strength, rgb.g * strength, rgb.b * strength);
  }

  set grain(v) {
    this.finalMat.uniforms.uGrain.value = v;
  }

  renderScene(scene, camera) {
    const { renderer } = this;
    renderer.setRenderTarget(this.sceneRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
  }

  present(source, seed = 0) {
    const { renderer } = this;
    if (this.bloom.strength > 0) this.bloom.render(renderer, null, source, 0, false);
    this.finalMat.uniforms.tScene.value = source.texture;
    this.finalMat.uniforms.uSeed.value = seed;
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    this.finalQuad.render(renderer);
  }

  /** Single-sample frame for the live view. */
  renderLive(scene, camera, seed) {
    this.renderScene(scene, camera);
    this.present(this.sceneRT, seed);
  }

  beginAccumulation() {
    const { renderer } = this;
    for (const rt of [this.accA, this.accB]) {
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
    }
    this.read = this.accA;
    this.write = this.accB;
  }

  /** Render the scene once and fold it into the running average with the given weight. */
  accumulate(scene, camera, weight) {
    const { renderer } = this;
    this.renderScene(scene, camera);
    const u = this.accumQuad.material.uniforms;
    u.tOld.value = this.read.texture;
    u.tNew.value = this.sceneRT.texture;
    u.weight.value = weight;
    renderer.setRenderTarget(this.write);
    this.accumQuad.render(renderer);
    [this.read, this.write] = [this.write, this.read];
  }

  finishAccumulation(seed = 0) {
    this.present(this.read, seed);
  }
}
