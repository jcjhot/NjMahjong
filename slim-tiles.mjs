// 精简 FluffyStuff 麻将 SVG：去掉 Inkscape 编辑器遗留的元数据
// 保守做法：保留 id 与 xlink 引用，避免破坏 <use xlink:href="#id"> 这类内部引用
// 用法: node slim-tiles.mjs
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const DIR = 'public/tiles';

function clean(svg) {
  let s = svg;
  s = s.replace(/<\?xml[^>]*\?>/g, '');                       // XML 声明
  s = s.replace(/<!--[\s\S]*?-->/g, '');                      // 注释
  s = s.replace(/<metadata[\s\S]*?<\/metadata>/g, '');        // RDF 元数据
  // namedview / path-effect 可能带子元素，必须先按「成对标签」删，再兜底删自闭合形式，
  // 否则会留下悬空的结束标签，整个 SVG 会解析失败（浏览器里表现为图片不显示）
  s = s.replace(/<sodipodi:namedview[\s\S]*?<\/sodipodi:namedview>/g, '');
  s = s.replace(/<sodipodi:namedview[^>]*\/>/g, '');
  s = s.replace(/<inkscape:path-effect[\s\S]*?<\/inkscape:path-effect>/g, '');
  s = s.replace(/<inkscape:path-effect[^>]*\/>/g, '');
  s = s.replace(/\s+xmlns:(osb|dc|cc|rdf|sodipodi|inkscape)="[^"]*"/g, '');
  // 命名空间声明已删除，任何残留的带前缀属性都会让 SVG 解析失败，必须一并清掉
  s = s.replace(/\s+(osb|dc|cc|rdf|inkscape|sodipodi):[a-zA-Z-]+="[^"]*"/g, '');
  s = s.replace(/>\s+</g, '><');                              // 标签间空白
  s = s.replace(/\s{2,}/g, ' ');
  return s.trim();
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.svg'));
let before = 0, after = 0;
for (const f of files) {
  const p = join(DIR, f);
  const src = readFileSync(p, 'utf-8');
  const out = clean(src);
  before += Buffer.byteLength(src);
  after += Buffer.byteLength(out);
  writeFileSync(p, out, 'utf-8');
}
console.log('处理', files.length, '个文件');
console.log('精简前', (before / 1024).toFixed(0), 'KB → 精简后', (after / 1024).toFixed(0), 'KB',
  '（省', (100 - after / before * 100).toFixed(0) + '%）');
