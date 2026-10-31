"""把 shared/ 的公共代码拷进扩展目录，并生成网页版单文件 web/index.html，最后打包扩展 zip"""
import shutil, os, zipfile
R = os.path.dirname(os.path.abspath(__file__))
sh = lambda *p: os.path.join(R, 'shared', *p)
for f in ('core.js', 'industries.js', 'templates-lib.js', 'needs.js', 'insight.js', 'ai.js', 'deep.js', 'xlsx-lite.js', 'store-base.js', 'app.js', 'app.css'):
    shutil.copy(sh(f), os.path.join(R, 'extension', f))
shutil.copy(os.path.join(R, 'report', 'pipeline.js'), os.path.join(R, 'extension', 'pipeline.js'))
read = lambda p: open(p, encoding='utf8').read()
js = '\n'.join(read(p) for p in (sh('core.js'), sh('industries.js'), sh('templates-lib.js'), sh('needs.js'), sh('insight.js'), sh('ai.js'), sh('xlsx-lite.js'), sh('store-base.js'), os.path.join(R, 'web', 'env-web.js'), sh('app.js')))
html = f'''<title>餐饮矩阵助手</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600;700&family=JetBrains+Mono:wght@500;600&display=swap">
<style>
{read(sh('app.css'))}
</style>
<div id="app" class="app"></div>
<script>
{js.replace('</script', '<\\/script')}
</script>
'''
open(os.path.join(R, 'web', 'index.html'), 'w', encoding='utf8').write(html)
os.makedirs(os.path.join(R, 'dist'), exist_ok=True)
zp = os.path.join(R, 'dist', '矩阵内容助手-chrome扩展.zip')
with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED) as z:
    ext = os.path.join(R, 'extension')
    for base, _, files in os.walk(ext):
        for f in files:
            full = os.path.join(base, f)
            z.write(full, os.path.join('矩阵内容助手', os.path.relpath(full, ext)))
print('built', zp)

# ---------- 评价调研报告页 ----------
rp = lambda *p: os.path.join(R, 'report', *p)
rjs = '\n'.join(read(p) for p in (sh('xlsx-lite.js'), rp('pipeline.js'), rp('report.js')))
rhtml = f'''<title>评价调研报告</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600;700&family=JetBrains+Mono:wght@500;600&display=swap">
<style>
{read(rp('report.css'))}
</style>
<div id="app" class="wrap"></div>
<script>
{rjs.replace('</script', '<\\/script')}
</script>
'''
open(rp('index.html'), 'w', encoding='utf8').write(rhtml)
print('built report/index.html', len(rhtml))
