import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(req: NextRequest) {
  try {
    const { email, subject, message } = await req.json();
    if (!email || !subject || !message) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 });
    }

    // Debug: Check if env variables are loaded
    console.log('ICLOUD_USER exists:', !!process.env.ICLOUD_USER);
    console.log('ICLOUD_PW exists:', !!process.env.ICLOUD_PW);
    console.log('ICLOUD_USER length:', process.env.ICLOUD_USER?.length);

    if (!process.env.ICLOUD_USER || !process.env.ICLOUD_PW) {
      return NextResponse.json({ error: 'Email credentials not configured' }, { status: 500 });
    }

    // Set up nodemailer with iCloud SMTP
    const transporter = nodemailer.createTransport({
      host: 'smtp.mail.me.com',
      port: 587,
      secure: false, // Use STARTTLS for port 587
      requireTLS: true, // Force TLS
      debug: true, // Add this line for verbose logging
      auth: {
        user: process.env.ICLOUD_USER, // Authenticate with @icloud.com
        pass: process.env.ICLOUD_PW,
      },
      tls: {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2'
      }
    });

    // Use custom domain for "from" if specified, otherwise use iCloud email
    const fromAddress = process.env.NARA_FROM_EMAIL || process.env.ICLOUD_USER;

    const mailOptions = {
      from: fromAddress, // Send from custom domain (jun@nara.ws)
      to: email,
      bcc: 'j7un28@gmail.com', // BCC j7un28@gmail.com on every email
      subject,
      text: message,
    };

    await transporter.sendMail(mailOptions);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to send email.' }, { status: 500 });
  }
}
