/**
 * aiDecision.js — FULL LOGS + SOFT‑CROSS BUY
 * Compatible with Nobitex candle format: [timestamp, open, high, low, close]
 */

function ema(data, period) {
    const k = 2 / (period + 1);
    let emaPrev = data[0];
    const result = [emaPrev];

    for (let i = 1; i < data.length; i++) {
        emaPrev = data[i] * k + emaPrev * (1 - k);
        result.push(emaPrev);
    }
    return result;
}

function analyzeMarket(candles, currentState) {
    if (!candles || candles.length < 30) {
        console.log("❗ Candle data insufficient (<30). Holding...");
        return { signal: "hold", nextState: currentState };
    }

    // Nobitex array format → [t, open, high, low, close]
    const closes = candles.map(c => Number(c[4]));
    const last = closes.length - 1;

    // Indicators
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);

    const e20 = ema20[last];
    const e50 = ema50[last];
    const prevE20 = ema20[last - 1];
    const price = closes[last];
    const prevPrice = closes[last - 1];

    // Momentum / Slope
    const ema20SlopeUp = e20 > prevE20;
    const ema20SlopeDown = e20 < prevE20;

    const priceAboveE20 = price > e20;
    const priceBelowE20 = price < e20;

    // Trend
    const trendUp = e20 > e50;
    const trendDown = e20 < e50;

    // ⭐ Soft-Cross Condition (مهم!)
    const softCross = e20 >= e50 * 0.995;

    console.log("\n----------------------------------");
    console.log("📊 MARKET CHECK (Soft‑Cross)");
    console.log("----------------------------------");
    console.log("Price:", price);
    console.log("EMA20:", e20, " | Prev:", prevE20);
    console.log("EMA50:", e50);
    console.log("Slope20:", (e20 - prevE20).toFixed(6));
    console.log("Price > EMA20:", priceAboveE20);
    console.log("SoftCross (E20 >= E50*0.995):", softCross);
    console.log("Trend Up:", trendUp, "| Trend Down:", trendDown);
    console.log("Current State:", currentState);
    console.log("----------------------------------");

    // ----------------------- FSM LOGIC -----------------------

    switch (currentState) {

        case "WAIT":
            console.log("🟡 STATE: WAIT — Waiting for DOWN trend start...");

            if (trendDown) {
                console.log("⬇ EMA20 < EMA50 → DOWN trend detected → switching to DOWN");
                return { signal: "hold", nextState: "DOWN" };
            }

            console.log("⏳ Still WAIT. Trend not DOWN yet.");
            return { signal: "hold", nextState: "WAIT" };


        case "DOWN":
            console.log("🔴 STATE: DOWN — Checking BUY (Soft‑Cross)");

            console.log("\n📌 BUY CONDITIONS:");
            console.log("1) EMA20 Slope Up:", ema20SlopeUp);
            console.log("2) Price > EMA20:", priceAboveE20);
            console.log("3) Soft-Cross (E20 >= E50*0.995):", softCross);

            let buyScore = 0;
            if (ema20SlopeUp) buyScore++;
            if (priceAboveE20) buyScore++;
            if (softCross) buyScore++;

            console.log(`🎯 BUY Progress: ${buyScore}/3`);

            if (buyScore === 3) {
                console.log("💚 ALL BUY CONDITIONS MATCH → BUY SIGNAL");
                return { signal: "buy", nextState: "HOLD" };
            }

            console.log("⏳ Conditions incomplete. Staying DOWN.");
            return { signal: "hold", nextState: "DOWN" };


        case "HOLD":
            console.log("🟢 STATE: HOLD — Position open. Checking SELL...");

            console.log("\n📌 SELL CONDITIONS:");
            console.log("1) Trend Down (E20 < E50):", trendDown);
            console.log("2) Price < EMA20:", priceBelowE20);
            console.log("3) EMA20 Slope Down:", ema20SlopeDown);

            let sellScore = 0;
            if (trendDown) sellScore++;
            if (priceBelowE20) sellScore++;
            if (ema20SlopeDown) sellScore++;

            console.log(`🔥 SELL Progress: ${sellScore}/3`);

            if (sellScore >= 2) {
                console.log("🔻 SELL SIGNAL (≥2/3 conditions matched)");
                return { signal: "sell", nextState: "WAIT" };
            }

            console.log("⏳ HOLDING. No SELL triggered.");
            return { signal: "hold", nextState: "HOLD" };


        default:
            console.log("⚪ Unknown state → Resetting to WAIT");
            return { signal: "hold", nextState: "WAIT" };
    }
}

module.exports = { analyzeMarket };
