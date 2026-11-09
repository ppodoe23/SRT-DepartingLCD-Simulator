// SRT 출발/도착 깃발 (2D, 1024×768 기준 좌표 — 영상에서 잰 위치)
//  출발: 깃대 왼쪽 / 도착: 깃대 오른쪽 (영상과 같이 좌우가 바뀜)
import { splitTime } from '../util.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

// 영상(2023-09-16)에서 원근을 되돌려 잰 위치 (1024×768)
const GEO = {
  departure: { pole: 248, top: 176, base: 636, armY: 190, arm: [230, 760], banner: [262, 207, 808, 552], hooks: [318, 334, 736, 752] },
  arrival: { pole: 814, top: 250, base: 694, armY: 262, arm: [229, 836], banner: [252, 273, 795, 592], hooks: [300, 316, 736, 752] },
};

// 현수막 바탕: 위 자홍 → 보라 → 아래 하늘색, 구름 같은 얼룩
function paintBanner(cv, w, h, seed) {
  const dpr = 2; cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  // 영상: 위 자홍 → 분홍빛 보라 띠 → 아래 진한 하늘색
  g.addColorStop(0, '#c13ac0'); g.addColorStop(.3, '#c84cc6'); g.addColorStop(.52, '#b46ccd'); g.addColorStop(.74, '#7fa9db'); g.addColorStop(1, '#4ec6d8');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  let r = seed;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * w, y = h * (.15 + rnd() * .8), rad = 60 + rnd() * 150;
    const light = rnd() < .55;
    const gg = ctx.createRadialGradient(x, y, 0, x, y, rad);
    gg.addColorStop(0, light ? 'rgba(255,235,255,.16)' : 'rgba(150,40,160,.12)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gg; ctx.save(); ctx.translate(x, y); ctx.scale(1.8, .55); ctx.translate(-x, -y);
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}

export class SrtFlag {
  constructor(layer) { this.layer = layer; }

  build(kind, st) {
    const G = GEO[kind], [bx0, by0, bx1, by1] = G.banner, bw = bx1 - bx0, bh = by1 - by0;
    const t = splitTime(st.time);
    const el = document.createElement('div'); el.className = 'fl';
    const px = (v) => `${v}px`;
    const hooks = G.hooks.map((x) => `<i class="fl-hook" style="left:${px(x - 2)};top:${px(G.armY - 2)}"></i>`).join('');
    el.innerHTML = `
      <i class="fl-pole" style="left:${px(G.pole - 5)};top:${px(G.top)};height:${px(G.base - G.top)}"></i>
      <i class="fl-cap" style="left:${px(G.pole - 9)};top:${px(G.top - 10)}"></i>
      <i class="fl-arm" style="left:${px(G.arm[0])};top:${px(G.armY - 4)};width:${px(G.arm[1] - G.arm[0])}"></i>
      ${hooks}
      <i class="fl-base" style="left:${px(G.pole - 14)};top:${px(G.base - 16)}"></i>
      <div class="fl-banner" style="left:${px(bx0)};top:${px(by0)};width:${px(bw)};height:${px(bh)}">
        <canvas></canvas>
        <div class="fl-text">
          <div class="fl-kind" style="top:11.5%"><b>${kind === 'arrival' ? '도착' : '출발'}</b>${kind === 'arrival' ? 'ARRIVAL' : 'DEPARTURE'}</div>
          <div class="fl-name" style="top:28.6%">${esc(st.ko)}</div>
          <div class="fl-en" style="top:46.6%">${esc(st.en)}</div>
          <div class="fl-line" style="top:54%"></div>
          <div class="fl-tkind" style="top:61%"><b>${kind === 'arrival' ? '도착시간' : '출발시간'}</b>TIME</div>
          <div class="fl-time" style="top:77.5%"><span class="t">${t.time.padStart(5, '0')}</span><span class="ap"><span>${t.ko}</span><span>${t.en}</span></span></div>
        </div>
      </div>`;
    paintBanner(el.querySelector('canvas'), bw, bh, kind === 'arrival' ? 7 : 3);
    // 긴 역 이름은 가로로 줄여 현수막 안에 맞춤
    this.layer.innerHTML = ''; this.layer.appendChild(el);
    const nm = el.querySelector('.fl-name');
    const w = nm.scrollWidth; if (w > bw * .86) nm.style.transform = `translateY(-50%) scaleX(${(bw * .86) / w})`;
    this.el = el; this.text = el.querySelector('.fl-text'); this.banner = el.querySelector('.fl-banner');
    return el;
  }

  // 영상 타이밍: 0~1.0초 깃발이 안개 속에서 나타남 → 1.7~2.2초 글씨 → (끝 2.3초 전) 글씨 사라짐 → 깃발 사라짐
  frame(t, T) {
    if (!this.el) return;
    const k = (a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
    const appear = k(0, 1.0), gone = k(T - 1.3, T - .2);
    this.el.style.opacity = String(appear * (1 - gone));
    this.banner.style.filter = `saturate(${.25 + .75 * k(.3, 1.2)}) brightness(${1 + .25 * (1 - k(.3, 1.2)) + .25 * k(T - 1.3, T - .4)})`;
    this.text.style.opacity = String(k(1.7, 2.2) * (1 - k(T - 2.3, T - 1.8)));
  }

  clear() { this.layer.innerHTML = ''; this.el = null; }
}
