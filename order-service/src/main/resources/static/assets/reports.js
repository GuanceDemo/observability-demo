(() => {
  "use strict";
  const copy = {
    zh: {
      kpisLabel: "经营指标",
      brand: "可观测性书店",
      workspace: "经营工作台",
      back: "返回商城 ↗",
      title: "每一笔订单，都有迹可循。",
      subtitle: "从真实订单到经营洞察，查看近 7 日销售与数据更新情况。",
      sevenDays: "近 7 个自然日",
      refresh: "刷新数据",
      loading: "正在读取经营报表…",
      timezone: "北京时间 · 每 5 分钟更新",
      revenue: "7 日营业额",
      revenueHint: "已确认订单的实际总金额",
      orders: "成交订单",
      ordersHint: "近 7 日有效订单数",
      units: "售出件数",
      unitsHint: "按订单购买数量统计",
      average: "平均客单价",
      averageHint: "营业额 ÷ 成交订单",
      trend: "销售趋势",
      trendHint: "观察日销售变化与短期均值",
      revenueShort: "营业额",
      ordersShort: "订单量",
      movingAverage: "3 日移动平均",
      updates: "数据更新",
      updatesHint: "每份报表，追溯到来源批次",
      sourceTitle: "订单清洗与销售汇总",
      sourceDescription: "Python · 真实订单数据源",
      updateNote:
        "作业失败时保留最近成功结果。当前日期尚未结束，日环比暂不计算。",
      provenance: "查看报表批次",
      details: "每日经营明细",
      detailsHint: "指标来自同一成功批次，可与数据库和血缘作业对照",
      date: "日期",
      change: "日环比",
      revenueChange: "营业额日环比",
      share: "营业额占比",
      tableNote:
        "金额单位：人民币。仅统计有效已确认订单，订单总额不重复乘以购买数量。环比为「—」表示当天未结束、无前日数据或前日营业额为零。",
      footer: "真实业务数据 · 可追溯的数据旅程",
      partial: "未结束",
      asOf: "源数据截至",
      generated: "报表生成于",
      stale: "数据超过 15 分钟未更新，当前展示最近成功报表。请查看作业状态。",
      failed: "最近一次作业未完成，当前展示上一次成功报表。",
      empty: "报表尚未生成，等待 Java 日报与 Spark 趋势作业完成后刷新。",
      disabled: "经营报表暂未启用。配置报表只读连接后即可查看。",
      unavailable: "暂时无法读取报表，请稍后刷新。",
      dailyTitle: "经营日报",
      trendTitle: "销售趋势",
      completed: "成功",
      running: "运行中",
      failure: "失败",
      aborted: "中止",
      waiting: "等待运行",
      javaDescription: "Java · 日报指标计算",
      sparkDescription: "Spark SQL · 窗口分析",
      sourceBatch: "Python 来源批次",
      javaBatch: "Java 日报批次",
      sparkBatch: "Spark 报表批次",
      selectedDate: "选择日期",
      metricsLabel: "趋势指标",
      chartLabel: "每日销售趋势，详细数值见下方明细表",
    },
    en: {
      kpisLabel: "Business metrics",
      brand: "Observability Books",
      workspace: "Business workspace",
      back: "Back to store ↗",
      title: "Every order tells a story.",
      subtitle:
        "Explore seven days of real sales, from source orders to business insights.",
      sevenDays: "Last 7 calendar days",
      refresh: "Refresh data",
      loading: "Loading your sales report…",
      timezone: "Asia/Shanghai · Updated every 5 minutes",
      revenue: "7-day revenue",
      revenueHint: "Actual totals of confirmed orders",
      orders: "Orders",
      ordersHint: "Valid orders over the last 7 days",
      units: "Units sold",
      unitsHint: "Total quantities purchased",
      average: "Average order value",
      averageHint: "Revenue ÷ completed orders",
      trend: "Sales trend",
      trendHint: "Daily performance and the short-term average",
      revenueShort: "Revenue",
      ordersShort: "Orders",
      movingAverage: "3-day moving average",
      updates: "Data updates",
      updatesHint: "Trace every report to its source batch",
      sourceTitle: "Order cleansing & aggregation",
      sourceDescription: "Python · Real order source",
      updateNote:
        "Failed jobs preserve the last successful report. Today is incomplete, so its daily change is not calculated.",
      provenance: "View report batches",
      details: "Daily performance",
      detailsHint:
        "All metrics use one successful batch, ready for SQL and lineage checks",
      date: "Date",
      change: "Day-over-day",
      revenueChange: "Revenue day-over-day",
      share: "Revenue share",
      tableNote:
        "Amounts are in CNY. Only valid confirmed orders are counted. Order totals are not multiplied by quantity again. A dash means an incomplete day, missing prior day, or zero prior-day revenue.",
      footer: "Real business data · A traceable data journey",
      partial: "In progress",
      asOf: "Source data as of",
      generated: "Report generated",
      stale:
        "Source data is over 15 minutes old. Showing the last successful report. Check job status for updates.",
      failed:
        "The latest job did not complete. The last successful report is shown.",
      empty:
        "No report yet. Refresh after the Java daily report and Spark trend jobs complete.",
      disabled:
        "Sales reports are not enabled. Configure the read-only reporting connection to view them.",
      unavailable:
        "The report is temporarily unavailable. Please refresh later.",
      dailyTitle: "Business daily",
      trendTitle: "Sales trend",
      completed: "Success",
      running: "Running",
      failure: "Failed",
      aborted: "Aborted",
      waiting: "Waiting",
      javaDescription: "Java · Daily business metrics",
      sparkDescription: "Spark SQL · Window analytics",
      sourceBatch: "Python source batch",
      javaBatch: "Java daily batch",
      sparkBatch: "Spark report batch",
      selectedDate: "Select a date",
      metricsLabel: "Trend metric",
      chartLabel: "Daily sales trend. Detailed values are in the table below.",
    },
  };
  const params = new URL(location.href).searchParams;
  const state = {
    language: params.get("lang") === "en" ? "en" : "zh",
    data: null,
    metric: "revenue",
    selected: 6,
    error: "",
    loading: false,
  };
  const el = (id) => document.getElementById(id);
  const t = (key) => copy[state.language][key] || key;
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  const number = (value) =>
    new Intl.NumberFormat(state.language === "en" ? "en-US" : "zh-CN", {
      maximumFractionDigits: 0,
    }).format(value);
  const money = (cents) =>
    new Intl.NumberFormat(state.language === "en" ? "en-US" : "zh-CN", {
      style: "currency",
      currency: "CNY",
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 2,
    }).format(Number(cents) / 100);
  const time = (value) =>
    value
      ? new Intl.DateTimeFormat(state.language === "en" ? "en-GB" : "zh-CN", {
          timeZone: "Asia/Shanghai",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(new Date(value))
      : "—";
  const change = (value) =>
    value == null
      ? "—"
      : `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(1)}%`;
  const changeClass = (value) =>
    value == null
      ? ""
      : Number(value) > 0
        ? "positive"
        : Number(value) < 0
          ? "negative"
          : "";
  const action = (name, context = {}) =>
    window.DATAFLUX_RUM?.addAction?.(name, context);
  function text() {
    document.documentElement.lang = state.language === "en" ? "en" : "zh-CN";
    document.title = `${t("details")} · ${t("brand")}`;
    document.querySelectorAll("[data-copy]").forEach((node) => {
      node.textContent = t(node.dataset.copy);
    });
    el("language").textContent = state.language === "en" ? "中" : "EN";
    el("language").setAttribute(
      "aria-label",
      state.language === "en" ? "切换为中文" : "Switch to English",
    );
    el("shopLink").href = el("backLink").href =
      `shop.html?lang=${state.language}`;
    el("dayPicker").setAttribute("aria-label", t("selectedDate"));
    document
      .querySelector(".metric-switch")
      .setAttribute("aria-label", t("metricsLabel"));
    document.querySelector(".kpis").setAttribute("aria-label", t("kpisLabel"));
    render();
  }
  function render() {
    const data = state.data;
    const ready = data?.status === "ready";
    el("report").hidden = !ready;
    el("refresh").disabled = state.loading;
    const failed =
      ready && data.jobs?.some((job) => ["FAIL", "ABORT"].includes(job.state));
    const message =
      state.error ||
      (!data
        ? "loading"
        : data.status !== "ready"
          ? data.status
          : data.stale
            ? "stale"
            : failed
              ? "failed"
              : "");
    el("notice").hidden = !message;
    el("notice").classList.toggle("error", !!state.error);
    el("notice").textContent = message ? t(message) : "";
    if (!ready) return;
    el("dateRange").textContent =
      `${data.days[0].date.replaceAll("-", ".")} — ${data.days.at(-1).date.slice(5).replace("-", ".")}`;
    el("freshnessText").textContent =
      `${t("asOf")} ${time(data.sourceUpdatedAt)} · ${t("generated")} ${time(data.generatedAt)}`;
    el("freshnessDot").classList.toggle("stale", data.stale);
    el("revenue").textContent = money(data.summary.revenueCent);
    el("orders").textContent = number(data.summary.orders);
    el("units").textContent = number(data.summary.units);
    el("average").textContent = money(data.summary.averageOrderCent);
    renderChart();
    renderJobs();
    el("dailyRows").innerHTML = data.days
      .map(
        (day, i) => `<tr class="${i === state.selected ? "selected" : ""}">
      <td>${escape(day.date)}${day.partial ? `<span class="tag">${t("partial")}</span>` : ""}</td>
      <td>${number(day.orders)}</td><td>${number(day.units)}</td><td>${money(day.revenueCent)}</td><td>${money(day.averageOrderCent)}</td>
      <td class="${changeClass(day.revenueChangePct)}">${change(day.revenueChangePct)}</td><td>${Number(day.revenueSharePct).toFixed(1)}%</td></tr>`,
      )
      .join("");
    el("provenance").innerHTML = [
      ["sourceBatch", data.sourceRunId],
      ["javaBatch", data.upstreamRunId],
      ["sparkBatch", data.runId],
    ]
      .map(([key, value]) => `<dt>${t(key)}</dt><dd>${escape(value)}</dd>`)
      .join("");
  }
  function renderChart() {
    const days = state.data.days;
    const revenue = state.metric === "revenue";
    const values = days.map((d) =>
      revenue ? Number(d.revenueCent) / 100 : Number(d.orders),
    );
    const averages = days.map((d) => Number(d.movingAverage3dCent) / 100);
    const largest = Math.max(1, ...values, ...(revenue ? averages : []));
    const magnitude = Math.pow(10, Math.floor(Math.log10(largest)));
    const max = Math.ceil(largest / magnitude / 0.5) * magnitude * 0.5;
    const width = 680,
      height = 244,
      left = 48,
      top = 20,
      bottom = 224,
      right = 664;
    const slot = (right - left) / days.length;
    const y = (value) => bottom - (value / max) * (bottom - top);
    const x = (index) => left + slot * (index + 0.5);
    const axisNumber = (value) =>
      value >= 10000 ? `${Math.round(value / 1000)}k` : number(value);
    const grid = Array.from({ length: 5 }, (_, i) => {
      const value = (max * i) / 4,
        cy = y(value);
      return `<line class="grid" x1="${left}" y1="${cy}" x2="${right}" y2="${cy}"/><text x="${left - 10}" y="${cy + 3}" text-anchor="end">${axisNumber(value)}</text>`;
    }).join("");
    const bars = values
      .map(
        (value, i) =>
          `<rect x="${x(i) - 15}" y="${y(value)}" width="30" height="${Math.max(0, bottom - y(value))}" rx="4" fill="${i === state.selected ? "#e77945" : "#f3c3a3"}" opacity="${days[i].partial ? "0.65" : "1"}"/>`,
      )
      .join("");
    const line = revenue
      ? `<polyline class="average-line" points="${averages.map((value, i) => `${x(i)},${y(value)}`).join(" ")}"/>${averages.map((value, i) => `<circle cx="${x(i)}" cy="${y(value)}" r="3" fill="white" stroke="#8097b6" stroke-width="1.5"/>`).join("")}`
      : "";
    el("chart").innerHTML =
      `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(t("chartLabel"))}">${grid}${bars}${line}</svg>`;
    el("metricLabel").textContent = t(revenue ? "revenueShort" : "ordersShort");
    el("chartUnit").textContent = revenue ? "CNY" : t("ordersShort");
    el("averageLegend").hidden = !revenue;
    document
      .querySelectorAll("[data-metric]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.metric === state.metric),
        ),
      );
    el("dayPicker").innerHTML = days
      .map(
        (day, i) =>
          `<button type="button" data-day="${i}" aria-pressed="${i === state.selected}" aria-label="${escape(day.date)}">${day.date.slice(5).replace("-", "/")}</button>`,
      )
      .join("");
    const day = days[state.selected];
    el("dayDetail").innerHTML =
      `<span>${escape(day.date)}</span><strong>${revenue ? money(day.revenueCent) : number(day.orders)}</strong>${day.partial ? `<span class="tag">${t("partial")}</span>` : ""}<span>${t("revenueChange")} <span class="${changeClass(day.revenueChangePct)}">${change(day.revenueChangePct)}</span></span>`;
  }
  function renderJobs() {
    const states = {
      COMPLETE: "completed",
      START: "running",
      FAIL: "failure",
      ABORT: "aborted",
    };
    el("jobCards").innerHTML = [
      ["business_daily", "java", "J", "dailyTitle", "javaDescription"],
      ["sales_trend", "spark", "S", "trendTitle", "sparkDescription"],
    ]
      .map(([name, engine, letter, title, description]) => {
        const job = state.data.jobs?.find((item) => item.job === name);
        return `<div class="job-card"><span class="engine ${engine}">${letter}</span><div><strong>${t(title)}</strong><small>${t(description)}</small><span class="job-time">${time(job?.finishedAt || job?.startedAt)}</span></div><span class="job-state ${job?.state !== "COMPLETE" ? "warn" : ""}">${t(states[job?.state] || "waiting")}</span></div>`;
      })
      .join("");
  }
  let request;
  let generation = 0;
  async function load(manual = false) {
    const current = ++generation;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    state.loading = true;
    state.error = "";
    render();
    try {
      const response = await fetch("/api/reports/sales", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (
        data.status === "ready" &&
        (!Array.isArray(data.days) || data.days.length !== 7 || !data.summary)
      )
        throw new Error("Invalid report");
      if (current !== generation) return;
      state.data = data;
      if (manual)
        action("sales_report_refreshed", {
          report_status: data.status,
          source_run_id: data.sourceRunId,
        });
    } catch (error) {
      if (current !== generation) return;
      state.error = "unavailable";
    } finally {
      clearTimeout(timeout);
      if (current === generation) {
        state.loading = false;
        render();
      }
    }
  }
  el("refresh").addEventListener("click", () => load(true));
  el("language").addEventListener("click", () => {
    state.language = state.language === "en" ? "zh" : "en";
    const url = new URL(location.href);
    url.searchParams.set("lang", state.language);
    history.replaceState(null, "", url);
    text();
  });
  document
    .querySelector(".metric-switch")
    .addEventListener("click", (event) => {
      const button = event.target.closest("[data-metric]");
      if (!button) return;
      state.metric = button.dataset.metric;
      render();
      action("sales_report_metric_selected", { metric: state.metric });
    });
  el("dayPicker").addEventListener("click", (event) => {
    const button = event.target.closest("[data-day]");
    if (!button) return;
    state.selected = Number(button.dataset.day);
    render();
    // Restore keyboard focus after replacing the day picker DOM.
    el("dayPicker")
      .querySelector(`[data-day="${state.selected}"]`)
      ?.focus({ preventScroll: true });
  });
  async function initRum() {
    try {
      const response = await fetch("/api/demo/rum-config", {
        cache: "no-store",
      });
      if (!response.ok) return;
      const config = await response.json();
      if (!config.enabled || !config.applicationId) return;
      if (!window.DATAFLUX_RUM)
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = `https://static.${config.datakitProvider === "truewatch" ? "truewatch" : "guance"}.com/browser-sdk/v3/dataflux-rum.js`;
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      const rum = window.DATAFLUX_RUM;
      if (!rum) return;
      rum.init({
        applicationId: config.applicationId,
        datakitOrigin: config.datakitOrigin,
        env: config.env,
        version: config.version,
        service: config.service,
        sessionSampleRate: config.sessionSampleRate ?? 100,
        sessionReplaySampleRate: config.sessionReplaySampleRate ?? 100,
        sessionReplayOnErrorSampleRate:
          config.sessionReplayOnErrorSampleRate ?? 100,
        sessionPersistence: "local-storage",
        trackViewsManually: true,
        defaultPrivacyLevel: "mask-user-input",
        trackInteractions: true,
        trackResources: true,
        trackLongTasks: true,
        compressIntakeRequests: config.compressIntakeRequests !== false,
        traceType: config.traceType || "ddtrace",
        allowedTracingOrigins: [location.origin],
      });
      rum.startSessionReplayRecording?.();
      rum.setGlobalContextProperty?.("project", config.project);
      rum.setGlobalContextProperty?.("page", "sales-report");
      rum.startView({ name: "sales-report" });
    } catch (_) {
      /* Reporting remains usable when the optional RUM SDK is unavailable. */
    }
  }
  text();
  load();
  initRum();
  setInterval(() => {
    if (document.visibilityState === "visible" && !state.loading) load();
  }, 60000);
})();
