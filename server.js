const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");
const XLSX = require("xlsx");

const app = express();

app.use(cors());
app.use(express.json());

const REPORT_PASSWORD = "7929";
const ADMIN_PASSWORD = "0101";
const REPORT_TOKEN = "7929-ok";
const ADMIN_TOKEN = "0101-ok";

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
      order_type TEXT NOT NULL DEFAULT '內用',
      paid_amount INTEGER NOT NULL DEFAULT 0,
      change_amount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL,
      completed_at BIGINT,
      deleted_at BIGINT,
      delete_reason TEXT
    )
  `);

  const result = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'orders'
  `);

  const cols = result.rows.map((r) => r.column_name);

  if (!cols.includes("completed_at")) {
    await pool.query(`ALTER TABLE orders ADD COLUMN completed_at BIGINT`);
  }
  if (!cols.includes("deleted_at")) {
    await pool.query(`ALTER TABLE orders ADD COLUMN deleted_at BIGINT`);
  }
  if (!cols.includes("delete_reason")) {
    await pool.query(`ALTER TABLE orders ADD COLUMN delete_reason TEXT`);
  }
  if (!cols.includes("order_type")) {
    await pool.query(
      `ALTER TABLE orders ADD COLUMN order_type TEXT NOT NULL DEFAULT '內用'`
    );
  }
  if (!cols.includes("paid_amount")) {
    await pool.query(
      `ALTER TABLE orders ADD COLUMN paid_amount INTEGER NOT NULL DEFAULT 0`
    );
  }
  if (!cols.includes("change_amount")) {
    await pool.query(
      `ALTER TABLE orders ADD COLUMN change_amount INTEGER NOT NULL DEFAULT 0`
    );
  }
}

function mapOrder(row) {
  return {
    id: row.id,
    items: row.items || [],
    price: Number(row.price || 0),
    orderType: row.order_type || "內用",
    paidAmount: Number(row.paid_amount || 0),
    changeAmount: Number(row.change_amount || 0),
    status: row.status,
    createdAt: Number(row.created_at || 0),
    completedAt: row.completed_at ? Number(row.completed_at) : null,
    deletedAt: row.deleted_at ? Number(row.deleted_at) : null,
    deleteReason: row.delete_reason || null,
  };
}

function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
    label: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
  };
}

function getYesterdayRange() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);

  const start = new Date(d);
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);

  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
    label: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
  };
}

function getMonthRange(monthString) {
  let year;
  let month;

  if (monthString && /^\d{4}-\d{2}$/.test(monthString)) {
    const parts = monthString.split("-");
    year = Number(parts[0]);
    month = Number(parts[1]) - 1;
  } else {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth();
  }

  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 1, 0, 0, 0, 0);

  return {
    startMs: start.getTime(),
    endMs: end.getTime() - 1,
    label: `${year}-${String(month + 1).padStart(2, "0")}`,
  };
}

function getYearRange(yearString) {
  let year;

  if (yearString && /^\d{4}$/.test(yearString)) {
    year = Number(yearString);
  } else {
    year = new Date().getFullYear();
  }

  const start = new Date(year, 0, 1, 0, 0, 0, 0);
  const end = new Date(year + 1, 0, 1, 0, 0, 0, 0);

  return {
    startMs: start.getTime(),
    endMs: end.getTime() - 1,
    label: `${year}`,
  };
}

function getDateRange(dateString) {
  let date;

  if (dateString && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    date = new Date(dateString);
  } else {
    date = new Date();
  }

  date.setHours(0, 0, 0, 0);
  const start = new Date(date);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  const label = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;

  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
    label,
  };
}

function countPizzaFromOrders(rows) {
  let pizzaCount = 0;

  rows.forEach((row) => {
    const items = row.items || [];
    items.forEach((item) => {
      if (item.size === "方形" || item.size === "圓形") {
        pizzaCount += 1;
      }
    });
  });

  return pizzaCount;
}

function buildHistoryFilter(reqQuery) {
  const { dateFrom, dateTo, keyword, status, month } = reqQuery;

  let sql = `SELECT * FROM orders WHERE 1=1`;
  const params = [];
  let idx = 1;

  if (month) {
    const range = getMonthRange(month);
    sql += ` AND created_at >= $${idx++} AND created_at <= $${idx++}`;
    params.push(range.startMs, range.endMs);
  }

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

  if (status) {
    sql += ` AND status = $${idx++}`;
    params.push(status);
  }

  sql += ` ORDER BY created_at DESC`;

  return { sql, params, keyword };
}

function filterRowsByKeyword(rows, keyword) {
  if (!keyword) return rows;

  return rows.filter((row) => {
    if ((row.id || "").includes(keyword)) return true;
    if ((row.orderType || "").includes(keyword)) return true;
    return (row.items || []).some((item) =>
      (item.name || "").includes(keyword)
    );
  });
}

function requireReportToken(req, res, next) {
  const token = req.headers["x-report-token"] || req.query.token;
  if (token === REPORT_TOKEN) return next();
  return res.status(401).json({ error: "未授權，請先登入報表系統" });
}

function requireAdminToken(req, res, next) {
  const token = req.headers["x-admin-token"] || req.query.token;
  if (token === ADMIN_TOKEN) return next();
  return res.status(401).json({ error: "未授權，請先登入後台" });
}

async function summaryByRange(startMs, endMs, labelKey, labelValue) {
  const result = await pool.query(
    `SELECT *
     FROM orders
     WHERE status = 'done'
       AND created_at >= $1
       AND created_at <= $2
     ORDER BY created_at DESC`,
    [startMs, endMs]
  );

  const rows = result.rows.map(mapOrder);
  const orderCount = rows.length;
  const total = rows.reduce((sum, row) => sum + Number(row.price || 0), 0);
  const pizzaCount = countPizzaFromOrders(rows);
  const cashInDrawer = rows.reduce(
    (sum, row) =>
      sum + (Number(row.paidAmount || 0) - Number(row.changeAmount || 0)),
    0
  );

  return {
    [labelKey]: labelValue,
    orderCount,
    total,
    pizzaCount,
    cashInDrawer,
  };
}

// ===== 登入頁 =====
app.get("/admin-login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin-login.html"));
