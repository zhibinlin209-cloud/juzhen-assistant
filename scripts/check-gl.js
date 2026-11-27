// 改完攻略平台代码后跑一遍：node scripts/check-gl.js
// 查三件事：glweb.js 语法；gl.html 里脚本的语法；有没有「调用了却没定义」的函数（11-27 改评论大厅时误删过 candBox，页面一直报错没人发现）。
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const root = path.join(__dirname, '..'); let bad = 0;
const check = f => { try { cp.execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); console.log('语法 OK  ' + path.relative(root, f)); } catch (e) { bad++; console.log('语法错误 ' + path.relative(root, f) + '\n' + String(e.stderr).split('\n').slice(0, 6).join('\n')); } };
const html = fs.readFileSync(path.join(root, 'bot/cockpit/gl.html'), 'utf8'); const js = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map(x => x.replace(/^<script>|<\/script>$/g, '')).join('\n');
const tmp = path.join(os.tmpdir(), 'gl_check_' + process.pid + '.js'); fs.writeFileSync(tmp, js);
['bot/lib/glweb.js', 'bot/lib/glib.js', 'bot/lib/glreplies.js'].forEach(f => check(path.join(root, f))); check(tmp);
function undef(src, extra) {
  const defs = new Set(); let m;
  const reDef = /(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+\[([^\]]+)\]\s*=|(?:const|let|var)\s+\{([^}]+)\}\s*=|\(([^()]*)\)\s*=>|([A-Za-z_$][\w$]*)\s*=>|function\s*[A-Za-z_$\w]*\s*\(([^()]*)\)|catch\s*\(([A-Za-z_$][\w$]*)\))/g;
  while ((m = reDef.exec(src))) for (let i = 1; i <= 7; i++) if (m[i]) m[i].split(/[,\s:=\[\]{}.]+/).forEach(x => { if (/^[A-Za-z_$][\w$]*$/.test(x)) defs.add(x); });
  const reMulti = /(?:const|let|var)\s+([^;]+?);/g; while ((m = reMulti.exec(src))) m[1].split(',').forEach(p => { const mm = p.trim().match(/^([A-Za-z_$][\w$]*)\s*(=|$)/); if (mm) defs.add(mm[1]); });
  const ok = new Set(('document window location fetch setTimeout clearTimeout setInterval clearInterval Promise JSON Math Date String Number Array Object Set Map RegExp Error URL URLSearchParams Blob FileReader Image navigator console parseInt parseFloat isNaN encodeURIComponent decodeURIComponent confirm alert prompt requestAnimationFrame localStorage Boolean AbortSignal FormData File atob btoa history Intl Symbol crypto require Buffer process if for while switch return typeof function catch await new async of rgba var min max calc gradient url ' + extra).split(/\s+/));
  const out = new Map(); const reCall = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g; while ((m = reCall.exec(src))) { const n = m[1]; if (!defs.has(n) && !ok.has(n)) out.set(n, (out.get(n) || 0) + 1); } return [...out.keys()];
}
const u1 = undef(js, 'sec fn'), u2 = undef(fs.readFileSync(path.join(root, 'bot/lib/glweb.js'), 'utf8'), 'log bossDm vision rosterSrc');
if (u1.length) { bad++; console.log('gl.html 里调用了但没定义：' + u1.join('、')); } else console.log('函数都在 OK  bot/cockpit/gl.html');
if (u2.length) { bad++; console.log('glweb.js 里调用了但没定义：' + u2.join('、')); } else console.log('函数都在 OK  bot/lib/glweb.js');
try { fs.unlinkSync(tmp); } catch (e) { }
process.exit(bad ? 1 : 0);
