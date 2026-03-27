const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      items JSONB NOT NULL,
      price INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL,
      deleted_at BIGINT,
      delete_reason TEXT
    )
  `);
}

function mapOrder(row) {
  return {
    id: row.id,
    items: row.items || [],
    price: Number(row.price || 0),
    status: row.status,
    createdAt: Number(row.created_at || 0),
    deletedAt: row.deleted_at ? Number(row.deleted_at) : null,
    deleteReason: row.delete_reason || null,
  };
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.post("/order", async (req, res) => {
  try {
    const { items, price } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items 不可為空" });
    }

    const id = "A" + Date.now().toString().slice(-4);

    await pool.query(
      `INSERT INTO orders (id, items, price, status, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, JSON.stringify(items), Number(price || 0), "pending", Date.now()]
    );

    res.json({ id });
  } catch (err) {
    console.error("新增訂單失敗:", err);
    res.status(500).json({ error: "新增訂單失敗" });
  }
});

app.get("/orders", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
       FROM orders
       WHERE status <> 'deleted'
       ORDER BY created_at DESC`
    );

    res.json(result.rows.map(mapOrder));
  } catch (err) {
    console.error("讀取訂單失敗:", err);
    res.status(500).json({ error: "讀取訂單失敗" });
  }
});

app.get("/order/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
       FROM orders
       WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "找不到訂單" });
    }

    res.json(mapOrder(result.rows[0]));
  } catch (err) {
    console.error("讀取單筆訂單失敗:", err);
    res.status(500).json({ error: "讀取單筆訂單失敗" });
  }
});

app.post("/pay/:id", async (req, res) => {
  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM orders
       WHERE status = 'making'`
    );

    const makingCount = countResult.rows[0].count;
    const nextStatus = makingCount < 4 ? "making" : "waiting";

    await pool.query(
      `UPDATE orders
       SET status = $1
       WHERE id = $2`,
      [nextStatus, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("收款失敗:", err);
    res.status(500).json({ error: "收款失敗" });
  }
});

app.post("/done/:id", async (req, res) => {
  try {
    await pool.query(
      `UPDATE orders
       SET status = 'done'
       WHERE id = $1`,
      [req.params.id]
    );

    const waitingResult = await pool.query(
      `SELECT id
       FROM orders
       WHERE status = 'waiting'
       ORDER BY created_at ASC
       LIMIT 1`
    );

    if (waitingResult.rows.length > 0) {
      await pool.query(
        `UPDATE orders
         SET status = 'making'
         WHERE id = $1`,
        [waitingResult.rows[0].id]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("完成訂單失敗:", err);
    res.status(500).json({ error: "完成訂單失敗" });
  }
});

app.post("/refund/:id", async (req, res) => {
  try {
    await pool.query(
      `UPDATE orders
       SET status = 'refunded',
           delete_reason = $1,
           deleted_at = $2
       WHERE id = $3`,
      ["退單", Date.now(), req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("退單失敗:", err);
    res.status(500).json({ error: "退單失敗" });
  }
});

app.post("/delete/:id", async (req, res) => {
  try {
    const { reason } = req.body || {};

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: "刪除原因必填" });
    }

    await pool.query(
      `UPDATE orders
       SET status = 'deleted',
           delete_reason = $1,
           deleted_at = $2
       WHERE id = $3`,
      [reason.trim(), Date.now(), req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("刪除訂單失敗:", err);
    res.status(500).json({ error: "刪除訂單失敗" });
  }
});

app.post("/update-order/:id", async (req, res) => {
  try {
    const { items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items 不可為空" });
    }

    const totalPrice = items.reduce((sum, item) => {
      return sum + Number(item.price || 0);
    }, 0);

    await pool.query(
      `UPDATE orders
       SET items = $1,
           price = $2
       WHERE id = $3
         AND status = 'pending'`,
      [JSON.stringify(items), totalPrice, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("修改訂單失敗:", err);
    res.status(500).json({ error: "修改訂單失敗" });
  }
});

app.get("/report/today", async (req, res) => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS "orderCount",
         COALESCE(SUM(price), 0)::int AS total
       FROM orders
       WHERE status = 'done'
         AND created_at >= $1`,
      [start.getTime()]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("今日報表失敗:", err);
    res.status(500).json({ error: "今日報表失敗" });
  }
});

app.get("/report/month", async (req, res) => {
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);

    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS "orderCount",
         COALESCE(SUM(price), 0)::int AS total
       FROM orders
       WHERE status = 'done'
         AND created_at >= $1`,
      [start.getTime()]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("本月報表失敗:", err);
    res.status(500).json({ error: "本月報表失敗" });
  }
});

app.get("/report/year", async (req, res) => {
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);

    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS "orderCount",
         COALESCE(SUM(price), 0)::int AS total
       FROM orders
       WHERE status = 'done'
         AND created_at >= $1`,
      [start.getTime()]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("本年報表失敗:", err);
    res.status(500).json({ error: "本年報表失敗" });
  }
});

app.get("/report/history", async (req, res) => {
  try {
    const { dateFrom, dateTo, keyword } = req.query;

    let sql = `SELECT * FROM orders WHERE 1=1`;
    const params = [];
    let idx = 1;

    if (dateFrom) {
      const start = new Date(dateFrom);
      start.setHours(0, 0, 0, 0);
      sql += ` AND created_at >= $${idx++}`;
      params.push(start.getTime());
    }

    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      sql += ` AND created_at <= $${idx++}`;
      params.push(end.getTime());
    }

    sql += ` ORDER BY created_at DESC`;

    const result = await pool.query(sql, params);
    let rows = result.rows.map(mapOrder);

    if (keyword) {
      rows = rows.filter((row) => {
        if ((row.id || "").includes(keyword)) return true;
        return (row.items || []).some((item) =>
          (item.name || "").includes(keyword)
        );
      });
    }

    res.json(rows);
  } catch (err) {
    console.error("歷史訂單查詢失敗:", err);
    res.status(500).json({ error: "歷史訂單查詢失敗" });
  }
});

app.get("/report/items", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT items
       FROM orders
       WHERE status = 'done'`
    );

    const map = {};

    result.rows.forEach((order) => {
      const items = order.items || [];
      items.forEach((item) => {
        const key = `${item.name}｜${item.size}`;
        if (!map[key]) {
          map[key] = {
            item: item.name,
            size: item.size,
            qty: 0,
            total: 0,
          };
        }
        map[key].qty += 1;
        map[key].total += Number(item.price || 0);
      });
    });

    const rows = Object.values(map).sort((a, b) => b.qty - a.qty);
    res.json(rows);
  } catch (err) {
    console.error("熱銷分析失敗:", err);
    res.status(500).json({ error: "熱銷分析失敗" });
  }
});

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log("POS running on port " + PORT);
    });
  })
  .catch((err) => {
    console.error("DB init failed:", err);
    process.exit(1);
  });
