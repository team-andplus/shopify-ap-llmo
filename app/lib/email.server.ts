import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "sv219.xbiz.ne.jp",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("[email] SMTP credentials not configured, skipping email");
    return { success: false, error: "SMTP credentials not configured" };
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || "info@andplus.tech",
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    console.log("[email] Sent:", info.messageId);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[email] Failed to send:", message);
    return { success: false, error: message };
  }
}
