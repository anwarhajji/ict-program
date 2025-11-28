
# ICT Trading Dashboard - Master Plan & Changelog

## 1. Project Overview
A professional-grade web-based trading terminal designed for **Inner Circle Trader (ICT)** concepts. It features real-time data analysis, algorithmic pattern detection, backtesting simulation, and paper trading capabilities.

## 2. Technical Architecture
*   **Frontend Framework**: React 18+ (TypeScript).
*   **Charting Engine**: `lightweight-charts` v5.0.
    *   *Rendering Strategy*: Hybrid approach using native Series for Candles/Histograms and a synchronized HTML5 `<canvas>` overlay for complex shapes (Zones, Boxes).
*   **Data Source**: Binance Public API (`api.binance.vision` / `api.binance.com`).
    *   *Proxies*: `PAXGUSDT` used for Gold (`XAUUSD`) and Micro Gold (`MGC`), Stablecoin pairs for Forex.
*   **State Management**: React `useState` / `useRef` for real-time ticks and chart synchronization.

## 3. Functional Specifications

### A. Charting & Visuals
*   **Candlestick Chart**: Standard price visualization.
*   **Session Killzones**:
    *   Visualized as background colors using a separate `HistogramSeries` on a hidden Left Price Scale (0-1 range).
    *   **Asia**: 00:00 - 08:00 UTC (Orange).
    *   **London**: 07:00 - 16:00 UTC (Blue).
    *   **New York**: 12:00 - 21:00 UTC (Green).
*   **Macro Times (New)**:
    *    Highlights the 20-minute window surrounding the top of the hour (XX:50 to XX:10).
    *   Visualized as a Gold/Yellow background.
*   **Canvas Overlay (Zones)**:
    *   **Order Blocks (OB)**: Rectangles extending from creation to current time.
    *   **Fair Value Gaps (FVG)**: Rectangles extending to the right.
    *   **Premium/Discount Zones**: Range analysis showing Expensive (Premium) vs Cheap (Discount) prices.
    *   **MTF Levels**: Previous Day High/Low lines.
    *   *Rendering*: Optimized via `requestAnimationFrame`.

### B. ICT Algorithms
*   **Structure Detection**:
    *   **Swing Points**: Identifies HH, HL, LH, LL based on configurable lookback.
    *   **BOS (Break of Structure)**: Trend continuation.
    *   **CHoCH (Change of Character)**: Trend reversal.
*   **Order Blocks (OB)**:
    *   **Detection**: Candle preceding a significant "Impulse Move" (Mean Threshold logic).
    *   **Restriction**: Only active on **5m, 15m, 1h** timeframes.
    *   **Subtypes**: Standard, Breaker, Swing.
    *   **Mitigation**: Smart detection of filled blocks.
*   **Fair Value Gaps (FVG)**:
    *   **Detection**: Gap analysis.
    *   **Silver Bullet**: Time-based weighting.
*   **Entry Signal Logic (The Scanner)**:
    *   **Scoring System (0-10)**:
        *   Trend Alignment.
        *   OB/FVG Touch.
        *   Silver Bullet.
        *   PO3 (Power of 3) Analysis.
    *   **A+ Setup**: Score ≥ 7.

### C. Trading Simulator & Backtesting
*   **Paper Trading**: Virtual Balance, Manual/Auto execution, SL/TP logic (2R).
*   **Auto-Trading Engine**: Automated execution of high-probability setups.
*   **Backtest Engine**: 
    *   Simulates all detected signals on loaded data.
    *   Strict 2R outcome validation (TP vs SL hit).
    *   Metrics: Win Rate, Net PnL, Profit Factor, Max Drawdown.
    *   **Daily Analysis**: Breakdown of last 3 days, max 10 trades per day, with PnL calculation.

### D. User Interface (UI)
*   **Sidebar**: Asset/Timeframe selection, Navigation.
*   **Settings Panel**:
    *   **Inputs**: Sensitivity, Quantities.
    *   **Style**: Color configuration.
    *   **Visibility**: Toggles for all overlays.
    *   **MTF**: Toggle for Multi-Timeframe overlays.
*   **Panels**: Scanner, Stats Dashboard, Analysis (Backtest), Top 3 Setups.

## 4. Change Log

### [Current Version] - ICT Macro Times
*   **Action**: Added visualization for Macro Times (10 mins before/after the hour).
*   **Visuals**: Gold background highlight.
*   **Status**: Implemented in `index.tsx`.

### [Previous Version] - Daily Stats Breakdown
*   **Action**: Updated Stats Dashboard to show "Last 3 Days" analysis.
*   **Details**: Analyzes last 10 detected trades per day, calculates Gain/Loss based on 1:2 R:R.
*   **Status**: Implemented in `index.tsx`.
