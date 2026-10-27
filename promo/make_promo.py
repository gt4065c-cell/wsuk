#!/usr/bin/env python3
"""
우송대학교 AI경영학과 × WSUK 연수 홍보 영상(9:16 모션그래픽) 제작기
외부 AI 이미지·음성 없이 PIL로 장면을 직접 그리고, 배경음도 직접 합성한다.

  python3 make_promo.py            # → out/wsuk_promo.mp4, out/cover.jpg
"""
import math, subprocess, wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS, SR = 1080, 1920, 30, 48000
ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"
BOLD = str(ROOT / "fonts" / "Pretendard-ExtraBold.otf")
SEMI = str(ROOT / "fonts" / "Pretendard-SemiBold.otf")

NAVY, TEAL, TURQ = (12, 24, 58), (16, 92, 120), (64, 200, 210)
GOLD, WHITE, SOFT = (255, 196, 70), (255, 255, 255), (200, 220, 235)


def font(path, size, _c={}):
    if (path, size) not in _c:
        _c[(path, size)] = ImageFont.truetype(path, size)
    return _c[(path, size)]


def ease(p):
    p = min(max(p, 0.0), 1.0)
    return 1 - (1 - p) ** 3


# ─────────────── 장면 구성: (길이초, 아이콘, [(텍스트, 크기, 색, 굵기, 등장시각)]) ───────────────
SCENES = [
    (4.5, "plane", [("스무 살,", 92, WHITE, BOLD, 0.2),
                    ("첫 해외 캠퍼스는", 92, WHITE, BOLD, 0.6),
                    ("카자흐스탄!", 124, GOLD, BOLD, 1.3)]),
    (5.0, "dome", [("실크로드의 도시", 76, SOFT, SEMI, 0.2),
                   ("투르키스탄", 120, WHITE, BOLD, 0.6),
                   ("우송대 해외 캠퍼스 WSUK", 64, GOLD, BOLD, 1.3)]),
    (5.0, "globe", [("REASON 01", 48, TURQ, BOLD, 0.1),
                    ("글로벌 시야", 112, WHITE, BOLD, 0.4),
                    ("떠오르는 중앙아시아 시장을", 58, SOFT, SEMI, 1.0),
                    ("직접 보고, 느끼고, 배우기", 58, SOFT, SEMI, 1.3)]),
    (5.0, "network", [("REASON 02", 48, TURQ, BOLD, 0.1),
                      ("AI × 경영 실전", 104, WHITE, BOLD, 0.4),
                      ("현지 친구들과 함께", 58, SOFT, SEMI, 1.0),
                      ("AI로 신시장 문제 풀어보기", 58, SOFT, SEMI, 1.3)]),
    (5.0, "friends", [("REASON 03", 48, TURQ, BOLD, 0.1),
                      ("평생 친구", 112, WHITE, BOLD, 0.4),
                      ("게임처럼 신나는 팀 미션,", 58, SOFT, SEMI, 1.0),
                      ("동기들과 쌓는 스무 살의 추억", 58, SOFT, SEMI, 1.3)]),
    (6.5, "star", [("넓은 세상에서", 84, WHITE, BOLD, 0.2),
                   ("친구와 함께", 84, WHITE, BOLD, 0.5),
                   ("꿈을 키우세요", 104, GOLD, BOLD, 0.9),
                   ("지금, 함께 떠나요!", 68, TURQ, BOLD, 2.0)]),
]
XF = 0.45  # 장면 전환 페이드(초)


# ─────────────── 배경 ───────────────
def make_background():
    y = np.linspace(0, 1, H)[:, None]
    top, bot = np.array(NAVY), np.array(TEAL)
    grad = top + (bot - top) * (y ** 1.4)[..., None]
    img = np.repeat(grad, W, axis=1).astype(np.uint8)
    return Image.fromarray(img, "RGB")


rng = np.random.default_rng(7)
STARS = [(rng.uniform(0, W), rng.uniform(0, H), rng.uniform(1.5, 4), rng.uniform(0, 6.28), rng.uniform(8, 25))
         for _ in range(70)]


def draw_stars(d, t):
    for x, y, r, ph, sp in STARS:
        yy = (y - t * sp) % H
        a = int(90 + 80 * math.sin(t * 1.5 + ph))
        d.ellipse([x - r, yy - r, x + r, yy + r], fill=(255, 255, 255, a))


# ─────────────── 아이콘(벡터 일러스트) ───────────────
def icon(d, kind, cx, cy, p, t):
    """p: 등장 진행도 0~1, t: 장면 내 시간"""
    s = 0.6 + 0.4 * ease(p)
    a = int(255 * ease(p))
    if kind == "plane":
        # 점선 궤적 + 비행기
        k = ease(min(1, t / 3.0))
        pts = [(cx - 380 + 760 * u, cy + 120 - 260 * math.sin(math.pi * u * 0.9)) for u in np.linspace(0, k, 40)]
        for i, (x, y) in enumerate(pts[::2]):
            d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(255, 255, 255, 150))
        x, y = pts[-1]
        ang = math.atan2(pts[-1][1] - pts[-2][1], pts[-1][0] - pts[-2][0]) if len(pts) > 1 else 0
        def rot(px, py):
            return (x + px * math.cos(ang) - py * math.sin(ang), y + px * math.sin(ang) + py * math.cos(ang))
        body = [rot(70, 0), rot(-50, -14), rot(-60, 0), rot(-50, 14)]
        wing = [rot(10, 0), rot(-25, -70), rot(-40, -70), rot(-20, 0), rot(-40, 70), rot(-25, 70)]
        d.polygon(wing, fill=GOLD + (a,)); d.polygon(body, fill=WHITE + (a,))
    elif kind == "dome":
        r = 150 * s
        base_y = cy + 150
        d.rectangle([cx - 230 * s, base_y - 140 * s, cx + 230 * s, base_y], fill=(230, 210, 170, a))
        d.rectangle([cx - 70 * s, base_y - 110 * s, cx + 70 * s, base_y], fill=(120, 90, 60, a))
        d.pieslice([cx - r, base_y - 140 * s - r, cx + r, base_y - 140 * s + r], 180, 360, fill=TURQ + (a,))
        d.line([cx, base_y - 140 * s - r, cx, base_y - 140 * s - r - 50 * s], fill=GOLD + (a,), width=8)
        for side in (-1, 1):
            mx = cx + side * 300 * s
            d.rectangle([mx - 22 * s, base_y - 330 * s, mx + 22 * s, base_y], fill=(230, 210, 170, a))
            d.pieslice([mx - 30 * s, base_y - 360 * s, mx + 30 * s, base_y - 300 * s], 180, 360, fill=TURQ + (a,))
        d.line([cx - 420, base_y + 4, cx + 420, base_y + 4], fill=GOLD + (a,), width=6)
    elif kind == "globe":
        r = 200 * s
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=TURQ + (a,), width=8)
        rot = t * 0.6
        for k in range(-2, 3):
            ry = r * math.cos(k * 0.5)
            yy = cy + r * math.sin(k * 0.5)
            d.ellipse([cx - ry, yy - 10, cx + ry, yy + 10], outline=TURQ + (a // 2,), width=4)
        for k in range(4):
            w = abs(r * math.cos(rot + k * math.pi / 4))
            d.ellipse([cx - w, cy - r, cx + w, cy + r], outline=TURQ + (a // 2,), width=4)
        # 한국 → 카자흐스탄 핀
        for (px, py, c) in [(cx + 90 * s, cy - 40 * s, WHITE), (cx - 70 * s, cy - 70 * s, GOLD)]:
            d.ellipse([px - 16, py - 16, px + 16, py + 16], fill=c + (a,))
        d.line([cx + 90 * s, cy - 40 * s, cx - 70 * s, cy - 70 * s], fill=GOLD + (a,), width=5)
    elif kind == "network":
        nodes = [(-220, -80), (-60, -190), (130, -120), (230, 60), (40, 120), (-170, 110), (0, -20)]
        pts = [(cx + x * s, cy + y * s) for x, y in nodes]
        for i in range(len(pts)):
            for j in range(i + 1, len(pts)):
                if (i + j) % 2 == 0 or j == 6:
                    pulse = 0.5 + 0.5 * math.sin(t * 3 + i + j)
                    d.line([pts[i], pts[j]], fill=TURQ + (int(a * (0.3 + 0.5 * pulse)),), width=4)
        for i, (x, y) in enumerate(pts):
            rr = 34 if i == 6 else 20
            d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(GOLD if i == 6 else WHITE) + (a,))
        d.text((pts[6][0], pts[6][1]), "AI", font=font(BOLD, 30), fill=NAVY + (a,), anchor="mm")
    elif kind == "friends":
        cols = [TURQ, GOLD, WHITE, (255, 130, 120)]
        for i, c in enumerate(cols):
            x = cx + (i - 1.5) * 150 * s
            bob = 14 * math.sin(t * 4 + i * 1.2)
            y = cy + bob
            d.ellipse([x - 45 * s, y - 150 * s, x + 45 * s, y - 60 * s], fill=c + (a,))
            d.pieslice([x - 75 * s, y - 40 * s, x + 75 * s, y + 110 * s], 180, 360, fill=c + (a,))
        for k in range(5):
            hx = cx - 260 + k * 130
            hy = cy - 230 - 20 * math.sin(t * 2 + k)
            d.text((hx, hy), "♥" if k % 2 else "★", font=font(SEMI, 44), fill=GOLD + (int(a * 0.8),), anchor="mm")
    elif kind == "star":
        r = 120 * s * (1 + 0.05 * math.sin(t * 3))
        pts = []
        for k in range(10):
            ang = -math.pi / 2 + k * math.pi / 5 + t * 0.3
            rr = r if k % 2 == 0 else r * 0.45
            pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
        d.polygon(pts, fill=GOLD + (a,))


def glow_layer(size):
    return Image.new("RGBA", size, (0, 0, 0, 0))


# ─────────────── 프레임 렌더 ───────────────
def render_scene_frame(bg, si, t, dur):
    _, kind, lines = SCENES[si]
    img = bg.copy().convert("RGBA")
    layer = glow_layer((W, H)); d = ImageDraw.Draw(layer)
    draw_stars(d, t + si * 5)

    # 상단 헤더(인스타 UI 안전 영역)
    hf = font(SEMI, 40); label = "우송대학교 AI경영학과"
    hw = d.textlength(label, font=hf)
    d.text((W / 2, 300), label, font=hf, fill=SOFT + (220,), anchor="mm")
    for side in (-1, 1):
        x0 = W / 2 + side * (hw / 2 + 24)
        d.line([x0, 300, x0 + side * 60, 300], fill=GOLD + (200,), width=3)

    icon(d, kind, W / 2, 720, min(1, t / 0.8), t)

    # 텍스트: 아래에서 올라오며 페이드인
    total_h = sum(sz * 1.35 for _, sz, *_ in lines)
    y = 1250 - total_h / 2 + 60
    for text, sz, col, f, t0 in lines:
        p = ease((t - t0) / 0.6)
        if p > 0:
            dy = (1 - p) * 60
            d.text((W / 2 + 3, y + dy + 4), text, font=font(f, sz), fill=(0, 0, 0, int(110 * p)), anchor="mt")
            d.text((W / 2, y + dy), text, font=font(f, sz), fill=col + (int(255 * p),), anchor="mt")
        y += sz * 1.35

    if si == len(SCENES) - 1:
        p = ease((t - 2.8) / 0.6)
        if p > 0:
            bx0, by0, bx1, by1 = 170, 1660, 910, 1760
            d.rounded_rectangle([bx0, by0, bx1, by1], radius=50, fill=GOLD + (int(240 * p),))
            d.text((W / 2, (by0 + by1) / 2), "WSUK 연수 · 신청은 학과 공지에서",
                   font=font(BOLD, 44), fill=NAVY + (int(255 * p),), anchor="mm")

    img = Image.alpha_composite(img, layer).convert("RGB")
    # 장면 전환 페이드
    fade = min(1, t / XF, (dur - t) / XF) if si not in (0,) else min(1, (dur - t) / XF, t / 0.3)
    if si == len(SCENES) - 1:
        fade = min(1, t / XF, (dur - t) / 0.8)
    if fade < 1:
        img = Image.blend(Image.new("RGB", (W, H), NAVY), img, max(0, fade))
    return img


# ─────────────── 배경음(직접 합성 — 저작권 걱정 없음) ───────────────
def note(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def synth_bgm(total):
    n = int(total * SR); t = np.arange(n) / SR
    out = np.zeros(n, np.float32)
    prog = [[41, 45, 48, 52], [43, 47, 50, 55], [45, 48, 52, 55], [48, 52, 55, 60]]
    beat = 0.5  # 120BPM
    bar = beat * 4
    for b in range(int(math.ceil(total / bar)) + 1):
        chord = prog[b % 4]
        s0 = b * bar
        i0, i1 = int(s0 * SR), min(n, int((s0 + bar + 0.3) * SR))
        if i0 >= n:
            break
        tt = t[i0:i1] - s0
        env = np.minimum(1, tt * 20) * np.exp(-tt * 0.6)
        pad = sum(np.sin(2 * np.pi * note(m) * tt) for m in chord)
        out[i0:i1] += (pad * env * 0.03).astype(np.float32)
        # 베이스
        bass = np.sin(2 * np.pi * note(chord[0] - 12) * tt) * np.exp(-tt * 1.5)
        out[i0:i1] += (bass * 0.12).astype(np.float32)
        # 8분음표 아르페지오
        arp = [chord[0] + 24, chord[2] + 12, chord[1] + 24, chord[3] + 12]
        for k in range(8):
            st = s0 + k * beat / 2
            j0 = int(st * SR)
            if j0 >= n:
                break
            j1 = min(n, j0 + int(0.4 * SR)); tp = t[j0:j1] - st
            f = note(arp[k % 4])
            out[j0:j1] += ((np.sin(2 * np.pi * f * tp) + 0.3 * np.sin(4 * np.pi * f * tp))
                           * np.exp(-tp * 8) * 0.05).astype(np.float32)
        # 킥 + 하이햇
        for k in range(4):
            st = s0 + k * beat
            j0 = int(st * SR)
            if j0 >= n:
                break
            j1 = min(n, j0 + int(0.25 * SR)); tp = t[j0:j1] - st
            kick = np.sin(2 * np.pi * (50 + 90 * np.exp(-tp * 30)) * tp) * np.exp(-tp * 12)
            out[j0:j1] += (kick * 0.22).astype(np.float32)
            h0 = int((st + beat / 2) * SR); h1 = min(n, h0 + int(0.05 * SR))
            if h0 < n:
                out[h0:h1] += (np.random.default_rng(k + b).normal(0, 1, h1 - h0)
                               * np.exp(-np.arange(h1 - h0) / SR * 80) * 0.03).astype(np.float32)
    fi, fo = int(0.5 * SR), int(1.5 * SR)
    out[:fi] *= np.linspace(0, 1, fi); out[-fo:] *= np.linspace(1, 0, fo)
    return out


def write_wav(path, x):
    x = np.clip(x / max(1e-6, np.abs(x).max()) * 0.9, -1, 1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


def main():
    OUT.mkdir(exist_ok=True)
    total = sum(s[0] for s in SCENES)
    wav = OUT / "bgm.wav"
    write_wav(wav, synth_bgm(total))

    bg = make_background()
    mp4 = OUT / "wsuk_promo.mp4"
    ff = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
         "-i", "-", "-i", str(wav), "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-ar", str(SR), "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
         "-movflags", "+faststart", "-shortest", str(mp4)], stdin=subprocess.PIPE)
    snaps = []
    for si, (dur, *_) in enumerate(SCENES):
        nf = int(round(dur * FPS))
        for f in range(nf):
            t = f / FPS
            frame = render_scene_frame(bg, si, t, dur)
            ff.stdin.write(frame.tobytes())
            if f == int(nf * 0.75):
                snaps.append(frame.resize((270, 480)))
                if si == len(SCENES) - 1:
                    frame.save(OUT / "cover.jpg", quality=92)
    ff.stdin.close(); ff.wait()

    sheet = Image.new("RGB", (270 * len(snaps), 480))
    for i, s in enumerate(snaps):
        sheet.paste(s, (270 * i, 0))
    sheet.save(OUT / "contact_sheet.jpg", quality=85)
    wav.unlink()
    print(f"완료: {mp4} ({total:.1f}초)")


if __name__ == "__main__":
    main()
