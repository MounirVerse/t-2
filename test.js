class TestTracker {
    constructor() {
        this.testId = new URLSearchParams(window.location.search).get('id');
        this.chart = null;
        this.test = null;
        this.priceData = [];
        this.positionSize = 10;
        this.init();
    }

    async init() {
        try {
            if (!this.testId) {
                throw new Error('No test ID provided');
            }
            await this.loadTest();
        } catch (error) {
            this.showError(error.message);
        }
    }

    async loadTest() {
        try {
            const response = await fetch('api.php?action=getTests');
            if (!response.ok) {
                throw new Error('Failed to fetch tests');
            }
            
            const tests = await response.json();
            this.test = tests.find(t => t.id === this.testId);
            
            if (!this.test) {
                throw new Error('Test not found');
            }

            await this.initializeChart();
            this.displayTestDetails();
            
            // Only start tracking if the test is still active
            if (this.test.status === 'active') {
                this.startTracking();
            }
        } catch (error) {
            console.error('Error loading test:', error);
            this.showError(error.message);
        }
    }

    async initializeChart() {
        const ctx = document.getElementById('testChart').getContext('2d');
        
        if (this.chart) {
            this.chart.destroy();
        }

        try {
            const response = await fetch(`api.php?action=getData&symbol=${this.test.symbol}&timeframe=${this.test.timeframe}&limit=50`);
            const data = await response.json();

            // Find the index where the signal started
            const signalTime = this.test.start_time * 1000;
            const startIndex = data.findIndex(candle => candle.time >= signalTime);
            
            // Get data around the signal (10 candles before and rest after)
            const relevantData = data.slice(Math.max(0, startIndex - 10));

            // Format data for chart
            this.priceData = relevantData.map(candle => ({
                time: new Date(candle.time),
                price: parseFloat(candle.close)
            }));

            // Calculate min and max prices for chart scaling
            const prices = relevantData.map(d => [parseFloat(d.high), parseFloat(d.low)]).flat();
            const minPrice = Math.min(...prices, this.test.sl, this.test.entry_price);
            const maxPrice = Math.max(...prices, this.test.tp, this.test.entry_price);
            const padding = (maxPrice - minPrice) * 0.1;

            // Calculate if winning or losing
            const pnl = this.calculateDollarPnL();
            const bgColor = pnl >= 0 ? 'rgba(76, 175, 80, 0.1)' : 'rgba(244, 67, 54, 0.1)';

            this.chart = new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: [{
                        label: 'Price',
                        data: this.priceData,
                        borderColor: '#4CAF50',
                        borderWidth: 1,
                        pointRadius: 0,
                        fill: false,
                        parsing: {
                            xAxisKey: 'time',
                            yAxisKey: 'price'
                        }
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    backgroundColor: bgColor,
                    plugins: {
                        legend: {
                            display: false
                        },
                        annotation: {
                            annotations: {
                                entry: {
                                    type: 'line',
                                    yMin: this.test.entry_price,
                                    yMax: this.test.entry_price,
                                    borderColor: '#fff',
                                    borderWidth: 2,
                                    borderDash: [5, 5],
                                    label: {
                                        content: `Entry ${this.test.entry_price}`,
                                        enabled: true
                                    }
                                },
                                tp: {
                                    type: 'line',
                                    yMin: this.test.tp,
                                    yMax: this.test.tp,
                                    borderColor: '#4CAF50',
                                    borderWidth: 2,
                                    borderDash: [5, 5],
                                    label: {
                                        content: `TP ${this.test.tp}`,
                                        enabled: true
                                    }
                                },
                                sl: {
                                    type: 'line',
                                    yMin: this.test.sl,
                                    yMax: this.test.sl,
                                    borderColor: '#f44336',
                                    borderWidth: 2,
                                    borderDash: [5, 5],
                                    label: {
                                        content: `SL ${this.test.sl}`,
                                        enabled: true
                                    }
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            type: 'time',
                            time: {
                                unit: this.getTimeUnit(this.test.timeframe)
                            },
                            grid: {
                                color: 'rgba(255, 255, 255, 0.1)'
                            },
                            ticks: {
                                color: '#fff'
                            }
                        },
                        y: {
                            min: minPrice - padding,
                            max: maxPrice + padding,
                            position: 'right',
                            grid: {
                                color: 'rgba(255, 255, 255, 0.1)'
                            },
                            ticks: {
                                color: '#fff'
                            }
                        }
                    }
                }
            });

            if (this.test.status !== 'active') {
                this.stopTracking();
            }
        } catch (error) {
            this.showError('Error initializing chart: ' + error.message);
        }
    }

    // Add this helper method to determine the time unit based on timeframe
    getTimeUnit(timeframe) {
        switch(timeframe) {
            case '1m':
            case '5m':
            case '15m':
                return 'minute';
            case '1h':
            case '4h':
                return 'hour';
            case '1d':
                return 'day';
            default:
                return 'minute';
        }
    }

    displayTestDetails() {
        const container = document.getElementById('testDetails');
        const profitLoss = this.calculateProfitLoss();
        const positionSize = this.test.position_size || 10;
        const quantity = this.calculateQuantity();
        
        container.innerHTML = `
            <div class="test-info ${this.test.type}-test">
                <h2>${this.test.type.toUpperCase()} Trade Test</h2>
                <p>Symbol: ${this.test.symbol}</p>
                <p>Position Size: $${positionSize.toFixed(2)} USDT</p>
                <p>Quantity: ${quantity.toFixed(8)} ${this.test.symbol.replace('USDT', '')}</p>
                <p>Entry Price: ${parseFloat(this.test.entry_price).toFixed(8)} USDT</p>
                <p>Take Profit: ${parseFloat(this.test.tp).toFixed(8)} USDT</p>
                <p>Stop Loss: ${parseFloat(this.test.sl).toFixed(8)} USDT</p>
                <p>Current Price: ${parseFloat(this.test.current_price || this.test.entry_price).toFixed(8)} USDT</p>
                <p>P/L: <span class="${profitLoss >= 0 ? 'profit' : 'loss'}">$${this.calculateDollarPnL().toFixed(2)} (${profitLoss.toFixed(2)}%)</span></p>
                <p>Start Time: ${new Date(this.test.start_time * 1000).toLocaleString()}</p>
                <p>Status: <span class="status-${this.test.status}">${this.test.status}</span></p>
            </div>
        `;
    }

    calculateQuantity() {
        const positionSize = this.test.position_size || 10;
        return positionSize / parseFloat(this.test.entry_price);
    }

    calculateProfitLoss() {
        if (!this.test.current_price) return 0;
        
        const entryPrice = parseFloat(this.test.entry_price);
        // Use final_price instead of current_price for completed/stopped tests
        const currentPrice = (this.test.status !== 'active' && this.test.final_price) ? 
            parseFloat(this.test.final_price) : 
            parseFloat(this.test.current_price);
        
        if (this.test.type === 'long') {
            return ((currentPrice - entryPrice) / entryPrice) * 100;
        } else {
            return ((entryPrice - currentPrice) / entryPrice) * 100;
        }
    }

    calculateDollarPnL() {
        if (!this.test.current_price) return 0;
        
        const positionSize = this.test.position_size || 10;
        
        // Use final_price instead of current_price for completed/stopped tests
        const currentPrice = (this.test.status !== 'active' && this.test.final_price) ? 
            parseFloat(this.test.final_price) : 
            parseFloat(this.test.current_price);
        
        const quantity = positionSize / parseFloat(this.test.entry_price);
        const entryValue = quantity * parseFloat(this.test.entry_price);
        const currentValue = quantity * currentPrice;
        
        return this.test.type === 'long' ? 
            currentValue - entryValue : 
            entryValue - currentValue;
    }

    startTracking() {
        this.trackingInterval = setInterval(async () => {
            // Only fetch new data if test is still active
            if (this.test.status === 'active') {
                try {
                    const response = await fetch(`api.php?action=getData&symbol=${this.test.symbol}&timeframe=${this.test.timeframe}&limit=1`);
                    const data = await response.json();
                    
                    if (data && data.length > 0) {
                        const currentPrice = parseFloat(data[0].close);
                        this.test.current_price = currentPrice;
                        
                        // Add new price to chart
                        this.priceData.push({
                            time: new Date(),
                            price: currentPrice
                        });
                        
                        if (this.priceData.length > 100) {
                            this.priceData.shift();
                        }
                        
                        // Update chart and details
                        this.updateChart();
                        this.checkTestStatus();
                        this.displayTestDetails();
                    }
                } catch (error) {
                    console.error('Tracking error:', error);
                }
            }
        }, 1000);
    }

    updateChart() {
        if (this.chart && this.test.status === 'active' && this.priceData.length > 0) {
            // Update last price
            this.priceData[this.priceData.length - 1] = {
                time: new Date(),
                price: this.test.current_price
            };

            this.chart.update('none');
        }
    }

    checkTestStatus() {
        if (this.test.status !== 'active') return;
        
        const currentPrice = parseFloat(this.test.current_price);
        const tp = parseFloat(this.test.tp);
        const sl = parseFloat(this.test.sl);
        
        let statusChanged = false;
        
        if (this.test.type === 'long') {
            if (currentPrice >= tp) {
                this.test.status = 'completed';
                this.test.final_price = tp;
                statusChanged = true;
            } else if (currentPrice <= sl) {
                this.test.status = 'stopped';
                this.test.final_price = sl;
                statusChanged = true;
            }
        } else {
            if (currentPrice <= tp) {
                this.test.status = 'completed';
                this.test.final_price = tp;
                statusChanged = true;
            } else if (currentPrice >= sl) {
                this.test.status = 'stopped';
                this.test.final_price = sl;
                statusChanged = true;
            }
        }
        
        if (statusChanged) {
            this.test.end_time = Math.floor(Date.now() / 1000);
            this.test.final_pnl = this.calculateDollarPnL();
            this.updateTestStatus();
            this.stopTracking();
        }
    }

    async updateTestStatus() {
        try {
            await fetch('api.php?action=updateTest', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(this.test)
            });
        } catch (error) {
            console.error('Error updating test status:', error);
        }
    }

    stopTracking() {
        if (this.trackingInterval) {
            clearInterval(this.trackingInterval);
            this.trackingInterval = null;
        }
    }

    showError(message) {
        const container = document.getElementById('testDetails');
        container.innerHTML = `
            <div class="error-message">
                ${message}
                <br>
                <div class="error-actions">
                    <button onclick="window.location.href='tests.html'" class="back-button">Back to Tests</button>
                </div>
            </div>
        `;
    }
}

// Initialize the test tracker
document.addEventListener('DOMContentLoaded', () => {
    new TestTracker();
}); 