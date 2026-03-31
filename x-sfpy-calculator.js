const crypto = require("crypto");

const secret =
  "f757761e3c795f52d88ce094f21e10b79fcba7325c1a18e91eb9ae1d5d7305c2";
const bodyString =
  '{"data":{"token":"D6RJCTLF09HC73BUMBFG","client_id":"sec_8d97b969-2372-44e2-af60-d64effce641e","type":"payment:created","endpoint":"https://giovanna-smashable-intimately.ngrok-free.dev/api/payments/webhook","notification":{"tracker":"tracker_d6rjctllh63s73ellpo0","reference":"333","intent":"PAYFAST","fee":"4.92","net":"145.08","user":"johndoe@gmail.com","state":"PAID","amount":"150","currency":"PKR","metadata":{"order_id":"XG102312","source":"shopify"}},"delivery_attempts":3,"resource":"notification","next_attempt_at":"2026-03-15T22:48:16Z","created_at":"2026-03-15T22:45:11Z"}}';

const hmac = crypto.createHmac("sha256", secret);
hmac.update(bodyString);
const myHash = hmac.digest("hex");

console.log("My Calculated Hash:", myHash);
