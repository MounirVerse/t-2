<?php
// Allow cross-origin requests
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json');

// Error reporting for debugging
error_reporting(E_ALL);
ini_set('display_errors', 1);

// Define the path to tests.json
$testFile = __DIR__ . '/tests.json';

// Initialize tests.json if it doesn't exist or is corrupted
if (!file_exists($testFile) || !is_readable($testFile) || !is_writable($testFile)) {
    try {
        // Create new file with empty array
        if (file_put_contents($testFile, '[]') === false) {
            logError("Failed to create tests.json");
            throw new Exception("Failed to create tests file");
        }
        
        // Set proper permissions
        if (!chmod($testFile, 0666)) {
            logError("Failed to set permissions on tests.json");
            throw new Exception("Failed to set file permissions");
        }
    } catch (Exception $e) {
        logError("Error during file initialization: " . $e->getMessage());
        throw $e;
    }
}

// Verify JSON integrity
$content = file_get_contents($testFile);
if ($content !== false) {
    $tests = json_decode($content, true);
    if ($tests === null && json_last_error() !== JSON_ERROR_NONE) {
        // Reset file if JSON is invalid
        file_put_contents($testFile, '[]');
        logError("Reset tests.json due to invalid JSON");
    }
}

// Log function
function logError($message) {
    error_log(date('Y-m-d H:i:s') . " - " . $message . "\n", 3, __DIR__ . '/error.log');
}

function fetchBinanceData($symbol, $timeframe, $limit = 100) {
    $interval = [
        '1m' => '1m',
        '5m' => '5m',
        '15m' => '15m',
        '1h' => '1h',
        '4h' => '4h',
        '1d' => '1d'
    ][$timeframe] ?? '1m';

    $limit = isset($_GET['limit']) ? intval($_GET['limit']) : $limit;
    $url = "https://api.binance.com/api/v3/klines?symbol={$symbol}&interval={$interval}&limit={$limit}";

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_HTTPHEADER, array('User-Agent: Mozilla/5.0'));
    
    $response = curl_exec($ch);
    
    if (curl_errno($ch)) {
        throw new Exception('Curl error: ' . curl_error($ch));
    }

    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    if ($httpCode !== 200) {
        throw new Exception('Binance API error: HTTP code ' . $httpCode);
    }
    
    curl_close($ch);

    $data = json_decode($response, true);
    if (!$data || !is_array($data)) {
        throw new Exception('Failed to decode Binance response');
    }
    
    return array_map(function($candle) {
        return [
            'time' => (int)$candle[0],
            'open' => floatval($candle[1]),
            'high' => floatval($candle[2]),
            'low' => floatval($candle[3]),
            'close' => floatval($candle[4]),
            'volume' => floatval($candle[5])
        ];
    }, $data);
}

function getTests() {
    global $testFile;
    try {
        // Check if file exists
        if (!file_exists($testFile)) {
            // Create new file with empty array
            if (file_put_contents($testFile, '[]') === false) {
                logError("Failed to create tests.json");
                return [];
            }
        }
        
        // Read file contents
        $content = file_get_contents($testFile);
        if ($content === false) {
            logError("Failed to read tests.json");
            return [];
        }
        
        // Check if content is empty
        if (empty($content)) {
            return [];
        }
        
        // Decode JSON
        $tests = json_decode($content, true);
        if ($tests === null && json_last_error() !== JSON_ERROR_NONE) {
            logError("JSON decode error: " . json_last_error_msg());
            // Reset file with empty array
            file_put_contents($testFile, '[]');
            return [];
        }
        
        return $tests ?? [];
    } catch (Exception $e) {
        logError("Error in getTests(): " . $e->getMessage());
        return [];
    }
}

function saveTest($data) {
    global $testFile;
    $tests = getTests();
    
    $data['id'] = uniqid();
    $data['status'] = 'active';
    $data['start_time'] = time();
    $data['position_size'] = 10;
    $data['current_price'] = $data['entry_price'];
    
    $tests[] = $data;
    
    if (file_put_contents($testFile, json_encode($tests)) === false) {
        throw new Exception('Failed to write to tests file');
    }
    
    return $data['id'];
}

function calculateSMA($prices, $period) {
    $sma = [];
    $count = count($prices);
    
    for ($i = 0; $i < $count; $i++) {
        if ($i < $period - 1) {
            $sma[] = null;
            continue;
        }
        $sum = 0;
        for ($j = 0; $j < $period; $j++) {
            $sum += $prices[$i - $j];
        }
        $sma[] = $sum / $period;
    }
    return $sma;
}

function calculateRSI($prices, $period) {
    $changes = [];
    for ($i = 1; $i < count($prices); $i++) {
        $changes[] = $prices[$i] - $prices[$i - 1];
    }
    
    $gains = [];
    $losses = [];
    $rsi = [];
    
    // Calculate initial gains and losses
    for ($i = 0; $i < $period; $i++) {
        $change = $changes[$i];
        $gains[] = $change > 0 ? $change : 0;
        $losses[] = $change < 0 ? -$change : 0;
        $rsi[] = null;
    }
    
    $avgGain = array_sum($gains) / $period;
    $avgLoss = array_sum($losses) / $period;
    
    // Calculate RSI
    for ($i = $period; $i < count($changes); $i++) {
        $change = $changes[$i];
        $gain = $change > 0 ? $change : 0;
        $loss = $change < 0 ? -$change : 0;
        
        $avgGain = (($avgGain * ($period - 1)) + $gain) / $period;
        $avgLoss = (($avgLoss * ($period - 1)) + $loss) / $period;
        
        if ($avgLoss == 0) {
            $rsi[] = 100;
        } else {
            $rs = $avgGain / $avgLoss;
            $rsi[] = 100 - (100 / (1 + $rs));
        }
    }
    
    return $rsi;
}

function calculateTrendStrength($prices) {
    $returns = [];
    for ($i = 1; $i < count($prices); $i++) {
        $returns[] = ($prices[$i] - $prices[$i-1]) / $prices[$i-1];
    }
    return abs(array_sum($returns) / count($returns));
}

function calculateVolatility($data) {
    $tr = [];
    for ($i = 1; $i < count($data); $i++) {
        $high = floatval($data[$i]['high']);
        $low = floatval($data[$i]['low']);
        $prevClose = floatval($data[$i-1]['close']);
        $tr[] = max($high - $low, abs($high - $prevClose), abs($low - $prevClose));
    }
    return array_sum($tr) / count($tr);
}

function calculateSignalStrength($params) {
    $strength = 0;
    
    // RSI component (0-30)
    if ($params['type'] === 'long') {
        if ($params['rsi'] < 30) $strength += 30;
        else if ($params['rsi'] < 40) $strength += 20;
    } else {
        if ($params['rsi'] > 70) $strength += 30;
        else if ($params['rsi'] > 60) $strength += 20;
    }
    
    // Trend component (0-20)
    if ($params['trend']) $strength += 20;
    
    // MACD component (0-15)
    if ($params['macd']) $strength += 15;
    
    // BB Position (0-15)
    if ($params['bb_position']) $strength += 15;
    
    // Volume component (0-10)
    if ($params['volume_increase'] > 2) $strength += 10;
    else if ($params['volume_increase'] > 1.5) $strength += 5;
    
    // Risk/Reward (0-10)
    if ($params['risk_reward'] >= 2.5) $strength += 10;
    else if ($params['risk_reward'] >= 2) $strength += 5;
    
    return min(100, $strength);
}

function isDuplicateTest($data, $tests) {
    $fiveMinutesAgo = time() - (5 * 60);
    foreach ($tests as $test) {
        if ($test['symbol'] === $data['symbol'] &&
            $test['timeframe'] === $data['timeframe'] &&
            $test['type'] === $data['type'] &&
            $test['start_time'] > $fiveMinutesAgo) {
            return true;
        }
    }
    return false;
}

// Add these new helper functions for dynamic TP/SL calculation
function calculateDynamicTPSL($data, $type, $currentPrice, $atr, $useTrailingStop = false) {
    // Get recent volatility and trend data
    $volatility = calculateVolatility($data);
    $trendStrength = calculateTrendStrength(array_map(fn($c) => $c['close'], $data));
    
    // Base multipliers that will be adjusted based on market conditions
    $tpMultiplier = 2.0;
    $slMultiplier = 1.0;
    
    // Adjust multipliers based on trend strength
    if ($trendStrength > 0.02) { // Strong trend
        $tpMultiplier *= 1.5;
        $slMultiplier *= 0.8;
    } else if ($trendStrength < 0.005) { // Weak trend
        $tpMultiplier *= 0.8;
        $slMultiplier *= 1.2;
    }
    
    // Adjust for volatility
    if ($volatility > $atr * 2) { // High volatility
        $tpMultiplier *= 1.3;
        $slMultiplier *= 0.7;
    } else if ($volatility < $atr * 0.5) { // Low volatility
        $tpMultiplier *= 0.7;
        $slMultiplier *= 1.3;
    }
    
    // Calculate dynamic TP and SL distances
    $tpDistance = $atr * $tpMultiplier;
    $slDistance = $atr * $slMultiplier;
    
    // Ensure minimum risk-reward ratio of 1.5
    while (($tpDistance / $slDistance) < 1.5) {
        $tpDistance *= 1.1;
    }
    
    // Calculate actual TP and SL prices
    if ($type === 'long') {
        $tp = $currentPrice * (1 + $tpDistance / $currentPrice);
        $sl = $currentPrice * (1 - $slDistance / $currentPrice);
    } else {
        $tp = $currentPrice * (1 - $tpDistance / $currentPrice);
        $sl = $currentPrice * (1 + $slDistance / $currentPrice);
    }
    
    if ($useTrailingStop) {
        // Implement trailing stop logic
        $trailingStopDistance = $atr * 1.5;
        // Adjust SL dynamically as the price moves in favor
    }
    
    return ['tp' => $tp, 'sl' => $sl];
}

// Modify the analyzeMarket function to improve signal generation
function analyzeMarket($data, $symbol, $timeframe) {
    if (!$data || count($data) < 30) return [];
    
    $signals = [];
    $prices = array_map(function($candle) {
        return floatval($candle['close']);
    }, $data);
    
    // Calculate technical indicators
    $ema9 = calculateEMA($prices, 9);
    $ema20 = calculateEMA($prices, 20);
    $rsi = calculateRSI($prices, 14);
    $stochastic = calculateStochastic($prices);
    $adx = calculateADX($data, 14);
    $atr = calculateATR($data, 14);
    $volume_increase = calculateVolumeIncrease($data, 10);
    $bbands = calculateBollingerBands($prices, 20, 2);
    $macd = calculateMACD($prices);
    
    // Get current values
    $lastCandle = end($data);
    $lastPrice = floatval($lastCandle['close']);
    $last_ema9 = end($ema9);
    $last_ema20 = end($ema20);
    $lastRSI = end($rsi);
    $lastStochastic = end($stochastic);
    $lastBB = end($bbands);
    $lastMACD = end($macd['macdLine']);
    
    // Analyze additional indicators
    $fvg = findFVG($data);
    $trendLines = calculateTrendLines($data);
    $fibonacciLevels = calculateFibonacciLevels(max($prices), min($prices));
    $liquidityHeatmap = analyzeLiquidityHeatmap($symbol);
    
    // Use these indicators to refine entry and exit conditions
    // Example: Check if price is near a Fibonacci level or FVG
    if (
        ($lastPrice <= $fibonacciLevels['61.8'] || $lastPrice >= $fibonacciLevels['38.2']) &&
        ($lastPrice >= $fvg[0]['start'] && $lastPrice <= $fvg[0]['end']) &&
        $volume_increase > 1.1 &&
        $adx > 15 &&
        $last_ema9 > $last_ema20 * 0.99
    ) {
        // Calculate dynamic TP and SL with trailing stop
        $levels = calculateDynamicTPSL($data, 'long', $lastPrice, $atr, true);
        
        // Risk-reward check
        $risk = $lastPrice - $levels['sl'];
        $reward = $levels['tp'] - $lastPrice;
        $rr_ratio = $reward / $risk;
        
        if ($rr_ratio >= 1.5) {
            $signals[] = [
                'type' => 'long',
                'symbol' => $symbol,
                'timeframe' => $timeframe,
                'price' => $lastPrice,
                'tp' => $levels['tp'],
                'sl' => $levels['sl'],
                'time' => $lastCandle['time'],
                'strength' => calculateSignalStrength([
                    'type' => 'long',
                    'rsi' => $lastRSI,
                    'trend' => true,
                    'macd' => $lastMACD > 0.002,
                    'bb_position' => $lastPrice < $lastBB['middle'],
                    'risk_reward' => $rr_ratio,
                    'volume_increase' => $volume_increase
                ]),
                'strategy' => 'Advanced Scalping Strategy',
                'indicators' => [
                    'ema_trend' => 'Bullish Setup',
                    'rsi' => number_format($lastRSI, 2),
                    'macd' => number_format($lastMACD, 8),
                    'bb_position' => 'Favorable',
                    'volume' => number_format($volume_increase, 2) . 'x',
                    'atr' => number_format($atr, 8)
                ]
            ];
        }
    }
    
    // Implement similar logic for SHORT signals using these indicators
    
    // Filter signals by minimum strength
    return array_filter($signals, function($signal) {
        return $signal['strength'] >= 65;
    });
}

function checkLongSetup($price, $ema9, $ema21, $rsi, $percentB) {
    // More sensitive conditions for long signals
    $emaAligned = $ema9 >= $ema21 * 0.998; // Allow for closer EMA values
    
    // Broader RSI conditions
    $rsiCondition = ($rsi < 45) || // Oversold condition
                    ($rsi > 45 && $rsi < 55 && $emaAligned); // Trend continuation
    
    // Price relative to Bollinger Bands
    $bbCondition = $percentB < 50; // Price in lower half of BB
    
    return $emaAligned && ($rsiCondition || $bbCondition);
}

function checkShortSetup($price, $ema9, $ema21, $rsi, $percentB) {
    // More sensitive conditions for short signals
    $emaAligned = $ema9 <= $ema21 * 1.002; // Allow for closer EMA values
    
    // Broader RSI conditions
    $rsiCondition = ($rsi > 55) || // Overbought condition
                    ($rsi > 45 && $rsi < 55 && $emaAligned); // Trend continuation
    
    // Price relative to Bollinger Bands
    $bbCondition = $percentB > 50; // Price in upper half of BB
    
    return $emaAligned && ($rsiCondition || $bbCondition);
}

// Add these new technical indicator functions
function calculateEMA($prices, $period) {
    $multiplier = 2 / ($period + 1);
    $ema = [];
    
    // First EMA is SMA
    $sma = array_sum(array_slice($prices, 0, $period)) / $period;
    $ema[] = $sma;
    
    for ($i = $period; $i < count($prices); $i++) {
        $ema[] = ($prices[$i] - end($ema)) * $multiplier + end($ema);
    }
    
    return $ema;
}

// Add this function to calculate the MACD
function calculateMACD($prices, $shortPeriod = 12, $longPeriod = 26, $signalPeriod = 9) {
    $emaShort = calculateEMA($prices, $shortPeriod);
    $emaLong = calculateEMA($prices, $longPeriod);
    $macdLine = array_map(function($short, $long) {
        return $short - $long;
    }, $emaShort, $emaLong);

    $signalLine = calculateEMA($macdLine, $signalPeriod);
    $macdHistogram = array_map(function($macd, $signal) {
        return $macd - $signal;
    }, $macdLine, $signalLine);

    return [
        'macdLine' => $macdLine,
        'signalLine' => $signalLine,
        'histogram' => $macdHistogram
    ];
}

function calculateATR($data, $period) {
    if (count($data) < $period + 1) {
        return 0;
    }

    $tr = [];
    for ($i = 1; $i < count($data); $i++) {
        $high = floatval($data[$i]['high']);
        $low = floatval($data[$i]['low']);
        $prevClose = floatval($data[$i-1]['close']);
        
        $tr[] = max(
            $high - $low,
            abs($high - $prevClose),
            abs($low - $prevClose)
        );
    }
    
    // Calculate ATR
    $atr = array_sum(array_slice($tr, -$period)) / $period;
    return $atr;
}

// Add these functions after the existing indicator functions

function calculateVolumeIncrease($data, $period) {
    $volumes = array_map(function($candle) {
        return floatval($candle['volume']);
    }, $data);
    
    // Calculate average volume for the period
    $avgVolume = array_sum(array_slice($volumes, -$period)) / $period;
    
    // Get current volume
    $currentVolume = end($volumes);
    
    // Calculate percentage increase
    return ($currentVolume / $avgVolume) - 1;
}

function analyzePriceAction($data, $period) {
    $closes = array_map(function($candle) {
        return floatval($candle['close']);
    }, array_slice($data, -$period));
    
    $opens = array_map(function($candle) {
        return floatval($candle['open']);
    }, array_slice($data, -$period));
    
    // Calculate average candle size
    $totalMove = 0;
    for ($i = 0; $i < count($closes); $i++) {
        $totalMove += abs($closes[$i] - $opens[$i]);
    }
    $avgMove = $totalMove / count($closes);
    
    // Calculate price direction
    $startPrice = $opens[0];
    $endPrice = end($closes);
    $priceChange = ($endPrice - $startPrice) / $startPrice;
    
    // Return normalized price action score (-1 to 1)
    return $priceChange / $avgMove;
}

function calculateLongStrength($params) {
    $strength = 0;
    
    // EMA alignment (0-30)
    if ($params['ema_alignment']) {
        $strength += 30;
    }
    
    // RSI component (0-25)
    if ($params['rsi'] < 30) {
        $strength += 25;
    } elseif ($params['rsi'] < 40) {
        $strength += 15;
    }
    
    // MACD component (0-20)
    if ($params['macd'] > 0) {
        $strength += 20;
    }
    
    // Volume component (0-15)
    if ($params['volume'] > 1.5) {
        $strength += 15;
    } elseif ($params['volume'] > 1.2) {
        $strength += 10;
    }
    
    // Price action component (0-10)
    if ($params['price_action'] > 0.5) {
        $strength += 10;
    } elseif ($params['price_action'] > 0) {
        $strength += 5;
    }
    
    return $strength;
}

function calculateShortStrength($params) {
    $strength = 0;
    
    // EMA alignment (0-30)
    if ($params['ema_alignment']) {
        $strength += 30;
    }
    
    // RSI component (0-25)
    if ($params['rsi'] > 70) {
        $strength += 25;
    } elseif ($params['rsi'] > 60) {
        $strength += 15;
    }
    
    // MACD component (0-20)
    if ($params['macd'] < 0) {
        $strength += 20;
    }
    
    // Volume component (0-15)
    if ($params['volume'] > 1.5) {
        $strength += 15;
    } elseif ($params['volume'] > 1.2) {
        $strength += 10;
    }
    
    // Price action component (0-10)
    if ($params['price_action'] < -0.5) {
        $strength += 10;
    } elseif ($params['price_action'] < 0) {
        $strength += 5;
    }
    
    return $strength;
}

class PricePredictor {
    private $data;
    
    public function __construct($data) {
        $this->data = $data;
    }
    
    public function predict() {
        // Get recent price action
        $prices = array_slice($this->data, -10);
        $volumes = array_map(function($candle) {
            return $candle['volume'];
        }, $prices);
        
        // Calculate momentum
        $momentum = $this->calculateMomentum($prices);
        
        // Calculate volume trend
        $volumeTrend = $this->calculateVolumeTrend($volumes);
        
        // Calculate price patterns
        $pattern = $this->identifyPattern($prices);
        
        // Combine signals
        $upSignals = 0;
        $downSignals = 0;
        $totalSignals = 3;
        
        // Momentum signal
        if ($momentum > 0) $upSignals++;
        else if ($momentum < 0) $downSignals++;
        
        // Volume trend signal
        if ($volumeTrend > 0) $upSignals++;
        else if ($volumeTrend < 0) $downSignals++;
        
        // Pattern signal
        if ($pattern === 'bullish') $upSignals++;
        else if ($pattern === 'bearish') $downSignals++;
        
        // Calculate direction and confidence
        $direction = $upSignals > $downSignals ? 'up' : 'down';
        $confidence = max($upSignals, $downSignals) / $totalSignals * 100;
        
        return [
            'direction' => $direction,
            'confidence' => $confidence
        ];
    }
    
    private function calculateMomentum($prices) {
        $closes = array_map(function($candle) {
            return $candle['close'];
        }, $prices);
        
        $sma5 = array_sum(array_slice($closes, -5)) / 5;
        $sma10 = array_sum($closes) / 10;
        
        return $sma5 - $sma10;
    }
    
    private function calculateVolumeTrend($volumes) {
        $recentVol = array_sum(array_slice($volumes, -3)) / 3;
        $oldVol = array_sum(array_slice($volumes, 0, 3)) / 3;
        
        return $recentVol - $oldVol;
    }
    
    private function identifyPattern($prices) {
        $closes = array_map(function($candle) {
            return $candle['close'];
        }, $prices);
        
        // Check for bullish pattern
        $bullish = true;
        for ($i = 2; $i < count($closes); $i++) {
            if ($closes[$i] <= $closes[$i-2]) {
                $bullish = false;
                break;
            }
        }
        
        // Check for bearish pattern
        $bearish = true;
        for ($i = 2; $i < count($closes); $i++) {
            if ($closes[$i] >= $closes[$i-2]) {
                $bearish = false;
                break;
            }
        }
        
        if ($bullish) return 'bullish';
        if ($bearish) return 'bearish';
        return 'neutral';
    }
}

function calculateBollingerBands($prices, $period = 20, $deviations = 2) {
    $bands = [];
    for ($i = 0; $i < count($prices); $i++) {
        if ($i < $period - 1) {
            $bands[] = [
                'upper' => null,
                'middle' => null,
                'lower' => null
            ];
            continue;
        }
        
        $slice = array_slice($prices, $i - $period + 1, $period);
        $sma = array_sum($slice) / $period;
        
        // Calculate standard deviation
        $variance = array_reduce($slice, function($carry, $price) use ($sma) {
            return $carry + pow($price - $sma, 2);
        }, 0) / $period;
        $stdDev = sqrt($variance);
        
        $bands[] = [
            'upper' => $sma + ($stdDev * $deviations),
            'middle' => $sma,
            'lower' => $sma - ($stdDev * $deviations)
        ];
    }
    return $bands;
}

function calculateVolumeProfile($data, $period) {
    $volumes = array_map(function($candle) {
        return floatval($candle['volume']);
    }, array_slice($data, -$period));
    
    return [
        'current' => end($volumes),
        'average' => array_sum($volumes) / count($volumes),
        'max' => max($volumes),
        'min' => min($volumes)
    ];
}

function findKeyLevels($data, $period) {
    $prices = array_slice($data, -$period);
    
    // Get highs and lows
    $highs = array_map(function($candle) {
        return floatval($candle['high']);
    }, $prices);
    
    $lows = array_map(function($candle) {
        return floatval($candle['low']);
    }, $prices);
    
    // Find support (lowest low)
    $support = min($lows);
    
    // Find resistance (highest high)
    $resistance = max($highs);
    
    // Calculate current price
    $currentPrice = floatval(end($data)['close']);
    
    // If price is closer to resistance, adjust support up
    // If price is closer to support, adjust resistance down
    if ($currentPrice - $support > $resistance - $currentPrice) {
        // Price closer to resistance, find higher support
        $support = min(array_filter($lows, function($low) use ($currentPrice) {
            return $low < $currentPrice;
        }));
    } else {
        // Price closer to support, find lower resistance
        $resistance = max(array_filter($highs, function($high) use ($currentPrice) {
            return $high > $currentPrice;
        }));
    }
    
    return [
        'support' => $support,
        'resistance' => $resistance
    ];
}

// Add this function to calculate the Stochastic Oscillator
function calculateStochastic($prices, $period = 14) {
    $stochastic = [];
    for ($i = $period - 1; $i < count($prices); $i++) {
        $currentPrice = $prices[$i];
        $lowestLow = min(array_slice($prices, $i - $period + 1, $period));
        $highestHigh = max(array_slice($prices, $i - $period + 1, $period));
        
        if ($highestHigh - $lowestLow == 0) {
            $stochastic[] = 0; // Avoid division by zero
        } else {
            $stochastic[] = (($currentPrice - $lowestLow) / ($highestHigh - $lowestLow)) * 100;
        }
    }
    return $stochastic;
}

// Add this function to calculate the ADX
function calculateADX($data, $period = 14) {
    $adx = [];
    $tr = [];
    $dmPlus = [];
    $dmMinus = [];

    for ($i = 1; $i < count($data); $i++) {
        $currentHigh = $data[$i]['high'];
        $currentLow = $data[$i]['low'];
        $previousClose = $data[$i - 1]['close'];

        $tr[] = max($currentHigh - $currentLow, abs($currentHigh - $previousClose), abs($currentLow - $previousClose));
        $dmPlus[] = $currentHigh - $data[$i - 1]['high'] > $data[$i - 1]['low'] - $currentLow ? max($currentHigh - $data[$i - 1]['high'], 0) : 0;
        $dmMinus[] = $data[$i - 1]['low'] - $currentLow > $currentHigh - $data[$i - 1]['high'] ? max($data[$i - 1]['low'] - $currentLow, 0) : 0;
    }

    $tr14 = array_sum(array_slice($tr, 0, $period));
    $dmPlus14 = array_sum(array_slice($dmPlus, 0, $period));
    $dmMinus14 = array_sum(array_slice($dmMinus, 0, $period));

    for ($i = $period; $i < count($tr); $i++) {
        $tr14 = $tr14 - ($tr14 / $period) + $tr[$i];
        $dmPlus14 = $dmPlus14 - ($dmPlus14 / $period) + $dmPlus[$i];
        $dmMinus14 = $dmMinus14 - ($dmMinus14 / $period) + $dmMinus[$i];

        $diPlus = 100 * ($dmPlus14 / $tr14);
        $diMinus = 100 * ($dmMinus14 / $tr14);
        $dx = abs($diPlus - $diMinus) / ($diPlus + $diMinus) * 100;

        if ($i == $period) {
            $adx[] = $dx;
        } else {
            $adx[] = (($adx[count($adx) - 1] * ($period - 1)) + $dx) / $period;
        }
    }

    return $adx;
}

function findFVG($data) {
    $fvg = [];
    for ($i = 1; $i < count($data) - 1; $i++) {
        $currentLow = $data[$i]['low'];
        $nextHigh = $data[$i + 1]['high'];
        $previousHigh = $data[$i - 1]['high'];
        
        if ($currentLow > $nextHigh && $previousHigh < $currentLow) {
            $fvg[] = [
                'start' => $previousHigh,
                'end' => $currentLow
            ];
        }
    }
    return $fvg;
}

function calculateTrendLines($data) {
    // Simple linear regression to find trend lines
    $trendLines = [];
    // Implement logic to calculate trend lines
    // This is a placeholder for a more complex algorithm
    return $trendLines;
}

function calculateFibonacciLevels($high, $low) {
    $levels = [];
    $diff = $high - $low;
    $levels['23.6'] = $high - $diff * 0.236;
    $levels['38.2'] = $high - $diff * 0.382;
    $levels['50.0'] = $high - $diff * 0.5;
    $levels['61.8'] = $high - $diff * 0.618;
    $levels['78.6'] = $high - $diff * 0.786;
    return $levels;
}

function analyzeLiquidityHeatmap($symbol) {
    // Placeholder for API call to get liquidity data
    $heatmap = [];
    // Implement logic to analyze liquidity
    return $heatmap;
}

try {
    if (!isset($_GET['action'])) {
        throw new Exception('Action not specified');
    }

    // Ensure proper JSON headers are set
    header('Content-Type: application/json');
    error_reporting(0); // Disable error reporting for production
    
    switch ($_GET['action']) {
        case 'getData':
            if (!isset($_GET['symbol'])) {
                throw new Exception('Symbol not specified');
            }
            $symbol = strtoupper($_GET['symbol']);
            $timeframe = $_GET['timeframe'] ?? '1m';
            $limit = $_GET['limit'] ?? 100;
            $data = fetchBinanceData($symbol, $timeframe, $limit);
            echo json_encode($data);
            break;

        case 'getTests':
            try {
                $tests = getTests();
                echo json_encode($tests);
            } catch (Exception $e) {
                logError("Error in getTests action: " . $e->getMessage());
                throw $e;
            }
            break;

        case 'saveTest':
            $testData = json_decode(file_get_contents('php://input'), true);
            if (!$testData) {
                throw new Exception('Invalid test data');
            }
            
            // Check for duplicates
            $tests = getTests();
            if (isDuplicateTest($testData, $tests)) {
                echo json_encode(['error' => 'Duplicate test']);
                break;
            }
            
            $testId = saveTest($testData);
            echo json_encode(['id' => $testId]);
            break;

        case 'updateTest':
            $testData = json_decode(file_get_contents('php://input'), true);
            if (!$testData || !isset($testData['id'])) {
                throw new Exception('Invalid test data');
            }
            $tests = getTests();
            $tests = array_map(function($test) use ($testData) {
                return $test['id'] === $testData['id'] ? $testData : $test;
            }, $tests);
            file_put_contents($testFile, json_encode($tests));
            echo json_encode(['success' => true]);
            break;

        case 'deleteTest':
            $testData = json_decode(file_get_contents('php://input'), true);
            if (!$testData || !isset($testData['id'])) {
                throw new Exception('Invalid test data');
            }
            $tests = getTests();
            $tests = array_values(array_filter($tests, function($test) use ($testData) {
                return $test['id'] !== $testData['id'];
            }));
            file_put_contents($testFile, json_encode($tests));
            echo json_encode(['success' => true]);
            break;

        case 'analyzeMarkets':
            header('Content-Type: application/json');
            $symbol = $_GET['symbol'] ?? null;
            $timeframe = $_GET['timeframe'] ?? null;
            
            if (!$symbol || !$timeframe) {
                throw new Exception('Symbol and timeframe are required');
            }
            
            $data = fetchBinanceData($symbol, $timeframe);
            if (!$data || count($data) < 30) {
                echo json_encode([]);
                break;
            }
            
            $signals = analyzeMarket($data, $symbol, $timeframe);
            echo json_encode($signals);
            break;

        case 'getAllSymbols':
            try {
                $tickerUrl = "https://api.binance.com/api/v3/ticker/24hr";
                $ch = curl_init();
                curl_setopt($ch, CURLOPT_URL, $tickerUrl);
                curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
                curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
                
                $response = curl_exec($ch);
                if (curl_errno($ch)) {
                    throw new Exception('Curl error: ' . curl_error($ch));
                }
                curl_close($ch);
                
                $tickers = json_decode($response, true);
                if (!$tickers || !is_array($tickers)) {
                    throw new Exception('Invalid response from Binance ticker');
                }

                // Filter USDT pairs and exclude unwanted pairs
                $usdtPairs = array_filter($tickers, function($ticker) {
                    // Must end with USDT
                    if (!str_ends_with($ticker['symbol'], 'USDT')) {
                        return false;
                    }

                    // Exclude stablecoins and fiat pairs
                    $excludedPairs = [
                        'USDCUSDT', 'BUSDUSDT', 'TUSDUSDT', 'USDPUSDT', 'FDUSDUSDT',
                        'USDTTRY', 'USDTARS', 'USDTBRL', 'USDTBIDR', 'USDTRUB',
                        'USDTIDRT', 'USDTUAH', 'USDTGYEN', 'USDTGBP', 'USDTEUR',
                        'USDTCOP', 'TSTUSDT', 'PNUTUSDT'
                    ];
                    if (in_array($ticker['symbol'], $excludedPairs)) {
                        return false;
                    }

                    // Exclude leveraged tokens
                    if (strpos($ticker['symbol'], 'UP') !== false ||
                        strpos($ticker['symbol'], 'DOWN') !== false ||
                        strpos($ticker['symbol'], 'BULL') !== false ||
                        strpos($ticker['symbol'], 'BEAR') !== false) {
                        return false;
                    }

                    // Must have significant volume (more than $1M in 24h)
                    if (floatval($ticker['quoteVolume']) < 1000000) {
                        return false;
                    }

                    return true;
                });

                // Sort by quote volume (USDT volume)
                usort($usdtPairs, function($a, $b) {
                    return floatval($b['quoteVolume']) - floatval($a['quoteVolume']);
                });

                // Get top 50 pairs
                $topPairs = array_slice($usdtPairs, 0, 50);
                
                // Extract just the symbols
                $symbols = array_map(function($pair) {
                    return $pair['symbol'];
                }, $topPairs);

                // Log the selected pairs and their volumes
                error_log("Selected top 50 pairs by volume:");
                foreach ($topPairs as $pair) {
                    error_log("{$pair['symbol']}: " . number_format($pair['quoteVolume'], 2) . " USDT 24h volume");
                }

                header('Content-Type: application/json');
                echo json_encode($symbols);
            } catch (Exception $e) {
                http_response_code(500);
                echo json_encode(['error' => $e->getMessage()]);
            }
            break;

        default:
            throw new Exception('Invalid action');
    }
} catch (Exception $e) {
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode([
        'error' => $e->getMessage()
    ]);
} 