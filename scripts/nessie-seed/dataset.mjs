// Demo persona for the Nessie sandbox. Pure data — no I/O, no ids, no keys.
// Every payload value must stay ASCII: the real sandbox rejected the first
// non-ASCII payload (an em dash in a deposit description) with HTTP 400.
// Shared by scripts/nessie-seed.mjs and the offline dataset tests; never
// imported by the app.
//
// All amounts, dates, balances, and counts are generated from a seeded PRNG
// keyed on (personaId + asOf). Same inputs always produce the same dataset,
// so tests and the read-back verification are fully deterministic. Different
// personas or dates produce realistic variation.

export const SEED_MARKER = "sg-seed:";

/**
 * The live sandbox requires `status` on transaction creates (it answered a
 * deposit without one with "1 validation error for DepositCreate / status /
 * field required"), even though the SDKs mark it optional. "completed" is
 * valid for deposits, withdrawals, and purchases alike.
 */
export const TRANSACTION_STATUS = "completed";
// sg-demo-subprime-01 is a broken partial seed in the sandbox (see docs/nessie-sandbox.md).
export const DEFAULT_PERSONA = "sg-demo-subprime-02";

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- deterministic PRNG (mulberry32 + FNV-1a) ----------
// Kept here so the dataset module has no runtime dependencies.

function fnv1a(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (Math.imul(h, 16777619) >>> 0);
  }
  return h;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(personaId, asOf) {
  const raw = mulberry32(fnv1a(`${personaId}|${asOf}`));
  return {
    /** Uniform float in [0, 1). */
    next: raw,
    /** Integer in [min, max] inclusive. */
    int(min, max) { return min + Math.floor(raw() * (max - min + 1)); },
    /** Float rounded to `decimals` places in [min, max). */
    float(min, max, decimals = 0) {
      const v = min + raw() * (max - min);
      const f = Math.pow(10, decimals);
      return Math.round(v * f) / f;
    },
    /** Pick a random element from an array. */
    pick(arr) { return arr[this.int(0, arr.length - 1)]; },
    /**
     * Draw `count` distinct integers from [0, pool-1], sorted ascending.
     * Used to place transaction days within the 90-day window without overlap.
     */
    distinctDays(pool, count) {
      const set = new Set();
      let attempts = 0;
      while (set.size < count && attempts < pool * 4) {
        set.add(this.int(2, pool));
        attempts++;
      }
      return [...set].sort((a, b) => a - b);
    },
  };
}

// ---------- date helpers ----------

/**
 * `YYYY-MM-DD` for `asOf` minus `daysAgo` days (UTC).
 * @param {string} asOf `YYYY-MM-DD`
 * @param {number} daysAgo
 * @returns {string}
 */
export function isoDay(asOf, daysAgo) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOf);
  if (!match) throw new Error(`asOf must be YYYY-MM-DD, got "${asOf}"`);
  const base = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(base - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

/**
 * For a bill due on `dayOfMonth` (1–28), the most recent due date on or
 * before `asOf` and the next one after it.
 * @param {string} asOf `YYYY-MM-DD`
 * @param {number} dayOfMonth
 */
export function monthlyDueDates(asOf, dayOfMonth) {
  const [y, m, d] = asOf.split("-").map(Number);
  const iso = (/** @type {number} */ year, /** @type {number} */ month) =>
    new Date(Date.UTC(year, month - 1, dayOfMonth)).toISOString().slice(0, 10);
  const last = d >= dayOfMonth ? iso(y, m) : iso(y, m - 1);
  const next = d >= dayOfMonth ? iso(y, m + 1) : iso(y, m);
  return { last, next };
}

// ---------- persona profiles ----------
// Each profile defines realistic ranges for a credit / income tier.
// The PRNG draws actual values within these ranges, so every seed looks
// authentic but no two persona+date combos produce identical numbers.

const PROFILES = {
  subprime: {
    // Biweekly payroll range ($1,400 – $1,800)
    payrollMin: 1400, payrollMax: 1800,
    // Monthly side-income range ($80 – $220)
    sideIncomeMin: 80, sideIncomeMax: 220,
    // Rent range ($1,100 – $1,400)
    rentMin: 1100, rentMax: 1400,
    // Internet range ($45 – $90)
    internetMin: 45, internetMax: 90,
    // Electric (ACH withdrawal) range per occurrence ($70 – $140)
    electricMin: 70, electricMax: 140,
    // ATM cash range ($80 – $180)
    atmMin: 80, atmMax: 180,
    // Checking opening balance range ($1,200 – $2,600)
    checkingMin: 1200, checkingMax: 2600,
    // Savings opening balance range ($800 – $3,500)
    savingsMin: 800, savingsMax: 3500,
    // Card balance (owed) range ($800 – $2,200)
    cardMin: 800, cardMax: 2200,
    // Loan: monthly payment range ($100 – $200), total amount ($2,000 – $6,000)
    loanPaymentMin: 100, loanPaymentMax: 200,
    loanAmountMin: 2000, loanAmountMax: 6000,
    // Loan credit score range
    loanScoreMin: 580, loanScoreMax: 649,
    // Grocery spend range per trip ($55 – $130)
    groceryMin: 55, groceryMax: 130,
    // Gas spend range per fill-up ($32 – $65)
    gasMin: 32, gasMax: 65,
    // Restaurant spend range per visit ($18 – $55)
    restaurantMin: 18, restaurantMax: 55,
    // Payees
    payrollPayees: ["Acme Logistics", "Metro Staffing", "Citywide Services", "Harbor Freight Solutions"],
    sidePayees: ["Rideshare payout", "Gig platform payout", "Delivery platform payout"],
    electricPayees: ["AEP Ohio ACH", "Columbus City Utilities ACH", "Midwest Electric ACH"],
    rentPayees: ["Columbus Property Mgmt", "Midtown Realty", "Heartland Housing Group"],
    internetPayees: ["Buckeye Fiber", "Spectrum Internet", "Insight Broadband"],
  },
};

// ---------- merchant pool ----------
// Merchant names are drawn from a pool per category; the RNG picks one for
// each persona so different seeds use different store names.

const MERCHANT_POOL = {
  grocery: ["Second Gear Demo Grocer", "Fresh Market Demo", "Greenway Grocery Demo", "Corner Store Demo"],
  gas:     ["Second Gear Demo Gas", "QuickFuel Demo", "HarborFuel Demo", "RoadStop Demo"],
  restaurant: ["Second Gear Demo Diner", "Harvest Table Demo", "Riverside Cafe Demo", "Main Street Grill Demo"],
};

// ---------- address pool ----------

const ADDRESS_POOL = [
  { street_number: "1200", street_name: "Demo Ave",    city: "Columbus",    state: "OH", zip: "43215" },
  { street_number: "740",  street_name: "Market St",   city: "Columbus",    state: "OH", zip: "43206" },
  { street_number: "3301", street_name: "Olentangy Blvd", city: "Columbus", state: "OH", zip: "43202" },
];

const GEOCODE_POOL = [
  { lat: 39.9612, lng: -82.9988 },
  { lat: 39.9479, lng: -82.9812 },
  { lat: 40.0170, lng: -83.0129 },
];

// ---------- main builder ----------

/** @typedef {"checking" | "savings" | "card"} AccountKey */
/** @typedef {"grocery" | "gas" | "restaurant"} MerchantCategory */

/**
 * Builds every POST body for the demo persona, dated relative to `asOf`.
 * All amounts, balances, dates, and payee names are generated from a
 * seeded PRNG keyed on (personaId + asOf) — deterministic but not hardcoded.
 *
 * Records reference accounts by key and purchases reference merchants by
 * category; the runner swaps in real ids at apply time.
 *
 * Shape rules that keep the cash-flow analyzer honest:
 * - everything transacts on checking, so Nessie can't move the card balance
 *   that drives the card-minimum debt figure;
 * - rent and the loan are never also posted as withdrawals (no double count);
 * - nothing is deposited into savings (it would read as income);
 * - every record is 2–80 days old, inside the 90-day window.
 *
 * @param {{ asOf: string, personaId?: string, profile?: keyof typeof PROFILES }} options
 */
export function buildSeedDataset({ asOf, personaId = DEFAULT_PERSONA, profile: profileKey = "subprime" }) {
  const rng = makeRng(personaId, asOf);
  const p = PROFILES[profileKey];
  const day  = (/** @type {number} */ daysAgo) => isoDay(asOf, daysAgo);
  const tag  = (/** @type {string} */ text) => `${SEED_MARKER} ${text}`;

  // ---- persona address & merchants ----
  const addressIdx = rng.int(0, ADDRESS_POOL.length - 1);
  const address  = ADDRESS_POOL[addressIdx];
  const geocode  = GEOCODE_POOL[addressIdx];

  const merchantNames = {
    grocery:    rng.pick(MERCHANT_POOL.grocery),
    gas:        rng.pick(MERCHANT_POOL.gas),
    restaurant: rng.pick(MERCHANT_POOL.restaurant),
  };

  // ---- income ----
  const payrollAmount = rng.int(p.payrollMin, p.payrollMax);
  const sideAmount    = rng.int(p.sideIncomeMin, p.sideIncomeMax);
  const payrollPayee  = rng.pick(p.payrollPayees);
  const sidePayee     = rng.pick(p.sidePayees);

  // Biweekly payroll: 6 occurrences spread across the 90-day window.
  // Draw distinct days then sort; spacing stays natural because the pool is [3, 80].
  const payrollDays = rng.distinctDays(80, 6);
  // Monthly side income: 3 occurrences.
  const sideDays = rng.distinctDays(80, 3);

  const deposits = [
    ...payrollDays.map((d) => ({
      account: /** @type {AccountKey} */ ("checking"),
      body: { medium: "balance", status: TRANSACTION_STATUS, transaction_date: day(d), amount: payrollAmount, description: tag(`${payrollPayee} payroll (${day(d)})`) },
    })),
    ...sideDays.map((d) => ({
      account: /** @type {AccountKey} */ ("checking"),
      body: { medium: "balance", status: TRANSACTION_STATUS, transaction_date: day(d), amount: sideAmount, description: tag(`${sidePayee} (${day(d)})`) },
    })),
  ];

  // ---- withdrawals ----
  const electricPayee = rng.pick(p.electricPayees);
  // 3 ATM withdrawals, 3 electric ACH withdrawals, all on distinct days.
  const atmDays      = rng.distinctDays(80, 3);
  const electricDays = rng.distinctDays(80, 3);
  const atmAmount    = rng.int(p.atmMin, p.atmMax);

  const withdrawals = [
    ...atmDays.map((d) => ({
      account: /** @type {AccountKey} */ ("checking"),
      body: { medium: "balance", status: TRANSACTION_STATUS, transaction_date: day(d), amount: atmAmount, description: tag(`ATM cash (${day(d)})`) },
    })),
    ...electricDays.map((d) => ({
      account: /** @type {AccountKey} */ ("checking"),
      body: { medium: "balance", status: TRANSACTION_STATUS, transaction_date: day(d), amount: rng.int(p.electricMin, p.electricMax), description: tag(`${electricPayee} (${day(d)})`) },
    })),
  ];

  // ---- recurring bills ----
  // Recurring bills only. BillCreate rejects upcoming_payment_date ("extra
  // fields not permitted"); the sandbox computes it, and its bill list fails
  // for any bill without one. recurring_date is the due day and payment_date
  // the last due date on or before asOf.
  const rentPayee     = rng.pick(p.rentPayees);
  const internetPayee = rng.pick(p.internetPayees);
  const rentAmount    = rng.int(p.rentMin, p.rentMax);
  const internetAmount = rng.int(p.internetMin, p.internetMax);
  // Due days: rent on day 1–5, internet on day 10–20 (avoid end-of-month edge cases).
  const rentDueDay     = rng.int(1, 5);
  const internetDueDay = rng.int(10, 20);

  const recurring = (payee, label, dueDay, amount) => ({
    account: /** @type {AccountKey} */ ("checking"),
    body: {
      status: "recurring",
      payee,
      nickname: tag(label),
      payment_date: monthlyDueDates(asOf, dueDay).last,
      recurring_date: dueDay,
      payment_amount: amount,
    },
  });

  const bills = [
    recurring(rentPayee, "Rent", rentDueDay, rentAmount),
    recurring(internetPayee, "Internet", internetDueDay, internetAmount),
  ];

  // ---- purchases ----
  // Number of trips is drawn per category (within a realistic range).
  const groceryCount    = rng.int(8, 14);
  const gasCount        = rng.int(4, 8);
  const restaurantCount = rng.int(4, 8);

  const makePurchases = (merchant, label, count, amountMin, amountMax) => {
    const days = rng.distinctDays(80, count);
    return days.map((d) => ({
      account: /** @type {AccountKey} */ ("checking"),
      merchant: /** @type {MerchantCategory} */ (merchant),
      body: {
        medium: "balance",
        status: TRANSACTION_STATUS,
        purchase_date: day(d),
        amount: rng.int(amountMin, amountMax),
        description: tag(`${label} (${day(d)})`),
      },
    }));
  };

  const purchases = [
    ...makePurchases("grocery",    "Groceries", groceryCount,    p.groceryMin,    p.groceryMax),
    ...makePurchases("gas",        "Gas",       gasCount,        p.gasMin,        p.gasMax),
    ...makePurchases("restaurant", "Diner",     restaurantCount, p.restaurantMin, p.restaurantMax),
  ];

  // ---- loans ----
  const loanPayment = rng.int(p.loanPaymentMin, p.loanPaymentMax);
  const loanAmount  = rng.int(p.loanAmountMin, p.loanAmountMax);
  const loanScore   = rng.int(p.loanScoreMin, p.loanScoreMax);

  const loans = [
    {
      account: /** @type {AccountKey} */ ("checking"),
      body: {
        type: "small business",
        status: "approved",
        credit_score: loanScore,
        monthly_payment: loanPayment,
        amount: loanAmount,
        description: tag("Equipment loan"),
      },
    },
  ];

  // ---- accounts ----
  const checkingBalance = rng.int(p.checkingMin, p.checkingMax);
  const savingsBalance  = rng.int(p.savingsMin, p.savingsMax);
  const cardBalance     = rng.int(p.cardMin, p.cardMax);

  return {
    persona: personaId,
    asOf,
    customer: { first_name: "SecondGear", last_name: `Demo ${personaId}`, address: { ...address } },
    accounts: [
      { key: /** @type {AccountKey} */ ("checking"), body: { type: "Checking",     nickname: "Everyday Checking", rewards: 0, balance: checkingBalance } },
      { key: /** @type {AccountKey} */ ("savings"),  body: { type: "Savings",      nickname: "Rainy Day Savings", rewards: 0, balance: savingsBalance } },
      { key: /** @type {AccountKey} */ ("card"),     body: { type: "Credit Card",  nickname: "Starter Card",      rewards: 0, balance: cardBalance } },
    ],
    merchantsNeeded: (["grocery", "gas", "restaurant"]).map((cat) => ({
      category: /** @type {MerchantCategory} */ (cat),
      body: { name: merchantNames[cat], category: cat, address: { ...address }, geocode: { ...geocode } },
    })),
    deposits,
    withdrawals,
    bills,
    purchases,
    loans,
  };
}

/** @typedef {ReturnType<typeof buildSeedDataset>} SeedDataset */
