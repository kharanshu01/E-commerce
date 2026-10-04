const nodemailer = require('nodemailer');

let transporter;
function getTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
  }
  return transporter;
}

module.exports = async function sendOrderConfirmation(order, isStatusUpdate = false) {
  const mailer = getTransporter();
  if (!mailer || !order.shipping?.email) return;
  const orderNumber = String(order._id).slice(-8).toUpperCase();
  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: order.shipping.email,
      subject: isStatusUpdate ? `FashionHub order #${orderNumber}: ${order.status}` : `FashionHub order #${orderNumber} confirmed`,
      text: `${isStatusUpdate ? 'Your order status has been updated.' : 'Thank you for your order.'} Order #${orderNumber} total: ₹${order.totalPrice}. Current status: ${order.status}.${order.trackingNumber ? ` Tracking number: ${order.trackingNumber}.` : ''}`,
      html: `<p>${isStatusUpdate ? 'Your order status has been updated.' : `Thank you for your order, ${String(order.shipping.firstName || 'customer').replace(/[&<>"']/g, '')}.`}</p><p>Order <strong>#${orderNumber}</strong> total: ₹${order.totalPrice}</p><p>Status: ${order.status}</p>${order.trackingNumber ? `<p>Tracking number: ${String(order.trackingNumber).replace(/[&<>"']/g, '')}${order.courier ? ` · ${String(order.courier).replace(/[&<>"']/g, '')}` : ''}</p>` : ''}`,
    });
  } catch (error) {
    console.error('Order confirmation email failed:', error.message);
  }
};