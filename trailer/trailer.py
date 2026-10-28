# -*- coding: utf-8 -*-
"""정몽주 「단심」 영화 예고편 — 절차적 수묵 영상 + 합성 사운드트랙."""
import math, sys, subprocess, wave, glob
from multiprocessing import Pool
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops

W, H, FPS = 1920, 1080, 30
SR = 48000
BAR = 138                      # 2.39:1 레터박스
FONT_DIR = glob.glob('/root/.claude/skills/synced/*/wisdom-reels/assets/fonts')[0]
F_SERIF = f'{FONT_DIR}/GowunBatang-Bold-sub.ttf'
F_SANS = f'{FONT_DIR}/Pretendard-SemiBold.otf'
F_HANJA = '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'

# ------------------------------------------------------------------ timeline
# (start, end, scene, params)
TL = [
    (0.0, 4.0, 'card', dict(lines=['실제 역사에서 시작된 이야기'], size=46, at=0.7)),
    (4.0, 11.0, 'mountains', {}),
    (11.0, 14.0, 'card', dict(lines=['한 왕조가', '저물고 있었다'], size=78, at=0.2)),
    (14.0, 20.0, 'sea', {}),
    (20.0, 22.5, 'card', dict(lines=['학자, 외교가, 그리고 재상'], size=70, at=0.15)),
    (22.5, 28.5, 'army', {}),
    (28.5, 31.0, 'card', dict(lines=['같은 꿈을 꾸던 동지는'], size=78, at=0.1)),
    (31.0, 33.5, 'card', dict(lines=['서로 다른 길에 섰다'], size=78, at=0.1, red=True)),
    (33.5, 40.5, 'two', {}),
    (40.5, 47.5, 'candle', {}),
    (47.5, 48.6, 'card', dict(lines=['충절인가'], size=120, at=0.0)),
    (48.6, 48.95, 'flash', dict(src='army')),
    (48.95, 50.05, 'card', dict(lines=['고집인가'], size=120, at=0.0, red=True)),
    (50.05, 50.4, 'flash', dict(src='sea')),
    (50.4, 51.5, 'card', dict(lines=['새 시대인가'], size=120, at=0.0)),
    (51.5, 51.85, 'flash', dict(src='two')),
    (51.85, 53.0, 'card', dict(lines=['옛 약속인가'], size=120, at=0.0, red=True)),
    (53.0, 59.4, 'bridge', {}),
    (59.4, 61.0, 'black', {}),
    (61.0, 67.5, 'title', {}),
    (67.5, 71.5, 'card', dict(lines=['당신이라면,', '무엇을 지키겠습니까?'], size=72, at=0.3)),
    (71.5, 76.0, 'end', {}),
]
TOTAL = TL[-1][1]

# 장면 위 자막: (start, end, lines, size, pos, small)
CAPTIONS = [
    (5.0, 10.2, ['1392년, 고려'], 64, 'low', None),
    (15.0, 19.4, ['칼 대신 말로', '나라를 지킨 사람'], 60, 'low', None),
    (23.4, 27.8, ['1388년, 위화도 회군'], 60, 'low', None),
    (34.3, 39.9, ['이런들 어떠하리', '저런들 어떠하리'], 62, 'low2', '— 하여가, 이방원이 불렀다고 전해지는 노래'),
    (41.0, 44.1, ['이 몸이 죽고 죽어', '일백 번 고쳐 죽어'], 64, 'top', None),
    (44.3, 47.3, ['님 향한 일편단심이야', '가실 줄이 있으랴'], 64, 'top', '— 단심가, 정몽주가 답했다고 전해지는 노래'),
    (54.2, 58.6, ['1392년 4월, 선죽교'], 60, 'low', None),
]

# ------------------------------------------------------------------ helpers
rng0 = np.random.default_rng(1392)

def smooth(p):
    p = min(max(p, 0.0), 1.0)
    return p * p * (3 - 2 * p)

def fade(t, a, b, fi=0.6, fo=0.6):
    if t < a or t > b:
        return 0.0
    return min(smooth((t - a) / fi) if fi > 0 else 1, smooth((b - t) / fo) if fo > 0 else 1)

def noise1d(n, octaves, seed, base=8):
    r = np.random.default_rng(seed)
    out = np.zeros(n)
    amp, freq = 1.0, base
    for _ in range(octaves):
        pts = r.random(freq + 2)
        x = np.linspace(0, freq, n)
        i = x.astype(int)
        f = x - i
        f = f * f * (3 - 2 * f)
        out += amp * (pts[i] * (1 - f) + pts[i + 1] * f)
        amp *= 0.5
        freq *= 2
    return out / (2 - 2 ** (1 - octaves))

def noise2d(w, h, seed, scales=(6, 12, 24, 48)):
    r = np.random.default_rng(seed)
    acc = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0
    for s in scales:
        small = (r.random((max(2, int(s * h / w) + 2), s + 2)) * 255).astype(np.uint8)
        big = np.asarray(Image.fromarray(small).resize((w, h), Image.BICUBIC), np.float32) / 255
        acc += amp * big
        tot += amp
        amp *= 0.55
    acc /= tot
    return (acc - acc.min()) / (acc.max() - acc.min() + 1e-6)

def vgrad(h, w, top, bot, curve=1.0):
    t = np.linspace(0, 1, h)[:, None, None] ** curve
    top, bot = np.array(top, np.float32), np.array(bot, np.float32)
    return np.broadcast_to(top * (1 - t) + bot * t, (h, w, 3)).copy()

def radial(w, h, cx, cy, r, power=2.0):
    y, x = np.ogrid[:h, :w]
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r
    return np.clip(1 - d, 0, 1) ** power

def to_img(a):
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

def ridge_layer(w, h, base_y, amp, seed, color, blur=0, octaves=6, freq=5):
    n = noise1d(w, octaves, seed, freq)
    ys = base_y - amp * n
    mask = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.polygon([(0, h)] + [(x, ys[x]) for x in range(0, w, 3)] + [(w - 1, ys[-1]), (w, h)], fill=255)
    if blur:
        mask = mask.filter(ImageFilter.GaussianBlur(blur))
    return mask, color

def comp(base, mask, color, alpha=1.0):
    m = np.asarray(mask, np.float32)[..., None] / 255 * alpha
    return base * (1 - m) + np.array(color, np.float32) * m

def person(d, x, y, s, color, facing=1, step=0.0):
    """갓 쓴 선비 실루엣. (x,y)=발끝 중앙, s=키(px)."""
    f = facing
    head_r = s * 0.065
    hy = y - s * 0.86
    # 도포
    sw = math.sin(step) * s * 0.03
    d.polygon([(x - s * 0.10, hy + head_r * 1.6), (x + s * 0.10, hy + head_r * 1.6),
               (x + s * 0.20 + sw, y), (x - s * 0.20 - sw, y)], fill=color)
    # 소매
    d.polygon([(x - s * 0.11, hy + head_r * 2.2), (x - s * 0.24, y - s * 0.40),
               (x - s * 0.15, y - s * 0.36), (x - s * 0.05, hy + head_r * 3)], fill=color)
    d.polygon([(x + s * 0.11, hy + head_r * 2.2), (x + s * 0.24, y - s * 0.40),
               (x + s * 0.15, y - s * 0.36), (x + s * 0.05, hy + head_r * 3)], fill=color)
    # 목, 머리
    d.rectangle([x - head_r * 0.45, hy, x + head_r * 0.45, hy + head_r * 2], fill=color)
    d.ellipse([x - head_r + f * head_r * 0.15, hy - head_r, x + head_r + f * head_r * 0.15, hy + head_r], fill=color)
    # 갓
    by = hy - head_r * 0.55
    d.ellipse([x - s * 0.16, by - s * 0.012, x + s * 0.16, by + s * 0.014], fill=color)
    d.polygon([(x - head_r * 0.75, by), (x - head_r * 0.6, by - head_r * 1.5),
               (x + head_r * 0.6, by - head_r * 1.5), (x + head_r * 0.75, by)], fill=color)

def soldier(d, x, y, s, color, flag=None, phase=0.0):
    person(d, x, y, s, color)
    d.line([(x + s * 0.2, y), (x + s * 0.26, y - s * 1.35)], fill=color, width=max(2, int(s * 0.02)))
    if flag is not None:
        px, py = x + s * 0.26, y - s * 1.35
        pts = []
        for k in range(12):
            u = k / 11
            pts.append((px + u * s * 0.5, py + s * 0.02 + math.sin(phase + u * 4) * s * 0.04 * u))
        bot = [(px2, py2 + s * 0.28) for (px2, py2) in reversed(pts)]
        d.polygon(pts + bot, fill=flag)

# ------------------------------------------------------------------ text
_font_cache = {}
def font(path, size):
    k = (path, size)
    if k not in _font_cache:
        _font_cache[k] = ImageFont.truetype(path, size)
    return _font_cache[k]

_text_cache = {}
def text_img(lines, size, color=(236, 228, 210), path=F_SERIF, spacing=1.35, tracking=0.04):
    key = (tuple(lines), size, color, path, tracking)
    if key in _text_cache:
        return _text_cache[key]
    f = font(path, size)
    tr = size * tracking
    widths = []
    for ln in lines:
        widths.append(sum(f.getlength(c) for c in ln) + tr * (len(ln) - 1))
    tw = int(max(widths) + size)
    th = int(size * spacing * len(lines) + size * 0.6)
    img = Image.new('RGBA', (tw, th), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i, ln in enumerate(lines):
        x = (tw - widths[i]) / 2
        y = size * 0.3 + i * size * spacing
        for c in ln:
            d.text((x, y), c, font=f, fill=color + (255,))
            x += f.getlength(c) + tr
    glow = img.filter(ImageFilter.GaussianBlur(size * 0.18))
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    g = np.asarray(glow).copy(); g[..., 3] = (g[..., 3] * 0.55).astype(np.uint8)
    out = Image.alpha_composite(out, Image.fromarray(g))
    out = Image.alpha_composite(out, img)
    _text_cache[key] = out
    return out

def paste_text(frame, timg, cx, cy, alpha, scale=1.0):
    if alpha <= 0.003:
        return
    im = timg
    if abs(scale - 1) > 1e-3:
        im = im.resize((int(im.width * scale), int(im.height * scale)), Image.BICUBIC)
    a = np.asarray(im, np.float32)
    x0, y0 = int(cx - im.width / 2), int(cy - im.height / 2)
    x1, y1 = max(0, x0), max(0, y0)
    x2, y2 = min(W, x0 + im.width), min(H, y0 + im.height)
    if x2 <= x1 or y2 <= y1:
        return
    sub = a[y1 - y0:y2 - y0, x1 - x0:x2 - x0]
    m = sub[..., 3:4] / 255 * alpha
    frame[y1:y2, x1:x2] = frame[y1:y2, x1:x2] * (1 - m) + sub[..., :3] * m

# ------------------------------------------------------------------ static assets (per worker)
A = {}

def build_assets():
    BW, BH = int(W * 1.12), int(H * 1.12)
    A['BW'], A['BH'] = BW, BH
    # 산수
    bg = vgrad(BH, BW, (22, 30, 44), (118, 128, 132), 0.9)
    bg += 120 * radial(BW, BH, BW * 0.68, BH * 0.30, BH * 0.10, 0.6)[..., None] * np.array([1.0, 0.95, 0.85])
    bg += 60 * radial(BW, BH, BW * 0.68, BH * 0.30, BH * 0.55, 2.0)[..., None]
    for k, (by, amp, col, bl) in enumerate([(0.55, 0.30, (78, 88, 98), 6), (0.66, 0.26, (58, 66, 76), 4),
                                             (0.77, 0.24, (38, 44, 52), 2), (0.88, 0.22, (22, 26, 32), 1),
                                             (1.0, 0.18, (10, 12, 15), 0)]):
        m, c = ridge_layer(BW, BH, BH * by, BH * amp, 100 + k, col, bl, freq=3 + k)
        bg = comp(bg, m, c)
        mist = np.clip((np.linspace(0, 1, BH) - (by - 0.12)) / 0.12, 0, 1) * np.clip(((by + 0.02) - np.linspace(0, 1, BH)) / 0.06, 0, 1)
        bg = bg * (1 - 0.35 * mist[:, None, None]) + 160 * 0.35 * mist[:, None, None]
    A['mountains'] = bg.astype(np.float32)
    A['mist'] = noise2d(W * 2, H, 7)
    # 바다 (하늘만 정적)
    sky = vgrad(BH, BW, (8, 14, 26), (40, 52, 68), 1.2)
    sky += 200 * radial(BW, BH, BW * 0.30, BH * 0.22, BH * 0.06, 0.4)[..., None]
    sky += 50 * radial(BW, BH, BW * 0.30, BH * 0.22, BH * 0.5, 2.2)[..., None] * np.array([0.8, 0.9, 1.0])
    stars = rng0.random((BH, BW)) > 0.9993
    sky[stars] += 120
    A['sea_sky'] = sky.astype(np.float32)
    # 군대 하늘
    sky2 = vgrad(BH, BW, (40, 14, 10), (190, 80, 30), 1.4)
    sky2 += 90 * radial(BW, BH, BW * 0.5, BH * 0.62, BH * 0.7, 1.5)[..., None] * np.array([1.0, 0.6, 0.25])
    m, c = ridge_layer(BW, BH, BH * 0.62, BH * 0.18, 300, (60, 22, 14), 3, freq=3)
    sky2 = comp(sky2, m, c)
    A['army_sky'] = sky2.astype(np.float32)
    A['dust'] = noise2d(W * 2, H, 11, (4, 8, 16, 32))
    # 두 사람 방 (창호 역광)
    room = vgrad(H, W, (10, 9, 8), (18, 15, 12))
    win = np.zeros((H, W), np.float32)
    win[BAR + 40:H - BAR - 330, W // 2 - 260:W // 2 + 260] = 1
    win = np.asarray(Image.fromarray((win * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(30)), np.float32) / 255
    lattice = np.ones((H, W), np.float32)
    for x in range(W // 2 - 260, W // 2 + 261, 104):
        lattice[:, x - 4:x + 4] = 0.15
    for y in range(BAR + 40, H - BAR - 329, 87):
        lattice[y - 4:y + 4, :] = 0.15
    room += (win * lattice)[..., None] * np.array([150, 115, 75], np.float32)
    room += 70 * radial(W, H, W / 2, H * 0.45, H * 0.8, 2)[..., None] * np.array([1, 0.7, 0.4])
    A['room'] = room.astype(np.float32)
    # 다리
    sky3 = vgrad(BH, BW, (12, 16, 22), (34, 40, 48), 1.0)
    m, c = ridge_layer(BW, BH, BH * 0.52, BH * 0.10, 500, (20, 24, 30), 4, freq=4)
    sky3 = comp(sky3, m, c)
    water_top = int(BH * 0.62)
    wt = vgrad(BH - water_top, BW, (26, 32, 40), (8, 10, 14))
    sky3[water_top:] = wt
    A['bridge_bg'] = sky3.astype(np.float32)
    A['water_top'] = water_top
    # 비닐 그레인 & 비네트
    A['vig'] = (0.35 + 0.65 * (1 - radial(W, H, W / 2, H / 2, W * 0.75, 1.0)[...] * 0) * 1).astype(np.float32)
    y, x = np.ogrid[:H, :W]
    d = np.sqrt(((x - W / 2) / (W / 2)) ** 2 + ((y - H / 2) / (H / 2)) ** 2)
    A['vig'] = np.clip(1.05 - 0.45 * d ** 2.2, 0.25, 1)[..., None].astype(np.float32)
    A['grain'] = [rng0.normal(0, 7, (H, W, 1)).astype(np.float32) for _ in range(6)]
    # 잉크 번짐
    A['ink'] = noise2d(W, H, 21, (3, 6, 12, 24, 48))
    # 빗줄기
    r = np.random.default_rng(9)
    A['rain'] = r.random((400, 3)) * np.array([W, H, 1])

def kenburns(img, p, z0=1.0, z1=1.08, dx=0.0, dy=0.0):
    BW, BH = img.shape[1], img.shape[0]
    z = z0 + (z1 - z0) * p
    cw, ch = W / z * (BW / (W * 1.12)), H / z * (BH / (H * 1.12))
    cw, ch = min(cw, BW), min(ch, BH)
    cx = BW / 2 + dx * (BW - cw) / 2 * (2 * p - 1)
    cy = BH / 2 + dy * (BH - ch) / 2 * (2 * p - 1)
    x0, y0 = int(cx - cw / 2), int(cy - ch / 2)
    crop = img[y0:y0 + int(ch), x0:x0 + int(cw)]
    return np.asarray(to_img(crop).resize((W, H), Image.BILINEAR), np.float32)

# ------------------------------------------------------------------ scenes
def sc_mountains(t, p):
    f = kenburns(A['mountains'], p, 1.0, 1.10, dx=0.3)
    off = int(t * 40) % W
    mist = A['mist'][:, off:off + W]
    m = np.clip((mist - 0.45) * 2.2, 0, 1) * np.linspace(0.2, 0.9, H)[:, None]
    f = f * (1 - 0.5 * m[..., None]) + 175 * 0.5 * m[..., None]
    # 학 한 마리
    img = to_img(f); d = ImageDraw.Draw(img)
    bx, by = W * (0.2 + 0.5 * p), H * (0.32 - 0.05 * p)
    wing = math.sin(t * 5) * 14
    d.line([(bx - 34, by - wing), (bx, by), (bx + 34, by - wing)], fill=(20, 22, 26), width=5)
    return np.asarray(img, np.float32)

def sc_sea(t, p):
    f = kenburns(A['sea_sky'], p, 1.02, 1.08)
    img = to_img(f); d = ImageDraw.Draw(img)
    horizon = H * 0.55
    # 달빛 반사
    for k in range(40):
        y = horizon + k * 9
        w = 30 + k * 6 + 20 * math.sin(t * 3 + k)
        d.line([(W * 0.30 - w + 40 * math.sin(k + t), y), (W * 0.30 + w, y)], fill=(150, 160, 170), width=2)
    boat_drawn = False
    for k in range(7):
        y0 = horizon + k * k * 9 + k * 12
        amp = 6 + k * 6
        col = (int(14 + k * 3), int(22 + k * 3), int(34 + k * 3))
        pts = [(x, y0 + amp * math.sin(x / (160 - k * 12) + t * (1.2 + k * 0.25) + k)
                + amp * 0.4 * math.sin(x / 47 + t * 2.1 + k * 2)) for x in range(0, W + 20, 20)]
        if k == 4 and not boat_drawn:
            bx = W * (0.58 + 0.06 * p)
            by = y0 + amp * math.sin(bx / (160 - k * 12) + t * (1.2 + k * 0.25) + k) - 4
            tilt = math.cos(bx / (160 - k * 12) + t * (1.2 + k * 0.25) + k) * 0.12
            c, s = math.cos(tilt), math.sin(tilt)
            def R(px, py): return (bx + px * c - py * s, by + px * s + py * c)
            d.polygon([R(-150, -10), R(150, -10), R(110, 30), R(-110, 30)], fill=(6, 8, 12))
            d.line([R(0, -10), R(0, -230)], fill=(6, 8, 12), width=6)
            d.polygon([R(6, -220), R(110, -200), R(100, -40), R(6, -30)], fill=(30, 30, 34))
            person(d, *R(-60, -8), 70, (6, 8, 12))
            boat_drawn = True
        d.polygon(pts + [(W, H), (0, H)], fill=col)
        # 물마루 하이라이트
        d.line(pts, fill=(col[0] + 40, col[1] + 45, col[2] + 50), width=2)
    return np.asarray(img, np.float32)

def sc_army(t, p):
    f = kenburns(A['army_sky'], p, 1.0, 1.06, dx=-0.6)
    img = to_img(f); d = ImageDraw.Draw(img)
    shift = -p * 120
    r = np.random.default_rng(55)
    for row, (yy, sz, col) in enumerate([(0.70, 70, (40, 14, 10)), (0.80, 110, (24, 8, 6)), (0.95, 170, (10, 4, 3))]):
        n = int(W / (sz * 0.55)) + 4
        for i in range(n):
            x = i * sz * 0.55 + r.random() * 20 + shift * (row + 1) - 60
            y = H * yy + r.random() * 10
            flag = (110, 16, 12) if r.random() < 0.12 else None
            soldier(d, x, y, sz, col, flag, t * 4 + i)
    # 말 탄 장수 실루엣 (중앙)
    cx, cy = W * 0.52 + shift * 0.5, H * 0.78
    d.ellipse([cx - 120, cy - 90, cx + 110, cy - 10], fill=(14, 5, 4))
    d.polygon([(cx + 90, cy - 80), (cx + 170, cy - 170), (cx + 200, cy - 150), (cx + 120, cy - 50)], fill=(14, 5, 4))
    for lx in (-90, -50, 50, 90):
        d.line([(cx + lx, cy - 30), (cx + lx + 10 * math.sin(t * 3 + lx), cy + 70)], fill=(14, 5, 4), width=12)
    person(d, cx - 10, cy - 70, 170, (14, 5, 4))
    soldier(d, cx - 10, cy - 70, 170, (14, 5, 4), (170, 24, 18), t * 4)
    f = np.asarray(img, np.float32)
    off = int(t * 90) % W
    dust = A['dust'][:, off:off + W]
    m = np.clip((dust - 0.4) * 1.8, 0, 1)[..., None] * 0.45
    return f * (1 - m) + np.array([200, 110, 60]) * m

def sc_two(t, p):
    f = A['room'].copy()
    z = 1 + 0.06 * p
    img = to_img(f)
    if z != 1:
        cw, ch = int(W / z), int(H / z)
        img = img.crop(((W - cw) // 2, (H - ch) // 2, (W + cw) // 2, (H + ch) // 2)).resize((W, H), Image.BILINEAR)
    d = ImageDraw.Draw(img)
    # 상
    d.rectangle([W * 0.30, H * 0.70, W * 0.70, H * 0.74], fill=(5, 4, 3))
    d.polygon([(W * 0.47, H * 0.70), (W * 0.53, H * 0.70), (W * 0.52, H * 0.66), (W * 0.48, H * 0.66)], fill=(5, 4, 3))
    person(d, W * 0.27, H - BAR + 40, 600, (4, 3, 3), facing=1)
    person(d, W * 0.73, H - BAR + 40, 600, (4, 3, 3), facing=-1)
    f = np.asarray(img, np.float32)
    # 떠다니는 먼지
    r = np.random.default_rng(3)
    pts = r.random((60, 3))
    for (a, b, c) in pts:
        x = int((a * W + t * 15 * (c - 0.5) * 4) % W); y = int((b * H - t * 10 * c) % H)
        f[max(0, y - 2):y + 2, max(0, x - 2):x + 2] += 90 * c
    return f

def sc_candle(t, p):
    f = np.zeros((H, W, 3), np.float32) + 6
    cx, cy = W * 0.5, H * 0.64
    fl = 1 + 0.06 * math.sin(t * 13) + 0.04 * math.sin(t * 31 + 1)
    f += 150 * fl * radial(W, H, cx, cy - 60, H * 0.75, 2.3)[..., None] * np.array([1, 0.6, 0.28])
    img = to_img(f); d = ImageDraw.Draw(img)
    d.rectangle([cx - 28, cy, cx + 28, cy + 280], fill=(210, 190, 160))
    d.rectangle([cx - 28, cy, cx - 10, cy + 280], fill=(170, 150, 125))
    d.rectangle([cx - 80, cy + 280, cx + 80, cy + 300], fill=(30, 22, 16))
    sway = 6 * math.sin(t * 7) + 3 * math.sin(t * 17)
    flame = Image.new('L', (W, H), 0); fd = ImageDraw.Draw(flame)
    fd.ellipse([cx - 22 + sway * 0.3, cy - 120 * fl, cx + 22 + sway * 0.3, cy - 8], fill=200)
    fd.ellipse([cx - 14 + sway, cy - 150 * fl, cx + 14 + sway, cy - 60], fill=160)
    flame = flame.filter(ImageFilter.GaussianBlur(9))
    f = np.asarray(img, np.float32)
    m = np.asarray(flame, np.float32)[..., None] / 255
    f = f * (1 - m) + np.array([255, 214, 140]) * m
    core = radial(W, H, cx, cy - 40, 26, 1.2)[..., None]
    f = f * (1 - core) + 255 * core
    d.line
    # 심지
    f[int(cy - 30):int(cy), int(cx - 2):int(cx + 2)] = 30
    # 천천히 밀어들기
    z = 1 + 0.10 * p
    return np.asarray(to_img(f).crop((int(W * (1 - 1 / z) / 2), int(H * (1 - 1 / z) / 2),
                                      int(W * (1 + 1 / z) / 2), int(H * (1 + 1 / z) / 2))).resize((W, H)), np.float32)

def sc_bridge(t, p):
    f = kenburns(A['bridge_bg'], p, 1.0, 1.05)
    img = to_img(f); d = ImageDraw.Draw(img)
    wy = H * 0.60
    deck = wy - 70
    col = (6, 7, 9)
    d.rectangle([W * 0.15, deck, W * 0.85, deck + 32], fill=col)
    for px in np.linspace(W * 0.2, W * 0.8, 5):
        d.rectangle([px - 22, deck + 32, px + 22, wy + 10], fill=col)
    for px in np.linspace(W * 0.17, W * 0.83, 9):
        d.rectangle([px - 6, deck - 40, px + 6, deck], fill=col)
    d.line([(W * 0.17, deck - 34), (W * 0.83, deck - 34)], fill=col, width=6)
    # 수면 반사
    for k in range(18):
        y = wy + 20 + k * 14
        sh = 12 * math.sin(t * 2 + k)
        d.line([(W * 0.18 + sh, y), (W * 0.82 + sh, y)], fill=(14 + k, 16 + k, 20 + k), width=3)
    # 걸어가는 사람
    walk = min(p / 0.85, 1)
    x = W * (0.25 + 0.38 * walk)
    person(d, x, deck, 190, (3, 3, 4), facing=1, step=t * 6 if walk < 1 else 0)
    f = np.asarray(img, np.float32)
    # 끝부분 붉은 잉크가 물에 번진다
    if p > 0.72:
        q = smooth((p - 0.72) / 0.28)
        ink = A['ink']
        reach = radial(W, H, x, wy + 60, W * (0.05 + 0.5 * q), 0.8)
        m = np.clip((ink * 0.6 + reach * 1.2 - 0.85) * 3, 0, 1)
        m *= np.clip((np.arange(H) - wy) / 40, 0, 1)[:, None]
        m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(14)), np.float32) / 255
        f = f * (1 - 0.8 * m[..., None]) + np.array([120, 6, 8]) * 0.8 * m[..., None]
    # 비
    rimg = Image.new('L', (W, H), 0); rd = ImageDraw.Draw(rimg)
    for (rx, ry, rs) in A['rain']:
        y = (ry + t * (1400 + 600 * rs)) % H
        xx = (rx - (y - ry) * 0.12) % W
        rd.line([(xx, y), (xx - 6, y + 40 + 30 * rs)], fill=int(60 + 90 * rs), width=2)
    rm = np.asarray(rimg, np.float32)[..., None] / 255
    return f * (1 - rm * 0.6) + 190 * rm * 0.6

def sc_title(t, lt):
    f = np.zeros((H, W, 3), np.float32) + 4
    # 먹 번짐
    q = smooth(lt / 2.2)
    ink = A['ink']
    reach = radial(W, H, W / 2, H * 0.46, W * (0.1 + 0.4 * q), 0.7)
    m = np.clip((ink * 0.7 + reach * 1.3 - 0.95) * 2.5, 0, 1)[..., None]
    f = f * (1 - m * 0.9) + np.array([92, 8, 10]) * m * 0.9
    a = smooth((lt - 0.15) / 1.2)
    sc = 1.10 - 0.08 * smooth(lt / 6.0)
    paste_text(f, text_img(['단심'], 230, (246, 240, 228), tracking=0.35), W / 2, H * 0.43, a, sc)
    paste_text(f, text_img(['丹心'], 46, (200, 60, 50), path=F_HANJA, tracking=0.8), W / 2, H * 0.60, smooth((lt - 1.0) / 1.0) * 0.9)
    paste_text(f, text_img(['정몽주, 무너지는 나라 끝에서 충절을 택하다'], 38, (210, 200, 185), path=F_SANS, tracking=0.12),
               W / 2, H * 0.69, smooth((lt - 1.8) / 1.0))
    # 낙관
    sa = smooth((lt - 2.6) / 0.5)
    if sa > 0:
        seal = Image.new('RGBA', (100, 100), (0, 0, 0, 0)); sd = ImageDraw.Draw(seal)
        sd.rectangle([4, 4, 96, 96], fill=(170, 30, 26, 255))
        sd.text((50, 52), '圃隱', font=font(F_HANJA, 34), fill=(246, 230, 210, 255), anchor='mm')
        paste_text(f, seal, W / 2 + 330, H * 0.36, sa, 1.0 + 0.4 * (1 - sa))
    return f

def sc_end(t, lt):
    f = np.zeros((H, W, 3), np.float32) + 4
    paste_text(f, text_img(['곧, 여러분의 강의실에서'], 64), W / 2, H * 0.45, fade(lt, 0.2, 4.5, 0.8, 1.2))
    paste_text(f, text_img(['참고 : 『고려사』 열전 「정몽주」 · 한국민족문화대백과사전'], 26, (150, 145, 135), path=F_SANS, tracking=0.05),
               W / 2, H * 0.62, fade(lt, 0.8, 4.5, 0.8, 1.2) * 0.9)
    return f

SCENES = dict(mountains=sc_mountains, sea=sc_sea, army=sc_army, two=sc_two, candle=sc_candle, bridge=sc_bridge)

def scene_at(t):
    for seg in TL:
        if seg[0] <= t < seg[1]:
            return seg
    return TL[-1]

def render(fi):
    t = fi / FPS
    a, b, kind, prm = scene_at(t)
    lt, dur = t - a, b - a
    p = lt / dur
    if kind in SCENES:
        f = SCENES[kind](t, p)
        # 장면 들어오고 나가는 페이드
        f *= min(smooth(lt / 0.5), smooth((b - t) / 0.45))
    elif kind == 'flash':
        f = SCENES[prm['src']](t, 0.9)
        f = f * np.array([1.5, 0.55, 0.5]) + 30
        f *= 1.0 if lt < 0.25 else 0.4
    elif kind == 'card':
        f = np.zeros((H, W, 3), np.float32) + 4
        col = (214, 70, 58) if prm.get('red') else (236, 228, 210)
        timg = text_img(prm['lines'], prm['size'], col)
        al = fade(lt, prm['at'], dur - 0.05, 0.35 if prm['size'] >= 100 else 0.7, 0.35 if dur < 2 else 0.6)
        sc = 1.0 + 0.05 * (1 - p) if prm['size'] < 100 else 1.12 - 0.12 * smooth(lt / 0.25)
        paste_text(f, timg, W / 2, H / 2, al, sc)
    elif kind == 'title':
        f = sc_title(t, lt)
        f *= smooth((b - t) / 0.6)
    elif kind == 'end':
        f = sc_end(t, lt)
    else:
        f = np.zeros((H, W, 3), np.float32) + 2
    for (ca, cb, lines, size, pos, small) in CAPTIONS:
        if ca <= t <= cb:
            al = fade(t, ca, cb, 0.7, 0.6)
            cy = {'low': H - BAR - 120, 'low2': H - BAR - 165, 'top': BAR + 150}.get(pos, H * 0.5)
            nudge = 6 * (1 - smooth((t - ca) / 1.5))
            paste_text(f, text_img(lines, size), W / 2, cy + nudge, al)
            if small:
                paste_text(f, text_img([small], 28, (190, 180, 160), path=F_SANS, tracking=0.05),
                           W / 2, cy + size * len(lines) * 0.75 + 40, al * 0.9)
    # 그레이딩: 살짝 청록-호박 분리, 비네트, 그레인, 레터박스
    lum = f.mean(axis=2, keepdims=True)
    f = f + (lum < 90) * np.array([-4, 2, 6]) + (lum >= 90) * np.array([6, 2, -6])
    f = f * A['vig'] + A['grain'][fi % 6]
    f[:BAR] = 0; f[H - BAR:] = 0
    return np.clip(f, 0, 255).astype(np.uint8).tobytes()

# ------------------------------------------------------------------ audio
def env_exp(n, tau):
    return np.exp(-np.arange(n) / (tau * SR))

def lowpass(x, cutoff):
    a = math.exp(-2 * math.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    # 블록 처리 (scipy 없이 벡터화된 IIR 근사): 1차 IIR 3번
    from numpy.lib.stride_tricks import sliding_window_view  # noqa
    for _ in range(2):
        acc = 0.0
        out = np.empty_like(x)
        b = 1 - a
        # 루프는 느리므로 lfilter 대용: 주파수 영역 처리
        X = np.fft.rfft(x)
        fr = np.fft.rfftfreq(len(x), 1 / SR)
        H_ = 1 / (1 + 1j * fr / cutoff)
        x = np.fft.irfft(X * H_, len(x))
        out = x
    return out

def saw(freq, n, detune=0.0, phase=0.0):
    t = np.arange(n) / SR
    return 2 * ((t * freq * (1 + detune) + phase) % 1) - 1

def reverb(x, secs=2.8, mix=0.35, seed=5):
    r = np.random.default_rng(seed)
    n = int(secs * SR)
    ir = r.normal(0, 1, n) * np.exp(-np.arange(n) / (secs / 6.9 * SR))
    ir[:int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))
    ir /= np.sqrt((ir ** 2).sum())
    L = len(x) + n
    nfft = 1 << (L - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft), nfft)[:len(x)]
    return x * (1 - mix) + y * mix * 1.4

def boom(dur=3.0, f0=90, f1=34, gain=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    fr = f1 + (f0 - f1) * np.exp(-t * 9)
    ph = 2 * np.pi * np.cumsum(fr) / SR
    s = np.sin(ph) * env_exp(n, 0.55)
    click = np.random.default_rng(1).normal(0, 1, n) * env_exp(n, 0.012)
    return gain * (s + 0.35 * lowpass(click, 2500))

def braam(dur=2.4, root=73.42, gain=1.0):
    n = int(dur * SR)
    s = np.zeros(n)
    for mult, g in [(1, 1.0), (1.5, 0.6), (2, 0.7), (1.189, 0.35)]:
        for dt in (-0.006, 0, 0.007):
            s += g * saw(root * mult, n, dt, np.random.random())
    t = np.arange(n) / SR
    att = np.clip(t / 0.06, 0, 1)
    e = att * np.exp(-t / (dur * 0.45))
    s = lowpass(s * e, 900) * 0.18
    bm = boom(min(dur, 3), 70, 30)
    s[:len(bm)] += 0.6 * bm
    return gain * s

def riser(dur, gain=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    nz = np.random.default_rng(8).normal(0, 1, n)
    out = np.zeros(n)
    # 구간별로 밝아지는 노이즈
    seg = 8
    for k in range(seg):
        a, b = k * n // seg, (k + 1) * n // seg
        out[a:b] = lowpass(nz[a:b], 300 + 5000 * (k / seg) ** 2)
    fr = 110 * 2 ** (3 * t / dur)
    tone = np.sin(2 * np.pi * np.cumsum(fr) / SR) * 0.3
    return gain * (out * 0.6 + tone) * (t / dur) ** 2

def pluck(freq, dur=2.5, gain=1.0):
    """카플러스-스트롱 — 가야금 느낌의 뜯는 소리."""
    n = int(dur * SR)
    p = int(SR / freq)
    buf = np.random.default_rng(int(freq)).uniform(-1, 1, p)
    out = np.zeros(n)
    for i in range(0, n, p):
        k = min(p, n - i)
        out[i:i + k] = buf[:k]
        buf = 0.497 * (buf + np.roll(buf, -1))
    t = np.arange(n) / SR
    bend = 1 + 0.0  # 단순화
    return gain * out * np.exp(-t / 1.4) * bend

def heartbeat(gain=1.0):
    n = int(0.9 * SR)
    s = np.zeros(n)
    for off, g in [(0, 1.0), (0.22, 0.7)]:
        b = boom(0.5, 60, 38, g)
        i = int(off * SR)
        s[i:i + len(b)] += b[:n - i]
    return gain * s

def add(track, sig, at, gain=1.0):
    i = int(at * SR)
    if i >= len(track):
        return
    k = min(len(sig), len(track) - i)
    track[i:i + k] += sig[:k] * gain

def build_audio(path):
    n = int((TOTAL + 0.5) * SR)
    mus = np.zeros(n)
    t = np.arange(n) / SR
    # 저음 드론 (D) — 구간별 볼륨
    drone = 0.5 * np.sin(2 * np.pi * 36.71 * t) + 0.25 * lowpass(saw(73.42, n, 0.003) + saw(73.42, n, -0.004), 220)
    dvol = np.interp(t, [0, 3, 11, 22, 33, 47, 53, 59.3, 59.4, 61, 67, 72, TOTAL + 0.5],
                     [0, 0.25, 0.4, 0.55, 0.5, 0.6, 0.9, 1.0, 0, 0.7, 0.4, 0.25, 0])
    mus += drone * dvol * 0.5
    # 가야금 선율 (D 단조 오음계)
    scale = [146.83, 174.61, 196.0, 220.0, 261.63, 293.66, 349.23]
    melody = [(0.4, 5), (1.3, 3), (2.0, 4), (3.2, 2), (5.0, 3), (6.0, 1), (6.6, 2), (8.0, 0),
              (14.2, 5), (15.0, 4), (16.4, 3), (18.0, 2), (20.2, 1), (33.8, 4), (35.6, 3), (37.4, 1),
              (41.0, 0), (42.6, 2), (44.4, 1), (46.0, 0), (67.8, 2), (69.2, 1), (71.6, 0)]
    for at, k in melody:
        add(mus, pluck(scale[k], 3.0), at, 0.5)
        add(mus, pluck(scale[k] / 2, 3.0), at + 0.02, 0.25)
    # 현악 오스티나토 (22.5~53) — 16분음표, 점점 커짐
    bpm = 120; step = 60 / bpm / 4
    pattern = [73.42, 73.42, 110.0, 73.42, 87.31, 73.42, 110.0, 98.0]
    k = 0
    tt = 22.5
    while tt < 59.3:
        if 33.5 <= tt < 40.5:
            tt += step; k += 1; continue           # 대화 장면은 숨 고르기
        fr = pattern[k % len(pattern)] * (2 if tt > 47.5 else 1)
        nn = int(step * SR * 0.95)
        note = lowpass(saw(fr, nn) + saw(fr * 2, nn, 0.004) * 0.5, 1400) * np.exp(-np.arange(nn) / (0.09 * SR))
        g = 0.10 + 0.25 * (tt - 22.5) / 37
        add(mus, note, tt, g)
        tt += step; k += 1
    # 타악 & 브람
    for at in [11.0, 20.0]:
        add(mus, boom(3.0), at, 0.9)
    for at in [22.5, 24.5, 26.5]:
        add(mus, boom(1.2, 120, 50), at, 0.5)
    add(mus, braam(2.6), 28.5, 1.0)
    add(mus, braam(2.6, 65.41), 31.0, 1.1)
    add(mus, boom(4.0), 33.5, 0.6)
    add(mus, boom(3.0), 40.5, 0.6)
    for i, at in enumerate([47.5, 48.95, 50.4, 51.85]):
        add(mus, braam(1.6, [73.42, 69.3, 65.41, 61.74][i]), at, 1.0 + 0.1 * i)
    for at in np.arange(53.0, 59.3, 0.5):
        add(mus, boom(0.6, 140, 60), at, 0.35 + 0.4 * (at - 53) / 6)
    add(mus, riser(6.2), 53.1, 0.55)
    # 침묵 후 심장 소리, 타이틀 히트
    add(mus, heartbeat(), 59.6, 0.9)
    add(mus, heartbeat(), 60.25, 0.9)
    add(mus, braam(5.0, 36.71), 61.0, 1.3)
    add(mus, boom(5.0, 70, 26), 61.0, 1.0)
    # 효과음: 파도 / 군중 먼지 / 비
    nz = np.random.default_rng(77).normal(0, 1, n)
    sea = lowpass(nz, 500) * (0.6 + 0.4 * np.sin(2 * np.pi * t / 3.2)) * np.interp(t, [13.8, 14.3, 19.6, 20.0], [0, 1, 1, 0])
    rain = lowpass(nz, 6000) * 0.25 * np.interp(t, [52.8, 53.4, 59.3, 59.4], [0, 1, 1, 0])
    wind = lowpass(nz, 260) * np.interp(t, [3.8, 5, 10.6, 11.0, 22.4, 23, 28.2, 28.5], [0, 0.8, 0.8, 0, 0, 0.6, 0.6, 0])
    sfx = sea * 0.35 + rain + wind * 0.5
    # 휙! (장면 플래시)
    for at in [48.6, 50.05, 51.5]:
        sw = riser(0.35) * 2
        add(sfx, sw, at - 0.1, 0.6)
    mix = reverb(mus, 3.0, 0.38) + sfx
    mix[int(59.4 * SR):int(59.55 * SR)] *= np.linspace(1, 0, int(0.15 * SR))[:, ] if False else 1
    # 끝 페이드
    mix *= np.interp(t, [0, 0.1, TOTAL - 2.5, TOTAL], [0, 1, 1, 0])
    # 스테레오 약간 넓게
    R = np.roll(mix, int(0.011 * SR))
    st = np.stack([mix, 0.85 * R + 0.15 * mix], 1)
    st /= np.abs(st).max() + 1e-9
    st *= 0.95
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((st * 32767).astype(np.int16).tobytes())

# ------------------------------------------------------------------ main
def check_glyphs():
    from fontTools.ttLib import TTFont
    cm = TTFont(F_SERIF).getBestCmap()
    txt = ''.join(''.join(s[3].get('lines', [])) for s in TL) + ''.join(''.join(c[2]) for c in CAPTIONS) + '단심곧, 여러분의 강의실에서'
    miss = sorted({c for c in txt if c.strip() and ord(c) not in cm})
    if miss:
        raise SystemExit(f'serif font missing: {miss}')

if __name__ == '__main__':
    import os
    os.makedirs(OUT, exist_ok=True)
    check_glyphs()
    mode = sys.argv[2] if len(sys.argv) > 2 else 'all'
    if mode == 'stills':
        build_assets()
        for ts in [25, 37, 43, 46, 58.8]:
            Image.frombytes('RGB', (W, H), render(int(ts * FPS))).resize((640, 360)).save(f'{OUT}/s_{ts:05.1f}.jpg')
        sys.exit()
    wav = f'{OUT}/audio.wav'
    build_audio(wav)
    print('audio ok', flush=True)
    nframes = int(TOTAL * FPS)
    ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
                           '-r', str(FPS), '-i', '-', '-i', wav,
                           '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
                           '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest',
                           '-movflags', '+faststart', f'{OUT}/jeongmongju_trailer.mp4'], stdin=subprocess.PIPE)
    with Pool(4, initializer=build_assets) as pool:
        for i, fr in enumerate(pool.imap(render, range(nframes), chunksize=8)):
            ff.stdin.write(fr)
            if i % 300 == 0:
                print(f'frame {i}/{nframes}', flush=True)
    ff.stdin.close(); ff.wait()
    print('done', ff.returncode)
