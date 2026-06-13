/** Inline script: WebSocket to `/p/:projectId/ws` → repaint issue stream (Sentry-style layout). */

export function projectIssuesLiveScript(
  projectId: string,
  streamQuery: string,
  search = ""
): string {
  const id = JSON.stringify(projectId);
  const query = JSON.stringify(streamQuery);
  const searchJson = JSON.stringify(search.toLowerCase());
  return `(function () {
  var projectId = ${id};
  var streamQuery = ${query};
  var searchTerm = ${searchJson};
  var proto = location.protocol === "https:" ? "wss:" : "ws:";
  var wsUrl = proto + "//" + location.host + "/p/" + encodeURIComponent(projectId) + "/ws";
  var badgeClass = {
    unresolved: "border-amber-500/25 bg-amber-500/10 text-amber-400",
    resolved: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    ignored: "border-kumo-hairline bg-kumo-base text-kumo-subtle",
  };
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function statusBadgeClass(st) {
    return badgeClass[st] || badgeClass.unresolved;
  }
  function rowLastSeenMs(row) {
    var t = row.lastSeen;
    if (t == null) return Date.now();
    if (typeof t === "number") return t;
    var d = new Date(t);
    var ms = d.getTime();
    return isNaN(ms) ? Date.now() : ms;
  }
  function relTime(tsMs) {
    var sec = Math.floor((Date.now() - tsMs) / 1000);
    if (sec < 5) return "just now";
    if (sec < 60) return sec + "s ago";
    var min = Math.floor(sec / 60);
    if (min < 60) return min + "m ago";
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + "h ago";
    var day = Math.floor(hr / 24);
    if (day < 7) return day + "d ago";
    return new Date(tsMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function matchesSearch(r) {
    if (!searchTerm) return true;
    return (
      String(r.value || "").toLowerCase().indexOf(searchTerm) !== -1 ||
      String(r.type || "").toLowerCase().indexOf(searchTerm) !== -1 ||
      String(r.culprit || "").toLowerCase().indexOf(searchTerm) !== -1
    );
  }
  function applyStreamFilter(rows) {
    var byStatus;
    if (streamQuery === "is:all" || streamQuery === "all") {
      byStatus = rows;
    } else if (streamQuery === "is:resolved" || streamQuery === "resolved") {
      byStatus = rows.filter(function (r) { return r.status === "resolved"; });
    } else if (streamQuery === "is:ignored" || streamQuery === "ignored") {
      byStatus = rows.filter(function (r) { return r.status === "ignored"; });
    } else {
      byStatus = rows.filter(function (r) { return r.status === "unresolved"; });
    }
    return byStatus.filter(matchesSearch);
  }
  function issueSig(list) {
    return list
      .map(function (r) {
        return (
          r.id +
          ":" +
          r.status +
          ":" +
          (r.eventsCount || 0) +
          ":" +
          String(r.culprit || "") +
          ":" +
          rowLastSeenMs(r)
        );
      })
      .join("|");
  }
  var lastIssuesSig = null;
  var UPDATE_BADGE_ON =
    "inline-flex items-center gap-1 rounded-md border border-sky-500/35 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.12)]";
  var UPDATE_BADGE_OFF = "hidden";
  var updateBadgeTimer;
  function flashUpdateNotice() {
    var el = document.getElementById("wana-update-badge");
    if (!el) return;
    if (updateBadgeTimer) clearTimeout(updateBadgeTimer);
    el.className = UPDATE_BADGE_ON;
    el.innerHTML =
      '<span class="relative flex h-2 w-2 shrink-0" aria-hidden="true">' +
      '<span class="absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-60 motion-safe:animate-ping"></span>' +
      '<span class="relative inline-flex h-2 w-2 rounded-full bg-sky-400"></span></span>' +
      "<span>更新</span>";
    updateBadgeTimer = setTimeout(function () {
      el.className = UPDATE_BADGE_OFF;
      el.innerHTML = "";
    }, 2200);
  }
  function render(msg) {
    if (!msg || msg.type !== "issues" || !Array.isArray(msg.issues)) return;
    var filtered = applyStreamFilter(msg.issues);
    var sig = issueSig(filtered);
    var changed = lastIssuesSig !== null && sig !== lastIssuesSig;
    lastIssuesSig = sig;
    var countEl = document.getElementById("wana-issues-count");
    var bodyEl = document.getElementById("wana-issues-body");
    if (!bodyEl) return;
    var n = filtered.length;
    if (countEl) {
      countEl.textContent = n > 0 ? n + " issues" : "";
    }
    if (changed) flashUpdateNotice();

    var total = msg.issues.length;
    if (total === 0) {
      bodyEl.innerHTML =
        '<div class="px-6 py-14 text-center"><p class="text-sm text-kumo-subtle">まだ issue がありません。SDK 経由でエラーを送信すると、ここに表示されます。</p><p class="mt-2 text-xs text-kumo-subtle">設定ページから DSN を確認してください。</p></div>';
      return;
    }
    if (n === 0) {
      var msgEmpty =
        streamQuery === "is:all"
          ? "このプロジェクトにはまだ issue がありません。"
          : streamQuery === "is:unresolved"
            ? "未解決の issue はありません。"
            : streamQuery === "is:resolved"
              ? "解決済みの issue はありません。"
              : streamQuery === "is:ignored"
                ? "無視中の issue はありません。"
                : "条件に一致する issue はありません。";
      bodyEl.innerHTML =
        '<div class="px-6 py-14 text-center"><p class="text-sm text-kumo-subtle">' +
        esc(msgEmpty) +
        '</p><p class="mt-2 text-xs text-kumo-subtle">上のタブを切り替えるか、issue 詳細から状態を変更してください。</p></div>';
      return;
    }

    var head =
      '<div class="wana-issue-stream divide-y divide-kumo-hairline">' +
      '<div class="hidden gap-0 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle sm:grid sm:grid-cols-[minmax(0,1fr)_7rem_5rem_6.5rem]" role="row">' +
      '<div class="pr-4">Issue</div><div class="text-right">Last seen</div><div class="text-right">Events</div><div class="text-right">Status</div></div>';

    var rows = filtered
      .map(function (row) {
        var bc = statusBadgeClass(row.status);
        var cul = row.culprit != null && row.culprit !== "" ? row.culprit : "—";
        var seen = relTime(rowLastSeenMs(row));
        return (
          '<a class="group grid gap-3 px-5 py-4 transition-colors hover:bg-kumo-base sm:grid-cols-[minmax(0,1fr)_7rem_5rem_6.5rem] sm:items-center sm:gap-0" href="/p/' +
          esc(projectId) +
          "/issues/" +
          esc(row.id) +
          '">' +
          '<div class="min-w-0 space-y-1 pr-4">' +
          '<p class="text-[15px] font-semibold leading-snug text-kumo-default group-hover:text-amber-400">' +
          esc(row.value) +
          "</p>" +
          '<p class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-kumo-subtle">' +
          '<span class="font-medium text-kumo-subtle">' +
          esc(row.type) +
          '</span><span class="text-kumo-subtle" aria-hidden="true">|</span>' +
          '<span class="truncate font-mono text-[11px] text-kumo-subtle">' +
          esc(cul) +
          "</span></p></div>" +
          '<div class="text-left text-xs tabular-nums text-kumo-subtle sm:text-right">' +
          '<span class="text-kumo-subtle sm:hidden">Last seen: </span>' +
          esc(seen) +
          "</div>" +
          '<div class="text-left text-xs tabular-nums text-kumo-subtle sm:text-right">' +
          '<span class="text-kumo-subtle sm:hidden">Events: </span>' +
          row.eventsCount +
          "</div>" +
          '<div class="flex sm:justify-end"><span class="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums ' +
          bc +
          '">' +
          esc(row.status) +
          "</span></div></a>"
        );
      })
      .join("");

    bodyEl.innerHTML = head + rows + "</div>";
  }
  var LIVE_WRAP =
    "inline-flex items-center gap-2 rounded-full border px-2.5 py-1";
  var DOT_BASE = "h-2 w-2 shrink-0 rounded-full ";
  function setLiveState(mode, label) {
    var wrap = document.getElementById("wana-live-indicator");
    var dot = document.getElementById("wana-live-dot");
    var text = document.getElementById("wana-live-label");
    if (!wrap || !dot || !text) return;
    text.textContent = label;
    if (mode === "live") {
      wrap.className =
        LIVE_WRAP +
        " border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_14px_rgba(16,185,129,0.12)]";
      dot.className =
        DOT_BASE +
        "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.65)] animate-pulse ring-2 ring-emerald-500/30";
      text.className = "text-xs font-medium tabular-nums text-emerald-300/95";
      return;
    }
    if (mode === "error") {
      wrap.className = LIVE_WRAP + " border-amber-500/35 bg-amber-500/10";
      dot.className = DOT_BASE + "bg-amber-400 ring-2 ring-amber-500/25";
      text.className = "text-xs font-medium tabular-nums text-amber-200/90";
      return;
    }
    wrap.className = LIVE_WRAP + " border-kumo-hairline bg-kumo-recessed";
    dot.className = DOT_BASE + "bg-kumo-line ring-2 ring-kumo-hairline";
    text.className = "text-xs font-medium tabular-nums text-kumo-subtle";
  }
  var ws;
  var pingTimer;
  function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    setLiveState("connecting", "接続中…");
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      setLiveState("error", "接続できません");
      return;
    }
    ws.onopen = function () {
      setLiveState("live", "ライブ更新");
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(function () {
        try {
          if (ws && ws.readyState === WebSocket.OPEN) ws.send("ping");
        } catch (_) {}
      }, 25000);
    };
    ws.onmessage = function (ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg.type === "pong") return;
        render(msg);
      } catch (_) {}
    };
    ws.onerror = function () {
      setLiveState("error", "接続エラー");
    };
    ws.onclose = function () {
      setLiveState("idle", "再接続中…");
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      setTimeout(connect, 3000);
    };
  }
  connect();
})();`;
}
