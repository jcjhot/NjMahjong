// 用 FluffyStuff 的牌面底图（Front.svg）合成 8 张花牌
// 花牌不在 riichi 牌组里，但用同一套底图 + 传统汉字，视觉风格才统一
// 用法: node build-flowers.mjs
import { readFileSync, writeFileSync } from 'fs';

const FRONT_RAW = '/tmp/front-raw.svg';
const OUT_DIR = 'public/tiles';

// 春夏秋冬 梅兰竹菊 —— 配色沿用传统花牌的红 / 绿 / 蓝 / 黄
const FLOWERS = {
  f1: { ch: '春', color: '#c0392b' },
  f2: { ch: '夏', color: '#2e7d32' },
  f3: { ch: '秋', color: '#c47a12' },
  f4: { ch: '冬', color: '#1565c0' },
  f5: { ch: '梅', color: '#c0392b' },
  f6: { ch: '兰', color: '#2e7d32' },
  f7: { ch: '竹', color: '#2e7d32' },
  f8: { ch: '菊', color: '#c47a12' }
};

function clean(svg) {
  let s = svg;
  s = s.replace(/<\?xml[^>]*\?>/g, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<metadata[\s\S]*?<\/metadata>/g, '');
  // namedview / path-effect 可能带子元素，必须先按「成对标签」删，再兜底删自闭合形式，
  // 否则会留下悬空的结束标签，整个 SVG 会解析失败
  s = s.replace(/<sodipodi:namedview[\s\S]*?<\/sodipodi:namedview>/g, '');
  s = s.replace(/<sodipodi:namedview[^>]*\/>/g, '');
  s = s.replace(/<inkscape:path-effect[\s\S]*?<\/inkscape:path-effect>/g, '');
  s = s.replace(/<inkscape:path-effect[^>]*\/>/g, '');
  s = s.replace(/\s+xmlns:(osb|dc|cc|rdf|sodipodi|inkscape)="[^"]*"/g, '');
  s = s.replace(/\s+(osb|dc|cc|rdf|inkscape|sodipodi):[a-zA-Z-]+="[^"]*"/g, '');
  s = s.replace(/>\s+</g, '><');
  s = s.replace(/\s{2,}/g, ' ');
  return s.trim();
}

const front = clean(readFileSync(FRONT_RAW, 'utf-8'));

let n = 0;
for (const [id, f] of Object.entries(FLOWERS)) {
  // 把汉字叠在牌面正中；字体按各平台常见的中文楷/宋体依次回退
  const text = '<text x="150" y="212" text-anchor="middle" dominant-baseline="central" ' +
    'font-family="Kaiti SC,STKaiti,KaiTi,STSong,SimSun,serif" font-size="196" font-weight="bold" ' +
    'fill="' + f.color + '">' + f.ch + '</text>';
  const svg = front.replace(/<\/svg>\s*$/, text + '</svg>');
  writeFileSync(OUT_DIR + '/' + id + '.svg', svg, 'utf-8');
  n++;
}
console.log('生成花牌', n, '张 →', Object.keys(FLOWERS).join(' '));
