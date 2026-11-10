// SRT 3D 장면: 정면(열차가 다가옴) · 측면 통과 · 3D 지도 · 지도 위 낮은 배경(깃발·정차역 화면 뒤)
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { normalize, loadGLB } from '../intro3d.js';
import { PROVINCES, NORTH_KOREA, project } from '../data/koreaMap.js';
import { STATIONS } from '../data/stations.js';
import { buildRoutePath } from '../routePath.js';
import { layout } from '../layout.js';

export const PINK = '#d0378f', CYAN = '#84bfe3', SKY = '#8fb4ff';
export const MAP_H = 5;                    // 지도 두께 (지도 좌표: 경도 1° ≈ 80, 위도 1° = 100)
const FOG = 0xe4e6e9;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const seg = (t, a, b) => clamp01((t - a) / (b - a));
export const easeOut = (x) => 1 - Math.pow(1 - x, 3);
export const easeIn = (x) => x * x * x;
export const easeInOut = (x) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = (a, b, k) => a + (b - a) * k;

// SVG 경로 문자열 → 고리 목록
function rings(d) {
  return d.split('M').filter(Boolean).map((part) => part.replace(/Z/g, '').split('L').map((p) => p.split(',').map(Number)));
}

function gradientTexture(stops, w = 4, h = 256) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'), g = ctx.createLinearGradient(0, 0, 0, h);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// 색 줄무늬(가운데가 진하고 양끝이 투명) 텍스처
function streakTexture(col) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 8;
  const ctx = c.getContext('2d'), g = ctx.createLinearGradient(0, 0, 256, 0);
  g.addColorStop(0, col + '66'); g.addColorStop(.12, col + 'dd'); g.addColorStop(.85, col + 'ee'); g.addColorStop(1, col + 'aa');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 8);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class SrtScene {
  constructor(canvas, cfg, route) {
    this.cfg = cfg; this.route = route;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.1, 6000);
    this.resize();
    addEventListener('stage-resize', () => this.resize());
    this.ready = this.build();
  }

  resize() {
    const w = Math.round(layout.W), h = Math.round(layout.H);
    this.renderer.setPixelRatio(Math.min(2, (window.devicePixelRatio || 1) * layout.s));
    this.renderer.setSize(w, h, false);
    // 콘텐츠 상자(1024×768) 높이에 세로 화각 40°를 맞춤 → 화면이 더 길면 위아래로 더 보임
    const v = 2 * Math.atan(Math.tan((20 * Math.PI) / 180) * (h / layout.box.h));
    this.camera.aspect = w / h; this.camera.fov = (v * 180) / Math.PI; this.camera.updateProjectionMatrix();
    this._fitKey = '';
  }

  async build() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // ── 선로 장면 (정면 · 측면) ───────────────────────
    const T = this.track = new THREE.Scene();
    // 하늘: 'blue' 위는 파랗고 지평선 쪽은 옅은 하늘빛 (2021-06-09 영상) / 'white' 흰 바탕 (2023-09-16 영상)
    const blue = (this.cfg.sky || 'blue') !== 'white';
    T.background = gradientTexture(blue ? [[0, '#3f9fe6'], [.22, '#7cc3f0'], [.42, '#d3eefb'], [.5, '#eaf7fd'], [1, '#f1fafe']] : [[0, '#eceef1'], [.5, '#f5f6f8'], [1, '#f7f7f8']]);
    T.fog = new THREE.Fog(blue ? 0xe6f5fc : 0xf5f6f8, 90, 520);
    T.environment = env; T.environmentIntensity = .8;
    T.add(new THREE.HemisphereLight(0xffffff, 0xdfe2e7, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(20, 40, 30); T.add(sun);
    const tg = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ color: blue ? 0xeef9fe : 0xf4f5f7 }));
    tg.rotation.x = -Math.PI / 2; T.add(tg);
    // 만화풍 검은 선로 (영상: 열차 폭의 두 배쯤 되는 넓은 선로): 검은 바탕 + 가는 흰 틈 + 양옆으로 삐죽 나온 침목
    const black = new THREE.MeshBasicMaterial({ color: 0x17181b });
    const bed = new THREE.Mesh(new THREE.BoxGeometry(5.6, .2, 1600), black); bed.position.set(0, .1, -400); T.add(bed);
    const N = 1500;
    const gaps = new THREE.InstancedMesh(new THREE.BoxGeometry(3.7, .05, .34), new THREE.MeshBasicMaterial({ color: 0xf2f3f5 }), N);
    const ties = new THREE.InstancedMesh(new THREE.BoxGeometry(6.6, .2, .46), black, N);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < N; i++) {
      const z = 400 - i * 1.05;
      m4.makeTranslation(0, .21, z - .52); gaps.setMatrixAt(i, m4);
      m4.makeTranslation(0, .1, z); ties.setMatrixAt(i, m4);
    }
    T.add(gaps, ties);

    // 컬러 띠 (정면 장면): 선로 위 공간을 감싸는 띠 터널 → 열차가 그 안을 지나 빠져나오면
    //   띠가 잔상처럼 열차를 따라 늘어나다가 뒤에서부터 줄어들며 바람처럼 사라짐
    this.streaks = [];
    const cols = ['#d0378f', '#84bfe3', '#e6a6d0', '#d0378f', '#bcdcf0', '#84bfe3'];
    const NB = 22;
    for (let i = 0; i < NB; i++) {
      // 각도: 열차 양옆을 감쌈 (오른쪽 -25°~55°, 왼쪽 125°~205°, 바로 위·땅 밑은 비움)
      const half = NB / 2, j = i % half, f = (j + Math.random() * .7) / half;
      const deg = i < half ? -25 + 80 * f : 205 - 80 * f;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]), 2));
      g.setIndex([0, 2, 1, 1, 2, 3]);
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: streakTexture(cols[i % cols.length]), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      mesh.frustumCulled = false;
      mesh.userData = {
        a: (deg * Math.PI) / 180, w: (3 + Math.random() * 5) * Math.PI / 180,
        r: 4.2 + Math.random() * 3.2,                  // 열차(높이 4)를 감싸는 반지름
        back: -330 - Math.random() * 60,               // 터널 뒤끝
        front: 2 + Math.random() * 6,                  // 터널 앞끝 (카메라 가까이)
        lag: .55 + Math.random() * .5,                 // 뒤끝이 따라붙는 빠르기
      };
      this.streaks.push(mesh); T.add(mesh);
    }
    // 측면 장면 리본 (분홍·하늘)
    this.sideRibbons = [PINK, PINK, '#7fd3e6'].map((c, i) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 200, 1), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, transparent: true, opacity: .9 }));
      m.userData.y = 4.35 + i * .42; T.add(m); return m;
    });

    // 열차
    const mc = this.cfg.models.train;
    const raw = await loadGLB(mc.url);
    let train;
    if (raw) train = normalize(raw, mc, 'SRT 열차', true);
    else {
      train = new THREE.Group();
      const white = new THREE.MeshStandardMaterial({ color: 0xf5f6f8, roughness: .35 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(150, 3.4, 3), white); body.position.set(-4, 2.2, 0); train.add(body);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), white);
      nose.scale.set(1.5, 7, 1.5); nose.rotation.z = -Math.PI / 2; nose.position.set(71, 1.6, 0); train.add(nose);
      const stripe = (c, y) => { const s = new THREE.Mesh(new THREE.BoxGeometry(150, .22, 3.04), new THREE.MeshStandardMaterial({ color: c })); s.position.set(-4, y, 0); train.add(s); };
      stripe(0xb0306f, 3.75); stripe(0xd0378f, 1.2);
      const win = new THREE.Mesh(new THREE.BoxGeometry(146, .6, 3.04), new THREE.MeshStandardMaterial({ color: 0x1b2433 })); win.position.set(-6, 2.7, 0); train.add(win);
    }
    const tb = new THREE.Box3().setFromObject(train);
    this.trainFront = tb.max.x; this.trainLen = tb.max.x - tb.min.x;
    train.rotation.y = -Math.PI / 2;            // 앞(+X) → +Z (카메라 쪽)
    this.train = train; T.add(train);
    // 열차 사라짐 효과 (영상): 앞머리가 화면 오른쪽 끝을 지날 때 가는 세로 줄무늬로 비쳐 보이며 사라지고,
    //   끝날 때는 꼬리 쪽부터 창문이 점선처럼 끊기며 사라짐. (세계 좌표 z 기준, 줄무늬는 잘라내기로 그림)
    const fx = this.trainFx = { uNose: { value: new THREE.Vector2(1e5, 1e6) }, uTail: { value: -1e6 } };
    const patch = (sh) => {
      sh.uniforms.uNose = fx.uNose; sh.uniforms.uTail = fx.uTail;
      sh.vertexShader = 'varying float vWz;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vWz = (modelMatrix * vec4(transformed, 1.0)).z;');
      sh.fragmentShader = 'varying float vWz;\nuniform vec2 uNose;\nuniform float uTail;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\n  float fxN = smoothstep(uNose.x, uNose.y, vWz);\n  if (fxN > 0.0 && fract(vWz * 22.0) < fxN * 1.02) discard;\n  float fxT = smoothstep(uTail, uTail - 16.0, vWz);\n  if (fxT > 0.0 && fract(vWz * 1.7) < fxT * 1.02) discard;');
    };
    train.traverse((m) => {
      if (!m.material) return;
      for (const mt of Array.isArray(m.material) ? m.material : [m.material]) { mt.onBeforeCompile = patch; mt.needsUpdate = true; }
    });

    // ── 지도 장면 ─────────────────────────────────
    const M = this.map = new THREE.Scene();
    M.background = new THREE.Color(FOG);
    M.fog = new THREE.Fog(FOG, 600, 1500);
    M.add(new THREE.HemisphereLight(0xffffff, 0xd9dde3, 2.3));
    M.add(new THREE.AmbientLight(0xffffff, .55));
    const ms = new THREE.DirectionalLight(0xffffff, 1.25);
    ms.position.set(-260, 420, -320); ms.target.position.set(260, 0, 260);
    ms.castShadow = true; ms.shadow.mapSize.set(2048, 2048);
    Object.assign(ms.shadow.camera, { left: -520, right: 520, top: 560, bottom: -560, near: 10, far: 1700 });
    ms.shadow.bias = -0.0004; ms.shadow.radius = 6;
    M.add(ms, ms.target);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshBasicMaterial({ color: 0xdfe1e5 }));
    ground.rotation.x = -Math.PI / 2; M.add(ground);
    const shade = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.ShadowMaterial({ opacity: .16 }));
    shade.rotation.x = -Math.PI / 2; shade.position.y = .05; shade.receiveShadow = true; M.add(shade);
    // 시도 경계마다 따로 그리면 너무 많아서 하나로 합침 (윗면 흰색, 옆면 회색 = 꼭짓점 색)
    const geos = [], top = new THREE.Color(0xffffff), sideC = new THREE.Color(0xd5d9df);
    const addLand = (d) => {
      for (const r of rings(d)) {
        if (r.length < 4) continue;
        const shape = new THREE.Shape(r.map(([x, y]) => new THREE.Vector2(x, -y)));
        let g = new THREE.ExtrudeGeometry(shape, { depth: MAP_H, bevelEnabled: false, curveSegments: 1 });
        if (g.index) g = g.toNonIndexed();
        const n = g.attributes.position.count, col = new Float32Array(n * 3);
        for (const gr of g.groups) { const c = gr.materialIndex === 0 ? top : sideC; for (let i = gr.start; i < gr.start + gr.count; i++) c.toArray(col, i * 3); }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.clearGroups();
        g.rotateX(-Math.PI / 2); geos.push(g);
      }
    };
    for (const p of PROVINCES) addLand(p.d);
    addLand(NORTH_KOREA);
    const landMesh = new THREE.Mesh(mergeGeometries(geos, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    landMesh.castShadow = true; landMesh.receiveShadow = true; M.add(landMesh);
    geos.forEach((g) => g.dispose());
    // 남한 본토 외곽점 (카메라 맞춤용, 제주 제외)
    this.skPts = [];
    for (const p of PROVINCES) for (const r of rings(p.d)) for (let i = 0; i < r.length; i += 3) if (r[i][1] < 470 && r[i][0] > 115 && r[i][0] < 420) this.skPts.push(V(r[i][0], MAP_H, r[i][1]));

    // 노선 (낮은 배경에서만 보이는 회색 선 + 역 점)
    const rp = this.rp = buildRoutePath(this.route.all);
    this.stationXY = rp.stationXY;
    const pts = rp.samples.map((p) => V(p.x, MAP_H + .15, p.y));
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(64, pts.length * 2), .22, 6, false);
    this.routeTube = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: 0x8e9299 }));
    M.add(this.routeTube);
    this.dots = rp.stationXY.map((p) => {
      const g = new THREE.Group();
      const o = new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, .3, 18), new THREE.MeshBasicMaterial({ color: 0x8e9299 }));
      const w = new THREE.Mesh(new THREE.CylinderGeometry(.6, .6, .32, 18), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      w.position.y = .02; g.add(o, w); g.position.set(p.x, MAP_H + .2, p.y); M.add(g); return g;
    });
    // 셰이더 미리 준비 (첫 장면 전환 때 멈칫하지 않게)
    this.fitMap(); this.setCam(this.mapCam);
    this.renderer.compile(M, this.camera); this.renderer.compile(T, this.camera);
    this.renderer.render(M, this.camera);
  }

  // ── 선로 장면 ─────────────────────────────────
  placeTrainZ(front) {        // 앞머리가 z=front에 오도록
    this.train.position.set(0, .2 + (this.cfg.models.train.yOffset || 0), front - this.trainFront);
  }

  // 정면: 소실점에서 색 줄무늬가 퍼지고 열차가 다가옴 → 카메라가 오른쪽 위로 비켜 섬
  // 정면 장면 띠 (영상: 소실점(열차)에서 화면 끝까지 퍼진 띠 → 바깥 끝이 계단처럼 차례로 열차 쪽으로 줄어듦
  //   → 열차 앞머리를 감싼 짧은 띠가 열차와 함께 다가오다 사라짐)
  updateBands(front, t, cam) {
    const cy = 2.0 + (this.cfg.models.train.yOffset || 0);
    const near = cam.position.z - 5;
    this.streaks.forEach((s, i) => {
      const u = s.userData, pos = s.geometry.attributes.position;
      const t0 = .62 + ((i * 7) % this.streaks.length) / this.streaks.length * .3;   // 띠마다 줄어드는 시작 시각이 다름 (계단 모양)
      const k = easeInOut(seg(t, t0, t0 + .38));
      const zF0 = u.back + (near - u.back) * easeOut(seg(t, 0, .3));
      const zF = zF0 + (front + 2.5 - zF0) * k;
      const zB = u.back + (front - 9 - u.back) * k;
      const rx = u.r * 1.55 + (4.6 - u.r * 1.55) * k, ry = u.r * .65 + (2.9 - u.r * .65) * k;
      const hw = (u.w / 2) * (1 + .6 * k);
      const P = (ang, z, j) => pos.setXYZ(j, Math.cos(ang) * rx, cy + Math.sin(ang) * ry, z);
      P(u.a - hw, zB, 0); P(u.a + hw, zB, 1); P(u.a - hw, Math.max(zF, zB + .5), 2); P(u.a + hw, Math.max(zF, zB + .5), 3);
      pos.needsUpdate = true;
      s.visible = true;
      s.material.opacity = Math.min(1, t / .12) * (1 - seg(t, 1.25, 1.5));
    });
  }

  tunnel(t, T) {
    const cam = this.camera;
    // 열차: 처음엔 소실점 근처에 작게 있다가 띠가 줄어들 무렵부터 빠르게 다가옴
    const front = -230 + 222 * easeInOut(seg(t, .25, T));
    this.placeTrainZ(front);
    this.sideRibbons.forEach((r) => (r.visible = false));
    const pan = easeInOut(seg(t, T - .55, T));
    cam.position.copy(V(0, 2.6, 16).lerp(V(-8, 4.4, 9), pan));
    cam.lookAt(V(0, 2.2, -60).lerp(V(3, 2, -20), pan));
    this.updateBands(front, t, cam);
    this.renderer.render(this.track, cam);
  }

  // 측면: 열차 옆에 바짝 붙어 따라감. 분홍 띠 두 줄이 지붕 위를, 하늘색 띠가 창문 줄을 따라 열차를 감싸고 흐름
  //   → 열차가 빠져나가면 띠가 뒤에서부터 줄어들며 바람처럼 사라짐
  // ── 열차 장면 카메라 (2021-06-09 정면 촬영 영상을 프레임 단위로 잰 값) ─────────
  //  시각(화살표 묶음이 나타난 뒤 초), 선로에서 왼쪽으로 떨어진 거리, 높이, 오른쪽으로 돌린 각도(°: 0 = 선로 정면)
  //  0.9초 선로 위 정면 → 1.25초 낮게 내려앉으며 왼쪽으로 → 1.7초부터 다가오는 열차를 따라 오른쪽으로 돌며 물러남
  //  → 2.7초 앞머리가 화면 오른쪽 끝 → 3.05초부터 옆모습(소실점은 화면 왼쪽 밖)
  static CAM = [[0, .3, 4.5, 2], [.9, .3, 4.5, 2], [1.2, 3.3, 3, 7.5], [1.7, 4.2, 3, 10.5], [2.3, 7, 3, 9.5], [2.5, 7.5, 3, 21], [2.7, 8, 3, 25], [2.8, 8, 3, 28], [3.2, 9.2, 2.8, 35.5], [99, 9.2, 2.8, 35.5]];
  //  열차 앞머리 위치(z): 1.7초까지 멀리서 천천히 → 2.3초부터 빠르게 다가와 2.8초에 화면 오른쪽 끝을 지남
  static FRONT = [[0, -50], [1.0, -42], [1.7, -36], [2.0, -35], [2.3, -33], [2.5, -11.5], [2.7, -8.8], [2.8, -5.9]];

  // 표(K)에서 시각 t의 값 (부드럽게 이음). mEnd: 마지막 점에서의 빠르기
  keyAt(K, t, mEnd = 0) {
    let i = 0; while (i < K.length - 2 && t > K[i + 1][0]) i++;
    const a = K[i], b = K[i + 1], p = K[Math.max(0, i - 1)], n = K[Math.min(K.length - 1, i + 2)];
    const dt = b[0] - a[0], u = Math.min(1, Math.max(0, (t - a[0]) / dt)), u2 = u * u, u3 = u2 * u;
    const out = [];
    for (let k = 1; k < a.length; k++) {
      const m0 = i === 0 ? 0 : (b[k] - p[k]) / (b[0] - p[0]), m1 = i + 2 > K.length - 1 ? mEnd : (n[k] - a[k]) / (n[0] - a[0]);
      out.push((2 * u3 - 3 * u2 + 1) * a[k] + (u3 - 2 * u2 + u) * dt * m0 + (-2 * u3 + 3 * u2) * b[k] + (u3 - u2) * dt * m1);
    }
    return out;
  }

  camKey(t) { return this.keyAt(this.constructor.CAM, t); }     // [X, h, yaw°]

  setTrainCam(X, h, yawDeg) {
    const cam = this.camera, y = (yawDeg * Math.PI) / 180, p = (1.25 * Math.PI) / 180;   // 지평선이 화면 높이 47%쯤
    cam.position.set(-X, h, 0);
    cam.lookAt(-X + Math.sin(y) * Math.cos(p) * 50, h - Math.sin(p) * 50, -Math.cos(y) * Math.cos(p) * 50);
    cam.updateMatrixWorld();
  }

  setTrainOpacity(o) {
    if (this._trainOp === o) return;
    this._trainOp = o;
    this.train.visible = o > .01;
    this.train.traverse((m) => {
      if (!m.material) return;
      for (const mt of Array.isArray(m.material) ? m.material : [m.material]) { mt.transparent = o < 1; mt.opacity = o; mt.depthWrite = o >= 1; }
    });
  }

  // 측면 통과 속도: 꼬리가 4.25초(측면 장면 1.55초)에 화면 왼쪽 끝에 닿도록 (열차 길이에 맞춤)
  get passSpeed() { return Math.max(40, ((this.trainLen || 150) - 48) / 1.45); }

  trainFrontAt(t) {
    const v = this.passSpeed;
    return t > 2.8 ? -5.9 + v * (t - 2.8) : this.keyAt(this.constructor.FRONT, t, v)[0];
  }

  // 측면: 카메라는 그대로 서 있고 열차가 오른쪽으로 지나감 (t: 앞머리가 화면 오른쪽 끝을 지난 뒤 초)
  //   분홍 띠 두 줄은 지붕 위, 하늘색 띠는 창문 줄을 따라 흐름
  //   끝 0.65초: 꼬리가 사라지고 카메라가 선로 옆으로 돌아 선로와 띠가 가로로 누움 → 줄무늬 전환
  side(t, T) {
    for (const s of this.streaks) s.visible = false;
    const front = this.trainFrontAt(2.7 + t);
    this.placeTrainZ(front);
    const t0 = T - .65, turn = easeInOut(seg(t, t0, t0 + .55));
    const [X, h, yaw] = this.camKey(2.7 + t);
    this.setTrainCam(lerp(X, 16, turn), lerp(h, 1.75, turn), lerp(yaw, 90, turn));
    this.setTrainOpacity(1);
    // 앞머리(첫 칸)가 지나가는 동안만 화면 오른쪽 끝에서 비쳐 보이며 사라짐. 그 뒤 객차는 끝까지 또렷함
    if (front < 22) this.trainFx.uNose.value.set(-7.5, -4); else this.trainFx.uNose.value.set(1e5, 1e6);
    // 꼬리 쪽(화면 왼쪽)부터 오른쪽으로 0.3초 동안 점선처럼 끊기며 사라짐
    this.trainFx.uTail.value = t < t0 - .1 ? -1e6 : lerp(-75, 14, seg(t, t0 - .1, t0 + .2));
    const rear = front - (this.trainLen || 150);
    const roof = 4.0 + (this.cfg.models.train.yOffset || 0);
    const gone = seg(rear, -60, -10);                        // 꼬리가 화면을 지나감
    const drop = easeInOut(seg(t, t0, t0 + .5));              // 끝: 선로 쪽으로 내려앉음
    const R = [
      { x: -1.2, y: roof + .4, w: .13, on: 0 },
      { x: -1.2, y: roof + .95, w: .17, on: .05 },
      { x: -1.75, y: 2.5, w: .2, on: .55 },                  // 창문 줄 (하늘색, 영상: 조금 늦게 나타남)
    ];
    this.sideRibbons.forEach((r, i) => {
      const c = R[i];
      const show = seg(t, c.on, c.on + .25);
      r.visible = show > 0;
      r.material.opacity = .95 * show * (1 - seg(t, T - .15, T));
      const y = lerp(c.y, .35 + i * .22, Math.max(gone * .6, drop));
      const pos = r.geometry.attributes.position;
      const zN = 260, zF = -420;
      for (let j = 0; j < pos.count; j++) {
        const u = (j % 201) / 200, row = Math.floor(j / 201);
        pos.setXYZ(j, c.x, y + (row ? c.w : 0), zN + (zF - zN) * u);
      }
      pos.needsUpdate = true;
    });
    this.renderer.render(this.track, this.camera);
  }

  // 첫 애니메이션 (t: 화살표 묶음이 나타난 뒤 초). 돌려주는 값: 열차 앞머리의 화면 위치 (2D 띠의 중심)
  approach(t) {
    for (const s of this.streaks) s.visible = false;
    this.sideRibbons.forEach((r) => (r.visible = false));
    this.setTrainOpacity(1);
    this.trainFx.uNose.value.set(-7.5, -4); this.trainFx.uTail.value = -1e6;
    const front = this.trainFrontAt(t);
    this.placeTrainZ(front);
    this.setTrainCam(...this.camKey(t));
    this.renderer.render(this.track, this.camera);
    return this.toScreen(V(0, 2.0 + (this.cfg.models.train.yOffset || 0), front));
  }

  // ── 지도 ─────────────────────────────────────
  // 영상 속 남한 본토 위치(1024×768 기준): 가로 400~904, 세로 101~715
  fitMap() {
    const key = `${layout.W}x${layout.H}`;
    if (this._fitKey === key) return;
    this._fitKey = key;
    const cam = this.camera, bx = layout.box.x, by = layout.box.y;
    const tx0 = bx + 400, tx1 = bx + 904, ty0 = by + 101, ty1 = by + 715;
    let pitch = 0.95, dist = 900, cx = 230, cz = 270;
    const place = () => {
      const d = V(0, Math.sin(pitch), Math.cos(pitch));
      cam.position.set(cx + d.x * dist, d.y * dist, cz + d.z * dist);
      cam.lookAt(cx, 0, cz); cam.updateMatrixWorld();
    };
    for (let it = 0; it < 60; it++) {
      place();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of this.skPts) { const s = this.toScreen(p); x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y); }
      const sw = x1 - x0, sh = y1 - y0;
      pitch = Math.min(1.5, Math.max(.4, pitch + .5 * (Math.log(sw / sh) - Math.log((tx1 - tx0) / (ty1 - ty0)))));
      dist *= Math.pow((sh / (ty1 - ty0) + sw / (tx1 - tx0)) / 2, .8);
      const wpp = (2 * dist * Math.tan((cam.fov * Math.PI) / 360)) / layout.H;
      cx += (((x0 + x1) / 2) - (tx0 + tx1) / 2) * wpp * .8;
      cz += (((y0 + y1) / 2) - (ty0 + ty1) / 2) * wpp * .8 / Math.sin(pitch);
    }
    place();
    // 실제 화면(2021-06-09 SRT 365 정면 촬영)에서 잰 역 위치에 맞춰 카메라를 다듬음 (최소제곱)
    //   콘텐츠 상자(1024×768) 기준 px. 노선과 상관없이 지도 구도는 항상 같음
    //   두 영상(2023-09-16 4:3 화면, 2021-06-09 16:9 화면 → 4:3로 되돌려 잰 값)의 평균
    const ANCHORS = [['수서', 588, 195], ['동탄', 569, 245], ['평택지제', 565, 286], ['천안아산', 570, 338], ['오송', 590, 377],
      ['대전', 587, 416], ['김천 (구미)', 670, 471], ['동대구', 730, 532], ['밀양', 739, 571], ['경주', 816, 542]]
      .filter(([n]) => STATIONS[n]).map(([n, x, y]) => { const [mx, my] = project(STATIONS[n].lat, STATIONS[n].lon); return { p: V(mx, MAP_H, my), x: bx + x, y: by + y }; });
    let yaw = 0;
    const placeY = () => {
      const d = V(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      cam.position.set(cx + d.x * dist, d.y * dist, cz + d.z * dist);
      cam.lookAt(cx, 0, cz); cam.updateMatrixWorld();
    };
    const err = () => { placeY(); let e = 0; for (const a of ANCHORS) { const q = this.toScreen(a.p); e += (q.x - a.x) ** 2 + (q.y - a.y) ** 2; } return e; };
    if (ANCHORS.length >= 3) {
      const P = { pitch: [.03, .4, 1.53], dist: [40, 150, 3000], cx: [8, -400, 900], cz: [8, -400, 900], yaw: [.02, -.6, .6] };
      const get = (k) => ({ pitch, dist, cx, cz, yaw })[k];
      const set = (k, v) => { if (k === 'pitch') pitch = v; else if (k === 'dist') dist = v; else if (k === 'cx') cx = v; else if (k === 'cz') cz = v; else yaw = v; };
      let best = err();
      for (let round = 0; round < 14; round++) {
        for (const k of Object.keys(P)) {
          const [st, lo, hi] = P[k];
          let step = st * Math.pow(.7, round) * 4;
          for (let tries = 0; tries < 12; tries++) {
            const v0 = get(k); let improved = false;
            for (const dv of [step, -step]) {
              const v = Math.min(hi, Math.max(lo, v0 + dv)); set(k, v);
              const e = err(); if (e < best) { best = e; improved = true; break; }
              set(k, v0);
            }
            if (!improved) step *= .5;
          }
        }
      }
      placeY();
      console.info('[SRT LCD] 지도 구도 맞춤 오차(px)', Math.sqrt(best / ANCHORS.length).toFixed(1), { pitch: pitch.toFixed(3), yaw: yaw.toFixed(3), dist: dist.toFixed(0) });
    }
    this.mapCam = { pos: cam.position.clone(), target: V(cx, 0, cz) };
    // 낮은 배경 카메라 (출발역: 왼쪽 아래 / 도착역: 오른쪽 아래)
    const n = this.stationXY.length;
    this.groundCams = {
      start: this.aimGround(this.stationXY[0], 1, bx + 264, by + 648),
      end: this.aimGround(this.stationXY[n - 1], -1, bx + 838, by + 706),
    };
  }

  // 역 S가 화면 (px, py)에 오도록 낮게 비스듬히 보는 카메라
  aimGround(st, sideSign, px, py) {
    const cam = this.camera, S = V(st.x, MAP_H, st.y);
    const P = V(st.x + 26 * sideSign, MAP_H + 15, st.y + 62);
    let yaw = Math.atan2(-(S.x - P.x), -(S.z - P.z)), pitch = -.12;
    const hf = 2 * Math.atan(Math.tan((cam.fov * Math.PI) / 360) * cam.aspect), vf = (cam.fov * Math.PI) / 180;
    for (let i = 0; i < 30; i++) {
      cam.position.copy(P);
      cam.lookAt(P.x - Math.sin(yaw) * Math.cos(pitch), P.y + Math.sin(pitch), P.z - Math.cos(yaw) * Math.cos(pitch));
      cam.updateMatrixWorld();
      const s = this.toScreen(S);
      yaw += ((px - s.x) / layout.W) * hf * .9;
      pitch += ((py - s.y) / layout.H) * vf * .9;
    }
    const target = V(P.x - Math.sin(yaw) * Math.cos(pitch) * 100, P.y + Math.sin(pitch) * 100, P.z - Math.cos(yaw) * Math.cos(pitch) * 100);
    return { pos: P, target };
  }

  setCam(c) { this.camera.position.copy(c.pos); this.camera.lookAt(c.target); this.camera.updateMatrixWorld(); }

  // 지도 화면: t 0~1 안개 속에서 나타나며 살짝 다가옴 → 정지 → T-2초부터 출발역으로 내려감
  mapShot(t, T) {
    this.fitMap();
    const M = this.mapCam, G = this.groundCams.start;
    this.routeTube.visible = false; this.dots.forEach((d) => (d.visible = false));
    this.map.fog.near = 600; this.map.fog.far = 1500;
    const dolly = 1 + .07 * (1 - easeOut(seg(t, 0, .7)));
    let pos = M.target.clone().add(M.pos.clone().sub(M.target).multiplyScalar(dolly)), target = M.target.clone();
    const f = seg(t, T - 2, T);
    if (f > 0) {
      // 영상: 카메라가 뒤로 물러나며(지도가 작아짐) 기울어지고 → 낮게 내려가 안개 속으로 (2차 베지에 경로)
      const b = f;
      const far = M.target.clone().add(M.pos.clone().sub(M.target).multiplyScalar(2.8));
      far.z += 260;
      const u = 1 - b;
      pos = pos.clone().multiplyScalar(u * u).add(far.multiplyScalar(2 * u * b)).add(G.pos.clone().multiplyScalar(b * b));
      target = target.lerp(G.target, easeInOut(seg(f, .35, 1)));
      // 안개: 처음엔 카메라 거리에 맞춰 지도가 다 보이게, 뒤쪽 절반에서 짙어짐
      const d = pos.distanceTo(target), k = easeIn(seg(f, .45, 1));
      this.map.fog.near = lerp(d * .65, 12, k); this.map.fog.far = lerp(d * 1.8, 270, seg(f, .45, 1));
      const showRoute = b > .6; this.routeTube.visible = showRoute; this.dots.forEach((d) => (d.visible = showRoute));
    }
    this.setCam({ pos, target });
    this.renderer.render(this.map, this.camera);
  }

  // 깃발·정차역 화면 뒤 배경 (안개 낀 낮은 지도)
  backdrop(which = 'start') {
    this.fitMap();
    this.routeTube.visible = true; this.dots.forEach((d) => (d.visible = true));
    this.map.fog.near = 12; this.map.fog.far = 270;
    this.setCam(this.groundCams[which]);
    this.renderer.render(this.map, this.camera);
  }

  // 지도 좌표 (x, y) → 화면 px (지도 윗면)
  mapToScreen(x, y) { return this.toScreen(V(x, MAP_H, y)); }

  toScreen(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * .5 + .5) * layout.W, y: (-p.y * .5 + .5) * layout.H };
  }
}
