// Animación anatómica 3D procedural: catéter epidural caudal -> GRD L4 izquierdo.
// Unidades: cm. x+ = izquierda del paciente, y+ = craneal, z+ = anterior.
import * as THREE from 'three';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

const params = new URLSearchParams(location.search);
const W = +(params.get('w') || 1920), H = +(params.get('h') || 1080);
const DURATION = 20;

/* ------------------------------------------------------------------ util */
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, t) => { const x = clamp((t - a) / (b - a)); return x * x * x * (x * (x * 6 - 15) + 10); };
const lerp = (a, b, t) => a + (b - a) * t;
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = rng(7);

// Interpolación monótona cúbica (Fritsch-Carlson) para cámara sin paradas bruscas
function pchip(keys) {
  const n = keys.length, h = [], d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { h[i] = keys[i + 1][0] - keys[i][0]; d[i] = (keys[i + 1][1] - keys[i][1]) / h[i]; }
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : 2 * d[i - 1] * d[i] / (d[i - 1] + d[i]);
  return t => {
    if (t <= keys[0][0]) return keys[0][1];
    if (t >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0; while (t > keys[i + 1][0]) i++;
    const x = (t - keys[i][0]) / h[i], x2 = x * x, x3 = x2 * x;
    return (2 * x3 - 3 * x2 + 1) * keys[i][1] + (x3 - 2 * x2 + x) * h[i] * m[i] + (-2 * x3 + 3 * x2) * keys[i + 1][1] + (x3 - x2) * h[i] * m[i + 1];
  };
}

/* ------------------------------------------------------------ renderer */
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const BG = 0x0b1c3d;
const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 130, 330);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(28, W / H, 1, 600);
scene.add(camera);
const key = new THREE.DirectionalLight(0xfff4e6, 2.1); key.position.set(-30, 45, 40); camera.add(key);
const fill = new THREE.DirectionalLight(0x9fb8ff, 0.7); fill.position.set(40, -10, 30); camera.add(fill);
const rim = new THREE.DirectionalLight(0xbfd8ff, 0.9); rim.position.set(0, 20, -50); camera.add(rim);
camera.add(key.target); key.target.position.set(0, 0, -100);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a2a55, 0.55));

/* -------------------------------------------------------------- eje espinal */
// ángulo de la tangente (rad) en función de s (cm desde el borde superior de T12, hacia caudal)
const alphaKnots = [[-6, 0.14], [0, 0.12], [6, 0.08], [12, -0.02], [18, -0.16], [22, -0.30], [28, -0.50], [34, -0.78], [38, -1.0], [46, -1.2]];
const alphaAt = s => {
  const k = alphaKnots; if (s <= k[0][0]) return k[0][1]; if (s >= k[k.length - 1][0]) return k[k.length - 1][1];
  let i = 0; while (s > k[i + 1][0]) i++;
  const x = (s - k[i][0]) / (k[i + 1][0] - k[i][0]);
  return lerp(k[i][1], k[i + 1][1], 0.5 - 0.5 * Math.cos(Math.PI * x));
};
const DS = 0.01, S0 = -8, NS = 6000;
const tabY = new Float64Array(NS + 1), tabZ = new Float64Array(NS + 1);
{ let y = 0, z = 0; for (let i = 0; i <= NS; i++) { tabY[i] = y; tabZ[i] = z; const a = alphaAt(S0 + i * DS); y += -Math.cos(a) * DS; z += Math.sin(a) * DS; }
  const y0 = tabY[Math.round(-S0 / DS)], z0 = tabZ[Math.round(-S0 / DS)]; for (let i = 0; i <= NS; i++) { tabY[i] -= y0; tabZ[i] -= z0; } }
function axisAt(s) { const f = (s - S0) / DS, i = Math.floor(f), r = f - i; return { y: lerp(tabY[i], tabY[i + 1], r), z: lerp(tabZ[i], tabZ[i + 1], r), a: alphaAt(s) }; }
// local (x lateral, zl anterior, yl craneal) -> mundo
function L2W(s, x, zl, yl = 0) { const A = axisAt(s), c = Math.cos(A.a), n = Math.sin(A.a); return new THREE.Vector3(x, A.y + yl * c + zl * n, A.z - yl * n + zl * c); }
function frameGroup(s) { const A = axisAt(s), g = new THREE.Group(); g.position.set(0, A.y, A.z); g.rotation.x = -A.a; return g; }

/* ---------------------------------------------------------------- materiales */
function rimify(mat, { rimPow = 2.0, base = 0.45, gain = 1.5, fade = null } = {}) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uFade = { value: new THREE.Vector2(fade ? fade[0] : 1e5, fade ? fade[1] : 1e5 + 1) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWY; uniform vec2 uFade;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float fr = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), ${rimPow.toFixed(2)});
        gl_FragColor.a = clamp(opacity * (${base.toFixed(2)} + ${gain.toFixed(2)} * fr), 0.0, 1.0) * (1.0 - smoothstep(uFade.x, uFade.y, vWY));`);
  };
  return mat;
}
const topFade = [axisAt(0.2).y, axisAt(-2.6).y];
const M = {
  bone: new THREE.MeshStandardMaterial({ color: 0xf1ebdd, roughness: 0.5, metalness: 0.0 }),
  ghost: rimify(new THREE.MeshStandardMaterial({ color: 0xeee8da, roughness: 0.5, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide }), { base: 0.35, gain: 1.7 }),
  ghostMid: rimify(new THREE.MeshStandardMaterial({ color: 0xf1ebdd, roughness: 0.5, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }), { base: 0.5, gain: 1.3 }),
  ghostSoft: rimify(new THREE.MeshStandardMaterial({ color: 0xeee8da, roughness: 0.5, transparent: true, opacity: 0.20, depthWrite: false, side: THREE.DoubleSide }), { base: 0.35, gain: 1.7 }),
  disc: new THREE.MeshStandardMaterial({ color: 0x6f89a8, roughness: 0.55 }),
  dura: rimify(new THREE.MeshStandardMaterial({ color: 0xb9a2ee, roughness: 0.4, transparent: true, opacity: 0.30, depthWrite: false, side: THREE.DoubleSide }), { base: 0.55, gain: 1.8, rimPow: 2.2, fade: topFade }),
  sleeve: rimify(new THREE.MeshStandardMaterial({ color: 0xb9a2ee, roughness: 0.4, transparent: true, opacity: 0.30, depthWrite: false, side: THREE.DoubleSide }), { base: 0.55, gain: 1.8, rimPow: 2.2 }),
  fat: rimify(new THREE.MeshStandardMaterial({ color: 0xf2d9a4, roughness: 0.6, transparent: true, opacity: 0.075, depthWrite: false, side: THREE.DoubleSide }), { base: 0.5, gain: 2.2, rimPow: 2.5, fade: topFade }),
  nerve: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.45, emissive: 0x3a1a12, emissiveIntensity: 0.6 }),
  rootlet: new THREE.MeshStandardMaterial({ color: 0xd99a85, roughness: 0.5, emissive: 0x3a1a12, emissiveIntensity: 0.5 }),
  cord: rimify(new THREE.MeshStandardMaterial({ color: 0xe6d3b4, roughness: 0.5, transparent: true, opacity: 1, side: THREE.DoubleSide }), { base: 1, gain: 0, fade: topFade }),
  filum: new THREE.MeshStandardMaterial({ color: 0xeadfc8, roughness: 0.5 }),
  cath: new THREE.MeshStandardMaterial({ color: 0x14c9b4, roughness: 0.32, emissive: 0x053d38, emissiveIntensity: 0.6 }),
  metal: new THREE.MeshStandardMaterial({ color: 0xd5dbe1, roughness: 0.22, metalness: 1.0, envMapIntensity: 1.3 }),
  intro: rimify(new THREE.MeshStandardMaterial({ color: 0xdfeaf5, roughness: 0.2, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }), { base: 0.6, gain: 1.6 }),
  hub: new THREE.MeshStandardMaterial({ color: 0xe9eef3, roughness: 0.35 }),
};

/* ---------------------------------------------------------------- geometría */
function varTube(curve, radiusFn, { segs = 120, radial = 14, u0 = 0, u1 = 1, colorFn = null, caps = true } = {}) {
  const fr = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], col = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const u = lerp(u0, u1, i / segs), P = curve.getPointAt(u), N = fr.normals[i], B = fr.binormals[i], r = radiusFn(u);
    const c = colorFn ? colorFn(u) : null;
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * Math.PI * 2, dx = N.x * Math.cos(a) + B.x * Math.sin(a), dy = N.y * Math.cos(a) + B.y * Math.sin(a), dz = N.z * Math.cos(a) + B.z * Math.sin(a);
      pos.push(P.x + dx * r, P.y + dy * r, P.z + dz * r); nor.push(dx, dy, dz); if (c) col.push(c.r, c.g, c.b);
    }
  }
  const rs = radial + 1;
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) { const a = i * rs + j, b = (i + 1) * rs + j; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const body = idx.length;
  if (caps) for (const end of [0, segs]) {
    const u = lerp(u0, u1, end / segs), P = curve.getPointAt(u), ci = pos.length / 3, T = curve.getTangentAt(u).multiplyScalar(end ? 1 : -1);
    pos.push(P.x, P.y, P.z); nor.push(T.x, T.y, T.z); if (colorFn) { const c = colorFn(u); col.push(c.r, c.g, c.b); }
    for (let j = 0; j < radial; j++) { const a = end * rs + j; end ? idx.push(ci, a + 1, a) : idx.push(ci, a, a + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (colorFn) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.userData.bodyIndexCount = body; g.userData.radial = radial;
  return g;
}
const catmull = pts => new THREE.CatmullRomCurve3(pts, false, 'centripetal');

// barrido de anillos (x, zl) a lo largo del eje, en el marco local de cada s
function sweep(sA, sB, n, ringFn, mat, { closed = true, order = 0 } = {}) {
  const pos = [], idx = []; let K = 0;
  for (let i = 0; i <= n; i++) { const s = lerp(sA, sB, i / n), ring = ringFn(s, i / n); K = ring.length; for (const [x, zl] of ring) { const v = L2W(s, x, zl); pos.push(v.x, v.y, v.z); } }
  const kk = closed ? K : K - 1;
  for (let i = 0; i < n; i++) for (let j = 0; j < kk; j++) { const a = i * K + j, b = i * K + (j + 1) % K, c = (i + 1) * K + j, d = (i + 1) * K + (j + 1) % K; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.renderOrder = order; return m;
}
const ellipse = (cx, cz, rx, rz, n = 40) => Array.from({ length: n }, (_, k) => { const a = k / n * Math.PI * 2; return [cx + rx * Math.cos(a), cz + rz * Math.sin(a)]; });

/* ---------------------------------------------------------- parámetros anatómicos */
const SV = [1.8, 5.3, 8.8, 12.3, 15.8, 19.3];            // centros T12, L1..L5
const S_SAC0 = 21.6, SAC_L = 11.4, S_SAC1 = S_SAC0 + SAC_L;
const pS = s => (s - S_SAC0) / SAC_L;
// canal: centro zc, semiprofundidad hz, semiancho hx (lumbar y sacro continuos)
const canal = s => { const p = clamp(pS(s)); return { zc: -2.6 + 1.6 * p, hz: 1.0 - 0.7 * p, hx: 1.2 - 0.85 * p }; };
const canalBack = s => { const c = canal(s); return c.zc - c.hz; };
const zSac = s => canal(s).zc + 0.15;
const SUP = new THREE.Group(); scene.add(SUP);

/* ------------------------------------------------------------------ vértebras */
const BWs = [2.2, 2.3, 2.4, 2.5, 2.55, 2.6], TPl = [1.6, 2.4, 2.8, 3.0, 2.6, 2.1];
function lathe(H0, bulge) {
  const prof = [[0.001, -.5], [0.84, -.5], [0.95, -.44], [0.985 * bulge, -.34], [0.93 * bulge, -.1], [0.9 * bulge, 0], [0.93 * bulge, .1], [0.985 * bulge, .34], [0.95, .44], [0.84, .5], [0.001, .5]].map(([r, y]) => new THREE.Vector2(r, y * H0));
  return new THREE.LatheGeometry(prof, 56);
}
SV.forEach((sc, i) => {
  const g = frameGroup(sc); SUP.add(g);
  const BW = BWs[i], body = new THREE.Mesh(lathe(2.6, 1.0), M.bone); body.scale.set(BW, 1, 1.7); g.add(body);
  for (const sx of [1, -1]) {
    const ped = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.5, 8, 16), M.ghostMid); ped.geometry.rotateX(Math.PI / 2); ped.position.set(sx * 1.55, 0.55, -2.3); g.add(ped);
    const lam = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), M.ghost); lam.scale.set(0.95, 0.85, 0.2); lam.position.set(sx * 0.85, 0.15, -3.8); lam.rotation.z = -sx * 0.15; g.add(lam);
    const tp = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, TPl[i], 8, 16), M.ghostSoft); tp.geometry.rotateZ(Math.PI / 2); tp.geometry.translate(sx * (1.8 + TPl[i] / 2), 0, 0); tp.position.set(0, 0.3, -3.3); tp.rotation.y = sx * 0.2; g.add(tp);
    const sa = new THREE.Mesh(new THREE.SphereGeometry(0.48, 20, 14), M.ghost); sa.scale.set(0.85, 1.35, 0.9); sa.position.set(sx * 1.45, 1.0, -3.6); g.add(sa);
    const ia = new THREE.Mesh(new THREE.SphereGeometry(0.46, 20, 14), M.ghost); ia.scale.set(0.8, 1.3, 0.9); ia.position.set(sx * 1.15, -1.0, -4.0); g.add(ia);
  }
  const sp = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), M.ghost); sp.scale.set(0.28, 0.85, 1.25); sp.position.set(0, 0, -5.0); sp.rotation.x = -0.2; g.add(sp);
});
// discos
for (let i = 0; i < SV.length; i++) {
  const sm = i < SV.length - 1 ? (SV[i] + SV[i + 1]) / 2 : (SV[i] + 1.3 + S_SAC0) / 2, g = frameGroup(sm); SUP.add(g);
  const BW = i < SV.length - 1 ? (BWs[i] + BWs[i + 1]) / 2 : BWs[5];
  const d = new THREE.Mesh(lathe(i < SV.length - 1 ? 0.96 : 1.1, 1.03), M.disc); d.scale.set(BW * 1.0, 1, 1.72); g.add(d);
}
// sacro y cóccix
const wSac = p => 0.9 + 4.3 * Math.pow(1 - p, 1.4);
const zfSac = p => 1.7 - 1.8 * p;
const zbSac = s => canalBack(s) - 0.15 - 0.4 * (1 - clamp(pS(s)));
function outerEll(s) { const p = pS(s), zf = zfSac(p), zb = zbSac(s); return { W: wSac(p), zm: (zf + zb) / 2, Dz: (zf - zb) / 2 }; }
const winHalf = s => { const o = outerEll(s), c = canal(s); return Math.asin(Math.min(0.95, (c.hx + 0.3) / o.W)); };
function troughRing(s) {
  const o = outerEll(s), c = canal(s), K = 56, out = [], inn = [], d = winHalf(s), a0 = 1.5 * Math.PI + d, a1 = 3.5 * Math.PI - d;
  for (let k = 0; k <= K; k++) { const th = lerp(a0, a1, k / K); out.push([o.W * Math.cos(th), o.zm + o.Dz * Math.sin(th)]); inn.push([c.hx * Math.cos(th), c.zc + c.hz * Math.sin(th)]); }
  return out.concat(inn.reverse());
}
{
  const m = sweep(S_SAC0, S_SAC1 + 1.2, 60, s => troughRing(Math.min(s, S_SAC1)), M.bone); SUP.add(m);
  // tapa superior
  const ring = troughRing(S_SAC0), shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, z)));
  const sg = new THREE.ShapeGeometry(shape), p = sg.attributes.position;
  for (let i = 0; i < p.count; i++) { const v = L2W(S_SAC0, p.getX(i), p.getY(i)); p.setXYZ(i, v.x, v.y, v.z); }
  p.needsUpdate = true; sg.computeVertexNormals(); const cap = new THREE.Mesh(sg, M.bone); cap.material = M.bone.clone(); cap.material.side = THREE.DoubleSide; SUP.add(cap);
  // placa posterior translúcida con hiato (arco invertido)
  const NU = 24, NP = 40, pos = [], idx = [];
  for (let j = 0; j <= NU; j++) {
    const f = j / NU, pend = lerp(0.60, 0.86, Math.pow(Math.abs(f - 0.5) * 2, 1.6));
    for (let i = 0; i <= NP; i++) { const s = S_SAC0 + SAC_L * pend * i / NP, o = outerEll(s), d = winHalf(s), th = lerp(1.5 * Math.PI - d, 1.5 * Math.PI + d, f), v = L2W(s, o.W * Math.cos(th), o.zm + o.Dz * Math.sin(th) - 0.02); pos.push(v.x, v.y, v.z); }
  }
  for (let j = 0; j < NU; j++) for (let i = 0; i < NP; i++) { const a = j * (NP + 1) + i, b = (j + 1) * (NP + 1) + i; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const plate = new THREE.Mesh(g, M.ghost); plate.renderOrder = 3; SUP.add(plate);
  // cuernos sacros y cresta lateral
  for (const sx of [1, -1]) {
    const s = S_SAC0 + SAC_L * 0.88, c = canal(s), horn = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.7, 6, 12), M.bone);
    horn.position.copy(L2W(s, sx * (c.hx + 0.32), c.zc - c.hz - 0.1, 0.1)); horn.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), L2W(s, 0, 0, 1).sub(L2W(s, 0, 0, 0)).normalize()); SUP.add(horn);
  }
  // cóccix
  [[33.6, 0.85, 0.95], [34.9, 0.62, 0.8], [36.0, 0.48, 0.7], [37.0, 0.34, 0.6]].forEach(([s, rx, ry]) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), M.bone); e.scale.set(rx, ry, 0.5 * rx + 0.1); const A = axisAt(s);
    e.position.copy(L2W(s, 0, -0.95)); e.rotation.x = -A.a; SUP.add(e);
  });
}

/* ---------------------------------------------- espacio epidural, saco dural, médula */
{
  const sTop = -2.6, sEnd = 31.0;
  const fat = sweep(sTop, sEnd, 260, s => { const c = canal(s); return ellipse(0, c.zc, (c.hx - 0.04) * 0.97, (c.hz - 0.03) * 0.97, 36); }, M.fat, { order: 1 }); SUP.add(fat);
  const taper = s => s < 22.3 ? 1 : 0.04 + 0.96 * (0.5 + 0.5 * Math.cos(Math.PI * clamp((s - 22.3) / 2.9)));
  const dura = sweep(sTop, 25.2, 300, s => ellipse(0, zSac(s), 0.85 * taper(s), 0.72 * taper(s), 36), M.dura, { order: 2 }); SUP.add(dura);
  // médula espinal + cono medular (termina en L1-L2)
  const cordPts = []; for (let s = sTop; s <= 6.9; s += 0.7) cordPts.push(L2W(s, 0, zSac(s)));
  const cc = catmull(cordPts), Lc = cc.getLength(), sOf = u => sTop + (6.9 - sTop) * u;
  const cord = new THREE.Mesh(varTube(cc, u => { const s = sOf(u); return s < 5.0 ? 0.43 : 0.43 * Math.sqrt(Math.max(0.0005, 1 - Math.pow((s - 5.0) / 1.9, 2))); }, { segs: 160, radial: 20, caps: false }), M.cord); SUP.add(cord);
  // filum terminal
  const fp = []; for (let s = 6.8; s <= 36; s += 1.2) fp.push(L2W(s, 0, s < 22 ? zSac(s) : canal(Math.min(s, S_SAC1)).zc + 0.1 * (s > S_SAC1 ? 0 : 1)));
  SUP.add(new THREE.Mesh(varTube(catmull(fp), () => 0.03, { segs: 200, radial: 6 }), M.filum));
}

/* ------------------------------------------------ raíces, ganglios y ramos (L1-L5) */
const copper = new THREE.Color(0xc98672), copperDRG = new THREE.Color(0xe7a08a);
const sFor = n => [6.65, 10.15, 13.65, 17.15, 20.7][n], lenFor = n => [1.8, 2.4, 3.0, 3.6, 4.3][n];
const sCord = [3.3, 3.8, 4.3, 4.8, 5.4];
const DRG = {};   // sx -> n -> {center, dir}
for (let n = 0; n < 5; n++) for (const sx of [1, -1]) {
  const sf = sFor(n), sa = sf - lenFor(n);
  const P = [[sa, 0.60, -2.25], [lerp(sa, sf, 0.45), 1.05, -2.12], [sf - 0.35, 1.5, -2.0], [sf, 1.95, -2.0], [sf + 0.7, 2.6, -1.95], [sf + 1.5, 3.3, -1.8], [sf + 2.3, 3.9, -1.65]].map(([s, x, z]) => L2W(s, sx * x, z));
  const cur = catmull(P), Lt = cur.getLength(), F = P[3];
  // arco más cercano al centro del foramen
  let a3 = 0, best = 1e9; for (let i = 0; i <= 400; i++) { const d = cur.getPointAt(i / 400).distanceTo(F); if (d < best) { best = d; a3 = i / 400 * Lt; } }
  const aA = a3 - 0.75, aB = a3 + 0.65;
  const rad = u => { const a = u * Lt; let r = 0.095; if (a > aA && a < aB) { const w = (a - aA) / (aB - aA); r += (0.30 - 0.095) * Math.pow(Math.sin(Math.PI * w), 0.75); }
    if (a >= aB) r = lerp(0.095, 0.17, smooth(aB, aB + 0.7, a)) * lerp(1, 0.75, smooth(aB + 0.7, Lt, a)); return r; };
  const colf = u => { const a = u * Lt, w = clamp((a - aA) / (aB - aA)), k = a > aA && a < aB ? Math.sin(Math.PI * w) : 0; return copper.clone().lerp(copperDRG, k); };
  const nerve = new THREE.Mesh(varTube(cur, rad, { segs: 140, radial: 18, colorFn: colf }), M.nerve); SUP.add(nerve);
  // manguito dural (hasta el polo proximal del ganglio)
  const uEnd = (aA + 0.12) / Lt, sl = new THREE.Mesh(varTube(cur, u => { const a = u * Lt; return (0.34 + 0.12 * (1 - smooth(0, 0.7, a))) * lerp(1, 0.55, smooth(aA - 0.4, aA + 0.12, a)); }, { segs: 60, radial: 18, u1: uEnd }), M.sleeve); sl.renderOrder = 2; SUP.add(sl);
  // raíz ventral
  const V = [[sa + 0.2, 0.55, -1.95], [sf - 0.5, 1.5, -1.65], [sf + 0.15, 1.95, -1.7], [sf + 0.8, 2.6, -1.85]].map(([s, x, z]) => L2W(s, sx * x, z));
  SUP.add(new THREE.Mesh(varTube(catmull(V), () => 0.06, { segs: 40, radial: 8 }), M.nerve.clone())); SUP.children.at(-1).material.vertexColors = false; SUP.children.at(-1).material.color.copy(copper);
  // ramo posterior y rama medial
  const sp = cur.getPointAt(clamp((aB + 0.5) / Lt));
  const R = [sp, L2W(sf + 0.5, sx * 2.85, -2.7), L2W(sf + 0.35, sx * 2.8, -3.35)];
  SUP.add(new THREE.Mesh(varTube(catmull(R), u => lerp(0.075, 0.04, u), { segs: 50, radial: 8 }), M.nerve.clone())); SUP.children.at(-1).material.vertexColors = false; SUP.children.at(-1).material.color.copy(copper);
  DRG[sx] = DRG[sx] || {}; const tg = cur.getTangentAt(a3 / Lt); DRG[sx][n] = { center: cur.getPointAt(a3 / Lt), dir: tg };
  // raicillas intradurales (cauda equina)
  for (let k = 0; k < 2; k++) {
    const s0 = sCord[n] + rand() * 0.8, ang = rand() * 6.28, r0 = 0.1 + rand() * 0.2, r1 = 0.3 + rand() * 0.2, pts = [];
    pts.push(L2W(s0, Math.cos(ang) * r0, zSac(s0) + Math.sin(ang) * r0));
    const am = ang * 0.3 + sx * 0.9;
    for (const f of [0.25, 0.6, 0.9]) { const s = lerp(s0, sa, f), rr = lerp(r0, r1, f) * (1 - 0.0); pts.push(L2W(s, sx * 0.2 * f + Math.cos(am) * rr * 0.8, zSac(s) + Math.sin(am) * rr * 0.8)); }
    pts.push(L2W(sa, sx * 0.58, -2.25)); pts.push(L2W(sa + 0.35, sx * 0.72, -2.2));
    SUP.add(new THREE.Mesh(varTube(catmull(pts), () => 0.032, { segs: 60, radial: 6, caps: false }), M.rootlet));
  }
}
// raicillas sacras / cauda equina caudal
for (let k = 0; k < 10; k++) {
  const s0 = 5.2 + rand() * 1.6, ang = rand() * 6.28, r0 = 0.1 + rand() * 0.25, r1 = 0.35 + rand() * 0.25, sEndk = 21.5 + rand() * 3.0, pts = [];
  pts.push(L2W(s0, Math.cos(ang) * r0, zSac(s0) + Math.sin(ang) * r0));
  for (const f of [0.3, 0.65, 0.9, 1]) { const s = lerp(s0, sEndk, f), tp = s < 22.3 ? 1 : 0.1 + 0.9 * (0.5 + 0.5 * Math.cos(Math.PI * clamp((s - 22.3) / 2.9))); const rr = lerp(r0, r1, Math.min(1, f * 1.3)) * tp; pts.push(L2W(s, Math.cos(ang) * rr, zSac(s) + Math.sin(ang) * rr)); }
  SUP.add(new THREE.Mesh(varTube(catmull(pts), () => 0.03, { segs: 90, radial: 6, caps: false }), M.rootlet));
}

/* ------------------------------------------------------------------ catéter */
const R_CATH = 0.11;
const D_IN = (() => { const a = 35 * Math.PI / 180; return { yl: Math.cos(a), zl: Math.sin(a) }; })();
const S_E = S_SAC0 + SAC_L * 0.76, cE = canal(S_E), ZE = cE.zc - cE.hz + 0.25;
const along = d => L2W(S_E, 0, ZE + D_IN.zl * d, D_IN.yl * d);   // d<0 fuera del paciente
const cathPts = [-40, -28, -17, -9, -5, -2.5].map(along);
cathPts.push(along(0), along(0.7));
for (const [s, x] of [[29.2, 0], [27.8, 0], [26.0, 0], [24.2, 0], [22.6, 0], [21.1, 0], [20.0, 0]]) cathPts.push(L2W(s, x, canalBack(s) + 0.25));
for (const [s, x, z] of [[19.2, 0.18, -3.34], [18.5, 0.55, -3.18], [17.9, 1.0, -2.95], [17.5, 1.3, -2.8], [17.15, 1.55, -2.68]]) cathPts.push(L2W(s, x, z));
const cathCurve = catmull(cathPts), L_P = cathCurve.getLength();
let A_E = 0, bestD = 1e9; for (let i = 0; i <= 4000; i++) { const d = cathCurve.getPointAt(i / 4000).distanceTo(along(0)); if (d < bestD) { bestD = d; A_E = i / 4000 * L_P; } }
const SEGS = 2400, RAD = 18;
const cathGeo = varTube(cathCurve, () => R_CATH, { segs: SEGS, radial: RAD, caps: false });
const cathMesh = new THREE.Mesh(cathGeo, M.cath); SUP.add(cathMesh);
const tipBall = new THREE.Mesh(new THREE.SphereGeometry(R_CATH * 1.001, 24, 16), M.metal); SUP.add(tipBall);
let metalMesh = null; const METAL_LEN = 1.2;
// introductor corto + conector
{
  const ip = [along(-3.4), along(0.15)], ic = new THREE.LineCurve3(ip[0], ip[1]);
  const t = new THREE.Mesh(varTube(ic, () => 0.24, { segs: 4, radial: 20 }), M.intro); t.renderOrder = 4; SUP.add(t);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.55, 0.9, 24), M.hub), dir = ip[1].clone().sub(ip[0]).normalize();
  hub.position.copy(ip[0].clone().addScaledVector(dir, -0.35)); hub.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate()); SUP.add(hub);
}
const A0 = A_E - 3.0;
// perfil de velocidad -> progreso normalizado
const velW = t => smooth(3.0, 4.3, t) * (1 - smooth(15.4, 17.0, t));
const NQ = 4000, Q = new Float64Array(NQ + 1); { let acc = 0; for (let i = 1; i <= NQ; i++) { const t = i / NQ * DURATION; acc += velW(t); Q[i] = acc; } for (let i = 0; i <= NQ; i++) Q[i] /= Q[NQ]; }
const progress = t => { const f = clamp(t / DURATION) * NQ, i = Math.min(NQ - 1, Math.floor(f)); return lerp(Q[i], Q[i + 1], f - i); };
const tipArc = t => lerp(A0, L_P, progress(t));
function updateCatheter(t) {
  const a = tipArc(t), body = Math.max(0, a - METAL_LEN + 0.08), nSeg = Math.floor(body / L_P * SEGS);
  cathGeo.setDrawRange(0, nSeg * RAD * 6);
  const tp = cathCurve.getPointAt(clamp(a / L_P)); tipBall.position.copy(tp);
  if (metalMesh) { SUP.remove(metalMesh); metalMesh.geometry.dispose(); }
  const u1 = clamp(a / L_P), u0 = clamp((a - METAL_LEN) / L_P);
  metalMesh = new THREE.Mesh(varTube(cathCurve, () => R_CATH * 1.004, { segs: 40, radial: 22, u0, u1, caps: false }), M.metal); SUP.add(metalMesh);
  return tp;
}

/* ------------------------------------------------------------------- cámara */
const Tov = L2W(19.5, 0, -2.5), tipFinal = cathCurve.getPointAt(1), Gdrg = DRG[1][3].center;
const Tfinal = tipFinal.clone().lerp(Gdrg, 0.5);
const camD = pchip([[0, 90], [3, 85], [6, 34], [9, 40], [13, 44], [15, 32], [17, 23], [18.5, 17.5], [20, 17.5]]);
const camPsi = pchip([[0, -0.10], [3, 0.0], [6, 0.10], [13, 0.14], [17, 0.95], [18.5, 1.0], [20, 1.0]]);
const camPhi = pchip([[0, 0.22], [3, 0.22], [6, 0.30], [13, 0.22], [17, 0.12], [20, 0.12]]);
const T6 = L2W(S_E, 0, ZE, 3.5);
function renderFrame(t) {
  const tip = updateCatheter(t);
  let T;
  if (t < 3) T = Tov.clone();
  else if (t < 6) T = Tov.clone().lerp(T6, smooth(3, 6, t));
  else {
    const k = smooth(6, 9, t), tip6 = cathCurve.getPointAt(clamp(tipArc(6) / L_P));
    T = tip.clone().add(T6.clone().sub(tip6).multiplyScalar(1 - k)).add(new THREE.Vector3(0, 1.2 * k, 0));
    T.lerp(Tfinal, smooth(13, 17, t));
  }
  const D = camD(t), psi = camPsi(t), phi = camPhi(t);
  camera.position.set(T.x + D * Math.sin(psi) * Math.cos(phi), T.y + D * Math.sin(phi), T.z - D * Math.cos(psi) * Math.cos(phi));
  camera.up.set(0, 1, 0); camera.lookAt(T);
  renderer.render(scene, camera);
}
window.renderFrame = renderFrame; window.DURATION = DURATION; window.ready = true;
renderFrame(0);
