#!/usr/bin/env python3
"""국토부 아파트 전월세 실거래가 API(RTMSDataSvcAptRent)로 세종(36110) 전월세 원자료를 받아
data/molit/세종_아파트전월세_<시작>_<끝>.csv 로 저장한다. 매매 원자료와 같은 기간(2021.11~)을 받는다.

실행: DATA_GO_KR_KEY=... python3 tools/fetch_molit_rent.py 202111 202610
"""
import csv, os, re, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = os.environ.get("DATA_GO_KR_KEY", "").strip() or sys.exit("DATA_GO_KR_KEY 환경변수가 없습니다")
URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent"
def months(a, b):
    y, m = int(a[:4]), int(a[4:])
    while y * 100 + m <= int(b):
        yield f"{y}{m:02d}"; m += 1
        if m > 12: y, m = y + 1, 1


def fetch(ym):
    out, page = [], 1
    while True:
        q = urllib.parse.urlencode({"serviceKey": KEY, "LAWD_CD": "36110", "DEAL_YMD": ym, "numOfRows": 1000, "pageNo": page})
        for a in range(5):
            try:
                root = ET.fromstring(urllib.request.urlopen(URL + "?" + q, timeout=40).read()); break
            except Exception as e:
                err = type(e).__name__; time.sleep(2 * (a + 1))
        else:
            raise RuntimeError(f"{ym} p{page} 실패({err})")
        items = root.findall(".//item")
        out += [{c.tag: (c.text or "").strip() for c in it} for it in items]
        total = int(root.findtext(".//totalCount") or 0)
        if page * 1000 >= total or not items: return out
        page += 1


def main():
    a, b = (sys.argv[1:3] + ["202111", "202610"])[:2] if len(sys.argv) >= 3 else ("202111", "202610")
    rows = []
    for ym in months(a, b):
        got = fetch(ym); rows += got
        print(ym, len(got), flush=True)
    head = ["계약일", "지역구분", "법정동", "지번", "단지명", "전용면적(㎡)", "층", "보증금(만원)", "월세(만원)",
            "계약구분", "계약기간", "종전보증금(만원)", "종전월세(만원)", "갱신요구권사용", "건축년도"]
    path = os.path.join(ROOT, "data", "molit", f"세종_아파트전월세_{a[:4]}-{a[4:]}_{b[:4]}-{b[4:]}.csv")
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f); w.writerow(head)
        for r in sorted(rows, key=lambda r: (r.get("dealYear"), int(r.get("dealMonth") or 0), int(r.get("dealDay") or 0))):
            dong = r.get("umdNm", "")
            area = "읍면" if re.search(r"(읍|면)(\s|$)", dong) else "동"
            w.writerow([f"{r.get('dealYear')}-{int(r.get('dealMonth')):02d}-{int(r.get('dealDay')):02d}", area, dong, r.get("jibun", ""),
                        r.get("aptNm", ""), r.get("excluUseAr", ""), r.get("floor", ""), r.get("deposit", "").replace(",", ""),
                        r.get("monthlyRent", "").replace(",", ""), r.get("contractType", ""), r.get("contractTerm", ""),
                        r.get("preDeposit", "").replace(",", ""), r.get("preMonthlyRent", "").replace(",", ""),
                        r.get("useRRRight", ""), r.get("buildYear", "")])
    print("저장:", os.path.relpath(path, ROOT), len(rows), "건")


if __name__ == "__main__":
    main()
