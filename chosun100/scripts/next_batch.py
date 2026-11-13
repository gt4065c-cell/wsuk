"""다음에 그림을 만들 인물 N명(기본 4)을 index.html의 P 목록에서 찾아 출력한다.
img/NNN.jpg 가 이미 있는 번호는 건너뛴다."""
import json, os, re, sys
n = int(sys.argv[1]) if len(sys.argv) > 1 else 4
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(root, 'index.html'), encoding='utf-8').read()
body = src[src.index('const P = ['):]
body = body[:body.index('].map(')]
rows = re.findall(r'\[(\d+),"([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]*)"', body)
out = [dict(n=int(r[0]), name=r[1], role=r[2], copy=r[3], theme=r[4], era=r[5])
       for r in rows if not os.path.exists(os.path.join(root, 'img', f'{int(r[0]):03d}.jpg'))][:n]
print(json.dumps(out, ensure_ascii=False, indent=1))
