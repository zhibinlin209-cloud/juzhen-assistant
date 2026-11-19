"""打「通用版」插件：给别人用，不带禧聚的服务器口令和专用功能。
用法：python3 tools/build_generic.py 输出目录
- 去掉：ingest-key.js（连禧聚服务器的口令）、美团管家/经营宝/推广通/自家内容库（ownlib/gjrun/jybrun）、
  门店评价调研（reviews/dianping）、禧聚营销部飞书分析（feishu/postsync/xhsshot）、自动更新脚本
- 飞书页换成 cmtdirect.js：只做评论采集，直连使用者自己的飞书 + 自己的大模型密钥
"""
import json, os, re, shutil, sys
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'extension')
OUT = sys.argv[1]
DROP = {'ingest-key.js', 'ownlib.js', 'gjrun.js', 'jybrun.js', 'reviews.js', 'dianping.js', 'feishu.js', 'postsync.js', 'xhsshot.js',
        'update.ps1', '安装自动更新.bat', '使用说明.txt', 'comments.js'}
if os.path.exists(OUT): shutil.rmtree(OUT)
os.makedirs(OUT)
for n in os.listdir(SRC):
    if n in DROP or n.startswith('.') or n.endswith('.zip'): continue
    p = os.path.join(SRC, n)
    (shutil.copytree if os.path.isdir(p) else shutil.copy2)(p, os.path.join(OUT, n))
# 侧边栏：去掉被删的脚本，飞书页换成评论采集
sp = open(os.path.join(SRC, 'sidepanel.html'), encoding='utf-8').read()
for n in ['ingest-key.js', 'ownlib.js', 'postsync.js', 'xhsshot.js', 'reviews.js', 'comments.js']:
    sp = sp.replace(f'  <script src="{n}"></script>\n', '')
sp = sp.replace('<script src="feishu.js"></script>', '<script src="cmtdirect.js"></script>')
assert 'cmtdirect.js' in sp and 'ingest-key' not in sp and 'ownlib' not in sp
open(os.path.join(OUT, 'sidepanel.html'), 'w', encoding='utf-8').write(sp)
# manifest：版本、去掉禧聚 / 美团 / 点评的网址和后台常驻
m = json.load(open(os.path.join(SRC, 'manifest.json'), encoding='utf-8'))
m['name'] = '矩阵内容助手'
m['version'] = sys.argv[2] if len(sys.argv) > 2 else '1.0.0'
m['description'] = '小红书 / 抖音：关键词调研竞对和爆款、挖顾客需求、按人设生成内容；贴链接拉全部评论写进自己的飞书多维表格，并用自己的大模型做评论总结。'
m['permissions'] = [p for p in m['permissions'] if p != 'alarms']
bad = re.compile(r'dianping|meituan|yesyueji|channels\.weixin')
m['host_permissions'] = [h for h in m['host_permissions'] if not bad.search(h)]
m['content_scripts'] = [c for c in m['content_scripts'] if not any('dianping' in x for x in c['matches'])]
json.dump(m, open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
# 后台：只留点工具栏图标打开侧边栏
open(os.path.join(OUT, 'background.js'), 'w', encoding='utf-8').write("""// 点击工具栏图标时打开侧边栏
chrome.runtime.onInstalled.addListener(() => { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}); });
""")
app = open(os.path.join(OUT, 'app.js'), encoding='utf-8').read()
app = app.replace('${window.Research ? "小红书 / 抖音 / 大众点评" : "小红书 / 抖音"}', '小红书 / 抖音')
open(os.path.join(OUT, 'app.js'), 'w', encoding='utf-8').write(app)
# 自查：通用版里不能有禧聚的口令、网址、人名
for root, _, fs in os.walk(OUT):
    for f in fs:
        if f.endswith(('.js', '.html', '.json')):
            t = open(os.path.join(root, f), encoding='utf-8', errors='ignore').read()
            for w in ['yesyueji', '__rmIngest', '禧聚', '林智斌', '洛琳', 'x-rm-key']:
                assert w not in t, f'{f} 里还有 {w}'
rd = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'generic_readme.txt'), encoding='utf-8').read().replace('{VER}', m['version'])
open(os.path.join(OUT, '使用说明.txt'), 'w', encoding='utf-8-sig').write(rd.replace('\n', '\r\n'))
print('ok', OUT, m['version'])
