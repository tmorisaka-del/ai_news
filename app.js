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
    "SNSの話題":    "var(--c-sns)"
  };
  var WD = ["日", "月", "火", "水", "木", "金", "土"];

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
      '<article>' +
        '<div class="meta">' +
          '<span class="cat" style="background:' + (CAT_COLORS[n.category] || "var(--primary)") + '">' + esc(n.category) + '</span>' +
          '<span class="date">' + fmtDate(n.date) + ' 掲載</span>' +
          (isNew(n.date) ? '<span class="badge-new">NEW</span>' : "") +
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

  function renderHeaderDateWeather() {
    var dateEl = document.getElementById("t-date");
    var weatherEl = document.getElementById("t-weather");
    if (!dateEl) return;
    var now = new Date();
    dateEl.textContent = now.getFullYear() + "年" + (now.getMonth() + 1) + "月" + now.getDate() + "日（" + WD[now.getDay()] + "）";
    if (!weatherEl) return;

    function codeToWeather(c) {
      if (c === 0) return ["☀️", "快晴"];
      if (c === 1) return ["🌤️", "晴れ"];
      if (c === 2) return ["⛅", "晴れ時々くもり"];
      if (c === 3) return ["☁️", "くもり"];
      if (c === 45 || c === 48) return ["🌫️", "霧"];
      if (c >= 51 && c <= 57) return ["🌦️", "霧雨"];
      if (c >= 61 && c <= 67) return ["🌧️", "雨"];
      if (c >= 71 && c <= 77) return ["🌨️", "雪"];
      if (c >= 80 && c <= 82) return ["🌦️", "にわか雨"];
      if (c === 85 || c === 86) return ["🌨️", "雪"];
      if (c >= 95) return ["⛈️", "雷雨"];
      return ["🌡️", "天気"];
    }

    fetch("https://api.open-meteo.com/v1/forecast?latitude=35.66&longitude=139.75&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=Asia%2FTokyo")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var w = codeToWeather(d.current.weather_code);
        var t = Math.round(d.current.temperature_2m);
        var hi = Math.round(d.daily.temperature_2m_max[0]);
        var lo = Math.round(d.daily.temperature_2m_min[0]);
        weatherEl.textContent = "東京 " + w[0] + " " + w[1] + " " + t + "℃（最高" + hi + "℃／最低" + lo + "℃）";
      })
      .catch(function () {
        weatherEl.textContent = "";
        if (weatherEl.previousElementSibling) weatherEl.previousElementSibling.style.display = "none";
      });
  }

  function fail(msg) {
    if (listEl) {
      listEl.innerHTML = '<div class="empty"><div class="face">😢</div>' + esc(msg) +
        '<br>時間をおいて再読み込みしてください。</div>';
    }
  }

  function start() {
    buildChips();
    render();
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
    renderHeaderDateWeather(); // archiveでは #t-date が無ければ何もしません
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
    renderHeaderDateWeather();
    getJSON("news.json")
      .then(function (data) {
        NEWS_DATA = data;
        start();
        renderTop();
      })
      .catch(function (e) { console.error(e); fail("最新ニュースを読み込めませんでした。"); });

    getJSON("archive-index.json")
      .then(function (index) { renderArchiveList(index.days || []); })
      .catch(function (e) { console.error(e); });
  }
})();
