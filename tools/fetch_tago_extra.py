#!/usr/bin/env python3
"""주변 도시(대전·청주·천안·공주)에 등록된 버스 중 세종 단지 앞을 지나는 노선을 TAGO에서 받아
bus_sejong.json에 더한다.

- 키: 환경변수 DATA_GO_KR_KEY (공공데이터포털 일반 인증키, Decoding). 값은 출력하지 않는다.
- 남기는 노선: 세종 단지(transit.json 좌표) 반경 500m 안에 정류장이 하나라도 있는 노선
- 이미 세종 데이터에 같은 번호가 있는 BRT(B·A 계열)는 건너뛴다
- 새 노선 이름: BRT는 번호 그대로(B1 등), 그 밖에는 "대전 102"처럼 도시명을 앞에 붙인다

실행: DATA_GO_KR_KEY=... python3 tools/fetch_tago_extra.py
"""
import json, math, os, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://apis.data.go.kr/1613000/BusRouteInfoInqireService/"
CITIES = ["대전", "청주", "천안", "공주"]
KEY = os.environ.get("DATA_GO_KR_KEY", "").strip()
if not KEY:
    sys.exit("DATA_GO_KR_KEY 환경변수가 없습니다")


CACHE = os.environ.get("TAGO_CACHE")  # 지정하면 응답을 저장해 재실행 때 다시 받지 않는다


def call(op, **q):
    ck = None
    if CACHE:
        os.makedirs(CACHE, exist_ok=True)
        ck = os.path.join(CACHE, op + "_" + "_".join(f"{k}-{v}" for k, v in sorted(q.items())) + ".json")
        if os.path.exists(ck): return json.load(open(ck))
    q.update(serviceKey=KEY, _type="json", numOfRows=q.get("numOfRows", 1000), pageNo=q.get("pageNo", 1))
    url = BASE + op + "?" + urllib.parse.urlencode(q)
    err = ""
    for attempt in range(6):
        try:
            body = json.loads(urllib.request.urlopen(url, timeout=40).read())
            items = body["response"]["body"].get("items") or {}
            it = items.get("item", []) if isinstance(items, dict) else []
            it = it if isinstance(it, list) else [it]
            if ck: json.dump(it, open(ck, "w"), ensure_ascii=False)
            return it
        except Exception as e:  # 키가 URL에 있으므로 예외 메시지에 URL을 싣지 않는다
            err = type(e).__name__
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"{op} 호출 실패({err})")


def hav(a, b, c, d):
    t = math.pi / 180
    x = math.sin((c - a) * t / 2) ** 2 + math.cos(a * t) * math.cos(c * t) * math.sin((d - b) * t / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(x))


def main():
    bus = json.load(open(os.path.join(ROOT, "bus_sejong.json")))
    tr = json.load(open(os.path.join(ROOT, "transit.json")))["data"]
    complexes = [(v[4], v[5]) for v in tr.values() if v[4] is not None]
    lat0, lat1 = min(c[0] for c in complexes) - .01, max(c[0] for c in complexes) + .01
    lng0, lng1 = min(c[1] for c in complexes) - .01, max(c[1] for c in complexes) + .01

    def near_complex(la, ln):
        if not (lat0 < la < lat1 and lng0 < ln < lng1): return False
        return any(hav(la, ln, c[0], c[1]) <= 500 for c in complexes)

    have = {r["name"] for r in bus["routes"]}
    codes = {c["cityname"]: c["citycode"] for c in call("getCtyCodeList")}
    picked = {}
    failed = []
    for city in CITIES:
        code = next((v for k, v in codes.items() if k.startswith(city)), None)
        if code is None:
            print(city, "도시코드 없음"); continue
        routes = call("getRouteNoList", cityCode=code)
        kept = 0
        for r in routes:
            no = str(r.get("routeno", "")).strip()
            brt = bool(re.match(r"^[AB]\d", no))
            if brt and no in have: continue
            try:
                stops = call("getRouteAcctoThrghSttnList", cityCode=code, routeId=r["routeid"])
            except RuntimeError as e:
                failed.append(f"{city} {no}"); print("  건너뜀:", city, no, e, flush=True); continue
            pts = [s for s in stops if s.get("gpslati") and s.get("gpslong")]
            if not any(near_complex(float(s["gpslati"]), float(s["gpslong"])) for s in pts): continue
            name = no if brt else f"{city} {no}"
            if name in picked: continue
            dirs = {}
            for s in sorted(pts, key=lambda s: int(s.get("nodeord", 0))):
                dirs.setdefault(str(s.get("updowncd", "0")), []).append((float(s["gpslati"]), float(s["gpslong"])))
            picked[name] = {"label": f"{name}({r.get('startnodenm','')}↔{r.get('endnodenm','')})", "dirs": list(dirs.values())}
            kept += 1
            time.sleep(0.05)
        print(f"{city}: 노선 {len(routes)}개 중 {kept}개가 세종 단지 앞을 지남", flush=True)

    # 정류장 병합: 기존 정류장과 15m 안이면 같은 정류장으로 본다
    grid = {}
    def key(la, ln): return (round(la / 0.0003), round(ln / 0.0003))
    for i, s in enumerate(bus["stops"]):
        grid.setdefault(key(s["lat"], s["lng"]), []).append(i)
    def stop_index(la, ln):
        k = key(la, ln)
        for dk in [(a, b) for a in (-1, 0, 1) for b in (-1, 0, 1)]:
            for i in grid.get((k[0] + dk[0], k[1] + dk[1]), []):
                s = bus["stops"][i]
                if hav(la, ln, s["lat"], s["lng"]) <= 15: return i
        bus["stops"].append({"lat": round(la, 6), "lng": round(ln, 6), "r": []})
        i = len(bus["stops"]) - 1; grid.setdefault(k, []).append(i); return i

    labels = {}
    for name, v in picked.items():
        for seq in v["dirs"]:
            ri = len(bus["routes"]); idx = []
            for la, ln in seq:
                si = stop_index(la, ln); idx.append(si)
                if ri not in bus["stops"][si]["r"]: bus["stops"][si]["r"].append(ri)
            bus["routes"].append({"name": name, "seq": idx})
        labels[name] = v["label"]

    bus["meta"]["src"] = "국토교통부 TAGO 버스노선정보 (세종 cityCode=12 + 대전·청주·천안·공주 노선 중 세종 단지 반경 500m를 지나는 노선)"
    bus["meta"]["extra_fetched"] = time.strftime("%Y-%m-%d")
    bus["meta"]["routes"] = len(bus["routes"]); bus["meta"]["stops"] = len(bus["stops"])
    json.dump(bus, open(os.path.join(ROOT, "bus_sejong.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    json.dump(labels, open(os.path.join(ROOT, "data", "extra_route_labels.json"), "w"), ensure_ascii=False, indent=1)
    print("추가 노선:", ", ".join(sorted(picked)) or "없음")
    if failed: print("조회 실패(다시 실행하면 이어서 받음):", ", ".join(failed))


if __name__ == "__main__":
    main()
