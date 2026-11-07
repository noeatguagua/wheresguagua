"""把含車廂標記的 app/data.js 拆成「公開版」與「私有版」。
  app/data.js          公開：access 欄位清空（可進版控）
  app/data.private.js  私有：只含 access（已列入 .gitignore，頁面載入時自動疊加）
usage: python tools/split_private.py app/data.js
重建資料後（build_data.py 會產生含 access 的 data.js）請再跑一次。
"""
import json, sys

path = sys.argv[1]
src = open(path, encoding='utf-8').read()
head = 'window.METRO_DATA='
if not src.startswith(head):
    sys.exit('unexpected data.js format')
data = json.loads(src[len(head):].strip().rstrip(';'))
access = data.get('access') or {}
if not access:
    sys.exit('access 已是空的，無需拆分（若私有檔已存在請勿覆蓋）')
dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(', ', ': '))
data['access'] = {}
open(path, 'w', encoding='utf-8').write(head + dump(data) + ';\n')
priv = path.replace('data.js', 'data.private.js')
open(priv, 'w', encoding='utf-8').write('window.METRO_DATA.access=' + dump(access) + ';\n')
print(f'public: {path} (access 清空)\nprivate: {priv} ({len(access)} 個行車方向)')
