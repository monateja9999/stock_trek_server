const express = require("express");
const cors = require("cors");
const { DateTime } = require("luxon");
const { MongoClient } = require("mongodb");
const app = express();

// Import dotenv
const dotenv = require('dotenv');

// Load .env file from the root directory
dotenv.config({ path: './.env' });

const API_KEY = process.env.API_KEY;
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
const CONNECTION_STRING = process.env.CONNECTION_STRING;
const DATABASE_NAME = process.env.DATABASE_NAME;

app.set('trust proxy', true);
app.use(cors());
app.use(express.json());


let database;

MongoClient.connect(CONNECTION_STRING, (error, client) => {
  if (error) {
    console.error("MongoDB connection error:", error);
    return;
  }
  database = client.db(DATABASE_NAME);
  console.log("MongoDB Connection Successful");
});


// Define route for the root URL
app.get('/', function (req, res) {
  res.send('Hello, Mona!');
});


app.get("/watchlist", (req, res) => {
  const watchlistCollection = database.collection("watchlist");
  watchlistCollection.find({}).toArray((err, result) => {
    if (err) {
      console.error("Error fetching watchlist items:", err);
      res.status(500).send("Internal Server Error");
      return;
    }
    res.json(result);
  });
});

app.post("/watchlist", async (req, res) => {
  try {
    const { companyTicker, companyName, query } = req.body;
    const watchlistCollection = database.collection("watchlist");
    const newItem = { companyTicker, companyName, query };
    await watchlistCollection.insertOne(newItem);
    res.status(201).json({ message: "Item added to watchlist successfully", newItem });
  } catch (error) {
    console.error("Error adding item to watchlist:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.delete("/watchlist/:companyTicker", async (req, res) => {
  try {
    const companyTicker = req.params.companyTicker;
    const watchlistCollection = database.collection("watchlist");
    const result = await watchlistCollection.deleteOne({ companyTicker: companyTicker });
    if (result.deletedCount === 0) {
      res.status(404).json({ message: "Item not found in watchlist" });
      return;
    }
    res.json({ message: "Item deleted from watchlist successfully" });
  } catch (error) {
    console.error("Error deleting item from watchlist:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/wallet", (req, res) => {
  const walletCollection = database.collection("wallet");
  walletCollection.find({}).toArray((err, result) => {
    if (err) {
      console.error("Error fetching wallet data:", err);
      res.status(500).send("Internal Server Error");
      return;
    }
    res.json(result);
  });
});

app.get("/portfolio", (req, res) => {
  const portfolioCollection = database.collection("portfolio");
  portfolioCollection.find({}).toArray((err, result) => {
    if (err) {
      console.error("Error fetching portfolio data:", err);
      res.status(500).send("Internal Server Error");
      return;
    }
    res.json(result);
  });
});

app.post("/purchase", async (req, res) => {
  try {
    const { companyTicker, companyName, quantity, currentPrice, query } = req.body;
    const portfolioCollection = database.collection("portfolio");
    const walletCollection = database.collection("wallet");

    // Find the document in the portfolio collection that matches the companyTicker
    const portfolioItem = await portfolioCollection.findOne({ companyTicker });

    // Check if the portfolio item exists
    if (!portfolioItem) {
      // If the companyTicker is not found in the portfolio, create a new portfolio item
      const newPortfolioItem = {
        companyTicker,
        companyName,
        quantity: quantity.toFixed(2),
        totalCost: (parseFloat(quantity) * parseFloat(currentPrice)).toFixed(2),
        query: query
      };

      // Add the query field if it exists in the request body
      if (req.body.query) {
        newPortfolioItem.query = req.body.query;
      }

      // Insert the new portfolio item
      await portfolioCollection.insertOne(newPortfolioItem);

      // Calculate the new wallet balance after the purchase
      const walletItem = await walletCollection.findOne({});
      if (!walletItem) {
        return res.status(404).json({ message: "Wallet not found" });
      }

      const currentBalance = parseFloat(walletItem.balance);
      const purchaseAmount = parseFloat(quantity) * parseFloat(currentPrice);
      const newBalance = currentBalance - purchaseAmount;

      // Update the document in the wallet collection with the new balance
      await walletCollection.updateOne(
        {},
        { $set: { balance: newBalance.toFixed(2) } }
      );

      // Send a success response to the client
      return res.status(200).json({ message: "New stock added to Portfolio" });
    }

    // Update the quantity and totalCost based on the user's purchase
    const newCompanyTicker = portfolioItem.companyTicker;
    const newCompanyName = portfolioItem.companyName;
    const newQuantity = parseFloat(portfolioItem.quantity) + parseFloat(quantity);
    const newTotalCost = parseFloat(portfolioItem.totalCost) + (parseFloat(quantity) * parseFloat(currentPrice));
    const newQuery = portfolioItem.query;

    // Update the document in the portfolio collection with the new quantity and totalCost
    await portfolioCollection.updateOne(
      { companyTicker },
      { $set: { companyName: newCompanyName, quantity: newQuantity.toFixed(2), totalCost: newTotalCost.toFixed(2), query: newQuery } },
    );

    // Calculate the new wallet balance after the purchase
    const walletItem = await walletCollection.findOne({});
    if (!walletItem) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    const currentBalance = parseFloat(walletItem.balance);
    const purchaseAmount = parseFloat(quantity) * parseFloat(currentPrice);
    const newBalance = currentBalance - purchaseAmount;

    // Update the document in the wallet collection with the new balance
    await walletCollection.updateOne(
      {},
      { $set: { balance: newBalance.toFixed(2) } }
    );

    // Send a success response to the client
    res.status(200).json({ message: "Purchase successful" });
  } catch (error) {
    console.error("Error purchasing:", error);
    // Send an error response to the client if any issues occur during the purchase process
    res.status(500).json({ error: "Internal server error" });
  }
});


app.post("/sell", async (req, res) => {
  try {
    const { companyTicker, quantity, currentPrice } = req.body;
    const portfolioCollection = database.collection("portfolio");
    const walletCollection = database.collection("wallet");

    // Find the document in the portfolio collection that matches the companyTicker
    const portfolioItem = await portfolioCollection.findOne({ companyTicker });

    if (!portfolioItem) {
      // If the companyTicker is not found in the portfolio, return an error
      return res.status(404).json({ message: "Company ticker not found in portfolio" });
    }

    // Check if the quantity to sell exceeds the owned quantity
    const ownedQuantity = parseFloat(portfolioItem.quantity);
    const ownedQuantityTotalCost = parseFloat(portfolioItem.totalCost)

    if (parseFloat(quantity) > ownedQuantity) {
      // If the quantity to sell exceeds the owned quantity, return an error
      return res.status(400).json({ message: "Cannot sell more stocks than owned" });
    }

    // Calculate the average cost per unit in the portfolio
    const ownedAverageCostPerUnit = ownedQuantityTotalCost / ownedQuantity;

    // Calculate the new total cost after selling the specified quantity
    const newTotalCost = ownedQuantityTotalCost - (ownedAverageCostPerUnit * parseFloat(quantity));

    // Update the new quantity based on the user's sell
    const newQuantity = ownedQuantity - parseFloat(quantity);


    if (newQuantity <= 0) {
      // If the new quantity becomes 0 or negative after selling, delete the document from the portfolio collection
      await portfolioCollection.deleteOne({ companyTicker });
    } else {
      // Update the document in the portfolio collection with the new quantity and totalCost
      await portfolioCollection.updateOne(
        { companyTicker },
        { $set: { quantity: newQuantity.toFixed(2), totalCost: newTotalCost.toFixed(2) } }
      );
    }

    // Calculate the new wallet balance after the sell
    const walletItem = await walletCollection.findOne({});
    if (!walletItem) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    const currentBalance = parseFloat(walletItem.balance);
    const sellAmount = parseFloat(quantity) * parseFloat(currentPrice);
    const newBalance = currentBalance + sellAmount;

    // Update the document in the wallet collection with the new balance
    await walletCollection.updateOne(
      {},
      { $set: { balance: newBalance.toFixed(2) } }
    );

    // Send a success response to the client
    res.status(200).json({ message: "Sell successful" });
  } catch (error) {
    console.error("Error selling:", error);
    // Send an error response to the client if any issues occur during the sell process
    res.status(500).json({ error: "Internal server error" });
  }
});


app.get("/company", async (req, res) => {
  const { searchQuery } = req.query;

  try {

    const response = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${searchQuery}&token=${API_KEY}`);
    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.error("Error fetching Company Profile:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/quote", async (req, res) => {
  const { searchQuery } = req.query;

  try {

    const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${searchQuery}&token=${API_KEY}`);
    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.error("Error fetching Stock Summary", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/topNews", async (req, res) => {
  const { searchQuery } = req.query;

  try {
    const todayDate = DateTime.now().toISODate();
    const previousDate = DateTime.now().minus({ days: 30 }).toISODate();
    const response = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${searchQuery}&from=${previousDate}&to=${todayDate}&token=${API_KEY}`);
    const data = await response.json();

    const filteredNews = data.filter(article => (
      article.image !== null && article.image.trim() !== "" &&
      article.url !== null && article.url.trim() !== "" &&
      article.headline !== null && article.headline.trim() !== ""
    ));

    const sortedNews = filteredNews.sort((a, b) => b.datetime - a.datetime);

    const latestNews = sortedNews.slice(0, 20);

    res.json(latestNews);
  } catch (error) {
    console.error("Error fetching Top News", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/peers", async (req, res) => {
  const { searchQuery } = req.query;

  try {

    const response = await fetch(`https://finnhub.io/api/v1/stock/peers?symbol=${searchQuery}&token=${API_KEY}`);
    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.error("Error fetching Peers Data", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/autocomplete", async (req, res) => {
  const { searchQuery } = req.query;

  try {

    const response = await fetch(`https://finnhub.io/api/v1/search?q=${searchQuery}&token=${API_KEY}`);
    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.error("Error fetching Autocomplete Data", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


app.get("/insidersData", async (req, res) => {
  const { searchQuery } = req.query;

  try {
    // const todayDate = DateTime.now().toISODate();

    const response = await fetch(`https://finnhub.io/api/v1/stock/insider-sentiment?symbol=${searchQuery}&token=${API_KEY}`);
    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.error("Error fetching Company Insiders Data", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/historicalEPSData", async (req, res) => {
  const { searchQuery } = req.query;

  try {

    const response = await fetch(`https://finnhub.io/api/v1/stock/earnings?symbol=${searchQuery}&token=${API_KEY}`)
    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.error("Error fetching Historical EPS Data", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/recommendationTrendsData", async (req, res) => {
  const { searchQuery } = req.query;

  try {

    const response = await fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${searchQuery}&token=${API_KEY}`);
    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.error("Error fetching Recommendation Trends Data", error);
    res.status(500).json({ error: "Internal server error" });
  }
});



app.get("/chartsData", async (req, res) => {
  const { searchQuery } = req.query;
  const todayDate = DateTime.now().toISODate();
  const previousDate = DateTime.now().minus({ years: 2 }).toISODate();

  try {

    const response = await fetch(`https://api.polygon.io/v2/aggs/ticker/${searchQuery}/range/1/day/${previousDate}/${todayDate}?adjusted=true&sort=asc&apiKey=${POLYGON_API_KEY}`);
    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.error("Error fetching Charts Data", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/dayChartsData", async (req, res) => {
  const { searchQuery, fetchDate } = req.query;

  // Convert Unix timestamp to Luxon DateTime object
  const toDate = DateTime.fromMillis(fetchDate * 1000).toISODate(); // Multiply by 1000 to convert seconds to milliseconds

  // Calculate fromDate based on the day of the week
  let fromDate;
  const toDateObj = DateTime.fromMillis(fetchDate * 1000);

  if (toDateObj.weekday === 1) {
    // If toDate is Monday, set fromDate to the previous week's Friday
    fromDate = toDateObj.minus({ days: 3 }).toISODate();
  } else {
    // Otherwise, subtract 1 day from toDate
    fromDate = toDateObj.minus({ days: 1 }).toISODate();
  }

  console.log("From Date:", fromDate);
  console.log("To Date:", toDate);


  try {

    const response = await fetch(`https://api.polygon.io/v2/aggs/ticker/${searchQuery}/range/1/hour/${fromDate}/${toDate}?adjusted=true&sort=asc&apiKey=${POLYGON_API_KEY}`);
    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.error("Error fetching Charts Data", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = app;