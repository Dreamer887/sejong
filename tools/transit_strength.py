#!/usr/bin/env python3
"""단지별 대중교통 강도(0~100)를 다시 계산해 transit.json을 갱신한다.

기준(단지 중심 반경 500m 안 정류장):
  - BRT 노선 하루 운행횟수 합 50%  (B5 순환은 절반만 반영)
  - 환승 없이 닿는 정류장 수 25%
  - 전체 노선 하루 운행횟수 합 25%
  세 값을 단지 간 백분위로 바꿔 합산한다. 같은 번호 노선은 한 번만 센다.

운행횟수:
  - 세종 노선: 세종특별자치시_버스운행 현황 CSV(운행횟수, 없으면 배차간격으로 16시간 운행 가정)
  - 대전·청주·공주 등록 노선: data/extra_route_runs.json (TAGO 첫차·막차·배차간격 추정)
  - 둘 다 없으면 기본값: A계열 40회, 그 밖 10회

실행: python3 tools/transit_strength.py <버스운행현황.csv> [--dry]
"""
import csv, io, json, math, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CITY = r"^(대전|청주|천안|공주)\s+"


def hav(a, b, c, d):
    t = math.pi / 180
    x = math.sin((c - a) * t / 2) ** 2 + math.cos(a * t) * math.cos(c * t) * math.sin((d - b) * t / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(x))


def route_no(name):  # 노선 식별자: 괄호·'번'을 떼고 도시명은 남긴다 (bus-reach.html의 ROUTE_NO와 같음)
    return re.sub(r"번$", "", re.sub(r"\s*\(.*$", "", name)).strip()


def bare(no):  # 도시명을 뗀 번호
    return re.sub(CITY, "", no)


def is_brt(no):
    return bool(re.match(r"^[AB]\d", bare(no), re.I))


def load_sejong_runs(path):
    raw = open(path, "rb").read()
    try: txt = raw.decode("utf-8-sig")
    except UnicodeDecodeError: txt = raw.decode("cp949")
    F = {}
    for r in csv.DictReader(io.StringIO(txt)):
        n = (r.get("노선번호") or "").strip()
        c = re.sub(r"[^\d.]", "", r.get("운행횟수") or "")
        if c: F[n] = float(c); continue
        m = re.findall(r"\d+", r.get("배차간격") or "")
        if m: F[n] = round(16 * 60 / (sum(map(int, m)) / len(m)), 1)
    return F


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args: sys.exit("버스운행 현황 CSV 경로를 주세요")
    F = load_sejong_runs(args[0])
    extra = json.load(open(os.path.join(ROOT, "data", "extra_route_runs.json")))["runs"]
    bus = json.load(open(os.path.join(ROOT, "bus_sejong.json")))
    tp = os.path.join(ROOT, "transit.json"); tr = json.load(open(tp))
    S, R = bus["stops"], bus["routes"]
    RN = [route_no(r["name"]) for r in R]

    def runs(no):
        if no in extra: return extra[no]["runs"]
        if no in F: return F[no]
        if bare(no) in F and not re.match(CITY, no): return F[bare(no)]
        return 40 if re.match(r"^A\d", bare(no)) else 10

    rows = []
    for name, v in tr["data"].items():
        la, ln = v[4], v[5]
        near = [i for i, s in enumerate(S) if hav(la, ln, s["lat"], s["lng"]) <= 500]
        ri = {r for i in near for r in S[i]["r"]}
        nos = sorted({RN[r] for r in ri})
        brt = sum(runs(n) * (0.5 if re.match(r"^B5", bare(n)) else 1) for n in nos if is_brt(n))
        allr = sum(runs(n) for n in nos)
        reach = len({si for r in ri for si in R[r]["seq"]})
        rows.append(dict(name=name, near=len(near), nos=nos, brt=brt, all=allr, reach=reach, lat=la, lng=ln))

    def pct(key):
        v = sorted(r[key] for r in rows)
        for r in rows:
            r["p_" + key] = (sum(1 for x in v if x < r[key]) + 0.5 * sum(1 for x in v if x == r[key])) / len(v)
    for k in ("brt", "reach", "all"): pct(k)
    for r in rows: r["score"] = round(100 * (0.5 * r["p_brt"] + 0.25 * r["p_reach"] + 0.25 * r["p_all"]))
    rows.sort(key=lambda r: -r["score"])
    old = {k: v[0] for k, v in tr["data"].items()}
    new = {}
    for i, r in enumerate(rows, 1):
        new[r["name"]] = [r["score"], i, r["near"], r["nos"], r["lat"], r["lng"]]
    if "--dry" in sys.argv:
        diff = sorted(rows, key=lambda r: -abs(r["score"] - old[r["name"]]))
        print("변화 큰 단지:", [(r["name"], old[r["name"]], r["score"]) for r in diff[:10]])
        print("평균 절대 변화:", round(sum(abs(r["score"] - old[r["name"]]) for r in rows) / len(rows), 2))
        return
    labels = dict(tr.get("labels", {}))
    lp = os.path.join(ROOT, "data", "extra_route_labels.json")
    if os.path.exists(lp):
        for k, v in json.load(open(lp)).items(): labels.setdefault(k.replace("(단)", ""), v)
    tr["data"] = new; tr["labels"] = labels; tr["n"] = len(new)
    tr["basis"] = "국토교통부 TAGO 노선·정류장(2026년 10월, 세종 + 대전·청주·공주 등록 노선) + 세종시 버스운행 현황(2026년 8월)"
    json.dump(tr, open(tp, "w"), ensure_ascii=False, separators=(",", ":"))
    print("transit.json 갱신:", len(new), "개 단지")


if __name__ == "__main__":
    main()
