import type { VercelRequest, VercelResponse } from '@vercel/node';
import QRCode from 'qrcode';
import { z } from 'zod';

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
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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

    return res.status(500).json({
      success: false,
      error: 'Failed to generate QR code',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
