// aiDecision.js

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
        return { signal: 'hold', nextState: currentState };
    }
    
    const closes = candles.map(c => Number(c[4]));
    const last = closes.length - 1;

    // EMA20 & EMA50
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);

    const lastE20 = ema20[last];
    const lastE50 = ema50[last];

    // Trend detection
    const trendDown = lastE20 < lastE50;
    const trendUp   = lastE20 > lastE50;
    console.log('UP:', trendUp, 'DOWN:', trendDown, '----', lastE20, '<' , lastE50)

    // Momentum (close > previous close)
    const momentumPositive = closes[last] > closes[last - 1];
    console.log('momentumPositive', momentumPositive, closes[last], '>', closes[last - 1])

    // Reversal candle: strong wick + close higher than previous candle close
    const prevClose = closes[last - 1];
    const currOpen  = Number(candles[last][1]);
    const currClose = Number(candles[last][4]);
    const currLow   = Number(candles[last][3]);

    const longWickDown = (currOpen - currLow) > ((currOpen - currClose) * 1.5);
    const reversalCandle = (currClose > prevClose) && longWickDown;

    // --------------------------
    // FSM logic
    // --------------------------

    switch (currentState) {

        case 'WAIT':
            if (trendDown) {
                return { signal: 'hold', nextState: 'DOWN' };
            }
            return { signal: 'hold', nextState: 'WAIT' };

        case 'DOWN':
            if (reversalCandle && momentumPositive) {
                return { signal: 'hold', nextState: 'REVERSAL' };
            }
            if (!trendDown) {
                return { signal: 'hold', nextState: 'WAIT' };
            }
            return { signal: 'hold', nextState: 'DOWN' };

        case 'REVERSAL':
            if (trendUp && momentumPositive) {
                return { signal: 'buy', nextState: 'HOLD' };
            }
            if (trendDown) {
                return { signal: 'hold', nextState: 'DOWN' };
            }
            return { signal: 'hold', nextState: 'REVERSAL' };

        case 'HOLD':
            if (!trendUp) {
                return { signal: 'sell', nextState: 'WAIT' };
            }
            return { signal: 'hold', nextState: 'HOLD' };

        default:
            return { signal: 'hold', nextState: 'WAIT' };
    }
}

module.exports = { analyzeMarket };
