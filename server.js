// DULLYVPN FIBER - Backend ya Pesapal API 3.0

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET;
const BASE_URL = "https://pay.pesapal.com/v3/api"; // production
const PUBLIC_URL = process.env.PUBLIC_URL;

const PACKAGES = {
  "dully-mini": { name: "MINI (Siku 1)", price: 500 },
  "dully-lite": { name: "LITE (Siku 2)", price: 1000 },
  "basic": { name: "BASIC (Siku 4)", price: 2000 },
  "plus": { name: "PLUS (Wiki 1)", price: 3000 },
  "premium": { name: "PREMIUM (Wiki 2)", price: 5000 },
  "vip": { name: "VIP (Mwezi 1)", price: 10000 },
};

const payments = {}; // key = orderTrackingId, value = { status, package }

let cachedToken = null;
let tokenExpiry = 0;
let notificationId = null;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch(`${BASE_URL}/Auth/RequestToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      consumer_key: CONSUMER_KEY,
      consumer_secret: CONSUMER_SECRET,
    }),
  });

  const data = await res.json();
  if (!data.token) throw new Error("Imeshindwa kupata token: " + JSON.stringify(data));

  cachedToken = data.token;
  tokenExpiry = Date.now() + 4 * 60 * 1000; // 4 min (token halisi ni 5 min)
  return cachedToken;
}

async function ensureIpnRegistered() {
  if (notificationId) return notificationId;

  const token = await getToken();
  const res = await fetch(`${BASE_URL}/URLSetup/RegisterIPN`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      url: `${PUBLIC_URL}/ipn`,
      ipn_notification_type: "POST",
    }),
  });

  const data = await res.json();
  if (!data.ipn_id) throw new Error("Imeshindwa kusajili IPN: " + JSON.stringify(data));

  notificationId = data.ipn_id;
  console.log("IPN imesajiliwa:", notificationId);
  return notificationId;
}

// 1) Unda malipo
app.post("/create-payment", async (req, res) => {
  try {
    const { packageId, phone, name } = req.body;
    const pkg = PACKAGES[packageId];
    if (!pkg) return res.status(400).json({ error: "Kifurushi hakijulikani" });

    const token = await getToken();
    const ipnId = await ensureIpnRegistered();

    const orderId = "DVF" + Date.now() + Math.floor(Math.random() * 1000);

    const orderRes = await fetch(`${BASE_URL}/Transactions/SubmitOrderRequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        id: orderId,
        currency: "TZS",
        amount: pkg.price,
        description: pkg.name,
        callback_url: `${PUBLIC_URL}/thankyou`,
        notification_id: ipnId,
        billing_address: {
          phone_number: phone || "",
          first_name: name || "Mteja",
          country_code: "TZ",
        },
      }),
    });

    const orderData = await orderRes.json();

    if (!orderData.order_tracking_id) {
      return res.status(400).json({ error: orderData.message || "Imeshindwa kuunda order" });
    }

    payments[orderData.order_tracking_id] = { status: "pending", package: packageId };

    res.json({
      reference: orderData.order_tracking_id,
      payment_url: orderData.redirect_url,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Hitilafu ya server" });
  }
});

// 2) Pesapal inatuma IPN hapa
app.post("/ipn", async (req, res) => {
  try {
    const { OrderTrackingId } = req.body;
    if (!OrderTrackingId) return res.status(400).json({ status: 500 });

    const token = await getToken();
    const statusRes = await fetch(
      `${BASE_URL}/Transactions/GetTransactionStatus?orderTrackingId=${OrderTrackingId}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
    );
    const statusData = await statusRes.json();

    if (!payments[OrderTrackingId]) payments[OrderTrackingId] = {};

    const desc = (statusData.payment_status_description || "").toUpperCase();
    if (desc === "COMPLETED") payments[OrderTrackingId].status = "paid";
    else if (desc === "FAILED" || desc === "INVALID") payments[OrderTrackingId].status = "failed";

    console.log("IPN:", OrderTrackingId, payments[OrderTrackingId].status);

    res.json({
      orderNotificationType: "IPNCHANGE",
      orderTrackingId: OrderTrackingId,
      orderMerchantReference: req.body.OrderMerchantReference || "",
      status: 200,
    });
  } catch (err) {
    console.error(err);
    res.json({ status: 500 });
  }
});

// GET version pia (Pesapal inaweza tuma GET)
app.get("/ipn", async (req, res) => {
  req.body = req.query;
  return app._router.handle(req, res, () => {}, "post");
});

// 3) Website inauliza status
app.get("/status/:reference", (req, res) => {
  const record = payments[req.params.reference];
  if (!record) return res.json({ status: "pending" });
  res.json({ status: record.status || "pending" });
});

app.get("/thankyou", (req, res) => {
  res.send("<h2>Asante! Unaweza kufunga ukurasa huu na kurudi kwenye website.</h2>");
});

app.get("/", (req, res) => {
  res.send("DULLYVPN FIBER Pesapal backend iko live.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server inaendesha kwenye port ${PORT}`);
});
