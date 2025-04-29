class SignalsManager {
    constructor() {
        this.signals = [];
        this.symbols = [];
        this.timeframes = ['1m', '5m', '15m','30m', '1h', '4h', '1d'];
        this.analysisQueue = [];
        this.autoTestThreshold = 80;
        this.refreshInterval = 1 * 60 * 1000; // 5 minutes
        this.symbolsRefreshInterval = 15 * 60 * 1000; // 15 minutes
        this.lastPairsUpdate = Date.now();
        this.lastSignalsUpdate = Date.now();
        this.init();
        this.startTimers();
    }

    async init() {
        await this.loadAllSymbols();
        this.setupFilters();
        await this.refreshSignals();
        this.startAutoRefresh();
        this.startSymbolsAutoRefresh();
    }

    startSymbolsAutoRefresh() {
        // Initial symbols refresh
        setInterval(async () => {
            console.log('Refreshing top 50 pairs...');
            await this.loadAllSymbols();
            // After loading new symbols, refresh signals
            await this.refreshSignals();
        }, this.symbolsRefreshInterval);
    }

    async loadAllSymbols() {
        try {
            const response = await fetch('api.php?action=getAllSymbols');
            const data = await response.json();
            
            if (!Array.isArray(data)) {
                throw new Error('Invalid data format from API');
            }
            
            // Check if symbols have changed
            const newSymbols = data.sort().join(',');
            const oldSymbols = this.symbols.sort().join(',');
            
            if (newSymbols !== oldSymbols) {
                console.log('Symbols list updated');
                this.symbols = data;
                
                // Update symbol filter
                const symbolFilter = document.getElementById('symbolFilter');
                symbolFilter.innerHTML = '<option value="all">All Top 50 Pairs</option>';
                
                this.symbols.forEach(symbol => {
                    const option = document.createElement('option');
                    option.value = symbol;
                    option.textContent = symbol.replace('USDT', '/USDT');
                    symbolFilter.appendChild(option);
                });
                
                console.log(`Loaded ${this.symbols.length} top pairs by volume`);
                console.log('Current pairs:', this.symbols);
            }

            this.lastPairsUpdate = Date.now();
            this.updateCountdowns();

        } catch (error) {
            console.error('Error loading symbols:', error);
            console.error('API Response:', error.response);
        }
    }

    setupFilters() {
        // Add symbols to filter
        const symbolFilter = document.getElementById('symbolFilter');
        this.symbols.forEach(symbol => {
            const option = document.createElement('option');
            option.value = symbol;
            option.textContent = symbol;
            symbolFilter.appendChild(option);
        });

        // Add event listeners
        document.getElementById('strengthFilter').addEventListener('change', () => this.filterSignals());
        document.getElementById('typeFilter').addEventListener('change', () => this.filterSignals());
        document.getElementById('symbolFilter').addEventListener('change', () => this.filterSignals());
    }

    async refreshSignals() {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'loading';
        document.getElementById('signalsList').innerHTML = '';
        document.getElementById('signalsList').appendChild(loadingDiv);

        try {
            // Create analysis queue
            this.analysisQueue = [];
            for (const symbol of this.symbols) {
                for (const timeframe of this.timeframes) {
                    this.analysisQueue.push({ symbol, timeframe });
                }
            }

            const parallelAnalyses = 10; // Increase parallel analyses
            const total = this.analysisQueue.length;
            let processed = 0;

            const updateProgress = () => {
                loadingDiv.textContent = `Analyzing markets... (${processed}/${total})`;
            };
            updateProgress();

            // Process queue with multiple parallel requests
            while (this.analysisQueue.length > 0) {
                const batch = this.analysisQueue.splice(0, parallelAnalyses);
                const promises = batch.map(item => this.analyzeOne(item.symbol, item.timeframe));
                
                // Process results as they come in
                for (const promise of promises) {
                    promise.then(signals => {
                        processed++;
                        updateProgress();
                        
                        if (signals && signals.length > 0) {
                            signals.forEach(signal => {
                                const key = `${signal.symbol}-${signal.timeframe}-${signal.type}`;
                                const existingSignal = this.signals.find(s => 
                                    s.symbol === signal.symbol && 
                                    s.timeframe === signal.timeframe && 
                                    s.type === signal.type
                                );

                                if (!existingSignal || 
                                    signal.strength > existingSignal.strength || 
                                    (Date.now() - existingSignal.time > 1 * 60 * 1000)) {
                                    
                                    // Remove old signal if exists
                                    this.signals = this.signals.filter(s => 
                                        !(s.symbol === signal.symbol && 
                                          s.timeframe === signal.timeframe && 
                                          s.type === signal.type)
                                    );

                                    // Add new signal
                                    this.signals.push(signal);

                                    // Auto-test if strong enough
                                    if (signal.strength >= this.autoTestThreshold) {
                                        this.testSignal(signal, true);
                                    }

                                    // Update display immediately
                                    this.filterSignals();
                                }
                            });
                        }
                    }).catch(error => {
                        console.error(`Error analyzing ${item.symbol} ${item.timeframe}:`, error);
                        processed++;
                        updateProgress();
                    });
                }
                
                // Wait for all promises in batch to complete
                await Promise.allSettled(promises);
            }

            loadingDiv.remove();
            this.lastSignalsUpdate = Date.now();
            this.updateCountdowns();
        } catch (error) {
            console.error('Error refreshing signals:', error);
            loadingDiv.textContent = 'Error refreshing signals';
        }
    }

    async analyzeOne(symbol, timeframe) {
        try {
            const response = await fetch(`api.php?action=analyzeMarkets&symbol=${symbol}&timeframe=${timeframe}`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const signals = await response.json();
            return signals;
        } catch (error) {
            console.error(`Error analyzing ${symbol} ${timeframe}:`, error);
            return [];
        }
    }

    filterSignals() {
        const strengthFilter = document.getElementById('strengthFilter').value;
        const typeFilter = document.getElementById('typeFilter').value;
        const symbolFilter = document.getElementById('symbolFilter').value;

        let filteredSignals = this.signals.filter(signal => {
            const strengthMatch = strengthFilter === 'all' ||
                (strengthFilter === 'strong' && signal.strength > 70) ||
                (strengthFilter === 'medium' && signal.strength >= 40 && signal.strength <= 70) ||
                (strengthFilter === 'weak' && signal.strength < 40);

            const typeMatch = typeFilter === 'all' || signal.type === typeFilter;
            const symbolMatch = symbolFilter === 'all' || signal.symbol === symbolFilter;

            return strengthMatch && typeMatch && symbolMatch;
        });

        // Sort by strength (highest first)
        filteredSignals.sort((a, b) => b.strength - a.strength);

        this.displaySignals(filteredSignals);
    }

    displaySignals(signals) {
        const container = document.getElementById('signalsList');
        container.innerHTML = '';

        if (signals.length === 0) {
            container.innerHTML = '<div class="no-signals">No signals found matching the criteria</div>';
            return;
        }

        signals.forEach(signal => {
            const signalElement = this.displaySignal(signal);
            container.appendChild(signalElement);
        });
    }

    displaySignal(signal) {
        const signalElement = document.createElement('div');
        signalElement.className = `signal-item signal-${signal.type.toLowerCase()}`;
        
        const strengthClass = signal.strength >= 80 ? 'strong' : 
                             signal.strength >= 60 ? 'medium' : 'weak';
        
        signalElement.innerHTML = `
            <div class="signal-header">
                <h3>${signal.symbol} - ${signal.timeframe}</h3>
                <span class="signal-strength ${strengthClass}">${signal.strength.toFixed(1)}%</span>
            </div>
            <p class="signal-type">${signal.type}</p>
            <div class="signal-details">
                <p>Entry: ${signal.price.toFixed(8)} USDT</p>
                <p>Take Profit: ${signal.tp.toFixed(8)} USDT</p>
                <p>Stop Loss: ${signal.sl.toFixed(8)} USDT</p>
            </div>
            <div class="signal-indicators">
                <p data-label="Strategy">${signal.strategy || 'Technical Analysis'}</p>
                <p data-label="EMA Trend">${signal.indicators.ema_trend || 'N/A'}</p>
                <p data-label="RSI">${signal.indicators.rsi || 'N/A'}</p>
                <p data-label="MACD">${signal.indicators.macd || 'N/A'}</p>
                <p data-label="BB Position">${signal.indicators.bb_position || 'N/A'}</p>
                <p data-label="Volume">${signal.indicators.volume || 'N/A'}</p>
                <p data-label="Risk/Reward">${signal.indicators.risk_reward || 'N/A'}</p>
                <p data-label="Trend">${signal.indicators.trend || 'N/A'}</p>
            </div>
            <div class="signal-actions">
                ${signal.strength >= this.autoTestThreshold ? 
                    (signal.testId ? 
                        `<div class="auto-test-buttons">
                            <span class="auto-test-badge">Auto-Tested</span>
                            <a href="test.html?id=${signal.testId}" class="view-chart-btn">
                                <i class="fas fa-chart-line"></i> View Chart
                            </a>
                        </div>` :
                        '<span class="auto-test-badge testing">Auto-Testing Signal...</span>'
                    ) : 
                    `<button onclick="signalsManager.testSignal(${JSON.stringify(signal)})">Test Signal</button>`
                }
            </div>
        `;
        
        return signalElement;
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
            rsi.push(null);
        }

        let avgGain = gains.reduce((a, b) => a + b, 0) / period;
        let avgLoss = losses.reduce((a, b) => a + b, 0) / period;

        // Calculate RSI using smoothed moving average
        for (let i = period; i < changes.length; i++) {
            const change = changes[i];
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? -change : 0;

            avgGain = ((avgGain * (period - 1)) + gain) / period;
            avgLoss = ((avgLoss * (period - 1)) + loss) / period;

            if (avgLoss === 0) {
                rsi.push(100);
            } else {
                const rs = avgGain / avgLoss;
                rsi.push(100 - (100 / (1 + rs)));
            }
        }

        return rsi;
    }

    calculateTrendStrength(prices) {
        // Simple trend strength calculation
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i-1]) / prices[i-1]);
        }
        return Math.abs(returns.reduce((a, b) => a + b, 0) / returns.length);
    }

    calculateVolatility(data) {
        // Calculate average true range as volatility measure
        const tr = [];
        for (let i = 1; i < data.length; i++) {
            const high = parseFloat(data[i].high);
            const low = parseFloat(data[i].low);
            const prevClose = parseFloat(data[i-1].close);
            tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
        }
        return tr.reduce((a, b) => a + b, 0) / tr.length;
    }

    calculateSignalStrength({ rsi, maConvergence, trendStrength, volatility, type }) {
        let strength = 0;

        if (type === 'long') {
            // RSI component (0-40)
            // More weight when RSI is in oversold territory (below 30)
            if (rsi < 30) {
                strength += 40;
            } else if (rsi < 40) {
                strength += (40 - rsi) * 2; // Gradual decrease
            }
            
            // MA convergence component (0-30)
            // Increase sensitivity to MA crossovers
            strength += Math.min(maConvergence * 15, 30);
            
            // Trend strength component (0-20)
            strength += Math.min(trendStrength * 100, 20);
            
            // Volatility component (0-10)
            // Lower volatility is better for reliable signals
            strength += (1 - Math.min(volatility, 0.5) / 0.5) * 10;
        } else { // Short signals
            // RSI component (0-40)
            // More weight when RSI is in overbought territory (above 70)
            if (rsi > 70) {
                strength += 40;
            } else if (rsi > 60) {
                strength += (rsi - 60) * 2; // Gradual decrease
            }
            
            // MA convergence component (0-30)
            strength += Math.min(maConvergence * 15, 30);
            
            // Trend strength component (0-20)
            strength += Math.min(trendStrength * 100, 20);
            
            // Volatility component (0-10)
            strength += (1 - Math.min(volatility, 0.5) / 0.5) * 10;
        }

        // Add bonus for strong trend confirmation
        if ((type === 'long' && trendStrength > 0.02) || 
            (type === 'short' && trendStrength < -0.02)) {
            strength += 10;
        }

        return Math.min(100, Math.max(0, strength));
    }

    startAutoRefresh() {
        setInterval(async () => {
            console.log('Auto-refreshing signals...');
            await this.refreshSignals();
        }, this.refreshInterval);
    }

    async testSignal(signal, isAutoTest = false) {
        try {
            // First, get all existing tests
            const response = await fetch('api.php?action=getTests');
            const existingTests = await response.json();

            // Enhanced duplicate check
            const isDuplicate = existingTests.some(test => {
                // Check for same symbol and type
                const isSamePair = test.symbol === signal.symbol && test.type === signal.type;
                
                // Check if test is still active
                const isActive = test.status === 'active';
                
                // Check if it's a recent test (within last 4 hours)
                const fourHoursAgo = Date.now() - (4 * 60 * 60 * 1000);
                const isRecent = test.start_time * 1000 > fourHoursAgo;
                
                // Check if price is close to existing entry (within 1%)
                const priceClose = Math.abs(test.entry_price - signal.price) / signal.price < 0.01;
                
                return isSamePair && (isActive || (isRecent && priceClose));
            });

            if (isDuplicate) {
                console.log(`Skipping duplicate test for ${signal.symbol} ${signal.type} (${signal.strength}% strength)`);
                return;
            }

            const testSignal = {
                type: signal.type,
                symbol: signal.symbol,
                timeframe: signal.timeframe,
                entry_price: signal.price,
                current_price: signal.price,
                tp: signal.tp,
                sl: signal.sl,
                time: signal.time,
                strength: signal.strength,
                indicators: signal.indicators,
                auto_tested: isAutoTest
            };

            const saveResponse = await fetch('api.php?action=saveTest', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(testSignal)
            });

            const result = await saveResponse.json();
            if (result.id) {
                if (!isAutoTest) {
                    window.location.href = 'tests.html';
                } else {
                    console.log(`Auto-tested signal for ${signal.symbol} (${signal.strength}% strength)`);
                    // Store the test ID in the signal
                    signal.testId = result.id;
                    // Update the display to show the link
                    this.filterSignals();
                }
            } else {
                throw new Error('Failed to create test');
            }
        } catch (error) {
            console.error('Error saving test:', error);
            if (!isAutoTest) {
                alert('Error saving test: ' + error.message);
            }
        }
    }

    startTimers() {
        // Update countdown every second
        setInterval(() => {
            this.updateCountdowns();
        }, 1000);
    }

    updateCountdowns() {
        const now = Date.now();
        
        // Update pairs countdown
        const pairsTimeLeft = Math.max(0, this.symbolsRefreshInterval - (now - this.lastPairsUpdate));
        const pairsMinutes = Math.floor(pairsTimeLeft / 60000);
        const pairsSeconds = Math.floor((pairsTimeLeft % 60000) / 1000);
        document.querySelector('.pairs-countdown').textContent = 
            `${pairsMinutes}:${pairsSeconds.toString().padStart(2, '0')}`;

        // Update signals countdown
        const signalsTimeLeft = Math.max(0, this.refreshInterval - (now - this.lastSignalsUpdate));
        const signalsMinutes = Math.floor(signalsTimeLeft / 60000);
        const signalsSeconds = Math.floor((signalsTimeLeft % 60000) / 1000);
        document.querySelector('.signals-countdown').textContent = 
            `${signalsMinutes}:${signalsSeconds.toString().padStart(2, '0')}`;
    }
}

// Initialize and make it globally accessible
window.signalsManager = new SignalsManager(); 