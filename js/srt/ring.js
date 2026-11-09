// SRT 정차역 안내 (1024×768 기준, 영상에서 잰 위치)
//  왼쪽: 화살표 두 개가 도는 링 + 역 정보 / 오른쪽: 작은 노선 지도 + 출발·종착역
import { anim, splitTime } from '../util.js';
import { buildRoutePath } from '../routePath.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const RC = 340, RB = 282, BW = 26;          // 링 상자 반지름(680px 상자), 띠 중심 반지름, 띠 두께

// 링 모양 마스크 (SVG): 시계 방향으로 도는 호 두 개 + 바깥쪽으로 뻗은 화살촉
function ringMask() {
  const P = (clock, r) => { const a = ((clock - 90) * Math.PI) / 180; return [RC + r * Math.cos(a), RC + r * Math.sin(a)]; };
  const f = (p) => p.map((v) => v.toFixed(1)).join(',');
  let body = '';
  for (const [a0, a1] of [[210, 382], [30, 202]]) {
    const e = a1 - 9;
    const [x0, y0] = P(a0, RB), [x1, y1] = P(e, RB);
    body += `<path d="M${f([x0, y0])} A${RB},${RB} 0 0 1 ${f([x1, y1])}" fill="none" stroke="#fff" stroke-width="${BW}"/>`;
    body += `<polygon fill="#fff" points="${f(P(e - .6, RB - BW / 2))} ${f(P(e - .6, RB + BW / 2 + 20))} ${f(P(a1 + 4, RB + 3))} ${f(P(a1 + .5, RB - BW / 2))}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${RC * 2} ${RC * 2}">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// 붙어 있는 역 점들을 서로 밀어 최소 간격(MIN)을 만듦. fixed(i)가 true인 역은 움직이지 않음
export function spread(P, fixed, MIN, clamp) {
  const n = P.length;
  for (let it = 0; it < 80; it++) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const fi = fixed(i) ? 0 : 1, fj = fixed(j) ? 0 : 1;
      if (!fi && !fj) continue;
      const dx = P[j][0] - P[i][0], dy = P[j][1] - P[i][1], d = Math.hypot(dx, dy) || .01;
      if (d >= MIN) continue;
      const k = (MIN - d) / 2 / d;
      P[i][0] -= dx * k * fi * (fj ? 1 : 2); P[i][1] -= dy * k * fi * (fj ? 1 : 2);
      P[j][0] += dx * k * fj * (fi ? 1 : 2); P[j][1] += dy * k * fj * (fi ? 1 : 2);
    }
    if (clamp) P.forEach(clamp);
  }
  return P;
}

// 직선 노선 위의 점들 (글씨가 선을 덮지 않게 검사할 때 씀)
export function linePoints(P, step = 3) {
  const out = [];
  for (let i = 1; i < P.length; i++) {
    const [ax, ay] = P[i - 1], [bx, by] = P[i], m = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
    for (let j = 1; j < m; j++) out.push([ax + (bx - ax) * j / m, ay + (by - ay) * j / m]);
  }
  return out;
}

export class SrtGuide {
  constructor(layer, cfg, route) {
    this.layer = layer; this.cfg = cfg; this.route = route;
    this.mask = ringMask();
    layer.innerHTML = `<div class="rg-stage"></div>
      <div class="rg-text"><div class="rg-prov"></div><div class="rg-name"></div><div class="rg-roman"></div>
        <div class="rg-line"></div><div class="rg-kind"></div>
        <div class="rg-time"><div class="rg-ampm"><b></b><i></i></div><div class="rg-clock"></div></div></div>
      <div class="srt-strip"><svg viewBox="0 0 1024 768" width="1024" height="768" style="position:absolute;left:0;top:0;overflow:visible"></svg></div>`;
    this.stage = layer.querySelector('.rg-stage');
    this.text = layer.querySelector('.rg-text');
    this.strip = layer.querySelector('.srt-strip');
    this.buildStrip();
    this.unit = null; this.cur = null;
  }

  colorOf(s, i) {
    if (s.ringColor) return s.ringColor;
    if (i === 0) return 'mix';
    return (this.cfg.pinkStations || []).includes(s.ko) ? 'pink' : 'blue';
  }

  makeUnit(color) {
    const u = document.createElement('div');
    u.className = 'rg-unit';
    u.style.cssText = `left:${388 - RC}px;top:${385 - RC}px;width:${RC * 2}px;height:${RC * 2}px;--rmask:${this.mask}`;
    u.innerHTML = `<div class="rg-disc" style="inset:${RC - 258}px"></div><div class="rg-dots" style="inset:${RC - 247}px"></div><div class="rg-arcs ${color}"><i></i></div>`;
    this.stage.appendChild(u);
    // 링은 계속 시계 방향으로 돎 (영상: 약 8초에 한 바퀴)
    const start = (this.spinAngle = ((this.spinAngle ?? 210) + 140) % 360);
    u.querySelector('.rg-arcs').animate([{ transform: `rotate(${start}deg)` }, { transform: `rotate(${start + 360}deg)` }], { duration: 8000, iterations: Infinity });
    return u;
  }

  // 잔상 (빠르게 움직일 때 흐릿하게 남는 링)
  ghost(src, frames, opts, alpha) {
    const g = src.cloneNode(true);
    g.querySelector('.rg-disc').remove(); g.querySelector('.rg-dots').remove();
    this.stage.appendChild(g);
    const arcs = g.querySelector('.rg-arcs'), srcArcs = src.querySelector('.rg-arcs');
    arcs.style.transform = getComputedStyle(srcArcs).transform;
    g.animate(frames.map((f) => ({ ...f, opacity: (f.opacity ?? 1) * alpha })), { ...opts, fill: 'forwards' }).finished.then(() => g.remove(), () => g.remove());
  }

  // ── 오른쪽 노선 띠 ─────────────────────────────
  buildStrip() {
    const all = this.route.all, n = all.length;
    const rp = buildRoutePath(all);
    const xs = rp.samples.map((p) => p.x), ys = rp.samples.map((p) => p.y);
    const gx0 = Math.min(...xs), gx1 = Math.max(...xs), gy0 = Math.min(...ys), gy1 = Math.max(...ys);
    const box = { x0: 716, x1: 892, y0: 274, y1: 726 };
    // 영상처럼 세로로 조금 늘려 띠 높이를 채움 (가로 배율은 세로 배율을 넘지 않음)
    const ky = (box.y1 - box.y0) / Math.max(1, gy1 - gy0);
    const kx = Math.min((box.x1 - box.x0) / Math.max(1, gx1 - gx0), ky);
    const ox = box.x0 + ((box.x1 - box.x0) - (gx1 - gx0) * kx) / 2 - gx0 * kx;
    const oy = box.y0 - gy0 * ky;
    const T = (p) => [p.x * kx + ox, p.y * ky + oy];
    const svg = this.strip.querySelector('svg');
    const tags = new Set(this.cfg.tagStations || []);
    // 영상처럼 역 사이를 직선으로 잇고, 붙어 있는 역(창원·마산·창원중앙 등)은 서로 밀어 간격을 벌림
    const P = rp.stationXY.map(T);
    spread(P, (i) => tags.has(all[i].ko), 24, (q) => { q[0] = Math.min(box.x1 + 10, Math.max(box.x0 - 30, q[0])); q[1] = Math.min(box.y1 + 6, q[1]); });
    let html = `<polyline points="${P.map((q) => q.map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#cf7aa8" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`;
    P.forEach(([x, y], i) => { if (!tags.has(all[i].ko)) html += `<circle class="st-dot" cx="${x}" cy="${y}" r="5.5" fill="#fff" stroke="#c9cbd1" stroke-width="2.2"/>`; });
    // 출발·종착역 (오른쪽 큰 글씨) + 세로선
    html += `<line x1="987" y1="333" x2="987" y2="457" stroke="#c9cbd1" stroke-width="1.2"/><circle cx="987" cy="333" r="3" fill="${'#d0378f'}"/><circle cx="987" cy="457" r="3" fill="#6aaee2"/>`;
    svg.innerHTML = html;
    const od = (en, ko, yEn, yKo, dst) => `<div class="st-od" style="right:${1024 - 968}px;top:0;width:300px;height:0">
        <span class="en" style="top:${yEn - 8}px">${esc(en)}</span><span class="ko ${dst ? 'dst' : ''}" style="top:${yKo - 32}px">${esc(ko)}</span></div>`;
    this.strip.insertAdjacentHTML('beforeend', od(all[0].en, all[0].ko, 288, 337, false) + od(all[n - 1].en, all[n - 1].ko, 425, 464, true));
    this.strip.querySelectorAll('.st-od .ko').forEach((el) => { const w = el.scrollWidth; if (w > 150) el.style.transform = `scaleX(${150 / w})`; });
    // 역 이름: 오른쪽 → 왼쪽 → 아래 → 위 순서로 겹치지 않는 자리
    const placed = [{ x0: 905, y0: 270, x1: 1024, y1: 480 }];
    // 노선 선 위의 점들 (글씨가 선을 덮지 않게)
    const linePts = linePoints(P);
    const hit = (b) => placed.some((q) => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0)
      || linePts.some(([x, y]) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1)
      || P.some(([x, y]) => x > b.x0 - 4 && x < b.x1 + 4 && y > b.y0 - 4 && y < b.y1 + 4);
    this.labels = all.map((s, i) => {
      const [x, y] = P[i], tag = tags.has(s.ko);
      const el = document.createElement('div');
      el.className = 'st-lbl ' + (tag ? 'tagl' : 'txt');
      el.innerHTML = tag ? `<span class="pill">${esc(s.label)}</span>` : esc(s.label);
      this.strip.appendChild(el);
      const w = el.offsetWidth || (tag ? 32 + s.label.length * 14 : s.label.length * 13 + 4), h = tag ? 27 : 15;
      let pos;
      if (tag) pos = { left: x - 13, top: y - h / 2, origin: '13px 50%' };
      else {
        const opts = [
          { left: x + 9, top: y - h / 2, origin: '0 50%' },
          { left: x - 9 - w, top: y - h / 2, origin: '100% 50%' },
          { left: x - w / 2, top: y + 8, origin: '50% 0' },
          { left: x - w / 2, top: y - 8 - h, origin: '50% 100%' },
        ];
        pos = opts.find((o) => !hit({ x0: o.left - 2, y0: o.top - 1, x1: o.left + w + 2, y1: o.top + h + 1 })) || opts[0];
      }
      placed.push({ x0: pos.left - 2, y0: pos.top - 1, x1: pos.left + w + 2, y1: pos.top + h + 1 });
      el.style.left = pos.left + 'px'; el.style.top = pos.top + 'px'; el.style.transformOrigin = pos.origin;
      return el;
    });
    this.dots = [...svg.querySelectorAll('.st-dot')];
  }

  highlight(i) {
    // 영상: 지금 역 이름만 크게 + 분홍 (나머지는 작은 회색 글씨)
    this.labels.forEach((el, k) => { el.style.transform = k === i ? 'scale(1.38)' : ''; el.classList.toggle('on', k === i); });
  }

  fill(s, i) {
    const q = (c) => this.text.querySelector(c);
    const t = splitTime(s.time);
    q('.rg-prov').textContent = s.province || '';
    q('.rg-name').innerHTML = `${esc(s.ko)}역${s.sub ? `<small>(${esc(s.sub)})</small>` : ''}`;
    q('.rg-roman').textContent = s.en + (s.subEn ? `(${s.subEn})` : '');
    q('.rg-kind').innerHTML = i === 0 ? '[<b>출발시간</b><i>┊</i>departure]' : '[<b>도착시간</b><i>┊</i>Arrival ]';
    q('.rg-ampm b').textContent = t.ko; q('.rg-ampm i').textContent = t.en;
    q('.rg-clock').textContent = t.time.padStart(5, '0');
    const nm = q('.rg-name'); nm.style.transform = '';
    if (nm.scrollWidth > 440) nm.style.transform = `translateY(-50%) scaleX(${440 / nm.scrollWidth})`;
  }

  // 오른쪽 노선 띠가 나타나고, 역 이름이 위에서 아래로 차례로 커졌다 작아짐
  async enterStrip() {
    await anim(this.strip, [{ opacity: 0 }, { opacity: 1 }], { duration: 600, easing: 'ease-out' });
  }
  wave(delay = 0) {
    this.labels.forEach((el, k) => el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.38)', offset: .45 }, { transform: 'scale(1)' }],
      { duration: 520, delay: delay + k * 260, easing: 'ease-in-out' }));    // 영상: 이름마다 약 0.26~0.33초 간격
  }

  // 첫 링: 커졌다 작아지며 튕기듯 자리 잡음 (잔상 두 개)
  async ringIn(i) {
    const s = this.route.all[i];
    const u = this.unit = this.makeUnit(this.colorOf(s, i));
    const fr = [{ transform: 'scale(.8)', opacity: 0 }, { transform: 'scale(1.15)', opacity: 1, offset: .3 }, { transform: 'scale(.95)', offset: .62 }, { transform: 'scale(1)', opacity: 1 }];
    this.ghost(u, [{ transform: 'scale(.9)', opacity: 0 }, { transform: 'scale(1.22)', opacity: 1, offset: .35 }, { transform: 'scale(1.08)', opacity: 0 }], { duration: 520, delay: 40 }, .35);
    this.ghost(u, [{ transform: 'scale(1.3)', opacity: 0 }, { transform: 'scale(1.12)', opacity: 1, offset: .4 }, { transform: 'scale(.98)', opacity: 0 }], { duration: 560, delay: 90 }, .25);
    await anim(u, fr, { duration: 480, easing: 'ease-out' });
  }

  // 다음 링: 지금 링은 왼쪽으로 빠지며 사라지고, 새 링이 오른쪽에서 들어옴
  async slideTo(i) {
    const s = this.route.all[i], old = this.unit;
    const u = this.unit = this.makeUnit(this.colorOf(s, i));
    if (old) {
      this.ghost(old, [{ transform: 'translateX(0)', opacity: .9 }, { transform: 'translateX(-150px)', opacity: 0 }], { duration: 420, easing: 'ease-in' }, .6);
      old.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateX(-300px)', opacity: 0 }], { duration: 650, easing: 'cubic-bezier(.5,0,.8,.6)', fill: 'forwards' })
        .finished.then(() => old.remove(), () => old.remove());
    }
    this.ghost(u, [{ transform: 'translateX(330px)', opacity: 0 }, { transform: 'translateX(120px)', opacity: 1 }, { transform: 'translateX(20px)', opacity: 0 }], { duration: 520, easing: 'ease-out' }, .4);
    await anim(u, [{ transform: 'translateX(230px)', opacity: 0 }, { transform: 'translateX(90px)', opacity: 1, offset: .35 }, { transform: 'none', opacity: 1 }], { duration: 700, easing: 'cubic-bezier(.2,.7,.25,1)' });
  }

  async textIn(i) {
    this.fill(this.route.all[i], i); this.cur = i;
    this.highlight(i);
    await anim(this.text, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
  }
  async textOut() {
    this.highlight(-1);
    await anim(this.text, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-in' });
  }

  async exit() {
    const u = this.unit;
    await Promise.all([
      u && anim(u, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.97)' }], { duration: 600, easing: 'ease-in' }),
      anim(this.strip, [{ opacity: 1 }, { opacity: 0 }], { duration: 500 }),
    ]);
    u?.remove(); this.unit = null; this.cur = null;
  }
}
