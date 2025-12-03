// index.js
require("dotenv").config();
const fs = require('fs');
const axios = require('axios');
const { fetchCandles } = require('./candleFetcher');
const { analyzeMarket } = require('./aiDecision');
const { sendTelegram } = require('./telegram.js');

// Load last state
const stateFilePath = './lastPrice.json';

const TRADE_AMOUNT = 7;
const SYMBOL = 'BTCUSDT';
const SESSION = process.env.NOBI_TOKEN;

function loadState() {
    try {
        return JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'));
    } catch {
        return {
            lastPrice: 0,
            state: 'WAIT',
            buys: 0
        };
    }
}

function saveState(data) {
    console.log('-----DATA----', data)
    fs.writeFileSync(stateFilePath, JSON.stringify(data, null, 2));
}



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
                Authorization: `Token ${SESSION}`,
                "Content-Type": "application/json"
            }
        });

        return resp.data;

    } catch (err) {
        throw cleanAxiosError(err);
    }
}

// LOG
function writeTradeLog(type, price, amount) {
    const line = `${new Date().toISOString()} | ${type.toUpperCase()} | price=${price} | amount=${amount}\n`;
    fs.appendFileSync("./trade.log", line, "utf8");
}

async function placeOrder(type, price, customAmount = null) {
    // اگر customAmount نداشت یعنی BUY هست
    let amount;

    if (customAmount !== null) {
        amount = customAmount;
    } else {
        // BUY مقدار دلار ثابت
        amount = Math.floor(TRADE_AMOUNT / price * 1e6) / 1e6;
    }

    // ---- مانع معامله زیر حداقل 5 USDT ----
    if (price * amount < 5) {
        console.log(`❌ Trade rejected: total value < 5 USDT (value=${price * amount})`);
        sendTelegram(`❌ Trade rejected: Below minimum 5 USDT (value=${price * amount})`);
        return false;
    }

    const payload = {
        type,
        execution: "limit",
        price: Number(price),
        amount: Number(amount),
        srcCurrency: "btc",
        dstCurrency: "usdt",
        clientOrderId: String(Date.now())
    };

    console.log("ORDER PAYLOAD:", payload);
    sendTelegram(`ORDERING: ${type} | ${price} | amount=${amount}`);

    const data = await nobiPost("https://apiv2.nobitex.ir/market/orders/add", payload);

    if (data.status === "failed") {
        console.log("ORDER FAIL:", data);
        sendTelegram(`ORDER FAIL: ${data.message}`);
        return false;
    }

    writeTradeLog(type, price, amount);
    sendTelegram(`ORDER OK: ${type} ${price} amount=${amount}`);
    return true;
}


// GET BALANCE
async function getBalance(cur) {
    const data = await nobiPost(
        "https://apiv2.nobitex.ir/users/wallets/balance",
        { currency: cur }
    );

    if (data.status !== "ok") return 0;
    return parseFloat(data.balance);
}

async function getOrderBook() {
    const url = "https://apiv2.nobitex.ir/v3/orderbook/BTCUSDT";
    const res = await axios.get(url);
    return res.data;
}

function profitTarget(buyPrice) {
    return Number((buyPrice * 1.01).toFixed(2));
}

async function logicLoop() {
    let data = loadState();

    // Fetch candles (5 minutes)
    const candles = await fetchCandles(SYMBOL, 5, 50);

    // Analyze market condition
    const analysis = analyzeMarket(candles, data.state);
    // Orderbook
    const orderBook = await getOrderBook();
    const bestBuy = Number(orderBook.bids[0][0]);
    const bestSell = Number(orderBook.asks[0][0]);

    console.log(`State=${data.state} → Next=${analysis.nextState} | Signal=${analysis.signal} | BESTBUY: ${bestBuy} | BEST SELL: ${bestSell}`);

    // BUY
    if (analysis.signal === 'buy') {
        if (!data.lastPrice) {
            const place = await placeOrder('buy', bestSell);
            if (place) {
                data.lastPrice = bestSell;
                data.buys += 1;
                sendTelegram(`Buy executed at price: ${bestSell}`);
                console.log(`Buy executed at price: ${bestSell}`);
            }
        }
        else{
            console.log("Position already open. Skipping BUY until we SELL.");
            sendTelegram("Position already open. Skipping BUY until we SELL.");

        }
    }

    if (analysis.signal === 'sell') {

        if (data.lastPrice === 0) {
            console.log("Sell signal received but lastPrice is 0. Ignoring.");
            sendTelegram("Sell signal received but no active position found.");
            return;
        }

        const target = profitTarget(data.lastPrice);

        if (bestBuy >= target) {
            const balanceBTC = await getBalance("btc");

            if (balanceBTC <= 0) {
                sendTelegram("❌ SELL FAILED: No BTC balance");
                console.log("No BTC balance to sell.");
                return;
            }

            // کنترل حداقل معامله 5 تتر
            if (balanceBTC * bestBuy < 5) {
                sendTelegram("❌ SELL BLOCKED: Value < 5 USDT (minimum trade)");
                console.log("Trade rejected: value < 5 USDT");
                return;
            }

            const place = await placeOrder('sell', bestBuy, balanceBTC);

            if (place) {
                sendTelegram(`Sell executed at ${bestBuy} | amount=${balanceBTC}`);
                console.log(`Sell executed at ${bestBuy}`);
                data.lastPrice = 0;
                data.buys = 0;
            }

        } else {
            console.log(`Sell signal detected, but price < target. Now=${bestBuy}, Target=${target}`);
            sendTelegram(`Sell signal detected, but price < target`);
            data.state = 'HOLD'
        }
    }

    // Update bot state
    data.state = analysis.nextState;
    saveState(data);
}

// Loop every 5 seconds
setInterval(logicLoop, 2000);

sendTelegram("BTC/USDT bot is now running with new FSM and full candle analysis...");
console.log("Bot started: BTC/USDT FSM + 5m candle analysis active.");
