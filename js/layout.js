// 반응형 화면 배치
//  - 스테이지는 창을 여백 없이 꽉 채움 (배경·지도·3D는 끝까지 그려짐)
//  - 안내 내용은 가운데 '콘텐츠 상자'에 배치: 가로 화면 1280×720, 세로 화면 720×1280
//  - 크기 단위는 디자인 기준 px (콘텐츠 상자가 화면에 딱 맞게 전체 배율을 정함)
export const layout = { W: 1280, H: 720, s: 1, mode: 'land', box: { x: 0, y: 0, w: 1280, h: 720 } };

// land: 가로 화면 콘텐츠 상자 크기 (SRT 버전은 실제 화면 비율 4:3 → [1024, 768])
export function computeLayout(allowPortrait = true, land = [1280, 720]) {
  const vw = innerWidth, vh = innerHeight;
  const mode = allowPortrait && vh > vw * 1.05 ? 'port' : 'land';
  const bw = mode === 'port' ? 720 : land[0], bh = mode === 'port' ? 1280 : land[1];
  const s = Math.min(vw / bw, vh / bh);
  const W = vw / s, H = vh / s;
  Object.assign(layout, { W, H, s, mode, box: { x: (W - bw) / 2, y: (H - bh) / 2, w: bw, h: bh } });
  return layout;
}
