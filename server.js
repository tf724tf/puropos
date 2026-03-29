require('dotenv').config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");
const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const REPORT_PASSWORD = "7929";
const ADMIN_PASSWORD = "0101";
const REPORT_TOKEN = "7929-ok";
const ADMIN_TOKEN = "0101-ok";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
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
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("status", "done")
    .gte("created_at", startMs)
    .lte("created_at", endMs)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = (data || []).map(mapOrder);
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

// ===== 頁面 =====
app.get("/", (req, res) => {
  res.redirect("/admin-login.html");
});

app.get("/admin-login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin-login.html"));
});

app.get("/report-login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "report-login.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/report.html", (req, res) => {
  res.sendFile(path.join(__dirname, "report.html"));
});

app.get("/order.html", (req, res) => {
  res.sendFile(path.join(__dirname, "order.html"));
});

app.get("/menu.js", (req, res) => {
  res.sendFile(path.join(__dirname, "menu.js"));
});

// ===== 新增：從 Supabase 讀商品 =====
app.get("/api/products", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error("讀取 products 失敗:", err);
    res.status(500).json({ error: "讀取商品失敗" });
  }
});

// ===== 登入 API =====
app.post("/admin-login", (req, res) => {
  const { password } = req.body || {};

  if (String(password || "").trim() !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "密碼錯誤" });
  }

  res.json({
    success: true,
    token: ADMIN_TOKEN,
  });
});

app.post("/report-login", (req, res) => {
  const { password } = req.body || {};

  if (String(password || "").trim() !== REPORT_PASSWORD) {
    return res.status(401).json({ error: "密碼錯誤" });
  }

  res.json({
    success: true,
    token: REPORT_TOKEN,
  });
});

// ===== 客人公開 API =====
app.post("/order", async (req, res) => {
  try {
    const { items, price, orderType } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items 不可為空" });
    }

    if (!orderType || !["內用", "外帶"].includes(orderType)) {
      return res.status(400).json({ error: "請選擇內用或外帶" });
    }

    const id = "A" + Date.now().toString().slice(-4);

    const { error } = await supabase
      .from("orders")
      .insert([
        {
          id,
          items,
          price: Number(price || 0),
          order_type: orderType,
          status: "pending",
          created_at: Date.now(),
          paid_amount: 0,
          change_amount: 0,
          completed_at: null,
          deleted_at: null,
          delete_reason: null
        }
      ]);

    if (error) {
      throw error;
    }

    res.json({ id });
  } catch (err) {
    console.error("新增訂單失敗:", err);
    res.status(500).json({ error: "新增訂單失敗" });
  }
});

// ===== 後台 API（要 0101）=====
app.get("/orders", requireAdminToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .neq("status", "deleted")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json((data || []).map(mapOrder));
  } catch (err) {
    console.error("讀取訂單失敗:", err);
    res.status(500).json({ error: "讀取訂單失敗" });
  }
});

app.get("/order/:id", requireAdminToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ error: "找不到訂單" });
      }
      throw error;
    }

    res.json(mapOrder(data));
  } catch (err) {
    console.error("讀取單筆訂單失敗:", err);
    res.status(500).json({ error: "讀取單筆訂單失敗" });
  }
});
app.post("/pay/:id", requireAdminToken, async (req, res) => {
  try {
    const { paidAmount } = req.body || {};

    const { data: orderData, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (orderError) {
      if (orderError.code === "PGRST116") {
        return res.status(404).json({ error: "找不到訂單" });
      }
      throw orderError;
    }

    const order = mapOrder(orderData);
    const paid = Number(paidAmount || 0);

    if (Number.isNaN(paid) || paid < order.price) {
      return res.status(400).json({ error: "收款金額不足" });
    }

    const changeAmount = paid - order.price;

    const { data: makingOrders, error: makingError } = await supabase
      .from("orders")
      .select("id")
      .eq("status", "making");

    if (makingError) throw makingError;

    const makingCount = (makingOrders || []).length;
    const nextStatus = makingCount < 4 ? "making" : "waiting";

    const { error: updateError } = await supabase
      .from("orders")
      .update({
        status: nextStatus,
        paid_amount: paid,
        change_amount: changeAmount
      })
      .eq("id", req.params.id);

    if (updateError) throw updateError;

    res.json({ success: true, paidAmount: paid, changeAmount });
  } catch (err) {
    console.error("收款失敗:", err);
    res.status(500).json({ error: "收款失敗" });
  }
});

app.post("/done/:id", requireAdminToken, async (req, res) => {
  try {
    const { error: doneError } = await supabase
      .from("orders")
      .update({
        status: "done",
        completed_at: Date.now()
      })
      .eq("id", req.params.id);

    if (doneError) throw doneError;

    const { data: waitingOrders, error: waitingError } = await supabase
      .from("orders")
      .select("id")
      .eq("status", "waiting")
      .order("created_at", { ascending: true })
      .limit(1);

    if (waitingError) throw waitingError;

    if (waitingOrders && waitingOrders.length > 0) {
      const { error: promoteError } = await supabase
        .from("orders")
        .update({ status: "making" })
        .eq("id", waitingOrders[0].id);

      if (promoteError) throw promoteError;
    }

    res.json({ success: true });
  } catch (err) {
    console.error("完成訂單失敗:", err);
    res.status(500).json({ error: "完成訂單失敗" });
  }
});

app.post("/delete/:id", requireAdminToken, async (req, res) => {
  try {
    const { reason } = req.body || {};

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: "刪除原因必填" });
    }

    const { error } = await supabase
      .from("orders")
      .update({
        status: "deleted",
        delete_reason: reason.trim(),
        deleted_at: Date.now()
      })
      .eq("id", req.params.id);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error("刪除訂單失敗:", err);
    res.status(500).json({ error: "刪除訂單失敗" });
  }
});

app.post("/update-order/:id", requireAdminToken, async (req, res) => {
  try {
    const { items, orderType } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items 不可為空" });
    }

    if (!orderType || !["內用", "外帶"].includes(orderType)) {
      return res.status(400).json({ error: "請選擇內用或外帶" });
    }

    const totalPrice = items.reduce((sum, item) => {
      return sum + Number(item.price || 0);
    }, 0);

    const { error } = await supabase
      .from("orders")
      .update({
        items,
        price: totalPrice,
        order_type: orderType
      })
      .eq("id", req.params.id)
      .eq("status", "pending");

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error("修改訂單失敗:", err);
    res.status(500).json({ error: "修改訂單失敗" });
  }
});

// ===== 報表 API（要 7929）=====
app.get("/report/overview", requireReportToken, async (req, res) => {
  try {
    const today = getTodayRange();
    const yesterday = getYesterdayRange();
    const month = getMonthRange();

    const { data: allData, error: allError } = await supabase
      .from("orders")
      .select("*")
      .eq("status", "done")
      .order("created_at", { ascending: false });

    if (allError) throw allError;

    const allRows = (allData || []).map(mapOrder);

    const todaySummary = await summaryByRange(today.startMs, today.endMs, "label", today.label);
    const yesterdaySummary = await summaryByRange(yesterday.startMs, yesterday.endMs, "label", yesterday.label);
    const monthSummary = await summaryByRange(month.startMs, month.endMs, "label", month.label);

    const allTotal = allRows.reduce((sum, row) => sum + Number(row.price || 0), 0);
    const allCount = allRows.length;
    const allPizzaCount = countPizzaFromOrders(allRows);

    res.json({
      today: {
        ...todaySummary,
        cashInDrawer: todaySummary.cashInDrawer
      },
      yesterday: {
        ...yesterdaySummary,
        cashInDrawer: 0
      },
      month: {
        ...monthSummary,
        cashInDrawer: 0
      },
      all: {
        label: "累計",
        total: allTotal,
        orderCount: allCount,
        pizzaCount: allPizzaCount,
        cashInDrawer: 0
      }
    });
  } catch (err) {
    console.error("累計摘要失敗:", err);
    res.status(500).json({ error: "累計摘要失敗" });
  }
});
  } catch (err) {
    console.error("累計摘要失敗:", err);
    res.status(500).json({ error: "累計摘要失敗" });
  }
});

app.get("/report/daily-summary", requireReportToken, async (req, res) => {
  try {
    const range = getDateRange(req.query.date);
    const data = await summaryByRange(range.startMs, range.endMs, "date", range.label);
    res.json(data);
  } catch (err) {
    console.error("單日摘要失敗:", err);
    res.status(500).json({ error: "單日摘要失敗" });
  }
});

app.get("/report/monthly-summary", requireReportToken, async (req, res) => {
  try {
    const range = getMonthRange(req.query.month);
    const data = await summaryByRange(range.startMs, range.endMs, "month", range.label);
    res.json(data);
  } catch (err) {
    console.error("月份摘要失敗:", err);
    res.status(500).json({ error: "月份摘要失敗" });
  }
});

app.get("/report/yearly-summary", requireReportToken, async (req, res) => {
  try {
    const range = getYearRange(req.query.year);
    const data = await summaryByRange(range.startMs, range.endMs, "year", range.label);
    res.json(data);
  } catch (err) {
    console.error("年度摘要失敗:", err);
    res.status(500).json({ error: "年度摘要失敗" });
  }
});

app.get("/report/history", requireReportToken, async (req, res) => {
  try {
    const { sql, params, keyword } = buildHistoryFilter(req.query);
    const result = await pool.query(sql, params);
    let rows = result.rows.map(mapOrder);
    rows = filterRowsByKeyword(rows, keyword);
    rows = rows.slice(0, 10);
    res.json(rows);
  } catch (err) {
    console.error("歷史訂單查詢失敗:", err);
    res.status(500).json({ error: "歷史訂單查詢失敗" });
  }
});

app.get("/report/items", requireReportToken, async (req, res) => {
  try {
    const month = req.query.month;
    let result;

    if (month) {
      const range = getMonthRange(month);
      result = await pool.query(
        `SELECT items
         FROM orders
         WHERE status = 'done'
           AND created_at >= $1
           AND created_at <= $2`,
        [range.startMs, range.endMs]
      );
    } else {
      result = await pool.query(
        `SELECT items
         FROM orders
         WHERE status = 'done'`
      );
    }

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

app.get("/report/export", requireReportToken, async (req, res) => {
  try {
    const month = req.query.month;
    const range = getMonthRange(month);

    const result = await pool.query(
      `SELECT *
       FROM orders
       WHERE status = 'done'
         AND created_at >= $1
         AND created_at <= $2
       ORDER BY created_at DESC`,
      [range.startMs, range.endMs]
    );

    const rows = result.rows.map(mapOrder);

    const summaryRows = [{
      月份: range.label,
      訂單數: rows.length,
      Pizza張數: countPizzaFromOrders(rows),
      營業額: rows.reduce((sum, row) => sum + Number(row.price || 0), 0),
      今日錢櫃應有金額: 0
    }];

    const dailyMap = {};
    rows.forEach((order) => {
      const d = new Date(order.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!dailyMap[key]) {
        dailyMap[key] = {
          日期: key,
          訂單數: 0,
          Pizza張數: 0,
          營業額: 0,
          錢櫃應有金額: 0
        };
      }
      dailyMap[key].訂單數 += 1;
      dailyMap[key].營業額 += Number(order.price || 0);
      dailyMap[key].錢櫃應有金額 += Number(order.paidAmount || 0) - Number(order.changeAmount || 0);

      (order.items || []).forEach((item) => {
        if (item.size === "方形" || item.size === "圓形") {
          dailyMap[key].Pizza張數 += 1;
        }
      });
    });

    const dailyRows = Object.values(dailyMap).sort((a, b) => a.日期.localeCompare(b.日期));

    const itemMap = {};
    rows.forEach((order) => {
      (order.items || []).forEach((item) => {
        const key = `${item.name}｜${item.size}`;
        if (!itemMap[key]) {
          itemMap[key] = {
            品項: item.name,
            尺寸: item.size,
            銷售數量: 0,
            銷售額: 0
          };
        }
        itemMap[key].銷售數量 += 1;
        itemMap[key].銷售額 += Number(item.price || 0);
      });
    });

    const itemRows = Object.values(itemMap).sort((a, b) => b.銷售數量 - a.銷售數量);

    const detailRows = [];
    rows.forEach((order) => {
      (order.items || []).forEach((item) => {
        detailRows.push({
          單號: order.id,
          類型: order.orderType,
          建立時間: new Date(order.createdAt).toLocaleString("zh-TW"),
          完成時間: order.completedAt ? new Date(order.completedAt).toLocaleString("zh-TW") : "",
          品項: item.name,
          尺寸: item.size,
          品項金額: item.price,
          訂單總額: order.price,
          收款金額: order.paidAmount,
          找零金額: order.changeAmount,
          淨收入: Number(order.paidAmount || 0) - Number(order.changeAmount || 0)
        });
      });
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "月摘要");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyRows), "每日營業");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemRows), "熱銷排行");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), "訂單明細");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `puro-month-report-${range.label}.xlsx`;

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
  } catch (err) {
    console.error("匯出報表失敗:", err);
    res.status(500).json({ error: "匯出報表失敗" });
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
