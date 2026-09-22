/* Allok — monthly CHF allocation. sessionStorage only, no libraries. */
(() => {
  const KEY = "allok:v1";
  const MIX_KEYS = ["taxes", "cash", "btc", "realestate", "other"];
  const MIX_META = {
    taxes: { label: "Taxes", color: "var(--taxes)" },
    cash: { label: "Cash", color: "var(--cash)" },
    btc: { label: "BTC", color: "var(--btc)" },
    realestate: { label: "Real estate", color: "var(--realestate)" },
    other: { label: "Other assets", color: "var(--other)" },
  };
  /* Shares of the living slice (4663 CHF = 100% of living). Do not touch livingPct. */
  const LIVING_KEYS = ["rent", "css", "sports", "transport", "kita", "digital", "spend", "home"];
  const LIVING_META = {
    rent: { label: "Rent", color: "var(--rent)" },
    css: { label: "CSS", color: "var(--css)" },
    sports: { label: "Sports", color: "var(--sports)" },
    transport: { label: "Transport", color: "var(--transport)" },
    kita: { label: "Kita", color: "var(--kita)" },
    digital: { label: "Digital services", color: "var(--digital)" },
    spend: { label: "Spend allowance", color: "var(--spend)" },
    home: { label: "Home and kid", color: "var(--homekid)" },
  };
  const DEFAULT_LIVING_MIX = () => ({
    rent: 1650 / 4663 * 100,
    css: 560 / 4663 * 100,
    sports: 110 / 4663 * 100,
    transport: 50 / 4663 * 100,
    kita: 1293 / 4663 * 100,
    digital: 100 / 4663 * 100,
    spend: 600 / 4663 * 100,
    home: 300 / 4663 * 100,
  });
  const POTS = [
    { id: "backup", label: "Backup fund", color: "var(--backup)" },
    { id: "family", label: "Family fund", color: "var(--family)" },
    { id: "taxes", label: "Taxes", color: "var(--taxes)" },
    { id: "cash", label: "Cash", color: "var(--cash)" },
    { id: "btc", label: "BTC", color: "var(--btc)", crypto: true },
    { id: "realestate", label: "Real estate", color: "var(--realestate)" },
    { id: "other", label: "Other assets", color: "var(--other)" },
  ];

  const DEFAULT_MONTH = () => ({
    income: 1_000_000,
    livingPct: 55.75,
    backupOfSavedPct: 11.43089027,
    familyOfSavedPct: 5.715445133,
    livingMix: DEFAULT_LIVING_MIX(),
    mix: { taxes: 0, cash: 0, btc: 50, realestate: 25, other: 25 },
  });

  const BTC_YEAR_RETURNS = [1.9333, 54.6301, -0.5759, 0.3437, 1.2375, 13.6903, -0.7348, 0.92, 3.0309, 0.5971, -0.6427, 1.5541, 1.2098, -0.0633];
  const BTC_GEO_YEARLY = Math.pow(BTC_YEAR_RETURNS.reduce((p, r) => p * (1 + r), 1), 1 / BTC_YEAR_RETURNS.length) - 1;

  const DEFAULT_STATE = () => ({
    month: currentMonthId(),
    months: {},
    funds: { backup: 0, family: 0, taxes: 0, cash: 0, btc: 0, btcUnit: "BTC", realestate: 17000, other: 0 },
    available: { backup: 0, family: 0, taxes: 0, cash: 0, btc: 0, realestate: 8225, other: 8225 },
    rates: { btcChf: 69090, usdtChf: 0.823057, fetchedAt: 0 },
    projYears: 4,
    simAsset: "btc",
    bands: defaultBands(),
    actuals: {},
  });

  function defaultBands() {
    const off = () => ({ on: false, threshold: 0, yearlyReturn: 0, startPrice: 0 });
    return {
      backup: off(),
      family: off(),
      taxes: off(),
      cash: off(),
      btc: { on: true, threshold: 100000, yearlyReturn: BTC_GEO_YEARLY, startPrice: 0 },
      realestate: off(),
      other: off(),
    };
  }

  let state = load();
  const $ = (id) => document.getElementById(id);
  const tooltip = $("tooltip");

  function currentMonthId() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function load() {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return DEFAULT_STATE();
      const parsed = JSON.parse(raw);
      const base = DEFAULT_STATE();
      const bands = defaultBands();
      const parsedBands = parsed.bands || {};
      for (const k of Object.keys(bands)) {
        const incoming = parsedBands[k] || {};
        bands[k] = incoming.threshold != null || incoming.yearlyReturn != null
          ? { ...bands[k], ...incoming }
          : bands[k];
      }
      const available = { ...base.available, ...(parsed.available || {}) };
      if (!parsed.available) {
        if (available.realestate === 0) available.realestate = 8225;
        if (available.other === 0) available.other = 8225;
      }
      return {
        ...base,
        ...parsed,
        funds: { ...base.funds, ...(parsed.funds || {}) },
        available,
        rates: { ...base.rates, ...(parsed.rates || {}) },
        months: parsed.months || {},
        bands,
        actuals: parsed.actuals || {},
      };
    } catch {
      return DEFAULT_STATE();
    }
  }

  function save() {
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota / private mode */ }
  }

  function monthData() {
    if (!state.months[state.month]) state.months[state.month] = DEFAULT_MONTH();
    else state.months[state.month] = normalizeMonth(state.months[state.month]);
    return state.months[state.month];
  }

  function normalizeMonth(m) {
    const d = DEFAULT_MONTH();
    if (!m) return d;
    if (m.familyOfSavedPct == null) return { ...d, income: m.income ?? d.income };
    return {
      ...d,
      ...m,
      mix: { ...d.mix, ...(m.mix || {}) },
      livingMix: { ...d.livingMix, ...(m.livingMix || {}) },
    };
  }

  function parseAmount(raw) {
    if (raw == null) return 0;
    let s = String(raw).trim().toLowerCase().replace(/chf/g, "").replace(/['’′\s,_]/g, "");
    if (!s) return 0;
    let mul = 1;
    if (s.endsWith("m")) { mul = 1e6; s = s.slice(0, -1); }
    else if (s.endsWith("k")) { mul = 1e3; s = s.slice(0, -1); }
    s = s.replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n * mul : 0;
  }

  /* Income field is kCHF. "1000" and "1000k" both mean 1'000'000. Big bare numbers are francs. */
  function parseIncome(raw) {
    const s = String(raw).trim().toLowerCase().replace(/chf/g, "").replace(/['’′\s,_]/g, "");
    if (!s) return 0;
    if (s.endsWith("m") || s.endsWith("k")) return parseAmount(raw);
    const n = Number(s.replace(",", "."));
    if (!Number.isFinite(n)) return 0;
    return Math.abs(n) >= 10_000 ? n : n * 1000;
  }

  function parseChfField(raw) {
    const s = String(raw).trim().toLowerCase().replace(/chf/g, "").replace(/['’′\s,_]/g, "");
    if (!s) return 0;
    if (s.endsWith("m") || s.endsWith("k")) return parseAmount(raw);
    const n = Number(s.replace(",", "."));
    if (!Number.isFinite(n)) return 0;
    return Math.abs(n) >= 10_000 ? n : n * 1000;
  }

  function fmtIncomeInput(n) {
    const k = n / 1000;
    const digits = Math.abs(k - Math.round(k)) < 1e-9 ? 0 : 2;
    let s = fmtNum(k, digits);
    if (digits) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s;
  }

  function parsePct(raw) {
    const n = Number(String(raw).replace(",", ".").replace("%", "").trim());
    return Number.isFinite(n) ? n : 0;
  }

  function fmtNum(n, digits = 2) {
    const neg = n < 0;
    const abs = Math.abs(n);
    const [i, f] = abs.toFixed(digits).split(".");
    const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
    return (neg ? "−" : "") + grouped + (digits ? "." + f : "");
  }

  function fmtK(n) {
    const k = n / 1000;
    const digits = Math.abs(k - Math.round(k)) < 1e-9 ? 0 : Math.abs(k) < 10 ? 3 : 2;
    let s = fmtNum(k, digits);
    if (digits) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s + "k";
  }

  function fmtInputChf(n) {
    if (n === 0) return "0";
    if (Math.abs(n) >= 1000) return fmtK(n);
    return fmtNum(n, 2).replace(/\.00$/, "");
  }

  function fmtChf(n) {
    return "CHF " + fmtNum(n, 2);
  }

  function fmtPct(n) {
    const rounded = Math.round(n * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }

  function btcChf() {
    const { btc, btcUnit } = state.funds;
    const { btcChf, usdtChf } = state.rates;
    if (btcUnit === "CHF") return btc;
    if (btcUnit === "USDT") return btc * usdtChf;
    return btc * btcChf;
  }

  function compute() {
    const m = monthData();
    const income = Math.max(0, m.income);
    const livingPct = m.livingPct;
    const savedPct = 100 - livingPct;
    const backupOfSaved = m.backupOfSavedPct || 0;
    const familyOfSaved = m.familyOfSavedPct || 0;
    const fundsOfSaved = backupOfSaved + familyOfSaved;
    const investOfSaved = Math.max(0, 100 - fundsOfSaved);
    const backupPct = savedPct * backupOfSaved / 100;
    const familyPct = savedPct * familyOfSaved / 100;
    const investPct = savedPct * investOfSaved / 100;
    const mixSum = MIX_KEYS.reduce((s, k) => s + (m.mix[k] || 0), 0);
    const slices = MIX_KEYS.map((k) => {
      const ofInvest = m.mix[k] || 0;
      const ofIncome = investPct * ofInvest / 100;
      return { id: k, ofInvest, ofIncome, chf: income * ofIncome / 100 };
    });
    const unallocOfInvest = Math.max(0, 100 - mixSum);
    const unallocPct = investPct * unallocOfInvest / 100;
    const livingMix = m.livingMix || DEFAULT_LIVING_MIX();
    const livingMixSum = LIVING_KEYS.reduce((s, k) => s + (livingMix[k] || 0), 0);
    const livingSlices = LIVING_KEYS.map((k) => {
      const ofLiving = livingMix[k] || 0;
      const ofIncome = livingPct * ofLiving / 100;
      return { id: k, ofLiving, ofIncome, chf: income * ofIncome / 100 };
    });
    const unallocOfLiving = Math.max(0, 100 - livingMixSum);
    const unallocLivingPct = livingPct * unallocOfLiving / 100;
    return {
      income,
      livingPct,
      livingChf: income * livingPct / 100,
      livingMixSum,
      livingSlices,
      unallocOfLiving,
      unallocLivingPct,
      unallocLivingChf: income * unallocLivingPct / 100,
      savedPct,
      savedChf: income * savedPct / 100,
      backupOfSaved,
      familyOfSaved,
      fundsOfSaved,
      investOfSaved,
      backupPct,
      familyPct,
      backupChf: income * backupPct / 100,
      familyChf: income * familyPct / 100,
      fundsChf: income * (backupPct + familyPct) / 100,
      investPct,
      investChf: income * investPct / 100,
      mixSum,
      slices,
      unallocOfInvest,
      unallocPct,
      unallocChf: income * unallocPct / 100,
    };
  }

  function investedOf(id) {
    if (id === "btc") return btcChf();
    return Math.max(0, state.funds[id] || 0);
  }

  function availableOf(id) {
    return Math.max(0, (state.available || {})[id] || 0);
  }

  function holdingsChf() {
    const o = {};
    for (const p of POTS) o[p.id] = investedOf(p.id) + availableOf(p.id);
    return o;
  }

  function snapshotMonth(m) {
    return {
      income: m.income,
      livingPct: m.livingPct,
      backupOfSavedPct: m.backupOfSavedPct,
      familyOfSavedPct: m.familyOfSavedPct,
      livingMix: { ...m.livingMix },
      mix: { ...m.mix },
    };
  }

  function goMonth(nextId) {
    const snap = snapshotMonth(monthData());
    state.month = nextId;
    if (!state.months[nextId]) state.months[nextId] = snap;
    save();
    render();
  }

  function shiftMonth(delta) {
    const [y, mo] = state.month.split("-").map(Number);
    const d = new Date(y, mo - 1 + delta, 1);
    goMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  function render() {
    const c = compute();
    $("month").value = state.month;
    $("income").value = fmtIncomeInput(c.income);
    $("incomeFull").textContent = fmtChf(c.income);
    $("rateBtc").value = fmtNum(state.rates.btcChf, 0);
    $("rateUsdt").value = fmtNum(state.rates.usdtChf, 6).replace(/0+$/, "").replace(/\.$/, "");
    renderTable(c);
    renderFunds();
    renderAfter(c);
    drawIncomeSankey(c);
    drawHoldings();
    renderLegend(c);
    renderForecast(c);
    save();
  }

  function renderLegend(c) {
    const items = [
      ["var(--living)", `Living ${fmtPct(c.livingPct)}%`],
      ["var(--saved)", `Saved ${fmtPct(c.savedPct)}%`],
      ["var(--backup)", `Backup ${fmtPct(c.backupPct)}%`],
      ["var(--family)", `Family ${fmtPct(c.familyPct)}%`],
      ["var(--invest)", `Investments ${fmtPct(c.investPct)}%`],
      ...c.slices.filter((s) => s.ofIncome > 0).map((s) => [MIX_META[s.id].color, `${MIX_META[s.id].label} ${fmtPct(s.ofIncome)}%`]),
    ];
    $("sankeyLegend").innerHTML = items.map(([color, label]) =>
      `<span><i class="dot" style="background:${color}"></i>${label}</span>`
    ).join("");
  }

  function pctInput(value, field) {
    return `<input class="pct" data-field="${field}" value="${fmtPct(value)}" inputmode="decimal" aria-label="${field}" /><span class="pct-mark">%</span>`;
  }

  function chfInput(value, field) {
    return `<input class="chf-edit" data-chf="${field}" value="${fmtK(value)}" inputmode="decimal" aria-label="${field} CHF" />`;
  }

  function plainChfInput(value, field) {
    return `<input class="chf-edit" data-chf="${field}" data-plain="1" value="${fmtInputChf(value)}" inputmode="decimal" aria-label="${field} CHF" />`;
  }

  function renderTable(c) {
    const rows = [];
    rows.push(row("root", `<span class="dot" style="background:var(--income)"></span>100%`,
      `<span>Net income</span>${chfInput(c.income, "income")}`));
    rows.push(row("", `<span class="dot" style="background:var(--living)"></span>Living`,
      `${pctInput(c.livingPct, "livingPct")}<span>of income</span>${chfInput(c.livingChf, "living")}`));
    const livingBar = c.livingSlices.map((s) =>
      `<i style="flex:${Math.max(s.ofLiving, 0)};background:${LIVING_META[s.id].color}" title="${LIVING_META[s.id].label}"></i>`
    ).join("") + (c.unallocOfLiving > 0.009
      ? `<i style="flex:${c.unallocOfLiving};background:#2a2a2a" title="Unallocated"></i>` : "");
    rows.push(`<div class="living-bar" aria-hidden="true">${livingBar}</div>`);
    for (const s of c.livingSlices) {
      const meta = LIVING_META[s.id];
      rows.push(row("nest", `<span class="dot" style="background:${meta.color}"></span>${meta.label}`,
        `${pctInput(s.ofLiving, "livingMix." + s.id)}<span>of living = ${fmtPct(s.ofIncome)}% of income</span>${plainChfInput(s.chf, "livingMixChf." + s.id)}`));
    }
    if (c.unallocOfLiving > 0.009) {
      rows.push(row("nest muted-name", `Unallocated living`,
        `<span>${fmtPct(c.unallocOfLiving)}% of living = ${fmtPct(c.unallocLivingPct)}% of income</span><span>${fmtK(c.unallocLivingChf)}</span>`));
    }
    rows.push(row("", `<span class="dot" style="background:var(--saved)"></span>Saved`,
      `${pctInput(c.savedPct, "savedPct")}<span>of income</span><span>${fmtK(c.savedChf)}</span>`));
    rows.push(row("nest", `<span class="dot" style="background:var(--backup)"></span>Backup fund`,
      `${pctInput(c.backupOfSaved, "backupOfSavedPct")}<span>of savings = ${fmtPct(c.backupPct)}% of income</span>${plainChfInput(c.backupChf, "backup")}`));
    rows.push(row("nest", `<span class="dot" style="background:var(--family)"></span>Family fund`,
      `${pctInput(c.familyOfSaved, "familyOfSavedPct")}<span>of savings = ${fmtPct(c.familyPct)}% of income</span>${plainChfInput(c.familyChf, "family")}`));
    rows.push(row("nest muted-name", `Backup + family`,
      `<span>${fmtPct(c.fundsOfSaved)}% of savings = ${fmtK(c.fundsChf)}</span>`));
    rows.push(row("nest", `<span class="dot" style="background:var(--invest)"></span>Investments`,
      `<span>${fmtPct(c.investOfSaved)}% of savings = ${fmtPct(c.investPct)}% of income</span><span>${fmtK(c.investChf)}</span>`));

    for (const s of c.slices) {
      const meta = MIX_META[s.id];
      rows.push(row("nest-2", `<span class="dot" style="background:${meta.color}"></span>${meta.label}`,
        `${pctInput(s.ofInvest, "mix." + s.id)}<span>of remaining = ${fmtPct(s.ofIncome)}% of income</span>${chfInput(s.chf, "mixChf." + s.id)}`));
    }
    if (c.unallocOfInvest > 0.009) {
      rows.push(row("nest-2 muted-name", `Unallocated`,
        `<span>${fmtPct(c.unallocOfInvest)}% of remaining = ${fmtPct(c.unallocPct)}% of income</span><span>${fmtK(c.unallocChf)}</span>`));
    }

    $("allocTable").innerHTML = rows.join("");
    const warn = $("mixWarn");
    if (c.fundsOfSaved + c.investOfSaved > 100.05) {
      warn.hidden = false;
      warn.textContent = `Backup + family take ${fmtPct(c.fundsOfSaved)}% of savings (over 100%).`;
    } else if (c.livingMixSum > 100.009) {
      warn.hidden = false;
      warn.textContent = `Living mix adds up to ${fmtPct(c.livingMixSum)}% (over 100%). Shrink a slice.`;
    } else if (c.mixSum > 100.009) {
      warn.hidden = false;
      warn.textContent = `Investment mix adds up to ${fmtPct(c.mixSum)}% (over 100%). Shrink a slice.`;
    } else {
      warn.hidden = true;
    }
  }

  function row(cls, name, vals) {
    return `<div class="row ${cls}"><div class="name">${name}</div><div class="vals">${vals}</div></div>`;
  }

  function renderFunds() {
    $("fundsGrid").innerHTML = POTS.map((p) => {
      const inv = investedOf(p.id);
      const av = availableOf(p.id);
      const investedInput = p.crypto
        ? `<div class="amt">
            <input data-fund="btc" value="${fmtCrypto(state.funds.btc)}" inputmode="decimal" />
            <select data-unit="btcUnit">
              ${["BTC", "USDT", "CHF"].map((u) => `<option${u === state.funds.btcUnit ? " selected" : ""}>${u}</option>`).join("")}
            </select>
          </div>`
        : `<div class="amt">
            <input data-fund="${p.id}" value="${fmtInputChf(state.funds[p.id])}" inputmode="decimal" />
            <span class="muted">CHF</span>
          </div>`;
      return `<div class="fund">
        <h3><span class="dot" style="background:${p.color}"></span>${p.label}</h3>
        <p class="muted" style="margin:0 0 6px;font-size:11px">Invested</p>
        ${investedInput}
        <div class="avail">
          <span>Available</span>
          <input data-avail="${p.id}" value="${fmtInputChf(av)}" inputmode="decimal" />
          <span>CHF</span>
        </div>
        <p class="bucket">bucket ${fmtChf(inv + av)}  ·  invested ${fmtChf(inv)}</p>
      </div>`;
    }).join("");
  }

  function fmtCrypto(n) {
    const abs = Math.abs(n);
    const digits = abs === 0 ? 0 : abs >= 100 ? 2 : abs >= 1 ? 4 : 8;
    return fmtNum(n, digits).replace(/0+$/, "").replace(/\.$/, "") || "0";
  }

  function renderAfter(c) {
    const h = holdingsChf();
    const flow = {
      backup: c.backupChf,
      family: c.familyChf,
      taxes: sliceChf(c, "taxes"),
      cash: sliceChf(c, "cash"),
      btc: sliceChf(c, "btc"),
      realestate: sliceChf(c, "realestate"),
      other: sliceChf(c, "other"),
    };
    const rows = POTS.map((p) => {
      const exist = h[p.id];
      const add = flow[p.id];
      const after = exist + add;
      return row("", `<span class="dot" style="background:${p.color}"></span>${p.label}`,
        `<span>held ${fmtK(exist)}</span><span>+ ${fmtK(add)}</span><span style="color:var(--fg)">${fmtK(after)}</span>`);
    });
    const totalExist = POTS.reduce((s, p) => s + h[p.id], 0);
    const totalAdd = POTS.reduce((s, p) => s + flow[p.id], 0);
    rows.unshift(row("root", "Pots", `<span>held ${fmtK(totalExist)}</span><span>+ ${fmtK(totalAdd)}</span><span style="color:var(--fg)">${fmtK(totalExist + totalAdd)}</span>`));
    $("afterTable").innerHTML = rows.join("");
  }

  function sliceChf(c, id) {
    return c.slices.find((s) => s.id === id)?.chf || 0;
  }

  function monthlyFlow(c) {
    return {
      backup: c.backupChf,
      family: c.familyChf,
      taxes: sliceChf(c, "taxes"),
      cash: sliceChf(c, "cash"),
      btc: sliceChf(c, "btc"),
      realestate: sliceChf(c, "realestate"),
      other: sliceChf(c, "other"),
    };
  }

  function addMonths(id, n) {
    const [y, m] = id.split("-").map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function monthName(id) {
    const [y, m] = id.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("en", { month: "long", year: "numeric" });
  }

  function bandOf(id) {
    return state.bands[id] || defaultBands()[id];
  }

  function startPriceOf(id) {
    const b = bandOf(id);
    if (b.startPrice > 0) return b.startPrice;
    if (id === "btc") return state.rates.btcChf || 0;
    return 0;
  }

  function simulateAsset(id, flow, months) {
    const b = bandOf(id);
    const n = months.length;
    let price = startPriceOf(id) || 1;
    const yearly = b.yearlyReturn || 0;
    const gated = b.on && b.threshold > 0;
    const threshold = b.threshold || 0;
    let available = availableOf(id);
    let units = 0;
    const startInvested = investedOf(id);
    if (price > 0 && startInvested > 0) units = startInvested / price;
    let desired = startInvested + available;
    let exposed = startInvested;
    const rows = [];
    const path = [];
    for (let i = 0; i < n; i++) {
      if (i > 0 && i % 12 === 0) price *= (1 + yearly);
      available += flow;
      desired += flow;
      const canBuy = !gated || price < threshold;
      let deployed = 0;
      if (canBuy && available > 0 && price > 0) {
        deployed = available;
        units += deployed / price;
        exposed += deployed;
        available = 0;
      }
      const invested = units * price;
      path.push({ close: price, low: price, high: price });
      rows.push({
        month: months[i],
        price,
        canBuy,
        deployed,
        desired,
        reserved: available,
        exposed: invested,
        units,
        invested,
        yearCut: i > 0 && i % 12 === 0,
      });
    }
    return { rows, path, gated, threshold, start: startPriceOf(id), yearly };
  }

  function renderForecast(c) {
    const years = clamp(Number(state.projYears) || 4, 1, 30);
    state.projYears = years;
    $("projYears").value = String(years);
    const n = years * 12;
    const start = state.month;
    const months = Array.from({ length: n }, (_, i) => addMonths(start, i));
    const flow = monthlyFlow(c);
    const held = holdingsChf();
    const bals = { ...held };
    const cols = POTS;

    const head = ["Month", ...cols.map((p) => p.label), "Baseline"];
    const body = [];
    const preCells = cols.map((p) => held[p.id]);
    body.push({ id: start, label: monthName(start) + " pre", kind: "pre", cells: preCells, base: POTS.reduce((s, p) => s + held[p.id], 0) });
    months.forEach((id, i) => {
      POTS.forEach((p) => { bals[p.id] += flow[p.id]; });
      const cells = cols.map((p) => bals[p.id]);
      const base = POTS.reduce((s, p) => s + bals[p.id], 0);
      const kind = i === 0 || i % 12 === 0 ? "year" : "";
      const label = i === 0 ? monthName(id) + " post" : monthName(id);
      body.push({ id, label, kind, cells, base });
    });

    $("projTable").innerHTML = `<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${
      body.map((r) => `<tr class="${r.kind}"><td>${r.label}</td>${r.cells.map((v) => `<td>${fmtK(v)}</td>`).join("")}<td class="fill">${fmtK(r.base)}</td></tr>`).join("")
    }</tbody>`;
    const last = body[body.length - 1];
    $("projSummary").textContent = `After ${years}y  baseline ${fmtChf(last.base)}  ·  BTC ${fmtK(bals.btc)}  ·  real estate ${fmtK(bals.realestate)}  ·  other ${fmtK(bals.other)}`;

    const asset = state.simAsset;
    const pot = POTS.find((p) => p.id === asset) || POTS[3];
    $("simAssets").innerHTML = POTS.map((p) =>
      `<button type="button" data-asset="${p.id}" class="${p.id === asset ? "on" : ""}">${p.label}</button>`
    ).join("");

    const b = bandOf(asset);
    const effectiveStart = startPriceOf(asset);
    $("bandForm").innerHTML = `
      <label class="check"><input type="checkbox" data-band="on" ${b.on ? "checked" : ""} /> Allocate on threshold</label>
      <label>Allocate below<input data-band="threshold" value="${b.threshold ? fmtK(b.threshold) : "0"}" /></label>
      <label>Yearly return<input data-band="yearlyReturn" value="${fmtPct((b.yearlyReturn || 0) * 100)}" /></label>
      <label>Start price<input data-band="startPrice" value="${effectiveStart ? fmtK(effectiveStart) : "0"}" /></label>
    `;

    const sim = simulateAsset(asset, flow[asset], months);
    drawSpark($("simSpark"), sim);
    const lastSim = sim.rows[sim.rows.length - 1] || { desired: 0, invested: 0, reserved: 0, units: 0 };
    const retPct = fmtPct((sim.yearly || 0) * 100);
    $("simSummary").textContent = sim.gated
      ? `${retPct}%/y each September  ·  buy < ${fmtK(sim.threshold)}  ·  desired ${fmtK(lastSim.desired)}  ·  invested ${fmtK(lastSim.invested)}  ·  waiting ${fmtK(lastSim.reserved)}  ·  stacked ${fmtCrypto(lastSim.units)}`
      : `No threshold — monthly flow is fully allocated  ·  ${retPct}%/y each September`;

    $("simTable").innerHTML = `<thead><tr>
      <th>Month</th><th>Price</th><th>Below</th>
      <th>Desired</th><th>Allocated</th><th>Invested</th><th>Waiting</th><th>Stacked</th>
    </tr></thead><tbody>${sim.rows.map((r, i) => {
      const kind = i === 0 || i % 12 === 0 ? "year" : "";
      return `<tr class="${kind}">
        <td>${i === 0 ? monthName(r.month) + " post" : monthName(r.month)}</td>
        <td>${fmtK(r.price)}</td>
        <td class="${r.canBuy ? "fill" : "miss"}">${r.canBuy ? "yes" : "no"}</td>
        <td>${fmtK(r.desired)}</td>
        <td class="${r.deployed > 0 ? "fill" : "miss"}">${r.deployed ? fmtK(r.deployed) : "—"}</td>
        <td>${fmtK(r.invested)}</td>
        <td>${fmtK(r.reserved)}</td>
        <td>${fmtCrypto(r.units)}</td>
      </tr>`;
    }).join("")}</tbody>`;

    $("isTable").innerHTML = `<thead><tr>
      <th>Month</th><th>Desired</th><th>Sim exposed</th><th>Is allocated</th><th>Is price</th><th>vs sim</th><th>vs desired</th>
    </tr></thead><tbody>${sim.rows.map((r, i) => {
      const rec = (state.actuals[r.month] || {})[asset] || {};
      const has = rec.chf != null && rec.chf !== "";
      const isChf = has ? Number(rec.chf) || 0 : null;
      const vsSim = isChf == null ? "" : isChf - r.deployed;
      const vsDes = isChf == null ? "" : isChf - flow[asset];
      const kind = i === 0 || i % 12 === 0 ? "year" : "";
      return `<tr class="${kind}">
        <td>${monthName(r.month)}</td>
        <td>${fmtK(flow[asset])}</td>
        <td>${r.deployed ? fmtK(r.deployed) : "—"}</td>
        <td><input class="cell" data-is="chf" data-month="${r.month}" value="${has ? fmtK(isChf) : ""}" placeholder="—" /></td>
        <td><input class="cell" data-is="price" data-month="${r.month}" value="${rec.price ? fmtK(rec.price) : ""}" placeholder="—" /></td>
        <td class="${vsSim === "" ? "" : vsSim >= 0 ? "pos" : "neg"}">${vsSim === "" ? "" : fmtK(vsSim)}</td>
        <td class="${vsDes === "" ? "" : vsDes >= 0 ? "pos" : "neg"}">${vsDes === "" ? "" : fmtK(vsDes)}</td>
      </tr>`;
    }).join("")}</tbody>`;
  }

  function drawSpark(svg, sim) {
    const W = 960, H = 92, pad = 10;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.replaceChildren();
    const pts = sim.path || [];
    if (!pts.length) return;
    const ys = pts.map((p) => p.close);
    if (sim.gated) ys.push(sim.threshold);
    const min = Math.min(...ys) * 0.92, max = Math.max(...ys) * 1.08;
    const x = (i) => pad + i * ((W - pad * 2) / Math.max(pts.length - 1, 1));
    const y = (v) => pad + (1 - (v - min) / (max - min || 1)) * (H - pad * 2);
    if (sim.gated) {
      const ty = y(sim.threshold);
      svg.append(ns("line", { x1: pad, x2: W - pad, y1: ty, y2: ty, stroke: "rgba(247,147,26,0.55)", "stroke-dasharray": "4 4" }));
    }
    let d = "";
    pts.forEach((p, i) => {
      const X = x(i), Y = y(p.close);
      d += i === 0 ? `M${X},${Y}` : ` H${X} V${Y}`;
    });
    svg.append(ns("path", { d, fill: "none", stroke: "#d4d4d4", "stroke-width": "1.5" }));
  }

  function ns(tag, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    return el;
  }

  function drawIncomeSankey(c) {
    const nodes = [
      { id: "income", col: 0, value: c.income, label: "Net income", color: "#f5f5f5" },
      { id: "living", col: 1, value: c.livingChf, label: "Living", color: "#6b6b6b" },
      { id: "saved", col: 1, value: c.savedChf, label: "Saved", color: "#d4d4d4" },
    ];
    const links = [
      { from: "income", to: "living", value: c.livingChf, color: "#6b6b6b" },
      { from: "income", to: "saved", value: c.savedChf, color: "#d4d4d4" },
    ];
    for (const s of c.livingSlices) {
      if (s.chf <= 0) continue;
      const meta = LIVING_META[s.id];
      nodes.push({ id: "liv-" + s.id, col: 2, value: s.chf, label: meta.label, color: cssColor(meta.color) });
      links.push({ from: "living", to: "liv-" + s.id, value: s.chf, color: cssColor(meta.color) });
    }
    if (c.unallocLivingChf > 0.5) {
      nodes.push({ id: "liv-unalloc", col: 2, value: c.unallocLivingChf, label: "Unallocated", color: "#3a3a3a" });
      links.push({ from: "living", to: "liv-unalloc", value: c.unallocLivingChf, color: "#3a3a3a" });
    }
    nodes.push(
      { id: "backup", col: 2, value: c.backupChf, label: "Backup", color: "#e8c547" },
      { id: "family", col: 2, value: c.familyChf, label: "Family", color: "#c4a24a" },
      { id: "invest", col: 2, value: c.investChf, label: "Investments", color: "#ececec" },
    );
    links.push(
      { from: "saved", to: "backup", value: c.backupChf, color: "#e8c547" },
      { from: "saved", to: "family", value: c.familyChf, color: "#c4a24a" },
      { from: "saved", to: "invest", value: c.investChf, color: "#ececec" },
    );
    for (const s of c.slices) {
      if (s.chf <= 0) continue;
      const meta = MIX_META[s.id];
      nodes.push({ id: s.id, col: 3, value: s.chf, label: meta.label, color: cssColor(meta.color) });
      links.push({ from: "invest", to: s.id, value: s.chf, color: cssColor(meta.color) });
    }
    if (c.unallocChf > 0) {
      nodes.push({ id: "unalloc", col: 3, value: c.unallocChf, label: "Unallocated", color: "#3a3a3a" });
      links.push({ from: "invest", to: "unalloc", value: c.unallocChf, color: "#3a3a3a" });
    }
    drawSankey($("sankey"), nodes, links, c.income, { height: 520, shareLabel: "of income" });
  }

  function cssColor(v) {
    const map = {
      "var(--taxes)": "#ef9a9a",
      "var(--cash)": "#7dcea0",
      "var(--btc)": "#f7931a",
      "var(--realestate)": "#7eb6ff",
      "var(--other)": "#c4a6ff",
      "var(--backup)": "#e8c547",
      "var(--family)": "#c4a24a",
      "var(--rent)": "#9a9a9a",
      "var(--css)": "#5c7a8a",
      "var(--sports)": "#6a8a6a",
      "var(--transport)": "#8a735c",
      "var(--kita)": "#8a6a7a",
      "var(--digital)": "#5c6a8a",
      "var(--spend)": "#8a7a5c",
      "var(--homekid)": "#6a7a6a",
    };
    return map[v] || v;
  }

  function drawHoldings() {
    const h = holdingsChf();
    const total = POTS.reduce((s, p) => s + h[p.id], 0);
    $("holdingsTotal").textContent = total ? fmtChf(total) : "";
    const empty = $("holdingsEmpty");
    const svg = $("holdings");
    if (total <= 0) {
      empty.hidden = false;
      svg.replaceChildren();
      svg.removeAttribute("viewBox");
      svg.style.display = "none";
      return;
    }
    empty.hidden = true;
    svg.style.display = "block";
    const nodes = [{ id: "total", col: 0, value: total, label: "Holdings", color: "#f5f5f5" }];
    const links = [];
    for (const p of POTS) {
      if (h[p.id] <= 0) continue;
      nodes.push({ id: p.id, col: 1, value: h[p.id], label: p.label, color: cssColor(p.color) });
      links.push({ from: "total", to: p.id, value: h[p.id], color: cssColor(p.color) });
    }
    drawSankey(svg, nodes, links, total, { height: 220, shareLabel: "of holdings" });
  }

  function drawSankey(svg, nodes, links, total, { height, shareLabel }) {
    const W = 960, H = height, padT = 18, padB = 22, padL = 108, padR = 132;
    const nodeW = 14;
    const cols = Math.max(...nodes.map((n) => n.col));
    const byCol = [];
    for (let i = 0; i <= cols; i++) byCol[i] = nodes.filter((n) => n.col === i && n.value > 0);
    const gap = 10;
    const innerH = H - padT - padB;
    const scale = total > 0 ? innerH / total : 0;
    const usableH = (col) => innerH - Math.max(0, byCol[col].length - 1) * gap;
    const colScale = (col) => {
      const sum = byCol[col].reduce((s, n) => s + n.value, 0);
      return sum > 0 ? usableH(col) / sum : scale;
    };

    const layout = {};
    for (let i = 0; i <= cols; i++) {
      const sc = colScale(i);
      let y = padT;
      for (const n of byCol[i]) {
        const h = Math.max(2, n.value * sc);
        layout[n.id] = { ...n, x: padL + i * ((W - padL - padR - nodeW) / Math.max(cols, 1)), y, h };
        y += h + gap;
      }
    }

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.replaceChildren();

    const defs = ns("defs");
    links.forEach((link, i) => {
      const a = layout[link.from], b = layout[link.to];
      if (!a || !b) return;
      const id = "lg" + i;
      const g = ns("linearGradient", { id, x1: "0", x2: "1", y1: "0", y2: "0" });
      g.append(ns("stop", { offset: "0%", "stop-color": hexAlpha(link.color, 0.35) }));
      g.append(ns("stop", { offset: "100%", "stop-color": hexAlpha(link.color, 0.7) }));
      defs.append(g);
    });
    svg.append(defs);

    const outOff = {}, inOff = {};
    for (const id of Object.keys(layout)) { outOff[id] = 0; inOff[id] = 0; }

    links.forEach((link, i) => {
      const a = layout[link.from], b = layout[link.to];
      if (!a || !b || link.value <= 0) return;
      const ah = Math.max(2, (link.value / a.value) * a.h);
      const bh = Math.max(2, (link.value / b.value) * b.h);
      const y0 = a.y + outOff[a.id];
      const y1 = b.y + inOff[b.id];
      outOff[a.id] += ah;
      inOff[b.id] += bh;
      const x0 = a.x + nodeW, x1 = b.x;
      const c = (x1 - x0) * 0.46;
      const d = `M${x0},${y0} C${x0 + c},${y0} ${x1 - c},${y1} ${x1},${y1} L${x1},${y1 + bh} C${x1 - c},${y1 + bh} ${x0 + c},${y0 + ah} ${x0},${y0 + ah} Z`;
      const path = ns("path", { d, fill: `url(#lg${i})`, "data-tip": `${link.from} → ${nodes.find((n) => n.id === link.to)?.label || link.to}` });
      const pct = total > 0 ? (link.value / total) * 100 : 0;
      path.addEventListener("pointerenter", (e) => showTip(e, `${nodes.find((n) => n.id === link.to)?.label || link.to}\n${fmtPct(pct)}% ${shareLabel}\n${fmtChf(link.value)}`));
      path.addEventListener("pointermove", moveTip);
      path.addEventListener("pointerleave", hideTip);
      svg.append(path);
    });

    for (const n of nodes) {
      const L = layout[n.id];
      if (!L) continue;
      const g = ns("g");
      g.append(ns("rect", { x: L.x, y: L.y, width: nodeW, height: L.h, rx: "2", fill: n.color }));
      const right = n.col === cols;
      const left = n.col === 0;
      const mid = !left && !right && L.h >= 11;
      const text = ns("text", {
        x: right || !left ? L.x + nodeW + 8 : L.x - 8,
        y: L.y + Math.min(L.h / 2, 9) + 4,
        fill: "#c8c8c8",
        "font-size": mid ? "10" : "11",
        "font-family": "ui-sans-serif, system-ui, sans-serif",
        "text-anchor": left ? "end" : "start",
      });
      const pct = total > 0 ? (n.value / total) * 100 : 0;
      if (left || right || mid) {
        text.textContent = mid ? n.label : `${n.label} ${fmtPct(pct)}%`;
        g.append(text);
      }
      g.addEventListener("pointerenter", (e) => showTip(e, `${n.label}\n${fmtPct(pct)}% ${shareLabel}\n${fmtChf(n.value)}`));
      g.addEventListener("pointermove", moveTip);
      g.addEventListener("pointerleave", hideTip);
      svg.append(g);
    }
  }

  function hexAlpha(hex, a) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${a})`;
  }

  function showTip(e, text) {
    tooltip.hidden = false;
    tooltip.textContent = text;
    moveTip(e);
  }
  function moveTip(e) {
    tooltip.style.left = e.clientX + 12 + "px";
    tooltip.style.top = e.clientY + 12 + "px";
  }
  function hideTip() { tooltip.hidden = true; }

  function applyField(field, pct) {
    const m = monthData();
    if (field === "livingPct") m.livingPct = clamp(pct, 0, 100);
    else if (field === "savedPct") m.livingPct = clamp(100 - pct, 0, 100);
    else if (field === "backupOfSavedPct") m.backupOfSavedPct = Math.max(0, pct);
    else if (field === "familyOfSavedPct") m.familyOfSavedPct = Math.max(0, pct);
    else if (field.startsWith("livingMix.")) {
      if (!m.livingMix) m.livingMix = DEFAULT_LIVING_MIX();
      m.livingMix[field.slice(10)] = Math.max(0, pct);
    }
    else if (field.startsWith("mix.")) m.mix[field.slice(4)] = Math.max(0, pct);
  }

  function applyChf(field, chf) {
    const m = monthData();
    const c = compute();
    if (field === "income") m.income = Math.max(0, chf);
    else if (field === "living" && c.income) m.livingPct = clamp(chf / c.income * 100, 0, 100);
    else if (field === "backup" && c.savedChf) m.backupOfSavedPct = Math.max(0, chf / c.savedChf * 100);
    else if (field === "family" && c.savedChf) m.familyOfSavedPct = Math.max(0, chf / c.savedChf * 100);
    else if (field.startsWith("livingMixChf.")) {
      const id = field.slice(13);
      if (!m.livingMix) m.livingMix = DEFAULT_LIVING_MIX();
      if (c.livingChf) m.livingMix[id] = Math.max(0, chf / c.livingChf * 100);
    } else if (field.startsWith("mixChf.")) {
      const id = field.slice(7);
      if (c.investChf) m.mix[id] = Math.max(0, chf / c.investChf * 100);
    }
  }

  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }

  function onTableInput(e) {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.dataset.field) applyField(t.dataset.field, parsePct(t.value));
    if (t.dataset.chf) applyChf(t.dataset.chf, t.dataset.plain ? parseAmount(t.value) : parseChfField(t.value));
    save();
    const c = compute();
    $("income").value = fmtIncomeInput(c.income);
    $("incomeFull").textContent = fmtChf(c.income);
    drawIncomeSankey(c);
    renderLegend(c);
    renderAfter(c);
  }

  function onTableCommit(e) {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.dataset.field || t.dataset.chf) render();
  }

  $("allocTable").addEventListener("input", onTableInput);
  $("allocTable").addEventListener("change", onTableCommit);
  $("allocTable").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target instanceof HTMLInputElement) { e.target.blur(); render(); }
  });

  $("income").addEventListener("input", () => {
    monthData().income = Math.max(0, parseIncome($("income").value));
    const c = compute();
    $("incomeFull").textContent = fmtChf(c.income);
    drawIncomeSankey(c);
    renderLegend(c);
    renderAfter(c);
    save();
  });
  $("income").addEventListener("change", () => {
    monthData().income = Math.max(0, parseIncome($("income").value));
    render();
  });
  $("income").addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.target.blur();
  });

  document.addEventListener("focusin", (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type !== "month") e.target.select();
  });

  $("month").addEventListener("change", () => {
    goMonth($("month").value || currentMonthId());
  });
  $("prevMonth").addEventListener("click", () => shiftMonth(-1));
  $("nextMonth").addEventListener("click", () => shiftMonth(1));
  $("resetMonth").addEventListener("click", () => {
    state.months[state.month] = DEFAULT_MONTH();
    render();
  });
  $("resetAll").addEventListener("click", () => {
    sessionStorage.removeItem(KEY);
    state = DEFAULT_STATE();
    render();
  });

  $("fundsGrid").addEventListener("input", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.dataset.avail) {
      if (!state.available) state.available = {};
      state.available[t.dataset.avail] = Math.max(0, parseAmount(t.value));
    } else if (t.dataset.fund === "btc") state.funds.btc = parseAmount(t.value);
    else if (t.dataset.fund) state.funds[t.dataset.fund] = Math.max(0, parseAmount(t.value));
    else return;
    save();
    drawHoldings();
    renderAfter(compute());
    const card = t.closest(".fund");
    const id = t.dataset.avail || t.dataset.fund;
    const bucket = card?.querySelector(".bucket");
    if (bucket && id) {
      const inv = investedOf(id);
      const av = availableOf(id);
      bucket.textContent = `bucket ${fmtChf(inv + av)}  ·  invested ${fmtChf(inv)}`;
    }
  });
  $("fundsGrid").addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.unit) {
      const next = t.value;
      const chf = btcChf();
      state.funds.btcUnit = next;
      if (next === "CHF") state.funds.btc = chf;
      else if (next === "USDT") state.funds.btc = state.rates.usdtChf ? chf / state.rates.usdtChf : 0;
      else state.funds.btc = state.rates.btcChf ? chf / state.rates.btcChf : 0;
      render();
      return;
    }
    if (t.dataset.fund || t.dataset.avail) render();
  });

  $("rateBtc").addEventListener("change", () => {
    state.rates.btcChf = Math.max(0, parseAmount($("rateBtc").value));
    render();
  });
  $("rateUsdt").addEventListener("change", () => {
    state.rates.usdtChf = Math.max(0, parseAmount($("rateUsdt").value));
    render();
  });

  $("refreshRates").addEventListener("click", () => fetchRates(true));

  $("projYears").addEventListener("change", () => {
    state.projYears = clamp(parseInt($("projYears").value, 10) || 4, 1, 30);
    render();
  });
  $("simAssets").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-asset]");
    if (!btn) return;
    state.simAsset = btn.dataset.asset;
    render();
  });
  $("bandForm").addEventListener("change", (e) => {
    const t = e.target;
    const key = t.dataset.band;
    if (!key) return;
    const b = bandOf(state.simAsset);
    if (key === "on") b.on = t.checked;
    else if (key === "yearlyReturn") b.yearlyReturn = parsePct(t.value) / 100;
    else b[key] = Math.max(0, parseAmount(t.value));
    state.bands[state.simAsset] = b;
    render();
  });
  $("isTable").addEventListener("change", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !t.dataset.is) return;
    const month = t.dataset.month;
    const asset = state.simAsset;
    if (!state.actuals[month]) state.actuals[month] = {};
    if (!state.actuals[month][asset]) state.actuals[month][asset] = {};
    const rec = state.actuals[month][asset];
    const raw = t.value.trim();
    if (!raw) {
      if (t.dataset.is === "chf") delete rec.chf;
      else delete rec.price;
    } else {
      rec[t.dataset.is] = parseChfField(raw);
    }
    render();
  });

  $("copyAlloc").addEventListener("click", async () => {
    const c = compute();
    const lines = [
      `Allok  ${state.month}  net income ${fmtChf(c.income)}`,
      `Living ${fmtPct(c.livingPct)}%  ${fmtChf(c.livingChf)}`,
      ...c.livingSlices.map((s) => `  ${LIVING_META[s.id].label} ${fmtPct(s.ofLiving)}% of living = ${fmtChf(s.chf)}`),
      `Saved ${fmtPct(c.savedPct)}%  ${fmtChf(c.savedChf)}`,
      `  Backup fund ${fmtPct(c.backupOfSaved)}% of savings = ${fmtChf(c.backupChf)}`,
      `  Family fund ${fmtPct(c.familyOfSaved)}% of savings = ${fmtChf(c.familyChf)}`,
      `  Investments ${fmtPct(c.investOfSaved)}% of savings = ${fmtChf(c.investChf)}`,
      ...c.slices.map((s) => `    ${MIX_META[s.id].label} ${fmtPct(s.ofInvest)}% of investments = ${fmtPct(s.ofIncome)}% of income  ${fmtChf(s.chf)}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      $("copyAlloc").title = "Copied";
      setTimeout(() => { $("copyAlloc").title = "Copy allocation"; }, 1200);
    } catch { /* ignore */ }
  });

  async function fetchRates(manual) {
    const status = $("rateStatus");
    status.textContent = "Fetching…";
    try {
      const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,tether&vs_currencies=chf");
      if (!res.ok) throw new Error("http " + res.status);
      const json = await res.json();
      if (json.bitcoin?.chf) state.rates.btcChf = json.bitcoin.chf;
      if (json.tether?.chf) state.rates.usdtChf = json.tether.chf;
      state.rates.fetchedAt = Date.now();
      status.textContent = "Live rates";
      render();
    } catch {
      status.textContent = manual ? "Could not fetch — edit rates by hand" : "Using stored rates";
    }
  }

  render();
  fetchRates(false);
})();
