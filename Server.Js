// DULLYVPN FIBER - Backend ndogo ya kuunganisha na Snippe API
// Kazi: kuunda malipo, kupokea webhook, na ku-check status

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const SNIPPE_API_KEY = process.env.SNIPPE_API_KEY; // wekwa Render Environment Variables
const SNIPPE_BASE_URL = "https://api.snippe.sh/v1";

// Hifadhi ya muda ya status za malipo (kwa mfumo mkubwa zaidi, tumia database)
// key = reference, value = { status, package, createdAt }
const payments = {};

// Ramani ya vifurushi -> bei (TZS)
const PACKAGES = {
  "dully-mini": { name: "MINI (Siku 1)", price: 500 },
  "dully-lite": { name: "LITE (Siku 2)", price: 1000 },
  "basic": { name: "BASIC (Siku 4)", price: 2000 },
  "plus": { name: "PLUS (Wiki 1)", price: 3000 },
  "premium": { name: "PREMIUM (Wiki 2)", price: 5000 },
  "vip": { name: "VIP (Mwezi 1)", price: 10000 },
};

// 1) Tengeneza malipo mapya na upate payment_url ya kumpeleka mteja
app.post("/create-payment", async (req, res) => {
  try {
    const { packageId, phone, name } = req.body;

    const pkg = PACKAGES[packageId];
    if (!pkg) {
      return res.status(400).json({ error: "Kifurushi hakijulikani" });
    }

    const response = await fetch(`${SNIPPE_BASE_URL}/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SNIPPE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        payment_type: "mobile",
        details: { amount: pkg.price, currency: "TZS" },
        phone_number: phone,
        customer: { name: name || "Mteja" },
        webhook_url: `${process.env.PUBLIC_URL}/webhook`,
        metadata: { package: packageId },
      }),
    });

    const data = await response.json();

    if (data.status !== "success") {
      return res.status(400).json({ error: data.message || "Imeshindwa kuunda malipo" });
    }

    const reference = data.data.reference;

    payments[reference] = {
      status: "pending",
      package: packageId,
      createdAt: Date.now(),
    };

    res.json({
      reference,
      payment_url: data.data.payment_url || null,
      status: "pending",
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Hitilafu ya server" });
  }
});

// 2) Snippe inatuma taarifa hapa pindi malipo yanapokamilika/kushindwa
app.post("/webhook", (req, res) => {
  try {
    const event = req.body;

    // event.event => "payment.completed" au "payment.failed"
    // event.data.reference => reference id ya malipo

    const reference = event?.data?.reference;
    if (!reference) return res.sendStatus(400);

    if (!payments[reference]) {
      payments[reference] = {};
    }

    if (event.event === "payment.completed") {
      payments[reference].status = "paid";
    } else if (event.event === "payment.failed") {
      payments[reference].status = "failed";
    }

    payments[reference].updatedAt = Date.now();

    console.log("Webhook imepokelewa:", reference, payments[reference].status);

    res.sendStatus(200);

  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// 3) Website inauliza status ya malipo kwa reference
app.get("/status/:reference", (req, res) => {
  const record = payments[req.params.reference];

  if (!record) {
    return res.status(404).json({ status: "haijulikani" });
  }

  res.json({ status: record.status });
});

app.get("/", (req, res) => {
  res.send("DULLYVPN FIBER webhook server iko live.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server inaendesha kwenye port ${PORT}`);
});
