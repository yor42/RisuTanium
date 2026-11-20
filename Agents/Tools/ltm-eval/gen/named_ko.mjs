// Named-filler (NF) sentence templates, Korean. Same two kinds as named_en.mjs: presence and co-mention.
import { josa as j } from './lib.mjs';

export const presence = [
  (n, g, m, pl) => `${j(n, '은')} ${pl} 근처에 한참 서 있었다. ${g} 그랬다.`,
  (n, g, m, pl) => `${pl} 이야기가 나오자 ${j(n, '은')} ${m} 얼굴이 되었다.`,
  (n, g, m, pl) => `누군가 ${j(n, '이')} 아까 ${j(pl, '을')} 지나갔다고 말했다. ${g} 지나갔다고 했다.`,
  (n, g, m, pl) => `${j(n, '이')} ${pl} 건너편에서 손을 흔들고는 돌아섰다.`,
  (n, g, m, pl) => `${j(n, '은')} ${g} 아무에게도 아닌 말을 중얼거렸다.`,
  (n, g, m, pl) => `${j(n, '은')} 저녁 내내 ${m} 모습이었지만 아무도 이유를 묻지 않았다.`,
];

export const co = [
  { pool: 'animal', fn: (n, w) => `${j(n, '은')} ${j(w, '이')} 아침 내내 수레를 따라왔다고 말했다.` },
  { pool: 'weapon', fn: (n, w) => `${j(n, '은')} 가게 진열창의 ${j(w, '을')} 흘끗 보고는 그냥 지나쳤다.` },
  { pool: 'food', fn: (n, w) => `${j(n, '은')} 농담 하나를 주고 좌판에서 ${j(w, '을')} 한 줌 받았다.` },
  { pool: 'drink', fn: (n, w) => `${j(n, '은')} ${j(w, '을')} 시켜 놓고 손도 대지 않았다.` },
  { pool: 'place', fn: (n, w) => `${j(n, '은')} ${w}로 가는 길이 보기보다 멀다고 우겼다.` },
  { pool: 'trade', fn: (n, w) => `${j(n, '은')} 이 마을에 여관보다 ${j(w, '이')} 더 필요하다고 했다.` },
  { pool: 'objt', fn: (n, w) => `${j(n, '은')} 탁자 위의 ${j(w, '을')} 집었다가 도로 내려놓았다.` },
  { pool: 'term', fn: (n, w) => `${j(n, '은')} ${w}라는 말에 눈살을 찌푸리더니 화제를 돌렸다.` },
];
