const axios = require("axios");
const fs = require("fs");
const { sendTelegram } = require("./telegram.js")
require("dotenv").config();

const SYMBOL = "USDTIRT";

const TRADE_AMOUNT = "2";
const TAKE_PROFIT_PERCENT = 1;

// /////// STATE MACHINE ///////
let STATE = "WAIT";
let last3 = [];
let buys = [];

let sessionToken = process.env.NOBI_TOKEN;

const PRICE_FILE = "./lastPrice.json";

function saveState() {
    fs.writeFileSync(
        PRICE_FILE,
        JSON.stringify({ STATE, buys, last3 }),
        "utf8"
    );
}

function loadState() {

    if (!fs.existsSync(PRICE_FILE)) return;
    try {
        const d = JSON.parse(fs.readFileSync(PRICE_FILE, "utf8"));
        STATE = d.STATE || "WAIT";
        buys = d.buys || [];
        last3 = d.last3 || [];
    } catch { }
}

loadState();

// LOG
function writeTradeLog(type, price, amount) {
    const line = `${new Date().toISOString()} | ${type.toUpperCase()} | price=${price} | amount=${amount}\n`;
    fs.appendFileSync("./trade.log", line, "utf8");
}

// CLEAN ERR
function cleanAxiosError(err) {
    const status = err.response?.status;
    const body = err.response?.data;
    console.log("NOBITEX ERROR:", status, body);
    return new Error(err.message);
}

// NOBI POST
async function nobiPost(url, data) {
    try {
        const resp = await axios.post(url, data, {
            headers: {
                Authorization: `Token ${sessionToken}`,
                "Content-Type": "application/json"
            }
        });

        return resp.data;

    } catch (err) {
        throw cleanAxiosError(err);
    }
}

// GET PRICE
async function getPrice() {
    const url = `https://apiv2.nobitex.ir/v3/orderbook/${SYMBOL}`;
    const resp = await axios.get(url);

    const ask = parseFloat(resp.data.asks[0][0]);
    const bid = parseFloat(resp.data.bids[0][0]);

    return {
        mid: (ask + bid) / 2,
        ask,
        bid
    };
}

// PLACE ORDER
async function placeOrder(type, price, amount) {
    const payload = {
        type,
        execution: "limit",
        price: Number(price),
        amount: Number(amount),
        srcCurrency: "usdt",
        dstCurrency: "rls",
        clientOrderId: String(Date.now())
    };

    const data = await nobiPost(
        "https://apiv2.nobitex.ir/market/orders/add",
        payload
    );

    if (data.status === "failed") {
        console.log("ORDER FAIL:", data);
        sendTelegram(`ORDER FAIL: ${data.message} ${data.code}`)

        return false;
    }

    writeTradeLog(type, price, amount);
    sendTelegram(`ORDER OK: ${type} ${price} ${amount}`)

    return true;
}

// CALC AVERAGE COST
function getAverageBuy() {
    if (buys.length === 0) return null;
    let sumCost = 0;
    let sumAmount = 0;
    for (let b of buys) {
        sumCost += b.price * b.amount;
        sumAmount += b.amount;
    }
    return sumCost / sumAmount;
}

/* ============================================
    EMERGENCY SELL: SELL ALL USDT
============================================ */

// GET BALANCE
async function getBalance(cur) {
    const data = await nobiPost(
        "https://apiv2.nobitex.ir/users/wallets/balance",
        { currency: cur }
    );

    if (data.status !== "ok") return 0;
    return parseFloat(data.balance);
}

// SELL ALL USDT
async function emergencySell() {
    try {
        const usdt = await getBalance("usdt");
        if (usdt <= 0) return;

        const p = await getPrice();
        const price = p.bid;

        console.log("⚠️ EMERGENCY SELL →", usdt, "@", price);
        sendTelegram(`⚠️ EMERGENCY SELL TRIGGERED → ${usdt} @ ${price}`);

        await placeOrder("sell", price, usdt);

    } catch (e) {
        console.log("EMERGENCY SELL ERROR:", e);
    }
}

/* ============================================
    STRATEGY LOOP
============================================ */

async function strategyLoop() {
    const { mid: price } = await getPrice();

    last3.push(price);
    if (last3.length > 3) last3.shift();

    console.log("\nSTATE:", STATE, "| PRICE:", price);

    // ----------------------------------------------
    // EMERGENCY SELL CONDITION
    // سه کندل ریزشی پشت هم
    // ----------------------------------------------
    if (
        last3.length === 3 &&
        last3[0] > last3[1] &&
        last3[1] > last3[2]
    ) {
        console.log("⚠️ HARD DOWN TREND → SELLING ALL USDT");
        sendTelegram("⚠️ HARD DOWN TREND → SELLING ALL USDT");

        await emergencySell();

        STATE = "WAIT";
        buys = [];
        last3 = [];
        saveState();
        return;
    }

    // ------------------- WAIT -------------------
    if (STATE === "WAIT") {
        if (last3.length === 3) {
            STATE = "DOWN";
            saveState();
        }
        return;
    }

    // ------------------- DOWN -------------------
    if (STATE === "DOWN") {
        if (
            last3.length === 3 &&
            last3[0] > last3[1] &&
            last3[1] > last3[2]
        ) {
            console.log("📉 MARKET IN DOWN TREND");
            sendTelegram("MARKET IN DOWN TREND")
            return;
        } else {
            console.log("↗️ POSSIBLE REVERSAL, waiting confirmation...");
            sendTelegram("POSSIBLE REVERSAL, waiting confirmation...")

            STATE = "REVERSAL";
            saveState();
            return;
        }
    }

    // ------------------- REVERSAL -------------------
    if (STATE === "REVERSAL") {
        if (last3[2] > last3[1]) {
            console.log("🔵 UP CANDLE → Checking Higher-Low...");
            sendTelegram("UP CANDLE → Checking Higher-Low...")

            if (last3[1] > last3[0]) {
                console.log("🟢 REVERSAL CONFIRMED → BUYING");
                sendTelegram("REVERSAL CONFIRMED → BUYING")

                const ok = await placeOrder("buy", price, TRADE_AMOUNT);
                if (ok) {
                    buys.push({ price, amount: Number(TRADE_AMOUNT) });
                    STATE = "HOLD";
                    saveState();
                }
                return;
            }
        }
        return;
    }

    // ------------------- HOLD -------------------
    if (STATE === "HOLD") {
        const avg = getAverageBuy();
        const tp = avg * (1 + TAKE_PROFIT_PERCENT / 100);

        console.log("📈 AVG:", avg, "| TP:", tp);

        if (price >= tp) {
            console.log("🔴 TAKE PROFIT TRIGGERED → SELL");
            sendTelegram("TAKE PROFIT TRIGGERED → SELL")

            const ok = await placeOrder("sell", price, TRADE_AMOUNT);
            if (ok) {
                STATE = "WAIT";
                buys = [];
                last3 = [];
                saveState();
            }
        }

        return;
    }
}

async function getCurrentWallet(){
    const usdt = await getBalance("usdt");
    const rls = await getBalance("rls");
    console.log(`WALLET   USDT: ${usdt} | RIAL: ${rls}`)
    sendTelegram(`WALLET   USDT: ${usdt} | RIAL: ${rls}`)

}

// START
console.log("🚀 Farshad Trend-Reversal Bot Started...");
sendTelegram("🚀 Farshad Trend-Reversal Bot Started...")

setInterval(strategyLoop, 6000);
setInterval(getCurrentWallet, 1000 * 60 * 60)
getCurrentWallet()
