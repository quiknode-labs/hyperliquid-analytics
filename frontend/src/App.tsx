import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import { 
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import './styles.css';

// Backend API URL
const API_URL = 'http://localhost:3001';

// Types
interface MEVPattern {
  type: string;
  address?: string;
  swapCount?: number;
  attacker?: string;
  victim?: string;
  frontTx?: string;
  backTx?: string;
  victimTx?: string;
  arbitrageur?: string;
  transactions?: string[];
  txHash?: string;
}

interface BlockData {
  blockNumber: number;
  timestamp: number;
  hyperCoreActions: number;
  hyperEVMTxns: number;
  crossLayerCalls: number;
  gasUsed: string;
  uniqueUsers: string[];
  metrics?: {
    avgGasPerTx: number;
    crossLayerRatio: string;
    uniqueUserCount: number;
    mevRate?: string;
    liquidationRate?: string;
  };
  summary?: {
    totalTxns: number;
    failedTxns: number;
    oracleReads: number;
    coreActions: number;
    mevTransactions?: number;
    liquidationTransactions?: number;
    highActivityAddresses?: string[];
  };
  mev?: {
    detected: boolean;
    patterns: MEVPattern[];
    suspiciousAddresses: string[];
    totalExtractedValue: string;
  };
  liquidations?: {
    count: number;
    totalValue: string;
    liquidators: any;
    topLiquidations?: any[];
  };
}

interface HypeTokenData {
  hypePrice: number;
  totalSupply: number;
  circulatingSupply: number;
  marketCap: number;
}

interface Stats {
  totalRecords: number;
  firstBlock: number;
  lastBlock: number;
  totalTransactions: number;
  totalCrossLayerCalls: number;
  totalGasUsed: string;
}

const App: React.FC = () => {
  const [blockSearch, setBlockSearch] = useState('');
  const [searchResult, setSearchResult] = useState<BlockData | null>(null);
  const [recentBlocks, setRecentBlocks] = useState<BlockData[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamStatus, setStreamStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentBlock, setCurrentBlock] = useState<number | null>(null);
  
  // HYPE token states
  const [hypeData, setHypeData] = useState<HypeTokenData | null>(null);
  const [hypePriceHistory, setHypePriceHistory] = useState<{time: string, price: number}[]>([]);

  // Fetch HYPE token data
  const fetchHypeData = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/api/hype-token-data`);
      setHypeData(response.data);
      
      // Add to price history
      setHypePriceHistory(prev => [...prev, {
        time: format(new Date(), 'HH:mm:ss'),
        price: response.data.hypePrice
      }].slice(-30)); // Keep last 30 data points
    } catch (error) {
      console.error('Error fetching HYPE data:', error);
    }
  }, []);

  // Fetch stream data from backend
  const fetchStreamData = useCallback(async () => {
    try {
      setError(null);
      const response = await axios.get(`${API_URL}/api/blocks/recent`);
      
      if (response.data && Array.isArray(response.data)) {
        setRecentBlocks(response.data);
        setStreamStatus('connected');
      }
    } catch (error) {
      console.error('Error fetching stream data:', error);
      setError('Unable to fetch data from server. Make sure the backend is running on port 3001.');
      setStreamStatus('disconnected');
    }
  }, []);

  // Fetch statistics
  const fetchStats = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/api/stats`);
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  }, []);

  // Fetch current block number
  const fetchCurrentBlock = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/api/block-number`);
      setCurrentBlock(response.data.blockNumber);
    } catch (error) {
      console.error('Error fetching current block:', error);
    }
  }, []);

  // Search block
  const searchBlock = async () => {
    if (!blockSearch) {
      setSearchResult(null);
      return;
    }
    
    setLoading(true);
    
    try {
      const blockNum = parseInt(blockSearch);
      
      // First check in recent blocks
      const found = recentBlocks.find(b => b.blockNumber === blockNum);
      if (found) {
        setSearchResult(found);
      } else {
        // Try to fetch from backend
        try {
          const response = await axios.get(`${API_URL}/api/blocks/${blockNum}`);
          setSearchResult(response.data);
        } catch (err: any) {
          if (err.response?.status === 404) {
            alert('Block not found');
          } else {
            alert('Error searching block');
          }
        }
      }
    } catch (error) {
      console.error('Error searching block:', error);
      alert('Invalid block number');
    } finally {
      setLoading(false);
    }
  };

  // Check backend health
  const checkBackendHealth = async () => {
    try {
      const response = await axios.get(`${API_URL}/health`);
      if (response.data.status === 'ok') {
        setStreamStatus('connected');
        setError(null);
      }
    } catch (error) {
      setStreamStatus('disconnected');
      setError('Backend disconnected. Please check if the server is running.');
    }
  };

  // Initial data fetch
  useEffect(() => {
    checkBackendHealth();
    fetchStreamData();
    fetchStats();
    fetchHypeData();
    fetchCurrentBlock();

    // Set up polling
    const dataInterval = setInterval(() => {
      fetchStreamData();
      fetchStats();
      fetchCurrentBlock();
    }, 10000); // Every 10 seconds
    
    const hypeInterval = setInterval(fetchHypeData, 5000); // Update HYPE data every 5 seconds
    const healthInterval = setInterval(checkBackendHealth, 30000); // Every 30 seconds

    return () => {
      clearInterval(dataInterval);
      clearInterval(hypeInterval);
      clearInterval(healthInterval);
    };
  }, [fetchStreamData, fetchStats, fetchHypeData, fetchCurrentBlock]);

  // Calculate total stats from recent blocks if stats API fails
  const totalStats = stats || recentBlocks.reduce((acc, block) => ({
    totalRecords: recentBlocks.length,
    firstBlock: Math.min(acc.firstBlock || Infinity, block.blockNumber),
    lastBlock: Math.max(acc.lastBlock || 0, block.blockNumber),
    totalTransactions: acc.totalTransactions + block.hyperEVMTxns,
    totalCrossLayerCalls: acc.totalCrossLayerCalls + block.crossLayerCalls,
    totalGasUsed: (BigInt(acc.totalGasUsed || '0') + BigInt(block.gasUsed)).toString()
  }), {
    totalRecords: 0,
    firstBlock: 0,
    lastBlock: 0,
    totalTransactions: 0,
    totalCrossLayerCalls: 0,
    totalGasUsed: '0'
  } as Stats);

  // Prepare chart data
  const activityChartData = recentBlocks.slice(0, 10).reverse().map(block => ({
    block: block.blockNumber,
    'HyperCore': block.hyperCoreActions,
    'HyperEVM': block.hyperEVMTxns,
    'Cross-Layer': block.crossLayerCalls
  }));

  const pieData = [
    { name: 'Cross-Layer Calls', value: totalStats.totalCrossLayerCalls, color: '#c4b5fd' },
    { name: 'Regular Txns', value: totalStats.totalTransactions - totalStats.totalCrossLayerCalls, color: '#93c5fd' }
  ];

  // Custom Y-axis tick formatter for price chart
  const formatPriceTick = (value: number) => {
    return `$${value.toFixed(2)}`;
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <div>
            <h1 className="gradient-text">HyperCore ↔ HyperEVM Analytics</h1>
            <p className="subtitle">Powered by QuickNode Streams</p>
          </div>
          <div className="header-right">
            <div className={`status-badge ${streamStatus}`}>
              <div className="status-dot" />
              <span>Stream: {streamStatus}</span>
            </div>
            {currentBlock && (
              <div className="current-block">
                Block: #{currentBlock.toLocaleString()}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Error Notice */}
      {error && (
        <div className="error-notice glass-card">
          <p>⚠️ {error}</p>
        </div>
      )}

      {/* HYPE Token Section */}
      <section className="hype-section">
        <div className="glass-card">
          <h2 className="section-title">HYPE Token Metrics</h2>
          {hypeData && (
            <div className="hype-metrics">
              <div className="hype-stat">
                <span className="label">HYPE Price</span>
                <span className="value">${hypeData.hypePrice.toFixed(2)}</span>
              </div>
              <div className="hype-stat">
                <span className="label">Market Cap</span>
                <span className="value">${(hypeData.marketCap / 1e9).toFixed(2)}B</span>
              </div>
              <div className="hype-stat">
                <span className="label">Circulating Supply</span>
                <span className="value">{(hypeData.circulatingSupply / 1e6).toFixed(0)}M</span>
              </div>
              <div className="hype-stat">
                <span className="label">Total Supply</span>
                <span className="value">{(hypeData.totalSupply / 1e9).toFixed(1)}B</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* HYPE Price Chart - Now full width */}
      <section className="price-chart-section">
        <div className="glass-card">
          <h3>HYPE Token Price History</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={hypePriceHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2b2f" />
              <XAxis 
                dataKey="time" 
                stroke="#666"
              />
              <YAxis 
                stroke="#666" 
                domain={['dataMin - 0.1', 'dataMax + 0.1']}
                tickFormatter={formatPriceTick}
              />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1a1b1e', border: '1px solid #2a2b2f' }}
                formatter={(value: any) => `$${value.toFixed(2)}`}
              />
              <Line 
                type="monotone" 
                dataKey="price" 
                stroke="#c4b5fd" 
                strokeWidth={2}
                dot={false}
                name="HYPE"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Stats Overview */}
      <section className="stats-section">
        <div className="stats-grid">
          <div className="stat-card glass-card">
            <div className="stat-label">Total Blocks</div>
            <div className="stat-value">{totalStats.totalRecords.toLocaleString()}</div>
          </div>
          <div className="stat-card glass-card">
            <div className="stat-label">Total Transactions</div>
            <div className="stat-value">{totalStats.totalTransactions.toLocaleString()}</div>
          </div>
          <div className="stat-card glass-card">
            <div className="stat-label">Cross-Layer Calls</div>
            <div className="stat-value">{totalStats.totalCrossLayerCalls.toLocaleString()}</div>
          </div>
          <div className="stat-card glass-card">
            <div className="stat-label">Total Gas Used</div>
            <div className="stat-value">{(parseInt(totalStats.totalGasUsed) / 1e9).toFixed(2)} Gwei</div>
          </div>
        </div>
      </section>

      {/* Search Section */}
      <section className="search-section">
        <div className="search-container glass-card">
          <h2>Block Explorer</h2>
          <div className="search-input-group">
            <input
              type="text"
              placeholder="Search block number..."
              value={blockSearch}
              onChange={(e) => setBlockSearch(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && searchBlock()}
              className="search-input"
            />
            <button 
              onClick={searchBlock} 
              disabled={loading}
              className="search-button"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>
      </section>

      {/* Search Results - Only show when there's a result */}
      {searchResult && blockSearch && (
        <section className="search-results">
          <div className="glass-card">
            <h3>Block #{searchResult.blockNumber}</h3>
            <div className="metrics-grid">
              <div className="metric-card pastel-purple">
                <div className="metric-label">HyperCore Actions</div>
                <div className="metric-value">{searchResult.hyperCoreActions}</div>
              </div>
              <div className="metric-card pastel-blue">
                <div className="metric-label">HyperEVM Txns</div>
                <div className="metric-value">{searchResult.hyperEVMTxns}</div>
              </div>
              <div className="metric-card pastel-green">
                <div className="metric-label">Cross-Layer Calls</div>
                <div className="metric-value">{searchResult.crossLayerCalls}</div>
              </div>
              <div className="metric-card pastel-yellow">
                <div className="metric-label">Gas Used</div>
                <div className="metric-value">{(parseInt(searchResult.gasUsed) / 1e9).toFixed(3)} Gwei</div>
              </div>
            </div>

            <div className="cross-layer-details">
              <h4>Additional Metrics</h4>
              <div className="detail-row">
                <span>Block Timestamp:</span>
                <span>{format(new Date(searchResult.timestamp * 1000), 'MMM dd, yyyy HH:mm:ss')}</span>
              </div>
              {searchResult.metrics && (
                <>
                  <div className="detail-row">
                    <span>Avg Gas per Tx:</span>
                    <span>{searchResult.metrics.avgGasPerTx.toLocaleString()} wei</span>
                  </div>
                  <div className="detail-row">
                    <span>Cross-Layer Ratio:</span>
                    <span>{(parseFloat(searchResult.metrics.crossLayerRatio) * 100).toFixed(0)}%</span>
                  </div>
                  <div className="detail-row">
                    <span>Unique Users:</span>
                    <span>{searchResult.metrics.uniqueUserCount}</span>
                  </div>
                  {searchResult.metrics.mevRate && (
                    <div className="detail-row">
                      <span>MEV Rate:</span>
                      <span>{(parseFloat(searchResult.metrics.mevRate) * 100).toFixed(1)}%</span>
                    </div>
                  )}
                  {searchResult.metrics.liquidationRate && (
                    <div className="detail-row">
                      <span>Liquidation Rate:</span>
                      <span>{(parseFloat(searchResult.metrics.liquidationRate) * 100).toFixed(1)}%</span>
                    </div>
                  )}
                </>
              )}
              {searchResult.summary && (
                <>
                  <div className="detail-row">
                    <span>Failed Transactions:</span>
                    <span>{searchResult.summary.failedTxns} / {searchResult.summary.totalTxns}</span>
                  </div>
                  <div className="detail-row">
                    <span>Oracle Reads:</span>
                    <span>{searchResult.summary.oracleReads}</span>
                  </div>
                  <div className="detail-row">
                    <span>Core Actions:</span>
                    <span>{searchResult.summary.coreActions}</span>
                  </div>
                  {searchResult.summary.mevTransactions !== undefined && searchResult.summary.mevTransactions > 0 && (
                    <div className="detail-row">
                      <span>MEV Transactions:</span>
                      <span className="badge badge-active">{searchResult.summary.mevTransactions}</span>
                    </div>
                  )}
                  {searchResult.summary.liquidationTransactions !== undefined && searchResult.summary.liquidationTransactions > 0 && (
                    <div className="detail-row">
                      <span>Liquidation Transactions:</span>
                      <span className="badge badge-active">{searchResult.summary.liquidationTransactions}</span>
                    </div>
                  )}
                </>
              )}
              
              {/* MEV Section - High Swap Activity */}
              {searchResult.mev && searchResult.mev.detected && (
                <div className="mev-section">
                  <h4>High Swap Activity Detected</h4>
                  
                  {/* Group patterns by type */}
                  {(() => {
                    const patternsByType = searchResult.mev.patterns.reduce((acc, pattern) => {
                      if (!acc[pattern.type]) acc[pattern.type] = [];
                      acc[pattern.type].push(pattern);
                      return acc;
                    }, {} as Record<string, MEVPattern[]>);

                    return Object.entries(patternsByType).map(([type, patterns]) => (
                      <div key={type} className="pattern-group">
                        {type === 'high_swap_activity' && (
                          <>
                            <div className="pattern-type-header">
                              <span className="pattern-type">High Swap Activity</span>
                              <span className="pattern-count">({patterns.length} addresses)</span>
                            </div>
                            <div className="pattern-addresses">
                              {patterns.map((pattern: MEVPattern, idx: number) => (
                                <div key={idx} className="address-item">
                                  <span className="address-label">#{idx + 1}</span>
                                  <span className="address full-address">{pattern.address || 'Unknown'}</span>
                                  <span className="swap-count">{pattern.swapCount} swaps</span>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                        
                        {type === 'sandwich_attack' && (
                          <>
                            <div className="pattern-type-header">
                              <span className="pattern-type">Sandwich Attacks</span>
                              <span className="pattern-count">({patterns.length})</span>
                            </div>
                            {patterns.map((pattern: MEVPattern, idx: number) => (
                              <div key={idx} className="pattern-details">
                                <div className="pattern-detail-row">
                                  <span className="detail-label">Attacker:</span>
                                  <span className="address full-address">{pattern.attacker || 'Unknown'}</span>
                                </div>
                                <div className="pattern-detail-row">
                                  <span className="detail-label">Victim:</span>
                                  <span className="address full-address">{pattern.victim || 'Unknown'}</span>
                                </div>
                                <div className="tx-details">
                                  <span>Front: {pattern.frontTx?.slice(0, 10)}...</span>
                                  <span>Back: {pattern.backTx?.slice(0, 10)}...</span>
                                </div>
                              </div>
                            ))}
                          </>
                        )}
                        
                        {type === 'arbitrage' && (
                          <>
                            <div className="pattern-type-header">
                              <span className="pattern-type">Arbitrage</span>
                              <span className="pattern-count">({patterns.length})</span>
                            </div>
                            {patterns.map((pattern: MEVPattern, idx: number) => (
                              <div key={idx} className="pattern-details">
                                <div className="pattern-detail-row">
                                  <span className="detail-label">Arbitrageur:</span>
                                  <span className="address full-address">{pattern.arbitrageur || 'Unknown'}</span>
                                </div>
                                <div className="pattern-detail-row">
                                  <span className="detail-label">Swaps:</span>
                                  <span>{pattern.swapCount}</span>
                                </div>
                                <div className="tx-list">
                                  Txs: {pattern.transactions?.slice(0, 2).map((tx: string) => tx.slice(0, 10) + '...').join(', ')}
                                  {pattern.transactions && pattern.transactions.length > 2 && ` +${pattern.transactions.length - 2} more`}
                                </div>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    ));
                  })()}
                </div>
              )}

              {/* Liquidations Section */}
              {searchResult.liquidations && searchResult.liquidations.count > 0 && (
                <div className="liquidations-section">
                  <h4>Liquidation Activity</h4>
                  <div className="detail-row">
                    <span>Total Liquidations:</span>
                    <span>{searchResult.liquidations.count}</span>
                  </div>
                  <div className="detail-row">
                    <span>Total Value:</span>
                    <span>{(BigInt(searchResult.liquidations.totalValue) / BigInt(1e18)).toString()} ETH</span>
                  </div>
                  {searchResult.liquidations.topLiquidations && searchResult.liquidations.topLiquidations.length > 0 && (
                    <>
                      <h5>Top Liquidations:</h5>
                      {searchResult.liquidations.topLiquidations.slice(0, 3).map((liq, index) => (
                        <div key={index} className="liquidation-item">
                          <span>#{index + 1}: {(BigInt(liq.value) / BigInt(1e18)).toString()} ETH</span>
                          <span className="tx-hash">{liq.txHash.slice(0, 10)}...</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Charts Section */}
      <section className="charts-section">
        <div className="charts-grid">
          {/* Cross-Layer Activity Breakdown */}
          <div className="glass-card chart-container">
            <h3>Cross-Layer Activity Breakdown</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) => `${entry.name}: ${entry.value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Recent Cross-Layer Activity */}
          <div className="glass-card chart-container">
            <h3>Recent Cross-Layer Activity</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={activityChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2b2f" />
                <XAxis dataKey="block" stroke="#666" />
                <YAxis stroke="#666" />
                <Tooltip contentStyle={{ backgroundColor: '#1a1b1e', border: '1px solid #2a2b2f' }} />
                <Bar dataKey="HyperCore" fill="#c4b5fd" />
                <Bar dataKey="HyperEVM" fill="#93c5fd" />
                <Bar dataKey="Cross-Layer" fill="#86efac" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Recent Blocks Table */}
      <section className="table-section">
        <div className="glass-card">
          <h3>Recent Blocks</h3>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Block</th>
                  <th>Timestamp</th>
                  <th>HyperCore</th>
                  <th>HyperEVM</th>
                  <th>Cross-Layer</th>
                  <th>Gas Used</th>
                  <th>MEV</th>
                  <th>Liquidations</th>
                </tr>
              </thead>
              <tbody>
                {recentBlocks.slice(0, 10).map((block) => (
                  <tr key={block.blockNumber}>
                    <td>{block.blockNumber}</td>
                    <td>{format(new Date(block.timestamp * 1000), 'HH:mm:ss')}</td>
                    <td>{block.hyperCoreActions}</td>
                    <td>{block.hyperEVMTxns}</td>
                    <td>
                      <span className={`badge ${block.crossLayerCalls > 0 ? 'badge-active' : ''}`}>
                        {block.crossLayerCalls}
                      </span>
                    </td>
                    <td>{(parseInt(block.gasUsed) / 1e6).toFixed(2)}M</td>
                    <td>
                      {block.mev && block.mev.detected ? (
                        <span className="badge badge-mev">{block.mev.patterns.length}</span>
                      ) : (
                        <span className="badge">0</span>
                      )}
                    </td>
                    <td>
                      {block.liquidations && block.liquidations.count > 0 ? (
                        <span className="badge badge-liquidation">{block.liquidations.count}</span>
                      ) : (
                        <span className="badge">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Info Section */}
      <section className="info-section">
        <div className="glass-card info-card">
          <h3>How It Works</h3>
          <div className="info-grid">
            <div className="info-item">
              <div className="info-icon">📊</div>
              <h4>QuickNode Streams</h4>
              <p>Real-time monitoring of HyperEVM blocks with custom filters to identify cross-layer interactions</p>
            </div>
            <div className="info-item">
              <div className="info-icon">🔗</div>
              <h4>Cross-Layer Detection</h4>
              <p>Identifies CoreWriter calls and precompile reads that bridge HyperCore and HyperEVM</p>
            </div>
            <div className="info-item">
              <div className="info-icon">💾</div>
              <h4>Neon PostgreSQL</h4>
              <p>Stream data is automatically stored in your Neon database for historical analysis</p>
            </div>
            <div className="info-item">
              <div className="info-icon">⚡</div>
              <h4>Oracle Precompiles</h4>
              <p>HYPE token prices fetched directly from HyperEVM oracle precompiles via QuickNode RPC</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default App;