#!/usr/bin/env python3
"""세부인 단지 관심도 TOP 20 집계 (interest.json 갱신)

방법은 docs/관심도_검색량_집계방법.md 에 정리돼 있습니다. 이 스크립트는 그 문서를 그대로 구현합니다.
(2026년 10월분을 계산한 코드 interest2.py · spike.py 를 정리해 옮긴 것)

사용법
    python3 tools/interest_rank.py --keys /안전한/경로/keys.env            # 계산 + interest.json 갱신
    python3 tools/interest_rank.py --keys keys.env --dry                     # 결과만 출력, 파일은 안 씀
    python3 tools/interest_rank.py --list-keywords                           # 단지별 검색어만 출력(API 호출 없음)

keys.env 에 필요한 값: SA_API_KEY, SA_SECRET, SA_CUSTOMER_ID(네이버 검색광고),
NAVER_KEY_ID, NAVER_KEY(네이버 API 허브 데이터랩). 키 파일은 저장소 밖에 두고, 값은 출력하지 않습니다.

원 검색량(단지별 합계·검색어별 수치)은 저장소에 올리지 않습니다. --raw 로 지정한 로컬 파일에만 남깁니다.
"""
import argparse, base64, collections, datetime as dt, hashlib, hmac, json, os, statistics, sys, time
import urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── 기준 ─────────────────────────────────────────────
BASE_NAME = '가재마을5단지'                      # 지수 100 기준 단지
BASE_MONTH = '2026년 10월'                       # 이 달의 기준 단지 값을 100으로 고정
BASE_WINDOW = ('2026-10-02', '2026-10-31')       # 기준 달의 30일 구간(11월 1일 실행분)
TOP_N = 20
SPIKE_CHECK_N = 25        # 급증 여부를 확인할 상위 단지 수
SPIKE_RATIO = 3.0         # 5일 평균이 평소(중앙값)의 몇 배 이상이면 '급증'
SPIKE_LEAD_DAYS = 13      # 평소 값을 잡기 위해 30일 구간 앞에 더 보는 날 수

# 단지 정보의 브랜드명이 실제 검색 형태와 다른 단지는 아래 이름으로 검색합니다.
BRAND_OVERRIDE = {
    '나릿재마을1단지': '리더스포레', '나릿재마을2단지': '리더스포레', '나릿재마을3단지': '제일풍경채위너스카이',
    '나릿재마을5단지': '한신더휴리저브', '나릿재마을6단지': '한신더휴리저브', '한뜰마을4단지': '한신더휴리저브2',
    '가온마을2단지': '한신휴플러스제일풍경채', '산울마을8단지': '엘리프세종', '가락마을8단지': '고운뜰파크',
    '새뜸마을1단지': '메이저시티푸르지오', '새나루마을1단지': '자이e편한세상', '새나루마을2단지': '하늘채센트레빌',
    '새나루마을8단지': '하늘채센트레빌', '새나루마을3단지': '더휴예미지', '새나루마을4단지': '더휴예미지',
    '새나루마을9단지': '어울림파밀리에센트럴', '새나루마을10단지': '어울림파밀리에센트럴',
    '새나루마을11단지': '어울림파밀리에센트럴',
}
# 브랜드가 아닌 값(브랜드 검색어를 만들지 않음)
NOT_BRAND = {'다산마을', '행복아파트', '세경아파트'}
# 전국에 같은 이름 단지가 많은 브랜드: '브랜드+N단지' 단독 형태는 다른 지역과 섞이므로 만들지 않음
NATIONAL = {'푸르지오', '힐스테이트', '롯데캐슬', '삼성래미안', '래미안', '센트레빌', '한신더휴', '호반베르디움',
            '이지더원', '퍼스트프라임', '더하이스트', '신동아파밀리에', '반도유보라', '유승한내들', '골드클래스',
            '힐데스하임', '블루시티', '한신휴플러스', '캐슬앤파밀리에', '투머로우시티', 'e편한세상푸르지오'}
# 번호 없는 브랜드 검색 중 따로 더하는 것
EXTRA_BRAND_KEYWORDS = {'세종파밀리에센트럴': ('파밀리에센트럴', None), '집현동파밀리에센트럴': ('파밀리에센트럴', '집현동')}


def norm(b):
    return b.replace(' ', '').replace('&', '앤').replace('Ⅱ', '2').replace('-', '')


def core(b):
    return b[2:] if b.startswith('세종') else b


def load_complexes():
    data = json.load(open(os.path.join(ROOT, 'complexes.json')))['data']
    out = []
    for m in data:
        b = BRAND_OVERRIDE.get(m['이름']) or norm(m.get('브랜드') or '')
        if b in NOT_BRAND:
            b = ''
        V = m['마을']
        Vs = V.replace('마을', '') if V != '첫마을' else ''
        out.append(dict(이름=m['이름'], D=m['동'], V=V, Vs=Vs, N=m['단지'], B=b, core=core(b) if b else ''))
    return out


def build_keywords(C):
    """A 검색어(단지 하나를 가리키는 형태)와 B 검색어(번호 없는 브랜드 형태)를 만든다."""
    for c in C:
        D, V, Vs, N, K = c['D'], c['V'], c['Vs'], c['N'], c['core']
        ks = [f'{V}{N}단지', f'{D}{N}단지', f'{D}{V}{N}단지']
        if Vs:
            ks += [f'{Vs}{N}단지', f'{D}{Vs}{N}단지']
        if K:
            ks += [f'{D}{K}{N}단지', f'세종{K}{N}단지']
            if K not in NATIONAL:
                ks.append(f'{K}{N}단지')
        c['A'] = list(dict.fromkeys(ks))
    own = collections.defaultdict(list)
    for c in C:
        for k in c['A']:
            own[k].append(c['이름'])
    Bk = {}
    for c in C:
        K = c['core']
        if not K:
            continue
        Bk[f"{c['D']}{K}"] = (K, c['D'])
        Bk[f'세종{K}'] = (K, None)
        if '세종' in c['B'] and not c['B'].startswith('세종'):
            Bk[c['B']] = (c['B'], None)
    Bk.update(EXTRA_BRAND_KEYWORDS)
    return own, Bk


# ── API ─────────────────────────────────────────────
def load_env(path):
    return dict(l.strip().split('=', 1) for l in open(path) if '=' in l and not l.startswith('#'))


def searchad_volumes(env, keywords):
    """네이버 검색광고 키워드 도구: 최근 30일 PC+모바일 검색량. '< 10' 은 0으로 센다."""
    def call(hints):
        uri = '/keywordstool'
        ts = str(int(time.time() * 1000))
        sig = base64.b64encode(hmac.new(env['SA_SECRET'].encode(), f'{ts}.GET.{uri}'.encode(),
                                        hashlib.sha256).digest()).decode()
        q = urllib.parse.urlencode({'hintKeywords': ','.join(hints), 'showDetail': '1'})
        req = urllib.request.Request(f'https://api.searchad.naver.com{uri}?{q}', headers={
            'X-Timestamp': ts, 'X-API-KEY': env['SA_API_KEY'], 'X-Customer': env['SA_CUSTOMER_ID'],
            'X-Signature': sig})
        return json.load(urllib.request.urlopen(req, timeout=30))['keywordList']

    v = lambda x: 0 if isinstance(x, str) else x
    vol = {}
    for i in range(0, len(keywords), 5):       # 한 번에 힌트 5개까지
        batch = keywords[i:i + 5]
        try:
            r = call(batch)
        except Exception as e:
            print('ERR', batch, e, file=sys.stderr)
            r = []
        want = {k.upper(): k for k in batch}
        for x in r:
            k = want.get(x['relKeyword'].replace(' ', '').upper())
            if k:
                vol[k] = v(x['monthlyPcQcCnt']) + v(x['monthlyMobileQcCnt'])
        for k in batch:
            vol.setdefault(k, 0)
        time.sleep(0.35)
        if i % 200 == 0:
            print(f'  검색량 조회 {i}/{len(keywords)}', file=sys.stderr)
    return vol


def datalab_daily(env, groups, start, end):
    """데이터랩 일별 검색 추이(그룹당 검색어 20개, 요청당 그룹 5개)."""
    body = dict(startDate=str(start), endDate=str(end), timeUnit='date', keywordGroups=groups)
    req = urllib.request.Request('https://naverapihub.apigw.ntruss.com/search-trend/v1/search',
                                 data=json.dumps(body).encode(), method='POST', headers={
                                     'X-NCP-APIGW-API-KEY-ID': env['NAVER_KEY_ID'],
                                     'X-NCP-APIGW-API-KEY': env['NAVER_KEY'], 'Content-Type': 'application/json'})
    res = json.load(urllib.request.urlopen(req, timeout=30))
    days = [str(start + dt.timedelta(days=j)) for j in range((end - start).days + 1)]
    out = {}
    for g in res['results']:
        s = {x['period']: x['ratio'] for x in g['data']}
        out[g['title']] = (days, [s.get(d, 0) for d in days])
    return out


# ── 집계 ─────────────────────────────────────────────
def aggregate(C, own, Bk, vol):
    by = {c['이름']: c for c in C}
    for c in C:
        c['Asum'], c['Bsum'], c['det'] = 0, 0.0, {}
    # 1) 한 단지만 가리키는 A 검색어는 그 단지에 그대로
    for k, names in own.items():
        if len(names) == 1:
            c = by[names[0]]
            c['Asum'] += vol.get(k, 0)
            c['det'][k] = vol.get(k, 0)
    # 2) 여러 단지에 겹치는 A 검색어는 각 단지의 A 합계 비율로 나눔
    for k, names in own.items():
        if len(names) > 1:
            tot = sum(by[n]['Asum'] for n in names) or len(names)
            for n in names:
                s = vol.get(k, 0) * ((by[n]['Asum'] or 1) / tot)
                by[n]['Bsum'] += s
                by[n]['det'][k + '(배분)'] = round(s)
    # 3) 번호 없는 브랜드 검색(B)은 그 브랜드를 쓰는 단지(동 지정 시 그 동만)에 A 합계 비율로 나눔
    for k, (K, dong) in Bk.items():
        if not vol.get(k):
            continue
        tg = [c for c in C if c['core'] and K in c['B'] and (dong is None or c['D'] == dong)]
        if not tg:
            continue
        tot = sum(c['Asum'] for c in tg) or len(tg)
        for c in tg:
            s = vol[k] * ((c['Asum'] or 1) / tot)
            c['Bsum'] += s
            c['det'][k + '(배분)'] = round(s)
    res = [dict(이름=c['이름'], 동=c['D'], 브랜드=c['B'], A=c['Asum'], B=round(c['Bsum']),
                합계=round(c['Asum'] + c['Bsum']),
                키워드={k: x for k, x in sorted(c['det'].items(), key=lambda kv: -kv[1]) if x}) for c in C]
    res.sort(key=lambda r: -r['합계'])
    return res


def own_keywords(r):
    return [k for k, x in r['키워드'].items() if '(배분)' not in k][:20] or [r['이름']]


def base_value(env, res, win_start, win_end):
    """기준 단지의 '기준 달' 합계를 이번 달 값으로 환산한다.
    이번 달 검색광고 합계 × (기준 달 30일 데이터랩 합 ÷ 이번 30일 데이터랩 합)."""
    b = next(r for r in res if r['이름'] == BASE_NAME)
    bs, be = (dt.date.fromisoformat(x) for x in BASE_WINDOW)
    if (bs, be) == (win_start, win_end):
        return b['합계'], 1.0
    start = min(bs, win_start)
    days, ser = datalab_daily(env, [dict(groupName=BASE_NAME, keywords=own_keywords(b))], start, win_end)[BASE_NAME]
    pick = lambda a, z: sum(v for d, v in zip(days, ser) if str(a) <= d <= str(z))
    ratio = pick(bs, be) / (pick(win_start, win_end) or 1)
    return b['합계'] * ratio, ratio


def detect_spikes(env, res, win_start, win_end):
    """상위 단지의 일별 추이에서 30일 구간 중 가장 높은 5일 평균이 평소(중앙값)의 3배 이상이면 급증."""
    top = res[:SPIKE_CHECK_N]
    start = win_start - dt.timedelta(days=SPIKE_LEAD_DAYS)
    out = {}
    for i in range(0, len(top), 5):
        groups = [dict(groupName=r['이름'], keywords=own_keywords(r)) for r in top[i:i + 5]]
        for name, (days, ser) in datalab_daily(env, groups, start, win_end).items():
            med = statistics.median(ser) or 0.01
            last, dl = ser[-30:], days[-30:]
            best = max(range(len(last) - 4), key=lambda j: sum(last[j:j + 5]))
            pk = sum(last[best:best + 5]) / 5
            out[name] = dict(ratio=round(pk / med, 1), peak_from=dl[best], peak_to=dl[best + 4])
        time.sleep(0.3)
    return out


def spike_label(s):
    if not s or s['ratio'] < SPIKE_RATIO:
        return None
    f, t = s['peak_from'].split('-'), s['peak_to'].split('-')
    if f[1] == t[1]:
        return f'{int(f[1])}월 {int(f[2])}일~{int(t[2])}일'
    return f'{int(f[1])}/{int(f[2])}~{int(t[1])}/{int(t[2])}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--keys', default='keys.env')
    ap.add_argument('--month', help='표시할 달, 예: "2026년 11월" (기본: 실행일의 지난달)')
    ap.add_argument('--raw', default='interest_raw.json', help='원 검색량을 남길 로컬 파일(저장소에 올리지 않음)')
    ap.add_argument('--dry', action='store_true')
    ap.add_argument('--list-keywords', action='store_true')
    a = ap.parse_args()

    C = load_complexes()
    own, Bk = build_keywords(C)
    allk = sorted(set(own) | set(Bk))
    if a.list_keywords:
        for c in C:
            print(c['이름'], ' / '.join(c['A']))
        print(f'단지 {len(C)}개 · A 검색어 {len(own)}개 · B 검색어 {len(Bk)}개 · 전체 {len(allk)}개')
        return

    env = load_env(a.keys)
    today = dt.date.today()
    win_end, win_start = today - dt.timedelta(days=1), today - dt.timedelta(days=30)
    print(f'구간 {win_start}~{win_end} · 검색어 {len(allk)}개 조회', file=sys.stderr)

    vol = searchad_volumes(env, allk)
    res = aggregate(C, own, Bk, vol)
    bval, bratio = base_value(env, res, win_start, win_end)
    spikes = detect_spikes(env, res, win_start, win_end)

    top = []
    for r in res[:TOP_N]:
        top.append({'이름': r['이름'], '지수': round(r['합계'] / bval * 100),
                    '급증': spike_label(spikes.get(r['이름']))})
    for k, t in enumerate(top):           # 지수가 같으면 같은 순위
        t['순위'] = top[k - 1]['순위'] if k and top[k - 1]['지수'] == t['지수'] else k + 1

    prev = today.replace(day=1) - dt.timedelta(days=1)     # 매달 1일 실행 → 지난달 이름
    month = a.month or f'{prev.year}년 {prev.month}월'
    md = lambda d: f'{d.month}월 {d.day}일'
    out = {'month': month,
           'basis': f'최근 30일({md(win_start)}~{md(win_end)}) 네이버 검색량 기준',
           'index_base': f'{BASE_NAME}({BASE_MONTH}) = 100',
           'top': top}

    json.dump({'구간': [str(win_start), str(win_end)], '기준값': round(bval, 1), '기준환산비': round(bratio, 3),
               '급증': spikes, 'vol': vol, 'data': res},
              open(a.raw, 'w'), ensure_ascii=False, indent=1)
    for t in top:
        print(t['순위'], t['이름'], t['지수'], t['급증'] or '')
    print(f'기준 단지 환산비 {bratio:.3f} · 원 자료: {a.raw}', file=sys.stderr)
    if not a.dry:
        with open(os.path.join(ROOT, 'interest.json'), 'w') as f:
            json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        print('interest.json 갱신 완료', file=sys.stderr)


if __name__ == '__main__':
    main()
