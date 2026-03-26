const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database("./orders.db");

// 新版資料表：items 存整張訂單內容（JSON字串）
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      items TEXT,
      price INTEGER,
      status TEXT,
      createdAt INTEGER
    )
  `);

  // 兼容舊表：如果原本沒有 items 欄位，補上
  db.all(`PRAGMA table_info(orders)`, (err, columns) => {
    if (err) {
      console.error(err);
      return;
    }

    const columnNames = columns.map(c => c.name);

    if (!columnNames.includes("items")) {
      db.run(`ALTER TABLE orders ADD COLUMN items TEXT`);
    }

    if (!columnNames.includes("price")) {
      db.run(`ALTER TABLE orders ADD COLUMN price INTEGER DEFAULT 0`);
    }

    if (!columnNames.includes("createdAt")) {
      db.run(`ALTER TABLE orders ADD COLUMN createdAt INTEGER`);
    }
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// 建立訂單：一次送多品項
app.post("/order", (req, res) => {
  const { items, price } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items 不可為空" });
  }

  const id = "A" + Date.now().toString().slice(-4);

  db.run(
    `INSERT INTO orders (id, items, price, status, createdAt) VALUES (?, ?, ?, ?, ?)`,
    [id, JSON.stringify(items), price || 0, "pending", Date.now()],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "新增訂單失敗" });
      }

      res.json({ id });
    }
  );
});

app.get("/orders", (req, res) => {
  db.all(`SELECT * FROM orders ORDER BY createdAt ASC`, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "讀取訂單失敗" });
    }

    const parsedRows = rows.map(row => {
      let parsedItems = [];
      try {
        parsedItems = row.items ? JSON.parse(row.items) : [];
      } catch {
        parsedItems = [];
      }

      return {
        ...row,
        items: parsedItems
      };
    });

    res.json(parsedRows);
  });
});

app.post("/pay/:id", (req, res) => {
  db.all(`SELECT * FROM orders WHERE status='making'`, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "收款失敗" });
    }

    const nextStatus = rows.length < 4 ? "making" : "waiting";

    db.run(
      `UPDATE orders SET status=? WHERE id=?`,
      [nextStatus, req.params.id],
      (err) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "更新狀態失敗" });
        }
        res.json({ success: true });
      }
    );
  });
});

app.post("/done/:id", (req, res) => {
  db.run(
    `UPDATE orders SET status='done' WHERE id=?`,
    [req.params.id],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "完成訂單失敗" });
      }

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

      res.json({ success: true });
    }
  );
});

app.get("/order/:id", (req, res) => {
  db.get(`SELECT * FROM orders WHERE id=?`, [req.params.id], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "讀取單筆訂單失敗" });
    }

    if (!row) {
      return res.status(404).json({ error: "找不到訂單" });
    }

    let parsedItems = [];
    try {
      parsedItems = row.items ? JSON.parse(row.items) : [];
    } catch {
      parsedItems = [];
    }

    res.json({
      ...row,
      items: parsedItems
    });
  });
});

app.get("/report/today", (req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  db.get(
    `SELECT SUM(price) as total FROM orders WHERE status='done' AND createdAt >= ?`,
    [start.getTime()],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "今日報表失敗" });
      }
      res.json({ total: row?.total || 0 });
    }
  );
});

app.get("/report/all", (req, res) => {
  db.get(
    `SELECT SUM(price) as total FROM orders WHERE status='done'`,
    [],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "總報表失敗" });
      }
      res.json({ total: row?.total || 0 });
    }
  );
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 POS running on port " + PORT);
});
