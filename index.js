const axios = require("axios");
const fs = require("fs");
require("dotenv").config();
const {sendTelegram} = require("./telegram.js")


const SYMBOL = "USDTIRT";

// هر سفارش 50 تومن
const TRADE_AMOUNT = "1";

// درصدها
const BUY_DROP_PERCENT = 0.3;
const TAKE_PROFIT_PERCENT = 0.3;

let sessionToken = process.env.NOBI_TOKEN;

// فایل ذخیره‌ی قیمت آخر
const LAST_PRICE_FILE = "./lastPrice.json";

// ---------------------------
// لود کردن lastPrice از فایل
// ---------------------------
function loadLastPrice() {
    try {
        if (fs.existsSync(LAST_PRICE_FILE)) {
            const data = JSON.parse(fs.readFileSync(LAST_PRICE_FILE, "utf8"));
            return data.lastPrice || null;
        }
    } catch (err) {
        console.log("⚠️ Error loading lastPrice:", err);
    }
    return null;
}

// ---------------------------
// ذخیره lastPrice در فایل
// ---------------------------
function saveLastPrice(price) {
    try {
        fs.writeFileSync(LAST_PRICE_FILE, JSON.stringify({ lastPrice: price }), "utf8");
    } catch (err) {
        console.log("⚠️ Error saving lastPrice:", err);
    }
}

// مقدار اولیه
let lastPrice = loadLastPrice();

// ---------------------------
// نوشتن لاگ خرید/فروش
// ---------------------------
function writeTradeLog(type, price, amount) {
    const line = `${new Date().toISOString()} | ${type.toUpperCase()} | price=${price} | amount=${amount}\n`;
    fs.appendFileSync("./trade.log", line, "utf8");
}

// --------------------------------------------------
// CLEAN ERROR
// --------------------------------------------------
function cleanAxiosError(err) {
    const status = err.response?.status || null;
    const body = err.response?.data || null;
    const message = err.message;

    console.log("\n======= 🚨 NOBI API ERROR (CLEAN) 🚨 =======");
    if (status) console.log("STATUS:", status);
    if (body) console.log("BODY:", JSON.stringify(body, null, 2));
    console.log("MESSAGE:", message);
    console.log("===========================================\n");

    const e = new Error(message);
    e.status = status;
    e.body = body;
    return e;
}

// --------------------------------------------------
// AUTH POST
// --------------------------------------------------
async function nobiPost(url, data) {
    console.log("SESSION TOKEN:", sessionToken);
    try {
        const resp = await axios.post(url, data, {
            headers: {
                Authorization: `Token ${sessionToken}`,
                "Content-Type": "application/json"
            }
        });

        if (resp.data.code === "token_not_valid") {
            console.log("⚠️ Token expired → refreshing...");
            await fetchToken(); 
            return nobiPost(url, data);
        }

        return resp.data;

    } catch (err) {
        throw cleanAxiosError(err);
    }
}

// --------------------------------------------------
// PRICE FROM ORDERBOOK
// --------------------------------------------------
async function getPrice() {
    try {
        const url = `https://apiv2.nobitex.ir/v3/orderbook/${SYMBOL}`;
        const resp = await axios.get(url);

        const bestAsk = parseFloat(resp.data.asks[0][0]);
        const bestBid = parseFloat(resp.data.bids[0][0]);

        return (bestAsk + bestBid) / 2;
    } catch (err) {
        throw cleanAxiosError(err);
    }
}

// --------------------------------------------------
// PLACE ORDER
// --------------------------------------------------
async function placeOrder(type, price, amount) {
    const clientOrderId = `${Date.now()}`;

    const payload = {
        type,
        execution: "limit",
        price: Number(price),
        amount: Number(amount),
        srcCurrency: "usdt",
        dstCurrency: "rls",
        clientOrderId
    };

    try {
        const data = await nobiPost(
            "https://apiv2.nobitex.ir/market/orders/add",
            payload
        );

        console.log("DATA:", data);

        if (data.status === "failed") {
            console.log(`🔴 ORDER FAIL [${type}] price=${price} amount=${amount} ${data.message}`);
            sendTelegram(`ORDER FAIL [${type}] price=${price} amount=${amount} ${data.message}`)

            return data;
        } else {
            
            console.log(`🟢 ORDER OK [${type}] price=${price} amount=${amount} ${data.message}`);
            sendTelegram(`ORDER OK [${type}] price=${price} amount=${amount} ${data.message}`)

            writeTradeLog(type, price, amount);

            return data;
        }

    } catch (err) {
        console.log(`🔴 ORDER FAIL [${type}] price=${price} amount=${amount}`);
        sendTelegram(`ORDER FAIL [${type}] price=${price} amount=${amount}`)

        throw err;
    }
}

// --------------------------------------------------
// STRATEGY LOOP
// --------------------------------------------------
async function strategyLoop() {
    const price = await getPrice();

    // محاسبه روند
    let trend = "➡️ FLAT";
    let percentChange = 0;
    let diff = 0;

    if (lastPrice) {
        diff = price - lastPrice;
        percentChange = (diff / lastPrice) * 100;

        if (diff > 0) trend = "🔼 UP";
        else if (diff < 0) trend = "🔽 DOWN";
    }

    console.log(
        "💰 PRICE:", price,
        "| TREND:", trend,
        "| CHANGE:", percentChange.toFixed(3) + "%", `(${diff.toFixed(0)})`,
        "| BUY_POINT:", lastPrice ? (lastPrice * (1 - BUY_DROP_PERCENT / 100)).toFixed(0) : "-",
        "| SELL_POINT:", lastPrice ? (lastPrice * (1 + TAKE_PROFIT_PERCENT / 100)).toFixed(0) : "-"
    );

    if (!lastPrice) {
        lastPrice = price;
        saveLastPrice(price);
        console.log("📌 lastPrice set");
        return;
    }

    // BUY SIGNAL
    if (price <= lastPrice * (1 - BUY_DROP_PERCENT / 100)) {
        console.log("🟢 BUY SIGNAL");
        await placeOrder("buy", price, TRADE_AMOUNT);
        lastPrice = price;
        saveLastPrice(price);
        return;
    }

    // SELL SIGNAL
    if (price >= lastPrice * (1 + TAKE_PROFIT_PERCENT / 100)) {
        console.log("🔴 SELL SIGNAL");
        await placeOrder("sell", price, TRADE_AMOUNT);
        lastPrice = price;
        saveLastPrice(price);
        return;
    }
}

// --------------------------------------------------
// START
// --------------------------------------------------
console.log("🚀 Farshad Nobitex Bot Started...");
sendTelegram("🚀 Farshad Nobitex V1 Bot Started...")

setInterval(strategyLoop, 3000);
