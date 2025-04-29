class TestsList {
    constructor() {
        this.tests = [];
        this.priceUpdates = {};
        // Initialize first, then add event listeners
        this.init();
        this.setupExportButton();
    }

    setupExportButton() {
        console.log('Setting up export button');
        const exportButton = document.getElementById('exportButton');
        if (exportButton) {
            exportButton.addEventListener('click', () => {
                console.log('Export button clicked');
                this.exportToExcel();
            });
            console.log('Export button listener added');
        } else {
            console.error('Export button not found');
        }
    }

    async init() {
        try {
            await this.loadTests();
            this.setupFilters();
            this.displayTests();
            this.startPriceUpdates();
            console.log('Tests loaded:', this.tests);
        } catch (error) {
            console.error('Error initializing:', error);
        }
    }

    async loadTests() {
        // Load from local storage
        const localTests = localStorage.getItem('tradingTests');
        if (localTests) {
            this.tests = JSON.parse(localTests);
        }

        // Load from server and merge with local storage
        try {
            const response = await fetch('api.php?action=getTests');
            const serverTests = await response.json();
            
            // Merge server tests with local tests
            serverTests.forEach(serverTest => {
                const existingTest = this.tests.find(t => t.id === serverTest.id);
                if (existingTest) {
                    Object.assign(existingTest, serverTest);
                } else {
                    this.tests.push(serverTest);
                }
            });

            this.saveToLocalStorage();
        } catch (error) {
            console.error('Error loading tests:', error);
        }
    }

    setupFilters() {
        const statusFilter = document.getElementById('statusFilter');
        const symbolFilter = document.getElementById('symbolFilter');

        // Get unique symbols
        const symbols = [...new Set(this.tests.map(test => test.symbol))];
        symbols.forEach(symbol => {
            const option = document.createElement('option');
            option.value = symbol;
            option.textContent = symbol;
            symbolFilter.appendChild(option);
        });

        // Add event listeners
        statusFilter.addEventListener('change', () => this.filterTests());
        symbolFilter.addEventListener('change', () => this.filterTests());
    }

    filterTests() {
        const status = document.getElementById('statusFilter').value;
        const symbol = document.getElementById('symbolFilter').value;

        const filteredTests = this.tests.filter(test => {
            const statusMatch = status === 'all' || test.status === status;
            const symbolMatch = symbol === 'all' || test.symbol === symbol;
            return statusMatch && symbolMatch;
        });

        this.displayTests(filteredTests);
    }

    async fetchCurrentPrices() {
        const uniqueSymbols = [...new Set(this.tests.map(test => test.symbol))];
        
        for (const symbol of uniqueSymbols) {
            try {
                const response = await fetch(`api.php?action=getData&symbol=${symbol}&timeframe=1m&limit=1`);
                const data = await response.json();
                if (data && data.length > 0) {
                    this.priceUpdates[symbol] = {
                        price: parseFloat(data[data.length - 1].close),
                        time: parseInt(data[data.length - 1].time)
                    };
                }
            } catch (error) {
                console.error(`Error fetching price for ${symbol}:`, error);
            }
        }
    }

    startPriceUpdates() {
        // Initial price fetch
        this.fetchCurrentPrices().then(() => this.updateTestsWithCurrentPrices());

        // Update prices every 3 seconds
        setInterval(async () => {
            await this.fetchCurrentPrices();
            this.updateTestsWithCurrentPrices();
        }, 3000);
    }

    updateTestsWithCurrentPrices() {
        const now = Date.now();
        
        this.tests.forEach(test => {
            // Only update current price for active tests
            if (test.status === 'active' && this.priceUpdates[test.symbol]) {
                test.current_price = this.priceUpdates[test.symbol].price;
                
                const currentPrice = parseFloat(test.current_price);
                const tp = parseFloat(test.tp);
                const sl = parseFloat(test.sl);

                if (test.type === 'long') {
                    if (currentPrice >= tp) {
                        test.status = 'completed';
                        test.final_price = tp;
                        test.end_time = Math.floor(now / 1000);
                    } else if (currentPrice <= sl) {
                        test.status = 'stopped';
                        test.final_price = sl;
                        test.end_time = Math.floor(now / 1000);
                    }
                } else {
                    if (currentPrice <= tp) {
                        test.status = 'completed';
                        test.final_price = tp;
                        test.end_time = Math.floor(now / 1000);
                    } else if (currentPrice >= sl) {
                        test.status = 'stopped';
                        test.final_price = sl;
                        test.end_time = Math.floor(now / 1000);
                    }
                }

                // If test just completed/stopped, update it on the server
                if (test.status !== 'active') {
                    this.updateTestOnServer(test);
                }
            }
        });

        // Save updated tests to local storage
        this.saveToLocalStorage();
        
        // Refresh the display
        this.displayTests();
    }

    // Add new method to update test on server
    async updateTestOnServer(test) {
        try {
            await fetch('api.php?action=updateTest', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(test)
            });
        } catch (error) {
            console.error('Error updating test on server:', error);
        }
    }

    calculateProfitLoss(test) {
        if (!test.current_price) return 0;
        
        const entryPrice = parseFloat(test.entry_price);
        // Use final_price instead of current_price for completed/stopped tests
        const currentPrice = (test.status !== 'active' && test.final_price) ? 
            parseFloat(test.final_price) : 
            parseFloat(test.current_price);
        
        if (test.type === 'long') {
            return ((currentPrice - entryPrice) / entryPrice) * 100;
        } else {
            return ((entryPrice - currentPrice) / entryPrice) * 100;
        }
    }

    calculateDollarPnL(test) {
        if (!test.current_price) return 0;
        
        const positionSize = test.position_size || 10;
        
        // Use final_price instead of current_price for completed/stopped tests
        const currentPrice = (test.status !== 'active' && test.final_price) ? 
            parseFloat(test.final_price) : 
            parseFloat(test.current_price);
        
        const quantity = positionSize / parseFloat(test.entry_price);
        const entryValue = quantity * parseFloat(test.entry_price);
        const currentValue = quantity * currentPrice;
        
        return test.type === 'long' ? 
            currentValue - entryValue : 
            entryValue - currentValue;
    }

    getStatistics() {
        const stats = {
            total: this.tests.length,
            active: 0,
            completed: 0,
            stopped: 0,
            winCount: 0,
            lossCount: 0,
            totalPnL: 0
        };

        this.tests.forEach(test => {
            // Count by status
            stats[test.status]++;

            // Calculate win/loss for completed trades
            if (test.status !== 'active') {
                const pnl = this.calculateDollarPnL(test);
                stats.totalPnL += pnl;
                if (pnl > 0) {
                    stats.winCount++;
                } else if (pnl < 0) {
                    stats.lossCount++;
                }
            }
        });

        return stats;
    }

    displayTests(testsToShow = this.tests) {
        const container = document.getElementById('testsList');
        container.innerHTML = '';

        // Add statistics section
        const stats = this.getStatistics();
        
        // Update stats calculation to handle old tests
        const updatedStats = {
            ...stats,
            totalPnL: this.tests.reduce((total, test) => {
                // Ensure we're using position_size or default 10
                const pnl = this.calculateDollarPnL(test);
                return total + pnl;
            }, 0)
        };

        const statsHtml = `
            <div class="tests-stats">
                <div class="stat-item">
                    <span class="stat-label">Total Trades:</span>
                    <span class="stat-value">${updatedStats.total}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Active:</span>
                    <span class="stat-value status-active">${updatedStats.active}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Completed:</span>
                    <span class="stat-value status-completed">${updatedStats.completed}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Stopped:</span>
                    <span class="stat-value status-stopped">${updatedStats.stopped}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Win/Loss:</span>
                    <span class="stat-value">${updatedStats.winCount}/${updatedStats.lossCount}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Total P/L:</span>
                    <span class="stat-value ${updatedStats.totalPnL >= 0 ? 'profit' : 'loss'}">$${updatedStats.totalPnL.toFixed(2)}</span>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', statsHtml);

        const sortedTests = testsToShow.sort((a, b) => b.start_time - a.start_time);

        sortedTests.forEach(test => {
            const profitLoss = this.calculateProfitLoss(test);
            const dollarPnL = this.calculateDollarPnL(test);
            const testElement = document.createElement('div');
            testElement.className = `test-item ${test.type}-test`;
            
            const currentPrice = test.current_price ? 
                parseFloat(test.current_price).toFixed(8) : 
                'Loading...';

            // Format the date correctly
            const startTime = new Date(test.start_time * 1000);
            const formattedDate = startTime.toLocaleString('en-GB', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });

            // Update the delete button HTML
            const deleteButton = `
                <button onclick="testsList.deleteTest('${test.id}')" class="delete-btn">
                    <i class="fas fa-trash"></i>
                    
                </button>
            `;

            testElement.innerHTML = `
                <div class="test-summary">
                    <h3>${test.symbol} - ${test.type.toUpperCase()}</h3>
                    <p class="test-status status-${test.status}">${test.status.toUpperCase()}</p>
                </div>
                <div class="test-details">
                    <p>Entry: ${parseFloat(test.entry_price).toFixed(8)} USDT</p>
                    <p>Current: ${currentPrice} USDT</p>
                    <p>P/L: <span class="${profitLoss >= 0 ? 'profit' : 'loss'}">$${dollarPnL.toFixed(2)} (${profitLoss.toFixed(2)}%)</span></p>
                    <p>Time: ${formattedDate}</p>
                </div>
                <div class="test-actions">
                    <button onclick="window.location.href='test.html?id=${test.id}'">View Details</button>
                    ${deleteButton}
                </div>
            `;
            container.appendChild(testElement);
        });
    }

    async deleteTest(testId) {
        if (!confirm('Are you sure you want to delete this test?')) return;

        this.tests = this.tests.filter(test => test.id !== testId);
        this.saveToLocalStorage();
        this.filterTests();

        try {
            await fetch('api.php?action=deleteTest', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ id: testId })
            });
        } catch (error) {
            console.error('Error deleting test:', error);
        }
    }

    saveToLocalStorage() {
        localStorage.setItem('tradingTests', JSON.stringify(this.tests));
    }

    exportToExcel() {
        try {
            console.log('Starting export with tests:', this.tests);
            if (!this.tests || this.tests.length === 0) {
                alert('No data to export');
                return;
            }

            // Prepare data for export
            const exportData = this.tests.map(test => {
                const profitLoss = this.calculateProfitLoss(test);
                const dollarPnL = this.calculateDollarPnL(test);
                
                return {
                    'Date': new Date(test.start_time * 1000).toLocaleString(),
                    'Symbol': test.symbol,
                    'Type': test.type.toUpperCase(),
                    'Status': test.status.toUpperCase(),
                    'Entry Price': parseFloat(test.entry_price).toFixed(8),
                    'Current/Final Price': test.final_price ? 
                        parseFloat(test.final_price).toFixed(8) : 
                        parseFloat(test.current_price).toFixed(8),
                    'Take Profit': parseFloat(test.tp).toFixed(8),
                    'Stop Loss': parseFloat(test.sl).toFixed(8),
                    'P&L %': profitLoss.toFixed(2) + '%',
                    'P&L $': '$' + dollarPnL.toFixed(2),
                    'Position Size': '$' + (test.position_size || 10).toFixed(2),
                    'Timeframe': test.timeframe,
                    'Duration': this.calculateDuration(test)
                };
            });

            console.log('Prepared export data:', exportData);

            // Create worksheet
            const ws = XLSX.utils.json_to_sheet(exportData);

            // Add summary data
            const stats = this.getStatistics();
            const summaryData = [
                ['Summary'],
                ['Total Trades', stats.total],
                ['Active Trades', stats.active],
                ['Completed Trades', stats.completed],
                ['Stopped Trades', stats.stopped],
                ['Win/Loss Ratio', `${stats.winCount}/${stats.lossCount}`],
                ['Total P&L', '$' + stats.totalPnL.toFixed(2)],
                ['Win Rate', ((stats.winCount / (stats.winCount + stats.lossCount)) * 100).toFixed(2) + '%']
            ];

            // Create a new worksheet for summary
            const summaryWS = XLSX.utils.aoa_to_sheet(summaryData);

            // Create workbook and add worksheets
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Trading Tests');
            XLSX.utils.book_append_sheet(wb, summaryWS, 'Summary');

            // Generate Excel file
            const fileName = `trading_tests_${new Date().toISOString().split('T')[0]}.xlsx`;
            XLSX.writeFile(wb, fileName);
            console.log('Export completed successfully');
        } catch (error) {
            console.error('Export failed:', error);
            alert('Export failed: ' + error.message);
        }
    }

    calculateDuration(test) {
        const startTime = test.start_time * 1000;
        const endTime = test.end_time ? test.end_time * 1000 : Date.now();
        const duration = endTime - startTime;
        
        const hours = Math.floor(duration / (1000 * 60 * 60));
        const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
        
        return `${hours}h ${minutes}m`;
    }
}

// Create instance and make it globally accessible
const testsList = new TestsList();
window.testsList = testsList; 