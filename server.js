const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // ✅ 這行就是讓 order.html 能用

const db = new sqlite3.Database("./orders.db");

// 建表
db.run(`
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  item TEXT,
  size TEXT,
  price INTEGER,
  status TEXT,
  createdAt INTEGER
)
`);

// 首頁
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// 新增訂單
const { item, size, price } = req.body;

db.run(
  `INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?)`,
  [id, item, size, price, "pending", Date.now()]
);
// 全部訂單
app.get("/orders", (req, res) => {
  db.all(`SELECT * FROM orders ORDER BY createdAt ASC`, (err, rows) => {
    res.json(rows);
  });
});

// 收款（排單）
app.post("/pay/:id", (req, res) => {
  db.all(`SELECT * FROM orders WHERE status='making'`, (err, rows) => {

    if (rows.length < 4) {
      db.run(`UPDATE orders SET status='making' WHERE id=?`, [req.params.id]);
    } else {
      db.run(`UPDATE orders SET status='waiting' WHERE id=?`, [req.params.id]);
    }

    res.json({ success: true });
  });
});

// 完成
app.post("/done/:id", (req, res) => {
  db.run(
    `UPDATE orders SET status='done' WHERE id=?`,
    [req.params.id],
    () => {
      db.get(
        `SELECT * FROM orders 
         WHERE status='waiting' 
         ORDER BY createdAt ASC 
         LIMIT 1`,
        (err, row) => {
          if (row) {
            db.run(`UPDATE orders SET status='making' WHERE id=?`, [row.id]);
          }
        }
      );
    }
  );

  res.json({ success: true });
});

// 單筆
app.get("/order/:id", (req, res) => {
  db.get(`SELECT * FROM orders WHERE id=?`, [req.params.id], (err, row) => {
    res.json(row);
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 POS running on port " + PORT);
});
// 今日營業額
app.get("/report/today", (req, res) => {
  const start = new Date().setHours(0,0,0,0);

  db.all(
    `SELECT SUM(price) as total FROM orders WHERE status='done' AND createdAt >= ?`,
    [start],
    (err, rows) => {
      res.json(rows[0]);
    }
  );
});

// 全部營業額
app.get("/report/all", (req, res) => {
  db.all(
    `SELECT SUM(price) as total FROM orders WHERE status='done'`,
    [],
    (err, rows) => {
      res.json(rows[0]);
    }
  );
});