import nodemailer, { type Transporter } from 'nodemailer';

export type EmailTemplate =
  | 'registration-otp'
  | 'password-reset-otp'
  | 'password-change-otp'
  | 'email-change-old-otp'
  | 'email-change-new-otp'
  | 'welcome';

type EmailOptions = {
  to: string;
  template: EmailTemplate;
  code?: string;
  nickname?: string;
};

type EmailTemplateContent = {
  subject: string;
  preheader?: string;
  title: string;
  bodyHtml: string;
  bodyText: string;
  code?: string;
};

type EmailTransporter = Transporter;

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;',
};

let transporter: EmailTransporter | null = null;

const escapeHtml = (value: string): string =>
  value.replace(/[&<>'"]/g, character => HTML_ENTITIES[character] ?? character);

const getTransporter = (): EmailTransporter => {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass || !Number.isInteger(port) || port <= 0) {
    throw new Error('SMTP is not configured');
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    pool: true,
    maxConnections: Number(process.env.SMTP_MAX_CONNECTIONS || 5),
    maxMessages: Number(process.env.SMTP_MAX_MESSAGES || 100),
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 10_000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10_000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 30_000),
  });

  return transporter;
};

const otpTemplate = (options: {
  subject: string;
  title: string;
  introHtml: string;
  introText: string;
  code?: string;
}): EmailTemplateContent => ({
  subject: options.subject,
  title: options.title,
  bodyHtml: `<p style="margin:0 0 18px">${options.introHtml}</p>`,
  bodyText: options.introText,
  code: options.code?.trim(),
});

const getTemplate = (
  template: EmailTemplate,
  code?: string,
  nickname?: string
): EmailTemplateContent => {
  const safeNickname = nickname ? escapeHtml(nickname) : 'there';
  const safeCode = code?.trim();

  switch (template) {
    case 'registration-otp':
      return otpTemplate({
        subject: 'Verify your identity',
        title: 'Verify your email',
        introHtml:
          'Thanks for creating a Framezoo account. Enter the following code in the app to verify your email and finish signing up.',
        introText:
          'Thanks for creating a Framezoo account. Enter the following code in the app to verify your email and finish signing up.',
        code: safeCode,
      });
    case 'password-reset-otp':
      return otpTemplate({
        subject: 'Verify your identity',
        title: 'Reset your password',
        introHtml:
          'We received a request to reset your Framezoo password. Enter the following code in the app to continue.',
        introText:
          'We received a request to reset your Framezoo password. Enter the following code in the app to continue.',
        code: safeCode,
      });
    case 'password-change-otp':
      return otpTemplate({
        subject: 'Verify your identity',
        title: 'Confirm password change',
        introHtml:
          'Someone requested a password change for your Framezoo account. Enter the following code in the app to confirm it.',
        introText:
          'Someone requested a password change for your Framezoo account. Enter the following code in the app to confirm it.',
        code: safeCode,
      });
    case 'email-change-old-otp':
      return otpTemplate({
        subject: 'Verify your identity',
        title: 'Confirm email change',
        introHtml:
          'A request was made to change the email on your Framezoo account. Enter the following code to confirm that request.',
        introText:
          'A request was made to change the email on your Framezoo account. Enter the following code to confirm that request.',
        code: safeCode,
      });
    case 'email-change-new-otp':
      return otpTemplate({
        subject: 'Verify your identity',
        title: 'Verify your new email',
        introHtml:
          'Enter the following code in the app to verify this email address for your Framezoo account.',
        introText:
          'Enter the following code in the app to verify this email address for your Framezoo account.',
        code: safeCode,
      });
    case 'welcome':
      return {
        subject: 'Welcome to Framezoo',
        title: `Welcome to Framezoo, ${safeNickname}!`,
        preheader: 'Your Framezoo account is ready. Let the watching begin.',
        bodyHtml:
          '<p style="margin:0 0 18px">Thanks for joining Framezoo. Your account is ready, and your movie space is waiting for you.</p><p style="margin:0 0 18px">Explore movies and TV, keep your watch history in sync, and make every stream feel like home.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;border-collapse:separate;border-spacing:0"><tr><td style="padding:18px;background:#f4f1ff;border:1px solid #e4ddff;border-radius:12px;color:#403568;font-size:15px;line-height:1.6"><strong style="color:#241b4b">A few places to start</strong><br>Discover something new, save what you want to watch, and personalize your viewing experience across your devices.</td></tr></table><p style="margin:0">Enjoy your next great watch. We are glad you are here.</p>',
        bodyText:
          'Thanks for joining Framezoo. Your account is ready, and your movie space is waiting for you.\n\nExplore movies and TV, keep your watch history in sync, and make every stream feel like home.\n\nA few places to start: Discover something new, save what you want to watch, and personalize your viewing experience across your devices.\n\nEnjoy your next great watch. We are glad you are here.',
      };
  }
};

const renderEmail = (template: EmailTemplateContent): { html: string; text: string } => {
  const codeHtml = template.code
    ? `<div style="text-align:center;margin:24px 0"><div style="margin:0 auto;width:210px;height:54px;background-color:#f4f1ff;border:1px solid #e4ddff;border-radius:10px;line-height:54px;font-weight:700;font-size:28px;letter-spacing:4px;color:#241b4b;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;user-select:all;-webkit-user-select:all">${escapeHtml(template.code)}</div><div style="margin-top:10px;font-size:13px;line-height:1.4;color:#6f6597">This code expires in 10 minutes.</div></div>`
    : '';
  const preheaderHtml = template.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(template.preheader)}</div>`
    : '';
  const codeText = template.code
    ? `\n\n${template.code}\n\nThis code expires in 10 minutes.\n\n`
    : '\n\n';
  const securityHtml = template.code
    ? 'Never share this code with anyone. If you did not request this email, you can ignore it.'
    : 'If you did not request this email, you can ignore it.';
  const securityText = template.code
    ? 'Keep your account safe. Never share this code with anyone. If you did not request this email, you can ignore it.'
    : 'Keep your account safe. If you did not request this email, you can ignore it.';

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="x-apple-disable-message-reformatting"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(template.subject)}</title></head><body style="margin:0;padding:0;background:#f4f5fb;color:#1d1930;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">${preheaderHtml}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f4f5fb"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border-collapse:separate;border-spacing:0"><tr><td style="padding:28px 32px;background:#241b4b;border-radius:18px 18px 0 0"><div style="font-size:20px;line-height:1;letter-spacing:3px;color:#fff;font-weight:800">FRAMEZOO</div><div style="margin-top:8px;font-size:13px;line-height:1.4;color:#cfc8ef">Your personal movie space</div></td></tr><tr><td style="padding:34px 32px 30px;background:#fff;border:1px solid #e8e7f0;border-top:0;border-radius:0 0 18px 18px"><h1 style="margin:0 0 18px;color:#241b4b;font-size:28px;line-height:1.2;font-weight:800">${template.title}</h1>${template.bodyHtml}${codeHtml}<p style="margin:24px 0 0;padding:16px;background:#faf9fd;border-left:3px solid #7563d8;color:#5e5871;font-size:13px;line-height:1.6"><strong style="color:#403568">Keep your account safe.</strong><br>${securityHtml}</p></td></tr><tr><td align="center" style="padding:22px 16px 0;color:#88839b;font-size:12px;line-height:1.6">Framezoo · This is an automated message. Please do not reply.</td></tr></table></td></tr></table></body></html>`;
  const text = `${template.title}\n\n${template.bodyText}${codeText}${securityText}\n\nFramezoo\nThis is an automated message. Please do not reply.`;

  return { html, text };
};

export async function sendEmail(options: EmailOptions): Promise<{ messageId?: string }> {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  if (!from) throw new Error('MAIL_FROM or SMTP_USER is not configured');

  const template = getTemplate(options.template, options.code, options.nickname);
  const rendered = renderEmail(template);

  const result = await getTransporter().sendMail({
    from,
    to: options.to,
    subject: template.subject,
    text: rendered.text,
    html: rendered.html,
  });

  return { messageId: result.messageId };
}
