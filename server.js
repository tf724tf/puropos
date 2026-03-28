const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");
const XLSX = require("xlsx");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

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
  const end = new Date(year, month +
