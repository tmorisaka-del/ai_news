/* =========================================================
   AIニュースまとめ（社内版）共通スクリプト
   - index.html と archive.html で共用します。
   - ページ側で window.PAGE_CONFIG = { mode, newDays } を指定します。
       mode    : "index"（トップ）/ "archive"（アーカイブ）
       newDays : 掲載からこの日数はNEW表示（アーカイブは -1 で常に非表示）
   - 記事データは JSON を fetch して読み込みます（HTMLには埋め込みません）。
   ★通常の更新では原則このファイルは編集しません。編集するのは JSON だけです。
========================================================= */
(function () {
  "use strict";

  var CFG = window.PAGE_CONFIG || { mode: "index", newDays: 4 };

  var CAT_COLORS = {
    "法規制・権利": "var(--c-law)",
    "人材・組織":   "var(--c-hr)",
    "経営・投資":   "var(--c-biz)",
    "業務ツール":   "var(--c-tool)",
    "海外の動き":   "var(--c-world)",
    "産業動向":     "var(--c-ind)",
    "SNSの話題":    "var(--c-sns)",
    "成功事例":     "#c99700"
  };
  var WD = ["日", "月", "火", "水", "木", "金", "土"];

  /* ▼ フロント表示ルール（例外的にapp.jsへ実装）
     土日祝を「営業日」に数えず、2営業日前までのカードを表示する。
     ・その範囲内にある土日祝の日付の記事は表示される（数えないだけ）。
     ・HOLIDAYS は日本の祝日（振替休日・国民の休日含む）。年ごとに要更新。 */
  var FRONT_BUSINESS_DAYS = 2;
  var HOLIDAYS = { "2026-01-01": true, "2026-01-12": true, "2026-02-11": true, "2026-02-23": true, "2026-03-20": true, "2026-04-29": true, "2026-05-03": true, "2026-05-04": true, "2026-05-05": true, "2026-05-06": true, "2026-07-20": true, "2026-08-11": true, "2026-09-21": true, "2026-09-22": true, "2026-09-23": true, "2026-10-12": true, "2026-11-03": true, "2026-11-23": true, "2027-01-01": true, "2027-01-11": true, "2027-02-11": true, "2027-02-23": true, "2027-03-21": true, "2027-03-22": true, "2027-04-29": true, "2027-05-03": true, "2027-05-04": true, "2027-05-05": true, "2027-07-19": true, "2027-08-11": true, "2027-09-20": true, "2027-09-23": true, "2027-10-11": true, "2027-11-03": true, "2027-11-23": true };
  function ymd(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
  }
  function isNonBusiness(d) {
    var w = d.getDay();
    return w === 0 || w === 6 || HOLIDAYS[ymd(d)] === true;
  }
  function frontCutoff(nDays) {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    var counted = 0;
    while (counted < nDays) {
      d.setDate(d.getDate() - 1);
      if (!isNonBusiness(d)) counted++;
    }
    return ymd(d);
  }

  var listEl  = document.getElementById("list");
  var qEl     = document.getElementById("q");
  var chipsEl = document.getElementById("chips");
  var countEl = document.getElementById("count");

  var NEWS_DATA = [];
  var activeCat = "すべて";

  function fmtDate(s) {
    var d = new Date(s + "T00:00:00");
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日（" + WD[d.getDay()] + "）";
  }
  function isNew(s) {
    if (CFG.newDays < 0) return false;
    var d = new Date(s + "T00:00:00");
    return (Date.now() - d.getTime()) / 86400000 <= CFG.newDays;
  }
  function esc(t) {
    return String(t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function cardHTML(n) {
    return "" +
      '<article' + (isNew(n.postedAt || n.date) ? ' class="is-new"' : (n.pickup ? ' class="is-pickup"' : "")) + '>' +
        '<div class="meta">' +
          '<span class="cat" style="background:' + (CAT_COLORS[n.category] || "var(--primary)") + '">' + esc(n.category) + '</span>' +
          '<span class="date">' + fmtDate(n.date) + ' 掲載</span>' +
          (isNew(n.postedAt || n.date) ? '<span class="badge-new">NEW</span>' : "") +
          (n.pickup ? '<span class="badge-pickup">再掲</span>' : "") +
        '</div>' +
        '<h3>' + esc(n.title) + '</h3>' +
        '<p>' + esc(n.summary) + '</p>' +
        (n.hint ? '<div class="hint"><b class="h">注目ポイント：</b>' + esc(n.hint) + '</div>' : "") +
        (n.terms && n.terms.length
          ? '<div class="terms"><span class="t-title">用語解説</span>' +
            n.terms.map(function (t) {
              return '<div class="term-row"><dt>' + esc(t.word) + '</dt><dd>' + esc(t.desc) + '</dd></div>';
            }).join("") + '</div>'
          : "") +
        '<div class="src">出典：<a href="' + esc(n.source.url) + '" target="_blank" rel="noopener">' + esc(n.source.label) + '</a></div>' +
      '</article>';
  }

  function buildChips() {
    var cats = ["すべて"].concat(Object.keys(CAT_COLORS).filter(function (c) {
      return NEWS_DATA.some(function (n) { return n.category === c; });
    }));
    chipsEl.innerHTML = cats.map(function (c) {
      return '<button class="chip' + (c === activeCat ? " active" : "") + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
    }).join("");
    Array.prototype.forEach.call(chipsEl.querySelectorAll(".chip"), function (b) {
      b.addEventListener("click", function () {
        activeCat = b.dataset.cat;
        buildChips();
        render();
      });
    });
  }

  function render() {
    var q = qEl.value.trim().toLowerCase();
    var sorted = NEWS_DATA.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    var hits = sorted.filter(function (n) {
      if (activeCat !== "すべて" && n.category !== activeCat) return false;
      if (!q) return true;
      var hay = [n.title, n.summary, n.hint, n.category, n.date]
        .concat((n.terms || []).reduce(function (acc, t) { return acc.concat([t.word, t.desc]); }, []))
        .join(" ").toLowerCase();
      return q.split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
    });

    if (CFG.mode === "archive") {
      countEl.innerHTML = (q || activeCat !== "すべて")
        ? "<b>" + hits.length + "</b> 件が見つかりました（全 " + NEWS_DATA.length + " 件）"
        : "全 <b>" + NEWS_DATA.length + "</b> 件を掲載中";
    } else {
      countEl.innerHTML = (q || activeCat !== "すべて")
        ? "<b>" + hits.length + "</b> 件が見つかりました（全 " + NEWS_DATA.length + " 件）"
        : "直近 <b>" + NEWS_DATA.length + "</b> 件を掲載中（過去分は下部のアーカイブから）";
    }

    if (hits.length === 0) {
      listEl.innerHTML = '<div class="empty"><div class="face">🔍</div>見つかりませんでした。<br>別の言葉で検索してみてください。</div>';
      return;
    }

    if (CFG.mode === "archive") {
      var prevD = null;
      listEl.innerHTML = hits.map(function (n) {
        var head = n.date !== prevD ? '<div class="day-head" id="d' + n.date + '">' + fmtDate(n.date) + 'のニュース</div>' : "";
        prevD = n.date;
        return head + cardHTML(n);
      }).join("");
    } else {
      listEl.innerHTML = hits.map(cardHTML).join("");
    }
  }

  function renderTop() {
    var el = document.getElementById("topnews");
    if (!el) return;
    var tops = NEWS_DATA.filter(function (n) { return n.topReason; })
      .sort(function (a, b) { return b.date.localeCompare(a.date); });
    if (!tops.length) { el.style.display = "none"; el.innerHTML = ""; return; }
    var n = tops[0];
    el.style.display = "";
    el.innerHTML = "" +
      '<span class="tn-label">☀ 今日のトップニュース</span>' +
      '<h2>' + esc(n.title) + '</h2>' +
      '<div class="tn-summary">' + esc(n.summary) + '</div>' +
      '<div class="tn-reason"><b>注目ポイント：</b>' + esc(n.topReason) + '</div>' +
      '<div class="tn-src">出典：<a href="' + esc(n.source.url) + '" target="_blank" rel="noopener">' + esc(n.source.label) + '</a></div>';
  }

  function renderArchiveList(days) {
    var el = document.getElementById("archive-list");
    if (!el) return;
    el.innerHTML = (days || []).map(function (a) {
      var d = new Date(a.date + "T00:00:00");
      return '<a class="archive-row" href="archive.html#d' + a.date + '"><span>' +
        (d.getMonth() + 1) + '月' + d.getDate() + '日（' + WD[d.getDay()] + '）分ニュース</span>' +
        '<span class="a-count">' + a.count + '件</span></a>';
    }).join("");
  }


  function fail(msg) {
    if (listEl) {
      listEl.innerHTML = '<div class="empty"><div class="face">😢</div>' + esc(msg) +
        '<br>時間をおいて再読み込みしてください。</div>';
    }
  }

  function renderLastUpdated() {
    var el = document.getElementById("last-updated");
    if (!el) return;
    if (CFG.updatedAt) { el.textContent = CFG.updatedAt; return; }
    if (!NEWS_DATA.length) return;
    var latest = NEWS_DATA.reduce(function (a, b) { return a > b.date ? a : b.date; }, "");
    if (latest) el.textContent = fmtDate(latest);
  }

  function start() {
    buildChips();
    render();
    renderLastUpdated();
    if (qEl) qEl.addEventListener("input", render);
  }

  function getJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(url + " 取得失敗 (" + r.status + ")");
      return r.json();
    });
  }

  /* ============ ページ別の初期化 ============ */
  if (CFG.mode === "archive") {
    getJSON("archive-index.json")
      .then(function (index) {
        var months = (index.months || []).map(function (m) { return m.month; });
        return Promise.all(months.map(function (m) { return getJSON("archive-" + m + ".json"); }));
      })
      .then(function (chunks) {
        NEWS_DATA = chunks.reduce(function (acc, c) { return acc.concat(c); }, []);
        start();
      })
      .catch(function (e) { console.error(e); fail("アーカイブ記事を読み込めませんでした。"); });
  } else {
    getJSON("news.json")
      .then(function (data) {
        var cutoff = frontCutoff(FRONT_BUSINESS_DAYS);
        NEWS_DATA = data.filter(function (n) { return n.date >= cutoff || n.pickup; });
        start();
        renderTop();
        renderLastUpdated();
      })
      .catch(function (e) { console.error(e); fail("最新ニュースを読み込めませんでした。"); });

    getJSON("archive-index.json")
      .then(function (index) { renderArchiveList(index.days || []); })
      .catch(function (e) { console.error(e); });
  }
})();
