# ICT Trading Dashboard Documentation

## Overview
The **ICT Trading Dashboard** is a web-based charting application designed for traders who utilize "Inner Circle Trader" (ICT) concepts. It visualizes real-time market data and automatically overlays technical analysis indicators specific to smart money concepts.

## Features

### 1. Multi-Asset Support
The dashboard supports various asset classes using real-time data:
- **Crypto:** BTC, ETH, SOL, XRP, BNB.
- **Forex:** EUR, GBP, JPY (pegged via USDT pairs).
- **Metals:** Gold (pegged via PAXG).

### 2. ICT Smart Money Indicators
The app automatically calculates and renders key algorithmic trading concepts:

*   **Fair Value Gaps (FVG):**
    *   **Definition:** A three-candle pattern where the first candle's high/low does not overlap with the third candle's low/high, leaving a gap in the second candle.
    *   **Visualization:**
        *   **Bullish FVG:** Green Up Arrow (Potential Support).
        *   **Bearish FVG:** Red Down Arrow (Potential Resistance).
    *   **Usage:** These areas often act as magnets for price to rebalance.

*   **Daily Bias:**
    *   **Definition:** Determines the likely direction of the day based on the previous day's High/Low.
    *   **Logic:**
        *   If current price > Previous Day High = **Bullish**.
        *   If current price < Previous Day Low = **Bearish**.
        *   Otherwise = **Neutral**.

*   **Session Killzones:**
    *   **Definition:** Specific time windows where volatility and volume are expected to be highest due to major market sessions.
    *   **Sessions Tracked (UTC):**
        *   **Asian Range:** 00:00 - 08:00 (Orange background)
        *   **London Open:** 07:00 - 16:00 (Blue background)
        *   **New York Open:** 12:00 - 21:00 (Green background)

### 3. Technical Stack
*   **Framework:** React 18+
*   **Charting Engine:** Lightweight Charts v5 (Canvas-based, high performance).
*   **Data Source:** Binance Public API (No API key required).
    *   *Note:* Forex and Gold use stablecoin/tokenized pairs (e.g., PAXG/USDT for Gold) to ensure free, real-time data access without CORS restrictions.

## How to Use

1.  **Select Asset:** Use the sidebar to choose between Crypto, Forex, or Metals.
2.  **Select Timeframe:** Toggle between 5m, 15m, 1h, 4h, or 1D timeframes.
3.  **Toggle Overlays:** Use the checkboxes in the sidebar to show/hide FVGs or Session Killzones.
4.  **Navigation:** The chart supports zooming (mouse wheel), panning (drag), and scaling.

## Troubleshooting
*   **"No Data":** Ensure you have an internet connection. The Binance API may occasionally rate-limit requests if refreshed too quickly.
*   **Chart Scaling:** If the chart looks squashed, double-click the price scale (right axis) to auto-fit the data.
