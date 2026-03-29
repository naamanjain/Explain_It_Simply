const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const API_KEY = process.env.API_KEY;

app.post("/api/explain", async (req, res) => {
  try {
    const userQuery = req.body.query;
    if (!userQuery) return res.status(400).json({ error: "Query is required" });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are an expert explainer. For the topic: "${userQuery}", respond ONLY with this exact JSON format, no markdown, no backticks:
{"eli5":"simple analogy-based explanation for a 5 year old","technical":"• point1\\n• point2\\n• point3","keyTakeaway":"one sentence summary"}`
            }]
          }]
        })
      }
    );

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    res.json({
      choices: [{ message: { content: text } }]
    });

  } catch (err) {
    console.log("ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log("🚀 Server running on http://localhost:3000"));