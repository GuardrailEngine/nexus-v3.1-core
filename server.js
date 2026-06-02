const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/klines', async (req, res) => {
  const { symbol, interval, limit } = req.query;
  try {
    const response = await axios.get(`https://api.binance.com/api/v3/klines`, { params: { symbol, interval, limit } });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ticker', async (req, res) => {
  const { symbol } = req.query;
  try {
    const response = await axios.get(`https://api.binance.com/api/v3/ticker/24hr`, { params: { symbol } });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static('.'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
