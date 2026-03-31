import { Request, Response } from "express";
import { AppDataSource } from "../config/db";
import { User } from "../entities/User";
import { Payment } from "../entities/transactions";
import { createHmac } from "crypto";

export const initiatePayment = async (req: any, res: any) => {
  const userId = req.user.id;
  const { amount } = req.body;

  const txnRefNo = Date.now().toString();

  try {
    const salt = process.env.JAZZCASH_INTEGRITY_SALT!.trim();
    const merchantId = process.env.JAZZCASH_MERCHANT_ID!.trim();
    const password = process.env.JAZZCASH_PASSWORD!.trim();
    const returnURL = process.env.JAZZCASH_RETURN_URL!.trim();

    const now = new Date();
    const pktTime = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const formattedDate = pktTime
      .toISOString()
      .replace(/[-:T.Z]/g, "")
      .slice(0, 14);

    const expiryDate = new Date(pktTime.getTime() + 60 * 60 * 1000);
    const formattedExpiry = expiryDate
      .toISOString()
      .replace(/[-:T.Z]/g, "")
      .slice(0, 14);

    const paisaAmount = Math.round(Number(amount) * 100).toString();

    const paymentRepo = AppDataSource.getRepository(Payment);
    await paymentRepo.save({
      txnRefNo,
      amount: Number(amount),
      userId,
      status: "PENDING",
    });

    const postData: any = {
      pp_Version: "1.1",
      pp_TxnType: "MWALLET",
      pp_Language: "EN",
      pp_MerchantID: merchantId,
      pp_Password: password,
      pp_TxnRefNo: txnRefNo,
      pp_Amount: paisaAmount,
      pp_TxnCurrency: "PKR",
      pp_TxnDateTime: formattedDate,
      pp_BillReference: "billRef",
      pp_Description: "Topup",
      pp_ReturnURL: returnURL,
      pp_ExpiryDateTime: formattedExpiry,
    };

    const sortedKeys = Object.keys(postData).sort();
    let hashString = salt;
    for (const key of sortedKeys) {
      if (postData[key] !== "") {
        hashString += `&${postData[key]}`;
      }
    }

    postData.pp_SecureHash = createHmac("sha256", salt)
      .update(hashString)
      .digest("hex")
      .toUpperCase();

    console.log(`🚀 Init Payment: ${txnRefNo} | Amount: ${paisaAmount}`);

    return res.json({
      url: "https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform",
      postData,
    });
  } catch (error) {
    console.log("❌ Init Error:", error);
    res.status(500).json({ message: "Fail" });
  }
};

export const createPayment = async (req: Request, res: Response) => {
  const body = req.body;

  if (!body || !body.pp_TxnRefNo) {
    return res.status(200).send("OK");
  }

  console.log(`--- JazzCash Callback --- ${body.pp_TxnRefNo}`);
  console.log(`Code: ${body.pp_ResponseCode} Msg: ${body.pp_ResponseMessage}`);

  try {
    await AppDataSource.transaction(async (manager) => {
      const payment = await manager.findOne(Payment, {
        where: { txnRefNo: body.pp_TxnRefNo },
        lock: { mode: "pessimistic_write" },
      });

      if (!payment) {
        console.log("❌ Payment Record Not Found in DB");
        return;
      }

      if (payment.status === "SUCCESS") return;

      const isSuccessful =
        body.pp_ResponseCode === "000" ||
        body.pp_ResponseCode === "121" ||
        (process.env.NODE_ENV === "development" &&
          ["999", "199"].includes(body.pp_ResponseCode));

      if (isSuccessful) {
        const user = await manager.findOne(User, {
          where: { id: payment.userId },
        });

        if (user) {
          const paidAmount = Number(parseFloat(body.pp_Amount) / 100);
          const oldBalance = Number(user.pendingBalance || 0);
          user.pendingBalance = oldBalance + paidAmount;
          await manager.save(User, user);
          console.log(
            `✅ User Balance Updated: ${oldBalance} -> ${user.pendingBalance}`,
          );
        }

        payment.status = "SUCCESS";
        payment.jazzcashTransactionId = body.pp_RetRefNo || "N/A";
      } else {
        payment.status = "FAILED";
      }

      await manager.save(Payment, payment);
      console.log(`✅ DB Sync Status: ${payment.status}`);
    });

    return res.status(200).send("OK");
  } catch (error) {
    console.log("❌ Callback Processing Error:", error);
    return res.status(200).send("OK");
  }
};

export const getPaymentStatus = async (req: any, res: any) => {
  const { txnRefNo } = req.params;
  try {
    const payment = await AppDataSource.getRepository(Payment).findOne({
      where: { txnRefNo },
    });
    if (!payment) return res.status(404).json({ status: "NOT_FOUND" });
    return res.json({ status: payment.status });
  } catch (error) {
    return res.status(500).json({ message: "Error" });
  }
};
