// ─────────────────────────────────────────────────────────────
//  SRT 객실 LCD 안내화면 설정 (srt.html)
//  KTX 버전(index.html / js/config.js)과 별개로 동작합니다.
//  역 목록·소요시간표는 KTX 버전과 같은 js/data/ 파일을 함께 씁니다.
// ─────────────────────────────────────────────────────────────
export default {
  storageKey: 'srtlcd.route',
  // 화면 맞춤: 'auto' 가로 화면(4:3 ~ 2:1)은 실제 16:9 SRT 화면처럼 4:3 안내화면을 가로로 늘림, 그 밖은 여백을 배경으로 채움
  //           'stretch' 항상 늘림 / 'fill' 늘리지 않고 여백을 배경으로 채움(예전 방식)
  screen: { fit: 'auto' },          // 사이트 설정창 저장 이름 (KTX 버전과 따로 저장)

  clock: { mode: 'live' },             // 오른쪽 위 날짜·시각: 'live' 현재 시각 / 'fixed' + value (예: '2023-09-16T19:26:00')
  // 'manual' 아래 시각 그대로 (영상과 같은 시각) / 'auto' 현재 시각 + 역간 소요시간표로 자동
  times: { mode: 'manual', dwell: 1 },

  // 기본 노선 — 영상(2023-09-16 SRT 363 수서 → 진주)과 같은 노선·시각·표기
  //  pass: true  → 통과역: 지도·오른쪽 노선 띠에만 나오고 링(정차역 안내)·시각은 없음
  //  label       → 지도·노선 띠에 쓰는 이름 (예: 김천(구미))
  //  province    → 링 위쪽 도 이름 (영상 표기 그대로: 수서도 '경기도')
  //  en          → 영문 표기 (영상 표기 그대로: 평택지제 'PyeontaekJije')
  route: {
    origin: { name: '수서', depart: '19:25', province: '서울특별시' },
    stops: [
      { name: '동탄',     arrive: '19:41', province: '경기도' },
      { name: '평택지제', arrive: '19:51', province: '경기도', en: 'PyeontaekJije' },
      { name: '천안아산', pass: true },
      { name: '오송',     arrive: '20:10', province: '충청북도' },
      { name: '대전',     arrive: '20:27', province: '대전광역시' },
      { name: '김천구미', pass: true, label: '김천(구미)' },
      { name: '동대구',   arrive: '21:10', province: '대구광역시' },
      { name: '밀양',     arrive: '21:46', province: '경상남도' },
      { name: '진영',     arrive: '22:05', province: '경상남도' },
      { name: '창원중앙', arrive: '22:16', province: '경상남도' },
      { name: '창원',     arrive: '22:25', province: '경상남도' },
      { name: '마산',     arrive: '22:31', province: '경상남도' },
    ],
    destination: { name: '진주', arrive: '22:58', province: '경상남도' },
  },

  // 링 색 (영상 기준): 출발역 'mix'(분홍+파랑이 함께 도는 링), 아래 목록의 역 'pink', 나머지 'blue'
  //   역마다 바꾸려면 route의 역에 ringColor: 'mix' | 'pink' | 'blue' 를 적으세요.
  pinkStations: ['동탄', '평택지제', '천안아산', '오송'],
  // 노선 띠·지도에서 분홍 태그로 표시할 역 (SRT 전용역)
  tagStations: ['수서', '동탄', '평택지제'],

  // 이미지·모델 (없으면 기본 표시로 대체)
  assets: {
    srLogo: 'images/sr_ci.svg',        // SR CI (파랑 기하학 심벌 + 분홍 SR 글자): 처음 로고 화면, 왼쪽 아래, 안내문
    srtLogo: 'images/sr_bi.svg',       // SR BI: '정차역 안내' 아래, 지도 화면
    biColor: '#4B2F48',                // SR BI 색 (흰색 SVG를 이 색으로 칠함). 원래 색 그대로 쓰려면 null
  },
  models: {
    train: {
      url: 'models/SRT_MODELING.glb',
      height: 4.0, length: null, forwardAxis: 'auto', rotationY: 0, yOffset: 0,
      scale: 1, ignoreMeshes: [], carCount: 0, carLength: null,
    },
  },

  // 장면 길이 (ms) — 영상(2023-09-16 SRT 363 수서→진주)을 프레임 단위로 잰 값
  timing: {
    logo: 2700,        // 흰 화면(1.25초) → SR 로고 → 사라짐
    tunnel: 2700,      // 화살표 묶음이 모임 → 쐐기로 펼쳐짐 → 짧아져 열차를 감쌈 → 열차가 다가옴 (앞쪽 3/4 각도)
    side: 1750,        // 열차 옆을 지나감
    wipe: 1400,        // 줄무늬 전환
    map: 11000,        // 3D 지도 + 노선 (끝 2초는 카메라가 출발역으로 내려감)
    flag: 11500,       // 출발 깃발
    stop: 8000,        // 정차역 링 한 화면 (링이 바뀌는 간격)
    arrivalFlag: 11000,// 도착 깃발
    notice: 7000,      // 안내문 한 장
  },

  // 마지막 안내문 (여러 장). 영상에는 없으므로 기본은 끔 (도착 깃발 → 처음으로). 켜려면 enabled: true
  notice: {
    enabled: false,
    slides: [
      { title: '열차 내 안전 안내', lines: ['열차가 완전히 멈춘 뒤', '내리고 타 주시기 바랍니다.', '', '비상 시에는 객실 양 끝의', '비상 인터폰을 이용해 주세요.'] },
      { title: '쾌적한 여행을 위해', lines: ['객실 안에서는', '휴대전화를 진동으로 바꾸고', '통화는 통로에서 해 주세요.', '', '모두가 함께하는 공간입니다.'] },
    ],
  },

  loop: true,
};
