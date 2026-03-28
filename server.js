const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

let orders = [];
let deletedOrders = [];

app.post("/order", (req, res) => {
  const { items, price, type } = req.body;

  const id = "A" + Date.now().toString().slice(-4);

  orders.push({
    id,
    items,
    price,
    orderType: type,
    status: "pending",
    createdAt: Date.now(),
    paidAmount: 0,
    changeAmount: 0
  });

  res.json({ id });
});

app.get("/orders", (req, res) => {
  res.json([...orders, ...deletedOrders]);
});

app.post("/pay/:id", (req, res) => {
  const { paidAmount } = req.body;
  const order = orders.find(o => o.id === req.params.id);

  if (!order) return res.status(404).json({ error: "找不到訂單" });

  order.paidAmount = paidAmount;
  order.changeAmount = paidAmount - order.price;

  const makingCount = orders.filter(o => o.status === "making").length;

  order.status = makingCount < 4 ? "making" : "waiting";

  res.json({ success: true });
});

app.post("/done/:id", (req, res) => {
  const order = orders.find(o => o.id === req.params.id);

  if (!order) return res.status(404).json({ error: "找不到訂單" });

  order.status = "done";
  order.completedAt = Date.now();

  const next = orders
    .filter(o => o.status === "waiting")
    .sort((a, b) => a.createdAt - b.createdAt)[0];

  if (next) next.status = "making";

  res.json({ success: true });
});

app.post("/delete/:id", (req, res) => {
  const { reason } = req.body;
  const index = orders.findIndex(o => o.id === req.params.id);

  if (index === -1) return res.status(404).json({ error: "找不到訂單" });

  const order = orders[index];
  order.status = "deleted";
  order.deleteReason = reason;
  order.deletedAt = Date.now();

  deletedOrders.push(order);
  orders.splice(index, 1);

  res.json({ success: true });
});

app.post("/update-order/:id", (req, res) => {
  const { items, orderType } = req.body;
  const order = orders.find(o => o.id === req.params.id);

  if (!order) return res.status(404).json({ error: "找不到訂單" });

  order.items = items;
  order.orderType = orderType;
  order.price = items.reduce((s, i) => s + i.price, 0);

  res.json({ success: true });
});

app.get("/order/:id", (req, res) => {
  res.json(orders.find(o => o.id === req.params.id));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 POS running"));
