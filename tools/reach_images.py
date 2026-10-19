#!/usr/bin/env python3
"""단지별 '버스 무환승 도달권' 정적 이미지 생성기.

bus-reach.html의 밀도 계산(buildDensity)과 색 규칙(heatColor)을 그대로 옮겨,
단지 정보 페이지(/complex)에 넣을 단지별 이미지를 images/reach/<단지명>.webp로 만든다.
지도 타일 대신 세종 버스 노선망·동 이름·주요 거점을 바탕으로 깐다.

실행: python3 tools/reach_images.py   (bus_sejong.json · transit.json이 바뀌었을 때 다시 실행)
필요: Pillow, Noto Sans CJK 폰트
"""
import json, math, os, re, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "images", "reach")
RADIUS_M, CELL_M, SAMPLE_M = 500, 110, 55
LAT_STEP = CELL_M / 111000
LNG_STEP = CELL_M / (111000 * math.cos(36.51 * math.pi / 180))
W, H, SS = 960, 720, 2  # 출력 크기, 슈퍼샘플링 배율
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
FONT_R = "/usr/share/fonts/opentype/noto/NotoSansCJK-Medium.ttc"

DONGS = {"고운동": (36.512089, 127.235952), "아름동": (36.513701, 127.247805), "종촌동": (36.503436, 127.247825),
         "도담동": (36.513755, 127.260736), "어진동": (36.501229, 127.263036), "해밀동": (36.527319, 127.2674),
         "다정동": (36.495046, 127.247088), "새롬동": (36.485854, 127.251106), "나성동": (36.486851, 127.260707),
         "한솔동": (36.47803, 127.254565), "대평동": (36.472385, 127.276631), "보람동": (36.479056, 127.290141),
         "소담동": (36.484899, 127.301523), "반곡동": (36.495211, 127.309355), "산울동": (36.530995, 127.261501),
         "집현동": (36.496528, 127.326435)}
LANDMARKS = {"정부세종청사": (36.5035, 127.2618), "세종시청": (36.4801, 127.2890),
             "오송역": (36.6205, 127.3272), "반석역": (36.3903, 127.3135)}


def hav(a, b, c, d):
    t = math.pi / 180
    x = math.sin((c - a) * t / 2) ** 2 + math.cos(a * t) * math.cos(c * t) * math.sin((d - b) * t / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(x))


def route_w(n):
    n = (n or "").strip()
    if re.match(r"^B5", n, re.I): return 5
    if re.match(r"^[AB]\d", n, re.I): return 10
    if re.match(r"^M\d", n, re.I): return 6
    if re.match(r"^10\d\d", n): return 5
    if re.match(r"^\d", n): return 3
    return 1


def heat_color(t):
    S = [(0, (44, 123, 182)), (0.35, (127, 205, 187)), (0.6, (255, 255, 140)), (0.8, (253, 141, 60)), (1, (189, 0, 38))]
    for i in range(1, len(S)):
        if t <= S[i][0]:
            a, b = S[i - 1], S[i]
            f = (t - a[0]) / (b[0] - a[0]) if b[0] - a[0] else 0
            return tuple(round(a[1][k] + (b[1][k] - a[1][k]) * f) for k in range(3))
    return S[-1][1]


def density(bus, route_no, lat, lng):
    stops, routes = bus["stops"], bus["routes"]
    near = [i for i, s in enumerate(stops) if hav(lat, lng, s["lat"], s["lng"]) <= RADIUS_M]
    ridx = sorted({ri for i in near for ri in stops[i]["r"]})
    sets = {}
    for ri in ridx:
        prev = None
        for si in routes[ri]["seq"]:
            s = stops[si]
            if prev:
                nn = max(1, math.ceil(hav(prev["lat"], prev["lng"], s["lat"], s["lng"]) / SAMPLE_M))
                for k in range(nn + 1):
                    t = k / nn
                    la = prev["lat"] + (s["lat"] - prev["lat"]) * t
                    ln = prev["lng"] + (s["lng"] - prev["lng"]) * t
                    sets.setdefault((math.floor(la / LAT_STEP), math.floor(ln / LNG_STEP)), set()).add(route_no[ri])
            prev = s
    cells = {k: sum(route_w(n) for n in v) for k, v in sets.items()}
    vals = sorted(cells.values()); M = len(vals); counts = {}
    for v in vals: counts[v] = counts.get(v, 0) + 1
    pmap, cum = {}, 0
    for v in sorted(counts):
        c = counts[v]; pmap[v] = (cum + (c - 1) / 2) / (M - 1) if M > 1 else 1; cum += c
    return cells, pmap, ridx


def frame(lat, lng):
    """행복도시 중심부 고정 틀(약 11.6×8.7km). 단지가 가장자리에 걸리면 단지 쪽으로 옮긴다."""
    kx = 111000 * math.cos(36.51 * math.pi / 180)
    wm = 11600; hm = wm * H / W
    clat, clng = 36.4995, 127.2790
    half_la, half_ln = hm / 2 / 111000, wm / 2 / kx
    m_la, m_ln = 1500 / 111000, 1500 / kx  # 단지 둘레 최소 여백
    clat = min(max(clat, lat + m_la - half_la), lat - m_la + half_la)
    clng = min(max(clng, lng + m_ln - half_ln), lng - m_ln + half_ln)
    return clat - half_la, clng - half_ln, wm / W  # 남단, 서단, m/px


def main():
    bus = json.load(open(os.path.join(ROOT, "bus_sejong.json")))
    tr = json.load(open(os.path.join(ROOT, "transit.json")))["data"]
    route_no = [re.sub(r"번$", "", re.sub(r"\s*\(.*$", "", r["name"])).strip() for r in bus["routes"]]
    os.makedirs(OUT, exist_ok=True)
    only = set(sys.argv[1:])
    f_lab = ImageFont.truetype(FONT, 15 * SS, index=1)
    f_dong = ImageFont.truetype(FONT_R, 13 * SS, index=1)
    f_name = ImageFont.truetype(FONT, 17 * SS, index=1)
    f_small = ImageFont.truetype(FONT_R, 12 * SS, index=1)
    kx = 111000 * math.cos(36.51 * math.pi / 180)
    made = 0
    for name, row in tr.items():
        if only and name not in only: continue
        lat, lng = row[4], row[5]
        if lat is None: continue
        cells, pmap, ridx = density(bus, route_no, lat, lng)
        s_lat, w_lng, mpp = frame(lat, lng)
        def px(la, ln):
            return ((ln - w_lng) * kx / mpp * SS, (H - (la - s_lat) * 111000 / mpp) * SS)
        img = Image.new("RGB", (W * SS, H * SS), (246, 247, 251))
        d = ImageDraw.Draw(img)
        # 바탕: 세종 버스 노선망 전체
        for r in bus["routes"]:
            pts = [px(bus["stops"][si]["lat"], bus["stops"][si]["lng"]) for si in r["seq"]]
            if len(pts) > 1: d.line(pts, fill=(214, 219, 230), width=2 * SS, joint="curve")
        # 음영
        heat = Image.new("RGBA", img.size, (0, 0, 0, 0)); hd = ImageDraw.Draw(heat)
        cell_px = max(CELL_M / mpp * SS, 1.5 * SS)
        for (ci, cj), v in sorted(cells.items(), key=lambda kv: pmap[kv[1]]):
            t = pmap[v]; x, y = px((ci + .5) * LAT_STEP, (cj + .5) * LNG_STEP)
            r = cell_px * 1.5
            hd.ellipse([x - r, y - r, x + r, y + r], fill=heat_color(t) + (int(255 * (0.45 + 0.4 * t)),))
        heat = heat.filter(ImageFilter.GaussianBlur(5 * SS))
        img.paste(heat, (0, 0), heat)
        d = ImageDraw.Draw(img)
        # 동 이름
        for dn, (la, ln) in DONGS.items():
            x, y = px(la, ln)
            if 0 < x < W * SS and 0 < y < H * SS and all(math.hypot(x - px(*v)[0] - 45 * SS, y - px(*v)[1]) > 60 * SS for v in LANDMARKS.values()):
                d.text((x, y), dn, font=f_dong, fill=(90, 98, 118), anchor="mm", stroke_width=3 * SS, stroke_fill=(255, 255, 255))
        # 주요 거점: 틀 안이면 표시, 틀 밖이면 환승 없이 닿을 때만 가장자리에 방면 표시
        reached = {(ci, cj) for (ci, cj) in cells}
        for ln_name, (la, ln) in LANDMARKS.items():
            x, y = px(la, ln)
            if 14 * SS < x < (W - 14) * SS and 14 * SS < y < (H - 14) * SS:
                r = 5 * SS; d.rectangle([x - r, y - r, x + r, y + r], fill=(22, 32, 58), outline=(255, 255, 255), width=2 * SS)
                d.text((x + 8 * SS, y - 6 * SS), ln_name, font=f_lab, fill=(22, 32, 58), anchor="lb", stroke_width=3 * SS, stroke_fill=(255, 255, 255))
                continue
            ci, cj = math.floor(la / LAT_STEP), math.floor(ln / LNG_STEP)
            if not any((ci + a, cj + b) in reached for a in range(-4, 5) for b in range(-4, 5)): continue
            cx, cy = W * SS / 2, H * SS / 2; dx, dy = x - cx, y - cy
            k = min((W * SS / 2 - 70 * SS) / abs(dx) if dx else 1e9, (H * SS / 2 - 26 * SS) / abs(dy) if dy else 1e9)
            ex, ey = cx + dx * k, cy + dy * k
            arrow = ("↑" if dy < 0 else "↓") if abs(dy) > abs(dx) else ("→" if dx > 0 else "←")
            label = f"{arrow} {ln_name}까지 환승 없이"
            bb = d.textbbox((ex, ey), label, font=f_lab, anchor="mm")
            d.rounded_rectangle([bb[0] - 10 * SS, bb[1] - 6 * SS, bb[2] + 10 * SS, bb[3] + 6 * SS], radius=12 * SS, fill=(22, 32, 58))
            d.text((ex, ey), label, font=f_lab, fill=(255, 255, 255), anchor="mm")
        # 단지 + 500m 반경
        x, y = px(lat, lng); rr = RADIUS_M / mpp * SS
        d.ellipse([x - rr, y - rr, x + rr, y + rr], outline=(185, 28, 28), width=2 * SS)
        r = 7 * SS; d.ellipse([x - r, y - r, x + r, y + r], fill=(185, 28, 28), outline=(255, 255, 255), width=3 * SS)
        d.text((x, y - rr - 6 * SS), name, font=f_name, fill=(185, 28, 28), anchor="mb", stroke_width=4 * SS, stroke_fill=(255, 255, 255))
        # 범례 + 축척
        lx, ly = 18 * SS, (H - 34) * SS
        for i in range(160 * SS):
            d.line([(lx + i, ly), (lx + i, ly + 10 * SS)], fill=heat_color(i / (160 * SS)))
        d.text((lx, ly - 4 * SS), "환승 없이 닿는 노선  적음 → 많음", font=f_small, fill=(90, 98, 118), anchor="ld")
        km = 2
        bl = km * 1000 / mpp * SS; bx = (W - 18) * SS - bl; by = (H - 22) * SS
        d.line([(bx, by), (bx + bl, by)], fill=(90, 98, 118), width=3 * SS)
        d.text((bx + bl / 2, by - 4 * SS), f"{km}km", font=f_small, fill=(90, 98, 118), anchor="md")
        img = img.resize((W, H), Image.LANCZOS)
        img.save(os.path.join(OUT, f"{name}.webp"), "WEBP", quality=80, method=6)
        made += 1
    print(f"{made}개 이미지 → images/reach/")


if __name__ == "__main__":
    main()
