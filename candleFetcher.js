// candleFetcher.js
const axios = require('axios');

async function fetchCandles(symbol = 'BTCUSDT', resolution = '60', limit = 50) {
    try {
        const url = 'https://apiv2.nobitex.ir/market/udf/history';

        // زمان پایان = الان
        const to = Math.floor(Date.now() / 1000);

        const params = {
            symbol,
            resolution: String(resolution),  // مثل "5"
            from: to - 3600,
            to,
            countback: limit                 // تعداد کندل
        };

        const res = await axios.get(url, { params,  headers: {
            "User-Agent": "curl/7.88.1",
            "Accept": "*/*"
        },
        timeout: 5000 });

        if (!res.data || res.data.s !== 'ok') {
            console.error('UDF fetch error:', res.data);
            return null;
        }

        const { t, o, h, l, c, v } = res.data;

        // استانداردسازی ساختار خروجی
        const candles = t.map((timestamp, i) => [
            timestamp,
            o[i],
            h[i],
            l[i],
            c[i],
            v[i]
        ]);

        return candles;

    } catch (err) {
        console.error('fetchCandles error:', err.message);
        return null;
    }
}

module.exports = { fetchCandles };
