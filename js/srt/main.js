// SRT 객실 LCD 안내화면 — 전체 재생 순서 (영상: 2023-09-16 SRT 363 수서→진주, 프레임 단위로 잰 타이밍)
//  흰 화면 + SR 로고 → 리본이 모임 → 열차가 정면에서 다가옴 → 측면 통과 → 줄무늬 전환
//  → 3D 지도(노선·역 이름) → 카메라가 출발역으로 내려감 → 출발 깃발
//  → 노선 띠 + 정차역 링(출발역 · 정차역 · 종착역) → 도착 깃발 → 안내문 → 반복
import cfg from './config.js';
import { anim, sleep } from '../util.js';
import { resolveRoute } from '../route.js';
import { layout, computeLayout } from '../layout.js';
import { loadSettings, initSettings, autoTimes } from '../settings.js';
import { SrtScene, seg, easeOut, easeInOut } from './scene3d.js';
import { SrtGuide } from './ring.js';
import { SrtFlag } from './flag.js';

const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const BOX = [1024, 768];                       // 실제 SRT 화면 비율 4:3
// 예전 config(시간·색 항목이 없는 버전)를 그대로 써도 동작하도록 기본값을 채움
cfg.timing = { logo: 2700, tunnel: 2700, side: 1750, wipe: 1400, map: 11000, flag: 11500, stop: 8000, arrivalFlag: 11000, notice: 7000, ...cfg.timing };
cfg.assets = { biColor: '#4B2F48', ...cfg.assets };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ── 반응형: 꽉 채우기 (SRT 화면은 항상 가로 구도) ──────────────
// 실제 SRT 화면: 4:3 안내화면을 16:9 화면에서는 가로로 늘려서 보여 줌 (2021-06-09 16:9 화면 촬영에서 확인:
//   깃발 현수막 가로세로비 1.58 → 2.14, SR 로고·글씨도 가로로 넓어짐)
//   screen.fit: 'auto' (가로 화면은 늘림, 세로·아주 넓은 화면은 여백을 배경으로 채움) | 'stretch' | 'fill'
function useStretch() {
  const mode = cfg.screen?.fit || 'auto', a = innerWidth / innerHeight;
  return mode === 'stretch' || (mode === 'auto' && a >= 1.2 && a <= 2.0);
}
function fit() {
  let L;
  if (useStretch()) {
    const sx = innerWidth / BOX[0], sy = innerHeight / BOX[1];
    L = Object.assign(layout, { W: BOX[0], H: BOX[1], s: Math.max(sx, sy), mode: 'land', box: { x: 0, y: 0, w: BOX[0], h: BOX[1] } });
    stage.style.width = BOX[0] + 'px'; stage.style.height = BOX[1] + 'px';
    stage.style.transform = `scale(${sx}, ${sy})`;
  } else {
    L = computeLayout(false, BOX);
    stage.style.width = L.W + 'px'; stage.style.height = L.H + 'px';
    stage.style.transform = `scale(${L.s})`;
  }
  for (const el of document.querySelectorAll('.content-box')) {
    Object.assign(el.style, { left: L.box.x + 'px', top: L.box.y + 'px', width: L.box.w + 'px', height: L.box.h + 'px', right: 'auto', bottom: 'auto' });
  }
  for (const id of ['#ribbons', '#mapRoute']) $(id).setAttribute('viewBox', `0 0 ${L.W} ${L.H}`);
  dispatchEvent(new CustomEvent('stage-resize'));
}
addEventListener('resize', () => { fit(); onResize?.(); });
let onResize = null;
fit();

// ── 시계 (오른쪽 위) ────────────────────────────────────
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const t0c = Date.now(), base = cfg.clock?.mode === 'fixed' ? new Date(cfg.clock.value).getTime() : null;
function tick() {
  const d = base ? new Date(base + (Date.now() - t0c)) : new Date();
  let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  $('#clock .d').textContent = `${d.getMonth() + 1}월${d.getDate()}일(${DAYS[d.getDay()]})`;
  $('#clock .t').textContent = `${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
}
tick(); setInterval(tick, 1000);

// ── 로고 이미지 (없으면 글자). SR BI는 흰색 SVG → biColor로 칠함 ──────────
function setLogo(sel, url, fallback, tint) {
  const img = new Image();
  img.onload = () => document.querySelectorAll(sel).forEach((el) => {
    el.classList.remove('missing'); el.textContent = '';
    // CSS 변수 안의 url()은 css/ 폴더 기준으로 풀리므로 절대 주소로 바꿔 넣음
    if (tint) { el.classList.add('tinted'); el.style.setProperty('--logo', `url("${new URL(url, location.href).href}")`); el.style.setProperty('--bi', tint); }
    else el.style.backgroundImage = `url("${url}")`;
  });
  img.onerror = () => document.querySelectorAll(sel).forEach((el) => { el.classList.add('missing'); el.textContent = fallback; if (tint) el.style.color = tint; });
  img.src = url;
}
setLogo('.sr-logo', cfg.assets.srLogo, 'SR');
setLogo('.srt-logo', cfg.assets.srtLogo, 'SRT', cfg.assets.biColor || null);

// ── 노선 · 시각 ─────────────────────────────────────────
const settings = loadSettings(cfg);
const autoMode = settings.times.mode !== 'manual';
const routeInput = autoMode ? autoTimes(settings.route, settings.times) : settings.route;
initSettings(routeInput, settings.times, settings.defaults);
const route = resolveRoute(routeInput);
console.info('[SRT LCD] 노선', route.all.map((s) => (s.pass ? `(${s.label} 통과)` : `${s.ko} ${s.time}`)).join(' → '));

const fade = (el, to, ms = 400, easing = 'ease-out') => anim(el, [{ opacity: to }], { duration: ms, easing });
const setOp = (el, v) => { el.getAnimations().forEach((a) => a.cancel()); el.style.opacity = String(v); };

// 프레임마다 fn(t) 호출, T초 뒤 끝
function run(T, fn) {
  return new Promise((done) => {
    const s = performance.now();
    const loop = () => {
      const t = (performance.now() - s) / 1000;
      fn(Math.min(t, T));
      if (t < T) requestAnimationFrame(loop); else done();
    };
    requestAnimationFrame(loop);
  });
}
// 장면 시작부터 sec초가 될 때까지 기다림
const clockFrom = () => { const s = performance.now(); return (sec) => sleep(Math.max(0, s + sec * 1000 - performance.now())); };

// ── 2D 리본 · 화살표 (1024×768 기준 좌표 → 무대 좌표) ─────────────
const PINKC = '#d0378f', BLUEC = '#84bfe3', PALEC = '#e4dcea', clamp01 = (x) => Math.min(1, Math.max(0, x));
const segT = (t, a, b) => clamp01((t - a) / (b - a));
const pts = (P) => P.map((q) => q.map((v) => v.toFixed(1)).join(',')).join(' ');
const poly = (P, fill, op = 1) => `<polygon fill="${fill}" opacity="${op.toFixed(3)}" points="${pts(P)}"/>`;

// 꼬리(s) → 끝(e) 띠 화살표. 띠 굵기 w0(꼬리)→w1(끝), 끝에는 한쪽(위쪽)으로만 난 미늘
function barbArrow(s, e, w0, w1, color, op = 1, head = [22, 11]) {
  const dx = e[0] - s[0], dy = e[1] - s[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
  let nx = -uy, ny = ux; if (ny > 0) { nx = -nx; ny = -ny; }          // n: 화면 위쪽
  const [hl, hw] = head, hb = Math.min(hl, L * .5);
  const bx = e[0] - ux * hb, by = e[1] - uy * hb;
  const P = [
    [s[0] + nx * w0 / 2, s[1] + ny * w0 / 2],
    [bx + nx * w1 / 2, by + ny * w1 / 2],
    [bx + nx * (w1 / 2 + hw) - ux * hb * .35, by + ny * (w1 / 2 + hw) - uy * hb * .35],   // 미늘 (뒤로 살짝 젖힘)
    [e[0], e[1]],
    [bx - nx * w1 / 2, by - ny * w1 / 2],
    [s[0] - nx * w0 / 2, s[1] - ny * w0 / 2],
  ];
  return poly(P, color, op);
}

// 쐐기 (중심 A에서 각도 th 방향으로 r0~r1, 각 폭 w)
function wedge(A, th, w, r0, r1, color, op) {
  if (r1 - r0 < .5 || op <= 0) return '';
  const d = (a, r) => [A[0] + Math.cos(a) * r, A[1] + Math.sin(a) * r];
  return poly([d(th - w / 2, r0), d(th - w / 2, r1), d(th + w / 2, r1), d(th + w / 2, r0)], color, op);
}

// 첫 애니메이션 쐐기 목록 (영상 기준 각도: 왼쪽은 왼쪽 위 25° ~ 왼쪽 아래 35°, 오른쪽은 오른쪽 위 20° ~ 오른쪽 아래 32°)
//  [쪽(-1 왼쪽 / 1 오른쪽), 수평에서 위로 몇 도, 폭(도), 색, 짧아진 뒤 길이, 줄어드는 시작 시각]
const WEDGES = [
  [-1, 25, 9, BLUEC, 70, 1.36], [-1, 17, 3, PINKC, 120, 1.48], [-1, 13, 2.2, PALEC, 50, 1.40], [-1, 9, 3.5, PINKC, 150, 1.55],
  [-1, 5, 2, BLUEC, 90, 1.44], [-1, 1.5, 3, PINKC, 140, 1.52], [-1, -3, 2.5, PALEC, 60, 1.38], [-1, -8, 4, PINKC, 110, 1.58],
  [-1, -13, 3, BLUEC, 80, 1.46], [-1, -21, 6, PINKC, 130, 1.42], [-1, -31, 7, BLUEC, 60, 1.50],
  [1, 19, 3, PALEC, 60, 1.40], [1, 13, 2.2, BLUEC, 150, 1.56], [1, 9, 3, PALEC, 90, 1.44], [1, 5, 3.5, PINKC, 170, 1.50],
  [1, 1, 2, BLUEC, 120, 1.38], [1, -3, 4, PINKC, 160, 1.54], [1, -8, 3, PINKC, 100, 1.46], [1, -13, 2.5, PALEC, 70, 1.42],
  [1, -18, 5, PINKC, 140, 1.58], [1, -25, 4, BLUEC, 90, 1.48], [1, -32, 6, PINKC, 120, 1.52],
];
const D2R = Math.PI / 180;

// 처음 화살표 묶음: 왼쪽 위 / 오른쪽 아래에서 가운데(A)로 날아옴 (k: 0→1)
function bundleSVG(A, k, op) {
  const cols = [PINKC, BLUEC, PINKC, BLUEC];
  let html = '';
  for (const side of [-1, 1]) {
    const base = side < 0 ? Math.atan2(.47, 1) : Math.atan2(.55, 1) + Math.PI;     // 날아가는 방향
    const e = easeOut(k);
    cols.forEach((c, i) => {
      const off = (i - 1.5) * 15 * side;
      const a = base - (i - 1.5) * 2.4 * D2R * side;                                 // 꼬리 쪽으로 살짝 벌어짐
      const ux = Math.cos(a), uy = Math.sin(a), nx = -Math.sin(base), ny = Math.cos(base);
      const gap = 24 + i * 6, travel = (1 - e) * 820;
      const tip = [A[0] - ux * (gap + travel) + nx * off, A[1] - uy * (gap + travel) + ny * off];
      const tail = [tip[0] - ux * 1100, tip[1] - uy * 1100];
      html += barbArrow(tail, tip, 8, 8, c, op * .95, [20, 10]);
    });
  }
  return html;
}

// 첫 애니메이션 한 장면 (t: 화살표 묶음이 나타난 뒤 초). 3D(열차·선로·카메라) + 2D(화살표·쐐기)
function introFrame(t) {
  const gl = $('#gl');
  let A = scene.approach(t);                      // 열차 앞머리 화면 위치
  A = [A.x, A.y];
  gl.style.opacity = String(easeOut(segT(t, .58, .92)));
  stage.style.background = '#f2f2f3';
  const R = 1500;
  let html = '';
  // 화살표 묶음 (0 ~ 0.55초 날아옴, 0.6 ~ 0.8초 사라짐)
  const bop = 1 - segT(t, .6, .8);
  if (bop > 0) html += bundleSVG(A, segT(t, 0, .55), bop);
  // 쐐기: 0.55초부터 묶음 방향에서 펼쳐짐 → 1.36~1.8초 바깥 끝부터 계단처럼 짧아짐 → 1.8~2.45초 열차를 따라 가늘어지며 사라짐
  if (t > .55) {
    WEDGES.forEach(([side, up, w, col, short, t0], i) => {
      const open = easeOut(segT(t, .55 + (i % 5) * .025, .9 + (i % 4) * .02));
      const bundleA = side < 0 ? Math.PI + Math.atan2(.47, 1) : Math.atan2(.55, 1);   // 묶음이 놓인 방향
      const target = side < 0 ? Math.PI + up * D2R : -up * D2R;
      // 묶음 방향 → 제 각도로 돌아가며 펼쳐짐
      const ba = side < 0 ? bundleA - Math.PI * 2 * 0 : bundleA;
      let dA = target - ba; while (dA > Math.PI) dA -= Math.PI * 2; while (dA < -Math.PI) dA += Math.PI * 2;
      const th = ba + dA * open;
      const shrink = easeInOut(segT(t, t0, t0 + .3));
      const fadeTail = segT(t, 1.8, 2.2);
      const zoom = 1 + 1.6 * segT(t, 1.6, 2.4);                 // 열차가 다가오면 띠도 같이 커짐
      const r0 = (4 + 16 * shrink) * zoom * (1 + 1.5 * fadeTail);
      const r1 = (R * open * (1 - shrink) + (short * (1 - .55 * fadeTail)) * shrink) * zoom;
      const ww = w * D2R * (1 + .9 * shrink) * (1 - .5 * fadeTail);       // 짧아진 띠는 굵게 보임 (영상)
      const op = .92 * (1 - fadeTail) * Math.min(1, open * 3);
      html += wedge(A, th, ww, r0, Math.max(r0, r1), col, op);
    });
  }
  $('#ribbons').innerHTML = html;
}

// 지도 화면 화살표: 왼쪽 밖에 꼬리를 둔 띠 4개가 왼쪽 아래에서 날아와 서해안 한 점(C)으로 모임 (k: 0→1)
//   영상(1024×768 기준): 끝이 모이는 점 ≈ (478, 342), 화면 왼쪽 끝에서 띠 높이 ≈ 462 / 540 / 612 / 690
//   영상(1024×768 상자 기준): 화면 왼쪽 끝에서 띠 높이 ≈ 470 / 548 / 628 / 710, 굵기 ≈ 46 → 끝 ≈ 16
const MAP_ARROWS = [[PINKC, 470], [BLUEC, 548], [PINKC, 628], [BLUEC, 710]];
function drawMapRibbons(k, op = 1) {
  // 끝이 모이는 곳: 두 영상 평균 (상자 기준 466, 334 — 아산만 서해안)
  const by = layout.box.y, C = [layout.box.x + 466, by + 334];
  const e = easeOut(clamp01(k));
  let html = '';
  MAP_ARROWS.forEach(([c, y], i) => {
    const s = [-60, by + y + 22];                                         // 꼬리 (화면 왼쪽 밖, 고정)
    const dx = C[0] - s[0], dy = C[1] - s[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
    // 끝: 띠마다 조금씩 어긋나게 (위쪽 분홍 띠가 가장 멀리, 미늘이 보이게)
    const end = [C[0] - ux * i * 16 - uy * (i - 1.5) * 8, C[1] - uy * i * 16 + ux * (i - 1.5) * 8];
    const tip = [s[0] + (end[0] - s[0]) * e, s[1] + (end[1] - s[1]) * e];
    if (e > .002) html += barbArrow(s, tip, 46, 16 + 22 * (1 - e), c, .95 * op, [34, 15]);
  });
  $('#ribbons').innerHTML = html;
}

// ── 줄무늬 전환 (오른쪽 → 왼쪽으로 색 띠가 지나감) ─────────────
async function stripeWipe(T) {
  const w = $('#wipe');
  w.innerHTML = '';
  const bars = [['#d84a9c', 10, 4], ['#3d63c9', 24, 9], ['#d84a9c', 7, 16], ['#e9b6d5', 30, 22], ['#4f7fd6', 26, 31], ['#d84a9c', 12, 40],
    ['#86c1e4', 34, 47], ['#d84a9c', 6, 56], ['#3d63c9', 22, 63], ['#d84a9c', 20, 72], ['#a9d3ee', 14, 80], ['#d84a9c', 9, 88], ['#3d63c9', 16, 94]];
  const els = bars.map(([c, h, top], i) => {
    const b = document.createElement('i');
    b.style.background = `linear-gradient(90deg, ${c}00, ${c} 30%, ${c} 80%, ${c}00)`;
    b.style.top = `${top}%`; b.style.height = `${h}px`;
    w.appendChild(b);
    // 영상: 띠는 왼쪽에서 들어와 오른쪽으로 빠져나감
    b.animate([{ transform: 'translateX(-140%)' }, { transform: 'translateX(100%)' }], { duration: 700 + (i % 4) * 160, delay: (i * 97) % 600, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
    return b;
  });
  fade($('#fog'), 1, T * 1000 * .55, 'ease-in');
  await sleep(T * 1000);
  els.forEach((b) => b.remove());
}

// ── 지도 위 노선 · 역 이름 ──────────────────────────────
let mapOverlay = null;
function buildMapOverlay() {
  scene.fitMap();
  scene.setCam(scene.mapCam);
  const tags = new Set(cfg.tagStations || []);
  // 노선은 실제 위치 그대로 (지도 위 실제 선로 모양). 지도 구도는 scene.fitMap()이 실제 화면에 맞춰 둠
  const P0 = scene.stationXY.map((p) => scene.mapToScreen(p.x, p.y));
  // 실제 화면처럼 너무 붙은 역(창원·마산·창원중앙 등)만 조금 벌리고, 선도 그 근처만 같이 휘게 함
  const P = P0.map((q) => ({ x: q.x, y: q.y }));
  for (let it = 0; it < 60; it++) for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const dx = P[j].x - P[i].x, dy = P[j].y - P[i].y, d = Math.hypot(dx, dy) || .01, MIN = 19;
    if (d >= MIN) continue;
    const k = (MIN - d) / 2 / d;
    P[i].x -= dx * k; P[i].y -= dy * k; P[j].x += dx * k; P[j].y += dy * k;
  }
  const disp = P.map((q, i) => [q.x - P0[i].x, q.y - P0[i].y]);
  const warp = (q) => {
    let wx = 0, wy = 0, ws = 0;
    P0.forEach((o, i) => { const w = 1 / (Math.pow(Math.hypot(q.x - o.x, q.y - o.y), 2) + 4); wx += disp[i][0] * w; wy += disp[i][1] * w; ws += w; });
    const fall = Math.max(...P0.map((o, i) => (Math.hypot(...disp[i]) > .5 ? Math.max(0, 1 - Math.hypot(q.x - o.x, q.y - o.y) / 40) : 0)));
    return { x: q.x + (wx / ws) * fall, y: q.y + (wy / ws) * fall };
  };
  const line = scene.rp.samples.map((p) => warp(scene.mapToScreen(p.x, p.y)));
  let len = 0; for (let i = 1; i < line.length; i++) len += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
  let svg = `<polyline class="mr-line" points="${line.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')}" fill="none" stroke="#666a71" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="${len}" stroke-dashoffset="${len}"/>`;
  const LP = line.filter((_, i) => i % 2 === 0).map((q) => [q.x, q.y]);
  mapOverlay = {};
  P.forEach((q, i) => { if (!tags.has(route.all[i].ko)) svg += `<circle class="mr-dot" data-i="${i}" cx="${q.x}" cy="${q.y}" r="3.6" fill="#fff" stroke="#9a9ea5" stroke-width="1.6" opacity="0"/>`; });
  $('#mapRoute').innerHTML = svg;
  const box = $('#mapLabels'); box.innerHTML = '';
  const placed = [];
  const hit = (b) => placed.some((q) => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0)
    || LP.some(([x, y]) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1)
    || P.some((q) => q.x > b.x0 - 3 && q.x < b.x1 + 3 && q.y > b.y0 - 3 && q.y < b.y1 + 3);
  const labels = route.all.map((s, i) => {
    const tag = tags.has(s.ko), q = P[i];
    const el = document.createElement('div');
    el.className = 'ml ' + (tag ? 'tagl' : 'txt');
    el.innerHTML = tag ? `<span class="pill">${esc(s.label)}</span>` : esc(s.label);
    box.appendChild(el);
    const w = el.offsetWidth, h = el.offsetHeight;
    let pos;
    if (tag) pos = { left: q.x - 11, top: q.y - h / 2 };
    else {
      const opts = [{ left: q.x + 8, top: q.y - h / 2 }, { left: q.x - 8 - w, top: q.y - h / 2 }, { left: q.x - w / 2, top: q.y + 6 }, { left: q.x - w / 2, top: q.y - 6 - h }];
      pos = opts.find((o) => !hit({ x0: o.left, y0: o.top, x1: o.left + w, y1: o.top + h })) || opts[0];
    }
    placed.push({ x0: pos.left - 1, y0: pos.top, x1: pos.left + w + 1, y1: pos.top + h });
    el.style.left = pos.left + 'px'; el.style.top = pos.top + 'px';
    return el;
  });
  mapOverlay = { ...mapOverlay, labels, len };
}

// ── 장면들 ──────────────────────────────────────────────
let scene = null, guide = null;
const flag = new SrtFlag($('#flagLayer'));

async function playLogo() {
  const ls = $('#logoScreen'), logo = ls.querySelector('.logo');
  setOp(ls, 1); setOp(logo, 0);
  // 영상: 흰 화면 1.25초 → 로고가 나타나 1초 머묾 → 사라짐 (전체 cfg.timing.logo)
  const k = cfg.timing.logo / 2700;
  await sleep(1250 * k);
  await anim(logo, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 * k });
  await sleep(1000 * k);
  await anim(logo, [{ opacity: 1 }, { opacity: 0 }], { duration: 250 * k });
}

async function playTrain() {
  const fog = $('#fog'), rb = $('#ribbons');
  const T1 = cfg.timing.tunnel / 1000, T2 = cfg.timing.side / 1000;
  setOp(fog, 0); setOp($('#logoScreen'), 0); setOp(rb, 1);
  let decor = 0;
  await run(T1, (t) => {
    introFrame(t);
    if (decor === 0 && t > 1.3) { decor = 1; fade($('.corner-sr'), 1, 400); }
    if (decor === 1 && t > 1.6) { decor = 2; fade($('#clouds'), 1, 600); }
  });
  rb.innerHTML = ''; stage.style.background = ''; setOp($('#gl'), 1);
  await run(T2, (t) => scene.side(t, T2));
  await stripeWipe(cfg.timing.wipe / 1000);
}

async function playMap() {
  const T = cfg.timing.map / 1000, mt = $('#mapText'), title = mt.querySelector('.mt-title'), big = mt.querySelector('.mt-station');
  const fog = $('#fog'), rb = $('#ribbons'), mr = $('#mapRoute'), ml = $('#mapLabels');
  buildMapOverlay(); onResize = () => buildMapOverlay();
  // 영상: 역 이름은 1.3초부터 하나씩, 모두 합쳐 약 4.4초 동안 (역이 많으면 더 빨리)
  const n = route.all.length, D = 4.4 / Math.max(1, n - 1), L0 = 1.3;
  setOp(fog, 1); setOp(rb, 1); setOp(mr, 1); setOp(ml, 1); setOp(mt, 1); setOp(title, 0); big.innerHTML = ''; setOp(big, 1); delete big.dataset.gone;
  setOp($('#clouds'), 1);
  fade(fog, 0, 650, 'ease-out');
  let shown = -1, titled = false, out = false, corner = 0;
  const line = mr.querySelector('.mr-line');
  await run(T, (t) => {
    scene.mapShot(t, T);
    if (t > .1) $('#wipe').innerHTML = '';
    // 노선 선이 그려지고 리본이 들어옴
    const draw = easeInOut(seg(t, .85, 1.6));
    line.setAttribute('stroke-dashoffset', String(mapOverlay.len * (1 - draw)));
    if (!out) drawMapRibbons(seg(t, .9, 1.5));
    // 역 이름이 하나씩 + 오른쪽 아래 큰 역 이름
    const j = t < L0 ? -1 : Math.min(n - 1, Math.floor((t - L0) / D));
    while (shown < j) {
      shown++;
      const el = mapOverlay.labels[shown];
      el.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1.12)', offset: .6 }, { opacity: 1, transform: 'none' }], { duration: 260, fill: 'forwards' });
      mr.querySelector(`.mr-dot[data-i="${shown}"]`)?.setAttribute('opacity', '1');
      while (big.children.length > 1) big.firstChild.remove();
      const old = big.querySelector('span');
      if (old) old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).finished.then(() => old.remove());
      const sp = document.createElement('span'); sp.textContent = route.all[shown].label; big.appendChild(sp);
      sp.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, fill: 'forwards' });
    }
    // 영상: 마지막 역 이름이 나오고 0.7초쯤 뒤 오른쪽 아래 큰 이름이 사라짐
    if (shown === n - 1 && !big.dataset.gone && t > L0 + (n - 1) * D + .7) { big.dataset.gone = '1'; fade(big, 0, 400); }
    if (!titled && t > 1.6) { titled = true; fade(title, 1, 350); }
    // 끝: 글씨·리본이 사라지고 카메라가 출발역으로 내려감
    if (!out && t > T - 2.7) { out = true; for (const el of [rb, mr, ml, mt]) fade(el, 0, 550); }
    if (corner === 0 && t > T - 1.5) { corner = 1; setOp($('#corner'), 1); fade($('#corner .guide-label'), 1, 300); }
    if (corner === 1 && t > T - 1.3) { corner = 2; fade($('#corner .logo'), 1, 300); }
  });
  onResize = null;
  for (const el of [rb, mr, ml, mt]) setOp(el, 0);
  rb.innerHTML = '';
}

// 깃발 (출발: 출발역 쪽 배경 / 도착: 종착역 쪽 배경)
async function playFlag(kind) {
  const T = (kind === 'arrival' ? cfg.timing.arrivalFlag : cfg.timing.flag) / 1000;
  const idx = kind === 'arrival' ? route.all.length - 1 : 0;
  const which = kind === 'arrival' ? 'end' : 'start';
  scene.backdrop(which); onResize = () => scene.backdrop(which);
  flag.build(kind, route.all[idx]);
  await run(T, (t) => flag.frame(t, T));
  flag.clear(); onResize = null;
}

async function playStops() {
  guide = guide || new SrtGuide($('#srtGuide'), cfg, route);
  scene.backdrop('start'); onResize = () => scene.backdrop('start');
  // 링은 정차역만 (통과역은 오른쪽 노선 띠에만 있음). H: route.all 안의 정차역 번호
  const at = clockFrom(), S = cfg.timing.stop / 1000;
  const H = route.all.map((s, i) => (s.pass ? -1 : i)).filter((i) => i >= 0), N = H.length;
  // 노선 띠 → 역 이름 물결 → 첫 링 (영상: 띠 +0.7초, 물결 +2.7초, 링 +4.2초, 글씨 +5.8초)
  await at(.7); guide.enterStrip();
  await at(2.7); guide.wave();
  await at(4.2); await guide.ringIn(H[0]);
  await at(5.8); await guide.textIn(H[0]);
  // 영상: 첫 링은 7.6초 뒤, 그다음부터는 8초마다 다음 역으로 넘어감
  let slide = 4.2 - .4;
  for (let i = 1; i < N; i++) {
    await at(slide + S - .4); await guide.textOut();
    slide += S;
    await at(slide); guide.slideTo(H[i]);
    await at(slide + 2.1); await guide.textIn(H[i]);
  }
  await at(slide + S - .4); await guide.textOut();
  await guide.exit();
  // 배경을 종착역 쪽으로 바꿈 (안개로 가림)
  await fade($('#fog'), 1, 350, 'ease-in');
  scene.backdrop('end');
  await fade($('#fog'), 0, 600);
  onResize = null;
}

async function playNotice() {
  if (!cfg.notice?.enabled || !cfg.notice.slides?.length) return;
  const sec = $('#srtNotice'), box = sec.querySelector('.nt-box');
  fade($('.corner-sr'), 0); fade($('#corner'), 0); fade($('#clouds'), 0); $('#clock').classList.add('on-dark');
  for (const sl of cfg.notice.slides) {
    box.innerHTML = `<div class="nt-title"></div>${sl.lines.map(() => '<div class="nt-line"></div>').join('')}<div class="logo sr-logo nt-logo"></div>`;
    box.querySelector('.nt-title').textContent = sl.title;
    box.querySelectorAll('.nt-line').forEach((el, i) => { el.textContent = sl.lines[i] || ' '; });
    setLogo('.nt-logo', cfg.assets.srLogo, 'SR');
    await fade(sec, 1, 500);
    await sleep(cfg.timing.notice);
    await fade(sec, 0, 500);
  }
  $('#clock').classList.remove('on-dark');
}

function resetDecor() {
  for (const el of ['#clouds', '#corner', '#corner .guide-label', '#corner .logo', '.corner-sr', '#ribbons', '#mapRoute', '#mapLabels', '#mapText']) setOp($(el), 0);
}

async function freezeAt(name, sec) {
  const t = +sec || 0;
  for (const el of ['#logoScreen', '#fog']) setOp($(el), 0);
  setOp($('#gl'), 1);
  if (name === 'intro') {
    setOp($('#ribbons'), 1);
    introFrame(t);
  } else if (name === 'side') {
    setOp($('.corner-sr'), 1); setOp($('#clouds'), 1);
    scene.side(t, cfg.timing.side / 1000);
  } else if (name === 'map') {
    buildMapOverlay();
    for (const el of ['#ribbons', '#mapRoute', '#mapLabels', '#mapText', '#mapText .mt-title', '#clouds', '.corner-sr']) setOp($(el), 1);
    scene.mapShot(t, cfg.timing.map / 1000);
    drawMapRibbons(seg(t, .9, 1.5));
    $('#mapRoute .mr-line').setAttribute('stroke-dashoffset', '0');
    $('#mapRoute').querySelectorAll('.mr-dot').forEach((d) => d.setAttribute('opacity', '1'));
    mapOverlay.labels.forEach((el) => { el.style.opacity = '1'; });
  } else if (name === 'flag' || name === 'arrival') {
    for (const el of ['#clouds', '#corner', '#corner .guide-label', '#corner .logo', '.corner-sr']) setOp($(el), 1);
    const kind = name === 'flag' ? 'departure' : 'arrival';
    scene.backdrop(name === 'flag' ? 'start' : 'end');
    flag.build(kind, route.all[name === 'flag' ? 0 : route.all.length - 1]);
    flag.frame(t, (kind === 'arrival' ? cfg.timing.arrivalFlag : cfg.timing.flag) / 1000);
  } else if (name === 'stops') {
    // ?freeze=stops:번호 (route.all 안의 번호, 0 = 출발역)
    for (const el of ['#clouds', '#corner', '#corner .guide-label', '#corner .logo', '.corner-sr']) setOp($(el), 1);
    scene.backdrop('start');
    guide = new SrtGuide($('#srtGuide'), cfg, route);
    guide.strip.style.opacity = '1';
    const i = Math.round(t);
    await guide.ringIn(i); await guide.textIn(i);
    guide.unit.getAnimations().forEach((a) => a.cancel()); guide.unit.style.opacity = '1';
  }
  document.body.dataset.frozen = '1';
}

async function main() {
  await Promise.all(['300 20px "NanumBarunLocal"', '400 20px "NanumBarunLocal"', '700 20px "NanumBarunLocal"', '400 20px "NanumBarunGothic"', '700 20px "NanumBarunGothic"']
    .map((f) => document.fonts.load(f, '역도착').catch(() => {})));
  scene = new SrtScene($('#gl'), cfg, route);
  await scene.ready;
  window.__srt = { scene, route };
  const q = new URLSearchParams(location.search);
  // 디버그: ?freeze=intro:1.2 | side:0.8 | map:5  → 그 장면의 그 시각 한 장면에서 멈춤
  if (q.get('freeze')) { await freezeAt(...q.get('freeze').split(':')); return; }
  const ORDER = ['logo', 'train', 'map', 'flag', 'stops', 'arrival', 'notice'];
  const startAt = q.get('start');   // ?start=train | map | flag | stops | arrival | notice
  let first = true;
  do {
    if (!first && autoMode) {
      const r = autoTimes(settings.route, settings.times);
      const list = [r.origin, ...(r.stops || []), r.destination];
      route.all.forEach((s, i) => { s.time = s.pass ? '' : i === 0 ? list[i].depart : list[i].arrive; });
      guide = null; $('#srtGuide').innerHTML = '';
    }
    const skip = (name) => first && startAt && ORDER.indexOf(name) < ORDER.indexOf(startAt);
    resetDecor();
    setOp($('#gl'), 1);
    window.__t0 = window.__t0 ?? performance.now();
    if (!skip('logo')) await playLogo();
    if (!skip('train')) await playTrain();
    setOp($('#logoScreen'), 0);
    if (!skip('map')) await playMap();
    for (const el of ['#clouds', '#corner', '#corner .guide-label', '#corner .logo', '.corner-sr']) setOp($(el), 1);
    setOp($('#fog'), 0);
    if (!skip('flag')) await playFlag('departure');
    if (!skip('stops')) await playStops();
    else scene.backdrop('end');
    if (!skip('arrival')) await playFlag('arrival');
    if (!skip('notice')) await playNotice();
    first = false;
  } while (cfg.loop);
}
main();

addEventListener('keydown', (e) => { if (e.target.tagName !== 'INPUT' && (e.key === 'r' || e.key === 'R')) location.reload(); });
