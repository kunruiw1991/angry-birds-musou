#!/usr/bin/env python3
"""Fast headless smoke check (owner: opus-director). Run after EVERY edit:

  python3 tests/smoke.py              # all levels: launch + ability + 4 s of sim each
  python3 tests/smoke.py --shot       # also saves /tmp/ab_musou/shots/smoke_<level>.png mid-ability

Exit 0 only if every level ran, window.__ERRORS__ is empty and no JS exceptions were thrown.
Writes nothing outside /tmp/ab_musou/.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import Browser  # noqa: E402

JS_RUN = r"""
(() => {
  const M = window.__MUSOU__;
  const out = [];
  for (const lv of M.listLevels()) {
    M.startLevel(lv.id, { seed: 7 });
    M.launch(40, 0.9); M.stepFrames(40); M.useAbility(); M.stepFrames(240);
    const s = M.getState();
    out.push({ id: lv.id, pigs: `${s.pigsLeft}/${s.pigsAtStart}`, displaced: `${s.displaced}/${s.blocksAtStart}`,
               score: s.score, state: s.state, bodies: s.bodies });
  }
  return JSON.stringify({ out, errors: window.__ERRORS__ || [] });
})()
"""


def main():
  ap = argparse.ArgumentParser()
  ap.add_argument('--shot', action='store_true')
  args = ap.parse_args()
  with Browser(1280, 800) as b:
    if not b.goto('index.html'):
      print('SMOKE_FAIL page/seam did not load; exceptions:', b.exceptions[:3], 'errors:',
            b.eval('JSON.stringify(window.__ERRORS__||[])') if True else '')
      sys.exit(1)
    try:
      res = json.loads(b.eval(JS_RUN))
    except Exception as e:  # noqa: BLE001
      print('SMOKE_FAIL', e, 'exceptions:', b.exceptions[:3])
      sys.exit(1)
    if args.shot:
      for lv in json.loads(b.eval('JSON.stringify(window.__MUSOU__.listLevels().map(l=>l.id))')):
        b.eval(f'window.__MUSOU__.startLevel("{lv}",{{seed:7}}); window.__MUSOU__.launch(40,0.9); '
               f'window.__MUSOU__.stepFrames(40); window.__MUSOU__.useAbility(); window.__MUSOU__.stepFrames(20); 1')
        import time; time.sleep(0.25)
        print('shot:', b.screenshot(f'/tmp/ab_musou/shots/smoke_{lv}.png'))
    bad_http = [r for r in b.requests if str(r[2]).startswith(('4', '5'))]
    errs = res['errors'] + [str(x) for x in b.exceptions]
    for r in res['out']:
      print(f"  {r['id']}: pigs {r['pigs']} displaced {r['displaced']} score {r['score']} state {r['state']} bodies {r['bodies']}")
    ok = not errs and not bad_http
    print(('SMOKE_OK' if ok else 'SMOKE_FAIL'), 'levels=%d' % len(res['out']), 'errors=%s' % json.dumps(errs[:5]),
          'http_errors=%s' % bad_http[:5])
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
  main()
