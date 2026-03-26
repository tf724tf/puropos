const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database("./orders.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      items TEXT,
      price INTEGER,
      status TEXT,
      createdAt INTEGER,
      deletedAt INTEGER,
      deleteReason TEXT
    )
  `);

  db.all(`PRAGMA table_info(orders)`, (err, columns) => {
    if (err) {
      console.error(err);
      return;
    }

    const names = columns.map(c => c.name);

    if (!names.includes("items")) {
      db.run(`ALTER TABLE orders ADD COLUMN items TEXT`);
    }
    if (!names.includes("price")) {
      db.run(`ALTER TABLE orders ADD COLUMN price INTEGER DEFAULT 0`);
    }
    if (!names.includes("createdAt")) {
      db.run(`ALTER TABLE orders ADD COLUMN createdAt INTEGER`);
    }
    if (!names.includes("deletedAt")) {
      db.run(`ALTER TABLE orders ADD COLUMN deletedAt INTEGER`);
    }
    if (!names.includes("deleteReason")) {
      db.run(`ALTER TABLE orders ADD COLUMN deleteReason TEXT`);
    }
  });
});

function parseItems(itemsText) {
  try {
    return itemsText ? JSON.parse(itemsText) : [];
  } catch {
    return [];
  }
}

function safeRow(row) {
  return {
    ...row,
    items: parseItems(row.items)
  };
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.post("/order", (req, res) => {
  const { items, price } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items 不可為空" });
  }

  const id = "A" + Date.now().toString().slice(-4);

  db.run(
    `INSERT INTO orders (id, items, price, status, createdAt, deletedAt, deleteReason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, JSON.stringify(items), price || 0, "pending", Date.now(), null, null],
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
  db.all(
    `SELECT * FROM orders
     WHERE status NOT IN ('deleted')
     ORDER BY createdAt DESC`,
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "讀取訂單失敗" });
      }
      res.json(rows.map(safeRow));
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
    res.json(safeRow(row));
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

app.post("/refund/:id", (req, res) => {
  db.run(
    `UPDATE orders
     SET status='refunded',
         deleteReason=?,
         deletedAt=?
     WHERE id=?`,
    ["退單", Date.now(), req.params.id],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "退單失敗" });
      }
      res.json({ success: true });
    }
  );
});

app.post("/delete/:id", (req, res) => {
  const { reason } = req.body || {};

  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: "刪除原因必填" });
  }

  db.run(
    `UPDATE orders
     SET status='deleted',
         deleteReason=?,
         deletedAt=?
     WHERE id=?`,
    [reason.trim(), Date.now(), req.params.id],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "刪除訂單失敗" });
      }
      res.json({ success: true });
    }
  );
});

// 修改未收款訂單
app.post("/update-order/:id", (req, res) => {
  const { items } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items 不可為空" });
  }

  const totalPrice = items.reduce((sum, item) => {
    return sum + Number(item.price || 0);
  }, 0);

  db.run(
    `UPDATE orders
     SET items=?,
         price=?
     WHERE id=?
       AND status='pending'`,
    [JSON.stringify(items), totalPrice, req.params.id],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "修改訂單失敗" });
      }

      res.json({ success: true });
    }
  );
});

app.get("/report/today", (req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  db.get(
    `SELECT
       COUNT(*) as orderCount,
       COALESCE(SUM(price), 0) as total
     FROM orders
     WHERE status='done'
       AND createdAt >= ?`,
    [start.getTime()],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "今日報表失敗" });
      }
      res.json({
        orderCount: row?.orderCount || 0,
        total: row?.total || 0
      });
    }
  );
});

app.get("/report/month", (req, res) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);

  db.get(
    `SELECT
       COUNT(*) as orderCount,
       COALESCE(SUM(price), 0) as total
     FROM orders
     WHERE status='done'
       AND createdAt >= ?`,
    [start.getTime()],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "本月報表失敗" });
      }
      res.json({
        orderCount: row?.orderCount || 0,
        total: row?.total || 0
      });
    }
  );
});

app.get("/report/year", (req, res) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);

  db.get(
    `SELECT
       COUNT(*) as orderCount,
       COALESCE(SUM(price), 0) as total
     FROM orders
     WHERE status='done'
       AND createdAt >= ?`,
    [start.getTime()],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "本年報表失敗" });
      }
      res.json({
        orderCount: row?.orderCount || 0,
        total: row?.total || 0
      });
    }
  );
});

app.get("/report/history", (req, res) => {
  const { dateFrom, dateTo, keyword } = req.query;

  let sql = `SELECT * FROM orders WHERE 1=1`;
  const params = [];

  if (dateFrom) {
    const start = new Date(dateFrom);
    start.setHours(0, 0, 0, 0);
    sql += ` AND createdAt >= ?`;
    params.push(start.getTime());
  }

  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    sql += ` AND createdAt <= ?`;
    params.push(end.getTime());
  }

  sql += ` ORDER BY createdAt DESC`;

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "歷史訂單查詢失敗" });
    }

    let parsedRows = rows.map(safeRow);

    if (keyword) {
      parsedRows = parsedRows.filter(row => {
        if ((row.id || "").includes(keyword)) return true;
        return (row.items || []).some(item => (item.name || "").includes(keyword));
      });
    }

    res.json(parsedRows);
  });
});

app.get("/report/items", (req, res) => {
  db.all(
    `SELECT items, status FROM orders WHERE status='done'`,
    [],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "熱銷分析失敗" });
      }

      const map = {};

      rows.forEach(order => {
        const items = parseItems(order.items);
        items.forEach(item => {
          const key = `${item.name}｜${item.size}`;
          if (!map[key]) {
            map[key] = {
              item: item.name,
              size: item.size,
              qty: 0,
              total: 0
            };
          }
          map[key].qty += 1;
          map[key].total += Number(item.price || 0);
        });
      });

      const result = Object.values(map).sort((a, b) => b.qty - a.qty);
      res.json(result);
    }
  );
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 POS running on port " + PORT);
});
