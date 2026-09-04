#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ai_news_ops - AIニュースまとめ（社内版）の更新処理

incoming.json に置かれた新規記事を news.json へ取り込み、
フロント掲載期間を過ぎた記事を月次アーカイブへ移動し、
archive-index.json と index.html の updatedAt を作り直します。

  python3 scripts/ai_news_ops.py            # 実行
  python3 scripts/ai_news_ops.py --dry-run  # 書き込まずに結果だけ表示

祝日と表示日数は app.js を唯一の情報源として読み取ります。
app.js を直せば、このスクリプトの挙動も自動的に追従します。
"""

import argparse
import collections
import datetime
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JST = datetime.timezone(datetime.timedelta(hours=9))
WEEK_JA = ["月", "火", "水", "木", "金", "土", "日"]

REQUIRED_KEYS = ["date", "category", "title", "summary", "source"]
VALID_CATEGORIES = {
    "法規制・権利", "人材・組織", "経営・投資", "業務ツール",
    "海外の動き", "産業動向", "SNSの話題", "成功事例",
}
BANNED_WORDS = ["マーケター", "マーケッター", "当社", "担当者視点"]


def p(*a):
    print(*a, flush=True)


def path(name):
    return os.path.join(ROOT, name)


def load_json(name, default=None):
    fp = path(name)
    if not os.path.exists(fp):
        return default
    with open(fp, encoding="utf-8") as f:
        return json.load(f)


def save_json(name, data, dry):
    if dry:
        return
    with open(path(name), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


# ---------------------------------------------------------------- app.js 読取

def read_app_settings():
    """app.js から FRONT_BUSINESS_DAYS と HOLIDAYS を取り出す。"""
    src = open(path("app.js"), encoding="utf-8").read()

    m = re.search(r"FRONT_BUSINESS_DAYS\s*=\s*(\d+)", src)
    days = int(m.group(1)) if m else 2

    m = re.search(r"HOLIDAYS\s*=\s*\{(.*?)\}\s*;", src, re.S)
    holidays = set(re.findall(r'"(\d{4}-\d{2}-\d{2})"\s*:\s*true', m.group(1))) if m else set()

    if not holidays:
        p("!! app.js から祝日を読み取れませんでした。土日のみ非営業日として扱います。")
    return days, holidays


def front_cutoff(today, business_days, holidays):
    """app.js の frontCutoff() と同じ計算。"""
    d, counted = today, 0
    while counted < business_days:
        d -= datetime.timedelta(days=1)
        if d.weekday() < 5 and d.isoformat() not in holidays:
            counted += 1
    return d.isoformat()


# ---------------------------------------------------------------- 検証

def validate(items):
    errors = []
    for i, a in enumerate(items):
        tag = "incoming[%d] %s" % (i, a.get("title", "(見出しなし)")[:30])
        for k in REQUIRED_KEYS:
            if k not in a:
                errors.append("%s : 必須項目 '%s' がありません" % (tag, k))
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(a.get("date", ""))):
            errors.append("%s : date は YYYY-MM-DD 形式にしてください" % tag)
        if a.get("category") not in VALID_CATEGORIES:
            errors.append("%s : category '%s' は使えません" % (tag, a.get("category")))
        src = a.get("source") or {}
        if not isinstance(src, dict) or not src.get("label") or not src.get("url"):
            errors.append("%s : source に label と url が必要です" % tag)
        elif not str(src["url"]).startswith("http"):
            errors.append("%s : source.url が URL になっていません" % tag)
        for t in a.get("terms") or []:
            if not (isinstance(t, dict) and t.get("word") and t.get("desc")):
                errors.append("%s : terms は word と desc の組にしてください" % tag)
        blob = " ".join(str(a.get(k, "")) for k in ("title", "summary", "hint", "topReason"))
        for w in BANNED_WORDS:
            if w in blob:
                errors.append("%s : 使用禁止の語「%s」が含まれています" % (tag, w))
    return errors


# ---------------------------------------------------------------- 本体

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="書き込まずに結果だけ表示")
    ap.add_argument("--date", help="基準日をYYYY-MM-DDで上書き（動作確認用）")
    args = ap.parse_args()
    dry = args.dry_run

    today = (datetime.date.fromisoformat(args.date) if args.date
             else datetime.datetime.now(JST).date())
    today_s = today.isoformat()
    stamp = "%d年%d月%d日（%s）" % (today.year, today.month, today.day, WEEK_JA[today.weekday()])

    business_days, holidays = read_app_settings()
    cutoff = front_cutoff(today, business_days, holidays)
    p("基準日 %s / 掲載範囲は %s 以降（%d営業日）" % (today_s, cutoff, business_days))

    incoming = load_json("incoming.json", []) or []
    if not isinstance(incoming, list):
        p("!! incoming.json は記事の配列にしてください。")
        return 1

    # 1) 検証
    if incoming:
        errs = validate(incoming)
        if errs:
            p("\n!! incoming.json に問題があります。中止します。")
            for e in errs:
                p("   -", e)
            return 1
        p("incoming.json: %d件 検証OK" % len(incoming))
    else:
        p("incoming.json: 新規記事なし（アーカイブ整理のみ実行）")

    news = load_json("news.json", []) or []

    # 2) 重複除外（日付＋見出しが一致するもの）
    known = {(a.get("date"), a.get("title")) for a in news}
    for name in glob.glob(path("archive-????-??.json")):
        for a in json.load(open(name, encoding="utf-8")):
            known.add((a.get("date"), a.get("title")))

    fresh, skipped = [], []
    for a in incoming:
        if (a.get("date"), a.get("title")) in known:
            skipped.append(a)
        else:
            a.setdefault("postedAt", today_s)
            a.setdefault("hint", "")
            a.setdefault("terms", [])
            fresh.append(a)
    for a in skipped:
        p("   重複のため取り込みません:", a.get("title", "")[:44])

    # 3) フロント掲載範囲の判定
    keep, move = [], []
    for a in news:
        eff = max(str(a.get("date", "")), str(a.get("postedAt") or ""))
        (keep if (eff >= cutoff or a.get("pickup")) else move).append(a)

    # 4) 今日のトップニュースを一本化する
    #    新規側に topReason があれば、フロントに残る既存記事の topReason を外す
    #    （アーカイブへ移る記事はそのまま残す）
    if any(a.get("topReason") for a in fresh):
        for a in keep:
            if a.pop("topReason", None):
                p("   トップから降格:", a.get("title", "")[:44])

    news_out = fresh + keep
    save_json("news.json", news_out, dry)
    p("news.json: %d件（新規%d / 継続%d / アーカイブへ%d）"
      % (len(news_out), len(fresh), len(keep), len(move)))

    # 5) 月次アーカイブへ移動
    by_month = collections.defaultdict(list)
    for a in move:
        by_month[str(a.get("date", ""))[:7]].append(a)

    archives = {}
    for fp in glob.glob(path("archive-????-??.json")):
        archives[os.path.basename(fp)[8:15]] = json.load(open(fp, encoding="utf-8"))

    for month, items in sorted(by_month.items()):
        name = "archive-%s.json" % month
        arc = archives.get(month, [])
        seen = {(x.get("date"), x.get("title")) for x in arc}
        arc = arc + [x for x in items if (x.get("date"), x.get("title")) not in seen]
        arc.sort(key=lambda x: str(x.get("date", "")), reverse=True)
        archives[month] = arc
        save_json(name, arc, dry)
        p("   %s: %d件（+%d）" % (name, len(arc), len(items)))

    # 6) archive-index.json は必ず全月次ファイルから作り直す
    months, days = [], collections.Counter()
    for month in sorted(archives, reverse=True):
        y, mo = month[:4], month[5:7]
        data = archives[month]
        months.append({"month": "%s-%s" % (y, mo),
                       "label": "%s年%d月" % (y, int(mo)),
                       "count": len(data)})
        for a in data:
            days[str(a.get("date", ""))] += 1
    index = {"months": months,
             "days": [{"date": d, "count": c} for d, c in sorted(days.items(), reverse=True)]}
    save_json("archive-index.json", index, dry)
    p("archive-index.json: %s / 日付%d種 計%d件"
      % ("・".join("%s(%d)" % (m["month"], m["count"]) for m in months),
         len(index["days"]), sum(days.values())))

    # 7) index.html の updatedAt
    html_path = path("index.html")
    html = open(html_path, encoding="utf-8").read()
    new_html, n = re.subn(r'(updatedAt:\s*")[^"]*(")', r"\g<1>%s\g<2>" % stamp, html, count=1)
    if n == 0:
        p("!! index.html の updatedAt が見つかりませんでした。手動で確認してください。")
    else:
        if not dry:
            open(html_path, "w", encoding="utf-8").write(new_html)
        p("index.html updatedAt: %s" % stamp)

    # 8) 設定と既存記事の見張り（止めずに警告だけ出す）
    m = re.search(r"newDays:\s*(-?\d+)", html)
    if m and m.group(1) != "1":
        p("!! index.html の newDays が %s です。指示文では 1 を維持することになっています。"
          % m.group(1))
    for a in news_out:
        blob = " ".join(str(a.get(k, "")) for k in ("title", "summary", "hint", "topReason"))
        for w in BANNED_WORDS:
            if w in blob:
                p("!! 掲載中の記事に禁止語「%s」: %s" % (w, a.get("title", "")[:40]))

    # 9) incoming.json を空に戻す（二重取り込み防止）
    if fresh and not dry:
        with open(path("incoming.json"), "w", encoding="utf-8") as f:
            f.write("[]\n")
        p("incoming.json を空に戻しました")

    if dry:
        p("\n--- dry-run のため書き込みはしていません ---")
    return 0


if __name__ == "__main__":
    sys.exit(main())
