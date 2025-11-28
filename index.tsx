import React, { useState, useEffect, useRef, useCallback, useMemo, Component } from 'react';
import { createRoot } from 'react-dom/client';
import { 
    createChart, 
    CandlestickSeries,
    ColorType, 
    IChartApi, 
    ISeriesApi, 
    SeriesMarker, 
    UTCTimestamp,
    Time,
    DeepPartial,
    ChartOptions,
    HistogramSeries,
    PriceLineOptions,
    MouseEventParams,
    IPriceLine
} from 'lightweight-charts';

// --- TYPES ---

export type SessionType = 'ASIA' | 'LONDON' | 'NEW_YORK' | 'NONE';

export interface CandleData {
    time: UTCTimestamp;
    open: number;
    high: number;
    low: number;
    close: number;
    color?: string;
    borderColor?: string;
    wickColor?: string;
}

export interface StructurePoint {
    time: UTCTimestamp;
    price: number;
    type: 'PH' | 'PL' | 'BOS' | 'CHoCH' | 'HH' | 'HL' | 'LH' | 'LL';
    direction: 'Bullish' | 'Bearish';
}

export interface FVG {
    id: string;
    time: UTCTimestamp;
    priceHigh: number;
    priceLow: number;
    direction: 'Bullish' | 'Bearish';
    mitigated: boolean;
    isSilverBullet: boolean;
    timeframe?: string;
}

export interface OrderBlock {
    id: string;
    time: UTCTimestamp;
    priceHigh: number;
    priceLow: number;
    direction: 'Bullish' | 'Bearish';
    mitigated: boolean;
    subtype: 'Standard' | 'Breaker' | 'Swing';
    timeframe?: string;
}

export interface TradeEntry {
    time: UTCTimestamp;
    type: 'LONG' | 'SHORT';
    price: number;
    stopLoss: number;
    takeProfit: number;
    result?: 'WIN' | 'LOSS' | 'OPEN';
    pnl?: number;
    confluences: string[];
    score: number;
}

export interface EntrySignal {
    time: UTCTimestamp;
    type: 'LONG' | 'SHORT';
    price: number;
    score: number;
    confluences: string[];
    sl: number;
    tp: number;
    winProbability: number;
    tradingStyle: 'SCALP' | 'DAY_TRADE';
    po3Phase: 'ACCUMULATION' | 'MANIPULATION' | 'DISTRIBUTION' | 'NONE';
    backtestResult?: 'WIN' | 'LOSS' | 'PENDING';
    backtestPnL?: number;
}

export interface BacktestStats {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    netPnL: number;
    profitFactor: number;
    maxDrawdown: number;
    equityCurve: number[];
}

// --- UTILS ---

const getSession = (hour: number): SessionType => {
    if (hour >= 0 && hour < 8) return 'ASIA';
    if (hour >= 7 && hour < 16) return 'LONDON';
    if (hour >= 12 && hour < 21) return 'NEW_YORK';
    return 'NONE';
};

const determinePO3 = (candle: CandleData, session: SessionType): 'ACCUMULATION' | 'MANIPULATION' | 'DISTRIBUTION' | 'NONE' => {
    if (session === 'ASIA') return 'ACCUMULATION';
    if (session === 'LONDON' || session === 'NEW_YORK') {
        const body = Math.abs(candle.close - candle.open);
        const range = candle.high - candle.low;
        if (body > range * 0.6) return 'DISTRIBUTION';
        return 'MANIPULATION';
    }
    return 'NONE';
};

// --- LOGIC: ICT ALGORITHMS ---

const detectStructure = (data: CandleData[], swingLength: number = 5): StructurePoint[] => {
    const points: StructurePoint[] = [];
    const pivotHighs: {index: number, price: number}[] = [];
    const pivotLows: {index: number, price: number}[] = [];

    for (let i = swingLength; i < data.length - swingLength; i++) {
        let isHigh = true;
        let isLow = true;
        for (let j = 1; j <= swingLength; j++) {
            if (data[i].high <= data[i-j].high || data[i].high <= data[i+j].high) isHigh = false;
            if (data[i].low >= data[i-j].low || data[i].low >= data[i+j].low) isLow = false;
        }

        if (isHigh) pivotHighs.push({ index: i, price: data[i].high });
        if (isLow) pivotLows.push({ index: i, price: data[i].low });
    }

    let lastHigh = pivotHighs[0];
    let lastLow = pivotLows[0];

    const allPivots = [
        ...pivotHighs.map(p => ({...p, type: 'High'})), 
        ...pivotLows.map(p => ({...p, type: 'Low'}))
    ].sort((a,b) => a.index - b.index);

    for (const p of allPivots) {
        const candle = data[p.index];
        if (p.type === 'High') {
            if (!lastHigh) {
                lastHigh = p;
                continue;
            }
            if (p.price > lastHigh.price) {
                points.push({ time: candle.time, price: p.price, type: 'HH', direction: 'Bearish' });
            } else {
                points.push({ time: candle.time, price: p.price, type: 'LH', direction: 'Bearish' });
            }
            lastHigh = p;
        } else {
            if (!lastLow) {
                lastLow = p;
                continue;
            }
            if (p.price < lastLow.price) {
                 points.push({ time: candle.time, price: p.price, type: 'LL', direction: 'Bullish' });
            } else {
                 points.push({ time: candle.time, price: p.price, type: 'HL', direction: 'Bullish' });
            }
            lastLow = p;
        }
    }
    
    return points;
};

const detectFVG = (data: CandleData[]): FVG[] => {
    const fvgs: FVG[] = [];
    for (let i = 2; i < data.length; i++) {
        const c1 = data[i - 2];
        const c2 = data[i - 1];
        const c3 = data[i];

        const c2TimeDate = new Date((c2.time as number) * 1000);
        const hour = c2TimeDate.getUTCHours();
        const isSilverBullet = (hour === 14 || hour === 9 || hour === 3);

        if (c1.high < c3.low) {
            fvgs.push({
                id: `fvg-bull-${c2.time}`,
                time: c2.time,
                priceHigh: c3.low,
                priceLow: c1.high,
                direction: 'Bullish',
                mitigated: false,
                isSilverBullet
            });
        }
        if (c1.low > c3.high) {
            fvgs.push({
                id: `fvg-bear-${c2.time}`,
                time: c2.time,
                priceHigh: c1.low,
                priceLow: c3.high,
                direction: 'Bearish',
                mitigated: false,
                isSilverBullet
            });
        }
    }
    
    for (let i = 0; i < fvgs.length; i++) {
        const fvg = fvgs[i];
        const futureCandles = data.filter(d => (d.time as number) > (fvg.time as number));
        for (const candle of futureCandles) {
            if (fvg.direction === 'Bullish' && candle.low < fvg.priceLow) {
                fvg.mitigated = true;
                break;
            }
            if (fvg.direction === 'Bearish' && candle.high > fvg.priceHigh) {
                fvg.mitigated = true;
                break;
            }
        }
    }
    return fvgs.filter(f => !f.mitigated);
};

const detectOrderBlocks = (data: CandleData[], thresholdMult: number): OrderBlock[] => {
    const obs: OrderBlock[] = [];
    const bodySizes = data.slice(-100).map(d => Math.abs(d.close - d.open));
    const meanBody = bodySizes.reduce((a, b) => a + b, 0) / bodySizes.length || 1;
    const IMPULSE_THRESHOLD = meanBody * thresholdMult; 

    for (let i = 2; i < data.length - 3; i++) {
        const candle = data[i];
        const nextCandle = data[i+1];

        const moveUp = (nextCandle.close - nextCandle.open) > IMPULSE_THRESHOLD;
        const moveDown = (nextCandle.open - nextCandle.close) > IMPULSE_THRESHOLD;

        if (candle.close < candle.open && moveUp && nextCandle.close > candle.high) {
            obs.push({
                id: `ob-bull-${candle.time}`,
                time: candle.time,
                priceHigh: candle.high,
                priceLow: candle.low,
                direction: 'Bullish',
                mitigated: false,
                subtype: 'Standard'
            });
        }

        if (candle.close > candle.open && moveDown && nextCandle.close < candle.low) {
            obs.push({
                id: `ob-bear-${candle.time}`,
                time: candle.time,
                priceHigh: candle.high,
                priceLow: candle.low,
                direction: 'Bearish',
                mitigated: false,
                subtype: 'Standard'
            });
        }
    }

    for (let i = 0; i < obs.length; i++) {
        const ob = obs[i];
        const startIndex = data.findIndex(d => d.time === ob.time);
        if (startIndex === -1) continue;

        for (let k = startIndex + 1; k < data.length; k++) {
            const current = data[k];
            if (ob.subtype === 'Standard') {
                if (ob.direction === 'Bullish' && current.close < ob.priceLow) {
                    ob.subtype = 'Breaker';
                    ob.direction = 'Bearish';
                } else if (ob.direction === 'Bearish' && current.close > ob.priceHigh) {
                    ob.subtype = 'Breaker';
                    ob.direction = 'Bullish';
                }
            } else if (ob.subtype === 'Breaker') {
                if (ob.direction === 'Bullish' && current.close < ob.priceLow) ob.mitigated = true;
                else if (ob.direction === 'Bearish' && current.close > ob.priceHigh) ob.mitigated = true;
            }
        }
    }
    return obs.filter(o => !o.mitigated).slice(-10);
};

const detectEntries = (data: CandleData[], obs: OrderBlock[], fvgs: FVG[], timeframe: string): EntrySignal[] => {
    const signals: EntrySignal[] = [];
    let lastSignalTime = 0;
    const COOLDOWN = 10 * 60; 
    const isScalping = ['1m', '3m', '5m'].includes(timeframe);

    for (let i = 100; i < data.length; i++) {
        const candle = data[i];
        const prev50 = data.slice(i-50, i);
        const avg = prev50.reduce((a,b) => a + b.close, 0) / 50;
        const isBullish = candle.close > avg;
        
        let score = 0;
        const confluences: string[] = [];

        const touchingBullOB = obs.find(ob => ob.direction === 'Bullish' && !ob.mitigated && candle.low <= ob.priceHigh && candle.low >= ob.priceLow && (ob.time as number) < (candle.time as number));
        if (touchingBullOB) {
            score += 3;
            confluences.push(`Retest Bullish ${touchingBullOB.subtype === 'Breaker' ? 'Breaker' : 'OB'}`);
        }
        const touchingBearOB = obs.find(ob => ob.direction === 'Bearish' && !ob.mitigated && candle.high >= ob.priceLow && candle.high <= ob.priceHigh && (ob.time as number) < (candle.time as number));
        if (touchingBearOB) {
            score += 3;
            confluences.push(`Retest Bearish ${touchingBearOB.subtype === 'Breaker' ? 'Breaker' : 'OB'}`);
        }
        const touchingBullFVG = fvgs.find(f => f.direction === 'Bullish' && candle.low <= f.priceHigh && candle.low >= f.priceLow && (f.time as number) < (candle.time as number));
        if (touchingBullFVG) {
            score += 2;
            confluences.push('Discount FVG');
            if (touchingBullFVG.isSilverBullet) { score += 4; confluences.push('Silver Bullet Zone'); }
        }
         const touchingBearFVG = fvgs.find(f => f.direction === 'Bearish' && candle.high >= f.priceLow && candle.high <= f.priceHigh && (f.time as number) < (candle.time as number));
        if (touchingBearFVG) {
            score += 2;
            confluences.push('Premium FVG');
            if (touchingBearFVG.isSilverBullet) { score += 4; confluences.push('Silver Bullet Zone'); }
        }
        
        const hour = new Date((candle.time as number) * 1000).getUTCHours();
        const session = getSession(hour);
        if (session !== 'NONE') score += 1;
        const po3 = determinePO3(candle, session);

        if (score >= 4 && ((candle.time as number) - lastSignalTime > COOLDOWN)) {
            if (isBullish && (touchingBullOB || touchingBullFVG)) {
                 const swingLow = Math.min(...data.slice(i-5, i+1).map(c => c.low));
                 const sl = Math.min(swingLow, touchingBullOB?.priceLow || swingLow) - (candle.close * 0.0005);
                 const risk = candle.close - sl;
                 const tp = candle.close + (risk * 2); 
                 signals.push({
                    time: candle.time,
                    type: 'LONG',
                    price: candle.close,
                    score, confluences, sl, tp,
                    winProbability: Math.min(95, score * 10 + 30),
                    tradingStyle: isScalping ? 'SCALP' : 'DAY_TRADE',
                    po3Phase: po3
                 });
                 lastSignalTime = candle.time as number;
            } else if (!isBullish && (touchingBearOB || touchingBearFVG)) {
                 const swingHigh = Math.max(...data.slice(i-5, i+1).map(c => c.high));
                 const sl = Math.max(swingHigh, touchingBearOB?.priceHigh || swingHigh) + (candle.close * 0.0005);
                 const risk = sl - candle.close;
                 const tp = candle.close - (risk * 2);
                 signals.push({
                    time: candle.time,
                    type: 'SHORT',
                    price: candle.close,
                    score, confluences, sl, tp,
                    winProbability: Math.min(95, score * 10 + 30),
                    tradingStyle: isScalping ? 'SCALP' : 'DAY_TRADE',
                    po3Phase: po3
                 });
                 lastSignalTime = candle.time as number;
            }
        }
    }
    return signals;
};

const performBacktest = (data: CandleData[], signals: EntrySignal[]): { stats: BacktestStats, results: EntrySignal[] } => {
    let wins = 0;
    let losses = 0;
    let netPnL = 0;
    let maxDrawdown = 0;
    let peakBalance = 0;
    let currentBalance = 100000;
    const equityCurve: number[] = [100000];
    
    const processedSignals = signals.map(signal => {
        const startIndex = data.findIndex(d => d.time === signal.time);
        if (startIndex === -1) return signal;

        let result: 'WIN' | 'LOSS' | 'PENDING' = 'PENDING';
        let pnl = 0;
        
        // STRICT 1:2 R:R
        const RISK_AMOUNT = 1000;
        const REWARD_AMOUNT = 2000;

        for (let i = startIndex + 1; i < data.length; i++) {
            const candle = data[i];
            if (signal.type === 'LONG') {
                if (candle.low <= signal.sl) {
                    result = 'LOSS';
                    pnl = -RISK_AMOUNT;
                    break;
                }
                if (candle.high >= signal.tp) {
                    result = 'WIN';
                    pnl = REWARD_AMOUNT;
                    break;
                }
            } else {
                if (candle.high >= signal.sl) {
                    result = 'LOSS';
                    pnl = -RISK_AMOUNT;
                    break;
                }
                if (candle.low <= signal.tp) {
                    result = 'WIN';
                    pnl = REWARD_AMOUNT;
                    break;
                }
            }
        }

        if (result === 'WIN') wins++;
        if (result === 'LOSS') losses++;
        
        netPnL += pnl;
        currentBalance += pnl;
        equityCurve.push(currentBalance);
        
        peakBalance = Math.max(peakBalance, currentBalance);
        const dd = peakBalance - currentBalance;
        maxDrawdown = Math.max(maxDrawdown, dd);

        return { ...signal, backtestResult: result, backtestPnL: pnl };
    });

    const totalTrades = wins + losses; 
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const profitFactor = losses > 0 ? (wins * 2000) / (losses * 1000) : wins > 0 ? 999 : 0;

    return {
        stats: { totalTrades, wins, losses, winRate, netPnL, profitFactor, maxDrawdown, equityCurve },
        results: processedSignals
    };
};

// --- COMPONENTS ---

const EntryDetailModal = ({ entry, onClose }: { entry: EntrySignal, onClose: () => void }) => (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center pointer-events-auto" onClick={onClose}>
        <div className="bg-[#1e222d] border border-blue-500 p-6 rounded shadow-2xl max-w-md w-full relative" onClick={e => e.stopPropagation()}>
            <button onClick={onClose} className="absolute top-2 right-2 text-gray-400 hover:text-white">✕</button>
            <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-2">
                <h3 className={`text-2xl font-bold ${entry.type === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                    {entry.type} SETUP
                </h3>
                <div className="bg-blue-900/30 text-blue-400 px-2 py-1 rounded text-xs border border-blue-500/30">
                    {new Date((entry.time as number) * 1000).toLocaleString()}
                </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-black/20 p-3 rounded">
                    <div className="text-xs text-gray-500 mb-1">ENTRY PRICE</div>
                    <div className="text-xl font-mono">{entry.price.toFixed(2)}</div>
                </div>
                <div className="bg-black/20 p-3 rounded">
                    <div className="text-xs text-gray-500 mb-1">WIN PROBABILITY</div>
                    <div className="text-xl font-mono text-yellow-400">{entry.winProbability}%</div>
                </div>
            </div>
            <div className="mb-4">
                <div className="text-xs font-bold text-gray-400 mb-2 uppercase">Confluence Checklist</div>
                <ul className="space-y-2">
                    {entry.confluences.map((c, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm text-gray-300">
                            <span className="text-green-500">✓</span> {c}
                        </li>
                    ))}
                    <li className="flex items-center gap-2 text-sm text-gray-300"><span className="text-blue-500">ℹ</span> Style: {entry.tradingStyle}</li>
                    <li className="flex items-center gap-2 text-sm text-gray-300"><span className="text-purple-500">ℹ</span> PO3 Phase: {entry.po3Phase}</li>
                </ul>
            </div>
            <div className="bg-gray-800/50 p-3 rounded border border-gray-700">
                <div className="flex justify-between text-sm font-mono mb-1"><span className="text-green-500">Target (TP):</span><span>{entry.tp.toFixed(2)}</span></div>
                <div className="flex justify-between text-sm font-mono"><span className="text-red-500">Stop (SL):</span><span>{entry.sl.toFixed(2)}</span></div>
                <div className="mt-2 text-center text-xs text-gray-500">Risk/Reward Ratio: 1:2</div>
            </div>
            <div className="mt-4 text-center"><button onClick={onClose} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded w-full font-bold transition-colors">ACKNOWLEDGE</button></div>
        </div>
    </div>
);

const TopSetupsModal = ({ entries, onClose }: { entries: EntrySignal[], onClose: () => void }) => {
    const top3 = [...entries].sort((a, b) => b.score - a.score).slice(0, 3);
    return (
        <div className="fixed inset-0 bg-black/80 z-[70] flex items-center justify-center p-4">
            <div className="bg-[#1e222d] border border-blue-500 rounded-lg shadow-2xl max-w-2xl w-full p-6">
                <div className="flex justify-between items-center mb-6 border-b border-gray-700 pb-4"><h2 className="text-2xl font-bold text-white">⚡ TOP 3 POTENTIAL SETUPS</h2><button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button></div>
                <div className="space-y-4">{top3.map((setup, i) => (<div key={i} className="bg-gray-800 rounded p-4 border-l-4 border-yellow-500 relative"><div className="absolute top-0 right-0 bg-yellow-500 text-black text-xs font-bold px-2 py-1 rounded-bl">#{i + 1} BEST</div><div className="flex justify-between items-start mb-3"><div><span className={`text-xl font-black ${setup.type === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>{setup.type}</span><span className="ml-3 text-sm font-mono text-gray-400">@ {setup.price.toFixed(2)}</span></div><div className="text-right"><div className="text-xl font-bold text-blue-400">{setup.winProbability}% WIN PROB</div><div className="text-xs text-gray-500">{setup.tradingStyle}</div></div></div><div className="flex gap-4 text-xs font-mono bg-black/50 p-2 rounded"><span className="text-green-500">TP: {setup.tp.toFixed(2)}</span><span className="text-red-500">SL: {setup.sl.toFixed(2)}</span></div></div>))}</div>
                <div className="mt-6 text-center"><button onClick={onClose} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded font-bold w-full">CLOSE ANALYSIS</button></div>
            </div>
        </div>
    );
};

const ToastNotification = ({ message, type, onClose }: { message: string, type: 'success'|'error'|'info', onClose: () => void }) => (
    <div className={`fixed top-4 right-4 p-4 rounded shadow-lg z-[60] text-white animate-bounce cursor-pointer ${type === 'success' ? 'bg-green-600' : 'bg-blue-600'}`} onClick={onClose}>
        <div className="flex justify-between items-center gap-4"><span>{message}</span><button onClick={onClose} className="text-sm font-bold">x</button></div>
    </div>
);

interface ErrorBoundaryProps {
    children?: React.ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false };
    }
    static getDerivedStateFromError() { return { hasError: true }; }
    componentDidCatch(error: any, errorInfo: any) { console.error("Chart Crash:", error, errorInfo); }
    render() { if (this.state.hasError) return <div className="p-4 bg-red-900 text-white">Chart Crashed. <button onClick={() => window.location.reload()} className="underline">Reload</button></div>; return this.props.children; }
}

interface ChartProps {
    data: CandleData[];
    obs: OrderBlock[];
    fvgs: FVG[];
    structure: StructurePoint[];
    entries: EntrySignal[];
    overlays: any;
    colors: any;
    onHoverEntry: (entry: EntrySignal | null) => void;
    onClickEntry: (entry: EntrySignal | null) => void;
    onToggleOverlay: () => void;
    pdRange: { high: number, low: number } | null;
    position: TradeEntry | null;
    htfObs: OrderBlock[];
    htfFvgs: FVG[];
}

const ChartComponent: React.FC<ChartProps> = ({ data, obs, fvgs, structure, entries, overlays, colors, onHoverEntry, onClickEntry, onToggleOverlay, pdRange, position, htfObs, htfFvgs }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const sessionSeriesAsiaRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const macroSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null); // New Ref for Macro
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const activeTradeLinesRef = useRef<IPriceLine[]>([]);

    useEffect(() => {
        if (!chartContainerRef.current) return;
        const chart = createChart(chartContainerRef.current, {
            layout: { background: { type: ColorType.Solid, color: '#131722' }, textColor: '#D9D9D9' },
            grid: { vertLines: { color: '#2B2B43' }, horzLines: { color: '#2B2B43' } },
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
            timeScale: { timeVisible: true, secondsVisible: false },
            rightPriceScale: { visible: true, borderColor: '#2B2B43' },
            leftPriceScale: { visible: false, borderColor: '#2B2B43' }, 
        });

        const candleSeries = chart.addSeries(CandlestickSeries, { upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350', priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
        const sessionSeriesAsia = chart.addSeries(HistogramSeries, { color: 'rgba(255, 165, 0, 0.1)', priceScaleId: 'left', priceFormat: { type: 'custom', formatter: () => '' } });
        const macroSeries = chart.addSeries(HistogramSeries, { color: 'rgba(255, 215, 0, 0.25)', priceScaleId: 'left', priceFormat: { type: 'custom', formatter: () => '' } }); // Macro Series
        
        chartRef.current = chart;
        candleSeriesRef.current = candleSeries;
        sessionSeriesAsiaRef.current = sessionSeriesAsia;
        macroSeriesRef.current = macroSeries;

        const handleResize = () => { if (chartContainerRef.current && chartRef.current) chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth, height: chartContainerRef.current.clientHeight }); };
        
        chart.subscribeCrosshairMove((param) => { if (!param.time || !entries.length) { onHoverEntry(null); return; } const hoveredEntry = entries.find(e => Math.abs((e.time as number) - (param.time as number)) < 300); onHoverEntry(hoveredEntry || null); });
        chart.subscribeClick((param) => { if (!param.time || !entries.length) { onClickEntry(null); return; } const clickedEntry = entries.find(e => e.time === param.time); if (clickedEntry) onClickEntry(clickedEntry); });
        chart.timeScale().subscribeVisibleTimeRangeChange(() => requestAnimationFrame(drawCanvasOverlay));
        window.addEventListener('resize', handleResize);
        return () => { window.removeEventListener('resize', handleResize); if (chartRef.current) chartRef.current.remove(); chartRef.current = null; candleSeriesRef.current = null; sessionSeriesAsiaRef.current = null; macroSeriesRef.current = null; };
    }, []);

    // Draw Position Lines
    useEffect(() => {
        const series = candleSeriesRef.current;
        if (!series) return;
        activeTradeLinesRef.current.forEach(line => series.removePriceLine(line));
        activeTradeLinesRef.current = [];
        if (position) {
            activeTradeLinesRef.current.push(series.createPriceLine({ price: position.price, color: position.type === 'LONG' ? '#2962FF' : '#E040FB', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: `${position.type} ENTRY` }));
            if (position.stopLoss) activeTradeLinesRef.current.push(series.createPriceLine({ price: position.stopLoss, color: '#FF1744', lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: 'SL' }));
            if (position.takeProfit) activeTradeLinesRef.current.push(series.createPriceLine({ price: position.takeProfit, color: '#00E676', lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: 'TP' }));
        }
        return () => { if (candleSeriesRef.current) activeTradeLinesRef.current.forEach(line => candleSeriesRef.current?.removePriceLine(line)); activeTradeLinesRef.current = []; }
    }, [position]);

    const drawCanvasOverlay = useCallback(() => {
        const chart = chartRef.current; const canvas = canvasRef.current; const container = chartContainerRef.current; const series = candleSeriesRef.current; 
        if (!chart || !canvas || !container || !series) return;
        const ctx = canvas.getContext('2d'); if (!ctx) return;
        if (canvas.width !== container.clientWidth || canvas.height !== container.clientHeight) { canvas.width = container.clientWidth; canvas.height = container.clientHeight; }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const timeScale = chart.timeScale();

        if (overlays.pdZones && pdRange) {
            const yHigh = series.priceToCoordinate(pdRange.high); const yLow = series.priceToCoordinate(pdRange.low); const yMid = series.priceToCoordinate((pdRange.high + pdRange.low) / 2);
            if (yHigh && yLow && yMid) {
                ctx.fillStyle = 'rgba(239, 83, 80, 0.1)'; ctx.fillRect(0, yHigh, canvas.width, yMid - yHigh);
                ctx.fillStyle = 'rgba(239, 83, 80, 0.8)'; ctx.font = '10px sans-serif'; ctx.fillText('PREMIUM', canvas.width - 60, yHigh + 12);
                ctx.fillStyle = 'rgba(38, 166, 154, 0.1)'; ctx.fillRect(0, yMid, canvas.width, yLow - yMid);
                ctx.fillStyle = 'rgba(38, 166, 154, 0.8)'; ctx.fillText('DISCOUNT', canvas.width - 60, yLow - 5);
                ctx.strokeStyle = '#78909C'; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(0, yMid); ctx.lineTo(canvas.width, yMid); ctx.stroke(); ctx.fillText('EQ', canvas.width - 20, yMid - 5);
            }
        }
        
        // Draw Current TF OBs
        if (overlays.obs) {
            obs.forEach(ob => {
                if (ob.mitigated) return;
                const x1 = timeScale.timeToCoordinate(ob.time); const y1 = series.priceToCoordinate(ob.priceHigh); const y2 = series.priceToCoordinate(ob.priceLow);
                if (x1 === null || y1 === null || y2 === null) return;
                const color = ob.direction === 'Bullish' ? colors.obBull : colors.obBear;
                ctx.fillStyle = color + '66'; ctx.strokeStyle = color;
                if (ob.subtype === 'Breaker') { ctx.setLineDash([4, 2]); ctx.lineWidth = 2; } else { ctx.setLineDash([]); ctx.lineWidth = 1; }
                const width = canvas.width - x1; const height = y2 - y1;
                ctx.fillRect(x1, y1, width, height); ctx.strokeRect(x1, y1, width, height);
                ctx.fillStyle = '#fff'; ctx.font = '10px Arial'; ctx.fillText(ob.subtype === 'Standard' ? 'OB' : 'Brkr', x1 + 5, y1 - 5);
            });
        }
        
        // Draw HTF OBs
        if (overlays.mtf && overlays.obs) {
            htfObs.forEach(ob => {
                if (ob.mitigated) return;
                const x1 = timeScale.timeToCoordinate(ob.time); const y1 = series.priceToCoordinate(ob.priceHigh); const y2 = series.priceToCoordinate(ob.priceLow);
                if (x1 === null || y1 === null || y2 === null) return;
                const color = ob.direction === 'Bullish' ? colors.obBull : colors.obBear;
                ctx.fillStyle = 'transparent'; ctx.strokeStyle = color;
                ctx.setLineDash([]); ctx.lineWidth = 3;
                const width = canvas.width - x1; const height = y2 - y1;
                ctx.strokeRect(x1, y1, width, height);
                ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.fillText(`HTF OB`, x1 + 5, y1 + 12);
            });
        }

        // Draw Current TF FVGs
        if (overlays.fvgs) {
            fvgs.forEach(fvg => {
                 const x1 = timeScale.timeToCoordinate(fvg.time); const y1 = series.priceToCoordinate(fvg.priceHigh); const y2 = series.priceToCoordinate(fvg.priceLow);
                 if (x1 === null || y1 === null || y2 === null) return;
                 const color = fvg.direction === 'Bullish' ? colors.fvgBull : colors.fvgBear;
                 ctx.fillStyle = color + '40'; ctx.setLineDash([]); ctx.fillRect(x1, y1, canvas.width - x1, y2 - y1);
            });
        }
        
        // Draw HTF FVGs
        if (overlays.mtf && overlays.fvgs) {
            htfFvgs.forEach(fvg => {
                 const x1 = timeScale.timeToCoordinate(fvg.time); const y1 = series.priceToCoordinate(fvg.priceHigh); const y2 = series.priceToCoordinate(fvg.priceLow);
                 if (x1 === null || y1 === null || y2 === null) return;
                 const color = fvg.direction === 'Bullish' ? colors.fvgBull : colors.fvgBear;
                 ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([2, 2]);
                 ctx.strokeRect(x1, y1, canvas.width - x1, y2 - y1);
                 ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.fillText(`HTF FVG`, x1 + 5, y1 - 2);
            });
        }
    }, [obs, fvgs, htfObs, htfFvgs, overlays, colors, pdRange]);

    useEffect(() => { requestAnimationFrame(drawCanvasOverlay); }, [drawCanvasOverlay]);

    useEffect(() => {
        if (!candleSeriesRef.current || data.length === 0) return;
        const coloredData = data.map(d => {
            const isEntry = entries.find(e => e.time === d.time);
            const date = new Date((d.time as number) * 1000);
            const h = date.getUTCHours();
            const isSB = (h === 14 || h === 9 || h === 3);
            let color = undefined; let wickColor = undefined; let borderColor = undefined;
            if (isEntry && isEntry.score >= 7) { color = '#FFFF00'; borderColor = '#FFFF00'; wickColor = '#FFFF00'; } 
            else if (isSB && overlays.silverBullet) { borderColor = '#FFD700'; }
            return { ...d, color, borderColor, wickColor };
        });
        candleSeriesRef.current.setData(coloredData);

        const markers: SeriesMarker<Time>[] = [];
        structure.forEach(s => {
            if (['HH','HL','LH','LL'].includes(s.type) && !overlays.swingStructure) return;
            if (['BOS','CHoCH'].includes(s.type) && !overlays.internalStructure) return;
            markers.push({ time: s.time, position: s.direction === 'Bullish' ? 'belowBar' : 'aboveBar', color: s.type.includes('BOS') ? '#2962FF' : (s.type.includes('CHoCH') ? '#E040FB' : '#FFFFFF'), shape: 'none', text: s.type, size: 0 } as any); 
        });
        entries.forEach(e => {
            if (e.score >= 4) {
                let markerText = e.type;
                let markerShape = e.type === 'LONG' ? 'arrowUp' : 'arrowDown';
                if (overlays.backtestMarkers && e.backtestResult) {
                     markerText = e.backtestResult === 'WIN' ? `✅ +$${e.backtestPnL}` : `❌ -$${Math.abs(e.backtestPnL||0)}`;
                     markerShape = e.backtestResult === 'WIN' ? 'arrowUp' : 'arrowDown'; 
                } else if (e.score >= 7) {
                    markerText = '💎';
                }
                markers.push({
                    time: e.time,
                    position: e.type === 'LONG' ? 'belowBar' : 'aboveBar',
                    color: e.backtestResult === 'WIN' ? '#00E676' : (e.backtestResult === 'LOSS' ? '#FF1744' : (e.type === 'LONG' ? '#00E676' : '#FF1744')),
                    shape: markerShape as any,
                    text: markerText
                });
            }
        });
        if (candleSeriesRef.current) { try { (candleSeriesRef.current as any).setMarkers(markers); } catch (e) { console.warn("setMarkers failed:", e); } }
        
        // Update Session Killzones
        if (sessionSeriesAsiaRef.current) {
            const sessionData = data.map(d => {
                const h = new Date((d.time as number) * 1000).getUTCHours();
                let value = 0; let color = 'transparent';
                if (overlays.killzones) {
                    if (h >= 0 && h < 8) { value = 1; color = 'rgba(255, 165, 0, 0.15)'; }
                    if (h >= 7 && h < 16) { value = 1; color = 'rgba(41, 98, 255, 0.15)'; }
                    if (h >= 12 && h < 21) { value = 1; color = 'rgba(0, 230, 118, 0.15)'; }
                }
                return { time: d.time, value, color };
            });
            sessionSeriesAsiaRef.current.setData(sessionData);
        }

        // Update Macro Times
        if (macroSeriesRef.current) {
            const macroData = data.map(d => {
                const date = new Date((d.time as number) * 1000);
                const m = date.getUTCMinutes();
                let value = 0; let color = 'transparent';
                
                // Logic: 10 mins before hour (50-59) AND 10 mins after hour (0-10)
                if (overlays.macro && (m >= 50 || m <= 10)) {
                    value = 1;
                    color = 'rgba(255, 215, 0, 0.25)'; // Gold background
                }
                return { time: d.time, value, color };
            });
            macroSeriesRef.current.setData(macroData);
        }

        requestAnimationFrame(drawCanvasOverlay);
    }, [data, obs, fvgs, structure, entries, overlays, colors, drawCanvasOverlay]);

    return (
        <div className="relative w-full h-full">
            <div ref={chartContainerRef} className="w-full h-full" />
            <canvas ref={canvasRef} className="absolute top-0 left-0 pointer-events-none z-10" />
            <button onClick={onToggleOverlay} className="absolute top-4 right-16 z-20 bg-gray-800 p-2 rounded hover:bg-gray-700 text-xs text-white border border-gray-600 transition-colors">{overlays.killzones ? 'HIDE SESSIONS' : 'SHOW SESSIONS'}</button>
        </div>
    );
};

// --- MAIN APP ---

const App = () => {
    const [data, setData] = useState<CandleData[]>([]);
    const [obs, setObs] = useState<OrderBlock[]>([]);
    const [fvgs, setFvgs] = useState<FVG[]>([]);
    const [structure, setStructure] = useState<StructurePoint[]>([]);
    const [entries, setEntries] = useState<EntrySignal[]>([]);
    
    // MTF State
    const [htfObs, setHtfObs] = useState<OrderBlock[]>([]);
    const [htfFvgs, setHtfFvgs] = useState<FVG[]>([]);

    const [pdRange, setPdRange] = useState<{high: number, low: number} | null>(null);
    const [backtestStats, setBacktestStats] = useState<BacktestStats | null>(null);
    
    const [activeTab, setActiveTab] = useState('SCANNER');
    const [settingsTab, setSettingsTab] = useState('VISIBILITY'); 
    const [asset, setAsset] = useState('MGC (COMEX)');
    const [timeframe, setTimeframe] = useState('15m');
    const [showTopSetups, setShowTopSetups] = useState(false);
    const [clickedEntry, setClickedEntry] = useState<EntrySignal | null>(null);
    
    const [overlays, setOverlays] = useState({
        obs: true, fvgs: true, killzones: true, silverBullet: true, pdZones: true,
        internalStructure: true, swingStructure: true, mtf: true, backtestMarkers: false,
        macro: true // New Macro Toggle
    });
    
    const [colors, setColors] = useState({ obBull: '#00E676', obBear: '#FF1744', fvgBull: '#00BCD4', fvgBear: '#2962FF' });
    const [config, setConfig] = useState({ swingLength: 5, obThreshold: 1.2, fvgExtend: 10 });
    
    const [balance, setBalance] = useState(100000);
    const [position, setPosition] = useState<TradeEntry | null>(null);
    const [tradeHistory, setTradeHistory] = useState<TradeEntry[]>([]);
    const [autoTrade, setAutoTrade] = useState(false);
    const [slInput, setSlInput] = useState('');
    const [tpInput, setTpInput] = useState('');
    const [alert, setAlert] = useState<{msg: string, type: 'success'|'error'|'info'} | null>(null);
    const [hoveredEntry, setHoveredEntry] = useState<EntrySignal | null>(null);

    const getHtf = (tf: string) => {
        if (['1m','3m','5m'].includes(tf)) return '1h';
        if (['15m','30m'].includes(tf)) return '4h';
        if (['1h','4h'].includes(tf)) return '1d';
        return '1d';
    };

    const fetchData = async () => {
        try {
            let symbol = asset;
            if (asset === 'XAUUSD.P' || asset === 'GOLD' || asset.includes('MGC')) symbol = 'PAXGUSDT'; 
            
            // 1. Fetch Current TF Data
            const res = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${timeframe}&limit=500`);
            const raw = await res.json();
            if (!Array.isArray(raw)) throw new Error("Invalid API Data");
            const candles: CandleData[] = raw.map((c: any) => ({ time: c[0] / 1000 as UTCTimestamp, open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]) }));
            
            // 2. Fetch HTF Data (Parallel)
            const htfTf = getHtf(timeframe);
            const resHtf = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${htfTf}&limit=200`);
            const rawHtf = await resHtf.json();
            const candlesHtf: CandleData[] = Array.isArray(rawHtf) ? rawHtf.map((c: any) => ({ time: c[0] / 1000 as UTCTimestamp, open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]) })) : [];

            setData(candles);
            const recentSlice = candles.slice(-100);
            const highest = Math.max(...recentSlice.map(c => c.high));
            const lowest = Math.min(...recentSlice.map(c => c.low));
            setPdRange({ high: highest, low: lowest });

            const _structure = detectStructure(candles, config.swingLength);
            const allowedObTimeframes = ['5m', '15m', '1h'];
            const _obs = allowedObTimeframes.includes(timeframe) ? detectOrderBlocks(candles, config.obThreshold) : [];
            const _fvgs = detectFVG(candles);
            const _entries = detectEntries(candles, _obs, _fvgs, timeframe);
            
            // Process HTF Patterns
            const _htfObs = detectOrderBlocks(candlesHtf, config.obThreshold);
            const _htfFvgs = detectFVG(candlesHtf);
            setHtfObs(_htfObs);
            setHtfFvgs(_htfFvgs);
            
            // Backtest
            const bt = performBacktest(candles, _entries);
            setBacktestStats(bt.stats);
            setEntries(bt.results);
            
            setStructure(_structure); setObs(_obs); setFvgs(_fvgs);
            
            if (autoTrade && !position && _entries.length > 0) {
                const lastSignal = _entries[_entries.length - 1];
                if (lastSignal.time === candles[candles.length - 1].time && lastSignal.score >= 8) {
                    enterTrade(lastSignal.type, lastSignal.price, lastSignal.sl, lastSignal.tp, lastSignal.confluences);
                    setAlert({ msg: `Auto-Trade Executed: ${lastSignal.type}`, type: 'success' });
                    playAlertSound();
                }
            }
        } catch (e) { console.error(e); setAlert({ msg: "Failed to fetch data", type: 'error' }); }
    };

    useEffect(() => { fetchData(); const interval = setInterval(fetchData, 60000); return () => clearInterval(interval); }, [asset, timeframe, autoTrade, config]);
    const playAlertSound = () => { const ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); const osc = ctx.createOscillator(); osc.connect(ctx.destination); osc.frequency.value = 800; osc.start(); osc.stop(ctx.currentTime + 0.2); };
    const enterTrade = (type: 'LONG'|'SHORT', price: number, sl: number, tp: number, confluences: string[] = []) => { setPosition({ time: Math.floor(Date.now() / 1000) as UTCTimestamp, type, price, stopLoss: sl, takeProfit: tp, result: 'OPEN', confluences, score: 0 }); };
    const closeTrade = (pnl: number) => { if (!position) return; setBalance(prev => prev + pnl); setTradeHistory(prev => [{ ...position, result: pnl > 0 ? 'WIN' : 'LOSS', pnl }, ...prev]); setPosition(null); };
    useEffect(() => { if (!position || data.length === 0) return; const currentPrice = data[data.length - 1].close; let pnl = 0; if (position.type === 'LONG') { pnl = (currentPrice - position.price) * 1; if (currentPrice >= position.takeProfit) closeTrade(pnl); if (currentPrice <= position.stopLoss) closeTrade(pnl); } else { pnl = (position.price - currentPrice) * 1; if (currentPrice <= position.takeProfit) closeTrade(pnl); if (currentPrice <= position.stopLoss) closeTrade(pnl); } }, [data, position]);

    // NEW: Daily Stats Calculation
    const dailyStats = useMemo(() => {
        const groups: {[key: string]: EntrySignal[]} = {};
        const validEntries = entries.filter(e => e.backtestResult === 'WIN' || e.backtestResult === 'LOSS');
        
        validEntries.forEach(e => {
            const date = new Date((e.time as number) * 1000).toLocaleDateString();
            if (!groups[date]) groups[date] = [];
            groups[date].push(e);
        });

        const sortedDates = Object.keys(groups).sort((a,b) => new Date(b).getTime() - new Date(a).getTime()).slice(0, 3);

        return sortedDates.map(date => {
            const dailyTrades = groups[date].sort((a,b) => (b.time as number) - (a.time as number)).slice(0, 10);
            
            let totalGain = 0;
            let totalLoss = 0;
            let netPnL = 0;
            const RISK_PER_TRADE = 1000; 

            dailyTrades.forEach(t => {
                if (t.backtestResult === 'WIN') {
                    const gain = RISK_PER_TRADE * 2;
                    totalGain += gain;
                    netPnL += gain;
                } else {
                    const loss = RISK_PER_TRADE;
                    totalLoss += loss;
                    netPnL -= loss;
                }
            });

            return { date, totalGain, totalLoss, netPnL, tradeCount: dailyTrades.length, trades: dailyTrades };
        });
    }, [entries]);

    return (
        <div className="flex h-screen bg-[#131722] text-gray-300">
            {alert && <ToastNotification message={alert.msg} type={alert.type} onClose={() => setAlert(null)} />}
            {showTopSetups && <TopSetupsModal entries={entries} onClose={() => setShowTopSetups(false)} />}
            {clickedEntry && <EntryDetailModal entry={clickedEntry} onClose={() => setClickedEntry(null)} />}

            <div className="w-64 bg-[#1e222d] border-r border-gray-800 flex flex-col">
                <div className="p-4 border-b border-gray-800 font-bold text-xl text-blue-500">ICT Master</div>
                <div className="p-4">
                    <button onClick={() => setShowTopSetups(true)} className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-bold p-3 rounded mb-4 flex items-center justify-center gap-2 animate-pulse">⚡ TOP 3 SETUPS</button>
                    <div className="text-xs font-bold text-gray-500 mb-2">ASSETS</div>
                    {['MGC (COMEX)', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'EURUSDT'].map(sym => ( <button key={sym} onClick={() => setAsset(sym)} className={`w-full text-left p-2 text-sm rounded mb-1 ${asset === sym ? 'bg-blue-600 text-white' : 'hover:bg-gray-700'}`}>{sym}</button> ))}
                </div>
                <div className="p-4">
                    <div className="text-xs font-bold text-gray-500 mb-2">TIMEFRAME</div>
                    <div className="grid grid-cols-3 gap-2">{['1m', '3m', '5m', '15m', '1h', '4h'].map(tf => ( <button key={tf} onClick={() => setTimeframe(tf)} className={`p-1 text-xs rounded ${timeframe === tf ? 'bg-blue-600 text-white' : 'bg-gray-800'}`}>{tf}</button> ))}</div>
                </div>
                <div className="p-4 border-t border-gray-800">
                    <div className="text-xs font-bold text-gray-500 mb-2">CONTROLS</div>
                    <div className="flex gap-2">
                        <button onClick={fetchData} className="flex-1 bg-gray-700 hover:bg-gray-600 p-2 rounded text-xs text-white font-bold">↻ RELOAD</button>
                        <button onClick={() => window.location.reload()} className="flex-1 bg-red-900 hover:bg-red-800 p-2 rounded text-xs text-white font-bold">⚠ REBOOT</button>
                    </div>
                </div>
                <div className="mt-auto p-2 flex flex-col gap-1">{['SCANNER', 'TRADING', 'STATS', 'SETTINGS', 'BACKTEST'].map(tab => ( <button key={tab} onClick={() => setActiveTab(tab)} className={`p-3 text-center font-bold rounded ${activeTab === tab ? 'bg-gray-700 text-white' : 'hover:bg-gray-800 text-gray-500'}`}>{tab}</button> ))}</div>
            </div>

            <div className="flex-1 flex relative">
                 <div className="absolute top-0 left-0 right-0 bg-black/40 backdrop-blur-sm border-b border-gray-700 text-xs flex items-center h-8 px-4 z-30 overflow-hidden whitespace-nowrap">
                    <span className="font-bold text-blue-400 mr-4">LIVE SIGNALS:</span>
                    <div className="flex gap-6 animate-marquee">{entries.slice(-5).reverse().map((e, i) => ( <span key={i} className={`font-mono ${e.score >= 7 ? 'text-yellow-400' : 'text-gray-400'}`}>{e.type} @ {e.price.toFixed(2)} (Score: {e.score})</span> ))}</div>
                </div>
                <div className="absolute top-8 bottom-0 left-0 right-0">
                    <ErrorBoundary>
                        <ChartComponent 
                            data={data} obs={obs} fvgs={fvgs} structure={structure} entries={entries} overlays={overlays} colors={colors} onHoverEntry={setHoveredEntry} onClickEntry={setClickedEntry} onToggleOverlay={() => setOverlays(p => ({...p, killzones: !p.killzones}))} pdRange={pdRange} position={position}
                            htfObs={htfObs} htfFvgs={htfFvgs}
                        />
                    </ErrorBoundary>
                </div>

                {hoveredEntry && !clickedEntry && (
                    <div className="absolute top-20 left-1/2 transform -translate-x-1/2 bg-black/90 p-4 rounded border border-blue-500 text-white z-50 max-w-sm pointer-events-none">
                        <div className="font-bold text-lg mb-2">{hoveredEntry.type} ENTRY {hoveredEntry.score >= 7 && '💎'}</div>
                        <div className="text-xs font-bold text-blue-400 mb-1">🚀 CONFLUENCES:</div>
                        <ul className="list-disc pl-4 text-xs">{hoveredEntry.confluences.map(c => <li key={c}>{c}</li>)}</ul>
                        <div className="text-xs text-gray-500 mt-2 italic">Click candle for full details...</div>
                    </div>
                )}

                {activeTab === 'SCANNER' && (
                    <div className="absolute top-12 left-4 bg-[#1e222d] p-4 rounded shadow-xl w-72 border border-gray-700 overflow-y-auto max-h-[500px]">
                        <div className="font-bold mb-4">ICT Scanner & Setups</div>
                        <div className="space-y-2">
                            <div className="flex justify-between"><span>Current Trend:</span><span className={structure[structure.length-1]?.direction === 'Bullish' ? 'text-green-500' : 'text-red-500'}>{structure[structure.length-1]?.direction || 'Neutral'}</span></div>
                            <div className="mt-4">
                                <div className="text-xs font-bold text-gray-500 mb-2">DETECTED SETUPS</div>
                                {entries.slice(-5).reverse().map((entry, i) => (
                                    <div key={i} className="p-2 bg-gray-800 rounded border-l-4 border-blue-500 mb-2 cursor-pointer hover:bg-gray-700" onClick={() => setClickedEntry(entry)}>
                                        <div className="flex justify-between items-center"><span className={`font-bold ${entry.type === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>{entry.type} {entry.score >= 7 && '💎'}</span><span className="text-xs text-gray-500">{new Date(entry.time as number * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span></div>
                                        <div className="text-xs text-gray-400 mt-1">Score: {entry.score}/10</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'TRADING' && (
                     <div className="absolute bottom-4 left-4 bg-[#1e222d] p-4 rounded shadow-xl w-72 border border-gray-700">
                        <div className="font-bold mb-2">Paper Trading</div>
                        <div className="text-2xl font-mono mb-4">${balance.toFixed(2)}</div>
                        {position ? (
                            <div className="bg-blue-900/30 p-3 rounded border border-blue-500">
                                <div className="flex justify-between mb-2"><span className="font-bold">{position.type}</span><span className={data[data.length-1]?.close > position.price ? 'text-green-400' : 'text-red-400'}>PnL: ${(position.type === 'LONG' ? (data[data.length-1]?.close - position.price) : (position.price - data[data.length-1]?.close)).toFixed(2)}</span></div>
                                <button onClick={() => closeTrade(0)} className="w-full bg-red-600 text-white py-1 rounded text-xs">CLOSE POSITION</button>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <div className="flex gap-2">
                                    <input type="number" placeholder="SL Price" value={slInput} onChange={e => setSlInput(e.target.value)} className="w-1/2 bg-gray-800 p-2 rounded text-xs text-white border border-gray-600" />
                                    <input type="number" placeholder="TP Price" value={tpInput} onChange={e => setTpInput(e.target.value)} className="w-1/2 bg-gray-800 p-2 rounded text-xs text-white border border-gray-600" />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <button onClick={() => enterTrade('LONG', data[data.length-1].close, parseFloat(slInput) || data[data.length-1].close*0.99, parseFloat(tpInput))} className="bg-green-600 hover:bg-green-700 py-3 rounded font-bold text-white">BUY / LONG</button>
                                    <button onClick={() => enterTrade('SHORT', data[data.length-1].close, parseFloat(slInput) || data[data.length-1].close*1.01, parseFloat(tpInput))} className="bg-red-600 hover:bg-red-700 py-3 rounded font-bold text-white">SELL / SHORT</button>
                                </div>
                                <div className="flex items-center gap-2 mt-2 justify-center bg-gray-800 p-1 rounded"><input type="checkbox" checked={autoTrade} onChange={e => setAutoTrade(e.target.checked)} /><span className="text-xs">Auto-Trade A+ Setups</span></div>
                            </div>
                        )}
                     </div>
                )}

                {activeTab === 'SETTINGS' && (
                    <div className="absolute inset-0 bg-[#131722] z-40 p-8 overflow-y-auto">
                        <div className="flex justify-between items-center mb-6 border-b border-gray-700 pb-4"><h1 className="text-2xl font-bold text-white">LuxAlgo Smart Money Concepts</h1><button onClick={() => setActiveTab('SCANNER')} className="text-gray-400 hover:text-white text-2xl">×</button></div>
                        <div className="flex gap-4 mb-6 border-b border-gray-700">{['INPUTS', 'STYLE', 'VISIBILITY'].map(tab => ( <button key={tab} onClick={() => setSettingsTab(tab)} className={`pb-2 font-bold text-sm ${settingsTab === tab ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-400 hover:text-white'}`}>{tab}</button> ))}</div>
                        <div className="bg-[#1e222d] rounded p-6 shadow-lg max-w-3xl mx-auto">
                            {settingsTab === 'INPUTS' && (
                                <div className="space-y-6">
                                    <div className="flex justify-between items-center"><label className="font-bold">Swing Structure Length</label><input type="number" value={config.swingLength} onChange={e => setConfig({...config, swingLength: parseInt(e.target.value)})} className="bg-gray-800 p-2 rounded w-20 text-center"/></div>
                                    <div className="flex justify-between items-center"><label className="font-bold">Order Block Threshold</label><input type="number" step="0.1" value={config.obThreshold} onChange={e => setConfig({...config, obThreshold: parseFloat(e.target.value)})} className="bg-gray-800 p-2 rounded w-20 text-center"/></div>
                                    <div className="flex justify-between items-center"><label className="font-bold">FVG Extension (Candles)</label><input type="number" value={config.fvgExtend} onChange={e => setConfig({...config, fvgExtend: parseInt(e.target.value)})} className="bg-gray-800 p-2 rounded w-20 text-center"/></div>
                                </div>
                            )}
                            {settingsTab === 'VISIBILITY' && (
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-3">
                                        <h3 className="text-blue-400 text-xs font-bold uppercase mb-2">Structure & Patterns</h3>
                                        <label className="flex items-center justify-between p-2 bg-gray-800 rounded cursor-pointer hover:bg-gray-700"><span>Internal Structure (BOS/CHoCH)</span> <input type="checkbox" checked={overlays.internalStructure} onChange={() => setOverlays({...overlays, internalStructure: !overlays.internalStructure})} /></label>
                                        <label className="flex items-center justify-between p-2 bg-gray-800 rounded cursor-pointer hover:bg-gray-700"><span>Swing Structure (HH/LL)</span> <input type="checkbox" checked={overlays.swingStructure} onChange={() => setOverlays({...overlays, swingStructure: !overlays.swingStructure})} /></label>
                                        <label className="flex items-center justify-between p-2 bg-gray-800 rounded cursor-pointer hover:bg-gray-700"><span>Order Blocks</span> <input type="checkbox" checked={overlays.obs} onChange={() => setOverlays({...overlays, obs: !overlays.obs})} /></label>
                                        <label className="flex items-center justify-between p-2 bg-gray-800 rounded cursor-pointer hover:bg-gray-700"><span>Fair Value Gaps</span> <input type="checkbox" checked={overlays.fvgs} onChange={() => setOverlays({...overlays, fvgs: !overlays.fvgs})} /></label>
                                        <label className="flex items-center justify-between p-2 bg-gray-800 rounded cursor-pointer hover:bg-gray-700"><span>Backtest Markers</span> <input type="checkbox" checked={overlays.backtestMarkers} onChange={() => setOverlays({...overlays, backtestMarkers: !overlays.backtestMarkers})} /></label>
                                        <label className="flex items-center justify-between p-2 bg-gray-800 rounded cursor-pointer hover:bg-gray-700"><span>MTF Analysis</span> <input type="checkbox" checked={overlays.mtf} onChange={() => setOverlays({...overlays, mtf: !overlays.mtf})} /></label>
                                    </div>
                                    <div className="space-y-3">
                                        <h3 className="text-blue-400 text-xs font-bold uppercase mb-2">Zones & Sessions</h3>
                                        <label className="flex items-center justify-between p-2 bg-gray-800 rounded cursor-pointer hover:bg-gray-700"><span>Premium / Discount Zones</span> <input type="checkbox" checked={overlays.pdZones} onChange={() => setOverlays({...overlays, pdZones: !overlays.pdZones})} /></label>
                                        <label className="flex items-center justify-between p-2 bg-gray-800 rounded cursor-pointer hover:bg-gray-700"><span>Killzones (Sessions)</span> <input type="checkbox" checked={overlays.killzones} onChange={() => setOverlays({...overlays, killzones: !overlays.killzones})} /></label>
                                        <label className="flex items-center justify-between p-2 bg-gray-800 rounded cursor-pointer hover:bg-gray-700"><span>Macro Times (Gold)</span> <input type="checkbox" checked={overlays.macro} onChange={() => setOverlays({...overlays, macro: !overlays.macro})} /></label>
                                        <label className="flex items-center justify-between p-2 bg-gray-800 rounded cursor-pointer hover:bg-gray-700"><span>Silver Bullet</span> <input type="checkbox" checked={overlays.silverBullet} onChange={() => setOverlays({...overlays, silverBullet: !overlays.silverBullet})} /></label>
                                    </div>
                                </div>
                            )}
                            {settingsTab === 'STYLE' && (
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-4">
                                        <div><label className="text-xs text-gray-500">Bullish Order Block</label><input type="color" value={colors.obBull} onChange={e => setColors({...colors, obBull: e.target.value})} className="block w-full h-8 rounded cursor-pointer mt-1"/></div>
                                        <div><label className="text-xs text-gray-500">Bearish Order Block</label><input type="color" value={colors.obBear} onChange={e => setColors({...colors, obBear: e.target.value})} className="block w-full h-8 rounded cursor-pointer mt-1"/></div>
                                    </div>
                                    <div className="space-y-4">
                                        <div><label className="text-xs text-gray-500">Bullish FVG</label><input type="color" value={colors.fvgBull} onChange={e => setColors({...colors, fvgBull: e.target.value})} className="block w-full h-8 rounded cursor-pointer mt-1"/></div>
                                        <div><label className="text-xs text-gray-500">Bearish FVG</label><input type="color" value={colors.fvgBear} onChange={e => setColors({...colors, fvgBear: e.target.value})} className="block w-full h-8 rounded cursor-pointer mt-1"/></div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'STATS' && (
                    <div className="absolute inset-0 bg-[#131722] z-40 p-8 overflow-y-auto">
                        <div className="flex justify-between items-center mb-8">
                            <h1 className="text-3xl font-bold">Performance Dashboard</h1>
                            <button onClick={() => setActiveTab('SCANNER')} className="bg-gray-700 px-4 py-2 rounded hover:bg-gray-600">Close</button>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-4 mb-8">
                            <div className="bg-[#1e222d] p-6 rounded">
                                <div className="text-gray-500">Total Trades</div>
                                <div className="text-3xl font-bold">{tradeHistory.length}</div>
                            </div>
                            <div className="bg-[#1e222d] p-6 rounded">
                                <div className="text-gray-500">Win Rate</div>
                                <div className="text-3xl font-bold text-green-500">
                                    {tradeHistory.length ? ((tradeHistory.filter(t => t.result === 'WIN').length / tradeHistory.length) * 100).toFixed(1) : 0}%
                                </div>
                            </div>
                            <div className="bg-[#1e222d] p-6 rounded">
                                <div className="text-gray-500">Net PnL</div>
                                <div className={`text-3xl font-bold ${balance >= 100000 ? 'text-green-500' : 'text-red-500'}`}>
                                    ${(balance - 100000).toFixed(2)}
                                </div>
                            </div>
                        </div>

                        {/* DAILY STATS BREAKDOWN */}
                        <div className="mb-8">
                            <h3 className="text-xl font-bold mb-4 text-blue-400">Daily Analysis (Last 3 Days - Max 10 Trades/Day - 2R)</h3>
                            <div className="space-y-4">
                                {dailyStats.map((day, i) => (
                                    <div key={i} className="bg-[#1e222d] rounded p-4 border border-gray-700">
                                        <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-2">
                                            <div className="font-bold text-lg">{day.date}</div>
                                            <div className={`text-xl font-mono font-bold ${day.netPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                {day.netPnL >= 0 ? '+' : ''}${day.netPnL.toLocaleString()}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-4 gap-4 text-sm mb-4">
                                            <div className="bg-gray-800 p-2 rounded">
                                                <div className="text-gray-500 text-xs">Trades</div>
                                                <div className="font-bold">{day.tradeCount}</div>
                                            </div>
                                            <div className="bg-gray-800 p-2 rounded">
                                                <div className="text-gray-500 text-xs">Total Gain</div>
                                                <div className="font-bold text-green-400">${day.totalGain.toLocaleString()}</div>
                                            </div>
                                            <div className="bg-gray-800 p-2 rounded">
                                                <div className="text-gray-500 text-xs">Total Loss</div>
                                                <div className="font-bold text-red-400">-${day.totalLoss.toLocaleString()}</div>
                                            </div>
                                            <div className="bg-gray-800 p-2 rounded">
                                                <div className="text-gray-500 text-xs">Win Rate</div>
                                                <div className="font-bold">
                                                    {day.tradeCount ? ((day.trades.filter(t => t.backtestResult==='WIN').length / day.tradeCount)*100).toFixed(0) : 0}%
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {dailyStats.length === 0 && <div className="text-gray-500 italic">No historical data available for analysis.</div>}
                            </div>
                        </div>
                        
                        <div className="bg-[#1e222d] rounded p-4">
                            <h3 className="font-bold mb-4">Trade History Log</h3>
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-800 text-gray-400">
                                    <tr>
                                        <th className="p-2">Time</th>
                                        <th className="p-2">Type</th>
                                        <th className="p-2">Entry Price</th>
                                        <th className="p-2">Result</th>
                                        <th className="p-2">PnL</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tradeHistory.map((t, i) => (
                                        <tr key={i} className="border-b border-gray-700">
                                            <td className="p-2">{new Date(t.time as number * 1000).toLocaleTimeString()}</td>
                                            <td className={`p-2 font-bold ${t.type === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>{t.type}</td>
                                            <td className="p-2">{t.price.toFixed(2)}</td>
                                            <td className={`p-2 ${t.result === 'WIN' ? 'text-green-500' : 'text-red-500'}`}>{t.result}</td>
                                            <td className="p-2 font-mono">${t.pnl?.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {activeTab === 'BACKTEST' && backtestStats && (
                     <div className="absolute inset-0 bg-[#131722] z-40 p-8 overflow-y-auto">
                        <div className="flex justify-between items-center mb-8">
                            <h1 className="text-3xl font-bold">Backtesting Engine Results <span className="text-sm font-normal text-gray-500">(On Loaded 500 Candles)</span></h1>
                            <button onClick={() => setActiveTab('SCANNER')} className="bg-gray-700 px-4 py-2 rounded hover:bg-gray-600">Close</button>
                        </div>
                        
                        <div className="grid grid-cols-4 gap-4 mb-8">
                            <div className="bg-[#1e222d] p-6 rounded border-l-4 border-blue-500">
                                <div className="text-gray-500 text-xs uppercase tracking-wide">Total Trades</div>
                                <div className="text-3xl font-bold mt-1">{backtestStats.totalTrades}</div>
                            </div>
                            <div className="bg-[#1e222d] p-6 rounded border-l-4 border-purple-500">
                                <div className="text-gray-500 text-xs uppercase tracking-wide">Win Rate</div>
                                <div className={`text-3xl font-bold mt-1 ${backtestStats.winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>{backtestStats.winRate.toFixed(1)}%</div>
                            </div>
                            <div className="bg-[#1e222d] p-6 rounded border-l-4 border-green-500">
                                <div className="text-gray-500 text-xs uppercase tracking-wide">Net PnL</div>
                                <div className={`text-3xl font-bold mt-1 ${backtestStats.netPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>${backtestStats.netPnL.toFixed(2)}</div>
                            </div>
                            <div className="bg-[#1e222d] p-6 rounded border-l-4 border-red-500">
                                <div className="text-gray-500 text-xs uppercase tracking-wide">Max Drawdown</div>
                                <div className="text-3xl font-bold mt-1 text-red-400">${backtestStats.maxDrawdown.toFixed(2)}</div>
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-8">
                            <div className="col-span-2 bg-[#1e222d] rounded p-6">
                                <h3 className="font-bold mb-4 text-lg border-b border-gray-700 pb-2">Equity Curve (Simulated)</h3>
                                <div className="h-64 flex items-end gap-1 border-b border-l border-gray-700 p-2">
                                    {backtestStats.equityCurve.map((val, i) => {
                                        const min = Math.min(...backtestStats.equityCurve);
                                        const max = Math.max(...backtestStats.equityCurve);
                                        const range = max - min || 1;
                                        const height = ((val - min) / range) * 100;
                                        return (
                                            <div key={i} className="flex-1 bg-blue-600 hover:bg-blue-400 transition-all relative group" style={{ height: `${height}%` }}>
                                                <div className="hidden group-hover:block absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-black text-white text-xs p-1 rounded">${val.toFixed(0)}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="bg-[#1e222d] rounded p-6 overflow-y-auto h-96">
                                <h3 className="font-bold mb-4 text-lg border-b border-gray-700 pb-2">Backtest Log</h3>
                                <div className="space-y-2">
                                    {entries.filter(e => e.backtestResult && e.backtestResult !== 'PENDING').reverse().map((e, i) => (
                                        <div key={i} className={`p-3 rounded border-l-4 ${e.backtestResult === 'WIN' ? 'bg-green-900/20 border-green-500' : 'bg-red-900/20 border-red-500'}`}>
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="font-bold text-sm">{e.type}</span>
                                                <span className={`font-bold ${e.backtestResult === 'WIN' ? 'text-green-400' : 'text-red-400'}`}>{e.backtestResult}</span>
                                            </div>
                                            <div className="flex justify-between text-xs text-gray-400">
                                                <span>{new Date(e.time as number * 1000).toLocaleTimeString()}</span>
                                                <span className="font-mono">${e.backtestPnL}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="mt-8 text-center">
                             <p className="text-gray-500 text-sm italic mb-4">
                                 * Backtest based on strict 2R logic (Risk $1000, Reward $2000) on the currently loaded 500 candles.
                                 <br/>Enable "Backtest Markers" in Visibility Settings to see exact trade locations on the chart.
                             </p>
                             <button onClick={() => { setOverlays({...overlays, backtestMarkers: true}); setActiveTab('SCANNER'); }} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded font-bold">
                                 SHOW TRADES ON CHART
                             </button>
                        </div>
                     </div>
                )}
            </div>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);