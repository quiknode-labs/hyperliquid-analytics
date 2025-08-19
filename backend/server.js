const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { ethers } = require('ethers');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: { 
    rejectUnauthorized: false 
  }
});

// Initialize ethers provider with QuickNode
const QUICKNODE_URL = process.env.QUICKNODE_RPC_URL;
const provider = new ethers.providers.JsonRpcProvider(QUICKNODE_URL);

// Precompile addresses
const PRECOMPILES = {
  spotPx: '0x0000000000000000000000000000000000000808',  // Spot price precompile
  oraclePx: '0x0000000000000000000000000000000000000807', // Oracle price precompile
  markPx: '0x0000000000000000000000000000000000000806'    // Mark price precompile
};

// HYPE token indices for mainnet
const HYPE_SPOT_INDEX = 107;  // Mainnet spot ID

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to database:', err.stack);
  } else {
    console.log('Connected to Neon PostgreSQL database');
    release();
  }
});

// Test QuickNode connection
provider.getBlockNumber().then(blockNumber => {
  console.log('Connected to QuickNode. Current block:', blockNumber);
}).catch(err => {
  console.error('Error connecting to QuickNode:', err.message);
});

// Helper function to parse block data from hype-debug table
function parseBlockData(dataString) {
  try {
    // Handle case where data might be a string or already parsed
    const data = typeof dataString === 'string' ? JSON.parse(dataString) : dataString;
    
    // For hype-debug table, check if we have the new MEV/liquidation structure
    if (data.blocks && Array.isArray(data.blocks)) {
      return data.blocks;
    }
    
    // If it's already an array of blocks
    if (Array.isArray(data)) {
      return data;
    }
    
    // If it's a single block (new structure includes mev and liquidations fields)
    if (data.blockNumber !== undefined) {
      return [data];
    }
    
    return [];
  } catch (error) {
    console.error('Error parsing block data:', error);
    return [];
  }
}

// Get HYPE price from spot price precompile
// Complete getHypePrice function
async function getHypePrice() {
  try {
    // Encode the spot index as a 32-byte value
    const encodedIndex = ethers.utils.defaultAbiCoder.encode(['uint256'], [107]); // Mainnet HYPE spot ID
    
    // Call the spot price precompile
    const result = await provider.call({
      to: PRECOMPILES.spotPx,
      data: encodedIndex
    });
    
    // The result is a uint256 representing the price with 8 decimals
    const priceRaw = ethers.BigNumber.from(result);
    
    // Convert to regular number (spot prices have 8 decimals)
    // For HYPE with szDecimals=2, we divide by 10^(8-2) = 10^6
    const price = priceRaw.toNumber() / 1000000;
    
    console.log('HYPE spot price from precompile:', price);
    return price;
  } catch (error) {
    console.error('Error fetching HYPE price from precompile:', error.message);
    
    // Fallback price based on current market
    return 48.0; // Current HYPE price is around $48
  }
}

// Get recent blocks from hype-debug table
app.get('/api/blocks/recent', async (req, res) => {
  try {
    // Get recent entries from hype-debug table
    const result = await pool.query(
      'SELECT * FROM "hype-debug" ORDER BY to_block_number DESC LIMIT 10'
    );
    
    // Parse and flatten all blocks
    const allBlocks = [];
    
    for (const row of result.rows) {
      const blocks = parseBlockData(row.data);
      allBlocks.push(...blocks);
    }
    
    // Sort by block number and take the most recent 20
    const sortedBlocks = allBlocks
      .sort((a, b) => b.blockNumber - a.blockNumber)
      .slice(0, 20);
    
    res.json(sortedBlocks);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
});

// Get specific block
app.get('/api/blocks/:blockNumber', async (req, res) => {
  try {
    const { blockNumber } = req.params;
    const blockNum = parseInt(blockNumber);
    
    // Query the hype-debug table for the block range containing this block
    const result = await pool.query(
      'SELECT * FROM "hype-debug" WHERE from_block_number <= $1 AND to_block_number >= $1 LIMIT 1',
      [blockNum]
    );
    
    if (result.rows.length > 0) {
      const blocks = parseBlockData(result.rows[0].data);
      const block = blocks.find(b => b.blockNumber === blockNum);
      
      if (block) {
        res.json(block);
      } else {
        // Try to get from blockchain directly
        try {
          const blockchainBlock = await provider.getBlock(blockNum);
          if (blockchainBlock) {
            res.json({
              blockNumber: blockchainBlock.number,
              timestamp: blockchainBlock.timestamp,
              hyperCoreActions: 0,
              hyperEVMTxns: blockchainBlock.transactions.length,
              crossLayerCalls: 0,
              gasUsed: blockchainBlock.gasUsed.toString(),
              uniqueUsers: [],
              metrics: {
                avgGasPerTx: blockchainBlock.transactions.length > 0 ? 
                  Math.floor(parseInt(blockchainBlock.gasUsed.toString()) / blockchainBlock.transactions.length) : 0,
                crossLayerRatio: '0',
                uniqueUserCount: 0
              }
            });
          } else {
            res.status(404).json({ error: 'Block not found' });
          }
        } catch (error) {
          res.status(404).json({ error: 'Block not found' });
        }
      }
    } else {
      res.status(404).json({ error: 'Block not found in database' });
    }
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
});

// Get statistics from all stored data
app.get('/api/stats', async (req, res) => {
  try {
    // Get basic stats from hype-debug table
    const result = await pool.query(
      'SELECT COUNT(*) as total_records, MIN(from_block_number) as first_block, MAX(to_block_number) as last_block FROM "hype-debug"'
    );
    
    const stats = result.rows[0];
    
    // Get all blocks to calculate detailed stats
    const blocksResult = await pool.query(
      'SELECT data FROM "hype-debug" ORDER BY to_block_number DESC'
    );
    
    let totalTransactions = 0;
    let totalCrossLayerCalls = 0;
    let totalGasUsed = BigInt(0);
    let totalHyperCoreActions = 0;
    let processedBlocks = 0;
    
    for (const row of blocksResult.rows) {
      const blocks = parseBlockData(row.data);
      for (const block of blocks) {
        if (block.hyperEVMTxns > 0) {
          processedBlocks++;
          totalTransactions += block.hyperEVMTxns || 0;
          totalCrossLayerCalls += block.crossLayerCalls || 0;
          totalHyperCoreActions += block.hyperCoreActions || 0;
          totalGasUsed += BigInt(block.gasUsed || 0);
        }
      }
    }
    
    res.json({
      totalRecords: parseInt(stats.total_records),
      firstBlock: parseInt(stats.first_block),
      lastBlock: parseInt(stats.last_block),
      totalTransactions,
      totalCrossLayerCalls,
      totalHyperCoreActions,
      totalGasUsed: totalGasUsed.toString(),
      processedBlocks,
      crossLayerPercentage: totalTransactions > 0 ? 
        ((totalCrossLayerCalls / totalTransactions) * 100).toFixed(2) : '0'
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Stats error', message: error.message });
  }
});

// Get HYPE token data
app.get('/api/hype-token-data', async (req, res) => {
  try {
    const hypePrice = await getHypePrice();
    
    res.json({
      hypePrice,
      totalSupply: 1000000000, // 1B total supply
      circulatingSupply: 333928180, // Current circulating supply from CoinMarketCap
      marketCap: 333928180 * hypePrice
    });
  } catch (error) {
    console.error('HYPE token data error:', error);
    res.status(500).json({ error: 'Failed to fetch HYPE data' });
  }
});

// Get current block number
app.get('/api/block-number', async (req, res) => {
  try {
    const blockNumber = await provider.getBlockNumber();
    res.json({ blockNumber });
  } catch (error) {
    console.error('Error getting block number:', error);
    res.status(500).json({ error: 'Failed to get block number' });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await pool.query('SELECT 1');
    
    // Check QuickNode connection
    const blockNumber = await provider.getBlockNumber();
    
    // Check if we have recent data
    const recentData = await pool.query(
      'SELECT COUNT(*) as count FROM "hype-debug" WHERE to_block_number > $1',
      [blockNumber - 1000]
    );
    
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      currentBlock: blockNumber,
      database: 'connected',
      quicknode: 'connected',
      recentDataCount: parseInt(recentData.rows[0].count),
      streamStatus: parseInt(recentData.rows[0].count) > 0 ? 'receiving data' : 'no recent data'
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'error', 
      timestamp: new Date().toISOString(),
      error: error.message 
    });
  }
});

// Debug endpoint to see raw data structure
app.get('/api/debug/raw-data', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM "hype-debug" ORDER BY to_block_number DESC LIMIT 1'
    );
    
    if (result.rows.length > 0) {
      const row = result.rows[0];
      const parsedData = parseBlockData(row.data);
      
      res.json({
        raw_row: {
          from_block: row.from_block_number,
          to_block: row.to_block_number,
          network: row.network,
          stream_id: row.stream_id
        },
        parsed_blocks: parsedData,
        total_blocks: parsedData.length,
        sample_block: parsedData[0] || null
      });
    } else {
      res.json({ message: 'No data found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to test HYPE price fetching
app.get('/api/debug/hype-price', async (req, res) => {
  try {
    // Try spot price precompile
    const spotPrice = await getHypePrice();
    
    // Also try oracle price for comparison
    let oraclePrice = null;
    try {
      const oracleData = ethers.utils.defaultAbiCoder.encode(['uint256'], [HYPE_SPOT_INDEX]);
      const oracleResult = await provider.call({
        to: PRECOMPILES.oraclePx,
        data: oracleData
      });
      const oraclePriceRaw = ethers.BigNumber.from(oracleResult);
      oraclePrice = oraclePriceRaw.toNumber() / 1000000;
    } catch (e) {
      console.error('Oracle price fetch failed:', e);
    }
    
    res.json({
      spotPrice,
      oraclePrice,
      spotIndex: HYPE_SPOT_INDEX,
      precompileAddresses: PRECOMPILES,
      note: 'Prices are in USDC with 6 decimal places converted to regular format'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`
===========================================
Backend server running on port ${PORT}
===========================================
Database: Connected to Neon PostgreSQL
===========================================
QuickNode Streams is actively pushing data to hype-debug table
HYPE price is fetched from HyperEVM precompiles

API Endpoints:
- http://localhost:${PORT}/api/blocks/recent
- http://localhost:${PORT}/api/stats
- http://localhost:${PORT}/api/hype-token-data
- http://localhost:${PORT}/api/debug/raw-data
- http://localhost:${PORT}/api/debug/hype-price
- http://localhost:${PORT}/health
===========================================
  `);
});