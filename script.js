class TradingAnalyzer {
    constructor() {
        this.chart = null;
        this.initializeEventListeners();
        // Make the instance globally accessible
        window.analyzer = this;
    }

    initializeEventListeners() {
        document.getElementById('analyze').addEventListener('click', () => this.fetchAndAnalyzeData());
    }

    async fetchAndAnalyzeData() {
        const symbol = document.getElementById('symbol').value;
        const timeframe = document.getElementById('timeframe').value;
        
        try {
            const response = await fetch(`api.php?action=getData&symbol=${symbol}&timeframe=${timeframe}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            if (data.error) {
                throw new Error(data.error);
            }
            this.processData(data);
        } catch (error) {
            console.error('Error fetching data:', error);
            // Show error to user
            const signalsList = document.getElementById('signalsList');
            signalsList.innerHTML = `<p class="error-message">Error: ${error.message}</p>`;
        }
    }

    processData(data) {
        const signals = this.analyzeMarket(data);
        this.updateChart(data);
        this.displaySignals(signals);
    }

    analyzeMarket(data) {
        const signals = [];
        const prices = data.map(candle => candle.close);
        
        // Get the most recent candle data
        const lastCandle = data[data.length - 1];
        const lastPrice = lastCandle.close;
        
        // Calculate various technical indicators
        const shortMA = this.calculateSMA(prices, 9);
        const longMA = this.calculateSMA(prices, 21);
        const rsi = this.calculateRSI(prices, 14);
        
        // Get the last values
        const lastShortMA = shortMA[shortMA.length - 1];
        const lastLongMA = longMA[longMA.length - 1];
        const lastRSI = rsi[rsi.length - 1];
        
        // Calculate price trend
        const priceChange = (lastPrice - prices[prices.length - 2]) / prices[prices.length - 2] * 100;
        const maConvergence = (lastShortMA - lastLongMA) / lastLongMA * 100;

        // Signal conditions
        const potentialLong = (
            lastRSI < 40 && // Oversold condition
            lastShortMA > lastLongMA * 0.995 && // MAs are close to crossing
            lastShortMA < lastLongMA && // But haven't crossed yet
            priceChange > -0.1 // Price is stabilizing
        );

        const potentialShort = (
            lastRSI > 60 && // Overbought condition
            lastShortMA < lastLongMA * 1.005 && // MAs are close to crossing
            lastShortMA > lastLongMA && // But haven't crossed yet
            priceChange < 0.1 // Price is stabilizing
        );

        if (potentialLong) {
            signals.push({
                type: 'long',
                price: lastPrice,
                time: lastCandle.time,
                tp: lastPrice * 1.02,
                sl: lastPrice * 0.99,
                confidence: this.calculateConfidence('long', lastRSI, maConvergence)
            });
        }

        if (potentialShort) {
            signals.push({
                type: 'short',
                price: lastPrice,
                time: lastCandle.time,
                tp: lastPrice * 0.98,
                sl: lastPrice * 1.01,
                confidence: this.calculateConfidence('short', lastRSI, maConvergence)
            });
        }

        return signals;
    }

    calculateSMA(prices, period) {
        const sma = [];
        for (let i = 0; i < prices.length; i++) {
            if (i < period - 1) {
                sma.push(null);
                continue;
            }
            const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
            sma.push(sum / period);
        }
        return sma;
    }

    calculateRSI(prices, period) {
        const changes = [];
        for (let i = 1; i < prices.length; i++) {
            changes.push(prices[i] - prices[i - 1]);
        }

        const rsi = [];
        let gains = [];
        let losses = [];

        // Calculate initial average gain and loss
        for (let i = 0; i < period; i++) {
            const change = changes[i];
            gains.push(change > 0 ? change : 0);
            losses.push(change < 0 ? -change : 0);
        }

        let avgGain = gains.reduce((a, b) => a + b, 0) / period;
        let avgLoss = losses.reduce((a, b) => a + b, 0) / period;

        // Calculate RSI
        for (let i = period; i < changes.length; i++) {
            const change = changes[i];
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? -change : 0;

            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;

            const rs = avgGain / (avgLoss === 0 ? 1 : avgLoss);
            rsi.push(100 - (100 / (1 + rs)));
        }

        return rsi;
    }

    calculateConfidence(type, rsi, maConvergence) {
        let confidence = 50; // Base confidence

        if (type === 'long') {
            // Stronger signal if RSI is more oversold
            confidence += (40 - rsi) * 1.5;
            // Stronger signal if MAs are closer to crossing
            confidence += (1 - maConvergence) * 10;
        } else {
            // Stronger signal if RSI is more overbought
            confidence += (rsi - 60) * 1.5;
            // Stronger signal if MAs are closer to crossing
            confidence += (1 - Math.abs(maConvergence)) * 10;
        }

        // Limit confidence between 0 and 100
        return Math.min(Math.max(confidence, 0), 100).toFixed(1);
    }

    updateChart(data) {
        const ctx = document.getElementById('priceChart').getContext('2d');
        
        if (this.chart) {
            this.chart.destroy();
        }

        // Prepare the data
        const chartData = data.map(candle => ({
            x: new Date(parseInt(candle.time)), // Ensure proper date conversion
            y: parseFloat(candle.close)
        }));

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Price',
                    data: chartData,
                    borderColor: '#4CAF50',
                    borderWidth: 1,
                    pointRadius: 0,
                    fill: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'hour',
                            displayFormats: {
                                hour: 'MMM d, HH:mm'
                            }
                        },
                        grid: {
                            color: '#333'
                        },
                        ticks: {
                            color: '#fff'
                        }
                    },
                    y: {
                        grid: {
                            color: '#333'
                        },
                        ticks: {
                            color: '#fff'
                        }
                    }
                },
                plugins: {
                    legend: {
                        labels: {
                            color: '#fff'
                        }
                    }
                }
            }
        });
    }

    displaySignals(signals) {
        const signalsList = document.getElementById('signalsList');
        signalsList.innerHTML = '';

        if (signals.length === 0) {
            signalsList.innerHTML = '<p class="no-signals">No potential signals detected</p>';
            return;
        }

        signals.forEach(signal => {
            const signalElement = document.createElement('div');
            signalElement.className = `signal-item signal-${signal.type}`;
            
            const price = signal.price.toFixed(2);
            const tp = signal.tp.toFixed(2);
            const sl = signal.sl.toFixed(2);
            
            const profitPercent = ((signal.type === 'long' ? 
                (signal.tp - signal.price) : (signal.price - signal.tp)) / signal.price * 100).toFixed(2);
            const lossPercent = ((signal.type === 'long' ? 
                (signal.price - signal.sl) : (signal.sl - signal.price)) / signal.price * 100).toFixed(2);

            // Change the onclick to use the global analyzer instance
            signalElement.innerHTML = `
                <h3>Potential ${signal.type.toUpperCase()} Signal</h3>
                <p class="confidence">Signal Strength: <span>${signal.confidence}%</span></p>
                <p>Suggested Entry: ${price} USDT</p>
                <p>Take Profit: ${tp} USDT <span class="profit">(${profitPercent}%)</span></p>
                <p>Stop Loss: ${sl} USDT <span class="loss">(${lossPercent}%)</span></p>
                <p>Current Time: ${new Date().toLocaleString()}</p>
                <button class="test-button" onclick='window.analyzer.testSignal(${JSON.stringify(signal).replace(/'/g, "&#39;")})'>Test Signal</button>
            `;
            signalsList.appendChild(signalElement);
        });
    }

    async testSignal(signal) {
        try {
            const testData = {
                ...signal,
                symbol: document.getElementById('symbol').value,
                timeframe: document.getElementById('timeframe').value,
                entry_price: signal.price,
                current_price: signal.price
            };

            const response = await fetch('api.php?action=saveTest', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(testData)
            });

            const result = await response.json();
            if (result.id) {
                // Save to local storage
                const localTests = JSON.parse(localStorage.getItem('tradingTests') || '[]');
                localTests.push({...testData, id: result.id, status: 'active', start_time: Math.floor(Date.now() / 1000)});
                localStorage.setItem('tradingTests', JSON.stringify(localTests));
                
                // Redirect to tests list instead of individual test
                window.location.href = 'tests.html';
            }
        } catch (error) {
            console.error('Error saving test:', error);
            alert('Error saving test: ' + error.message);
        }
    }
}

// Initialize the analyzer when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new TradingAnalyzer();
}); 