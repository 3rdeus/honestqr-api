import type { VercelRequest, VercelResponse } from '@vercel/node';
import QRCode from 'qrcode';
import { z } from 'zod';

// Rate limiting store (in-memory for serverless)
const rateLimit = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // 30 requests per minute

// Helper function to check rate limit
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimit.get(ip);

  if (!record || now > record.resetTime) {
    rateLimit.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  record.count++;
  return true;
}

const qrRequestSchema = z.object({
  url: z.string().url('Invalid URL format'),
  format: z.enum(['png', 'svg', 'dataURL']).default('png'),
  size: z.number().min(100).max(2000).default(300),
  darkColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#000000'),
  lightColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#ffffff'),
  errorCorrectionLevel: z.enum(['L', 'M', 'Q', 'H']).default('M'),
  margin: z.number().min(0).max(10).default(4),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', 'https://honestqr.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 
                   (req.headers['x-real-ip'] as string) || 
                   'unknown';
  
  if (!checkRateLimit(clientIp)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ 
      success: false,
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.'
    });
  }

  try {
    // Validate request body
    const validatedData = qrRequestSchema.parse(req.body);
    const { url, format, size, darkColor, lightColor, errorCorrectionLevel, margin } = validatedData;

    // QR code generation options
    const qrOptions = {
      errorCorrectionLevel,
      quality: 0.92,
      margin,
      color: {
        dark: darkColor,
        light: lightColor,
      },
      width: size,
    };

    // Set cache headers for static QR codes
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    // Generate QR code based on format
    if (format === 'svg') {
      const svgString = await QRCode.toString(url, { ...qrOptions, type: 'svg' });
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.status(200).send(svgString);
    } else if (format === 'dataURL') {
      const dataURL = await QRCode.toDataURL(url, qrOptions);
      return res.status(200).json({ success: true, dataURL });
    } else {
      // Default PNG format
      const buffer = await QRCode.toBuffer(url, qrOptions);
      res.setHeader('Content-Type', 'image/png');
      return res.status(200).send(buffer);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request parameters',
        details: error.issues,
      });
    }

    // Log error for debugging (in production, use proper logging service)
    console.error('QR generation error:', error);

    return res.status(500).json({
      success: false,
      error: 'Failed to generate QR code',
      message: process.env.NODE_ENV === 'development' && error instanceof Error 
        ? error.message 
        : 'An unexpected error occurred',
    });
  }
}
