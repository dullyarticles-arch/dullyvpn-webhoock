// DULLYVPN FIBER - Backend (webhook + metadata, hauitaji API Key)

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(cors());

// Hifadhi ya muda ya status za malipo
// key = client id (uliozalishwa na browser), value = { status, package, createdAt }
const payments = {};

const SIGNING_KEY = process.env.SNIPPE_WEBHOOK_SECRET;

function verifySignature(rawBody, headers) {
  if (!SIGNING_KEY) return true; // ikiwa hujaweka secret bado, ruka ukaguzi (kwa majaribio tu)

  const timestamp = headers["x-webhook-timestamp"];
  const signature = headers["x-webhook-signature"];
  if (!timestamp || !signature) return false;

  const eventTime = parseInt(timestamp, 10);
  const currentTime = Math.floor(Date.now() / 1000);
  if (currentTime - eventTime > 300) return false;

  const message = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", SIGNING_KEY).update(message).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Snippe inatuma taarifa hapa pindi malipo yanapokamilika/kushindwa
app.post("/webhook", express.raw({ type: "*/*" }), (req, res) => {
  try {
    const rawBody = req.body.toString();

    if (!verifySignature(rawBody, req.headers)) {
      console.log("Webhook signature isiyo sahihi");
      return res.sendStatus(400);
    }

    const event = JSON.parse(rawBody);
    const eventType = event.type || event.event; // support format mpya na ya zamani
    const data = event.data || event;

    const urlMeta = data?.metadata?.url_metadata;
    const clientId = urlMeta?.id;

    if (!clientId) {
      console.log("Webhook bila client id, tunapuuza");
      return res.sendStatus(200);
    }

    if (!payments[clientId]) payments[clientId] = {};

    if (eventType === "payment.completed") {
      payments[clientId].status = "paid";
    } else if (eventType === "payment.failed" || eventType === "payment.voided" || eventType === "payment.expired") {
      payments[clientId].status = "failed";
    }

    payments[clientId].updatedAt = Date.now();
    console.log("Webhook:", clientId, payments[clientId].status);

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.use(express.json());

// Website inauliza status ya malipo kwa client id
app.get("/status/:id", (req, res) => {
  const record = payments[req.params.id];
  if (!record) return res.json({ status: "pending" });
  res.json({ status: record.status || "pending" });
});

app.get("/", (req, res) => {
  res.send("DULLYVPN FIBER webhook server iko live.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server inaendesha kwenye port ${PORT}`);
});
