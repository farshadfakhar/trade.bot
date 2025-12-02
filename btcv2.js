// index.js
require("dotenv").config();
const fs = require('fs');
const axios = require('axios');
const { fetchCandles } = require('./candleFetcher');
const { analyzeMarket } = require('./aiDecision');
const { sendTelegram } = require('./telegram.js');

// Load last state
const stateFilePath = './lastPrice.json';

const TRADE_AMOUNT = 5;
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

async function placeOrder(type, price) {
    let amount = Math.floor(TRADE_AMOUNT / price * 1e6) / 1e6;
    console.log({
        type,
        execution: "limit",
        price: Number(price),
        amount: Number(amount),
        srcCurrency: "btc",
        dstCurrency: "usdt",
        clientOrderId: String(Date.now())
    })
    const payload = {
        type,
        execution: "limit",
        price: Number(price),
        amount: Number(amount),
        srcCurrency: "btc",
        dstCurrency: "usdt",
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

    // -------------------------
    // UPDATE lastPriceStored
    // -------------------------
    lastPriceStored = price;
    saveState();

    sendTelegram(`ORDER OK: ${type} ${price} ${amount}`)

    return true;
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
        const place = await placeOrder('buy', bestSell);
        if (place) {
            data.lastPrice = bestSell;
            data.buys += 1;
            sendTelegram(`Buy executed at price: ${bestSell}`);
            console.log(`Buy executed at price: ${bestSell}`);
        }
    }

    // SELL (target profit or trend break)
    if (analysis.signal === 'sell') {

        if (data.lastPrice === 0) {
            console.log("Sell signal received but lastPrice is 0. Ignoring.");
            sendTelegram("Sell signal received but no active position found.");
        }

        const target = profitTarget(data.lastPrice);

        if (bestBuy >= target) {
            const place = await placeOrder('sell', bestBuy);
            if (place) {
                sendTelegram(`Sell executed with +1% profit at price: ${bestBuy}`);
                console.log(`Sell executed with +1% profit at price: ${bestBuy}`);
                data.lastPrice = 0;
                data.buys = 0;
            }
        } else {
            sendTelegram(`Sell signal detected, but price has not reached 1% target. Current: ${bestBuy}, Target: ${target}`);
            console.log(`Sell signal detected, but target not reached. Current: ${bestBuy}, Target: ${target}`);
        }
    }

    // Update bot state
    data.state = analysis.nextState;
    saveState(data);
}

// Loop every 5 seconds
setInterval(logicLoop, 5000);

sendTelegram("BTC/USDT bot is now running with new FSM and full candle analysis...");
console.log("Bot started: BTC/USDT FSM + 5m candle analysis active.");
